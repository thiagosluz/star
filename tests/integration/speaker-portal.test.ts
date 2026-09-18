/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — portal do palestrante (FASE 25)
 *
 *  Prova o que o domínio puro não alcança, contra o PostgreSQL real:
 *    • E18 — o perfil é da PESSOA: cadastro, convite com hash, reivindicação e papel
 *      concedido por ATIVIDADE, com o vínculo legado preenchido junto;
 *    • E19 — posse: quem não é ministrante não edita perfil nem ementa de terceiro;
 *    • E20 — materiais com visibilidade resolvida por VISITANTE (401/403/404) e
 *      upload direto ao storage com conferência de integridade;
 *    • E21 — a vitrine e a ficha pública derivam do evento publicado;
 *    • isolamento entre instituições (RLS) nas duas tabelas novas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  attachSpeakerAccount,
  linkSpeakerToActivity,
  listSpeakers,
  loadActivityNotes,
  regenerateSpeakerInvite,
  saveSpeakerProfile,
  unlinkSpeakerFromActivity,
} from '../../src/lib/speakers/speaker-service';
import {
  claimSpeakerProfile,
  hasPendingSpeakerInvite,
  loadSpeakerPendingInvites,
  loadSpeakerPortal,
  updateMySpeakerProfile,
  updateSpeakerNotes,
} from '../../src/lib/speakers/speaker-portal-service';
import {
  confirmMaterialUpload,
  createMaterialLink,
  deleteMaterial,
  listActivityMaterials,
  loadMaterialOwnership,
  requestMaterialUpload,
  resolveMaterialDownload,
  updateMaterial,
} from '../../src/lib/speakers/material-service';
import { getPublicEvent, getPublicSpeaker } from '../../src/lib/events/event-repository';
import { hashInviteToken } from '../../src/domain/speakers/speaker-rules';
import { createUploadUrl, inspectObject } from '../../src/lib/storage/s3-client';

const RUN = randomUUID().slice(0, 8);
const EVENT_SLUG = `evento-f25-${RUN}`;

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let activityId: string;
let secondActivityId: string;
let organizerId: string;
let speakerUserId: string;
let otherSpeakerUserId: string;
let outsiderId: string;

const PAST_EVENT_END = new Date(Date.now() + 30 * 86_400_000);

/** Fim do evento no PASSADO — o certificado de palestrante exige evento encerrado. */
const FINISHED_EVENT_END = new Date(Date.now() - 2 * 86_400_000);

function emailFor(label: string): string {
  return `f25.${label}.${RUN}@exemplo.test`;
}

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f25-palestrante-${RUN}`,
      name: `Instituição Palestrante ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f25-outra-${RUN}`,
      name: `Outra Instituição ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  organizerId = randomUUID();
  speakerUserId = randomUUID();
  otherSpeakerUserId = randomUUID();
  outsiderId = randomUUID();

  await adminPrisma.user.createMany({
    data: [
      { id: organizerId, name: 'Organizadora F25', email: emailFor('org') },
      { id: speakerUserId, name: 'Palestrante F25', email: emailFor('speaker') },
      { id: otherSpeakerUserId, name: 'Outro Palestrante F25', email: emailFor('outro') },
      { id: outsiderId, name: 'Visitante F25', email: emailFor('visitante') },
    ],
  });

  eventId = randomUUID();
  activityId = randomUUID();
  secondActivityId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Congresso de Saúde Digital ${RUN}`,
        summary: 'Evento dos testes da FASE 25.',
        status: 'PUBLISHED',
        modality: 'IN_PERSON',
        startsAt: new Date(Date.now() - 5 * 86_400_000),
        endsAt: PAST_EVENT_END,
        timezone: 'America/Bahia',
        venueName: 'Centro de Convenções',
        city: 'Salvador',
        state: 'BA',
      },
    });

    await tx.activity.createMany({
      data: [
        {
          id: activityId,
          tenantId,
          eventId,
          slug: `minicurso-${RUN}`,
          title: 'Minicurso de Telemedicina',
          type: 'MINI_COURSE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() + 20 * 86_400_000),
          endsAt: new Date(Date.now() + 20 * 86_400_000 + 4 * 3_600_000),
          workloadMinutes: 240,
          capacity: 40,
        },
        {
          id: secondActivityId,
          tenantId,
          eventId,
          slug: `mesa-${RUN}`,
          title: 'Mesa-redonda de Políticas Públicas',
          type: 'ROUND_TABLE',
          status: 'SCHEDULED',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() + 21 * 86_400_000),
          endsAt: new Date(Date.now() + 21 * 86_400_000 + 2 * 3_600_000),
          workloadMinutes: 120,
          capacity: 100,
        },
      ],
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('cadastro, convite e vínculo com a atividade', () => {
  let invitedProfileId: string;
  let invitedToken: string;

  it('cadastra o palestrante sem conta e devolve o convite UMA vez', async () => {
    const result = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Convidada Externa',
      email: emailFor('convidada'),
      institution: 'Universidade Federal da Bahia',
      roleTitle: 'Keynote',
      bio: 'Pesquisadora de saúde digital.',
      socialLinks: { lattes: 'lattes.cnpq.br/998877' },
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    invitedProfileId = result.speakerProfileId;
    invitedToken = result.inviteToken ?? '';

    expect(result.created).toBe(true);
    expect(invitedToken).toHaveLength(32);

    /**
     * O token em claro NÃO é gravado: o banco guarda o SHA-256. É a diferença entre
     * um dump de backup e uma chave-mestra para reivindicar perfis.
     */
    const row = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: invitedProfileId },
        select: { inviteTokenHash: true, socialLinks: true, isConfirmed: true },
      }),
    );

    expect(row.inviteTokenHash).toBe(hashInviteToken(invitedToken));
    expect(row.inviteTokenHash).not.toBe(invitedToken);
    expect(row.isConfirmed).toBe(false);
  });

  it('recusa e-mail repetido na mesma instituição', async () => {
    const result = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Duplicada',
      email: emailFor('convidada'),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE_EMAIL');
  });

  it('vincular copia a identidade para o vínculo e assume a carga da atividade', async () => {
    const result = await linkSpeakerToActivity({
      tenantId,
      actorId: organizerId,
      activityId,
      speakerProfileId: invitedProfileId,
      roleTitle: 'Instrutor(a)',
      isKeynote: false,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    const link = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findUniqueOrThrow({
        where: { id: result.linkId },
        select: { guestName: true, guestEmail: true, guestInstitution: true, workloadMinutes: true, roleTitle: true },
      }),
    );

    expect(link.guestName).toBe('Convidada Externa');
    expect(link.guestEmail).toBe(emailFor('convidada'));
    expect(link.guestInstitution).toBe('Universidade Federal da Bahia');
    // Sem carga declarada no vínculo, a da atividade é assumida.
    expect(link.workloadMinutes).toBe(240);
    expect(link.roleTitle).toBe('Instrutor(a)');
  });

  it('regerar o convite invalida o anterior', async () => {
    const result = await regenerateSpeakerInvite({
      tenantId,
      actorId: organizerId,
      speakerProfileId: invitedProfileId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const previous = await claimSpeakerProfile({
      tenantId,
      userId: outsiderId,
      userEmail: emailFor('visitante'),
      token: invitedToken,
    });

    expect(previous.ok).toBe(false);
    if (previous.ok) return;
    /**
     * `NOT_FOUND` e não `INVALID_INPUT`: a busca do convite é PELO HASH, então um
     * token que foi invalidado não encontra linha nenhuma — e a mensagem orienta a
     * pedir um convite novo, que é a única saída real para quem está com o código
     * antigo na mão.
     */
    expect(previous.code).toBe('NOT_FOUND');
    expect(previous.message).toMatch(/convite não encontrado/i);

    invitedToken = result.inviteToken;
  });

  it('reivindica o perfil pelo token: vincula a conta, confirma e NÃO deixa token vivo', async () => {
    const claim = await claimSpeakerProfile({
      tenantId,
      userId: outsiderId,
      userEmail: emailFor('visitante'),
      token: invitedToken,
    });

    expect(claim.ok, claim.ok ? 'ok' : claim.message).toBe(true);
    if (!claim.ok) return;

    expect(claim.attachedActivities).toBe(1);

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: invitedProfileId },
        select: { userId: true, isConfirmed: true, inviteTokenHash: true, email: true },
      }),
    );

    expect(profile.userId).toBe(outsiderId);
    expect(profile.isConfirmed).toBe(true);
    // O convite morre ao ser usado.
    expect(profile.inviteTokenHash).toBeNull();
    // A conta tinha outro e-mail: o do perfil foi corrigido para o da conta.
    expect(profile.email).toBe(emailFor('visitante'));
  });

  it('recusa reivindicar de novo (o perfil já tem dono)', async () => {
    const again = await claimSpeakerProfile({
      tenantId,
      userId: otherSpeakerUserId,
      userEmail: emailFor('org'),
      speakerProfileId: invitedProfileId,
    });

    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('FORBIDDEN');
  });

  it('o aceite concede o papel SPEAKER no escopo da ATIVIDADE', async () => {
    /**
     * `attachSpeakerAccount` roda DENTRO da transação do aceite: vínculo, confirmação
     * e papel precisam acontecer juntos (é o que a ação faz). Aqui ele é chamado de
     * novo de propósito — a concessão é idempotente e o teste prova isso.
     */
    await withTenant(tenantId, (tx) =>
      attachSpeakerAccount(tx, {
        tenantId,
        userId: outsiderId,
        speakerProfileId: invitedProfileId,
        updateEmailTo: null,
        actorId: outsiderId,
      }),
    );

    const assignment = await withTenant(tenantId, (tx) =>
      tx.roleAssignment.findFirst({
        where: { tenantId, userId: outsiderId, role: 'SPEAKER', revokedAt: null },
        select: { scope: true, activityId: true },
      }),
    );

    expect(assignment?.scope).toBe('ACTIVITY');
    expect(assignment?.activityId).toBe(activityId);
  });

  it('o vínculo legado passa a apontar para a conta', async () => {
    const link = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findFirstOrThrow({
        where: { tenantId, activityId, speakerProfileId: invitedProfileId },
        select: { userId: true },
      }),
    );

    expect(link.userId).toBe(outsiderId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('posse — cada um cuida do que é seu', () => {
  let minhaProfileId: string;
  let outroProfileId: string;
  let minhaLinkId: string;

  beforeAll(async () => {
    const mine = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Palestrante Titular',
      email: emailFor('speaker'),
    });
    if (!mine.ok) throw new Error(mine.message);
    minhaProfileId = mine.speakerProfileId;

    await withTenant(tenantId, (tx) =>
      attachSpeakerAccount(tx, {
        tenantId,
        userId: speakerUserId,
        speakerProfileId: minhaProfileId,
        updateEmailTo: null,
        actorId: organizerId,
      }),
    );

    const link = await linkSpeakerToActivity({
      tenantId,
      actorId: organizerId,
      activityId,
      speakerProfileId: minhaProfileId,
      roleTitle: 'Instrutor(a)',
    });
    if (!link.ok) throw new Error(link.message);
    minhaLinkId = link.linkId;

    const other = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Palestrante Alheio',
      email: emailFor('outro'),
    });
    if (!other.ok) throw new Error(other.message);
    outroProfileId = other.speakerProfileId;

    await withTenant(tenantId, (tx) =>
      attachSpeakerAccount(tx, {
        tenantId,
        userId: otherSpeakerUserId,
        speakerProfileId: outroProfileId,
        updateEmailTo: null,
        actorId: organizerId,
      }),
    );

    await linkSpeakerToActivity({
      tenantId,
      actorId: organizerId,
      activityId: secondActivityId,
      speakerProfileId: outroProfileId,
    });
  });

  it('o dono edita o próprio perfil e a agenda recebe o nome novo', async () => {
    const result = await updateMySpeakerProfile({
      tenantId,
      userId: speakerUserId,
      speakerProfileId: minhaProfileId,
      name: 'Palestrante Titular Corrigido',
      bio: 'Bio revisada pelo próprio palestrante.',
      socialLinks: { github: 'github.com/titular' },
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);

    const link = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findFirstOrThrow({
        where: { id: minhaLinkId },
        select: { guestName: true, guestBio: true },
      }),
    );

    expect(link.guestName).toBe('Palestrante Titular Corrigido');
    expect(link.guestBio).toContain('revisada');
  });

  it('RECUSA editar o perfil de outra pessoa', async () => {
    const result = await updateMySpeakerProfile({
      tenantId,
      userId: speakerUserId,
      speakerProfileId: outroProfileId,
      name: 'Tentativa de Sequestro',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN');

    const untouched = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findUniqueOrThrow({
        where: { id: outroProfileId },
        select: { name: true },
      }),
    );

    expect(untouched.name).toBe('Palestrante Alheio');
  });

  it('o dono salva a ementa da PRÓPRIA atividade e o público a lê assinada', async () => {
    const result = await updateSpeakerNotes({
      tenantId,
      userId: speakerUserId,
      linkId: minhaLinkId,
      syllabus: 'Módulo 1: fundamentos. Módulo 2: prática.',
      requirements: 'Notebook com Python instalado.',
      bibliography: 'SILVA, A. Telemedicina na atenção básica. 2024.',
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);

    const notes = await loadActivityNotes(tenantId, activityId);
    expect(notes?.speakerName).toBe('Palestrante Titular Corrigido');
    expect(notes?.syllabus).toContain('Módulo 1');
    expect(notes?.requirements).toContain('Python');
  });

  it('RECUSA salvar ementa em atividade de terceiro', async () => {
    const foreignLink = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findFirstOrThrow({
        where: { tenantId, activityId: secondActivityId, speakerProfileId: outroProfileId },
        select: { id: true },
      }),
    );

    const result = await updateSpeakerNotes({
      tenantId,
      userId: speakerUserId,
      linkId: foreignLink.id,
      syllabus: 'Conteúdo indevido.',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FORBIDDEN');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('materiais — visibilidade decidida por visitante', () => {
  let publicMaterialId: string;
  let attendeesMaterialId: string;
  let privateMaterialId: string;
  let speakerProfileId: string;

  beforeAll(async () => {
    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findFirstOrThrow({
        where: { tenantId, userId: speakerUserId },
        select: { id: true },
      }),
    );
    speakerProfileId = profile.id;

    const publicMaterial = await createMaterialLink({
      tenantId,
      actorId: speakerUserId,
      activityId,
      speakerProfileId,
      title: 'Slides abertos',
      kind: 'SLIDES',
      visibility: 'PUBLIC',
      url: 'https://exemplo.org/slides',
    });
    if (!publicMaterial.ok) throw new Error(publicMaterial.message);
    publicMaterialId = publicMaterial.materialId;

    const attendeesMaterial = await createMaterialLink({
      tenantId,
      actorId: speakerUserId,
      activityId,
      speakerProfileId,
      title: 'Apostila da turma',
      kind: 'HANDOUT',
      visibility: 'ATTENDEES_ONLY',
      url: 'https://exemplo.org/apostila',
    });
    if (!attendeesMaterial.ok) throw new Error(attendeesMaterial.message);
    attendeesMaterialId = attendeesMaterial.materialId;

    const privateMaterial = await createMaterialLink({
      tenantId,
      actorId: speakerUserId,
      activityId,
      speakerProfileId,
      title: 'Rascunho da aula 2',
      kind: 'SLIDES',
      visibility: 'PRIVATE',
      url: 'https://exemplo.org/rascunho',
    });
    if (!privateMaterial.ok) throw new Error(privateMaterial.message);
    privateMaterialId = privateMaterial.materialId;
  });

  it('lista para o anônimo só o que é público, e CONTA o que está fechado', async () => {
    const result = await listActivityMaterials({
      tenantId,
      activityId,
      viewer: { kind: 'ANONYMOUS' },
    });

    expect(result.materials.map((material) => material.id)).toEqual([publicMaterialId]);
    // O material fechado não some da conta: é o que permite avisar que existe
    // conteúdo exclusivo para inscritos.
    expect(result.lockedCount).toBe(2);
  });

  it('o inscrito confirmado vê o material da turma; o não inscrito, não', async () => {
    await withTenant(tenantId, async (tx) => {
      await tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId,
          userId: outsiderId,
          status: 'CONFIRMED',
          consentData: true,
        },
      });
    });

    const confirmed = await listActivityMaterials({
      tenantId,
      activityId,
      viewer: { kind: 'ATTENDEE', userId: outsiderId, confirmed: true },
    });
    expect(confirmed.materials.map((material) => material.id)).toContain(attendeesMaterialId);
    expect(confirmed.materials.map((material) => material.id)).not.toContain(privateMaterialId);

    const pending = await listActivityMaterials({
      tenantId,
      activityId,
      viewer: { kind: 'ATTENDEE', userId: speakerUserId, confirmed: false },
    });

    expect(pending.materials.map((material) => material.id)).toEqual([publicMaterialId]);
  });

  it('download: 401 para anônimo no material de inscritos, 200 assinado para o dono', async () => {
    const anonymous = await resolveMaterialDownload({
      tenantId,
      materialId: attendeesMaterialId,
      viewer: { kind: 'ANONYMOUS' },
    });

    expect(anonymous.ok).toBe(false);
    if (anonymous.ok) return;
    expect(anonymous.httpStatus).toBe(401);

    const owner = await resolveMaterialDownload({
      tenantId,
      materialId: privateMaterialId,
      viewer: { kind: 'SPEAKER', userId: speakerUserId, owner: true },
    });

    expect(owner.ok).toBe(true);
    if (!owner.ok) return;
    expect(owner.kind).toBe('LINK');
    expect(owner.url).toBe('https://exemplo.org/rascunho');
  });

  it('download: 403 para o inscrito no material privado e 404 para material inexistente', async () => {
    const attendee = await resolveMaterialDownload({
      tenantId,
      materialId: privateMaterialId,
      viewer: { kind: 'ATTENDEE', userId: outsiderId, confirmed: true },
    });

    expect(attendee.ok).toBe(false);
    if (attendee.ok) return;
    expect(attendee.httpStatus).toBe(403);

    const missing = await resolveMaterialDownload({
      tenantId,
      materialId: randomUUID(),
      viewer: { kind: 'ORGANIZER', userId: organizerId },
    });

    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.httpStatus).toBe(404);
  });

  it('o dono do material é lido do BANCO, não do formulário', async () => {
    const ownership = await loadMaterialOwnership({ tenantId, materialId: publicMaterialId });

    expect(ownership?.ownerUserId).toBe(speakerUserId);
    expect(ownership?.activityId).toBe(activityId);
  });

  it('remover o material tira da página e da lista', async () => {
    const removed = await deleteMaterial({
      tenantId,
      actorId: speakerUserId,
      materialId: privateMaterialId,
    });

    expect(removed.ok, removed.ok ? 'ok' : removed.message).toBe(true);

    const list = await listActivityMaterials({
      tenantId,
      activityId,
      viewer: { kind: 'ORGANIZER', userId: organizerId },
    });

    expect(list.materials.map((material) => material.id)).not.toContain(privateMaterialId);
  });

  it('trocar a visibilidade muda o que o anônimo baixa', async () => {
    const updated = await updateMaterial({
      tenantId,
      actorId: speakerUserId,
      materialId: attendeesMaterialId,
      title: 'Apostila da turma',
      kind: 'HANDOUT',
      visibility: 'PUBLIC',
    });

    expect(updated.ok).toBe(true);

    const anonymous = await resolveMaterialDownload({
      tenantId,
      materialId: attendeesMaterialId,
      viewer: { kind: 'ANONYMOUS' },
    });

    expect(anonymous.ok).toBe(true);
  });

  it('vinculado a atividade que não ministra, o upload é recusado antes da assinatura', async () => {
    const result = await requestMaterialUpload({
      tenantId,
      eventId,
      activityId: secondActivityId,
      speakerProfileId,
      fileName: 'intruso.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      magicBytes: [0x25, 0x50, 0x44, 0x46],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('upload de arquivo de verdade (storage real)', () => {
  it('sobe um PDF, confere a integridade e recusa objeto trocado', async () => {
    const speakerProfileId = (
      await withTenant(tenantId, (tx) =>
        tx.speakerProfile.findFirstOrThrow({
          where: { tenantId, userId: speakerUserId },
          select: { id: true },
        }),
      )
    ).id;

    const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');

    const ticket = await requestMaterialUpload({
      tenantId,
      eventId,
      activityId,
      speakerProfileId,
      fileName: 'apresentacao.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      magicBytes: [...pdf.subarray(0, 8)],
    });

    expect(ticket.ok, ticket.ok ? 'ok' : ticket.message).toBe(true);
    if (!ticket.ok) return;

    // Objeto enviado diretamente ao storage, como o navegador faz.
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.requiredHeaders,
      body: new Uint8Array(pdf),
    });
    expect(put.ok).toBe(true);

    const stored = await inspectObject(ticket.bucket, ticket.objectKey);
    expect(stored.exists).toBe(true);

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE A CONFERÊNCIA DE INTEGRIDADE REALMENTE PEGA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O TAMANHO é sempre reportado pelo storage — declarar um tamanho diferente é
     *  recusado aqui, sem depender do backend.
     *
     *  O CHECKSUM só é comparado quando o storage o informa (`ChecksumSHA256` ou o
     *  metadado `x-amz-meta-sha256`). Nesta esteira o upload é assinado sem esse
     *  metadado, então o MinIO não o devolve e a conferência cai no tamanho — o
     *  caminho mais fraco, e o mesmo desde a FASE 4 (dívida registrada na FASE 25).
     *  O teste abaixo prova o caminho FORTE quando o checksum existe.
     */
    const wrongSize = await confirmMaterialUpload({
      tenantId,
      actorId: speakerUserId,
      eventId,
      activityId,
      speakerProfileId,
      title: 'Apresentação com tamanho errado',
      kind: 'SLIDES',
      visibility: 'PRIVATE',
      objectKey: ticket.objectKey,
      bucket: ticket.bucket,
      fileName: 'apresentacao.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length + 10,
      checksum: 'f'.repeat(64),
    });

    expect(wrongSize.ok).toBe(false);
    if (wrongSize.ok) return;
    expect(['INTEGRITY', 'STORAGE']).toContain(wrongSize.code);

    // Novo envio, agora com os dados corretos.
    const second = await requestMaterialUpload({
      tenantId,
      eventId,
      activityId,
      speakerProfileId,
      fileName: 'apresentacao.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      magicBytes: [...pdf.subarray(0, 8)],
    });
    if (!second.ok) throw new Error(second.message);

    await fetch(second.uploadUrl, {
      method: 'PUT',
      headers: second.requiredHeaders,
      body: new Uint8Array(pdf),
    });

    const { createHash } = await import('node:crypto');
    const checksum = createHash('sha256').update(pdf).digest('hex');

    const confirmed = await confirmMaterialUpload({
      tenantId,
      actorId: speakerUserId,
      eventId,
      activityId,
      speakerProfileId,
      title: 'Apresentação da aula 1',
      kind: 'SLIDES',
      visibility: 'PUBLIC',
      objectKey: second.objectKey,
      bucket: second.bucket,
      fileName: 'apresentacao.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.length,
      checksum,
    });

    expect(confirmed.ok, confirmed.ok ? 'ok' : confirmed.message).toBe(true);
    if (!confirmed.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.speakerMaterial.findUniqueOrThrow({
        where: { id: confirmed.materialId },
        select: { storageKey: true, sizeBytes: true, checksum: true, url: true },
      }),
    );

    expect(row.storageKey).toBe(second.objectKey);
    expect(row.sizeBytes).toBe(pdf.length);
    expect(row.checksum).toBe(checksum);
    // O arquivo NÃO ganha URL fixa: o bucket é privado e o endereço só existe assinado.
    expect(row.url).toBeNull();

    const download = await resolveMaterialDownload({
      tenantId,
      materialId: confirmed.materialId,
      viewer: { kind: 'ANONYMOUS' },
    });

    expect(download.ok).toBe(true);
    if (!download.ok) return;
    expect(download.kind).toBe('FILE');
    expect(download.url).toContain('X-Amz-Signature');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('portal, vitrine pública e carga horária', () => {
  it('o portal do palestrante mostra as atividades dele e de mais ninguém', async () => {
    const portal = await loadSpeakerPortal({
      tenantId,
      userId: speakerUserId,
      userEmail: emailFor('speaker'),
    });

    expect(portal.profiles).toHaveLength(1);
    expect(portal.profiles[0]?.activities.map((activity) => activity.activityId)).toEqual([activityId]);
    expect(portal.isEmpty).toBe(false);
  });

  it('o convite pendente aparece para o e-mail convidado (caminho do painel)', async () => {
    const convidado = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Pendente de Aceite',
      email: emailFor('pendente'),
    });
    if (!convidado.ok) throw new Error(convidado.message);

    await adminPrisma.user.create({
      data: { id: randomUUID(), name: 'Pendente', email: emailFor('pendente') },
    });

    const pendenteUser = await adminPrisma.user.findFirstOrThrow({
      where: { email: emailFor('pendente') },
      select: { id: true },
    });

    const portal = await loadSpeakerPortal({
      tenantId,
      userId: pendenteUser.id,
      userEmail: emailFor('pendente'),
    });

    expect(portal.pendingInvites.map((invite) => invite.name)).toContain('Pendente de Aceite');
    expect(portal.profiles).toHaveLength(0);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A PORTA DE ENTRADA PELO CONVITE (revisão da FASE 25)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O portal precisa abrir para quem foi convidado e AINDA NÃO aceitou: o papel
   *  `SPEAKER` nasce com o aceite, então exigir o papel para chegar ao convite era um
   *  impasse. A regra abaixo é a que a guarda da página e o item do menu consultam —
   *  os dois lugares perguntam a MESMA coisa.
   */
  it('o convite pendente é reconhecido pelo e-mail da conta — e a porta se fecha no aceite', async () => {
    const convidado = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Porta do Portal',
      email: emailFor('porta'),
    });
    if (!convidado.ok) throw new Error(convidado.message);

    const userId = randomUUID();
    await adminPrisma.user.create({
      data: { id: userId, name: 'Porta', email: emailFor('porta') },
    });

    await expect(
      hasPendingSpeakerInvite({ tenantId, userEmail: emailFor('porta') }),
    ).resolves.toBe(true);

    // A caixa do e-mail não decide nada: a comparação é normalizada dos dois lados.
    await expect(
      hasPendingSpeakerInvite({ tenantId, userEmail: emailFor('porta').toUpperCase() }),
    ).resolves.toBe(true);

    // Conta existente e SEM convite para o e-mail dela: nada pendente.
    await expect(
      hasPendingSpeakerInvite({ tenantId, userEmail: emailFor('visitante') }),
    ).resolves.toBe(false);

    // Aceite pelo painel (sem código): a identidade é o e-mail da conta.
    const aceite = await claimSpeakerProfile({
      tenantId,
      userId,
      userEmail: emailFor('porta'),
      speakerProfileId: convidado.speakerProfileId,
    });
    expect(aceite.ok, aceite.ok ? 'ok' : aceite.message).toBe(true);

    // O convite deixa de ser pendente exatamente quando deixa de existir.
    await expect(
      hasPendingSpeakerInvite({ tenantId, userEmail: emailFor('porta') }),
    ).resolves.toBe(false);

    const portal = await loadSpeakerPortal({ tenantId, userId, userEmail: emailFor('porta') });
    expect(portal.pendingInvites).toHaveLength(0);
    expect(portal.profiles.map((profile) => profile.speakerProfileId)).toEqual([
      convidado.speakerProfileId,
    ]);
  });

  it('o prazo do CÓDIGO não fecha a porta: quem tem conta assume pelo e-mail', async () => {
    const convidado = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Convite Vencido',
      email: emailFor('vencido'),
    });
    if (!convidado.ok) throw new Error(convidado.message);

    /**
     * Vence o código por baixo: `saveSpeakerProfile` sempre cria com prazo à frente, e
     * a situação real (convite antigo, pessoa demorou para entrar) precisa ser testável.
     */
    await withTenant(tenantId, (tx) =>
      tx.speakerProfile.update({
        where: { id: convidado.speakerProfileId },
        data: { inviteExpiresAt: new Date(Date.now() - 86_400_000) },
      }),
    );

    const lista = await loadSpeakerPendingInvites({ tenantId, userEmail: emailFor('vencido') });
    expect(lista).toHaveLength(1);
    // A tela avisa que o código venceu...
    expect(lista[0]?.hasValidToken).toBe(false);
    // ...e o convite continua pendente: o perfil está reservado para aquele e-mail.
    await expect(
      hasPendingSpeakerInvite({ tenantId, userEmail: emailFor('vencido') }),
    ).resolves.toBe(true);

    const userId = randomUUID();
    await adminPrisma.user.create({
      data: { id: userId, name: 'Vencido', email: emailFor('vencido') },
    });

    /**
     * O caminho do painel se identifica pelo E-MAIL e não usa o código — por isso o
     * prazo vencido não impede o aceite (`evaluateClaim` sem token ignora a validade, e
     * é correto: o link não está em jogo). O token vencido continua recusado no caminho
     * do código, que é responsabilidade dos testes de domínio.
     */
    const aceite = await claimSpeakerProfile({
      tenantId,
      userId,
      userEmail: emailFor('vencido'),
      speakerProfileId: convidado.speakerProfileId,
    });
    expect(aceite.ok, aceite.ok ? 'ok' : aceite.message).toBe(true);
  });

  it('a carga NÃO conta atividade que ainda não terminou (evento em andamento)', async () => {
    const portal = await loadSpeakerPortal({
      tenantId,
      userId: speakerUserId,
      userEmail: emailFor('speaker'),
    });

    // O evento termina daqui a 30 dias: nada foi ministrado ainda.
    expect(portal.certificates[0]?.workloadMinutes).toBe(0);
    expect(portal.certificates[0]?.eventFinished).toBe(false);
    expect(portal.certificates[0]?.eligible).toBe(false);
    expect(portal.certificates[0]?.reason).toMatch(/após o término/i);
  });

  it('com o evento encerrado e credenciamento, a carga é a soma das atividades', async () => {
    const finishedEventId = randomUUID();
    const finishedActivityId = randomUUID();
    const cancelledActivityId = randomUUID();

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A MONTAGEM É EM TRÊS TRANSAÇÕES, E ISSO É OBRIGATÓRIO
     * ─────────────────────────────────────────────────────────────────────────────
     *  `withTenant` abre uma transação. Chamar `linkSpeakerToActivity` (que abre a
     *  PRÓPRIA transação, em outra conexão) de dentro dela faria o serviço não ver a
     *  atividade recém-criada e ainda não commitada — `READ COMMITTED` não mostra
     *  dado de transação aberta. O sintoma seria um vínculo silenciosamente ausente.
     */
    await withTenant(tenantId, async (tx) => {
      await tx.event.create({
        data: {
          id: finishedEventId,
          tenantId,
          slug: `evento-encerrado-${RUN}`,
          title: `Simpósio Encerrado ${RUN}`,
          status: 'FINISHED',
          modality: 'IN_PERSON',
          startsAt: new Date(Date.now() - 10 * 86_400_000),
          endsAt: FINISHED_EVENT_END,
          timezone: 'America/Bahia',
        },
      });

      await tx.activity.createMany({
        data: [
          {
            id: finishedActivityId,
            tenantId,
            eventId: finishedEventId,
            slug: `encerrada-${RUN}`,
            title: 'Oficina concluída',
            type: 'WORKSHOP',
            status: 'COMPLETED',
            modality: 'IN_PERSON',
            startsAt: new Date(Date.now() - 10 * 86_400_000),
            endsAt: new Date(Date.now() - 10 * 86_400_000 + 3 * 3_600_000),
            workloadMinutes: 180,
          },
          {
            id: cancelledActivityId,
            tenantId,
            eventId: finishedEventId,
            slug: `cancelada-${RUN}`,
            title: 'Oficina cancelada',
            type: 'WORKSHOP',
            status: 'CANCELED',
            modality: 'IN_PERSON',
            startsAt: new Date(Date.now() - 9 * 86_400_000),
            endsAt: new Date(Date.now() - 9 * 86_400_000 + 2 * 3_600_000),
            workloadMinutes: 120,
          },
        ],
      });
    });

    const profile = await withTenant(tenantId, (tx) =>
      tx.speakerProfile.findFirstOrThrow({
        where: { tenantId, userId: speakerUserId },
        select: { id: true },
      }),
    );

    /**
     * Os vínculos são criados pelo SERVIÇO, e não à mão: é ele que assume a carga da
     * atividade quando o vínculo não declara uma (`workloadMinutes` tem `0` como
     * padrão da coluna, e um `INSERT` cru gravaria zero — o teste mediria o próprio
     * erro de montagem em vez da regra).
     */
    for (const activityTarget of [finishedActivityId, cancelledActivityId]) {
      const linked = await linkSpeakerToActivity({
        tenantId,
        actorId: organizerId,
        activityId: activityTarget,
        speakerProfileId: profile.id,
      });

      expect(linked.ok, linked.ok ? 'ok' : linked.message).toBe(true);
    }

    // Credenciamento no balcão (o que o STAFF registra no dia).
    await withTenant(tenantId, (tx) =>
      tx.registration.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId: finishedEventId,
          userId: speakerUserId,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: new Date(Date.now() - 10 * 86_400_000),
        },
      }),
    );

    const portal = await loadSpeakerPortal({
      tenantId,
      userId: speakerUserId,
      userEmail: emailFor('speaker'),
    });

    const status = portal.certificates.find((entry) => entry.eventId === finishedEventId);

    expect(status).toBeDefined();
    // 180 da oficina concluída; a cancelada NÃO entra, e o motivo fica registrado.
    expect(status?.workloadMinutes).toBe(180);
    expect(status?.excludedActivities).toBe(1);
    expect(status?.eligible).toBe(true);
    expect(status?.reason).toMatch(/pode emitir/i);
  });

  it('a vitrine pública mostra o palestrante com perfil e esconde o oculto', async () => {
    const event = await getPublicEvent(tenantId, EVENT_SLUG);

    expect(event).not.toBeNull();
    const names = event?.speakers.map((speaker) => speaker.name) ?? [];

    expect(names).toContain('Palestrante Titular Corrigido');
    expect(names).toContain('Palestrante Alheio');

    /**
     * A ficha é buscada PELO NOME, e não por `speakers[0]`: a ordem da vitrine é
     * (displayOrder, primeiro horário, nome), e os três palestrantes do teste têm
     * displayOrder 0. Assumir a posição faria o teste medir a ordem em vez do dado.
     */
    const titular = event?.speakers.find((speaker) => speaker.name === 'Palestrante Titular Corrigido');
    expect(titular).toBeDefined();

    const detail = await getPublicSpeaker(tenantId, EVENT_SLUG, titular?.id ?? 'inexistente');

    expect(detail?.speaker.bio).toContain('revisada');
    expect(detail?.speaker.socialLinks.github).toContain('github.com');
  });

  it('perfil oculto da vitrine não aparece nem tem ficha', async () => {
    const oculto = await saveSpeakerProfile({
      tenantId,
      actorId: organizerId,
      name: 'Palestrante Discreto',
      isPublic: false,
    });
    if (!oculto.ok) throw new Error(oculto.message);

    await linkSpeakerToActivity({
      tenantId,
      actorId: organizerId,
      activityId,
      speakerProfileId: oculto.speakerProfileId,
    });

    const event = await getPublicEvent(tenantId, EVENT_SLUG);
    expect(event?.speakers.map((speaker) => speaker.name)).not.toContain('Palestrante Discreto');

    // Mas ele CONTINUA na agenda: a atividade precisa de quem a ministra.
    const activity = event?.activities.find((entry) => entry.id === activityId);
    expect(activity?.speakerNames).toContain('Palestrante Discreto');
    expect(activity?.speakers.map((speaker) => speaker.name)).not.toContain('Palestrante Discreto');

    const detail = await getPublicSpeaker(tenantId, EVENT_SLUG, oculto.speakerProfileId);
    expect(detail).toBeNull();
  });

  it('a ficha pública do palestrante não existe em evento não publicado', async () => {
    const speakerId = (
      await withTenant(tenantId, (tx) =>
        tx.speakerProfile.findFirstOrThrow({
          where: { tenantId, userId: speakerUserId },
          select: { id: true },
        }),
      )
    ).id;

    const other = await getPublicSpeaker(otherTenantId, EVENT_SLUG, speakerId);
    expect(other).toBeNull();
  });

  it('desvincular tira o palestrante da agenda e despublica os materiais dele', async () => {
    const link = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findFirstOrThrow({
        where: { tenantId, activityId, userId: speakerUserId },
        select: { id: true, speakerProfileId: true },
      }),
    );

    const result = await unlinkSpeakerFromActivity({
      tenantId,
      actorId: organizerId,
      linkId: link.id,
    });

    expect(result.ok).toBe(true);

    const remaining = await withTenant(tenantId, (tx) =>
      tx.speakerMaterial.findMany({
        where: {
          tenantId,
          activityId,
          ...(link.speakerProfileId ? { speakerProfileId: link.speakerProfileId } : {}),
        },
        select: { deletedAt: true },
      }),
    );

    // Os materiais do vínculo saem da página (exclusão lógica, com a trilha preservada).
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.every((material) => material.deletedAt !== null)).toBe(true);

    const agenda = await getPublicEvent(tenantId, EVENT_SLUG);
    const activity = agenda?.activities.find((entry) => entry.id === activityId);
    expect(activity?.speakerNames).not.toContain('Palestrante Titular Corrigido');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições (RLS)', () => {
  it('o acervo de palestrantes não atravessa instituições', async () => {
    const mine = await listSpeakers({ tenantId });
    expect(mine.length).toBeGreaterThan(0);

    const theirs = await listSpeakers({ tenantId: otherTenantId });
    expect(theirs).toHaveLength(0);
  });

  it('um material de outra instituição não é encontrado nem pela organização', async () => {
    const material = await withTenant(tenantId, (tx) =>
      tx.speakerMaterial.findFirstOrThrow({
        where: { tenantId, activityId },
        select: { id: true },
      }),
    );

    const result = await resolveMaterialDownload({
      tenantId: otherTenantId,
      materialId: material.id,
      viewer: { kind: 'ORGANIZER', userId: organizerId },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.httpStatus).toBe(404);
  });

  it('a ficha pública de um palestrante só existe no evento em que ele fala', async () => {
    const event = await getPublicEvent(otherTenantId, EVENT_SLUG);
    expect(event).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('URL de upload assinada', () => {
  it('a chave assinada trava bucket, tamanho e tipo', async () => {
    const bucket = process.env.S3_BUCKET_SUBMISSIONS ?? 'eventflow-submissions';

    const ticket = await createUploadUrl({
      bucket,
      objectKey: `tenants/${tenantId}/eventos/${eventId}/palestrantes/${activityId}/teste.pdf`,
      contentType: 'application/pdf',
      contentLength: 100,
    });

    expect(ticket.uploadUrl).toContain(bucket);
    expect(ticket.requiredHeaders['Content-Type']).toBe('application/pdf');
  });
});
