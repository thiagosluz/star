/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — LAYOUT do certificado (FASE 40)
 *
 *  O layout é a régua física do documento: ele decide onde o nome cai, quanto a
 *  arte é recortada e se o certificado continua validável. Nada disso passa por
 *  tela — é aritmética em milímetros, e é aqui que ela é presa.
 *
 *  O bloco probatório tem teste próprio (QR + código + endereço são obrigatórios)
 *  porque é a única parte do desenho que o organizador NÃO pode apagar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  CERTIFICATE_TEMPLATE_PRESETS,
  CERTIFICATE_VARIABLES,
  MAX_BACKGROUND_BYTES,
  MAX_LAYOUT_ELEMENTS,
  backgroundFitNotice,
  buildLayoutFromRows,
  defaultLayout,
  elementText,
  findPreset,
  hashBackground,
  hashLayout,
  isCertificateVariableKey,
  normalizeLayout,
  pageFormat,
  readJpegInfo,
  resolveCertificateVariables,
  selectEffectiveTemplate,
  serializeLayout,
  validateCertificateBackground,
  validateLayout,
  visibleElements,
  type CertificateBackground,
  type CertificateLayout,
  type CertificateLayoutElement,
  type CertificateVariableValues,
} from '../../src/domain/certificates/certificate-layout-rules';

// ── Fixtures ───────────────────────────────────────────────────────────────────
const BACKGROUND: CertificateBackground = {
  objectKey: 'tenants/t/artes/fundo.jpg',
  checksum: 'a'.repeat(64),
  widthPx: 3508,
  heightPx: 2480,
  orientation: 1,
  colorComponents: 3,
  sizeBytes: 512_000,
  fit: 'COVER',
};

function element(partial: Partial<CertificateLayoutElement> & { id: string }): CertificateLayoutElement {
  return {
    kind: 'TEXT',
    xMm: 20,
    yMm: 20,
    widthMm: 100,
    heightMm: 10,
    align: 'LEFT',
    font: 'HELVETICA',
    sizePt: 12,
    color: '#111827',
    lineHeight: 1.4,
    text: 'Texto',
    variable: null,
    ...partial,
  };
}

/** O mínimo que a validação aceita: o bloco probatório e nada mais. */
function probatoryElements(): CertificateLayoutElement[] {
  return [
    element({ id: 'codigo', kind: 'VARIABLE', variable: 'codigo_validacao' }),
    element({ id: 'url', kind: 'VARIABLE', variable: 'url_validacao' }),
    element({ id: 'qr', kind: 'QR', text: null, widthMm: 30, heightMm: 30 }),
  ];
}

function layoutOf(
  elements: CertificateLayoutElement[],
  background: CertificateBackground | null = null,
): CertificateLayout {
  return { page: 'A4_LANDSCAPE', background, elements };
}

const VALUES: CertificateVariableValues = resolveCertificateVariables({
  recipientName: 'Ana Souza',
  title: 'Certificado de conclusão de minicurso',
  bodyText: 'Certificamos que Ana Souza concluiu o minicurso.',
  eventTitle: 'Congresso 2026',
  activityTitle: '',
  workloadLabel: '4 horas',
  period: '',
  issuedAtLabel: '20/03/2026',
  tenantName: 'UFBA',
  validationCode: 'CERT-7KQ4M2XP',
  validationUrl: 'https://eventflow.test/validar/CERT-7KQ4M2XP',
  contentHash: 'b'.repeat(64),
  signature: 'assinatura',
  keyId: 'cert-2026-01',
});

// ── Fixture de JPEG: bytes de verdade, montados marcador por marcador ──────────
function buildJpeg(input: {
  width: number;
  height: number;
  components?: number;
  progressive?: boolean;
  orientation?: number;
}): Uint8Array {
  const components = input.components ?? 3;
  const bytes: number[] = [0xff, 0xd8];

  // APP0 JFIF
  bytes.push(0xff, 0xe0, 0x00, 0x10);
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  if (input.orientation && input.orientation !== 1) {
    // APP1 Exif com a orientação (0x0112) na IFD0.
    const payload: number[] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    payload.push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00); // "II", 42, offset 8
    payload.push(0x01, 0x00); // 1 entrada
    payload.push(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00); // tag 0x0112, SHORT, count 1
    payload.push(input.orientation, 0x00, 0x00, 0x00); // valor + padding
    payload.push(0x00, 0x00, 0x00, 0x00); // próxima IFD

    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  }

  const sofLength = 8 + components * 3;
  bytes.push(0xff, input.progressive ? 0xc2 : 0xc0, (sofLength >> 8) & 0xff, sofLength & 0xff);
  bytes.push(0x08);
  bytes.push((input.height >> 8) & 0xff, input.height & 0xff);
  bytes.push((input.width >> 8) & 0xff, input.width & 0xff);
  bytes.push(components);
  for (let index = 0; index < components; index += 1) {
    bytes.push(index + 1, 0x11, 0x00);
  }

  // SOS + um byte de "dados" + EOI
  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00);
  bytes.push(0xff, 0xd9);

  return Uint8Array.from(bytes);
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('catálogo de variáveis', () => {
  it('toda variável tem rótulo, fonte declarada e exemplo', () => {
    for (const variable of CERTIFICATE_VARIABLES) {
      expect(variable.label.length, variable.key).toBeGreaterThan(3);
      expect(variable.source.length, variable.key).toBeGreaterThan(3);
      expect(variable.sample.length, variable.key).toBeGreaterThan(0);
    }
  });

  it('não oferece CPF nem título da apresentação — não há fonte para eles', () => {
    const keys = CERTIFICATE_VARIABLES.map((variable) => variable.key);
    expect(keys).not.toContain('cpf');
    expect(keys).not.toContain('titulo_apresentacao');
  });

  it('reconhece chave conhecida e recusa a desconhecida', () => {
    expect(isCertificateVariableKey('nome')).toBe(true);
    expect(isCertificateVariableKey('cpf')).toBe(false);
  });

  it('resolve todas as chaves do catálogo', () => {
    for (const variable of CERTIFICATE_VARIABLES) {
      expect(VALUES[variable.key], variable.key).toBeTypeOf('string');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('modelos prontos', () => {
  it('são cinco, com identificador, nome e descrição', () => {
    expect(CERTIFICATE_TEMPLATE_PRESETS).toHaveLength(5);
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      expect(preset.id).toMatch(/^[a-z-]+$/);
      expect(preset.name.length).toBeGreaterThan(3);
      expect(preset.description.length).toBeGreaterThan(20);
    }
  });

  it('TODO modelo pronto passa na validação — modelo que a própria casa recusa é defeito', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      const verdict = validateLayout(preset.layout);
      expect(verdict.ok, `${preset.id}: ${verdict.ok ? '' : JSON.stringify(verdict.issues)}`).toBe(true);
    }
  });

  it('nenhum modelo pronto traz arte: a arte é da instituição', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      expect(preset.layout.background).toBeNull();
    }
  });

  it('todos deixam o topo livre para o logotipo da arte (nada acima de 40 mm)', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      const topmost = Math.min(...preset.layout.elements.map((item) => item.yMm));
      expect(topmost, preset.id).toBeGreaterThanOrEqual(40);
    }
  });

  it('todos trazem o bloco probatório completo', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      const variables = preset.layout.elements.map((item) => item.variable);
      expect(preset.layout.elements.some((item) => item.kind === 'QR'), preset.id).toBe(true);
      expect(variables, preset.id).toContain('codigo_validacao');
      expect(variables, preset.id).toContain('url_validacao');
    }
  });

  it('encontra por identificador e devolve null quando não existe', () => {
    expect(findPreset('diploma')?.name).toBe('Diploma');
    expect(findPreset('nao-existe')).toBeNull();
  });

  it('o layout padrão é o primeiro modelo pronto, com o mesmo desenho', () => {
    expect(serializeLayout(defaultLayout())).toBe(serializeLayout(CERTIFICATE_TEMPLATE_PRESETS[0].layout));
  });

  it('cada modelo tem identificadores únicos dentro dele', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      const ids = preset.layout.elements.map((item) => item.id);
      expect(new Set(ids).size, preset.id).toBe(ids.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validação do layout', () => {
  it('aceita o mínimo probatório', () => {
    expect(validateLayout(layoutOf(probatoryElements())).ok).toBe(true);
  });

  it('recusa layout sem elemento nenhum', () => {
    const verdict = validateLayout(layoutOf([]));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toContain('NO_ELEMENTS');
  });

  it('recusa acima do teto de elementos', () => {
    const many = Array.from({ length: MAX_LAYOUT_ELEMENTS + 1 }, (_, index) =>
      element({ id: `e${index}` }),
    );
    const verdict = validateLayout(layoutOf(many));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toContain('TOO_MANY_ELEMENTS');
  });

  it('recusa identificador repetido', () => {
    const verdict = validateLayout(
      layoutOf([...probatoryElements(), element({ id: 'codigo', text: 'outro' })]),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toContain('DUPLICATE_ELEMENT_ID');
  });

  it('recusa elemento que sai da página, com os números na mensagem', () => {
    const verdict = validateLayout(
      layoutOf([...probatoryElements(), element({ id: 'fora', xMm: 250, widthMm: 60 })]),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      const issue = verdict.issues.find((item) => item.code === 'OUT_OF_PAGE');
      expect(issue?.message).toContain('310');
      expect(issue?.message).toContain('297');
    }
  });

  it('aceita o elemento encostado na borda (arredondamento não é defeito)', () => {
    const verdict = validateLayout(
      layoutOf([...probatoryElements(), element({ id: 'borda', xMm: 197, widthMm: 99.995 })]),
    );
    expect(verdict.ok).toBe(true);
  });

  it('recusa elemento pequeno demais', () => {
    const verdict = validateLayout(layoutOf([...probatoryElements(), element({ id: 'p', widthMm: 4 })]));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toContain('INVALID_BOX');
  });

  it('recusa corpo fora da faixa e cor fora de #rrggbb', () => {
    const small = validateLayout(layoutOf([...probatoryElements(), element({ id: 'a', sizePt: 3 })]));
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.issues.map((issue) => issue.code)).toContain('INVALID_FONT_SIZE');

    const color = validateLayout(layoutOf([...probatoryElements(), element({ id: 'b', color: 'azul' })]));
    expect(color.ok).toBe(false);
    if (!color.ok) expect(color.issues.map((issue) => issue.code)).toContain('INVALID_COLOR');
  });

  it('recusa variável desconhecida', () => {
    const verdict = validateLayout(
      layoutOf([...probatoryElements(), element({ id: 'v', kind: 'VARIABLE', variable: null, text: null })]),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toContain('UNKNOWN_VARIABLE');
  });

  it('recusa texto fixo vazio e texto longo demais', () => {
    const vazio = validateLayout(layoutOf([...probatoryElements(), element({ id: 't', text: '   ' })]));
    expect(vazio.ok).toBe(false);
    if (!vazio.ok) expect(vazio.issues.map((issue) => issue.code)).toContain('MISSING_TEXT');

    const longo = validateLayout(
      layoutOf([...probatoryElements(), element({ id: 't', text: 'a'.repeat(601) })]),
    );
    expect(longo.ok).toBe(false);
    if (!longo.ok) expect(longo.issues.map((issue) => issue.code)).toContain('TEXT_TOO_LONG');
  });

  it('recusa o layout SEM QR Code — o certificado não seria validável', () => {
    const semQr = probatoryElements().filter((item) => item.kind !== 'QR');
    const verdict = validateLayout(layoutOf(semQr));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      const issue = verdict.issues.find((item) => item.code === 'MISSING_VALIDATION_BLOCK');
      expect(issue?.message).toContain('QR Code');
    }
  });

  it('recusa o layout SEM o código ou SEM o endereço de validação', () => {
    for (const missing of ['codigo_validacao', 'url_validacao'] as const) {
      const elements = probatoryElements().filter((item) => item.variable !== missing);
      const verdict = validateLayout(layoutOf(elements));
      expect(verdict.ok, missing).toBe(false);
    }
  });

  it('recusa arte com impressão inválida e aceita a arte coerente', () => {
    const bad = validateLayout(
      layoutOf(probatoryElements(), { ...BACKGROUND, checksum: 'curto' }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((issue) => issue.code)).toContain('INVALID_BACKGROUND');

    expect(validateLayout(layoutOf(probatoryElements(), BACKGROUND)).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('normalização e hash do layout', () => {
  it('arredonda milímetros e normaliza a cor para minúsculas', () => {
    const normalized = normalizeLayout(
      layoutOf([element({ id: 'a', xMm: 20.123456, color: '#AABBCC', sizePt: 12.345 })]),
    );
    expect(normalized.elements[0]?.xMm).toBe(20.12);
    expect(normalized.elements[0]?.color).toBe('#aabbcc');
    expect(normalized.elements[0]?.sizePt).toBe(12.35);
  });

  it('a serialização não depende da ORDEM em que as chaves foram montadas', () => {
    const a = layoutOf([element({ id: 'a', text: 'X' })]);
    const b: CertificateLayout = {
      page: 'A4_LANDSCAPE',
      background: null,
      elements: [
        {
          variable: null,
          text: 'X',
          lineHeight: 1.4,
          color: '#111827',
          sizePt: 12,
          font: 'HELVETICA',
          align: 'LEFT',
          heightMm: 10,
          widthMm: 100,
          yMm: 20,
          xMm: 20,
          kind: 'TEXT',
          id: 'a',
        },
      ],
    };
    expect(serializeLayout(a)).toBe(serializeLayout(b));
    expect(hashLayout(a)).toBe(hashLayout(b));
  });

  it('mover um elemento muda o hash do documento', () => {
    const before = hashLayout(layoutOf([element({ id: 'a', xMm: 20 })]));
    const after = hashLayout(layoutOf([element({ id: 'a', xMm: 21 })]));
    expect(before).not.toBe(after);
  });

  it('trocar a arte muda o hash do documento', () => {
    const semArte = hashLayout(layoutOf(probatoryElements()));
    const comArte = hashLayout(layoutOf(probatoryElements(), BACKGROUND));
    const outraArte = hashLayout(
      layoutOf(probatoryElements(), { ...BACKGROUND, checksum: 'c'.repeat(64) }),
    );
    expect(semArte).not.toBe(comArte);
    expect(comArte).not.toBe(outraArte);
  });

  it('normalizar duas vezes não muda mais nada (o hash é estável)', () => {
    const once = normalizeLayout(layoutOf(probatoryElements(), BACKGROUND));
    expect(serializeLayout(normalizeLayout(once))).toBe(serializeLayout(once));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('montagem a partir das linhas do formulário (envio sem JavaScript)', () => {
  const rows = (overrides: Partial<Parameters<typeof buildLayoutFromRows>[0]> = {}) => ({
    page: 'A4_LANDSCAPE' as const,
    background: null,
    ids: ['codigo', 'url', 'qr'],
    kinds: ['VARIABLE', 'VARIABLE', 'QR'],
    texts: ['', '', ''],
    variables: ['codigo_validacao', 'url_validacao', ''],
    xMm: ['20', '20', '240'],
    yMm: ['170', '180', '160'],
    widthMm: ['70', '90', '34'],
    heightMm: ['8', '6', '34'],
    aligns: ['LEFT', 'LEFT', 'CENTER'],
    fonts: ['HELVETICA', 'HELVETICA', 'HELVETICA'],
    sizePt: ['11', '8', '10'],
    colors: ['#111827', '#111827', '#111827'],
    lineHeights: ['1.4', '1.4', '1.4'],
    ...overrides,
  });

  it('descarta a linha em branco que o formulário manda a mais', () => {
    const layout = buildLayoutFromRows(
      rows({
        ids: ['codigo', 'url', 'qr', ''],
        kinds: ['VARIABLE', 'VARIABLE', 'QR', 'TEXT'],
        texts: ['', '', '', '   '],
      }),
    );
    expect(layout.elements).toHaveLength(3);
  });

  it('deriva identificador quando a linha vem sem ele, e desempata repetido', () => {
    const layout = buildLayoutFromRows(
      rows({
        ids: ['', 'codigo', 'codigo'],
        kinds: ['VARIABLE', 'VARIABLE', 'QR'],
        variables: ['codigo_validacao', 'url_validacao', ''],
      }),
    );
    const ids = layout.elements.map((item) => item.id);
    expect(ids[0]).toBe('elemento-1');
    expect(new Set(ids).size).toBe(3);
  });

  it('aceita vírgula como separador decimal (o formulário é digitado por gente)', () => {
    const layout = buildLayoutFromRows(rows({ xMm: ['20,5', '20', '240'] }));
    expect(layout.elements[0]?.xMm).toBe(20.5);
  });

  it('valor inválido cai no padrão em vez de virar NaN', () => {
    const layout = buildLayoutFromRows(
      rows({ xMm: ['abc', '20', '240'], sizePt: ['', '8', '10'], aligns: ['DIAGONAL', 'LEFT', 'CENTER'] }),
    );
    expect(layout.elements[0]?.xMm).toBe(20);
    expect(layout.elements[0]?.sizePt).toBe(12);
    expect(layout.elements[0]?.align).toBe('LEFT');
  });

  it('variável desconhecida não vira elemento (é descartada antes de gravar)', () => {
    const layout = buildLayoutFromRows(rows({ variables: ['cpf', 'url_validacao', ''] }));
    expect(layout.elements.map((item) => item.variable)).not.toContain('cpf');
  });

  it('o layout montado a partir das linhas passa na validação', () => {
    expect(validateLayout(buildLayoutFromRows(rows())).ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('elementos visíveis e texto resolvido', () => {
  const withEmptyVariable = layoutOf([
    ...probatoryElements(),
    element({ id: 'atividade', kind: 'VARIABLE', variable: 'atividade', text: null }),
    element({ id: 'fixo', text: 'Portaria nº 12/2026' }),
  ]);

  it('variável SEM valor desaparece da página', () => {
    const visible = visibleElements(withEmptyVariable, VALUES);
    expect(visible.map((item) => item.id)).not.toContain('atividade');
  });

  it('texto fixo e QR continuam, e a variável preenchida aparece', () => {
    const visible = visibleElements(withEmptyVariable, { ...VALUES, atividade: 'Rust' });
    const ids = visible.map((item) => item.id);
    expect(ids).toContain('fixo');
    expect(ids).toContain('qr');
    expect(ids).toContain('atividade');
  });

  it('variável só com espaços também desaparece', () => {
    const visible = visibleElements(withEmptyVariable, { ...VALUES, atividade: '   ' });
    expect(visible.map((item) => item.id)).not.toContain('atividade');
  });

  it('elementoText devolve o valor da variável, o texto fixo e null no QR', () => {
    expect(elementText(element({ id: 'n', kind: 'VARIABLE', variable: 'nome' }), VALUES)).toBe('Ana Souza');
    expect(elementText(element({ id: 't', text: 'Fixo' }), VALUES)).toBe('Fixo');
    expect(elementText(element({ id: 'q', kind: 'QR', text: null }), VALUES)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('leitura do JPEG', () => {
  it('lê medidas e componentes de um JPEG baseline', () => {
    const result = readJpegInfo(buildJpeg({ width: 3508, height: 2480 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.widthPx).toBe(3508);
      expect(result.info.heightPx).toBe(2480);
      expect(result.info.components).toBe(3);
      expect(result.info.progressive).toBe(false);
      expect(result.info.orientation).toBe(1);
    }
  });

  it('lê a orientação EXIF quando o arquivo traz', () => {
    const result = readJpegInfo(buildJpeg({ width: 2480, height: 3508, orientation: 6 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.info.orientation).toBe(6);
  });

  it('reconhece JPEG progressivo', () => {
    const result = readJpegInfo(buildJpeg({ width: 1000, height: 1000, progressive: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.info.progressive).toBe(true);
  });

  it('recusa arquivo que não é JPEG', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = readJpegInfo(png);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('NOT_JPEG');
  });

  it('recusa arquivo cortado antes das medidas', () => {
    const full = buildJpeg({ width: 3508, height: 2480 });
    const truncated = full.slice(0, 8);
    const result = readJpegInfo(truncated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('BACKGROUND_TRUNCATED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('aceitação da arte de fundo', () => {
  const page = 'A4_LANDSCAPE' as const;

  it('aceita JPEG RGB na resolução da página e devolve a impressão do arquivo', () => {
    const bytes = buildJpeg({ width: 3508, height: 2480 });
    const result = validateCertificateBackground({ bytes, page });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checksum).toBe(hashBackground(bytes));
      expect(result.sizeBytes).toBe(bytes.length);
    }
  });

  it('ACEITA arte girada por EXIF com resolução suficiente (a orientação troca os lados)', () => {
    /**
     * 1600 × 2200 em A4 paisagem dá 137 dpi na largura — abaixo do mínimo. Girada
     * pela orientação 6, a MESMA imagem é desenhada como 2200 × 1600 e passa (188 dpi).
     */
    const bytes = buildJpeg({ width: 1600, height: 2200, orientation: 6 });
    expect(validateCertificateBackground({ bytes, page }).ok).toBe(true);

    const semExif = buildJpeg({ width: 1600, height: 2200 });
    const result = validateCertificateBackground({ bytes: semExif, page });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('BACKGROUND_TOO_SMALL');
  });

  it('recusa CMYK em vez de converter as cores da instituição', () => {
    const bytes = buildJpeg({ width: 3508, height: 2480, components: 4 });
    const result = validateCertificateBackground({ bytes, page });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((item) => item.code === 'JPEG_CMYK');
      expect(issue?.message).toContain('RGB');
    }
  });

  it('recusa JPEG progressivo com o caminho da correção na mensagem', () => {
    const bytes = buildJpeg({ width: 3508, height: 2480, progressive: true });
    const result = validateCertificateBackground({ bytes, page });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('JPEG_PROGRESSIVE');
  });

  it('recusa arte pequena demais, dizendo o mínimo em pixels', () => {
    const bytes = buildJpeg({ width: 800, height: 600 });
    const result = validateCertificateBackground({ bytes, page });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.issues.find((item) => item.code === 'BACKGROUND_TOO_SMALL');
      expect(issue?.message).toContain('1754');
      expect(issue?.message).toContain('150');
    }
  });

  it('recusa arquivo acima do teto de bytes antes de tentar ler', () => {
    // Não vale alocar 20 MB em teste: a checagem de tamanho usa só `length`.
    const huge = { length: MAX_BACKGROUND_BYTES + 1 } as unknown as Uint8Array;
    const result = validateCertificateBackground({ bytes: huge, page });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain('BACKGROUND_TOO_LARGE');
  });

  it('recusa arquivo vazio', () => {
    const result = validateCertificateBackground({ bytes: new Uint8Array(0), page });
    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('aviso de recorte da arte', () => {
  it('não avisa quando a arte tem a proporção da página', () => {
    expect(backgroundFitNotice(BACKGROUND, 'A4_LANDSCAPE')).toBeNull();
  });

  it('avisa as laterais e o topo/rodapé conforme a proporção', () => {
    const larga = backgroundFitNotice({ ...BACKGROUND, widthPx: 6000, heightPx: 2000 }, 'A4_LANDSCAPE');
    expect(larga).toContain('laterais');

    const alta = backgroundFitNotice({ ...BACKGROUND, widthPx: 2000, heightPx: 6000 }, 'A4_LANDSCAPE');
    expect(alta).toContain('topo e o rodapé');
  });

  it('não avisa no ajuste ESTICAR (a decisão foi do organizador)', () => {
    expect(backgroundFitNotice({ ...BACKGROUND, widthPx: 6000, heightPx: 2000, fit: 'STRETCH' }, 'A4_LANDSCAPE')).toBeNull();
  });

  it('mede com os lados TROCADOS quando o EXIF gira a arte', () => {
    const girada = { ...BACKGROUND, widthPx: 2480, heightPx: 3508, orientation: 6 };
    expect(backgroundFitNotice(girada, 'A4_LANDSCAPE')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('geometria da página', () => {
  it('as duas páginas são A4 nas duas orientações', () => {
    expect(pageFormat('A4_LANDSCAPE')).toEqual({ widthMm: 297, heightMm: 210 });
    expect(pageFormat('A4_PORTRAIT')).toEqual({ widthMm: 210, heightMm: 297 });
  });

  it('o certificado padrão do projeto é A4 paisagem', () => {
    expect(defaultLayout().page).toBe('A4_LANDSCAPE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('qual modelo vale para o certificado', () => {
  const candidates = [
    { id: 'instituicao', eventId: null, kind: null },
    { id: 'instituicao-minicurso', eventId: null, kind: 'MINI_COURSE' },
    { id: 'evento', eventId: 'evento-1', kind: null },
    { id: 'evento-minicurso', eventId: 'evento-1', kind: 'MINI_COURSE' },
    { id: 'outro-evento', eventId: 'evento-2', kind: null },
  ];

  it('o alvo mais específico ganha: EVENTO+TIPO', () => {
    expect(selectEffectiveTemplate(candidates, { eventId: 'evento-1', kind: 'MINI_COURSE' })?.id).toBe(
      'evento-minicurso',
    );
  });

  it('sem modelo do tipo, vale o do EVENTO', () => {
    expect(selectEffectiveTemplate(candidates, { eventId: 'evento-1', kind: 'SPEAKER' })?.id).toBe('evento');
  });

  it('sem modelo do evento, vale o da INSTITUIÇÃO para o tipo', () => {
    expect(selectEffectiveTemplate(candidates, { eventId: 'evento-9', kind: 'MINI_COURSE' })?.id).toBe(
      'instituicao-minicurso',
    );
  });

  it('sem nada específico, vale o da INSTITUIÇÃO', () => {
    expect(selectEffectiveTemplate(candidates, { eventId: 'evento-9', kind: 'SPEAKER' })?.id).toBe('instituicao');
  });

  it('modelo de OUTRO evento é ignorado, mesmo sendo mais específico no tipo', () => {
    const apenasOutro = candidates.filter((candidate) => candidate.id !== 'instituicao');
    expect(selectEffectiveTemplate(apenasOutro, { eventId: 'evento-9', kind: 'SPEAKER' })).toBeNull();
  });

  it('sem candidato nenhum devolve null (o chamador usa o padrão do código)', () => {
    expect(selectEffectiveTemplate([], { eventId: 'evento-1', kind: 'SPEAKER' })).toBeNull();
  });

  it('a lista vazia de modelos da instituição cai no padrão, e não em erro', () => {
    expect(selectEffectiveTemplate([{ id: 'x', eventId: 'outro', kind: 'SPEAKER' }], { eventId: 'e', kind: 'SPEAKER' })).toBeNull();
  });
});

/** Um teste de fumaça do tipo usado pelo documento: nada aqui pode lançar. */
describe('robustez da leitura', () => {
  it('não lança com bytes aleatórios', () => {
    for (const size of [1, 2, 3, 5, 9, 64]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 37) % 256);
      expect(() => readJpegInfo(bytes)).not.toThrow();
    }
  });
});
