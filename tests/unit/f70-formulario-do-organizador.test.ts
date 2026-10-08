/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O editor do formulário do organizador (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM, E O QUE ELES NÃO TENTAM PRENDER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A régua do campo (allowlist, tetos, finalidade obrigatória no texto longo,
 *  duplicata) é do DOMÍNIO e já tem 74 casos próprios. O que se prova aqui é a
 *  metade que nasceu nesta fatia e não existia em lugar nenhum:
 *
 *    • a tradução do `<form>` para o candidato — em especial "campo em branco é
 *      AUSENTE, não zero/NaN por acidente", que é o que faz o organizador receber a
 *      mensagem CERTA quando digita algo no campo errado;
 *    • as quatro operações sobre a lista (acrescentar, editar, remover, reordenar),
 *      inclusive a recusa — e a recusa com o TEXTO DO DOMÍNIO, porque inventar uma
 *      segunda frase para o mesmo defeito é o começo de duas réguas.
 *
 *  Sem banco, sem navegador, sem HTTP: `FormData` é o mesmo tipo que o `<form>`
 *  produz, e é ele que o adaptador recebe.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  applyRegistrationFormOperation,
  describeRegistrationForm,
  registrationFieldFromFormData,
} from '../../src/lib/admin/registration-form-editing';
import { validateRegistrationFormSpec } from '../../src/domain/events/registration-form-spec-rules';
import type { RegistrationFormField } from '../../src/domain/events/registration-form-spec-rules';

/** Um `<form>` como o navegador o enviaria: só o que foi preenchido. */
function formData(entries: Record<string, string>): FormData {
  const data = new FormData();

  for (const [name, value] of Object.entries(entries)) data.set(name, value);

  return data;
}

const NOME: RegistrationFormField = {
  key: 'nome',
  label: 'Nome completo',
  type: 'SHORT_TEXT',
  required: true,
};

const OBSERVACOES: RegistrationFormField = {
  key: 'observacoes',
  label: 'Observações',
  type: 'LONG_TEXT',
  required: false,
  purpose: 'Registrar pedidos que não cabem nas outras perguntas.',
};

const TURNO: RegistrationFormField = {
  key: 'turno',
  label: 'Turno',
  type: 'SINGLE_CHOICE',
  required: false,
  options: ['Manhã', 'Tarde'],
};

describe('o formulário do organizador vira candidato do domínio', () => {
  it('campo em branco NÃO é declaração: limite, faixa e opções ausentes somem', () => {
    const candidate = registrationFieldFromFormData(
      formData({
        key: 'nome',
        label: 'Nome completo',
        type: 'SHORT_TEXT',
        help: '',
        purpose: '',
        maxLength: '',
        min: '',
        max: '',
        options: '',
      }),
    );

    /**
     * O candidato é aceito pelo domínio como um texto curto comum — e é isso que
     * prova a ausência: se `min` tivesse viajado como `NaN`, a recusa seria "o campo
     * é Texto curto e não usa faixa de valores", uma mensagem sobre um campo que o
     * organizador nunca preencheu.
     */
    const validation = validateRegistrationFormSpec([candidate]);

    expect(validation.ok).toBe(true);
    expect(candidate).not.toHaveProperty('maxLength');
    expect(candidate).not.toHaveProperty('min');
    expect(candidate).not.toHaveProperty('max');
    expect(candidate).not.toHaveProperty('options');
    expect(candidate.required).toBe(false);
  });

  it('"Sim" marcado viaja como booleano, e a opção por linha vira lista', () => {
    const candidate = registrationFieldFromFormData(
      formData({
        key: 'turno',
        label: 'Turno',
        type: 'SINGLE_CHOICE',
        required: 'on',
        options: 'Manhã\n\n  Tarde  \n',
      }),
    );

    expect(candidate.required).toBe(true);
    expect(candidate.options).toEqual(['Manhã', 'Tarde']);
  });

  it('limite que não é número vira a RECUSA do domínio, com o texto dele', () => {
    const candidate = registrationFieldFromFormData(
      formData({ key: 'nome', label: 'Nome', type: 'SHORT_TEXT', maxLength: 'abc' }),
    );

    const validation = validateRegistrationFormSpec([candidate]);

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.problems[0]?.message).toContain('Limite de caracteres inválido');
    expect(validation.problems[0]?.key).toBe('nome');
  });

  it('a chave NÃO é aparada — o domínio declara que ela nunca é', () => {
    const candidate = registrationFieldFromFormData(
      formData({ key: ' nome', label: 'Nome', type: 'SHORT_TEXT' }),
    );

    expect(candidate.key).toBe(' nome');
  });

  it('opção em tipo que não usa opções é recusada pelo domínio (não é descartada)', () => {
    const candidate = registrationFieldFromFormData(
      formData({ key: 'nome', label: 'Nome', type: 'SHORT_TEXT', options: 'Manhã' }),
    );

    const validation = validateRegistrationFormSpec([candidate]);

    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    expect(validation.problems[0]?.message).toContain('Opções de escolha única inválidas');
  });
});

describe('as operações do editor', () => {
  it('acrescentar põe o campo NO FIM, e a lista anterior continua inteira', () => {
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: 'turma', label: 'Turma', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['nome', 'turma']);
  });

  it('editar SUBSTITUI no lugar — e a lista não ganha um campo a mais', () => {
    const result = applyRegistrationFormOperation([NOME, TURNO], {
      kind: 'SAVE',
      originalKey: 'nome',
      field: { key: 'nome', label: 'Nome do participante', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]?.label).toBe('Nome do participante');
    expect(result.fields[1]?.key).toBe('turno');
  });

  it('renomear a chave de um campo existente NÃO cria um campo novo', () => {
    const result = applyRegistrationFormOperation([NOME, TURNO], {
      kind: 'SAVE',
      originalKey: 'turno',
      field: { key: 'periodo', label: 'Período', type: 'SINGLE_CHOICE', required: false, options: ['Manhã'] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['nome', 'periodo']);
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A CHAVE DERIVADA DO RÓTULO (FASE 70 — fechamento)
   * ═══════════════════════════════════════════════════════════════════════════════
   *  O derivador do domínio existia desde a fatia 1 e não tinha CHAMADOR: deixar o
   *  identificador em branco continuava sendo `MISSING_KEY`, e o organizador lia
   *  "campo sem identificador" sobre um campo que ele acabou de nomear. Estes casos
   *  prendem a ligação — e, com ela, as três regras de precedência.
   */
  it('identificador EM BRANCO deriva do rótulo — o caso novo que a tela recomenda', () => {
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: '', label: 'Restrição alimentar', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['nome', 'restricao_alimentar']);
  });

  it('o identificador DIGITADO ganha do rótulo — quem escreveu quis aquele', () => {
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: 'turma', label: 'Restrição alimentar', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['nome', 'turma']);
  });

  it('RENOMEAR O RÓTULO não troca a chave de quem já respondeu', () => {
    /**
     * É o invariante da fase: a resposta já gravada vive sob `restricao`, e um
     * `campo_livre` derivado do rótulo novo faria o certificado, o CSV e a eliminação
     * procurarem a resposta sob um nome que ninguém escreveu.
     */
    const antigo: RegistrationFormField = {
      key: 'restricao',
      label: 'Restrição alimentar',
      type: 'SHORT_TEXT',
      required: false,
    };

    const result = applyRegistrationFormOperation([antigo], {
      kind: 'SAVE',
      originalKey: 'restricao',
      field: { key: '', label: 'Algo que você não come', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.key).toBe('restricao');
    expect(result.fields[0]?.label).toBe('Algo que você não come');
  });

  it('dois rótulos que derivam para a MESMA chave são recusados pelo domínio', () => {
    /**
     * Não há desempate automático (`_2`) aqui, e a diferença em relação à rubrica da
     * F39 é deliberada: a chave guarda respostas recebidas, e um nome inventado em
     * silêncio criaria um campo que ninguém pediu, com a resposta de outra pergunta
     * embaixo dele. A recusa é a do validador que já existia.
     */
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: '', label: 'Nome', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_FIELD');
    expect(result.message).toContain('Identificador de campo repetido');
  });

  it('a chave repetida é recusada com a mensagem do DOMÍNIO', () => {
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: 'nome', label: 'Outro nome', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_FIELD');
    expect(result.message).toContain('Identificador de campo repetido');
  });

  it('texto longo sem finalidade é recusado — e a frase é a do domínio, com o índice', () => {
    const result = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: null,
      field: { key: 'observacoes', label: 'Observações', type: 'LONG_TEXT', required: false },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    /**
     * O `index` é o da LISTA FINAL (o campo novo é o segundo), e não "1" — é por isso
     * que a lista inteira vai para o validador. A tela usa essa coordenada para
     * apontar QUAL campo está torto.
     */
    expect(result.message).toContain('Texto longo sem finalidade declarada');
    expect(result.problems?.[0]?.index).toBe(2);
    expect(result.problems?.[0]?.key).toBe('observacoes');
  });

  it('o teto de campos é do domínio: o 41º campo é recusado', () => {
    const quarenta: RegistrationFormField[] = Array.from({ length: 40 }, (_, index) => ({
      key: `campo_${index}`,
      label: `Campo ${index}`,
      type: 'SHORT_TEXT',
      required: false,
    }));

    const result = applyRegistrationFormOperation(quarenta, {
      kind: 'SAVE',
      originalKey: null,
      field: { key: 'excedente', label: 'Excedente', type: 'SHORT_TEXT', required: false },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toContain('Campos demais no formulário');
  });

  it('editar campo que não existe é recusado — e o mesmo vale para remover', () => {
    const editar = applyRegistrationFormOperation([NOME], {
      kind: 'SAVE',
      originalKey: 'inexistente',
      field: { key: 'inexistente', label: 'Inexistente', type: 'SHORT_TEXT', required: false },
    });

    expect(editar.ok).toBe(false);
    if (!editar.ok) expect(editar.code).toBe('FIELD_NOT_FOUND');

    const remover = applyRegistrationFormOperation([NOME], { kind: 'REMOVE', key: 'inexistente' });

    expect(remover.ok).toBe(false);
    if (!remover.ok) expect(remover.code).toBe('FIELD_NOT_FOUND');
  });

  it('remover tira UM campo e preserva a ordem dos outros', () => {
    const result = applyRegistrationFormOperation([NOME, TURNO, OBSERVACOES], {
      kind: 'REMOVE',
      key: 'turno',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['nome', 'observacoes']);
  });

  it('descer troca os dois vizinhos de lugar, com os campos INTEIROS (não só as chaves)', () => {
    const result = applyRegistrationFormOperation([NOME, TURNO], {
      kind: 'MOVE',
      key: 'nome',
      direction: 'down',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fields.map((field) => field.key)).toEqual(['turno', 'nome']);
    expect(result.fields[1]?.label).toBe('Nome completo');
  });

  it('nas pontas nada muda, e a resposta diz por quê', () => {
    const primeiro = applyRegistrationFormOperation([NOME, TURNO], {
      kind: 'MOVE',
      key: 'nome',
      direction: 'up',
    });

    expect(primeiro.ok).toBe(false);
    if (!primeiro.ok) {
      expect(primeiro.code).toBe('AT_THE_EDGE');
      expect(primeiro.message).toBe('Este campo já é o primeiro do formulário.');
    }

    const ultimo = applyRegistrationFormOperation([NOME, TURNO], {
      kind: 'MOVE',
      key: 'turno',
      direction: 'down',
    });

    expect(ultimo.ok).toBe(false);
    if (!ultimo.ok) expect(ultimo.message).toBe('Este campo já é o último do formulário.');
  });
});

describe('a lista em uma frase (o que a trilha registra)', () => {
  it('lista vazia não é "0 campos": é nenhum campo declarado', () => {
    expect(describeRegistrationForm([])).toBe('nenhum campo declarado');
  });

  it('singular e plural, com as chaves na ordem da tela', () => {
    expect(describeRegistrationForm([NOME])).toBe('1 campo: nome');
    expect(describeRegistrationForm([NOME, TURNO])).toBe('2 campos: nome, turno');
  });
});
