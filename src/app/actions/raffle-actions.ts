'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Sorteios
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A APURAÇÃO É UMA ACTION SEPARADA DA CRIAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar o sorteio é configuração; APURAR é o ato público. Separar as duas
 *  permite ao organizador montar o sorteio com calma, conferir a lista de
 *  elegíveis e só então executar — e é o que torna possível recusar uma segunda
 *  apuração sem afetar a configuração.
 *
 *  A autorização exige `event:manage` (e não `event:update`): sortear afeta
 *  PESSOAS e produz resultado auditável, então fica com quem responde pelo evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { can, type Principal } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPES, type RaffleScope } from '@/domain/raffles/raffle-rules';
import {
  cancelRaffle,
  createRaffle,
  drawRound,
  markPrizeDelivered,
  prepareRound,
  previewEligibility,
  reversePrizeDelivery,
  setRaffleVisibility,
  updateRoundAnnouncement,
} from '@/lib/raffles/raffle-service';

export interface RaffleActionState {
  ok: boolean;
  code?: string;
  message?: string;
  details?: readonly string[];
  data?: Record<string, unknown>;
}

async function guard(tenantSlug: string): Promise<
  | { ok: true; userId: string; tenantId: string; principal: Principal }
  | { ok: false; state: RaffleActionState }
> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return {
      ok: false,
      state: { ok: false, code: 'NOT_AUTHENTICATED', message: 'Sessão expirada. Entre novamente.' },
    };
  }

  const tenant = await adminPrisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });

  if (!tenant) {
    return { ok: false, state: { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' } };
  }

  const membership = await adminPrisma.userTenantProfile.findFirst({
    where: { tenantId: tenant.id, userId: user.id, deletedAt: null },
    select: { status: true },
  });

  if (!membership || membership.status !== 'ACTIVE') {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Você não tem vínculo ativo com esta instituição.' },
    };
  }

  const principal = await loadPrincipal(user.id, tenant.id, membership.status);

  if (!can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' })) {
    return {
      ok: false,
      state: { ok: false, code: 'FORBIDDEN', message: 'Permissão negada: event:manage.' },
    };
  }

  return { ok: true, userId: user.id, tenantId: tenant.id, principal };
}

function toDateOnly(value: FormDataEntryValue | null): Date | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  // `<input type="date">` devolve `AAAA-MM-DD`; interpretamos ao meio-dia UTC para
  // que nenhum fuso desloque a data para o dia anterior.
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prévia (somente leitura, mas exige a mesma permissão)
// ───────────────────────────────────────────────────────────────────────────────
const previewSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  eventId: z.string().uuid(),
  scope: z.enum(RAFFLE_SCOPES as unknown as [RaffleScope, ...RaffleScope[]]),
  activityId: z.string().uuid().optional(),
  referenceDate: z.string().trim().optional(),
  minAttendanceMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  winnersCount: z.coerce.number().int().min(1).max(500).default(1),
  alternatesCount: z.coerce.number().int().min(0).max(500).default(0),
  weightByMinutes: z.coerce.boolean().optional().default(false),
  allowPriorEventWinners: z.coerce.boolean().optional().default(false),
});

/**
 * Calcula os elegíveis SEM sortear.
 *
 * Existe para que a conferência aconteça ANTES do sorteio: no palco, descobrir que
 * a lista estava errada já não tem volta.
 */
export async function previewRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = previewSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    scope: formData.get('scope'),
    activityId: (formData.get('activityId') as string) || undefined,
    referenceDate: (formData.get('referenceDate') as string) || undefined,
    minAttendanceMinutes: formData.get('minAttendanceMinutes') ?? 0,
    winnersCount: formData.get('winnersCount') ?? 1,
    alternatesCount: formData.get('alternatesCount') ?? 0,
    weightByMinutes: formData.get('weightByMinutes') === 'on',
    allowPriorEventWinners: formData.get('allowPriorEventWinners') === 'on',
  });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'Verifique os parâmetros do sorteio.',
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await previewEligibility({
    tenantId: auth.tenantId,
    eventId: parsed.data.eventId,
    config: {
      scope: parsed.data.scope,
      referenceDate: toDateOnly(parsed.data.referenceDate ?? null),
      activityId: parsed.data.activityId ?? null,
      minAttendanceMinutes: parsed.data.minAttendanceMinutes,
      winnersCount: parsed.data.winnersCount,
      alternatesCount: parsed.data.alternatesCount,
      weightByMinutes: parsed.data.weightByMinutes,
      allowPriorEventWinners: parsed.data.allowPriorEventWinners,
    },
  });

  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }

  return {
    ok: true,
    message: result.preview.readiness.message,
    data: {
      eligibleCount: result.preview.eligible.length,
      inspectedAttendances: result.preview.inspectedAttendances,
      canDraw: result.preview.readiness.canDraw,
      willDraw: result.preview.readiness.willDraw,
      shortfall: result.preview.readiness.shortfall,
      alternatesToDraw: result.preview.readiness.alternatesToDraw,
      eligible: result.preview.eligible.slice(0, 100).map((entry) => ({
        userId: entry.userId,
        userName: entry.userName,
        minutes: entry.minutes,
      })),
      rejected: result.preview.rejected.slice(0, 50),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação do sorteio — com ou sem apuração imediata (FASE 30)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O prêmio e o patrocinador são ANÚNCIO, não entrada do sorteio (ADR-145): não entram
 * no documento assinado, e corrigir o texto do prêmio não invalida um resultado já
 * publicado. Por isso a validação aqui é de tamanho; a normalização é do domínio.
 */
const prizeFields = {
  prizeTitle: z.string().trim().max(200).optional(),
  prizeDescription: z.string().trim().max(600).optional(),
  sponsorId: z.string().uuid().optional(),
};

const raffleConfigSchema = previewSchema.extend({
  title: z.string().trim().min(3, 'Dê um nome ao sorteio (mínimo 3 caracteres).').max(200),
  description: z.string().trim().max(2000).optional(),
  isPublic: z.coerce.boolean().optional().default(false),
  ...prizeFields,
});

type RaffleConfigInput = z.infer<typeof raffleConfigSchema>;

/**
 * Lê a configuração do formulário em UM lugar só.
 *
 * O console tem dois botões — "Sortear agora" e "Criar para o palco" — sobre o MESMO
 * formulário. Ler os campos duas vezes faria os dois caminhos divergirem no dia em que
 * um campo novo entrasse em apenas um deles (armadilha 55).
 */
function readRaffleConfig(
  formData: FormData,
): { ok: true; data: RaffleConfigInput } | { ok: false; state: RaffleActionState } {
  const parsed = raffleConfigSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    eventId: formData.get('eventId'),
    title: formData.get('title'),
    description: (formData.get('description') as string) || undefined,
    scope: formData.get('scope'),
    activityId: (formData.get('activityId') as string) || undefined,
    referenceDate: (formData.get('referenceDate') as string) || undefined,
    minAttendanceMinutes: formData.get('minAttendanceMinutes') ?? 0,
    winnersCount: formData.get('winnersCount') ?? 1,
    alternatesCount: formData.get('alternatesCount') ?? 0,
    weightByMinutes: formData.get('weightByMinutes') === 'on',
    allowPriorEventWinners: formData.get('allowPriorEventWinners') === 'on',
    isPublic: formData.get('isPublic') === 'on',
    prizeTitle: (formData.get('prizeTitle') as string) || undefined,
    prizeDescription: (formData.get('prizeDescription') as string) || undefined,
    sponsorId: (formData.get('sponsorId') as string) || undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      state: {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Verifique os dados do sorteio.',
        details: parsed.error.issues.map((issue) => issue.message),
      },
    };
  }

  return { ok: true, data: parsed.data };
}

/** A criação em si — usada pelos dois caminhos (apurar agora ou deixar para o palco). */
async function createFromConfig(
  config: RaffleConfigInput,
  auth: { tenantId: string; userId: string },
) {
  return createRaffle({
    tenantId: auth.tenantId,
    eventId: config.eventId,
    actorId: auth.userId,
    title: config.title,
    description: config.description ?? null,
    scope: config.scope,
    referenceDate: toDateOnly(config.referenceDate ?? null),
    activityId: config.activityId ?? null,
    minAttendanceMinutes: config.minAttendanceMinutes,
    winnersCount: config.winnersCount,
    alternatesCount: config.alternatesCount,
    weightByMinutes: config.weightByMinutes,
    isPublic: config.isPublic,
    allowPriorEventWinners: config.allowPriorEventWinners,
    prizeTitle: config.prizeTitle ?? null,
    prizeDescription: config.prizeDescription ?? null,
    sponsorId: config.sponsorId ?? null,
  });
}

/**
 * Cria o sorteio, prepara a rodada 1 e NÃO apura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE CAMINHO PASSOU A EXISTIR (FASE 30)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O console só sabia criar E apurar de uma vez. O telão, então, nascia mostrando um
 *  resultado já apurado: não havia como projetá-lo ANTES — que é justamente o que se
 *  faz no dia do evento, com o público chegando e o compromisso na tela. Aqui o
 *  sorteio nasce em rascunho, com a rodada 1 preparada (semente selada, compromisso
 *  publicado na trilha) e o telão tem o que mostrar: o compromisso e a contagem ao
 *  vivo, até alguém apurar.
 */
export async function createRaffleForStageAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const config = readRaffleConfig(formData);
  if (!config.ok) return config.state;

  const auth = await guard(config.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const created = await createFromConfig(config.data, auth);

  revalidatePath(
    tenantPath(config.data.tenantSlug, `/administracao/eventos/${config.data.eventId}/sorteios`),
  );

  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message, details: created.details };
  }

  return {
    ok: true,
    message:
      'Sorteio criado com a rodada 1 preparada e o compromisso da semente já publicado. Projete o telão: ele mostra o compromisso e a contagem ao vivo até você apurar.',
    data: {
      raffleId: created.raffleId,
      roundNumber: 1,
      status: 'DRAFT',
      seedCommitment: created.seedCommitment,
      awaitingDraw: true,
    },
  };
}

/**
 * Cria e apura o sorteio de uma vez.
 *
 * É o fluxo de quem já está com o público na frente e quer o resultado agora. As duas
 * operações continuam separadas no serviço (a criação grava o `DRAFT` com a rodada 1),
 * mas a tela não obriga a dois envios.
 *
 * O COMPROMISSO da semente (FASE 16) nasce na criação — antes de existir elegível — e
 * volta na resposta para que a tela possa exibi-lo junto do resultado.
 */
export async function createAndDrawRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const config = readRaffleConfig(formData);
  if (!config.ok) return config.state;

  const auth = await guard(config.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const created = await createFromConfig(config.data, auth);

  if (!created.ok) {
    return { ok: false, code: created.code, message: created.message, details: created.details };
  }

  const drawn = await drawRound({
    tenantId: auth.tenantId,
    raffleId: created.raffleId,
    actorId: auth.userId,
  });

  revalidatePath(
    tenantPath(config.data.tenantSlug, `/administracao/eventos/${config.data.eventId}/sorteios`),
  );

  if (!drawn.ok) {
    /**
     * A configuração FOI criada, mas a apuração não pôde acontecer (tipicamente
     * nenhum elegível). O sorteio permanece como `DRAFT` para ser conferido e
     * apurado depois — em vez de desaparecer e obrigar a redigitar tudo.
     */
    return {
      ok: false,
      code: drawn.code,
      message: drawn.message,
      data: {
        raffleId: created.raffleId,
        status: 'DRAFT',
        seedCommitment: created.seedCommitment,
      },
    };
  }

  return {
    ok: true,
    message:
      drawn.shortfall > 0
        ? `${drawn.winners.length} posição(ões) sorteadas entre ${drawn.eligibleCount} elegíveis (faltaram ${drawn.shortfall} para o pedido).`
        : drawn.alternatesDrawn > 0
          ? `${drawn.winnersDrawn} titular(es) e ${drawn.alternatesDrawn} suplente(s) sorteados entre ${drawn.eligibleCount} elegíveis.`
          : `${drawn.winnersDrawn} vencedor(es) sorteados entre ${drawn.eligibleCount} elegíveis.`,
    data: {
      raffleId: drawn.raffleId,
      eligibleCount: drawn.eligibleCount,
      inspectedAttendances: drawn.inspectedAttendances,
      resultHash: drawn.resultHash,
      drawnAt: drawn.drawnAt.toISOString(),
      shortfall: drawn.shortfall,
      winners: drawn.winners,
      winnersDrawn: drawn.winnersDrawn,
      alternatesDrawn: drawn.alternatesDrawn,
      seedCommitment: drawn.seedCommitment,
      seedRevealed: drawn.seedRevealed,
      seeded: drawn.seeded,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Rodadas: preparar e apurar em MOMENTOS separados (FASE 30)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Prepara a PRÓXIMA rodada: nova semente, novo compromisso, novo prêmio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RODADA PRECISA SER PREPARADA, E NÃO SÓ APURADA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A apuração REVELA a semente. Se a rodada 2 usasse a mesma semente da 1, quem
 *  lesse a revelação da primeira saberia os ganhadores da segunda antes do anúncio —
 *  no palco, com a plateia olhando. Preparar publica um compromisso NOVO (e o telão o
 *  exibe) antes de existir resultado.
 *
 *  O prêmio e o patrocinador entram aqui porque é o momento do ANÚNCIO: a lista de
 *  quem concorre ainda vai ser calculada na apuração.
 */
export async function prepareRoundAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      winnersCount: z.coerce.number().int().min(1).max(500).optional(),
      alternatesCount: z.coerce.number().int().min(0).max(500).optional(),
      ...prizeFields,
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      winnersCount: formData.get('winnersCount') || undefined,
      alternatesCount: formData.get('alternatesCount') || undefined,
      prizeTitle: (formData.get('prizeTitle') as string) || undefined,
      prizeDescription: (formData.get('prizeDescription') as string) || undefined,
      sponsorId: (formData.get('sponsorId') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Verifique os dados da próxima rodada.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await prepareRound({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
    winnersCount: parsed.data.winnersCount,
    alternatesCount: parsed.data.alternatesCount,
    prizeTitle: parsed.data.prizeTitle ?? null,
    prizeDescription: parsed.data.prizeDescription ?? null,
    sponsorId: parsed.data.sponsorId ?? null,
  });

  revalidatePath(
    tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`),
  );

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: `Rodada ${result.roundNumber} preparada: o compromisso da semente já está publicado e o telão pode anunciá-la.`,
    data: {
      raffleId: result.raffleId,
      roundId: result.roundId,
      roundNumber: result.roundNumber,
      seedCommitment: result.seedCommitment,
    },
  };
}

/**
 * Atualiza os textos de anúncio (prêmio e patrocinador) de uma rodada (FASE 35 · Dívida E38).
 */
export async function updateRoundAnnouncementAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      roundId: z.string().uuid(),
      ...prizeFields,
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      roundId: formData.get('roundId'),
      prizeTitle: (formData.get('prizeTitle') as string) || undefined,
      prizeDescription: (formData.get('prizeDescription') as string) || undefined,
      sponsorId: (formData.get('sponsorId') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Verifique os dados do anúncio.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await updateRoundAnnouncement({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    roundId: parsed.data.roundId,
    actorId: auth.userId,
    prizeTitle: parsed.data.prizeTitle ?? null,
    prizeDescription: parsed.data.prizeDescription ?? null,
    sponsorId: parsed.data.sponsorId ?? null,
  });

  revalidatePath(
    tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`),
  );

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  return {
    ok: true,
    message: `Anúncio da rodada ${result.roundNumber} atualizado com sucesso.`,
    data: {
      raffleId: result.raffleId,
      roundId: result.roundId,
      roundNumber: result.roundNumber,
      prizeTitle: result.prizeTitle,
      prizeDescription: result.prizeDescription,
      sponsorId: result.sponsorId,
      sponsorName: result.sponsorName,
    },
  };
}

/**
 * Apura UMA rodada do sorteio (a preparada, quando nenhuma é indicada).
 *
 * `roundId` é opcional e existe para que a tela possa apurar uma rodada específica do
 * histórico sem depender de "qual está pendente" — mas o caminho normal do palco é
 * apurar a que foi anunciada.
 */
export async function drawRoundAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      roundId: z.string().uuid().optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      roundId: (formData.get('roundId') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para a apuração.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const drawn = await drawRound({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    roundId: parsed.data.roundId,
    actorId: auth.userId,
  });

  const eventPath = tenantPath(
    parsed.data.tenantSlug,
    `/administracao/eventos/${parsed.data.eventId}/sorteios`,
  );
  revalidatePath(eventPath);
  // O telão e o resultado público leem a apuração: apurar é publicar para eles.
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'), 'layout');

  if (!drawn.ok) {
    return { ok: false, code: drawn.code, message: drawn.message };
  }

  return {
    ok: true,
    /**
     * A mensagem volta a dizer "vencedor" quando NÃO há suplentes: é o caso em que
     * "titular" só acrescentaria uma palavra nova para o mesmo fato. Com suplência, a
     * distinção passa a importar — quem entrega o prêmio precisa saber quantos são
     * titulares e quantos são reserva.
     */
    message:
      drawn.alternatesDrawn > 0
        ? `Rodada ${drawn.roundNumber}: ${drawn.winnersDrawn} titular(es) e ${drawn.alternatesDrawn} suplente(s) entre ${drawn.eligibleCount} elegíveis.`
        : `Rodada ${drawn.roundNumber}: ${drawn.winnersDrawn} vencedor(es) entre ${drawn.eligibleCount} elegíveis.`,
    data: {
      raffleId: drawn.raffleId,
      roundId: drawn.roundId,
      roundNumber: drawn.roundNumber,
      eligibleCount: drawn.eligibleCount,
      inspectedAttendances: drawn.inspectedAttendances,
      resultHash: drawn.resultHash,
      drawnAt: drawn.drawnAt.toISOString(),
      shortfall: drawn.shortfall,
      firstPosition: drawn.firstPosition,
      winners: drawn.winners,
      winnersDrawn: drawn.winnersDrawn,
      alternatesDrawn: drawn.alternatesDrawn,
      seedCommitment: drawn.seedCommitment,
      seedRevealed: drawn.seedRevealed,
      seeded: drawn.seeded,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Apuração de um sorteio já configurado (compatibilidade)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Apura a rodada preparada de um sorteio — o mesmo que `drawRoundAction` sem `roundId`.
 *
 * Continua existindo porque a tela de histórico chama por este nome desde a FASE 22, e
 * o comportamento (apurar o que está pendente) é exatamente o que ela quer.
 */
export async function drawRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  return drawRoundAction(_prev, formData);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Entrega do prêmio (FASE 16, item G2)
// ─────────────────────────────────────────────────────────────────────────────
export async function markPrizeDeliveredAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      // Id da POSIÇÃO sorteada (não da pessoa): é o que o serviço registra.
      positionId: z.string().uuid(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      positionId: formData.get('positionId'),
      note: (formData.get('note') as string) || undefined,
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para registrar a entrega.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await markPrizeDelivered({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    positionId: parsed.data.positionId,
    actorId: auth.userId,
    note: parsed.data.note ?? null,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  return result.ok
    ? {
        ok: true,
        message: `Entrega registrada para ${result.userName}.`,
        data: { positionId: result.positionId },
      }
    : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Desfazer a entrega do prêmio (FASE 22, item G8)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Desfaz o registro de entrega de uma posição — com motivo obrigatório.
 *
 * Mesma permissão da entrega (`event:manage`): quem registra no balcão é quem
 * corrige. O motivo chega do formulário e vai inteiro para a trilha; a validação de
 * tamanho é do domínio (`evaluateDeliveryReversal`), para a regra valer também em
 * qualquer chamada que não passe por aqui.
 */
export async function reversePrizeDeliveryAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      positionId: z.string().uuid(),
      /**
       * O motivo NÃO é validado aqui quanto ao tamanho: vazio vira `''` e a recusa
       * vem do domínio, com a mensagem que explica por que ele é exigido. Validar nos
       * dois lugares deixaria duas mensagens diferentes para a mesma regra.
       */
      reason: z.string().max(300).optional(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      positionId: formData.get('positionId'),
      reason: (formData.get('reason') as string) ?? '',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para desfazer a entrega.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await reversePrizeDelivery({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    positionId: parsed.data.positionId,
    actorId: auth.userId,
    reason: parsed.data.reason ?? '',
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));
  // A publicação mostra a retirada do prêmio: desfazer a entrega muda o que o
  // público vê no resultado publicado.
  revalidatePath(tenantPath(parsed.data.tenantSlug, `/eventos`), 'layout');

  return result.ok
    ? {
        ok: true,
        message: `Entrega de ${result.userName} desfeita. O motivo ficou na trilha de auditoria.`,
        data: { positionId: result.positionId },
      }
    : { ok: false, code: result.code, message: result.message };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Publicação do resultado (FASE 16, item G5)
// ───────────────────────────────────────────────────────────────────────────────
export async function setRaffleVisibilityAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      isPublic: z.coerce.boolean(),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      isPublic: formData.get('isPublic') === 'true',
    });

  if (!parsed.success) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Dados inválidos para publicar o resultado.' };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await setRaffleVisibility({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
    isPublic: parsed.data.isPublic,
  });

  const eventPath = tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`);
  revalidatePath(eventPath);

  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  // A página pública do evento mostra o resultado: invalidar é parte de publicar.
  revalidatePath(tenantPath(parsed.data.tenantSlug, '/eventos'));
  revalidatePath(eventPath);

  return {
    ok: true,
    message: result.isPublic
      ? 'Resultado publicado na página do evento (nomes mascarados, exceto perfis públicos).'
      : 'Resultado deixou de ser publicado.',
    data: { isPublic: result.isPublic },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Cancelamento
// ───────────────────────────────────────────────────────────────────────────────
export async function cancelRaffleAction(
  _prev: RaffleActionState | null,
  formData: FormData,
): Promise<RaffleActionState> {
  const parsed = z
    .object({
      tenantSlug: z.string().trim().min(1).max(63),
      eventId: z.string().uuid(),
      raffleId: z.string().uuid(),
      reason: z.string().trim().min(8, 'Descreva o motivo (mínimo 8 caracteres).').max(400),
    })
    .safeParse({
      tenantSlug: formData.get('tenantSlug'),
      eventId: formData.get('eventId'),
      raffleId: formData.get('raffleId'),
      reason: formData.get('reason'),
    });

  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message ?? 'Dados inválidos.',
    };
  }

  const auth = await guard(parsed.data.tenantSlug);
  if (!auth.ok) return auth.state;

  const result = await cancelRaffle({
    tenantId: auth.tenantId,
    raffleId: parsed.data.raffleId,
    actorId: auth.userId,
    reason: parsed.data.reason,
  });

  revalidatePath(tenantPath(parsed.data.tenantSlug, `/administracao/eventos/${parsed.data.eventId}/sorteios`));

  return result.ok
    ? { ok: true, message: 'Sorteio cancelado.' }
    : { ok: false, code: result.code, message: result.message };
}
