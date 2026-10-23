/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O PAR DE E2E DO TOPO ÚNICO (FASE 78 · fatia 5)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE — E O QUE A CATRACA DE FONTE NÃO PROVA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 5 fechou a dívida H1 com uma catraca de FONTE
 *  (`tests/unit/f78-topo-unico.test.ts`): cada `page.tsx` migrado importa e usa
 *  `PageHeader`, não escreve `<h1>` nem um `<header>` logo depois do `<main>`.
 *
 *  Fonte não é render. Uma página pode importar o componente e passá-lo por um
 *  ramo que não aparece, ou o componente pode ser trocado por um `<header>` com
 *  `<h2>` de outro arquivo compartilhado. O limite está escrito no cabeçalho
 *  daquela catraca — e este arquivo é a outra metade: o HTML que o SERVIDOR
 *  entrega, medido no navegador, em doze telas de sete famílias.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE CADA CASO AFIRMA (os três invariantes do topo)
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **exatamente UM `<h1>` na tela** — o título da página, e não um título de
 *       seção promovido a título (as 6 telas que usavam `<h2>` como título);
 *    2. **exatamente UM `<h1>` DENTRO do `<header>`** — o topo é o `PageHeader`, e
 *       não um `<h1>` solto no corpo com um `<header>` vazio ao lado;
 *    3. **o `eyebrow` é um `<p>` e está FORA do `<h1>`** — dentro, o nome acessível
 *       do título viraria "OperaçãoCredenciamento", e o grupo de navegação
 *       passaria a ser lido como parte do título. Nas telas sem `eyebrow` (auth e
 *       lista pública) o caso afirma o outro lado da mesma regra: **nenhum grupo
 *       de navegação vazou para o cabeçalho**.
 *
 *  O título é conferido pelo TEXTO exato em cada tela — sem isso, um `PageHeader`
 *  com o título errado (ou uma tela que caiu no estado vazio de outra) passaria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS SETE FAMÍLIAS (e por que estas doze telas)
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • **Painel** ........ dashboard (a tela de referência, grupo "Geral");
 *    • **Participantes** .. diretório (a tela mais densa, grupo "Operação");
 *    • **Administração** .. a raiz da gestão e a equipe;
 *    • **Evento** ......... a raiz do evento e a programação (as duas usam o
 *                           mesmo grupo, mas têm trilhas e ações diferentes);
 *    • **Participação** ... minhas inscrições e certificados (grupo "Minha
 *                           participação");
 *    • **Plataforma** ..... métricas e rotinas (superadmin, grupo "Plataforma");
 *    • **Auth e pública** . login (sem grupo) e a lista pública de eventos (sem
 *                           grupo — a página não pertence a um menu).
 *
 *  Não é varredura das 81 telas migradas: é a AMOSTRA que cobre as quatro fontes
 *  de `eyebrow` (`TENANT_NAV_GROUPS`, `PLATFORM_NAV_GROUP` e a ausência), os dois
 *  renderizadores de casca (instituição e plataforma) e o caso público sem grupo.
 *  Um caso por família é o que a catraca de fonte não consegue substituir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f78-topo';
const TENANT_NAME = `Instituto do Topo Único ${RUN_ID}`;
const EVENT_TITLE = `Congresso do Topo Único ${RUN_ID}`;
const EVENT_SLUG = `f78-congresso-${RUN_ID}`;

let tenantSlug: string;
let tenantId: string;
let eventId: string;
let adminEmail: string;
let platformEmail: string;

/** O grupo de navegação da instituição e o da plataforma — as duas fontes únicas. */
const GRUPOS = /^(Geral|Minha participação|Comitê científico|Operação|Plataforma)$/;

interface Tela {
  /** O número do caso — a ordem é a do relatório da fase. */
  n: number;
  nome: string;
  /** O caminho relativo (o `tenantSlug`/`eventId` entram na montagem). */
  url: () => string;
  /** O texto exato do `<h1>` — o título que a pessoa lê. */
  titulo: string;
  /** O grupo de navegação, ou `null` quando a tela não pertence a um menu. */
  eyebrow: string | null;
  /** Quem precisa estar logado: o administrador da instituição ou o SuperAdmin. */
  conta: 'admin' | 'plataforma' | null;
}

const TELAS: readonly Tela[] = [
  {
    n: 1,
    nome: 'o painel da instituição',
    url: () => `/t/${tenantSlug}/dashboard`,
    titulo: `Painel de ${TENANT_NAME}`,
    eyebrow: 'Geral',
    conta: 'admin',
  },
  {
    n: 2,
    nome: 'o diretório de participantes',
    url: () => `/t/${tenantSlug}/participantes`,
    titulo: 'Participantes',
    eyebrow: 'Operação',
    conta: 'admin',
  },
  {
    n: 3,
    nome: 'a raiz da administração',
    url: () => `/t/${tenantSlug}/administracao`,
    titulo: 'Administração',
    eyebrow: 'Operação',
    conta: 'admin',
  },
  {
    n: 4,
    nome: 'a equipe da instituição',
    url: () => `/t/${tenantSlug}/administracao/equipe`,
    titulo: 'Equipe e participantes',
    eyebrow: 'Operação',
    conta: 'admin',
  },
  {
    n: 5,
    nome: 'a raiz do evento',
    url: () => `/t/${tenantSlug}/administracao/eventos/${eventId}`,
    titulo: EVENT_TITLE,
    eyebrow: 'Operação',
    conta: 'admin',
  },
  {
    n: 6,
    nome: 'a programação do evento',
    url: () => `/t/${tenantSlug}/administracao/eventos/${eventId}/programacao`,
    titulo: 'Programação',
    eyebrow: 'Operação',
    conta: 'admin',
  },
  {
    n: 7,
    nome: 'as minhas inscrições',
    url: () => `/t/${tenantSlug}/minhas-inscricoes`,
    titulo: 'Minhas inscrições',
    eyebrow: 'Minha participação',
    conta: 'admin',
  },
  {
    n: 8,
    nome: 'os meus certificados',
    url: () => `/t/${tenantSlug}/certificados`,
    titulo: 'Meus certificados',
    eyebrow: 'Minha participação',
    conta: 'admin',
  },
  {
    n: 9,
    nome: 'as métricas da plataforma',
    url: () => '/superadmin/metricas',
    titulo: 'Métricas da plataforma',
    eyebrow: 'Plataforma',
    conta: 'plataforma',
  },
  {
    n: 10,
    nome: 'as rotinas automáticas',
    url: () => '/superadmin/rotinas',
    titulo: 'Rotinas automáticas',
    eyebrow: 'Plataforma',
    conta: 'plataforma',
  },
  {
    n: 11,
    nome: 'a tela de entrada',
    url: () => '/login',
    titulo: 'Entrar',
    eyebrow: null,
    conta: null,
  },
  {
    n: 12,
    nome: 'a lista pública de eventos da instituição',
    url: () => `/t/${tenantSlug}/eventos`,
    titulo: 'Eventos',
    eyebrow: null,
    conta: null,
  },
];

async function signUpVia(api: Page['request'], name: string): Promise<{ id: string; email: string }> {
  const email = uniqueEmail('f78');

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);

  const body = (await response.json()) as { user: { id: string } };

  return { id: body.user.id, email };
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  expect(response.ok(), await response.text()).toBe(true);
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: TENANT_NAME });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: EVENT_TITLE,
      status: 'REGISTRATION_OPEN',
    });
    eventId = event.id;

    const admin = await signUpVia(api, 'Administradora do Topo Único');
    adminEmail = admin.email;
    await linkUser({ userId: admin.id, tenantId, kind: 'MEMBER' });
    await grantRole({ userId: admin.id, tenantId, role: 'ADMIN', scope: 'TENANT' });

    const platform = await signUpVia(api, 'SuperAdmin do Topo Único');
    platformEmail = platform.email;
    await grantPlatformRole({ userId: platform.id });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('o topo único nas telas reais', () => {
  for (const tela of TELAS) {
    test(`${tela.n}. ${tela.nome}`, async ({ page }) => {
      if (tela.conta === 'admin') await signInAs(page, adminEmail);
      if (tela.conta === 'plataforma') await signInAs(page, platformEmail);

      await page.goto(tela.url());

      /**
       * O título pode chegar por streaming, então a espera é pela condição certa
       * (o `<h1>` com o texto) — e não por um tempo fixo.
       */
      await expect(page.locator('h1')).toHaveCount(1, { timeout: 30_000 });
      await expect(page.locator('header h1')).toHaveCount(1);

      const h1 = page.locator('h1');
      await expect(h1).toHaveText(tela.titulo);

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  O EYEBROW É `<p>` E NÃO ESTÁ DENTRO DO `<h1>`
       * ─────────────────────────────────────────────────────────────────────────
       *  O locator é o PARÁGRAFO do cabeçalho com o texto EXATO do grupo (o
       *  `hasText` com âncoras evita casar a descrição, que também é um `<p>`).
       *  As três provas:
       *    • existe UM parágrafo com aquele texto, e a tag é `P`;
       *    • ele não tem `<h1>` como ancestral (`closest('h1') === null`);
       *    • o texto do `<h1>` NÃO contém o grupo — a prova pelo nome que a pessoa
       *      lê, e não só pela árvore.
       */
      if (tela.eyebrow) {
        const eyebrow = page.locator('header p').filter({ hasText: new RegExp(`^${tela.eyebrow}$`) });

        await expect(eyebrow).toHaveCount(1);

        const [tag, ancestor, textoDoTitulo] = await Promise.all([
          eyebrow.evaluate((el) => el.tagName),
          eyebrow.evaluate((el) => (el.closest('h1') ? 'dentro' : 'fora')),
          h1.textContent(),
        ]);

        expect(tag).toBe('P');
        expect(ancestor).toBe('fora');
        expect(textoDoTitulo).not.toContain(tela.eyebrow);
      } else {
        /**
         * Nas telas sem grupo, o invariante é o NEGATIVO: nenhum dos quatro grupos
         * da instituição nem o da plataforma pode aparecer como parágrafo do topo.
         * Se alguém "consertar" a ausência inventando um eyebrow, este caso reprova.
         */
        await expect(page.locator('header p').filter({ hasText: GRUPOS })).toHaveCount(0);
      }

      /** O grupo, quando existe, jamais é um heading — não rouba a hierarquia. */
      await expect(page.locator('h1 p')).toHaveCount(0);
    });
  }
});
