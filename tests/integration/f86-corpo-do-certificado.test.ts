/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 86 · FATIA 2 — O CORPO DO CERTIFICADO É DO ORGANIZADOR (integração)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (com banco e storage de verdade)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • um modelo com elemento `BODY` emite com o `corpo` RESOLVIDO, e o valor está
 *    nos DOIS lugares assinados: `bodyText` e `variableSnapshot.corpo`;
 *  • o `layoutSnapshot` guarda o GABARITO com `{{chave}}` — o documento prova de
 *    onde o texto saiu;
 *  • a reverificação confere a assinatura, e reemitir não muda o hash;
 *  • o PDF emitido imprime o texto resolvido (o renderizador não reinterpreta);
 *  • um modelo SEM corpo continua exatamente como antes (frase gerada em código);
 *  • um certificado emitido ANTES da fase — hash calculado com a serialização
 *    publicada aqui como literal — continua íntegro. É a prova de que o elemento
 *    novo NÃO mexeu no conteúdo canônico de quem não o usa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  generateCertificate,
  getPublicCertificate,
  requestCertificate,
  verifyCertificateIntegrity,
} from '../../src/lib/certificates/certificate-service';
import { saveCertificateTemplate, getCertificateTemplate } from '../../src/lib/certificates/certificate-template-service';
import { getSigningConfig, signContentHash } from '../../src/lib/certificates/signer';
import {
  buildCanonicalPayloadV2,
  generateValidationCode,
  hashCanonicalPayload,
  type CertificateKind,
} from '../../src/domain/certificates/certificate-rules';
import {
  contentValuesFrom,
  resolveBodyTemplate,
  serializeContentValues,
  serializeLayout,
  type CertificateLayout,
} from '../../src/domain/certificates/certificate-layout-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityId: string;
let participantId: string;

const eventSlug = `evento-corpo-${RUN}`;
const startsAt = new Date(Date.now() - 5 * 86_400_000);
const endsAt = new Date(startsAt.getTime() + 3 * 86_400_000);

/**
 * O GABARITO do organizador. Tem quebra de linha e o código de validação — o código é
 * alocado ANTES da resolução, e é isso que prova que a interpolação acontece na
 * emissão (e não no renderizador, que não tem como saber o código).
 */
const GABARITO =
  'Certificamos que {{nome}} participou de {{evento}},\ncom carga horária de {{carga_horaria}}.\nCódigo de validação: {{codigo_validacao}}.';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A SERIALIZAÇÃO DO "ANTES" — MEDIDA COM O CÓDIGO ANTERIOR À FASE 86
 * ─────────────────────────────────────────────────────────────────────────────
 *  O hash de um certificado versão 2 cobre o layout serializado. Este literal foi
 *  produzido por `serializeLayout` de um modelo SEM corpo com o código de antes da
 *  fase; o teste abaixo calcula o hash com ELE (não com o serializador de hoje) e
 *  pede a reverificação. Se o serializador tivesse ganhado um campo, o hash
 *  recomputado seria outro e o documento antigo apareceria como TAMPERED.
 */
const OLD_LAYOUT_JSON =
  '{"page":"A4_LANDSCAPE","background":null,"elements":[{"id":"corpo","kind":"VARIABLE","xMm":24,"yMm":90,"widthMm":249,"heightMm":40,"align":"CENTER","font":"HELVETICA","sizePt":13,"color":"#111827","lineHeight":1.6,"text":null,"variable":"corpo"},{"id":"qr","kind":"QR","xMm":240,"yMm":158,"widthMm":34,"heightMm":34,"align":"CENTER","font":"HELVETICA","sizePt":12,"color":"#111827","lineHeight":1.4,"text":null,"variable":null}]}';

const OLD_CONTENT = {
  nome: 'Fulano de Tal',
  titulo: 'Certificado de conclusão de minicurso',
  corpo: 'Certificamos que Fulano de Tal concluiu o minicurso de Rust.',
  evento: 'Congresso Antigo de Tecnologia',
  atividade: 'Minicurso de Rust',
  carga_horaria: '4 horas',
  periodo: '10 a 12 de outubro de 2024',
  data_emissao: '15/10/2024',
  instituicao: 'Universidade Federal da Bahia',
  codigo_validacao: 'CERT-AAAAAAAA',
  url_validacao: 'https://eventflow.test/validar/CERT-AAAAAAAA',
  cpf: '',
  titulo_apresentacao: '',
};

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f86.corpo.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

/** Emite e GERA o arquivo (o worker, aqui, somos nós). */
async function issueAndGenerate(input: {
  kind: CertificateKind;
  activityId: string | null;
}): Promise<{ certificateId: string; code: string }> {
  const requested = await requestCertificate({
    tenantId,
    eventId,
    userId: participantId,
    kind: input.kind,
    activityId: input.activityId,
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
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `corpo-${RUN}`,
      name: `Instituição do Corpo ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  participantId = await createUser(`Participante do Corpo ${RUN}`);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: eventSlug,
        title: 'Congresso do Corpo do Certificado 2026',
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt,
        timezone: 'America/Bahia',
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: 'minicurso-corpo',
        title: 'Minicurso com Corpo Próprio',
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

    /**
     * A inscrição do EVENTO (activityId nulo) é a que carrega o formulário: é dela que o
     * CPF sai, e é ela que a elegibilidade do certificado do evento lê.
     */
    await tx.registration.create({
      data: {
        id: randomUUID(),
        tenantId,
        eventId,
        activityId: null,
        userId: participantId,
        status: 'CONFIRMED',
        consentData: true,
      },
    });
  });
}, 120_000);

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f86.corpo.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('modelo com corpo próprio', () => {
  let templateId: string;
  let certificateId: string;
  let code: string;

  beforeAll(async () => {
    const saved = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      name: 'Modelo com corpo do organizador',
      eventId,
      kind: 'MINI_COURSE',
      rows: {
        page: 'A4_LANDSCAPE',
        ids: ['titulo', 'corpo-gabarito', 'codigo', 'url', 'qr'],
        kinds: ['VARIABLE', 'BODY', 'VARIABLE', 'VARIABLE', 'QR'],
        texts: ['', GABARITO, '', '', ''],
        variables: ['titulo', '', 'codigo_validacao', 'url_validacao', ''],
        xMm: ['24', '24', '24', '24', '240'],
        yMm: ['44', '92', '172', '180', '158'],
        widthMm: ['249', '249', '70', '90', '34'],
        heightMm: ['12', '40', '8', '6', '34'],
        aligns: ['CENTER', 'CENTER', 'LEFT', 'LEFT', 'CENTER'],
        fonts: ['HELVETICA_BOLD', 'HELVETICA', 'HELVETICA_BOLD', 'HELVETICA', 'HELVETICA'],
        sizePt: ['22', '13', '11', '8', '12'],
        colors: ['#1d4ed8', '#111827', '#1d4ed8', '#4b5563', '#111827'],
        lineHeights: ['1.4', '1.6', '1.4', '1.4', '1.4'],
      },
    });

    if (!saved.ok) throw new Error(`Falha ao salvar o modelo: ${saved.code} ${saved.message}`);
    templateId = saved.templateId;

    const issued = await issueAndGenerate({ kind: 'MINI_COURSE', activityId });
    certificateId = issued.certificateId;
    code = issued.code;
  }, 120_000);

  it('o modelo guarda o gabarito no elemento BODY', async () => {
    const record = await getCertificateTemplate(tenantId, templateId);
    const body = record?.layout.elements.find((element) => element.kind === 'BODY');

    expect(body?.text).toBe(GABARITO);
    expect(body?.variable).toBeNull();
  });

  it('a emissão grava o corpo RESOLVIDO em `bodyText` e em `corpo`', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { bodyText: true, variableSnapshot: true, validationCode: true },
      }),
    );

    const snapshot = row.variableSnapshot as Record<string, string>;
    const expected = resolveBodyTemplate(GABARITO, snapshot);

    expect(row.bodyText).toBe(expected);
    expect(snapshot.corpo).toBe(expected);

    // O texto impresso é o do organizador, com as variáveis resolvidas — e sem chaves.
    expect(expected).toContain('Certificamos que');
    expect(expected).toContain(`Participante do Corpo ${RUN}`);
    expect(expected).toContain('Congresso do Corpo do Certificado 2026');
    expect(expected).toContain('4h');
    expect(expected).toContain(row.validationCode);
    expect(expected).not.toContain('{{');

    // A quebra de linha do gabarito sobrevive à interpolação.
    expect(expected.split('\n')).toHaveLength(3);
  });

  it('o `layoutSnapshot` guarda o GABARITO (de onde o texto saiu)', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { layoutSnapshot: true, bodyText: true },
      }),
    );

    const layout = row.layoutSnapshot as CertificateLayout;
    const body = layout.elements.find((element) => element.kind === 'BODY');

    expect(body?.text).toBe(GABARITO);
    // O snapshot continua sendo a serialização canônica do modelo (é o que o hash cobre).
    expect(serializeLayout(layout)).toContain(GABARITO.replace(/\n/g, '\\n'));
    // E o texto resolvido NÃO está no layout: ele vive em `bodyText`/`corpo`.
    expect(row.bodyText).not.toBe(GABARITO);
  });

  it('a reverificação valida o documento e a página pública confere a assinatura', async () => {
    const integrity = await verifyCertificateIntegrity(certificateId, tenantId);

    expect(integrity.ok).toBe(true);
    expect(integrity.signatureValid).toBe(true);
    expect(integrity.hasSignature).toBe(true);

    const publicResult = await getPublicCertificate(code);
    expect(publicResult.ok).toBe(true);
    if (!publicResult.ok) return;

    expect(publicResult.verdict.status).toBe('VALID');
    expect(publicResult.certificate?.signatureValid).toBe(true);
  });

  it('reemitir NÃO muda o hash (o corpo resolvido é o mesmo snapshot)', async () => {
    const before = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { contentHash: true, bodyText: true },
      }),
    );

    const again = await generateCertificate({ tenantId, certificateId });
    expect(again.ok).toBe(true);

    const after = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { contentHash: true, bodyText: true },
      }),
    );

    expect(after.contentHash).toBe(before.contentHash);
    expect(after.bodyText).toBe(before.bodyText);

    const integrity = await verifyCertificateIntegrity(certificateId, tenantId);
    expect(integrity.ok).toBe(true);
  });

  it('o PDF emitido imprime o texto RESOLVIDO — nunca o gabarito', async () => {
    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: certificateId },
        select: { storageKey: true },
      }),
    );

    const pdf = row.storageKey ? await readObject(row.storageKey) : null;
    expect(pdf).not.toBeNull();

    const text = (pdf ?? Buffer.alloc(0)).toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Certificamos que');
    expect(text).toContain(`Participante do Corpo ${RUN}`);
    expect(text).not.toContain('{{');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('modelo SEM corpo continua como antes', () => {
  it('o certificado sai com a frase gerada em código e sem BODY no snapshot', async () => {
    const saved = await saveCertificateTemplate({
      tenantId,
      actorId: participantId,
      name: 'Modelo sem corpo (diploma)',
      eventId,
      kind: 'ATTENDANCE',
      presetId: 'diploma',
    });

    expect(saved.ok).toBe(true);

    const issued = await issueAndGenerate({ kind: 'ATTENDANCE', activityId: null });

    const row = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({
        where: { id: issued.certificateId },
        select: { bodyText: true, variableSnapshot: true, layoutSnapshot: true, contentHash: true },
      }),
    );

    const layout = row.layoutSnapshot as CertificateLayout;
    expect(layout.elements.some((element) => element.kind === 'BODY')).toBe(false);

    // A frase gerada (`buildCertificateText`) continua sendo o corpo do documento.
    expect(row.bodyText.startsWith('Certificamos que')).toBe(true);
    expect(row.bodyText).toContain('Congresso do Corpo do Certificado 2026');
    expect(row.bodyText).not.toContain('{{');

    const snapshot = row.variableSnapshot as Record<string, string>;
    expect(snapshot.corpo).toBe(row.bodyText);

    const integrity = await verifyCertificateIntegrity(issued.certificateId, tenantId);
    expect(integrity.ok).toBe(true);
  }, 120_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('certificado emitido ANTES da fase continua verificando', () => {
  it('o hash calculado com a serialização ANTIGA continua batendo (e a adulteração reprova)', async () => {
    const validationCode = generateValidationCode((max) => randomInt(0, max));
    const issuedAt = new Date('2024-10-15T12:00:00.000Z');
    const content = contentValuesFrom(OLD_CONTENT);

    /**
     * O conteúdo canônico é montado com o LITERAL antigo do layout — nunca com o
     * serializador de hoje. É o que simula "o documento foi emitido antes".
     */
    const canonical = buildCanonicalPayloadV2({
      version: 2,
      validationCode,
      tenantId,
      eventId,
      userId: participantId,
      activityId: null,
      kind: 'MERIT',
      recipientName: OLD_CONTENT.nome,
      title: OLD_CONTENT.titulo,
      bodyText: OLD_CONTENT.corpo,
      workloadMinutes: 240,
      issuedAt: issuedAt.toISOString(),
      layout: OLD_LAYOUT_JSON,
      content: serializeContentValues(content),
    });

    const contentHash = hashCanonicalPayload(canonical);
    const { keyId, alg } = getSigningConfig();

    const created = await withTenant(tenantId, (tx) =>
      tx.certificate.create({
        data: {
          id: randomUUID(),
          tenantId,
          eventId,
          userId: participantId,
          activityId: null,
          kind: 'MERIT',
          status: 'ISSUED',
          validationCode,
          title: OLD_CONTENT.titulo,
          recipientName: OLD_CONTENT.nome,
          bodyText: OLD_CONTENT.corpo,
          workloadMinutes: 240,
          issuedAt,
          contentHash,
          signature: signContentHash({ contentHash }),
          signatureKeyId: keyId,
          signatureAlg: alg,
          layoutSnapshot: JSON.parse(OLD_LAYOUT_JSON) as object,
          variableSnapshot: content as unknown as object,
        },
        select: { id: true },
      }),
    );

    /**
     * O layout lido do banco é NORMALIZADO; ele tem de serializar exatamente como o
     * literal usado no hash. Se esta linha falhar, o serializador mudou — e o teste
     * seguinte reprovaria como TAMPERED, que é o sintoma do defeito de verdade.
     */
    const stored = await withTenant(tenantId, (tx) =>
      tx.certificate.findUniqueOrThrow({ where: { id: created.id }, select: { layoutSnapshot: true } }),
    );
    expect(serializeLayout(stored.layoutSnapshot as CertificateLayout)).toBe(OLD_LAYOUT_JSON);

    const integrity = await verifyCertificateIntegrity(created.id, tenantId);
    expect(integrity.ok).toBe(true);
    expect(integrity.signatureValid).toBe(true);
    expect(integrity.contentHash).toBe(contentHash);

    const publicResult = await getPublicCertificate(validationCode);
    expect(publicResult.ok).toBe(true);
    if (!publicResult.ok) return;
    expect(publicResult.verdict.status).toBe('VALID');
    expect(publicResult.certificate?.signatureValid).toBe(true);

    // A verificação NÃO é vazia: mexer no corpo do documento antigo reprova.
    await withTenant(tenantId, (tx) =>
      tx.certificate.update({ where: { id: created.id }, data: { bodyText: 'Outro texto qualquer.' } }),
    );

    const tampered = await verifyCertificateIntegrity(created.id, tenantId);
    expect(tampered.ok).toBe(false);
    expect(tampered.signatureValid).toBe(false);
  });
});
