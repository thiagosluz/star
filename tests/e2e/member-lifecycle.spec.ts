/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — Ciclo de vida do membro e quota de armazenamento (FASE 21)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PROVA, DO PONTO DE VISTA DE QUEM OPERA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. C5 — o proprietário troca os PAPÉIS de alguém pela tela de equipe, sem
 *         SQL, e os papéis aparecem atualizados na própria lista;
 *      2. C5 — remover o acesso de quem saiu passa pelo DIÁLOGO DO SISTEMA, tira a
 *         pessoa da equipe e DEVOLVE a vaga para a quota do plano;
 *      3. C5 — a própria linha não oferece remover o próprio acesso (a trava que
 *         impede a pessoa de se trancar fora);
 *      4. C4 — a instituição sem espaço vê o aviso no painel e tem o ENVIO RECUSADO
 *         antes de o arquivo sair do navegador, com o motivo escrito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  RUN_ID,
  cleanupRun,
  createEvent,
  createTenant,
  e2eDb,
  grantRole,
  linkUser,
} from './helpers';

const PASSWORD = 'senha-forte-e2e-2026';
const ORIGIN = { origin: 'http://localhost:3000' };

/**
 * PNG 8×8 de verdade — a assinatura do arquivo é o que a validação confere, e a
 * imagem precisa DECODIFICAR para virar WebP (FASE 46).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE FIXTURE MUDOU DE 1×1 PARA 8×8
 * ─────────────────────────────────────────────────────────────────────────────
 *  O PNG 1×1 usado desde a FASE 17 tinha o CRC do `IDAT` ERRADO. O navegador perdoa
 *  e desenha; o libpng recusa o arquivo. Enquanto o conteúdo não era decodificado,
 *  ninguém notou — e a suíte inteira media uploads com um arquivo que não é imagem
 *  decodificável. Com a conversão para WebP, a recusa apareceu.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEklEQVQYlWM4oWHzHx9mGBkKAHkRisGTbO91AAAAAElFTkSuQmCC',
  'base64',
);

test.afterAll(async () => {
  await cleanupRun();
  await e2eDb.$disconnect();
});

/** Cria a conta pela API e entra com ela (o cadastro pela tela tem cenário próprio). */
async function signUpAndSignIn(
  page: import('@playwright/test').Page,
  name: string,
): Promise<{ id: string; email: string }> {
  const email = `f21.${RUN_ID}.${randomUUID().slice(0, 8)}@example.test`;

  const response = await page.request.post('/api/auth/sign-up/email', {
    headers: ORIGIN,
    data: { name, email, password: PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Falha ao cadastrar ${name}: HTTP ${response.status()} ${await response.text()}`);
  }

  const user = await e2eDb.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { id: user.id, email };
}

/**
 * Pessoa que só aparece na LISTA (não entra no navegador): criar pelo banco evita
 * trocar a sessão do contexto — o mesmo motivo pelo qual a inscrição pública não
 * pede login (armadilha 9).
 */
async function createListedUser(name: string): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `f21.lista.${RUN_ID}.${randomUUID().slice(0, 6)}@example.test`;

  await e2eDb.user.create({ data: { id, name: `${name} ${RUN_ID}`, email } });
  return { id, email };
}

test.describe('ciclo de vida do membro', () => {
  test('o proprietário troca papéis e remove o acesso, devolvendo a vaga', async ({ page }) => {
    const tenant = await createTenant({
      label: 'membros-f21',
      name: `Instituição Membros ${RUN_ID}`,
    });

    const owner = await signUpAndSignIn(page, 'Proprietária F21');
    await linkUser({ tenantId: tenant.id, userId: owner.id });
    await grantRole({ tenantId: tenant.id, userId: owner.id, role: 'OWNER' });

    const staff = await createListedUser('Equipe Sem Papel');
    await linkUser({ tenantId: tenant.id, userId: staff.id });

    await page.goto(`/t/${tenant.slug}/administracao/equipe`);
    await expect(page.getByTestId('team-page')).toBeVisible();

    const teamCountBefore = await page.getByTestId('team-member-count').innerText();

    const row = page.locator(`[data-user-id="${staff.id}"]`);
    await expect(row).toContainText('sem papel vigente');

    // ── Concede o papel de equipe de operação ────────────────────────────────
    await row.getByText('Papéis e acesso').click();
    await page.getByTestId(`role-${staff.id}-STAFF`).check();
    await page.getByTestId(`member-roles-${staff.id}`).getByTestId('save-roles-submit').click();

    await expect(page.getByTestId(`member-roles-feedback-${staff.id}`)).toContainText(
      /Papéis atualizados/i,
      { timeout: 20_000 },
    );

    // A lista já mostra o papel com o RÓTULO em português (não o enum).
    await expect(row).toContainText('Equipe de operação');

    // ── Remoção pelo diálogo do sistema ─────────────────────────────────────
    await page.getByTestId(`remove-member-${staff.id}-open`).click();
    await page.getByTestId(`remove-member-${staff.id}-confirm-confirm`).click();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A SINCRONIZAÇÃO É A LINHA QUE SOME (lição da FASE 4)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Esperar o texto "não tem mais acesso" seria esperar por um elemento que o
     *  próprio fluxo DESMONTA: a confirmação vive dentro da linha do membro, e a linha
     *  sai da lista quando o vínculo é removido. O sinal durável é o efeito no dado —
     *  a pessoa sai da tabela e a contagem da quota cai.
     */
    await expect(page.locator(`[data-user-id="${staff.id}"]`)).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByTestId('team-member-count')).not.toHaveText(teamCountBefore);

    // ── A própria linha não oferece remover o próprio acesso ────────────────
    const selfRow = page.locator(`[data-user-id="${owner.id}"]`);
    await selfRow.getByText('Papéis e acesso').click();
    await expect(page.getByTestId(`member-self-${owner.id}`)).toBeVisible();
    await expect(page.getByTestId(`remove-member-${owner.id}`)).toHaveCount(0);
  });

  test('retirar o papel do único proprietário é explicado, não silencioso', async ({ page }) => {
    const tenant = await createTenant({
      label: 'membros-unico-dono',
      name: `Instituição Único Dono ${RUN_ID}`,
    });

    const owner = await signUpAndSignIn(page, 'Dono Único F21');
    await linkUser({ tenantId: tenant.id, userId: owner.id });
    await grantRole({ tenantId: tenant.id, userId: owner.id, role: 'OWNER' });

    await page.goto(`/t/${tenant.slug}/administracao/equipe`);

    const row = page.locator(`[data-user-id="${owner.id}"]`);
    await row.getByText('Papéis e acesso').click();

    // Desmarca o único papel e tenta salvar: a recusa vem do domínio, com o motivo.
    await page.getByTestId(`role-${owner.id}-OWNER`).uncheck();
    await page.getByTestId(`member-roles-${owner.id}`).getByTestId('save-roles-submit').click();

    await expect(page.getByTestId(`member-roles-feedback-${owner.id}`)).toContainText(
      /proprietário/i,
      { timeout: 20_000 },
    );

    // E a seleção volta ao que está no banco: o papel continua marcado.
    await expect(page.getByTestId(`role-${owner.id}-OWNER`)).toBeChecked();
  });
});

test.describe('quota de armazenamento', () => {
  test('sem espaço, o painel avisa e o envio de imagem é recusado', async ({ page }) => {
    const tenant = await createTenant({
      label: 'storage-f21',
      name: `Instituição Sem Espaço ${RUN_ID}`,
    });

    // O plano é ajustado pela plataforma; aqui o banco faz o papel dela.
    await e2eDb.tenant.update({
      where: { id: tenant.id },
      data: { maxStorageBytes: BigInt(0) },
    });

    const owner = await signUpAndSignIn(page, 'Dona do Storage F21');
    await linkUser({ tenantId: tenant.id, userId: owner.id });
    await grantRole({ tenantId: tenant.id, userId: owner.id, role: 'OWNER' });

    const event = await createEvent({
      tenantId: tenant.id,
      slug: `evento-storage-f21-${RUN_ID}`,
      title: `Congresso Sem Espaço ${RUN_ID}`,
      status: 'PUBLISHED',
    });

    // ── O painel mostra o estado e explica o que passa a ser recusado ────────
    await page.goto(`/t/${tenant.slug}/administracao`);
    await expect(page.getByTestId('storage-quota-alert')).toBeVisible();
    await expect(page.getByTestId('storage-total')).toBeVisible();

    // ── O envio é recusado ANTES de o arquivo sair do navegador ─────────────
    await page.goto(`/t/${tenant.slug}/administracao/eventos/${event.id}/pagina/midia`);

    const uploader = page.getByTestId('asset-uploader-GALLERY');
    await uploader.getByLabel('Imagem da galeria').setInputFiles({
      name: 'capa-f21.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await uploader.getByRole('button', { name: /Enviar imagem/i }).click();

    await expect(uploader.getByTestId('asset-status-GALLERY')).toContainText(
      /plano|acervo|quota|espaço/i,
      { timeout: 20_000 },
    );

    // E nada entrou no acervo.
    await expect(page.getByTestId('empty-media')).toBeVisible();
  });
});
