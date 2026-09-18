import { describe, expect, it } from 'vitest';

import {
  activitiesOfSpeaker,
  canonicalMaterialExtension,
  canAccessMaterial,
  computeSpeakerWorkload,
  detectMaterialFamily,
  evaluateClaim,
  filterVisibleMaterials,
  generateInviteToken,
  hashInviteToken,
  initialsOf,
  inviteExpiryFrom,
  isInviteExpired,
  isPubliclyVisible,
  isSpeakerOfActivity,
  normalizeInviteToken,
  normalizeSpeakerProfile,
  orderSpeakersForDisplay,
  readSocialLinks,
  sanitizeSocialLinks,
  validateExternalMaterialUrl,
  validateMaterialUpload,
  MATERIAL_VISIBILITY_LABELS,
  MAX_MATERIAL_BYTES,
  type MaterialViewer,
  type SpeakerWorkloadEntry,
} from '../../src/domain/speakers/speaker-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 25 — Regras do palestrante, do convite e dos materiais
 *
 *  Os três blocos que mais importam aqui:
 *    • VISIBILIDADE do material (é o que decide se um PDF de aula sai para anônimo);
 *    • POSSE (é o que separa o portal de um cadastro aberto);
 *    • CARGA HORÁRIA (é o que o certificado vai afirmar).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const ANONYMOUS: MaterialViewer = { kind: 'ANONYMOUS' };
const ATTENDEE_CONFIRMED: MaterialViewer = { kind: 'ATTENDEE', userId: 'u1', confirmed: true };
const ATTENDEE_PENDING: MaterialViewer = { kind: 'ATTENDEE', userId: 'u1', confirmed: false };
const SPEAKER_OWNER: MaterialViewer = { kind: 'SPEAKER', userId: 'u1', owner: true };
const SPEAKER_OTHER: MaterialViewer = { kind: 'SPEAKER', userId: 'u2', owner: false };
const ORGANIZER: MaterialViewer = { kind: 'ORGANIZER', userId: 'u9' };

// ═══════════════════════════════════════════════════════════════════════════════
describe('sanitizeSocialLinks()', () => {
  it('aceita os hosts de cada rede e normaliza para https', () => {
    const result = sanitizeSocialLinks({
      linkedin: 'linkedin.com/in/fulano',
      lattes: 'http://lattes.cnpq.br/123456',
      website: 'https://exemplo.org/perfil',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.links.linkedin).toBe('https://linkedin.com/in/fulano');
    expect(result.links.lattes).toBe('http://lattes.cnpq.br/123456');
    expect(result.links.website).toBe('https://exemplo.org/perfil');
  });

  it('RECUSA javascript: (é XSS com outro nome)', () => {
    const result = sanitizeSocialLinks({ website: 'javascript:alert(1)' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('NOT_HTTP');
  });

  it('recusa host que não é o da rede rotulada', () => {
    // O campo se chama "LinkedIn" na tela: aceitar qualquer host faria o rótulo mentir.
    const result = sanitizeSocialLinks({ linkedin: 'https://phishing.example/login' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('UNSUPPORTED_HOST');
  });

  it('campo vazio é AUSENTE, não string vazia', () => {
    const result = sanitizeSocialLinks({ linkedin: '   ', github: '' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.links).toEqual({});
  });

  it('remove a âncora (não muda o destino, muda o cache)', () => {
    const result = sanitizeSocialLinks({ website: 'https://exemplo.org/perfil#secao' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.links.website).toBe('https://exemplo.org/perfil');
  });
});

describe('readSocialLinks()', () => {
  it('descarta o que ficou inválido sem quebrar a leitura', () => {
    const links = readSocialLinks({ lattes: 'http://lattes.cnpq.br/1', website: 'javascript:x' });

    expect(links.lattes).toContain('lattes.cnpq.br');
    expect(links.website).toBeUndefined();
  });

  it('tolera valor que não é objeto', () => {
    expect(readSocialLinks(null)).toEqual({});
    expect(readSocialLinks('texto')).toEqual({});
    expect(readSocialLinks([1, 2])).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('posse — quem ministra o quê', () => {
  const links = [
    { activityId: 'a1', speakerProfileId: 'p1', userId: null },
    { activityId: 'a2', speakerProfileId: 'p2', userId: 'u-own' },
    { activityId: 'a3', speakerProfileId: 'p3', userId: null },
  ];

  it('reconhece o vínculo antigo (userId direto no vínculo)', () => {
    expect(
      isSpeakerOfActivity({ links, activityId: 'a2', userId: 'u-own' }),
    ).toBe(true);
  });

  it('reconhece o perfil reivindicado depois', () => {
    expect(
      isSpeakerOfActivity({
        links,
        activityId: 'a1',
        userId: 'u-own',
        claimedProfileIds: ['p1'],
      }),
    ).toBe(true);
  });

  it('NÃO reconhece perfil de outra pessoa', () => {
    expect(
      isSpeakerOfActivity({
        links,
        activityId: 'a1',
        userId: 'u-own',
        claimedProfileIds: ['p3'],
      }),
    ).toBe(false);
  });

  it('NÃO reconhece atividade sem vínculo nenhum', () => {
    expect(
      isSpeakerOfActivity({
        links,
        activityId: 'a4',
        userId: 'u-own',
        claimedProfileIds: ['p1', 'p3'],
      }),
    ).toBe(false);
  });

  it('lista as atividades em que a pessoa é ministrante', () => {
    const ids = activitiesOfSpeaker({
      links,
      userId: 'u-own',
      claimedProfileIds: ['p1'],
    });

    expect(ids.sort()).toEqual(['a1', 'a2']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('computeSpeakerWorkload()', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');

  function entry(overrides: Partial<SpeakerWorkloadEntry> = {}): SpeakerWorkloadEntry {
    return {
      activityId: 'a1',
      activityTitle: 'Minicurso de Rust',
      activityStatus: 'COMPLETED',
      startsAt: new Date('2026-09-20T12:00:00.000Z'),
      endsAt: new Date('2026-09-20T16:00:00.000Z'),
      activityWorkloadMinutes: 240,
      declaredWorkloadMinutes: null,
      ...overrides,
    };
  }

  it('soma as atividades concluídas', () => {
    const result = computeSpeakerWorkload([entry(), entry({ activityId: 'a2' })], now);

    expect(result.totalMinutes).toBe(480);
    expect(result.countedActivities).toBe(2);
  });

  it('NÃO conta atividade cancelada — e diz o motivo', () => {
    const result = computeSpeakerWorkload([entry({ activityStatus: 'CANCELED' })], now);

    expect(result.totalMinutes).toBe(0);
    expect(result.excludedActivities).toBe(1);
    expect(result.entries[0]?.reason).toMatch(/cancelada/i);
  });

  it('NÃO conta atividade que ainda não terminou', () => {
    const result = computeSpeakerWorkload(
      [entry({ endsAt: new Date('2026-11-01T00:00:00.000Z') })],
      now,
    );

    expect(result.totalMinutes).toBe(0);
    expect(result.entries[0]?.counted).toBe(false);
    expect(result.entries[0]?.reason).toMatch(/não concluída/i);
  });

  it('a carga DECLARADA no vínculo vence a da atividade (dois palestrantes, 4 h)', () => {
    const result = computeSpeakerWorkload([entry({ declaredWorkloadMinutes: 120 })], now);

    expect(result.totalMinutes).toBe(120);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('canAccessMaterial()', () => {
  it('material PÚBLICO abre para qualquer visitante', () => {
    expect(canAccessMaterial({ visibility: 'PUBLIC', viewer: ANONYMOUS }).allowed).toBe(true);
  });

  it('material de INSCRITOS: anônimo recebe 401 (entre e se inscreva)', () => {
    const verdict = canAccessMaterial({ visibility: 'ATTENDEES_ONLY', viewer: ANONYMOUS });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.httpStatus).toBe(401);
  });

  it('material de INSCRITOS: autenticado sem inscrição recebe 403', () => {
    const verdict = canAccessMaterial({ visibility: 'ATTENDEES_ONLY', viewer: ATTENDEE_PENDING });

    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) return;
    expect(verdict.httpStatus).toBe(403);
  });

  it('material de INSCRITOS: inscrito confirmado acessa', () => {
    expect(canAccessMaterial({ visibility: 'ATTENDEES_ONLY', viewer: ATTENDEE_CONFIRMED }).allowed).toBe(true);
  });

  it('RASCUNHO: só o dono e a equipe — nem o inscrito vê', () => {
    expect(canAccessMaterial({ visibility: 'PRIVATE', viewer: SPEAKER_OWNER }).allowed).toBe(true);
    expect(canAccessMaterial({ visibility: 'PRIVATE', viewer: ORGANIZER }).allowed).toBe(true);

    const inscrito = canAccessMaterial({ visibility: 'PRIVATE', viewer: ATTENDEE_CONFIRMED });
    expect(inscrito.allowed).toBe(false);
    if (inscrito.allowed) return;
    // 403 e não 404 para o INSCRITO: ele participa da atividade, e negar com "não
    // existe" seria mentir sobre o que a organização tem.
    expect(inscrito.httpStatus).toBe(403);
  });

  it('RASCUNHO de outro palestrante não é acessível', () => {
    expect(canAccessMaterial({ visibility: 'PRIVATE', viewer: SPEAKER_OTHER }).allowed).toBe(false);
  });

  it('todo material tem rótulo legível (a tela não inventa texto)', () => {
    for (const visibility of ['PUBLIC', 'ATTENDEES_ONLY', 'PRIVATE'] as const) {
      expect(MATERIAL_VISIBILITY_LABELS[visibility].length).toBeGreaterThan(5);
    }
  });
});

describe('filterVisibleMaterials()', () => {
  it('deixa passar só o que o visitante pode ver', () => {
    const materials = [
      { id: 'm1', visibility: 'PUBLIC' as const },
      { id: 'm2', visibility: 'ATTENDEES_ONLY' as const },
      { id: 'm3', visibility: 'PRIVATE' as const },
    ];

    expect(filterVisibleMaterials(materials, ANONYMOUS).map((m) => m.id)).toEqual(['m1']);
    expect(filterVisibleMaterials(materials, ATTENDEE_CONFIRMED).map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(filterVisibleMaterials(materials, SPEAKER_OWNER).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateMaterialUpload()', () => {
  const pdfMagic = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
  const zipMagic = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00];
  const htmlMagic = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50];

  it('aceita PDF pela ASSINATURA, mesmo com tipo declarado errado', () => {
    const result = validateMaterialUpload({
      fileName: 'slides.pdf',
      mimeType: 'application/octet-stream',
      sizeBytes: 1024,
      magicBytes: pdfMagic,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mimeType).toBe('application/pdf');
  });

  it('aceita PPTX (contêiner ZIP) quando o tipo declarado é Office', () => {
    const result = validateMaterialUpload({
      fileName: 'aula.pptx',
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      sizeBytes: 2048,
      magicBytes: zipMagic,
    });

    expect(result.ok).toBe(true);
  });

  it('RECUSA HTML renomeado para .pdf', () => {
    const result = validateMaterialUpload({
      fileName: 'malicioso.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
      magicBytes: htmlMagic,
    });

    // Assinatura de texto com tipo declarado de PDF: família não bate.
    expect(result.ok).toBe(false);
  });

  it('recusa arquivo vazio e arquivo acima do limite', () => {
    const empty = validateMaterialUpload({ fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 0 });
    expect(empty.ok).toBe(false);

    const big = validateMaterialUpload({
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: MAX_MATERIAL_BYTES + 1,
      magicBytes: pdfMagic,
    });
    expect(big.ok).toBe(false);
    if (big.ok) return;
    expect(big.errors[0]?.code).toBe('TOO_LARGE');
  });

  it('sem os bytes, cai no caminho fraco: tipo declarado + extensão coerentes', () => {
    const result = validateMaterialUpload({
      fileName: 'apostila.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      magicBytes: null,
    });

    expect(result.ok).toBe(true);

    const mismatch = validateMaterialUpload({
      fileName: 'apostila.exe',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      magicBytes: null,
    });
    expect(mismatch.ok).toBe(false);
  });

  it('detecta a família do arquivo pela assinatura', () => {
    expect(detectMaterialFamily(pdfMagic)).toBe('pdf');
    expect(detectMaterialFamily(zipMagic)).toBe('zip');
    expect(detectMaterialFamily(htmlMagic)).toBe('text');
    expect(detectMaterialFamily([0x00, 0x01, 0x02, 0x03])).toBeNull();
  });

  it('a extensão gravada vem do tipo REAL', () => {
    expect(canonicalMaterialExtension('application/pdf')).toBe('pdf');
    expect(
      canonicalMaterialExtension(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ),
    ).toBe('pptx');
  });
});

describe('validateExternalMaterialUrl()', () => {
  it('aceita http(s) e assume https quando falta o esquema', () => {
    expect(validateExternalMaterialUrl('exemplo.org/aula').ok).toBe(true);
    expect(validateExternalMaterialUrl('https://exemplo.org/aula').ok).toBe(true);
  });

  it('recusa esquema que não é http(s)', () => {
    expect(validateExternalMaterialUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateExternalMaterialUrl('data:text/html,<script>').ok).toBe(false);
  });

  it('recusa credenciais embutidas (vazariam no href público)', () => {
    const result = validateExternalMaterialUrl('https://user:senha@exemplo.org/aula');
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('convite — geração, expiração e reivindicação', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('o token gerado é longo, do alfabeto seguro e determinístico pela fonte', () => {
    const token = generateInviteToken((max) => max - 1);

    expect(token).toHaveLength(32);
    expect(token).toMatch(/^[A-Z2-9]+$/);
    // Sem caracteres que se confundem quando o código é ditado.
    expect(token).not.toMatch(/[IO01]/);
  });

  it('o hash é estável e o token é normalizado (caixa e separadores)', () => {
    const token = generateInviteToken((max) => max - 1);

    expect(hashInviteToken(token)).toBe(hashInviteToken(token.toLowerCase()));
    expect(normalizeInviteToken(' abcd-2345 efgh ')).toBe('ABCD2345EFGH');
    expect(hashInviteToken(token)).toHaveLength(64);
  });

  it('a expiração é contada em dias', () => {
    const expiry = inviteExpiryFrom(now);

    expect(isInviteExpired(expiry, now)).toBe(false);
    expect(isInviteExpired(expiry, new Date(expiry.getTime() + 1000))).toBe(true);
    expect(isInviteExpired(null, now)).toBe(true);
  });

  function claimInput(overrides: Partial<Parameters<typeof evaluateClaim>[0]> = {}) {
    return {
      profile: {
        email: 'palestrante@exemplo.test',
        userId: null,
        inviteTokenHash: hashInviteToken('ABCD2345EFGH6789ABCD2345EFGH6789'),
        inviteExpiresAt: inviteExpiryFrom(now),
        ...(overrides.profile ?? {}),
      },
      token: overrides.token !== undefined ? overrides.token : 'ABCD2345EFGH6789ABCD2345EFGH6789',
      userEmail: overrides.userEmail ?? 'palestrante@exemplo.test',
      userId: overrides.userId ?? 'u-speaker',
      now: overrides.now ?? now,
    };
  }

  it('aceita com token válido e e-mail igual', () => {
    const verdict = evaluateClaim(claimInput());

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.updateEmailTo).toBeNull();
  });

  it('aceita token válido com e-mail DIFERENTE e corrige o e-mail do perfil', () => {
    // Cenário real: a organização cadastrou o e-mail institucional e a pessoa tem
    // conta com o pessoal.
    const verdict = evaluateClaim(claimInput({ userEmail: 'pessoal@exemplo.test' }));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.updateEmailTo).toBe('pessoal@exemplo.test');
  });

  it('recusa token inválido, expirado e perfil já reivindicado', () => {
    const invalid = evaluateClaim(claimInput({ token: 'ZZZZ2345EFGH6789ABCD2345EFGH6789' }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.code).toBe('INVALID_TOKEN');

    const expired = evaluateClaim(
      claimInput({
        now: new Date('2026-12-31T00:00:00.000Z'),
      }),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.code).toBe('EXPIRED');

    const taken = evaluateClaim(claimInput({ profile: { userId: 'outra-conta' } as never }));
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.code).toBe('ALREADY_CLAIMED');
  });

  it('no caminho do PAINEL (sem token), o e-mail é a única identidade', () => {
    const other = evaluateClaim(claimInput({ token: null, userEmail: 'outro@exemplo.test' }));
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.code).toBe('EMAIL_MISMATCH');

    const withoutEmail = evaluateClaim(
      claimInput({ token: null, profile: { email: null } as never }),
    );
    expect(withoutEmail.ok).toBe(false);
    if (!withoutEmail.ok) expect(withoutEmail.code).toBe('NO_EMAIL');

    expect(evaluateClaim(claimInput({ token: null })).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalizeSpeakerProfile()', () => {
  it('normaliza nome, e-mail e campos vazios', () => {
    const result = normalizeSpeakerProfile({
      name: '  Ana Ribeiro  ',
      email: '  ANA@Exemplo.Test ',
      institution: '   ',
      bio: '',
      socialLinks: { lattes: 'lattes.cnpq.br/1' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.name).toBe('Ana Ribeiro');
    expect(result.draft.email).toBe('ana@exemplo.test');
    expect(result.draft.institution).toBeNull();
    expect(result.draft.bio).toBeNull();
    expect(result.draft.socialLinks.lattes).toContain('lattes.cnpq.br');
  });

  it('recusa nome curto, e-mail inválido e rede com host errado', () => {
    expect(normalizeSpeakerProfile({ name: 'Al' }).ok).toBe(false);
    expect(normalizeSpeakerProfile({ name: 'Ana Ribeiro', email: 'sem-arroba' }).ok).toBe(false);

    const social = normalizeSpeakerProfile({
      name: 'Ana Ribeiro',
      socialLinks: { github: 'https://phishing.example/ana' },
    });
    expect(social.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('vitrine', () => {
  it('perfil oculto ou removido não aparece', () => {
    expect(isPubliclyVisible({ isPublic: true, deletedAt: null })).toBe(true);
    expect(isPubliclyVisible({ isPublic: false, deletedAt: null })).toBe(false);
    expect(isPubliclyVisible({ isPublic: true, deletedAt: new Date() })).toBe(false);
  });

  it('ordena por displayOrder, depois pelo primeiro horário, depois pelo nome', () => {
    const ordered = orderSpeakersForDisplay([
      { name: 'Zélia', displayOrder: 10, firstActivityAt: null },
      { name: 'Bruno', displayOrder: 0, firstActivityAt: new Date('2026-09-21T10:00:00Z') },
      { name: 'Ana', displayOrder: 0, firstActivityAt: new Date('2026-09-20T10:00:00Z') },
      { name: 'Carla', displayOrder: 0, firstActivityAt: null },
    ]);

    expect(ordered.map((speaker) => speaker.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Zélia']);
  });

  it('iniciais para o avatar sem foto', () => {
    expect(initialsOf('Ana Ribeiro')).toBe('AR');
    expect(initialsOf('Madonna')).toBe('MA');
    expect(initialsOf('  ')).toBe('?');
  });
});
