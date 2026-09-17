/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — conflito de interesse
 *
 *  Este é o módulo mais crítico da avaliação por pares: um parecer com conflito
 *  invalida o processo, não apenas o torna "menos justo".
 *
 *  A postura testada é ASSIMÉTRICA: na dúvida, marca-se o conflito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK_ON_UNCERTAIN_CONFLICT,
  detectConflicts,
  domainsMatch,
  emailDomain,
  evaluateConflict,
  hasBlockingConflict,
  institutionsMatch,
  normalizeDomain,
  normalizeInstitution,
  normalizePersonName,
  normalizePersonalId,
  screenReviewersForConflicts,
  type ReviewAuthorIdentity,
  type ReviewerIdentity,
} from '../../src/domain/review/conflict-of-interest';

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
function reviewer(overrides: Partial<ReviewerIdentity> = {}): ReviewerIdentity {
  return {
    userId: 'reviewer-1',
    name: 'Revisora Silva',
    email: 'revisora@universidade-a.edu.br',
    institution: null,
    ...overrides,
  };
}

function author(overrides: Partial<ReviewAuthorIdentity> = {}): ReviewAuthorIdentity {
  return {
    userId: 'author-1',
    name: 'Autor Souza',
    email: 'autor@universidade-b.edu.br',
    institution: null,
    ...overrides,
  };
}

const NO_CONFLICT = { reviewer: reviewer(), authors: [author()] };

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalização', () => {
  it('remove acentos, caixa e pontuação do nome da instituição', () => {
    expect(normalizeInstitution('Universidade Federal da Bahia')).toBe(
      'universidade federal da bahia',
    );
    expect(normalizeInstitution('UNIVERSIDADE  FEDERAL—DA BAHIA')).toBe(
      'universidade federal da bahia',
    );
    expect(normalizeInstitution('Universidade Federal da Bahía')).toBe(
      'universidade federal da bahia',
    );
  });

  it('remove sufixos legais', () => {
    expect(normalizeInstitution('Empresa de Pesquisa LTDA')).toBe('empresa de pesquisa');
    expect(normalizeInstitution('Consultoria S.A.')).toBe('consultoria');
  });

  it('normaliza nome de pessoa', () => {
    expect(normalizePersonName('José  da Silva')).toBe('jose da silva');
    expect(normalizePersonName('JOSÉ DA SILVA')).toBe('jose da silva');
  });

  it('normaliza identificador pessoal removendo espaços e hífens', () => {
    expect(normalizePersonalId('0000-0002-1825-0097')).toBe('0000000218250097');
    expect(normalizePersonalId('  0000 0002  ')).toBe('00000002');
    expect(normalizePersonalId('')).toBeNull();
    expect(normalizePersonalId(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('institutionsMatch()', () => {
  it('casa nomes idênticos com variação de caixa e acento', () => {
    expect(
      institutionsMatch('Universidade Federal da Bahia', 'universidade federal da bahia'),
    ).toBe(true);
    expect(
      institutionsMatch('Universidade Federal da Bahia', 'Universidade Federal da Bahía'),
    ).toBe(true);
  });

  it('casa por CONTENÇÃO (nome curto contido no longo)', () => {
    expect(institutionsMatch('Universidade Federal', 'Universidade Federal da Bahia')).toBe(true);
  });

  it('casa quando o nome completo traz a SIGLA junto', () => {
    // Caso muito comum: a pessoa escreve "Universidade Federal da Bahia - UFBA"
    // e a outra escreve apenas "UFBA".
    expect(
      institutionsMatch('UFBA', 'Universidade Federal da Bahia - UFBA'),
    ).toBe(true);
  });

  it('NÃO casa sigla isolada com o nome por extenso (limitação conhecida)', () => {
    /**
     * "UFBA" não tem relação textual com "Universidade Federal da Bahia"; ligá-las
     * exigiria uma TABELA de sinônimos por instituição (ou consulta a um cadastro
     * oficial), não comparação de strings.
     *
     * Documentamos o comportamento em vez de fingir que resolvemos: um falso
     * negativo aqui é mitigado pela checagem de domínio de e-mail institucional,
     * que costuma pegar o mesmo caso por outro caminho (`@ufba.br`).
     */
    expect(institutionsMatch('UFBA', 'Universidade Federal da Bahia')).toBe(false);
  });

  it('não casa instituições diferentes', () => {
    expect(
      institutionsMatch('Universidade de São Paulo', 'Universidade Federal do Rio'),
    ).toBe(false);
  });

  it('não casa termos curtos por contenção (evita falso positivo)', () => {
    // "un" está contido em "universidade", mas isso não significa nada.
    expect(institutionsMatch('un', 'universidade')).toBe(false);
  });

  it('não casa strings vazias', () => {
    expect(institutionsMatch('', 'UFBA')).toBe(false);
    expect(institutionsMatch('UFBA', '')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('emailDomain()', () => {
  it('extrai o domínio institucional', () => {
    expect(emailDomain('pesquisador@ufba.br')).toBe('ufba.br');
    expect(emailDomain('a.b@universidade.edu.br')).toBe('universidade.edu.br');
  });

  it('RECUSA domínios de provedores pessoais', () => {
    // Dois revisores com @gmail.com não são "da mesma instituição" — tratá-los
    // como tal bloquearia atribuições legítimas em massa.
    for (const domain of ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com.br']) {
      expect(emailDomain(`alguem@${domain}`), `não deveria aceitar ${domain}`).toBeNull();
    }
  });

  it('é insensível a caixa', () => {
    expect(emailDomain('Pesquisador@UFBA.BR')).toBe('ufba.br');
  });

  /**
   * Domínios reservados (RFC 2606/6761) não identificam instituição alguma.
   *
   * O caso que expôs o defeito: em testes e demonstrações todas as contas usam
   * `@example.test`, e o domínio compartilhado fazia todo revisor parecer colega
   * de todo autor — o painel do comitê ficava sem NENHUM elegível.
   */
  it('RECUSA domínios reservados de teste e redes internas', () => {
    for (const domain of [
      'example.test',
      'aluno.example.test',
      'exemplo.example',
      'algo.invalid',
      'servidor.localhost',
      'intranet',
      'maquina.local',
      'host.internal',
      'casa.home.arpa',
    ]) {
      expect(emailDomain(`alguem@${domain}`), `não deveria aceitar ${domain}`).toBeNull();
    }
  });

  it('devolve null para entrada inválida', () => {
    expect(emailDomain('sem-arroba')).toBeNull();
    expect(emailDomain('termina-em-@')).toBeNull();
    expect(emailDomain(null)).toBeNull();
    expect(emailDomain('')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalizeDomain() e domainsMatch()', () => {
  it('normaliza o domínio declarado', () => {
    expect(normalizeDomain('@UFBA.BR')).toBe('ufba.br');
    expect(normalizeDomain('  Ufba.Br  ')).toBe('ufba.br');
  });

  it('recusa declaração vazia ou reservada', () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain('   ')).toBeNull();
    expect(normalizeDomain('example.test')).toBeNull();
  });

  it('reconhece subdomínio como a mesma instituição', () => {
    // `saude.ufba.br` é a UFBA; um revisor que declarou `ufba.br` não deixa de
    // ser colega porque o autor usa o domínio do instituto.
    expect(domainsMatch('saude.ufba.br', 'ufba.br')).toBe(true);
    expect(domainsMatch('ufba.br', 'ufba.br')).toBe(true);
  });

  it('NÃO casa domínios de instituições diferentes', () => {
    expect(domainsMatch('ufba.br', 'ufmg.br')).toBe(false);
    // Cuidado com sufixo textual: `naoufba.br` NÃO é subdomínio de `ufba.br`.
    expect(domainsMatch('naoufba.br', 'ufba.br')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('detectConflicts() — sem conflito', () => {
  it('não detecta nada em caso neutro', () => {
    expect(detectConflicts(NO_CONFLICT)).toHaveLength(0);
  });

  it('não detecta conflito com instituições diferentes', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ institution: 'Universidade A' }),
      authors: [author({ institution: 'Universidade B' })],
    });
    expect(conflicts).toHaveLength(0);
  });

  it('não detecta conflito com e-mails de provedores pessoais', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ email: 'rev@gmail.com' }),
      authors: [author({ email: 'autor@gmail.com' })],
    });
    expect(conflicts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('detectConflicts() — autoria (o caso mais grave)', () => {
  it('detecta o revisor como autor', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ userId: 'u1' }),
      authors: [author({ userId: 'u1', name: 'Revisora Silva' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('COAUTHOR');
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
    expect(conflicts[0]?.reason).toContain('Revisora Silva');
  });

  it('detecta o revisor como autor correspondente mesmo fora da lista', () => {
    // Dado inconsistente não pode virar brecha: se o id bate com quem submeteu,
    // o conflito existe.
    const conflicts = detectConflicts({
      reviewer: reviewer({ userId: 'u1' }),
      authors: [author({ userId: 'u2' })],
      submittedById: 'u1',
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('COAUTHOR');
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
    expect(conflicts[0]?.reason).toMatch(/autor correspondente/i);
  });

  it('detecta coautoria por ORCID compartilhado', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ orcidId: '0000-0002-1825-0097' }),
      authors: [author({ orcidId: '0000-0002-1825-0097' })],
    });

    expect(conflicts[0]?.type).toBe('COAUTHOR');
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
    expect(conflicts[0]?.reason).toMatch(/ORCID/);
  });

  it('detecta coautoria por Lattes compartilhado', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ lattesId: '1234567890123456' }),
      authors: [author({ lattesId: '1234 5678 9012 3456' })],
    });

    expect(conflicts[0]?.type).toBe('COAUTHOR');
    expect(conflicts[0]?.reason).toMatch(/Lattes/);
  });

  it('detecta nome idêntico como conflito INCERTO', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ userId: 'u1', name: 'Maria Fernanda Costa' }),
      authors: [author({ userId: null, name: 'maria fernanda costa' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.confidence).toBe('UNCERTAIN');
    expect(conflicts[0]?.reason).toMatch(/nome/i);
  });

  it('não trata nome curto como conflito (evita falso positivo)', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ userId: 'u1', name: 'Ana' }),
      authors: [author({ userId: null, name: 'Ana' })],
    });
    expect(conflicts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('detectConflicts() — orientação e vínculos', () => {
  it('detecta relação de orientação', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ advisesUserIds: ['orientando-1'] }),
      authors: [author({ userId: 'orientando-1', name: 'Orientando' })],
    });

    expect(conflicts[0]?.type).toBe('ADVISOR_ADVISEE');
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
    expect(conflicts[0]?.reason).toMatch(/orientador/i);
  });

  it('detecta vínculo financeiro declarado', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ hasFinancialTie: true }),
      authors: [author()],
    });

    expect(conflicts[0]?.type).toBe('FINANCIAL_TIE');
    expect(conflicts[0]?.detection).toBe('DECLARED');
  });

  it('declaração do próprio revisor tem precedência absoluta', () => {
    // Se a pessoa afirma ter conflito, não cabe ao sistema contestar — nem
    // sequer para verificar se há outros conflitos.
    const conflicts = detectConflicts({
      reviewer: reviewer({ declaredConflict: true, declaredConflictReason: 'Fui coautor em 2024.' }),
      authors: [author()],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('SELF_DECLARED');
    expect(conflicts[0]?.reason).toBe('Fui coautor em 2024.');
  });

  it('usa texto padrão quando a declaração não tem motivo', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ declaredConflict: true }),
      authors: [author()],
    });
    expect(conflicts[0]?.reason).toMatch(/declarou conflito/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('detectConflicts() — mesma instituição', () => {
  it('detecta por afiliação declarada (CERTAIN)', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ institution: 'Universidade Federal da Bahia' }),
      authors: [author({ institution: 'Universidade Federal da Bahia - UFBA' })],
    });

    expect(conflicts[0]?.type).toBe('SAME_INSTITUTION');
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
  });

  it('duas grafias do mesmo nome são reconhecidas como a mesma instituição', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ institution: 'Universidade Federal da Bahia' }),
      authors: [author({ institution: 'universidade federal da bahía' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
  });

  it('detecta por domínio de e-mail institucional (UNCERTAIN)', () => {
    // Evidência mais fraca: domínio compartilhado pode ser coincidência.
    const conflicts = detectConflicts({
      reviewer: reviewer({ email: 'rev@ufba.br' }),
      authors: [author({ email: 'autor@ufba.br' })],
    });

    expect(conflicts[0]?.type).toBe('SAME_INSTITUTION');
    expect(conflicts[0]?.confidence).toBe('UNCERTAIN');
    expect(conflicts[0]?.reason).toContain('ufba.br');
  });

  it('prefere o domínio DECLARADO sobre o do e-mail', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({
        email: 'pessoal@outro.com',
        institutionalEmailDomain: 'ufba.br',
      }),
      authors: [author({ email: 'autor@ufba.br' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('SAME_INSTITUTION');
  });

  /**
   * A declaração SUBSTITUI o domínio do e-mail; não se soma a ele.
   *
   * Somar criava evidência que ninguém declarou: bastava o revisor ter conta em
   * um domínio corporativo para virar "possível colega" de todo autor com conta
   * no mesmo domínio — mesmo tendo declarado outra instituição.
   */
  it('o domínio declarado NÃO é somado ao domínio do e-mail', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({
        email: 'revisor@outro.com',
        institutionalEmailDomain: 'ufba.br',
      }),
      authors: [author({ email: 'autor@outro.com' })],
    });

    expect(conflicts).toHaveLength(0);
  });

  it('NÃO detecta conflito por domínio reservado de teste', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ email: 'revisor@example.test' }),
      authors: [author({ email: 'autor@example.test' })],
    });

    expect(conflicts).toHaveLength(0);
  });

  it('detecta por SUBDOMÍNIO do domínio declarado', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ institutionalEmailDomain: 'ufba.br' }),
      authors: [author({ email: 'autor@saude.ufba.br' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.confidence).toBe('UNCERTAIN');
  });

  it('afiliação declarada tem precedência sobre heurística de domínio', () => {
    /**
     * O revisor declara a MESMA instituição do autor, mas tem e-mail em outro
     * domínio (caso comum: e-mail antigo, instituição nova).
     *
     * A evidência declarada é a mais forte e é a que deve ser reportada — se a
     * heurística de domínio fosse avaliada antes, o comitê veria uma mensagem
     * mais fraca do que a evidência disponível.
     */
    const conflicts = detectConflicts({
      reviewer: reviewer({
        institution: 'Universidade Federal da Bahia',
        // Domínio diferente: a heurística NÃO dispararia.
        email: 'rev@outra-instituicao.br',
      }),
      authors: [author({ institution: 'Universidade Federal da Bahia - UFBA' })],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.confidence).toBe('CERTAIN');
    expect(conflicts[0]?.reason).toMatch(/declaram a mesma instituição/i);
  });

  it('verifica todos os autores, não apenas o primeiro', () => {
    const conflicts = detectConflicts({
      reviewer: reviewer({ userId: 'rev-1' }),
      authors: [
        author({ userId: 'a1', name: 'Primeiro' }),
        author({ userId: 'rev-1', name: 'Revisor' }),
      ],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.type).toBe('COAUTHOR');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('hasBlockingConflict() e evaluateConflict()', () => {
  it('conflito CERTO bloqueia', () => {
    expect(
      hasBlockingConflict([
        { type: 'COAUTHOR', detection: 'AUTOMATIC', reason: 'x', confidence: 'CERTAIN' },
      ]),
    ).toBe(true);
  });

  it('conflito INCERTO também bloqueia (postura assimétrica)', () => {
    // Documentado: o custo de recusar em dúvida é baixo; o de aceitar é alto.
    expect(BLOCK_ON_UNCERTAIN_CONFLICT).toBe(true);
    expect(
      hasBlockingConflict([
        { type: 'SAME_INSTITUTION', detection: 'AUTOMATIC', reason: 'x', confidence: 'UNCERTAIN' },
      ]),
    ).toBe(true);
  });

  it('lista vazia não bloqueia', () => {
    expect(hasBlockingConflict([])).toBe(false);
  });

  it('evaluateConflict devolve veredito legível quando não há conflito', () => {
    const verdict = evaluateConflict(NO_CONFLICT);
    expect(verdict.blocked).toBe(false);
    expect(verdict.message).toMatch(/Nenhum conflito/i);
    expect(verdict.primaryConflict).toBeNull();
  });

  it('evaluateConflict devolve o conflito principal e bloqueia', () => {
    const verdict = evaluateConflict({
      reviewer: reviewer({ userId: 'u1' }),
      authors: [author({ userId: 'u1', name: 'Mesma Pessoa' })],
    });

    expect(verdict.blocked).toBe(true);
    expect(verdict.primaryConflict?.type).toBe('COAUTHOR');
    expect(verdict.message).toContain('Mesma Pessoa');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('screenReviewersForConflicts()', () => {
  const authors = [
    author({ userId: 'author-1', institution: 'Universidade B', email: 'a@unib.br' }),
  ];

  it('separa elegíveis de bloqueados', () => {
    const candidates: ReviewerIdentity[] = [
      // Elegível: instituição e domínio diferentes.
      reviewer({ userId: 'ok-1', institution: 'Universidade A', email: 'r@unia.br' }),
      // Bloqueado: mesmo domínio institucional.
      reviewer({ userId: 'blocked-1', email: 'r@unib.br' }),
      // Elegível.
      reviewer({ userId: 'ok-2', institution: 'Universidade C', email: 'r@unic.br' }),
    ];

    const result = screenReviewersForConflicts(candidates, authors);

    expect(result.eligible.map((r) => r.userId).sort()).toEqual(['ok-1', 'ok-2']);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]?.reviewer.userId).toBe('blocked-1');
    expect(result.blocked[0]?.verdict.blocked).toBe(true);
  });

  it('bloqueia o autor correspondente', () => {
    const candidates: ReviewerIdentity[] = [
      reviewer({ userId: 'author-1', email: 'outro@dominio.br' }),
    ];

    const result = screenReviewersForConflicts(candidates, authors, 'author-1');
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(1);
  });

  it('lista vazia de candidatos devolve resultado vazio', () => {
    const result = screenReviewersForConflicts([], authors);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });

  it('todos bloqueados quando todos compartilham a instituição', () => {
    const candidates: ReviewerIdentity[] = [
      reviewer({ userId: 'r1', email: 'r1@unib.br' }),
      reviewer({ userId: 'r2', email: 'r2@unib.br' }),
    ];

    const result = screenReviewersForConflicts(candidates, authors);
    expect(result.eligible).toHaveLength(0);
    expect(result.blocked).toHaveLength(2);
  });
});
