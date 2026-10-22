/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — a PRÉVIA do JSON real da API (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PRÉVIA É A ROTA, NÃO UM CAMINHO PRIVILEGIADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela mostra "o que o cliente recebe". Escrever a prévia com uma consulta
 *  própria — ou com `loadEventApiProjections` direto — criaria um TERCEIRO caminho
 *  para o banco, e a prévia poderia ficar bonita enquanto a API responde 404 por
 *  causa de uma seção desligada. Por isso a prévia chama o MESMO
 *  `createEventApiRouteHandlers` que as cinco rotas montam, com a chave do próprio
 *  evento no `Authorization: Bearer`. Assim ela atravessa de verdade as portas da
 *  fatia 2: chave, evento publicado, interruptor de seção, envelope, `ETag`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ÚNICA COISA INJETADA É O LIMITADOR — E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O teto de 120/min protege a API de sondagem externa, por IP de CLIENTE. A prévia
 *  não é tráfego externo: é a própria tela autenticada desenhando cinco respostas,
 *  no servidor. Usar o limitador real faria o organizador derrubar a própria prévia
 *  depois de vinte e quatro aberturas de página na mesma janela (5 requisições × 24)
 *  — e o 429 que apareceria ali não diria nada sobre o conteúdo. O limitador
 *  injetado libera a prévia; a rota pública continua com o limitador real.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CHAVE EM CLARO NUNCA SAI DAQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela só existe neste parâmetro e no cabeçalho da requisição sintética: não entra
 *  em log, nem em URL, nem no corpo. Quem chama (a página) já teve o direito de
 *  reexibi-la conferido pela guarda de permissão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { API_RESOURCES, type ApiResource } from '@/domain/api/public-api-contract';
import type { RateLimitStorage } from '@/lib/auth/rate-limit-storage';
import { createEventApiRouteHandlers } from '@/lib/api/event-api-route-handlers';
import { eventApiResourcePath } from '@/domain/api/event-api-organizer-rules';

export interface EventApiPreview {
  /** O código HTTP REAL daquela resposta (200, 404, …). */
  status: number;
  etag: string | null;
  /** O corpo, com a indentação de leitura — o conteúdo é o mesmo. */
  body: string;
}

export type EventApiPreviewsResult =
  | { ok: true; previews: Record<ApiResource, EventApiPreview> }
  | { ok: false; message: string };

/** Ver o cabeçalho: a prévia não consome o teto da API pública. */
const PREVIEW_RATE_LIMIT: RateLimitStorage = {
  consume: () => Promise.resolve({ allowed: true, retryAfter: null }),
};

const PREVIEW_ORIGIN = 'http://eventflow.local';

/**
 * Formata o corpo JSON para leitura.
 *
 * Um corpo que não seja JSON volta como veio: a prévia não pode FINGIR um formato
 * que a API não devolveu. `JSON.stringify` preserva a ordem das chaves do corpo
 * (que é o contrato), e só troca os espaços.
 */
function readableBody(text: string, contentType: string | null): string {
  if (!contentType?.includes('application/json')) return text;

  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return text;
  }
}

/**
 * As cinco prévias, em paralelo.
 *
 * `now` é injetável para a tela ser determinística em teste; em produção é o
 * instante da renderização — o mesmo que o `meta.generatedAt` mostra.
 */
export async function buildEventApiPreviews(input: {
  tenantSlug: string;
  eventSlug: string;
  chave: string;
  now?: Date;
}): Promise<EventApiPreviewsResult> {
  const now = input.now ?? new Date();

  try {
    const entries = await Promise.all(
      API_RESOURCES.map(async (resource) => {
        const handlers = createEventApiRouteHandlers(resource, {
          rateLimit: PREVIEW_RATE_LIMIT,
          now: () => now,
        });

        const request = new Request(
          `${PREVIEW_ORIGIN}${eventApiResourcePath({
            tenantSlug: input.tenantSlug,
            eventSlug: input.eventSlug,
            resource,
          })}`,
          {
            method: 'GET',
            headers: { authorization: `Bearer ${input.chave}` },
          },
        );

        const response = await handlers.GET(request, {
          params: Promise.resolve({
            tenantSlug: input.tenantSlug,
            eventSlug: input.eventSlug,
          }),
        });

        const preview: EventApiPreview = {
          status: response.status,
          etag: response.headers.get('etag'),
          body: readableBody(await response.text(), response.headers.get('content-type')),
        };

        return [resource, preview] as const;
      }),
    );

    return { ok: true, previews: Object.fromEntries(entries) as Record<ApiResource, EventApiPreview> };
  } catch {
    /**
     * A prévia é informação; a tela é o trabalho. Falhar aqui não pode derrubar a
     * configuração da chave — a página mostra o aviso e os demais controles seguem.
     * O `catch` não engole diagnóstico: o handler já registra a causa no log; aqui
     * só se decide não transformar a tela inteira em 500.
     */
    return {
      ok: false,
      message: 'Não foi possível gerar a prévia agora. A configuração da chave continua disponível.',
    };
  }
}
