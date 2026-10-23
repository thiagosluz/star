/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILTRO MALFORMADO É FILTRO IGNORADO — E ANUNCIADO (FASE 76 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Id no CAMINHO é endereço (formato inválido = 404). Id na QUERY é FILTRO: a lista
 *  existe com ou sem ele. Malformado, o filtro é descartado — e a tela ANUNCIA, em
 *  vez de mostrar a lista inteira como se o recorte tivesse valido.
 *
 *  Este teste é puro: nenhum banco, nenhum Next. Ele prende a decisão e a FRASE
 *  (que é conteúdo de produto e aparece em três telas) antes de qualquer render.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  discardedFilterNotice,
  resolveUuidQueryFilter,
} from '../../src/domain/validation/query-filter-rules';
import { parseMediaSourceEvent } from '../../src/domain/events/media-filter-rules';

const UUID = '3f6c8a10-9d2b-4e7a-8c51-0a1b2c3d4e5f';

describe('resolveUuidQueryFilter — ausência não é erro', () => {
  it('sem valor, vazio ou só espaço não há filtro nem aviso', () => {
    /**
     * Abrir a tela sem filtrar é o estado normal. Devolver um aviso aqui ensinaria a
     * pessoa a ignorar o aviso — e a regra da casa é anunciar o que foi ESCONDIDO.
     */
    expect(resolveUuidQueryFilter({ value: undefined, label: 'evento' })).toBeNull();
    expect(resolveUuidQueryFilter({ value: null, label: 'evento' })).toBeNull();
    expect(resolveUuidQueryFilter({ value: '', label: 'evento' })).toBeNull();
    expect(resolveUuidQueryFilter({ value: '   ', label: 'evento' })).toBeNull();
  });
});

describe('resolveUuidQueryFilter — valor com forma de uuid é aplicado', () => {
  it('aplica o uuid', () => {
    expect(resolveUuidQueryFilter({ value: UUID, label: 'evento' })).toEqual({
      kind: 'applied',
      value: UUID,
    });
  });

  it('limpa o espaço em volta — URL copiada à mão é o caso comum', () => {
    /**
     * `isUuid` não faz `trim` de propósito (endereço não tem espaço). Para FILTRO, a
     * política é limpar: `" <uuid> "` é a mesma intenção, e recusá-la seria inventar
     * um 500 por um espaço invisível — que é o defeito que esta fatia fecha.
     */
    expect(resolveUuidQueryFilter({ value: `  ${UUID}  `, label: 'evento' })).toEqual({
      kind: 'applied',
      value: UUID,
    });
  });

  it('aceita sentinelas declarados pelo chamador (o acervo tem "sem-evento")', () => {
    expect(
      resolveUuidQueryFilter({
        value: 'sem-evento',
        label: 'evento de origem',
        extraValues: ['sem-evento'],
      }),
    ).toEqual({ kind: 'applied', value: 'sem-evento' });
  });
});

describe('resolveUuidQueryFilter — malformado é descartado e anunciado', () => {
  it('texto que não é uuid vira descarte com a frase do domínio', () => {
    const decision = resolveUuidQueryFilter({ value: 'nao-e-uuid', label: 'evento' });

    expect(decision).toEqual({
      kind: 'discarded',
      notice: discardedFilterNotice('evento'),
    });
  });

  it('um uuid truncado também é descarte, não "quase um id"', () => {
    expect(resolveUuidQueryFilter({ value: UUID.slice(0, -1), label: 'modelo' })?.kind).toBe(
      'discarded',
    );
  });

  it('parâmetro repetido é descarte — não existe UM filtro pedido', () => {
    /**
     * O Next expõe `?evento=a&evento=b` como array. Escolher o primeiro em silêncio
     * inventaria o recorte; a regra descarta e anuncia, como no valor torto.
     */
    expect(
      resolveUuidQueryFilter({ value: [UUID, randomUUID()], label: 'evento' }),
    ).toEqual({ kind: 'discarded', notice: discardedFilterNotice('evento') });

    expect(resolveUuidQueryFilter({ value: [], label: 'evento' })).toBeNull();
  });

  it('a frase diz que o filtro NÃO foi aplicado e por quê', () => {
    expect(discardedFilterNotice('evento')).toBe(
      'O filtro por evento foi descartado: o identificador no endereço não é válido. A lista continua sem esse filtro.',
    );
    expect(discardedFilterNotice('modelo')).toContain('filtro por modelo');
    expect(discardedFilterNotice('evento de origem')).toContain('filtro por evento de origem');
  });
});

describe('parseMediaSourceEvent — a tela e o serviço usam a MESMA decisão', () => {
  it('continua devolvendo o id, o sentinela e null como antes', () => {
    const eventId = randomUUID();

    expect(parseMediaSourceEvent(eventId)).toBe(eventId);
    expect(parseMediaSourceEvent(` ${eventId} `)).toBe(eventId);
    expect(parseMediaSourceEvent('sem-evento')).toBe('sem-evento');
    expect(parseMediaSourceEvent('nao-e-uuid')).toBeNull();
    expect(parseMediaSourceEvent('')).toBeNull();
    expect(parseMediaSourceEvent(undefined)).toBeNull();
  });

  it('o que o serviço descarta é exatamente o que a tela anuncia', () => {
    /**
     * A garantia contra divergência: se `parseMediaSourceEvent` devolve `null` para um
     * valor PRESENTE, a decisão da tela tem de ser "discarded". Sem isso, a lista
     * poderia ser alargada sem aviso (o defeito original do acervo).
     */
    for (const value of ['nao-e-uuid', 'abc', '123', 'sem-evento-x']) {
      expect(parseMediaSourceEvent(value)).toBeNull();
      expect(
        resolveUuidQueryFilter({
          value,
          label: 'evento de origem',
          extraValues: ['sem-evento'],
        })?.kind,
      ).toBe('discarded');
    }
  });
});
