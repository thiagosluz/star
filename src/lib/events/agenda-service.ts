/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — "Minha agenda": favoritar e ler a grade do dia (FASE 65 · fatia 1)
 *
 *  Quatro operações, todas por `withTenant` (nunca `adminPrisma` — invariante nº 1):
 *
 *      favoriteActivity          marcar uma atividade (idempotente)
 *      unfavoriteActivity        desmarcar (idempotente)
 *      listMyFavoriteActivityIds os ids marcados por esta pessoa neste evento
 *      getMyAgenda               a UNIÃO de favoritos e inscrições, com marcas e
 *                                choques já calculados pela regra do domínio
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FAVORITAR NÃO É INSCREVER — A LINHA QUE ESTE ARQUIVO NÃO CRUZA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada aqui importa `registration-service`, nenhuma função daqui escreve em
 *  `registrations`, e nenhuma toca em `activities."confirmedCount"` ou
 *  `"waitlistCount"`. Favoritar NÃO reserva vaga, NÃO consome quota, NÃO entra na
 *  loteria nem na lista de espera: quem garante lugar é a inscrição, com a régua
 *  da `registration-rules.ts` intocada.
 *
 *  O teste de integração prende isso com a atividade LOTADA — a marca funciona e a
 *  contagem de inscrições não se move —, porque é o tipo de regra que se perde no
 *  dia em que alguém "aproveitar" este serviço para pré-reservar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NENHUMA PERMISSÃO NOVA: A POSSE É O `userId`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Favoritar é ato da PRÓPRIA pessoa — não há `activity:favorite` no catálogo de
 *  permissões, e não deve haver: uma permissão aqui só criaria a possibilidade de
 *  marcar/desmarcar em nome de outra pessoa, que é exatamente o que ninguém quer.
 *  O `userId` vem da SESSÃO (a Server Action da fatia 2 o entrega), e todas as
 *  consultas filtram por ele; a RLS fecha o resto (outra instituição não é
 *  alcançável nem com o id da atividade na mão).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DECISÃO DOCUMENTADA: O FAVORITO **NÃO** ENTRA NA TRILHA DE AUDITORIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `recordAudit` responde "quem mudou o quê, e quando" sobre fatos com efeito para
 *  a INSTITUIÇÃO: vaga reservada, papel concedido, página publicada, ficha de
 *  participante aberta. O favorito não é nada disso — é preferência PESSOAL,
 *  reversível com um clique, sem efeito para mais ninguém e sem valor probatório:
 *  ninguém precisa saber, seis meses depois, que alguém marcou uma palestra e
 *  desmarcou em seguida.
 *
 *  O custo de auditar seria concreto e o benefício, nulo. `audit_logs` é
 *  PARTICIONADA por mês e a retenção é `DROP TABLE` (dívida B8): cada marca viraria
 *  uma linha num volume que existe para investigar incidente, e o sinal que importa
 *  (quem publicou, quem removeu membro, quem leu dado pessoal) se perderia no ruído
 *  de milhares de corações.
 *
 *  Se a instituição quiser medir INTERESSE algum dia — "quantos marcaram cada
 *  atividade" —, o caminho é CONTAGEM sobre `activity_favorites`: o dado já está
 *  gravado, e contar não exige trilha.
 *
 *  (Discordar é legítimo e o argumento existe: auditar daria o histórico de
 *  mudança de interesse por pessoa. Ele perde para o custo acima e para a natureza
 *  reversível do ato; se a instituição pedir, a decisão volta à mesa ANTES de
 *  virar código.)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { isPubliclyVisible } from '@/domain/events/event-rules';
import { buildMyAgenda, type MyAgenda } from '@/domain/agenda/agenda-rules';

export type FavoriteErrorCode = 'INVALID_INPUT' | 'ACTIVITY_NOT_AVAILABLE' | 'INTERNAL';

export type FavoriteOutcome =
  | { ok: true; created: boolean }
  | { ok: false; code: FavoriteErrorCode; message: string };

export type UnfavoriteOutcome =
  | { ok: true; removed: boolean }
  | { ok: false; code: FavoriteErrorCode; message: string };

/** A grade pronta, com o evento a que ela pertence. */
export interface MyAgendaView extends MyAgenda {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Escrita: marcar e desmarcar
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Marca uma atividade como favorita. IDEMPOTENTE: marcar de novo não é erro e não
 * duplica (`created: false`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A IDEMPOTÊNCIA É DO BANCO, E NÃO DE UM `SELECT` ANTES
 * ─────────────────────────────────────────────────────────────────────────────
 *  `createMany({ skipDuplicates: true })` vira `INSERT ... ON CONFLICT DO NOTHING`
 *  sobre o índice único `(activityId, userId)`. A alternativa — ler para ver se já
 *  existe e então inserir — tem a janela clássica: dois toques simultâneos leem
 *  "não existe" e um deles quebra com violação de unicidade. Pior: em PostgreSQL
 *  qualquer erro ABORTA a transação, e o `try/catch` em volta não a ressuscita
 *  (armadilha 97). Aqui não há erro a tratar, porque não há corrida a perder.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ATIVIDADE PRECISA ESTAR VISÍVEL PARA SER MARCADA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A checagem tem TRÊS papéis, e nenhum é decorativo:
 *    1. uma atividade em RASCUNHO não está na programação pública — marcar algo
 *       que a pessoa não pode ver criaria um item fantasma na grade dela;
 *    2. o evento precisa ser público pela MESMA régua da vitrine
 *       (`isPubliclyVisible`), senão o favorito daria acesso antecipado a um
 *       evento que ainda não existe para o público;
 *    3. o `SELECT` sob RLS é o que prova que a atividade é DESTA instituição — a
 *       chave estrangeira não sabe de tenant, e sem esta leitura um favorito
 *       poderia apontar para a atividade de outra casa.
 */
export async function favoriteActivity(input: {
  tenantId: string;
  userId: string;
  activityId: string;
}): Promise<FavoriteOutcome> {
  const activityId = input.activityId?.trim();
  if (!activityId) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Atividade não informada.' };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const activity = await tx.activity.findFirst({
        where: { id: activityId, deletedAt: null, status: { not: 'DRAFT' } },
        select: {
          id: true,
          event: { select: { status: true, deletedAt: true } },
        },
      });

      if (
        !activity ||
        activity.event.deletedAt !== null ||
        !isPubliclyVisible(activity.event.status)
      ) {
        return {
          ok: false as const,
          code: 'ACTIVITY_NOT_AVAILABLE' as const,
          message: 'Esta atividade não está disponível para favoritar.',
        };
      }

      const inserted = await tx.activityFavorite.createMany({
        data: [
          {
            tenantId: input.tenantId,
            activityId: activity.id,
            userId: input.userId,
          },
        ],
        skipDuplicates: true,
      });

      return { ok: true as const, created: inserted.count === 1 };
    });
  } catch (error) {
    console.error(`[agenda] falha ao favoritar ${activityId}: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível salvar o favorito. Tente novamente.',
    };
  }
}

/**
 * Desmarca uma atividade. IDEMPOTENTE: desmarcar o que não estava marcado não é
 * erro (`removed: false`).
 *
 * Não há `SELECT` antes pelo mesmo motivo da marcação: `deleteMany` afeta 0 linhas
 * quando não há o que apagar, e zero linhas é resposta de negócio (invariante nº 5).
 * A fronteira de tenant continua sendo a RLS — o `where` não repete `tenantId`
 * porque a policy o aplica, mas o `userId` é explícito: ninguém desmarca o
 * favorito de outra pessoa.
 */
export async function unfavoriteActivity(input: {
  tenantId: string;
  userId: string;
  activityId: string;
}): Promise<UnfavoriteOutcome> {
  const activityId = input.activityId?.trim();
  if (!activityId) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Atividade não informada.' };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const deleted = await tx.activityFavorite.deleteMany({
        where: { activityId, userId: input.userId },
      });

      return { ok: true as const, removed: deleted.count === 1 };
    });
  } catch (error) {
    console.error(`[agenda] falha ao desfavoritar ${activityId}: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível remover o favorito. Tente novamente.',
    };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura dos favoritos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os ids das atividades que esta pessoa marcou NESTE evento.
 *
 * A junção com a atividade é o que descobre o evento (não há `eventId` na tabela —
 * ver o comentário do modelo): assim o favorito nunca pode apontar para uma data
 * diferente da atividade que ele representa. Atividade em rascunho e atividade
 * excluída ficam de fora, pelo MESMO critério do serviço de escrita e da regra da
 * grade — três lugares que precisam concordar sobre o que é visível.
 */
export async function listMyFavoriteActivityIds(input: {
  tenantId: string;
  userId: string;
  eventId: string;
}): Promise<string[]> {
  return withTenant(input.tenantId, async (tx) => {
    const rows = await tx.activityFavorite.findMany({
      where: {
        userId: input.userId,
        activity: { eventId: input.eventId, deletedAt: null, status: { not: 'DRAFT' } },
      },
      orderBy: { createdAt: 'asc' },
      select: { activityId: true },
    });

    return rows.map((row) => row.activityId);
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  A grade
// ───────────────────────────────────────────────────────────────────────────────
/**
 * "Minha grade": a UNIÃO de favoritos e inscrições vivas, com marca e choques.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  UMA LEITURA, UMA TRANSAÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  As três consultas (atividades, favoritos, inscrições) rodam no MESMO
 *  `withTenant`. Ler em transações separadas abriria a janela em que alguém se
 *  inscreve entre a leitura das inscrições e a das atividades, e a grade sairia com
 *  um item marcado duas vezes ou com uma vaga que já não existe.
 *
 *  `null` quando o evento não existe NESTA instituição — a RLS torna o evento de
 *  outra casa invisível, então o chamador responde 404 sem precisar saber a
 *  diferença (a mesma escolha de `getPublicEvent`).
 *
 *  As inscrições são lidas SEM filtrar status: quem decidir o que é "inscrição
 *  viva" é `registrationIsLive`, dentro da regra pura — a MESMA definição do índice
 *  único parcial do banco (armadilha 103). Filtrar aqui criaria uma segunda régua
 *  de "vivo" que divergiria da primeira.
 */
export async function getMyAgenda(input: {
  tenantId: string;
  userId: string;
  eventId: string;
}): Promise<MyAgendaView | null> {
  const eventId = input.eventId?.trim();
  if (!eventId) return null;

  return withTenant(input.tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { id: true, slug: true, title: true, timezone: true },
    });

    if (!event) return null;

    const activities = await tx.activity.findMany({
      where: { eventId: event.id, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        startsAt: true,
        endsAt: true,
        type: true,
        workloadMinutes: true,
        room: { select: { name: true } },
      },
    });

    const favorites = await tx.activityFavorite.findMany({
      where: { userId: input.userId, activity: { eventId: event.id } },
      select: { activityId: true },
    });

    const registrations = await tx.registration.findMany({
      where: { eventId: event.id, userId: input.userId, deletedAt: null },
      select: { activityId: true, status: true },
    });

    const agenda = buildMyAgenda({
      timezone: event.timezone,
      activities: activities.map((activity) => ({
        id: activity.id,
        title: activity.title,
        slug: activity.slug,
        status: activity.status,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        type: activity.type,
        roomName: activity.room?.name ?? null,
        workloadMinutes: activity.workloadMinutes,
      })),
      favoriteActivityIds: favorites.map((favorite) => favorite.activityId),
      /**
       * A inscrição no EVENTO (`activityId` nulo) não vira item da grade: ela não
       * tem horário nem sala. O que ela dá é o acesso às atividades abertas, e
       * essas chegam aqui como inscrições `EVENT_AUTO` com atividade própria.
       */
      registrations: registrations.flatMap((row) =>
        row.activityId === null ? [] : [{ activityId: row.activityId, status: row.status }],
      ),
    });

    return {
      eventId: event.id,
      eventSlug: event.slug,
      eventTitle: event.title,
      ...agenda,
    };
  });
}
