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
import { getLiveEligibility, type LiveEligibility } from '@/lib/raffles/raffle-read-service';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

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
  return tenantApiError(400, 'INVALID_INPUT', message);
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
  const { eventId } = await context.params;

  /**
   * ─── O `eventId` É O ENDEREÇO DA PRÉVIA (FASE 76) ───────────────────────────
   * A rota não é de `/api/t/**`, mas devolve o MESMO envelope — é a prévia que a tela
   * de operação consome, e um segundo formato de erro só para ela seria a divergência
   * que esta fatia veio apagar. Antes, o id malformado descia até a consulta de
   * elegibilidade, o serviço engolia o `P2023` e a rota respondia **200 com
   * `{ok:false}`** no corpo — um erro disfarçado de sucesso. Agora é 404 antes de
   * tocar o banco.
   */
  if (!isUuid(eventId)) {
    return tenantApiError(404, 'NOT_FOUND', 'Evento não encontrado.');
  }

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') ?? 'EVENT';
  const activityId = url.searchParams.get('activityId')?.trim() || null;

  /**
   * ─── `?activityId=` É ENTRADA OBRIGATÓRIA NO ESCOPO DE ATIVIDADE (FASE 76) ──
   *  A fatia 2 cobriu o `eventId` do caminho e deixou este param de fora. Como
   *  ele só é lido quando `scope = ACTIVITY`, o formato passa pela MESMA régua da
   *  fase: entrada obrigatória → **400 `INVALID_INPUT`**, com o envelope e ANTES
   *  de autenticar/consultar (a pergunta é sobre o PEDIDO, não sobre quem pediu).
   *  Um uuid bem formado e inexistente continua seguindo o caminho de sempre (o
   *  serviço decide 404); o que muda é só o TEXTO torto, que antes descia ao
   *  Prisma e virava 500 `INTERNAL`.
   */
  if (scope === 'ACTIVITY') {
    if (!activityId) {
      return badRequest('Informe a atividade do sorteio.');
    }

    if (!isUuid(activityId)) {
      return tenantApiError(
        400,
        'INVALID_INPUT',
        'A atividade do sorteio não é um identificador válido.',
      );
    }
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return tenantApiError(401, 'NOT_AUTHENTICATED', 'Sessão expirada. Entre novamente.');
  }

  const tenantSlug = url.searchParams.get('tenantSlug')?.trim() ?? '';

  if (!tenantSlug || !(RAFFLE_SCOPES as readonly string[]).includes(scope)) {
    return badRequest('Informe a instituição e um escopo de sorteio válido.');
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return tenantApiError(
      403,
      'FORBIDDEN',
      'Você não tem vínculo ativo com esta instituição.',
    );
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' })) {
    return tenantApiError(403, 'FORBIDDEN', 'Permissão negada: event:manage.');
  }

  const referenceDateParam = url.searchParams.get('referenceDate');

  const config = {
    scope: scope as RaffleScope,
    referenceDate: referenceDateParam ? new Date(`${referenceDateParam}T12:00:00.000Z`) : null,
    activityId,
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
      /**
       * `result.code` vem do serviço: `INTERNAL` é falha de leitura (500), `NOT_FOUND`
       * é ausência (404) e o resto é pedido inválido (400). O status deixa de ser
       * 200 — um erro nunca foi sucesso.
       */
      const status = result.code === 'INTERNAL' ? 500 : result.code === 'NOT_FOUND' ? 404 : 400;

      return tenantApiError(status, result.code, result.message);
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
