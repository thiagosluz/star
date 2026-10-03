/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Blocos e rascunho × publicado da página da instituição
 *                                                            (FASE 64 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LIÇÃO DA E79, PRENDIDA POR TESTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A decisão desta fatia foi COMPOR com o editor do evento em vez de copiar a
 *  régua. Um teste que só verificasse o comportamento não protegeria a decisão: ele
 *  continuaria passando depois de alguém copiar o schema para cá. Por isso há casos
 *  que comparam a IDENTIDADE do schema (`toBe`) — se a régua for duplicada, o teste
 *  cai e a razão aparece no nome dele.
 *
 *  O resto do arquivo prende o que a página pública NÃO pode aceitar: HTML livre
 *  renderizado, URL `javascript:`, bloco de tipo que esta página não desenha e
 *  rascunho publicado por engano.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import { blockContentSchemas } from '../../src/domain/events/landing-page';
import {
  TENANT_BLOCK_LABELS,
  TENANT_DEFAULT_BLOCK_CONTENT,
  TENANT_MAX_PAGE_BLOCKS,
  TENANT_PAGE_BLOCK_TYPES,
  TENANT_SANDBOXED_BLOCK_TYPES,
  TENANT_THEME_PALETTE,
  isTenantBlockType,
  readTenantPageSnapshot,
  resolveTenantPagePublication,
  selectRenderableTenantBlocks,
  tenantBlockContentSchemas,
  tenantPageChecksum,
  validateTenantBlockContent,
  validateTenantPage,
  type TenantPageBlock,
  type TenantPageSnapshot,
} from '../../src/domain/tenancy/tenant-public-page';

function bloco(patch: Partial<TenantPageBlock> = {}): TenantPageBlock {
  return {
    id: 'bloco-1',
    type: 'RICH_TEXT',
    content: { title: 'Sobre', body: 'Texto' },
    style: {},
    displayOrder: 0,
    isVisible: true,
    ...patch,
  };
}

function pagina(patch: Partial<TenantPageSnapshot> = {}): TenantPageSnapshot {
  return {
    title: 'Instituto de Letras',
    description: 'A casa dos cursos de Letras.',
    coverImageUrl: null,
    logoUrl: null,
    theme: { primaryColor: '#0f6f8c' },
    blocks: [bloco()],
    ...patch,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A régua é COMPARTILHADA, não copiada
// ───────────────────────────────────────────────────────────────────────────────
describe('os blocos compartilhados usam o schema DO EVENTO, por identidade', () => {
  it('o schema de cada tipo compartilhado é o MESMO objeto do editor do evento', () => {
    expect(tenantBlockContentSchemas.HERO).toBe(blockContentSchemas.HERO);
    expect(tenantBlockContentSchemas.RICH_TEXT).toBe(blockContentSchemas.RICH_TEXT);
    expect(tenantBlockContentSchemas.TEAM).toBe(blockContentSchemas.TEAM);
    expect(tenantBlockContentSchemas.SPONSORS).toBe(blockContentSchemas.SPONSORS);
    expect(tenantBlockContentSchemas.FAQ).toBe(blockContentSchemas.FAQ);
    expect(tenantBlockContentSchemas.CUSTOM_HTML).toBe(blockContentSchemas.CUSTOM_HTML);
  });

  it('os tipos desta página que NÃO existem no evento têm schema próprio e todos os tipos estão cobertos', () => {
    const doEvento = new Set(Object.keys(blockContentSchemas));

    for (const tipo of TENANT_PAGE_BLOCK_TYPES) {
      expect(tenantBlockContentSchemas[tipo], `tipo ${tipo}`).toBeDefined();
      expect(TENANT_BLOCK_LABELS[tipo], `rótulo ${tipo}`).toBeTruthy();
      expect(TENANT_DEFAULT_BLOCK_CONTENT[tipo], `padrão ${tipo}`).toBeDefined();
    }

    expect(doEvento.has('ABOUT')).toBe(false);
    expect(doEvento.has('PAST_EVENTS')).toBe(false);
    expect(doEvento.has('CONTACT')).toBe(false);
  });

  it('o conteúdo compartilhado herda a NORMALIZAÇÃO do evento (linha em branco é descartada)', () => {
    /** Um tipo compartilhado passa por `validateBlockContent` do evento. */
    const resultado = validateTenantBlockContent('FAQ', {
      items: [
        { question: 'Como chego?', answer: 'De ônibus.' },
        { question: '', answer: '' },
      ],
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.content.items).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O que a página pública pode gravar
// ───────────────────────────────────────────────────────────────────────────────
describe('validação do conteúdo de um bloco', () => {
  it('bloco de texto aceita só um título e cai em vazio quando não há corpo', () => {
    const resultado = validateTenantBlockContent('RICH_TEXT', { title: 'Nossa casa' });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.content.body).toBe('');
  });

  it('URL fora de http(s) é RECUSADA — ela vira `href` na página pública', () => {
    const javascript = validateTenantBlockContent('CONTACT', {
      mapUrl: 'javascript:alert(1)',
    });
    const relativa = validateTenantBlockContent('CONTACT', { mapUrl: '/mapa' });
    const aceita = validateTenantBlockContent('CONTACT', { mapUrl: 'https://exemplo.test/mapa' });

    expect(javascript.ok).toBe(false);
    expect(relativa.ok).toBe(false);
    expect(aceita.ok).toBe(true);
  });

  it('o erro diz QUAL campo falhou, e não "conteúdo inválido"', () => {
    const resultado = validateTenantBlockContent('FAQ', {
      items: [{ question: 'Pergunta?', answer: '' }],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.errors.join(' ')).toContain('items.0.answer');
  });

  it('o bloco de HTML livre continua SANDBOXED (exibido como texto)', () => {
    expect(TENANT_SANDBOXED_BLOCK_TYPES.has('CUSTOM_HTML')).toBe(true);

    const resultado = validateTenantBlockContent('CUSTOM_HTML', { html: '<script>alert(1)</script>' });

    /** Aceito como TEXTO — quem não interpreta é o renderizador (fatia 2). */
    expect(resultado.ok).toBe(true);
  });

  it('o bloco de histórico limita a quantidade e tem padrão', () => {
    const padrao = validateTenantBlockContent('PAST_EVENTS', {});
    const exagerado = validateTenantBlockContent('PAST_EVENTS', { limit: 999 });

    expect(padrao.ok).toBe(true);
    if (padrao.ok) expect(padrao.content.limit).toBe(6);

    expect(exagerado.ok).toBe(false);
  });

  it('o bloco de contato aceita os campos de exibição', () => {
    const resultado = validateTenantBlockContent('CONTACT', {
      title: 'Fale com a gente',
      address: 'Rua das Letras, 1',
      email: 'contato@exemplo.test',
      phone: '+55 71 0000-0000',
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.content.address).toBe('Rua das Letras, 1');
  });

  it('o tipo é reconhecido pela função do domínio (a tela usa a mesma)', () => {
    expect(isTenantBlockType('ABOUT')).toBe(true);
    expect(isTenantBlockType('SCHEDULE')).toBe(false);
    expect(isTenantBlockType('')).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A página inteira
// ───────────────────────────────────────────────────────────────────────────────
describe('validação da página', () => {
  it('título é obrigatório', () => {
    const resultado = validateTenantPage({ title: '   ' });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.code).toBe('INVALID_INPUT');
  });

  it('normaliza o vazio para `null` em vez de gravar string vazia', () => {
    const resultado = validateTenantPage({ title: 'Instituto', description: '   ' });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.snapshot.description).toBeNull();
  });

  it('recusa URL de capa fora de http(s) e aceita a absoluta', () => {
    expect(validateTenantPage({ title: 'X', coverImageUrl: 'data:text/html,x' }).ok).toBe(false);

    const aceita = validateTenantPage({ title: 'X', coverImageUrl: 'https://exemplo.test/capa.webp' });
    expect(aceita.ok).toBe(true);
    if (aceita.ok) expect(aceita.snapshot.coverImageUrl).toBe('https://exemplo.test/capa.webp');
  });

  it('recusa tema com cor fora do contrato (a mesma régua do evento)', () => {
    expect(validateTenantPage({ title: 'X', theme: { primaryColor: 'azul' } }).ok).toBe(false);
    expect(validateTenantPage({ title: 'X', theme: { primaryColor: '#0f6f8c' } }).ok).toBe(true);
  });

  it('recusa tipo de bloco que esta página não desenha, dizendo QUAL bloco', () => {
    const resultado = validateTenantPage({
      title: 'X',
      blocks: [bloco(), { id: 'b2', type: 'SCHEDULE' as unknown as TenantPageBlock['type'] }],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.message).toContain('bloco 2');
  });

  it('recusa bloco inválido dizendo o número E o tipo, para o organizador achar', () => {
    const resultado = validateTenantPage({
      title: 'X',
      blocks: [{ id: 'b1', type: 'FAQ', content: { items: [{ question: 'P?', answer: '' }] } }],
    });

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;

    expect(resultado.message).toContain('Bloco 1');
    expect(resultado.message).toContain('Perguntas frequentes');
  });

  it('recusa mais blocos do que o teto da página', () => {
    const blocos = Array.from({ length: TENANT_MAX_PAGE_BLOCKS + 1 }, (_, i) => bloco({ id: `b${i}` }));
    const resultado = validateTenantPage({ title: 'X', blocks: blocos });

    expect(resultado.ok).toBe(false);
  });

  it('bloco sem id ganha um id posicional e a ordem padrão, sem perder o conteúdo', () => {
    const resultado = validateTenantPage({
      title: 'X',
      blocks: [{ type: 'ABOUT', content: { body: 'História' } }],
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;

    expect(resultado.snapshot.blocks[0]?.id).toBe('bloco-1');
    expect(resultado.snapshot.blocks[0]?.displayOrder).toBe(0);
    expect(resultado.snapshot.blocks[0]?.type).toBe('ABOUT');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Ordem e visibilidade dos blocos
// ───────────────────────────────────────────────────────────────────────────────
describe('blocos que a página desenha', () => {
  it('descarta bloco invisível, tipo desconhecido e ordena por displayOrder', () => {
    const selecionados = selectRenderableTenantBlocks([
      bloco({ id: 'b', displayOrder: 20 }),
      bloco({ id: 'a', displayOrder: 10 }),
      bloco({ id: 'oculto', displayOrder: 5, isVisible: false }),
      bloco({ id: 'estranho', displayOrder: 1, type: 'GALLERY' as unknown as TenantPageBlock['type'] }),
    ]);

    expect(selecionados.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('empate de ordem usa o id, para o layout não pular entre renders', () => {
    const selecionados = selectRenderableTenantBlocks([
      bloco({ id: 'z', displayOrder: 0 }),
      bloco({ id: 'a', displayOrder: 0 }),
    ]);

    expect(selecionados.map((item) => item.id)).toEqual(['a', 'z']);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Rascunho × publicado
// ───────────────────────────────────────────────────────────────────────────────
describe('checksum e estado de publicação', () => {
  it('o checksum é canônico: a ORDEM das chaves não muda o hash', () => {
    const primeiro = tenantPageChecksum(pagina({ theme: { primaryColor: '#0f6f8c', radius: 12 } }));
    const segundo = tenantPageChecksum(pagina({ theme: { radius: 12, primaryColor: '#0f6f8c' } }));

    expect(primeiro).toBe(segundo);
  });

  it('o checksum muda quando o conteúdo muda (é o que responde "tem alteração não publicada?")', () => {
    const original = tenantPageChecksum(pagina());
    const alterado = tenantPageChecksum(pagina({ title: 'Outro nome' }));

    expect(original).not.toBe(alterado);
  });

  it('nunca publicada é `NEVER_PUBLISHED` (o `{}` do banco não conta como versão)', () => {
    const estado = resolveTenantPagePublication({
      publishedSnapshot: {},
      publishedAt: null,
      draft: pagina(),
    });

    expect(estado.state).toBe('NEVER_PUBLISHED');
    expect(estado.isUpToDate).toBe(false);
    expect(estado.publishedAt).toBeNull();
  });

  it('publicada e sem alteração é `PUBLISHED`', () => {
    const draft = pagina();
    const estado = resolveTenantPagePublication({
      publishedSnapshot: draft,
      publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      draft,
    });

    expect(estado.state).toBe('PUBLISHED');
    expect(estado.isUpToDate).toBe(true);
  });

  it('editada DEPOIS de publicar é `CHANGES_PENDING` — o site tem a versão antiga', () => {
    const publicado = pagina();
    const draft = pagina({ description: 'Texto novo que ainda não foi ao ar.' });

    const estado = resolveTenantPagePublication({
      publishedSnapshot: publicado,
      publishedAt: new Date('2026-11-01T10:00:00.000Z'),
      draft,
    });

    expect(estado.state).toBe('CHANGES_PENDING');
    expect(estado.isUpToDate).toBe(false);
  });

  it('snapshot sem título não é uma versão publicada', () => {
    expect(readTenantPageSnapshot({})).toBeNull();
    expect(readTenantPageSnapshot(null)).toBeNull();
    expect(readTenantPageSnapshot('texto')).toBeNull();
    expect(readTenantPageSnapshot({ title: '  ' })).toBeNull();
  });

  it('a leitura do snapshot descarta bloco de tipo desconhecido em vez de quebrar a página', () => {
    const lido = readTenantPageSnapshot({
      title: 'Instituto',
      blocks: [
        { type: 'GALLERY', content: {}, displayOrder: 0, isVisible: true },
        { type: 'ABOUT', content: { body: 'História' }, displayOrder: 1, isVisible: true },
      ],
    });

    expect(lido?.blocks.map((item) => item.type)).toEqual(['ABOUT']);
  });

  it('a leitura preenche o que falta sem inventar conteúdo', () => {
    const lido = readTenantPageSnapshot({
      title: 'Instituto',
      blocks: [{ type: 'CONTACT', displayOrder: 3 }],
    });

    expect(lido?.description).toBeNull();
    expect(lido?.theme).toEqual({});
    expect(lido?.blocks[0]?.isVisible).toBe(true);
    expect(lido?.blocks[0]?.content).toEqual({});
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O tema
// ───────────────────────────────────────────────────────────────────────────────
describe('a paleta da instituição', () => {
  it('cobre os dois modos, e a marca não inverte entre eles', () => {
    expect(TENANT_THEME_PALETTE.light.primary).toBe(TENANT_THEME_PALETTE.dark.primary);
    expect(TENANT_THEME_PALETTE.light.background).not.toBe(TENANT_THEME_PALETTE.dark.background);
  });

  it('a paleta é DA INSTITUIÇÃO — não é a do evento', async () => {
    const { EVENT_THEME_PALETTE } = await import('../../src/domain/events/landing-page');

    expect(TENANT_THEME_PALETTE.light.primary).not.toBe(EVENT_THEME_PALETTE.light.primary);
  });
});
