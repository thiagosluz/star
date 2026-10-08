import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EVENT_OBLIGATION_FORM_KEYS,
  FORM_CHOICE_OPTIONS_MAX,
  FORM_FIELD_TYPES,
  FORM_LONG_TEXT_MAX,
  FORM_SHORT_TEXT_MAX,
  THIRD_PARTY_FORM_RESPONSE_KEYS,
  THIRD_PARTY_FORBIDDEN_FORM_KEYS,
  composeFormResponses,
  erasePersonalFormResponses,
  forbiddenFieldTypeFragment,
  formFieldRequiresPurpose,
  formResponseFieldName,
  formResponsesWithoutPersonalData,
  isCalendarDate,
  isForbiddenFieldType,
  isFormFieldType,
  readRegistrationForm,
  validateFormResponses,
  validateRegistrationFormSpec,
} from '../../src/domain/events/registration-form-spec-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O FORMULÁRIO QUE O ORGANIZADOR MONTA (FASE 70 · fatia 1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Domínio puro: nenhum banco, nenhum relógio, nenhuma tela. O que se prova aqui são
 *  os DOIS LADOS de cada regra — o que entra e o que NÃO entra —, porque uma regra
 *  testada só pelo lado permissivo é uma regra que pode estar desligada.
 *
 *  O padrão de nomes é o do repositório: `describe` com a função, `it` com a frase do
 *  comportamento.
 */
function problemsOf(spec: unknown): readonly string[] {
  const result = validateRegistrationFormSpec(spec);

  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

/** Um campo válido de texto curto, do qual cada teste troca só o que quer testar. */
function field(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'restricao',
    label: 'Restrição alimentar',
    type: 'SHORT_TEXT',
    required: false,
    ...overrides,
  };
}

/**
 * O aceito quando a validação passou; `null` quando a inscrição inteira foi RECUSADA
 * (spec torto, respostas que não são objeto ou `required` vazio). Recusa de UM campo
 * não devolve `null` — ela aparece em `rejected`, e o resto continua aceito.
 */
function acceptedOrNull(
  fields: readonly unknown[],
  raw: unknown,
): Record<string, unknown> | null {
  const result = validateFormResponses(fields, raw);

  return result.ok ? result.accepted : null;
}

/** Os códigos do que não entrou — a leitura curta para prender o motivo. */
function rejectionCodes(fields: readonly unknown[], raw: unknown): readonly string[] {
  const result = validateFormResponses(fields, raw);

  return result.ok ? result.rejected.map((rejection) => rejection.code) : ['RECUSOU_TUDO'];
}

// ───────────────────────────────────────────────────────────────────────────────
//  A allowlist de tipos
// ───────────────────────────────────────────────────────────────────────────────
describe('a allowlist de tipos do campo', () => {
  it('aceita exatamente os seis tipos decididos', () => {
    expect(FORM_FIELD_TYPES).toEqual([
      'SHORT_TEXT',
      'LONG_TEXT',
      'SINGLE_CHOICE',
      'YES_NO',
      'NUMBER',
      'DATE',
    ]);
  });

  it('aceita cada um dos seis no spec', () => {
    expect(isFormFieldType('SHORT_TEXT')).toBe(true);
    expect(isFormFieldType('LONG_TEXT')).toBe(true);
    expect(isFormFieldType('SINGLE_CHOICE')).toBe(true);
    expect(isFormFieldType('YES_NO')).toBe(true);
    expect(isFormFieldType('NUMBER')).toBe(true);
    expect(isFormFieldType('DATE')).toBe(true);
  });

  it('recusa tipo inventado que não é sensível', () => {
    expect(isFormFieldType('EMAIL')).toBe(false);
    expect(isFormFieldType('FILE_UPLOAD')).toBe(false);
    expect(isFormFieldType('TEXT')).toBe(false);
    expect(isFormFieldType(42)).toBe(false);
    expect(isFormFieldType(null)).toBe(false);

    expect(problemsOf([field({ type: 'EMAIL' })])).toEqual(['UNKNOWN_TYPE']);
  });

  it('o texto longo é PERMITIDO — desde que declare a finalidade', () => {
    expect(
      problemsOf([field({ type: 'LONG_TEXT', purpose: 'Saber o que o participante espera do evento.' })]),
    ).toEqual([]);
  });

  it('recusa o texto longo SEM finalidade declarada', () => {
    expect(problemsOf([field({ type: 'LONG_TEXT' })])).toEqual(['MISSING_PURPOSE']);
    expect(problemsOf([field({ type: 'LONG_TEXT', purpose: '   ' })])).toEqual(['MISSING_PURPOSE']);
  });

  it('os outros tipos não exigem finalidade', () => {
    expect(formFieldRequiresPurpose('LONG_TEXT')).toBe(true);
    expect(formFieldRequiresPurpose('SHORT_TEXT')).toBe(false);
    expect(formFieldRequiresPurpose('YES_NO')).toBe(false);
    expect(formFieldRequiresPurpose('NUMBER')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Tipos sensíveis: proibidos POR CONSTRUÇÃO
// ───────────────────────────────────────────────────────────────────────────────
describe('os tipos sensíveis são proibidos por construção', () => {
  it('recusa `CPF` e `SAUDE` — os dois exemplos do pedido', () => {
    expect(problemsOf([field({ type: 'CPF' })])).toEqual(['FORBIDDEN_TYPE']);
    expect(problemsOf([field({ type: 'SAUDE' })])).toEqual(['FORBIDDEN_TYPE']);
  });

  it('recusa cada família de dado sensível, com o mesmo código', () => {
    const tipos = [
      'CPF',
      'CNPJ',
      'RG',
      'DOCUMENTO',
      'PASSAPORTE',
      'SAUDE',
      'BIOMETRIA',
      'RELIGIAO',
      'RACA',
      'ETNIA',
      'ORIENTACAO_SEXUAL',
      'GENERO',
      'FILIACAO_PARTIDARIA',
      'SINDICATO',
      'DEFICIENCIA',
      'DOENCA',
      'MEDICAMENTO',
      'TIPO_SANGUINEO',
      'DNA',
      'SENHA',
      'CARTAO_DE_CREDITO',
      'DADOS_BANCARIOS',
      'PIS',
      'TITULO_DE_ELEITOR',
    ];

    for (const tipo of tipos) {
      expect(problemsOf([field({ type: tipo })]), tipo).toEqual(['FORBIDDEN_TYPE']);
    }
  });

  it('recusa a variante de caixa e separador — o buraco não pode ser uma maiúscula', () => {
    expect(isForbiddenFieldType('cpf')).toBe(true);
    expect(isForbiddenFieldType('Cpf')).toBe(true);
    expect(isForbiddenFieldType('c_p_f')).toBe(true);
    expect(isForbiddenFieldType('CPF DO TITULAR')).toBe(true);
    expect(isForbiddenFieldType('saude_mental')).toBe(true);
    expect(isForbiddenFieldType('cartao-sus')).toBe(true);
  });

  it('NÃO recusa os seis tipos da allowlist', () => {
    for (const tipo of FORM_FIELD_TYPES) {
      expect(isForbiddenFieldType(tipo), tipo).toBe(false);
      expect(forbiddenFieldTypeFragment(tipo), tipo).toBeNull();
    }
  });

  it('devolve o fragmento que casou — é o que a mensagem de recusa cita', () => {
    expect(forbiddenFieldTypeFragment('CPF')).toBe('cpf');
    expect(forbiddenFieldTypeFragment('dados_de_saude')).toBe('saude');
    expect(forbiddenFieldTypeFragment('SHORT_TEXT')).toBeNull();
    expect(forbiddenFieldTypeFragment(7)).toBeNull();
  });

  it('a mensagem diz que é dado sensível e lista os tipos possíveis', () => {
    const result = validateRegistrationFormSpec([field({ type: 'CPF' })]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      const problem = result.problems[0];
      expect(problem?.code).toBe('FORBIDDEN_TYPE');
      expect(problem?.message).toMatch(/dado sensível/i);
      expect(problem?.message).toMatch(/CPF/);
      expect(problem?.message).toContain('SHORT_TEXT');
      expect(problem?.key).toBe('restricao');
      expect(problem?.index).toBe(1);
    }
  });

  /**
   * A DISTINÇÃO que não pode ser perdida: proibir por tipo não é prometer que texto
   * livre nunca conterá um CPF digitado. O que o validador garante é que o dado não
   * ganha ESTRUTURA (tipo, coluna, filtro); o risco do texto digitado à mão fica com o
   * aviso ao organizador (fatia 3) e com a eliminação (fatia 4).
   */
  it('um TEXTO curto aceita o CPF digitado — e é por isso que o aviso existe', () => {
    const spec = [field({ key: 'observacoes', label: 'Observações', type: 'SHORT_TEXT' })];

    expect(acceptedOrNull(spec, { observacoes: 'meu cpf é 529.982.247-25' })).toEqual({
      observacoes: 'meu cpf é 529.982.247-25',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O spec: chave, rótulo, opções, faixa, limite
// ───────────────────────────────────────────────────────────────────────────────
describe('validateRegistrationFormSpec()', () => {
  it('recusa quando a configuração não é uma lista', () => {
    expect(problemsOf({ key: 'x' })).toEqual(['NOT_A_LIST']);
    expect(problemsOf('texto')).toEqual(['NOT_A_LIST']);
    expect(problemsOf(null)).toEqual(['NOT_A_LIST']);
    expect(problemsOf(undefined)).toEqual(['NOT_A_LIST']);
  });

  it('lista vazia é válida: o evento que não declarou campo nenhum', () => {
    const result = validateRegistrationFormSpec([]);

    expect(result.ok).toBe(true);

    if (result.ok) expect(result.fields).toEqual([]);
  });

  it('recusa acima do teto de campos', () => {
    const muitos = Array.from({ length: 41 }, (_, index) => field({ key: `campo_${index}` }));

    expect(problemsOf(muitos)).toEqual(['TOO_MANY_FIELDS']);
  });

  it('recusa item que não é objeto', () => {
    expect(problemsOf(['restricao'])).toEqual(['NOT_AN_OBJECT']);
    expect(problemsOf([['restricao']])).toEqual(['NOT_AN_OBJECT']);
    expect(problemsOf([null])).toEqual(['NOT_AN_OBJECT']);
  });

  it('recusa chave ausente, vazia, com maiúscula, com hífen ou longa demais', () => {
    expect(problemsOf([field({ key: undefined })])).toEqual(['MISSING_KEY']);
    expect(problemsOf([field({ key: '' })])).toEqual(['MISSING_KEY']);
    expect(problemsOf([field({ key: 42 })])).toEqual(['INVALID_KEY']);
    expect(problemsOf([field({ key: 'Restricao' })])).toEqual(['INVALID_KEY']);
    expect(problemsOf([field({ key: 'restricao-alimentar' })])).toEqual(['INVALID_KEY']);
    expect(problemsOf([field({ key: '1restricao' })])).toEqual(['INVALID_KEY']);
    expect(problemsOf([field({ key: 'a'.repeat(41) })])).toEqual(['INVALID_KEY']);
  });

  it('aceita chave no limite de 40 caracteres', () => {
    expect(problemsOf([field({ key: `a${'b'.repeat(39)}` })])).toEqual([]);
  });

  it('recusa chave reservada do sistema', () => {
    for (const key of ['__proto__', 'constructor', 'key', 'type', 'id', 'evento']) {
      expect(problemsOf([field({ key })]), key).toEqual(['RESERVED_KEY']);
    }
  });

  it('recusa chave repetida — duas vezes o mesmo campo não é o mesmo campo', () => {
    expect(problemsOf([field({ key: 'a' }), field({ key: 'a' })])).toEqual(['DUPLICATE_KEY']);
  });

  it('recusa rótulo ausente, vazio, de outro tipo ou longo demais', () => {
    expect(problemsOf([field({ label: undefined })])).toEqual(['MISSING_LABEL']);
    expect(problemsOf([field({ label: '' })])).toEqual(['MISSING_LABEL']);
    expect(problemsOf([field({ label: '   ' })])).toEqual(['INVALID_LABEL']);
    expect(problemsOf([field({ label: 7 })])).toEqual(['INVALID_LABEL']);
    expect(problemsOf([field({ label: 'x'.repeat(121) })])).toEqual(['INVALID_LABEL']);
  });

  it('recusa tipo ausente', () => {
    expect(problemsOf([field({ type: undefined })])).toEqual(['MISSING_TYPE']);
  });

  it('recusa `required` que não é verdadeiro ou falso', () => {
    expect(problemsOf([field({ required: 'sim' })])).toEqual(['INVALID_REQUIRED']);
    expect(problemsOf([field({ required: 1 })])).toEqual(['INVALID_REQUIRED']);
  });

  it('recusa propriedade que o sistema não conhece, em vez de ignorá-la', () => {
    expect(problemsOf([field({ sensitive: true })])).toEqual(['UNKNOWN_PROPERTY']);
    expect(problemsOf([field({ visible: false })])).toEqual(['UNKNOWN_PROPERTY']);
  });

  it('escolha única: exige opções, com pelo menos uma', () => {
    expect(problemsOf([field({ type: 'SINGLE_CHOICE' })])).toEqual(['MISSING_OPTIONS']);
    expect(problemsOf([field({ type: 'SINGLE_CHOICE', options: [] })])).toEqual(['INVALID_OPTIONS']);
    expect(problemsOf([field({ type: 'SINGLE_CHOICE', options: 'sim;nao' })])).toEqual([
      'INVALID_OPTIONS',
    ]);
  });

  it('escolha única: recusa opção vazia, repetida, longa demais ou em excesso', () => {
    expect(problemsOf([field({ type: 'SINGLE_CHOICE', options: ['Vegano', ''] })])).toEqual([
      'INVALID_OPTIONS',
    ]);
    expect(problemsOf([field({ type: 'SINGLE_CHOICE', options: ['Vegano', 'Vegano'] })])).toEqual([
      'INVALID_OPTIONS',
    ]);
    expect(
      problemsOf([field({ type: 'SINGLE_CHOICE', options: ['x'.repeat(81)] })]),
    ).toEqual(['INVALID_OPTIONS']);

    const muitas = Array.from({ length: FORM_CHOICE_OPTIONS_MAX + 1 }, (_, index) => `Opção ${index}`);
    expect(problemsOf([field({ type: 'SINGLE_CHOICE', options: muitas })])).toEqual([
      'INVALID_OPTIONS',
    ]);
  });

  it('escolha única: aceita opções válidas e apara o espaço das pontas', () => {
    const result = validateRegistrationFormSpec([
      field({ type: 'SINGLE_CHOICE', options: ['  Vegano ', 'Sem glúten'] }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) expect(result.fields[0]?.options).toEqual(['Vegano', 'Sem glúten']);
  });

  it('opções só existem no tipo escolha única', () => {
    expect(problemsOf([field({ options: ['a'] })])).toEqual(['INVALID_OPTIONS']);
  });

  it('número: recusa faixa invertida, não inteira e em tipo que não é número', () => {
    expect(problemsOf([field({ type: 'NUMBER', min: 18, max: 12 })])).toEqual(['INVALID_RANGE']);
    expect(problemsOf([field({ type: 'NUMBER', min: 1.5 })])).toEqual(['INVALID_RANGE']);
    expect(problemsOf([field({ type: 'NUMBER', max: '99' })])).toEqual(['INVALID_RANGE']);
    expect(problemsOf([field({ min: 1 })])).toEqual(['INVALID_RANGE']);
  });

  it('número: aceita faixa coerente, inclusive com os dois limites iguais', () => {
    expect(problemsOf([field({ type: 'NUMBER', min: 18, max: 99 })])).toEqual([]);
    expect(problemsOf([field({ type: 'NUMBER', min: 18, max: 18 })])).toEqual([]);
    expect(problemsOf([field({ type: 'NUMBER', min: 0 })])).toEqual([]);
  });

  it('limite de caracteres: só no texto, inteiro, dentro do teto do tipo', () => {
    expect(problemsOf([field({ maxLength: FORM_SHORT_TEXT_MAX })])).toEqual([]);
    expect(problemsOf([field({ maxLength: FORM_SHORT_TEXT_MAX + 1 })])).toEqual([
      'INVALID_MAX_LENGTH',
    ]);
    expect(problemsOf([field({ maxLength: 0 })])).toEqual(['INVALID_MAX_LENGTH']);
    expect(problemsOf([field({ maxLength: 2.5 })])).toEqual(['INVALID_MAX_LENGTH']);
    expect(problemsOf([field({ type: 'NUMBER', maxLength: 10 })])).toEqual(['INVALID_MAX_LENGTH']);

    expect(
      problemsOf([field({ type: 'LONG_TEXT', purpose: 'Saber a expectativa.', maxLength: FORM_LONG_TEXT_MAX })]),
    ).toEqual([]);
    expect(
      problemsOf([field({ type: 'LONG_TEXT', purpose: 'Saber a expectativa.', maxLength: FORM_LONG_TEXT_MAX + 1 })]),
    ).toEqual(['INVALID_MAX_LENGTH']);
  });

  it('ajuda: texto curto; ajuda longa demais é recusada', () => {
    expect(problemsOf([field({ help: 'Aparece na sua credencial.' })])).toEqual([]);
    expect(problemsOf([field({ help: 7 })])).toEqual(['INVALID_HELP']);
    expect(problemsOf([field({ help: 'x'.repeat(201) })])).toEqual(['INVALID_HELP']);
  });

  it('finalidade: recusa texto, cobra teto e apara o espaço das pontas', () => {
    expect(problemsOf([field({ purpose: 7 })])).toEqual(['MISSING_PURPOSE']);
    expect(
      problemsOf([field({ type: 'LONG_TEXT', purpose: 'x'.repeat(301) })]),
    ).toEqual(['MISSING_PURPOSE']);

    const result = validateRegistrationFormSpec([
      field({ type: 'LONG_TEXT', purpose: '  Saber a expectativa do participante.  ' }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) expect(result.fields[0]?.purpose).toBe('Saber a expectativa do participante.');
  });

  it('devolve um MOTIVO por campo com problema — a tela conserta tudo de uma vez', () => {
    const result = validateRegistrationFormSpec([
      field({ key: 'ok' }),
      field({ key: 'ruim', type: 'CPF' }),
      field({ key: 'ruim2', type: 'EMAIL' }),
    ]);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problems.map((problem) => problem.code)).toEqual([
        'FORBIDDEN_TYPE',
        'UNKNOWN_TYPE',
      ]);
      expect(result.problems.map((problem) => problem.index)).toEqual([2, 3]);
      expect(result.problems.map((problem) => problem.key)).toEqual(['ruim', 'ruim2']);
    }
  });

  it('devolve a lista NORMALIZADA quando tudo está certo', () => {
    const result = validateRegistrationFormSpec([
      field({ key: 'restricao', label: '  Restrição alimentar  ' }),
      field({ key: 'precisa_libras', label: 'Precisa de Libras?', type: 'YES_NO', required: true }),
    ]);

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.fields).toEqual([
        { key: 'restricao', label: 'Restrição alimentar', type: 'SHORT_TEXT', required: false },
        { key: 'precisa_libras', label: 'Precisa de Libras?', type: 'YES_NO', required: true },
      ]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  As respostas: "só o aceito"
// ───────────────────────────────────────────────────────────────────────────────
describe('validateFormResponses() — só o aceito', () => {
  const spec = [
    field({ key: 'restricao', label: 'Restrição alimentar' }),
    field({ key: 'instituicao', label: 'Instituição' }),
    field({ key: 'faixa_etaria', label: 'Faixa etária', type: 'NUMBER', min: 18, max: 99 }),
  ];

  it('manda 5 chaves, 2 fora do spec, e voltam 3', () => {
    const result = validateFormResponses(spec, {
      restricao: 'Vegano',
      instituicao: 'UFBA',
      faixa_etaria: 30,
      cpf: '52998224725',
      consentImage: 'true',
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.accepted).toEqual({
        restricao: 'Vegano',
        instituicao: 'UFBA',
        faixa_etaria: 30,
      });
      expect(result.acceptedKeys).toHaveLength(3);
      expect(result.acceptedKeys).toEqual(['restricao', 'instituicao', 'faixa_etaria']);
      expect(result.rejected).toEqual([]);
    }
  });

  it('chave desconhecida não entra e não vira recusa — ela nem era do formulário', () => {
    const result = validateFormResponses(spec, { restricao: 'Vegano', cpf: '52998224725' });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(Object.keys(result.accepted)).toEqual(['restricao']);
      expect(result.rejected).toEqual([]);
    }
  });

  it('respostas que não são objeto recusam', () => {
    expect(validateFormResponses(spec, null)).toEqual({
      ok: false,
      problem: {
        code: 'NOT_A_RECORD',
        key: null,
        label: null,
        message: 'As respostas do formulário não chegaram em um formato que o sistema entenda.',
      },
    });
    expect(validateFormResponses(spec, 'restricao=Vegano').ok).toBe(false);
    expect(validateFormResponses(spec, ['Vegano']).ok).toBe(false);
  });

  it('spec inválido recusa e diz o motivo — nada é aceito por adivinhação', () => {
    const result = validateFormResponses([field({ key: 'saude', type: 'SAUDE' })], {
      saude: 'nada',
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.problem.code).toBe('SPEC_INVALID');
      expect(result.problem.message).toMatch(/configuração deste formulário está inválida/i);
      expect(result.problem.message).toMatch(/dado sensível/i);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Tipo errado, limite, escolha, número e data — os DOIS lados
// ───────────────────────────────────────────────────────────────────────────────
describe('validateFormResponses() — o que não entra', () => {
  it('tipo errado não entra, com o motivo na recusa', () => {
    const spec = [field({ key: 'restricao', label: 'Restrição alimentar' })];
    const result = validateFormResponses(spec, { restricao: 42 });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.accepted).toEqual({});
      expect(result.rejected).toEqual([
        {
          code: 'WRONG_TYPE',
          key: 'restricao',
          label: 'Restrição alimentar',
          message:
            '"Restrição alimentar" não foi preenchido no formato esperado (Texto curto) e não foi considerado.',
        },
      ]);
    }
  });

  it('texto longo demais no campo de texto curto não é "tipo errado" — é valor acima do teto', () => {
    /** O que separa os dois tipos é o TETO, não a forma do valor. */
    const spec = [field({ key: 'restricao', maxLength: 8 })];

    expect(acceptedOrNull(spec, { restricao: 'Vegano' })).toEqual({ restricao: 'Vegano' });
    expect(rejectionCodes(spec, { restricao: 'Vegano' })).toEqual([]);

    const longo = 'Vegano e sem glúten';
    expect(acceptedOrNull(spec, { restricao: longo })).toEqual({});
    expect(rejectionCodes(spec, { restricao: longo })).toEqual(['TOO_LONG']);
  });

  it('limite de borda: exatamente no limite passa, um a mais não passa', () => {
    const spec = [field({ key: 'restricao', label: 'Restrição', maxLength: 10 })];

    expect(acceptedOrNull(spec, { restricao: 'x'.repeat(10) })).toEqual({ restricao: 'x'.repeat(10) });

    const result = validateFormResponses(spec, { restricao: 'x'.repeat(11) });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.accepted).toEqual({});
      expect(result.rejected[0]?.code).toBe('TOO_LONG');
      expect(result.rejected[0]?.message).toContain('10 caracteres');
    }
  });

  it('o limite é medido no valor aparado — o espaço das pontas não conta', () => {
    const spec = [field({ key: 'restricao', maxLength: 6 })];

    expect(acceptedOrNull(spec, { restricao: '  Vegano  ' })).toEqual({ restricao: 'Vegano' });
  });

  it('`required` vazio RECUSA a inscrição inteira e diz qual campo, com o rótulo', () => {
    const spec = [
      field({ key: 'restricao' }),
      field({ key: 'instituicao', label: 'Instituição', required: true }),
    ];

    for (const vazio of [undefined, null, '', '   ']) {
      const result = validateFormResponses(spec, { restricao: 'Vegano', instituicao: vazio });

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.problem.code).toBe('MISSING_REQUIRED');
        expect(result.problem.key).toBe('instituicao');
        expect(result.problem.label).toBe('Instituição');
        expect(result.problem.message).toBe('Preencha "Instituição".');
      }
    }
  });

  it('campo obrigatório PREENCHIDO passa', () => {
    const spec = [field({ key: 'instituicao', label: 'Instituição', required: true })];

    expect(acceptedOrNull(spec, { instituicao: 'UFBA' })).toEqual({ instituicao: 'UFBA' });
  });

  it('campo OPCIONAL vazio simplesmente não entra no JSON', () => {
    const spec = [field({ key: 'restricao' })];

    expect(acceptedOrNull(spec, {})).toEqual({});
    expect(acceptedOrNull(spec, { restricao: '' })).toEqual({});
    expect(acceptedOrNull(spec, { restricao: '   ' })).toEqual({});
  });

  it('escolha fora das opções não entra (e o valor certo entra)', () => {
    const spec = [
      field({ key: 'refeicao', label: 'Refeição', type: 'SINGLE_CHOICE', options: ['Vegano', 'Padrão'] }),
    ];

    expect(acceptedOrNull(spec, { refeicao: 'Vegano' })).toEqual({ refeicao: 'Vegano' });

    const result = validateFormResponses(spec, { refeicao: 'vegano' });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.accepted).toEqual({});
      expect(result.rejected[0]?.code).toBe('NOT_AN_OPTION');
      expect(result.rejected[0]?.message).toContain('Vegano');
    }
  });

  it('número fora da faixa não entra; nos limites, entra', () => {
    const spec = [field({ key: 'idade', label: 'Idade', type: 'NUMBER', min: 18, max: 99 })];

    expect(acceptedOrNull(spec, { idade: 18 })).toEqual({ idade: 18 });
    expect(acceptedOrNull(spec, { idade: 99 })).toEqual({ idade: 99 });
    expect(acceptedOrNull(spec, { idade: 17 })).toEqual({});
    expect(acceptedOrNull(spec, { idade: 100 })).toEqual({});
    expect(rejectionCodes(spec, { idade: 17 })).toEqual(['OUT_OF_RANGE']);
    expect(rejectionCodes(spec, { idade: 100 })).toEqual(['OUT_OF_RANGE']);

    const result = validateFormResponses(spec, { idade: 17 });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.rejected[0]?.code).toBe('OUT_OF_RANGE');
      expect(result.rejected[0]?.message).toContain('entre 18 e 99');
    }
  });

  it('número SEM faixa aceita qualquer inteiro e recusa o que não é número', () => {
    const spec = [field({ key: 'quantos', label: 'Quantos?', type: 'NUMBER' })];

    expect(acceptedOrNull(spec, { quantos: 7 })).toEqual({ quantos: 7 });
    expect(acceptedOrNull(spec, { quantos: -3 })).toEqual({ quantos: -3 });
    expect(acceptedOrNull(spec, { quantos: 'abc' })).toEqual({});
    expect(acceptedOrNull(spec, { quantos: '12,5' })).toEqual({});
    expect(acceptedOrNull(spec, { quantos: 12.5 })).toEqual({});
    expect(acceptedOrNull(spec, { quantos: true })).toEqual({});
    expect(rejectionCodes(spec, { quantos: 'abc' })).toEqual(['WRONG_TYPE']);
    expect(rejectionCodes(spec, { quantos: 12.5 })).toEqual(['WRONG_TYPE']);
  });

  it('número aceito como texto do formulário é convertido — e só quando é número', () => {
    const spec = [field({ key: 'idade', type: 'NUMBER', min: 0, max: 130 })];

    expect(acceptedOrNull(spec, { idade: '30' })).toEqual({ idade: 30 });
    expect(acceptedOrNull(spec, { idade: ' 30 ' })).toEqual({ idade: 30 });
    expect(acceptedOrNull(spec, { idade: '30.0' })).toEqual({ idade: 30 });
  });

  it('data: aceita data real, recusa o que não existe no calendário', () => {
    const spec = [field({ key: 'chegada', label: 'Chegada', type: 'DATE' })];

    expect(acceptedOrNull(spec, { chegada: '2026-10-12' })).toEqual({ chegada: '2026-10-12' });
    expect(acceptedOrNull(spec, { chegada: '2024-02-29' })).toEqual({ chegada: '2024-02-29' });

    for (const invalida of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '12/10/2026', '2026-1-2', 'hoje']) {
      expect(acceptedOrNull(spec, { chegada: invalida }), invalida).toEqual({});
      expect(rejectionCodes(spec, { chegada: invalida }), invalida).toEqual(['INVALID_DATE']);
    }

    const result = validateFormResponses(spec, { chegada: '2026-02-30' });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.rejected[0]?.code).toBe('INVALID_DATE');
      expect(result.rejected[0]?.message).toContain('AAAA-MM-DD');
    }
  });

  it('Sim/Não: aceita as formas do formulário e recusa o que não é resposta', () => {
    const spec = [field({ key: 'libras', label: 'Precisa de Libras?', type: 'YES_NO' })];

    expect(acceptedOrNull(spec, { libras: true })).toEqual({ libras: true });
    expect(acceptedOrNull(spec, { libras: false })).toEqual({ libras: false });
    expect(acceptedOrNull(spec, { libras: 'on' })).toEqual({ libras: true });
    expect(acceptedOrNull(spec, { libras: 'true' })).toEqual({ libras: true });
    expect(acceptedOrNull(spec, { libras: 'sim' })).toEqual({ libras: true });
    expect(acceptedOrNull(spec, { libras: 'off' })).toEqual({ libras: false });
    expect(acceptedOrNull(spec, { libras: 'não' })).toEqual({ libras: false });
    expect(acceptedOrNull(spec, { libras: '' })).toEqual({});
    expect(acceptedOrNull(spec, { libras: 'talvez' })).toEqual({});
    expect(acceptedOrNull(spec, { libras: 2 })).toEqual({});
    expect(rejectionCodes(spec, { libras: 'talvez' })).toEqual(['WRONG_TYPE']);
    expect(rejectionCodes(spec, { libras: 2 })).toEqual(['WRONG_TYPE']);
  });

  it('recusas e aceites convivem: o que dá certo entra, o que não dá é relatado', () => {
    const spec = [
      field({ key: 'restricao', label: 'Restrição' }),
      field({ key: 'idade', label: 'Idade', type: 'NUMBER', min: 18, max: 99 }),
      field({ key: 'chegada', label: 'Chegada', type: 'DATE' }),
    ];

    const result = validateFormResponses(spec, {
      restricao: 'Vegano',
      idade: 200,
      chegada: '2026-02-30',
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.accepted).toEqual({ restricao: 'Vegano' });
      expect(result.rejected.map((rejection) => rejection.code)).toEqual([
        'OUT_OF_RANGE',
        'INVALID_DATE',
      ]);
      expect(result.rejected.map((rejection) => rejection.label)).toEqual(['Idade', 'Chegada']);
    }
  });

  it('lista de campos vazia aceita as respostas e devolve nada — o formulário padrão manda', () => {
    expect(acceptedOrNull([], { cpf: '52998224725', accessibilityNotes: 'Rampa' })).toEqual({});
  });

  it('não modifica o objeto de respostas recebido', () => {
    const spec = [field({ key: 'restricao' })];
    const cru = { restricao: 'Vegano', cpf: '52998224725' };

    validateFormResponses(spec, cru);

    expect(cru).toEqual({ restricao: 'Vegano', cpf: '52998224725' });
  });

  it('não guarda a resposta crua do tipo errado "normalizada"', () => {
    const spec = [field({ key: 'idade', type: 'NUMBER' })];

    expect(acceptedOrNull(spec, { idade: '' })).toEqual({});
    expect(acceptedOrNull(spec, { idade: null })).toEqual({});
    expect(acceptedOrNull(spec, { idade: undefined })).toEqual({});
    expect(acceptedOrNull(spec, { idade: '0' })).toEqual({ idade: 0 });
  });
});

describe('isCalendarDate()', () => {
  it('aceita datas que existem e recusa as que não existem', () => {
    expect(isCalendarDate('2026-10-12')).toBe(true);
    expect(isCalendarDate('2026-12-31')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-04-31')).toBe(false);
    expect(isCalendarDate('2026-10-12T00:00:00Z')).toBe(false);
    expect(isCalendarDate(20261012)).toBe(false);
    expect(isCalendarDate('')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  readRegistrationForm() — o leitor TOLERANTE
// ───────────────────────────────────────────────────────────────────────────────
describe('readRegistrationForm()', () => {
  const declarado = [field({ key: 'restricao' })];

  it('cai no padrão quando `settings` está ausente ou nem é objeto', () => {
    for (const settings of [undefined, null, 'texto', 42, [], true]) {
      const result = readRegistrationForm(settings);

      expect(result.source, String(settings)).toBe('DEFAULT');
      expect(result.fields).toEqual([]);
      expect(result.problems).toEqual([]);
    }
  });

  it('cai no padrão quando a chave `registrationForm` não existe — o caso normal', () => {
    const result = readRegistrationForm({ registrationRequiresMembership: false });

    expect(result).toEqual({ fields: [], source: 'DEFAULT', problems: [] });
  });

  it('cai no padrão quando `registrationForm` é null', () => {
    expect(readRegistrationForm({ registrationForm: null }).source).toBe('DEFAULT');
  });

  it('cai no padrão quando a configuração está torcida — e diz POR QUÊ', () => {
    const torto = readRegistrationForm({ registrationForm: [{ key: 'x' }] });

    expect(torto.source).toBe('DEFAULT');
    expect(torto.fields).toEqual([]);
    expect(torto.problems.map((problem) => problem.code)).toEqual(['MISSING_LABEL']);
  });

  it('cai no padrão quando o spec declara um tipo sensível — sem "consertar" nada', () => {
    const torto = readRegistrationForm({ registrationForm: [field({ type: 'CPF' })] });

    expect(torto.source).toBe('DEFAULT');
    expect(torto.fields).toEqual([]);
    expect(torto.problems[0]?.code).toBe('FORBIDDEN_TYPE');
  });

  it('cai no padrão quando `registrationForm` não é lista', () => {
    const torto = readRegistrationForm({ registrationForm: { key: 'x' } });

    expect(torto.source).toBe('DEFAULT');
    expect(torto.problems[0]?.code).toBe('NOT_A_LIST');
  });

  it('lê o formulário declarado quando ele está válido', () => {
    const result = readRegistrationForm({
      registrationRequiresMembership: true,
      registrationForm: declarado,
    });

    expect(result.source).toBe('SETTINGS');
    expect(result.problems).toEqual([]);
    expect(result.fields).toEqual([
      { key: 'restricao', label: 'Restrição alimentar', type: 'SHORT_TEXT', required: false },
    ]);
  });

  it('lista vazia declarada é formulário declarado (e vazio), não "padrão"', () => {
    const result = readRegistrationForm({ registrationForm: [] });

    expect(result.source).toBe('SETTINGS');
    expect(result.fields).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Dado pessoal — o padrão é NÃO expor
// ───────────────────────────────────────────────────────────────────────────────
describe('formResponsesWithoutPersonalData()', () => {
  it('não devolve CPF, necessidades, dieta nem consentimentos', () => {
    const respostas = {
      cpf: '52998224725',
      accessibilityNotes: 'Cadeirante; sem glúten',
      dietaryNotes: 'Vegano',
      consentData: true,
      consentImage: 'on',
    };

    expect(formResponsesWithoutPersonalData(respostas)).toEqual({});
  });

  it('não devolve campo que o organizador declarou — o padrão vale para o desconhecido', () => {
    expect(formResponsesWithoutPersonalData({ restricao: 'Vegano', idade: 30 })).toEqual({});
  });

  it('não devolve o que o formulário PADRÃO responde', () => {
    /** O formulário real de hoje, exatamente como o serviço grava. */
    expect(
      formResponsesWithoutPersonalData({
        cpf: '52998224725',
        accessibilityNotes: 'Intérprete de Libras',
      }),
    ).toEqual({});
  });

  it('a allowlist de terceiro não contém nenhuma chave proibida', () => {
    for (const proibida of THIRD_PARTY_FORBIDDEN_FORM_KEYS) {
      expect(THIRD_PARTY_FORM_RESPONSE_KEYS).not.toContain(proibida);
    }
  });

  it('a allowlist está VAZIA hoje: expor é decisão explícita, e nenhuma foi tomada', () => {
    expect(THIRD_PARTY_FORM_RESPONSE_KEYS).toEqual([]);
  });

  it('não modifica o objeto recebido', () => {
    const respostas = { cpf: '52998224725' };

    formResponsesWithoutPersonalData(respostas);

    expect(respostas).toEqual({ cpf: '52998224725' });
  });

  it('objeto vazio devolve objeto vazio', () => {
    expect(formResponsesWithoutPersonalData({})).toEqual({});
  });

  it('a allowlist é o ÚNICO caminho: o que sai vem dela, e nada mais', () => {
    /**
     * A catraca da decisão: crescer a allowlist é permitido, mas é ato consciente —
     * quem acrescentar uma chave vê ESTE teste mudar junto, e a pergunta "por que este
     * campo sai para terceiro?" tem de ser respondida no código.
     */
    const respostas = { cpf: '52998224725', restricao: 'Vegano', nome_completo: 'Ana' };
    const expostas = formResponsesWithoutPersonalData(respostas);

    expect(Object.keys(expostas)).toEqual([...THIRD_PARTY_FORM_RESPONSE_KEYS]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O nome do controle — o prefixo que impede a colisão com o formulário fixo
// ───────────────────────────────────────────────────────────────────────────────
describe('formResponseFieldName()', () => {
  it('prefixa a chave declarada — o campo nunca colide com o CPF do sistema', () => {
    expect(formResponseFieldName('restricao')).toBe('resposta_restricao');
    /** O caso que o prefixo existe para impedir: `cpf` é do formulário FIXO. */
    expect(formResponseFieldName('cpf')).not.toBe('cpf');
  });

  it('`cpf` e as chaves do formulário fixo são RESERVADAS — a segunda camada', () => {
    /**
     * O prefixo protege o `<form>`; a lista de reservadas protege o JSON. Sem ela, um
     * campo declarado como `cpf` gravaria a resposta dele na MESMA propriedade que o
     * certificado lê.
     */
    for (const key of ['cpf', 'accessibilityNotes', 'consentData', 'consentImage']) {
      expect(problemsOf([field({ key })])).toContain('RESERVED_KEY');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A COMPOSIÇÃO DO DEPÓSITO — o que o organizador declarou, e o sistema por ÚLTIMO
// ───────────────────────────────────────────────────────────────────────────────
describe('composeFormResponses()', () => {
  it('o declarado entra e as chaves do SISTEMA têm a última palavra', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O CASO É HOSTIL DE PROPÓSITO, E ISSO É O TESTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  `validateRegistrationFormSpec` recusa `cpf` como identificador de campo — então,
     *  no caminho real, um `accepted` com `cpf` não existe. Passá-lo aqui é o único jeito
     *  de medir a SEGUNDA camada (a ordem da composição), que é a que protege uma chave
     *  de sistema nova que alguém esqueça de acrescentar a `FORM_RESERVED_KEYS`.
     */
    const composto = composeFormResponses({
      declared: { cpf: '11144477735', instituicao: 'UFBA' },
      system: { cpf: '52998224725' },
    });

    expect(composto).toEqual({ cpf: '52998224725', instituicao: 'UFBA' });
  });

  it('sem chave de sistema, o declarado passa inteiro', () => {
    expect(
      composeFormResponses({ declared: { restricao: 'Sem glúten' }, system: {} }),
    ).toEqual({ restricao: 'Sem glúten' });
  });

  it('devolve objeto NOVO — quem chama tem o aceito do validador em mãos', () => {
    const declared = { restricao: 'Vegano' };
    const composto = composeFormResponses({ declared, system: {} });

    expect(composto).not.toBe(declared);
    composto.restricao = 'Outro';
    expect(declared.restricao).toBe('Vegano');
  });

  it('as duas portas de escrita chamam esta função — ela não é promessa sem chamador', () => {
    /**
     * A lição da própria fase (código que existia e era MORTO): a função de domínio sem
     * chamador não é funcionalidade. A catraca lê o arquivo das DUAS actions e exige o
     * uso — um `{ ...aceito, cpf }` espalhado de volta à mão passa a reprovar aqui.
     */
    const fonte = readFileSync('src/app/actions/registration-actions.ts', 'utf8');

    /** A importação não conta — só as CHAMADAS. */
    const usos = fonte.match(/composeFormResponses\(\{/g) ?? [];

    expect(usos.length).toBeGreaterThanOrEqual(2);

    /** E o espalhamento manual, que a função substituiu, não voltou. */
    expect(fonte).not.toContain('...(cpf ? { cpf } : {})');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A ELIMINAÇÃO — o que sai e o que fica
// ───────────────────────────────────────────────────────────────────────────────
describe('erasePersonalFormResponses()', () => {
  it('apaga os campos DECLARADOS e o que não é obrigação do evento', () => {
    const { kept, removedKeys } = erasePersonalFormResponses({
      restricao: 'Sem glúten',
      instituicao: 'UFBA',
      observacoes: 'Chego às 9h',
    });

    expect(kept).toEqual({});
    expect(removedKeys).toEqual(['restricao', 'instituicao', 'observacoes']);
  });

  it('PRESERVA o CPF — é a base do certificado', () => {
    const { kept, removedKeys } = erasePersonalFormResponses({
      cpf: '52998224725',
      restricao: 'Vegano',
    });

    expect(kept).toEqual({ cpf: '52998224725' });
    expect(removedKeys).toEqual(['restricao']);
  });

  it('apaga a resposta de um campo que o organizador JÁ REMOVEU do formulário', () => {
    /**
     * É o caso que decide o desenho: a lista do que SAI seria "as chaves dos campos
     * declarados hoje", e a resposta de um campo apagado do formulário ficaria
     * guardada para sempre — sem que ninguém pudesse apagá-la. A allowlist do que FICA
     * é fail-safe: na dúvida, apaga.
     */
    const { kept, removedKeys } = erasePersonalFormResponses({ campo_antigo: 'valor' });

    expect(kept).toEqual({});
    expect(removedKeys).toEqual(['campo_antigo']);
  });

  it('depósito vazio (ou lixo) não devolve chave nenhuma — e nada a preservar', () => {
    expect(erasePersonalFormResponses({})).toEqual({ kept: {}, removedKeys: [] });
    expect(erasePersonalFormResponses(null)).toEqual({ kept: {}, removedKeys: [] });
    expect(erasePersonalFormResponses('texto')).toEqual({ kept: {}, removedKeys: [] });
    expect(erasePersonalFormResponses(['a'])).toEqual({ kept: {}, removedKeys: [] });
  });

  it('é idempotente: apagar o que já foi apagado não devolve chave nenhuma', () => {
    const primeira = erasePersonalFormResponses({ cpf: '52998224725', restricao: 'Vegano' });
    const segunda = erasePersonalFormResponses(primeira.kept);

    expect(segunda.removedKeys).toEqual([]);
    expect(segunda.kept).toEqual({ cpf: '52998224725' });
  });

  it('não modifica o objeto recebido — quem chama tem o JSON do banco em mãos', () => {
    const respostas = { cpf: '52998224725', restricao: 'Vegano' };

    erasePersonalFormResponses(respostas);

    expect(respostas).toEqual({ cpf: '52998224725', restricao: 'Vegano' });
  });

  it('a allowlist do que FICA é curta e declarada — o CPF, e só', () => {
    /**
     * Os consentimentos não estão nesta lista porque não estão no depósito: eles são
     * COLUNAS de `registrations`, e o serviço de eliminação não as toca (a prova está
     * na integração). Crescer esta lista é decisão explícita, e este teste existe para
     * que ela seja vista.
     */
    expect(EVENT_OBLIGATION_FORM_KEYS).toEqual(['cpf']);
  });
});
