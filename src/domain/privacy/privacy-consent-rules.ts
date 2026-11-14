/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Privacidade, inventário versionado e consentimento de cookies (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESCOLHA REAL: TEMA E BARRA LATERAL NÃO SÃO ESSENCIAIS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Chamar preferência cosmética de "essencial" para contornar consentimento é
 *  maquiagem. Os cookies da plataforma são separados em dois grupos honestos:
 *
 *    • `ESSENTIAL`: sessão autenticada, contexto da instituição, desafio 2FA e o
 *      próprio recibo de escolha de cookies (`ef_consentimento`). Sem eles o
 *      serviço não funciona com segurança.
 *    • `PREFERENCE`: aparência (`ef_tema`) e estado da barra lateral (`ef_nav`).
 *      Funcionam apenas quando aceitos; recusar apaga os existentes e impede
 *      gravações futuras até nova escolha do visitante.
 *
 *  Este arquivo concentra a versão vigente do inventário, a definição das duas
 *  categorias e o parser puro do cookie de consentimento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const PRIVACY_INVENTORY_VERSION = '2026.11-v1';
export const PRIVACY_INVENTORY_EFFECTIVE_DATE = '2026-11-14';
export const TERMS_VERSION = '2026.11-v1';
export const ACCESSIBILITY_STATEMENT_VERSION = '2026.11-v1';

export const COOKIE_CONSENT_COOKIE = 'ef_consentimento';
export const COOKIE_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 ano

export type CookieCategory = 'ESSENTIAL' | 'PREFERENCE';
export type CookieConsentChoice = 'ESSENTIAL_ONLY' | 'ALL';

export interface CookieInventoryEntry {
  readonly name: string;
  readonly category: CookieCategory;
  readonly title: string;
  readonly purpose: string;
  readonly retention: string;
  readonly optional: boolean;
}

export interface DataInventoryEntry {
  readonly scope: 'Plataforma' | 'Instituição';
  readonly category: string;
  readonly dataPoints: string;
  readonly purpose: string;
  readonly legalBasis: string;
  readonly retention: string;
}

export const COOKIE_INVENTORY: readonly CookieInventoryEntry[] = [
  {
    name: 'better-auth.session_token',
    category: 'ESSENTIAL',
    title: 'Sessão autenticada',
    purpose: 'Mantém a pessoa autenticada e protege rotas privadas contra CSRF.',
    retention: 'Até encerrar a sessão ou expirar (máx. 7 dias)',
    optional: false,
  },
  {
    name: 'ef_tenant / subdomínio',
    category: 'ESSENTIAL',
    title: 'Contexto da instituição',
    purpose: 'Identifica com segurança em qual instituição e painel o usuário está operando (assinado por HMAC).',
    retention: 'Sessão / duração do vínculo ativo',
    optional: false,
  },
  {
    name: 'better-auth.two_factor',
    category: 'ESSENTIAL',
    title: 'Verificação em dois fatores (2FA)',
    purpose: 'Controla o estado do desafio TOTP durante a autenticação em dois passos.',
    retention: 'Curta duração (fluxo de login)',
    optional: false,
  },
  {
    name: 'ef_consentimento',
    category: 'ESSENTIAL',
    title: 'Recibo de escolha de cookies',
    purpose: 'Guarda sua decisão entre aceitar apenas essenciais ou também preferências, evitando reexibir o aviso.',
    retention: '12 meses (versão vigente do inventário)',
    optional: false,
  },
  {
    name: 'ef_tema',
    category: 'PREFERENCE',
    title: 'Preferência de tema (claro / escuro / sistema)',
    purpose: 'Permite que o servidor entregue a paleta visual escolhida já no primeiro HTML, sem piscar.',
    retention: '12 meses (apagado se preferências forem recusadas)',
    optional: true,
  },
  {
    name: 'ef_nav',
    category: 'PREFERENCE',
    title: 'Estado da barra lateral',
    purpose: 'Lembra se a navegação lateral está expandida ou recolhida entre páginas do painel.',
    retention: '12 meses (apagado se preferências forem recusadas)',
    optional: true,
  },
];

export const DATA_PROCESSING_INVENTORY: readonly DataInventoryEntry[] = [
  {
    scope: 'Plataforma',
    category: 'Identidade e acesso',
    dataPoints: 'Nome, e-mail, hash de senha (scrypt), semente 2FA criptografada, sessões.',
    purpose: 'Autenticação única, segurança da conta e recuperação de acesso.',
    legalBasis: 'Execução de contrato e cumprimento de obrigação de segurança (LGPD art. 7º, V).',
    retention: 'Enquanto a conta estiver ativa; apagados ou anonimizados ao encerrar a conta.',
  },
  {
    scope: 'Plataforma',
    category: 'Registro de consentimento de cookies',
    dataPoints: 'Token opaco do recibo, versão do inventário, decisão (essenciais/preferências), IP mascarado (/24 ou /48) e User-Agent.',
    purpose: 'Comprovar a escolha livre do visitante sem rastreamento individual.',
    legalBasis: 'Cumprimento de obrigação legal e prestação de contas (LGPD art. 7º, II).',
    retention: '5 anos a partir do registro.',
  },
  {
    scope: 'Plataforma',
    category: 'Trilha de segurança da conta',
    dataPoints: 'Tipo do evento de segurança, carimbo de data/hora, IP mascarado (/24 ou /48) e User-Agent.',
    purpose: 'Prevenção a fraudes e investigação de alterações críticas (senha, 2FA, e-mail).',
    legalBasis: 'Proteção ao crédito/segurança e exercício regular de direitos (LGPD art. 7º, VI e IX).',
    retention: '5 anos.',
  },
  {
    scope: 'Instituição',
    category: 'Inscrições, presenças e certificados',
    dataPoints: 'Participação em atividades, respostas declaradas pelo evento, notas de acessibilidade, consentimento versionado e CPF (opcional, para certificado).',
    purpose: 'Execução do evento, controle de vagas, acessibilidade e emissão verificável de certificados.',
    legalBasis: 'Execução do serviço solicitado pelo participante e consentimento específico (LGPD art. 7º, I e V).',
    retention: 'Definido pela instituição; respostas pessoais podem ser apagadas em Minhas inscrições.',
  },
  {
    scope: 'Instituição',
    category: 'Submissões científicas e avaliação por pares',
    dataPoints: 'Título, resumo, arquivos enviados, autoria e pareceres do comitê.',
    purpose: 'Organização de chamadas de trabalhos e avaliação duplamente cega.',
    legalBasis: 'Execução de procedimento acadêmico solicitado pelo autor (LGPD art. 7º, V).',
    retention: 'Conforme edital da instituição organizadora.',
  },
];

export interface ParsedCookieConsent {
  readonly version: string;
  readonly choice: CookieConsentChoice;
  readonly preferencesAllowed: boolean;
  readonly token: string;
}

/**
 * Serializa a decisão para o cookie `ef_consentimento`.
 *
 * Formato curto e estável: `<version>|<choice>|<token>`.
 */
export function serializeCookieConsent(input: {
  version: string;
  choice: CookieConsentChoice;
  token: string;
}): string {
  const safeVersion = input.version.replaceAll('|', '-');
  const safeToken = input.token.replaceAll('|', '');
  return `${safeVersion}|${input.choice}|${safeToken}`;
}

export function parseCookieConsent(raw: string | undefined | null): ParsedCookieConsent | null {
  if (!raw) return null;

  const parts = raw.split('|');
  if (parts.length !== 3) return null;

  const [version, choice, token] = parts;
  if (!version || !token) return null;
  if (choice !== 'ESSENTIAL_ONLY' && choice !== 'ALL') return null;

  return {
    version,
    choice,
    preferencesAllowed: choice === 'ALL',
    token,
  };
}

/**
 * O banner só aparece quando ainda não existe escolha registrada na versão
 * vigente do inventário.
 */
export function shouldShowCookieBanner(consent: ParsedCookieConsent | null): boolean {
  if (!consent) return true;
  return consent.version !== PRIVACY_INVENTORY_VERSION;
}

/**
 * Recusa explícita (`ESSENTIAL_ONLY`) proíbe ler ou gravar `ef_tema` e `ef_nav`.
 */
export function isPreferenceRejected(consent: ParsedCookieConsent | null): boolean {
  return consent !== null && consent.choice === 'ESSENTIAL_ONLY';
}
