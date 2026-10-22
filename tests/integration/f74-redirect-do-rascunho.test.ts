/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE INTEGRAÇÃO — A ACTION QUE REDIRECIONA PARA O RASCUNHO
 *  (FASE 74 · ajuste da fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDOU, E POR QUE SÓ O BANCO DE VERDADE PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 2 devolvia o `submissionId` na recusa e a tela mostrava um link. O
 *  ajuste tirou a tela intermediária: quando o SERVIÇO recusa por prontidão
 *  (`NOT_READY`), a action chama `redirect()` para o rascunho que ele acabou de
 *  gravar.
 *
 *  `redirect()` não é valor de retorno — é a renderização interrompida pelo
 *  framework. Por isso o teste EXECUTA a action (como o teste da página da fatia 2
 *  executa a página) e observa a sentinela `NEXT_REDIRECT`: só assim se mede a
 *  PORTA, e não a regra que ela usa.
 *
 *  O caso negativo é o par obrigatório: uma recusa SEM rascunho (a chamada
 *  encerrada) continua voltando como erro na tela. Se a action redirecionasse
 *  qualquer recusa, não haveria para onde ir — e a tela morta que o ajuste remove
 *  voltaria pela porta dos fundos.
 *
 *  O que é substituído: a SESSÃO (cookie do Better Auth não existe fora de uma
 *  requisição do Next), `redirect` (vira sentinela) e `revalidatePath`. O resto é o
 *  caminho real: guarda, leitura pública do evento e da chamada, e o serviço que
 *  cria o rascunho e recusa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminPrisma } from '../../src/lib/db/admin-client';
import { withTenant } from '../../src/lib/db/tenant-client';

const RUN = randomUUID().slice(0, 8);
const TIME_ZONE = 'America/Bahia';
const TENANT_SLUG = `f74-redirect-${RUN}`;
const EVENT_SLUG = `evento-f74-redirect-${RUN}`;
const OPEN_CALL_SLUG = `artigos-abertos-${RUN}`;
const CLOSED_CALL_SLUG = `artigos-encerrados-${RUN}`;

const ABERTURA = new Date(Date.now() - 2 * 86_400_000);
const FECHAMENTO = new Date(Date.now() + 20 * 86_400_000);
const FECHAMENTO_PASSADO = new Date(Date.now() - 86_400_000);

/** O resumo precisa passar do mínimo do domínio (150 caracteres). */
const ABSTRACT =
  'Este resumo descreve a proposta científica que o formulário público envia e que o serviço recusa por falta do arquivo anonimizado: o rascunho já foi gravado, e a action precisa levar a pessoa até ele sem uma tela intermediária.';

const sessao = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock('../../src/lib/auth/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/auth/session')>();

  return {
    ...real,
    getAuthenticatedUser: async () =>
      sessao.userId === null
        ? null
        : {
            id: sessao.userId,
            name: 'Pessoa do teste',
            email: `${sessao.userId}@exemplo.test`,
            image: null,
            publicHandle: null,
            emailVerified: true,
          },
  };
});

/** `redirect()` para a renderização — é o que o teste observa. */
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/** `revalidatePath` só existe dentro de uma requisição do Next — e não é o assunto. */
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const { submitProposalAction } = await import('../../src/app/actions/call-actions');

let tenantId: string;
let eventId: string;
let trackId: string;
let openCallId: string;
let closedCallId: string;
let autorId: string;

function formDaProposta(input: { callSlug: string; title: string }): FormData {
  const form = new FormData();

  form.set('tenantSlug', TENANT_SLUG);
  form.set('eventSlug', EVENT_SLUG);
  form.set('callSlug', input.callSlug);
  form.set('title', input.title);
  form.set('abstract', ABSTRACT);
  form.set('keywords', 'território, saúde coletiva, atenção básica');

  return form;
}

/** Executa a action e devolve a URL do redirect (ou `null` se ela retornou). */
async function urlDoRedirect(form: FormData): Promise<string | null> {
  try {
    await submitProposalAction(null, form);
    return null;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

beforeAll(async () => {
  tenantId = randomUUID();
  eventId = randomUUID();
  trackId = randomUUID();
  openCallId = randomUUID();
  closedCallId = randomUUID();
  autorId = randomUUID();

  await adminPrisma.tenant.create({
    data: {
      id: tenantId,
      slug: TENANT_SLUG,
      name: `Instituição do Redirecionamento ${RUN}`,
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      timezone: TIME_ZONE,
    },
  });

  await adminPrisma.user.create({
    data: {
      id: autorId,
      name: `Autora do redirecionamento ${RUN}`,
      email: `f74.redirect.${RUN}@exemplo.test`,
      emailVerified: true,
    },
  });

  sessao.userId = autorId;

  const startsAt = new Date(Date.now() + 30 * 86_400_000);

  await withTenant(tenantId, async (tx) => {
    await tx.event.create({
      data: {
        id: eventId,
        tenantId,
        slug: EVENT_SLUG,
        title: `Simpósio do Redirecionamento ${RUN}`,
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
        slug: `trilha-f74-redirect-${RUN}`,
        name: 'Pesquisa e extensão',
        requiresBlindReview: true,
        requiredReviews: 2,
      },
    });

    await tx.callForProposals.create({
      data: {
        id: openCallId,
        tenantId,
        eventId,
        kind: 'PAPER',
        slug: OPEN_CALL_SLUG,
        title: `Artigos abertos ${RUN}`,
        opensAt: ABERTURA,
        closesAt: FECHAMENTO,
        isPublished: true,
        requiresBlindReview: true,
        trackId,
      },
    });

    /**
     * A chamada ENCERRADA é o caso da recusa SEM rascunho: o serviço devolve
     * `CALL_CLOSED` antes de criar qualquer coisa (o `canSubmitToCall` do
     * `createSubmission`), e a action não pode inventar um destino.
     */
    await tx.callForProposals.create({
      data: {
        id: closedCallId,
        tenantId,
        eventId,
        kind: 'PAPER',
        slug: CLOSED_CALL_SLUG,
        title: `Artigos encerrados ${RUN}`,
        opensAt: new Date(FECHAMENTO_PASSADO.getTime() - 86_400_000),
        closesAt: FECHAMENTO_PASSADO,
        isPublished: true,
        requiresBlindReview: true,
        trackId,
      },
    });
  });
});

afterAll(async () => {
  await adminPrisma.tenant.deleteMany({ where: { id: tenantId } });
  await adminPrisma.user.deleteMany({ where: { email: { contains: RUN } } });
  await adminPrisma.$disconnect();
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('submitProposalAction() — a recusa que tem rascunho redireciona', () => {
  it('leva ao submissionId certo, com o marcador `?rascunho=1`', async () => {
    const url = await urlDoRedirect(
      formDaProposta({
        callSlug: OPEN_CALL_SLUG,
        title: `Vigilância epidemiológica com dados abertos ${RUN}`,
      }),
    );

    /**
     * O rascunho é lido do BANCO, e não de uma variável montada à mão: o teste
     * mede o id que o serviço gravou, não o que ele "deveria" gravar.
     */
    const rascunho = await withTenant(tenantId, (tx) =>
      tx.submission.findFirstOrThrow({
        where: { tenantId, eventId, callId: openCallId, submittedById: autorId },
        select: { id: true, status: true, submittedAt: true },
      }),
    );

    expect(rascunho.status).toBe('DRAFT');
    expect(rascunho.submittedAt).toBeNull();

    expect(url).toBe(
      `NEXT_REDIRECT:/t/${TENANT_SLUG}/submissoes/${rascunho.id}?rascunho=1`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('submitProposalAction() — a recusa SEM rascunho continua na tela', () => {
  it('chamada encerrada devolve o erro e NÃO redireciona', async () => {
    const form = formDaProposta({
      callSlug: CLOSED_CALL_SLUG,
      title: `Proposta fora do prazo ${RUN}`,
    });

    /**
     * O caminho é o valor de retorno normal da action: nenhuma sentinela, nenhum
     * rascunho. É a prova de que o redirect é da recusa `NOT_READY`, e não de
     * "qualquer erro".
     */
    let resultado: Awaited<ReturnType<typeof submitProposalAction>> | null = null;

    try {
      resultado = await submitProposalAction(null, form);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      throw new Error(`A recusa sem rascunho não pode redirecionar: ${error.message}`);
    }

    expect(resultado).not.toBeNull();
    if (!resultado || resultado.ok) throw new Error('A chamada encerrada deveria recusar.');

    expect(resultado.code).toBe('CALL_CLOSED');
    expect(resultado).not.toHaveProperty('submissionId');

    /** E nada foi gravado: a recusa acontece antes do rascunho nascer. */
    const rascunhos = await withTenant(tenantId, (tx) =>
      tx.submission.count({ where: { tenantId, callId: closedCallId } }),
    );

    expect(rascunhos).toBe(0);
  });
});
