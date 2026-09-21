/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O CRACHÁ DO PARTICIPANTE (FASE 31)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM CRACHÁ POR PESSOA, NÃO UM POR ATIVIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição é por (pessoa × evento) E por (pessoa × atividade) — e o crachá
 *  morava na INSCRIÇÃO. Na prática, quem se inscreveu no evento e em dois
 *  minicursos teria três "crachás" diferentes, e a portaria não saberia qual ler.
 *
 *  O crachá é da PESSOA no EVENTO. O QR carrega um código opaco e o MONITOR escolhe
 *  o contexto da leitura (portaria do evento, ou a atividade que está acontecendo).
 *  O fato de presença continua sendo por (pessoa × atividade) — é o CONTEXTO que
 *  decide onde registrar, não o código lido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CÓDIGO É OPACO, CURTO E DIGITÁVEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que vai no QR é o CÓDIGO, e nada mais: nome, e-mail ou `userId` no crachá
 *  seriam dado pessoal circulando em papel e em leitor de terceiros (a mesma
 *  decisão do código `P-…` da lista publicada da FASE 29).
 *
 *  O alfabeto não tem `I`, `L`, `O`, `U`, `0` nem `1` — o crachá é lido por um
 *  leitor USB que "digita", e por gente quando o leitor falha. Confundir `O` com
 *  `0` na digitação manual seria um erro de operação, não de segurança.
 *
 *  Funções PURAS: a aleatoriedade entra por parâmetro (`randomInt`), como no sorteio
 *  de cartas da FASE 5 e no sorteio da FASE 8 — sem isso, não haveria como testar a
 *  distribuição nem o formato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Prefixo do código do crachá. `CR` = credencial. */
export const BADGE_CODE_PREFIX = 'CR';

/** Alfabeto sem caracteres ambíguos (nada de I, L, O, U, 0, 1). */
export const BADGE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** O código é exibido em dois grupos — ler `CR-ABCD-EFGH` é mais fácil que 8 seguidos. */
export const BADGE_CODE_GROUPS = 2;
export const BADGE_CODE_GROUP_SIZE = 4;
export const BADGE_CODE_RANDOM_LENGTH = BADGE_CODE_GROUPS * BADGE_CODE_GROUP_SIZE;

/** Teto de crachás emitidos ou impressos de uma vez (a folha é uma só, física). */
export const MAX_BADGE_BATCH = 200;

/**
 * Monta o código canônico a partir dos caracteres aleatórios.
 *
 * O canônico é o que vai para o QR, para o banco e para a etiqueta: um formato só,
 * em um lugar só. Comparar o que foi lido com um código de formato diferente é o
 * defeito clássico de busca que "não encontra" um crachá que existe.
 */
export function formatBadgeCode(randomChars: string): string {
  const groups: string[] = [];

  for (let index = 0; index < BADGE_CODE_GROUPS; index += 1) {
    groups.push(randomChars.slice(index * BADGE_CODE_GROUP_SIZE, (index + 1) * BADGE_CODE_GROUP_SIZE));
  }

  return `${BADGE_CODE_PREFIX}-${groups.join('-')}`;
}

/** Sorteia os caracteres do código com a fonte de aleatoriedade injetada. */
export function generateBadgeCode(randomInt: (max: number) => number): string {
  let chars = '';

  for (let index = 0; index < BADGE_CODE_RANDOM_LENGTH; index += 1) {
    const draw = Math.max(0, Math.min(randomInt(BADGE_CODE_ALPHABET.length), BADGE_CODE_ALPHABET.length - 1));
    chars += BADGE_CODE_ALPHABET[draw]!;
  }

  return formatBadgeCode(chars);
}

/**
 * Normaliza o que o monitor digitou (ou o leitor mandou) para o formato canônico.
 *
 * Aceita com e sem prefixo, com e sem separadores, em qualquer caixa: no balcão, o
 * código chega de três jeitos (QR, leitor USB, digitação) e recusar um deles por
 * causa de um hífen seria transformar formato em fila.
 *
 * `null` quando não dá para aproveitar — o chamador responde "código inválido" em
 * vez de procurar um código que nunca existiu.
 */
export function normalizeBadgeCode(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const withoutPrefix =
    cleaned.startsWith(BADGE_CODE_PREFIX) && cleaned.length === BADGE_CODE_PREFIX.length + BADGE_CODE_RANDOM_LENGTH
      ? cleaned.slice(BADGE_CODE_PREFIX.length)
      : cleaned;

  if (withoutPrefix.length !== BADGE_CODE_RANDOM_LENGTH) return null;
  if (![...withoutPrefix].every((char) => BADGE_CODE_ALPHABET.includes(char))) return null;

  return formatBadgeCode(withoutPrefix);
}

/** O texto é um código de crachá válido? */
export function isBadgeCode(raw: string | null | undefined): boolean {
  return normalizeBadgeCode(raw) !== null;
}

/**
 * O que o QR Code do crachá carrega.
 *
 * É o CÓDIGO, e só ele. Uma URL obrigaria o leitor do balcão a interpretar texto
 * livre; o código puro funciona com leitor USB, com a câmera e com digitação.
 */
export function badgeQrPayload(code: string): string {
  return normalizeBadgeCode(code) ?? code;
}

export type CredentialState = 'ACTIVE' | 'REVOKED';

export const CREDENTIAL_STATE_LABELS: Readonly<Record<CredentialState, string>> = {
  ACTIVE: 'Válido',
  REVOKED: 'Revogado',
};

export interface CredentialRef {
  status: string;
  revokedAt: Date | null;
}

/**
 * O estado do crachá.
 *
 * Revogado vence o status gravado: um crachá revogado é inválido mesmo que a coluna
 * diga `ACTIVE` (o contrário — ler só a coluna — faria um crachá reemitido continuar
 * passando se a gravação do status falhasse).
 */
export function credentialStateOf(credential: CredentialRef): CredentialState {
  if (credential.revokedAt !== null) return 'REVOKED';

  return credential.status === 'REVOKED' ? 'REVOKED' : 'ACTIVE';
}

/** O crachá pode ser usado no balcão? */
export function canUseCredential(credential: CredentialRef): { ok: boolean; reason: string | null } {
  const state = credentialStateOf(credential);

  return state === 'ACTIVE'
    ? { ok: true, reason: null }
    : { ok: false, reason: 'Este crachá foi revogado — emita um novo antes de usar.' };
}

/** Contexto da leitura: a portaria do evento ou uma atividade. */
export type AttendanceContextKind = 'EVENT' | 'ACTIVITY';

export interface AttendanceContextRef {
  kind: AttendanceContextKind;
  activityId: string | null;
  activityTitle?: string | null;
}

export function describeAttendanceContext(context: AttendanceContextRef): string {
  if (context.kind === 'EVENT') return 'Portaria do evento';

  return context.activityTitle ? `Atividade: ${context.activityTitle}` : 'Atividade';
}
