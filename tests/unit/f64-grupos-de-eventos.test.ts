/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Os três grupos de eventos da página da instituição
 *                                                       (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra dos três grupos é uma CONTA DE BORDAS. Todo o resto da página pode estar
 *  certo e ela ainda errar em dois instantes: o evento que começa exatamente agora e
 *  o que termina exatamente agora. Um erro aqui não quebra nada — ele põe um evento
 *  acabado em "acontecendo agora", e ninguém percebe até alguém reclamar.
 *
 *  Por isso a lista de casos é explícita, com o instante e a fronteira:
 *  • começa EXATAMENTE agora  → `em breve`;
 *  • termina EXATAMENTE agora → `antigo`;
 *  • sem data                 → `em breve` (não some de todos os grupos);
 *  • fuso da instituição ≠ servidor → a classificação não muda, a DATA escrita muda.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  TENANT_GROUP_DEFAULT_LIMIT,
  TENANT_GROUP_MAX_LIMIT,
  classifyTenantEvent,
  formatTenantEventPeriod,
  groupTenantEvents,
  normalizeGroupLimit,
  type TenantEventDateSource,
} from '../../src/domain/tenancy/tenant-event-groups';

const AGORA = new Date('2026-11-10T12:00:00.000Z');

/** Um evento completo, com o status público padrão — o caso feliz. */
function evento(patch: Partial<TenantEventDateSource> = {}): TenantEventDateSource {
  return {
    id: 'evt-1',
    slug: 'evt-1',
    title: 'Evento',
    startsAt: new Date('2026-11-10T13:00:00.000Z'),
    endsAt: new Date('2026-11-10T18:00:00.000Z'),
    status: 'PUBLISHED',
    ...patch,
  };
}

const grupos = (eventos: readonly TenantEventDateSource[], limit?: unknown) =>
  groupTenantEvents(eventos, { now: AGORA, timeZone: 'America/Bahia', limit });

describe('classificação de um evento pelos três grupos', () => {
  it('começa depois de agora é `em breve`', () => {
    expect(
      classifyTenantEvent(
        { startsAt: new Date('2026-11-10T12:00:01.000Z'), endsAt: new Date('2026-11-10T20:00:00.000Z') },
        AGORA,
      ),
    ).toBe('UPCOMING');
  });

  it('começa EXATAMENTE agora NÃO é `em breve` — já está acontecendo (a janela é fechada no início)', () => {
    expect(
      classifyTenantEvent(
        { startsAt: AGORA, endsAt: new Date('2026-11-10T20:00:00.000Z') },
        AGORA,
      ),
    ).toBe('ONGOING');
  });

  it('a janela contém agora é `acontecendo`', () => {
    expect(
      classifyTenantEvent(
        { startsAt: new Date('2026-11-10T11:00:00.000Z'), endsAt: new Date('2026-11-10T13:00:00.000Z') },
        AGORA,
      ),
    ).toBe('ONGOING');
  });

  it('termina EXATAMENTE agora já é `antigo` (a janela é aberta no fim)', () => {
    expect(
      classifyTenantEvent(
        { startsAt: new Date('2026-11-10T08:00:00.000Z'), endsAt: AGORA },
        AGORA,
      ),
    ).toBe('PAST');
  });

  it('terminou antes de agora é `antigo`', () => {
    expect(
      classifyTenantEvent(
        { startsAt: new Date('2026-11-09T08:00:00.000Z'), endsAt: new Date('2026-11-09T18:00:00.000Z') },
        AGORA,
      ),
    ).toBe('PAST');
  });

  it('sem data nenhuma vai para `em breve` — o evento existe e não pode desaparecer', () => {
    /**
     * A borda é de DADO AUSENTE (`Event.startsAt`/`endsAt` são NOT NULL no modelo).
     * O cast existe porque o tipo declara o campo obrigatório — é justamente o
     * objeto que NÃO deveria existir que a regra precisa saber tratar.
     */
    const semData = { startsAt: undefined, endsAt: undefined } as unknown as {
      startsAt: Date;
      endsAt: Date;
    };

    expect(classifyTenantEvent(semData, AGORA)).toBe('UPCOMING');
  });

  it('só com fim usa o fim como janela', () => {
    const soFim = (endsAt: Date) => ({ startsAt: undefined, endsAt }) as unknown as { startsAt: Date; endsAt: Date };

    expect(classifyTenantEvent(soFim(AGORA), AGORA)).toBe('PAST');
    expect(classifyTenantEvent(soFim(new Date('2026-11-10T13:00:00.000Z')), AGORA)).toBe('ONGOING');
  });

  it('só com início: ainda não começou é `em breve`, e já começou sem fim é `acontecendo`', () => {
    const soInicio = (startsAt: Date) => ({ startsAt, endsAt: undefined }) as unknown as { startsAt: Date; endsAt: Date };

    expect(classifyTenantEvent(soInicio(new Date('2026-11-10T13:00:00.000Z')), AGORA)).toBe('UPCOMING');
    expect(classifyTenantEvent(soInicio(AGORA), AGORA)).toBe('ONGOING');
    expect(classifyTenantEvent(soInicio(new Date('2026-11-10T11:00:00.000Z')), AGORA)).toBe('ONGOING');
  });
});

describe('o fuso da instituição entra na APRESENTAÇÃO, não na conta', () => {
  it('o MESMO instante é classificado igual, mesmo com o fuso da casa longe do servidor', () => {
    const eventoNoFuso = { startsAt: new Date('2026-11-10T11:00:00.000Z'), endsAt: new Date('2026-11-10T13:00:00.000Z') };

    /** Tóquio (+9) e Bahia (−3) leem o mesmo instante; a janela não muda. */
    expect(
      groupTenantEvents([evento(eventoNoFuso)], {
        now: AGORA,
        timeZone: 'Asia/Tokyo',
        limit: 6,
      }).ongoing.total,
    ).toBe(1);

    expect(
      groupTenantEvents([evento(eventoNoFuso)], {
        now: AGORA,
        timeZone: 'America/Bahia',
        limit: 6,
      }).ongoing.total,
    ).toBe(1);
  });

  it('a data é escrita no fuso da instituição (11:00Z é 08:00 em Salvador)', () => {
    /** 2026-11-10 é um dia antes do início do horário de verão brasileiro (se houver). */
    const inicio = new Date('2026-11-10T11:00:00.000Z');
    const fim = new Date('2026-11-10T14:30:00.000Z');

    const label = formatTenantEventPeriod({ startsAt: inicio, endsAt: fim }, 'America/Bahia');

    expect(label).toContain('08:00');
    expect(label).toContain('11:30');
    expect(label).not.toContain('11:00');
  });

  it('o mesmo evento em Tóquio mostra a hora de Tóquio', () => {
    const inicio = new Date('2026-11-10T11:00:00.000Z');
    const semFim = { startsAt: inicio, endsAt: undefined } as unknown as { startsAt: Date; endsAt: Date };

    expect(formatTenantEventPeriod(semFim, 'Asia/Tokyo')).toContain('20:00');
  });

  it('um evento de outro dia escreve as duas datas', () => {
    const label = formatTenantEventPeriod(
      { startsAt: new Date('2026-11-10T11:00:00.000Z'), endsAt: new Date('2026-11-12T11:00:00.000Z') },
      'America/Bahia',
    );

    expect(label).toContain('até');
  });

  it('fuso inválido no banco não derruba a página: cai em UTC', () => {
    const semFim = {
      startsAt: new Date('2026-11-10T11:00:00.000Z'),
      endsAt: undefined,
    } as unknown as { startsAt: Date; endsAt: Date };

    const label = formatTenantEventPeriod(semFim, 'Fuso/Que-Nao-Existe');

    expect(label).toContain('11:00');
  });

  it('sem data o rótulo diz que a data está por definir', () => {
    const semData = { startsAt: undefined, endsAt: undefined } as unknown as {
      startsAt: Date;
      endsAt: Date;
    };

    expect(formatTenantEventPeriod(semData, 'America/Bahia')).toBe('Data a definir');
  });
});

describe('os grupos, com limite e contagem total', () => {
  const eventos: TenantEventDateSource[] = [
    evento({ id: 'a', slug: 'a', startsAt: new Date('2026-11-11T10:00:00.000Z'), endsAt: new Date('2026-11-11T18:00:00.000Z') }),
    evento({ id: 'b', slug: 'b', startsAt: new Date('2026-11-12T10:00:00.000Z'), endsAt: new Date('2026-11-12T18:00:00.000Z') }),
    evento({ id: 'c', slug: 'c', startsAt: new Date('2026-11-13T10:00:00.000Z'), endsAt: new Date('2026-11-13T18:00:00.000Z') }),
    evento({ id: 'd', slug: 'd', startsAt: new Date('2026-11-10T11:00:00.000Z'), endsAt: new Date('2026-11-10T13:00:00.000Z') }),
    evento({ id: 'e', slug: 'e', startsAt: new Date('2026-11-01T10:00:00.000Z'), endsAt: new Date('2026-11-01T18:00:00.000Z') }),
    evento({ id: 'f', slug: 'f', startsAt: new Date('2026-10-01T10:00:00.000Z'), endsAt: new Date('2026-10-01T18:00:00.000Z') }),
  ];

  it('separa os três grupos e conta o total de cada um', () => {
    const result = grupos(eventos);

    expect(result.upcoming.total).toBe(3);
    expect(result.ongoing.total).toBe(1);
    expect(result.past.total).toBe(2);
    expect(result.total).toBe(6);
  });

  it('o limite recorta os itens MAS o total continua sendo o de verdade (a lição da F54)', () => {
    const result = grupos(eventos, 2);

    expect(result.upcoming.items).toHaveLength(2);
    /** O "N de M" da tela sai do serviço — a tela NÃO reconta. */
    expect(result.upcoming.total).toBe(3);
    expect(result.upcoming.hasMore).toBe(true);
    expect(result.past.items).toHaveLength(2);
    expect(result.past.total).toBe(2);
    expect(result.past.hasMore).toBe(false);
  });

  it('os eventos do recorte são os MESMOS dos cartões — não há duas listas', () => {
    const result = grupos(eventos, 2);

    expect(result.upcoming.events.map((e) => e.id)).toEqual(result.upcoming.items.map((e) => e.id));
  });

  it('`em breve` ordena pelo PRÓXIMO primeiro', () => {
    expect(grupos(eventos).upcoming.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('`antigos` ordena pelo mais RECENTE primeiro', () => {
    expect(grupos(eventos).past.items.map((item) => item.id)).toEqual(['e', 'f']);
  });

  it('`acontecendo` marca o selo e os outros grupos não', () => {
    const result = grupos(eventos);

    expect(result.ongoing.items[0]?.isHappeningNow).toBe(true);
    expect(result.upcoming.items.every((item) => !item.isHappeningNow)).toBe(true);
  });

  it('evento não público NÃO entra em grupo nenhum nem no total', () => {
    const result = grupos([
      evento({ id: 'rascunho', status: 'DRAFT' }),
      evento({ id: 'arquivado', status: 'ARCHIVED' }),
      evento({ id: 'cancelado', status: 'CANCELED' }),
      evento({ id: 'publicado', status: 'PUBLISHED' }),
    ]);

    expect(result.total).toBe(1);
    expect(result.upcoming.items.map((item) => item.id)).toEqual(['publicado']);
  });

  it('o rótulo do período sai no cartão, já no fuso da instituição', () => {
    const result = grupos([evento({ startsAt: new Date('2026-11-10T11:00:00.000Z'), endsAt: new Date('2026-11-10T13:00:00.000Z') })]);
    const cartao = result.ongoing.items[0];

    expect(cartao?.periodLabel).toContain('08:00');
  });

  it('lista vazia não quebra: os três grupos existem com zero', () => {
    const result = grupos([]);

    expect(result.total).toBe(0);
    expect(result.upcoming.total).toBe(0);
    expect(result.upcoming.items).toEqual([]);
    expect(result.upcoming.hasMore).toBe(false);
  });

  it('empate de horário tem ordem ESTÁVEL (dois eventos no mesmo instante não trocam de lugar)', () => {
    const mesmoHorario = new Date('2026-11-20T10:00:00.000Z');
    const mesmoFim = new Date('2026-11-20T18:00:00.000Z');

    const primeira = grupos([
      evento({ id: 'z', startsAt: mesmoHorario, endsAt: mesmoFim }),
      evento({ id: 'a', startsAt: mesmoHorario, endsAt: mesmoFim }),
    ]);
    const segunda = grupos([
      evento({ id: 'a', startsAt: mesmoHorario, endsAt: mesmoFim }),
      evento({ id: 'z', startsAt: mesmoHorario, endsAt: mesmoFim }),
    ]);

    expect(primeira.upcoming.items.map((i) => i.id)).toEqual(['a', 'z']);
    expect(segunda.upcoming.items.map((i) => i.id)).toEqual(['a', 'z']);
  });

  it('evento sem data fica no FIM de `em breve` (não ocupa o lugar do próximo)', () => {
    const semData = evento({
      id: 'sem-data',
      startsAt: undefined as unknown as Date,
      endsAt: undefined as unknown as Date,
    });

    const result = grupos([
      semData,
      evento({ id: 'proximo', startsAt: new Date('2026-11-11T10:00:00.000Z'), endsAt: new Date('2026-11-11T18:00:00.000Z') }),
    ]);

    expect(result.upcoming.items.map((i) => i.id)).toEqual(['proximo', 'sem-data']);
  });
});

describe('normalização do limite pedido na URL', () => {
  it('sem valor usa o padrão; valor fora da faixa também', () => {
    expect(normalizeGroupLimit(undefined)).toBe(TENANT_GROUP_DEFAULT_LIMIT);
    expect(normalizeGroupLimit('')).toBe(TENANT_GROUP_DEFAULT_LIMIT);
    expect(normalizeGroupLimit('abc')).toBe(TENANT_GROUP_DEFAULT_LIMIT);
    expect(normalizeGroupLimit(0)).toBe(TENANT_GROUP_DEFAULT_LIMIT);
    expect(normalizeGroupLimit(-4)).toBe(TENANT_GROUP_DEFAULT_LIMIT);
    /** O teto existe para `?limite=100000` não virar uma consulta do acervo inteiro. */
    expect(normalizeGroupLimit(TENANT_GROUP_MAX_LIMIT + 1)).toBe(TENANT_GROUP_DEFAULT_LIMIT);
  });

  it('valor dentro da faixa é respeitado, inclusive como texto da query', () => {
    expect(normalizeGroupLimit(3)).toBe(3);
    expect(normalizeGroupLimit('3')).toBe(3);
    expect(normalizeGroupLimit(String(TENANT_GROUP_MAX_LIMIT))).toBe(TENANT_GROUP_MAX_LIMIT);
  });
});
