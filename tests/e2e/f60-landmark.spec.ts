/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — UM ÚNICO LANDMARK `<main>` POR TELA (FASE 60 · dívida I2)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A auditoria da FASE 52 descobriu que a casca (`AppShell`) era o landmark do
 *  painel — e que as OUTRAS árvores nunca tiveram nenhum. O resultado era o pior
 *  dos dois mundos: telas autenticadas com DOIS `<main>` (casca + página, o
 *  achado H5) e dezesseis telas com ZERO — oito do painel de plataforma e oito
 *  públicas. A dívida I2 é o segundo grupo.
 *
 *  A decisão da F52 é a régua deste arquivo, e ela tem DUAS metades:
 *
 *      • o `<main>` é o conteúdo da TELA, e a casca deixou de ser landmark;
 *      • e continua valendo **exatamente UM** por tela — quem herda o landmark
 *        de um componente (a página pública do evento herda o da `EventLanding`)
 *        NÃO ganha outro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A AMOSTRA É A LISTA INTEIRA, E NÃO TRÊS DE CADA LADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um teste de amostra prova as telas que ele visita e deixa as outras na
 *  confiança. Aqui a lista completa é barata — a fixture é uma instituição, um
 *  evento, uma atividade, um perfil de palestrante e uma chamada — e é ela que
 *  fecha a dívida: qualquer tela nova que nasça sem `<main>` (ou com dois)
 *  entra nesta tabela.
 *
 *  A varredura tem DUAS metades de propósito:
 *
 *      1. as telas que DESENHAM o próprio `<main>` (todo o `/superadmin/**` e as
 *         páginas públicas que não delegam a outro componente);
 *      2. a página pública do evento, que HERDA o `<main>` da `EventLanding` —
 *         ela é a prova da segunda metade da regra: se alguém "consertar" a
 *         página acrescentando um `<main>` a mais, este cenário reprova.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ESPERA É POR CONTEÚDO DA PRÓPRIA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Contar landmarks sem esperar mediria o esqueleto de carregamento — e um
 *  `<main>` que ainda não renderizou passaria como "não existe". Por isso cada
 *  linha da tabela traz uma ÂNCORA (um `data-testid` ou o título da tela): o
 *  cenário só conta depois que o conteúdo daquela tela está visível.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantPlatformRole,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f60-landmark';
const EVENT_SLUG = `evento-f60-${RUN_ID}`;
const EVENT_TITLE = `Seminário do Landmark ${RUN_ID}`;
const ACTIVITY_SLUG = `oficina-f60-${RUN_ID}`;
const CALL_SLUG = `chamada-f60-${RUN_ID}`;
const CALL_TITLE = `Chamada de minicursos ${RUN_ID}`;

let tenantId: string;
let tenantSlug: string;
let operatorEmail: string;
let speakerProfileId: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f60.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

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
      name: `Instituição do Landmark ${RUN_ID}`,
    });

    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: EVENT_SLUG,
      title: EVENT_TITLE,
      status: 'REGISTRATION_OPEN',
    });

    const activity = await createActivity({
      tenantId,
      eventId: event.id,
      slug: ACTIVITY_SLUG,
      title: `Oficina do Landmark ${RUN_ID}`,
    });

    speakerProfileId = randomUUID();

    /**
     * A ficha pública do palestrante e a chamada publicada nascem por ESCRITA
     * DIRETA, como em `member-lifecycle` e em `call-for-proposals`: o editor de
     * chamadas e o cadastro de palestrante têm cobertura própria, e o que este
     * arquivo mede é o LANDMARK da tela que já existe.
     */
    await e2eDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

      await tx.speakerProfile.create({
        data: {
          id: speakerProfileId,
          tenantId,
          name: `Palestrante do Landmark ${RUN_ID}`,
          bio: 'Perfil criado para medir o landmark da ficha pública.',
        },
      });

      await tx.activitySpeaker.create({
        data: { tenantId, activityId: activity.id, speakerProfileId, displayOrder: 0 },
      });

      await tx.callForProposals.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId: event.id,
          // Fora da ciência: a trilha não é exigida (ADR-162).
          kind: 'MINICOURSE',
          slug: CALL_SLUG,
          title: CALL_TITLE,
          isPublished: true,
          opensAt: new Date(Date.now() - 86_400_000),
          closesAt: new Date(Date.now() + 20 * 86_400_000),
        },
      });
    });

    const operator = await signUpVia(api, `Operadora do Landmark ${RUN_ID}`);
    operatorEmail = operator.email;

    // O painel de plataforma responde 404 para quem não tem a concessão, e a
    // primeira concessão nunca sai da própria UI (a decisão do E2E da FASE 9).
    await grantPlatformRole({ userId: operator.id });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Uma tela da varredura: como chegar nela e o que esperar antes de contar. */
interface Tela {
  nome: string;
  caminho: () => string;
  ancora: (page: Page) => Locator;
}

/**
 * As oito telas do painel de plataforma que a auditoria da F52 achou SEM landmark.
 *
 * Todas usam o mesmo shell (`/superadmin/layout.tsx` → `AppShell`), que desde a F52
 * não é landmark: o `<main>` é o do conteúdo, e é isso que estas linhas prendem.
 */
const TELAS_DO_PAINEL: Tela[] = [
  {
    nome: 'métricas da plataforma',
    caminho: () => '/superadmin/metricas',
    ancora: (page) => page.getByTestId('metrics-generated-at'),
  },
  {
    nome: 'instituições',
    caminho: () => '/superadmin/tenants',
    ancora: (page) => page.getByTestId('tenant-search'),
  },
  {
    nome: 'detalhe da instituição',
    caminho: () => `/superadmin/tenants/${tenantId}`,
    ancora: (page) => page.getByTestId('tenant-detail-name'),
  },
  {
    nome: 'rotinas automáticas',
    caminho: () => '/superadmin/rotinas',
    ancora: (page) => page.getByTestId('jobs-generated-at'),
  },
  {
    nome: 'auditoria',
    caminho: () => '/superadmin/auditoria',
    ancora: (page) => page.getByTestId('identity-critical-30d'),
  },
  {
    nome: 'denúncias de perfil',
    caminho: () => '/superadmin/denuncias',
    ancora: (page) => page.getByTestId('moderation-generated-at'),
  },
  {
    /**
     * Governança é a única sem âncora interna incondicional (a lista de SuperAdmins
     * tem um vazio alternativo): o próprio `data-testid` da tela é o sinal de que a
     * página certa renderizou.
     */
    nome: 'governança',
    caminho: () => '/superadmin/governanca',
    ancora: (page) => page.getByTestId('platform-governance'),
  },
  {
    nome: 'guia de estilo',
    caminho: () => '/superadmin/design',
    ancora: (page) => page.getByTestId('design-surfaces'),
  },
];

/**
 * As telas PÚBLICAS que a auditoria achou sem landmark, mais a página do evento.
 *
 * A última linha é a outra metade da regra: `/eventos/<slug>` não desenha `<main>`
 * — ela o HERDA da `EventLanding`, que ganhou o seu na F52. Por isso o cenário
 * espera o título do evento (o conteúdo REAL) e exige que continue havendo UM.
 */
const TELAS_PUBLICAS: Tela[] = [
  {
    nome: 'convite de equipe',
    caminho: () => `/t/${tenantSlug}/convite`,
    ancora: (page) => page.getByTestId('invitation-not-found'),
  },
  {
    nome: 'convite de palestrante',
    caminho: () => `/t/${tenantSlug}/palestrante/convite`,
    ancora: (page) => page.getByRole('heading', { name: 'Convite de palestrante' }),
  },
  {
    nome: 'inscrição no evento',
    caminho: () => `/t/${tenantSlug}/eventos/${EVENT_SLUG}/inscricao`,
    ancora: (page) => page.getByTestId('event-registration-summary'),
  },
  {
    nome: 'atividade da programação',
    caminho: () => `/t/${tenantSlug}/eventos/${EVENT_SLUG}/atividades/${ACTIVITY_SLUG}`,
    ancora: (page) => page.getByTestId('activity-schedule'),
  },
  {
    nome: 'chamada pública',
    caminho: () => `/t/${tenantSlug}/eventos/${EVENT_SLUG}/chamada/${CALL_SLUG}`,
    ancora: (page) => page.getByTestId('call-title'),
  },
  {
    nome: 'ficha pública do palestrante',
    caminho: () => `/t/${tenantSlug}/eventos/${EVENT_SLUG}/palestrantes/${speakerProfileId}`,
    ancora: (page) => page.getByTestId('speaker-name'),
  },
  {
    nome: 'página pública do evento (herda o <main> da EventLanding)',
    caminho: () => `/t/${tenantSlug}/eventos/${EVENT_SLUG}`,
    ancora: (page) => page.getByRole('heading', { level: 1, name: EVENT_TITLE }),
  },
];

/**
 * Espera o CONTEÚDO da tela e só então conta os landmarks.
 *
 * `getByRole('main')` já ignora o que está escondido por CSS ou `aria-hidden` — é a
 * mesma árvore que o leitor de tela enxerga —, então a contagem é literalmente
 * "quantas regiões principais esta tela anuncia". O `toBeVisible()` é o que amarra
 * o "visível" do requisito: um `<main>` com `display: none` não conta dois, e é
 * bom que não conte — mas também não pode ser o ÚNICO, senão não há landmark.
 */
async function provarLandmarkUnico(page: Page, ancora: Locator): Promise<void> {
  await expect(ancora).toBeVisible();

  const landmark = page.getByRole('main');

  // A contagem vem PRIMEIRO: com dois landmarks, `toBeVisible()` sozinho falharia
  // com "strict mode violation" e esconderia o número — que é o diagnóstico.
  await expect(landmark).toHaveCount(1);
  await expect(landmark).toBeVisible();
}

test.describe('painel de plataforma', () => {
  /**
   * O operador entra UMA vez por cenário: cada teste do Playwright ganha contexto
   * novo (cookies inclusive), então a sessão de plataforma precisa ser refeita.
   */
  test.beforeEach(async ({ page }) => {
    await signInAs(page, operatorEmail);
  });

  for (const tela of TELAS_DO_PAINEL) {
    test(`${tela.nome}: exatamente um <main>`, async ({ page }) => {
      const response = await page.goto(tela.caminho());

      // 200 antes de qualquer contagem: um 404 também tem conteúdo, e medir a
      // página de erro como se fosse a tela seria um teste verde e mentiroso.
      expect(response?.status()).toBe(200);

      await provarLandmarkUnico(page, tela.ancora(page));
    });
  }
});

test.describe('páginas públicas', () => {
  for (const tela of TELAS_PUBLICAS) {
    test(`${tela.nome}: exatamente um <main>`, async ({ page }) => {
      const response = await page.goto(tela.caminho());

      expect(response?.status()).toBe(200);

      await provarLandmarkUnico(page, tela.ancora(page));
    });
  }
});
