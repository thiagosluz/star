/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 51 — A INTEGRIDADE FAZ PARTE DA AUTENTICIDADE (defeito real, dívida E7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A validação pública olhava só o REGISTRO (emitido? revogado? vencido?) e tratava
 *  a assinatura como aviso à parte: a página dizia "Certificado autêntico" e oferecia
 *  o PDF de um documento cujo conteúdo não correspondia mais à assinatura gravada — e
 *  a rota de download entregava o arquivo sem conferir nada disso.
 *
 *  O sintoma apareceu ao construir a conferência em LOTE (E7): ela reprovava o mesmo
 *  documento que a tela de um código aprovava. Duas telas públicas, respostas opostas
 *  sobre a mesma prova — e a mais permissiva era a de um código só, que é justamente
 *  o instrumento em que um terceiro se apoia para ACEITAR o documento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  generateCertificate,
  getPublicCertificate,
  getPublicCertificateDownloadUrl,
  issueCertificate,
} from '../../src/lib/certificates/certificate-service';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let reviewerId: string;

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f51.cert.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

/** Emite e GERA o arquivo (o worker, aqui, somos nós). */
async function issuedCertificate(): Promise<{ validationCode: string; certificateId: string }> {
  const issued = await issueCertificate({
    tenantId,
    eventId,
    userId: reviewerId,
    kind: 'REVIEWER',
  });

  if (!issued.ok) throw new Error(issued.message);

  if (!issued.generated) {
    const generated = await generateCertificate({ tenantId, certificateId: issued.certificateId });

    if (!generated.ok) throw new Error(generated.message);
  }

  return { validationCode: issued.validationCode, certificateId: issued.certificateId };
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f51-cert-${RUN}`,
      name: `Instituição da integridade ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  reviewerId = await createUser('Revisor da integridade');

  const autorId = await createUser('Autor da integridade');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `f51-cert-evento-${RUN}`,
        title: 'Congresso da integridade',
        status: 'FINISHED',
        modality: 'IN_PERSON',
        timezone: 'America/Bahia',
        startsAt: new Date('2026-09-17T12:00:00.000Z'),
        endsAt: new Date('2026-09-19T12:00:00.000Z'),
      },
    });

    /**
     * O certificado de REVISOR exige parecer concluído — e o parecer exige a submissão.
     * O fixture cria os dois para que o certificado seja emitido pelo caminho de
     * verdade (a mesma exigência que a instituição enfrenta).
     */
    const submissionId = randomUUID();

    await tx.submission.create({
      data: {
        id: submissionId,
        tenantId,
        eventId,
        protocol: `F51-${RUN}`,
        title: 'Trabalho avaliado na conferência de integridade',
        abstract:
          'Resumo do trabalho avaliado, escrito para que o certificado de revisor possa ser emitido no teste de integridade do certificado.',
        keywords: ['integridade', 'certificado', 'revisor'],
        status: 'ACCEPTED',
        submittedById: autorId,
        submittedAt: new Date('2026-09-18T12:00:00.000Z'),
      },
    });

    await tx.review.create({
      data: {
        id: randomUUID(),
        tenantId,
        submissionId,
        reviewerId,
        status: 'SUBMITTED',
        recommendation: 'ACCEPT',
        isBlind: true,
        submittedAt: new Date('2026-09-18T18:00:00.000Z'),
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f51.cert.${RUN}` } } });
});

describe('integridade do certificado (FASE 51 · defeito real da dívida E7)', () => {
  it('certificado íntegro continua AUTÊNTICO e baixável (sem falso positivo)', async () => {
    const { validationCode } = await issuedCertificate();

    const result = await getPublicCertificate(validationCode);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('VALID');
    expect(result.verdict.isUsable).toBe(true);
    expect(result.certificate?.signatureValid).toBe(true);
  });

  it('conteúdo ADULTERADO não é autêntico e o download é RECUSADO', async () => {
    const { validationCode, certificateId } = await issuedCertificate();

    /** A adulteração é a que a assinatura existe para detectar: o corpo do documento. */
    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: certificateId },
        data: { bodyText: 'Texto trocado depois da emissão, por fora da aplicação.' },
      }),
    );

    const result = await getPublicCertificate(validationCode);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('TAMPERED');
    expect(result.verdict.isUsable).toBe(false);
    expect(result.verdict.message).toMatch(/não confere|alterado/i);
    expect(result.certificate?.signatureValid).toBe(false);

    /**
     * E a ROTA de download recusa também: esconder o botão na tela não impede ninguém
     * de chamar o endereço, e é esta rota que entrega o arquivo.
     */
    const download = await getPublicCertificateDownloadUrl(validationCode);

    expect(download.ok).toBe(false);
  });

  it('certificado ANTIGO sem assinatura gravada não é acusado de adulteração', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A DIFERENÇA ENTRE "NÃO HÁ PROVA" E "A PROVA NÃO CONFERE"
     * ─────────────────────────────────────────────────────────────────────────────
     *  Certificado emitido antes de a assinatura existir (F6) não tem o que conferir.
     *  Acusá-lo de adulteração seria pior que o defeito corrigido: recusaria download de
     *  documento legítimo e diria ao público que a instituição emitiu algo violado. O
     *  veredito fica como estava e a limitação é declarada — a assinatura é a prova, e
     *  sem ela a plataforma não tem prova (nem contra).
     */
    const { validationCode, certificateId } = await issuedCertificate();

    await withTenant(tenantId, (tx) =>
      tx.certificate.update({ where: { id: certificateId }, data: { signature: null } }),
    );

    const result = await getPublicCertificate(validationCode);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).not.toBe('TAMPERED');
    expect(result.certificate?.signatureValid).toBe(false);
  });

  it('a REVOGAÇÃO continua falando mais alto que a adulteração', async () => {
    /**
     * A ordem das perguntas importa: revogar é ATO da instituição, adulterar é violação
     * do arquivo. Quem lê a página precisa da causa mais forte primeiro — e o
     * documento adulterado E revogado aparece como revogado.
     */
    const { validationCode, certificateId } = await issuedCertificate();

    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: certificateId },
        data: { bodyText: 'Adulterado.', revokedAt: new Date(), revokedReason: 'fraude' },
      }),
    );

    const result = await getPublicCertificate(validationCode);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.verdict.status).toBe('REVOKED');
    expect(result.verdict.isUsable).toBe(false);
  });
});
