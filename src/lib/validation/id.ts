import { notFound } from 'next/navigation';

import { isUuid } from '@/domain/validation/id-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ID DO CAMINHO: VALIDADO ANTES DE QUALQUER CONSULTA
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VALIDAÇÃO VEM ANTES DA CONSULTA (e não depois)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `where: { id }` com um texto que não é uuid não devolve "nenhum resultado": o
 *  Prisma tenta converter o parâmetro para o tipo `uuid` da coluna, o Postgres
 *  responde `invalid input syntax for type uuid` e o Prisma embrulha isso em
 *  `P2023` (inconsistent column data). O `catch` não existe no caminho de leitura,
 *  então a exceção sobe e a página responde **500** — não 404.
 *
 *  O `if (!x) notFound()` que já existia em cada página nunca era alcançado: ele
 *  fica DEPOIS da consulta, e a consulta é justamente quem estoura. Daí a linha
 *  única no topo: o formato é pergunta de ENDEREÇO, e ela pode ser respondida sem
 *  tocar o banco. Recurso inexistente (uuid bem formado) continua sendo o 404 lá
 *  embaixo, na consulta — são duas perguntas diferentes e cada uma tem seu lugar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO É DE APLICAÇÃO, E NÃO DE DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA ("tem forma de uuid?") é pura e vive em `domain/validation/id-rules.ts`.
 *  A POLÍTICA ("formato inválido na URL = 404") depende do framework, e é aqui que
 *  `notFound()` é chamado. O domínio não importa `next/navigation`.
 *
 *  A política é a mesma para toda página, mas NÃO é a mesma para todo chamador: o
 *  filtro do acervo ignora um `evento` malformado (filtro não é endereço) e o
 *  formulário de segmento RECUSA, dizendo o motivo. Por isso eles usam `isUuid` e
 *  não este helper — cada um decide o que fazer com a resposta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Devolve o valor de `params[chave]` quando ele é um uuid, e interrompe a
 * renderização com `notFound()` quando não é.
 *
 * Cobre os quatro casos que o caminho de uma página pode receber:
 * ausente (`undefined`), vazio (`''`), repetido (`string[]`, que o Next expõe em
 * segmentos dinâmicos) e texto que não tem forma de uuid.
 */
export function requireUuidParam(
  params: Readonly<Record<string, string | string[] | undefined>>,
  chave: string,
): string {
  const value = params[chave];

  /**
   * O array é recusado mesmo que o primeiro item seja um uuid: a URL com o segmento
   * repetido não tem UM id, tem vários, e escolher o primeiro em silêncio seria
   * inventar qual recurso a pessoa pediu.
   */
  if (typeof value !== 'string' || !isUuid(value)) notFound();

  return value;
}
