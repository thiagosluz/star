/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Patrocínio: cotas e patrocinadores (FASE 17, item E5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE JÁ EXISTIA E O QUE FALTAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `SponsorTier` e `Sponsor` existem desde a FASE 3, o bloco `SPONSORS` da landing
 *  page os renderiza, e a permissão `sponsor:manage` está no catálogo desde a FASE 2
 *  — inclusive concedida a `FINANCE`. O que nunca existiu foi o caminho de escrita:
 *  nenhum código da aplicação criava cota ou patrocinador. O bloco de patrocínio era
 *  inalcançável na prática.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A QUOTA É RESPEITADA NA MESMA TRANSAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `maxSponsors` é cláusula comercial ("só um Diamante por edição"), não preferência
 *  de layout. Contar e gravar em transações separadas deixaria dois cadastros
 *  simultâneos furarem o limite — o mesmo raciocínio da reserva de vaga em atividade
 *  e da quota de membros do plano. Aqui a contagem acontece DENTRO da transação da
 *  gravação, com o contexto de instituição aplicado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation, violatedIndexName } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import {
  CONTRACT_STATE_LABELS,
  evaluateContractState,
  evaluateTierCapacity,
  maskTaxId,
  nextSlugCandidate,
  slugifySponsorName,
  sortSponsorsForDisplay,
  type ContractState,
  type SponsorTierKey,
} from '@/domain/events/sponsor-rules';

export type SponsorErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'TIER_FULL'
  | 'SLUG_TAKEN'
  | 'TIER_IN_USE'
  | 'INTERNAL';

export type SponsorResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: SponsorErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorTierRow {
  id: string;
  key: SponsorTierKey;
  name: string;
  description: string | null;
  color: string | null;
  rank: number;
  priceCents: number;
  currency: string;
  maxSponsors: number;
  benefits: string[];
  sponsorCount: number;
  /** Quantas vagas sobram; `null` = ilimitado. */
  remaining: number | null;
}

export interface SponsorRow {
  id: string;
  name: string;
  slug: string;
  tierId: string | null;
  tierName: string | null;
  tierRank: number | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Documento fiscal MASCARADO — o valor completo não sai do banco para a tela. */
  taxIdMasked: string | null;
  contractValueCents: number | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  contractState: ContractState;
  contractStateLabel: string;
  displayOrder: number;
  isActive: boolean;
}

export interface SponsorBoard {
  tiers: SponsorTierRow[];
  sponsors: SponsorRow[];
  /** Quantos patrocinadores ativos aparecem na página pública. */
  publicCount: number;
}

export async function listSponsorBoard(
  tenantId: string,
  eventId: string,
  options: { now?: Date } = {},
): Promise<SponsorBoard | null> {
  const now = options.now ?? new Date();

  return withTenant(tenantId, async (tx) => {
    const event = await tx.event.findFirst({
      where: { id: eventId, tenantId, deletedAt: null },
      select: { id: true },
    });

    if (!event) return null;

    const [tiers, sponsors] = await Promise.all([
      tx.sponsorTier.findMany({
        where: { tenantId, eventId },
        orderBy: [{ rank: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          key: true,
          name: true,
          description: true,
          color: true,
          rank: true,
          priceCents: true,
          currency: true,
          maxSponsors: true,
          benefits: true,
          _count: { select: { sponsors: { where: { deletedAt: null } } } },
        },
      }),
      tx.sponsor.findMany({
        where: { tenantId, eventId, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          tierId: true,
          logoUrl: true,
          websiteUrl: true,
          description: true,
          contactName: true,
          contactEmail: true,
          contactPhone: true,
          taxId: true,
          contractValueCents: true,
          contractStart: true,
          contractEnd: true,
          displayOrder: true,
          isActive: true,
          tier: { select: { name: true, rank: true } },
        },
      }),
    ]);

    const tierRows: SponsorTierRow[] = tiers.map((tier) => {
      const capacity = evaluateTierCapacity({
        maxSponsors: tier.maxSponsors,
        currentCount: tier._count.sponsors,
      });

      return {
        id: tier.id,
        key: tier.key as SponsorTierKey,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        rank: tier.rank,
        priceCents: tier.priceCents,
        currency: tier.currency,
        maxSponsors: tier.maxSponsors,
        benefits: toStringArray(tier.benefits),
        sponsorCount: tier._count.sponsors,
        remaining: capacity.remaining,
      };
    });

    const ordered = sortSponsorsForDisplay(
      sponsors.map((sponsor) => ({
        id: sponsor.id,
        name: sponsor.name,
        displayOrder: sponsor.displayOrder,
        tierRank: sponsor.tier?.rank ?? null,
        raw: sponsor,
      })),
    );

    const rows: SponsorRow[] = ordered.map(({ raw }) => {
      const state = evaluateContractState({
        contractStart: raw.contractStart,
        contractEnd: raw.contractEnd,
        now,
      });

      return {
        id: raw.id,
        name: raw.name,
        slug: raw.slug,
        tierId: raw.tierId,
        tierName: raw.tier?.name ?? null,
        tierRank: raw.tier?.rank ?? null,
        logoUrl: raw.logoUrl,
        websiteUrl: raw.websiteUrl,
        description: raw.description,
        contactName: raw.contactName,
        contactEmail: raw.contactEmail,
        contactPhone: raw.contactPhone,
        taxIdMasked: maskTaxId(raw.taxId),
        contractValueCents: raw.contractValueCents,
        contractStart: raw.contractStart,
        contractEnd: raw.contractEnd,
        contractState: state,
        contractStateLabel: CONTRACT_STATE_LABELS[state],
        displayOrder: raw.displayOrder,
        isActive: raw.isActive,
      };
    });

    return {
      tiers: tierRows,
      sponsors: rows,
      publicCount: rows.filter((row) => row.isActive).length,
    };
  });
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cotas
// ───────────────────────────────────────────────────────────────────────────────
export interface SaveTierInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  tierId?: string;
  key: SponsorTierKey;
  name: string;
  description: string | null;
  color: string | null;
  rank: number;
  priceCents: number;
  currency: string;
  maxSponsors: number;
  benefits: string[];
}

export async function saveSponsorTier(
  input: SaveTierInput,
): Promise<SponsorResult<{ tierId: string; created: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const data = {
        key: input.key,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        color: input.color?.trim() || null,
        rank: input.rank,
        priceCents: input.priceCents,
        currency: input.currency.toUpperCase(),
        maxSponsors: input.maxSponsors,
        benefits: input.benefits as unknown as object,
      };

      if (input.tierId) {
        const before = await tx.sponsorTier.findFirst({
          where: { id: input.tierId, eventId: input.eventId, tenantId: input.tenantId },
          select: { id: true, name: true, rank: true, maxSponsors: true, priceCents: true },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Cota não encontrada.' };
        }

        /**
         * Reduzir o limite abaixo do que já está ocupado é recusado.
         *
         * A alternativa — aceitar e deixar a cota "estourada" — transformaria um
         * erro de digitação em um estado que o próprio sistema considera inválido,
         * e a próxima leitura mostraria "0 vagas" para uma cota com 3 patrocinadores.
         */
        const currentCount = await tx.sponsor.count({
          where: { tierId: before.id, deletedAt: null },
        });

        if (input.maxSponsors > 0 && currentCount > input.maxSponsors) {
          return {
            ok: false as const,
            code: 'TIER_FULL' as const,
            message: `Esta cota já tem ${currentCount} patrocinador(es); o limite não pode ser menor que isso.`,
          };
        }

        await tx.sponsorTier.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'sponsorTier',
            entityId: before.id,
            changes: diffFields(before, data, ['name', 'rank', 'maxSponsors', 'priceCents']),
          },
          tx,
        );

        return { ok: true as const, tierId: before.id, created: false };
      }

      const tierId = randomUUID();

      await tx.sponsorTier.create({
        data: { id: tierId, tenantId: input.tenantId, eventId: input.eventId, ...data },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'sponsorTier',
          entityId: tierId,
          changes: {
            name: { from: null, to: input.name.trim() },
            maxSponsors: { from: null, to: input.maxSponsors },
          },
        },
        tx,
      );

      return { ok: true as const, tierId, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error) && violatedIndexName(error)?.includes('name')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN' as const,
        message: 'Já existe uma cota com este nome neste evento.',
      };
    }

    return toFailure('saveSponsorTier', error, 'Não foi possível salvar a cota.');
  }
}

/**
 * Remove uma cota.
 *
 * Recusa quando há patrocinadores nela. A FK é `onDelete: SetNull`, então o banco
 * aceitaria — e o resultado seria um patrocínio pago que perde a cota e desce para
 * o agrupamento genérico, sem ninguém ter pedido. Melhor recusar e dizer quem está
 * lá.
 */
export async function deleteSponsorTier(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  tierId: string;
}): Promise<SponsorResult<{ tierId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const tier = await tx.sponsorTier.findFirst({
        where: { id: input.tierId, eventId: input.eventId, tenantId: input.tenantId },
        select: { id: true, name: true },
      });

      if (!tier) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Cota não encontrada.' };
      }

      const inUse = await tx.sponsor.count({ where: { tierId: tier.id, deletedAt: null } });

      if (inUse > 0) {
        return {
          ok: false as const,
          code: 'TIER_IN_USE' as const,
          message: `Esta cota tem ${inUse} patrocinador(es). Mova-os antes de removê-la.`,
        };
      }

      await tx.sponsorTier.delete({ where: { id: tier.id } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'sponsorTier',
          entityId: tier.id,
          changes: { name: { from: tier.name, to: null } },
        },
        tx,
      );

      return { ok: true as const, tierId: tier.id };
    });
  } catch (error) {
    return toFailure('deleteSponsorTier', error, 'Não foi possível remover a cota.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Patrocinadores
// ───────────────────────────────────────────────────────────────────────────────
export interface SaveSponsorInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  sponsorId?: string;
  name: string;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  tierId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /**
   * Documento fiscal.
   *
   * `undefined` = NÃO INFORMADO, e o valor gravado é preservado. É deliberado: a
   * tela mostra o documento MASCARADO, então o formulário de edição não tem como
   * devolvê-lo — se `undefined` virasse `null`, abrir o formulário e salvar apagaria
   * o CNPJ do patrocinador sem ninguém pedir. Para limpar o campo é preciso mandar
   * string vazia.
   */
  taxId?: string | null;
  contractValueCents: number | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  displayOrder: number;
  isActive: boolean;
}

/**
 * Cria ou atualiza um patrocinador, aplicando o limite de vagas da cota.
 *
 * O `slug` é único por INSTITUIÇÃO (não por evento): o patrocínio é reaproveitável
 * entre edições do mesmo evento e entre eventos da mesma instituição, e o slug é o
 * que mantém o mesmo registro em vez de duplicar o cadastro.
 */
export async function saveSponsor(
  input: SaveSponsorInput,
): Promise<SponsorResult<{ sponsorId: string; created: boolean; slug: string }>> {
  try {
    if (input.contractStart && input.contractEnd && input.contractEnd.getTime() < input.contractStart.getTime()) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT' as const,
        message: 'O fim do contrato não pode ser antes do início.',
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      if (input.tierId) {
        const tier = await tx.sponsorTier.findFirst({
          where: { id: input.tierId, eventId: input.eventId, tenantId: input.tenantId },
          select: { id: true, name: true, maxSponsors: true },
        });

        if (!tier) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Cota não encontrada neste evento.' };
        }

        const currentCount = await tx.sponsor.count({
          where: {
            tierId: tier.id,
            deletedAt: null,
            ...(input.sponsorId ? { id: { not: input.sponsorId } } : {}),
          },
        });

        const capacity = evaluateTierCapacity({
          maxSponsors: tier.maxSponsors,
          currentCount,
        });

        if (!capacity.allowed) {
          return {
            ok: false as const,
            code: 'TIER_FULL' as const,
            message: capacity.message ?? `A cota "${tier.name}" está completa.`,
          };
        }
      }

      const data = {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
        logoUrl: input.logoUrl?.trim() || null,
        tierId: input.tierId,
        contactName: input.contactName?.trim() || null,
        contactEmail: input.contactEmail?.trim() || null,
        contactPhone: input.contactPhone?.trim() || null,
        ...(input.taxId === undefined ? {} : { taxId: input.taxId?.trim() || null }),
        contractValueCents: input.contractValueCents,
        contractStart: input.contractStart,
        contractEnd: input.contractEnd,
        displayOrder: input.displayOrder,
        isActive: input.isActive,
      };

      if (input.sponsorId) {
        const before = await tx.sponsor.findFirst({
          where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
          select: {
            id: true,
            slug: true,
            name: true,
            tierId: true,
            isActive: true,
            logoUrl: true,
            displayOrder: true,
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
        }

        await tx.sponsor.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'sponsor',
            entityId: before.id,
            /**
             * O documento fiscal NUNCA entra na trilha, nem mascarado: a trilha é
             * lida por mais gente do que o cadastro comercial, e `recordAudit`
             * omite a chave `taxId` só se ela for enviada — então ela não é enviada.
             */
            changes: diffFields(before, data, ['name', 'tierId', 'isActive', 'logoUrl', 'displayOrder']),
          },
          tx,
        );

        return { ok: true as const, sponsorId: before.id, created: false, slug: before.slug };
      }

      const slug = await allocateSlug(tx, input.tenantId, input.name);
      const sponsorId = randomUUID();

      await tx.sponsor.create({
        data: { id: sponsorId, tenantId: input.tenantId, eventId: input.eventId, slug, ...data },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'sponsor',
          entityId: sponsorId,
          changes: {
            name: { from: null, to: input.name.trim() },
            slug: { from: null, to: slug },
            tierId: { from: null, to: input.tierId },
          },
        },
        tx,
      );

      return { ok: true as const, sponsorId, created: true, slug };
    });
  } catch (error) {
    return toFailure('saveSponsor', error, 'Não foi possível salvar o patrocinador.');
  }
}

/**
 * Aloca um `slug` livre para a instituição.
 *
 * O índice único é a garantia definitiva; esta busca só evita o erro no caso
 * comum. Um patrocinador homônimo de outro evento da mesma instituição recebe
 * `nome-2`, e é assim que o mesmo patrocínio em duas edições fica com o mesmo
 * registro quando o organizador reutiliza o cadastro existente.
 */
async function allocateSlug(
  tx: TxClient,
  tenantId: string,
  name: string,
): Promise<string> {
  const base = slugifySponsorName(name);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const candidate = nextSlugCandidate(base, attempt);
    const existing = await tx.sponsor.findFirst({
      where: { tenantId, slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  return nextSlugCandidate(`${base}-${Date.now().toString(36)}`, 1);
}

/**
 * Liga/desliga a exibição pública.
 *
 * Ação separada de `saveSponsor` de propósito: quem está no balcão precisa tirar um
 * patrocinador do ar sem abrir o formulário inteiro e sem risco de mexer em contrato.
 */
export async function setSponsorActive(input: {
  tenantId: string;
  actorId: string;
  sponsorId: string;
  isActive: boolean;
}): Promise<SponsorResult<{ sponsorId: string; isActive: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const before = await tx.sponsor.findFirst({
        where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });

      if (!before) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
      }

      await tx.sponsor.update({ where: { id: before.id }, data: { isActive: input.isActive } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'sponsor',
          entityId: before.id,
          changes: { isActive: { from: before.isActive, to: input.isActive } },
        },
        tx,
      );

      return { ok: true as const, sponsorId: before.id, isActive: input.isActive };
    });
  } catch (error) {
    return toFailure('setSponsorActive', error, 'Não foi possível alterar a exibição.');
  }
}

/**
 * Remove um patrocinador (remoção LÓGICA).
 *
 * `deletedAt` em vez de `DELETE`: o registro carrega contrato e valor, e apagar o
 * histórico financeiro de um patrocínio é decisão de negócio, não efeito colateral
 * de clicar em "remover" na tela errada.
 */
export async function removeSponsor(input: {
  tenantId: string;
  actorId: string;
  sponsorId: string;
}): Promise<SponsorResult<{ sponsorId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const before = await tx.sponsor.findFirst({
        where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true, isActive: true },
      });

      if (!before) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
      }

      await tx.sponsor.update({
        where: { id: before.id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'sponsor',
          entityId: before.id,
          changes: { name: { from: before.name, to: null }, isActive: { from: before.isActive, to: false } },
        },
        tx,
      );

      return { ok: true as const, sponsorId: before.id };
    });
  } catch (error) {
    return toFailure('removeSponsor', error, 'Não foi possível remover o patrocinador.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Falhas
// ───────────────────────────────────────────────────────────────────────────────
function toFailure<T>(
  operation: string,
  error: unknown,
  fallbackMessage: string,
): SponsorResult<T> {
  if (isUniqueViolation(error)) {
    const index = violatedIndexName(error) ?? '';
    if (index.includes('slug')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN' as const,
        message: 'Já existe um patrocinador com este identificador na instituição.',
      };
    }
    if (index.includes('name')) {
      return {
        ok: false as const,
        code: 'SLUG_TAKEN' as const,
        message: 'Já existe uma cota com este nome neste evento.',
      };
    }
  }

  console.error(`[sponsor] falha em ${operation}: ${errorMessage(error)}`);
  return { ok: false as const, code: 'INTERNAL' as const, message: fallbackMessage };
}
