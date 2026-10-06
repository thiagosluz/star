/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A REGRA DE TELA DA ABA "SEGMENTOS" (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, E POR QUE CADA COISA É UM INVARIANTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • o formulário da URL vira a MESMA entrada que a composição do domínio usa, e
 *      um parâmetro vazio NÃO é parâmetro informado (o padrão declarado vale);
 *    • CONDIÇÃO DESCONHECIDA atravessa até o domínio e é RECUSADA lá: descartá-la
 *      em silêncio alargaria a seleção (fail-open numa tela de envio);
 *    • o "exceto quem…" vazio é ausência de exclusão, e não um erro do organizador;
 *    • o PASSO da tela segue a ordem que a tela promete: nada enviado = montar,
 *      recusa = mostrar o motivo, texto inválido = continuar editando (nunca
 *      "confirmar" com mensagem sem assunto);
 *    • o SNAPSHOT que viaja para o envio preserva as condições e os parâmetros — e
 *      um id desconhecido continua sendo recusado do outro lado;
 *    • o endereço da tela é reconstruído sem as chaves que o passo remove.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { composeSegment } from '../../src/domain/communication/segments';
import {
  SEGMENT_SLOT_COUNT,
  encodeSegmentDefinition,
  isSegmentEventIdShaped,
  segmentExceptParamField,
  segmentFormCompositionInput,
  segmentFormFromSearchParams,
  segmentQuery,
  segmentScreenStep,
  segmentSlotField,
  segmentSlotParamField,
} from '../../src/lib/communication/segment-form';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// ───────────────────────────────────────────────────────────────────────────────
describe('o formulário da URL vira a entrada da composição', () => {
  it('lê os filtros, os parâmetros por filtro e a exclusão', () => {
    const state = segmentFormFromSearchParams({
      aba: 'segmentos',
      segmento: '1',
      evento: UUID_A,
      [segmentSlotField(0)]: 'inscrito-na-atividade',
      [segmentSlotParamField(0, 'atividade')]: UUID_B,
      [segmentSlotField(1)]: 'minutos-abaixo',
      [segmentSlotParamField(1, 'minutos')]: '120',
      [segmentSlotField(2)]: '',
      exceto: 'xp-acima',
      [segmentExceptParamField('xp')]: '500',
      assunto: 'Vaga reservada',
      corpo: 'Confirme até sexta.',
      revisar: '1',
    });

    expect(state.submitted).toBe(true);
    expect(state.eventId).toBe(UUID_A);
    expect(state.slots).toHaveLength(SEGMENT_SLOT_COUNT);
    expect(state.slots[0]).toEqual({
      id: 'inscrito-na-atividade',
      values: { atividade: UUID_B },
    });
    expect(state.slots[1]).toEqual({ id: 'minutos-abaixo', values: { minutos: '120' } });
    expect(state.slots[2]).toBeNull();
    expect(state.except).toEqual({ id: 'xp-acima', values: { xp: '500' } });
    expect(state.subject).toBe('Vaga reservada');
    expect(state.body).toBe('Confirme até sexta.');
    expect(state.reviewing).toBe(true);
  });

  it('a tela em branco não é um envio — e não gera recusa nenhuma', () => {
    const state = segmentFormFromSearchParams({});

    expect(state.submitted).toBe(false);
    expect(state.eventId).toBeNull();
    expect(state.slots.every((slot) => slot === null)).toBe(true);
    expect(state.except).toBeNull();
    expect(state.reviewing).toBe(false);
  });

  /**
   * Parâmetro em branco é AUSENTE, e não "valor vazio": assim o padrão declarado no
   * catálogo vale (`manha` = 12:00) e o obrigatório sem valor é recusado com o
   * motivo do domínio, em vez de virar filtro com string vazia.
   */
  it('parâmetro em branco não entra — o padrão do catálogo vale', () => {
    const state = segmentFormFromSearchParams({
      segmento: '1',
      [segmentSlotField(0)]: 'presenca-manha-sem-tarde',
      [segmentSlotParamField(0, 'manha')]: '   ',
      [segmentSlotParamField(0, 'tarde')]: '18:00',
    });

    expect(state.slots[0]?.values).toEqual({ tarde: '18:00' });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.ok).toBe(true);
    expect(composition.definition.conditions[0]?.params).toEqual({ manha: '12:00', tarde: '18:00' });
  });

  it('o "exceto quem…" vazio é AUSÊNCIA de exclusão (e não erro do organizador)', () => {
    const state = segmentFormFromSearchParams({ segmento: '1', exceto: '' });

    expect(state.except).toBeNull();
    expect(segmentFormCompositionInput(state).except).toBeNull();
  });

  it('"exceto quem…" escolhido SEM condição nenhuma ainda é segmento vazio', () => {
    const state = segmentFormFromSearchParams({
      segmento: '1',
      exceto: 'xp-acima',
      [segmentExceptParamField('xp')]: '10',
    });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.code).toBe('SEGMENTO_VAZIO');
  });

  it('o formulário vazio é RECUSADO com o motivo do domínio', () => {
    const state = segmentFormFromSearchParams({ segmento: '1' });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.ok).toBe(false);
    expect(composition.message).toBe('Escolha ao menos uma condição para montar o segmento.');
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A CATRACA CONTRA O FAIL-OPEN
   * ─────────────────────────────────────────────────────────────────────────────
   *  Se o id desconhecido fosse DESCARTADO, "todas as condições valem" passaria a
   *  valer com uma condição a menos — e o segmento selecionaria MAIS gente do que o
   *  organizador pediu. Ele atravessa até o domínio e é recusado lá.
   */
  it('condição desconhecida ATRAVESSA e é recusada (nunca descartada em silêncio)', () => {
    const state = segmentFormFromSearchParams({
      segmento: '1',
      [segmentSlotField(0)]: 'xp-acima',
      [segmentSlotParamField(0, 'xp')]: '10',
      [segmentSlotField(1)]: 'condicao-que-nao-existe',
    });

    expect(state.slots[1]).toEqual({ id: 'condicao-que-nao-existe', values: {} });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.ok).toBe(false);
    expect(composition.code).toBe('DEFINICAO_INVALIDA');
    expect(composition.issues[0]?.code).toBe('CONDICAO_DESCONHECIDA');
  });

  it('parâmetro inválido é recusado com o texto do domínio', () => {
    const state = segmentFormFromSearchParams({
      segmento: '1',
      [segmentSlotField(0)]: 'xp-acima',
      [segmentSlotParamField(0, 'xp')]: 'muito',
    });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.ok).toBe(false);
    expect(composition.issues[0]?.message).toContain('Valor inválido para xp mínimo');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('o evento do endereço', () => {
  it('aceita ausência de evento e uuid bem formado', () => {
    expect(isSegmentEventIdShaped(null)).toBe(true);
    expect(isSegmentEventIdShaped(UUID_A)).toBe(true);
  });

  it('recusa valor torto — tratá-lo como "sem evento" faria a campanha da casa inteira', () => {
    expect(isSegmentEventIdShaped('evento-do-ano')).toBe(false);
    expect(isSegmentEventIdShaped('')).toBe(false);
    expect(isSegmentEventIdShaped(`${UUID_A} `)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('o passo da tela', () => {
  const base = { submitted: true, compositionOk: true, evaluationOk: true, textOk: true };

  it('sem envio, a tela mostra o formulário — e não um erro', () => {
    expect(segmentScreenStep({ ...base, submitted: false, reviewing: false })).toBe('montar');
  });

  it('recusa da definição ou da avaliação vira o passo "recusado"', () => {
    expect(segmentScreenStep({ ...base, compositionOk: false, reviewing: false })).toBe('recusado');
    expect(segmentScreenStep({ ...base, evaluationOk: false, reviewing: true })).toBe('recusado');
  });

  it('texto inválido NUNCA chega à confirmação — o botão de enviar não existe', () => {
    expect(segmentScreenStep({ ...base, textOk: false, reviewing: true })).toBe('contar');
    expect(segmentScreenStep({ ...base, textOk: false, reviewing: false })).toBe('contar');
  });

  it('confirmação só com o organizador pedindo e tudo de pé', () => {
    expect(segmentScreenStep({ ...base, reviewing: true })).toBe('confirmar');
    expect(segmentScreenStep({ ...base, reviewing: false })).toBe('contar');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('o snapshot que viaja para o envio', () => {
  it('preserva condições, parâmetros e exclusão — e a composição o aceita de volta', () => {
    const state = segmentFormFromSearchParams({
      segmento: '1',
      [segmentSlotField(0)]: 'inscrito-na-atividade',
      [segmentSlotParamField(0, 'atividade')]: UUID_B,
      [segmentSlotField(1)]: 'minutos-abaixo',
      [segmentSlotParamField(1, 'minutos')]: '90',
      exceto: 'xp-acima',
      [segmentExceptParamField('xp')]: '500',
    });

    const composition = composeSegment(segmentFormCompositionInput(state));
    expect(composition.ok).toBe(true);

    const restored = JSON.parse(encodeSegmentDefinition(composition.definition)) as unknown;
    const again = composeSegment(restored as { conditions: unknown; except: unknown });

    expect(again.ok).toBe(true);
    expect(again.definition.conditions).toEqual(composition.definition.conditions);
    expect(again.definition.except).toEqual(composition.definition.except);
    expect(again.explanation).toEqual(composition.explanation);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('o endereço da tela', () => {
  it('reconstrói tudo o que veio, menos o que o passo remove', () => {
    const query = segmentQuery(
      { aba: 'segmentos', segmento: '1', revisar: '1', [segmentSlotField(0)]: 'xp-acima' },
      { omit: ['revisar'] },
    );

    expect(query).toContain('aba=segmentos');
    expect(query).toContain('segmento=1');
    expect(query).toContain('c0=xp-acima');
    expect(query).not.toContain('revisar');
  });

  it('acrescenta o que o passo pede, sem perder o resto', () => {
    const query = segmentQuery({ segmento: '1' }, { set: { aba: 'segmentos' } });

    expect(query).toContain('segmento=1');
    expect(query).toContain('aba=segmentos');
  });
});
