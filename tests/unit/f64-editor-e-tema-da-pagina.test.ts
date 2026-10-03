/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O EDITOR DA PÁGINA DA INSTITUIÇÃO E O TEMA DELA
 *                                                       (FASE 64 · fatias 3 e 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DURA DA FASE, PROVADA A FRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "A paleta da instituição NÃO pode matar o claro/escuro do visitante" é uma
 *  afirmação sobre o que é PUBLICADO no escopo da página — e isso é HTML, não
 *  navegador. Aqui o mapa de papéis é chamado com os três valores do cookie
 *  (`claro`, `escuro`, `sistema`) e o resultado é inspecionado papel por papel:
 *
 *    • visitante pediu ESCURO → `--ef-background` é o fundo ESCURO da paleta;
 *    • visitante pediu CLARO  → `--ef-background` é o fundo CLARO;
 *    • visitante pediu SISTEMA → vale o modo declarado, e só aí ele decide.
 *
 *  O caso que pega a mutação é o primeiro: a implementação "óbvia" (usar o mesmo
 *  `themeToCssVariables` do evento, com o modo da instituição) produziria o fundo
 *  CLARO para quem pediu escuro — que é exatamente o defeito que esta fase proíbe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MAIS ESTES CASOS PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a marca NÃO inverte com o modo (primária/secundária/destaque iguais nos dois);
 *  • o formulário do editor NÃO oferece fundo, texto nem modo — a ausência é a
 *    decisão de produto, e um campo reintroduzido derruba o caso;
 *  • o status da publicação responde as DUAS perguntas ("está no ar?" × "o que eu
 *    salvei já está?") em frases diferentes;
 *  • o resumo de cada tipo de bloco é o do EVENTO, por referência, e os três tipos
 *    exclusivos da instituição ganham texto próprio;
 *  • a capa e o logotipo da instituição existem no catálogo canônico com teto e
 *    política de WebP — a catraca de alvo novo sem política é do `image-webp`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  TENANT_THEME_PALETTE,
  TENANT_BLOCK_WITHOUT_RENDERER,
  type TenantPageBlock,
  type TenantPageBlockType,
  type ResolvedTenantTheme,
} from '../../src/domain/tenancy/tenant-public-page';
import {
  CONTRASTE_ALVO_DO_TEXTO,
  TENANT_PALETTE_ROLES,
  buildTenantThemeScope,
  corDeTextoLegivel,
  paraRgb,
  razaoDeContraste,
  resolveTenantThemeMode,
} from '../../src/domain/tenancy/tenant-page-theme-rules';
import {
  tenantBlockRows,
  tenantBlockSummary,
  tenantBlockTypeNotice,
  tenantPageStatus,
} from '../../src/domain/tenancy/tenant-page-editor';
import {
  ASSET_TARGET_LABELS,
  ASSET_TARGETS,
  MAX_IMAGE_BYTES,
  WEBP_POLICY,
  type ImageTarget,
} from '../../src/domain/events/image-rules';
import { THEME_MODES } from '../../src/lib/theme/theme-mode';

// ───────────────────────────────────────────────────────────────────────────────
//  Fixtures
// ───────────────────────────────────────────────────────────────────────────────
/** Um tema como a leitura da página o entrega: resolvido, com todos os papéis. */
function tema(patch: Partial<ResolvedTenantTheme> = {}): ResolvedTenantTheme {
  return {
    colorMode: 'light',
    radius: 8,
    fontFamily: 'system',
    spacing: 'normal',
    heroStyle: 'plain',
    animation: 'none',
    ...patch,
  } as ResolvedTenantTheme;
}

function bloco(patch: Partial<TenantPageBlock> = {}): TenantPageBlock {
  return {
    id: 'bloco-1',
    type: 'ABOUT',
    content: {},
    style: {},
    displayOrder: 0,
    isVisible: true,
    ...patch,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  O MODO: quem manda é o visitante
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · a paleta da instituição não mata o modo do visitante', () => {
  it('quem pediu ESCURO recebe o fundo e o texto do modo escuro', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A MUTAÇÃO QUE ESTE CASO PEGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A implementação "óbvia" é chamar `themeToCssVariables(theme)` e publicar o
     *  resultado — e o mapa escolhe a paleta pelo `colorMode` DA INSTITUIÇÃO. Com um
     *  tema declarado `light`, quem pediu escuro receberia `#fbfcfd` de fundo e
     *  `#16202a` de texto: a página inteira clara dentro de um casco escuro, com o
     *  controle do rodapé marcando "Escuro". Este `expect` é o que reprova isso.
     */
    const scope = buildTenantThemeScope({ theme: tema({ colorMode: 'light' }), visitorMode: 'escuro' });

    expect(scope.mode).toBe('dark');
    expect(scope.visitorDecided).toBe(true);
    expect(scope.variables['--ef-background']).toBe(TENANT_THEME_PALETTE.dark.background);
    expect(scope.variables['--ef-text']).toBe(TENANT_THEME_PALETTE.dark.text);
  });

  it('quem pediu CLARO recebe a paleta clara, mesmo com a instituição declarando escuro', () => {
    /** O outro lado da mesma moeda: a decisão do visitante vence nos DOIS sentidos. */
    const scope = buildTenantThemeScope({ theme: tema({ colorMode: 'dark' }), visitorMode: 'claro' });

    expect(scope.mode).toBe('light');
    expect(scope.variables['--ef-background']).toBe(TENANT_THEME_PALETTE.light.background);
    expect(scope.variables['--ef-text']).toBe(TENANT_THEME_PALETTE.light.text);
  });

  it('sem escolha do visitante (`sistema`), vale o modo que a instituição declarou', () => {
    /**
     * `sistema` não é um modo: é a ausência de escolha. Aí — e só aí — a página pode
     * decidir sozinha, e decide pelo modo em que as cores foram escolhidas.
     */
    const escura = buildTenantThemeScope({ theme: tema({ colorMode: 'dark' }), visitorMode: 'sistema' });
    const clara = buildTenantThemeScope({ theme: tema({ colorMode: 'light' }), visitorMode: 'sistema' });

    expect(escura.mode).toBe('dark');
    expect(escura.visitorDecided).toBe(false);
    expect(escura.variables['--ef-background']).toBe(TENANT_THEME_PALETTE.dark.background);

    expect(clara.mode).toBe('light');
    expect(clara.variables['--ef-background']).toBe(TENANT_THEME_PALETTE.light.background);
  });

  it('`auto` (o legado do evento) cai no claro, e o mapa continua fechando TODO papel', () => {
    /**
     * O tema da instituição herda o contrato do evento, onde `auto` é um valor
     * possível. Ele não pode virar um buraco: resolvido como claro, os papéis
     * continuam todos publicados — nenhum `var()` do CSS alcança token da plataforma
     * (a catraca disso é `f61-tema-do-evento`, sobre o mesmo mapa).
     */
    const scope = buildTenantThemeScope({
      theme: tema({ colorMode: 'auto' as ResolvedTenantTheme['colorMode'] }),
      visitorMode: 'sistema',
    });

    expect(scope.mode).toBe('light');

    for (const papel of ['--ef-primary', '--ef-secondary', '--ef-accent', '--ef-background', '--ef-text']) {
      expect(scope.variables[papel], papel).toBeTruthy();
      expect(scope.variables[papel], papel).not.toContain('var(');
    }
  });

  it('a MARCA não inverte com o modo; só o que a instituição não escolheu acompanha', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  IDENTIDADE × SUPERFÍCIE (a mesma régua do evento)
     * ─────────────────────────────────────────────────────────────────────────────
     *  A cor principal é a marca da casa: ela é a mesma numa página clara e numa
     *  escura. O que muda com o modo são fundo, texto e as superfícies de apoio — os
     *  papéis que a instituição NÃO escolhe no editor, exatamente para não brigar com
     *  o modo de quem lê.
     */
    const marca = {
      primaryColor: '#0f6f8c',
      secondaryColor: '#eef4f7',
      accentColor: '#e8a33d',
    };

    const clara = buildTenantThemeScope({
      theme: tema({ ...marca, colorMode: 'light' }),
      visitorMode: 'claro',
    });
    const escura = buildTenantThemeScope({
      theme: tema({ ...marca, colorMode: 'light' }),
      visitorMode: 'escuro',
    });

    expect(escura.variables['--ef-primary']).toBe(clara.variables['--ef-primary']);
    expect(escura.variables['--ef-secondary']).toBe(clara.variables['--ef-secondary']);
    expect(escura.variables['--ef-accent']).toBe(clara.variables['--ef-accent']);

    /** E o que muda é só o que a instituição não escolheu. */
    expect(escura.variables['--ef-background']).not.toBe(clara.variables['--ef-background']);
  });

  it('`resolveTenantThemeMode` é a régua isolada, e cobre os três valores do cookie', () => {
    for (const modo of THEME_MODES) {
      const esperado = modo === 'escuro' ? 'dark' : modo === 'claro' ? 'light' : 'light';

      expect(resolveTenantThemeMode(modo, 'light'), modo).toBe(esperado);
    }

    /** Com o tema declarado escuro, `sistema` passa a ser escuro. */
    expect(resolveTenantThemeMode('sistema', 'dark')).toBe('dark');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A PALETA PINTA — e a tinta de TEXTO é ajustada ao modo (FASE 64 · fatia 5)
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · a paleta da casa chega aos apelidos que a página lê', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O DEFEITO QUE ESTES CASOS PRENDEM (medido, com números, na fatia 5)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A fatia 4 publicava só os papéis `--ef-*`. O `globals.css` resolve os apelidos
   *  semânticos na RAIZ (`--brand: var(--ef-primary)`, …) e o CSS substitui `var()` no
   *  elemento onde a declaração é feita — então sobrescrever `--ef-primary` num
   *  descendente não re-resolve `--brand`, e a paleta da casa NÃO pintava pixel nenhum
   *  (medido: `text-brand` seguia `#3525cd` no claro e `#a5b4fc` no escuro com
   *  `#7b2ff7` publicado).
   */
  const ESCOLHA = '#7b2ff7';

  it('os apelidos de IDENTIDADE que a página lê são publicados', () => {
    const escopo = buildTenantThemeScope({
      theme: tema({ primaryColor: ESCOLHA }),
      visitorMode: 'claro',
    });

    for (const apelido of [
      '--brand',
      '--brand-foreground',
      '--primary',
      '--primary-foreground',
      '--primary-hover',
      '--primary-soft',
      '--ring',
    ]) {
      expect(escopo.variables[apelido], apelido).toBeTruthy();
    }

    /** O preenchimento é a cor da casa COMO ELA FOI ESCOLHIDA — a marca não inverte. */
    expect(escopo.variables['--primary']).toBe(ESCOLHA);
    expect(escopo.variables['--ring']).toBe(ESCOLHA);
  });

  it('os apelidos de SUPERFÍCIE e de TEXTO continuam vindo do modo do visitante', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A LINHA QUE NÃO PODE SER CRUZADA (a decisão do humano, ADR-332)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Se o escopo publicasse `--surface`, `--background`, `--card`, `--foreground` ou
     *  `--border`, a paleta da instituição passaria a mandar na ILUMINAÇÃO — e o
     *  visitante que escolheu "escuro" receberia uma página clara com o controle do
     *  rodapé marcando "Escuro". Este caso é a catraca disso: nenhum desses apelidos
     *  pode aparecer no escopo, por mais que a fase queira "pintar mais".
     */
    const escopo = buildTenantThemeScope({
      theme: tema({ primaryColor: ESCOLHA }),
      visitorMode: 'escuro',
    });

    for (const proibido of [
      '--surface',
      '--surface-low',
      '--surface-lowest',
      '--background',
      '--card',
      '--foreground',
      '--muted-foreground',
      '--border',
      '--popover',
      '--warning-soft',
      '--success',
    ]) {
      expect(escopo.variables[proibido], proibido).toBeUndefined();
    }
  });

  it('a tinta de TEXTO é legível nos dois modos, com a paleta da casa e com a escolhida', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  NÃO EXISTE UM TOM QUE SIRVA AOS DOIS MODOS (a mesma lição do token de aviso)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Para o AA sobre a superfície clara a luminância tem de ser baixa; sobre a escura,
     *  alta. São conjuntos disjuntos. Por isso o papel de TEXTO (`--brand`) é ajustado
     *  ao modo, enquanto o PREENCHIMENTO guarda a cor escolhida.
     *
     *  As duas paletas medidas são as que a fase usa de verdade: o roxo que o editor
     *  grava no E2E (`#7b2ff7`) e o azul institucional padrão (`#0f6f8c`, o de quem não
     *  escolheu nada).
     */
    for (const cor of [ESCOLHA, TENANT_THEME_PALETTE.light.primary]) {
      for (const modo of ['claro', 'escuro'] as const) {
        const escopo = buildTenantThemeScope({ theme: tema({ primaryColor: cor }), visitorMode: modo });

        const tinta = escopo.variables['--brand'] ?? '';
        const fundo = TENANT_THEME_PALETTE[escopo.mode].background;
        const razao = razaoDeContraste(tinta, fundo);

        expect(razao, `${cor} no ${modo} (${tinta} sobre ${fundo})`).not.toBeNull();
        expect(
          razao ?? 0,
          `${cor} no ${modo}: ${tinta} sobre ${fundo} dá ${razao?.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(CONTRASTE_ALVO_DO_TEXTO);
      }
    }
  });

  it('no CLARO a escolha da casa é publicada como ela é; no ESCURO ela é clareada', () => {
    /** O ajuste é o MÍNIMO: quando o tom escolhido já passa, ele sai intacto. */
    const clara = buildTenantThemeScope({ theme: tema({ primaryColor: ESCOLHA }), visitorMode: 'claro' });
    const escura = buildTenantThemeScope({ theme: tema({ primaryColor: ESCOLHA }), visitorMode: 'escuro' });

    expect(clara.variables['--brand']).toBe(ESCOLHA);
    expect(escura.variables['--brand']).not.toBe(ESCOLHA);

    /** E o PREENCHIMENTO continua a cor escolhida nos dois modos — a marca não inverte. */
    expect(clara.variables['--primary']).toBe(ESCOLHA);
    expect(escura.variables['--primary']).toBe(ESCOLHA);
  });

  it('o rótulo sobre a cor da casa é escolhido por MEDIÇÃO (não é branco por padrão)', () => {
    /** Com a marca escura, o rótulo é branco. */
    const escura = buildTenantThemeScope({
      theme: tema({ primaryColor: '#0f6f8c' }),
      visitorMode: 'claro',
    });
    expect(escura.variables['--primary-foreground']).toBe('#ffffff');

    /** Com a marca CLARA, branco seria ilegível: o rótulo vira a tinta do modo. */
    const clara = buildTenantThemeScope({
      theme: tema({ primaryColor: '#ffe066' }),
      visitorMode: 'claro',
    });
    expect(clara.variables['--primary-foreground']).not.toBe('#ffffff');
    expect(
      razaoDeContraste(clara.variables['--primary-foreground'] ?? '', '#ffe066') ?? 0,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('`corDeTextoLegivel` devolve a cor intacta quando não sabe lê-la', () => {
    /** Formato fora do schema: publicar o valor original é melhor do que inventar tom. */
    expect(corDeTextoLegivel({ cor: 'var(--x)', fundo: '#ffffff' })).toBe('var(--x)');
    expect(razaoDeContraste('var(--x)', '#ffffff')).toBeNull();
  });

  it('a conversão cobre os dois espaços de cor que o schema permite', () => {
    /** Hexadecimal de 3 e de 6 dígitos. */
    expect(paraRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    expect(paraRgb('#7b2ff7')).toEqual({ r: 123, g: 47, b: 247 });

    /** E o `oklch` da paleta escura da instituição é convertido de verdade. */
    const escuro = paraRgb(TENANT_THEME_PALETTE.dark.background);
    expect(escuro).not.toBeNull();
    expect(escuro?.r).toBeLessThan(60);
    expect(paraRgb('rgb(1,2,3)')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O formulário não oferece o modo — e isso é a decisão de produto
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · o editor escolhe a identidade, não a iluminação', () => {
  it('os campos de paleta são exatamente os três que não dependem do modo', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTE CASO PRENDE (e por que ele é a regra, e não estilo)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Fundo e texto são os dois únicos papéis que PRECISAM acompanhar o modo (um
     *  fundo claro com texto escuro é ilegível no escuro). No instante em que o
     *  formulário oferecer um deles, a escolha da instituição terá de vencer o
     *  visitante — e a regra desta fase morre no primeiro salvamento. Um `colorMode`
     *  no formulário tem o mesmo efeito, um nível acima.
     */
    expect(TENANT_PALETTE_ROLES.map((role) => role.key)).toEqual([
      'primaryColor',
      'secondaryColor',
      'accentColor',
    ]);

    const chaves = TENANT_PALETTE_ROLES.map((role) => role.key as string);

    expect(chaves).not.toContain('backgroundColor');
    expect(chaves).not.toContain('textColor');
    expect(chaves).not.toContain('colorMode');
  });

  it('todo papel de paleta tem rótulo e explicação — nada de campo mudo', () => {
    for (const role of TENANT_PALETTE_ROLES) {
      expect(role.label.length, role.key).toBeGreaterThan(0);
      expect(role.hint.length, role.key).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O status da publicação responde DUAS perguntas
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · o estado da publicação em uma frase', () => {
  const TZ = 'America/Bahia';

  it('nunca publicada: diz que o visitante está vendo a lista de eventos', () => {
    const status = tenantPageStatus({
      publication: { state: 'NEVER_PUBLISHED', publishedAt: null, isUpToDate: false },
      timeZone: TZ,
    });

    expect(status.state).toBe('NEVER_PUBLISHED');
    expect(status.label).toContain('não está no ar');
    expect(status.publicationLabel).toContain('não publicada');
  });

  it('no ar COM alterações: `CHANGES_PENDING` não é rascunho', () => {
    /**
     * O defeito clássico que esta frase evita: o editor dizer "rascunho" enquanto o
     * site está no ar com a versão da semana passada. Quem lê precisa saber que a
     * página ESTÁ publicada e que o que ele acabou de salvar ainda não subiu.
     */
    const status = tenantPageStatus({
      publication: {
        state: 'CHANGES_PENDING',
        publishedAt: new Date('2026-11-01T13:00:00.000Z'),
        isUpToDate: false,
      },
      timeZone: TZ,
    });

    expect(status.state).toBe('CHANGES_PENDING');
    expect(status.label).toContain('No ar');
    expect(status.label).not.toContain('Rascunho');
    expect(status.detail).toContain('não subiu');
    expect(status.publicationLabel).toContain('alterações');
  });

  it('publicada e em dia: a data é escrita no fuso da INSTITUIÇÃO', () => {
    const status = tenantPageStatus({
      publication: {
        state: 'PUBLISHED',
        publishedAt: new Date('2026-11-01T13:00:00.000Z'),
        isUpToDate: true,
      },
      timeZone: TZ,
    });

    expect(status.label).toContain('Publicada');
    /** 13:00Z é 10:00 em Salvador — a hora que o organizador confere no relógio dele. */
    expect(status.label).toContain('10:00');
    expect(status.detail).toContain('exatamente o rascunho');
  });

  it('os quatro estados possíveis produzem frases DIFERENTES entre si', () => {
    const frases = (
      ['NEVER_PUBLISHED', 'PUBLISHED', 'CHANGES_PENDING'] as const
    ).map((state) =>
      tenantPageStatus({
        publication: { state, publishedAt: new Date('2026-11-01T13:00:00.000Z'), isUpToDate: state === 'PUBLISHED' },
        timeZone: TZ,
      }).label,
    );

    expect(new Set(frases).size).toBe(frases.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A lista de blocos
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · o resumo de cada bloco', () => {
  it('os tipos compartilhados usam a régua do EVENTO, por referência', () => {
    expect(tenantBlockSummary('RICH_TEXT', { body: 'Doze letras.' })).toContain('caractere(s)');
    expect(tenantBlockSummary('FAQ', { items: [{ question: 'a', answer: 'b' }] })).toBe(
      '1 pergunta(s)',
    );
    expect(tenantBlockSummary('CUSTOM_HTML', { html: '<p>x</p>' })).toContain('exibido como texto');
    expect(tenantBlockSummary('HERO', {})).toContain('não é desenhado');
  });

  it('os três tipos exclusivos da instituição ganham texto próprio', () => {
    expect(tenantBlockSummary('ABOUT', { foundedLabel: '1957', body: 'História.' })).toContain(
      'fundação: 1957',
    );
    expect(tenantBlockSummary('ABOUT', {})).toContain('vazio');

    /** O histórico NÃO afirma quantidade de evento: ele guarda o LIMITE (ADR-168). */
    const historico = tenantBlockSummary('PAST_EVENTS', { limit: 6 });

    expect(historico).toContain('até 6');
    expect(historico).toContain('lidos do sistema');

    expect(tenantBlockSummary('CONTACT', { email: 'casa@exemplo.test', phone: '71 0000' })).toBe(
      '2 forma(s) de contato',
    );
    expect(tenantBlockSummary('CONTACT', {})).toContain('vazio');
  });

  it('a lista marca posição, vazio e "não aparece na página" para cada bloco', () => {
    const rows = tenantBlockRows([
      bloco({ id: 'a', type: 'ABOUT', content: { body: 'Texto da casa.' } }),
      bloco({ id: 'b', type: 'FAQ', content: { items: [] } }),
      bloco({ id: 'c', type: 'TEAM', content: {} }),
    ]);

    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
    expect(rows[0]?.vazio).toBe(false);
    expect(rows[1]?.vazio).toBe(true);
    /**
     * `TEAM` hoje NÃO é marcado como "não aparece na página" pelo conjunto do
     * domínio, ainda que o renderizador da fatia 2 não o desenhe (ver o caso do
     * aviso, abaixo). O resumo é o do evento: o título do bloco, ou o nome do tipo.
     */
    expect(rows[2]?.semRenderizador).toBe(false);
    expect(rows[2]?.vazio).toBe(false);
  });

  it('o aviso de tipo sem renderizador existe só para quem está no conjunto do domínio', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A LISTA DO DOMÍNIO TEM SÓ `HERO` — E `TEAM`/`SPONSORS` SÃO UM DEFEITO RELATADO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O renderizador da fatia 2 também devolve `null` para `TEAM` e `SPONSORS`
     *  ("ainda não têm de onde ler"), mas o conjunto do domínio
     *  (`TENANT_BLOCK_WITHOUT_RENDERER`) só declara `HERO`. Este arquivo NÃO altera a
     *  fatia 1 nem a 2 (é a regra da fase): o caso abaixo prende o estado REAL, para
     *  que a correção — quando vier — apareça como mudança consciente aqui, e não
     *  como surpresa. O defeito está relatado no documento da entrega.
     */
    const doConjunto: readonly TenantPageBlockType[] = ['HERO'];

    for (const type of doConjunto) {
      expect(TENANT_BLOCK_WITHOUT_RENDERER.has(type), type).toBe(true);
      expect(tenantBlockTypeNotice(type), type).toContain('NÃO desenha');
    }

    expect(TENANT_BLOCK_WITHOUT_RENDERER.has('TEAM')).toBe(false);
    expect(TENANT_BLOCK_WITHOUT_RENDERER.has('SPONSORS')).toBe(false);

    for (const type of ['ABOUT', 'PAST_EVENTS', 'CONTACT', 'RICH_TEXT', 'FAQ', 'CUSTOM_HTML'] as const) {
      expect(TENANT_BLOCK_WITHOUT_RENDERER.has(type), type).toBe(false);
      expect(tenantBlockTypeNotice(type), type).toBeNull();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  As finalidades de imagem da página da instituição
// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 64 · capa e logotipo da instituição no catálogo canônico', () => {
  it('as duas finalidades existem, com rótulo, teto e política de WebP', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ELAS SÃO FINALIDADES PRÓPRIAS
     * ─────────────────────────────────────────────────────────────────────────────
     *  A finalidade é parte da identidade do objeto no bucket e da deduplicação do
     *  acervo. Reusar `COVER` faria a MESMA imagem subida na capa de um evento e na
     *  da instituição virar um objeto só — e apagar uma deixaria a outra quebrada.
     */
    for (const target of ['TENANT_COVER', 'TENANT_LOGO'] as const) {
      expect(ASSET_TARGETS).toContain(target);
      expect(ASSET_TARGET_LABELS[target].length).toBeGreaterThan(0);
      expect(MAX_IMAGE_BYTES[target]).toBeGreaterThan(0);
      expect(WEBP_POLICY[target]).toBeDefined();
    }
  });

  it('a capa é fotografia (faixa larga) e o logotipo é gráfico (sem redimensionar)', () => {
    expect(WEBP_POLICY.TENANT_COVER.mode).toBe('FOTOGRAFIA');
    expect(WEBP_POLICY.TENANT_COVER.maxLongestSide).toBe(1920);

    expect(WEBP_POLICY.TENANT_LOGO.mode).toBe('GRAFICO');
    expect(WEBP_POLICY.TENANT_LOGO.maxLongestSide).toBeNull();

    /** O teto de bytes segue a mesma régua do evento: capa grande, marca pequena. */
    expect(MAX_IMAGE_BYTES.TENANT_COVER).toBe(MAX_IMAGE_BYTES.COVER);
    expect(MAX_IMAGE_BYTES.TENANT_LOGO).toBe(MAX_IMAGE_BYTES.LOGO);
  });

  it('nenhum alvo do catálogo ficou sem rótulo, teto ou política', () => {
    /** A catraca larga: um alvo novo em `ASSET_TARGETS` sem as três tabelas cai aqui. */
    for (const target of ASSET_TARGETS as readonly ImageTarget[]) {
      expect(ASSET_TARGET_LABELS[target], target).toBeTruthy();
      expect(MAX_IMAGE_BYTES[target], target).toBeGreaterThan(0);
      expect(WEBP_POLICY[target], target).toBeDefined();
    }
  });
});
