/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — ACESSIBILIDADE (dívida H5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O projeto tem sistema de design, testes de unidade e 166 testes E2E — e nenhum
 *  deles perguntava se a tela pode ser USADA por quem navega por teclado, por leitor
 *  de tela ou com baixa visão. O `docs/design-system.md` recomenda a varredura desde
 *  a FASE 2 e ela nunca existiu: acessibilidade sem catraca vira intenção, e
 *  intenção não sobrevive à pressa de uma fase.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A VARREDURA REPROVA — E O QUE ELA NÃO REPROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Roda o `axe-core` no HTML que o servidor entregou (já hidratado) e **reprova** em
 *  impacto `critical` e `serious` — o que impede alguém de usar a tela. `moderate` e
 *  `minor` NÃO reprovam: viraria uma lista de preferências que ninguém lê, e o
 *  objetivo aqui é o portão, não o relatório.
 *
 *  As tags são as do padrão **WCAG AA (2.0, 2.1 e 2.2)**. `best-practice` fica de
 *  fora de propósito (ordem de títulos, região): não impede o uso, e misturar
 *  recomendação com requisito é o caminho mais rápido para alguém desligar o teste.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MENSAGEM DO ERRO DIZ O QUE CORRIGIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Falha de acessibilidade sem o seletor é meia informação: quem lê o CI precisa
 *  saber QUAL regra, em QUAL elemento e o que a regra espera. O helper monta isso
 *  (id, impacto, descrição, seletores e o link da regra) em vez de despejar o JSON
 *  do axe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NENHUMA ISENÇÃO GENÉRICA — A ISENÇÃO É POR NÓ, NÃO POR REGRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `disableRules('color-contrast')` calaria a regra INTEIRA, inclusive num texto
 *  cinza que ninguém consegue ler. O que existe aqui é isenção **por elemento**: só
 *  o nó que usa o token de aviso é dispensado, e qualquer OUTRA falha de contraste
 *  continua reprovando o build. A isenção também é CONTADA e impressa — dívida
 *  silenciosa é dívida esquecida.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, createEvent, createTenant, e2eDb, grantPlatformRole, grantRole, linkUser } from './helpers';
import { createDemand } from '../../src/lib/events/demand-service';
import { reportPublicProfile } from '../../src/lib/profile/profile-report-service';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'acessibilidade';

/** Só o que IMPEDE o uso da tela reprova (ver o cabeçalho). */
const IMPACTOS_REPROVADOS = ['critical', 'serious'] as const;

/**
 * Isenções — por ELEMENTO e com o motivo medido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A DÍVIDA DO TOKEN DE AVISO FOI PAGA (FASE 52) — E ESTA LISTA ESTÁ VAZIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A varredura da FASE 50 mediu, aqui mesmo, que `text-warning-strong` (`#d97706`)
 *  dava **2,89:1** sobre `bg-warning-soft` (`#fff2e4`) e 4,15:1 sobre a superfície
 *  escura do telão: um valor único não serve às duas superfícies, e por isso estes
 *  nós foram isentos enquanto o token não fosse separado.
 *
 *  Ele foi separado — `warning-strong` (`#92400e`) para painéis claros e
 *  `warning-strong-on-dark` (`#fcd34d`) para o telão, ambos presos por teste em
 *  `tests/unit/f52-warning-contrast.test.ts`. **Não há mais nada isentado**: qualquer
 *  violação de `color-contrast`, em qualquer nó, reprova o portão.
 *
 *  A lista e o teto continuam existindo porque o mecanismo é bom: isenção por NÓ (e
 *  nunca `disableRules`, que calaria a regra inteira), com o motivo medido escrito ao
 *  lado. Quem precisar isentar algo no futuro passa a ter onde declarar — e o teto de
 *  duas linhas obriga a justificar.
 */
const ISENCOES: readonly { id: string; classeAncestral: string; motivo: string }[] = [];

/** Teto das isenções: passar disso deixou de ser exceção e virou configuração. */
const MAX_ISENCOES = 2;

interface NodeResumo {
  alvo: string;
  html: string;
}

interface ViolacaoResumo {
  id: string;
  impacto: string;
  ajuda: string;
  descricao: string;
  url: string;
  nodes: NodeResumo[];
}

/**
 * Varre a tela atual e reprova o que impediria alguém de usá-la.
 *
 * Devolve também quantos NÓS foram isentos, para o relatório do CI dizer o tamanho da
 * dívida em vez de escondê-la.
 */
async function expectNoCriticalViolations(page: Page, tela: string): Promise<{ isentos: number }> {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A VARREDURA ESPERA O MOVIMENTO PARAR (FASE 50)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O axe lê a cor COMPUTADA de cada nó. No meio de uma transição de `opacity` ou de
   *  uma animação de entrada, o valor lido é o do instante — e a mesma tela passa numa
   *  execução e reprova na seguinte (aconteceu: a varredura do diretório reprovou uma
   *  vez e passou nas outras duas). Não era violação: era corrida.
   *
   *  `reducedMotion: 'reduce'` usa o caminho que o PRÓPRIO produto tem para movimento
   *  reduzido (o CSS do projeto já o respeita), e o estilo desliga transições e
   *  animações que o app não cobre. O portão não fica mais frouxo: fica determinístico
   *  — violação de contraste que exista de verdade continua reprovando.
   */
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E ESPERA O DOM PARAR DE MUDAR (FASE 50)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A segunda metade da corrida: com a máquina sob carga, o axe analisava a página
   *  ENQUANTO o React ainda trocava o conteúdo que veio por streaming — e reprovava
   *  regra de um DOM que não é o que a pessoa vê. O sintoma era o pior possível: a
   *  MESMA tela passando três vezes e falhando na quarta.
   *
   *  `MutationObserver` com 120 ms de silêncio é a espera determinística: continua
   *  assim que o DOM para, e não "espera 2 segundos para ver se resolve". As fontes
   *  entram junto porque o layout depende delas.
   */
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts?.ready;

    await new Promise<void>((resolve) => {
      let timer = window.setTimeout(() => {
        observer.disconnect();
        resolve();
      }, 120);

      const observer = new MutationObserver(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          observer.disconnect();
          resolve();
        }, 120);
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    });
  });

  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  const reprovadas: ViolacaoResumo[] = [];
  let isentos = 0;

  for (const violacao of resultado.violations) {
    if (!(IMPACTOS_REPROVADOS as readonly string[]).includes(violacao.impact ?? '')) continue;

    const isencao = ISENCOES.find((item) => item.id === violacao.id);
    const nodes = violacao.nodes.map((node) => ({
      alvo: node.target.map((alvo) => String(alvo)).join(' '),
      html: node.html,
    }));

    /**
     * A isenção olha para o ELEMENTO e seus ANCESTRAIS no navegador, e não para o HTML
     * do próprio nó: quem falha é o `<p>` interno, e a cor vem de um invólucro com o
     * token (`text-warning-strong`) — o HTML do nó não traz a classe, e casar por texto
     * deixaria a isenção sem efeito (foi o primeiro erro desta varredura).
     */
    const restantes = isencao
      ? (
          await Promise.all(
            nodes.map(async (node) => {
              const seletor = node.alvo.split(' >>> ').pop() ?? node.alvo;
              const herdado = await page
                .evaluate(
                  (dados) => {
                    try {
                      const elemento = document.querySelector(dados.seletor);
                      return Boolean(elemento?.closest('.' + dados.classe));
                    } catch {
                      return false;
                    }
                  },
                  { seletor, classe: isencao.classeAncestral },
                )
                .catch(() => false);

              return herdado ? null : node;
            }),
          )
        ).filter((node): node is NodeResumo => node !== null)
      : nodes;

    isentos += nodes.length - restantes.length;

    if (restantes.length === 0) continue;

    reprovadas.push({
      id: violacao.id,
      impacto: violacao.impact ?? 'desconhecido',
      ajuda: violacao.help,
      descricao: violacao.description,
      url: violacao.helpUrl,
      nodes: restantes,
    });
  }

  if (isentos > 0) {
    /**
     * O aviso fica no log de propósito: quem for corrigir a paleta precisa saber que a
     * isenção AINDA está sendo usada (e onde).
     */
    console.log(
      `[a11y] ${tela}: ${isentos} nó(s) isento(s) — dívida do token de aviso (ver ISENCOES)`,
    );
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E O LANDMARK: EXATAMENTE UM `<main>` POR TELA (ADR-290 · FASE 60)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A FASE 52 tirou o `<main>` da casca e o devolveu às páginas — e **16 páginas
   *  ficaram sem NENHUM** (a dívida I2). O `axe` não reprova landmark ausente (é boa
   *  prática, e não critério do AA), então sem esta linha a varredura ficaria VERDE
   *  numa tela sem landmark nenhum.
   *
   *  A pergunta é feita ao DOM, e nos DOIS sentidos: ZERO pega a página que não tem o
   *  seu `<main>`; DOIS pega a casca voltando a ser landmark — o defeito original
   *  (achado H5), que não pode renascer em silêncio.
   *
   *  Vem ANTES do retorno antecipado de propósito: dentro do caminho de falha, a
   *  catraca só rodaria em tela já reprovada.
   */
  await expect
    .soft(page.locator('main'), `Landmarks <main> em ${tela}: esperado exatamente 1`)
    .toHaveCount(1);

  if (reprovadas.length === 0) return { isentos };

  const detalhe = reprovadas
    .map((violacao) => {
      const alvos = violacao.nodes
        .map((node) => `      ${node.alvo}\n        <${node.html.slice(0, 180)}>`)
        .join('\n');

      return [
        `  ✗ ${violacao.id} (${violacao.impacto}) — ${violacao.ajuda}`,
        `    o que corrigir: ${violacao.descricao}`,
        `    elementos (${violacao.nodes.length}):`,
        alvos,
        `    regra: ${violacao.url}`,
      ].join('\n');
    })
    .join('\n\n');

  expect
    .soft(
      reprovadas.map((violacao) => violacao.id),
      `Acessibilidade em ${tela}: ${reprovadas.length} violação(ões) de impacto crítico/sério\n\n${detalhe}\n`,
    )
    .toEqual([]);

  return { isentos };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Fixture: uma instituição com uma pessoa da equipe (a tela autenticada precisa de
//  vínculo E papel — vínculo sem papel não chega ao painel; lição da FASE 25).
// ───────────────────────────────────────────────────────────────────────────────
let tenantSlug: string;
let adminEmail: string;
/** O evento do quadro de demandas (FASE 57) e a pessoa que o administra. */
let eventId: string;
/** A conta de PLATAFORMA: a fila de denúncias só abre para SuperAdmin (FASE 56 · E62). */
let superEmail: string;

async function signUpVia(
  api: import('@playwright/test').APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `a11y.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  return { id: user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({
      label: TENANT_LABEL,
      name: `Instituição Acessível ${RUN_ID}`,
    });

    tenantSlug = tenant.slug;

    const admin = await signUpVia(api, 'Administradora Acessível');
    adminEmail = admin.email;

    await linkUser({ userId: admin.id, tenantId: tenant.id, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId: tenant.id, role: 'ADMIN', scope: 'TENANT' });

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  AS TELAS DA FASE 56 E DA FASE 57 ENTRAM NO PORTÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O quadro de demandas foi varrido na FASE 50 como UMA tela (o Kanban). Ele passou
     *  a ter três vistas (FASE 57), e cada uma desenha o que a outra não desenha — eixo,
     *  barra, célula de mês. A fila de denúncias (FASE 56) tem o formulário de decisão,
     *  que é onde rótulo ausente e contraste ruim aparecem.
     *
     *  As fixtures são criadas aqui para a varredura encontrar a tela COM conteúdo: uma
     *  fila vazia e um Gantt sem barra não provam nada sobre o que a tela mostra.
     */
    const event = await createEvent({
      tenantId: tenant.id,
      slug: `acessivel-${RUN_ID}`,
      title: `Evento Acessível ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
      capacity: 100,
    });

    eventId = event.id;

    const hoje = new Date();
    const demandaBase = {
      tenantId: tenant.id,
      eventId: event.id,
      actorId: admin.id,
    };

    /** Uma barra que ATRAVESSA o período e vence no mês corrente. */
    await createDemand({
      ...demandaBase,
      title: 'Confirmar os crachás da portaria',
      priority: 'HIGH',
      startAt: new Date(hoje.getTime() - 2 * 86_400_000),
      dueAt: hoje,
    });

    /** Um marco: começa e vence no mesmo dia (a barra de um dia do Gantt). */
    await createDemand({
      ...demandaBase,
      title: 'Imprimir a lista de presença',
      startAt: new Date(hoje.getTime() - 86_400_000),
      dueAt: new Date(hoje.getTime() + 5 * 86_400_000),
    });

    /** Sem prazo nenhum: é a faixa "sem data" das duas vistas. */
    await createDemand({
      ...demandaBase,
      title: 'Revisar o texto de abertura',
    });

    /** A conta de plataforma e UMA denúncia na fila (o formulário de decisão). */
    const superAdmin = await signUpVia(api, 'SuperAdmin Acessível');
    superEmail = superAdmin.email;
    await grantPlatformRole({ userId: superAdmin.id });

    await e2eDb.user.update({
      where: { id: admin.id },
      data: { publicHandle: `acessivel-${RUN_ID}` },
    });

    await reportPublicProfile({
      tenantId: tenant.id,
      reporterUserId: superAdmin.id,
      username: `acessivel-${RUN_ID}`,
      category: 'SPAM',
      details: 'Denúncia criada pela varredura de acessibilidade para a fila ter conteúdo.',
    });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** A lista de isenções é exceção, não configuração. */
test('a lista de isenções continua curta', () => {
  expect(
    ISENCOES.length,
    `Isenções de acessibilidade: ${ISENCOES.map((item) => `${item.id} (${item.classeAncestral})`).join(', ')}`,
  ).toBeLessThanOrEqual(MAX_ISENCOES);
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('telas públicas', () => {
  test('a landing da plataforma não tem violação crítica', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'landing da plataforma (/)');
  });

  test('a tela de login não tem violação crítica', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form')).toBeVisible();

    await expectNoCriticalViolations(page, 'login (/login)');
  });

  test('a validação pública de certificado não tem violação crítica', async ({ page }) => {
    /**
     * O código inexistente é o caso mais comum da vida real (link digitado errado,
     * certificado revogado) — e é a tela que um TERCEIRO abre sem login. Se o estado
     * de erro não for acessível, quem depende de leitor de tela não sabe o resultado.
     */
    await page.goto(`/validar/CERT-INEXISTENTE-${RUN_ID}`);
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'validação pública (/validar/<code>)');
  });

  test('o diretório público de instituições não tem violação crítica', async ({ page }) => {
    await page.goto('/organizacoes');
    await expect(page.locator('body')).toBeVisible();

    await expectNoCriticalViolations(page, 'diretório de instituições (/organizacoes)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('telas autenticadas', () => {
  test('o painel da instituição não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    /**
     * `.last()` porque a CASCA do painel também é um `<main>` e a página traz o dela:
     * são DOIS landmarks `main` na mesma página — achado desta varredura, registrado no
     * relatório da dívida H5. Não é violação de WCAG AA (landmark único é
     * `best-practice`), então o portão não reprova; a correção é estrutural, no shell,
     * e mexe em todas as telas autenticadas de uma vez.
     */
    await expect(page.getByRole('main').last()).toBeVisible();

    await expectNoCriticalViolations(page, `painel da instituição (/t/${tenantSlug}/dashboard)`);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A BARRA RECOLHIDA TAMBÉM PASSA PELO PORTÃO (FASE 59)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A varredura anterior mede a barra INTEIRA. A recolhida é outra tela para o
   *  `axe`: o rótulo de cada item sai da área visível (vira `sr-only`), o bloco de
   *  contexto e o de conta perdem o texto, e é exatamente aí que um link sem nome
   *  acessível (`link-name`) aparece — o defeito que esta varredura existe para
   *  prender.
   *
   *  O cookie é gravado ANTES do `goto` de propósito: a barra precisa nascer
   *  recolhida no HTML do servidor, que é como a pessoa a encontra quando volta ao
   *  painel. Recolher por clique mediria o estado depois de uma hidratação, e não
   *  o que o servidor entrega.
   */
  test('o painel com a barra recolhida não tem violação crítica', async ({ page, baseURL }) => {
    await signInAs(page, adminEmail);

    await page.context().addCookies([
      { name: 'ef_nav', value: 'rail', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    await expect(page.locator('aside[data-nav]')).toHaveAttribute('data-nav', 'rail');

    /**
     * Os itens do menu continuam nomeados MESMO sem o rótulo desenhado — e é isto
     * que a varredura confirma por outro caminho (o `axe` reprova `link-name`).
     */
    await expect(
      page.locator('aside[data-nav]').getByRole('link', { name: 'Painel', exact: true }),
    ).toHaveAccessibleName('Painel');

    await expectNoCriticalViolations(
      page,
      `painel com a barra recolhida (/t/${tenantSlug}/dashboard · ef_nav=rail)`,
    );

    /**
     * A barra volta ao estado normal para o resto do arquivo: o cookie é do
     * CONTEXTO do navegador, e um teste seguinte que abrisse o painel mediria a
     * barra recolhida sem ter pedido.
     */
    await page.context().addCookies([
      { name: 'ef_nav', value: 'full', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  E O MODO ESCURO TAMBÉM PASSA PELO PORTÃO (FASE 61 · dívida H3)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Até aqui toda varredura deste arquivo media UMA paleta: a clara, que é o `:root`
   *  de sempre. O modo noturno traz um conjunto NOVO de pares texto/fundo — e nenhum
   *  deles tem histórico de medição.
   *
   *  O navegador entra com a escolha JÁ gravada (`ef_tema=escuro`, o mesmo cookie que o
   *  layout raiz lê no servidor), então a página chega escura desde a primeira
   *  resposta: o `axe` mede a paleta escura de verdade, e não um tema aplicado depois
   *  por JavaScript — que é justamente o que não queremos que exista.
   */
  test('o painel em modo escuro não tem violação crítica', async ({ page, baseURL }) => {
    await signInAs(page, adminEmail);

    await page.context().addCookies([
      { name: 'ef_tema', value: 'escuro', url: baseURL ?? 'http://localhost:3000' },
    ]);

    await page.goto(`/t/${tenantSlug}/dashboard`);
    /** A prova de que o SERVIDOR entregou o escuro (e não o cliente, depois). */
    await expect(page.locator('html')).toHaveAttribute('data-tema', 'escuro');

    await expectNoCriticalViolations(
      page,
      `painel em modo escuro (/t/${tenantSlug}/dashboard · ef_tema=escuro)`,
    );

    /**
     * A paleta volta à CLARA para o resto do arquivo: o cookie é do CONTEXTO do
     * navegador, e um teste seguinte mediria o escuro sem ter pedido. `claro` é
     * escolha explícita de propósito: sem cookie o modo é o do SISTEMA, e a varredura
     * passaria a depender da preferência da máquina que roda a suíte.
     */
    await page.context().addCookies([
      { name: 'ef_tema', value: 'claro', url: baseURL ?? 'http://localhost:3000' },
    ]);
  });

  test('o diretório de participantes não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/participantes`);
    await expect(page.getByRole('main').last()).toBeVisible();

    /**
     * Esta é a tela mais DENSA do sistema num só lugar: filtros, tabela, seleção e o
     * painel de exportação da FASE 49 — o melhor alvo para o portão pegar rótulo
     * ausente, nome de botão e contraste fora do token de aviso.
     */
    await expectNoCriticalViolations(page, `diretório de participantes (/t/${tenantSlug}/participantes)`);
  });
  // ───────────────────────────────────────────────────────────────────────────────
  //  As VISTAS do quadro de demandas (FASE 57) — uma varredura por vista
  // ───────────────────────────────────────────────────────────────────────────────
  test('o quadro de demandas (Kanban) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas`);
    await expect(page.getByTestId('demand-board-kanban')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Kanban (/t/${tenantSlug}/administracao/eventos/<id>/demandas)`,
    );
  });

  test('o quadro de demandas (Gantt) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    /**
     * O Gantt é a vista com mais texto pequeno e mais cor fora do token: eixo de dias,
     * barras com tom por situação e a faixa "sem data". Se a acessibilidade valesse só
     * para o Kanban, esta tela nasceria fora do portão.
     */
    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas?vista=gantt`);
    await expect(page.getByTestId('demand-gantt')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Gantt (/t/${tenantSlug}/administracao/eventos/<id>/demandas?vista=gantt)`,
    );
  });

  test('o quadro de demandas (calendário) não tem violação crítica', async ({ page }) => {
    await signInAs(page, adminEmail);

    await page.goto(`/t/${tenantSlug}/administracao/eventos/${eventId}/demandas?vista=calendario`);
    await expect(page.getByTestId('demand-calendar')).toBeVisible();

    await expectNoCriticalViolations(
      page,
      `quadro de demandas · Calendário (/t/${tenantSlug}/administracao/eventos/<id>/demandas?vista=calendario)`,
    );
  });

  // ───────────────────────────────────────────────────────────────────────────────
  //  A FILA DE DENÚNCIAS (FASE 56 · dívida E62) — tela de PLATAFORMA
  // ───────────────────────────────────────────────────────────────────────────────
  test('a fila de denúncias da plataforma não tem violação crítica', async ({ page }) => {
    await signInAs(page, superEmail);

    await page.goto('/superadmin/denuncias');
    await expect(page.getByTestId('moderation-queue')).toBeVisible();

    /**
     * A fila traz o relato de quem denunciou e o formulário de decisão (nota + dispensar
     * + ocultar). É onde uma decisão de moderação é tomada: se ela não for operável por
     * teclado e leitor de tela, quem decide fica sem o caminho.
     */
    await expectNoCriticalViolations(page, 'fila de denúncias (/superadmin/denuncias)');
  });
});
