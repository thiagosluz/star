/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — EXPERIÊNCIA DO PATROCINADOR (FASE 42)
 *
 *  O que estes testes prendem, e por que cada um importa:
 *
 *    • o pacote compartilhado é SEMPRE `{ name, email }` — é a garantia de que
 *      acrescentar campo ao perfil da pessoa não passa a vazar para o patrocinador
 *      por descuido;
 *    • a autorização tem PRAZO, pode ser REVOGADA e é a única régua de visibilidade;
 *    • a leitura credita UMA vez por pessoa e por QR (a trava do farm de XP);
 *    • o convite prova token E posse do e-mail, como no portal do palestrante.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CONSENT_DAYS,
  LEAD_ACCESS_LABELS,
  MAX_CONSENT_DAYS,
  MAX_SPONSOR_QR_XP,
  MIN_CONSENT_DAYS,
  SPONSOR_CONSENT_VERSION,
  SPONSOR_LEAD_FIELDS,
  SPONSOR_LEAD_SHARE_KEYS,
  SPONSOR_QR_ALPHABET,
  SPONSOR_QR_LENGTH,
  buildLeadShare,
  consentExpiryFrom,
  creditForScan,
  evaluateLeadAccess,
  evaluateSponsorInviteClaim,
  formatSponsorQrCode,
  generateSponsorQrCode,
  isLeadVisible,
  isValidSponsorQrCode,
  leadConsentFrom,
  normalizeSponsorQrCode,
  sponsorConsentText,
  sponsorQrInputSchema,
} from '../../src/domain/events/sponsor-experience-rules';
import { hashInviteToken } from '../../src/domain/tenancy/invite-token-rules';
import {
  SPONSOR_QR_FILE_WIDTH,
  SPONSOR_QR_IMAGE_WIDTH,
  isSponsorQrFormat,
  sponsorQrFile,
  sponsorQrPath,
  sponsorQrSheet,
  sponsorQrUrl,
} from '../../src/lib/sponsors/sponsor-qr-sheet';

const NOW = new Date('2026-09-24T12:00:00.000Z');

// ═══════════════════════════════════════════════════════════════════════════════
describe('código público do QR', () => {
  it('normaliza prefixo, hífen, espaço e caixa', () => {
    expect(normalizeSponsorQrCode('pt-abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeSponsorQrCode(' PT ABCD EFGH ')).toBe('ABCDEFGH');
    expect(normalizeSponsorQrCode('ABCDEFGH')).toBe('ABCDEFGH');
  });

  it('mostra em dois grupos, com prefixo', () => {
    expect(formatSponsorQrCode('ABCDEFGH')).toBe('PT-ABCD-EFGH');
  });

  it('gera com o alfabeto sem letras confundíveis', () => {
    const code = generateSponsorQrCode(() => 0);

    expect(code).toHaveLength(SPONSOR_QR_LENGTH);
    expect(code).toBe(SPONSOR_QR_ALPHABET[0]!.repeat(SPONSOR_QR_LENGTH));
    // `I`, `O`, `0` e `1` ficam de fora: o código é ditado no balcão.
    expect(SPONSOR_QR_ALPHABET).not.toMatch(/[IO01]/);
  });

  it('recusa código com tamanho ou símbolo fora do alfabeto', () => {
    expect(isValidSponsorQrCode('PT-ABCD-EFGH')).toBe(true);
    expect(isValidSponsorQrCode('ABCD')).toBe(false);
    expect(isValidSponsorQrCode('ABCDEFG1')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('consentimento (LGPD)', () => {
  it('o pacote compartilhado tem EXATAMENTE os campos declarados', () => {
    /**
     * Este é o teste que protege o dado pessoal: se alguém acrescentar telefone,
     * documento ou instituição ao pacote, ele quebra aqui — e não num vazamento.
     * A comparação é nos DOIS sentidos: nada declarado fica de fora, e nada no
     * pacote existe sem estar declarado.
     */
    const share = buildLeadShare({
      name: '  Ana Souza ',
      email: ' ANA@Exemplo.Test ',
    });

    const declarados = SPONSOR_LEAD_FIELDS.map((field) => SPONSOR_LEAD_SHARE_KEYS[field]).sort();

    expect(Object.keys(share).sort()).toEqual(declarados);
    expect(share).toEqual({ sharedName: 'Ana Souza', sharedEmail: 'ana@exemplo.test' });
  });

  it('o texto diz quem recebe, por quanto tempo e que dá para revogar', () => {
    const text = sponsorConsentText({
      sponsorName: 'Instituto Parceiro',
      eventTitle: 'Congresso 2026',
      days: 30,
    });

    expect(text).toContain('Instituto Parceiro');
    expect(text).toContain('Congresso 2026');
    expect(text).toContain('30 dia(s)');
    expect(text).toContain('revogar');
  });

  it('o prazo respeita o mínimo e o máximo, mesmo com valor absurdo', () => {
    const clampedLow = consentExpiryFrom(NOW, 0);
    const clampedHigh = consentExpiryFrom(NOW, 9999);

    expect(clampedLow.toISOString()).toBe(
      new Date(NOW.getTime() + MIN_CONSENT_DAYS * 86_400_000).toISOString(),
    );
    expect(clampedHigh.toISOString()).toBe(
      new Date(NOW.getTime() + MAX_CONSENT_DAYS * 86_400_000).toISOString(),
    );
  });

  it('sem autorização NÃO existe lead — a visita continua existindo', () => {
    const semConsentimento = leadConsentFrom({
      consent: false,
      name: 'Ana Souza',
      email: 'ana@exemplo.test',
      consentText: 'texto',
      consentedAt: NOW,
      days: 90,
    });

    expect(semConsentimento).toBeNull();
  });

  it('com autorização grava o texto EXATO lido, a versão e o vencimento', () => {
    const text = sponsorConsentText({ sponsorName: 'ACME', eventTitle: null, days: 45 });

    const consent = leadConsentFrom({
      consent: true,
      name: 'Ana Souza',
      email: 'ana@exemplo.test',
      consentText: text,
      consentedAt: NOW,
      days: 45,
    });

    expect(consent?.consentText).toBe(text);
    expect(consent?.consentVersion).toBe(SPONSOR_CONSENT_VERSION);
    expect(consent?.expiresAt.toISOString()).toBe(
      new Date(NOW.getTime() + 45 * 86_400_000).toISOString(),
    );
    expect(consent?.sharedEmail).toBe('ana@exemplo.test');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('visibilidade do lead', () => {
  it('só a autorização vigente é visível', () => {
    expect(
      evaluateLeadAccess({ consentedAt: NOW, expiresAt: null, revokedAt: null, now: NOW }),
    ).toBe('ACTIVE');
  });

  it('sem consentimento é visita, não contato', () => {
    expect(
      evaluateLeadAccess({ consentedAt: null, expiresAt: null, revokedAt: null, now: NOW }),
    ).toBe('NONE');
  });

  it('revogado vence o prazo na MENSAGEM (a pessoa agiu; o prazo é passivo)', () => {
    const state = evaluateLeadAccess({
      consentedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      revokedAt: new Date('2026-01-15T00:00:00.000Z'),
      now: NOW,
    });

    expect(state).toBe('REVOKED');
    expect(LEAD_ACCESS_LABELS[state]).toContain('revogada');
    expect(isLeadVisible(state)).toBe(false);
  });

  it('prazo vencido fecha o acesso sem ninguém precisar agir', () => {
    const state = evaluateLeadAccess({
      consentedAt: new Date('2026-01-01T00:00:00.000Z'),
      expiresAt: new Date('2026-03-01T00:00:00.000Z'),
      revokedAt: null,
      now: NOW,
    });

    expect(state).toBe('EXPIRED');
    expect(isLeadVisible(state)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('crédito da leitura', () => {
  it('a primeira leitura credita; a segunda é repetição', () => {
    expect(creditForScan(null)).toEqual({ credits: true, repeated: false });
    expect(creditForScan({ id: 'scan-1' })).toEqual({ credits: false, repeated: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('convite do patrocinador', () => {
  const token = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const invite = (overrides: Partial<Parameters<typeof evaluateSponsorInviteClaim>[0]['invite']> = {}) => ({
    invitedEmail: 'contato@empresa.test',
    inviteTokenHash: hashInviteToken(token),
    inviteExpiresAt: new Date(NOW.getTime() + 86_400_000),
    userId: null,
    ...overrides,
  });

  it('aceita token válido para o e-mail da conta', () => {
    const verdict = evaluateSponsorInviteClaim({
      invite: invite(),
      token,
      userEmail: 'contato@empresa.test',
      now: NOW,
    });

    expect(verdict.ok).toBe(true);
  });

  it('recusa token que não casa', () => {
    const verdict = evaluateSponsorInviteClaim({
      invite: invite(),
      token: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      userEmail: 'contato@empresa.test',
      now: NOW,
    });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('INVALID_TOKEN');
  });

  it('recusa convite expirado, já aceito e de outro endereço', () => {
    const expirado = evaluateSponsorInviteClaim({
      invite: invite({ inviteExpiresAt: new Date('2026-09-01T00:00:00.000Z') }),
      token,
      userEmail: 'contato@empresa.test',
      now: NOW,
    });
    expect(expirado.ok).toBe(false);
    if (!expirado.ok) expect(expirado.code).toBe('EXPIRED');

    const aceito = evaluateSponsorInviteClaim({
      invite: invite({ userId: 'user-1' }),
      token,
      userEmail: 'contato@empresa.test',
      now: NOW,
    });
    expect(aceito.ok).toBe(false);
    if (!aceito.ok) expect(aceito.code).toBe('ALREADY_LINKED');

    const outroEmail = evaluateSponsorInviteClaim({
      invite: invite(),
      token,
      userEmail: 'outra@empresa.test',
      now: NOW,
    });
    expect(outroEmail.ok).toBe(false);
    if (!outroEmail.ok) expect(outroEmail.code).toBe('EMAIL_MISMATCH');
  });

  it('convite inexistente responde "não encontrado", não "inválido"', () => {
    const verdict = evaluateSponsorInviteClaim({
      invite: null,
      token,
      userEmail: 'contato@empresa.test',
      now: NOW,
    });

    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toContain('não encontrado');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('formulário do QR', () => {
  const base = { label: 'Estande — entrada' };

  it('nasce com o prazo padrão de consentimento', () => {
    expect(sponsorQrInputSchema.parse(base).consentDays).toBe(DEFAULT_CONSENT_DAYS);
    expect(sponsorQrInputSchema.parse(base).xpAmount).toBe(0);
  });

  it('recusa XP acima do teto e prazo fora da faixa', () => {
    expect(sponsorQrInputSchema.safeParse({ ...base, xpAmount: MAX_SPONSOR_QR_XP + 1 }).success).toBe(
      false,
    );
    expect(sponsorQrInputSchema.safeParse({ ...base, consentDays: 0 }).success).toBe(false);
    expect(sponsorQrInputSchema.safeParse({ ...base, consentDays: MAX_CONSENT_DAYS + 1 }).success).toBe(
      false,
    );
  });

  it('exige um nome legível para o QR', () => {
    expect(sponsorQrInputSchema.safeParse({ label: 'ab' }).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * O QR QUE VAI PARA O ESTANDE.
 *
 * A fase nasceu mostrando só o ENDEREÇO em texto, e o estande ficou sem peça: quem
 * lê o código é a câmera do celular do participante, e ninguém digita `PT-ABCD-2345`
 * no meio do pavilhão. Estes testes prendem as três coisas que fazem a peça
 * funcionar: endereço ABSOLUTO (caminho relativo não abre nada), imagem com
 * conteúdo de verdade e um arquivo em tamanho de impressão.
 */
describe('QR do estande para imprimir', () => {
  const originalAppUrl = process.env.APP_URL;

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = originalAppUrl;
  });

  it('monta o endereço ABSOLUTO, sem barra duplicada', () => {
    process.env.APP_URL = 'https://eventos.exemplo.br/';

    expect(sponsorQrPath('ufba-demo', 'abcd2345')).toBe('/t/ufba-demo/patrocinio/ABCD2345');
    expect(sponsorQrUrl('ufba-demo', 'abcd2345')).toBe(
      'https://eventos.exemplo.br/t/ufba-demo/patrocinio/ABCD2345',
    );
  });

  it('usa o host configurado, e não um caminho relativo', () => {
    process.env.APP_URL = 'https://congresso.ufba.br';

    expect(sponsorQrUrl('ufba-demo', 'ABCD2345').startsWith('https://')).toBe(true);
    expect(sponsorQrUrl('ufba-demo', 'ABCD2345')).toContain('/t/ufba-demo/patrocinio/ABCD2345');
  });

  it('embute a imagem em PNG, com assinatura de arquivo de verdade', async () => {
    const sheet = await sponsorQrSheet({ tenantSlug: 'ufba-demo', code: 'ABCD2345' });

    expect(sheet.url).toBe(sponsorQrUrl('ufba-demo', 'ABCD2345'));
    expect(sheet.path).toBe('/t/ufba-demo/patrocinio/ABCD2345');
    expect(sheet.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    /**
     * Um `data:` vazio também "começa com" o prefixo. A assinatura PNG (oito bytes
     * fixos) é o que prova que a biblioteca realmente desenhou o código.
     */
    const bytes = Buffer.from(sheet.dataUrl.split(',')[1] ?? '', 'base64');
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('entrega PNG para imprimir agora e SVG para ampliar sem perder qualidade', async () => {
    const png = await sponsorQrFile({ tenantSlug: 'ufba-demo', code: 'abcd2345', format: 'png' });

    expect(png.contentType).toBe('image/png');
    expect(png.fileName).toBe('qr-ABCD2345.png');
    expect(Buffer.isBuffer(png.body)).toBe(true);
    expect((png.body as Buffer).byteLength).toBeGreaterThan(500);

    const svg = await sponsorQrFile({ tenantSlug: 'ufba-demo', code: 'abcd2345', format: 'svg' });

    expect(svg.contentType).toContain('image/svg+xml');
    expect(svg.fileName).toBe('qr-ABCD2345.svg');
    expect(String(svg.body)).toContain('<svg');
  });

  it('o arquivo sai MAIOR que a imagem da tela', () => {
    /** Um cartaz impresso a partir de 240 px sai serrilhado nas bordas dos módulos. */
    expect(SPONSOR_QR_FILE_WIDTH).toBeGreaterThan(SPONSOR_QR_IMAGE_WIDTH);
  });

  it('recusa formato que não entende, em vez de escolher um', () => {
    expect(isSponsorQrFormat('png')).toBe(true);
    expect(isSponsorQrFormat('svg')).toBe(true);
    expect(isSponsorQrFormat('pdf')).toBe(false);
    expect(isSponsorQrFormat(null)).toBe(false);
  });
});
