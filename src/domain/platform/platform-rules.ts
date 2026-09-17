/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Governança de plataforma e diretório público
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA DE NATUREZA NESTA FASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui, toda regra operava DENTRO de uma instituição, com a RLS como
 *  fronteira. A governança de plataforma e o diretório público são as duas
 *  primeiras coisas que precisam enxergar VÁRIAS instituições ao mesmo tempo — e
 *  isso impõe disciplina extra:
 *
 *    1. SLUG É ENDEREÇO PÚBLICO. Ele vira `slug.lvh.me`, entra em URL, em QR Code
 *       e em e-mail. Um slug reservado (`api`, `superadmin`) ou ambíguo quebra a
 *       plataforma inteira, não um cadastro.
 *    2. SUSPENSÃO É CORTE, NÃO SINAL. Precisa de justificativa obrigatória porque
 *       alguém vai perguntar por que o evento parou no meio.
 *    3. DIREITÓRIO É VITRINE, NÃO DUMP. Só entra quem é público e está ativo, e o
 *       que sai dali (nome, descrição, contagem de eventos) é dado que a
 *       instituição escolheu expor.
 *
 *  Tudo neste arquivo é PURO: recebe dados já lidos e devolve decisão. É o que
 *  permite testar slug reservado, quota por plano, agregação do diretório e
 *  ordenação por relevância sem tocar em banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { safeUrlSchema } from '@/domain/events/landing-page';

// ───────────────────────────────────────────────────────────────────────────────
//  Status e planos
// ───────────────────────────────────────────────────────────────────────────────
export type TenantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type TenantPlan = 'FREE' | 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';

export const TENANT_STATUSES: readonly TenantStatus[] = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'];
export const TENANT_PLANS: readonly TenantPlan[] = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'];

export const TENANT_STATUS_LABELS: Readonly<Record<TenantStatus, string>> = {
  PENDING: 'Aguardando ativação',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  ARCHIVED: 'Arquivada',
};

export const TENANT_PLAN_LABELS: Readonly<Record<TenantPlan, string>> = {
  FREE: 'Gratuito',
  STARTER: 'Inicial',
  PROFESSIONAL: 'Profissional',
  ENTERPRISE: 'Corporativo',
};

/**
 * Quotas padrão por plano.
 *
 * `null` significa ILIMITADO — e a distinção importa: `0` seria "nenhum evento
 * permitido", que é o oposto do que ENTERPRISE quer dizer. A mesma semântica de
 * `maxSubmissionsPerAuthor = 0` **não** se aplica aqui de propósito, porque são
 * domínios diferentes; esta é explícita.
 */
export interface PlanDefinition {
  label: string;
  maxEvents: number | null;
  maxMembers: number | null;
  maxStorageBytes: number | null;
  /** Resumo mostrado na tela de provisionamento. */
  highlights: readonly string[];
}

export const PLAN_DEFINITIONS: Readonly<Record<TenantPlan, PlanDefinition>> = {
  FREE: {
    label: TENANT_PLAN_LABELS.FREE,
    maxEvents: 3,
    maxMembers: 100,
    maxStorageBytes: 5 * 1024 ** 3,
    highlights: ['3 eventos', '100 membros', '5 GiB'],
  },
  STARTER: {
    label: TENANT_PLAN_LABELS.STARTER,
    maxEvents: 10,
    maxMembers: 500,
    maxStorageBytes: 25 * 1024 ** 3,
    highlights: ['10 eventos', '500 membros', '25 GiB'],
  },
  PROFESSIONAL: {
    label: TENANT_PLAN_LABELS.PROFESSIONAL,
    maxEvents: 50,
    maxMembers: 5_000,
    maxStorageBytes: 100 * 1024 ** 3,
    highlights: ['50 eventos', '5.000 membros', '100 GiB'],
  },
  ENTERPRISE: {
    label: TENANT_PLAN_LABELS.ENTERPRISE,
    maxEvents: null,
    maxMembers: null,
    maxStorageBytes: null,
    highlights: ['eventos ilimitados', 'membros ilimitados', 'armazenamento negociado'],
  },
};

// ───────────────────────────────────────────────────────────────────────────────
//  Slug: o endereço público da instituição
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Slugs que a plataforma NÃO pode entregar a uma instituição.
 *
 * São rotas de plataforma, hostnames de infraestrutura ou nomes que gerariam
 * ambiguidade de resolução (um tenant chamado `api` faria `api.lvh.me` competir
 * com o próprio host da aplicação). A lista é verificada ANTES do formato porque
 * `api` é um slug perfeitamente válido — só não está disponível.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // Rotas de plataforma
  'admin',
  'administracao',
  'superadmin',
  'platform',
  'plataforma',
  'organizacoes',
  'organizations',
  'explorar',
  'explore',
  'validar',
  'validacao',
  'login',
  'signup',
  'cadastro',
  'entrar',
  'logout',
  'selecionar-instituicao',
  'dashboard',
  'painel',
  'perfil',
  'conta',
  'configuracoes',
  'config',
  // Infraestrutura e API
  'api',
  'graphql',
  'webhooks',
  'webhook',
  'health',
  'healthcheck',
  'status',
  'metrics',
  'static',
  'assets',
  'public',
  'cdn',
  'media',
  'files',
  'download',
  'uploads',
  // Hostnames e nomes técnicos
  'www',
  'app',
  'apps',
  'mail',
  'email',
  'smtp',
  'ftp',
  'ns',
  'ns1',
  'ns2',
  'dns',
  'localhost',
  'lvh',
  'test',
  'staging',
  'homolog',
  'dev',
  'beta',
  'demo',
  'internal',
  'interno',
  'sistema',
  'root',
  'suporte',
  'support',
  'help',
  'ajuda',
  'docs',
  'documentacao',
  'billing',
  'pagamento',
  'financeiro',
  'termos',
  'privacidade',
  'sobre',
  'contato',
];

/** Formato do slug: minúsculas, números e hífen interno (nunca nas pontas). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MIN_SLUG_LENGTH = 3;
export const MAX_SLUG_LENGTH = 63;

export interface SlugValidation {
  valid: boolean;
  /** Mensagem única e acionável (a UI mostra uma por vez). */
  message: string | null;
}

/**
 * Valida o slug de uma instituição.
 *
 * A ordem é RESERVA → FORMATO → TAMANHO, e ela mudou depois de um teste:
 *
 *   • `ns` é reservado e tem 2 caracteres. Com o tamanho avaliado antes, a resposta
 *     era "muito curto" — e a pessoa tentaria `ns1`, que também é reservado. Dizer
 *     "reservado" de imediato dá a informação que resolve o problema.
 *   • Caixa alta é NORMALIZADA, não recusada: quem digita `UFBA` quer o slug
 *     `ufba`, e recusar isso seria burocracia.
 */
export function validateTenantSlug(raw: string): SlugValidation {
  const slug = raw.trim().toLowerCase();

  if (slug.length === 0) {
    return { valid: false, message: 'Informe um identificador (slug) para a instituição.' };
  }

  if (RESERVED_SLUGS.includes(slug)) {
    return {
      valid: false,
      message: `"${slug}" é reservado pela plataforma (rota de sistema ou nome de infraestrutura). Escolha outro.`,
    };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return {
      valid: false,
      message:
        'O identificador deve usar apenas letras minúsculas, números e hífen (sem hífen no começo ou no fim).',
    };
  }

  if (slug.length < MIN_SLUG_LENGTH) {
    return { valid: false, message: `O identificador deve ter ao menos ${MIN_SLUG_LENGTH} caracteres.` };
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    return { valid: false, message: `O identificador deve ter no máximo ${MAX_SLUG_LENGTH} caracteres.` };
  }

  return { valid: true, message: null };
}

/** Slug disponível? (recebe os já usados, lidos do banco) */
export function isSlugTaken(slug: string, taken: readonly string[]): boolean {
  return taken.includes(slug.trim().toLowerCase());
}

/** Normaliza para gravação: caixa baixa e sem espaços nas pontas. */
export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

// ───────────────────────────────────────────────────────────────────────────────
//  Provisionamento
// ───────────────────────────────────────────────────────────────────────────────
export interface ProvisioningInput {
  name: string;
  slug: string;
  plan: TenantPlan;
  ownerEmail: string;
  customDomain?: string | null;
  maxEvents?: number | null;
  maxMembers?: number | null;
  description?: string | null;
  isPublic?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Valores normalizados, prontos para gravação (só quando `valid`). */
  normalized: {
    name: string;
    slug: string;
    plan: TenantPlan;
    ownerEmail: string;
    customDomain: string | null;
    maxEvents: number | null;
    maxMembers: number | null;
    description: string | null;
    isPublic: boolean;
  } | null;
}

/** Validação de e-mail deliberadamente simples: a entrega prova o resto. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * Valida o provisionamento de uma instituição.
 *
 * Devolve TODOS os erros de uma vez: quem preenche o formulário corrige tudo em
 * uma passada, em vez de descobrir um problema por tentativa (mesma decisão da
 * validação de sorteio na FASE 8).
 */
export function validateProvisioning(input: ProvisioningInput): ValidationResult {
  const errors: string[] = [];

  const name = input.name?.trim() ?? '';
  if (name.length < 3) errors.push('O nome da instituição precisa ter ao menos 3 caracteres.');
  if (name.length > 160) errors.push('O nome da instituição não pode passar de 160 caracteres.');

  const slug = normalizeSlug(input.slug ?? '');
  const slugValidation = validateTenantSlug(slug);
  if (!slugValidation.valid && slugValidation.message) errors.push(slugValidation.message);

  if (!(TENANT_PLANS as readonly string[]).includes(input.plan)) {
    errors.push('Plano inválido. Use FREE, STARTER, PROFESSIONAL ou ENTERPRISE.');
  }

  const ownerEmail = input.ownerEmail?.trim().toLowerCase() ?? '';
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    errors.push('Informe um e-mail válido para o proprietário (OWNER) da instituição.');
  }

  const customDomain = input.customDomain?.trim().toLowerCase() || null;
  if (customDomain && !DOMAIN_PATTERN.test(customDomain)) {
    errors.push('O domínio personalizado deve ser um domínio válido (ex.: eventos.instituicao.br), sem protocolo.');
  }

  const maxEvents = input.maxEvents ?? null;
  if (maxEvents !== null && (!Number.isInteger(maxEvents) || maxEvents < 0)) {
    errors.push('A quota de eventos deve ser um número inteiro maior ou igual a zero.');
  }

  const maxMembers = input.maxMembers ?? null;
  if (maxMembers !== null && (!Number.isInteger(maxMembers) || maxMembers < 0)) {
    errors.push('A quota de membros deve ser um número inteiro maior ou igual a zero.');
  }

  const description = input.description?.trim() || null;
  if (description && description.length > 600) {
    errors.push('A descrição não pode passar de 600 caracteres.');
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  const defaults = PLAN_DEFINITIONS[input.plan];

  return {
    valid: true,
    errors: [],
    normalized: {
      name,
      slug,
      plan: input.plan,
      ownerEmail,
      customDomain,
      // Quota não informada herda o padrão do PLANO (e `null` continua significando
      // ilimitado, em vez de virar "0 = nada").
      maxEvents: maxEvents ?? defaults.maxEvents,
      maxMembers: maxMembers ?? defaults.maxMembers,
      description,
      isPublic: input.isPublic ?? true,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quotas do plano
// ───────────────────────────────────────────────────────────────────────────────
export interface QuotaDecision {
  allowed: boolean;
  message: string | null;
  /** Quanto ainda cabe. `null` = ilimitado. */
  remaining: number | null;
}

/**
 * A instituição ainda pode criar evento? (item C2 do levantamento da FASE 12)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A QUOTA PASSOU A SER VERIFICADA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `maxEvents` era gravado no provisionamento, herdado do plano e EXIBIDO no painel
 *  de governança — e nunca consultado em nenhum caminho de escrita. O plano era, na
 *  prática, decorativo: uma instituição FREE criava duzentos eventos e o painel
 *  continuava dizendo "3".
 *
 *  A decisão fica no domínio porque é regra de negócio (o que fazer ao estourar), e
 *  a mensagem precisa ser acionável: quem organiza deve saber que o caminho é falar
 *  com a plataforma, não tentar de novo.
 *
 *  `maxEvents = 0` significa "nenhum evento" — e não "ilimitado". Ilimitado é `null`,
 *  como no resto do sistema (mesma semântica de `Event.capacity`).
 */
export function evaluateEventQuota(input: {
  currentCount: number;
  maxEvents: number | null;
}): QuotaDecision {
  if (input.maxEvents === null) {
    return { allowed: true, message: null, remaining: null };
  }

  const remaining = input.maxEvents - input.currentCount;

  if (remaining <= 0) {
    return {
      allowed: false,
      remaining: 0,
      message:
        `O plano desta instituição permite ${input.maxEvents} evento(s) e todos já foram criados. ` +
        'Solicite à plataforma o aumento da quota ou arquive um evento antigo.',
    };
  }

  return { allowed: true, message: null, remaining };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ciclo de vida
// ───────────────────────────────────────────────────────────────────────────────
export const MIN_SUSPENSION_REASON_LENGTH = 8;

export interface LifecycleDecision {
  allowed: boolean;
  message: string | null;
}

/**
 * Pode suspender?
 *
 * A justificativa é obrigatória e tem tamanho mínimo porque a suspensão é um ato
 * com testemunhas: o dono da instituição vai ver essa frase na tela de bloqueio e
 * o suporte vai lê-la meses depois. "manutenção" não explica nada.
 */
export function evaluateSuspension(input: { status: TenantStatus; reason: string }): LifecycleDecision {
  if (input.status === 'SUSPENDED') {
    return { allowed: false, message: 'Esta instituição já está suspensa.' };
  }

  if (input.status === 'ARCHIVED') {
    return { allowed: false, message: 'Instituição arquivada não pode ser suspensa.' };
  }

  const reason = input.reason?.trim() ?? '';
  if (reason.length < MIN_SUSPENSION_REASON_LENGTH) {
    return {
      allowed: false,
      message: `Descreva o motivo da suspensão (mínimo de ${MIN_SUSPENSION_REASON_LENGTH} caracteres).`,
    };
  }

  return { allowed: true, message: null };
}

/** Pode reativar? */
export function evaluateReactivation(status: TenantStatus): LifecycleDecision {
  if (status === 'ACTIVE') return { allowed: false, message: 'Esta instituição já está ativa.' };
  if (status === 'ARCHIVED') {
    return { allowed: false, message: 'Instituição arquivada não pode ser reativada por aqui.' };
  }

  return { allowed: true, message: null };
}

/**
 * O tráfego desta instituição deve ser cortado?
 *
 * Função que a página pública, o painel e a página de bloqueio consultam. `ACTIVE`
 * é o único estado que atende tráfego; qualquer outro é bloqueio — fail-closed,
 * para que um estado novo no enum não vire "acesso liberado" por esquecimento.
 */
export function isTrafficAllowed(status: TenantStatus): boolean {
  return status === 'ACTIVE';
}

/** Mensagem exibida na página de bloqueio (nunca vaza detalhe interno). */
export function blockedNotice(input: {
  tenantName: string;
  status: TenantStatus;
  reason?: string | null;
}): { title: string; body: string } {
  if (input.status === 'SUSPENDED') {
    return {
      title: 'Acesso suspenso',
      body:
        `O acesso de ${input.tenantName} está temporariamente suspenso.` +
        (input.reason ? ` Motivo informado: ${input.reason}` : '') +
        ' Se você organiza esta instituição, entre em contato com o suporte da plataforma.',
    };
  }

  if (input.status === 'PENDING') {
    return {
      title: 'Instituição em ativação',
      body: `${input.tenantName} ainda está sendo ativada na plataforma. Tente novamente em alguns instantes.`,
    };
  }

  return {
    title: 'Instituição indisponível',
    body: `Esta instituição (${input.tenantName}) não está disponível no momento.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Diretório público
// ───────────────────────────────────────────────────────────────────────────────
/** Linha do diretório: já agregada pelo repositório (sem N+1). */
export interface DirectoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  customDomain: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  isPublic: boolean;
  /** Eventos abertos (PUBLISHED ou REGISTRATION_OPEN) que ainda não terminaram. */
  openEventCount: number;
  /** Início do próximo evento aberto (ordenação de desempate). */
  nextEventStartsAt: Date | null;
}

export interface DirectoryEntry extends DirectoryRow {
  /** Caminho canônico por slug (o subdomínio é a mesma vitrine). */
  path: string;
  /** Rótulo pronto para o card, sem cálculo na UI. */
  activityLabel: string;
}

export interface DirectoryOptions {
  /** Busca textual por nome ou slug (aceita também a sigla no nome). */
  query?: string;
  page?: number;
  pageSize?: number;
}

export const DEFAULT_DIRECTORY_PAGE_SIZE = 12;
export const MAX_DIRECTORY_PAGE_SIZE = 48;

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Monta a vitrine a partir das linhas agregadas.
 *
 * Faz, em ordem: FILTRAR (só públicas e ativas), BUSCAR (nome ou slug, sem
 * acento/caixa), ORDENAR (mais eventos abertos primeiro; empate pelo próximo
 * evento; depois alfabético) e PAGINAR.
 *
 * A ordenação por volume de eventos é o que faz a vitrine ter utilidade: as
 * instituições que estão acontecendo agora aparecem antes.
 */
export function buildDirectory(
  rows: readonly DirectoryRow[],
  options: DirectoryOptions = {},
): {
  entries: DirectoryEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  const pageSize = Math.min(
    Math.max(1, Math.floor(options.pageSize ?? DEFAULT_DIRECTORY_PAGE_SIZE)),
    MAX_DIRECTORY_PAGE_SIZE,
  );

  const term = options.query ? normalizeForSearch(options.query.trim()) : '';

  const visible = rows
    .filter((row) => row.status === 'ACTIVE' && row.isPublic)
    .filter((row) => {
      if (term.length === 0) return true;
      return (
        normalizeForSearch(row.name).includes(term) || normalizeForSearch(row.slug).includes(term)
      );
    })
    .sort((a, b) => {
      if (b.openEventCount !== a.openEventCount) return b.openEventCount - a.openEventCount;

      const aNext = a.nextEventStartsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bNext = b.nextEventStartsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (aNext !== bNext) return aNext - bNext;

      return a.name.localeCompare(b.name, 'pt-BR');
    });

  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), totalPages);
  const start = (page - 1) * pageSize;

  const entries = visible.slice(start, start + pageSize).map((row) => ({
    ...row,
    path: `/t/${row.slug}`,
    activityLabel:
      row.openEventCount === 0
        ? 'Sem eventos abertos no momento'
        : row.openEventCount === 1
          ? '1 evento aberto'
          : `${row.openEventCount} eventos abertos`,
  }));

  return { entries, total, page, pageSize, totalPages };
}

/**
 * Conta eventos abertos por instituição a partir de linhas cruas.
 *
 * Existe como função pura porque é AQUI que o N+1 seria introduzido: agrupar em
 * memória, a partir de UMA consulta agregada, é o que mantém a vitrine com custo
 * constante por instituição.
 */
export function countOpenEvents(
  events: readonly { tenantId: string; startsAt: Date; status: string }[],
  now: Date,
): Map<string, { openEventCount: number; nextEventStartsAt: Date | null }> {
  const result = new Map<string, { openEventCount: number; nextEventStartsAt: Date | null }>();

  for (const event of events) {
    if (event.status !== 'PUBLISHED' && event.status !== 'REGISTRATION_OPEN') continue;
    if (event.startsAt.getTime() < now.getTime()) continue;

    const current = result.get(event.tenantId) ?? { openEventCount: 0, nextEventStartsAt: null };
    current.openEventCount += 1;

    if (!current.nextEventStartsAt || event.startsAt < current.nextEventStartsAt) {
      current.nextEventStartsAt = event.startsAt;
    }

    result.set(event.tenantId, current);
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil público da instituição
// ───────────────────────────────────────────────────────────────────────────────
export interface PublicProfileInput {
  description?: string | null;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  isPublic?: boolean;
}

export interface PublicProfileResult {
  valid: boolean;
  errors: string[];
  normalized: { description: string | null; logoUrl: string | null; websiteUrl: string | null; isPublic: boolean } | null;
}

/**
 * Valida o perfil que aparece na vitrine.
 *
 * As URLs passam por `safeUrlSchema` — a MESMA allowlist do tema da landing page
 * (FASE 3), que recusa `javascript:`, `data:` e qualquer coisa que não seja
 * http(s). Elas viram `src` de imagem e `href` de link em página pública: aceitar
 * entrada livre seria XSS refletido com outro nome.
 */
export function validatePublicProfile(input: PublicProfileInput): PublicProfileResult {
  const errors: string[] = [];

  const description = input.description?.trim() || null;
  if (description && description.length > 600) {
    errors.push('A descrição não pode passar de 600 caracteres.');
  }

  const parseUrl = (value: string | null | undefined, label: string): string | null => {
    const trimmed = value?.trim() || null;
    if (!trimmed) return null;

    const parsed = safeUrlSchema.safeParse(trimmed);
    if (!parsed.success) {
      errors.push(`${label} deve ser uma URL absoluta com http ou https.`);
      return null;
    }

    return parsed.data;
  };

  const logoUrl = parseUrl(input.logoUrl, 'A URL do logotipo');
  const websiteUrl = parseUrl(input.websiteUrl, 'O site institucional');

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: { description, logoUrl, websiteUrl, isPublic: input.isPublic ?? true },
  };
}
