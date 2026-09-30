/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — conferência de certificados em lote (FASE 51, dívida E7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PROVAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • o lote com válido, inexistente e revogado devolve uma linha para cada um, com o
 *      nome de quem recebeu, o evento, a emissão e o motivo de não valer;
 *    • a ORDEM da resposta é a ordem digitada;
 *    • código repetido é conferido UMA vez (inclusive quando escrito de outra forma) e a
 *      posição da primeira ocorrência é preservada;
 *    • acima do teto a lista é RECUSADA inteira, com mensagem clara — nada de resultado
 *      parcial com cara de completo;
 *    • código em branco é ignorado, não vira linha de erro;
 *    • a linha do lote diz o MESMO que a tela de um código, porque as duas chamam a
 *      mesma função de validação.
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
  revokeCertificate,
} from '../../src/lib/certificates/certificate-service';
import { verifyCertificateBatch } from '../../src/lib/certificates/certificate-batch-service';
import {
  CERTIFICATE_BATCH_LIMIT,
  CERTIFICATE_BATCH_MAX_INPUT,
} from '../../src/domain/certificates/certificate-batch-rules';
import { VALIDATION_ALPHABET } from '../../src/domain/certificates/certificate-rules';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let eventId: string;
let activityId: string;

let validoCode: string;
let revogadoCode: string;
let adulteradoCode: string;

const INEXISTENTE = 'CERT-22222222';

/** Código de formato VÁLIDO e inexistente — para o cenário do teto. */
function codeAt(index: number): string {
  let remaining = index;
  let body = '';

  for (let position = 0; position < 8; position += 1) {
    body = VALIDATION_ALPHABET[remaining % VALIDATION_ALPHABET.length] + body;
    remaining = Math.floor(remaining / VALIDATION_ALPHABET.length);
  }

  return `CERT-${body}`;
}

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f51.cert.${RUN}.${id.slice(0, 8)}@exemplo.test`, emailVerified: true },
  });

  return id;
}

/** Presença completa (entrada e saída) numa atividade — o fato que habilita o certificado. */
async function createAttendance(userId: string, minutes: number): Promise<void> {
  const start = new Date('2026-09-17T12:00:00.000Z');
  const registrationId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.registration.create({
      data: {
        id: registrationId,
        tenantId,
        eventId,
        activityId,
        userId,
        status: 'ATTENDED',
        consentData: true,
        checkedInAt: start,
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
        checkedInAt: start,
        checkedOutAt: new Date(start.getTime() + minutes * 60_000),
        minutesAttended: minutes,
      },
    });
  });
}

/** Emite o certificado de verdade (fila ou inline) e devolve o código. */
async function issueFor(userId: string): Promise<string> {
  const issued = await issueCertificate({ tenantId, eventId, userId, kind: 'MINI_COURSE' });

  expect(issued.ok, issued.ok ? 'ok' : issued.message).toBe(true);
  if (!issued.ok) throw new Error('emissão falhou');

  if (!issued.generated) {
    const generated = await generateCertificate({
      tenantId,
      certificateId: issued.certificateId,
    });

    expect(generated.ok, generated.ok ? 'ok' : generated.message).toBe(true);
  }

  return issued.validationCode;
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  activityId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f51-cert-${RUN}`,
      name: `Instituição Conferência ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
      timezone: 'America/Bahia',
    },
  });

  const startsAt = new Date('2026-09-17T12:00:00.000Z');

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-conferencia-${RUN}`,
        title: `Congresso de Conferência ${RUN}`,
        status: 'REGISTRATION_CLOSED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        timezone: 'America/Bahia',
        confirmedCount: 0,
      },
    });

    await tx.activity.create({
      data: {
        id: activityId,
        tenantId,
        eventId,
        slug: `minicurso-conferencia-${RUN}`,
        title: 'Minicurso de Conferência',
        type: 'MINI_COURSE',
        status: 'SCHEDULED',
        modality: 'IN_PERSON',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
        workloadMinutes: 240,
      },
    });
  });

  const ana = await createUser('Ana Conferida');
  const bruno = await createUser('Bruno Revogado');
  const carla = await createUser('Carla Adulterada');

  await createAttendance(ana, 240);
  await createAttendance(bruno, 240);
  await createAttendance(carla, 240);

  validoCode = await issueFor(ana);
  revogadoCode = await issueFor(bruno);
  adulteradoCode = await issueFor(carla);

  const brunoCertificate = await withTenant(tenantId, (tx) =>
    tx.certificate.findFirstOrThrow({
      where: { validationCode: revogadoCode },
      select: { id: true },
    }),
  );

  const revoked = await revokeCertificate({
    tenantId,
    certificateId: brunoCertificate.id,
    reason: 'Presença não comprovada em auditoria interna.',
  });
  expect(revoked.ok).toBe(true);
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('conferência em lote com códigos reais (E7)', () => {
  it('devolve uma linha por código, na ORDEM digitada, com nome, evento, emissão e motivo', async () => {
    const outcome = await verifyCertificateBatch(
      [revogadoCode, INEXISTENTE, validoCode].join('\n'),
    );

    expect(outcome.ok, outcome.ok ? 'ok' : outcome.message).toBe(true);
    if (!outcome.ok) return;

    const { rows } = outcome.batch;

    expect(rows.map((row) => row.code)).toEqual([revogadoCode, INEXISTENTE, validoCode]);
    expect(rows.map((row) => row.valid)).toEqual([false, false, true]);
    expect(rows.map((row) => row.status)).toEqual(['REVOKED', 'NOT_FOUND', 'VALID']);

    // O revogado diz POR QUE não vale (o motivo gravado na revogação).
    expect(rows[0]?.reason).toContain('Presença não comprovada');
    expect(rows[0]?.recipientName).toBe('Bruno Revogado');

    // O inexistente não inventa dado nenhum.
    expect(rows[1]?.recipientName).toBeNull();
    expect(rows[1]?.eventTitle).toBeNull();
    expect(rows[1]?.issuedAt).toBeNull();
    expect(rows[1]?.reason).toMatch(/não encontrado/i);

    // O válido traz o que a tela precisa mostrar.
    expect(rows[2]?.recipientName).toBe('Ana Conferida');
    expect(rows[2]?.eventTitle).toContain('Conferência');
    expect(rows[2]?.issuedAt).toBeInstanceOf(Date);

    expect(outcome.batch.validCount).toBe(1);
    expect(outcome.batch.invalidCount).toBe(2);
  });

  it('a linha do lote diz o MESMO que a tela de um código (mesma função)', async () => {
    const outcome = await verifyCertificateBatch(validoCode);
    const solo = await getPublicCertificate(validoCode);

    expect(outcome.ok && solo.ok).toBe(true);
    if (!outcome.ok || !solo.ok) return;

    const row = outcome.batch.rows[0];
    expect(row?.status).toBe(solo.verdict.status);
    expect(row?.recipientName).toBe(solo.certificate?.recipientName);
    expect(row?.eventTitle).toBe(solo.certificate?.eventTitle);
    expect(row?.issuedAt?.getTime()).toBe(solo.certificate?.issuedAt?.getTime());
    expect(row?.reason).toBe(solo.verdict.message);
    expect(row?.valid).toBe(solo.verdict.isUsable);
  });

  it('código repetido é conferido UMA vez, mantendo a posição da primeira ocorrência', async () => {
    /**
     * As duas formas abaixo são o MESMO código depois da normalização
     * (`normalizeValidationCode`): conferir duas vezes gastaria duas consultas para
     * responder a mesma pergunta e devolveria duas linhas idênticas na tabela.
     */
    const semPrefixo = validoCode.replace('CERT-', '').toLowerCase();

    const outcome = await verifyCertificateBatch(
      [validoCode, INEXISTENTE, semPrefixo].join(', '),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.batch.rows.map((row) => row.code)).toEqual([validoCode, INEXISTENTE]);
    expect(outcome.batch.duplicates).toEqual([validoCode]);
    expect(outcome.batch.ignored).toBe(0);
  });

  it('código em branco é ignorado; linha com separador solto também', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE TESTE NASCEU ERRADO, E O ERRO ERA UMA PROMESSA FALSA
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão esperava `ignored > 0` para um texto cheio de linhas em branco
     *  e vírgulas soltas. O contador veio ZERO — e o comportamento está certo: o
     *  separador é `[\s,;]+`, então a sequência inteira é absorvida e NENHUM item chega
     *  a existir; não há o que ignorar. Quem é contado em `ignored` é o item que TEM
     *  caracteres e nenhum deles é de código (pontuação solta, prefixo sem o código).
     *
     *  A expectativa errada estava no teste E no comentário do parser (e na frase da
     *  tela); os três foram corrigidos para dizer a mesma coisa.
     */
    const comBrancos = await verifyCertificateBatch(
      `\n\n${validoCode}\n,\n;;\n\n${INEXISTENTE}\n, ,\n`,
    );

    expect(comBrancos.ok).toBe(true);
    if (!comBrancos.ok) return;

    expect(comBrancos.batch.rows).toHaveLength(2);
    expect(comBrancos.batch.ignored).toBe(0);

    // Agora os itens que de fato não têm código nenhum dentro.
    const comPontuacao = await verifyCertificateBatch(`-\n()\nCERT-\n${validoCode}`);

    expect(comPontuacao.ok).toBe(true);
    if (!comPontuacao.ok) return;

    expect(comPontuacao.batch.rows).toHaveLength(1);
    expect(comPontuacao.batch.rows[0]?.code).toBe(validoCode);
    expect(comPontuacao.batch.ignored).toBe(3);
  });

  it('código malformado vira linha inválida com o motivo do formato', async () => {
    const outcome = await verifyCertificateBatch('CERT-ABC');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const row = outcome.batch.rows[0];
    expect(row?.valid).toBe(false);
    expect(row?.status).toBe('NOT_FOUND');
    expect(row?.reason).toMatch(/formato inválido/i);
  });

  it('lista vazia é recusada com mensagem clara', async () => {
    const outcome = await verifyCertificateBatch('   \n  ,  \n ');

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.code).toBe('EMPTY');
    expect(outcome.message).toMatch(/pelo menos um código/i);
  });

  it('acima do teto a lista é RECUSADA inteira, sem conferir nada', async () => {
    const muitos = Array.from({ length: CERTIFICATE_BATCH_LIMIT + 1 }, (_, index) =>
      codeAt(index),
    ).join('\n');

    const outcome = await verifyCertificateBatch(muitos);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.code).toBe('TOO_MANY');
    expect(outcome.found).toBe(CERTIFICATE_BATCH_LIMIT + 1);
    expect(outcome.message).toContain(String(CERTIFICATE_BATCH_LIMIT));
    // Não devolve resultado nenhum: parcial com cara de completo é pior que a recusa.
    expect(outcome).not.toHaveProperty('batch');
  });

  it('exatamente no teto é aceito', async () => {
    const noLimite = Array.from({ length: CERTIFICATE_BATCH_LIMIT }, (_, index) =>
      codeAt(index),
    ).join('\n');

    const outcome = await verifyCertificateBatch(noLimite);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.batch.rows).toHaveLength(CERTIFICATE_BATCH_LIMIT);
    expect(outcome.batch.validCount).toBe(0);
  });

  it('texto longo demais é recusado antes de qualquer consulta', async () => {
    const gigante = 'a'.repeat(CERTIFICATE_BATCH_MAX_INPUT + 1);

    const outcome = await verifyCertificateBatch(gigante);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.code).toBe('TOO_LONG');
  });

  it('documento ADULTERADO não passa como válido — nem no lote, nem na tela de um código', async () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CASO EXISTE — E O QUE MUDOU DEPOIS DELE
     * ─────────────────────────────────────────────────────────────────────────────
     *  O veredito (`evaluateValidation`) olhava só o ESTADO do registro; a assinatura
     *  olha o CONTEÚDO. Um documento com o texto alterado no banco continuava
     *  "emitido, não revogado" — e uma conferência que só olhasse o veredito
     *  carimbaria como válido um documento que a própria plataforma detecta como
     *  alterado.
     *
     *  Este caso nasceu encontrando uma DIVERGÊNCIA: o lote reprovava o documento
     *  adulterado enquanto a tela de UM código o anunciava como autêntico e oferecia o
     *  PDF. A divergência foi corrigida na FASE 51 (a integridade entrou no veredito e
     *  a rota de download passou a conferir a assinatura), então o que este teste
     *  prende agora é mais forte: as DUAS telas dizem a mesma coisa — não.
     */
    const original = await withTenant(tenantId, (tx) =>
      tx.certificate.findFirstOrThrow({
        where: { validationCode: adulteradoCode },
        select: { id: true, workloadMinutes: true },
      }),
    );

    await withTenant(tenantId, (tx) =>
      tx.certificate.update({
        where: { id: original.id },
        data: { workloadMinutes: original.workloadMinutes + 600 },
      }),
    );

    try {
      const outcome = await verifyCertificateBatch(adulteradoCode);

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      const row = outcome.batch.rows[0];
      expect(row?.valid).toBe(false);
      /**
       * O motivo vem da MESMA função que a tela de um código usa — por isso a asserção
       * aceita as duas redações (a do lote e a do veredito): o que importa é que a
       * recusa diga que a assinatura não confere com o conteúdo.
       */
      expect(row?.reason).toMatch(/assinatura/i);
      expect(row?.reason).toMatch(/não confere|alterado/i);

      /**
       * E a tela de UM código conta a MESMA história: o veredito público é `TAMPERED`
       * (não `VALID` com aviso ao lado), e o download é recusado. Sem esta segunda
       * metade, a correção poderia ser desfeita num lado só.
       */
      const publico = await getPublicCertificate(adulteradoCode);

      expect(publico.ok).toBe(true);
      if (!publico.ok) return;

      expect(publico.verdict.status).toBe('TAMPERED');
      expect(publico.verdict.isUsable).toBe(false);

      const download = await getPublicCertificateDownloadUrl(adulteradoCode);
      expect(download.ok).toBe(false);
    } finally {
      await withTenant(tenantId, (tx) =>
        tx.certificate.update({
          where: { id: original.id },
          data: { workloadMinutes: original.workloadMinutes },
        }),
      );
    }

    // Restaurado: o mesmo código volta a passar.
    const restaurado = await verifyCertificateBatch(adulteradoCode);
    expect(restaurado.ok && restaurado.batch.rows[0]?.valid).toBe(true);
  });
});
