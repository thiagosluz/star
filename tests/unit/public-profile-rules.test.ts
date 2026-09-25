/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — PERFIL PÚBLICO DO PARTICIPANTE (FASE 44)
 *
 *  O que estes testes prendem, e por que cada um importa:
 *
 *    • o **pacote** que sai do servidor é montado campo a campo — um campo privado
 *      não aparece, e nenhum campo novo entra sem decisão de visibilidade;
 *    • **anônimo vê o que é público** e mais nada; `ATTENDEES_ONLY` é para quem
 *      participa da instituição; o DONO vê tudo (é a prévia);
 *    • perfil com tudo privado **não existe** para os outros (404, e não "existe mas
 *      você não pode ver" — o que já revelaria o handle);
 *    • o `@handle` é validado e normalizado: minúsculo, sem acento, sem palavra
 *      reservada, com espera entre trocas;
 *    • interesse é DECLARADO — o domínio não aceita nada que venha de inferência.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROFILE_AUDIENCES,
  MAX_INTERESTS,
  PUBLIC_PROFILE_FIELDS,
  PUBLIC_PROFILE_SHARE_KEYS,
  RESERVED_USERNAMES,
  USERNAME_CHANGE_COOLDOWN_DAYS,
  buildPublicProfile,
  evaluatePublicProfile,
  lattesUrl,
  normalizeInterests,
  normalizeLattesId,
  normalizeOrcidId,
  normalizePublicSiteUrl,
  normalizePublicText,
  normalizeUsername,
  orcidUrl,
  parseProfileAudiences,
  profileViewerOf,
  resolvePublicDisplayName,
  standingFromRank,
  usernameChangeState,
  validateUsername,
  visibleProfileFields,
  type PublicProfileSource,
} from '../../src/domain/profile/public-profile-rules';

const SOURCE: PublicProfileSource = {
  username: 'ana-souza',
  displayName: 'Ana Souza',
  avatarUrl: 'https://cdn.test/ana.png',
  headline: 'Pesquisadora em saúde pública',
  bio: 'Trabalho com vigilância epidemiológica.',
  interests: ['Saúde pública', 'Rust'],
  siteUrl: 'https://ana.test',
  orcidId: '0000-0002-1825-0097',
  lattesId: '1234567890123456',
  level: 7,
  levelTitle: 'Curadora',
  prestige: 1,
  xp: 4300,
  streak: 12,
  pinnedCards: [{ name: 'Guardião do Método', rarity: 'MYTHIC', imageUrl: null, isFoil: true }],
  collection: { owned: 9, total: 9, byRarity: { RARE: 4, MYTHIC: 1 }, foils: 2 },
  eventCount: 3,
  events: [{ title: 'Congresso de Tecnologia', year: 2026 }],
  certificates: [
    {
      title: 'Certificado de participação',
      kind: 'PARTICIPATION',
      workloadLabel: '8 h',
      validationUrl: 'http://localhost:3000/validar/CERT-1',
    },
  ],
  standing: { topPercent: 10, sampleSize: 42 },
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('o pacote público é montado campo a campo', () => {
  it('com tudo autorizado, traz exatamente as chaves da lista', () => {
    const payload = buildPublicProfile({
      source: SOURCE,
      visibleFields: PUBLIC_PROFILE_FIELDS,
    });

    expect(Object.keys(payload).sort()).toEqual([...PUBLIC_PROFILE_SHARE_KEYS].sort());
  });

  it('NÃO traz o que não foi autorizado — nem a chave', () => {
    const payload = buildPublicProfile({
      source: SOURCE,
      visibleFields: ['level', 'pinnedCards'],
    });

    expect(Object.keys(payload).sort()).toEqual(['level', 'levelTitle', 'pinnedCards', 'prestige', 'username']);

    /** O XP é o caso que mais importa: nível sim, número não. */
    expect(payload.xp).toBeUndefined();
    expect(payload.events).toBeUndefined();
    expect(payload.bio).toBeUndefined();
    expect(payload.certificates).toBeUndefined();
  });

  it('o handle entra SEMPRE: é o endereço da página', () => {
    const payload = buildPublicProfile({ source: SOURCE, visibleFields: [] });

    expect(payload).toEqual({ username: 'ana-souza' });
  });

  it('sem nome de exibição, o handle é o nome — e ele já sai com @', () => {
    const payload = buildPublicProfile({
      source: { ...SOURCE, displayName: '   ' },
      visibleFields: ['displayName'],
    });

    expect(payload.displayName).toBe('@ana-souza');
    expect(resolvePublicDisplayName({ displayName: null, username: 'ana-souza' })).toBe('@ana-souza');
    expect(resolvePublicDisplayName({ displayName: 'Ana', username: 'ana-souza' })).toBe('Ana');
  });

  it('toda chave da lista pertence a algum campo — nada de chave órfã', () => {
    const payload = buildPublicProfile({ source: SOURCE, visibleFields: PUBLIC_PROFILE_FIELDS });

    for (const key of Object.keys(payload)) {
      expect(PUBLIC_PROFILE_SHARE_KEYS).toContain(key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quem vê o quê', () => {
  it('anônimo vê só o que é PUBLIC', () => {
    const visible = visibleProfileFields({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'ANONYMOUS',
    });

    expect(visible).toContain('level');
    expect(visible).toContain('bio');
    expect(visible).not.toContain('xp');
    expect(visible).not.toContain('events');
    expect(visible).not.toContain('standing');
  });

  it('quem participa da instituição vê também o que é ATTENDEES_ONLY', () => {
    const visible = visibleProfileFields({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'AUDIENCE',
    });

    expect(visible).toContain('xp');
    expect(visible).toContain('events');
    expect(visible).toContain('collection');
  });

  it('o DONO vê todos os campos — é a prévia do que ele configurou', () => {
    const evaluation = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'OWNER',
      hasUsername: true,
      belongsToInstitution: true,
    });

    expect(evaluation.pageVisible).toBe(true);
    expect(evaluation.visibleFields).toEqual([...PUBLIC_PROFILE_FIELDS]);
  });

  it('perfil com TUDO privado não existe para os outros (404, e não "sem permissão")', () => {
    const privado = Object.fromEntries(
      PUBLIC_PROFILE_FIELDS.map((field) => [field, 'PRIVATE' as const]),
    ) as typeof DEFAULT_PROFILE_AUDIENCES;

    const anonimo = evaluatePublicProfile({
      audiences: privado,
      viewer: 'ANONYMOUS',
      hasUsername: true,
      belongsToInstitution: true,
    });
    expect(anonimo.pageVisible).toBe(false);

    const daCasa = evaluatePublicProfile({
      audiences: privado,
      viewer: 'AUDIENCE',
      hasUsername: true,
      belongsToInstitution: true,
    });
    expect(daCasa.pageVisible).toBe(false);

    /** O dono continua enxergando a própria página. */
    const dono = evaluatePublicProfile({
      audiences: privado,
      viewer: 'OWNER',
      hasUsername: true,
      belongsToInstitution: true,
    });
    expect(dono.pageVisible).toBe(true);
  });

  it('sem handle não há página, para ninguém', () => {
    const semHandle = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'OWNER',
      hasUsername: false,
      belongsToInstitution: true,
    });

    expect(semHandle.pageVisible).toBe(false);
  });

  it('quem NÃO participa da instituição não tem página nela, por mais público que seja', () => {
    /**
     * O `user` é global e a RLS não o protege: sem esta guarda, o `@handle` de uma
     * pessoa viraria uma janela para o nome, a foto e a bio dela dentro do site de
     * qualquer instituição onde ela nunca pôs os pés.
     */
    const evaluation = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'ANONYMOUS',
      hasUsername: true,
      belongsToInstitution: false,
    });

    expect(evaluation.pageVisible).toBe(false);
    expect(evaluation.visibleFields).toEqual([]);
    expect(evaluation.moreForAttendees).toBe(false);

    /** Nem para quem é da casa: a página é da pessoa, e ela não é daqui. */
    const daCasaOlhandoDeFora = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'AUDIENCE',
      hasUsername: true,
      belongsToInstitution: false,
    });
    expect(daCasaOlhandoDeFora.pageVisible).toBe(false);

    /** A prévia do dono sobrevive: é ele olhando o que ele mesmo configurou. */
    const dono = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'OWNER',
      hasUsername: true,
      belongsToInstitution: false,
    });
    expect(dono.pageVisible).toBe(true);
  });

  it('o anônimo é convidado a entrar quando há mais para quem participa', () => {
    const evaluation = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'ANONYMOUS',
      hasUsername: true,
      belongsToInstitution: true,
    });

    expect(evaluation.moreForAttendees).toBe(true);

    /** Para quem já participa não há convite: ele já vê tudo o que é da casa. */
    const daCasa = evaluatePublicProfile({
      audiences: DEFAULT_PROFILE_AUDIENCES,
      viewer: 'AUDIENCE',
      hasUsername: true,
      belongsToInstitution: true,
    });

    expect(daCasa.moreForAttendees).toBe(false);
  });

  it('a matriz gravada é tolerante: campo desconhecido ou inválido cai no padrão', () => {
    const parsed = parseProfileAudiences({
      bio: 'PUBLIC',
      xp: 'PRIVATE',
      level: 'QUALQUER_COISA',
      invencao: 'PUBLIC',
    });

    expect(parsed.bio).toBe('PUBLIC');
    expect(parsed.xp).toBe('PRIVATE');
    expect(parsed.level).toBe(DEFAULT_PROFILE_AUDIENCES.level);
    expect(Object.keys(parsed).sort()).toEqual([...PUBLIC_PROFILE_FIELDS].sort());
  });

  it('o visitante é classificado pela posse e pelo vínculo', () => {
    expect(profileViewerOf({ isOwner: true, isInstitutionAudience: false })).toBe('OWNER');
    expect(profileViewerOf({ isOwner: false, isInstitutionAudience: true })).toBe('AUDIENCE');
    expect(profileViewerOf({ isOwner: false, isInstitutionAudience: false })).toBe('ANONYMOUS');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('@handle', () => {
  it('normaliza acento, espaço, maiúscula e símbolo', () => {
    expect(normalizeUsername('Ana Souza')).toBe('ana-souza');
    expect(normalizeUsername('João  D`Ávila')).toBe('joao-d-avila');
    expect(normalizeUsername('  --Ana--  ')).toBe('ana');
  });

  it('aceita o que é legível e devolve a forma normalizada', () => {
    const verdict = validateUsername(' Ana-Souza ');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.username).toBe('ana-souza');
  });

  it('recusa curto, longo, reservado e vazio', () => {
    expect(validateUsername('ab').ok).toBe(false);
    expect(validateUsername('a'.repeat(21)).ok).toBe(false);
    expect(validateUsername('admin').ok).toBe(false);
    expect(validateUsername('   ').ok).toBe(false);

    const reservado = validateUsername('superadmin');
    expect(reservado.ok).toBe(false);
    if (!reservado.ok) expect(reservado.code).toBe('RESERVED');
  });

  it('as palavras reservadas incluem as rotas da própria plataforma', () => {
    for (const palavra of ['admin', 'api', 'validar', 'organizacoes', 'u', 't']) {
      expect(RESERVED_USERNAMES).toContain(palavra);
    }
  });

  it('a espera entre trocas é de 30 dias, e a primeira troca é livre', () => {
    const agora = new Date('2026-09-26T12:00:00.000Z');

    expect(usernameChangeState({ lastChangedAt: null, now: agora }).canChange).toBe(true);

    const recente = usernameChangeState({
      lastChangedAt: new Date('2026-09-20T12:00:00.000Z'),
      now: agora,
    });

    expect(recente.canChange).toBe(false);
    expect(recente.daysLeft).toBeGreaterThan(0);

    const antigo = usernameChangeState({
      lastChangedAt: new Date(agora.getTime() - (USERNAME_CHANGE_COOLDOWN_DAYS + 1) * 86_400_000),
      now: agora,
    });

    expect(antigo.canChange).toBe(true);
    expect(antigo.nextAllowedAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o que a pessoa declara', () => {
  it('interesses: sem repetição, sem caixa duplicada e com teto', () => {
    const interests = normalizeInterests([
      'Rust',
      'rust',
      'Saúde pública',
      'a',
      'x'.repeat(40),
      'Educação',
      'Dados',
      'Eventos',
      'Ciência',
      'Extras',
      'Mais um',
    ]);

    expect(interests).toEqual(['Rust', 'Saúde pública', 'Educação', 'Dados', 'Eventos', 'Ciência']);
    expect(interests).toHaveLength(MAX_INTERESTS);
  });

  it('texto curto: espaços colapsados, vazio vira nulo e o teto é respeitado', () => {
    expect(normalizePublicText('  duas   linhas  ', 20)).toBe('duas linhas');
    expect(normalizePublicText('   ', 20)).toBeNull();
    expect(normalizePublicText('x'.repeat(50), 20)).toHaveLength(20);
  });

  it('site: só http/https — `javascript:` nunca vira link público', () => {
    expect(normalizePublicSiteUrl('https://ana.test')).toBe('https://ana.test/');
    expect(normalizePublicSiteUrl('http://ana.test/x')).toBe('http://ana.test/x');
    expect(normalizePublicSiteUrl('javascript:alert(1)')).toBeNull();
    expect(normalizePublicSiteUrl('ana.test')).toBeNull();
    expect(normalizePublicSiteUrl('')).toBeNull();
  });

  it('ORCID e Lattes só viram link quando o identificador é válido', () => {
    expect(orcidUrl('0000-0002-1825-0097')).toBe('https://orcid.org/0000-0002-1825-0097');
    expect(orcidUrl('0000-0002-1825-009X')).toBe('https://orcid.org/0000-0002-1825-009X');
    expect(orcidUrl('123')).toBeNull();

    expect(lattesUrl('1234567890123456')).toBe('http://lattes.cnpq.br/1234567890123456');
    expect(lattesUrl('123')).toBeNull();
  });

  it('identificador digitado: vazio LIMPA, inválido RECUSA em vez de sumir', () => {
    /** ─── O defeito que este teste prende ───────────────────────────────────────
     *  O formulário tinha dois campos editáveis que o serviço NÃO gravava: a pessoa
     *  digitava o ORCID, salvava, e o dado sumia sem aviso. Agora ou grava, ou diz o
     *  formato — nunca descarta em silêncio.
     */
    expect(normalizeOrcidId('')).toEqual({ ok: true, value: null });
    expect(normalizeOrcidId('   ')).toEqual({ ok: true, value: null });
    expect(normalizeOrcidId(' 0000-0002-1825-009x ')).toEqual({ ok: true, value: '0000-0002-1825-009X' });
    expect(normalizeOrcidId('000000218250097')).toEqual({ ok: false, message: expect.any(String) });

    expect(normalizeLattesId('')).toEqual({ ok: true, value: null });
    /** A pessoa pode colar o endereço com pontos — os dígitos são o identificador. */
    expect(normalizeLattesId('1234.5678.9012.3456')).toEqual({ ok: true, value: '1234567890123456' });
    expect(normalizeLattesId('http://lattes.cnpq.br/1234567890123456')).toEqual({
      ok: true,
      value: '1234567890123456',
    });
    expect(normalizeLattesId('1234')).toEqual({ ok: false, message: expect.any(String) });
  });

  it('a posição vira fatia, nunca lista: "top N%" com a base dita', () => {
    /** `betterThan` = quantas pessoas ficaram ATRÁS. Quem supera todo mundo é top 1%. */
    expect(standingFromRank({ betterThan: 99, total: 100 })).toEqual({ topPercent: 1, sampleSize: 100 });
    expect(standingFromRank({ betterThan: 90, total: 100 })).toEqual({ topPercent: 10, sampleSize: 100 });
    expect(standingFromRank({ betterThan: 5, total: 6 })).toEqual({ topPercent: 17, sampleSize: 6 });
    expect(standingFromRank({ betterThan: 0, total: 100 })).toEqual({ topPercent: 100, sampleSize: 100 });

    /** Sem base não há posição: `null` não é "primeiro lugar". */
    expect(standingFromRank({ betterThan: 0, total: 1 })).toBeNull();
    expect(standingFromRank({ betterThan: 0, total: 0 })).toBeNull();
  });

  it('superar mais gente NUNCA piora a fatia — a direção é a armadilha', () => {
    /** Este teste existe porque a direção já esteve invertida: o líder recebia top 100%. */
    const fatias = [0, 25, 50, 75, 99, 100].map(
      (betterThan) => standingFromRank({ betterThan, total: 100 })!.topPercent,
    );

    for (let i = 1; i < fatias.length; i += 1) {
      expect(fatias[i]!).toBeLessThanOrEqual(fatias[i - 1]!);
    }

    expect(fatias[0]).toBe(100);
    expect(fatias[fatias.length - 1]).toBe(1);
    expect(standingFromRank({ betterThan: 100, total: 100 })).toEqual({ topPercent: 1, sampleSize: 100 });
  });
});
