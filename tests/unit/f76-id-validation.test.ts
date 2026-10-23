/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ID DO ENDEREÇO — A REGRA PURA E A POLÍTICA DO 404 (FASE 76 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito medido na fase: 42 URLs com `nao-e-uuid` respondiam 500 (25 delas),
 *  200 com painel de erro (5) ou 400 — quase nunca 404. A causa é sempre a mesma:
 *  o valor do caminho ia direto para `where: { id }`, o Prisma o convertia para o
 *  tipo `uuid` e o Postgres lançava `invalid input syntax for type uuid` (`P2023`).
 *  O `if (!x) notFound()` que já existia em cada página ficava DEPOIS da consulta e
 *  nunca era alcançado.
 *
 *  A correção tem duas metades que este teste separa de propósito:
 *
 *    • `isUuid` — a REGRA de formato, pura, sem framework (e sem `trim`: quem
 *      limpa o texto é o chamador, com a política dele);
 *    • `requireUuidParam` — a POLÍTICA "formato inválido no caminho = 404",
 *      que precisa do `notFound()` do Next.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `notFound()` É DUBLADO, E NÃO CHAMADO DE VERDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Fora de uma requisição do Next, `notFound()` lança o erro interno do framework
 *  (que depende do roteador). O dublê troca a exceção por um sentinela —
 *  `NEXT_NOT_FOUND` —, que é exatamente o que a página renderizada observa no teste
 *  de integração. Aqui o que se prova é a REGRA de quando ele é chamado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { isUuid } from '../../src/domain/validation/id-rules';
import { requireUuidParam } from '../../src/lib/validation/id';
import { parseMediaSourceEvent } from '../../src/domain/events/media-filter-rules';
import { parseSegmentParams, segmentCondition } from '../../src/domain/communication/segments';
import { isSegmentEventIdShaped } from '../../src/lib/communication/segment-form';

/** `notFound()` interrompe a renderização: é o sentinela que o teste observa. */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/**
 * Um uuid VÁLIDO e estável, montado à mão: os testes de formato não podem depender
 * do gerador (se `randomUUID` mudasse de versão, o caso continuaria sendo um uuid).
 */
const UUID = '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const UUID_CAIXA_ALTA = '3F1A2B4C-5D6E-4F70-8A9B-0C1D2E3F4A5B';
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

describe('isUuid — a forma canônica', () => {
  it('aceita uuid em caixa baixa, em caixa alta e o nil uuid', () => {
    /**
     * A regex é a MESMA dos três módulos que tinham a cópia (a flag `i` aceita
     * maiúsculas), e o Postgres aceita as duas formas. O nil uuid é forma válida
     * de uuid: recusá-lo seria inventar uma regra que o banco não tem.
     */
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid(UUID_CAIXA_ALTA)).toBe(true);
    expect(isUuid(NIL_UUID)).toBe(true);
  });

  it('aceita o uuid que o projeto gera de verdade', () => {
    expect(isUuid(randomUUID())).toBe(true);
  });

  it('recusa o texto que o Postgres recusaria', () => {
    expect(isUuid('nao-e-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('   ')).toBe(false);
    // Sem hífens, truncado, com caractere a mais e com prefixo: todos casariam um
    // teste frouxo (sem âncora) e todos estourariam a consulta de verdade.
    expect(isUuid(UUID.replace(/-/g, ''))).toBe(false);
    expect(isUuid(UUID.slice(0, -1))).toBe(false);
    expect(isUuid(`${UUID}a`)).toBe(false);
    expect(isUuid(`prefixo-${UUID}`)).toBe(false);
  });

  it('recusa uuid com chaves ou com espaço em volta (não faz trim)', () => {
    /**
     * `{<uuid>}` e `" <uuid> "` são jeitos comuns de um id colado à mão. Nenhum dos
     * dois é um uuid — e o `trim` NÃO é daqui: é política do chamador que recebe
     * texto digitado. Se `isUuid` limpasse sozinho, o valor validado e o valor usado
     * poderiam ser diferentes, que é a família de defeito que esta fase conserta.
     */
    expect(isUuid(`{${UUID}}`)).toBe(false);
    expect(isUuid(` ${UUID} `)).toBe(false);
    expect(isUuid(`${UUID}\n`)).toBe(false);
  });

  it('recusa valores que nem são texto', () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid({})).toBe(false);
    expect(isUuid([UUID])).toBe(false);
  });

  it('recusa uma string longa, mesmo que comece com um uuid', () => {
    const longa = `${UUID}-${'a'.repeat(500)}`;
    expect(isUuid(longa)).toBe(false);
  });
});

describe('requireUuidParam — formato inválido é 404, antes de consultar', () => {
  it('devolve o valor quando ele é um uuid', () => {
    expect(requireUuidParam({ eventId: UUID }, 'eventId')).toBe(UUID);
  });

  it('ignora as outras chaves do caminho', () => {
    expect(
      requireUuidParam({ tenantSlug: 'ufba-demo', eventId: UUID }, 'eventId'),
    ).toBe(UUID);
  });

  it('interrompe quando o parâmetro está ausente', () => {
    expect(() => requireUuidParam({}, 'eventId')).toThrow('NEXT_NOT_FOUND');
  });

  it('interrompe quando o parâmetro está vazio', () => {
    expect(() => requireUuidParam({ eventId: '' }, 'eventId')).toThrow('NEXT_NOT_FOUND');
  });

  it('interrompe quando o parâmetro chega como array', () => {
    /**
     * O Next expõe segmentos repetidos como `string[]`. Escolher o primeiro item em
     * silêncio seria inventar qual recurso a pessoa pediu — e um array com um uuid
     * válido dentro NÃO é um pedido de recurso único. A recusa é a resposta honesta.
     */
    expect(() => requireUuidParam({ eventId: [UUID] }, 'eventId')).toThrow('NEXT_NOT_FOUND');
    expect(() => requireUuidParam({ eventId: [UUID, UUID] }, 'eventId')).toThrow('NEXT_NOT_FOUND');
  });

  it('interrompe quando o parâmetro não tem forma de uuid', () => {
    expect(() => requireUuidParam({ eventId: 'nao-e-uuid' }, 'eventId')).toThrow('NEXT_NOT_FOUND');
    expect(() => requireUuidParam({ eventId: UUID.slice(0, -1) }, 'eventId')).toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(() => requireUuidParam({ eventId: ` ${UUID} ` }, 'eventId')).toThrow('NEXT_NOT_FOUND');
  });

  it('valida a chave pedida, e não "algum" parâmetro', () => {
    expect(
      requireUuidParam({ eventId: UUID, demandId: 'nao-e-uuid' }, 'eventId'),
    ).toBe(UUID);

    expect(() =>
      requireUuidParam({ eventId: UUID, demandId: 'nao-e-uuid' }, 'demandId'),
    ).toThrow('NEXT_NOT_FOUND');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS TRÊS CÓPIAS DA REGEX — A POLÍTICA DE CADA CHAMADOR CONTINUA DELE
 *
 *  A fase matou três cópias da mesma regex, mas NÃO unificou a decisão: um
 *  chamador descarta o valor malformado (filtro não é endereço), outro o RECUSA
 *  (seleção de campanha não pode crescer em silêncio) e outro só pergunta a forma.
 *  Os casos abaixo existem para provar que a troca da regex por `isUuid` não mudou
 *  nenhuma dessas políticas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('as três cópias da regex — a política preservada', () => {
  it('o filtro do acervo faz trim e DESCARTA o malformado (não recusa)', () => {
    expect(parseMediaSourceEvent(` ${UUID} `)).toBe(UUID);
    expect(parseMediaSourceEvent(UUID_CAIXA_ALTA)).toBe(UUID_CAIXA_ALTA);
    expect(parseMediaSourceEvent('nao-e-uuid')).toBeNull();
    expect(parseMediaSourceEvent('')).toBeNull();
    expect(parseMediaSourceEvent(undefined)).toBeNull();
  });

  it('o parâmetro de segmento faz trim, BAIXA a caixa e RECUSA o malformado', () => {
    const condicao = segmentCondition('inscrito-na-atividade');
    if (!condicao) throw new Error('Condição do catálogo não encontrada');

    const aceito = parseSegmentParams(condicao, { atividade: ` ${UUID_CAIXA_ALTA} ` });
    expect(aceito.ok).toBe(true);
    expect(aceito.values.atividade).toBe(UUID);

    const recusado = parseSegmentParams(condicao, { atividade: 'nao-e-uuid' });
    expect(recusado.ok).toBe(false);
    expect(recusado.problems.join(' ')).toContain('Valor inválido');
  });

  it('a forma do evento do formulário aceita AUSENTE e recusa torto (sem trim)', () => {
    expect(isSegmentEventIdShaped(null)).toBe(true);
    expect(isSegmentEventIdShaped(UUID)).toBe(true);
    expect(isSegmentEventIdShaped(UUID_CAIXA_ALTA)).toBe(true);
    expect(isSegmentEventIdShaped('nao-e-uuid')).toBe(false);
    expect(isSegmentEventIdShaped('')).toBe(false);
    expect(isSegmentEventIdShaped(` ${UUID} `)).toBe(false);
  });
});
