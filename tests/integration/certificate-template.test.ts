import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  clearTemplateBackground,
  deleteCertificateTemplate,
  getCertificateTemplate,
  listCertificateTemplates,
  readTemplateBackground,
  resolveTemplateFor,
  saveCertificateTemplate,
  setTemplateBackground,
} from '../../src/lib/certificates/certificate-template-service';
import {
  requestCertificate,
  generateCertificate,
  getPublicCertificate,
} from '../../src/lib/certificates/certificate-service';
import {
  CERTIFICATE_TEMPLATE_PRESETS,
  findPreset,
  type CertificateLayout,
} from '../../src/domain/certificates/certificate-layout-rules';
import {
  buildCanonicalPayloadV2,
  hashCanonicalPayload,
  type CertificateKind,
} from '../../src/domain/certificates/certificate-rules';
import { contentValuesFrom, serializeContentValues, serializeLayout } from '../../src/domain/certificates/certificate-layout-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let otherEventId: string;
let activityId: string;
let participantId: string;

const eventSlug = `evento-modelo-${RUN}`;
const startsAt = new Date(Date.now() - 5 * 86_400_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Modelo visual do certificado (FASE 40) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a PRECEDÊNCIA do modelo (evento+tipo → evento → instituição+tipo → instituição
 *    → desenho padrão) e a exclusividade de cada combinação, decidida pelo BANCO;
 *  • a arte é aceita pelos BYTES (JPEG RGB, resolução mínima para a página) e
 *    recusada quando o PDF à mão não saberia embutir (CMYK, progressivo);
 *  • a arte CONTA na quota de armazenamento da instituição (FASE 21);
 *  • o certificado emitido com modelo grava o LAYOUT e o CONTEÚDO congelados, e o
 *    hash cobre os dois — a validação pública continua conferindo;
 *  • editar o modelo DEPOIS não muda documento emitido: reemitir gera os mesmos
 *    bytes e o mesmo hash;
 *  • a RLS isola os modelos entre instituições;
 *  • excluir o modelo não estraga o certificado que o usou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FIXTURE DE PRESENÇA É DIRETA, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A elegibilidade para certificado lê `Attendance` e `Registration`; o caminho que
 *  as cria (credenciamento) tem cobertura própria em `certification.test.ts` e
 *  `credential-checkin.test.ts`. Aqui o que interessa é o DESENHO do documento, e a
 *  fixture garante apenas o que a elegibilidade lê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f40.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

/** Um JPEG de verdade: SOF0 com as medidas e os componentes pedidos. */
function jpeg(input: { width: number; height: number; components?: number; progressive?: boolean; orientation?: number }): Uint8Array {
  const components = input.components ?? 3;
  const bytes: number[] = [0xff, 0xd8];

  bytes.push(0xff, 0xe0, 0x00, 0x10);
  bytes.push(0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00);

  if (input.orientation && input.orientation !== 1) {
    const payload: number[] = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    payload.push(0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00);
    payload.push(0x01, 0x00);
    payload.push(0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00);
    payload.push(input.orientation, 0x00, 0x00, 0x00);
    payload.push(0x00, 0x00, 0x00, 0x00);

    const length = payload.length + 2;
    bytes.push(0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload);
  }

  const sofLength = 8 + components * 3;
  bytes.push(0xff, input.progressive ? 0xc2 : 0xc0, (sofLength >> 8) & 0xff, sofLength & 0xff, 0x08);
  bytes.push((input.height >> 8) & 0xff, input.height & 0xff, (input.width >> 8) & 0xff, input.width & 0xff, components);

  for (let index = 0; index < components; index += 1) bytes.push(index + 1, 0x11, 0x00);

  bytes.push(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9);

  return Uint8Array.from(bytes);
}

const ART = jpeg({ width: 3508, height: 2480 });

async function createTemplate(input: {
  name: string;
  presetId?: string;
  eventId?: string | null;
  kind?: CertificateKind | null;
  tenant?: string;
}): Promise<string> {
  const result = await saveCertificateTemplate({
    tenantId: input.tenant ?? tenantId,
    actorId: participantId,
    name: input.name,
    eventId: input.eventId ?? null,
    kind: input.kind ?? null,
    presetId: input.presetId ?? 'classico-institucional',
  });

  if (!result.ok) throw new Error(`Falha ao criar o modelo: ${result.message}`);

  return result.templateId;
}

/** Emite e gera o certificado de um participante, devolvendo o código. */
async function issueAndGenerate(
  kind: CertificateKind = 'MINI_COURSE',
  userId: string = participantId,
): Promise<{ certificateId: string; code: string }> {
  const requested = await requestCertificate({
    tenantId,
    eventId,
    userId,
    kind,
    activityId,
    actorId: participantId,
  });

  if (!requested.ok) throw new Error(`Falha ao pedir o certificado: ${requested.message}`);

  const generated = await generateCertificate({ tenantId, certificateId: requested.certificateId });

  if (!generated.ok) throw new Error(`Falha ao gerar o certificado: ${generated.message}`);

  return { certificateId: requested.certificateId, code: requested.validationCode };
}

async function readObject(key: string): Promise<Buffer | null> {
  return withTenant(tenantId, async () => {
    const { BUCKETS, getObjectBuffer } = await import('../../src/lib/storage/s3-client');

    return getObjectBuffer(BUCKETS.certificates(), key).catch(() => null);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  otherEventId = randomUUID();

  for (const [id, slug, name] of [
    [tenantId, `modelo-${RUN}`, `Instituição do Modelo ${RUN}`],
    [otherTenantId, `modelo-outro-${RUN}`, `Outra Instituição ${RUN}`],
  ] as const) {
    await adminPrisma.tenant.create({
      data: { id, slug, name, status: 'ACTIVE', plan: 'FREE', timezone: 'America/Bahia' },
    });
  }

  participantId = await createUser(`Participante Modelo ${RUN}`);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Congresso do Modelo Visual 2026',
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.event.create({
      data: {
        id: otherEventId,
        tenantId,
        slug: `${eventSlug}-2`,
        title: 'Segundo Evento do Modelo',
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 86_400_000),
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    activityId = randomUUID();

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: 'minicurso-modelo',
        title: 'Minicurso com Modelo Visual',
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        workloadMinutes: 240,
      },
    });

    const registrationId = randomUUID();

    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId,
        eventId,
        activityId,
        userId: participantId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: startsAt,
      },
    });

    await tx.attendance.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId,
        registrationId,
        userId: participantId,
        status: 'PRESENT',
        source: 'MANUAL_STAFF',
        checkedInAt: startsAt,
        checkedOutAt: new Date(startsAt.getTime() + 240 * 60_000),
        minutesAttended: 240,
      },
    });
  });
}, 120_000);

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `.${RUN}.` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('modelos prontos viram modelo da instituição', () => {
  it('cria a partir de um modelo pronto e guarda o layout validado', async () => {
    const templateId = await createTemplate({
      name: 'Clássico da casa',
      presetId: 'diploma',
      eventId: otherEventId,
      kind: 'ATTENDANCE',
    });
    const record = await getCertificateTemplate(tenantId, templateId);

    expect(record).not.toBeNull();
    expect(record?.layout.elements.length).toBe(findPreset('diploma')?.layout.elements.length);
    expect(record?.layout.page).toBe('A4_LANDSCAPE');
    expect(record?.layout.background).toBeNull();
  });

  it('exige nome utilizável', async () => {
    const result = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      name: 'ab',
      presetId: 'minimalista',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_INPUT');
  });

  it('recusa layout que a própria casa não aceita, com os motivos', async () => {
    const result = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      name: 'Modelo sem QR',
      rows: {
        page: 'A4_LANDSCAPE',
        ids: ['nome'],
        kinds: ['VARIABLE'],
        texts: [''],
        variables: ['nome'],
        xMm: ['20'],
        yMm: ['20'],
        widthMm: ['200'],
        heightMm: ['10'],
        aligns: ['CENTER'],
        fonts: ['HELVETICA'],
        sizePt: ['12'],
        colors: ['#111827'],
        lineHeights: ['1.4'],
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
      expect(result.details?.join(' ')).toContain('QR Code');
    }
  });

  it('não deixa dois modelos para o mesmo evento e tipo (o BANCO decide)', async () => {
    await createTemplate({ name: 'Minicurso A', eventId, kind: 'MINI_COURSE' });

    const second = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      name: 'Minicurso B',
      eventId,
      kind: 'MINI_COURSE',
      presetId: 'minimalista',
    });

    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.message).toContain('Já existe um modelo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('precedência do modelo', () => {
  beforeAll(async () => {
    await createTemplate({ name: 'Instituição — qualquer tipo' });
    await createTemplate({ name: 'Instituição — palestrante', kind: 'SPEAKER', presetId: 'faixa-lateral' });
    await createTemplate({ name: 'Evento — qualquer tipo', eventId, presetId: 'minimalista' });
  });

  it('o mais específico ganha: EVENTO + TIPO', async () => {
    const resolved = await resolveTemplateFor({ tenantId, eventId, kind: 'MINI_COURSE' });
    const record = resolved ? await getCertificateTemplate(tenantId, resolved.templateId) : null;

    expect(record?.name).toBe('Minicurso A');
  });
  it('sem modelo do tipo, vale o do EVENTO', async () => {
    const resolved = await resolveTemplateFor({ tenantId, eventId, kind: 'ATTENDANCE' });
    const record = resolved ? await getCertificateTemplate(tenantId, resolved.templateId) : null;

    expect(record?.name).toBe('Evento — qualquer tipo');
  });

  it('em outro evento, vale o da INSTITUIÇÃO para o tipo', async () => {
    const resolved = await resolveTemplateFor({ tenantId, eventId: otherEventId, kind: 'SPEAKER' });
    const record = resolved ? await getCertificateTemplate(tenantId, resolved.templateId) : null;

    expect(record?.name).toBe('Instituição — palestrante');
  });

  it('sem nada específico, vale o modelo geral da instituição', async () => {
    const resolved = await resolveTemplateFor({ tenantId, eventId: otherEventId, kind: 'REVIEWER' });
    const record = resolved ? await getCertificateTemplate(tenantId, resolved.templateId) : null;

    expect(record?.name).toBe('Instituição — qualquer tipo');
  });

  it('a outra instituição não enxerga nem resolve estes modelos (RLS)', async () => {
    const list = await listCertificateTemplates(otherTenantId);
    expect(list).toHaveLength(0);

    const resolved = await resolveTemplateFor({ tenantId: otherTenantId, eventId, kind: 'MINI_COURSE' });
    expect(resolved).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('arte de fundo', () => {
  let templateId: string;

  beforeAll(async () => {
    templateId = await createTemplate({ name: 'Com arte', eventId: otherEventId, kind: 'ORGANIZER' });
  });

  it('aceita JPEG RGB e guarda impressão, medidas e orientação', async () => {
    const result = await setTemplateBackground({ tenantId, templateId, bytes: ART });

    expect(result.ok).toBe(true);

    const record = await getCertificateTemplate(tenantId, templateId);
    const background = record?.layout.background;

    expect(background?.widthPx).toBe(3508);
    expect(background?.heightPx).toBe(2480);
    expect(background?.colorComponents).toBe(3);
    expect(background?.orientation).toBe(1);
    expect(background?.sizeBytes).toBe(ART.length);
    expect(background?.fit).toBe('COVER');
    expect(record?.backgroundBytes).toBe(ART.length);
  });

  it('a arte vai para o bucket privado, byte a byte, e a chave é do modelo', async () => {
    const record = await getCertificateTemplate(tenantId, templateId);
    const bytes = record ? await readTemplateBackground(record.layout) : null;

    expect(bytes?.length).toBe(ART.length);
    expect(bytes?.equals(Buffer.from(ART))).toBe(true);
    expect(record?.layout.background?.objectKey).toContain(`/certificate-templates/${templateId}/`);
  });

  it('conta na quota de armazenamento da instituição', async () => {
    const { storageUsage } = await import('../../src/lib/storage/storage-quota');
    const before = await storageUsage(tenantId);

    // Reenvia a MESMA arte: a quota desconta o arquivo substituído (FASE 21) e o
    // total não pode dobrar.
    await setTemplateBackground({ tenantId, templateId, bytes: ART });

    const after = await storageUsage(tenantId);
    expect(after.certificateTemplateBytes).toBe(before.certificateTemplateBytes);
    expect(after.certificateTemplateBytes).toBeGreaterThanOrEqual(ART.length);
  });

  it('recusa CMYK em vez de converter as cores', async () => {
    const result = await setTemplateBackground({
      tenantId,
      templateId,
      bytes: jpeg({ width: 3508, height: 2480, components: 4 }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_BACKGROUND');
      expect(result.details?.join(' ')).toContain('RGB');
    }
  });

  it('recusa JPEG progressivo e arte pequena demais', async () => {
    const progressive = await setTemplateBackground({
      tenantId,
      templateId,
      bytes: jpeg({ width: 3508, height: 2480, progressive: true }),
    });
    expect(progressive.ok).toBe(false);
    if (!progressive.ok) expect(progressive.details?.join(' ')).toContain('progressivo');

    const small = await setTemplateBackground({
      tenantId,
      templateId,
      bytes: jpeg({ width: 800, height: 600 }),
    });
    expect(small.ok).toBe(false);
    if (!small.ok) expect(small.details?.join(' ')).toContain('150');
  });

  it('recusa arquivo que não é JPEG', async () => {
    const result = await setTemplateBackground({
      tenantId,
      templateId,
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details?.join(' ')).toContain('JPEG');
  });

  it('a arte anterior continua valendo quando a nova é recusada', async () => {
    const record = await getCertificateTemplate(tenantId, templateId);
    expect(record?.layout.background?.checksum).toBeTruthy();
    expect(record?.layout.background?.sizeBytes).toBe(ART.length);
  });

  it('remover a arte limpa o layout e o objeto', async () => {
    const before = await getCertificateTemplate(tenantId, templateId);
    const key = before?.layout.background?.objectKey ?? '';
    const previousBytes = before?.layout.background?.sizeBytes ?? 0;

    const { storageUsage } = await import('../../src/lib/storage/storage-quota');
    const usageBefore = await storageUsage(tenantId);

    const result = await clearTemplateBackground({ tenantId, templateId });

    expect(result.ok).toBe(true);

    const record = await getCertificateTemplate(tenantId, templateId);
    expect(record?.layout.background).toBeNull();
    expect(record?.backgroundBytes).toBe(0);
    expect(await readObject(key)).toBeNull();

    const usageAfter = await storageUsage(tenantId);
    expect(usageAfter.certificateTemplateBytes).toBe(usageBefore.certificateTemplateBytes - previousBytes);
  });

  it('só JPEG: um PNG com extensão trocada não passa', async () => {
    const result = await setTemplateBackground({
      tenantId,
      templateId,
      bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
    });

    expect(result.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('emissão com modelo visual', () => {
  let templateId: string;
  let certificateId: string;
  let code: string;

  beforeAll(async () => {
    /**
     * O modelo que vale para (este evento, minicurso) já existe — criado no bloco da
     * precedência. Aqui ele ganha ARTE, e é isso que o teste quer medir: o PDF
     * embutido.
     */
    const resolved = await resolveTemplateFor({ tenantId, eventId, kind: 'MINI_COURSE' });

    if (!resolved) throw new Error('O modelo do minicurso deveria ter sido criado no bloco da precedência.');

    templateId = resolved.templateId;
    await setTemplateBackground({ tenantId, templateId, bytes: ART });

    const issued = await issueAndGenerate('MINI_COURSE');
    certificateId = issued.certificateId;
    code = issued.code;
  }, 120_000);

  it('o certificado guarda o layout E o conteúdo congelados, e aponta o modelo', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { layoutSnapshot: true, variableSnapshot: true, templateId: true, contentHash: true },
      }),
    );

    expect(row.templateId).toBe(templateId);
    expect(row.layoutSnapshot).not.toBeNull();
    expect(row.variableSnapshot).not.toBeNull();
  });

  it('o conteúdo congelado traz o que o documento imprime (evento, instituição, atividade)', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({ where: { id: certificateId }, select: { variableSnapshot: true } }),
    );

    const values = row.variableSnapshot as Record<string, string>;

    expect(values.evento).toBe('Congresso do Modelo Visual 2026');
    expect(values.instituicao).toContain('Instituição do Modelo');
    expect(values.atividade).toBe('Minicurso com Modelo Visual');
    expect(values.carga_horaria).toContain('4');
    expect(values.hash).toBeUndefined();
  });

  it('o hash cobre o layout e o conteúdo congelados (versão 2 do documento)', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: {
          validationCode: true,
          contentHash: true,
          layoutSnapshot: true,
          variableSnapshot: true,
          recipientName: true,
          title: true,
          bodyText: true,
          workloadMinutes: true,
          issuedAt: true,
          tenantId: true,
          eventId: true,
          userId: true,
          activityId: true,
          kind: true,
        },
      }),
    );

    const layout = row.layoutSnapshot as CertificateLayout;
    const canonical = buildCanonicalPayloadV2({
      version: 2,
      validationCode: row.validationCode,
      tenantId: row.tenantId,
      eventId: row.eventId,
      userId: row.userId,
      activityId: row.activityId,
      kind: row.kind,
      recipientName: row.recipientName,
      title: row.title,
      bodyText: row.bodyText,
      workloadMinutes: row.workloadMinutes,
      issuedAt: (row.issuedAt ?? new Date()).toISOString(),
      layout: serializeLayout(layout),
      content: serializeContentValues(contentValuesFrom(row.variableSnapshot as Record<string, string>)),
    });

    expect(hashCanonicalPayload(canonical)).toBe(row.contentHash);
  });

  it('a validação pública confere a assinatura do documento com layout', async () => {
    const result = await getPublicCertificate(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.certificate?.signatureValid).toBe(true);
    expect(result.verdict.status).toBe('VALID');
  });

  it('o PDF emitido embute a arte como /DCTDecode e traz os valores impressos', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({ where: { id: certificateId }, select: { storageKey: true } }),
    );

    const pdf = row.storageKey ? await readObject(row.storageKey) : null;

    expect(pdf).not.toBeNull();
    const text = (pdf ?? Buffer.alloc(0)).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/DCTDecode');
    expect(text).toContain('Participante Modelo');
    expect(text).toContain('Congresso do Modelo Visual 2026');
    expect(pdf?.includes(Buffer.from(ART))).toBe(true);
  });

  it('EDITAR o modelo depois não muda o documento emitido', async () => {
    const before = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { contentHash: true, layoutSnapshot: true, storageKey: true },
      }),
    );

    const pdfBefore = before.storageKey ? await readObject(before.storageKey) : null;

    // O organizador muda o desenho do modelo (outro modelo pronto, mais elementos).
    // O ALVO vai junto: omitir evento e tipo moveria o modelo para "instituição,
    // qualquer tipo" — e é isso que a tela evita ao pré-preencher os seletores.
    const edited = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      templateId,
      name: 'Minicurso — desenho trocado',
      eventId,
      kind: 'MINI_COURSE',
      presetId: 'diploma',
    });
    expect(edited.ok, edited.ok ? '' : `${edited.code}: ${edited.message} ${edited.details?.join(' ') ?? ''}`).toBe(true);

    // Reemite: o desenho congelado manda, não o modelo atual.
    const again = await generateCertificate({ tenantId, certificateId });

    expect(again.ok).toBe(true);

    const after = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: {
          contentHash: true,
          layoutSnapshot: true,
          sizeBytes: true,
          storageKey: true,
        },
      }),
    );

    expect(after.contentHash).toBe(before.contentHash);
    expect(JSON.stringify(after.layoutSnapshot)).toBe(JSON.stringify(before.layoutSnapshot));

    const pdfAfter = after.storageKey ? await readObject(after.storageKey) : null;
    expect(pdfAfter?.equals(pdfBefore ?? Buffer.alloc(0))).toBe(true);

    // E o MODELO realmente mudou (nome e conjunto de elementos), provando que a
    // imutabilidade vem do snapshot, não de o modelo não ter sido tocado.
    const template = await getCertificateTemplate(tenantId, templateId);
    expect(template?.name).toBe('Minicurso — desenho trocado');
    expect(template?.layout.elements.length).toBe(findPreset('diploma')?.layout.elements.length);

    /**
     * E o alvo foi PRESERVADO: mover o modelo para outro escopo é permitido, mas só
     * quando o organizador pede — o teste confirma que editar o desenho não move.
     */
    expect(template?.eventId).toBe(eventId);
    expect(template?.kind).toBe('MINI_COURSE');
  }, 120_000);

  it('excluir o modelo não estraga o certificado que o usou', async () => {
    const removed = await deleteCertificateTemplate({ tenantId, templateId });
    expect(removed.ok).toBe(true);

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { templateId: true, layoutSnapshot: true },
      }),
    );

    expect(row.templateId).toBeNull();
    expect(row.layoutSnapshot).not.toBeNull();

    const validation = await getPublicCertificate(code);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.certificate?.signatureValid).toBe(true);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('sem modelo, o desenho antigo continua valendo', () => {
  it('o certificado sai na versão 1 do documento (sem layout no snapshot)', async () => {
    await withTenant(tenantId, (tx) => tx.certificateTemplate.deleteMany({ where: { tenantId } }));

    /**
     * Um participante NOVO: o certificado é único por (instituição, pessoa, evento,
     * atividade, tipo), e reemitir o do teste anterior devolveria o documento que já
     * tem layout — medindo o passado em vez do caminho sem modelo.
     */
    const freshParticipant = await withTenant(tenantId, async (tx) => {
      const userId = await createUser(`Participante Sem Modelo ${RUN}`);
      const registrationId = randomUUID();

      await tx.registration.create({
        data: {
          id: registrationId,
          tenantId,
          eventId,
          activityId,
          userId,
          status: 'ATTENDED',
          consentData: true,
          checkedInAt: startsAt,
        },
      });

      await tx.attendance.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          activityId,
          registrationId,
          userId,
          status: 'PRESENT',
          source: 'MANUAL_STAFF',
          checkedInAt: startsAt,
          checkedOutAt: new Date(startsAt.getTime() + 240 * 60_000),
          minutesAttended: 240,
        },
      });

      return userId;
    });

    const { certificateId, code } = await issueAndGenerate('MINI_COURSE', freshParticipant);

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { layoutSnapshot: true, variableSnapshot: true, templateId: true, contentHash: true, storageKey: true },
      }),
    );

    expect(row.layoutSnapshot).toBeNull();
    expect(row.variableSnapshot).toBeNull();
    expect(row.templateId).toBeNull();

    const pdf = row.storageKey ? await readObject(row.storageKey) : null;
    expect(pdf?.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
    // O desenho fixo da FASE 6 não embute imagem: nada de /DCTDecode.
    expect(pdf?.toString('latin1')).not.toContain('/DCTDecode');

    const validation = await getPublicCertificate(code);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.certificate?.signatureValid).toBe(true);
  }, 120_000);

  it('os cinco modelos prontos existem e nenhum traz arte embutida', () => {
    expect(CERTIFICATE_TEMPLATE_PRESETS).toHaveLength(5);
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) expect(preset.layout.background).toBeNull();
  });
});
