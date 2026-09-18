/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — AUTORIA da submissão (FASE 17, item E6)
 *
 *  A ordem de autoria é informação ACADÊMICA (citação, currículo, bolsa) e o autor
 *  correspondente é quem responde pelo trabalho. Nenhuma das duas pode depender do
 *  que o formulário enviou por acidente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_SUBMISSION_AUTHORS,
  ORCID_PATTERN,
  authorsDiffer,
  linkKnownAuthors,
  normalizeAuthors,
  toAuthorFormValues,
} from '../../src/domain/review/author-rules';

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalizeAuthors()', () => {
  it('reindexa a ordem de crédito de 1 a N, na ordem recebida', () => {
    const result = normalizeAuthors([
      { name: 'Ana Ribeiro', email: 'ana@ufba.br' },
      { name: 'Bruno Lima', email: 'bruno@ufba.br' },
      { name: 'Carla Souza', email: 'carla@ufba.br' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authors.map((author) => author.authorOrder)).toEqual([1, 2, 3]);
      expect(result.authors.map((author) => author.name)).toEqual([
        'Ana Ribeiro',
        'Bruno Lima',
        'Carla Souza',
      ]);
    }
  });

  it('sem marcação, o PRIMEIRO autor é o correspondente (é o que a academia espera)', () => {
    const result = normalizeAuthors([{ name: 'Ana Ribeiro' }, { name: 'Bruno Lima' }]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authors[0]?.isCorresponding).toBe(true);
      expect(result.authors[1]?.isCorresponding).toBe(false);
    }
  });

  it('com VÁRIOS marcados, vale o primeiro — nunca dois correspondentes', () => {
    const result = normalizeAuthors([
      { name: 'Ana Ribeiro' },
      { name: 'Bruno Lima', isCorresponding: true },
      { name: 'Carla Souza', isCorresponding: true },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authors.filter((author) => author.isCorresponding)).toHaveLength(1);
      expect(result.authors[1]?.isCorresponding).toBe(true);
    }
  });

  it('recusa lista vazia: uma submissão tem ao menos um autor', () => {
    expect(normalizeAuthors([]).ok).toBe(false);
  });

  it('recusa acima do teto de autores', () => {
    const many = Array.from({ length: MAX_SUBMISSION_AUTHORS + 1 }, (_, i) => ({
      name: `Autor ${i}`,
      email: `autor${i}@ufba.br`,
    }));
    const result = normalizeAuthors(many);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain(String(MAX_SUBMISSION_AUTHORS));
  });

  it('recusa o MESMO e-mail duas vezes — o defeito clássico de "adicionar mais um"', () => {
    const result = normalizeAuthors([
      { name: 'Ana Ribeiro', email: 'ana@ufba.br' },
      { name: 'Ana R.', email: 'ANA@ufba.br' },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('já está na lista');
  });

  it('recusa a MESMA conta duas vezes', () => {
    const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const result = normalizeAuthors([
      { name: 'Ana Ribeiro', userId: id },
      { name: 'Ana Ribeiro (conta)', userId: id },
    ]);
    expect(result.ok).toBe(false);
  });

  it('aponta a LINHA do erro, não só o erro', () => {
    const result = normalizeAuthors([{ name: 'Ana Ribeiro' }, { name: 'Bu' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('Autor 2');
  });

  it('valida ORCID no formato canônico quando informado', () => {
    expect(ORCID_PATTERN.test('0000-0002-1825-0097')).toBe(true);
    expect(ORCID_PATTERN.test('0000-0002-1825-009X')).toBe(true);
    expect(ORCID_PATTERN.test('0000-0002-1825')).toBe(false);

    const invalid = normalizeAuthors([{ name: 'Ana Ribeiro', orcidId: '1234' }]);
    expect(invalid.ok).toBe(false);

    const valid = normalizeAuthors([{ name: 'Ana Ribeiro', orcidId: '0000-0002-1825-0097' }]);
    expect(valid.ok).toBe(true);
  });

  it('recusa e-mail inválido em vez de gravar lixo no contato', () => {
    expect(normalizeAuthors([{ name: 'Ana Ribeiro', email: 'ana@' }]).ok).toBe(false);
  });

  it('normaliza espaços e converte campo vazio em ausente', () => {
    const result = normalizeAuthors([
      { name: '  Ana Ribeiro  ', email: '  ', institution: '  UFBA  ' },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authors[0]?.name).toBe('Ana Ribeiro');
      expect(result.authors[0]?.email).toBeNull();
      expect(result.authors[0]?.institution).toBe('UFBA');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('toAuthorFormValues()', () => {
  it('prefere o dado da CONTA ao do convidado', () => {
    const values = toAuthorFormValues([
      {
        userId: 'u1',
        guestName: 'apelido',
        guestEmail: 'apelido@x.test',
        guestInstitution: 'Instituição antiga',
        guestOrcidId: '0000-0002-1825-0097',
        isCorresponding: true,
      },
    ]);

    expect(values[0]).toEqual({
      userId: 'u1',
      name: 'apelido',
      email: 'apelido@x.test',
      institution: 'Instituição antiga',
      orcidId: '0000-0002-1825-0097',
      isCorresponding: true,
    });
  });

  it('lida com autor sem conta (campos de convidado)', () => {
    const values = toAuthorFormValues([
      { guestName: 'Convidado Externo', guestEmail: 'ext@outra.test' },
    ]);

    expect(values[0]?.userId).toBeNull();
    expect(values[0]?.name).toBe('Convidado Externo');
    expect(values[0]?.isCorresponding).toBe(false);
  });

  it('devolve lista vazia para entrada vazia', () => {
    expect(toAuthorFormValues([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('authorsDiffer()', () => {
  const base = [
    { userId: null, name: 'Ana', email: 'ana@ufba.br', institution: null, orcidId: null, isCorresponding: true },
  ];

  it('detecta troca de ordem, de nome e de correspondente', () => {
    const bruno = {
      userId: null,
      name: 'Bruno',
      email: 'bruno@ufba.br',
      institution: null,
      orcidId: null,
      isCorresponding: false,
    };

    expect(authorsDiffer(base, [...base])).toBe(false);
    expect(authorsDiffer(base, [{ ...base[0]!, name: 'Ana R.' }])).toBe(true);
    expect(authorsDiffer(base, [bruno, { ...base[0]!, isCorresponding: false }])).toBe(true);
    expect(authorsDiffer([...base, bruno], [bruno, ...base])).toBe(true);
    expect(authorsDiffer(base, [])).toBe(true);
  });

  it('não considera mudança o que não é mudança (auditoria sem ruído)', () => {
    expect(
      authorsDiffer(
        base,
        [{ ...base[0]!, isCorresponding: true }],
      ),
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('linkKnownAuthors()', () => {
  const authors = [
    {
      userId: null,
      name: 'Ana Ribeiro',
      email: 'ana@ufba.br',
      institution: null,
      orcidId: null,
      isCorresponding: true,
      authorOrder: 1,
    },
    {
      userId: null,
      name: 'Externo',
      email: 'ext@outra.test',
      institution: null,
      orcidId: null,
      isCorresponding: false,
      authorOrder: 2,
    },
  ];

  it('vincula a conta pelo e-mail, preservando o resto', () => {
    const linked = linkKnownAuthors(authors, new Map([['ana@ufba.br', 'user-1']]));
    expect(linked[0]?.userId).toBe('user-1');
    expect(linked[0]?.name).toBe('Ana Ribeiro');
    expect(linked[1]?.userId).toBeNull();
  });

  it('não sobrescreve vínculo já existente', () => {
    const linked = linkKnownAuthors(
      [{ ...authors[0]!, userId: 'conta-original' }],
      new Map([['ana@ufba.br', 'outra']]),
    );
    expect(linked[0]?.userId).toBe('conta-original');
  });

  it('sem e-mail não há como vincular', () => {
    const linked = linkKnownAuthors([{ ...authors[0]!, email: null }], new Map([['ana@ufba.br', 'u']]));
    expect(linked[0]?.userId).toBeNull();
  });
});
