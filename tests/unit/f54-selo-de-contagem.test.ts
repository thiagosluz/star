/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O selo de contagem das áreas (FASE 54)
 *
 *  O selo é a única frase da tela que o organizador lê sem clique, e é onde é fácil
 *  mentir sem perceber: "1 chamadas", "0 itens", ou um número que a consulta nem
 *  fez. Aqui se prova, sem banco e sem navegador, que cada área ganha o texto certo
 *  — singular, plural, zero com sentido — e que `null` (não conferido) vira **nada**.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  EMPTY_EVENT_AREA_COUNTS,
  EVENT_AREAS,
  eventAreaMetric,
  type EventAreaCounts,
} from '../../src/domain/events/event-areas';

const contagens = (patch: Partial<EventAreaCounts> = {}): EventAreaCounts => ({
  ...EMPTY_EVENT_AREA_COUNTS,
  ...patch,
});

describe('selo de contagem por área', () => {
  it('tudo desconhecido não produz selo nenhum (nem "0")', () => {
    for (const area of EVENT_AREAS) {
      expect(eventAreaMetric(area.id, EMPTY_EVENT_AREA_COUNTS), `área ${area.id}`).toBeNull();
    }
  });

  it('zero é RESPOSTA: diz que falta criar, em vez de desaparecer', () => {
    expect(eventAreaMetric('chamadas', contagens({ calls: 0 }))).toBe('nenhuma chamada');
    expect(eventAreaMetric('salas', contagens({ rooms: 0 }))).toBe('nenhuma sala');
    expect(eventAreaMetric('programacao', contagens({ activities: 0 }))).toBe('nenhuma atividade');
    expect(eventAreaMetric('crachas', contagens({ credentials: 0 }))).toBe('nenhum crachá emitido');
    expect(eventAreaMetric('confirmacoes', contagens({ pendingConfirmations: 0 }))).toBe(
      'nenhuma vaga retida',
    );
  });

  it('um é singular e dois é plural (o produto não pode parecer quebrado no primeiro uso)', () => {
    expect(eventAreaMetric('programacao', contagens({ activities: 1 }))).toBe('1 atividade');
    expect(eventAreaMetric('programacao', contagens({ activities: 4 }))).toBe('4 atividades');
    expect(eventAreaMetric('salas', contagens({ rooms: 1 }))).toBe('1 sala');
    expect(eventAreaMetric('salas', contagens({ rooms: 3 }))).toBe('3 salas');
    expect(eventAreaMetric('chamadas', contagens({ calls: 1 }))).toBe('1 chamada');
    expect(eventAreaMetric('chamadas', contagens({ calls: 2 }))).toBe('2 chamadas');
    expect(eventAreaMetric('patrocinadores', contagens({ sponsors: 1 }))).toBe('1 patrocinador');
    expect(eventAreaMetric('patrocinadores', contagens({ sponsors: 4 }))).toBe('4 patrocinadores');
    expect(eventAreaMetric('palestrantes', contagens({ speakers: 1 }))).toBe('1 palestrante');
    expect(eventAreaMetric('demandas', contagens({ openDemands: 1 }))).toBe('1 demanda aberta');
    expect(eventAreaMetric('certificados', contagens({ certificates: 1 }))).toBe('1 certificado');
  });

  it('a fila de confirmações fala de VAGA RETIDA — a palavra que explica por que importa', () => {
    expect(eventAreaMetric('confirmacoes', contagens({ pendingConfirmations: 3 }))).toBe(
      '3 vagas retidas',
    );
  });

  it('a página não é contagem, é ESTADO', () => {
    expect(eventAreaMetric('pagina', contagens({ pagePublished: true }))).toBe('publicada');
    expect(eventAreaMetric('pagina', contagens({ pagePublished: false }))).toBe('em rascunho');
    expect(eventAreaMetric('pagina', contagens({ pagePublished: null }))).toBeNull();
  });

  it('a vitrine pública e os sorteios ficam sem selo — não há o que contar', () => {
    expect(eventAreaMetric('publico', contagens({ calls: 5 }))).toBeNull();
    expect(eventAreaMetric('sorteios', contagens({ calls: 5 }))).toBeNull();
  });

  it('cada contagem alimenta UMA área — o selo não vaza de um cartão para o outro', () => {
    const cheio = contagens({
      calls: 2,
      teams: 3,
      sponsors: 4,
      speakers: 5,
      openDemands: 6,
      credentials: 7,
      certificates: 8,
      pendingConfirmations: 9,
    });

    expect(eventAreaMetric('chamadas', cheio)).toBe('2 chamadas');
    expect(eventAreaMetric('equipes', cheio)).toBe('3 equipes');
    expect(eventAreaMetric('patrocinadores', cheio)).toBe('4 patrocinadores');
    expect(eventAreaMetric('palestrantes', cheio)).toBe('5 palestrantes');
    expect(eventAreaMetric('demandas', cheio)).toBe('6 demandas abertas');
    expect(eventAreaMetric('crachas', cheio)).toBe('7 crachás emitidos');
    expect(eventAreaMetric('certificados', cheio)).toBe('8 certificados');
    expect(eventAreaMetric('confirmacoes', cheio)).toBe('9 vagas retidas');
  });

  it('o selo do crachá usa o plural com acento correto', () => {
    expect(eventAreaMetric('crachas', contagens({ credentials: 3 }))).toBe('3 crachás emitidos');
  });
});
