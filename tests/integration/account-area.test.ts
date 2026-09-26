/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Área de conta (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE SÓ O AMBIENTE REAL PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a foto da PESSOA vive em `users/<id>/avatar/…` no bucket público, é convertida
 *      para WebP (FASE 46) e a anterior é APAGADA — sem isso o bucket acumularia uma
 *      imagem por troca, e a promessa de "remover foto" seria só de tela;
 *    • a chave de OUTRA pessoa é recusada (a guarda que impede trocar a foto alheia);
 *    • a visão da conta diz a verdade sobre ter senha (as contas de convite não têm) e
 *      sobre o segundo fator;
 *    • a lista de sessões marca a ATUAL e ordena com ela no topo — a linha que a pessoa
 *      não deve encerrar por engano.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { getAccountOverview, readAccountSessions } from '../../src/lib/auth/account-service';
import {
  confirmUserAvatarUpload,
  objectKeyFromPublicUrl,
  removeUserAvatar,
  requestUserAvatarUpload,
} from '../../src/lib/auth/user-avatar-service';
import { inspectObject } from '../../src/lib/storage/s3-client';

const RUN = randomUUID().slice(0, 8);

let userId: string;
let otherUserId: string;

async function realPng(width = 900, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 80, b: 150 } },
  })
    .png()
    .toBuffer();
}

async function sha256Hex(bytes: Buffer): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

beforeAll(async () => {
  userId = randomUUID();
  otherUserId = randomUUID();

  await adminPrisma.user.create({
    data: { id: userId, name: 'Pessoa Conta', email: `f47.conta.${RUN}@exemplo.test` },
  });

  await adminPrisma.user.create({
    data: { id: otherUserId, name: 'Outra Pessoa', email: `f47.outra.${RUN}@exemplo.test` },
  });
});

afterAll(async () => {
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

/** Percurso REAL do envio: assina, envia para o bucket e confirma. */
async function uploadAvatar(input: { userId: string; body: Buffer; fileName?: string }) {
  const checksum = await sha256Hex(input.body);

  const ticket = await requestUserAvatarUpload({
    userId: input.userId,
    fileName: input.fileName ?? 'retrato.png',
    mimeType: 'image/png',
    sizeBytes: input.body.length,
    magicBytes: [...input.body.subarray(0, 16)],
  });

  expect(ticket.ok, ticket.ok ? 'ok' : ticket.message).toBe(true);
  if (!ticket.ok) throw new Error(ticket.message);

  const put = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: ticket.requiredHeaders,
    body: new Uint8Array(input.body),
  });
  expect(put.ok, `PUT falhou: HTTP ${put.status}`).toBe(true);

  const confirmed = await confirmUserAvatarUpload({
    userId: input.userId,
    objectKey: ticket.objectKey,
    bucket: ticket.bucket,
    fileName: 'retrato.png',
    mimeType: ticket.mimeType,
    sizeBytes: input.body.length,
    checksum,
  });

  return { ticket, confirmed };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('foto da pessoa', () => {
  it('o PNG vira WebP em `users/<id>/avatar/` e a coluna passa a apontar para ele', async () => {
    const png = await realPng();
    const { ticket, confirmed } = await uploadAvatar({ userId, body: png });

    expect(confirmed.ok, confirmed.ok ? 'ok' : confirmed.message).toBe(true);
    if (!confirmed.ok) return;

    expect(confirmed.objectKey.startsWith(`users/${userId}/avatar/`)).toBe(true);
    expect(confirmed.objectKey).toMatch(/\.webp$/);
    expect(confirmed.url).toMatch(/\.webp$/);
    expect(confirmed.sizeBytes).toBeLessThan(png.length);

    const stored = await inspectObject(ticket.bucket, confirmed.objectKey);
    expect(stored.exists).toBe(true);
    expect(stored.contentType).toBe('image/webp');

    // O objeto ENVIADO (o PNG) não fica no bucket.
    const original = await inspectObject(ticket.bucket, ticket.objectKey);
    expect(original.exists).toBe(false);

    const user = await adminPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { image: true },
    });
    expect(user.image).toBe(confirmed.url);
  });

  it('trocar a foto APAGA a anterior (o bucket não acumula uma por troca)', async () => {
    const before = await adminPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { image: true },
    });

    const previousUrl = before.image;
    expect(previousUrl).toMatch(/\.webp$/);

    const { ticket, confirmed } = await uploadAvatar({
      userId,
      body: await realPng(700, 400),
      fileName: 'outra.png',
    });

    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const previousKey = objectKeyFromPublicUrl(previousUrl, ticket.bucket, userId);
    expect(previousKey).not.toBeNull();

    const previous = await inspectObject(ticket.bucket, previousKey!);
    expect(previous.exists).toBe(false);
  }, 60_000);

  it('a chave de OUTRA pessoa é recusada na confirmação', async () => {
    /**
     * A guarda que impede trocar a foto alheia: a chave que chega do formulário tem de
     * estar sob o prefixo de quem está pedindo. Sem ela, bastaria conhecer a chave de
     * outro usuário para publicar uma imagem no perfil dele.
     */
    const png = await realPng(120, 120);
    const checksum = await sha256Hex(png);

    const result = await confirmUserAvatarUpload({
      userId,
      objectKey: `users/${otherUserId}/avatar/${randomUUID()}-invasao.png`,
      bucket: process.env.S3_BUCKET_ASSETS ?? 'eventflow-assets',
      fileName: 'invasao.png',
      mimeType: 'image/png',
      sizeBytes: png.length,
      checksum,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.message).toMatch(/não corresponde à sua foto/i);
    }
  });

  it('remover a foto limpa a coluna E apaga o arquivo do servidor', async () => {
    const current = await adminPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { image: true },
    });

    expect(current.image).toMatch(/\.webp$/);

    const result = await removeUserAvatar(userId);
    expect(result.ok).toBe(true);

    const after = await adminPrisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { image: true },
    });
    expect(after.image).toBeNull();

    const bucket = process.env.S3_BUCKET_ASSETS ?? 'eventflow-assets';
    const key = objectKeyFromPublicUrl(current.image, bucket, userId);
    const stored = await inspectObject(bucket, key!);
    expect(stored.exists).toBe(false);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('visão da conta', () => {
  it('conta sem senha própria é dita como tal (o convite não cria senha)', async () => {
    const overview = await getAccountOverview(userId);

    expect(overview).not.toBeNull();
    expect(overview?.hasPassword).toBe(false);
    expect(overview?.twoFactorEnabled).toBe(false);
    expect(overview?.email).toBe(`f47.conta.${RUN}@exemplo.test`);
  });

  it('com linha `credential` e senha, a conta diz que TEM senha', async () => {
    await adminPrisma.account.create({
      data: {
        id: randomUUID(),
        userId,
        providerId: 'credential',
        accountId: userId,
        password: 'hash-de-teste-nao-usado-na-conferencia',
      },
    });

    const overview = await getAccountOverview(userId);
    expect(overview?.hasPassword).toBe(true);
  });

  it('conta inexistente devolve null em vez de inventar estado', async () => {
    expect(await getAccountOverview(randomUUID())).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sessões', () => {
  it('marca a sessão atual e a coloca no topo', async () => {
    const currentToken = `token-atual-${RUN}`;
    const olderToken = `token-antigo-${RUN}`;

    await adminPrisma.session.createMany({
      data: [
        {
          id: randomUUID(),
          token: olderToken,
          userId,
          expiresAt: new Date(Date.now() + 86_400_000),
          userAgent:
            'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
          createdAt: new Date(Date.now() - 3_600_000),
        },
        {
          id: randomUUID(),
          token: currentToken,
          userId,
          expiresAt: new Date(Date.now() + 86_400_000),
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          createdAt: new Date(Date.now() - 60_000),
        },
      ],
    });

    const sessions = await readAccountSessions({ userId, currentToken });

    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions[0]?.token).toBe(currentToken);
    expect(sessions[0]?.isCurrent).toBe(true);
    expect(sessions[0]?.device).toBe('Windows');
    expect(sessions[0]?.browser).toBe('Chrome');

    const other = sessions.find((session) => session.token === olderToken);
    expect(other?.isCurrent).toBe(false);

    // A contagem que a tela mostra também sai daqui.
    const overview = await getAccountOverview(userId);
    expect(overview?.activeSessions).toBeGreaterThanOrEqual(2);
  });

  it('sem token atual, nenhuma sessão é marcada como "este dispositivo"', async () => {
    const sessions = await readAccountSessions({ userId, currentToken: null });

    expect(sessions.every((session) => !session.isCurrent)).toBe(true);
  });
});
