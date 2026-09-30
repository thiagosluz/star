/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — a declaração de autorização da foto (FASE 51 · E66)
 *
 *  Roda contra o banco real, com RLS e a role de runtime. Prova o que o domínio puro
 *  não alcança — o que fica GRAVADO no perfil e na trilha:
 *
 *    • foto NOVA sem canal é recusada (e nada é criado);
 *    • com canal, o perfil nasce com TEXTO + VERSÃO + CANAL + DATA;
 *    • trocar só o nome NÃO reexige nada e não reescreve a declaração vigente;
 *    • a trilha guarda quem declarou, sob qual redação e por qual canal;
 *    • remover a foto LIMPA a declaração (ela era sobre aquela imagem) e a retirada
 *      fica registrada na trilha;
 *    • a tela da organização recebe a declaração para poder mostrar o que está valendo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { listSpeakers, saveSpeakerProfile } from '../../src/lib/speakers/speaker-service';
import {
  PHOTO_AUTHORIZATION_TEXT,
  PHOTO_AUTHORIZATION_VERSION,
} from '../../src/domain/speakers/speaker-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let actorId: string;

const FOTO_DA_ORGANIZACAO = 'https://storage.test/eventflow-assets/tenants/x/equipe/retrato.webp';
const OUTRA_FOTO = 'https://storage.test/eventflow-assets/tenants/x/equipe/outra.webp';

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f51-autorizacao-${RUN}`,
      name: `Instituição Autorização ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: { id: actorId, name: 'Organizador Autorização', email: `f51.autorizacao.${RUN}@exemplo.test` },
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f51.autorizacao.${RUN}` } } });
  await adminPrisma.$disconnect();
});

function save(input: {
  speakerProfileId?: string;
  name: string;
  avatarUrl?: string | null;
  photoAuthorization?: boolean;
  photoAuthorizationChannel?: string | null;
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
    ...(input.photoAuthorizationChannel === undefined
      ? {}
      : { photoAuthorizationChannel: input.photoAuthorizationChannel }),
  });
}

type DeclaracaoGravada = {
  name: string;
  avatarUrl: string | null;
  avatarSource: string | null;
  photoAuthorizationText: string | null;
  photoAuthorizationVersion: string | null;
  photoAuthorizationChannel: string | null;
  photoAuthorizationAt: Date | null;
};

function lerPerfil(speakerProfileId: string): Promise<DeclaracaoGravada> {
  return withTenant(tenantId, (tx) =>
    tx.speakerProfile.findUniqueOrThrow({
      where: { id: speakerProfileId },
      select: {
        name: true,
        avatarUrl: true,
        avatarSource: true,
        photoAuthorizationText: true,
        photoAuthorizationVersion: true,
        photoAuthorizationChannel: true,
        photoAuthorizationAt: true,
      },
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('foto NOVA exige o canal, além da caixa', () => {
  it('sem canal a gravação é recusada e nada é criado', async () => {
    const result = await save({
      name: `Sem Canal ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toMatch(/canal/i);

    const created = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findFirst({ where: { tenantId, name: `Sem Canal ${RUN}` }, select: { id: true } }),
    );
    expect(created).toBe(null);
  });

  it('canal DESCONHECIDO também é recusado, com o motivo escrito', async () => {
    const result = await save({
      name: `Canal Estranho ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'pombo-correio',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/desconhecido/i);
  });

  it('com caixa e canal o perfil nasce com texto, versão, canal e data', async () => {
    const result = await save({
      name: `Com Canal ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'EMAIL',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const profile = await lerPerfil(result.speakerProfileId);

    expect(profile.avatarUrl).toBe(FOTO_DA_ORGANIZACAO);
    expect(profile.avatarSource).toBe('ORGANIZATION');
    // O texto gravado é o do DOMÍNIO — o mesmo que a tela mostra.
    expect(profile.photoAuthorizationText).toBe(PHOTO_AUTHORIZATION_TEXT);
    expect(profile.photoAuthorizationVersion).toBe(PHOTO_AUTHORIZATION_VERSION);
    expect(profile.photoAuthorizationChannel).toBe('EMAIL');
    expect(profile.photoAuthorizationAt).toBeInstanceOf(Date);
  });

  it('o rótulo lido na tela é aceito e gravado como a chave do enum', async () => {
    const result = await save({
      name: `Canal Por Rotulo ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'Telefone ou WhatsApp',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const profile = await lerPerfil(result.speakerProfileId);
    expect(profile.photoAuthorizationChannel).toBe('PHONE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a declaração vigente não é reescrita por engano', () => {
  it('trocar só o NOME (sem trocar a foto) não reexige nada e preserva a declaração', async () => {
    const created = await save({
      name: `Nome Antigo ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'EVENT_CONTRACT',
    });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const antes = await lerPerfil(created.speakerProfileId);

    // Sem caixa, sem canal: manter a MESMA foto não pede declaração nenhuma.
    const renomeado = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Nome Corrigido ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
    });
    expect(renomeado.ok, renomeado.ok ? 'ok' : renomeado.message).toBe(true);

    const depois = await lerPerfil(created.speakerProfileId);

    expect(depois.name).toBe(`Nome Corrigido ${RUN}`);
    expect(depois.avatarUrl).toBe(FOTO_DA_ORGANIZACAO);
    // Nem a data foi reescrita: a declaração é a MESMA que já estava valendo.
    expect(depois.photoAuthorizationAt?.getTime()).toBe(antes.photoAuthorizationAt?.getTime());
    expect(depois.photoAuthorizationText).toBe(PHOTO_AUTHORIZATION_TEXT);
    expect(depois.photoAuthorizationVersion).toBe(PHOTO_AUTHORIZATION_VERSION);
    expect(depois.photoAuthorizationChannel).toBe('EVENT_CONTRACT');
  });

  it('trocar a FOTO por outra exige declaração nova, com canal novo', async () => {
    const created = await save({
      name: `Troca de Foto ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'EMAIL',
    });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const semDeclaracao = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Troca de Foto ${RUN}`,
      avatarUrl: OUTRA_FOTO,
      photoAuthorization: true,
      photoAuthorizationChannel: '',
    });
    expect(semDeclaracao.ok).toBe(false);

    const comDeclaracao = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Troca de Foto ${RUN}`,
      avatarUrl: OUTRA_FOTO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'SIGNED_DOCUMENT',
    });
    expect(comDeclaracao.ok, comDeclaracao.ok ? 'ok' : comDeclaracao.message).toBe(true);

    const profile = await lerPerfil(created.speakerProfileId);
    expect(profile.avatarUrl).toBe(OUTRA_FOTO);
    expect(profile.photoAuthorizationChannel).toBe('SIGNED_DOCUMENT');
    expect(profile.photoAuthorizationText).toBe(PHOTO_AUTHORIZATION_TEXT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a trilha guarda quem declarou, sob qual redação e por qual canal', () => {
  it('a declaração entra na trilha como fato próprio, com autor e canal', async () => {
    const created = await save({
      name: `Com Trilha ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'PHONE',
    });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const registro = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'speakerProfile',
          entityId: created.speakerProfileId,
          action: 'CREATE',
        },
        select: { changes: true, userId: true, createdAt: true },
      }),
    );

    const texto = JSON.stringify(registro?.changes ?? {});

    expect(texto).toContain('autorizacaoDaFoto');
    expect(texto).toContain('declarada pela organização');
    expect(texto).toContain('canalDaAutorizacao');
    expect(texto).toContain('Telefone ou WhatsApp');
    expect(texto).toContain('versaoDaAutorizacao');
    expect(texto).toContain(PHOTO_AUTHORIZATION_VERSION);
    // Quem declarou é o ator da sessão — não um texto do formulário.
    expect(registro?.userId).toBe(actorId);
    expect(registro?.createdAt).toBeInstanceOf(Date);
  });

  it('remover a foto LIMPA a declaração e a retirada fica na trilha', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A DECISÃO DESTA FASE: A DECLARAÇÃO SAI COM A FOTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A declaração era sobre AQUELA imagem. Mantê-la depois da remoção deixaria o
     *  perfil afirmando uma base legal para uma foto que ninguém publica — e uma
     *  imagem publicada DEPOIS por outro caminho (o próprio palestrante no portal)
     *  ficaria parecendo coberta por uma declaração que ela nunca teve.
     *
     *  O FATO não se perde: a trilha guarda o que foi retirado, com autor e hora.
     */
    const created = await save({
      name: `Para Remover ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'EMAIL',
    });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const removido = await save({
      speakerProfileId: created.speakerProfileId,
      name: `Para Remover ${RUN}`,
      avatarUrl: '',
    });
    expect(removido.ok, removido.ok ? 'ok' : removido.message).toBe(true);

    const profile = await lerPerfil(created.speakerProfileId);

    expect(profile.avatarUrl).toBe(null);
    expect(profile.avatarSource).toBe(null);
    expect(profile.photoAuthorizationText).toBe(null);
    expect(profile.photoAuthorizationVersion).toBe(null);
    expect(profile.photoAuthorizationChannel).toBe(null);
    expect(profile.photoAuthorizationAt).toBe(null);

    const registro = await withTenant(tenantId, (tx) =>
      tx.auditLog.findFirst({
        where: {
          tenantId,
          entityType: 'speakerProfile',
          entityId: created.speakerProfileId,
          action: 'UPDATE',
        },
        orderBy: { createdAt: 'desc' },
        select: { changes: true, userId: true },
      }),
    );

    const texto = JSON.stringify(registro?.changes ?? {});
    expect(texto).toContain('retirada com a foto');
    expect(texto).toContain(PHOTO_AUTHORIZATION_VERSION);
    expect(registro?.userId).toBe(actorId);
  });

  it('a tela da organização recebe a declaração vigente, com rótulo do canal', async () => {
    const created = await save({
      name: `Na Lista ${RUN}`,
      avatarUrl: FOTO_DA_ORGANIZACAO,
      photoAuthorization: true,
      photoAuthorizationChannel: 'OTHER',
    });
    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const rows = await listSpeakers({ tenantId });
    const row = rows.find((item) => item.speakerProfileId === created.speakerProfileId);

    expect(row?.photoDeclaration).not.toBe(null);
    expect(row?.photoDeclaration?.text).toBe(PHOTO_AUTHORIZATION_TEXT);
    expect(row?.photoDeclaration?.version).toBe(PHOTO_AUTHORIZATION_VERSION);
    expect(row?.photoDeclaration?.channel).toBe('OTHER');
    expect(row?.photoDeclaration?.channelLabel).toBe('Outro meio');
    expect(row?.photoDeclaration?.versionIsCurrent).toBe(true);
  });

  it('cadastro SEM foto continua funcionando — é o caminho do seed e do convite', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A EXIGÊNCIA VALE PARA A FOTO NOVA, NÃO PARA O CADASTRO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Quem cadastra um palestrante a partir de uma proposta aceita
     *  (`acceptance-service`) e o dado de demonstração do seed chamam este mesmo
     *  serviço SEM foto. Sem este caso, a fase quebraria `npm run db:seed` — que roda
     *  os serviços reais — e ninguém saberia até rodar o seed.
     */
    const semFoto = await save({ name: `Sem Foto ${RUN}` });

    expect(semFoto.ok, semFoto.ok ? 'ok' : semFoto.message).toBe(true);
    if (!semFoto.ok) return;

    const profile = await lerPerfil(semFoto.speakerProfileId);

    expect(profile.avatarUrl).toBe(null);
    expect(profile.photoAuthorizationText).toBe(null);
    expect(profile.photoAuthorizationChannel).toBe(null);
    expect(profile.photoAuthorizationAt).toBe(null);
  });

  it('foto publicada sem declaração (anterior à fase) não inventa uma', async () => {
    /**
     * O caminho real: uma foto que já estava publicada quando a regra nasceu. A tela
     * precisa poder dizer "não há declaração gravada" em vez de mostrar um registro
     * vazio que pareceria uma autorização.
     */
    const legadoId = randomUUID();

    await withTenant(tenantId, (tx) =>
      tx.speakerProfile.create({
        data: {
          id: legadoId,
          tenantId,
          name: `Foto Antiga ${RUN}`,
          avatarUrl: FOTO_DA_ORGANIZACAO,
          avatarSource: 'ORGANIZATION',
          createdById: actorId,
        },
      }),
    );

    const rows = await listSpeakers({ tenantId });
    const row = rows.find((item) => item.speakerProfileId === legadoId);

    expect(row?.avatarUrl).toBe(FOTO_DA_ORGANIZACAO);
    expect(row?.photoDeclaration).toBe(null);
  });
});
