/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — fuso do agendamento, janela de exibição e sincronia de
 *  patrocinador (FASE 24, itens E15, E16 e E17)
 *
 *  O foco é o que erra em silêncio:
 *    • conversão de hora de parede + fuso (com horário de verão);
 *    • janela de exibição (término antes do início, término vencido);
 *    • sincronia (só os campos da EMPRESA, com o que muda identificado).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  formatZonedDateTime,
  instantToZonedWallTime,
  isValidTimeZone,
  processTimeZone,
  zoneOffsetMinutes,
  zonedWallTimeToInstant,
} from '../../src/domain/events/scheduling-rules';
import {
  PUBLICATION_STATE_LABELS,
  planPublication,
  resolvePublicationState,
} from '../../src/domain/events/landing-page';
import { planSponsorSync } from '../../src/domain/events/sponsor-rules';

const NOW = new Date('2026-09-18T12:00:00.000Z');
const inDays = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

// ═══════════════════════════════════════════════════════════════════════════════
describe('fusos (E17)', () => {
  it('reconhece fuso válido e recusa o resto', () => {
    expect(isValidTimeZone('America/Bahia')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('Marte/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('calcula o deslocamento do fuso (Brasília é UTC-3)', () => {
    expect(zoneOffsetMinutes('America/Bahia', NOW)).toBe(-180);
    expect(zoneOffsetMinutes('UTC', NOW)).toBe(0);
  });

  it('converte hora de parede no fuso do evento — o defeito que motivou o item', () => {
    /**
     * O organizador digita "seis da tarde" em Salvador. Antes, `new Date(texto)`
     * interpretava isso em UTC (fuso do processo) e a página entrava no ar às 15h de
     * Salvador. Agora 18:00 em America/Bahia é 21:00 UTC.
     */
    const instant = zonedWallTimeToInstant('2026-12-01T18:00', 'America/Bahia');
    expect(instant?.toISOString()).toBe('2026-12-01T21:00:00.000Z');
  });

  it('converte no fuso do evento e não no do processo', () => {
    const bahia = zonedWallTimeToInstant('2026-12-01T18:00', 'America/Bahia');
    const utc = zonedWallTimeToInstant('2026-12-01T18:00', 'UTC');

    expect(bahia?.toISOString()).not.toBe(utc?.toISOString());
    expect(bahia!.getTime() - utc!.getTime()).toBe(3 * 3_600_000);
  });

  it('o caminho de volta devolve a MESMA hora de parede (ida e volta)', () => {
    for (const zone of ['America/Bahia', 'UTC', 'America/Sao_Paulo', 'Europe/Lisbon']) {
      const instant = zonedWallTimeToInstant('2026-12-01T18:30', zone);
      expect(instant).not.toBeNull();
      expect(instantToZonedWallTime(instant!, zone)).toBe('2026-12-01T18:30');
    }
  });

  it('lida com HORÁRIO DE VERÃO (o deslocamento muda com a data)', () => {
    /**
     * Lisboa está em UTC+0 no inverno e UTC+1 no verão. A conversão precisa usar o
     * deslocamento DA DATA, e não o de hoje — é o que a segunda passagem garante.
     */
    const winter = zonedWallTimeToInstant('2026-01-15T12:00', 'Europe/Lisbon');
    const summer = zonedWallTimeToInstant('2026-07-15T12:00', 'Europe/Lisbon');

    expect(winter?.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(summer?.toISOString()).toBe('2026-07-15T11:00:00.000Z');
  });

  it('recusa texto inválido e fuso desconhecido em vez de inventar data', () => {
    expect(zonedWallTimeToInstant('01/12/2026 18:00', 'America/Bahia')).toBeNull();
    expect(zonedWallTimeToInstant('', 'America/Bahia')).toBeNull();
    expect(zonedWallTimeToInstant('2026-12-01T18:00', 'Marte/Olympus')).toBeNull();
  });

  it('formata para leitura em pt-BR no fuso do evento', () => {
    const instant = new Date('2026-12-01T21:00:00.000Z');
    expect(formatZonedDateTime(instant, 'America/Bahia')).toContain('18:00');
    expect(formatZonedDateTime(instant, 'UTC')).toContain('21:00');
  });

  it('sempre há um fuso de processo (usado como último recurso)', () => {
    expect(processTimeZone().length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('janela de exibição (E16)', () => {
  it('publica agora com data de término mantida', () => {
    const plan = planPublication({
      publishNow: true,
      publishAt: null,
      unpublishAt: inDays(10),
      now: NOW,
      timeZone: 'America/Bahia',
    });

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('PUBLISHED');
      expect(plan.unpublishAt?.getTime()).toBe(inDays(10).getTime());
      expect(plan.message).toContain('Sai do ar');
    }
  });

  it('agenda entrada E saída, dizendo as duas datas', () => {
    const plan = planPublication({
      publishNow: false,
      publishAt: inDays(3),
      unpublishAt: inDays(10),
      now: NOW,
      timeZone: 'America/Bahia',
    });

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('SCHEDULED');
      expect(plan.message).toContain('entra no ar');
      expect(plan.message).toContain('sai do ar');
    }
  });

  it('RECUSA término antes do início', () => {
    const plan = planPublication({
      publishNow: false,
      publishAt: inDays(10),
      unpublishAt: inDays(3),
      now: NOW,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('depois da data de entrada');
  });

  it('RECUSA término já vencido ao publicar agora', () => {
    /**
     * Aceitar gravaria uma página "publicada" que nunca aparece — a tela diria uma
     * coisa e o site faria outra.
     */
    const plan = planPublication({
      publishNow: true,
      publishAt: null,
      unpublishAt: inDays(-1),
      now: NOW,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain('no futuro');
  });

  it('DESPUBLICAR limpa as DUAS datas', () => {
    const plan = planPublication({
      publishNow: false,
      publishAt: null,
      unpublishAt: inDays(5),
      now: NOW,
    });

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.state).toBe('DRAFT');
      expect(plan.publishAt).toBeNull();
      expect(plan.unpublishAt).toBeNull();
    }
  });

  it('estado resolvido: dentro da janela, agendada e encerrada', () => {
    expect(
      resolvePublicationState({ isPublished: true, publishAt: null, unpublishAt: inDays(1) }, NOW),
    ).toBe('PUBLISHED');

    expect(
      resolvePublicationState(
        { isPublished: false, publishAt: inDays(1), unpublishAt: inDays(5) },
        NOW,
      ),
    ).toBe('SCHEDULED');

    expect(
      resolvePublicationState(
        { isPublished: true, publishAt: null, unpublishAt: inDays(-1) },
        NOW,
      ),
    ).toBe('WINDOW_CLOSED');

    // Entrada agendada que já venceu e término também: encerrada.
    expect(
      resolvePublicationState(
        { isPublished: false, publishAt: inDays(-5), unpublishAt: inDays(-1) },
        NOW,
      ),
    ).toBe('WINDOW_CLOSED');

    expect(
      resolvePublicationState({ isPublished: false, publishAt: null, unpublishAt: null }, NOW),
    ).toBe('DRAFT');
  });

  it('todo estado tem rótulo em pt-BR', () => {
    for (const state of ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'WINDOW_CLOSED'] as const) {
      expect(PUBLICATION_STATE_LABELS[state]).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sincronia de patrocinador (E15)', () => {
  const source = {
    name: 'Instituto de Tecnologia Aberta',
    description: 'Apoiadora do congresso.',
    websiteUrl: 'https://example.org/ita',
    logoUrl: 'https://cdn.test/ita-v2.png',
    contactName: 'Marina Alves',
    contactEmail: 'marina@example.org',
    contactPhone: '+55 71 99999-0000',
    taxId: '12345678000199',
  };

  it('identifica SÓ o que mudou', () => {
    const plan = planSponsorSync(source, {
      ...source,
      websiteUrl: 'https://example.org/antigo',
      logoUrl: null,
    });

    expect(plan.isEmpty).toBe(false);
    expect(Object.keys(plan.changes).sort()).toEqual(['logoUrl', 'websiteUrl']);
    expect(plan.changes.websiteUrl).toEqual({
      from: 'https://example.org/antigo',
      to: 'https://example.org/ita',
    });
    expect(plan.changes.logoUrl).toEqual({ from: null, to: 'https://cdn.test/ita-v2.png' });
  });

  it('sem diferença, não há o que fazer', () => {
    const plan = planSponsorSync(source, { ...source });
    expect(plan.isEmpty).toBe(true);
    expect(plan.changes).toEqual({});
  });

  it('texto vazio e ausente são a mesma coisa (o formulário devolve string vazia)', () => {
    const plan = planSponsorSync({ ...source, description: '' }, { ...source, description: null });
    expect(plan.changes.description).toBeUndefined();
  });

  it('NUNCA toca em cota, contrato, exibição ou ordem', () => {
    /**
     * Sincronizar é propagar os dados da EMPRESA. Cota, valor do contrato, vigência,
     * ordem e exibição são de cada edição — e o plano não tem sequer os campos.
     */
    const plan = planSponsorSync(source, source);
    for (const forbidden of [
      'tierId',
      'contractValueCents',
      'contractStart',
      'contractEnd',
      'isActive',
      'displayOrder',
      'slug',
    ]) {
      expect(Object.keys(plan.changes)).not.toContain(forbidden);
    }
  });
});
