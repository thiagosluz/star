/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 86 · FATIA 4 — O MODELO DO EVENTO É DO TENANT (integração)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O BURACO QUE ESTES TESTES FECHAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `saveCertificateTemplate` gravava o `eventId` que o formulário mandasse. A
 *  chave estrangeira só garante que o EVENTO EXISTE — não que ele seja desta
 *  instituição —, então um uuid de outra casa (ou de um evento excluído) virava
 *  uma linha que a resolução nunca alcançava: o organizador salvava e o
 *  certificado continuava saindo no padrão, sem erro nenhum.
 *
 *  A mesma família aparece na EDIÇÃO: a tela do evento recebe `?modelo=<id>` e,
 *  sem escopo, abriria (e salvaria) o modelo de outro evento; a tela da
 *  instituição faria o inverso. Por isso `getCertificateTemplate`,
 *  `deleteCertificateTemplate`, `setTemplateBackground` e `clearTemplateBackground`
 *  aceitam o alvo esperado — e é isso que os casos abaixo prendem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  deleteCertificateTemplate,
  getCertificateTemplate,
  listCertificateTemplates,
  resolveEventTemplateKinds,
  saveCertificateTemplate,
} from '../../src/lib/certificates/certificate-template-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let actorId: string;
let eventId: string;
let otherEventId: string;
let otherTenantEventId: string;
let deletedEventId: string;

/** Cria um evento do tenant informado; `deletedAt` é o caso da exclusão lógica. */
async function createEvent(input: {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  deletedAt?: Date | null;
}): Promise<void> {
  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(input.tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: input.id,
        tenantId: input.tenantId,
        slug: input.slug,
        title: input.title,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        capacity: null,
        confirmedCount: 0,
        deletedAt: input.deletedAt ?? null,
      },
    });
  });
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  otherEventId = randomUUID();
  otherTenantEventId = randomUUID();
  deletedEventId = randomUUID();

  for (const [id, slug, name] of [
    [tenantId, `f86-modelos-${RUN}`, `Instituição dos Modelos ${RUN}`],
    [otherTenantId, `f86-modelos-outra-${RUN}`, `Outra Instituição ${RUN}`],
  ] as const) {
    await adminPrisma.tenant.create({
      data: { id, slug, name, status: 'ACTIVE', plan: 'PROFESSIONAL', timezone: 'America/Bahia' },
    });
  }

  actorId = randomUUID();
  await adminPrisma.user.create({
    data: {
      id: actorId,
      name: `Autora dos Modelos ${RUN}`,
      email: `f86.modelos.${RUN}@exemplo.test`,
      emailVerified: true,
    },
  });

  await createEvent({
    id: eventId,
    tenantId,
    slug: `evento-modelos-${RUN}`,
    title: `Evento dos Modelos ${RUN}`,
  });
  await createEvent({
    id: otherEventId,
    tenantId,
    slug: `evento-modelos-outro-${RUN}`,
    title: `Outro Evento dos Modelos ${RUN}`,
  });
  await createEvent({
    id: otherTenantEventId,
    tenantId: otherTenantId,
    slug: `evento-alheio-${RUN}`,
    title: `Evento da Outra Instituição ${RUN}`,
  });
  await createEvent({
    id: deletedEventId,
    tenantId,
    slug: `evento-excluido-${RUN}`,
    title: `Evento Excluído ${RUN}`,
    deletedAt: new Date(),
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { id: actorId } });
  await adminPrisma.$disconnect();
});

/** Atalho: salva um modelo com o preset válido e devolve o resultado cru. */
function save(input: {
  name: string;
  eventId?: string | null;
  kind?: string | null;
  templateId?: string | null;
  tenantId?: string;
}) {
  return saveCertificateTemplate({
    tenantId: input.tenantId ?? tenantId,
    actorId,
    templateId: input.templateId ?? null,
    name: input.name,
    eventId: input.eventId ?? null,
    kind: input.kind ?? null,
    presetId: 'classico-institucional',
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('a posse do eventId — o buraco fechado', () => {
  it('RECUSA gravar modelo apontando para evento de OUTRA instituição', async () => {
    const result = await save({
      name: `Modelo para o evento alheio ${RUN}`,
      eventId: otherTenantEventId,
      kind: 'ATTENDANCE',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');

    /**
     * A recusa é de VERDADE: nenhuma linha nasceu. Se a validação só devolvesse
     * erro depois do `create`, o modelo existiria e o teste não estaria provando
     * o que promete.
     */
    const rows = await listCertificateTemplates(tenantId, { eventId: otherTenantEventId });
    expect(rows).toHaveLength(0);
  });

  it('RECUSA evento EXCLUÍDO (existe, mas não é alvo de modelo novo)', async () => {
    const result = await save({
      name: `Modelo para evento excluído ${RUN}`,
      eventId: deletedEventId,
      kind: 'ATTENDANCE',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('ACEITA o evento da própria instituição e grava o alvo', async () => {
    const result = await save({
      name: `Modelo do evento ${RUN}`,
      eventId,
      kind: 'ATTENDANCE',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const record = await getCertificateTemplate(tenantId, result.templateId, { eventId });
    expect(record?.eventId).toBe(eventId);
    expect(record?.kind).toBe('ATTENDANCE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a edição é presa ao ALVO da rota', () => {
  it('a lista separa o que é DO EVENTO do que é PADRÃO da instituição', async () => {
    const institutional = await save({
      name: `Padrão da instituição ${RUN}`,
      kind: 'REVIEWER',
    });
    expect(institutional.ok).toBe(true);

    const doEvento = await listCertificateTemplates(tenantId, { eventId });
    const padrao = await listCertificateTemplates(tenantId, { eventId: null });

    expect(doEvento.every((row) => row.eventId === eventId)).toBe(true);
    expect(doEvento.some((row) => row.name.startsWith(`Modelo do evento ${RUN}`))).toBe(true);
    expect(padrao.every((row) => row.eventId === null)).toBe(true);
    expect(padrao.some((row) => row.name === `Padrão da instituição ${RUN}`)).toBe(true);

    /** A lista sem filtro continua existindo para o inventário. */
    const todas = await listCertificateTemplates(tenantId);
    expect(todas.length).toBeGreaterThanOrEqual(doEvento.length + padrao.length);
  });

  it('`getCertificateTemplate` com alvo NÃO abre o modelo de outro evento nem o padrão', async () => {
    const rows = await listCertificateTemplates(tenantId, { eventId });
    const templateId = rows[0]?.id;
    expect(templateId).toBeDefined();

    expect(await getCertificateTemplate(tenantId, templateId!, { eventId: otherEventId })).toBeNull();
    expect(await getCertificateTemplate(tenantId, templateId!, { eventId: null })).toBeNull();
    expect(await getCertificateTemplate(tenantId, templateId!, { eventId })).not.toBeNull();
  });

  it('RECUSA mover um modelo existente para outro alvo', async () => {
    const rows = await listCertificateTemplates(tenantId, { eventId });
    const templateId = rows[0]?.id;
    expect(templateId).toBeDefined();

    const moved = await save({
      name: `Tentativa de mover ${RUN}`,
      eventId: otherEventId,
      kind: 'ATTENDANCE',
      templateId: templateId!,
    });

    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.code).toBe('INVALID_INPUT');

    const unchanged = await getCertificateTemplate(tenantId, templateId!, { eventId });
    expect(unchanged?.eventId).toBe(eventId);
    expect(unchanged?.name).not.toBe(`Tentativa de mover ${RUN}`);
  });

  it('a EXCLUSÃO com alvo errado não apaga; com o alvo certo, apaga', async () => {
    const created = await save({
      name: `Modelo a excluir ${RUN}`,
      eventId: otherEventId,
      kind: 'SPEAKER',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const wrongTarget = await deleteCertificateTemplate({
      tenantId,
      templateId: created.templateId,
      eventId,
    });
    expect(wrongTarget.ok).toBe(false);
    expect(await getCertificateTemplate(tenantId, created.templateId, { eventId: otherEventId })).not.toBeNull();

    const rightTarget = await deleteCertificateTemplate({
      tenantId,
      templateId: created.templateId,
      eventId: otherEventId,
    });
    expect(rightTarget.ok).toBe(true);
    expect(await getCertificateTemplate(tenantId, created.templateId)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a resolução por tipo — a precedência e o modelo ILEGÍVEL', () => {
  it('diz qual desenho vale, de onde ele veio e separa "não há" de "está inválido"', async () => {
    /**
     * O cenário:
     *   • instituição + ATTENDANCE  → "Padrão presença";
     *   • evento + ATTENDANCE       → "Evento presença" (vence o de cima);
     *   • instituição genérica      → "Padrão geral" (vale para MINI_COURSE);
     *   • evento + SPEAKER com layout ILEGÍVEL (inserido à mão, porque o serviço
     *     recusaria) → o estado INVALID, que a emissão hoje esconde.
     */
    const institutionalAttendance = await save({
      name: `Padrão presença ${RUN}`,
      eventId: null,
      kind: 'ATTENDANCE',
    });
    expect(institutionalAttendance.ok).toBe(true);

    const institutionalGeneric = await save({
      name: `Padrão geral ${RUN}`,
      eventId: null,
      kind: null,
    });
    expect(institutionalGeneric.ok).toBe(true);

    /**
     * O modelo do EVENTO para `ATTENDANCE` já nasceu no primeiro caso
     * ("Modelo do evento …"); reaproveitá-lo evita colidir com o índice único
     * parcial — e o cenário continua sendo o mesmo: evento × tipo vence
     * instituição × tipo.
     */
    const existingEventAttendance = await listCertificateTemplates(tenantId, { eventId });
    expect(existingEventAttendance.some((row) => row.kind === 'ATTENDANCE')).toBe(true);

    /**
     * Layout ilegível gravado DIRETO: `saveCertificateTemplate` valida antes de
     * gravar (e é isso que impede o produto de produzir esta linha). O teste
     * reproduz o dado de uma versão anterior do código, que é o que a tela da
     * emissão precisa saber ler.
     */
    const invalidId = randomUUID();
    await withTenant(tenantId, async (tx) => {
      await tx.certificateTemplate.create({
        data: {
          id: invalidId,
          tenantId,
          eventId,
          kind: 'SPEAKER',
          name: `Modelo ilegível ${RUN}`,
          layout: { page: 'A4_LANDSCAPE', elements: 'isto-não-é-uma-lista' },
        },
      });
    });

    const resolutions = await resolveEventTemplateKinds({
      tenantId,
      eventId,
      kinds: ['ATTENDANCE', 'MINI_COURSE', 'SPEAKER'],
    });

    const attendance = resolutions.find((row) => row.kind === 'ATTENDANCE');
    expect(attendance?.state).toBe('TEMPLATE');
    expect(attendance?.target).toBe('EVENT');
    expect(attendance?.templateName).toBe(`Modelo do evento ${RUN}`);

    const mini = resolutions.find((row) => row.kind === 'MINI_COURSE');
    expect(mini?.state).toBe('TEMPLATE');
    expect(mini?.target).toBe('INSTITUTION');
    expect(mini?.templateName).toBe(`Padrão geral ${RUN}`);

    const speaker = resolutions.find((row) => row.kind === 'SPEAKER');
    expect(speaker?.state).toBe('INVALID');
    expect(speaker?.templateName).toBe(`Modelo ilegível ${RUN}`);
    expect(speaker?.templateId).toBe(invalidId);
  });
});
