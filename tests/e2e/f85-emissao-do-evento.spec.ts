/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — A EMISSÃO EM LOTE É DO EVENTO (FASE 85 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, E POR QUE NENHUM OUTRO PROVAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `IssueBatchPanel` existia desde a FASE 6/36 e **nenhum teste o abria**: a
 *  busca por `issue-batch|issue-panel|issue-feedback` em `tests/` devolvia zero.
 *  A tela da instituição emitia pelo `<select>` de eventos, mas o cartão de
 *  RESULTADO da raiz do evento apontava para o INVENTÁRIO — o organizador clicava
 *  em "Certificados" esperando a emissão do evento e recebia a lista de documentos
 *  de todos eles.
 *
 *  Os três cenários cobrem o caminho inteiro e os dois lados do escopo:
 *
 *    1. o cartão "Certificados" do grupo Resultado leva à tela do EVENTO, o painel
 *       sabe de que evento é, o disparo emite de verdade (há linha em
 *       `certificates`), e o link do inventário abre filtrado por este evento;
 *    2. um evento sem ninguém elegível responde ZERO — sem inventar documento;
 *    3. um evento de OUTRA instituição (uuid bem formado) é 404: o pertencimento
 *       não é conferido pela tela, e sim pela consulta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE É A DA F51 (presença medida acima dos 75 %)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A elegibilidade do minicurso exige o FATO gravado: inscrição + frequência
 *  suficiente. O certificado nasce `QUEUED` e é o worker que gera o arquivo — o
 *  que este spec mede é a EMISSÃO (a linha e o código), não o PDF; o PDF já é
 *  provado por `certification.spec.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createActivity,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Cria a conta pela API e concede o papel — o caminho das outras specs de RBAC. */
async function criarPessoa(
  page: import('@playwright/test').Page,
  input: {
    tenantId: string;
    name: string;
    role: 'ADMIN' | 'PARTICIPANT';
  },
): Promise<{ id: string; email: string; name: string }> {
  const email = `f85.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name: input.name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${input.name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

  await linkUser({
    tenantId: input.tenantId,
    userId: user.id,
    kind: input.role === 'PARTICIPANT' ? 'PARTICIPANT' : 'MEMBER',
  });
  await grantRole({ tenantId: input.tenantId, userId: user.id, role: input.role });

  return { id: user.id, email, name: input.name };
}

async function signInAs(page: import('@playwright/test').Page, email: string): Promise<void> {
  await page.request.post('/api/auth/sign-out', {
    headers: { origin: 'http://localhost:3000' },
  });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password: PASSWORD },
  });

  if (!response.ok()) throw new Error(`Falha ao autenticar ${email}: HTTP ${response.status()}`);
}

/** Presença completa: inscrição `ATTENDED` + minutos registrados no minicurso. */
async function gravarPresenca(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  userId: string;
  minutes?: number;
}): Promise<void> {
  const minutes = input.minutes ?? 60;
  const start = new Date(Date.now() - 3 * 3_600_000);

  await e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${input.tenantId}, true)`;

    const registrationId = randomUUID();

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        userId: input.userId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: start,
        badgeToken: `BADGE-${registrationId.slice(0, 12)}`,
      },
    });

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        eventId: input.eventId,
        activityId: input.activityId,
        registrationId,
        userId: input.userId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: start,
        checkedOutAt: new Date(start.getTime() + minutes * 60_000),
        minutesAttended: minutes,
      },
    });
  });
}

/** Os certificados emitidos no evento — a prova de que o lote criou documento. */
async function lerCertificados(tenantId: string, eventId: string) {
  return e2eDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    return tx.certificate.findMany({
      where: { tenantId, eventId },
      orderBy: { createdAt: 'asc' },
      select: { validationCode: true, kind: true, userId: true, status: true },
    });
  });
}

test.describe('a emissão em lote do evento', () => {
  test('1. o cartão do Resultado abre a tela do evento e EMITE para quem tem presença', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const tenant = await createTenant({ label: 'f85-emissao', name: `Instituição Emissão ${RUN_ID}` });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-emissao-${RUN_ID}`,
      title: `Congresso da Emissão ${RUN_ID}`,
    });

    const activity = await createActivity({
      tenantId: tenant.id,
      eventId: event.id,
      slug: `minicurso-emissao-${RUN_ID}`,
      title: `Minicurso da Emissão ${RUN_ID}`,
      workloadMinutes: 60,
      type: 'MINI_COURSE',
    });

    const participant = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Participante Emitida ${RUN_ID}`,
      role: 'PARTICIPANT',
    });

    await gravarPresenca({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: participant.id,
    });

    /**
     * ─── A PESSOA QUE FICA DE FORA (FASE 85 · fatia 2) ─────────────────────────
     *  10 de 60 min ficam abaixo dos 45 exigidos (75 % da carga). Ela é candidata
     *  (tem presença registrada), não é elegível — e a tela tem de MOSTRAR isso
     *  com o motivo do domínio, não esconder a linha.
     */
    const semPresenca = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Participante Abaixo ${RUN_ID}`,
      role: 'PARTICIPANT',
    });

    await gravarPresenca({
      tenantId: tenant.id,
      eventId: event.id,
      activityId: activity.id,
      userId: semPresenca.id,
      minutes: 10,
    });

    const admin = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Organizadora da Emissão ${RUN_ID}`,
      role: 'ADMIN',
    });

    await signInAs(page, admin.email);

    /**
     * ─── A ENTRADA É PELA RAIZ DO EVENTO ──────────────────────────────────────
     *  O caminho que o organizador faz: abre o evento, acha o grupo RESULTADO e
     *  clica no cartão. Ir direto à URL mediria a tela sem medir o CARTÃO — e era
     *  justamente o cartão que apontava para a tela errada.
     */
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}`);

    const cartao = page.getByTestId('event-area-certificados');
    await expect(cartao).toBeVisible();
    await cartao.click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/administracao/eventos/${event.id}/certificados$`),
    );

    /**
     * O painel é o da F6/36, com os MESMOS testids: `issue-panel` (a seção),
     * `issue-batch` (o botão) e `issue-feedback` (a resposta). O testid novo
     * `issue-panel-event` prova que o formulário está preso ao evento da ROTA, e
     * não a um `<select>` escolhido no caminho.
     */
    await expect(page.getByTestId('issue-panel')).toBeVisible();
    await expect(page.getByTestId('issue-panel-event')).toContainText(event.title);

    /**
     * ─── A SIMULAÇÃO DA FATIA 2 ────────────────────────────────────────────────
     *  Duas pessoas no escopo (as duas têm presença), UMA elegível (a que cumpriu
     *  60 de 60) e DUAS tentativas descartadas (a outra pessoa × os dois tipos
     *  simulados). A fração é elegíveis ÷ escopo = 1/2 = 50 %, e não "presença
     *  média".
     */
    await expect(page.getByTestId('issue-scope')).toHaveAttribute('data-value', '2');
    await expect(page.getByTestId('issue-eligible')).toHaveAttribute('data-value', '1');
    await expect(page.getByTestId('issue-eligible')).toContainText('50%');
    await expect(page.getByTestId('issue-discarded-count')).toHaveAttribute('data-value', '2');
    await expect(page.getByTestId('issue-certificates')).toHaveAttribute('data-value', '2');
    await expect(page.getByTestId('issue-estimate')).toBeVisible();
    await expect(page.getByTestId('issue-queue')).toBeVisible();

    /**
     * A lista de descartados é `<details>` NATIVO: abre sem JavaScript, o leitor de
     * tela anuncia o estado, e cada linha é `<li>` com o motivo produzido pelo
     * domínio. O motivo do tipo PRESENÇA é o veredito agregado — o detalhamento
     * "10 min abaixo de 45" fica no `workload`, não no texto do veredito.
     */
    await page.getByTestId('issue-discarded-summary').click();
    const descartados = page.getByTestId('issue-discarded-list');
    await expect(descartados).toBeVisible();
    await expect(descartados).toContainText(semPresenca.name);
    await expect(descartados).toContainText('Nenhuma atividade com presença suficiente');
    await expect(descartados).toContainText('Nenhum minicurso com carga horária cumprida');

    await page.getByTestId('issue-batch').click();

    const feedback = page.getByTestId('issue-feedback');
    await expect(feedback).toContainText(/2 certificado\(s\) solicitado\(s\)/, { timeout: 60_000 });
    await expect(feedback).toContainText(/2 tentativa\(s\) descartada\(s\)/);
    await expect(feedback).not.toContainText('0 certificado(s) solicitado(s)');

    const certificados = await lerCertificados(tenant.id, event.id);
    expect(certificados).toHaveLength(2);
    expect(certificados.every((row) => row.userId === participant.id)).toBe(true);
    expect(certificados.map((row) => row.kind)).toContain('MINI_COURSE');
    expect(certificados[0]?.validationCode).toMatch(/^CERT-[23456789ABCDEFGHJKMNPQRTUVWXY]{8}$/);

    /**
     * ─── O INVENTÁRIO COM O FILTRO DO EVENTO ──────────────────────────────────
     *  O link leva `?evento=<uuid>`; a F76 só descarta o valor MALFORMADO, então
     *  o recorte vale e a lista mostra o documento recém-emitido. Se o filtro
     *  fosse ignorado, a lista misturaria outros eventos — aqui ela é deste.
     */
    await page.getByTestId('certificate-inventory-link').click();

    await expect(page).toHaveURL(
      new RegExp(`/t/${tenant.slug}/administracao/certificados\\?evento=${event.id}$`),
    );
    await expect(page.getByTestId('admin-certificate-list')).toBeVisible();
    await expect(page.getByTestId('admin-certificate-list')).toContainText(participant.name);
  });

  test('2. evento sem ninguém elegível responde ZERO, sem inventar documento', async ({ page }) => {
    test.setTimeout(120_000);

    const tenant = await createTenant({
      label: 'f85-vazio',
      name: `Instituição Sem Elegível ${RUN_ID}`,
    });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-vazio-${RUN_ID}`,
      title: `Evento Sem Elegível ${RUN_ID}`,
    });

    const admin = await criarPessoa(page, {
      tenantId: tenant.id,
      name: `Organizadora do Vazio ${RUN_ID}`,
      role: 'ADMIN',
    });

    await signInAs(page, admin.email);

    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}/certificados`);
    await expect(page.getByTestId('issue-panel')).toBeVisible();

    /**
     * ─── ZERO É RESPOSTA, E A TELA DIZ O QUE ZERO SIGNIFICA ───────────────────
     *  Sem candidato, os quatro contadores são 0 e a estimativa NÃO inventa tempo:
     *  "nada a gerar". A fração não vira 0 % — não há denominador.
     */
    await expect(page.getByTestId('issue-scope')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('issue-eligible')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('issue-discarded-count')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('issue-certificates')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('issue-eligible')).toContainText('sem pessoas no escopo');
    await expect(page.getByTestId('issue-estimate')).toContainText('Nada a gerar');

    await page.getByTestId('issue-discarded-summary').click();
    await expect(page.getByTestId('issue-discarded-empty')).toContainText(
      'Nenhuma tentativa descartada',
    );

    await page.getByTestId('issue-batch').click();

    /**
     * Zero é RESPOSTA, não erro: o painel percorre os candidatos e não acha
     * nenhum. A tela diz isso e o banco continua vazio — "0" não pode ser a
     * mensagem de um lote que emitiu.
     */
    await expect(page.getByTestId('issue-feedback')).toContainText('0 certificado(s) solicitado(s)', {
      timeout: 60_000,
    });

    expect(await lerCertificados(tenant.id, event.id)).toHaveLength(0);
  });

  test('3. evento de OUTRA instituição responde 404, e não "nenhum certificado"', async ({ page }) => {
    test.setTimeout(120_000);

    const daCasa = await createTenant({ label: 'f85-casa', name: `Instituição da Casa ${RUN_ID}` });
    const alheia = await createTenant({ label: 'f85-alheia', name: `Instituição Alheia ${RUN_ID}` });

    const eventoAlheio = await createEvent({
      tenantId: alheia.id,
      slug: `evento-alheio-${RUN_ID}`,
      title: `Evento Alheio ${RUN_ID}`,
    });

    const admin = await criarPessoa(page, {
      tenantId: daCasa.id,
      name: `Organizadora da Casa ${RUN_ID}`,
      role: 'ADMIN',
    });

    await signInAs(page, admin.email);

    /**
     * O uuid é bem formado — o formato passa, e o que recusa é o PERTENCIMENTO
     * (o `tenantId` no `where` de `getAdminEvent`). A tela de erro do painel é a
     * prova: um 200 com "nenhum certificado" faria o organizador acreditar que o
     * evento alheio existe e está vazio.
     */
    const resposta = await page.goto(
      `/t/${daCasa.slug}/administracao/eventos/${eventoAlheio.id}/certificados`,
    );

    expect(resposta?.status()).toBe(404);
    await expect(page.getByTestId('area-not-found-app')).toBeVisible();
  });
});
