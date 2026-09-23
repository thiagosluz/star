/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AO VIVO DE UM SORTEIO NO PALCO (FASE 29)
 *  `GET /api/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/ao-vivo`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA PÚBLICA, E NÃO A PRÉVIA DA OPERAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A prévia da FASE 16/F22 (`/api/events/<eventId>/raffle-live`) nasceu para a TELA
 *  DE OPERAÇÃO: exige sessão e `event:manage`, e recebe o recorte pelos campos do
 *  formulário, porque o sorteio ainda não existe. O telão é o oposto em tudo:
 *
 *    • é PÚBLICO — quem está na plateia não tem conta, e a contagem que ele mostra
 *      é a mesma que a instituição decidiu projetar na parede;
 *    • o recorte vem do SORTEIO, não da URL — aceitar o recorte por parâmetro
 *      permitiria um telão exibindo "42 elegíveis" de um recorte que não é o que
 *      será apurado, que é a discrepância exata que corrói a confiança no palco.
 *
 *  Duas rotas, dois públicos, cada uma com a sua autorização — em vez de uma rota
 *  só que fica pública pela metade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE VAI NO FLUXO, E QUANDO ELE PARA DE CONSULTAR O BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os mesmos campos da prévia (`eligibleCount`, `inspectedAttendances`,
 *  `lastCheckInAt`, `sampledAt`) mais o ESTADO do sorteio (`status`, `drawnAt`,
 *  hashes). Só emite quando algo muda; um comentário de heartbeat mantém a conexão
 *  viva em proxy que fecha o que não trafega.
 *
 *  A CADÊNCIA É ADAPTATIVA (FASE 30). Enquanto há rodada pendente, amostra a cada 3 s
 *  (a contagem de elegíveis muda com o credenciamento); sem rodada pendente, cai para
 *  10 s — e nesse ritmo só relê o estado do sorteio, sem contar elegíveis.
 *
 *  O fluxo NÃO para de amostrar depois da apuração: um sorteio pode ganhar outra
 *  rodada minutos depois (o operador prepara a próxima no meio do evento), e a parede
 *  precisa anunciá-la. Parar de amostrar — como a versão anterior fazia — deixava o
 *  telão mostrando o resultado da rodada 1 enquanto a 2 esperava (o E2E da FASE 30
 *  pegou exatamente isso). Só o CANCELAMENTO encerra a amostragem: sorteio cancelado
 *  não tem rodada futura.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import {
  getLiveEligibility,
  getRaffleLiveState,
  type LiveEligibility,
  type RaffleLiveState,
} from '@/lib/raffles/raffle-service';
import type { RaffleConfig } from '@/domain/raffles/raffle-rules';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Passo da amostragem COM rodada pendente (a contagem muda com o credenciamento). */
const SAMPLE_INTERVAL_MS = 3_000;
/**
 * Passo da amostragem SEM rodada pendente.
 *
 *  Aqui a parede está exibindo o resultado e esperando o operador preparar o próximo
 *  momento: a única coisa que pode mudar é uma rodada nova. Uma consulta por chave
 *  primária a cada 10 s é barata, e é o preço de o telão perceber a rodada seguinte.
 */
const IDLE_SAMPLE_INTERVAL_MS = 10_000;
/** Comentário periódico para proxy que fecha conexão ociosa. */
const HEARTBEAT_INTERVAL_MS = 20_000;

interface StageStatePayload {
  raffleId: string;
  status: string;
  drawnAt: string | null;
  resultHash: string | null;
  poolHash: string | null;
  /**
   * A rodada PREPARADA (o que o telão anuncia) e a última APURADA (o que faz a
   * parede revelar). Sem elas, um sorteio com várias rodadas ficaria `DRAWN` para
   * sempre e a rodada 2 seria apurada sem a parede perceber (FASE 30).
   */
  pendingRound: { roundId: string; roundNumber: number; prizeTitle: string | null } | null;
  lastDrawnRound: { roundId: string; roundNumber: number; resultHash: string | null } | null;
}

function notFound(): NextResponse {
  return NextResponse.json(
    { ok: false, code: 'NOT_FOUND' },
    { status: 404, headers: { 'cache-control': 'no-store' } },
  );
}

function payloadOf(
  state: StageStatePayload,
  eligibility: LiveEligibility | null,
): Record<string, unknown> {
  return {
    ok: true,
    raffle: state,
    eligibleCount: eligibility?.eligibleCount ?? null,
    inspectedAttendances: eligibility?.inspectedAttendances ?? null,
    lastCheckInAt: eligibility?.lastCheckInAt?.toISOString() ?? null,
    sampledAt: (eligibility?.sampledAt ?? new Date()).toISOString(),
  };
}

/** Assinatura: só o que o telão desenha. Campo que não muda a tela não gera evento. */
function signatureOf(payload: Record<string, unknown>): string {
  const raffle = payload.raffle as StageStatePayload;

  return [
    raffle.status,
    raffle.pendingRound?.roundId ?? '',
    raffle.pendingRound?.prizeTitle ?? '',
    raffle.lastDrawnRound?.roundId ?? '',
    raffle.lastDrawnRound?.resultHash ?? '',
    payload.eligibleCount ?? '',
    payload.lastCheckInAt ?? '',
  ].join('|');
}

/** O estado do sorteio no formato que o telão consome. */
function statePayloadOf(state: RaffleLiveState): StageStatePayload {
  return {
    raffleId: state.raffleId,
    status: state.status,
    drawnAt: state.drawnAt?.toISOString() ?? null,
    resultHash: state.resultHash,
    poolHash: state.poolHash,
    pendingRound: state.pendingRound
      ? {
          roundId: state.pendingRound.roundId,
          roundNumber: state.pendingRound.roundNumber,
          prizeTitle: state.pendingRound.prizeTitle,
        }
      : null,
    lastDrawnRound: state.lastDrawnRound
      ? {
          roundId: state.lastDrawnRound.roundId,
          roundNumber: state.lastDrawnRound.roundNumber,
          resultHash: state.lastDrawnRound.resultHash,
        }
      : null,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }> },
): Promise<Response> {
  const { tenantSlug, eventSlug, raffleId } = await context.params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return notFound();

  const state = await getRaffleLiveState({
    tenantId: tenant.tenantId,
    eventId: event.id,
    raffleId,
  });

  if (!state) return notFound();

  const statePayload: StageStatePayload = statePayloadOf(state);

  /**
   * O ESTADO É RELIDO A CADA AMOSTRA.
   *
   * A primeira versão desta rota calculava o estado UMA vez, na abertura da conexão,
   * e só reamostrava a contagem de elegíveis — o telão abria, mostrava "aguardando" e
   * NUNCA percebia a apuração, porque o status que ele recebia era uma fotografia do
   * momento em que a página carregou. O E2E pegou exatamente isso ("data-stage-state"
   * ficou em `AGUARDANDO` para sempre, com o sorteio já apurado no banco).
   *
   * A releitura é uma consulta por chave primária, na cadência de 3 s (rodada pendente)
   * ou 10 s (sem rodada pendente) — e o fluxo só encerra no CANCELAMENTO, porque o
   * sorteio pode ganhar outra rodada depois da primeira apuração (FASE 30).
   */
  const loadState = async (): Promise<RaffleLiveState | null> =>
    getRaffleLiveState({ tenantId: tenant.tenantId, eventId: event.id, raffleId });

  const loadEligibility = async (config: RaffleConfig): Promise<LiveEligibility | null> => {
    const result = await getLiveEligibility({
      tenantId: tenant.tenantId,
      eventId: event.id,
      config,
    });

    return result.ok ? result : null;
  };

  const wantsStream = request.headers.get('accept')?.includes('text/event-stream') ?? false;

  if (!wantsStream) {
    const eligibility = await loadEligibility(state.config);

    return NextResponse.json(payloadOf(statePayload, eligibility), {
      headers: { 'cache-control': 'no-store' },
    });
  }

  const encoder = new TextEncoder();
  let sampleTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSignature = '';

      const send = (chunk: string) => {
        if (closed) return;

        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const stopSampling = () => {
        if (sampleTimer) {
          clearTimeout(sampleTimer);
          sampleTimer = null;
        }
      };

      /**
       * Agenda a próxima amostra. É `setTimeout` (e não `setInterval`) porque a cadência
       * MUDA de uma amostra para a outra: 3 s com rodada pendente, 10 s sem ela.
       */
      const scheduleNext = (delay: number) => {
        if (closed) return;

        stopSampling();
        sampleTimer = setTimeout(() => void sample(), delay);
      };

      const close = () => {
        if (closed) return;
        closed = true;

        stopSampling();
        if (heartbeatTimer) clearInterval(heartbeatTimer);

        try {
          controller.close();
        } catch {
          // Já fechado pelo runtime.
        }
      };

      const sample = async () => {
        if (closed) return;

        try {
          /**
           * O estado do SORTEIO é relido a cada amostra (a rota não pode congelar o
           * status da abertura) e a contagem só é consultada enquanto há RODADA
           * PENDENTE — é ela que muda com o credenciamento.
           *
           * Desde a FASE 30 a condição é a RODADA, não o status: um sorteio com a
           * rodada 2 preparada continua `DRAWN` (a 1 já foi apurada) e a parede precisa
           * continuar amostrando para perceber a apuração seguinte.
           */
          const current = await loadState();

          if (closed) return;

          // Sorteio apagado no meio do evento: mantém o último estado na tela em vez
          // de derrubar o telão no meio da apresentação.
          if (!current) return;

          const eligibility = current.pendingRound ? await loadEligibility(current.config) : null;

          if (closed) return;

          const payload = payloadOf(statePayloadOf(current), eligibility);

          const signature = signatureOf(payload);
          if (signature !== lastSignature) {
            lastSignature = signature;
            send(`event: live\ndata: ${JSON.stringify(payload)}\n\n`);
          }

          /**
           * ───────────────────────────────────────────────────────────────────────────
           *  A PRÓXIMA AMOSTRA É AGENDADA AQUI, E A CADÊNCIA DEPENDE DO MOMENTO
           * ───────────────────────────────────────────────────────────────────────────
           *  Com rodada pendente, 3 s (a contagem de elegíveis muda a cada credenciamento).
           *  Sem rodada pendente, 10 s: a parede está exibindo o resultado e a única
           *  mudança possível é uma rodada NOVA — que o operador prepara no meio do
           *  evento. Parar de amostrar aqui (como a versão anterior fazia) deixava o
           *  telão preso no resultado da rodada 1 enquanto a 2 esperava: o E2E da FASE 30
           *  pegou exatamente isso.
           *
           *  Só o CANCELAMENTO encerra a amostragem — sorteio cancelado não tem rodada
           *  futura, e a parede pode ficar com o aviso.
           */
          if (current.status === 'CANCELED') {
            stopSampling();
            return;
          }

          scheduleNext(current.pendingRound ? SAMPLE_INTERVAL_MS : IDLE_SAMPLE_INTERVAL_MS);
        } catch (error) {
          console.error(
            `[raffles] falha no ao vivo do palco: ${error instanceof Error ? error.message : error}`,
          );
          send(`event: error\ndata: ${JSON.stringify({ code: 'INTERNAL' })}\n\n`);
          // Falha de leitura não encerra o fluxo: o telão continua vivo e tenta de novo.
          scheduleNext(SAMPLE_INTERVAL_MS);
        }
      };

      // Primeira amostra IMEDIATA: o telão não pode abrir em branco.
      await sample();

      heartbeatTimer = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (sampleTimer) clearTimeout(sampleTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
