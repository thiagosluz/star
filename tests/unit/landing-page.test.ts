/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — tema e blocos da landing page
 *
 *  O foco aqui é SEGURANÇA: o conteúdo do tema e dos blocos é escrito pelo
 *  organizador e renderizado na página pública. Um valor malicioso aqui é XSS
 *  armazenado atingindo todos os visitantes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK_LABELS,
  DEFAULT_THEME,
  PAGE_BLOCK_TYPES,
  RECOMMENDED_BLOCK_ORDER,
  SANDBOXED_BLOCK_TYPES,
  buildEventMetadata,
  colorSchema,
  resolveTheme,
  selectRenderableBlocks,
  themeToCssVariables,
  themeToStyleString,
  type PageBlock,
  type PageBlockType,
} from '../../src/domain/events/landing-page';

// ═══════════════════════════════════════════════════════════════════════════════
describe('colorSchema — allowlist de formato', () => {
  it('aceita hexadecimal de 3, 6 e 8 dígitos', () => {
    for (const color of ['#fff', '#ffffff', '#FF00AA', '#ffffffcc']) {
      expect(colorSchema.safeParse(color).success).toBe(true);
    }
  });

  it('aceita oklch()', () => {
    expect(colorSchema.safeParse('oklch(0.55 0.2 265)').success).toBe(true);
  });

  it('REJEITA qualquer valor que possa escapar do contexto CSS', () => {
    // Estes são os vetores reais de injeção em custom properties.
    const attacks = [
      'red; background-image: url(//evil.test/x)',
      '#fff} body{display:none}',
      'url(javascript:alert(1))',
      'expression(alert(1))',
      'rgb(0,0,0);} .x{color:red',
      'var(--x',
      '</style><script>alert(1)</script>',
      'javascript:alert(1)',
    ];

    for (const attack of attacks) {
      expect(colorSchema.safeParse(attack).success, `deveria rejeitar: ${attack}`).toBe(false);
    }
  });

  it('rejeita nomes de cor e formatos não previstos', () => {
    for (const value of ['red', 'rgb(255,0,0)', 'hsl(0,0%,0%)', 'transparent', '']) {
      expect(colorSchema.safeParse(value).success).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolveTheme()', () => {
  it('aplica o padrão quando o tema é vazio', () => {
    const { theme, isValid } = resolveTheme({});
    expect(isValid).toBe(true);
    expect(theme.radius).toBe(DEFAULT_THEME.radius);
    expect(theme.fontFamily).toBe('inter');
    expect(theme.colorMode).toBe('light');
  });

  it('normaliza um tema completo', () => {
    const { theme, isValid } = resolveTheme({
      primaryColor: '#1d4ed8',
      radius: 20,
      fontFamily: 'serif',
      spacing: 'spacious',
      heroStyle: 'image',
      animation: 'none',
      colorMode: 'dark',
    });

    expect(isValid).toBe(true);
    expect(theme.primaryColor).toBe('#1d4ed8');
    expect(theme.radius).toBe(20);
    expect(theme.fontFamily).toBe('serif');
  });

  it('CAI NO PADRÃO em vez de lançar quando o tema é inválido', () => {
    // Uma página pública com a aparência da plataforma é melhor que um erro 500
    // na vitrine do cliente.
    const { theme, isValid } = resolveTheme({
      primaryColor: 'red; background: url(evil)',
      radius: 9_999,
    });

    expect(isValid).toBe(false);
    expect(theme).toEqual(DEFAULT_THEME);
  });

  it('trata ausência de tema como tema padrão válido', () => {
    // Um evento sem tema configurado é o caso NORMAL (todo evento novo nasce
    // assim). Não é configuração inválida — é ausência de configuração, e
    // resolve para o padrão sem alarme.
    for (const empty of [null, undefined]) {
      const { theme, isValid } = resolveTheme(empty);
      expect(isValid).toBe(true);
      expect(theme).toEqual(DEFAULT_THEME);
    }
  });

  it('rejeita raio fora dos limites', () => {
    expect(resolveTheme({ radius: -5 }).isValid).toBe(false);
    expect(resolveTheme({ radius: 100 }).isValid).toBe(false);
  });

  it('rejeita família de fonte fora da allowlist', () => {
    // Não aceitamos `font-family` livre: poderia carregar fonte externa.
    expect(resolveTheme({ fontFamily: 'Comic Sans MS' as never }).isValid).toBe(false);
  });

  it('rejeita URL de imagem inválida', () => {
    expect(resolveTheme({ heroImageUrl: 'javascript:alert(1)' }).isValid).toBe(false);
    expect(resolveTheme({ heroImageUrl: 'nao-e-url' }).isValid).toBe(false);
    expect(resolveTheme({ heroImageUrl: 'https://cdn.test/capa.jpg' }).isValid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('themeToCssVariables()', () => {
  it('usa o prefixo --ef- em todas as variáveis', () => {
    const vars = themeToCssVariables({
      ...DEFAULT_THEME,
      primaryColor: '#123456',
    });

    for (const key of Object.keys(vars)) {
      expect(key.startsWith('--ef-')).toBe(true);
    }
  });

  it('não emite variável para cor ausente', () => {
    const vars = themeToCssVariables(DEFAULT_THEME);
    expect(vars['--ef-primary']).toBeUndefined();
    expect(vars['--ef-radius']).toBe('12px');
  });

  it('serializa para string de estilo válida', () => {
    const style = themeToStyleString({ ...DEFAULT_THEME, primaryColor: '#000000' });
    expect(style).toContain('--ef-primary:#000000');
    expect(style).toContain('--ef-radius:12px');
    expect(style).not.toContain(';;');
  });

  it('nunca contém ponto-e-vírgula injetável vindo de cor validada', () => {
    const { theme } = resolveTheme({ primaryColor: '#abcdef' });
    const style = themeToStyleString(theme);
    // Apenas os separadores entre pares: nenhum `;` extra de valor.
    const segments = style.split(';');
    for (const segment of segments) {
      expect(segment.split(':').length).toBeLessThanOrEqual(2);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('selectRenderableBlocks()', () => {
  const block = (
    id: string,
    type: PageBlockType,
    displayOrder: number,
    isVisible = true,
  ): PageBlock => ({
    id,
    type,
    content: {},
    style: {},
    displayOrder,
    isVisible,
  });

  it('ordena por displayOrder', () => {
    const result = selectRenderableBlocks([
      block('c', 'FAQ', 3),
      block('a', 'HERO', 1),
      block('b', 'RICH_TEXT', 2),
    ]);
    expect(result.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('descarta blocos invisíveis', () => {
    const result = selectRenderableBlocks([
      block('a', 'HERO', 1),
      block('b', 'FAQ', 2, false),
    ]);
    expect(result.map((b) => b.id)).toEqual(['a']);
  });

  it('descarta tipos desconhecidos em vez de quebrar a página', () => {
    // Permite adicionar tipos novos e remover antigos sem quebrar eventos.
    const result = selectRenderableBlocks([
      block('a', 'HERO', 1),
      block('b', 'BLOCO_DO_FUTURO' as PageBlockType, 2),
    ]);
    expect(result.map((b) => b.id)).toEqual(['a']);
  });

  it('desempata por id quando displayOrder é igual (ordem estável)', () => {
    const result = selectRenderableBlocks([
      block('z', 'FAQ', 5),
      block('a', 'HERO', 5),
      block('m', 'RICH_TEXT', 5),
    ]);
    expect(result.map((b) => b.id)).toEqual(['a', 'm', 'z']);
  });

  it('não muta a lista original', () => {
    const original = [block('b', 'FAQ', 2), block('a', 'HERO', 1)];
    selectRenderableBlocks(original);
    expect(original.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('lida com lista vazia', () => {
    expect(selectRenderableBlocks([])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('contrato de blocos', () => {
  it('CUSTOM_HTML está marcado como sandboxed', () => {
    // Renderizar HTML do organizador seria XSS armazenado.
    expect(SANDBOXED_BLOCK_TYPES.has('CUSTOM_HTML')).toBe(true);
  });

  it('todo tipo de bloco tem rótulo em pt-BR', () => {
    for (const type of PAGE_BLOCK_TYPES) {
      expect(BLOCK_LABELS[type]).toBeTruthy();
    }
  });

  it('a ordem recomendada só usa tipos existentes e não repete', () => {
    const known = new Set<string>(PAGE_BLOCK_TYPES);
    for (const type of RECOMMENDED_BLOCK_ORDER) {
      expect(known.has(type)).toBe(true);
    }
    expect(new Set(RECOMMENDED_BLOCK_ORDER).size).toBe(RECOMMENDED_BLOCK_ORDER.length);
  });

  it('a ordem recomendada começa pelo hero e termina na chamada de inscrição', () => {
    expect(RECOMMENDED_BLOCK_ORDER[0]).toBe('HERO');
    expect(RECOMMENDED_BLOCK_ORDER.at(-1)).toBe('REGISTRATION_CTA');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('buildEventMetadata()', () => {
  const base = {
    title: 'Congresso de Tecnologia 2026',
    startsAt: new Date('2026-04-01T09:00:00Z'),
    endsAt: new Date('2026-04-03T18:00:00Z'),
  };

  it('usa o resumo quando presente', () => {
    const meta = buildEventMetadata({ ...base, summary: 'Três dias de imersão.' });
    expect(meta.description).toBe('Três dias de imersão.');
  });

  it('cai para o subtítulo quando não há resumo', () => {
    const meta = buildEventMetadata({ ...base, subtitle: 'Inovação e ensino.' });
    expect(meta.description).toBe('Inovação e ensino.');
  });

  it('monta descrição com data e local quando não há texto', () => {
    const meta = buildEventMetadata({
      ...base,
      venueName: 'Centro de Convenções',
      city: 'Salvador',
    });
    expect(meta.description).toContain('Congresso de Tecnologia 2026');
    expect(meta.description).toContain('Centro de Convenções');
    expect(meta.description).toContain('Salvador');
  });

  it('ignora strings só com espaços', () => {
    const meta = buildEventMetadata({ ...base, summary: '   ', subtitle: 'Válido' });
    expect(meta.description).toBe('Válido');
  });

  it('inclui imagem no Open Graph quando houver capa', () => {
    const meta = buildEventMetadata({ ...base, coverImageUrl: 'https://cdn.test/c.jpg' });
    expect(meta.openGraph.images).toEqual([{ url: 'https://cdn.test/c.jpg' }]);
  });

  it('omite imagem quando não há capa', () => {
    const meta = buildEventMetadata(base);
    expect(meta.openGraph.images).toBeUndefined();
  });
});
