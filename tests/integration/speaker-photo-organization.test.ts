/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — a foto do palestrante que NÃO tem conta (FASE 46)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até esta fase, a ÚNICA forma de um palestrante ter foto era ele assumir o perfil e
 *  enviá-la pelo portal. Quem nunca faz cadastro — o caso comum de quem vem de fora —
 *  ficava sem foto, e a organização não tinha como resolver: o formulário não tinha o
 *  campo e a action nem lia `avatarUrl`.
 *
 *  Com o campo, apareceram três regras que precisam de prova:
 *
 *    • a foto de TERCEIRO só é publicada com a declaração de autorização, registrada
 *      na trilha (e a exigência vale para a foto NOVA, não para qualquer gravação);
 *    • a foto AUSENTE no formulário PRESERVA a existente — sem isso, corrigir o nome
 *      de um palestrante apagaria a foto que ele mesmo subiu;
 *    • a foto VAZIA APAGA: "remover" precisa existir, senão o aviso ao palestrante
 *      mentiria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  listSpeakers,
  saveSpeakerProfile,
} from '../../src/lib/speakers/speaker-service';
import { updateMySpeakerProfile } from '../../src/lib/speakers/speaker-portal-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let actorId: string;

const PHOTO_DA_ORGANIZACAO = 'https://storage.test/eventflow-assets/tenants/x/equipe/retrato.webp';
const PHOTO_DO_PALESTRANTE = 'https://storage.test/eventflow-assets/tenants/x/equipe/outra.webp';

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f46-foto-${RUN}`,
      name: `Instituição Foto ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador Foto', email: `f46.foto.${RUN}@exemplo.test` },
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f46.foto.${RUN}` } } });
  await adminPrisma.$disconnect();
});

function save(input: {
  speakerProfileId?: string;
  name: string;
  avatarUrl?: string | null;
  photoAuthorization?: boolean;
}) {
  return saveSpeakerProfile({
    tenantId,
    actorId,
    name: input.name,
    ...(input.speakerProfileId ? { speakerProfileId: input.speakerProfileId } : {}),
    ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
    ...(input.photoAuthorization === undefined
      ? {}
      : { photoAuthorization: input.photoAuthorization }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('foto enviada pela organização', () => {
  it('sem a declaração de autorização, a foto NÃO é publicada', async () => {
    const result = await save({
      name: `Sem Autorização ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.message).toMatch(/autorização do palestrante/i);
    }
  });

  it('com a declaração, o perfil nasce com a foto e a origem ORGANIZATION', async () => {
    const result = await save({
      name: `Palestrante Convidado ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: result.speakerProfileId },
        select: { avatarUrl: true, avatarSource: true },
      }),
    );

    expect(profile.avatarUrl).toBe(PHOTO_DA_ORGANIZACAO);
    expect(profile.avatarSource).toBe('ORGANIZATION');
  });

  it('a declaração fica na TRILHA — é ela que responde quem autorizou o quê', async () => {
    const result = await save({
      name: `Com Trilha ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No NASCIMENTO do perfil, com a foto já em mãos: a trilha é de CREATE.
    const created = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'speakerProfile',
          entityId: result.speakerProfileId,
          action: 'CREATE',
        },
        select: { changes: true, userId: true },
      }),
    );

    expect(JSON.stringify(created?.changes ?? {})).toContain('autorizacaoDaFoto');
    expect(JSON.stringify(created?.changes ?? {})).toContain('declarada pela organização');
    // Quem declarou é o ator da sessão, não um texto no formulário.
    expect(created?.userId).toBe(actorId);

    // E na TROCA da foto, com a trilha de UPDATE.
    const replaced = await save({
      speakerProfileId: result.speakerProfileId,
      name: `Com Trilha ${RUN}`,
      avatarUrl: PHOTO_DO_PALESTRANTE,
      photoAuthorization: true,
    });
    expect(replaced.ok).toBe(true);

    const updated = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'speakerProfile',
          entityId: result.speakerProfileId,
          action: 'UPDATE',
        },
        orderBy: { createdAt: 'desc' },
        select: { changes: true },
      }),
    );

    expect(JSON.stringify(updated?.changes ?? {})).toContain('autorizacaoDaFoto');
    expect(JSON.stringify(updated?.changes ?? {})).toContain(PHOTO_DO_PALESTRANTE);
  });

  it('editar o NOME sem mandar a foto PRESERVA a foto que existe', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A ARMADILHA QUE ESTE TESTE TRANCA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O serviço gravava `avatarUrl: input.avatarUrl ?? null`. Como o formulário de
     *  edição da organização não mandava o campo, corrigir um nome APAGAVA a foto em
     *  silêncio — e o palestrante descobria na vitrine. É a mesma família do `taxId`
     *  do patrocinador (FASE 17) e dos contatos do perfil público (FASE 45): campo que
     *  a tela não manda não pode ser decidido por omissão.
     */
    const created = await save({
      name: `Nome Antigo ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // Sem `photoAuthorization`: manter a MESMA foto não pede declaração nenhuma.
    const renamed = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Nome Corrigido ${RUN}`,
    });

    expect(renamed.ok, renamed.ok ? 'ok' : renamed.message).toBe(true);

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: created.speakerProfileId },
        select: { name: true, avatarUrl: true, avatarSource: true },
      }),
    );

    expect(profile.name).toBe(`Nome Corrigido ${RUN}`);
    expect(profile.avatarUrl).toBe(PHOTO_DA_ORGANIZACAO);
    expect(profile.avatarSource).toBe('ORGANIZATION');
  });

  it('a foto vazia APAGA a foto e a origem', async () => {
    const created = await save({
      name: `Para Remover ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cleared = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Para Remover ${RUN}`,
      avatarUrl: '',
    });

    expect(cleared.ok, cleared.ok ? 'ok' : cleared.message).toBe(true);

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: created.speakerProfileId },
        select: { avatarUrl: true, avatarSource: true },
      }),
    );

    expect(profile.avatarUrl).toBeNull();
    expect(profile.avatarSource).toBeNull();
  });

  it('a tela da organização recebe a origem da foto', async () => {
    const result = await save({
      name: `Na Lista ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = await listSpeakers({ tenantId });
    const row = rows.find((item) => item.speakerProfileId === result.speakerProfileId);

    expect(row?.avatarUrl).toBe(PHOTO_DA_ORGANIZACAO);
    expect(row?.avatarSource).toBe('ORGANIZATION');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o palestrante assume o perfil e a foto muda de origem', () => {
  it('quando ELE troca a foto, a origem passa a ser SPEAKER', async () => {
    const created = await save({
      name: `Assume o Perfil ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const speakerUserId = randomUUID();
    await adminPrisma.user.create({
      data: { id: speakerUserId, name: 'Palestrante Dono', email: `f46.dono.${RUN}@exemplo.test` },
    });

    await withTenant(tenantId, (tx) =>
      tx.speakerProfile.update({
        where: { id: created.speakerProfileId },
        data: { userId: speakerUserId },
      }),
    );

    // O caminho do portal exige a POSSE: o userId vem do banco, não do formulário.
    const denied = await updateMySpeakerProfile({
      tenantId,
      userId: actorId,
      speakerProfileId: created.speakerProfileId,
      name: `Assume o Perfil ${RUN}`,
      avatarUrl: PHOTO_DO_PALESTRANTE,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('FORBIDDEN');

    const updated = await updateMySpeakerProfile({
      tenantId,
      userId: speakerUserId,
      speakerProfileId: created.speakerProfileId,
      name: `Assume o Perfil ${RUN}`,
      avatarUrl: PHOTO_DO_PALESTRANTE,
    });

    expect(updated.ok, updated.ok ? 'ok' : updated.message).toBe(true);

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: created.speakerProfileId },
        select: { avatarUrl: true, avatarSource: true, isConfirmed: true },
      }),
    );

    expect(profile.avatarUrl).toBe(PHOTO_DO_PALESTRANTE);
    expect(profile.avatarSource).toBe('SPEAKER');
    expect(profile.isConfirmed).toBe(true);
  }, 60_000);

  it('e quando ele REMOVE a foto, a origem também sai', async () => {
    const created = await save({
      name: `Remove a Foto ${RUN}`,
      avatarUrl: PHOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const speakerUserId = randomUUID();
    await adminPrisma.user.create({
      data: { id: speakerUserId, name: 'Palestrante Remove', email: `f46.remove.${RUN}@exemplo.test` },
    });

    await withTenant(tenantId, (tx) =>
      tx.speakerProfile.update({
        where: { id: created.speakerProfileId },
        data: { userId: speakerUserId },
      }),
    );

    // Campo vazio = "remover foto" no portal (ausente seria "não mexer").
    const updated = await updateMySpeakerProfile({
      tenantId,
      userId: speakerUserId,
      speakerProfileId: created.speakerProfileId,
      name: `Remove a Foto ${RUN}`,
      avatarUrl: '',
    });

    expect(updated.ok, updated.ok ? 'ok' : updated.message).toBe(true);

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: created.speakerProfileId },
        select: { avatarUrl: true, avatarSource: true },
      }),
    );

    expect(profile.avatarUrl).toBeNull();
    expect(profile.avatarSource).toBeNull();
  }, 60_000);
});
