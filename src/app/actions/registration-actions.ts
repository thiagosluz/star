'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO EXPOSTOS AO BROWSER — Inscrições
 *
 *  Toda ação aqui:
 *    1. exige sessão autenticada;
 *    2. exige vínculo ATIVO com a instituição do contexto;
 *    3. **exige a permissão RBAC** correspondente, verificada no servidor;
 *    4. delega ao serviço de aplicação (que roda sob RLS e com controle de
 *       lotação atômico).
 *
 *  O passo 3 é o que impede que esconder um botão na UI seja a única proteção.
 *  A UI filtra por conveniência; a autorização real acontece aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { cpfDigits, isValidCpf } from '@/domain/events/registration-form-rules';
import {
  composeFormResponses,
  formResponseFieldName,
  validateFormResponses,
} from '@/domain/events/registration-form-spec-rules';

import { guardAction, guardSelfServiceAction, type ActionPermission } from '@/lib/auth/guard-action';
import {
  cancelRegistration,
  registerForActivity,
  registerForEvent,
  acceptPromotion,
  updateEventRegistrationData,
  type RegistrationOutcome,
} from '@/lib/events/registration-service';
import { readEventRegistrationFields } from '@/lib/events/registration-read-service';
import { eraseMyFormResponses } from '@/lib/events/registration-response-service';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

export interface RegistrationActionState {
  ok: boolean;
  code?: string;
  message?: string;
  /** Posição na lista de espera, quando o desfecho foi WAITLISTED. */
  waitlistPosition?: number | null;
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O QUE A PESSOA DIGITOU VOLTA PARA A TELA (FASE 56 · fatia 3)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O React 19 ZERA os campos de um formulário depois que a Server Action responde —
   *  e o formulário de inscrição é grande (CPF, necessidades de acessibilidade,
   *  consentimentos). Sem devolver os valores, a mensagem "confira os números do CPF"
   *  chegava com o campo VAZIO: a pessoa tinha de redigitar tudo para corrigir um
   *  dígito. O E2E da dívida E54 foi quem pegou isso.
   */
  values?: {
    cpf?: string;
    accessibilityNotes?: string;
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE A PESSOA RESPONDEU NOS CAMPOS DECLARADOS (FASE 70 · fatia 4)
     * ─────────────────────────────────────────────────────────────────────────────
     *  `key` → o texto CRU que chegou do `<form>`, e não o valor normalizado: é ele
     *  que volta para o `defaultValue` do controle. Devolver o normalizado faria a
     *  data digitada reaparecer no formato do banco e a escolha inválida sumir da
     *  tela — exatamente o apagamento que a lição da E54 proíbe.
     */
    declaredFields?: Record<string, string>;
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Guarda de autorização — o contrato PRÓPRIO da inscrição, traduzido
// ───────────────────────────────────────────────────────────────────────────────
interface GuardResult {
  userId: string;
  tenantId: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  POR QUE ESTA GUARDA NÃO DEVOLVE ESTADO COMO AS OUTRAS (e continua sendo UMA)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  As ações desta tela são as do PARTICIPANTE, e a experiência de quem chega sem
 *  sessão é diferente da de quem chegou e não pode: a primeira pessoa precisa
 *  ENTRAR (o chamador redireciona ao login preservando o destino), a segunda
 *  precisa VER o motivo (uma exceção, que a página de erro mostra).
 *
 *  É por isso que o contrato daqui é `null` × `throw` — e não `{ ok: false, state }`
 *  como nas outras guardas. Ele é o contrato que os chamadores já consomem, e a
 *  FASE 75 o manteve: o teste #10 de `f75-guardas-caracterizacao` prende os DOIS
 *  lados (sem sessão → redireciona; sem permissão → lança com a mensagem).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHECAGEM NÃO É MAIS UMA CÓPIA: ELA É O `guardAction`, TRADUZIDO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 75 esta função refazia sessão, instituição, vínculo e `can()` — a
 *  mesma checagem de `guardAction`, mantida em paralelo. Agora ela DELEGA e só
 *  traduz o resultado, usando o motivo estruturado (`reason`) em vez de adivinhar
 *  pela mensagem:
 *
 *    • `NOT_AUTHENTICATED` / `TENANT_NOT_FOUND` / `NO_MEMBERSHIP` → `null`
 *      (o chamador manda para o login);
 *    • `FORBIDDEN` → **lança** com a mensagem da casa.
 *
 *  `FORBIDDEN` é, por construção do `guardAction`, SEMPRE falta de permissão: o
 *  vínculo tem motivo próprio (`NO_MEMBERSHIP`). É essa separação que torna a
 *  tradução exata, e não uma leitura frágil de texto.
 *
 *  A POSSE continua resolvida: numa permissão `:own`, o `guardAction` passa
 *  `ownerId` = pessoa da sessão (o dono do RECURSO segue conferido no serviço, com
 *  o id vindo do banco — a lição da F74). Nada de `ownership` vindo do formulário.
 */
async function requireRegistrationActor(
  tenantSlug: string,
  permission: ActionPermission,
): Promise<GuardResult | null> {
  const auth = await guardAction<RegistrationActionState>({
    tenantSlug,
    permission,
    /**
     * A mensagem é a da tela, e não a da matriz de papéis: quem chega aqui é o
     * participante, e "fale com a organização do evento" é o que ele pode fazer.
     * O teste #10 prende a frase inteira.
     */
    deniedMessage: `Permissão negada: ${permission}. Fale com a organização do evento.`,
  });

  if (auth.ok) return { userId: auth.userId, tenantId: auth.tenantId };

  if (auth.reason !== 'FORBIDDEN') return null;

  throw new Error(auth.state.message ?? `Permissão negada: ${permission}. Fale com a organização do evento.`);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição
// ───────────────────────────────────────────────────────────────────────────────
const registerSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  activitySlug: z.string().trim().min(1).max(140),
  consentImage: z.coerce.boolean().optional().default(false),
  consentData: z.coerce.boolean().optional().default(false),
  accessibilityNotes: z.string().trim().max(600).optional(),
});

export async function registerForActivityAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const raw = {
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    activitySlug: formData.get('activitySlug'),
    consentImage: formData.get('consentImage') === 'on',
    consentData: formData.get('consentData') === 'on',
    accessibilityNotes: (formData.get('accessibilityNotes') as string) || undefined,
  };

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const data = parsed.data;

  /**
   * A guarda da AÇÃO PÚBLICA vive em `@/lib/auth/guard-action` desde a FASE 33: a
   * proposta de chamada (call for proposals) faz exatamente a mesma pergunta —
   * "esta conta, com ou sem vínculo, pode se inscrever/propor nesta instituição
   * aberta?" — e duas cópias da mesma autorização divergem na primeira manutenção
   * (armadilha 55). A cópia local saiu daqui.
   */
  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CREATE,
  });

  // Sem sessão: manda para o login preservando o destino exato.
  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message:
          'Seu perfil não tem permissão para se inscrever em atividades nesta instituição.',
      };
    }

    const target = tenantPath(
      data.tenantSlug,
      `/eventos/${data.eventSlug}/atividades/${data.activitySlug}`,
    );
    redirect(`/login?redirectTo=${encodeURIComponent(target)}`);
  }

  // LGPD: o consentimento de tratamento de dados é obrigatório para inscrever.
  if (!data.consentData) {
    return {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'É necessário autorizar o tratamento dos seus dados para se inscrever.',
    };
  }

  const outcome: RegistrationOutcome = await registerForActivity({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
    activitySlug: data.activitySlug,
    userId: context.userId,
    consentImage: data.consentImage,
    consentData: data.consentData,
    accessibilityNotes: data.accessibilityNotes ?? null,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  // A página precisa refletir o novo contador de vagas.
  revalidatePath(
    tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
    'page',
  );
  revalidatePath(
    tenantPath(
      data.tenantSlug,
      `/eventos/${data.eventSlug}/atividades/${data.activitySlug}`,
    ),
    'page',
  );

  return {
    ok: true,
    code: outcome.status,
    waitlistPosition: outcome.waitlistPosition,
    /**
     * ─── A VAGA RETIDA DIZ O PRAZO E O LUGAR (FASE 34) ─────────────────────────
     *
     *  `PENDING` não é "confirmado" nem "lista de espera": é "a vaga é sua se você
     *  confirmar". A mensagem precisa dizer as três coisas — que a vaga está
     *  RESERVADA, até QUANDO e ONDE confirmar —, senão a pessoa fecha a página
     *  achando que terminou, e descobre o contrário quando a vaga já foi liberada.
     */
    message:
      outcome.status === 'CONFIRMED'
        ? outcome.linkedAsParticipant
          ? 'Inscrição confirmada! Sua conta passou a ser participante desta instituição.'
          : 'Inscrição confirmada!'
        : outcome.status === 'PENDING'
          ? `Sua vaga está RESERVADA e aguarda confirmação${outcome.confirmationDueLabel ? ` até ${outcome.confirmationDueLabel}` : ''}. A confirmação é feita pela organização — sem ela, a vaga é liberada automaticamente.`
          : `Você entrou na lista de espera (posição ${outcome.waitlistPosition}).`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição no EVENTO (revisão da FASE 3)
// ───────────────────────────────────────────────────────────────────────────────
const registerForEventSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  consentImage: z.coerce.boolean().optional().default(false),
  consentData: z.coerce.boolean().optional().default(false),
  accessibilityNotes: z.string().trim().max(600).optional(),
  /**
   * CPF do formulário (FASE 56 · dívida E54). A validação de verdade é a do DOMÍNIO
   * (`isValidCpf`, com os dígitos verificadores) e roda logo abaixo: aqui só se recusa
   * o que nem chega a ser candidato a documento.
   */
  cpf: z.string().trim().max(20).optional(),
});

/**
 * Inscreve a pessoa no evento — e, com isso, em todas as atividades ABERTAS.
 *
 * A ação é a mesma porta da inscrição por atividade (o guarda de vínculo é
 * compartilhado), mas o destino é o evento: quem se inscreve aqui passa a ver a
 * programação liberada, e a mensagem diz o que aconteceu de automático — a pessoa
 * precisa saber em que ela acabou de ser inscrita.
 */
export async function registerForEventAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = registerForEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    consentImage: formData.get('consentImage') === 'on',
    consentData: formData.get('consentData') === 'on',
    accessibilityNotes: (formData.get('accessibilityNotes') as string) || undefined,
    cpf: (formData.get('cpf') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const data = parsed.data;

  /**
   * A guarda da AÇÃO PÚBLICA vive em `@/lib/auth/guard-action` desde a FASE 33: a
   * proposta de chamada (call for proposals) faz exatamente a mesma pergunta —
   * "esta conta, com ou sem vínculo, pode se inscrever/propor nesta instituição
   * aberta?" — e duas cópias da mesma autorização divergem na primeira manutenção
   * (armadilha 55). A cópia local saiu daqui.
   */
  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CREATE,
  });

  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message:
          'Seu perfil não tem permissão para se inscrever nesta instituição.',
      };
    }

    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
      )}`,
    );
  }

  if (!data.consentData) {
    return {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'É necessário autorizar o tratamento dos seus dados para se inscrever.',
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  OS CAMPOS DECLARADOS: O SPEC VEM DO BANCO, AS RESPOSTAS VÊM DO `<form>` (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A especificação é lida do EVENTO (jamais do POST: aceitá-la do cliente faria a
   *  validação ser uma formalidade que quem envia cumpre consigo mesmo), e as
   *  respostas são lidas pelo nome PREFIXADO de cada campo declarado — o mesmo que o
   *  componente desenhou. O que não foi preenchido simplesmente não aparece aqui, e é
   *  o `required` do domínio que decide se isso recusa.
   */
  const declaredFields = await readEventRegistrationFields({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
  });

  const typed: Record<string, string> = {};

  for (const field of declaredFields) {
    const raw = formData.get(formResponseFieldName(field.key));
    if (typeof raw === 'string') typed[field.key] = raw;
  }

  /** O que a pessoa digitou, como ela digitou — volta inteiro em qualquer recusa. */
  const values = {
    cpf: data.cpf,
    accessibilityNotes: data.accessibilityNotes,
    declaredFields: typed,
  };

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  CPF ERRADO É RECUSADO AQUI, COM A PESSOA NA TELA (dívida E54)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O CPF entra em DOCUMENTO (certificado, ata, lista de presença). Aceitar onze
   *  dígitos sem conferir os verificadores emitiria documento errado — e a única hora
   *  em que há alguém para corrigir é esta. O campo é OPCIONAL: quem não informa não
   *  é impedido de se inscrever, apenas não tem o CPF no certificado.
   */
  const cpf = data.cpf ? cpfDigits(data.cpf) : null;

  if (cpf && !isValidCpf(cpf)) {
    return {
      ok: false,
      code: 'INVALID_CPF',
      message: 'O CPF informado não confere. Confira os números e tente de novo.',
      values,
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O DOMÍNIO DECIDE O QUE ENTRA DAS RESPOSTAS — E A ACTION NÃO INVENTA TEXTO
   * ─────────────────────────────────────────────────────────────────────────────
   *  `validateFormResponses` devolve SÓ O ACEITO (é o contrato do `validateProposalData`
   *  da F33): tipo errado, valor acima do teto, escolha fora das opções, número fora
   *  da faixa, data que não existe — e `required` em branco, que é recusa da inscrição
   *  INTEIRA. As mensagens são as DELE, com o rótulo do campo: a tela não reescreve,
   *  não resume e não traduz.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  RECUSA DE CAMPO OPCIONAL TAMBÉM PARA A INSCRIÇÃO — E A RAZÃO É O SILÊNCIO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A alternativa seria gravar o aceito e seguir, deixando o valor inválido de fora.
   *  Isso apagaria em silêncio o que a pessoa digitou num campo OPCIONAL: ela veria a
   *  inscrição confirmada, e a resposta — que ela acredita ter dado — não existiria em
   *  lugar nenhum. Como a recusa devolve o que foi digitado, corrigir custa um dígito;
   *  engolir custaria o dado.
   */
  const declared = validateFormResponses(declaredFields, typed);

  if (!declared.ok) {
    return {
      ok: false,
      code: declared.problem.code,
      message: declared.problem.message,
      values,
    };
  }

  if (declared.rejected.length > 0) {
    return {
      ok: false,
      code: 'INVALID_DECLARED_FIELD',
      message: declared.rejected.map((rejection) => rejection.message).join(' '),
      values,
    };
  }

  const outcome = await registerForEvent({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
    userId: context.userId,
    consentImage: data.consentImage,
    consentData: data.consentData,
    accessibilityNotes: data.accessibilityNotes ?? null,
    /**
     * O CPF vive nas respostas do formulário — é o que o certificado lê depois (E54) —
     * e entra DEPOIS do que o organizador declarou, para que a chave do sistema seja a
     * última palavra. As duas não podem colidir: `cpf` é identificador RESERVADO.
     */
    formResponses: composeFormResponses({
      declared: declared.accepted,
      system: cpf ? { cpf } : {},
    }),
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message, values };
  }

  // A programação inteira muda de estado para esta pessoa: as atividades abertas
  // passam a ter a inscrição dela, e a página do evento mostra o crachá.
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');
  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');

  /**
   * ── EVENTO LOTADO NÃO É RECUSA: É FILA (dívida E33) ─────────────────────────
   *
   *  A mensagem é o único lugar em que a pessoa descobre que está esperando — e ela diz
   *  POSIÇÃO e PRAZO, porque as duas coisas mudam o que a pessoa faz: a posição diz se
   *  vale esperar, e o prazo é o que ela terá para responder quando for chamada (E1).
   *  Sem o prazo na mensagem, o aviso de promoção chegaria como surpresa com data de
   *  validade escondida.
   */
  if (outcome.waitlisted) {
    return {
      ok: true,
      code: 'WAITLISTED',
      message: `O evento está com a lotação completa — você entrou na lista de espera, na posição ${outcome.waitlistPosition ?? 1}. Assim que uma vaga for liberada, você é chamado por e-mail e tem 48 h para confirmar.${
        outcome.linkedAsParticipant ? ' Sua conta passou a ser participante desta instituição.' : ''
      }`,
    };
  }

  const automatic =
    outcome.enrolledActivities > 0
      ? ` Você também foi inscrito automaticamente em ${outcome.enrolledActivities} atividade(s) aberta(s) a todos os participantes: ${outcome.titles.join(', ')}.`
      : '';

  return {
    ok: true,
    code: 'CONFIRMED',
    message: `Inscrição no evento confirmada!${automatic}${
      outcome.linkedAsParticipant
        ? ' Sua conta passou a ser participante desta instituição.'
        : ''
    }`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Completar os dados da inscrição no evento (FASE 70)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  "COMPLETAR MEUS DADOS" — A PORTA DE QUEM VEIO PELA ATIVIDADE (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA AÇÃO PRÓPRIA, E NÃO A INSCRIÇÃO DE NOVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Desde esta fase, inscrever-se numa ATIVIDADE materializa a inscrição no EVENTO.
 *  Essa linha nasce com `formResponses` vazio, porque o formulário da atividade não
 *  coleta CPF — e `registerForEvent` recusa quem já tem inscrição viva (`DUPLICATE`),
 *  corretamente: não faz sentido "se inscrever de novo" quem já está inscrito.
 *
 *  O que falta a essa pessoa é ATUALIZAR a própria inscrição, e é o que esta ação faz.
 *  Ela NÃO cria linha, NÃO reserva vaga, NÃO mexe em fila nem em status: o serviço
 *  casa a inscrição pelo `userId` da SESSÃO (posse no banco, não na tela) e mescla as
 *  respostas.
 *
 *  A ação NÃO é a tela: a autorização é a mesma das outras portas públicas
 *  (`guardSelfServiceAction`), e o consentimento de dados continua obrigatório.
 */
export async function completeEventRegistrationDataAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = registerForEventSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    consentImage: formData.get('consentImage') === 'on',
    consentData: formData.get('consentData') === 'on',
    accessibilityNotes: (formData.get('accessibilityNotes') as string) || undefined,
    cpf: (formData.get('cpf') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados do formulário inválidos.' };
  }

  const data = parsed.data;

  const context = await guardSelfServiceAction({
    tenantSlug: data.tenantSlug,
    permission: PERMISSIONS.REGISTRATION_CREATE,
  });

  if (!context.ok) {
    if (context.reason === 'FORBIDDEN') {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Seu perfil não tem permissão para se inscrever nesta instituição.',
      };
    }

    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}/inscricao`),
      )}`,
    );
  }

  /** O consentimento de dados continua sendo a condição, como na inscrição. */
  if (!data.consentData) {
    return {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'É necessário autorizar o tratamento dos seus dados para salvar.',
    };
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS PERGUNTAS DO ORGANIZADOR TAMBÉM SÃO RESPONDIDAS AQUI (FASE 70)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Esta é a única porta que quem entrou pela ATIVIDADE tem para completar a própria
   *  inscrição — e ela nascia pedindo só CPF e necessidades. Sem os campos declarados
   *  aqui, o organizador que montou o formulário não coletava de quem veio pela oficina
   *  exatamente o que ele pediu: era a lacuna de produto que a fase tinha deixado.
   *
   *  A régua é a MESMA da tela de inscrição, e por inteiro:
   *   • o spec vem do BANCO (`readEventRegistrationFields`), nunca do POST — aceitá-lo
   *     do cliente faria a validação ser uma formalidade que quem envia cumpre consigo
   *     mesmo;
   *   • o validador é o mesmo (`validateFormResponses`), com as mensagens DELE;
   *   • a recusa devolve o que foi digitado (`values`), pela mesma razão da E54 — o
   *     React 19 zera o formulário depois da resposta;
   *   • o aceito é MESCLADO sobre o que já existe (no serviço), e nunca substitui: quem
   *     já tinha respondido não perde a resposta por passar aqui de novo.
   */
  const declaredFields = await readEventRegistrationFields({
    tenantId: context.tenantId,
    eventSlug: data.eventSlug,
  });

  const typed: Record<string, string> = {};

  for (const field of declaredFields) {
    const raw = formData.get(formResponseFieldName(field.key));
    if (typeof raw === 'string') typed[field.key] = raw;
  }

  /** O que a pessoa digitou, como ela digitou — volta inteiro em qualquer recusa. */
  const values = {
    cpf: data.cpf,
    accessibilityNotes: data.accessibilityNotes,
    declaredFields: typed,
  };

  const cpf = data.cpf ? cpfDigits(data.cpf) : null;

  if (cpf && !isValidCpf(cpf)) {
    return {
      ok: false,
      code: 'INVALID_CPF',
      message: 'O CPF informado não confere. Confira os números e tente de novo.',
      values,
    };
  }

  const declared = validateFormResponses(declaredFields, typed);

  if (!declared.ok) {
    return {
      ok: false,
      code: declared.problem.code,
      message: declared.problem.message,
      values,
    };
  }

  /**
   * Resposta de campo OPCIONAL inválida também RECUSA, como na inscrição: gravar só o
   * aceito apagaria em silêncio o que a pessoa digitou, e ela sairia da tela achando
   * que a resposta existe.
   */
  if (declared.rejected.length > 0) {
    return {
      ok: false,
      code: 'INVALID_DECLARED_FIELD',
      message: declared.rejected.map((rejection) => rejection.message).join(' '),
      values,
    };
  }

  const outcome = await updateEventRegistrationData({
    tenantId: context.tenantId,
    userId: context.userId,
    eventSlug: data.eventSlug,
    consentImage: data.consentImage,
    consentData: data.consentData,
    accessibilityNotes: data.accessibilityNotes ?? null,
    /**
     * O aceito do organizador e, por ÚLTIMO, o CPF do sistema — a mesma composição da
     * porta de inscrição (`composeFormResponses`). O que a pessoa NÃO respondeu não
     * aparece aqui, e é isso que faz o serviço manter a resposta que já existia.
     */
    formResponses: composeFormResponses({
      declared: declared.accepted,
      system: cpf ? { cpf } : {},
    }),
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message, values };
  }

  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}/inscricao`), 'page');

  return {
    ok: true,
    code: 'UPDATED',
    message: 'Seus dados foram atualizados. Eles são usados no seu certificado.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cancelamento
// ─────────────────────────────────────────────────────────────────────────────
const cancelSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  registrationId: z.string().uuid('Inscrição inválida.'),
  activitySlug: z.string().trim().max(140).optional(),
});

export async function cancelRegistrationAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = cancelSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    registrationId: formData.get('registrationId'),
    activitySlug: (formData.get('activitySlug') as string) || undefined,
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const data = parsed.data;

  /**
   * Cancelamento é uma permissão `:own`, e `can()` NEGA quando a posse não é
   * informada (fail-closed, por design). A posse é resolvida DENTRO do
   * `requireRegistrationActor`: numa action, o dono de uma permissão `:own` é a
   * pessoa da SESSÃO, nunca um id do formulário. O cliente não pode declarar posse
   * da inscrição de outra pessoa porque o id de dono não é dado de entrada — e o
   * serviço de aplicação ainda filtra por `userId` na consulta.
   *
   * Este erro (chamar `can()` sem `ownerId`) fazia o cancelamento falhar SEMPRE,
   * com "Permissão negada". Descoberto pelo E2E de cancelamento.
   */
  const context = await requireRegistrationActor(
    data.tenantSlug,
    PERMISSIONS.REGISTRATION_CANCEL_OWN,
  );

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`),
      )}`,
    );
  }

  const outcome = await cancelRegistration({
    tenantId: context.tenantId,
    registrationId: data.registrationId,
    userId: context.userId,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'page');
  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');

  return {
    ok: true,
    code: 'CANCELED',
    /**
     * A mensagem fala no SINGULAR e no PLURAL porque o cancelamento pode oferecer
     * mais de uma vaga (dívida E33): a inscrição do evento devolve o lugar no evento e
     * a vaga de cada atividade aberta que ela criou, e cada uma tem a sua fila.
     */
    message:
      outcome.promoted.length === 0
        ? 'Inscrição cancelada.'
        : outcome.promoted.length === 1
          ? 'Inscrição cancelada. A próxima pessoa da lista de espera foi chamada — ela tem 48 h para confirmar.'
          : `Inscrição cancelada. ${outcome.promoted.length} pessoas da lista de espera foram chamadas — cada uma tem 48 h para confirmar.`,
  };
}
// ───────────────────────────────────────────────────────────────────────────────
//  Apagar as MINHAS respostas do formulário (FASE 70 · fatia 4)
// ───────────────────────────────────────────────────────────────────────────────
const eraseFormResponsesSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APAGAR AS RESPOSTAS SEM CANCELAR A INSCRIÇÃO (decisão do humano na FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PERMISSÃO É A DE "AGIR SOBRE A PRÓPRIA INSCRIÇÃO"
 * ─────────────────────────────────────────────────────────────────────────────
 *  Não existe `registration:update:own` na matriz, e criar uma agora mexeria na
 *  avaliação de TODOS os papéis (a permissão nova entraria na escolha de cada um, e a
 *  matriz tem 66 itens presos por teste) para um ato que é da MESMA natureza do
 *  cancelamento: a pessoa decidindo sobre a própria inscrição. A guarda usada é a
 *  dele — `registration:cancel:own` com POSSE explícita —, e a posse é o próprio
 *  `userId` da SESSÃO: `can()` nega sem ela, por desenho (fail-closed).
 *
 *  O SERVIÇO ainda filtra por `userId` em todas as consultas. São duas linhas de
 *  defesa, e a segunda é a que vale se alguém chamar o serviço por outro caminho —
 *  não existe aqui campo de "qual inscrição", então não há como nomear a de outra
 *  pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A MENSAGEM DIZ — E POR QUE ELA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa precisa saber que NÃO perdeu a vaga e o que continua guardado. Uma
 *  eliminação que só dissesse "pronto" deixaria duas dúvidas: "cancelei sem querer?" e
 *  "apagou tudo mesmo?" — e a segunda tem resposta: o CPF e os consentimentos ficam.
 */
export async function eraseMyFormResponsesAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = eraseFormResponsesSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const data = parsed.data;

  const context = await requireRegistrationActor(
    data.tenantSlug,
    PERMISSIONS.REGISTRATION_CANCEL_OWN,
  );

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, '/minhas-inscricoes'),
      )}`,
    );
  }

  const outcome = await eraseMyFormResponses({
    tenantId: context.tenantId,
    userId: context.userId,
    eventSlug: data.eventSlug,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');

  return {
    ok: true,
    code: 'ERASED',
    message: outcome.erased
      ? 'Suas respostas do formulário foram apagadas. A sua inscrição continua ativa: a vaga, o histórico e o certificado não mudam. O CPF e os consentimentos continuam guardados — eles são a base do seu certificado e da sua autorização.'
      : 'Não havia respostas suas para apagar neste evento. A sua inscrição continua ativa e nada mudou.',
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ACEITAR A VAGA OFERTADA (dívida E1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A permissão é `registration:create` — a de se inscrever, que é o que aceitar a vaga
 *  COMPLETA. Aqui não há posse a declarar: `can()` só exige `ownerId` para permissões
 *  `:own`, e esta não é. Quem impede o cliente de agir sobre a inscrição de outra
 *  pessoa é o `userId` do serviço — ele vem da SESSÃO, nunca do formulário.
 *
 *  A autorização é conferida AQUI e o serviço ainda filtra por `userId` no `where`:
 *  duas linhas de defesa, e a segunda é a que vale se alguém chamar o serviço por outro
 *  caminho.
 */
const acceptPromotionSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventSlug: z.string().trim().min(1).max(120),
  registrationId: z.string().uuid('Inscrição inválida.'),
});

export async function acceptPromotionAction(
  _prev: RegistrationActionState | null,
  formData: FormData,
): Promise<RegistrationActionState> {
  const parsed = acceptPromotionSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventSlug: formData.get('eventSlug'),
    registrationId: formData.get('registrationId'),
  });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos.' };
  }

  const data = parsed.data;

  const context = await requireRegistrationActor(data.tenantSlug, PERMISSIONS.REGISTRATION_CREATE);

  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(data.tenantSlug, '/minhas-inscricoes'),
      )}`,
    );
  }

  const outcome = await acceptPromotion({
    tenantId: context.tenantId,
    registrationId: data.registrationId,
    userId: context.userId,
  });

  if (!outcome.ok) {
    return { ok: false, code: outcome.code, message: outcome.message };
  }

  revalidatePath(tenantPath(data.tenantSlug, '/minhas-inscricoes'), 'page');
  revalidatePath(tenantPath(data.tenantSlug, `/eventos/${data.eventSlug}`), 'layout');

  return {
    ok: true,
    code: 'CONFIRMED',
    message: 'Vaga confirmada! Ela agora é sua — o que a atividade pedir continua valendo.',
  };
}
