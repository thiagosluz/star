import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import {
  deleteCall,
  getCallBySlug,
  listCallProposals,
  listCalls,
  listPublicCalls,
  saveCall,
  setCallPublished,
} from '../../src/lib/proposals/call-service';
import { submitProposal } from '../../src/lib/proposals/proposal-service';
import { acceptProposal, getAcceptanceContext } from '../../src/lib/proposals/acceptance-service';
import { createSubmission } from '../../src/lib/review/submission-service';
import { getSubmissionReviewPanel } from '../../src/lib/review/review-service';
import { PROPOSAL_KIND_LABELS } from '../../src/domain/proposals/call-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let otherTenantId: string;
let tenantSlug: string;
let eventId: string;
let trackId: string;
let organizerId: string;
let authorId: string;

const now = new Date();
const opensAt = new Date(now.getTime() - 86_400_000);
const closesAt = new Date(now.getTime() + 30 * 86_400_000);
/**
 * A atividade nasce DENTRO do período do evento: a programação não aceita atividade
 * fora dele (`saveActivity`), e um horário fora faria o aceite voltar com aviso em vez
 * de criar a atividade — escondendo o que o teste quer provar.
 */
const activityStartsAt = new Date(now.getTime() + 61 * 86_400_000);
const activityEndsAt = new Date(activityStartsAt.getTime() + 4 * 3_600_000);

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Chamadas de propostas (FASE 33) — integração com banco real
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (e por que cada um existe)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a chamada como ENTIDADE (tipo, janela, publicação) — o painel lista, o público
 *    só vê o que foi publicado;
 *  • a proposta como SUBMISSION: o motor da FASE 4 é quem grava, então o que se
 *    prende aqui é que a chamada chega nele (`callId` + `proposalData`) e que a
 *    recusa da janela aparece com o vocabulário da chamada;
 *  • o limite por autor contado NESTA chamada (duas chamadas não compartilham cota);
 *  • o ISOLAMENTO entre instituições: o `user` é global e a chamada não é — duas
 *    instituições de verdade provam que a RLS responde "não existe";
 *  • o CAMINHO ANTIGO intacto: submissão científica sem `callId` continua criável e
 *    o protocolo de aceite simplesmente não se oferece para ela;
 *  • o ACEITE: decisão pelo motor do comitê + atividade criada com a carga horária
 *    DECLARADA + convite de palestrante ENFILEIRADO de verdade.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f33.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

async function createCall(input: {
  kind: 'PAPER' | 'SPEAKER' | 'MINICOURSE' | 'POSTER';
  slug: string;
  title: string;
  trackId?: string | null;
  maxSubmissionsPerAuthor?: number;
  startsAt?: Date;
  endsAt?: Date;
  /** Critérios PRÓPRIOS da chamada (vazio = usa a da trilha). */
  reviewRubric?: { key: string; label: string; weight: number; maxScore: number }[];
}): Promise<string> {
  const result = await saveCall({
    tenantId,
    eventId,
    actorId: organizerId,
    kind: input.kind,
    slug: input.slug,
    title: input.title,
    summary: `Chamada de ${input.title}`,
    opensAt: input.startsAt ?? opensAt,
    closesAt: input.endsAt ?? closesAt,
    maxSubmissionsPerAuthor: input.maxSubmissionsPerAuthor ?? 0,
    trackId: input.trackId ?? null,
    reviewRubric: input.reviewRubric,
  });

  if (!result.ok) throw new Error(`Falha ao criar a chamada: ${result.message}`);

  await setCallPublished({
    tenantId,
    eventId,
    callId: result.callId,
    actorId: organizerId,
    isPublished: true,
  });

  return result.callId;
}

beforeAll(async () => {
  tenantId = randomUUID();
  otherTenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();
  tenantSlug = `f33-${RUN}`;

  await adminPrisma.tenant.createMany({
    data: [
      {
        id: tenantId,
        slug: tenantSlug,
        name: `Instituição das Chamadas ${RUN}`,
        status: 'ACTIVE',
        plan: 'PROFESSIONAL',
        timezone: TIME_ZONE,
      },
      {
        id: otherTenantId,
        slug: `f33-vizinha-${RUN}`,
        name: `Instituição Vizinha ${RUN}`,
        status: 'ACTIVE',
        plan: 'FREE',
      },
    ],
  });

  organizerId = await createUser('Organizadora F33');
  authorId = await createUser('Proponente F33');

  await withTenant(tenantId, async (tx) => {
    const startsAt = new Date(now.getTime() + 60 * 86_400_000);

    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-chamadas-${RUN}`,
        title: 'Seminário de Extensão',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
        capacity: null,
        confirmedCount: 0,
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-${RUN}`,
        name: 'Extensão universitária',
        requiresBlindReview: true,
        requiredReviews: 2,
        reviewRubric: [{ key: 'relevance', label: 'Relevância', weight: 1, maxScore: 10 }],
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f33.${RUN}` } } });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('painel da chamada: janela, publicação e exclusão', () => {
  let callId: string;

  it('cria a chamada já publicada e a lista no painel', async () => {
    callId = await createCall({ kind: 'SPEAKER', slug: `palestrantes-${RUN}`, title: 'Chamada de palestrantes' });

    const listed = await listCalls({ tenantId, eventId, now: new Date() });

    expect(listed.ok, listed.ok ? 'ok' : listed.message).toBe(true);
    if (!listed.ok) return;

    const call = listed.calls.find((row) => row.id === callId);
    expect(call, 'a chamada criada precisa aparecer no painel').toBeTruthy();
    expect(call?.state).toBe('OPEN');
    expect(call?.kind).toBe('SPEAKER');
    expect(call?.windowLabel).toContain('/');
  });

  it('recusa janela que encerra antes de abrir', async () => {
    const result = await saveCall({
      tenantId,
      eventId,
      actorId: organizerId,
      kind: 'POSTER',
      slug: `janela-invalida-${RUN}`,
      title: 'Chamada com janela invertida',
      opensAt: closesAt,
      closesAt: opensAt,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_WINDOW');
  });

  it('a lista pública não mostra chamada em rascunho', async () => {
    const draft = await saveCall({
      tenantId,
      eventId,
      actorId: organizerId,
      kind: 'WORKSHOP',
      slug: `rascunho-${RUN}`,
      title: 'Oficina ainda em rascunho',
      opensAt,
      closesAt,
    });

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const publicList = await listPublicCalls({ tenantId, eventId, now: new Date() });

    expect(publicList.ok).toBe(true);
    if (!publicList.ok) return;

    expect(publicList.calls.some((row) => row.id === draft.callId)).toBe(false);

    // Publicar é o ato que a torna visível — e despublicar tira de novo.
    await setCallPublished({
      tenantId,
      eventId,
      callId: draft.callId,
      actorId: organizerId,
      isPublished: true,
    });

    const afterPublish = await listPublicCalls({ tenantId, eventId, now: new Date() });
    expect(afterPublish.ok && afterPublish.calls.some((row) => row.id === draft.callId)).toBe(true);

    await setCallPublished({
      tenantId,
      eventId,
      callId: draft.callId,
      actorId: organizerId,
      isPublished: false,
    });

    const afterUnpublish = await listPublicCalls({ tenantId, eventId, now: new Date() });
    expect(afterUnpublish.ok && afterUnpublish.calls.some((row) => row.id === draft.callId)).toBe(false);

    // Chamada sem propostas pode ser excluída: não há histórico a perder.
    const removed = await deleteCall({ tenantId, eventId, callId: draft.callId, actorId: organizerId });
    expect(removed.ok, removed.ok ? 'ok' : removed.message).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('proposta pela chamada pública', () => {
  let speakerCallId: string;

  it('grava a proposta com os campos do tipo e cria o vínculo de participante', async () => {
    speakerCallId = await createCall({
      kind: 'SPEAKER',
      slug: `convidados-${RUN}`,
      title: 'Chamada de palestrantes convidados',
    });

    const result = await submitProposal({
      tenantId,
      eventId,
      callId: speakerCallId,
      userId: authorId,
      title: 'Saúde digital na atenção básica',
      abstract: 'Uma palestra sobre telemedicina e o cuidado na atenção primária brasileira. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['telemedicina', 'atenção básica', 'saúde digital'],
      data: {
        bio: 'Pesquisadora de saúde digital com dez anos de atenção básica.',
        topics: 'Telemedicina, prontuário eletrônico',
        availability: 'Outubro',
      },
      tenantSlug,
    });

    expect(result.ok, result.ok ? 'ok' : result.message).toBe(true);
    if (!result.ok) return;

    expect(result.protocol).toMatch(/^\d{4}-/);

    const row = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: result.submissionId },
        select: {
          callId: true,
          trackId: true,
          proposalData: true,
          status: true,
        },
      }),
    );

    expect(row.callId).toBe(speakerCallId);
    // Palestrante não tem eixo temático: a chamada não pediu trilha.
    expect(row.trackId).toBeNull();
    expect(row.status).toBe('SUBMITTED');
    expect(row.proposalData).toMatchObject({ topics: 'Telemedicina, prontuário eletrônico' });

    /**
     * O vínculo de participante é o mesmo caminho da inscrição pública (FASE 10):
     * quem propõe passa a ser participante da instituição.
     */
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId, userId: authorId },
      select: { kind: true, status: true },
    });

    expect(membership?.status).toBe('ACTIVE');
    expect(membership?.kind).toBe('PARTICIPANT');
    expect(result.linkedAsParticipant).toBe(true);

    const listed = await listCallProposals({ tenantId, callId: speakerCallId });
    expect(listed.ok, listed.ok ? 'ok' : listed.message).toBe(true);
    if (!listed.ok) return;

    expect(listed.proposals).toHaveLength(1);
    expect(listed.proposals[0]?.authorEmail).toContain(`f33.${RUN}`);
    // Os campos vêm rotulados, na ordem do domínio.
    expect(listed.proposals[0]?.data.map((field) => field.label)).toContain('Temas que pretende abordar');
  });

  it('recusa quando falta campo obrigatório do tipo, sem gravar nada', async () => {
    const before = await withTenant(tenantId, (tx) =>
      tx.submission.count({ where: { tenantId, callId: speakerCallId } }),
    );

    const result = await submitProposal({
      tenantId,
      eventId,
      callId: speakerCallId,
      userId: authorId,
      title: 'Proposta sem minibiografia',
      abstract: 'Esta proposta não informa a minibiografia que a chamada exige. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: { topics: 'Apenas o tema' },
      tenantSlug,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.message).toContain('minibiografia');

    const after = await withTenant(tenantId, (tx) =>
      tx.submission.count({ where: { tenantId, callId: speakerCallId } }),
    );

    expect(after).toBe(before);
  });

  it('recusa proposta em chamada não publicada', async () => {
    const draft = await saveCall({
      tenantId,
      eventId,
      actorId: organizerId,
      kind: 'MINICOURSE',
      slug: `fechada-${RUN}`,
      title: 'Minicurso ainda não anunciado',
      opensAt,
      closesAt,
    });

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const result = await submitProposal({
      tenantId,
      eventId,
      callId: draft.callId,
      userId: authorId,
      title: 'Minicurso de Rust',
      abstract: 'Uma introdução prática à linguagem, com exercícios guiados no navegador. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: { workloadMinutes: 240, targetAudience: 'Iniciantes' },
      tenantSlug,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CALL_NOT_PUBLISHED');
  });

  it('recusa proposta fora da janela já encerrada', async () => {
    const closed = await createCall({
      kind: 'POSTER',
      slug: `encerrada-${RUN}`,
      title: 'Chamada de pôsteres encerrada',
      startsAt: new Date(now.getTime() - 10 * 86_400_000),
      endsAt: new Date(now.getTime() - 86_400_000),
    });

    const result = await submitProposal({
      tenantId,
      eventId,
      callId: closed,
      userId: authorId,
      title: 'Pôster sobre hortas urbanas',
      abstract: 'Relato de extensão sobre hortas comunitárias em terrenos ociosos da cidade. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: {},
      tenantSlug,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CALL_CLOSED');
  });

  it('respeita o limite de propostas por autor NESTA chamada', async () => {
    const limited = await createCall({
      kind: 'WORKSHOP',
      slug: `limite-${RUN}`,
      title: 'Oficina com limite de uma proposta',
      maxSubmissionsPerAuthor: 1,
    });

    const first = await submitProposal({
      tenantId,
      eventId,
      callId: limited,
      userId: authorId,
      title: 'Oficina de cerâmica',
      abstract: 'Oficina prática de modelagem em argila para iniciantes, com material incluso. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: { workloadMinutes: 180, targetAudience: 'Comunidade externa' },
      tenantSlug,
    });

    expect(first.ok, first.ok ? 'ok' : first.message).toBe(true);

    const second = await submitProposal({
      tenantId,
      eventId,
      callId: limited,
      userId: authorId,
      title: 'Segunda oficina de cerâmica',
      abstract: 'Uma segunda proposta na mesma chamada, que o limite de uma deve recusar. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: { workloadMinutes: 180, targetAudience: 'Comunidade externa' },
      tenantSlug,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('AUTHOR_LIMIT_REACHED');

    /**
     * O limite é POR CHAMADA: as outras propostas do mesmo autor continuam valendo —
     * contar no evento faria o limite de uma chamada consumir a cota da outra.
     */
    const otherCall = await listCallProposals({ tenantId, callId: speakerCallId });
    expect(otherCall.ok && otherCall.proposals.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('rubrica própria da chamada', () => {
  const callRubric = [
    { key: 'feasibility', label: 'Viabilidade da oficina', weight: 2, maxScore: 10 },
    { key: 'lesson_plan', label: 'Clareza do plano de aula', weight: 1, maxScore: 10 },
  ];

  it('a rubrica da chamada vence a da trilha no painel do comitê', async () => {
    /**
     * A chamada APONTA a trilha (para a afinidade dos revisores) e tem rubrica própria:
     * é o caso que prova a precedência — sem ela, os critérios gravados na chamada
     * seriam uma coluna que ninguém lê.
     */
    const callId = await createCall({
      kind: 'MINICOURSE',
      slug: `rubrica-${RUN}`,
      title: 'Minicurso com rubrica própria',
      trackId,
      reviewRubric: callRubric,
    });

    const proposal = await submitProposal({
      tenantId,
      eventId,
      callId,
      userId: authorId,
      title: 'Minicurso de marcenaria',
      abstract:
        'Um minicurso prático de marcenaria com ferramentas manuais, montagem de um banco de ' +
        'madeira e conversa sobre segurança no trabalho ao longo de toda a oficina.',
      keywords: ['marcenaria', 'oficina', 'segurança'],
      data: { workloadMinutes: 240, targetAudience: 'Comunidade externa' },
      tenantSlug,
    });

    expect(proposal.ok, proposal.ok ? 'ok' : proposal.message).toBe(true);
    if (!proposal.ok) return;

    const panel = await getSubmissionReviewPanel(tenantId, proposal.submissionId);

    expect(panel.ok, panel.ok ? 'ok' : panel.message).toBe(true);
    if (!panel.ok) return;

    expect(panel.panel.rubric.map((criterion) => criterion.key)).toEqual([
      'feasibility',
      'lesson_plan',
    ]);
  });

  it('recusa rubrica inválida com o motivo, em vez de cair no padrão em silêncio', async () => {
    const result = await saveCall({
      tenantId,
      eventId,
      actorId: organizerId,
      kind: 'WORKSHOP',
      slug: `rubrica-invalida-${RUN}`,
      title: 'Oficina com rubrica quebrada',
      opensAt,
      closesAt,
      reviewRubric: [{ key: 'peso-zero', label: 'Peso zero', weight: 0, maxScore: 10 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_INPUT');
    expect(result.details?.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('isolamento entre instituições', () => {
  it('a instituição vizinha não vê a chamada nem a proposta', async () => {
    /**
     * O evento da outra instituição simplesmente não existe sob a RLS dela: a leitura
     * responde `NOT_FOUND`, e não um erro de infraestrutura — a diferença entre "não
     * existe" e "não consegui carregar" é a diferença entre uma resposta e um alarme
     * falso.
     */
    const listed = await listCalls({ tenantId: otherTenantId, eventId, now: new Date() });
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.code).toBe('NOT_FOUND');

    const fetched = await getCallBySlug({
      tenantId: otherTenantId,
      eventId,
      slug: `convidados-${RUN}`,
      now: new Date(),
    });

    expect(fetched.ok).toBe(false);
    if (fetched.ok) return;
    expect(fetched.code).toBe('NOT_FOUND');

    // A chamada publicada continua invisível na lista pública da vizinha.
    const publicList = await listPublicCalls({ tenantId: otherTenantId, eventId, now: new Date() });
    expect(publicList.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('caminho anterior (submissão científica sem chamada)', () => {
  it('continua criando a submissão e não oferece protocolo de aceite', async () => {
    const created = await createSubmission({
      tenantId,
      eventId,
      trackId,
      userId: authorId,
      title: 'Artigo sem chamada',
      abstract: 'Um artigo submetido pelo caminho anterior às chamadas de propostas existirem. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'território'],
    });

    expect(created.ok, created.ok ? 'ok' : created.message).toBe(true);
    if (!created.ok) return;

    const row = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: created.id },
        select: { callId: true, trackId: true },
      }),
    );

    expect(row.callId).toBeNull();
    expect(row.trackId).toBe(trackId);

    const context = await getAcceptanceContext({ tenantId, submissionId: created.id });
    expect(context.ok, context.ok ? 'ok' : context.message).toBe(true);
    if (!context.ok) return;

    // Sem chamada não há protocolo de aceite: o painel do comitê segue o caminho dele.
    expect(context.context).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('protocolo de aceite', () => {
  let minicourseCallId: string;
  let submissionId: string;

  it('aceita a proposta, cria a atividade com a carga declarada e envia o convite', async () => {
    minicourseCallId = await createCall({
      kind: 'MINICOURSE',
      slug: `minicursos-${RUN}`,
      title: 'Chamada de minicursos',
      trackId,
    });

    const proposal = await submitProposal({
      tenantId,
      eventId,
      callId: minicourseCallId,
      userId: authorId,
      title: 'Minicurso de Introdução à Linguagem Rust',
      abstract: 'Quatro horas de prática guiada com a linguagem, do primeiro programa ao borrow checker. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['rust', 'programação', 'sistemas'],
      data: { workloadMinutes: 240, targetAudience: 'Pessoas com lógica de programação' },
      tenantSlug,
    });

    expect(proposal.ok, proposal.ok ? 'ok' : proposal.message).toBe(true);
    if (!proposal.ok) return;

    submissionId = proposal.submissionId;

    const accepted = await acceptProposal({
      tenantId,
      tenantSlug,
      submissionId,
      actorId: organizerId,
      notes: 'Aprovado para a grade da tarde.',
      createActivity: {
        activityType: 'MINI_COURSE',
        startsAt: activityStartsAt,
        endsAt: activityEndsAt,
        requiresRegistration: true,
      },
      inviteSpeaker: true,
    });

    expect(accepted.ok, accepted.ok ? 'ok' : accepted.message).toBe(true);
    if (!accepted.ok) return;

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.warnings, accepted.warnings.join(' | ')).toHaveLength(0);
    expect(accepted.activityId).toBeTruthy();
    expect(accepted.speakerProfileId).toBeTruthy();
    expect(accepted.inviteToken).toHaveLength(32);
    expect(accepted.inviteSent).toBe(true);

    // ── A atividade nasceu com o que a proposta declarou ────────────────────
    const activity = await withTenant(tenantId, (tx) =>
      tx.activity.findUniqueOrThrow({
        where: { id: accepted.activityId as string },
        select: {
          type: true,
          status: true,
          workloadMinutes: true,
          startsAt: true,
          requiresRegistration: true,
          title: true,
          description: true,
        },
      }),
    );

    expect(activity.type).toBe('MINI_COURSE');
    expect(activity.status).toBe('SCHEDULED');
    // 240 vem do campo `workloadMinutes` da proposta — não de um padrão do tipo.
    expect(activity.workloadMinutes).toBe(240);
    expect(activity.startsAt.getTime()).toBe(activityStartsAt.getTime());
    expect(activity.requiresRegistration).toBe(true);
    expect(activity.title).toContain('Rust');
    expect(activity.description).toContain('borrow checker');

    // ── O palestrante ficou vinculado à atividade criada ────────────────────
    const link = await withTenant(tenantId, (tx) =>
      tx.activitySpeaker.findFirstOrThrow({
        where: { tenantId, activityId: accepted.activityId as string },
        select: { speakerProfileId: true, roleTitle: true, guestEmail: true },
      }),
    );

    expect(link.speakerProfileId).toBe(accepted.speakerProfileId);
    expect(link.roleTitle).toBe(PROPOSAL_KIND_LABELS.MINICOURSE);

    // ── O convite saiu pelo outbox, com o link do portal ────────────────────
    const email = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findFirst({
        where: { tenantId, template: 'SPEAKER_INVITATION' },
        orderBy: { createdAt: 'desc' },
        select: { dedupeKey: true, payload: true, status: true },
      }),
    );

    expect(email, 'o convite precisa existir no outbox').toBeTruthy();
    expect(email?.dedupeKey).toContain('speaker-invitation-');
    expect(String((email?.payload as Record<string, unknown>)?.inviteUrl)).toContain(
      '/palestrante/convite?codigo=',
    );

    // ── A decisão é a do motor do comitê (FASE 16), não uma escrita paralela ─
    const decided = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: submissionId },
        select: { status: true, decisionById: true, decisionNotes: true },
      }),
    );

    expect(decided.status).toBe('ACCEPTED');
    expect(decided.decisionById).toBe(organizerId);
    expect(decided.decisionNotes).toContain('grade da tarde');
  });

  it('aceitar sem criar atividade nem convidar é um resultado legítimo', async () => {
    const callId = await createCall({
      kind: 'ROUNDTABLE',
      slug: `mesa-${RUN}`,
      title: 'Chamada de mesas-redondas',
    });

    const proposal = await submitProposal({
      tenantId,
      eventId,
      callId,
      userId: authorId,
      title: 'Mesa-redonda sobre saúde mental no campus',
      abstract: 'Proposta de mesa com quatro debatedores e mediação, sobre acolhimento estudantil. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
      keywords: ['extensão', 'comunidade', 'formação'],
      data: { format: '4 debatedores e 1 mediador, 90 minutos', durationMinutes: 90 },
      tenantSlug,
    });

    expect(proposal.ok, proposal.ok ? 'ok' : proposal.message).toBe(true);
    if (!proposal.ok) return;

    const accepted = await acceptProposal({
      tenantId,
      tenantSlug,
      submissionId: proposal.submissionId,
      actorId: organizerId,
      createActivity: null,
      inviteSpeaker: false,
    });

    expect(accepted.ok, accepted.ok ? 'ok' : accepted.message).toBe(true);
    if (!accepted.ok) return;

    expect(accepted.status).toBe('ACCEPTED');
    expect(accepted.activityId).toBeNull();
    expect(accepted.speakerProfileId).toBeNull();
    expect(accepted.inviteToken).toBeNull();

    // O aviso diz o que ficou pendente, em vez de deixar a organização supor.
    expect(accepted.warnings.join(' ')).toBe('');
  });

  it('recusa convidar quem não tem e-mail, sem registrar a decisão', async () => {
    const callId = await createCall({
      kind: 'SPEAKER',
      slug: `sem-contato-${RUN}`,
      title: 'Chamada com proposta sem contato',
    });

    /**
     * Uma proposta SEM e-mail de proponente: acontece quando a organização lança a
     * proposta por alguém que só deixou o nome (autoria convidada, sem conta).
     */
    const guestSubmissionId = randomUUID();

    await withTenant(tenantId, async (tx) => {
      await tx.submission.create({
        data: {
          id: guestSubmissionId,
          tenantId,
          eventId,
          callId,
          protocol: `F33${RUN.slice(0, 4).toUpperCase()}`,
          title: 'Palestra de encerramento',
          abstract: 'Palestra de encerramento do seminário, com relato de experiência. O texto detalha a motivacao, o publico esperado e os resultados ja observados na pratica, para que a avaliacao tenha o que julgar.',
          keywords: ['extensão', 'comunidade', 'formação'],
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedById: organizerId,
          proposalData: { bio: 'Convidado externo.', topics: 'Encerramento' },
        },
      });

      await tx.submissionAuthor.create({
        data: {
          id: randomUUID(),
          tenantId,
          submissionId: guestSubmissionId,
          authorOrder: 1,
          isCorresponding: true,
          guestName: 'Convidado Sem Contato',
          guestEmail: null,
        },
      });
    });

    const result = await acceptProposal({
      tenantId,
      tenantSlug,
      submissionId: guestSubmissionId,
      actorId: organizerId,
      createActivity: null,
      inviteSpeaker: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MISSING_EMAIL');

    // A recusa acontece ANTES da decisão: o comitê não aceitou nada por engano.
    const stillOpen = await withTenant(tenantId, (tx) =>
      tx.submission.findUniqueOrThrow({
        where: { id: guestSubmissionId },
        select: { status: true },
      }),
    );

    expect(stillOpen.status).toBe('SUBMITTED');
  });

  it('recusa excluir chamada que já recebeu propostas', async () => {
    const removed = await deleteCall({
      tenantId,
      eventId,
      callId: minicourseCallId,
      actorId: organizerId,
    });

    expect(removed.ok).toBe(false);
    if (removed.ok) return;
    expect(removed.code).toBe('INVALID_INPUT');
    expect(removed.message).toContain('despublique');
  });
});
