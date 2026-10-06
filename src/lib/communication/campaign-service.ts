/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Campanha segmentada: criar e disparar (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DISPARO NÃO ABRE UM SEGUNDO CAMINHO DE E-MAIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada destinatário vira UMA linha no outbox da FASE 15, pelo MESMO
 *  `queueEmail` que o convite, o aviso de prazo e o recado usam. Não há fila
 *  paralela, nem driver paralelo, nem contador paralelo — o que muda é só a
 *  origem do fato ("esta campanha, para esta pessoa").
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O REENVIO É CAMINHO DE OPERAÇÃO, E A CHAVE DO FATO O TORNA SEGURO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma passada pode parar antes do fim: o limite de ritmo (F13) existe para o
 *  provedor não responder 429 a uma campanha de mil pessoas. Então o disparo é
 *  desenhado para rodar VÁRIAS vezes — e o que impede a segunda passada de mandar
 *  a mesma mensagem de novo é o `dedupeKey` da campanha + destinatário, com
 *  índice único em `email_messages` (FASE 15). Quem já entrou no outbox volta como
 *  `duplicate`, e a contagem da campanha não muda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A EXCLUSÃO MÚTUA É DO BANCO, E TEM PRAZO DE VALIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O estado `SENDING` é tomado por um `UPDATE` CONDICIONAL: dois cliques ao mesmo
 *  tempo e só um passa (o perdedor recebe zero linhas e ouve "já está enviando").
 *  E — a lição da FASE 36 — a reserva tem validade: um processo que morre no meio
 *  deixaria a campanha `SENDING` para sempre. Passada meia hora, a próxima
 *  tentativa retoma, porque a chave do fato já garante que retomar não duplica.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRANSAÇÕES CURTAS, E-MAIL FORA DELAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três momentos, e nenhum deles envolve esperar por rede de terceiro: (1) tomar
 *  a reserva; (2) enfileirar (cada `queueEmail` tem a própria transação); (3)
 *  gravar o resultado. Invariante nº 8: comunicação não derruba — e não segura — o
 *  fluxo acadêmico.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CORPO É POR DESTINATÁRIO, E O RODAPÉ TAMBÉM (fatia 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Duas coisas acontecem dentro do laço de envio, e as duas são o que faz isto ser
 *  uma mala direta de verdade:
 *
 *    • os **marcadores** (`{nome}`, `{instituicao}`, `{evento}`) são trocados no
 *      corpo de CADA pessoa antes do `queueEmail` — o outbox grava o texto
 *      personalizado, e é ele que responde "o que esta pessoa recebeu?";
 *    • cada mensagem leva o **endereço de descadastro daquela pessoa**, derivado por
 *      HMAC de (instituição, pessoa). O token não depende de a linha em
 *      `communication_unsubscribes` existir — ela só nasce quando a pessoa sai —, e
 *      é o mesmo token que o disparo consulta para pular quem já saiu. O envio pular
 *      e o rodapé concordam por construção, porque saem da MESMA derivação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';
import { incCounter } from '@/lib/observability/metrics';
import { createRedisRateLimitStorage, type RateLimitStorage } from '@/lib/auth/rate-limit-storage';
import {
  CAMPAIGN_STALE_AFTER_MS,
  campaignDedupeKey,
  campaignDedupePrefix,
  campaignDispatchState,
  splitIntoBatches,
  validateCampaignText,
  type CampaignStatusValue,
} from '@/domain/communication/campaign-rules';
import { renderCampaignMarkers } from '@/domain/communication/campaign-markers';
import type { SegmentDefinition } from '@/domain/communication/segments';
import { evaluateSegment, loadSegmentRecipients, type SegmentFailureCode } from './segment-service';
import { unsubscribeUrlFor } from './unsubscribe-service';
import { queueEmail } from './email-service';

/** Tamanho do lote: quantas mensagens saem antes da pausa entre lotes. */
export const DISPATCH_BATCH_SIZE = 25;

/**
 * Pausa entre lotes.
 *
 * O limite de ritmo é quem MANDA (ele conta e decide); a pausa é o que impede uma
 * rajada: sem ela, os primeiros 120 e-mails de uma campanha grande sairiam no
 * mesmo segundo, e o provedor cobra isso com 429 — que é o que a FASE 15 trata
 * como falha transitória, gastando tentativa sem necessidade.
 */
export const DISPATCH_BATCH_PAUSE_MS = 1_000;

/** Janela e teto do limitador: 120 mensagens por minuto, por instituição. */
export const DISPATCH_RATE_WINDOW_SECONDS = 60;
export const DISPATCH_RATE_MAX_PER_WINDOW = 120;

export type CampaignFailureCode =
  | SegmentFailureCode
  | 'ALREADY_RUNNING'
  | 'INVALID_INPUT'
  | 'EMAIL_FAILED';

export type CampaignResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CampaignFailureCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura e escrita do snapshot
// ───────────────────────────────────────────────────────────────────────────────
interface StoredDefinition {
  conditions?: unknown;
  except?: unknown;
}

/**
 * Lê o snapshot gravado de volta para a forma que a composição entende.
 *
 * Um `definition` corrompido NÃO é reconstruído por adivinhação: ele vira lista
 * vazia, a composição recusa (`SEGMENTO_VAZIO`) e o disparo para — fail-closed,
 * como toda leitura de definição de segmento (`user` é global e um filtro vazio
 * seleciona a instituição inteira).
 */
export function parseStoredDefinition(value: unknown): SegmentDefinition {
  const stored = (value ?? {}) as StoredDefinition;

  return {
    conditions: Array.isArray(stored.conditions)
      ? (stored.conditions as SegmentDefinition['conditions'])
      : [],
    except: (stored.except ?? null) as SegmentDefinition['except'],
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar a campanha
// ───────────────────────────────────────────────────────────────────────────────
export interface CreateCampaignInput {
  tenantId: string;
  actorId: string;
  eventId?: string | null;
  definition: SegmentDefinition;
  subject: unknown;
  body: unknown;
}

export interface CreateCampaignOutput {
  campaignId: string;
  /** A contagem do momento da criação — a mesma que a tela mostra. */
  count: number;
  unsubscribed: number;
  /** As frases que o organizador leu, congeladas junto do ato. */
  explanation: readonly string[];
}

/**
 * Registra o ATO antes de qualquer envio.
 *
 * A contagem é tirada AQUI (e não só no disparo) porque é ela que o organizador
 * confere antes de mandar: entre criar e disparar pode passar um dia, e o número
 * do rascunho precisa ser o do dia em que ele o escreveu.
 */
export async function createCampaign(
  input: CreateCampaignInput,
): Promise<CampaignResult<CreateCampaignOutput>> {
  const text = validateCampaignText({ subject: input.subject, body: input.body });

  if (!text.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: text.message };
  }

  const evaluation = await evaluateSegment({
    tenantId: input.tenantId,
    eventId: input.eventId ?? null,
    definition: input.definition,
  });

  if (!evaluation.ok) {
    return {
      ok: false,
      code: evaluation.code,
      message: evaluation.message,
      details: evaluation.details,
    };
  }

  try {
    const campaignId = await withTenant(input.tenantId, async (tx) => {
      const created = await tx.communicationCampaign.create({
        data: {
          tenantId: input.tenantId,
          eventId: input.eventId ?? null,
          createdById: input.actorId,
          subject: text.subject,
          body: text.body,
          /**
           * O snapshot são os FATOS — `{ conditions: [{ id, params }], except }` —,
           * e nunca a lista de ids de quem foi selecionado: a lista seria dado
           * pessoal parado no banco e não explicaria nada seis meses depois.
           */
          definition: {
            conditions: input.definition.conditions.map((reference) => ({
              id: reference.id,
              params: reference.params,
            })),
            except: input.definition.except
              ? { id: input.definition.except.id, params: input.definition.except.params }
              : null,
          },
          explanation: [...evaluation.explanation, ...(evaluation.exclusion ? [`Exceto: ${evaluation.exclusion}`] : [])],
          status: 'DRAFT',
          recipientCount: evaluation.count,
          skippedCount: evaluation.unsubscribed,
        },
        select: { id: true },
      });

      return created.id;
    });

    return {
      ok: true,
      campaignId,
      count: evaluation.count,
      unsubscribed: evaluation.unsubscribed,
      explanation: evaluation.explanation,
    };
  } catch (error) {
    logger.error('campaign: falha ao criar a campanha', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível criar a campanha.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Disparar
// ───────────────────────────────────────────────────────────────────────────────
export interface DispatchCampaignInput {
  tenantId: string;
  campaignId: string;
  /**
   * Quem está disparando AGORA. É ele que o outbox guarda como autor das mensagens
   * desta passada — e pode não ser quem criou a campanha (o reenvio costuma ser de
   * outra pessoa da equipe).
   */
  actorId: string;
  /** Tamanho do lote (testes usam lotes pequenos; produção usa o padrão). */
  batchSize?: number;
  /** Limitador de ritmo injetável — o padrão é o Redis da FASE 13. */
  rateLimit?: RateLimitStorage;
  /** Espera entre lotes injetável: o teste não dorme de verdade. */
  wait?: (milliseconds: number) => Promise<void>;
  /** Injetável para teste do prazo de validade da reserva. */
  now?: Date;
}

export interface CampaignDispatchOutcome {
  campaignId: string;
  status: CampaignStatusValue;
  /** Quantos o segmento alcança hoje (já sem quem saiu). */
  evaluated: number;
  /** Quantos destes já estavam fora da lista. */
  skippedUnsubscribed: number;
  /** Entraram no outbox nesta passada. */
  queued: number;
  /** Já estavam no outbox (o reenvio não duplica). */
  duplicates: number;
  /** Não conseguiram entrar (endereço inválido, falha de banco). */
  failed: number;
  /** Sobraram para a próxima passada — o limite de ritmo parou o disparo. */
  remaining: number;
  batches: number;
  rateLimited: boolean;
}

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Dispara a campanha: avalia, enfileira em lotes e registra o resultado.
 *
 * O que este serviço NÃO faz: montar o texto (é do organizador), autorizar (é da
 * Server Action) e entregar (é do worker, pelo outbox).
 */
export async function dispatchCampaign(
  input: DispatchCampaignInput,
): Promise<CampaignResult<CampaignDispatchOutcome>> {
  const now = input.now ?? new Date();
  const wait = input.wait ?? defaultWait;
  const rateLimit = input.rateLimit ?? createRedisRateLimitStorage({ prefix: 'ef:rl:campaign:' });
  const batchSize = Math.max(1, Math.floor(input.batchSize ?? DISPATCH_BATCH_SIZE));

  // ── 1. A reserva (UPDATE condicional: o banco é o árbitro) ─────────────────
  let prepared: {
    campaignId: string;
    eventId: string | null;
    eventTitle: string | null;
    subject: string;
    body: string;
    definition: SegmentDefinition;
    tenantName: string;
    /**
     * O slug entra na preparação porque é ele que monta o ENDEREÇO DE DESCADASTRO
     * que vai no rodapé de cada mensagem — e o rodapé é parte do corpo que o outbox
     * grava. Sem ele, cada destinatário precisaria de uma segunda leitura da
     * instituição no meio do laço de envio.
     */
    tenantSlug: string;
    actorName: string | null;
  };

  try {
    prepared = await withTenant(input.tenantId, async (tx) => {
      const campaign = await tx.communicationCampaign.findFirst({
        where: { id: input.campaignId },
        select: {
          id: true,
          eventId: true,
          subject: true,
          body: true,
          definition: true,
          status: true,
          startedAt: true,
          event: { select: { title: true } },
        },
      });

      if (!campaign) throw new CampaignNotFound();

      const state = campaignDispatchState({
        status: campaign.status,
        startedAt: campaign.startedAt,
        now,
      });

      if (state === 'RUNNING') throw new CampaignAlreadyRunning(campaign.startedAt);

      const staleBefore = new Date(now.getTime() - CAMPAIGN_STALE_AFTER_MS);

      /**
       * A transição é condicional no que foi LIDO: `DRAFT`/`SENT` sempre podem;
       * `SENDING` só quando a reserva venceu (processo morto no meio). Se outra
       * instância tomou a reserva entre a leitura e este UPDATE, a contagem é zero
       * — e zero linhas é resposta de negócio (invariante nº 5), não erro.
       */
      const claimed = await tx.communicationCampaign.updateMany({
        where: {
          id: campaign.id,
          OR: [
            { status: { in: ['DRAFT', 'SENT'] } },
            { status: 'SENDING', startedAt: { lt: staleBefore } },
            { status: 'SENDING', startedAt: null },
          ],
        },
        data: { status: 'SENDING', startedAt: now, finishedAt: null, error: null },
      });

      if (claimed.count === 0) throw new CampaignAlreadyRunning(campaign.startedAt);

      const [tenant, actor] = await Promise.all([
        tx.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true, slug: true } }),
        tx.user.findUnique({ where: { id: input.actorId }, select: { name: true } }),
      ]);

      return {
        campaignId: campaign.id,
        eventId: campaign.eventId,
        eventTitle: campaign.event?.title ?? null,
        subject: campaign.subject,
        body: campaign.body,
        definition: parseStoredDefinition(campaign.definition),
        tenantName: tenant?.name ?? 'EventFlow',
        tenantSlug: tenant?.slug ?? '',
        actorName: actor?.name ?? null,
      };
    });
  } catch (error) {
    if (error instanceof CampaignNotFound) {
      return { ok: false, code: 'NOT_FOUND', message: 'Campanha não encontrada nesta instituição.' };
    }

    if (error instanceof CampaignAlreadyRunning) {
      return {
        ok: false,
        code: 'ALREADY_RUNNING',
        message: 'Esta campanha já está sendo enviada. Aguarde a passada terminar.',
      };
    }

    logger.error('campaign: falha ao reservar o disparo', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível iniciar o envio.' };
  }

  // ── 2. Enfileirar (fora da transação: cada mensagem tem a própria) ─────────
  try {
    const evaluation = await evaluateSegment({
      tenantId: input.tenantId,
      eventId: prepared.eventId,
      definition: prepared.definition,
      /**
       * O disparo avalia o segmento INTEIRO: a lista é o que será percorrido, e um
       * teto aqui deixaria gente de fora sem que a campanha soubesse.
       */
      limit: null,
    });

    if (!evaluation.ok) {
      await releaseCampaign({
        tenantId: input.tenantId,
        campaignId: prepared.campaignId,
        error: evaluation.message.slice(0, 500),
      });

      return {
        ok: false,
        code: evaluation.code,
        message: evaluation.message,
        details: evaluation.details,
      };
    }

    const recipients = await loadSegmentRecipients({
      tenantId: input.tenantId,
      userIds: evaluation.people.map((person) => person.userId),
    });
    const byId = new Map(recipients.map((person) => [person.userId, person]));

    const batches = splitIntoBatches(evaluation.people, batchSize);
    const rateKey = `dispatch:${input.tenantId}`;
    const rateRule = { window: DISPATCH_RATE_WINDOW_SECONDS, max: DISPATCH_RATE_MAX_PER_WINDOW };

    let queued = 0;
    let duplicates = 0;
    let failed = 0;
    let processed = 0;
    let executedBatches = 0;
    let rateLimited = false;

    for (const batch of batches) {
      if (rateLimited) break;

      executedBatches += 1;

      for (const person of batch) {
        const decision = await rateLimit.consume(rateKey, rateRule);

        if (!decision.allowed) {
          rateLimited = true;
          incCounter('campaign_dispatch_rate_limited_total');
          break;
        }

        const recipient = byId.get(person.userId);
        processed += 1;

        if (!recipient) {
          failed += 1;
          continue;
        }

        const result = await queueEmail({
          tenantId: input.tenantId,
          to: recipient.email,
          toUserId: recipient.userId,
          template: 'CAMPAIGN_MESSAGE',
          brandName: prepared.tenantName,
          dedupeKey: campaignDedupeKey(prepared.campaignId, recipient.userId),
          createdById: input.actorId,
          payload: {
            recipientName: recipient.name,
            tenantName: prepared.tenantName,
            subject: prepared.subject,
            /**
             * ─────────────────────────────────────────────────────────────────────
             *  O CORPO É DESTA PESSOA, E É GRAVADO ASSIM
             * ─────────────────────────────────────────────────────────────────────
             *  É aqui que a "mala direta" acontece: os marcadores (`{nome}`,
             *  `{instituicao}`, `{evento}`) são trocados AQUI, um corpo por
             *  destinatário, e o que o outbox grava é o HTML já personalizado. Trocar
             *  na entrega gravaria um HTML genérico e o registro deixaria de
             *  responder a pergunta que ele existe para responder ("o que esta pessoa
             *  recebeu?").
             *
             *  O ASSUNTO **NÃO** é personalizado, e é decisão: ele viaja num
             *  cabeçalho, e o `subject` do outbox é a chave pela qual a operação
             *  reconhece a campanha. Um assunto com nome dentro faria "Sua vaga, Ana"
             *  e "Sua vaga, Bruno" parecerem duas campanhas na caixa de saída.
             */
            body: renderCampaignMarkers(prepared.body, {
              nome: recipient.name,
              instituicao: prepared.tenantName,
              evento: prepared.eventTitle,
            }),
            eventTitle: prepared.eventTitle,
            senderName: prepared.actorName,
            /**
             * O endereço de descadastro DESTA pessoa. Nulo quando o servidor não tem
             * segredo utilizável — e aí o rodapé diz isso, em vez de mostrar um link
             * que não abre.
             */
            unsubscribeUrl: prepared.tenantSlug
              ? unsubscribeUrlFor({
                  tenantSlug: prepared.tenantSlug,
                  tenantId: input.tenantId,
                  userId: recipient.userId,
                })
              : null,
          },
        });

        if (!result.ok) {
          failed += 1;
          continue;
        }

        if (result.duplicate) duplicates += 1;
        else queued += 1;
      }

      const hasNext = processed < evaluation.people.length;

      if (!rateLimited && hasNext && batchSize > 0) {
        await wait(DISPATCH_BATCH_PAUSE_MS);
      }
    }

    const remaining = evaluation.people.length - processed;
    const reached = await countCampaignMessages(input.tenantId, prepared.campaignId);

    const stored = await withTenant(input.tenantId, (tx) =>
      tx.communicationCampaign.update({
        where: { id: prepared.campaignId },
        data: {
          status: 'SENT',
          finishedAt: new Date(),
          recipientCount: evaluation.count,
          skippedCount: evaluation.unsubscribed,
          /**
           * `reachedCount` é CONTADO no outbox pela chave do fato, e não somado em
           * memória: assim o reenvio não infla o número — a mensagem que já existia
           * continua sendo uma.
           */
          reachedCount: reached,
          failedCount: failed,
          error: null,
        },
        select: { status: true },
      }),
    );

    return {
      ok: true,
      campaignId: prepared.campaignId,
      status: stored.status,
      evaluated: evaluation.count,
      skippedUnsubscribed: evaluation.unsubscribed,
      queued,
      duplicates,
      failed,
      remaining,
      batches: executedBatches,
      rateLimited,
    };
  } catch (error) {
    logger.error('campaign: falha no disparo', { error: errorMessage(error) });

    await releaseCampaign({
      tenantId: input.tenantId,
      campaignId: prepared.campaignId,
      error: errorMessage(error).slice(0, 500),
    });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível concluir o envio.' };
  }
}

class CampaignNotFound extends Error {}
class CampaignAlreadyRunning extends Error {
  constructor(readonly startedAt: Date | null) {
    super(`campanha em envio desde ${startedAt?.toISOString() ?? 'instante desconhecido'}`);
  }
}

/**
 * Devolve a campanha ao rascunho depois de uma falha do disparo.
 *
 * Voltar a `DRAFT` é o que permite TENTAR DE NOVO — e o erro fica gravado para a
 * tela dizer o que aconteceu. Deixá-la em `SENDING` seria pior: a reserva
 * venceria em meia hora e, até lá, ninguém poderia retomar nem entender por quê.
 */
async function releaseCampaign(input: {
  tenantId: string;
  campaignId: string;
  error: string;
}): Promise<void> {
  try {
    await withTenant(input.tenantId, (tx) =>
      tx.communicationCampaign.updateMany({
        where: { id: input.campaignId, status: 'SENDING' },
        data: { status: 'DRAFT', finishedAt: null, error: input.error },
      }),
    );
  } catch (error) {
    logger.error('campaign: falha ao liberar a campanha', { error: errorMessage(error) });
  }
}

/** Quantas linhas do outbox são DESTA campanha (a contagem sai do prefixo). */
async function countCampaignMessages(tenantId: string, campaignId: string): Promise<number> {
  return withTenant(tenantId, (tx) =>
    tx.emailMessage.count({ where: { dedupeKey: { startsWith: campaignDedupePrefix(campaignId) } } }),
  );
}

export interface CampaignSummary {
  id: string;
  subject: string;
  eventId: string | null;
  status: string;
  recipientCount: number;
  reachedCount: number;
  failedCount: number;
  skippedCount: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  explanation: readonly string[];
}

/** O histórico da instituição — o que a tela de comunicação mostra. */
export async function listCampaigns(input: {
  tenantId: string;
  eventId?: string | null;
  limit?: number;
}): Promise<readonly CampaignSummary[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);

  return withTenant(input.tenantId, (tx) =>
    tx.communicationCampaign.findMany({
      where: input.eventId ? { eventId: input.eventId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        subject: true,
        eventId: true,
        status: true,
        recipientCount: true,
        reachedCount: true,
        failedCount: true,
        skippedCount: true,
        error: true,
        createdAt: true,
        finishedAt: true,
        explanation: true,
      },
    }),
  );
}
