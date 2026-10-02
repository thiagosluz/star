/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — A APARÊNCIA DO VISITANTE ANÔNIMO (FASE 63)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (e por que aqui, e não no navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 61 já provou a REGRA (`themeModeFromValue`, `themeMarkup`) sem Next e sem
 *  banco: o que o valor do cookie significa. O que faltava era o CONTROLE — o
 *  visitante sem sessão não tinha onde discordar do tema do sistema operacional.
 *
 *  A pergunta desta fase é de MARKUP, e é respondível a frio: **o HTML que o
 *  servidor entrega já traz os três estados, com o atual marcado?** Se a resposta
 *  for sim, o controle funciona antes de qualquer JavaScript — é o mesmo desenho
 *  das telas das FASES 38/39/59 —, e é isso que os casos abaixo RENDERIZAM (o
 *  componente é chamado com o cookie variando e o HTML resultante é inspecionado).
 *  A prova de ponta a ponta, com o formulário enviando de verdade, é do E2E.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O COOKIE É SUBSTITUÍDO, E NÃO O COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `next/headers` não existe fora de uma requisição do Next, então ele é trocado
 *  por um dublê que devolve o valor que o caso quer — a fronteira é a MESMA que o
 *  navegador usa (o cookie), e não uma prop nova inventada para o teste poder
 *  entrar. O resto do caminho é real: o componente, a lista `THEME_MODES`, os
 *  rótulos e o `aria-pressed`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { THEME_MODES, THEME_MODE_LABELS } from '../../src/lib/theme/theme-mode';

/**
 * O cookie desta requisição de mentira.
 *
 * `vi.hoisted` porque o dublê de `next/headers` é içado para antes das declarações
 * do arquivo: sem ele, a fábrica fecharia sobre uma variável ainda não inicializada.
 */
const estado = vi.hoisted(() => ({ valor: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) =>
      nome === 'ef_tema' && estado.valor !== undefined ? { name: nome, value: estado.valor } : undefined,
  }),
}));

/** `revalidatePath` só existe dentro de uma requisição do Next — e não é o assunto aqui. */
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { ThemeChoice } = await import('../../src/components/theme/theme-choice');

const RAIZ = process.cwd();
const COMPONENTE = 'src/components/theme/theme-choice.tsx';

/** O HTML do servidor para a variante pública, com o cookie valendo `valor`. */
async function htmlDoRodape(valor: string | undefined): Promise<string> {
  estado.valor = valor;

  return renderToStaticMarkup(await ThemeChoice({ variant: 'public' }));
}

/**
 * Os três botões, na ordem em que o HTML os traz.
 *
 * A leitura é por expressão regular de propósito: o que está em julgamento é o
 * HTML CRU que o servidor entrega, e não um componente React remontado pelo teste
 * (que passaria mesmo se o servidor não entregasse botão nenhum).
 */
function botoes(html: string): { valor: string; marcado: boolean }[] {
  return [...html.matchAll(/<button[^>]*>/g)].map((achado) => {
    const tag = achado[0];
    const valor = /value="([^"]*)"/.exec(tag)?.[1] ?? '';
    const marcado = /aria-pressed="true"/.test(tag);

    return { valor, marcado };
  });
}

describe('FASE 63 · o rodapé público rende os três estados', () => {
  it('o HTML do servidor já traz os três botões, com o nome que o formulário envia', async () => {
    const html = await htmlDoRodape(undefined);

    expect(botoes(html).map((botao) => botao.valor)).toEqual([...THEME_MODES]);
    expect(html).toContain('name="tema"');
    expect(html).toContain('type="submit"');
  });

  it('sem cookie, quem está marcado é `sistema` — o padrão que não impõe preferência', async () => {
    const html = await htmlDoRodape(undefined);

    expect(botoes(html)).toEqual([
      { valor: 'claro', marcado: false },
      { valor: 'escuro', marcado: false },
      { valor: 'sistema', marcado: true },
    ]);
  });

  it('cada um dos três valores do cookie marca exatamente um botão', async () => {
    /**
     * É a pergunta que o `aria-pressed` responde para quem não vê a cor do
     * preenchimento: "qual está valendo?". Um HTML com dois marcados (ou nenhum)
     * seria ambíguo — e o teste reprova dizendo qual valor do cookie o produziu.
     */
    for (const modo of THEME_MODES) {
      const html = await htmlDoRodape(modo);
      const marcados = botoes(html).filter((botao) => botao.marcado);

      expect(marcados, `cookie: ${modo}`).toEqual([{ valor: modo, marcado: true }]);
    }
  });

  it('um valor inválido no cookie não inventa um quarto estado', async () => {
    /** A leitura é a MESMA do layout: o que não é um dos três cai em `sistema`. */
    const html = await htmlDoRodape('noturno');

    expect(botoes(html).filter((botao) => botao.marcado)).toEqual([
      { valor: 'sistema', marcado: true },
    ]);
  });

  it('o grupo é nomeado pelo texto VISÍVEL do rodapé, e não por instrução de leitor de tela', async () => {
    /**
     * O rodapé não tem `<legend>`: a linha é uma só, com "Aparência:" ao lado dos
     * botões. Sem o `aria-labelledby`, quem ouve a tela receberia três botões
     * soltos ("Claro", "Escuro", "Sistema") sem saber do que eles tratam.
     */
    const html = await htmlDoRodape(undefined);

    expect(html).toContain('Aparência:');
    expect(html).toContain('role="group"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);

    const rotulo = /aria-labelledby="([^"]+)"/.exec(html)![1]!;

    expect(html, 'o rótulo apontado precisa existir no documento').toContain(`id="${rotulo}"`);
  });

  it('os rótulos são os mesmos das outras superfícies — nada de texto novo', async () => {
    const html = await htmlDoRodape('claro');

    for (const modo of THEME_MODES) {
      expect(html).toContain(THEME_MODE_LABELS[modo]);
    }
  });
});

describe('FASE 63 · o controle é UM, e as variantes não divergem', () => {
  it('as três variantes desenham os MESMOS três valores', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CATRACA DA FONTE ÚNICA (o risco declarado da fase)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O rodapé de cada página pública é de quem é a página, e cada um deles chama
     *  este controle. Se um quarto modo nascer — ou se um dos três valores for
     *  renomeado —, o `menu` do painel, o `/conta` e os três rodapés têm de mudar
     *  JUNTOS: um só componente significa um só lugar para mudar.
     */
    for (const variant of ['menu', 'account', 'public'] as const) {
      estado.valor = 'escuro';

      const html = renderToStaticMarkup(await ThemeChoice({ variant }));

      expect(botoes(html).map((botao) => botao.valor), `variante ${variant}`).toEqual([
        ...THEME_MODES,
      ]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Catracas de TEXTO — o "sem JavaScript" e o "um componente" moram no arquivo
// ───────────────────────────────────────────────────────────────────────────────
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const FONTE = semComentarios(readFileSync(join(RAIZ, COMPONENTE), 'utf8'));

describe('FASE 63 · catracas do controle no rodapé', () => {
  it('não há estado de cliente: o controle funciona antes de o JavaScript carregar', () => {
    /**
     * `useState`/`onClick`/`onChange` seriam a assinatura de um controle que só
     * existe depois da hidratação — e o visitante anônimo de uma página pública é
     * justamente quem menos pode depender disso (é a mesma régua das FASES 38, 39,
     * 59 e do botão de recolher a barra).
     */
    for (const proibido of ['useState', 'useEffect', 'onClick', 'onChange', 'use client']) {
      expect(FONTE, `o controle voltou a depender do cliente: ${proibido}`).not.toContain(proibido);
    }
  });

  it('o formulário chama a Server Action que já existe desde a FASE 61', () => {
    /** Duas ações para o mesmo cookie seriam duas verdades sobre o mesmo tema. */
    expect(FONTE).toContain('setThemeModeAction');
    expect(FONTE).toContain('name="tema"');
  });

  it('as três páginas públicas da plataforma chamam o controle no rodapé', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A CATRACA DA COBERTURA — e a razão de ela ser textual
     * ─────────────────────────────────────────────────────────────────────────────
     *  O defeito desta fase é de OMISSÃO: uma tela pública que ninguém lembrou de
     *  cobrir continua nascendo escura, e nenhum teste de componente vê isso (o
     *  componente está certo; ele só não foi chamado). A varredura prende as quatro
     *  páginas que o escopo nomeia — e o E2E cobra o comportamento nas três URLs.
     */
    const paginas = [
      'src/app/page.tsx',
      'src/app/(public)/organizacoes/page.tsx',
      'src/app/validar/[code]/page.tsx',
      'src/app/validar/lote/page.tsx',
    ];

    for (const pagina of paginas) {
      const fonte = semComentarios(readFileSync(join(RAIZ, pagina), 'utf8'));

      expect(fonte, `${pagina} não chama o controle de aparência`).toContain(
        '<ThemeChoice variant="public"',
      );
      expect(fonte, `${pagina} chama o controle fora de um rodapé`).toContain('<footer');
    }
  });

  it('a página do EVENTO não recebeu o controle da plataforma', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTA CATRACA PROTEGE (a decisão do humano, presa no código)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Na página pública do evento quem manda é o ORGANIZADOR (decisão da FASE 61),
     *  e o visitante não pode sobrescrever a identidade que a instituição escolheu
     *  com um clique no rodapé. O rodapé da plataforma e o do evento são peças
     *  diferentes de propósito: este caso prende que o controle do VISITANTE não
     *  entrou no casco das páginas da instituição (`(public)/layout.tsx`) nem no
     *  rodapé compartilhado por elas.
     */
    for (const arquivo of [
      'src/app/t/[tenantSlug]/(public)/layout.tsx',
      'src/components/shell/account-block.tsx',
    ]) {
      const fonte = semComentarios(readFileSync(join(RAIZ, arquivo), 'utf8'));

      expect(fonte, `${arquivo} passou a oferecer o controle do visitante`).not.toContain(
        "variant=\"public\"",
      );
    }
  });
});
