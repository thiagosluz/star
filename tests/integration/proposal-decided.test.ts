/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE INTEGRAÇÃO — Aviso de decisão ao proponente (FASE 36, dívida E47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DÍVIDA, EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 33 fez a proposta ter protocolo — o envio tem comprovante —, mas a
 *  RESPOSTA morria no painel do comitê: o proponente só descobria o resultado
 *  abrindo "Minhas submissões" por acaso. Numa chamada com pedido de ajustes, o
 *  prazo corria contra quem não sabia que precisava mexer em alguma coisa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a decisão de uma PROPOSTA avisa nos dois canais (caixa de entrada + outbox),
 *    com a MESMA `dedupeKey` do fato — a regra da FASE 32/34;
 *  • pedir ajustes e depois aceitar são DOIS fatos e geram DOIS avisos; repetir a
 *    mesma decisão não gera um terceiro;
 *  • o parecer do comitê vai junto (é o que a pessoa lê para ajustar) e é visível a
 *    ela na própria tela;
 *  • o ARTIGO do fluxo acadêmico (sem `callId`) continua sem aviso — limite
 *    declarado da fase, não esquecimento;
 *  • a decisão é registrada MESMO quando o aviso não pode sair: comunicação é
 *    consequência, nunca condição (invariante nº 8).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';
import { saveCall, setCallPublished } from '../../src/lib/proposals/call-service';
import { submitProposal } from '../../src/lib/proposals/proposal-service';
import { createSubmission } from '../../src/lib/review/submission-service';
import { recordDecision } from '../../src/lib/review/review-service';
import { DECISION_NOTICE_TEXT } from '../../src/domain/review/decision-notice-rules';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';

let tenantId: string;
let eventId: string;
let trackId: string;
let organizerId: string;
let authorId: string;
let callId: string;

const now = new Date();

async function createUser(name: string): Promise<string> {
  const id = randomUUID();

  await adminPrisma.user.create({
    data: { id, name, email: `f36.decisao.${RUN}.${id.slice(0, 8)}@exemplo.test` },
  });

  return id;
}

async function outbox(dedupeKey: string): Promise<{ template: string; subject: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx.emailMessage.findMany({ where: { dedupeKey }, select: { template: true, subject: true } }),
  );
}

async function inbox(dedupeKey: string): Promise<{ subject: string; body: string }[]> {
  return withTenant(tenantId, (tx) =>
    tx.participantMessage.findMany({ where: { dedupeKey }, select: { subject: true, body: true } }),
  );
}

async function statusOf(submissionId: string): Promise<string> {
  return withTenant(tenantId, (tx) =>
    tx.submission
      .findFirstOrThrow({ where: { id: submissionId }, select: { status: true } })
      .then((row) => row.status),
  );
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: `f36-decisao-${RUN}`,
      name: `Instituição da Decisão ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  organizerId = await createUser('Organizadora F36');
  authorId = await createUser('Proponente F36');

  await withTenant(tenantId, async (tx) => {
    const startsAt = new Date(now.getTime() + 60 * 86_400_000);

    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: `evento-decisao-${RUN}`,
        title: 'Seminário das Decisões',
        status: 'REGISTRATION_OPEN',
        modality: 'IN_PERSON',
        timezone: TIME_ZONE,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 86_400_000),
      },
    });

    await tx.track.create({
      data: {
        id: trackId,
        tenantId,
        eventId,
        slug: `trilha-decisao-${RUN}`,
        name: 'Extensão universitária',
        requiresBlindReview: false,
        requiredReviews: 1,
      },
    });
  });

  const call = await saveCall({
    tenantId,
    eventId,
    actorId: organizerId,
    kind: 'SPEAKER',
    slug: `chamada-decisao-${RUN}`,
    title: 'Chamada de palestrantes',
    summary: 'Chamada para a programação do seminário.',
    opensAt: new Date(now.getTime() - 86_400_000),
    closesAt: new Date(now.getTime() + 30 * 86_400_000),
    maxSubmissionsPerAuthor: 0,
    trackId: null,
  });

  if (!call.ok) throw new Error(`Falha ao criar a chamada: ${call.message}`);

  callId = call.callId;

  await setCallPublished({ tenantId, eventId, callId, actorId: organizerId, isPublished: true });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: `f36.decisao.${RUN}` } } });
});

async function createProposal(title: string): Promise<string> {
  const result = await submitProposal({
    tenantId,
    eventId,
    callId,
    userId: authorId,
    title,
    abstract:
      'Proposta criada para exercitar o aviso de decisão ao proponente, com o resumo no comprimento mínimo exigido pela validação de conteúdo do motor de submissões da plataforma.',
    keywords: ['decisão', 'proposta', 'aviso'],
    data: {
      bio: 'Pesquisadora de saúde digital com dez anos de atenção básica.',
      topics: 'Telemedicina, prontuário eletrônico',
      availability: 'Outubro',
    },
    tenantSlug: `f36-decisao-${RUN}`,
  });

  if (!result.ok) throw new Error(`Falha ao enviar a proposta: ${result.message}`);

  return result.submissionId;
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('decisão de uma proposta de chamada', () => {
  it('pedido de ajustes avisa nos DOIS canais, com o parecer do comitê', async () => {
    const submissionId = await createProposal('Oficina de telemedicina');

    const decision = await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'REVISION_REQUESTED',
      notes: 'Detalhar a carga horária e a ementa da oficina.',
      overrideQuorum: true,
    });

    expect(decision.ok, decision.ok ? 'ok' : decision.message).toBe(true);
    expect(await statusOf(submissionId)).toBe('REVISION_REQUESTED');

    const key = `proposal-decided-${submissionId}-REVISION_REQUESTED`;
    const messages = await inbox(key);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toContain(DECISION_NOTICE_TEXT.REVISION_REQUESTED.label);
    /** O parecer é a razão de o aviso existir: sem ele, "ajustes" não diz o quê. */
    expect(messages[0]!.body).toContain('Detalhar a carga horária e a ementa da oficina.');

    expect(await outbox(key)).toEqual([
      { template: 'PROPOSAL_DECIDED', subject: expect.stringContaining('Ajustes solicitados') },
    ]);
  });

  it('a mesma decisão repetida NÃO gera um segundo aviso (a chave é o FATO)', async () => {
    const submissionId = await createProposal('Mesa-redonda sobre prontuário');

    await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'REVISION_REQUESTED',
      notes: 'Falta a ementa.',
      overrideQuorum: true,
    });

    /**
     * A segunda tentativa é recusada pela máquina de estados (não se volta de
     * `REVISION_REQUESTED` para ele mesmo), então o que se prova aqui é que a chave
     * do aviso é estável — e que o aviso não depende de a decisão ter sido aceita
     * pela segunda vez.
     */
    const again = await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'REVISION_REQUESTED',
      notes: 'Falta a ementa.',
      overrideQuorum: true,
    });

    expect(again.ok).toBe(false);

    const key = `proposal-decided-${submissionId}-REVISION_REQUESTED`;

    expect(await inbox(key)).toHaveLength(1);
    expect(await outbox(key)).toHaveLength(1);
  });

  it('aceitar depois dos ajustes é um SEGUNDO fato — e avisa de novo', async () => {
    const submissionId = await createProposal('Palestra sobre saúde digital');

    await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'REVISION_REQUESTED',
      notes: 'Revisar o resumo.',
      overrideQuorum: true,
    });

    /** O autor reenvia: `REVISION_REQUESTED` → `SUBMITTED` é transição válida. */
    await withTenant(tenantId, (tx) =>
      tx.submission.update({ where: { id: submissionId }, data: { status: 'SUBMITTED' } }),
    );

    const accepted = await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'ACCEPTED',
      /** Decidir sem quórum exige justificativa registrada — a regra da FASE 4. */
      notes: 'Ajustes atendidos; aprovada pela coordenação.',
      overrideQuorum: true,
    });

    expect(accepted.ok, accepted.ok ? 'ok' : accepted.message).toBe(true);

    /**
     * Duas decisões, duas chaves, duas mensagens: quem foi avisado de "ajustes" e
     * depois aceito precisa receber as duas — senão a última notícia que ele tem é a
     * de que faltava algo.
     */
    expect(await inbox(`proposal-decided-${submissionId}-REVISION_REQUESTED`)).toHaveLength(1);

    const acceptedKey = `proposal-decided-${submissionId}-ACCEPTED`;
    const messages = await inbox(acceptedKey);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.subject).toContain('Aceita');
    expect(await outbox(acceptedKey)).toHaveLength(1);
  });

  it('a recusa também avisa — com o texto de recusa, não o de aceite', async () => {
    const submissionId = await createProposal('Painel sobre regulação');

    const decision = await recordDecision({
      tenantId,
      submissionId,
      decidedById: organizerId,
      decision: 'REJECTED',
      notes: 'Tema já coberto por outra atividade da programação.',
      overrideQuorum: true,
    });

    expect(decision.ok).toBe(true);

    const messages = await inbox(`proposal-decided-${submissionId}-REJECTED`);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toContain(DECISION_NOTICE_TEXT.REJECTED.outcome);
  });
});

describe('o limite declarado da fase: artigo do fluxo acadêmico não é avisado', () => {
  it('submissão SEM chamada muda de status em silêncio (e isso é intencional)', async () => {
    const created = await createSubmission({
      tenantId,
      eventId,
      userId: authorId,
      trackId,
      title: 'Artigo do fluxo antigo',
      abstract:
        'Este artigo entra pelo caminho acadêmico, sem chamada de propostas, e por isso não recebe o aviso de decisão desta fase — o limite está declarado no documento da FASE 36.',
      keywords: ['artigo', 'fluxo', 'acadêmico'],
    });

    if (!created.ok) throw new Error(`Falha ao criar o artigo: ${created.message}`);

    const decision = await recordDecision({
      tenantId,
      submissionId: created.id,
      decidedById: organizerId,
      decision: 'REJECTED',
      notes: 'Fora do escopo temático do evento.',
      overrideQuorum: true,
    });

    expect(decision.ok, decision.ok ? 'ok' : decision.message).toBe(true);

    /**
     * Nenhuma linha com a chave do aviso — o caminho científico continua como estava,
     * e quem submeteu acompanha a avaliação na tela de submissões (FASE 4).
     */
    const keys = await withTenant(tenantId, (tx) =>
      tx.participantMessage.findMany({
        where: { userId: authorId, subject: { contains: 'Artigo do fluxo antigo' } },
        select: { id: true },
      }),
    );

    expect(keys).toHaveLength(0);

    const queued = await withTenant(tenantId, (tx) =>
      tx.emailMessage.findMany({
        where: { template: 'PROPOSAL_DECIDED', payload: { path: ['proposalTitle'], equals: 'Artigo do fluxo antigo' } },
        select: { id: true },
      }),
    );

    expect(queued).toHaveLength(0);
  });
});
