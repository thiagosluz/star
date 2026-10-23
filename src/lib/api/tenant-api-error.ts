import { NextResponse } from 'next/server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ERRO DAS ROTAS `/api/t/**` — UM ENVELOPE, NUNCA CORPO VAZIO
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO FECHA (FASE 76 · fatia 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um id malformado em `[assetId]`, `[exportId]`, `[materialId]` ou na query de
 *  impressão chegava ao Prisma sem validação; o driver estourava com `P2023` e o
 *  handler do Next respondia **500 sem corpo** — zero byte, sem `content-type`. Quem
 *  consome a API não tinha como distinguir "erro do servidor" de "arquivo vazio"; e o
 *  mesmo defeito aparecia em três formatos diferentes: 500 mudo, 403 com
 *  `{code:"INTERNAL"}` e 200 com `{ok:false}` no corpo.
 *
 *  O envelope já era a resposta certa em 35 sítios escritos À MÃO em 9 arquivos (e é
 *  o que a rota `ao-vivo` do palco usa). Ele vira UMA função para que a próxima rota
 *  não invente um quarto formato — e para que "erro" signifique a mesma coisa em toda
 *  a API da instituição: `{ ok: false, code, message }`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `cache-control: no-store` É PARTE DO ERRO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Resposta de erro carrega mensagem sobre o RECURSO e a AUTORIZAÇÃO de quem pediu
 *  (por exemplo, "esta imagem é do acervo da instituição"). Guardá-la em cache
 *  intermediário manteria a recusa de uma pessoa servível a outra. O sucesso decide o
 *  próprio cache; o erro nunca é cacheável.
 *
 *  Este arquivo é de APLICAÇÃO (HTTP), não de domínio: status e `NextResponse` são
 *  transporte. A REGRA que produz o `code` continua no serviço que recusou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Os status que a API de instituição usa hoje. A união é fechada de propósito: um
 * status fora dela é erro de digitação, não uma decisão nova de contrato.
 */
export type TenantApiErrorStatus =
  | 400
  | 401
  | 403
  | 404
  | 405
  | 409
  | 410
  | 415
  | 422
  | 429
  | 500
  | 503;

/** O corpo de erro — o formato que o consumidor da API pode prever. */
export interface TenantApiErrorBody {
  ok: false;
  code: string;
  message: string;
}

/**
 * Responde um erro com o envelope único da API.
 *
 * `code` é a chave ESTÁVEL que o cliente testa (não a mensagem, que é para gente);
 * `message` é a frase em português que a tela pode mostrar. `headers` existe para os
 * casos que já precisam de um cabeçalho próprio (por exemplo, `X-Robots-Tag` no
 * material de palestrante) — o `no-store` do erro continua garantido.
 */
export function tenantApiError(
  status: TenantApiErrorStatus,
  code: string,
  message: string,
  headers?: Record<string, string>,
): NextResponse<TenantApiErrorBody> {
  return NextResponse.json<TenantApiErrorBody>(
    { ok: false, code, message },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        ...headers,
      },
    },
  );
}
