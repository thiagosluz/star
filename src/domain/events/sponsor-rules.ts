/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Patrocínio (cotas e patrocinadores)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU DOMÍNIO, E NÃO FICOU NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `SponsorTier` e `Sponsor` existem desde a modelagem da FASE 3 e a landing page
 *  os renderiza desde então; o que faltava era o caminho de ESCRITA. A tentação,
 *  ao construir a tela, é validar no formulário e gravar direto. O problema é que
 *  patrocínio tem duas regras que NÃO são de formulário:
 *
 *    1. o LIMITE DE VAGAS da cota (`maxSponsors`) — depende do que já está
 *       gravado, então precisa ser decidido no servidor, dentro da transação;
 *    2. a ORDEM de exibição — Diamante antes de Ouro, e dentro da cota a ordem
 *       escolhida pelo comercial. Errar isso publica a hierarquia errada do
 *       patrocínio, que é justamente o que o patrocinador comprou.
 *
 *  As duas vivem aqui, em funções puras, e são chamadas pelo serviço com o estado
 *  real do banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

import { colorSchema, safeUrlSchema } from '@/domain/events/landing-page';

// ───────────────────────────────────────────────────────────────────────────────
//  Cotas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Espelha o enum `SponsorTierKey` do schema.
 *
 * Redefinido aqui, como as demais uniões do domínio: a camada pura não importa o
 * ORM, e o tipo é estruturalmente idêntico ao do banco.
 */
export const SPONSOR_TIER_KEYS = [
  'DIAMOND',
  'GOLD',
  'SILVER',
  'BRONZE',
  'SUPPORTER',
  'MEDIA_PARTNER',
  'CUSTOM',
] as const;

export type SponsorTierKey = (typeof SPONSOR_TIER_KEYS)[number];

/** Rótulos pt-BR — usados na tela e no agrupamento público. */
export const SPONSOR_TIER_LABELS: Record<SponsorTierKey, string> = {
  DIAMOND: 'Diamante',
  GOLD: 'Ouro',
  SILVER: 'Prata',
  BRONZE: 'Bronze',
  SUPPORTER: 'Apoio',
  MEDIA_PARTNER: 'Parceiro de mídia',
  CUSTOM: 'Cota personalizada',
};

/** Ordem de rank sugerida quando o organizador escolhe uma cota do catálogo. */
export const SPONSOR_TIER_DEFAULT_RANK: Record<SponsorTierKey, number> = {
  DIAMOND: 0,
  GOLD: 10,
  SILVER: 20,
  BRONZE: 30,
  SUPPORTER: 40,
  MEDIA_PARTNER: 50,
  CUSTOM: 60,
};

export const MAX_TIER_BENEFITS = 12;
export const MAX_SPONSORS_PER_TIER = 200;

// ───────────────────────────────────────────────────────────────────────────────
//  Vitrine da cota: cor e tamanho da logo (FASE 41)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Escala da logo na página pública.
 *
 * É ESCALA, e não um número de pixels digitado, porque o tamanho aqui não é
 * preferência de layout: é a HIERARQUIA que o patrocinador comprou — Diamante
 * aparece maior que Prata, e é isso que a cota vendeu. Quatro degraus calibrados
 * mantêm a página coerente e impedem que um "400" digitado por engano empurre a
 * seção inteira para fora do desenho (mesma régua da armadilha 87: medida que o
 * sistema não entende não é substituída em silêncio, é recusada).
 */
export const SPONSOR_LOGO_SCALES = ['SMALL', 'MEDIUM', 'LARGE', 'FEATURE'] as const;

export type SponsorLogoScale = (typeof SPONSOR_LOGO_SCALES)[number];

export const SPONSOR_LOGO_SCALE_LABELS: Record<SponsorLogoScale, string> = {
  SMALL: 'Pequena',
  MEDIUM: 'Média',
  LARGE: 'Grande',
  FEATURE: 'Destaque',
};

/** Altura da logo na página pública, em pixels. */
export const SPONSOR_LOGO_HEIGHT_PX: Record<SponsorLogoScale, number> = {
  SMALL: 28,
  MEDIUM: 44,
  LARGE: 64,
  FEATURE: 96,
};

/** Largura máxima da logo: sem teto, uma marca deitada vira uma faixa na página. */
export const SPONSOR_LOGO_MAX_WIDTH_PX: Record<SponsorLogoScale, number> = {
  SMALL: 128,
  MEDIUM: 200,
  LARGE: 260,
  FEATURE: 340,
};

export const DEFAULT_SPONSOR_LOGO_SCALE: SponsorLogoScale = 'MEDIUM';

/**
 * Leitura tolerante da escala (valor desconhecido cai no padrão).
 *
 * É leitura de DADO já gravado, não de formulário: uma cota antiga, criada antes
 * desta fase, não tem o campo — e o padrão é o que ela já fazia na prática.
 */
export function parseSponsorLogoScale(value: unknown): SponsorLogoScale {
  return SPONSOR_LOGO_SCALES.includes(value as SponsorLogoScale)
    ? (value as SponsorLogoScale)
    : DEFAULT_SPONSOR_LOGO_SCALE;
}

/**
 * Cores sugeridas na tela.
 *
 * O organizador CLICA e a cor entra no campo, que continua sendo texto livre
 * (hexadecimal ou `oklch()`): a sugestão é atalho, não allowlist — a identidade da
 * instituição não cabe numa lista de sete.
 */
export const SPONSOR_TIER_COLOR_SUGGESTIONS = [
  { label: 'Ouro', value: '#b45309' },
  { label: 'Prata', value: '#64748b' },
  { label: 'Bronze', value: '#92400e' },
  { label: 'Azul', value: '#1d4ed8' },
  { label: 'Verde', value: '#15803d' },
  { label: 'Vinho', value: '#9f1239' },
  { label: 'Grafite', value: '#334155' },
] as const;

/** Tom do cartão da cota na página pública. */
export interface SponsorTierTint {
  /** Fundo do cartão: tom suave por cima do fundo da seção. */
  surface: string;
  /** Borda do cartão. */
  border: string;
  /** A cor CHEIA — vai no marcador ao lado do título da cota, nunca atrás de texto. */
  accent: string;
}

/**
 * Força do tom do cartão, em porcentagem da cor da cota.
 *
 * 16% é o valor que se lê como PASTEL sobre o fundo claro da página (o mesmo efeito
 * dos cartões do exemplo que originou a fase) e continua discreto no tema escuro.
 * Com 10% o cartão ficava quase branco e a hierarquia não aparecia — foi visto na
 * tela, não deduzido: a primeira versão saiu fraca.
 */
export const SPONSOR_TIER_TINT_PERCENT = 16;

/** Força da borda: mais firme que o fundo, para o cartão ter contorno definido. */
export const SPONSOR_TIER_BORDER_PERCENT = 45;

/**
 * Traduz a cor da cota no tom do cartão.
 *
 * Duas decisões que não são cosméticas:
 *
 *  1. a cor é VALIDADA antes de virar CSS (o mesmo `colorSchema` da página
 *     pública). Ela entra num `style` inline; um valor como `red; background:
 *     url(...)` sairia do contexto em que foi colocado;
 *  2. o tom suave sai de `color-mix`, e não de uma cor calculada em JavaScript:
 *     funciona igual para hexadecimal e para `oklch()`, e acompanha o tema claro
 *     ou escuro da página, porque mistura com `transparent` por cima do fundo.
 *
 * A cor cheia NUNCA vira fundo de cartão com texto por cima: `#facc15` com texto
 * branco é ilegível, e legibilidade não é escolha do organizador.
 *
 * Cota sem cor devolve `null`, e o cartão fica neutro: não escolher cor é resposta
 * legítima, não campo faltando.
 */
export function sponsorTierTint(color: string | null | undefined): SponsorTierTint | null {
  const parsed = colorSchema.safeParse(color ?? '');

  if (!parsed.success) return null;

  const accent = parsed.data;

  return {
    surface: `color-mix(in oklab, ${accent} ${SPONSOR_TIER_TINT_PERCENT}%, transparent)`,
    border: `color-mix(in oklab, ${accent} ${SPONSOR_TIER_BORDER_PERCENT}%, transparent)`,
    accent,
  };
}

/** Espaço reservado no orçamento do evento: reais, sem centavos. */
export const MAX_TIER_PRICE_CENTS = 100_000_000;

export const tierInputSchema = z.object({
  key: z.enum(SPONSOR_TIER_KEYS).default('CUSTOM'),
  name: z.string().trim().min(3, 'O nome da cota precisa ter ao menos 3 caracteres.').max(80),
  description: z.string().trim().max(400).optional(),
  color: colorSchema.optional(),
  /**
   * Degrau da logo na página pública (FASE 41).
   *
   * A escala é da COTA, e não do patrocinador: o tamanho é a hierarquia comprada,
   * e quem cadastra a empresa não é quem negociou a cota.
   */
  logoScale: z.enum(SPONSOR_LOGO_SCALES).default(DEFAULT_SPONSOR_LOGO_SCALE),
  rank: z.coerce.number().int().min(0).max(1000).default(0),
  priceCents: z.coerce.number().int().min(0).max(MAX_TIER_PRICE_CENTS).default(0),
  currency: z
    .string()
    .trim()
    .length(3, 'A moeda usa o código de 3 letras (ex.: BRL).')
    .toUpperCase()
    .default('BRL'),
  /**
   * `0` significa ILIMITADO, e não "nenhuma vaga".
   *
   * É a convenção que o schema já documenta (`maxSponsors Int @default(0)`), e a
   * única leitura que faz sentido: toda cota nasce em 0 e nenhuma cota nova pode
   * nascer proibida de receber patrocinador.
   */
  maxSponsors: z.coerce.number().int().min(0).max(MAX_SPONSORS_PER_TIER).default(0),
  /** O que a cota entrega (logo no site, estande, palestra…). */
  benefits: z.array(z.string().trim().min(1).max(160)).max(MAX_TIER_BENEFITS).default([]),
});

export type SponsorTierInput = z.input<typeof tierInputSchema>;

// ───────────────────────────────────────────────────────────────────────────────
//  Patrocinadores
// ───────────────────────────────────────────────────────────────────────────────
export const sponsorInputSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do patrocinador.').max(160),
  description: z.string().trim().max(2000).optional(),
  websiteUrl: safeUrlSchema.optional(),
  logoUrl: safeUrlSchema.optional(),
  tierId: z.string().uuid().optional(),
  contactName: z.string().trim().max(160).optional(),
  contactEmail: z.email('E-mail de contato inválido.').max(255).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  /**
   * Documento fiscal (CNPJ/CPF). Guardado, mas NUNCA devolvido em listagem nem
   * registrado em log — ver `maskTaxId`.
   */
  taxId: z.string().trim().max(32).optional(),
  contractValueCents: z.coerce.number().int().min(0).max(MAX_TIER_PRICE_CENTS).optional(),
  contractStart: z.coerce.date().optional(),
  contractEnd: z.coerce.date().optional(),
  displayOrder: z.coerce.number().int().min(0).max(1000).default(0),
  isActive: z.coerce.boolean().default(true),
});

export type SponsorInput = z.input<typeof sponsorInputSchema>;

/**
 * Gera o identificador do patrocinador a partir do nome.
 *
 * O `slug` é único por instituição (`@@unique([tenantId, slug])`) e é o que
 * permite reaproveitar o mesmo patrocinador em vários eventos sem duplicar
 * cadastro. Como o serviço pergunta ao banco se o candidato existe, a função aqui
 * é pura: devolve o candidato e, quando pedido, uma variação com sufixo.
 */
export function slugifySponsorName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

  return base.length > 0 ? base : 'patrocinador';
}

/** Candidato seguinte quando o slug já está em uso (`banco`, `banco-2`, …). */
export function nextSlugCandidate(slug: string, attempt: number): string {
  if (attempt <= 1) return slug.slice(0, 120);
  const suffix = `-${attempt}`;
  return `${slug.slice(0, 120 - suffix.length)}${suffix}`;
}

/**
 * Mascara o documento fiscal para exibição.
 *
 * CNPJ (`12345678000199`) vira `12.345.678/****-99`: o suficiente para o
 * financeiro conferir sem que a tela vire uma exportação de dados cadastrais.
 */
export function maskTaxId(taxId: string | null | undefined): string | null {
  if (!taxId) return null;

  const digits = taxId.replace(/\D/g, '');
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/****-${digits.slice(12)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
  }

  return '****';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Limite de vagas da cota
// ───────────────────────────────────────────────────────────────────────────────
export interface TierCapacityResult {
  allowed: boolean;
  /** Vagas restantes depois desta inclusão; `null` = ilimitado. */
  remaining: number | null;
  message?: string;
}

/**
 * A cota comporta mais um patrocinador?
 *
 * `currentCount` é contado no SERVIDOR, dentro da transação da gravação. É a
 * mesma decisão da reserva de vaga em atividade: sem contagem e escrita juntas,
 * dois cadastros simultâneos furariam o limite de patrocinadores — e o limite é
 * cláusula de contrato, não preferência de layout.
 */
export function evaluateTierCapacity(input: {
  maxSponsors: number;
  currentCount: number;
  /** Quantos já ocupam vaga com este mesmo patrocinador (edição). */
  excluding?: number;
}): TierCapacityResult {
  const occupied = Math.max(0, input.currentCount - (input.excluding ?? 0));

  if (input.maxSponsors <= 0) {
    return { allowed: true, remaining: null };
  }

  if (occupied >= input.maxSponsors) {
    return {
      allowed: false,
      remaining: 0,
      message: `Esta cota comporta ${input.maxSponsors} patrocinador(es) e já está completa.`,
    };
  }

  return { allowed: true, remaining: input.maxSponsors - occupied - 1 };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ordem de exibição
// ───────────────────────────────────────────────────────────────────────────────
export interface DisplaySponsor {
  id: string;
  name: string;
  displayOrder: number;
  tierRank: number | null;
}

/**
 * Ordena patrocinadores para exibição pública.
 *
 * Três critérios, nesta ordem: rank da cota → ordem dentro da cota → nome. O
 * último não é desempate cosmético: sem ele, dois patrocinadores da mesma cota
 * com a mesma ordem trocariam de lugar entre requisições (a ordem de retorno do
 * banco não é contrato), e a página pareceria instável.
 *
 * Quem não tem cota vai para o FIM (`Number.MAX_SAFE_INTEGER`), agrupado em
 * "Patrocinadores" — sumir com ele seria pior: o patrocínio existe e foi pago.
 */
export function sortSponsorsForDisplay<T extends DisplaySponsor>(sponsors: readonly T[]): T[] {
  return [...sponsors].sort((a, b) => {
    const rankA = a.tierRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.tierRank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vigência do contrato
// ───────────────────────────────────────────────────────────────────────────────
export type ContractState = 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'UNKNOWN';

export const CONTRACT_STATE_LABELS: Record<ContractState, string> = {
  ACTIVE: 'Vigente',
  SCHEDULED: 'A iniciar',
  EXPIRED: 'Encerrado',
  UNKNOWN: 'Sem vigência informada',
};

/**
 * Situação da vigência contratual na data de referência.
 *
 * Não altera a exibição pública — quem decide isso é `isActive`, que é um ato
 * explícito do organizador. Serve para o comercial ver o que venceu sem abrir
 * contrato por contrato, que é o motivo pelo qual o aviso existe.
 */
export function evaluateContractState(input: {
  contractStart?: Date | null;
  contractEnd?: Date | null;
  now: Date;
}): ContractState {
  const { contractStart, contractEnd, now } = input;

  if (!contractStart && !contractEnd) return 'UNKNOWN';

  const time = now.getTime();
  if (contractStart && time < contractStart.getTime()) return 'SCHEDULED';
  if (contractEnd && time > contractEnd.getTime()) return 'EXPIRED';

  return 'ACTIVE';
}

/** Normaliza uma lista de benefícios digitada como texto multilinha. */
export function parseBenefits(raw: string | null | undefined): string[] {
  if (!raw) return [];

  return raw
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_TIER_BENEFITS);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Reaproveitar um patrocinador em outro evento (FASE 23, item E11)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Dados de um patrocinador que fazem sentido levar para outra edição.
 *
 * Contrato, contato e logotipo VÃO junto: é o mesmo patrocínio, com o mesmo
 * responsável e a mesma marca. O que NÃO vai é a cota — a cota é do evento de
 * destino (o Ouro de uma edição pode não existir na outra) — e o valor do contrato,
 * que é renegociado a cada edição.
 */
export interface SponsorCopySource {
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  taxId: string | null;
  tierKey: SponsorTierKey | null;
}

export interface SponsorCopyTarget {
  eventId: string;
  /** Cotas do evento de destino, para casar a cota pela CHAVE. */
  tiers: readonly { id: string; key: SponsorTierKey }[];
  displayOrder?: number;
}

export interface SponsorCopyPlan {
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  taxId: string | null;
  tierId: string | null;
  displayOrder: number;
  isActive: boolean;
  /** A cota original não existe no destino? O organizador precisa saber. */
  tierMatched: boolean;
}

/**
 * Monta o cadastro do patrocinador no evento de destino.
 *
 * A cota é casada pela CHAVE (`GOLD` → `GOLD`), e não pelo nome: o nome é livre e
 * editável ("Ouro", "Cota Ouro", "Patrocinador Ouro") — casar por nome acertaria
 * por sorte. Sem cota correspondente, o patrocinador entra sem cota, que é um estado
 * válido (aparece no agrupamento genérico) e o chamador avisa na tela.
 *
 * O cadastro nasce INATIVO por padrão: quem copia está montando a próxima edição,
 * e exibir de imediato um patrocínio que ainda não foi fechado publicaria uma marca
 * no site sem contrato.
 */
export function planSponsorCopy(
  source: SponsorCopySource,
  target: SponsorCopyTarget,
): SponsorCopyPlan {
  const match = source.tierKey
    ? target.tiers.find((tier) => tier.key === source.tierKey) ?? null
    : null;

  return {
    name: source.name,
    description: source.description,
    websiteUrl: source.websiteUrl,
    logoUrl: source.logoUrl,
    contactName: source.contactName,
    contactEmail: source.contactEmail,
    contactPhone: source.contactPhone,
    taxId: source.taxId,
    tierId: match?.id ?? null,
    displayOrder: target.displayOrder ?? 0,
    isActive: false,
    tierMatched: match !== null,
  };
}

/**
 * O patrocinador já está neste evento?
 *
 * A comparação é por nome normalizado (sem acento, sem caixa) porque é assim que a
 * mesma empresa aparece escrita por pessoas diferentes — e cadastrar duas vezes a
 * mesma marca no mesmo evento duplica o logotipo na página pública.
 */
export function isAlreadySponsored(
  candidateName: string,
  existingNames: readonly string[],
): boolean {
  const key = normalizeName(candidateName);
  return existingNames.some((name) => normalizeName(name) === key);
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────────────────────────
//  Sincronizar uma cópia com a origem (FASE 24, item E15)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Campos que são da EMPRESA e podem ser sincronizados da origem.
 *
 * O que fica de fora, e por quê:
 *   • `tierId` — a cota é do evento (o Ouro de uma edição pode não existir na outra);
 *   • valor e vigência do contrato — renegociados a cada edição;
 *   • `isActive`, `displayOrder` — decisão de exibição de cada evento.
 *
 * Sincronizar só o que é da empresa mantém a promessa do modelo: a cópia é um
 * cadastro independente COM um vínculo, e não uma referência compartilhada.
 */
export const SPONSOR_SYNC_FIELDS = [
  'name',
  'description',
  'websiteUrl',
  'logoUrl',
  'contactName',
  'contactEmail',
  'contactPhone',
  'taxId',
] as const;

export interface SponsorSyncSource {
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  taxId: string | null;
}

export interface SponsorSyncPlan {
  /** Campos que mudariam, com o valor de antes e o de depois. */
  changes: Record<string, { from: string | null; to: string | null }>;
  /** Nada a fazer? (a tela evita uma viagem ao servidor sem efeito) */
  isEmpty: boolean;
}

/**
 * Compara a origem com a cópia e devolve o que mudaria.
 *
 * A comparação é campo a campo porque a ação precisa dizer O QUE vai mudar antes de
 * mudar — sincronizar é sobrescrever o cadastro do evento, e o organizador tem
 * direito de saber que o telefone de contato vai ser trocado pelo da origem.
 */
export function planSponsorSync(
  source: SponsorSyncSource,
  target: SponsorSyncSource,
): SponsorSyncPlan {
  const changes: Record<string, { from: string | null; to: string | null }> = {};

  for (const field of SPONSOR_SYNC_FIELDS) {
    const from = normalizeSyncValue(target[field]);
    const to = normalizeSyncValue(source[field]);

    if (from !== to) changes[field] = { from, to };
  }

  return { changes, isEmpty: Object.keys(changes).length === 0 };
}

/** Texto vazio e ausente são a mesma coisa aqui (o formulário devolve string vazia). */
function normalizeSyncValue(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}
