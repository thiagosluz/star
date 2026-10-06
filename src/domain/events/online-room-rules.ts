/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O ENDEREÇO DA SALA ONLINE E QUEM PODE VÊ-LO (FASE 68 · fatias 2 e 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É REGRA, E NÃO UM `if` NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O endereço da sala online é a informação que decide se alguém ASSISTE à
 *  atividade ou fica de fora — e ele tem duas perguntas, as duas respondidas aqui,
 *  sem banco, sem Next e sem navegador:
 *
 *    1. **Que endereço é um endereço?** (`parseOnlineRoomUrl`) — só `http`/`https`
 *       pode virar `href`. Sem esta régua, `javascript:` ou `data:` gravados no
 *       campo se tornariam um link na página pública: o organizador não escreve
 *       isso por maldade, mas quem copia e cola "o link da sala" de um lugar errado
 *       escreve — e o clique de um participante executa o que estiver ali.
 *    2. **Quem tem lugar para ver?** (`seesEventOnlineRoom` / `seesActivityOnlineRoom`)
 *       — a decisão do humano nesta fase: inscrição **CONFIRMED**, inscrição
 *       **retendo vaga** (`PENDING`, FASE 34) e a **equipe do evento**. A **lista de
 *       espera NÃO vê**.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA DE ESPERA FICA DE FORA, E A DERIVAÇÃO VEM DE `registrationIsLive`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `registrationIsLive` (`src/domain/events/registration-rules.ts:336-338`) é a
 *  fonte única do que é "inscrição viva" — `PENDING | CONFIRMED | WAITLISTED |
 *  ATTENDED` —, e é a MESMA definição do índice único parcial do banco (armadilha
 *  103). Ela **inclui a espera**, então reescrever a lista de situações aqui seria
 *  criar a QUARTA cópia da mesma lista (a do domínio, a do índice e a do
 *  `SEAT_AVAILABLE_PREDICATE`) e a divergência apareceria no dia em que uma delas
 *  mudasse. A regra nova é, portanto, **derivada** dela: viva E não-`WAITLISTED`.
 *
 *  Por que a espera não vê: quem espera **não tem lugar** — está numa fila que pode
 *  nunca andar. O endereço da sala é o que se dá a quem tem assento; entregá-lo a
 *  quem talvez não entre seria (a) prometer o que o sistema não confirmou e (b)
 *  publicar o endereço para muito mais gente do que a sala comporta. `ATTENDED`
 *  segue vendo pelo motivo oposto: quem já esteve na sala não perde o direito de
 *  reabrir o link.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "OUTRA INSTITUIÇÃO" NÃO PRECISA DE CASO PRÓPRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Estas funções recebem FATOS já lidos sob o contexto de UMA instituição
 *  (`withTenant`). A inscrição de outra instituição **nunca chega aqui**: a RLS não
 *  a devolve, e o que a função vê é `null` — indistinguível de "não se inscreveu",
 *  que é exatamente a resposta certa. A prova disso é de INTEGRAÇÃO (o banco), e a
 *  função pura prende a metade que lhe cabe: `null` não vê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { safeUrlSchema } from '@/domain/events/landing-page';
import { registrationIsLive, type RegistrationStatus } from '@/domain/events/registration-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  O endereço é um endereço?
// ───────────────────────────────────────────────────────────────────────────────
export type OnlineRoomUrlResult =
  | { ok: true; url: string | null }
  | { ok: false; message: string };

/**
 * Normaliza o endereço da sala online.
 *
 * Vazio (ou só espaços) é `null` — LIMPAR o campo é uma edição legítima, e não erro:
 * o organizador tira o link quando a sala deixa de existir.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A ALLOWLIST DE PROTOCOLO É A MESMA DA PÁGINA PÚBLICA (`safeUrlSchema`)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `safeUrlSchema` (`src/domain/events/landing-page.ts:57-68`) já resolvia esta
 *  pergunta para todo campo que vira `src`/`href` na página — inclusive o
 *  `z.string().url()` que aceita `javascript:` e `data:`. Escrever uma segunda régua
 *  aqui criaria duas allowlists para a MESMA superfície, e a divergência entre elas
 *  seria um link executável. Por isso a validação DELEGA: protocolo, comprimento e
 *  trim continuam vindo de lá; o que este módulo acrescenta é a RESPOSTA COMO VALOR
 *  (`{ ok, message }`), que é o formato dos serviços desta casa — e a mensagem no
 *  vocabulário da tela ("endereço da sala online"), não "URL inválida".
 */
export function parseOnlineRoomUrl(value: string | null | undefined): OnlineRoomUrlResult {
  const text = (value ?? '').trim();

  if (text.length === 0) return { ok: true, url: null };

  const parsed = safeUrlSchema.safeParse(text);

  if (!parsed.success) {
    return {
      ok: false,
      message:
        'O endereço da sala online precisa ser completo e começar por http:// ou https:// (ex.: https://sala.exemplo.com/entrar). Outros esquemas, como javascript: e data:, não viram link.',
    };
  }

  return { ok: true, url: parsed.data };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quem vê o endereço?
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os FATOS de quem está olhando — lidos no banco, sob o contexto de uma instituição,
 * e nunca recebidos do formulário (`src/lib/events/online-room-service.ts`).
 */
export interface OnlineRoomViewer {
  /** É da equipe DESTE evento? (permissão conferida no servidor.) */
  isEventTeam: boolean;
  /** Situação da inscrição da pessoa NO EVENTO (`activityId` nulo), se houver. */
  eventRegistration: RegistrationStatus | null;
  /**
   * Situações das inscrições POR ATIVIDADE, pelo id da atividade.
   *
   * Atividade ausente do mapa = a pessoa não se inscreveu nela. É o que permite a
   * régua por atividade: quem tem lugar no minicurso vê a sala do minicurso.
   */
  activityRegistrations: ReadonlyMap<string, RegistrationStatus>;
}

/**
 * Uma inscrição dá lugar na sala?
 *
 * `PENDING` RETÉM vaga (FASE 34) e por isso vê; `WAITLISTED` não vê (ver o cabeçalho
 * deste arquivo); `CANCELED`/`NO_SHOW` não são inscrição viva.
 */
export function registrationSeesOnlineRoom(status: RegistrationStatus | null | undefined): boolean {
  if (!status) return false;

  /** Derivada da fonte única: viva (PENDING | CONFIRMED | WAITLISTED | ATTENDED) MENOS a espera. */
  return registrationIsLive(status) && status !== 'WAITLISTED';
}

/** A pessoa vê o endereço da sala do EVENTO? */
export function seesEventOnlineRoom(viewer: OnlineRoomViewer): boolean {
  return viewer.isEventTeam || registrationSeesOnlineRoom(viewer.eventRegistration);
}

/**
 * A pessoa vê o endereço da sala desta ATIVIDADE?
 *
 *   • a equipe vê tudo — é quem monta a sala;
 *   • a inscrição NA ATIVIDADE dá lugar na atividade (o caso do minicurso);
 *   • atividade ABERTA (`requiresRegistration = false`) não tem inscrição própria: o
 *     público dela É o do evento (revisão da FASE 3), então a inscrição no evento
 *     vale — a MESMA razão pela qual o material de palestrante aceita a inscrição no
 *     evento (`material-service.ts`, "exigir uma segunda inscrição para o material de
 *     uma palestra de auditório seria uma regra que ninguém entende").
 *
 * A atividade que EXIGE inscrição própria não é liberada pela inscrição no evento: a
 * pessoa não tem lugar naquela sala, e o endereço é justamente o que se dá a quem tem.
 */
export function seesActivityOnlineRoom(
  viewer: OnlineRoomViewer,
  activity: { id: string; requiresRegistration: boolean },
): boolean {
  if (viewer.isEventTeam) return true;
  if (registrationSeesOnlineRoom(viewer.activityRegistrations.get(activity.id) ?? null)) {
    return true;
  }

  return !activity.requiresRegistration && registrationSeesOnlineRoom(viewer.eventRegistration);
}
