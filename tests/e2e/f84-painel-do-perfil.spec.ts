/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — O PAINEL É DE QUEM OLHA (FASE 84 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A matriz perfil × blocos já tem prova barata em `tests/unit/f84-painel-do-perfil.test.ts`
 *  (46 casos, sem banco). O que só o NAVEGADOR prova é o encontro da regra com o
 *  mundo real: o HTML que o servidor entrega, os `data-testid` que os specs usam,
 *  o botão de contexto ao lado do título e a frase que anuncia o que ficou de fora.
 *
 *  São seis perfis, e cada um responde a uma pergunta diferente:
 *
 *    1. PARTICIPANTE — vê os atalhos da participação e NÃO vê a prova de RBAC
 *       (`role-summary`/`permissions`), que mudou de casa para `/conta`;
 *    2. GESTOR (ADMIN) — vê o botão de contexto e os contadores da instituição;
 *    3. EXCESSO (OWNER + SPEAKER + patrocínio + prazo) — o teto de cinco corta e a
 *       tela ANUNCIA quantos atalhos ficaram de fora;
 *    4. FINANCE — o perfil sem destino: nenhum bloco, e a tela diz por quê (é a
 *       decisão declarada da fase: não há tela de financeiro/billing para apontar);
 *    5. CHAIR — o parecer aponta para `/revisoes`, e a tela de lá é honesta mesmo
 *       vazia; o comitê NÃO ganhou bloco próprio (a regra tem um `path` por bloco);
 *    6. CONVITE — um convite pendente em OUTRA instituição aparece no bloco cujo
 *       destino é `/conta#seus-acessos` (o fato é da pessoa, não da casa).
 *
 *  A fixture nasce pelos helpers de sempre e é APAGADA no fim (`cleanupRun`); nada
 *  depende do seed de demonstração nem de outro arquivo (a regra de independência
 *  do `helpers.ts`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
  uniqueEmail,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const TENANT_LABEL = 'f84-painel';
const TENANT_NAME = `Instituto do Painel do Perfil ${RUN_ID}`;
const ORIGEM = 'http://localhost:3000';

let tenantSlug: string;
let tenantId: string;
let eventId: string;
let activityId: string;

let emailDoParticipante: string;
let emailDoGestor: string;
let emailDoExcesso: string;
let emailDoFinanceiro: string;
let emailDoChair: string;
let emailDoConvite: string;

async function signUpVia(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; email: string }> {
  const endereco = uniqueEmail('f84');

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: ORIGEM },
    data: { name, email: endereco, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({
    where: { email: endereco },
    select: { id: true },
  });

  return { id: user.id, email: endereco };
}

async function signInAs(page: Page, endereco: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', { headers: { origin: ORIGEM } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: ORIGEM },
    data: { email: endereco, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${endereco}: HTTP ${response.status()}`);
}

/**
 * Uma passagem pelo contexto da instituição, do mesmo jeito que os helpers fazem.
 *
 * `sponsor_users` está sob FORCE RLS (nem o admin lê sem `app.tenant_id` na
 * transação), e o vínculo de patrocinador é o FATO que liga o bloco
 * `patrocinador` — não a permissão `sponsor:read`, que está no pacote mínimo de
 * todo mundo (a lição da FASE 59).
 */
async function criarVinculoDePatrocinador(userId: string): Promise<void> {
  const sponsorId = randomUUID();

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.sponsor.create({
      data: {
        id: sponsorId,
        tenantId,
        name: `Padaria do Painel ${RUN_ID}`,
        slug: `padaria-painel-${RUN_ID}`,
      },
    });

    await tx.sponsorUser.create({
      data: {
        id: randomUUID(),
        tenantId,
        sponsorId,
        userId,
        status: 'ACTIVE',
        acceptedAt: new Date(),
      },
    });
  });
}

/**
 * A vaga RETIDA devendo confirmação — o fato de "algo com prazo".
 *
 * A atividade nasce pelo helper (todas as colunas dele) e ganha a política
 * `REQUIRED` aqui: é o mesmo caminho de `fixarJanela` no `f62` — reescrever o dado
 * depois que ele existe.
 */
async function criarVagaRetida(userId: string): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.activity.update({
      where: { id: activityId },
      data: {
        confirmationPolicy: 'REQUIRED',
        confirmationRequirements: JSON.stringify(['Documento com foto']),
        confirmationPlace: 'Secretaria do evento',
      },
    });

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        userId,
        status: 'PENDING',
        confirmationDueAt: new Date(Date.now() + 3 * 86_400_000),
      },
    });
  });
}

/** A inscrição CONFIRMADA do participante — o fato do bloco `participacao`. */
async function inscreverConfirmado(userId: string, activity: string): Promise<void> {
  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: activity,
        userId,
        status: 'CONFIRMED',
      },
    });
  });
}

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });

  try {
    const tenant = await createTenant({ label: TENANT_LABEL, name: TENANT_NAME });
    tenantId = tenant.id;
    tenantSlug = tenant.slug;

    const event = await createEvent({
      tenantId,
      slug: `painel-${RUN_ID}`,
      title: `Congresso do Painel ${RUN_ID}`,
      status: 'REGISTRATION_OPEN',
    });
    eventId = event.id;

    const activity = await createActivity({
      tenantId,
      eventId,
      slug: `oficina-painel-${RUN_ID}`,
      title: 'Oficina do Painel',
    });
    activityId = activity.id;

    const segundaAtividade = await createActivity({
      tenantId,
      eventId,
      slug: `mesa-painel-${RUN_ID}`,
      title: 'Mesa do Painel',
    });

    const participante = await signUpVia(api, 'Participante do Painel');
    emailDoParticipante = participante.email;
    await linkUser({ tenantId, userId: participante.id, kind: 'PARTICIPANT' });
    await grantRole({ tenantId, userId: participante.id, role: 'PARTICIPANT' });
    await e2eDb.user.update({ where: { id: participante.id }, data: { emailVerified: true } });
    await inscreverConfirmado(participante.id, segundaAtividade.id);

    const gestor = await signUpVia(api, 'Gestor do Painel');
    emailDoGestor = gestor.email;
    await linkUser({ tenantId, userId: gestor.id });
    await grantRole({ tenantId, userId: gestor.id, role: 'ADMIN' });
    await e2eDb.user.update({ where: { id: gestor.id }, data: { emailVerified: true } });

    /**
     * O perfil do EXCESSO: gestão + palestrante + patrocínio + prazo. Ele é o único
     * que chega a SETE destinos distintos (o `acuacao-prazo` colapsa com
     * `participacao`), e é o caso em que a frase "e mais N atalhos" aparece.
     */
    const excesso = await signUpVia(api, 'Dona do Painel Cheio');
    emailDoExcesso = excesso.email;
    await linkUser({ tenantId, userId: excesso.id });
    await grantRole({ tenantId, userId: excesso.id, role: 'OWNER' });
    await grantRole({
      tenantId,
      userId: excesso.id,
      role: 'SPEAKER',
      scope: 'ACTIVITY',
      activityId,
      eventId,
    });
    await criarVinculoDePatrocinador(excesso.id);
    await criarVagaRetida(excesso.id);
    await e2eDb.user.update({ where: { id: excesso.id }, data: { emailVerified: true } });

    const financeiro = await signUpVia(api, 'Financeiro do Painel');
    emailDoFinanceiro = financeiro.email;
    await linkUser({ tenantId, userId: financeiro.id });
    await grantRole({ tenantId, userId: financeiro.id, role: 'FINANCE' });
    await e2eDb.user.update({ where: { id: financeiro.id }, data: { emailVerified: true } });

    const chair = await signUpVia(api, 'Coordenação do Painel');
    emailDoChair = chair.email;
    await linkUser({ tenantId, userId: chair.id });
    await grantRole({ tenantId, userId: chair.id, role: 'CHAIR' });
    await e2eDb.user.update({ where: { id: chair.id }, data: { emailVerified: true } });

    /**
     * ─────────────────────────────────────────────────────────────────────────
     *  O CONVITE É UM FATO GLOBAL — e por isso tem bloco no painel de OUTRA casa
     * ─────────────────────────────────────────────────────────────────────────
     *  A pessoa entra aqui (vínculo ATIVO, sem papel) e tem um convite esperando
     *  numa SEGUNDA instituição. O bloco só existe se o painel olhar para os
     *  vínculos `INVITED` — que é o que a fase pede — e o destino é `/conta`, não
     *  `/t/<slug>/convite` (o aceite exige o código do e-mail, e a rota sem código
     *  responde "convite não encontrado").
     */
    const convidada = await signUpVia(api, 'Convidada do Painel');
    emailDoConvite = convidada.email;
    await linkUser({ tenantId, userId: convidada.id });

    const outraCasa = await createTenant({
      label: 'f84-convidante',
      name: `Instituto Convidante ${RUN_ID}`,
    });
    await linkUser({ tenantId: outraCasa.id, userId: convidada.id, status: 'INVITED' });
    await e2eDb.user.update({ where: { id: convidada.id }, data: { emailVerified: true } });
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

test.describe('o painel por perfil', () => {
  test('1. participante: os atalhos da participação, sem a prova de RBAC', async ({ page }) => {
    await signInAs(page, emailDoParticipante);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    // Os blocos do perfil, com os destinos canônicos.
    const participacao = page.getByTestId('dashboard-block-participacao');
    await expect(participacao).toBeVisible();
    await expect(participacao).toHaveAttribute('href', `/t/${tenantSlug}/minhas-inscricoes`);
    await expect(participacao).toContainText('1 inscrição');

    const submissoes = page.getByTestId('dashboard-block-submissoes');
    await expect(submissoes).toBeVisible();
    await expect(submissoes).toHaveAttribute('href', `/t/${tenantSlug}/submissoes`);

    // A gestão não é dele, e o contador da instituição também não.
    await expect(page.getByTestId('dashboard-block-gestao')).toHaveCount(0);
    await expect(page.getByTestId('stats')).toHaveCount(0);

    // A prova do RBAC mora em /conta desde esta fase.
    await expect(page.getByTestId('role-summary')).toHaveCount(0);
    await expect(page.getByTestId('permissions')).toHaveCount(0);

    // O botão de contexto é de TODOS os perfis (é a saída do painel).
    await expect(page.getByTestId('dashboard-context')).toBeVisible();

    // Dois blocos cabem no teto: nada a anunciar.
    await expect(page.getByTestId('dashboard-hidden')).toHaveCount(0);
  });

  test('2. gestor: o botão de contexto e os contadores da instituição', async ({ page }) => {
    await signInAs(page, emailDoGestor);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    const contexto = page.getByTestId('dashboard-context');
    await expect(contexto).toBeVisible();
    await expect(contexto).toContainText(TENANT_NAME);
    await expect(contexto).toContainText('Trocar');
    await expect(contexto).toHaveAttribute('href', '/selecionar-instituicao');

    /**
     * `stats` é o contrato do PERFIL DE GESTÃO: os contadores vêm de
     * `getAdminOverview` (uma fonte, com `deletedAt`) e mostram a instituição
     * inteira. A fixture tem 1 evento e 2 atividades.
     */
    const stats = page.getByTestId('stats');
    await expect(stats).toBeVisible();
    await expect(stats).toContainText('Eventos');
    await expect(stats).toContainText('Atividades');

    const gestao = page.getByTestId('dashboard-block-gestao');
    await expect(gestao).toBeVisible();
    await expect(gestao).toHaveAttribute('href', `/t/${tenantSlug}/administracao/eventos`);

    await expect(page.getByTestId('role-summary')).toHaveCount(0);
    await expect(page.getByTestId('permissions')).toHaveCount(0);
  });

  test('3. o teto corta e a tela ANUNCIA o que ficou de fora', async ({ page }) => {
    await signInAs(page, emailDoExcesso);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    /**
     * Sete destinos distintos (a vaga retida colapsa com inscrições): o painel
     * desenha os cinco de maior precedência e diz que há mais dois.
     */
    await expect(page.getByTestId('dashboard-block-acuacao-prazo')).toBeVisible();
    await expect(page.getByTestId('dashboard-block-gestao')).toBeVisible();
    await expect(page.getByTestId('dashboard-block-palestrante')).toBeVisible();

    // Os dois da cauda ficaram de fora…
    await expect(page.getByTestId('dashboard-block-patrocinador')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-block-equipe')).toHaveCount(0);

    // …e a tela NÃO os esconde em silêncio: a frase é do domínio.
    const escondidos = page.getByTestId('dashboard-hidden');
    await expect(escondidos).toBeVisible();
    await expect(escondidos).toContainText('e mais 2 atalhos');
  });

  test('4. FINANCE: nenhum bloco, e a tela diz por quê', async ({ page }) => {
    await signInAs(page, emailDoFinanceiro);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    /**
     * O papel tem oito permissões (billing, patrocínio, analytics e leitura de
     * inscrições) e NENHUMA tela de financeiro/billing existe no App Router para
     * onde apontar. A decisão da fase foi não inventar bloco: o painel mostra o
     * estado vazio e leva aos acessos em `/conta`.
     */
    await expect(page.getByTestId('dashboard-empty')).toBeVisible();
    await expect(page.getByTestId('dashboard-blocks')).toHaveCount(0);
    await expect(page.getByTestId('stats')).toHaveCount(0);

    // O caminho para a resposta (papéis e permissões) está a um clique.
    await expect(
      page.getByTestId('dashboard-empty').getByRole('link', { name: 'Minha conta' }),
    ).toHaveAttribute('href', '/conta#seus-acessos');

    await expect(page.getByTestId('dashboard-context')).toBeVisible();
  });

  test('5. CHAIR: o parecer leva a /revisoes — o comitê não tem bloco próprio', async ({
    page,
  }) => {
    await signInAs(page, emailDoChair);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    const pareceres = page.getByTestId('dashboard-block-pareceres');
    await expect(pareceres).toBeVisible();
    await expect(pareceres).toHaveAttribute('href', `/t/${tenantSlug}/revisoes`);

    /**
     * A cadeira vê a gestão científica no COMITÊ (`/comite`, que exige
     * `submission:read:any`) e o bloco da regra aponta para `/revisoes`, que abre
     * para qualquer vínculo. A regra tem UM `path` por bloco, então a alternativa
     * (duas rotas no mesmo cartão) foi recusada — e o estado vazio de `/revisoes`
     * é o que a cadeira encontra. Aqui ele é medido, não suposto.
     */
    await pareceres.click();
    await expect(page).toHaveURL(new RegExp(`/t/${tenantSlug}/revisoes$`));
    await expect(
      page.getByText('Você não tem pareceres atribuídos no momento.'),
    ).toBeVisible();
  });

  test('6. convite pendente em outra casa: o bloco leva a /conta, não à rota sem código', async ({
    page,
  }) => {
    await signInAs(page, emailDoConvite);
    await page.goto(`/t/${tenantSlug}/dashboard`);

    /**
     * A conta tem vínculo ATIVO aqui (sem papel) e um convite `INVITED` noutra
     * instituição. O convite é um fato GLOBAL: o bloco aparece neste painel e
     * aponta para a seção de acessos de `/conta` — a rota `t/<slug>/convite` sem
     * código responderia "convite não encontrado", e a tela não inventa um botão
     * que não teria efeito.
     */
    const convite = page.getByTestId('dashboard-block-convite');
    await expect(convite).toBeVisible();
    await expect(convite).toHaveAttribute('href', '/conta#seus-acessos');

    // Nenhum outro bloco: os papéis desta casa não abrem nada.
    await expect(page.getByTestId('dashboard-block-participacao')).toHaveCount(0);
    await expect(page.getByTestId('dashboard-block-gestao')).toHaveCount(0);
    await expect(page.getByTestId('stats')).toHaveCount(0);
  });
});
