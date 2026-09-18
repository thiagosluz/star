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

/** Espaço reservado no orçamento do evento: reais, sem centavos. */
export const MAX_TIER_PRICE_CENTS = 100_000_000;

export const tierInputSchema = z.object({
  key: z.enum(SPONSOR_TIER_KEYS).default('CUSTOM'),
  name: z.string().trim().min(3, 'O nome da cota precisa ter ao menos 3 caracteres.').max(80),
  description: z.string().trim().max(400).optional(),
  color: colorSchema.optional(),
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
