/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Inscrições: leitura
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (FASE 75 · fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `registration-service` é o arquivo da ESCRITA: reserva de vaga, fila de espera,
 *  confirmação, cancelamento e promoção continuam lá, porque compartilham UMA
 *  transação (ADR-175/178) e é ela que prova a atomicidade. Aqui mora o que só LÊ:
 *  as inscrições da própria pessoa, a inscrição dela no evento e na atividade, os
 *  campos que o organizador declarou, os contadores de uma atividade e a fila do
 *  evento.
 *
 *  A extração foi MECÂNICA: o corpo das funções veio sem reescrita. O que mudou foi
 *  o lugar e o cabeçalho de imports.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CADA LEITURA ABRE A PRÓPRIA LEITURA (E SÓ ELA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `withTenant` aqui é contexto de RLS para uma consulta — não é fronteira de
 *  escrita. Nenhuma função deste arquivo chama `recordAudit`, usa verbo de escrita
 *  (`create`/`update`/`delete`) nem abre `$transaction`; quem grava é o serviço
 *  original, dono da transação. É a catraca `f75-servicos-fracionados` que prende
 *  isso.
 *
 *  A leitura da própria inscrição é a porta de "Minhas inscrições" e da página de
 *  inscrição: ela não decide nada, e é justamente por isso que pode sair do serviço
 *  de escrita sem mover efeito nenhum.
 */
import { withTenant } from '@/lib/db/tenant-client';
import {
  canAcceptPromotion,
  type RegistrationStatus,
} from '@/domain/events/registration-rules';
import {
  confirmationCountdown,
  confirmationDeadlineLabel,
  confirmationStateOf,
  parseConfirmationRequirements,
  requirementLabel,
  type ConfirmationPolicy,
  type ConfirmationState,
} from '@/domain/events/confirmation-rules';
import {
  itemsSummary,
  itemStatusLabel,
  normalizeItemStatus,
  type ConfirmationItemStatus,
} from '@/domain/events/confirmation-item-rules';
import {
  erasePersonalFormResponses,
  readRegistrationForm,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import { effectiveActivityCapacity } from '@/domain/events/event-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Consulta da própria inscrição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Um item do checklist de confirmação, como o PARTICIPANTE o vê (FASE 37).
 *
 * O participante lê o rótulo e o estado; quem marca é a equipe — o checklist aqui é
 * informação, não formulário.
 */
export interface MyConfirmationItem {
  id: string;
  position: number;
  label: string;
  note: string | null;
  required: boolean;
  status: ConfirmationItemStatus;
  /** "A receber" / "Recebido" / "Dispensado pela organização". */
  statusLabel: string;
}

export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  waitlistPosition: number | null;
  createdAt: Date;
  activityId: string;
  activityTitle: string;
  activitySlug: string;
  activityStartsAt: Date;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  /** `true` = a inscrição do EVENTO (sem atividade), não de uma atividade. */
  isEventRegistration: boolean;
  /** `true` = criada pela inscrição no evento (atividade aberta). */
  isAutomatic: boolean;
  /**
   * `true` quando há resposta pessoal a apagar (FASE 70): campo declarado preenchido
   * ou nota de acessibilidade. O CPF sozinho NÃO conta — ele fica.
   */
  hasErasableResponses: boolean;
  /**
   * ─── A VAGA OFERTADA PELA FILA (dívida E1) ──────────────────────────────────
   * Existe quando a pessoa foi CHAMADA da lista de espera e a decisão é DELA: a vaga
   * está retida em nome dela até `dueAt`, e o botão de aceitar vive na tela.
   *
   * `null` quando não há oferta a aceitar — inclusive quando a atividade exige
   * conferência da equipe: aí quem confirma é o time, pela fila de confirmações, e
   * quem fala disso é o campo `confirmation` (FASE 34). Os dois campos são coisas
   * diferentes de propósito: um é a decisão da PESSOA, o outro é a conferência da
   * EQUIPE, e misturá-los faria a tela pedir a quem não pode decidir.
   */
  promotion: { dueAt: Date; deadlineLabel: string } | null;
  /**
   * ─── Confirmação de vaga (FASE 34) ──────────────────────────────────────────
   * O que a pessoa precisa saber na lista: se a vaga está RETIDA devendo
   * confirmação, até quando, o que levar e onde ir. A tela não tem botão de
   * confirmar — quem confirma é a equipe —, então o aviso é INSTRUÇÃO, e não ação.
   */
  confirmation: {
    state: ConfirmationState;
    /** "25/09/2026, 23:59" no fuso do evento. */
    deadlineLabel: string | null;
    /** "faltam 2 dias" / "vence em menos de uma hora". */
    countdown: string | null;
    /** O checklist do que levar/apresentar. */
    requirements: string[];
    /**
     * O checklist ITEM A ITEM desta inscrição (FASE 37) — o que a equipe marca no
     * balcão e o que a vaga precisa ver satisfeito para se confirmar sozinha.
     *
     * Vem SEPARADO de `requirements` de propósito: `requirements` é a configuração
     * ATUAL da atividade, e isto é o snapshot do que foi cobrado de quem se inscreveu.
     * O organizador que editar a atividade amanhã muda o segundo e não o primeiro — e
     * quem já está na fila continua devendo o que foi combinado com ele.
     */
    items: MyConfirmationItem[];
    /** "2 de 3 itens" — o mesmo resumo que a equipe vê na fila. */
    itemsSummary: string;
    place: string | null;
    confirmedAt: Date | null;
  } | null;
}

/** Inscrições do usuário autenticado nesta instituição. */
export async function listMyRegistrations(
  tenantId: string,
  userId: string,
): Promise<MyRegistration[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.registration.findMany({
      where: { userId, deletedAt: null, status: { not: 'CANCELED' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        waitlistPosition: true,
        createdAt: true,
        activityId: true,
        eventId: true,
        origin: true,
        confirmationDueAt: true,
        confirmedAt: true,
        cancelReason: true,
        /**
         * Os dois campos que decidem se há o que APAGAR (FASE 70 · fatia 4). Entram na
         * MESMA consulta da lista de propósito: a tela precisa do fato para desenhar (ou
         * não) o controle de eliminação, e uma segunda ida ao banco por linha seria N+1
         * numa tela que abre a cada visita.
         */
        formResponses: true,
        accessibilityNotes: true,
        activity: {
          select: {
            title: true,
            slug: true,
            startsAt: true,
            confirmationPolicy: true,
            confirmationRequirements: true,
            confirmationPlace: true,
          },
        },
        event: { select: { title: true, slug: true, timezone: true } },
        /**
         * O checklist da PRÓPRIA inscrição (FASE 37). Uma consulta só para todas as
         * inscrições da lista: o Prisma resolve a relação por `IN`, e pedir os itens
         * dentro do `map` faria N+1 numa tela que abre a cada visita.
         */
        confirmationItems: {
          orderBy: { position: 'asc' },
          select: {
            id: true,
            position: true,
            label: true,
            note: true,
            required: true,
            status: true,
          },
        },
      },
    }),
  );

  const now = new Date();

  return rows.map((row) => ({
    id: row.id,
    status: row.status as RegistrationStatus,
    waitlistPosition: row.waitlistPosition,
    createdAt: row.createdAt,
    /**
     * `activityId` vazio identifica a inscrição DO EVENTO (revisão da FASE 3): é
     * ela que dá acesso às atividades abertas, e a tela a apresenta como
     * "Inscrição no evento", não como uma atividade sem nome.
     */
    activityId: row.activityId ?? '',
    activityTitle: row.activity?.title ?? (row.activityId ? 'Atividade removida' : 'Inscrição no evento'),
    activitySlug: row.activity?.slug ?? '',
    activityStartsAt: row.activity?.startsAt ?? row.createdAt,
    eventId: row.eventId,
    eventTitle: row.event.title,
    eventSlug: row.event.slug,
    isEventRegistration: row.activityId === null,
    isAutomatic: row.origin === 'EVENT_AUTO',
    /**
     * ─── HÁ O QUE APAGAR? (FASE 70 · fatia 4) ───────────────────────────────────
     *
     * A tela de "Minhas inscrições" é o caminho visível para ELIMINAR as respostas do
     * formulário. O controle só aparece quando há o que eliminar: oferecer "apague as
     * suas respostas" a quem nunca respondeu nada é um beco sem saída — a pessoa clica,
     * o servidor responde "nada a apagar" e ela fica sem saber se o sistema falhou.
     *
     * A régua é a do DOMÍNIO (`erasePersonalFormResponses`), e não uma cópia: o que
     * sobra depois da eliminação é exatamente o que NÃO conta como resposta pessoal
     * (o CPF, que é obrigação do evento). Contar à mão aqui daria uma tela que oferece
     * o botão para sempre, ou que o esconde de quem tem o que apagar.
     */
    hasErasableResponses:
      erasePersonalFormResponses(row.formResponses).removedKeys.length > 0 ||
      row.accessibilityNotes !== null,
    /**
     * A confirmação só existe quando a atividade pede confirmação E há vaga retida
     * (ou confirmada) a mostrar. Numa atividade automática, ou na inscrição do
     * evento, o campo é `null` — e a tela não fala de prazo nenhum. Preencher com
     * "previsto para 23:59" numa atividade que não confirma seria inventar uma
     * obrigação que ninguém pediu.
     */
    /**
     * A oferta da fila (dívida E1) — a régua do aceite é do DOMÍNIO, e não um `if` da
     * tela: quem pode aceitar, quando o prazo venceu e onde quem confirma é a equipe
     * estão em `canAcceptPromotion`, testado sem banco nem navegador.
     */
    promotion: canAcceptPromotion({
      status: row.status as RegistrationStatus,
      dueAt: row.confirmationDueAt,
      policy: (row.activity?.confirmationPolicy as 'AUTOMATIC' | 'REQUIRED' | undefined) ?? null,
      now,
    }).ok
      ? {
          dueAt: row.confirmationDueAt as Date,
          /** "25/09/2026, 23:59" no fuso do evento — a MESMA régua do prazo da F34. */
          deadlineLabel: confirmationDeadlineLabel(
            row.confirmationDueAt as Date,
            row.event.timezone,
          ),
        }
      : null,
    confirmation: row.activity
      ? (() => {
          const policy = row.activity.confirmationPolicy as ConfirmationPolicy;
          const state = confirmationStateOf({
            policy,
            status: row.status as RegistrationStatus,
            dueAt: row.confirmationDueAt,
            now,
            cancelReason: row.cancelReason,
          });

          if (policy !== 'REQUIRED') return null;
          if (state === 'NOT_REQUIRED') return null;

          const items: MyConfirmationItem[] = row.confirmationItems.map((item) => {
            const status = normalizeItemStatus(item.status);

            return {
              id: item.id,
              position: item.position,
              label: item.label,
              note: item.note,
              required: item.required,
              status,
              statusLabel: itemStatusLabel(status),
            };
          });

          return {
            state,
            deadlineLabel: row.confirmationDueAt
              ? confirmationDeadlineLabel(row.confirmationDueAt, row.event.timezone)
              : null,
            countdown: row.confirmationDueAt
              ? confirmationCountdown(row.confirmationDueAt, now)
              : null,
            requirements: parseConfirmationRequirements(
              row.activity.confirmationRequirements,
            ).map(requirementLabel),
            items,
            itemsSummary: itemsSummary(items),
            place: row.activity.confirmationPlace,
            confirmedAt: row.confirmedAt,
          };
        })()
      : null,
  }));
}

/** Inscrição do usuário no EVENTO, se existir. */
export async function findMyEventRegistration(
  tenantId: string,
  userId: string,
  eventId: string,
): Promise<{
  id: string;
  status: RegistrationStatus;
  waitlistPosition: number | null;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS RESPOSTAS GRAVADAS VÊM JUNTO (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A porta "Completar meus dados" precisa MOSTRAR o que a pessoa já respondeu. Sem
   *  isso, ela abriria um formulário em branco sobre respostas que existem — e a pessoa
   *  (ou a organização, que lê a tela) não teria como saber que o dado está lá. É a
   *  mesma leitura que já é feita: uma coluna a mais na projeção, e não uma consulta.
   */
  formResponses: Record<string, unknown>;
  /**
   * A nota de acessibilidade — uma COLUNA, e não resposta de campo declarado.
   *
   * Ela vem junto pelo mesmo motivo das respostas: o formulário de "completar" a
   * reenvia, e um campo em branco faria a nota gravada ser SOBRESCRITA por vazio a cada
   * passada por ali. Mostrar o valor é o que faz o reenvio ser inofensivo.
   */
  accessibilityNotes: string | null;
} | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { userId, eventId, activityId: null, deletedAt: null },
      select: {
        id: true,
        status: true,
        waitlistPosition: true,
        formResponses: true,
        accessibilityNotes: true,
      },
    }),
  );

  if (!row) return null;

  return {
    id: row.id,
    status: row.status as RegistrationStatus,
    /**
     * A posição na FILA DO EVENTO (dívida E33): a tela pública precisa dela para dizer
     * onde a pessoa está — sem o número, "você está na lista de espera" não responde a
     * única pergunta que a pessoa tem.
     */
    waitlistPosition: row.waitlistPosition,
    /**
     * Depósito de respostas: `null`, texto ou lista viram objeto VAZIO, e não erro — o
     * leitor tolerante é o mesmo de todo o resto do formulário, e uma tela de inscrição
     * não pode cair porque uma coluna Json antiga está num formato inesperado.
     */
    formResponses:
      row.formResponses !== null &&
      typeof row.formResponses === 'object' &&
      !Array.isArray(row.formResponses)
        ? (row.formResponses as Record<string, unknown>)
        : {},
    accessibilityNotes: row.accessibilityNotes,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OS CAMPOS QUE O ORGANIZADOR DECLAROU (FASE 70 · fatia 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ACTION LÊ ISTO, E NÃO O QUE A TELA MANDOU
 * ─────────────────────────────────────────────────────────────────────────────
 *  `validateFormResponses` precisa da ESPECIFICAÇÃO para decidir o que entra das
 *  respostas — e a especificação é do EVENTO, não do `<form>`. Aceitá-la como campo
 *  do formulário deixaria qualquer pessoa declarar o próprio spec no POST e gravar
 *  `{ cpf: ... }` (ou qualquer chave) como resposta de campo declarado: a validação
 *  passaria a ser uma formalidade que o cliente cumpre consigo mesmo.
 *
 *  A leitura passa pelo leitor TOLERANTE do domínio, o MESMO que a página do
 *  participante usa: a tela e o servidor não podem discordar sobre quais campos
 *  existem. Configuração torta devolve lista vazia — e vazia significa "o formulário
 *  de sempre", que é o que a pessoa vê e o que ela responde.
 */
export async function readEventRegistrationFields(input: {
  tenantId: string;
  eventSlug: string;
}): Promise<readonly RegistrationFormField[]> {
  return withTenant(input.tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { slug: input.eventSlug, deletedAt: null },
      select: { settings: true },
    });

    if (!event) return [];

    return readRegistrationForm(event.settings).fields;
  });
}

/** Inscrição do usuário em UMA atividade, se existir. */
export async function findMyRegistrationFor(
  tenantId: string,
  userId: string,
  activityId: string,
): Promise<{ id: string; status: RegistrationStatus; waitlistPosition: number | null } | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.registration.findFirst({
      where: { userId, activityId, deletedAt: null },
      select: { id: true, status: true, waitlistPosition: true },
    }),
  );

  if (!row) return null;
  return {
    id: row.id,
    status: row.status as RegistrationStatus,
    waitlistPosition: row.waitlistPosition,
  };
}

/**
 * Exposto para os testes de integração medirem o estado real.
 *
 * `capacity` é o LIMITE EFETIVO (o teto da sala já aplicado) e `declaredCapacity` é
 * o que a atividade declara — os dois juntos, porque um teste que só visse o
 * declarado não conseguiria distinguir "80 vagas" de "80 vagas numa sala de 40".
 */
export async function readActivityCounters(
  tenantId: string,
  activityId: string,
): Promise<{
  confirmedCount: number;
  waitlistCount: number;
  capacity: number | null;
  declaredCapacity: number | null;
  roomCapacity: number | null;
} | null> {
  const row = await withTenant(tenantId, (tx) =>
    tx.activity.findFirst({
      where: { id: activityId },
      select: {
        confirmedCount: true,
        waitlistCount: true,
        capacity: true,
        room: { select: { capacity: true } },
      },
    }),
  );

  if (!row) return null;

  return {
    confirmedCount: row.confirmedCount,
    waitlistCount: row.waitlistCount,
    capacity: effectiveActivityCapacity(row.capacity, row.room?.capacity ?? null),
    declaredCapacity: row.capacity,
    roomCapacity: row.room?.capacity ?? null,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QUEM ESPERA VAGA NO EVENTO (dívida E33)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A fila existe no banco desde que a reserva falha — mas dívida que não se vê não
 *  existe para quem organiza: antes desta leitura, a instituição só descobria a
 *  procura por fora (telefone, e-mail) e refazia à mão o que o sistema já sabia.
 *
 *  A lista sai na ORDEM DA FILA (`waitlistPosition`), que é a ordem em que as
 *  promoções acontecem. Ordenar por data de entrada daria uma fila bonita e uma
 *  posição mentirosa, porque quem entrou depois de uma reindexação tem data maior e
 *  posição menor.
 */
export interface EventWaitlistEntry {
  registrationId: string;
  position: number;
  personName: string;
  waitingSince: Date;
}

export async function listEventWaitlist(input: {
  tenantId: string;
  eventId: string;
}): Promise<EventWaitlistEntry[]> {
  return withTenant(input.tenantId, async (tx) => {
    const rows = await tx.registration.findMany({
      where: {
        eventId: input.eventId,
        activityId: null,
        status: 'WAITLISTED',
        deletedAt: null,
      },
      orderBy: [{ waitlistPosition: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        waitlistPosition: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    return rows.map((row, index) => ({
      registrationId: row.id,
      position: row.waitlistPosition ?? index + 1,
      personName: row.user.name,
      waitingSince: row.createdAt,
    }));
  });
}
