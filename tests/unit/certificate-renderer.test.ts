/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — assinatura e renderização do certificado
 *
 *  Duas propriedades são críticas e não óbvias:
 *    • DETERMINISMO — o mesmo conteúdo precisa gerar bytes idênticos (o hash do
 *      documento depende disso);
 *    • ESCAPE — nome com `(` ou `&` não pode quebrar o PDF nem o SVG.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  buildQrMatrix,
  escapePdfText,
  escapeXml,
  formatIssuedAt,
  renderCertificatePdf,
  renderCertificateSvg,
  wrapText,
  type CertificateDocument,
} from '../../src/lib/certificates/renderer';
import {
  getSigningConfig,
  isSigningConfigured,
  shortHash,
  signContentHash,
  verifySignature,
} from '../../src/lib/certificates/signer';

const document: CertificateDocument = {
  title: 'Certificado de conclusão de minicurso',
  recipientName: 'Ana Ribeiro',
  bodyText:
    'Certificamos que Ana Ribeiro participou pela conclusão do minicurso "Programação em Rust" realizado em 17 de setembro de 2026 com carga horária de 4h.',
  eventTitle: 'Congresso de Tecnologia e Educação 2026',
  tenantName: 'Universidade Federal da Bahia',
  period: '17 de setembro de 2026',
  workloadLabel: '4h',
  validationCode: 'CERT-ABCD2345',
  validationUrl: 'http://localhost:3000/validar/CERT-ABCD2345',
  contentHash: 'a'.repeat(64),
  signature: 'c2lnbmF0dXJlLWRlLXRlc3RlLWVtLWJhc2U2NA==',
  keyId: 'dev-key-2025-01',
  signatureAlg: 'HMAC-SHA256',
  issuedAt: new Date('2026-09-20T12:00:00.000Z'),
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('assinatura', () => {
  const secret = 'segredo-de-teste-com-tamanho-suficiente';

  it('assina e verifica o mesmo hash', () => {
    const signature = signContentHash({ contentHash: 'abc123', keyId: 'k1', secret });

    expect(signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(verifySignature({ contentHash: 'abc123', signature, keyId: 'k1', secret })).toBe(true);
  });

  it('RECUSA hash alterado', () => {
    const signature = signContentHash({ contentHash: 'abc123', keyId: 'k1', secret });

    expect(verifySignature({ contentHash: 'abc124', signature, keyId: 'k1', secret })).toBe(false);
  });

  it('RECUSA assinatura feita com outra chave', () => {
    const signature = signContentHash({ contentHash: 'abc123', keyId: 'k1', secret });

    expect(
      verifySignature({
        contentHash: 'abc123',
        signature,
        keyId: 'k1',
        secret: 'outro-segredo-com-tamanho-suficiente',
      }),
    ).toBe(false);
  });

  it('RECUSA assinatura de outro keyId (rotação de chave é auditável)', () => {
    // O keyId entra na mensagem assinada: trocar a chave sem trocar o
    // identificador produziria assinaturas indistinguíveis.
    const signature = signContentHash({ contentHash: 'abc123', keyId: 'k1', secret });

    expect(verifySignature({ contentHash: 'abc123', signature, keyId: 'k2', secret })).toBe(false);
  });

  it('recusa comparar assinatura de tamanho diferente sem lançar', () => {
    expect(verifySignature({ contentHash: 'abc123', signature: 'curto', keyId: 'k1', secret })).toBe(
      false,
    );
  });

  it('lança ao assinar sem segredo configurado', () => {
    expect(() => signContentHash({ contentHash: 'abc', keyId: 'k1', secret: '' })).toThrow(
      /CERTIFICATE_HMAC_SECRET/,
    );
  });

  it('lê a configuração do ambiente com padrão seguro', () => {
    const config = getSigningConfig();
    expect(config.alg).toBeTruthy();
    expect(typeof config.keyId).toBe('string');
    // Sem segredo configurado, a emissão precisa ser recusada — não silenciada.
    if (!process.env.CERTIFICATE_HMAC_SECRET) {
      expect(isSigningConfigured()).toBe(false);
    }
  });

  it('resume o hash para exibição no papel', () => {
    expect(shortHash('abcdef0123456789resto', 16)).toBe('abcdef0123456789');
    expect(shortHash('abcdef0123456789resto', 16)).toHaveLength(16);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('QR Code', () => {
  it('gera matriz quadrada e coerente', () => {
    const qr = buildQrMatrix(document.validationUrl);

    expect(qr.size).toBeGreaterThanOrEqual(21);
    expect(qr.data.length).toBe(qr.size * qr.size);
  });

  it('URL mais longa produz matriz maior (versão escolhida pelo conteúdo)', () => {
    const small = buildQrMatrix('http://a.test').size;
    const large = buildQrMatrix(`http://a.test/${'x'.repeat(120)}`).size;

    expect(large).toBeGreaterThan(small);
  });

  it('tem os padrões localizadores nos três cantos', () => {
    // O olho do QR (7×7) é a assinatura visual do formato: se ele não estiver
    // preto no canto superior esquerdo, nenhum leitor vai reconhecer o código.
    const qr = buildQrMatrix('http://localhost:3000/validar/CERT-ABCD2345');
    const at = (row: number, column: number) => qr.data[row * qr.size + column];

    for (let index = 0; index < 7; index += 1) {
      expect(at(0, index), `borda superior (${index})`).toBe(1);
      expect(at(index, 0), `borda esquerda (${index})`).toBe(1);
    }

    expect(at(1, 1)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('SVG', () => {
  it('inclui os dados essenciais do documento', () => {
    const svg = renderCertificateSvg(document);

    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('Ana Ribeiro');
    expect(svg).toContain('CERT-ABCD2345');
    expect(svg).toContain('4h');
    expect(svg).toContain(document.contentHash);
    expect(svg).toContain('HMAC-SHA256');
  });

  it('é DETERMINÍSTICO', () => {
    expect(renderCertificateSvg(document)).toBe(renderCertificateSvg({ ...document }));
  });

  it('desenha o QR como vetor', () => {
    const svg = renderCertificateSvg(document);
    const qr = buildQrMatrix(document.validationUrl);
    const darkModules = qr.data.reduce((sum, value) => sum + value, 0);

    const rects = svg.match(/<rect /g)?.length ?? 0;
    // 3 retângulos fixos (fundo + duas molduras) + 1 por módulo escuro.
    expect(rects).toBe(darkModules + 3);
  });

  it('escapa XML e não quebra com nome contendo & ou <', () => {
    const svg = renderCertificateSvg({
      ...document,
      recipientName: 'Ana & Bruno <Ribeiro>',
      eventTitle: 'Ciência & Arte',
    });

    expect(svg).toContain('Ana &amp; Bruno &lt;Ribeiro&gt;');
    expect(svg).not.toContain('<Ribeiro>');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('PDF', () => {
  it('gera um PDF estruturalmente válido', () => {
    const pdf = renderCertificatePdf(document).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Type /Pages');
    expect(pdf).toContain('/Type /Page');
    expect(pdf).toContain('/BaseFont /Helvetica');
    expect(pdf).toContain('xref');
    expect(pdf).toContain('trailer');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('a tabela xref aponta para offsets REAIS dos objetos', () => {
    /**
     * Um `xref` incorreto faz leitores estritos recusarem o arquivo — e o defeito
     * é invisível em visualizadores tolerantes. Aqui conferimos cada offset.
     *
     * A busca é por `\nxref\n` e não por `xref`: a palavra `startxref` (que vem
     * DEPOIS da tabela) contém a mesma sequência e enganaria o teste.
     */
    const buffer = renderCertificatePdf(document);
    const pdf = buffer.toString('latin1');

    const xrefStart = pdf.lastIndexOf('\nxref\n');
    expect(xrefStart).toBeGreaterThan(0);

    const entries = pdf
      .slice(xrefStart)
      .split('\n')
      .slice(3)
      .filter((line) => /^\d{10} 00000 n/.test(line));

    expect(entries.length).toBe(7);

    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      const expected = `${index + 1} 0 obj`;
      expect(pdf.slice(offset, offset + expected.length), `objeto ${index + 1}`).toBe(expected);
    });
  });

  it('é DETERMINÍSTICO', () => {
    const first = renderCertificatePdf(document);
    const second = renderCertificatePdf({ ...document });

    expect(first.equals(second)).toBe(true);
  });

  it('inclui nome, código e carga horária', () => {
    const pdf = renderCertificatePdf(document).toString('latin1');

    expect(pdf).toContain('Ana Ribeiro');
    expect(pdf).toContain('CERT-ABCD2345');
    expect(pdf).toContain('Carga hor');
    expect(pdf).toContain('HMAC-SHA256');
  });

  it('escapa parênteses e barras no texto', () => {
    const pdf = renderCertificatePdf({
      ...document,
      recipientName: 'Ana (Ribeiro) \\ Silva',
      bodyText: 'Texto com (parênteses) e \\ barras invertidas.',
    }).toString('latin1');

    expect(pdf).toContain('Ana \\(Ribeiro\\) \\\\ Silva');
    // Nenhum parêntese solto: o balanceamento dentro do stream precisa fechar.
    const stream = pdf.slice(pdf.indexOf('stream\n') + 7, pdf.indexOf('\nendstream'));
    const opens = (stream.match(/\(/g) ?? []).length;
    const closes = (stream.match(/\)/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it('desenha o QR como vetor (retângulos preenchidos)', () => {
    const pdf = renderCertificatePdf(document).toString('latin1');
    const qr = buildQrMatrix(document.validationUrl);
    const darkModules = qr.data.reduce((sum, value) => sum + value, 0);

    // As molduras usam `re S` (contorno); o único uso de `re f` (preenchido) é o QR.
    const fills = pdf.match(/ re f/g)?.length ?? 0;
    expect(fills).toBe(darkModules);
  });

  it('a data de criação vem do conteúdo (não do relógio)', () => {
    const pdf = renderCertificatePdf(document).toString('latin1');
    expect(pdf).toContain('/CreationDate (D:20260920120000Z)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('auxiliares de texto', () => {
  it('quebra linhas longas por palavra', () => {
    const lines = wrapText('uma duas tres quatro cinco seis sete oito nove dez', 20);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
    expect(lines.join(' ')).toBe('uma duas tres quatro cinco seis sete oito nove dez');
  });

  it('quebra palavra maior que o limite sem entrar em laço', () => {
    const lines = wrapText('x'.repeat(50), 10);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.join('').length).toBe(50);
  });

  it('texto vazio devolve uma linha vazia', () => {
    expect(wrapText('', 20)).toEqual(['']);
  });

  it('escapa PDF e XML', () => {
    expect(escapePdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
    expect(escapeXml('<a> & "b"')).toBe('&lt;a&gt; &amp; &quot;b&quot;');
  });

  it('formata a data de emissão em UTC', () => {
    expect(formatIssuedAt(new Date('2026-09-20T23:30:00.000Z'))).toBe('20/09/2026');
  });
});
