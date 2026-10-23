/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ENVELOPE DE ERRO DA API — A FORMA É O CONTRATO (FASE 76 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE TESTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito medido não era "um status errado": era **500 sem corpo**, 0 byte, sem
 *  `content-type` — e, no mesmo universo, 403 com `{code:"INTERNAL"}` e 200 com erro
 *  no corpo. Quem consome a API não conseguia nem distinguir erro de resposta vazia.
 *
 *  A correção é uma FUNÇÃO, e este teste prende as três coisas que o consumidor pode
 *  prever sem abrir o código de cada rota:
 *
 *    1. o **status** é o que a rota decidiu (e não um 200/500 de acidente);
 *    2. o **content-type** é JSON (nunca corpo vazio);
 *    3. o **corpo** tem sempre `{ ok:false, code, message }` — `code` estável para o
 *       cliente testar, `message` em português para a tela mostrar.
 *
 *  Não é teste de rota: é o contrato que as rotas passaram a compartilhar. O
 *  comportamento de cada rota (404 para id malformado) está na integração.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  tenantApiError,
  type TenantApiErrorStatus,
} from '../../src/lib/api/tenant-api-error';

/**
 * Todos os status que a API de instituição usa hoje. A lista é o contrato do tipo —
 * se um status novo entrar na união, ele entra aqui junto, e cada um é verificado.
 */
const STATUSES: readonly TenantApiErrorStatus[] = [
  400, 401, 403, 404, 405, 409, 410, 415, 422, 429, 500, 503,
];

describe('tenantApiError — cada status com o mesmo envelope', () => {
  for (const status of STATUSES) {
    it(`${status} responde JSON com ok:false, code e message`, async () => {
      const response = tenantApiError(status, 'CODIGO_ESTAVEL', 'Mensagem para a tela.');

      expect(response.status).toBe(status);

      /**
       * O `startsWith` (e não igualdade) é deliberado: o Next pode acrescentar
       * `; charset=utf-8` ao tipo, e o que importa para o cliente é a FAMÍLIA JSON.
       * O que não pode acontecer é o corpo sair sem tipo nenhum — o defeito medido.
       */
      expect(response.headers.get('content-type')).toMatch(/^application\/json/);
      expect(response.headers.get('cache-control')).toBe('no-store');

      const body = (await response.json()) as Record<string, unknown>;

      expect(body).toEqual({
        ok: false,
        code: 'CODIGO_ESTAVEL',
        message: 'Mensagem para a tela.',
      });
      expect(typeof body.code).toBe('string');
      expect(typeof body.message).toBe('string');
      expect(body.message).not.toBe('');
    });
  }
});

describe('tenantApiError — cabeçalhos próprios sem perder o no-store', () => {
  it('acrescenta os cabeçalhos do chamador e mantém o cache desligado', async () => {
    /**
     * O material de palestrante precisa de `x-robots-tag` para não ser indexado. O
     * helper aceita o extra — mas o `no-store` do erro não é negociável: a mensagem
     * pode descrever o recurso ou a autorização de quem pediu.
     */
    const response = tenantApiError(403, 'FORBIDDEN', 'Material restrito.', {
      'x-robots-tag': 'noindex, nofollow',
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('o corpo não tem campo a mais: o formato é previsível', async () => {
    const body = (await tenantApiError(404, 'NOT_FOUND', 'Não encontrado.').json()) as Record<
      string,
      unknown
    >;

    expect(Object.keys(body).sort()).toEqual(['code', 'message', 'ok']);
  });
});
