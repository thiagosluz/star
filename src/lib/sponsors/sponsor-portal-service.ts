/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Experiência do patrocinador (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS ATORES, TRÊS PERMISSÕES DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a ORGANIZAÇÃO (`sponsor:manage`) cadastra o QR, convida pessoas e vê tudo;
 *    • o PATROCINADOR (vínculo `ACTIVE`) vê **só o patrocinador dele**, e só o que
 *      o participante autorizou;
 *    • o PARTICIPANTE (dono da leitura) credita a visita e pode revogar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CRÉDITO É DA VISITA; O CONTATO É DO CONSENTIMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ler o QR credita XP/carta sempre — com ou sem autorização. O nome e o e-mail
 *  só entram no registro quando a pessoa autoriza, e `evaluateLeadAccess` decide,
 *  na LEITURA, se o patrocinador ainda pode ver. Condicionar a recompensa ao
 *  consentimento transformaria o dado pessoal em preço de entrada (LGPD, art. 8º,
 *  §3º) — e é por isso que a tela oferece as duas opções com o mesmo prêmio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS IDEMPOTÊNCIAS, PARA O MESMO FATO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QR do estande é PÚBLICO: reler o mesmo código não pode creditar de novo.
 *  A trava existe em dois lugares, de propósito:
 *    • `sponsor_scans` tem índice único (qrCodeId, userId) — é o registro do fato;
 *    • o XP usa chave derivada do MESMO par — mesmo que duas leituras simultâneas
 *      passem pela checagem, o motor de XP deduplica.
 *  O cartão é concedido apenas na PRIMEIRA leitura (o motor de cartas não recebe
 *  chave de fato do chamador; a trava é o registro da leitura).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { diffFields, recordAudit } from '@/lib/admin/audit';
import {
  DEFAULT_CONSENT_DAYS,
  LEAD_ACCESS_LABELS,
  buildLeadShare,
  consentExpiryFrom,
  creditForScan,
  evaluateLeadAccess,
  evaluateSponsorInviteClaim,
  formatSponsorQrCode,
  generateSponsorQrCode,
  isValidSponsorQrCode,
  normalizeSponsorQrCode,
  sponsorConsentText,
  type LeadAccessState,
} from '@/domain/events/sponsor-experience-rules';
import {
  hashInviteToken,
  inviteExpiryFrom,
  newInviteToken,
  normalizeInviteToken,
} from '@/domain/tenancy/invite-token-rules';
import { awardForEvent, grantCardForTrigger } from '@/lib/gamification/reward-engine';

export type SponsorPortalErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'NO_ACCOUNT'
  | 'ALREADY_LINKED'
  | 'INVITE_INVALID'
  | 'INTERNAL';

export type SponsorPortalResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: SponsorPortalErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Acesso: quem é patrocinador de quê
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorAccess {
  linkId: string;
  sponsorId: string;
  sponsorName: string;
  sponsorSlug: string;
  /** Eventos em que o patrocinador tem QR cadastrado (para o seletor da área). */
  eventTitles: string[];
}

/**
 * Os patrocinadores aos quais a pessoa está vinculada.
 *
 * É a PORTA da área do patrocinador (e o que a torna inalcançável para quem não
 * tem vínculo): o papel `SPONSOR` dá `sponsor:read` no escopo da instituição, mas
 * ver QUAL patrocinador é este vínculo que decide.
 */
export async function listSponsorAccess(tenantId: string, userId: string): Promise<SponsorAccess[]> {
  return withTenant(tenantId, async (tx) => {
    const links = await tx.sponsorUser.findMany({
      where: { tenantId, userId, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sponsor: {
          select: {
            id: true,
            name: true,
            slug: true,
            deletedAt: true,
            qrCodes: {
              where: { deletedAt: null },
              select: { event: { select: { title: true } } },
            },
          },
        },
      },
    });

    return links
      .filter((link) => link.sponsor.deletedAt === null)
      .map((link) => ({
        linkId: link.id,
        sponsorId: link.sponsor.id,
        sponsorName: link.sponsor.name,
        sponsorSlug: link.sponsor.slug,
        eventTitles: [...new Set(link.sponsor.qrCodes.map((qr) => qr.event.title))],
      }));
  });
}

/** A pessoa tem convite pendente para o e-mail da conta? (segunda porta da área) */
export async function hasPendingSponsorInvite(
  tenantId: string,
  userEmail: string | null,
): Promise<boolean> {
  if (!userEmail) return false;

  return withTenant(tenantId, async (tx) => {
    const row = await tx.sponsorUser.findFirst({
      where: {
        tenantId,
        invitedEmail: userEmail.trim().toLowerCase(),
        userId: null,
        inviteTokenHash: { not: null },
        status: 'INVITED',
        deletedAt: null,
      },
      select: { id: true },
    });

    return row !== null;
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Área do patrocinador (SÓ LEITURA, e só do que é dele)
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorPortalSponsor {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  tierName: string | null;
  tierBenefits: string[];
  tierPriceCents: number | null;
  currency: string | null;
  contractValueCents: number | null;
  contractStart: Date | null;
  contractEnd: Date | null;
  contractStateLabel: string;
  eventTitles: string[];
}

export interface SponsorPortalQr {
  id: string;
  code: string;
  formattedCode: string;
  label: string;
  xpAmount: number;
  cardName: string | null;
  consentDays: number;
  isActive: boolean;
  eventTitle: string;
  visits: number;
  leads: number;
}

export interface SponsorPortalLead {
  scanId: string;
  sharedName: string;
  sharedEmail: string;
  consentedAt: Date;
  expiresAt: Date | null;
  state: LeadAccessState;
  stateLabel: string;
  eventTitle: string;
  qrLabel: string;
}

export interface SponsorPortal {
  sponsors: SponsorPortalSponsor[];
  selected: SponsorPortalSponsor | null;
  qrCodes: SponsorPortalQr[];
  leads: SponsorPortalLead[];
  /** Visitas totais e visitas AUTORIZADAS (a diferença são as não identificadas). */
  counters: { visits: number; leads: number };
}

/**
 * O quadro do patrocinador.
 *
 * Toda leitura de contato passa por `evaluateLeadAccess`: um lead revogado ou
 * vencido NÃO entra na lista (e continua contando como visita). O patrocinador vê
 * números de visitas e a lista de quem autorizou — nada mais.
 */
export async function getSponsorPortal(input: {
  tenantId: string;
  userId: string;
  sponsorId?: string | null;
  now?: Date;
}): Promise<SponsorPortalResult<{ portal: SponsorPortal }>> {
  const now = input.now ?? new Date();

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const links = await tx.sponsorUser.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, status: 'ACTIVE', deletedAt: null },
        select: {
          sponsor: {
            select: {
              id: true,
              name: true,
              description: true,
              logoUrl: true,
              websiteUrl: true,
              contractValueCents: true,
              contractStart: true,
              contractEnd: true,
              deletedAt: true,
              tier: {
                select: {
                  name: true,
                  benefits: true,
                  priceCents: true,
                  currency: true,
                },
              },
              qrCodes: {
                where: { deletedAt: null },
                select: { event: { select: { title: true } } },
              },
            },
          },
        },
      });

      const available = links
        .filter((link) => link.sponsor.deletedAt === null)
        .map((link) => link.sponsor);

      if (available.length === 0) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Você não está vinculado a nenhum patrocinador desta instituição.',
        };
      }

      const chosen =
        available.find((sponsor) => sponsor.id === input.sponsorId) ?? available[0]!;

      const sponsors: SponsorPortalSponsor[] = available.map((sponsor) => ({
        id: sponsor.id,
        name: sponsor.name,
        description: sponsor.description,
        logoUrl: sponsor.logoUrl,
        websiteUrl: sponsor.websiteUrl,
        tierName: sponsor.tier?.name ?? null,
        tierBenefits: toStringArray(sponsor.tier?.benefits),
        tierPriceCents: sponsor.tier?.priceCents ?? null,
        currency: sponsor.tier?.currency ?? null,
        contractValueCents: sponsor.contractValueCents ?? null,
        contractStart: sponsor.contractStart,
        contractEnd: sponsor.contractEnd,
        contractStateLabel: contractStateLabel(sponsor.contractStart, sponsor.contractEnd, now),
        eventTitles: [...new Set(sponsor.qrCodes.map((qr) => qr.event.title))],
      }));

      const qrRows = await tx.sponsorQrCode.findMany({
        where: { tenantId: input.tenantId, sponsorId: chosen.id, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }],
        select: {
          id: true,
          code: true,
          label: true,
          xpAmount: true,
          consentDays: true,
          isActive: true,
          event: { select: { title: true } },
          cardTemplate: { select: { name: true } },
          scans: {
            select: { consentedAt: true, expiresAt: true, revokedAt: true },
          },
        },
      });

      const qrCodes: SponsorPortalQr[] = qrRows.map((qr) => {
        const leads = qr.scans.filter(
          (scan) =>
            evaluateLeadAccess({
              consentedAt: scan.consentedAt,
              expiresAt: scan.expiresAt,
              revokedAt: scan.revokedAt,
              now,
            }) === 'ACTIVE',
        ).length;

        return {
          id: qr.id,
          code: qr.code,
          formattedCode: formatSponsorQrCode(qr.code),
          label: qr.label,
          xpAmount: qr.xpAmount,
          cardName: qr.cardTemplate?.name ?? null,
          consentDays: qr.consentDays,
          isActive: qr.isActive,
          eventTitle: qr.event.title,
          visits: qr.scans.length,
          leads,
        };
      });

      const scanRows = await tx.sponsorScan.findMany({
        where: { tenantId: input.tenantId, sponsorId: chosen.id, consentedAt: { not: null } },
        orderBy: [{ consentedAt: 'desc' }],
        select: {
          id: true,
          sharedName: true,
          sharedEmail: true,
          consentedAt: true,
          expiresAt: true,
          revokedAt: true,
          event: { select: { title: true } },
          qrCode: { select: { label: true } },
        },
      });

      const leads: SponsorPortalLead[] = [];

      for (const scan of scanRows) {
        const state = evaluateLeadAccess({
          consentedAt: scan.consentedAt,
          expiresAt: scan.expiresAt,
          revokedAt: scan.revokedAt,
          now,
        });

        /** Só o que está VIGENTE entra na lista — e a contagem de visitas não muda. */
        if (state !== 'ACTIVE') continue;
        if (!scan.sharedName || !scan.sharedEmail) continue;

        leads.push({
          scanId: scan.id,
          sharedName: scan.sharedName,
          sharedEmail: scan.sharedEmail,
          consentedAt: scan.consentedAt!,
          expiresAt: scan.expiresAt,
          state,
          stateLabel: LEAD_ACCESS_LABELS[state],
          eventTitle: scan.event.title,
          qrLabel: scan.qrCode.label,
        });
      }

      const visits = qrCodes.reduce((total, qr) => total + qr.visits, 0);
      const totalLeads = leads.length;

      return {
        ok: true as const,
        portal: {
          sponsors,
          selected: sponsors.find((sponsor) => sponsor.id === chosen.id) ?? null,
          qrCodes,
          leads,
          counters: { visits, leads: totalLeads },
        },
      };
    });
  } catch (error) {
    return toFailure('getSponsorPortal', error, 'Não foi possível carregar a área do patrocinador.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  QR do patrocinador (a organização cadastra)
// ───────────────────────────────────────────────────────────────────────────────
export interface SaveSponsorQrInput {
  tenantId: string;
  actorId: string;
  sponsorId: string;
  eventId: string;
  qrId?: string;
  label: string;
  xpAmount: number;
  cardTemplateId: string | null;
  consentDays: number;
}

export async function saveSponsorQrCode(
  input: SaveSponsorQrInput,
): Promise<SponsorPortalResult<{ qrId: string; code: string; created: boolean }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const sponsor = await tx.sponsor.findFirst({
        where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true },
      });

      if (!sponsor) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
      }

      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      /**
       * A carta precisa ser DESTA instituição (e do evento ou da instituição): um id
       * de carta de outro tenant creditaria uma carta que o participante não pode
       * ter — a RLS barraria a leitura depois, e o QR ficaria creditando nada.
       */
      if (input.cardTemplateId) {
        const card = await tx.cardTemplate.findFirst({
          where: { id: input.cardTemplateId, tenantId: input.tenantId, deletedAt: null },
          select: { id: true },
        });

        if (!card) {
          return {
            ok: false as const,
            code: 'INVALID_INPUT' as const,
            message: 'A carta escolhida não existe nesta instituição.',
          };
        }
      }

      const data = {
        label: input.label.trim(),
        xpAmount: input.xpAmount,
        cardTemplateId: input.cardTemplateId,
        consentDays: input.consentDays,
        eventId: input.eventId,
        sponsorId: input.sponsorId,
      };

      if (input.qrId) {
        const before = await tx.sponsorQrCode.findFirst({
          where: { id: input.qrId, tenantId: input.tenantId, sponsorId: input.sponsorId, deletedAt: null },
          select: {
            id: true,
            code: true,
            label: true,
            xpAmount: true,
            consentDays: true,
            cardTemplateId: true,
            eventId: true,
          },
        });

        if (!before) {
          return { ok: false as const, code: 'NOT_FOUND' as const, message: 'QR não encontrado.' };
        }

        await tx.sponsorQrCode.update({ where: { id: before.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'sponsorQrCode',
            entityId: before.id,
            /**
             * `eventId` NÃO entra na comparação: mover um QR de evento é mudar o
             * crédito de lugar, e o diff compara só o que a tela edita.
             */
            changes: diffFields(before, data, ['label', 'xpAmount', 'consentDays', 'cardTemplateId']),
          },
          tx,
        );

        return { ok: true as const, qrId: before.id, code: before.code, created: false };
      }

      /**
       * O código é sorteado com `randomBytes` e conferido contra a instituição: a
       * colisão é improvável (40 bits), mas o laço existe porque falhar em silêncio
       * aqui imprimiria um QR que aponta para o patrocinador errado.
       */
      let code = '';
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateSponsorQrCode((max) => randomBytes(1)[0]! % max);
        const taken = await tx.sponsorQrCode.findFirst({
          where: { tenantId: input.tenantId, code: candidate },
          select: { id: true },
        });

        if (!taken) {
          code = candidate;
          break;
        }
      }

      if (!code) {
        return {
          ok: false as const,
          code: 'INTERNAL' as const,
          message: 'Não foi possível gerar um código único. Tente de novo.',
        };
      }

      const qrId = randomUUID();

      await tx.sponsorQrCode.create({
        data: { id: qrId, tenantId: input.tenantId, code, createdById: input.actorId, ...data },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'sponsorQrCode',
          entityId: qrId,
          changes: {
            label: { from: null, to: data.label },
            code: { from: null, to: code },
            xpAmount: { from: null, to: data.xpAmount },
          },
        },
        tx,
      );

      return { ok: true as const, qrId, code, created: true };
    });
  } catch (error) {
    return toFailure('saveSponsorQrCode', error, 'Não foi possível salvar o QR do patrocinador.');
  }
}

export async function setSponsorQrCodeActive(input: {
  tenantId: string;
  actorId: string;
  qrId: string;
  isActive: boolean;
}): Promise<SponsorPortalResult<Record<never, never>>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const qr = await tx.sponsorQrCode.findFirst({
        where: { id: input.qrId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, isActive: true },
      });

      if (!qr) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'QR não encontrado.' };
      }

      await tx.sponsorQrCode.update({ where: { id: qr.id }, data: { isActive: input.isActive } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'sponsorQrCode',
          entityId: qr.id,
          changes: { isActive: { from: qr.isActive, to: input.isActive } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    return toFailure('setSponsorQrCodeActive', error, 'Não foi possível alterar o QR.');
  }
}

/**
 * Desativar (e não apagar) é o caminho normal: o QR some da página pública e as
 * leituras continuam existindo. Apagar de verdade é para o QR criado por engano —
 * e leva as leituras junto (a FK é `CASCADE`), porque a autorização foi dada
 * PARA AQUELE QR.
 */
export async function deleteSponsorQrCode(input: {
  tenantId: string;
  actorId: string;
  qrId: string;
}): Promise<SponsorPortalResult<Record<never, never>>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const qr = await tx.sponsorQrCode.findFirst({
        where: { id: input.qrId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, code: true, label: true },
      });

      if (!qr) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'QR não encontrado.' };
      }

      await tx.sponsorQrCode.update({
        where: { id: qr.id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'sponsorQrCode',
          entityId: qr.id,
          changes: { label: { from: qr.label, to: null } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    return toFailure('deleteSponsorQrCode', error, 'Não foi possível excluir o QR.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculo: convite e vínculo manual
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorTeamRow {
  linkId: string;
  userId: string | null;
  name: string | null;
  email: string | null;
  status: 'INVITED' | 'ACTIVE' | 'REMOVED';
  invitedAt: Date;
  acceptedAt: Date | null;
  /** Token em claro só existe no momento da criação do convite. */
  pendingInvite: boolean;
}

export async function listSponsorTeam(tenantId: string, sponsorId: string): Promise<SponsorTeamRow[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.sponsorUser.findMany({
      where: { tenantId, sponsorId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        userId: true,
        invitedEmail: true,
        status: true,
        createdAt: true,
        acceptedAt: true,
        inviteTokenHash: true,
        user: { select: { name: true, email: true } },
      },
    });

    return rows.map((row) => ({
      linkId: row.id,
      userId: row.userId,
      name: row.user?.name ?? null,
      email: row.user?.email ?? row.invitedEmail,
      status: row.status,
      invitedAt: row.createdAt,
      acceptedAt: row.acceptedAt,
      pendingInvite: row.status === 'INVITED' && row.inviteTokenHash !== null,
    }));
  });
}

/**
 * Emite (ou reemite) o convite — e devolve o token UMA vez.
 *
 * Regerar invalida o anterior, como no portal do palestrante: dois convites válidos
 * para o mesmo endereço seriam dois caminhos de entrada que ninguém consegue
 * revogar em conjunto.
 */
export async function inviteSponsorUser(input: {
  tenantId: string;
  actorId: string;
  sponsorId: string;
  email: string;
  now?: Date;
}): Promise<SponsorPortalResult<{ linkId: string; token: string; expiresAt: Date; email: string }>> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const sponsor = await tx.sponsor.findFirst({
        where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, name: true },
      });

      if (!sponsor) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
      }

      const existing = await tx.sponsorUser.findFirst({
        where: { tenantId: input.tenantId, sponsorId: sponsor.id, invitedEmail: email },
        select: { id: true, status: true, userId: true },
      });

      if (existing?.status === 'ACTIVE' && existing.userId) {
        return {
          ok: false as const,
          code: 'ALREADY_LINKED' as const,
          message: 'Esta pessoa já tem acesso a este patrocinador.',
        };
      }

      const token = newInviteToken();
      const expiresAt = inviteExpiryFrom(now);
      const data = {
        invitedEmail: email,
        inviteTokenHash: hashInviteToken(token),
        inviteExpiresAt: expiresAt,
        status: 'INVITED' as const,
        invitedById: input.actorId,
        userId: null,
        acceptedAt: null,
        deletedAt: null,
      };

      if (existing) {
        await tx.sponsorUser.update({ where: { id: existing.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'sponsorUser',
            entityId: existing.id,
            changes: {
              inviteTokenHash: { from: 'anterior (invalidado)', to: 'novo' },
              invitedEmail: { from: null, to: email },
            },
          },
          tx,
        );

        return { ok: true as const, linkId: existing.id, token, expiresAt, email };
      }

      const linkId = randomUUID();

      await tx.sponsorUser.create({
        data: { id: linkId, tenantId: input.tenantId, sponsorId: sponsor.id, ...data },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'sponsorUser',
          entityId: linkId,
          changes: { invitedEmail: { from: null, to: email } },
        },
        tx,
      );

      return { ok: true as const, linkId, token, expiresAt, email };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false as const,
        code: 'ALREADY_LINKED' as const,
        message: 'Já existe um convite ou vínculo para este endereço neste patrocinador.',
      };
    }

    return toFailure('inviteSponsorUser', error, 'Não foi possível gerar o convite.');
  }
}

/**
 * Vincula direto quem JÁ tem conta — o caminho da equipe.
 *
 * Sem conta não há vínculo: o que o convite acrescenta é a prova de posse do
 * endereço, e quem é vinculado à mão já está autenticado com aquele e-mail. Por
 * isso aqui a busca é pelo e-mail da CONTA, e não pelo endereço digitado.
 */
export async function linkSponsorUserByEmail(input: {
  tenantId: string;
  actorId: string;
  sponsorId: string;
  email: string;
}): Promise<SponsorPortalResult<{ linkId: string; userId: string; name: string }>> {
  const email = input.email.trim().toLowerCase();

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const sponsor = await tx.sponsor.findFirst({
        where: { id: input.sponsorId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true },
      });

      if (!sponsor) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Patrocinador não encontrado.' };
      }

      /**
       * A conta é GLOBAL (a RLS não protege `user`) — por isso a leitura confere o
       * vínculo da pessoa com ESTA instituição: alguém de fora não é vinculável.
       * `memberships` é a tabela `user_tenant_profiles`.
       */
      const account = await tx.user.findFirst({
        where: { email },
        select: {
          id: true,
          name: true,
          email: true,
          memberships: {
            where: { tenantId: input.tenantId, deletedAt: null },
            select: { id: true, status: true },
          },
        },
      });

      if (!account) {
        return {
          ok: false as const,
          code: 'NO_ACCOUNT' as const,
          message: 'Não há conta com este e-mail. Use o convite para chamar a pessoa.',
        };
      }

      if (account.memberships.length === 0) {
        return {
          ok: false as const,
          code: 'NO_ACCOUNT' as const,
          message: 'Esta conta não tem vínculo com a instituição.',
        };
      }

      const existing = await tx.sponsorUser.findFirst({
        where: { tenantId: input.tenantId, sponsorId: sponsor.id, userId: account.id },
        select: { id: true, status: true },
      });

      const linkId = existing?.id ?? randomUUID();

      if (existing) {
        await tx.sponsorUser.update({
          where: { id: linkId },
          data: { status: 'ACTIVE', acceptedAt: new Date(), deletedAt: null, inviteTokenHash: null },
        });
      } else {
        await tx.sponsorUser.create({
          data: {
            id: linkId,
            tenantId: input.tenantId,
            sponsorId: sponsor.id,
            userId: account.id,
            invitedEmail: email,
            status: 'ACTIVE',
            invitedById: input.actorId,
            acceptedAt: new Date(),
          },
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: existing ? 'UPDATE' : 'CREATE',
          entityType: 'sponsorUser',
          entityId: linkId,
          changes: { invitedEmail: { from: null, to: email }, status: { from: null, to: 'ACTIVE' } },
        },
        tx,
      );

      return { ok: true as const, linkId, userId: account.id, name: account.name };
    }).then(async (result) => {
      /**
       * O PAPEL É CONCEDIDO DEPOIS DO COMMIT (armadilha 97).
       *
       * Ele já foi concedido no convite, e conceder de novo viola o índice único
       * parcial de concessão vigente. Um erro de escrita dentro da transação a
       * ABORTA, o `COMMIT` do PostgreSQL vira `ROLLBACK` **sem erro** e o serviço
       * responde `ok` com o vínculo perdido — que foi exatamente o defeito que este
       * teste pegou.
       *
       * Além disso, o papel é DERIVADO do vínculo: a porta da área é o vínculo, e a
       * concessão é catálogo. Falhar aqui não pode derrubar o acesso.
       */
      if (result.ok) await ensureSponsorRole({ tenantId: input.tenantId, userId: result.userId });
      return result;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false as const,
        code: 'ALREADY_LINKED' as const,
        message: 'Esta pessoa já tem acesso a este patrocinador.',
      };
    }

    return toFailure('linkSponsorUserByEmail', error, 'Não foi possível vincular a pessoa.');
  }
}

/** Aceite do convite: token E e-mail da conta, como no portal do palestrante. */
export async function acceptSponsorInvite(input: {
  tenantId: string;
  userId: string;
  userEmail: string | null;
  token: string;
  now?: Date;
}): Promise<SponsorPortalResult<{ sponsorId: string; sponsorName: string }>> {
  const now = input.now ?? new Date();

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const normalized = normalizeInviteToken(input.token);

      const invite = await tx.sponsorUser.findFirst({
        where: { tenantId: input.tenantId, inviteTokenHash: hashInviteToken(normalized) },
        select: {
          id: true,
          sponsorId: true,
          invitedEmail: true,
          inviteTokenHash: true,
          inviteExpiresAt: true,
          userId: true,
          deletedAt: true,
          invitedById: true,
          sponsor: { select: { name: true, deletedAt: true } },
        },
      });

      const verdict = evaluateSponsorInviteClaim({
        invite: invite
          ? {
              invitedEmail: invite.invitedEmail,
              inviteTokenHash: invite.deletedAt ? null : invite.inviteTokenHash,
              inviteExpiresAt: invite.inviteExpiresAt,
              userId: invite.userId,
            }
          : null,
        token: normalized,
        userEmail: input.userEmail,
        now,
      });

      if (!verdict.ok) {
        return { ok: false as const, code: 'INVITE_INVALID' as const, message: verdict.message };
      }

      if (!invite || invite.sponsor.deletedAt) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Convite não encontrado.' };
      }

      /**
       * ─── O VÍNCULO COM A INSTITUIÇÃO NASCE DO ACEITE ────────────────────────────
       *
       *  Quem recebe o convite é, muitas vezes, o contato COMERCIAL da empresa — que
       *  pode não ter vínculo nenhum com a instituição ainda. Exigir vínculo para
       *  aceitar criaria o impasse que a FASE 25 resolveu no portal do palestrante:
       *  sem vínculo não se aceita, e sem aceitar não há vínculo.
       *
       *  Nasce como `PARTICIPANT`: patrocinador não é equipe e não pode consumir a
       *  quota de membros do plano (mesma régua da inscrição pública e do convite de
       *  palestrante).
       */
      await tx.userTenantProfile.upsert({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        create: {
          tenantId: input.tenantId,
          userId: input.userId,
          status: 'ACTIVE',
          kind: 'PARTICIPANT',
          joinedAt: now,
          invitedAt: now,
          invitedById: invite.invitedById,
        },
        update: { status: 'ACTIVE', deletedAt: null, joinedAt: now },
        select: { id: true },
      });

      await tx.sponsorUser.update({
        where: { id: invite.id },
        data: {
          userId: input.userId,
          status: 'ACTIVE',
          acceptedAt: now,
          inviteTokenHash: null,
          inviteExpiresAt: null,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'sponsorUser',
          entityId: invite.id,
          changes: { status: { from: 'INVITED', to: 'ACTIVE' } },
        },
        tx,
      );

      return { ok: true as const, sponsorId: invite.sponsorId, sponsorName: invite.sponsor.name };
    }).then(async (result) => {
      /** O papel vem depois do commit — ver a nota em `linkSponsorUserByEmail`. */
      if (result.ok) await ensureSponsorRole({ tenantId: input.tenantId, userId: input.userId });
      return result;
    });
  } catch (error) {
    return toFailure('acceptSponsorInvite', error, 'Não foi possível aceitar o convite.');
  }
}

export async function removeSponsorUser(input: {
  tenantId: string;
  actorId: string;
  linkId: string;
}): Promise<SponsorPortalResult<Record<never, never>>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const link = await tx.sponsorUser.findFirst({
        where: { id: input.linkId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, userId: true, status: true, sponsorId: true },
      });

      if (!link) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Vínculo não encontrado.' };
      }

      await tx.sponsorUser.update({
        where: { id: link.id },
        data: { status: 'REMOVED', userId: null, deletedAt: new Date(), inviteTokenHash: null },
      });

      /**
       * O papel `SPONSOR` só é revogado quando a pessoa não é mais de NENHUM
       * patrocinador: revogar a cada remoção tiraria o acesso dela ao outro
       * patrocinador da mesma instituição.
       */
      if (link.userId) {
        const remaining = await tx.sponsorUser.count({
          where: {
            tenantId: input.tenantId,
            userId: link.userId,
            status: 'ACTIVE',
            deletedAt: null,
            id: { not: link.id },
          },
        });

        if (remaining === 0) {
          await tx.roleAssignment.updateMany({
            where: {
              tenantId: input.tenantId,
              userId: link.userId,
              role: 'SPONSOR',
              revokedAt: null,
            },
            data: { revokedAt: new Date() },
          });
        }
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'sponsorUser',
          entityId: link.id,
          changes: { status: { from: link.status, to: 'REMOVED' } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    return toFailure('removeSponsorUser', error, 'Não foi possível remover o vínculo.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  A LEITURA do QR (o fato: crédito + consentimento)
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorScanOutcome {
  sponsorName: string;
  eventTitle: string;
  xpAwarded: number;
  cardName: string | null;
  /** A pessoa já havia lido este QR: nada foi creditado de novo. */
  repeated: boolean;
  /** O contato foi compartilhado nesta leitura? */
  shared: boolean;
  consentDays: number;
  consentText: string;
}

export async function scanSponsorQr(input: {
  tenantId: string;
  code: string;
  userId: string;
  consent: boolean;
  now?: Date;
}): Promise<SponsorPortalResult<{ outcome: SponsorScanOutcome }>> {
  const now = input.now ?? new Date();
  const code = input.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const bare = code.replace(/^PT/, '');

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const qr = await tx.sponsorQrCode.findFirst({
        where: { tenantId: input.tenantId, code: bare },
        select: {
          id: true,
          code: true,
          label: true,
          xpAmount: true,
          consentDays: true,
          cardTemplateId: true,
          isActive: true,
          deletedAt: true,
          sponsor: { select: { id: true, name: true, deletedAt: true } },
          event: { select: { id: true, title: true } },
          cardTemplate: { select: { name: true } },
        },
      });

      if (!qr || qr.deletedAt || qr.sponsor.deletedAt) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'QR não encontrado.' };
      }

      if (!qr.isActive) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'Este QR está desativado pela organização.',
        };
      }

      const existing = await tx.sponsorScan.findUnique({
        where: { qrCodeId_userId: { qrCodeId: qr.id, userId: input.userId } },
        select: { id: true, consentedAt: true },
      });

      const verdict = creditForScan(existing);
      let xpAwarded = 0;

      if (verdict.credits) {
        if (qr.xpAmount > 0) {
          /**
           * A chave do fato é o PAR (QR, pessoa) — o mesmo par do índice único da
           * leitura. Duas leituras simultâneas chegam ao motor com a MESMA chave, e
           * ele credita uma vez.
           */
          const awarded = await awardForEvent({
            tenantId: input.tenantId,
            userId: input.userId,
            source: 'SPONSOR_QR',
            amount: qr.xpAmount,
            idempotencyKey: `sponsor-scan:${qr.id}:${input.userId}`,
            eventId: qr.event.id,
            reason: `Visita a ${qr.sponsor.name}`,
            occurredAt: now,
          });

          if (awarded.ok) xpAwarded = awarded.duplicate ? 0 : awarded.xpAwarded;
        }

        if (qr.cardTemplateId) {
          /**
           * O cartão sai só na PRIMEIRA leitura (o motor não recebe chave de fato do
           * chamador): a trava é `verdict.credits`. Falha aqui não desfaz o crédito
           * de XP nem a leitura — a recompensa nunca derruba o fluxo (invariante 8).
           */
          await grantCardForTrigger({
            tenantId: input.tenantId,
            userId: input.userId,
            trigger: 'SPONSOR_QR',
            templateId: qr.cardTemplateId,
            eventId: qr.event.id,
            sourceRef: `sponsor-scan:${qr.id}`,
            actorId: null,
            now,
          });
        }
      }

      const profile = await tx.user.findUnique({
        where: { id: input.userId },
        select: { name: true, email: true },
      });

      const consentText = sponsorConsentText({
        sponsorName: qr.sponsor.name,
        eventTitle: qr.event.title,
        days: qr.consentDays || DEFAULT_CONSENT_DAYS,
      });

      const share = input.consent
        ? buildLeadShare({
            name: profile?.name ?? 'Participante',
            email: profile?.email ?? '',
          })
        : null;

      /**
       * A leitura é gravada SEMPRE (é ela que credita e que conta a visita); o
       * consentimento é o que pode faltar. `upsert` cobre a releitura, e o
       * consentimento dado depois ATUALIZA a mesma linha — a visita é uma só.
       */
      const scanId = existing?.id ?? randomUUID();

      /**
       * ─── A LEITURA É ESCRITA CONDICIONAL, NÃO `upsert` COM `catch` ─────────────
       *
       *  A versão anterior usava `upsert` dentro de um `try/catch` de violação única
       *  para cobrir dois toques simultâneos. Em PostgreSQL isso é uma armadilha:
       *  QUALQUER erro aborta a transação, e o `catch` não a ressuscita — o `COMMIT`
       *  vira `ROLLBACK` sem erro e o consentimento se perde em silêncio
       *  (armadilha 97). Aqui a escolha é explícita: quem chegou primeiro cria, quem
       *  chegou depois ATUALIZA (a releitura é o caso comum). Uma corrida de verdade
       *  falha com erro visível, e a pessoa tenta de novo — melhor que perder o
       *  registro sem avisar.
       */
      if (existing) {
        if (share) {
          await tx.sponsorScan.update({
            where: { id: scanId },
            data: {
              consentedAt: now,
              expiresAt: consentExpiryFrom(now, qr.consentDays || DEFAULT_CONSENT_DAYS),
              revokedAt: null,
              consentText,
              consentVersion: 'v1',
              sharedName: share.sharedName,
              sharedEmail: share.sharedEmail,
            },
          });
        }
      } else {
        await tx.sponsorScan.create({
          data: {
            id: scanId,
            tenantId: input.tenantId,
            qrCodeId: qr.id,
            sponsorId: qr.sponsor.id,
            eventId: qr.event.id,
            userId: input.userId,
            xpAwarded,
            cardTemplateId: qr.cardTemplateId,
            ...(share
              ? {
                  consentedAt: now,
                  expiresAt: consentExpiryFrom(now, qr.consentDays || DEFAULT_CONSENT_DAYS),
                  revokedAt: null,
                  consentText,
                  consentVersion: 'v1',
                  sharedName: share.sharedName,
                  sharedEmail: share.sharedEmail,
                }
              : {}),
          },
        });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'CREATE',
          entityType: 'sponsorScan',
          entityId: scanId,
          changes: {
            qr: { from: null, to: formatSponsorQrCode(qr.code ?? bare) },
            creditado: { from: null, to: xpAwarded },
            compartilhou: { from: null, to: share ? 'sim' : 'não' },
          },
        },
        tx,
      );

      return {
        ok: true as const,
        outcome: {
          sponsorName: qr.sponsor.name,
          eventTitle: qr.event.title,
          xpAwarded,
          cardName: qr.cardTemplate?.name ?? null,
          repeated: verdict.repeated,
          shared: share !== null,
          consentDays: qr.consentDays || DEFAULT_CONSENT_DAYS,
          consentText,
        },
      };
    });
  } catch (error) {
    return toFailure('scanSponsorQr', error, 'Não foi possível registrar a visita.');
  }
}

/** O participante revoga o que autorizou. */
export async function revokeSponsorConsent(input: {
  tenantId: string;
  userId: string;
  scanId: string;
  now?: Date;
}): Promise<SponsorPortalResult<Record<never, never>>> {
  const now = input.now ?? new Date();

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const scan = await tx.sponsorScan.findFirst({
        where: { id: input.scanId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true, revokedAt: true, consentedAt: true },
      });

      if (!scan) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Registro não encontrado.' };
      }

      /**
       * Revogar duas vezes é a mesma coisa que revogar uma: o carimbo é o PRIMEIRO.
       * Sobrescrever a data apagaria quando a pessoa pediu para sair.
       */
      if (!scan.revokedAt) {
        await tx.sponsorScan.update({ where: { id: scan.id }, data: { revokedAt: now } });
      }

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.userId,
          action: 'UPDATE',
          entityType: 'sponsorScan',
          entityId: scan.id,
          changes: { compartilhamento: { from: 'autorizado', to: 'revogado' } },
        },
        tx,
      );

      return { ok: true as const };
    });
  } catch (error) {
    return toFailure('revokeSponsorConsent', error, 'Não foi possível revogar a autorização.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O que o PARTICIPANTE compartilhou (a tela dele)
// ───────────────────────────────────────────────────────────────────────────────
export interface MySponsorShare {
  scanId: string;
  sponsorName: string;
  eventTitle: string;
  qrLabel: string;
  sharedName: string;
  sharedEmail: string;
  consentedAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  state: LeadAccessState;
  stateLabel: string;
}

export async function listMySponsorShares(
  tenantId: string,
  userId: string,
  now = new Date(),
): Promise<MySponsorShare[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.sponsorScan.findMany({
      where: { tenantId, userId, consentedAt: { not: null } },
      orderBy: { consentedAt: 'desc' },
      select: {
        id: true,
        sharedName: true,
        sharedEmail: true,
        consentedAt: true,
        expiresAt: true,
        revokedAt: true,
        sponsor: { select: { name: true } },
        event: { select: { title: true } },
        qrCode: { select: { label: true } },
      },
    });

    return rows.map((row) => {
      const state = evaluateLeadAccess({
        consentedAt: row.consentedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        now,
      });

      return {
        scanId: row.id,
        sponsorName: row.sponsor.name,
        eventTitle: row.event.title,
        qrLabel: row.qrCode.label,
        sharedName: row.sharedName ?? '',
        sharedEmail: row.sharedEmail ?? '',
        consentedAt: row.consentedAt!,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        state,
        stateLabel: LEAD_ACCESS_LABELS[state],
      };
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leituras do painel e da página pública de leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface SponsorQrPanelRow {
  id: string;
  sponsorId: string;
  code: string;
  formattedCode: string;
  label: string;
  eventId: string;
  eventTitle: string;
  xpAmount: number;
  cardTemplateId: string | null;
  cardName: string | null;
  consentDays: number;
  isActive: boolean;
  visits: number;
  leads: number;
}

/** Os QRs de um patrocinador, com visita e contato contados (painel da organização). */
export async function listSponsorQrCodes(
  tenantId: string,
  sponsorId: string,
  now = new Date(),
): Promise<SponsorQrPanelRow[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.sponsorQrCode.findMany({
      where: { tenantId, sponsorId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sponsorId: true,
        code: true,
        label: true,
        eventId: true,
        xpAmount: true,
        cardTemplateId: true,
        consentDays: true,
        isActive: true,
        event: { select: { title: true } },
        cardTemplate: { select: { name: true } },
        scans: { select: { consentedAt: true, expiresAt: true, revokedAt: true } },
      },
    });

    return rows.map((qr) => ({
      id: qr.id,
      sponsorId: qr.sponsorId,
      code: qr.code,
      formattedCode: formatSponsorQrCode(qr.code),
      label: qr.label,
      eventId: qr.eventId,
      eventTitle: qr.event.title,
      xpAmount: qr.xpAmount,
      cardTemplateId: qr.cardTemplateId,
      cardName: qr.cardTemplate?.name ?? null,
      consentDays: qr.consentDays,
      isActive: qr.isActive,
      visits: qr.scans.length,
      leads: qr.scans.filter(
        (scan) =>
          evaluateLeadAccess({
            consentedAt: scan.consentedAt,
            expiresAt: scan.expiresAt,
            revokedAt: scan.revokedAt,
            now,
          }) === 'ACTIVE',
      ).length,
    }));
  });
}

export interface SponsorQrDownload {
  qrId: string;
  sponsorId: string;
  sponsorName: string;
  code: string;
  label: string;
  eventTitle: string;
  isActive: boolean;
}

/**
 * O QR que vai virar ARQUIVO (PNG/SVG para imprimir), com o patrocinador dono.
 *
 * ─── POR QUE ESTA LEITURA EXISTE, E POR QUE ELA DEVOLVE O DONO ───────────────
 *
 *  Quem baixa o QR é a organização OU o patrocinador — e o patrocinador só pode
 *  baixar o DELE. A rota de download precisa saber a quem o QR pertence ANTES de
 *  decidir, então a leitura devolve `sponsorId`; decidir pelo que veio na URL seria
 *  deixar o `qrId` escolher o dono.
 *
 *  Lê também o QR DESATIVADO: desativar é parar de creditar, não perder a arte. A
 *  tela diz que ele está desativado — o arquivo continua sendo da organização.
 */
export async function getSponsorQrForDownload(
  tenantId: string,
  qrId: string,
): Promise<SponsorPortalResult<SponsorQrDownload>> {
  try {
    return await withTenant(tenantId, async (tx) => {
      const qr = await tx.sponsorQrCode.findFirst({
        where: { id: qrId, tenantId, deletedAt: null },
        select: {
          id: true,
          sponsorId: true,
          code: true,
          label: true,
          isActive: true,
          sponsor: { select: { name: true } },
          event: { select: { title: true } },
        },
      });

      if (!qr) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'QR não encontrado.',
        };
      }

      return {
        ok: true as const,
        qrId: qr.id,
        sponsorId: qr.sponsorId,
        sponsorName: qr.sponsor.name,
        code: qr.code,
        label: qr.label,
        eventTitle: qr.event.title,
        isActive: qr.isActive,
      };
    });
  } catch (error) {
    return toFailure('getSponsorQrForDownload', error, 'Não foi possível ler o QR do patrocinador.');
  }
}

/** Os contatos VIGENTES de um patrocinador (painel e exportação). */
export async function listSponsorLeads(
  tenantId: string,
  sponsorId: string,
  now = new Date(),
): Promise<SponsorPortalLead[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.sponsorScan.findMany({
      where: { tenantId, sponsorId, consentedAt: { not: null } },
      orderBy: { consentedAt: 'desc' },
      select: {
        id: true,
        sharedName: true,
        sharedEmail: true,
        consentedAt: true,
        expiresAt: true,
        revokedAt: true,
        event: { select: { title: true } },
        qrCode: { select: { label: true } },
      },
    });

    const leads: SponsorPortalLead[] = [];

    for (const row of rows) {
      const state = evaluateLeadAccess({
        consentedAt: row.consentedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        now,
      });

      if (state !== 'ACTIVE' || !row.sharedName || !row.sharedEmail) continue;

      leads.push({
        scanId: row.id,
        sharedName: row.sharedName,
        sharedEmail: row.sharedEmail,
        consentedAt: row.consentedAt!,
        expiresAt: row.expiresAt,
        state,
        stateLabel: LEAD_ACCESS_LABELS[state],
        eventTitle: row.event.title,
        qrLabel: row.qrCode.label,
      });
    }

    return leads;
  });
}

export interface PublicSponsorQr {
  code: string;
  formattedCode: string;
  label: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  sponsorWebsiteUrl: string | null;
  eventTitle: string;
  xpAmount: number;
  cardName: string | null;
  consentDays: number;
  consentText: string;
  /** A pessoa já registrou esta visita? (a tela diz em vez de prometer de novo) */
  alreadyScanned: boolean;
}

/**
 * O que a PÁGINA PÚBLICA precisa saber antes de a pessoa decidir.
 *
 * Não devolve contato nem dado de quem já leu — só o que o estande anuncia: quem
 * patrocina, o que a visita vale e por quantos dias a autorização vale.
 */
export async function getPublicSponsorQr(input: {
  tenantId: string;
  code: string;
  userId?: string | null;
}): Promise<PublicSponsorQr | null> {
  const bare = normalizeSponsorQrCode(input.code);

  if (!isValidSponsorQrCode(bare)) return null;

  return withTenant(input.tenantId, async (tx) => {
    const qr = await tx.sponsorQrCode.findFirst({
      where: { tenantId: input.tenantId, code: bare, deletedAt: null },
      select: {
        id: true,
        code: true,
        label: true,
        xpAmount: true,
        consentDays: true,
        isActive: true,
        sponsor: { select: { name: true, logoUrl: true, websiteUrl: true, deletedAt: true } },
        event: { select: { title: true } },
        cardTemplate: { select: { name: true } },
      },
    });

    if (!qr || !qr.isActive || qr.sponsor.deletedAt) return null;

    const alreadyScanned = input.userId
      ? (await tx.sponsorScan.findUnique({
          where: { qrCodeId_userId: { qrCodeId: qr.id, userId: input.userId } },
          select: { id: true, revokedAt: true },
        })) !== null
      : false;

    return {
      code: qr.code,
      formattedCode: formatSponsorQrCode(qr.code),
      label: qr.label,
      sponsorName: qr.sponsor.name,
      sponsorLogoUrl: qr.sponsor.logoUrl,
      sponsorWebsiteUrl: qr.sponsor.websiteUrl,
      eventTitle: qr.event.title,
      xpAmount: qr.xpAmount,
      cardName: qr.cardTemplate?.name ?? null,
      consentDays: qr.consentDays || DEFAULT_CONSENT_DAYS,
      consentText: sponsorConsentText({
        sponsorName: qr.sponsor.name,
        eventTitle: qr.event.title,
        days: qr.consentDays || DEFAULT_CONSENT_DAYS,
      }),
      alreadyScanned,
    };
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Concede o papel `SPONSOR` no escopo da instituição — FORA da transação do vínculo.
 *
 * ─── POR QUE FORA DA TRANSAÇÃO (armadilha 97) ─────────────────────────────────
 *  Um erro de ESCRITA dentro de uma transação do PostgreSQL a ABORTA. A partir daí,
 *  todo comando seguinte falha com `25P02` — e, como `recordAudit` engole erro por
 *  projeto (auditoria nunca derruba o fluxo), o `COMMIT` do PostgreSQL vira
 *  `ROLLBACK` **sem erro nenhum**: o serviço responde `ok` e o dado não existe.
 *
 *  Aqui o caso era banal: a pessoa já tinha o papel (do convite aceito antes), e
 *  conceder de novo violava o índice único parcial de concessão vigente. O vínculo
 *  manual se perdia em silêncio.
 *
 *  Duas defesas, então: (1) a concessão é conferida ANTES de inserir; (2) ela roda
 *  na própria transação, depois do commit do vínculo. O vínculo é o FATO (é ele que
 *  abre a área do patrocinador); o papel é catálogo — se falhar, o acesso continua
 *  e o erro fica registrado para o operador.
 *
 * Escopo `TENANT` (e não EVENTO): o patrocinador pode apoiar mais de um evento da
 * mesma instituição, e o papel só abre as leituras do catálogo (`sponsor:read`).
 * QUEM ele enxerga é decidido pelo vínculo, não pelo papel.
 */
async function ensureSponsorRole(input: { tenantId: string; userId: string }): Promise<void> {
  try {
    await withTenant(input.tenantId, async (tx) => {
      const live = await tx.roleAssignment.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: 'SPONSOR',
          scope: 'TENANT',
          revokedAt: null,
        },
        select: { id: true },
      });

      if (live) return;

      await tx.roleAssignment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: 'SPONSOR',
          scope: 'TENANT',
          reason: 'Acesso à área do patrocinador (FASE 42)',
        },
      });
    });
  } catch (error) {
    console.error(
      `[sponsor-portal] falha ao conceder o papel SPONSOR: ${errorMessage(error)} — ` +
        'o vínculo permanece e a área do patrocinador continua acessível por ele.',
    );
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function contractStateLabel(start: Date | null, end: Date | null, now: Date): string {
  if (!start && !end) return 'Sem vigência informada';
  if (start && now.getTime() < start.getTime()) return 'A iniciar';
  if (end && now.getTime() > end.getTime()) return 'Encerrado';
  return 'Vigente';
}

function toFailure(
  operation: string,
  error: unknown,
  message: string,
): { ok: false; code: SponsorPortalErrorCode; message: string } {
  console.error(`[sponsor-portal] ${operation}: ${errorMessage(error)}`);
  return { ok: false, code: 'INTERNAL', message };
}
