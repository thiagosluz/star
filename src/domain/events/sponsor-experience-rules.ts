/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Experiência do patrocinador (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA FASE ACRESCENTA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QR do patrocinador faz DUAS coisas ao mesmo tempo, e elas são independentes:
 *
 *    1. CREDITA o participante (XP e/ou uma carta) por ter visitado o estande;
 *    2. COMPARTILHA nome e e-mail com o patrocinador — **só com autorização dele**.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AS DUAS COISAS SÃO SEPARADAS (LGPD)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Condicionar o XP à autorização transformaria o consentimento em moeda de troca:
 *  quem quisesse a recompensa teria de entregar o dado, e o consentimento deixaria
 *  de ser livre (art. 8º, §3º da LGPD — consentimento específico e destacado, não
 *  condição para o benefício). Aqui o crédito é da VISITA; o dado é do
 *  CONSENTIMENTO. Quem lê o QR e escolhe não compartilhar recebe o XP igual e
 *  aparece para o patrocinador apenas como número (visita contada, pessoa não
 *  identificada).
 *
 *  Três invariantes que este módulo garante, e que os testes prendem:
 *
 *    • o pacote compartilhado é SEMPRE `{ name, email }` — `buildLeadShare` monta
 *      o objeto campo a campo, então acrescentar um campo ao perfil da pessoa não
 *      vaza nada para o patrocinador por descuido;
 *    • a autorização tem PRAZO e pode ser REVOGADA, e o patrocinador deixa de ver
 *      o lead nos dois casos (`evaluateLeadAccess` é a única régua de visibilidade);
 *    • o crédito é UM por pessoa por QR (`creditForScan`), o que impede o farm de
 *      XP relendo o mesmo código.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { hashInviteToken, isInviteExpired } from '@/domain/tenancy/invite-token-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  O código público do QR
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Alfabeto e tamanho do código do QR.
 *
 * Mesmo alfabeto sem `I`/`O`/`0`/`1` dos outros códigos impressos do sistema: este
 * vai ser ditado no balcão quando a câmera falhar. Oito caracteres de 32 símbolos
 * são 40 bits — o código não é SEGREDO (ele é público, impresso no estande), mas
 * precisa ser impossível de enumerar por tentativa.
 */
export const SPONSOR_QR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SPONSOR_QR_LENGTH = 8;
export const SPONSOR_QR_PREFIX = 'PT';

/** Mostra em dois grupos: `PT-ABCD-EFGH` é mais fácil de ler que oito seguidos. */
export function formatSponsorQrCode(code: string): string {
  const clean = normalizeSponsorQrCode(code);
  return `${SPONSOR_QR_PREFIX}-${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/** Tira prefixo, hífen, espaço e caixa — o que o banco guarda é só o miolo. */
export function normalizeSponsorQrCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(new RegExp(`^${SPONSOR_QR_PREFIX}`), '')
    .slice(0, SPONSOR_QR_LENGTH);
}

export function isValidSponsorQrCode(value: string): boolean {
  const clean = normalizeSponsorQrCode(value);
  return clean.length === SPONSOR_QR_LENGTH && [...clean].every((char) => SPONSOR_QR_ALPHABET.includes(char));
}

/** Código novo a partir de bytes aleatórios injetados (testável e determinístico). */
export function generateSponsorQrCode(randomByte: (max: number) => number): string {
  let code = '';
  for (let index = 0; index < SPONSOR_QR_LENGTH; index += 1) {
    code += SPONSOR_QR_ALPHABET[randomByte(SPONSOR_QR_ALPHABET.length)];
  }
  return code;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Consentimento: o que é compartilhado, por quanto tempo e desde quando
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Versão do texto de consentimento.
 *
 * Vai gravada em CADA lead. Se o texto mudar (novo campo, novo prazo), ele vira
 * `v2` — e quem autorizou sob a `v1` continua com o que autorizou, sem herdar a
 * autorização nova. Guardar o texto junto do lead, e não só a versão, é o que
 * permite reconstruir o que a pessoa leu.
 */
export const SPONSOR_CONSENT_VERSION = 'v1';

/**
 * Os ÚNICOS campos que o patrocinador recebe.
 *
 * A lista é explícita e o pacote é montado campo a campo por `buildLeadShare`:
 * assim, acrescentar telefone ou instituição ao cadastro do participante não
 * começa a vazar para terceiro sem alguém decidir isso aqui.
 */
export const SPONSOR_LEAD_FIELDS = ['name', 'email'] as const;

export type SponsorLeadField = (typeof SPONSOR_LEAD_FIELDS)[number];

export const SPONSOR_LEAD_FIELD_LABELS: Record<SponsorLeadField, string> = {
  name: 'Nome',
  email: 'E-mail',
};

/** Prazo padrão da autorização, em dias. */
export const DEFAULT_CONSENT_DAYS = 90;

export const MIN_CONSENT_DAYS = 1;
export const MAX_CONSENT_DAYS = 365;

/** Teto de XP por leitura de QR de patrocinador (pega erro de unidade). */
export const MAX_SPONSOR_QR_XP = 500;

export function consentExpiryFrom(consentedAt: Date, days: number): Date {
  const safeDays = Math.min(Math.max(Math.trunc(days), MIN_CONSENT_DAYS), MAX_CONSENT_DAYS);
  return new Date(consentedAt.getTime() + safeDays * 24 * 60 * 60 * 1000);
}

/**
 * O texto que a pessoa lê ANTES de autorizar.
 *
 * É função pura porque o texto é parte da prova: o mesmo texto que aparece na tela
 * é o que fica gravado como `consentText` no lead. Montar a frase na tela e gravar
 * outra coisa no banco invalidaria a única evidência que interessa.
 */
export function sponsorConsentText(input: {
  sponsorName: string;
  eventTitle: string | null;
  days: number;
}): string {
  const where = input.eventTitle ? ` do evento "${input.eventTitle}"` : '';
  const days = Math.min(Math.max(Math.trunc(input.days), MIN_CONSENT_DAYS), MAX_CONSENT_DAYS);

  return (
    `Autorizo ${input.sponsorName}${where} a receber o meu nome e o meu e-mail ` +
    `como contato desta visita, por ${days} dia(s). Posso revogar esta autorização ` +
    `a qualquer momento na minha área, e o patrocinador deixa de ver os meus dados.`
  );
}

/** Pacote compartilhado — SEMPRE estes dois campos, nunca "o perfil". */
export interface SponsorLeadShare {
  sharedName: string;
  sharedEmail: string;
}

/**
 * O mapa campo lógico → coluna gravada.
 *
 * Existe para o teste poder afirmar a igualdade nos DOIS sentidos: nenhum campo
 * declarado fica de fora do pacote, e nenhum campo do pacote existe sem estar
 * declarado. Sem este mapa, "os campos compartilhados são name e email" seria uma
 * frase na documentação em vez de uma condição verificável.
 */
export const SPONSOR_LEAD_SHARE_KEYS: Record<SponsorLeadField, keyof SponsorLeadShare> = {
  name: 'sharedName',
  email: 'sharedEmail',
};

export function buildLeadShare(input: { name: string; email: string }): SponsorLeadShare {
  return {
    sharedName: input.name.trim(),
    sharedEmail: input.email.trim().toLowerCase(),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Visibilidade do lead
// ───────────────────────────────────────────────────────────────────────────────
export type LeadAccessState = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'NONE';

export const LEAD_ACCESS_LABELS: Record<LeadAccessState, string> = {
  ACTIVE: 'Autorizado',
  EXPIRED: 'Autorização vencida',
  REVOKED: 'Autorização revogada',
  NONE: 'Visita sem autorização',
};

/**
 * A ÚNICA régua de "o patrocinador pode ver este contato?".
 *
 * Um lead sem `consentedAt` é uma visita: existe para contar, não para identificar.
 * Ordem das checagens importa para a MENSAGEM: revogado vem antes de vencido
 * (a pessoa fez algo; o prazo é passivo) — e é a diferença entre "ela pediu para
 * sair" e "o prazo acabou".
 */
export function evaluateLeadAccess(input: {
  consentedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  now: Date;
}): LeadAccessState {
  if (!input.consentedAt) return 'NONE';
  if (input.revokedAt) return 'REVOKED';
  if (input.expiresAt && input.expiresAt.getTime() <= input.now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

export function isLeadVisible(state: LeadAccessState): boolean {
  return state === 'ACTIVE';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Crédito da leitura (idempotência por pessoa e por QR)
// ───────────────────────────────────────────────────────────────────────────────
export interface ScanCreditVerdict {
  /** Esta leitura credita XP/carta? */
  credits: boolean;
  /** Já havia leitura desta pessoa neste QR? A tela diz isso em vez de fingir. */
  repeated: boolean;
}

/**
 * Uma pessoa credita UMA vez por QR.
 *
 * Sem isto, o mesmo código lido dez vezes valeria dez XP — e o QR do estande,
 * que é público, viraria farm. A chave é o par (QR, pessoa), gravado por índice
 * único no banco; o domínio decide o que fazer com o que já existe.
 */
export function creditForScan(existingScan: { id: string } | null): ScanCreditVerdict {
  return existingScan
    ? { credits: false, repeated: true }
    : { credits: true, repeated: false };
}

/**
 * O que a leitura deve gravar de consentimento (ou `null`, quando não houve).
 *
 * O `consentText` chega PRONTO do chamador de propósito: é exatamente a frase que
 * a tela mostrou (`sponsorConsentText`), e não uma reconstrução posterior — a
 * prova é o que a pessoa leu, não o que dá para remontar depois.
 */
export function leadConsentFrom(input: {
  consent: boolean;
  name: string;
  email: string;
  consentText: string;
  consentedAt: Date;
  days: number;
}): (SponsorLeadShare & { consentVersion: string; consentText: string; consentedAt: Date; expiresAt: Date }) | null {
  if (!input.consent) return null;

  return {
    ...buildLeadShare({ name: input.name, email: input.email }),
    consentVersion: SPONSOR_CONSENT_VERSION,
    consentText: input.consentText,
    consentedAt: input.consentedAt,
    expiresAt: consentExpiryFrom(input.consentedAt, input.days),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Convite do patrocinador (mesmo formato do convite do palestrante)
// ───────────────────────────────────────────────────────────────────────────────
export type SponsorInviteRefusalCode =
  | 'INVALID_TOKEN'
  | 'EXPIRED'
  | 'ALREADY_LINKED'
  | 'EMAIL_MISMATCH'
  | 'NO_EMAIL';

export type SponsorInviteVerdict =
  | { ok: true }
  | { ok: false; code: SponsorInviteRefusalCode; message: string };

/**
 * O convite prova a posse do LINK; o e-mail da conta prova QUEM é.
 *
 * Os dois, e não um: só o token aceitaria qualquer pessoa que recebesse o link
 * encaminhado; só o e-mail permitiria alguém se declarar o contato sem ter
 * recebido convite nenhum. É a mesma régua do portal do palestrante (ADR-115).
 */
export function evaluateSponsorInviteClaim(input: {
  invite: {
    invitedEmail: string | null;
    inviteTokenHash: string | null;
    inviteExpiresAt: Date | null;
    userId: string | null;
  } | null;
  token: string | null;
  userEmail: string | null;
  now: Date;
}): SponsorInviteVerdict {
  if (!input.invite || !input.invite.inviteTokenHash) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Convite não encontrado.' };
  }

  if (input.invite.userId) {
    return { ok: false, code: 'ALREADY_LINKED', message: 'Este convite já foi aceito.' };
  }

  if (isInviteExpired(input.invite.inviteExpiresAt, input.now)) {
    return { ok: false, code: 'EXPIRED', message: 'Este convite expirou. Peça um novo à organização.' };
  }

  if (input.token && hashInviteToken(input.token) !== input.invite.inviteTokenHash) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Convite não encontrado.' };
  }

  if (!input.userEmail) {
    return { ok: false, code: 'NO_EMAIL', message: 'A sua conta não tem e-mail confirmado.' };
  }

  if (
    input.invite.invitedEmail &&
    input.invite.invitedEmail.trim().toLowerCase() !== input.userEmail.trim().toLowerCase()
  ) {
    return {
      ok: false,
      code: 'EMAIL_MISMATCH',
      message: 'Este convite é para outro endereço de e-mail. Entre com a conta que recebeu o convite.',
    };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Formulário do QR
// ───────────────────────────────────────────────────────────────────────────────
export const sponsorQrInputSchema = z.object({
  label: z.string().trim().min(3, 'Dê um nome ao QR (ex.: "Estande — entrada").').max(120),
  /** `0` = QR que não credita nada (só capta lead). */
  xpAmount: z.coerce.number().int().min(0).max(MAX_SPONSOR_QR_XP).default(0),
  cardTemplateId: z.string().uuid().optional(),
  consentDays: z.coerce
    .number()
    .int()
    .min(MIN_CONSENT_DAYS, `O prazo mínimo é ${MIN_CONSENT_DAYS} dia.`)
    .max(MAX_CONSENT_DAYS, `O prazo máximo é ${MAX_CONSENT_DAYS} dias.`)
    .default(DEFAULT_CONSENT_DAYS),
});

export type SponsorQrInput = z.input<typeof sponsorQrInputSchema>;
