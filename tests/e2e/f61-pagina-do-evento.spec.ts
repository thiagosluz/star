import { expect, test, type Page } from '@playwright/test';

import { EVENT_THEME_PALETTE } from '../../src/domain/events/landing-page';
import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 61 · A PÁGINA PÚBLICA DO EVENTO MANTÉM O TEMA DO ORGANIZADOR
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  A decisão da fase é "na página do evento quem manda é o organizador". O cenário
 *  deste arquivo é o caso em que ela NÃO valia: o visitante (ou o sistema dele) está
 *  no modo noturno, e o organizador escolheu **poucas cores** — só a primária, por
 *  exemplo. Até a correção, os papéis que ele não escolheu caíam em
 *  `var(--color-surface, …)`: a superfície da PLATAFORMA, que a escala escura redefine.
 *  A página pública escurecia junto com o painel.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA: A COR QUE O NAVEGADOR PINTOU, NO ESCONDO DA PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nada aqui é lido do código-fonte. O cookie `ef_tema=escuro` (a escolha explícita
 *  do modo noturno, gravada pelo servidor no `<html>`) é posto pelo navegador, e o
 *  que se mede é:
 *
 *    • o painel está escuro de verdade (a `<body>` — sem isso o cenário não prova
 *      nada, porque uma plataforma clara não tem como vazar para lugar nenhum);
 *    • o escopo do evento (`.ef-theme`, o elemento onde o `ThemeScope` publica o
 *      mapa) continua com as cores do organizador.
 *
 *  `body` NÃO é a régua da página do evento, e é bom que não seja: o fundo da
 *  plataforma é escuro DE PROPÓSITO, e a página pinta a superfície dela por cima. O
 *  contraste entre as duas medidas é justamente o que se quer ver.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CONTAINER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este cenário mede a plataforma em modo noturno, que só existe depois da FASE 61
 *  (escala escura no `globals.css` + fiação do cookie). Num container anterior a ela
 *  o primeiro caso falha na PRECONDIÇÃO — e isso é a resposta certa: medir a cor sob
 *  um modo escuro que não está no ar seria medir nada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO REPRODUZIDO (medido nesta entrega, com o código anterior no ar)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Com a fiação do modo noturno ligada e a correção DESFEITA, o caso 2 (tema parcial)
 *  reprova com `Expected: "rgb(249, 249, 255)"` / `Received: "rgb(23, 24, 30)"`: a
 *  superfície do evento era a da PLATAFORMA escura. Com a correção, os três casos
 *  passam. O caso 1 (tema completo) passa nos dois — é a prova de que quem já tinha
 *  escolhido todas as cores não vê diferença.
 */
const TENANT_LABEL = `f61-tema-${RUN_ID}`;

/** As três situações de escolha: tudo, só a primária e o escuro declarado sem cores. */
const TEMA_COMPLETO = {
  primaryColor: '#1d4ed8',
  secondaryColor: '#eef2ff',
  accentColor: '#0ea5e9',
  backgroundColor: '#fffdf5',
  textColor: '#1f2937',
  colorMode: 'light',
} as const;

const TEMA_PARCIAL = {
  primaryColor: '#b91c1c',
  colorMode: 'light',
} as const;

const TEMA_ESCURO = {
  colorMode: 'dark',
} as const;

/**
 * O tipo do tema no teste espelha o que o editor grava em `Event.theme`.
 *
 * É um `type` (e não um `interface`) de propósito: o alias ganha índice implícito e
 * encaixa no `InputJsonValue` do Prisma sem cast — interface não ganha, e o cast
 * seria a porta para gravar um tema que o domínio recusaria.
 */
type TemaDoEvento = {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  colorMode?: 'light' | 'dark' | 'auto';
};

let tenantId: string;
let tenantSlug: string;
let eventoCompleto: string;
let eventoParcial: string;
let eventoEscuro: string;

/** O que a página PINTOU no escopo do evento (`.ef-theme`), e não o que ela declarou. */
async function corDoEscopo(page: Page): Promise<{ fundo: string; texto: string }> {
  const bruto = await page
    .locator('.ef-theme')
    .first()
    .evaluate((elemento) => {
      const estilo = getComputedStyle(elemento);
      return { fundo: estilo.backgroundColor, texto: estilo.color };
    });

  return {
    fundo: await medirCor(page, bruto.fundo),
    texto: await medirCor(page, bruto.texto),
  };
}

/** A cor de fundo do `<body>` — a superfície da PLATAFORMA, que aqui é a testemunha. */
async function corDaPlataforma(page: Page): Promise<string> {
  return medirCor(
    page,
    await page.locator('body').evaluate((elemento) => getComputedStyle(elemento).backgroundColor),
  );
}

/**
 * Converte uma cor CSS em `rgb(r, g, b)` medindo o PIXEL que ela pinta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO COMPARAR AS STRINGS DE `getComputedStyle`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A paleta escura do tema do evento é escrita em `oklch(…)`, e o navegador NÃO
 *  devolve `oklch(…)` de volta: o valor computado sai como `lab(3.02059 …)` (medido
 *  nesta entrega). Comparar a string crua seria comparar o formato que eu imaginei
 *  com o formato que o motor escolheu — e o teste reprovaria sem que nada estivesse
 *  errado na página.
 *
 *  Medir o pixel normaliza OS DOIS LADOS pelo mesmo caminho: o literal da paleta e o
 *  que a página pintou passam pelo mesmo conversor do navegador. É a régua mais
 *  próxima de "o que o olho vê" que dá para medir sem imagem.
 */
function medirCor(page: Page, valor: string): Promise<string> {
  return page.evaluate((cor) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;

    const contexto = canvas.getContext('2d');
    if (!contexto) throw new Error('sem contexto 2d para medir a cor');

    contexto.fillStyle = cor;
    contexto.fillRect(0, 0, 1, 1);

    const [r, g, b] = contexto.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, valor);
}

/** Soma dos canais RGB: a régua grosseira e suficiente para "está escuro de verdade". */
function somaLuz(rgb: string): number {
  return (rgb.match(/\d+/g) ?? [])
    .slice(0, 3)
    .map((valor) => Number(valor))
    .reduce((total, valor) => total + valor, 0);
}

/**
 * Entra na página com a escolha EXPLÍCITA de modo noturno.
 *
 * O cookie é do SERVIDOR (a fiação o lê na requisição e escreve a classe no `<html>`);
 * pô-lo pelo contexto é o jeito de reproduzir "esta pessoa escolheu Escuro" sem passar
 * pelo menu de conta, que já tem cenário próprio (`f61-modo-noturno.spec.ts`).
 */
async function visitarComModoNoturno(
  page: Page,
  baseURL: string | undefined,
  caminho: string,
): Promise<void> {
  await page.context().addCookies([{ name: 'ef_tema', value: 'escuro', url: baseURL! }]);
  await page.goto(caminho);

  await expect(
    page.locator('html'),
    'precondição: a escolha de modo noturno precisa estar no ar (fiação da FASE 61)',
  ).toHaveAttribute('data-tema', 'escuro');

  const plataforma = await corDaPlataforma(page);

  expect(
    somaLuz(plataforma),
    `precondição: o painel precisa estar ESCURO de verdade — medido ${plataforma} (escala escura da FASE 61)`,
  ).toBeLessThan(200);
}

/** Grava o tema pelo mesmo campo que o editor grava (`Event.theme`) — é DADO, não formulário. */
async function gravarTema(
  tenantIdAlvo: string,
  eventId: string,
  tema: TemaDoEvento,
): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantIdAlvo}, true)`;
    await tx.event.update({ where: { id: eventId }, data: { theme: tema } });
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const tenant = await createTenant({
    label: TENANT_LABEL,
    name: `Instituição do tema do evento ${RUN_ID}`,
  });

  tenantId = tenant.id;
  tenantSlug = tenant.slug;

  const completo = await createEvent({
    tenantId,
    slug: `congresso-${RUN_ID}`,
    title: `Congresso com tema completo ${RUN_ID}`,
    summary: 'Evento cujo organizador escolheu todas as cores.',
  });
  eventoCompleto = completo.slug;
  await gravarTema(tenantId, completo.id, TEMA_COMPLETO);

  const parcial = await createEvent({
    tenantId,
    slug: `oficina-${RUN_ID}`,
    title: `Oficina com tema parcial ${RUN_ID}`,
    summary: 'Evento cujo organizador escolheu apenas a cor primária.',
  });
  eventoParcial = parcial.slug;
  await gravarTema(tenantId, parcial.id, TEMA_PARCIAL);

  const escuro = await createEvent({
    tenantId,
    slug: `seminario-${RUN_ID}`,
    title: `Seminário em modo escuro ${RUN_ID}`,
    summary: 'Evento cujo organizador declarou o modo escuro, sem escolher cores.',
  });
  eventoEscuro = escuro.slug;
  await gravarTema(tenantId, escuro.id, TEMA_ESCURO);
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test('1. tema COMPLETO: a página escura da plataforma não troca as cores do organizador', async ({
  page,
  baseURL,
}) => {
  await visitarComModoNoturno(page, baseURL, `/t/${tenantSlug}/eventos/${eventoCompleto}`);

  const escopo = await corDoEscopo(page);
  const plataforma = await corDaPlataforma(page);

  /**
   * A prova é o CONTRASTE entre as duas medidas: a plataforma está no escuro
   * (`#17181e`) e o escopo do evento continua com o creme que o organizador escolheu.
   * Se o tema do evento tivesse sido invertido (ou herdado) pelo modo noturno, as duas
   * medidas seriam iguais — e é por isso que a comparação é feita aqui, e não só contra
   * uma constante.
   */
  expect(escopo.fundo, 'a superfície do evento é a cor escolhida pelo organizador').toBe(
    await medirCor(page, TEMA_COMPLETO.backgroundColor),
  );
  expect(escopo.texto, 'o texto do evento é a cor escolhida pelo organizador').toBe(
    await medirCor(page, TEMA_COMPLETO.textColor),
  );
  expect(escopo.fundo).not.toBe(plataforma);
  expect(somaLuz(escopo.fundo)).toBeGreaterThan(somaLuz(plataforma));

  /**
   * E o mapa publicou os TRÊS papéis que o organizador não escolheu — com valor
   * próprio, sem sobra para o `var()` cair no token da plataforma. É a diferença que
   * esta entrega faz: antes, a acentuação vinha de um `var(--color-secondary-container, …)`.
   */
  const declarados = await page
    .locator('.ef-theme')
    .first()
    .evaluate((elemento) => {
      const estilo = (elemento as HTMLElement).style;
      return {
        fundo: estilo.getPropertyValue('--ef-background').trim(),
        texto: estilo.getPropertyValue('--ef-text').trim(),
        secundaria: estilo.getPropertyValue('--ef-secondary').trim(),
        acento: estilo.getPropertyValue('--ef-accent').trim(),
        primaria: estilo.getPropertyValue('--ef-primary').trim(),
      };
    });

  expect(declarados.fundo).toBe(TEMA_COMPLETO.backgroundColor);
  expect(declarados.texto).toBe(TEMA_COMPLETO.textColor);
  expect(declarados.secundaria).toBe(TEMA_COMPLETO.secondaryColor);
  expect(declarados.acento).toBe(TEMA_COMPLETO.accentColor);
  expect(declarados.primaria).toBe(TEMA_COMPLETO.primaryColor);
});

test('2. tema PARCIAL (só a primária): a página NÃO herda a superfície escura da plataforma', async ({
  page,
  baseURL,
}) => {
  await visitarComModoNoturno(page, baseURL, `/t/${tenantSlug}/eventos/${eventoParcial}`);

  const escopo = await corDoEscopo(page);
  const plataforma = await corDaPlataforma(page);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O RELATO, MEDIDO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Aqui a página NÃO pode estar escura: o organizador declarou `light` e escolheu
   *  só a cor primária. O que ele não escolheu é o PADRÃO DO MODO DELE — a superfície
   *  clara do tema do evento (`#f9f9ff`), que era o literal do fallback do CSS.
   *  Antes desta entrega, o papel caía em `var(--color-surface, #f9f9ff)`, e
   *  `--color-surface` vale `#17181e` no modo escuro: as duas medidas abaixo seriam a
   *  MESMA cor, que é exatamente o defeito.
   */
  expect(escopo.fundo, 'a superfície é a do tema do evento, não a da plataforma').toBe(
    await medirCor(page, EVENT_THEME_PALETTE.light.background),
  );
  expect(escopo.texto).toBe(await medirCor(page, EVENT_THEME_PALETTE.light.text));
  expect(escopo.fundo).not.toBe(plataforma);
  expect(somaLuz(escopo.fundo)).toBeGreaterThan(somaLuz(plataforma));

  /** E a cor que ele ESCOLHEU continua mandando na ação. */
  const primaria = await page
    .locator('.ef-theme')
    .first()
    .evaluate((elemento) => (elemento as HTMLElement).style.getPropertyValue('--ef-primary').trim());

  expect(primaria).toBe(TEMA_PARCIAL.primaryColor);

  /**
   * A metade que prende o DEFEITO, e não só o sintoma: o mapa declara os papéis que o
   * organizador não escolheu. Sem esta asserção, uma plataforma clara faria o sintoma
   * desaparecer — e o furo voltaria na primeira vez que alguém apagasse o mapa.
   */
  const fundoDeclarado = await page
    .locator('.ef-theme')
    .first()
    .evaluate((elemento) => (elemento as HTMLElement).style.getPropertyValue('--ef-background').trim());

  expect(
    fundoDeclarado,
    'o mapa precisa declarar a superfície — é o que impede o var() de cair no token da plataforma',
  ).toBe(EVENT_THEME_PALETTE.light.background);
});

test('3. `colorMode: dark` declarado: a página é escura mesmo com a plataforma clara', async ({
  page,
}) => {
  /**
   * O caminho espelhado, e ele importa: tirar os blocos de modo do CSS do evento só é
   * seguro porque o MAPA passou a responder o modo. Se ele não respondesse, um evento
   * com tema escuro ficaria claro numa plataforma clara — a regressão de outro lado.
   */
  await page.goto(`/t/${tenantSlug}/eventos/${eventoEscuro}`);

  const escopo = await corDoEscopo(page);
  const plataforma = await corDaPlataforma(page);

  /**
   * A testemunha continua sendo a cor medida: sem cookie, a plataforma está clara — e
   * o evento, escuro, porque foi isso que o organizador declarou.
   */
  expect(somaLuz(plataforma), `pré-condição: o painel está claro (medido ${plataforma})`)
    .toBeGreaterThan(600);

  expect(escopo.fundo).toBe(await medirCor(page, EVENT_THEME_PALETTE.dark.background));
  expect(escopo.texto).toBe(await medirCor(page, EVENT_THEME_PALETTE.dark.text));
  expect(somaLuz(escopo.fundo)).toBeLessThan(somaLuz(plataforma));
});
