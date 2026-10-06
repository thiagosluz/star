/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Segmentos, composição e campanha (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, E POR QUE CADA COISA É UM INVARIANTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • o CATÁLOGO é completo e coerente: toda condição tem rótulo, frase,
 *      parâmetros declarados, e a FRASE cita todos os parâmetros que mudam a
 *      seleção — sem isso o organizador envia sem saber para quem;
 *    • a frase NUNCA sai com `{chave}` cru, nem com valor obrigatório ausente;
 *    • a COMPOSIÇÃO tem as quatro bordas definidas: lista vazia recusa (em vez de
 *      selecionar a instituição inteira), parâmetro inválido recusa, condição
 *      repetida é dispensada com aviso, exclusão inválida recusa a definição
 *      inteira (seguir sem ela mandaria a mensagem para quem foi excluído);
 *    • a MÁSCARA é a régua da F60, e não uma segunda;
 *    • a CATRACA do catálogo ↔ construtor morde nos DOIS sentidos;
 *    • o `dedupeKey` da campanha é derivado do FATO (campanha + pessoa) e cabe na
 *      coluna;
 *    • a reserva de disparo tem PRAZO DE VALIDADE (senão a campanha travada nunca
 *      mais seria retomada).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  SEGMENT_CATALOG,
  SEGMENT_CONDITION_IDS,
  UNSET_PARAMETER_TEXT,
  canonicalSegmentParams,
  composeSegment,
  isSegmentConditionId,
  parseSegmentParams,
  segmentCondition,
  segmentConditionPhrase,
  segmentConditionRequiresEvent,
  segmentParamsWithDefaults,
  segmentRecipientIdentity,
} from '../../src/domain/communication/segments';
import {
  CAMPAIGN_STALE_AFTER_MS,
  CAMPAIGN_STATUS_LABELS,
  MAX_CAMPAIGN_SUBJECT_LENGTH,
  campaignDedupeKey,
  campaignDedupePrefix,
  campaignDispatchState,
  campaignStatusLabel,
  splitIntoBatches,
  validateCampaignText,
} from '../../src/domain/communication/campaign-rules';
import {
  hashUnsubscribeToken,
  isCurrentlyUnsubscribed,
  isUnsubscribeTokenShaped,
  newUnsubscribeToken,
} from '../../src/domain/communication/unsubscribe-rules';
import {
  SEGMENT_BUILDERS,
  segmentBuilderIds,
  segmentCatalogIds,
} from '../../src/lib/communication/segment-service';
import { parseStoredDefinition } from '../../src/lib/communication/campaign-service';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// ───────────────────────────────────────────────────────────────────────────────
describe('catálogo de segmentos', () => {
  it('cobre exatamente as condições declaradas, cada uma completa', () => {
    expect(Object.keys(SEGMENT_CATALOG).sort()).toEqual([...SEGMENT_CONDITION_IDS].sort());

    for (const id of SEGMENT_CONDITION_IDS) {
      const condition = segmentCondition(id);

      expect(condition.id).toBe(id);
      expect(condition.label.length).toBeGreaterThan(3);
      expect(condition.phrase.length).toBeGreaterThan(20);
      expect(isSegmentConditionId(id)).toBe(true);

      // Nenhum parâmetro repetido dentro da mesma condição (o snapshot usa a chave).
      const keys = condition.parameters.map((parameter) => parameter.key);
      expect(new Set(keys).size).toBe(keys.length);
    }

    expect(isSegmentConditionId('condicao-inventada')).toBe(false);
    expect(isSegmentConditionId(null)).toBe(false);
  });

  it('a FRASE cita todos os parâmetros e nenhum outro — é o que explica a seleção', () => {
    for (const id of SEGMENT_CONDITION_IDS) {
      const condition = segmentCondition(id);
      const placeholders = [...condition.phrase.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(
        (match) => match[1],
      );

      expect([...placeholders].sort(), `placeholders de ${id}`).toEqual(
        condition.parameters.map((parameter) => parameter.key).sort(),
      );
    }
  });

  it('parâmetro opcional SEM padrão diz como a frase o lê quando ausente', () => {
    for (const id of SEGMENT_CONDITION_IDS) {
      for (const parameter of segmentCondition(id).parameters) {
        if (!parameter.required && parameter.fallback === null) {
          expect(parameter.unset, `${id}.${parameter.key} sem "unset"`).toBeTruthy();
        }
      }
    }
  });

  it('a frase nunca sai com chave crua', () => {
    for (const id of SEGMENT_CONDITION_IDS) {
      const rendered = segmentConditionPhrase(id, {});

      expect(rendered, `frase crua em ${id}`).not.toMatch(/[{}]/);
    }

    /**
     * Parâmetro OBRIGATÓRIO ausente sai como "(não informado)" — e isso é
     * deliberado: a frase é montável mesmo com a definição recusada, porque é
     * mostrando "menos de (não informado) minutos" que o organizador entende o que
     * faltou preencher. O que NÃO pode acontecer é o `{minutos}` cru.
     */
    expect(segmentConditionPhrase('minutos-abaixo', {})).toContain(UNSET_PARAMETER_TEXT);

    // Parâmetro OPCIONAL ausente sai pelo texto declarado no catálogo.
    expect(segmentConditionPhrase('inscricao-em-espera', {})).toContain('do evento');
    expect(segmentConditionPhrase('presenca-manha-sem-tarde', {})).toContain('12:00');
  });

  it('os três obrigatórios do pedido estão no catálogo, com o fato certo na frase', () => {
    // (a) inscritos numa atividade que não confirmaram a vaga.
    expect(segmentConditionPhrase('inscricao-sem-confirmacao', {})).toContain('não confirmou a vaga');
    // (b) presentes pela manhã que não voltaram à tarde.
    expect(segmentConditionPhrase('presenca-manha-sem-tarde', {})).toContain('não voltou à tarde');
    // (c) autores com submissão aprovada que não enviaram material.
    expect(segmentConditionPhrase('autor-aprovado-sem-material', {})).toContain('material de apoio');
    expect(segmentCondition('autor-aprovado-sem-material').phrase).toContain('submissão aprovada');
  });

  it('o rótulo resolvido entra na frase no lugar do uuid', () => {
    const phrase = segmentConditionPhrase(
      'inscrito-na-atividade',
      { atividade: UUID_A },
      { 'inscrito-na-atividade:atividade': 'na atividade Robótica' },
    );

    expect(phrase).toBe('Quem está inscrito na atividade Robótica.');
    // Sem rótulo, o valor cru aparece — é o que a tela sem lista carregada mostra.
    expect(segmentConditionPhrase('inscrito-na-atividade', { atividade: UUID_A })).toContain(UUID_A);
  });

  it('as condições de evento se declaram, e as três da instituição não', () => {
    const semEvento = SEGMENT_CONDITION_IDS.filter((id) => !segmentConditionRequiresEvent(id));

    expect(semEvento.sort()).toEqual(['carta-conquistada', 'perfil-incompleto', 'xp-acima']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('validação dos parâmetros', () => {
  it('recusa uuid, dia, hora e número inválidos — e diz o motivo', () => {
    const base = { ok: false as const, values: {} };

    expect(parseSegmentParams(segmentCondition('inscrito-na-atividade'), { atividade: 'abc' })).toMatchObject(base);
    expect(
      parseSegmentParams(segmentCondition('presenca-manha-sem-tarde'), { dia: '2027-02-31' }),
    ).toMatchObject(base);
    expect(parseSegmentParams(segmentCondition('presenca-manha-sem-tarde'), { dia: '15/03/2027' })).toMatchObject(base);
    expect(
      parseSegmentParams(segmentCondition('presenca-manha-sem-tarde'), { manha: '25:00' }),
    ).toMatchObject(base);
    expect(parseSegmentParams(segmentCondition('xp-acima'), { xp: 0 })).toMatchObject(base);
    expect(parseSegmentParams(segmentCondition('minutos-abaixo'), { minutos: 'muitos' })).toMatchObject(base);
  });

  it('recusa parâmetro NÃO declarado (fail-closed: não ignora o que não entende)', () => {
    const result = parseSegmentParams(segmentCondition('xp-acima'), { xp: 10, evento: UUID_A });

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('evento');
  });

  it('aceita número em texto e aplica o padrão declarado', () => {
    const minutos = parseSegmentParams(segmentCondition('minutos-abaixo'), { minutos: '120' });
    expect(minutos.ok).toBe(true);
    expect(minutos.values.minutos).toBe(120);

    const manha = parseSegmentParams(segmentCondition('presenca-manha-sem-tarde'), {});
    expect(manha.ok).toBe(true);
    expect(manha.values.manha).toBe('12:00');
  });

  it('exige o parâmetro obrigatório', () => {
    const result = parseSegmentParams(segmentCondition('inscrito-na-atividade'), {});

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('atividade');
  });

  it('normaliza o uuid para minúsculas (o mesmo filtro escrito de duas formas)', () => {
    const upper = parseSegmentParams(segmentCondition('carta-conquistada'), {
      carta: UUID_A.toUpperCase(),
    });

    expect(upper.ok).toBe(true);
    expect(upper.values.carta).toBe(UUID_A);
  });

  it('os padrões declarados alimentam a frase e o filtro ao mesmo tempo', () => {
    const condition = segmentCondition('presenca-manha-sem-tarde');

    expect(segmentParamsWithDefaults(condition, {})).toEqual({ manha: '12:00' });
    expect(segmentParamsWithDefaults(condition, { tarde: '18:00' })).toEqual({
      manha: '12:00',
      tarde: '18:00',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('composição do segmento — as quatro bordas', () => {
  it('lista vazia RECUSA: o "E" vazio selecionaria a instituição inteira', () => {
    const composition = composeSegment({ conditions: [] });

    expect(composition.ok).toBe(false);
    expect(composition.code).toBe('SEGMENTO_VAZIO');
    expect(composition.definition.conditions).toEqual([]);
    expect(composition.issues.some((issue) => issue.blocking)).toBe(true);
  });

  it('"exceto quem…" sozinho também é segmento vazio', () => {
    const composition = composeSegment({ conditions: [], except: { id: 'xp-acima', params: { xp: 10 } } });

    expect(composition.ok).toBe(false);
    expect(composition.code).toBe('SEGMENTO_VAZIO');
  });

  it('uma condição válida compõe e produz a frase que o organizador lê', () => {
    const composition = composeSegment({
      conditions: [{ id: 'minutos-abaixo', params: { minutos: 120 } }],
    });

    expect(composition.ok).toBe(true);
    expect(composition.code).toBeNull();
    expect(composition.definition.conditions).toHaveLength(1);
    expect(composition.explanation).toHaveLength(1);
    expect(composition.explanation[0]).toContain('120 minutos');
    expect(composition.exclusion).toBeNull();
  });

  it('parâmetro inválido RECUSA a definição inteira (não envia para mais gente)', () => {
    const composition = composeSegment({
      conditions: [{ id: 'xp-acima', params: { xp: -5 } }],
    });

    expect(composition.ok).toBe(false);
    expect(composition.code).toBe('DEFINICAO_INVALIDA');
    expect(composition.definition.conditions).toEqual([]);
    expect(composition.issues[0]?.code).toBe('PARAMETRO_INVALIDO');
  });

  it('condição desconhecida RECUSA e é relatada', () => {
    const composition = composeSegment({ conditions: [{ id: 'nao-existe', params: {} }] });

    expect(composition.ok).toBe(false);
    expect(composition.issues[0]?.code).toBe('CONDICAO_DESCONHECIDA');
  });

  it('condição repetida (mesmos valores) é dispensada com AVISO, não com erro', () => {
    const composition = composeSegment({
      conditions: [
        { id: 'xp-acima', params: { xp: 100 } },
        { id: 'xp-acima', params: { xp: 100 } },
      ],
    });

    expect(composition.ok).toBe(true);
    expect(composition.definition.conditions).toHaveLength(1);
    expect(composition.issues.some((issue) => issue.code === 'CONDICAO_REPETIDA' && !issue.blocking)).toBe(true);
  });

  it('mesma condição com valores DIFERENTES são dois filtros de verdade', () => {
    const composition = composeSegment({
      conditions: [
        { id: 'inscrito-na-atividade', params: { atividade: UUID_A } },
        { id: 'inscrito-na-atividade', params: { atividade: UUID_B } },
      ],
    });

    expect(composition.ok).toBe(true);
    expect(composition.definition.conditions).toHaveLength(2);
    expect(composition.explanation).toHaveLength(2);
  });

  it('a ordem dos parâmetros não cria "condição repetida"', () => {
    expect(canonicalSegmentParams({ a: 1, b: 'x' })).toBe(canonicalSegmentParams({ b: 'x', a: 1 }));
  });

  it('exclusão inválida RECUSA — seguir sem ela mandaria para quem foi excluído', () => {
    const composition = composeSegment({
      conditions: [{ id: 'xp-acima', params: { xp: 100 } }],
      except: { id: 'xp-acima', params: { xp: 'muito' } },
    });

    expect(composition.ok).toBe(false);
    expect(composition.code).toBe('DEFINICAO_INVALIDA');
    expect(composition.definition.except).toBeNull();
    expect(composition.issues.some((issue) => issue.scope === 'exceto' && issue.blocking)).toBe(true);
  });

  it('"exceto quem…" sem condição escolhida é recusado', () => {
    const composition = composeSegment({
      conditions: [{ id: 'xp-acima', params: { xp: 100 } }],
      except: {},
    });

    expect(composition.ok).toBe(false);
    expect(composition.issues.some((issue) => issue.scope === 'exceto')).toBe(true);
  });

  it('a MESMA condição nos dois lados é legítima e avisa que a seleção fica vazia', () => {
    const composition = composeSegment({
      conditions: [{ id: 'xp-acima', params: { xp: 100 } }],
      except: { id: 'xp-acima', params: { xp: 100 } },
    });

    expect(composition.ok).toBe(true);
    expect(composition.issues.some((issue) => issue.code === 'CONDICAO_CONTRADITORIA')).toBe(true);
    expect(composition.exclusion).toContain('100 XP');
  });

  it('a exclusão com outros valores NÃO é contradição', () => {
    const composition = composeSegment({
      conditions: [{ id: 'xp-acima', params: { xp: 100 } }],
      except: { id: 'xp-acima', params: { xp: 500 } },
    });

    expect(composition.ok).toBe(true);
    expect(composition.issues.some((issue) => issue.code === 'CONDICAO_CONTRADITORIA')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('máscara da lista interna (F60 · E79)', () => {
  it('quem não foi ocultado sai com o nome inteiro', () => {
    expect(segmentRecipientIdentity({ name: 'Ana Souza', publicProfileHiddenAt: null })).toEqual({
      name: 'Ana Souza',
      masked: false,
    });
  });

  it('quem foi ocultado sai abreviado pela MESMA régua do ranking', () => {
    const identity = segmentRecipientIdentity({
      name: 'Ana Souza',
      publicProfileHiddenAt: new Date('2026-10-01T12:00:00.000Z'),
    });

    expect(identity).toEqual({ name: 'Ana S.', masked: true });
  });

  it('nome de uma palavra continua reconhecível', () => {
    expect(
      segmentRecipientIdentity({ name: 'Ana', publicProfileHiddenAt: new Date() }).name,
    ).toBe('Ana');
  });

  it('coluna ausente do select é "não visível" (fail-closed)', () => {
    const identity = segmentRecipientIdentity({
      name: 'Ana Souza',
      publicProfileHiddenAt: undefined as unknown as Date | null,
    });

    expect(identity.masked).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('catraca do catálogo ↔ construtor', () => {
  it('todo construtor tem condição E toda condição tem construtor', () => {
    expect(segmentBuilderIds()).toEqual(segmentCatalogIds());
    expect(segmentBuilderIds()).toHaveLength(SEGMENT_CONDITION_IDS.length);
  });

  it('o construtor declara o mesmo recorte de evento que o catálogo', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTA CATRACA EXISTE, SE O TIPO JÁ OBRIGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O tipo garante que há UM construtor por condição; ele não garante que os
     *  dois lados concordem sobre o RECORTE. Um construtor de evento sem
     *  `requiresEvent` no catálogo (ou o contrário) faria a tela oferecer uma
     *  condição que o disparo recusaria — ou aceitar uma que não filtra nada.
     */
    for (const id of SEGMENT_CONDITION_IDS) {
      const builder = SEGMENT_BUILDERS[id];
      expect(typeof builder, `construtor ausente para ${id}`).toBe('function');
    }

    expect(SEGMENT_CONDITION_IDS.filter((id) => segmentConditionRequiresEvent(id))).toHaveLength(12);
  });

  it('o snapshot gravado volta para a forma que a composição entende', () => {
    const restored = parseStoredDefinition({
      conditions: [{ id: 'xp-acima', params: { xp: 100 } }],
      except: null,
    });

    expect(composeSegment(restored).ok).toBe(true);
  });

  it('snapshot corrompido vira segmento vazio — e o disparo para (fail-closed)', () => {
    expect(composeSegment(parseStoredDefinition(null)).code).toBe('SEGMENTO_VAZIO');
    expect(composeSegment(parseStoredDefinition({ conditions: 'nada' })).code).toBe('SEGMENTO_VAZIO');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('regras da campanha', () => {
  it('a chave do fato é campanha + pessoa, e cabe na coluna', () => {
    const key = campaignDedupeKey(UUID_A, UUID_B);

    expect(key).toBe(`campaign:${UUID_A}:${UUID_B}`);
    expect(key.length).toBeLessThanOrEqual(200);
    expect(key.startsWith(campaignDedupePrefix(UUID_A))).toBe(true);
    // A chave de OUTRA campanha não colide com esta.
    expect(campaignDedupeKey(UUID_B, UUID_B).startsWith(campaignDedupePrefix(UUID_A))).toBe(false);
  });

  it('o assunto é uma linha, e os limites são recusados com motivo', () => {
    const ok = validateCampaignText({ subject: '  Vaga   reservada  ', body: 'Confirme até sexta.' });

    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.subject).toBe('Vaga reservada');
      expect(ok.body).toBe('Confirme até sexta.');
    }

    expect(validateCampaignText({ subject: '', body: 'corpo com tamanho' }).ok).toBe(false);
    expect(
      validateCampaignText({ subject: 'a'.repeat(MAX_CAMPAIGN_SUBJECT_LENGTH + 1), body: 'corpo' }).ok,
    ).toBe(false);
    expect(validateCampaignText({ subject: 'Oi', body: 'curto' }).ok).toBe(false);
  });

  it('os lotes preservam a ordem e não perdem ninguém', () => {
    const items = [1, 2, 3, 4, 5];

    expect(splitIntoBatches(items, 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(splitIntoBatches(items, 5)).toEqual([[1, 2, 3, 4, 5]]);
    expect(splitIntoBatches(items, 99)).toEqual([[1, 2, 3, 4, 5]]);
    expect(splitIntoBatches([], 3)).toEqual([]);
    // Tamanho inválido não pode virar lote vazio infinito.
    expect(splitIntoBatches([1], 0)).toEqual([[1]]);
    expect(splitIntoBatches([1], -2)).toEqual([[1]]);
  });

  it('a reserva de disparo tem prazo de validade', () => {
    const now = new Date('2026-10-04T12:00:00.000Z');

    expect(campaignDispatchState({ status: 'DRAFT', startedAt: null, now })).toBe('READY');
    expect(campaignDispatchState({ status: 'SENT', startedAt: now, now })).toBe('READY');

    const recent = new Date(now.getTime() - 60_000);
    expect(campaignDispatchState({ status: 'SENDING', startedAt: recent, now })).toBe('RUNNING');

    const stale = new Date(now.getTime() - CAMPAIGN_STALE_AFTER_MS - 1);
    expect(campaignDispatchState({ status: 'SENDING', startedAt: stale, now })).toBe('READY');

    // Reserva sem carimbo: fail-open para a retomada (a chave do fato protege).
    expect(campaignDispatchState({ status: 'SENDING', startedAt: null, now })).toBe('READY');
  });

  it('todo estado tem rótulo em português', () => {
    expect(Object.keys(CAMPAIGN_STATUS_LABELS).sort()).toEqual(['DRAFT', 'SENDING', 'SENT']);
    expect(campaignStatusLabel('SENT')).toBe('Enviada');
    expect(campaignStatusLabel('DESCONHECIDO')).toBe('DESCONHECIDO');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('regras do descadastro', () => {
  it('o token é único, longo e seguro em URL', () => {
    const first = newUnsubscribeToken();
    const second = newUnsubscribeToken();

    expect(first).not.toBe(second);
    expect(isUnsubscribeTokenShaped(first)).toBe(true);
    expect(hashUnsubscribeToken(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUnsubscribeToken(first)).not.toBe(hashUnsubscribeToken(second));
    // O hash é estável: é ele que indexa a leitura.
    expect(hashUnsubscribeToken(first)).toBe(hashUnsubscribeToken(` ${first} `));
  });

  it('recusa token com forma impossível (evita consulta com lixo na URL)', () => {
    expect(isUnsubscribeTokenShaped('')).toBe(false);
    expect(isUnsubscribeTokenShaped('curto')).toBe(false);
    expect(isUnsubscribeTokenShaped('tem espaço e não cabe na url')).toBe(false);
    expect(isUnsubscribeTokenShaped(undefined)).toBe(false);
  });

  it('o estado vigente é DERIVADO: saiu, voltou, saiu de novo', () => {
    expect(isCurrentlyUnsubscribed({ unsubscribedAt: null, resubscribedAt: null })).toBe(false);
    expect(isCurrentlyUnsubscribed({ unsubscribedAt: new Date('2026-10-01'), resubscribedAt: null })).toBe(true);
    expect(
      isCurrentlyUnsubscribed({
        unsubscribedAt: new Date('2026-10-01'),
        resubscribedAt: new Date('2026-10-02'),
      }),
    ).toBe(false);
  });

  it('volta anterior à saída deixa a pessoa FORA (o fato mais recente manda)', () => {
    expect(
      isCurrentlyUnsubscribed({
        unsubscribedAt: new Date('2026-10-02'),
        resubscribedAt: new Date('2026-10-01'),
      }),
    ).toBe(true);
  });
});
