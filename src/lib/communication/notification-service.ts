/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NOTIFICAÇÕES — os gatilhos que avisam alguém de um fato já consumado
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DESTE ARQUIVO: NENHUMA FUNÇÃO LANÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada função aqui é chamada no MEIO de outro fluxo — depois de atribuir uma
 *  avaliação, conceder uma carta, emitir um certificado. Nenhum desses fluxos pode
 *  falhar porque o provedor de e-mail está fora: o fato acadêmico já aconteceu e
 *  está gravado. Por isso:
 *
 *    • todas devolvem `Promise<void>` e engolem o erro em `logger.warn`;
 *    • todas carregam o que precisam e montam o payload JÁ FORMATADO (data no fuso
 *      do evento, rótulos em português), porque o renderizador não decide nada;
 *    • todas usam `dedupeKey` quando o fato pode ser reavaliado — o mesmo
 *      acontecimento não vira duas mensagens.
 *
 *  Efeito colateral aceito e desejado: existe um caminho em que o fato acontece e o
 *  aviso não sai (provedor fora do ar, `FAILED` no outbox). O outbox mostra
 *  exatamente isso, e o botão "tentar de novo" resolve. O contrário — bloquear a
 *  atribuição de uma avaliação por causa de e-mail — seria pior.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import type { CardRarity } from '@/domain/gamification/types';import { queueEmail } from './email-service';
import { tenantUrl } from './links';

/** Plano B quando o fuso do evento não está disponível (não deveria acontecer). */
const FALLBACK_TIMEZONE = 'America/Sao_Paulo';

async function tolerate(scope: string, tenantId: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    // Nunca propaga: comunicação é consequência do fato, não pré-requisito dele.
    logger.warn(`notificação não enviada (${scope})`, {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  D3 — avaliação atribuída
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Avisa o revisor de que um trabalho foi atribuído a ele.
 *
 * Chamada DEPOIS do commit da atribuição (armadilha 41): a função abre a própria
 * transação, e chamá-la de dentro de outra faria a leitura não enxergar o que ainda
 * não foi confirmado.
 */
export async function notifyReviewAssigned(input: {
  tenantId: string;
  assignmentId: string;
  actorId?: string | null;
}): Promise<void> {
  await tolerate('review-assigned', input.tenantId, async () => {
    const data = await withTenant(input.tenantId, async (tx) =>
      tx.reviewAssignment.findFirst({
        where: { id: input.assignmentId },
        select: {
          id: true,
          isBlind: true,
          dueAt: true,
          reviewer: { select: { id: true, name: true, email: true } },
          submission: {
            select: {
              id: true,
              title: true,
              track: { select: { name: true, event: { select: { timezone: true } } } },
            },
          },
          tenant: { select: { name: true, slug: true } },
        },
      }),
    );

    if (!data) return;

    const timezone = data.submission.track?.event?.timezone ?? FALLBACK_TIMEZONE;

    await queueEmail({
      tenantId: input.tenantId,
      to: data.reviewer.email,
      toUserId: data.reviewer.id,
      template: 'REVIEW_ASSIGNED',
      brandName: data.tenant.name,
      createdById: input.actorId ?? null,
      /**
       * O par (atribuição × revisor) é o fato: reatribuir a MESMA pessoa depois de
       * um decline precisa gerar aviso novo, e é por isso que o id do VÍNCULO entra
       * na chave — não o par submissão/revisor (que tem índice único e seria
       * reutilizado).
       */
      dedupeKey: `review-assigned:${data.id}`,
      payload: {
        reviewerName: data.reviewer.name,
        submissionTitle: data.submission.title,
        trackName: data.submission.track?.name ?? null,
        dueAtLabel: data.dueAt ? formatZonedDateTime(data.dueAt, timezone) : null,
        isBlind: data.isBlind,
        reviewUrl: tenantUrl(data.tenant.slug, `/revisoes/${data.submission.id}`),
      },
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  D5 — carta conquistada
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Celebra a carta nova. O `dedupeKey` é o par (pessoa × evento × gatilho): a
 * conquista é idempotente por desenho, e o aviso também precisa ser — uma segunda
 * avaliação da mesma conquista não pode virar segunda mensagem.
 */
export async function notifyCardGranted(input: {
  tenantId: string;
  userId: string;
  cardName: string;
  rarity: string;
  triggerLabel: string;
  eventId?: string | null;
  actorId?: string | null;
}): Promise<void> {
  await tolerate('card-granted', input.tenantId, async () => {
    const data = await withTenant(input.tenantId, async (tx) =>
      tx.user.findFirst({
        where: { id: input.userId },
        select: {
          id: true,
          name: true,
          email: true,
          memberships: {
            where: { tenantId: input.tenantId },
            select: { tenant: { select: { name: true, slug: true } } },
            take: 1,
          },
        },
      }),
    );

    if (!data) return;

    const membership = data.memberships[0];
    const slug = membership?.tenant.slug;

    await queueEmail({
      tenantId: input.tenantId,
      to: data.email,
      toUserId: data.id,
      template: 'CARD_GRANTED',
      brandName: membership?.tenant.name ?? 'EventFlow',
      createdById: input.actorId ?? null,
      dedupeKey: `card-granted:${input.tenantId}:${input.userId}:${input.eventId ?? 'global'}:${input.cardName}`,
      payload: {
        recipientName: data.name,
        cardName: input.cardName,
        rarityLabel: RARITY_LABELS[input.rarity as CardRarity] ?? input.rarity,
        reasonLabel: input.triggerLabel,
        albumUrl: slug ? tenantUrl(slug, '/cartas') : `${process.env.APP_URL ?? ''}/`,
      },
    });
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  D6 — certificado emitido
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Avisa que o certificado está pronto.
 *
 * O aviso é por CERTIFICADO (não por evento): quem tem certificado de participante
 * e de palestrante no mesmo evento recebe duas mensagens distintas, uma para cada
 * documento — e o `dedupeKey` pelo id do certificado garante que reemitir o mesmo
 * documento não gera uma terceira.
 */
export async function notifyCertificateIssued(input: {
  tenantId: string;
  certificateId: string;
  actorId?: string | null;
}): Promise<void> {
  await tolerate('certificate-issued', input.tenantId, async () => {
    const data = await withTenant(input.tenantId, async (tx) =>
      tx.certificate.findFirst({
        where: { id: input.certificateId },
        select: {
          id: true,
          title: true,
          recipientName: true,
          validationCode: true,
          workloadMinutes: true,
          userId: true,
          event: { select: { title: true, timezone: true } },
          tenant: { select: { name: true, slug: true } },
          user: { select: { name: true, email: true } },
        },
      }),
    );

    if (!data) return;

    await queueEmail({
      tenantId: input.tenantId,
      to: data.user.email,
      toUserId: data.userId,
      template: 'CERTIFICATE_ISSUED',
      brandName: data.tenant.name,
      createdById: input.actorId ?? null,
      dedupeKey: `certificate-issued:${data.id}`,
      payload: {
        recipientName: data.user.name,
        certificateTitle: data.title,
        eventTitle: data.event.title,
        workloadLabel: workloadLabel(data.workloadMinutes),
        validationCode: data.validationCode,
        certificateUrl: tenantUrl(data.tenant.slug, '/certificados'),
        validationUrl: `${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '')}/validar/${data.validationCode}`,
      },
    });
  });
}

/** "8h", "1h30", "45min" — o mesmo rótulo usado no certificado. */
function workloadLabel(minutes: number): string | null {
  if (!minutes || minutes <= 0) return null;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}min`;
  if (rest === 0) return `${hours}h`;

  return `${hours}h${String(rest).padStart(2, '0')}`;
}
