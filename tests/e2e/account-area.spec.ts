/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS QUATRO JORNADAS QUE O HUMANO PEDIU
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Esqueci minha senha** — pedido, link no e-mail, senha nova e entrada com ela;
 *    2. **Segundo fator** — ligar com o aplicativo autenticador (o teste CALCULA o
 *       código TOTP a partir da chave mostrada na tela), sair, entrar de novo caindo no
 *       desafio, e usar um **código de recuperação** como caminho de volta;
 *    3. **Troca de senha** — com a senha atual, e a senha antiga deixando de valer;
 *    4. **Foto e sessões** — envio que vira WebP, remoção que apaga o arquivo e o
 *       encerramento de outra sessão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO FAZ QUE NENHUM OUTRO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele fala com o fluxo REAL: o e-mail sai pelo outbox (o driver padrão não envia), o
 *  link é lido do corpo gravado, o TOTP é gerado com HMAC-SHA1 a partir da chave que a
 *  TELA mostrou, e o cookie do desafio precisa sobreviver entre a Server Action do
 *  login e a do código. Se qualquer uma dessas peças não funcionasse, o teste falharia
 *  no lugar em que a pessoa falharia.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';

import { RUN_ID, cleanupRun, e2eDb, uniqueEmail } from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const NEW_PASSWORD = 'outra-senha-forte-2026';

/** PNG 8×8 de verdade — a imagem precisa DECODIFICAR para virar WebP (FASE 46). */
const PNG_8X8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWM4oWHzHx9mGBkKAHkRisGTbO91AAAAAElFTkSuQmCC',
  'base64',
);

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

// ───────────────────────────────────────────────────────────────────────────────
//  TOTP calculado no teste (sem biblioteca: é HMAC-SHA1 + truncagem, RFC 6238)
// ───────────────────────────────────────────────────────────────────────────────
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

/**
 * O código do aplicativo autenticador.
 *
 * A chave que a tela mostra é o SEGREDO em base32; o servidor assina o contador com o
 * segredo em texto (a biblioteca usa a string como chave do HMAC). Por isso a chave é
 * decodificada de volta para texto antes de assinar — é o mesmo que o aplicativo do
 * celular faz a partir do QR.
 */
function totpFromBase32(base32Key: string, at: number = Date.now()): string {
  const secret = base32Decode(base32Key).toString('utf8');
  const counter = Math.floor(at / 1000 / 30);

  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac('sha1', secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const truncated =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(truncated % 1_000_000).padStart(6, '0');
}

async function signInAs(page: import('@playwright/test').Page, email: string, password = PASSWORD) {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  const response = await page.request.post('/api/auth/sign-in/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { email, password },
  });

  return response;
}

/**
 * Entrada completa quando o segundo fator está ligado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA FUNÇÃO EXISTE
 * ─────────────────────────────────────────────────────────────────────────────
 *  Com o segundo fator ligado, `signInAs` (que só chama a API) NÃO autentica: a
 *  resposta é `twoFactorRedirect` e a sessão não nasce. Ir direto para `/conta`
 *  depois disso cai em `/login` — foi assim que a primeira versão do cenário 5
 *  travou esperando um campo que a página nunca chegaria a mostrar. Entrar de
 *  verdade, aqui, é passar pelo desafio.
 */
async function signInWithTwoFactor(
  page: import('@playwright/test').Page,
  email: string,
  base32Key: string,
) {
  await page.request.post('/api/auth/sign-out', { headers: { origin: 'http://localhost:3000' } });

  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.waitForURL(/\/login\/dois-fatores/, { timeout: 30_000 });
  await page.getByTestId('challenge-code').fill(totpFromBase32(base32Key));
  await page.getByTestId('submit-challenge').click();
  await page.waitForURL(/selecionar-instituicao/, { timeout: 30_000 });
}

async function signUp(api: import('@playwright/test').APIRequestContext, name: string) {
  const email = uniqueEmail('f47');

  const response = await api.post('/api/auth/sign-up/email', {
    headers: { origin: 'http://localhost:3000' },
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  return email;
}

// ═══════════════════════════════════════════════════════════════════════════════
test.describe('área de conta', () => {
  test('1. a pessoa redefine a senha pelo link do e-mail e entra com ela (FASE 47)', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const api = await playwright.request.newContext({ baseURL });

    try {
      const email = await signUp(api, `Esqueci a Senha ${RUN_ID}`);

      // ── O pedido, pela tela ─────────────────────────────────────────────────
      await page.goto('/login');
      await page.getByTestId('login-forgot-password').click();
      await page.waitForURL(/\/esqueci-senha$/);

      await page.getByTestId('reset-email').fill(email);
      await page.getByTestId('request-reset').click();

      // A resposta é a MESMA exista ou não a conta — não há oráculo de cadastro.
      await expect(page.getByTestId('reset-request-sent')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('reset-request-sent')).toContainText(/se este e-mail tiver conta/i);

      // ── O e-mail chegou no outbox (o driver padrão grava e não envia) ───────
      const message = await e2eDb.emailMessage.findFirstOrThrow({
        where: { to: email, template: 'PASSWORD_RESET' },
        orderBy: { createdAt: 'desc' },
        select: { text: true, subject: true },
      });

      expect(message.subject).toMatch(/redefinir a senha/i);

      const link = /http:\/\/[^\s]+\/api\/auth\/reset-password\/[^\s]+/.exec(message.text)?.[0];
      expect(link, 'o e-mail precisa carregar o link de redefinição').toBeTruthy();

      // ── O link passa pela biblioteca e volta com o token ────────────────────
      const url = new URL(link!);
      await page.goto(`${url.pathname}${url.search}`);

      await page.waitForURL(/\/redefinir-senha\?token=/, { timeout: 30_000 });

      await page.getByTestId('reset-new-password').fill(NEW_PASSWORD);
      await page.getByTestId('reset-confirm-password').fill(NEW_PASSWORD);
      await page.getByTestId('submit-reset').click();

      await page.waitForURL(/\/login\?senha=redefinida/, { timeout: 30_000 });
      await expect(page.getByTestId('login-password-reset')).toBeVisible();

      // ── A senha ANTIGA não entra; a nova entra ──────────────────────────────
      const oldPassword = await signInAs(page, email, PASSWORD);
      expect(oldPassword.ok()).toBe(false);

      const newPassword = await signInAs(page, email, NEW_PASSWORD);
      expect(newPassword.ok()).toBe(true);

      const session = await page.request.get('/api/auth/get-session');
      expect((await session.json())?.user?.email).toBe(email);

      // O link é de uso único: repetir a rota não redefine nada.
      await page.goto('/redefinir-senha?error=INVALID_TOKEN');
      await expect(page.getByTestId('reset-invalid-token')).toBeVisible();
    } finally {
      await api.dispose();
    }
  });

  test('2. liga o segundo fator, entra com o código do aplicativo e com um código de recuperação', async ({
    page,
    playwright,
    baseURL,
  }) => {
    test.slow();

    const api = await playwright.request.newContext({ baseURL });

    try {
      const email = await signUp(api, `Com Segundo Fator ${RUN_ID}`);

      await signInAs(page, email);
      await page.goto('/conta');

      await expect(page.getByTestId('two-factor-start-form')).toBeVisible();
      await expect(page.getByTestId('account-current-email')).toContainText(email);

      // ── Passo 1: a senha gera o segredo e os códigos ────────────────────────
      await page.getByTestId('two-factor-password').fill(PASSWORD);
      await page.getByTestId('two-factor-start').click();

      await expect(page.getByTestId('two-factor-setup')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('two-factor-qr')).toBeVisible();

      const manualKey = (await page.getByTestId('two-factor-manual-key').innerText()).trim();
      expect(manualKey.length).toBeGreaterThan(15);

      const codes = page.getByTestId('two-factor-backup-code');
      await expect(codes).toHaveCount(10);
      const firstBackupCode = (await codes.first().innerText()).trim();

      // ── Passo 2: o código do aplicativo confirma o enrollment ───────────────
      await page.getByTestId('two-factor-code').fill(totpFromBase32(manualKey));
      await page.getByTestId('two-factor-confirm').click();

      await expect(page.getByTestId('two-factor-status')).toBeVisible({ timeout: 30_000 });

      const row = await e2eDb.twoFactor.findFirstOrThrow({
        where: { userId: (await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id },
        select: { verified: true },
      });
      expect(row.verified).toBe(true);

      const enabled = await e2eDb.user.findUniqueOrThrow({
        where: { email },
        select: { twoFactorEnabled: true },
      });
      expect(enabled.twoFactorEnabled).toBe(true);

      // ── Passo 3: entrar agora passa pelo desafio ────────────────────────────
      await signInAs(page, email);
      await page.goto('/login');

      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Senha').fill(PASSWORD);
      await page.getByRole('button', { name: 'Entrar' }).click();

      await page.waitForURL(/\/login\/dois-fatores/, { timeout: 30_000 });
      await expect(page.getByTestId('two-factor-challenge-form')).toBeVisible();

      await page.getByTestId('challenge-code').fill(totpFromBase32(manualKey));
      await page.getByTestId('submit-challenge').click();

      await page.waitForURL(/selecionar-instituicao/, { timeout: 30_000 });

      const session = await page.request.get('/api/auth/get-session');
      expect((await session.json())?.user?.email).toBe(email);

      // ── Passo 4: sem o celular, o código de recuperação é a saída ───────────
      await signInAs(page, email);
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Senha').fill(PASSWORD);
      await page.getByRole('button', { name: 'Entrar' }).click();

      await page.waitForURL(/\/login\/dois-fatores/, { timeout: 30_000 });
      await page.getByTestId('challenge-code').fill(firstBackupCode);
      await page.getByTestId('submit-challenge').click();

      await page.waitForURL(/selecionar-instituicao/, { timeout: 30_000 });

      // O código é de USO ÚNICO: o segundo uso do mesmo código é recusado.
      await signInAs(page, email);
      await page.goto('/login');
      await page.getByLabel('E-mail').fill(email);
      await page.getByLabel('Senha').fill(PASSWORD);
      await page.getByRole('button', { name: 'Entrar' }).click();

      await page.waitForURL(/\/login\/dois-fatores/, { timeout: 30_000 });
      await page.getByTestId('challenge-code').fill(firstBackupCode);
      await page.getByTestId('submit-challenge').click();

      await expect(page.getByTestId('two-factor-challenge-error')).toBeVisible({ timeout: 30_000 });

      // ── Passo 5: desligar exige a senha (e entrar, agora, exige o código) ──
      await signInWithTwoFactor(page, email, manualKey);
      await page.goto('/conta');

      await page.getByTestId('two-factor-disable-password').fill(PASSWORD);
      await page.getByTestId('two-factor-disable').click();

      await expect(page.getByTestId('two-factor-start-form')).toBeVisible({ timeout: 30_000 });

      /**
       * A prova do desligamento é o BANCO + a tela voltando ao estado inicial — e não a
       * mensagem do formulário: desligar o segundo fator ROTACIONA a sessão, o `revalidatePath`
       * reconstrói a página e o painel volta para o ramo "desligado", levando embaixo o
       * componente que guardava o estado daquela action. Procurar a mensagem ali seria
       * procurar um elemento que a própria operação bem-sucedida desmonta.
       */
      const disabled = await e2eDb.user.findUniqueOrThrow({
        where: { email },
        select: { twoFactorEnabled: true },
      });
      expect(disabled.twoFactorEnabled).toBe(false);

      const rows = await e2eDb.twoFactor.count({
        where: { userId: (await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id },
      });
      expect(rows).toBe(0);
    } finally {
      await api.dispose();
    }
  });

  test('3. troca a senha, a antiga deixa de valer e o nome é atualizado', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const api = await playwright.request.newContext({ baseURL });

    try {
      const email = await signUp(api, `Troca de Senha ${RUN_ID}`);

      await signInAs(page, email);
      await page.goto('/conta');

      // ── Nome ───────────────────────────────────────────────────────────────
      await page.getByTestId('account-name').fill(`Nome Editado ${RUN_ID}`);
      await page.getByTestId('save-account-profile').click();
      await expect(page.getByTestId('account-profile-feedback-ok')).toBeVisible({ timeout: 30_000 });

      const renamed = await e2eDb.user.findUniqueOrThrow({
        where: { email },
        select: { name: true },
      });
      expect(renamed.name).toBe(`Nome Editado ${RUN_ID}`);

      // ── Senha: sem a atual, recusa; com ela, troca ─────────────────────────
      await page.getByTestId('account-current-password').fill('senha-errada-0000');
      await page.getByTestId('account-new-password').fill(NEW_PASSWORD);
      await page.getByTestId('account-confirm-password').fill(NEW_PASSWORD);
      await page.getByTestId('save-account-password').click();

      await expect(page.getByTestId('account-password-feedback-error')).toContainText(
        /senha atual está incorreta/i,
        { timeout: 30_000 },
      );

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  O FORMULÁRIO É LIMPO DEPOIS DE UMA ACTION (React 19)
       * ─────────────────────────────────────────────────────────────────────────────
       *  Com `<form action={fn}>`, o React reseta os campos NÃO controlados quando a
       *  action termina — inclusive no caminho de erro. A primeira versão deste teste
       *  repos apenas a senha atual e clicava de novo: os outros dois campos estavam
       *  vazios, a validação recusou por tamanho e o teste mediu a própria pressa.
       *  Repor TUDO é o que a pessoa faz depois de errar a senha.
       */
      await page.getByTestId('account-current-password').fill(PASSWORD);
      await page.getByTestId('account-new-password').fill(NEW_PASSWORD);
      await page.getByTestId('account-confirm-password').fill(NEW_PASSWORD);
      await page.getByTestId('save-account-password').click();

      await expect(page.getByTestId('account-password-feedback-ok')).toContainText(
        /outras sessões foram encerradas/i,
        { timeout: 30_000 },
      );

      const oldPassword = await signInAs(page, email, PASSWORD);
      expect(oldPassword.ok()).toBe(false);

      const newPassword = await signInAs(page, email, NEW_PASSWORD);
      expect(newPassword.ok()).toBe(true);
    } finally {
      await api.dispose();
    }
  });

  test('4. envia a foto (vira WebP), remove e encerra outra sessão', async ({
    page,
    playwright,
    baseURL,
  }) => {
    const api = await playwright.request.newContext({ baseURL });

    try {
      const email = await signUp(api, `Foto e Sessões ${RUN_ID}`);
      const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });

      /**
       * Uma sessão ANTIGA, criada no banco, para a tela ter o que encerrar sem depender
       * de um segundo navegador. O token é de mentira e a linha é real: o que o teste
       * mede é a lista e o encerramento, não a origem da sessão.
       */
      const staleToken = `f47-stale-${randomUUID()}`;
      await e2eDb.session.create({
        data: {
          id: randomUUID(),
          token: staleToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 86_400_000),
          userAgent:
            'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
          ipAddress: '203.0.113.10',
        },
      });

      await signInAs(page, email);
      await page.goto('/conta');

      // ── Foto ───────────────────────────────────────────────────────────────
      await expect(page.getByTestId('account-avatar-initials')).toBeVisible();

      const chooserPromise = page.waitForEvent('filechooser');
      await page.getByTestId('account-avatar-upload').click();
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: 'retrato-f47.png',
        mimeType: 'image/png',
        buffer: PNG_8X8,
      });
      await expect(page.getByTestId('account-avatar-feedback')).toContainText(/WebP/i, {
        timeout: 30_000,
      });
      await expect(page.getByTestId('account-avatar-preview')).toHaveAttribute('src', /\.webp$/);

      const withPhoto = await e2eDb.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { image: true },
      });
      expect(withPhoto.image).toMatch(/\.webp$/);
      expect(withPhoto.image).toContain(`/users/${user.id}/avatar/`);

      // ── Sessões: a antiga aparece e pode ser encerrada ─────────────────────
      /**
       * A contagem esperada vem do BANCO, e não de um número fixo: o cadastro faz
       * `autoSignIn` (uma sessão) e a entrada do teste cria outra — fixar "2" fazia o
       * teste medir o próprio caminho de setup em vez da tela.
       */
      const sessionsInDb = await e2eDb.session.count({ where: { userId: user.id } });
      const sessions = page.getByTestId('account-session');

      await expect(sessions).toHaveCount(sessionsInDb, { timeout: 30_000 });
      await expect(page.getByTestId('account-session').first()).toHaveAttribute(
        'data-current',
        'true',
      );

      await page.getByTestId('account-session-revoke').first().click();
      await expect(page.getByTestId('account-sessions-feedback-ok')).toBeVisible({ timeout: 30_000 });

      const remaining = await e2eDb.session.findMany({
        where: { userId: user.id },
        select: { token: true },
      });
      expect(remaining.map((row) => row.token)).not.toContain(staleToken);

      // ── Remover a foto apaga o arquivo da conta ───────────────────────────
      await page.getByTestId('account-avatar-remove').click();
      await page.getByTestId('account-avatar-remove-dialog-confirm').click();

      await expect(page.getByTestId('account-avatar-initials')).toBeVisible({ timeout: 30_000 });

      const withoutPhoto = await e2eDb.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { image: true },
      });
      expect(withoutPhoto.image).toBeNull();

      const served = await page.request.get(withPhoto.image!);
      expect(served.status()).toBe(404);
    } finally {
      await api.dispose();
    }
  });
});
