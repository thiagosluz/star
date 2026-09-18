/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — EDITOR da landing page (FASE 17, item E3)
 *
 *  O foco aqui é o que separa um editor de um formulário que mente:
 *    • conteúdo de bloco é validado POR TIPO (e o inválido é recusado);
 *    • a ordem é reescrita de forma idempotente (subir/descer sempre visível);
 *    • o resumo diz quando um bloco está vazio — porque vazio não aparece na página.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK_DESCRIPTIONS,
  BLOCK_LABELS,
  BLOCK_ORDER_STEP,
  BLOCK_WITHOUT_RENDERER,
  DEFAULT_BLOCK_CONTENT,
  MAX_BLOCK_TEXT_LENGTH,
  MAX_FAQ_ITEMS,
  MAX_GALLERY_IMAGES,
  MAX_PAGE_BLOCKS,
  PAGE_BLOCK_TYPES,
  assignDisplayOrder,
  blockContentSchemas,
  moveBlockId,
  orderBlockIds,
  summarizeBlockContent,
  validateBlockContent,
  type PageBlockType,
} from '../../src/domain/events/landing-page';

// ═══════════════════════════════════════════════════════════════════════════════
describe('contrato do editor', () => {
  it('todo tipo de bloco tem schema, descrição e conteúdo inicial', () => {
    for (const type of PAGE_BLOCK_TYPES) {
      expect(blockContentSchemas[type], `sem schema: ${type}`).toBeDefined();
      expect(BLOCK_DESCRIPTIONS[type], `sem descrição: ${type}`).toBeTruthy();
      expect(DEFAULT_BLOCK_CONTENT[type], `sem conteúdo inicial: ${type}`).toBeDefined();
    }
  });

  it('o conteúdo inicial de TODO bloco passa na própria validação', () => {
    /**
     * Este é o teste que impede o defeito mais irritante possível: adicionar um
     * bloco e não conseguir salvá-lo sem preencher nada. Se o conteúdo inicial não
     * valida, "adicionar bloco" nasce quebrado.
     */
    for (const type of PAGE_BLOCK_TYPES) {
      const result = validateBlockContent(type, DEFAULT_BLOCK_CONTENT[type]);
      expect(result.ok, `conteúdo inicial inválido em ${type}`).toBe(true);
    }
  });

  it('só o HERO é declarado sem renderizador — e o editor avisa', () => {
    expect([...BLOCK_WITHOUT_RENDERER]).toEqual(['HERO']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validateBlockContent()', () => {
  it('aceita texto e normaliza espaços', () => {
    const result = validateBlockContent('RICH_TEXT', { title: '  Sobre  ', body: '  Um texto.  ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.title).toBe('Sobre');
      expect(result.content.body).toBe('Um texto.');
    }
  });

  it('REJEITA conteúdo acima do limite — o bloco não pode virar um despejo', () => {
    const result = validateBlockContent('RICH_TEXT', {
      body: 'a'.repeat(MAX_BLOCK_TEXT_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('body');
  });

  it('aceita lista vazia (bloco recém-criado) mas recusa item pela metade', () => {
    expect(validateBlockContent('FAQ', { items: [] }).ok).toBe(true);

    const half = validateBlockContent('FAQ', {
      items: [{ question: 'Onde é?', answer: '' }],
    });
    expect(half.ok).toBe(false);
    if (!half.ok) expect(half.errors.join(' ')).toMatch(/answer|answer/i);
  });

  it('DESCARTA linhas totalmente vazias antes de validar', () => {
    /**
     * O formulário envia todas as linhas que estão na tela, inclusive as que o
     * organizador acabou de adicionar e não preencheu. Descartar é o que separa
     * "não preenchi esta" de "preenchi pela metade".
     */
    const result = validateBlockContent('FAQ', {
      items: [
        { question: 'Vale certificado?', answer: 'Sim.' },
        { question: '', answer: '' },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect((result.content.items as unknown[]).length).toBe(1);
  });

  it('recusa URL de imagem que não seja http(s) — XSS por protocolo', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>x</script>', '#local']) {
      const result = validateBlockContent('GALLERY', { images: [{ url }] });
      expect(result.ok, `deveria recusar ${url}`).toBe(false);
    }
  });

  it('respeita os limites de itens das listas', () => {
    const faq = validateBlockContent('FAQ', {
      items: Array.from({ length: MAX_FAQ_ITEMS + 1 }, (_, i) => ({
        question: `P${i}`,
        answer: `R${i}`,
      })),
    });
    expect(faq.ok).toBe(false);

    const gallery = validateBlockContent('GALLERY', {
      images: Array.from({ length: MAX_GALLERY_IMAGES + 1 }, (_, i) => ({
        url: `https://cdn.test/${i}.jpg`,
      })),
    });
    expect(gallery.ok).toBe(false);
  });

  it('recusa identificador de cota que não é UUID no bloco de patrocinadores', () => {
    expect(validateBlockContent('SPONSORS', { tierId: 'ouro' }).ok).toBe(false);
    expect(
      validateBlockContent('SPONSORS', { tierId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }).ok,
    ).toBe(true);
  });

  it('CUSTOM_HTML aceita markup como TEXTO — não há campo para HTML cru', () => {
    const result = validateBlockContent('CUSTOM_HTML', {
      html: '<script>alert(1)</script>',
    });
    expect(result.ok).toBe(true);
    // O conteúdo é aceito como string; quem garante que não vira HTML é o renderizador
    // (renderizado em `<pre>`), e o teste disso está no componente.
  });

  it('um objeto desconhecido não passa como conteúdo de bloco', () => {
    expect(validateBlockContent('RICH_TEXT', 42).ok).toBe(false);
    expect(validateBlockContent('GALLERY', { images: 'nao-e-lista' }).ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('ordem dos blocos', () => {
  const blocks = [
    { id: 'c', displayOrder: 20 },
    { id: 'a', displayOrder: 0 },
    { id: 'b', displayOrder: 10 },
  ];

  it('ordena como a renderização pública ordena', () => {
    expect(orderBlockIds(blocks)).toEqual(['a', 'b', 'c']);
  });

  it('desempata por id — ordem estável entre requisições', () => {
    expect(
      orderBlockIds([
        { id: 'z', displayOrder: 5 },
        { id: 'a', displayOrder: 5 },
      ]),
    ).toEqual(['a', 'z']);
  });

  it('sobe e desce uma posição', () => {
    const order = ['a', 'b', 'c'];
    expect(moveBlockId(order, 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(moveBlockId(order, 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('nas pontas não muda nada — e não é erro', () => {
    const order = ['a', 'b', 'c'];
    expect(moveBlockId(order, 'a', 'up')).toEqual(order);
    expect(moveBlockId(order, 'c', 'down')).toEqual(order);
    expect(moveBlockId(order, 'inexistente', 'up')).toEqual(order);
  });

  it('não muta a lista recebida', () => {
    const order = ['a', 'b'];
    moveBlockId(order, 'a', 'down');
    expect(order).toEqual(['a', 'b']);
  });

  it('resolve o empate: reescrever a ordem sempre produz efeito visível', () => {
    /**
     * Dois blocos com a MESMA `displayOrder` (dado antigo). Trocar os dois valores
     * seria um no-op — e o organizador clicaria de novo achando que travou. Como a
     * ordem é reescrita inteira, o resultado é sempre o esperado.
     */
    const tied = [
      { id: 'a', displayOrder: 0 },
      { id: 'b', displayOrder: 0 },
    ];

    const before = orderBlockIds(tied);
    const after = moveBlockId(before, 'b', 'up');
    expect(before).toEqual(['a', 'b']);
    expect(after).toEqual(['b', 'a']);
  });

  it('atribui displayOrder com passo, deixando espaço para inserir no meio', () => {
    expect(assignDisplayOrder(['a', 'b', 'c'])).toEqual([
      { id: 'a', displayOrder: 0 },
      { id: 'b', displayOrder: BLOCK_ORDER_STEP },
      { id: 'c', displayOrder: BLOCK_ORDER_STEP * 2 },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('summarizeBlockContent()', () => {
  it('diz explicitamente quando o bloco está vazio (não aparece na página)', () => {
    expect(summarizeBlockContent('RICH_TEXT', { body: '' })).toContain('não aparece');
    expect(summarizeBlockContent('CUSTOM_HTML', { html: '  ' })).toContain('não aparece');
  });

  it('conta itens das listas', () => {
    expect(
      summarizeBlockContent('FAQ', { items: [{ question: 'a', answer: 'b' }] }),
    ).toBe('1 pergunta(s)');
    expect(
      summarizeBlockContent('GALLERY', { images: [{ url: 'https://x.test/a.png' }] }),
    ).toBe('1 imagem(ns)');
    expect(summarizeBlockContent('FAQ', { items: [] })).toBe('nenhuma pergunta ainda');
  });

  it('descreve o bloco de dados mesmo sem conteúdo próprio', () => {
    expect(summarizeBlockContent('SCHEDULE', {})).toMatch(/agenda/i);
    expect(summarizeBlockContent('VENUE_MAP', {})).toMatch(/local/i);
    expect(summarizeBlockContent('SPONSORS', {})).toMatch(/patrocinadores/i);
  });

  it('resiste a conteúdo de formato inesperado', () => {
    expect(() => summarizeBlockContent('FAQ', null)).not.toThrow();
    expect(() => summarizeBlockContent('RICH_TEXT', 'texto')).not.toThrow();
    expect(summarizeBlockContent('FAQ', 'texto')).toBe('nenhuma pergunta ainda');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rótulos e teto', () => {
  it('todo tipo tem rótulo em pt-BR distinto', () => {
    const labels = PAGE_BLOCK_TYPES.map((type) => BLOCK_LABELS[type as PageBlockType]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('o teto de blocos é um número sensato', () => {
    expect(MAX_PAGE_BLOCKS).toBeGreaterThanOrEqual(10);
    expect(MAX_PAGE_BLOCKS).toBeLessThanOrEqual(100);
  });
});
