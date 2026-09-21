/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRÉVIA AO VIVO DO CREDENCIAMENTO (FASE 16, item G7 · FASE 22, item G13)
 *  `GET /api/events/<eventId>/raffle-live?scope=…&activityId=…&minAttendanceMinutes=…`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO FECHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de sorteio calculava a prévia UMA vez, no carregamento. No palco, com o
 *  credenciamento acontecendo, o organizador via "42 elegíveis" e o número real já
 *  era outro — e a única saída era recarregar a página no meio da apresentação.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O MESMO ENDEREÇO RESPONDE JSON **E** SSE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 16 resolveu com polling de 5 s e escreveu por que NÃO usaria SSE: uma
 *  conexão aberta por tela traria reconexão, heartbeat e timeout de infraestrutura.
 *  O argumento continua verdadeiro — o que mudou é o custo do outro lado. Com N telas
 *  abertas no mesmo evento (palco, balcão, coordenação), o polling é N×12 requisições
 *  por minuto, cada uma refazendo a consulta de elegibilidade; a conexão aberta é UMA
 *  por tela e a consulta passa a ser do servidor, que pode até compartilhá-la.
 *
 *  Como a decisão da FASE 16 está documentada e um cliente antigo pode existir, a
 *  rota NEGOCIA: quem manda `Accept: text/event-stream` recebe o fluxo; qualquer
 *  outra coisa recebe o JSON de sempre, com o mesmo corpo. Nada quebra, e o
 *  comportamento novo é opt-in de quem sabe pedir (ADR-138).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE VAI NO FLUXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os mesmos campos do JSON (`eligibleCount`, `inspectedAttendances`,
 *  `lastCheckInAt`, `sampledAt`), e nada mais: o evento `live` só é emitido quando
 *  algum deles MUDA, então uma tela parada recebe silêncio em vez de repetição.
 *  Um comentário de heartbeat (`: keep-alive`) a cada 20 s mantém a conexão viva em
 *  proxy que fecha o que não trafega.
 *
 *  A consulta é a MESMA da apuração (`previewEligibility`): duas implementações da
 *  contagem divergiriam, e o organizador veria um número na tela e outro no
 *  resultado — exatamente a discrepância que corrói a confiança no sorteio.
 *
 *  Autorização: sessão + vínculo ativo + `event:manage`, como na tela que consome.
 *  A leitura roda sob RLS (`withTenant`), então o recorte de instituição é do banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { NextResponse } from 'next/server';

import { adminPrisma } from '@/lib/db/admin-client';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { RAFFLE_SCOPES, type RaffleScope } from '@/domain/raffles/raffle-rules';
import { getLiveEligibility, type LiveEligibility } from '@/lib/raffles/raffle-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Intervalo entre consultas do LADO DO SERVIDOR.
 *
 * Não é o intervalo que o navegador vê: o cliente recebe só quando muda. 3 s é o
 * passo que faz a contagem parecer imediata ao credenciar alguém, e é um número só
 * por evento enquanto houver tela aberta — contra 5 s × N telas do polling.
 */
const SAMPLE_INTERVAL_MS = 3_000;
/** Comentário periódico para proxy que fecha conexão ociosa. */
const HEARTBEAT_INTERVAL_MS = 20_000;

function badRequest(message: string): NextResponse {
  return NextResponse.json({ ok: false, code: 'INVALID_INPUT', message }, { status: 400 });
}

/** Os campos que a tela mostra — e a assinatura usada para decidir se houve mudança. */
function livePayload(result: LiveEligibility): Record<string, unknown> {
  return {
    ok: true,
    eligibleCount: result.eligibleCount,
    inspectedAttendances: result.inspectedAttendances,
    lastCheckInAt: result.lastCheckInAt?.toISOString() ?? null,
    sampledAt: result.sampledAt.toISOString(),
  };
}

function signatureOf(payload: Record<string, unknown>): string {
  return `${payload.eligibleCount}|${payload.inspectedAttendances}|${payload.lastCheckInAt}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ ok: false, code: 'NOT_AUTHENTICATED' }, { status: 401 });
  }

  const { eventId } = await context.params;
  const url = new URL(request.url);
  const tenantSlug = url.searchParams.get('tenantSlug')?.trim() ?? '';
  const scope = url.searchParams.get('scope') ?? 'EVENT';

  if (!tenantSlug || !(RAFFLE_SCOPES as readonly string[]).includes(scope)) {
    return badRequest('Informe a instituição e um escopo de sorteio válido.');
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404 });
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' })) {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  }

  const referenceDateParam = url.searchParams.get('referenceDate');

  const config = {
    scope: scope as RaffleScope,
    referenceDate: referenceDateParam ? new Date(`${referenceDateParam}T12:00:00.000Z`) : null,
    activityId: url.searchParams.get('activityId') || null,
    minAttendanceMinutes: Number(url.searchParams.get('minAttendanceMinutes') ?? 0) || 0,
    winnersCount: 1,
    alternatesCount: 0,
    weightByMinutes: false,
    allowPriorEventWinners: url.searchParams.get('allowPriorEventWinners') === 'true',
  };

  /**
   * O cliente pediu o FLUXO? O `Accept` é o sinal padrão de SSE (`EventSource` o
   * envia sozinho) — e é o que permite manter o JSON para quem não pediu.
   */
  const wantsStream = request.headers.get('accept')?.includes('text/event-stream') ?? false;

  if (!wantsStream) {
    const result = await getLiveEligibility({ tenantId: tenant.id, eventId, config });

    if (!result.ok) {
      return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status: 200 });
    }

    return NextResponse.json(livePayload(result), { headers: { 'cache-control': 'no-store' } });
  }

  const encoder = new TextEncoder();
  let sampleTimer: ReturnType<typeof setInterval> | null = null;
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
          // Cliente desconectou entre o `enqueue` anterior e este: encerra em silêncio.
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;

        if (sampleTimer) clearInterval(sampleTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);

        try {
          controller.close();
        } catch {
          // Já fechado pelo próprio runtime.
        }
      };

      /**
       * A cada amostra, o resultado vai para o cliente SÓ quando muda. O organizador
       * não precisa receber o mesmo número 20 vezes por minuto, e a ausência de
       * eventos é justamente o que diz "nada mudou desde a última vez".
       */
      const sample = async () => {
        if (closed) return;

        try {
          const result = await getLiveEligibility({ tenantId: tenant.id, eventId, config });

          if (closed) return;

          if (!result.ok) {
            send(`event: error\ndata: ${JSON.stringify({ code: result.code, message: result.message })}\n\n`);
            return;
          }

          const payload = livePayload(result);
          const signature = signatureOf(payload);

          if (signature === lastSignature) return;

          lastSignature = signature;
          send(`event: live\ndata: ${JSON.stringify(payload)}\n\n`);
        } catch (error) {
          console.error(`[raffles] falha na prévia ao vivo: ${error instanceof Error ? error.message : error}`);
          send(`event: error\ndata: ${JSON.stringify({ code: 'INTERNAL' })}\n\n`);
        }
      };

      // Primeira amostra IMEDIATA: a tela não pode ficar em "contando…" por 3 s.
      await sample();

      sampleTimer = setInterval(() => void sample(), SAMPLE_INTERVAL_MS);
      heartbeatTimer = setInterval(() => send(': keep-alive\n\n'), HEARTBEAT_INTERVAL_MS);

      /**
       * O encerramento vem do PRÓPRIO runtime (`request.signal`): a tela fechou, a
       * pessoa navegou, o proxy caiu. Sem isto, o intervalo continuaria consultando o
       * banco para um cliente que não existe — o vazamento clássico de SSE.
       */
      request.signal.addEventListener('abort', close, { once: true });
    },
    cancel() {
      if (sampleTimer) clearInterval(sampleTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      // `no-transform` impede proxy de "melhorar" o fluxo bufferizando (e matando a
      // sensação de tempo real); `x-accel-buffering` faz o mesmo no nginx.
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
