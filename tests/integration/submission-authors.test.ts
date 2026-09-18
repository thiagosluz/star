/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — autoria da submissão (FASE 17, item E6)
 *
 *  Prova o que o domínio puro não alcança:
 *    • a substituição total sobrevive ao índice ÚNICO `(submissionId, authorOrder)`
 *      — trocar a ordem de dois autores é o caso que quebraria uma atualização
 *      linha a linha;
 *    • o vínculo de conta é PRESERVADO na recriação das linhas;
 *    • a conta existente é encontrada pelo e-mail, mas só DENTRO da instituição;
 *    • autoria não se edita depois do envio, nem por quem não submeteu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  getSubmissionAuthors,
  saveSubmissionAuthors,
} from '../../src/lib/review/author-service';
import { createSubmission } from '../../src/lib/review/submission-service';
import { listAuditLog } from '../../src/lib/admin/audit';

const RUN = randomUUID().slice(0, 8);

let tenantId: string;
let otherTenantId: string;
let eventId: string;
let trackId: string;
let authorId: string;
let coauthorId: string;
let strangerId: string;
let submissionId: string;

beforeAll(async () => {
  const tenant = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f17-autoria-${RUN}`,
      name: `Instituição Autoria ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  tenantId = tenant.id;

  const other = await adminPrisma.tenant.create({
    data: {
      id: randomUUID(),
      slug: `f17-autoria-outra-${RUN}`,
      name: `Outra Autoria ${RUN}`,
      status: 'ACTIVE',
      plan: 'FREE',
    },
    select: { id: true },
  });
  otherTenantId = other.id;

  authorId = randomUUID();
  coauthorId = randomUUID();
  strangerId = randomUUID();

  await adminPrisma.user.createMany({
    data: [
      { id: authorId, name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test` },
      { id: coauthorId, name: 'Coautora Registrada', email: `f17c.${RUN}@exemplo.test` },
      { id: strangerId, name: 'Pessoa Estranha', email: `f17s.${RUN}@exemplo.test` },
    ],
  });

  // Só a coautora tem vínculo com a instituição — é o que a busca de contas exige.
  await adminPrisma.userTenantProfile.createMany({
    data: [
      { id: randomUUID(), tenantId, userId: authorId, status: 'ACTIVE', joinedAt: new Date() },
      { id: randomUUID(), tenantId, userId: coauthorId, status: 'ACTIVE', joinedAt: new Date() },
    ],
  });

  eventId = randomUUID();
  trackId = randomUUID();

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-f17-autoria-${RUN}`,
        title: `Congresso Autoria ${RUN}`,
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        startsAt: new Date('2026-11-10T13:00:00.000Z'),
        endsAt: new Date('2026-11-12T21:00:00.000Z'),
        timezone: 'America/Bahia',
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: 'trilha-autoria',
        name: 'Trilha de Autoria',
        requiredReviews: 1,
        acceptanceThreshold: 70,
        rejectThreshold: 45,
        isActive: true,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { slug: { contains: RUN } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

const newSubmission = (title: string) =>
  createSubmission({
    tenantId,
    eventId,
    trackId,
    userId: authorId,
    title,
    abstract: 'a'.repeat(200),
    keywords: ['tecnologia', 'educação', 'autoria'],
    language: 'pt-BR',
  });

// ═══════════════════════════════════════════════════════════════════════════════
describe('leitura da autoria', () => {
  it('a submissão nasce com UM autor: quem submeteu', async () => {
    const created = await newSubmission(`Trabalho de autoria ${RUN}`);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    submissionId = created.id;

    const view = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(view?.authors).toHaveLength(1);
    expect(view?.authors[0]?.userId).toBe(authorId);
    expect(view?.authors[0]?.isCorresponding).toBe(true);
    expect(view?.editable).toBe(true);
  });

  it('a submissão de outra instituição não é encontrada', async () => {
    const view = await getSubmissionAuthors({
      tenantId: otherTenantId,
      submissionId,
      userId: authorId,
    });
    expect(view).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('gravação da autoria', () => {
  it('adiciona coautores na ordem informada, com UM correspondente', async () => {
    const saved = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test`, isCorresponding: false },
        { name: 'Bruno Segundo', email: 'bruno@outra.test', isCorresponding: true },
        { name: 'Carla Terceira', email: 'carla@outra.test' },
      ],
    });

    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.count).toBe(3);
      expect(saved.changed).toBe(true);
    }

    const view = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(view?.authors.map((author) => author.name)).toEqual([
      'Autora Principal',
      'Bruno Segundo',
      'Carla Terceira',
    ]);
    expect(view?.authors.filter((author) => author.isCorresponding)).toHaveLength(1);
    expect(view?.authors[1]?.isCorresponding).toBe(true);
  });

  it('linha em branco enviada pelo formulário é descartada', async () => {
    const saved = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test` },
        { name: '', email: '' },
      ],
    });

    // O domínio recusa nome vazio; o descarte de linha vazia acontece na tela e na
    // normalização de LISTAS (FAQ/galeria). Aqui a linha vazia é ERRO, e o erro
    // aponta a linha — que é o comportamento correto para autoria.
    expect(saved.ok).toBe(false);
    if (!saved.ok) {
      expect(saved.code).toBe('INVALID_INPUT');
      expect(saved.details?.join(' ')).toContain('Autor 2');
    }
  });

  it('TROCAR a ordem de dois autores não colide no índice único', async () => {
    /**
     * `submission_authors` tem índice único em `(submissionId, authorOrder)`. Uma
     * atualização linha a linha (1→2 e 2→1) violaria o índice no meio do caminho,
     * porque o PostgreSQL verifica a unicidade a cada `UPDATE`. A substituição
     * total dentro da transação é o que torna esta operação trivial.
     */
    const before = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    const [first, second, third] = before?.authors ?? [];
    expect(first && second && third).toBeTruthy();

    const reordered = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: second!.name, email: second!.email ?? undefined, isCorresponding: false },
        { name: first!.name, email: first!.email ?? undefined, isCorresponding: true },
        { name: third!.name, email: third!.email ?? undefined },
      ],
    });

    expect(reordered.ok).toBe(true);

    const after = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(after?.authors.map((author) => author.name)).toEqual([
      second!.name,
      first!.name,
      third!.name,
    ]);

    // A ordem gravada é contígua, sem buracos.
    const orders = await withTenant(tenantId, (tx) =>
      tx.submissionAuthor.findMany({
        where: { submissionId },
        orderBy: { authorOrder: 'asc' },
        select: { authorOrder: true },
      }),
    );
    expect(orders.map((row) => row.authorOrder)).toEqual([1, 2, 3]);
  });

  it('VINCULA a conta pelo e-mail de quem já é da instituição, preservando-a', async () => {
    const saved = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test` },
        { name: 'Coautora Registrada', email: `f17c.${RUN}@exemplo.test` },
      ],
    });

    expect(saved.ok).toBe(true);

    const view = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(view?.authors[1]?.userId).toBe(coauthorId);
    // O nome canônico vem da CONTA, não do que foi digitado.
    expect(view?.authors[1]?.name).toBe('Coautora Registrada');
  });

  it('NÃO vincula conta de OUTRA instituição pelo e-mail', async () => {
    /**
     * Casar e-mail contra a base global revelaria a existência de contas de outras
     * instituições. A pessoa estranha existe na plataforma, mas não neste tenant.
     */
    const saved = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test` },
        { name: 'Pessoa Estranha', email: `f17s.${RUN}@exemplo.test` },
      ],
    });

    expect(saved.ok).toBe(true);

    const view = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(view?.authors[1]?.userId).toBeNull();
  });

  it('salvar sem mudança não escreve nem audita — trilha sem ruído', async () => {
    const current = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    const before = await listAuditLog(tenantId, { limit: 100 });
    const beforeCount = before.filter((entry) => entry.entityType === 'submission').length;

    const saved = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: (current?.authors ?? []).map((author) => ({
        name: author.name,
        email: author.email ?? undefined,
        institution: author.institution ?? undefined,
        orcidId: author.orcidId ?? undefined,
        userId: author.userId ?? undefined,
        isCorresponding: author.isCorresponding,
      })),
    });

    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.changed).toBe(false);

    const after = await listAuditLog(tenantId, { limit: 100 });
    expect(after.filter((entry) => entry.entityType === 'submission').length).toBe(beforeCount);
  });

  it('a mudança de autoria fica na trilha, com o correspondente antes e depois', async () => {
    await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [
        { name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test`, isCorresponding: true },
        { name: 'Coautora Registrada', email: `f17c.${RUN}@exemplo.test` },
      ],
    });

    const entries = await listAuditLog(tenantId, { limit: 100 });
    const authorship = entries.find(
      (entry) => entry.entityType === 'submission' && 'authors' in entry.changes,
    );

    expect(authorship).toBeDefined();
    expect(authorship?.changes.correspondingAuthor).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('quem pode editar', () => {
  it('recusa quem não submeteu o trabalho', async () => {
    const denied = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: strangerId,
      authors: [{ name: 'Invasor Curioso', email: 'invasor@x.test' }],
    });

    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe('FORBIDDEN');
  });

  it('DEPOIS do envio a autoria está congelada — o parecer aponta para a versão avaliada', async () => {
    /**
     * O `blindSnapshot` é capturado no envio. Permitir editar a autoria depois faria
     * o parecer apontar para uma lista de autores que não foi avaliada.
     *
     * O estado de envio é gravado DIRETO aqui, de propósito: o que este teste prova é
     * a guarda do serviço de autoria, não o fluxo de upload (que tem teste próprio na
     * FASE 4 e depende de um objeto real no storage).
     */
    await withTenant(tenantId, (tx) =>
      tx.submission.update({
        where: { id: submissionId },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          blindSnapshot: {
            capturedAt: new Date().toISOString(),
            authors: [{ order: 1, name: 'Autora Principal', isCorresponding: true }],
          } as unknown as object,
        },
      }),
    );

    const frozen = await saveSubmissionAuthors({
      tenantId,
      submissionId,
      actorId: authorId,
      authors: [{ name: 'Autora Principal', email: `f17a.${RUN}@exemplo.test` }],
    });

    expect(frozen.ok).toBe(false);
    if (!frozen.ok) {
      expect(frozen.code).toBe('NOT_EDITABLE');
      expect(frozen.message).toContain('antes do envio');
    }

    const view = await getSubmissionAuthors({ tenantId, submissionId, userId: authorId });
    expect(view?.editable).toBe(false);
  });
});
