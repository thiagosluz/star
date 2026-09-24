/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — DESENHO do layout (FASE 40)
 *
 *  Duas coisas são presas aqui, e nenhuma delas aparece na tela:
 *
 *    1. A GEOMETRIA. A matriz que leva o quadrado unitário para a página é a mesma
 *       no SVG e no PDF; se ela errar, a arte sai girada, espelhada ou deformada — e
 *       deformar a marca da instituição é o defeito que a fase existe para evitar.
 *    2. O DETERMINISMO. O mesmo documento e a mesma arte precisam produzir os MESMOS
 *       bytes. Um `/Length` errado, ou a data do relógio entrando nos metadados,
 *       quebraria isso sem quebrar nenhuma tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  formatIssuedAtLabel,
  normalizeLayout,
  resolveCertificateVariables,
  serializeContentValues,
  contentValuesFrom,
  type CertificateBackground,
  type CertificateLayout,
  type CertificateVariableValues,
} from '../../src/domain/certificates/certificate-layout-rules';
import {
  alignedX,
  backgroundPlacement,
  baselines,
  buildJpegXObject,
  drawLayoutPdf,
  drawLayoutSvg,
  layoutTextLines,
  mmToPt,
  orientationTransform,
  pdfMatrixValue,
  placementMatrix,
  ptToMm,
  qrPlacement,
  svgMatrixValue,
  wrapToWidth,
} from '../../src/lib/documents/layout-draw';
import {
  pageSizePt,
  renderCertificateLayoutPdf,
  renderCertificateLayoutSvg,
} from '../../src/lib/certificates/layout-renderer';

// ── Fixtures ───────────────────────────────────────────────────────────────────
const ART = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

const BACKGROUND: CertificateBackground = {
  objectKey: 'tenants/t/artes/fundo.jpg',
  checksum: 'a'.repeat(64),
  widthPx: 3508,
  heightPx: 2480,
  orientation: 1,
  colorComponents: 3,
  sizeBytes: ART.length,
  fit: 'COVER',
};

function values(overrides: Partial<CertificateVariableValues> = {}): CertificateVariableValues {
  return {
    ...resolveCertificateVariables({
      recipientName: 'Ana Souza',
      title: 'Certificado de conclusão',
      bodyText: 'Certificamos que Ana Souza concluiu o minicurso.',
      eventTitle: 'Congresso 2026',
      activityTitle: 'Rust para iniciantes',
      workloadLabel: '4 horas',
      period: '12 a 14 de março de 2026',
      issuedAtLabel: '20/03/2026',
      tenantName: 'UFBA',
      validationCode: 'CERT-7KQ4M2XP',
      validationUrl: 'https://eventflow.test/validar/CERT-7KQ4M2XP',
      contentHash: 'b'.repeat(64),
      signature: 'assinatura-base64',
      keyId: 'cert-2026-01',
    }),
    ...overrides,
  };
}

function layout(background: CertificateBackground | null = null): CertificateLayout {
  return normalizeLayout({
    page: 'A4_LANDSCAPE',
    background,
    elements: [
      {
        id: 'nome',
        kind: 'VARIABLE',
        xMm: 20,
        yMm: 60,
        widthMm: 257,
        heightMm: 16,
        align: 'CENTER',
        font: 'TIMES_BOLD',
        sizePt: 30,
        color: '#111827',
        lineHeight: 1.4,
        text: null,
        variable: 'nome',
      },
      {
        id: 'corpo',
        kind: 'VARIABLE',
        xMm: 30,
        yMm: 90,
        widthMm: 237,
        heightMm: 30,
        align: 'LEFT',
        font: 'HELVETICA',
        sizePt: 12,
        color: '#374151',
        lineHeight: 1.6,
        text: null,
        variable: 'corpo',
      },
      {
        id: 'codigo',
        kind: 'VARIABLE',
        xMm: 20,
        yMm: 172,
        widthMm: 80,
        heightMm: 8,
        align: 'LEFT',
        font: 'HELVETICA_BOLD',
        sizePt: 11,
        color: '#1d4ed8',
        lineHeight: 1.4,
        text: null,
        variable: 'codigo_validacao',
      },
      {
        id: 'url',
        kind: 'VARIABLE',
        xMm: 20,
        yMm: 180,
        widthMm: 90,
        heightMm: 6,
        align: 'LEFT',
        font: 'HELVETICA',
        sizePt: 8,
        color: '#4b5563',
        lineHeight: 1.4,
        text: null,
        variable: 'url_validacao',
      },
      {
        id: 'qr',
        kind: 'QR',
        xMm: 240,
        yMm: 158,
        widthMm: 34,
        heightMm: 34,
        align: 'CENTER',
        font: 'HELVETICA',
        sizePt: 10,
        color: '#111827',
        lineHeight: 1.4,
        text: null,
        variable: null,
      },
      {
        id: 'fixo',
        kind: 'TEXT',
        xMm: 20,
        yMm: 196,
        widthMm: 200,
        heightMm: 5,
        align: 'LEFT',
        font: 'COURIER',
        sizePt: 6,
        color: '#9ca3af',
        lineHeight: 1.4,
        text: 'Portaria nº 12/2026',
        variable: null,
      },
    ],
  });
}

const ISSUED_AT = new Date('2026-03-20T14:32:10.000Z');

// ═══════════════════════════════════════════════════════════════════════════════
describe('matriz de posicionamento', () => {
  it('sem rotação nem espelho, a matriz só posiciona e escala', () => {
    const matrix = placementMatrix({
      preRotationWidth: 100,
      preRotationHeight: 50,
      centerX: 50,
      centerY: 25,
      rotation: 0,
      flipX: false,
    });
    expect(matrix).toEqual([100, 0, 0, 50, 0, 0]);
  });

  it('gira 90° no sentido HORÁRIO da tela (o canto superior esquerdo vai para baixo)', () => {
    const [a, b, c, d, e, f] = placementMatrix({
      preRotationWidth: 100,
      preRotationHeight: 100,
      centerX: 50,
      centerY: 50,
      rotation: 90,
      flipX: false,
    });
    // (u,v) = (0,0) — canto superior esquerdo da imagem — cai em (e, f).
    expect([e, f]).toEqual([0, 100]);
    // A largura da imagem (100) vira ALTURA desenhada.
    expect(Math.abs(b)).toBe(100);
    expect(a).toBe(0);
    expect(d).toBe(0);
    expect(c).toBe(100);
  });

  it('espelha no DOMÍNIO: os coeficientes de X trocam de sinal e a origem anda', () => {
    const matrix = placementMatrix({
      preRotationWidth: 100,
      preRotationHeight: 50,
      centerX: 50,
      centerY: 25,
      rotation: 0,
      flipX: true,
    });
    expect(matrix).toEqual([-100, 0, 0, 50, 100, 0]);
  });

  it('as 8 orientações EXIF têm rotação e espelho definidos', () => {
    expect(orientationTransform(1)).toEqual({ rotation: 0, flipX: false });
    expect(orientationTransform(2)).toEqual({ rotation: 0, flipX: true });
    expect(orientationTransform(3)).toEqual({ rotation: 180, flipX: false });
    expect(orientationTransform(4)).toEqual({ rotation: 180, flipX: true });
    expect(orientationTransform(5)).toEqual({ rotation: 90, flipX: true });
    expect(orientationTransform(6)).toEqual({ rotation: 90, flipX: false });
    expect(orientationTransform(7)).toEqual({ rotation: 270, flipX: true });
    expect(orientationTransform(8)).toEqual({ rotation: 270, flipX: false });
    // Orientação desconhecida não gira nada: dado estranho não inventa transformação.
    expect(orientationTransform(99)).toEqual({ rotation: 0, flipX: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('posicionamento da arte', () => {
  it('COVER cobre a página inteira e pode exceder (o excesso é cortado)', () => {
    const placement = backgroundPlacement(BACKGROUND, 'A4_LANDSCAPE');
    expect(placement.drawnWidthMm).toBeGreaterThanOrEqual(297);
    expect(placement.drawnHeightMm).toBeGreaterThanOrEqual(210);
    // Uma das dimensões casa exatamente com a página.
    expect(placement.drawnWidthMm === 297 || placement.drawnHeightMm === 210).toBe(true);
  });

  it('COVER usa UM fator de escala: a proporção da arte é preservada', () => {
    const placement = backgroundPlacement({ ...BACKGROUND, widthPx: 6000, heightPx: 2000 }, 'A4_LANDSCAPE');
    const artRatio = 6000 / 2000;
    const drawnRatio = placement.drawnWidthMm / placement.drawnHeightMm;
    expect(drawnRatio).toBeCloseTo(artRatio, 6);
    expect(placement.overflowXMm).toBeGreaterThan(0);
    expect(placement.overflowYMm).toBe(0);
  });

  it('STRETCH entrega exatamente a página, mesmo deformando', () => {
    const placement = backgroundPlacement(
      { ...BACKGROUND, widthPx: 6000, heightPx: 2000, fit: 'STRETCH' },
      'A4_LANDSCAPE',
    );
    expect(placement.drawnWidthMm).toBeCloseTo(297, 6);
    expect(placement.drawnHeightMm).toBeCloseTo(210, 6);
    expect(placement.overflowXMm).toBe(0);
    expect(placement.overflowYMm).toBe(0);
  });

  it('a orientação EXIF troca os lados desenhados', () => {
    const semExif = backgroundPlacement({ ...BACKGROUND, widthPx: 2480, heightPx: 3508 }, 'A4_LANDSCAPE');
    const comExif = backgroundPlacement(
      { ...BACKGROUND, widthPx: 2480, heightPx: 3508, orientation: 6 },
      'A4_LANDSCAPE',
    );
    expect(semExif.drawnWidthMm).toBeCloseTo(297, 6);
    expect(comExif.drawnHeightMm).toBeCloseTo(210, 6);
  });

  it('respeita a página em retrato', () => {
    const placement = backgroundPlacement(BACKGROUND, 'A4_PORTRAIT');
    expect(placement.drawnWidthMm === 210 || placement.drawnHeightMm === 297).toBe(true);
  });

  it('a matriz do SVG sai em milímetros e a do PDF em pontos com o Y invertido', () => {
    const matrix = placementMatrix({
      preRotationWidth: 100,
      preRotationHeight: 50,
      centerX: 50,
      centerY: 25,
      rotation: 0,
      flipX: false,
    });
    expect(svgMatrixValue(matrix)).toBe('matrix(100 0 0 50 0 0)');

    const pdf = pdfMatrixValue(matrix, mmToPt(210)).split(' ').map(Number);
    expect(pdf[0]).toBeCloseTo(mmToPt(100), 3);
    expect(pdf[3]).toBeCloseTo(mmToPt(50), 3);
    // e/f: 0 mm continua 0 e a base (f) é a ALTURA da página menos o Y do topo.
    expect(pdf[4]).toBeCloseTo(0, 3);
    expect(pdf[5]).toBeCloseTo(mmToPt(210) - 0, 3);
  });

  it('converte milímetro e ponto de forma consistente', () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
    expect(ptToMm(72)).toBeCloseTo(25.4, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quebra de linha e alinhamento', () => {
  it('quebra por palavra na largura disponível', () => {
    const lines = wrapToWidth('um dois tres quatro cinco seis sete oito nove dez', mmToPt(40), 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line).not.toMatch(/^\s|\s$/);
  });

  it('palavra sozinha maior que a caixa não é cortada', () => {
    const lines = wrapToWidth('incompreensivelmente', mmToPt(10), 12);
    expect(lines).toEqual(['incompreensivelmente']);
  });

  it('respeita a quebra manual de linha', () => {
    expect(wrapToWidth('primeira\nsegunda', mmToPt(200), 12)).toEqual(['primeira', 'segunda']);
  });

  it('corta o que não cabe na altura e avisa com reticências', () => {
    const text = 'palavra '.repeat(200).trim();
    const lines = layoutTextLines({ text, widthMm: 100, heightMm: 10, sizePt: 12, lineHeight: 1.4 });
    const capacity = Math.max(1, Math.floor(mmToPt(10) / (12 * 1.4)));
    expect(lines).toHaveLength(capacity);
    expect(lines[lines.length - 1]?.endsWith('…')).toBe(true);
  });

  it('texto curto não ganha reticências', () => {
    const lines = layoutTextLines({ text: 'Curto', widthMm: 200, heightMm: 20, sizePt: 12, lineHeight: 1.4 });
    expect(lines).toEqual(['Curto']);
  });

  it('alinhamento posiciona a linha dentro da caixa', () => {
    const element = { xMm: 20, widthMm: 100, align: 'LEFT' as const };
    const left = alignedX(element, 'abc', 12);
    const center = alignedX({ ...element, align: 'CENTER' }, 'abc', 12);
    const right = alignedX({ ...element, align: 'RIGHT' }, 'abc', 12);

    expect(left).toBe(20);
    expect(center).toBeGreaterThan(left);
    expect(right).toBeGreaterThan(center);
    // A linha mais longa encosta na direita; a mais curta fica à direita TAMBÉM.
    const wide = alignedX({ ...element, align: 'LEFT' }, 'a'.repeat(60), 12);
    const wideRight = alignedX({ ...element, align: 'RIGHT' }, 'a'.repeat(60), 12);
    expect(wideRight).toBeGreaterThanOrEqual(20);
    expect(wide).toBeLessThanOrEqual(20);
  });

  it('as linhas de base descem de acordo com a entrelinha', () => {
    const tops = baselines({ yMm: 50, sizePt: 12, lineHeight: 1.5 }, 3);
    expect(tops).toHaveLength(3);
    expect(tops[0]).toBeCloseTo(50 + ptToMm(12) * 0.78, 6);
    expect((tops[1] ?? 0) - (tops[0] ?? 0)).toBeCloseTo(ptToMm(12 * 1.5), 6);
  });

  it('o QR usa o menor lado da caixa e sai quadrado', () => {
    expect(qrPlacement({ xMm: 10, yMm: 20, widthMm: 40, heightMm: 25 })).toEqual({
      sizeMm: 25,
      xMm: 10,
      yMm: 20,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('SVG do layout', () => {
  const doc = { values: values(), layout: layout(), qrPayload: 'https://eventflow.test/validar/X' };

  it('declara a página em milímetros e desenha os valores resolvidos', () => {
    const svg = renderCertificateLayoutSvg({ ...doc, backgroundBytes: null, issuedAt: ISSUED_AT });
    expect(svg).toContain('width="297mm"');
    expect(svg).toContain('viewBox="0 0 297 210"');
    expect(svg).toContain('Ana Souza');
    expect(svg).toContain('CERT-7KQ4M2XP');
    expect(svg).toContain('Portaria nº 12/2026');
  });

  it('embute a arte como data URI (o documento não depende de URL assinada)', () => {
    const svg = renderCertificateLayoutSvg({
      ...doc,
      layout: layout(BACKGROUND),
      backgroundBytes: ART,
      issuedAt: ISSUED_AT,
    });
    expect(svg).toContain('href="data:image/jpeg;base64,');
  });

  it('variável sem valor não aparece na página', () => {
    const svg = renderCertificateLayoutSvg({
      ...doc,
      values: values({ atividade: '' }),
      backgroundBytes: null,
      issuedAt: ISSUED_AT,
    });
    expect(svg).not.toContain('Rust para iniciantes');
  });

  it('é determinístico: o mesmo documento gera o mesmo SVG', () => {
    const first = renderCertificateLayoutSvg({ ...doc, backgroundBytes: ART, issuedAt: ISSUED_AT });
    const second = renderCertificateLayoutSvg({ ...doc, backgroundBytes: ART, issuedAt: ISSUED_AT });
    expect(first).toBe(second);
  });

  it('desenha o QR do endereço de validação', () => {
    const svg = renderCertificateLayoutSvg({ ...doc, backgroundBytes: null, issuedAt: ISSUED_AT });
    expect(svg).toContain('<rect');
    expect(svg).toContain('data-element="qr"');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('PDF do layout', () => {
  const base = {
    values: values(),
    layout: layout(),
    issuedAt: ISSUED_AT,
  };

  it('produz um PDF completo, com as fontes usadas referenciadas', () => {
    const pdf = renderCertificateLayoutPdf({ ...base, backgroundBytes: null });
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/F1 5 0 R');
    expect(text).toContain('/F4 8 0 R');
    expect(text).toContain('/F5 9 0 R');
    expect(text).toContain('Ana Souza');
  });

  it('embute a arte como XObject /DCTDecode com os bytes ORIGINAIS', () => {
    const withArt = renderCertificateLayoutPdf({
      values: base.values,
      layout: layout(BACKGROUND),
      backgroundBytes: ART,
      issuedAt: ISSUED_AT,
    });
    const text = withArt.toString('latin1');

    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/ColorSpace /DeviceRGB');
    expect(text).toContain('/XObject << /Im0 10 0 R >>');
    // Os bytes do arquivo atravessam a montagem sem interpretação: o JPEG inteiro
    // aparece no PDF, byte a byte.
    expect(withArt.includes(Buffer.from(ART))).toBe(true);
  });

  it('usa /DeviceGray quando o JPEG é de um componente', () => {
    const object = buildJpegXObject({ ...BACKGROUND, colorComponents: 1 }, ART);
    expect(object.toString('latin1')).toContain('/ColorSpace /DeviceGray');
    expect(object.toString('latin1')).toContain(`/Length ${ART.length}`);
  });

  it('o /Length de TODO stream casa com os bytes que ele declara', () => {
    const pdf = renderCertificateLayoutPdf({
      values: base.values,
      layout: layout(BACKGROUND),
      backgroundBytes: ART,
      issuedAt: ISSUED_AT,
    });
    const text = pdf.toString('latin1');
    const pattern = /\/Length (\d+) >>\nstream\n/g;

    let match = pattern.exec(text);
    let streams = 0;

    while (match) {
      const declared = Number(match[1]);
      const start = match.index + match[0].length;
      const end = start + declared;

      expect(pdf.subarray(start, end).length).toBe(declared);
      expect(text.slice(end, end + '\nendstream'.length)).toBe('\nendstream');

      streams += 1;
      match = pattern.exec(text);
    }

    // Conteúdo da página + a imagem.
    expect(streams).toBe(2);
  });

  it('é determinístico: bytes idênticos para o mesmo documento (com e sem arte)', () => {
    const first = renderCertificateLayoutPdf({ ...base, backgroundBytes: ART, layout: layout(BACKGROUND) });
    const second = renderCertificateLayoutPdf({ ...base, backgroundBytes: ART, layout: layout(BACKGROUND) });
    expect(first.equals(second)).toBe(true);
  });

  it('a data dos metadados vem do instante da emissão, não do relógio', () => {
    const pdf = renderCertificateLayoutPdf({ ...base, backgroundBytes: null });
    const text = pdf.toString('latin1');
    expect(text).toContain('/CreationDate (D:20260320143210Z)');
  });

  it('a página do PDF é A4 paisagem em pontos', () => {
    const pdf = renderCertificateLayoutPdf({ ...base, backgroundBytes: null });
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 841.89 595.28]');
  });

  it('retrato muda a MediaBox', () => {
    const portrait = normalizeLayout({ ...layout(), page: 'A4_PORTRAIT' });
    const pdf = renderCertificateLayoutPdf({ ...base, layout: portrait, backgroundBytes: null });
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pageSizePt(portrait)).toEqual({ widthPt: mmToPt(210), heightPt: mmToPt(297) });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('desenho direto (sem renderizador)', () => {
  it('o SVG do layout é um grupo identificado pela página', () => {
    const svg = drawLayoutSvg({
      layout: layout(),
      values: values(),
      qrPayload: 'https://eventflow.test/validar/X',
    });
    expect(svg).toContain('data-page="297x210"');
  });

  it('o desenho em PDF devolve os operadores e o objeto de imagem', () => {
    const drawing = drawLayoutPdf({
      layout: layout(BACKGROUND),
      values: values(),
      qrPayload: 'https://eventflow.test/validar/X',
      widthPt: mmToPt(297),
      heightPt: mmToPt(210),
      backgroundBytes: ART,
    });
    const content = drawing.operations.join('\n');

    expect(content).toContain('/Im0 Do');
    expect(content).toContain(' re W n');
    expect(drawing.imageObject).not.toBeNull();
  });

  it('sem os bytes da arte, o PDF não declara imagem', () => {
    const drawing = drawLayoutPdf({
      layout: layout(BACKGROUND),
      values: values(),
      qrPayload: 'https://eventflow.test/validar/X',
      widthPt: mmToPt(297),
      heightPt: mmToPt(210),
      backgroundBytes: null,
    });
    expect(drawing.imageObject).toBeNull();
    expect(drawing.operations.join('\n')).not.toContain('/Im0 Do');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('conteúdo congelado das variáveis', () => {
  it('serializa só as chaves de CONTEÚDO, na ordem do catálogo', () => {
    const serialized = serializeContentValues(contentValuesFrom(values()));
    const parsed = JSON.parse(serialized) as Record<string, string>;

    expect(Object.keys(parsed)).toEqual([
      'nome',
      'titulo',
      'corpo',
      'evento',
      'atividade',
      'carga_horaria',
      'periodo',
      'data_emissao',
      'instituicao',
      'codigo_validacao',
      'url_validacao',
    ]);

    // Auditoria NÃO entra: o hash não pode depender de si mesmo.
    expect(parsed).not.toHaveProperty('hash');
    expect(parsed).not.toHaveProperty('assinatura');
    expect(parsed).not.toHaveProperty('chave');
  });

  it('apara espaços e mantém chave ausente como string vazia', () => {
    const parsed = JSON.parse(
      serializeContentValues(contentValuesFrom(values({ atividade: '   ', nome: '  Ana  ' }))),
    ) as Record<string, string>;

    expect(parsed.nome).toBe('Ana');
    expect(parsed.atividade).toBe('');
  });

  it('data de emissão sai no fuso pedido, no formato brasileiro', () => {
    expect(formatIssuedAtLabel(ISSUED_AT, 'UTC')).toBe('20/03/2026');
    // 14:32 UTC ainda é 20/03 em Salvador; em Tóquio já é 20/03 às 23:32 — o fuso
    // do EVENTO é quem decide o dia impresso.
    expect(formatIssuedAtLabel(new Date('2026-03-20T02:00:00.000Z'), 'America/Bahia')).toBe('19/03/2026');
  });
});
