/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — a chave da API por evento: criar, revogar, reexibir, seções e
 *  VERIFICAR (FASE 72 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE SERVIÇO LÊ O BANCO (E POR QUE ISSO NÃO É "UM SEGUNDO CAMINHO")
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A projeção pública da API continua vindo de `loadEventApiProjections` — a
 *  MESMA visão da página. Este arquivo NÃO projeta conteúdo público: ele lê a
 *  CONFIGURAÇÃO (`Event.settings.api`) para decidir se a requisição pode ler, e
 *  grava a chave quando o organizador cria/revoga. É autorização, não projeção;
 *  misturar as duas coisas no `event-api-service.ts` faria a catraca da fase
 *  reprovar — com razão — um `withTenant` no caminho do dado público.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TRILHA GUARDA, E O QUE ELA NUNCA GUARDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar, revogar e CADA recusa viram linha em `audit_logs`. A chave em claro
 *  nunca entra: na criação vai o ÍNDICE (SHA-256) e o ato; nas recusas, o motivo
 *  e — quando houve chave apresentada — o índice dela. A taxa de recusa é o sinal
 *  de abuso que o humano pediu para enxergar.
 *
 *  O `entityId` da trilha é o ID DO EVENTO: a chave não tem linha própria, e "qual
 *  evento foi sondado" é a pergunta que se faz ao investigar. O `entityType`
 *  (`event_api_key`) separa esses fatos dos demais atos sobre o evento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ERRO COMO VALOR, E CRIAÇÃO QUE NÃO ROTACIONA EM SILÊNCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar uma chave com outra ativa responde `ALREADY_EXISTS`: rotacionar sem ato
 *  explícito invalidaria, em silêncio, o site externo que já está integrado. Trocar
 *  a chave é revogar e criar — dois atos, dois registros.
 *
 *  `BETTER_AUTH_SECRET` ausente/curto → `SEAL_UNAVAILABLE` (não grava em claro).
 *  A VERIFICAÇÃO, porém, não depende do segredo: ela compara SHA-256. Um segredo
 *  girado derruba só o REEXIBIR, e a mensagem diz isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE SERVIÇO NÃO AUTORIZA — QUEM AUTORIZA É A ACTION (FATIA 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra da casa é que TODA autorização é verificada na Server Action. Aqui as
 *  funções recebem `actorUserId` para a trilha e operam sobre o evento da
 *  instituição do contexto (RLS); a tela da fatia 3 é quem chama `guardAction`
 *  com a permissão de administrar o evento antes de criar/revogar. Uma rota de
 *  escrita NÃO existe nesta fatia de propósito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import {
  buildEventApiConfig,
  isEventApiKeyRevoked,
  readEventApiConfig,
  type EventApiSectionToggles,
  type EventApiStoredConfig,
} from '@/domain/api/event-api-key-rules';
import {
  createEventApiKeySecret,
  eventApiKeyMatchesHash,
  hashEventApiKey,
  openEventApiKey,
  sealEventApiKey,
} from '@/lib/api/event-api-key-vault';

/** Por que a leitura foi recusada. Só a trilha e o log veem o detalhe. */
export type EventApiRefusalReason =
  | 'AUSENTE'
  | 'EVENTO_INEXISTENTE'
  | 'SEM_CHAVE_CONFIGURADA'
  | 'CONFIGURACAO_INVALIDA'
  | 'REVOGADA'
  | 'DIVERGENTE';

export type EventApiKeyErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'NOT_CONFIGURED'
  | 'REVOKED'
  | 'SEAL_UNAVAILABLE'
  | 'INTERNAL';

export type EventApiKeyResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: EventApiKeyErrorCode; message: string };

export type VerifyEventApiKeyResult =
  | { ok: true; eventId: string; config: EventApiStoredConfig }
  | { ok: false; code: 'INVALID_KEY'; reason: EventApiRefusalReason };

/** `settings` é JSON livre: qualquer coisa que não seja objeto é tratada como vazio. */
function settingsObject(settings: unknown): Record<string, unknown> {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return {};

  return settings as Record<string, unknown>;
}

function internalFailure(scope: string, error: unknown): { ok: false; code: 'INTERNAL'; message: string } {
  console.error(`[api] falha ao ${scope} a chave do evento: ${errorMessage(error)}`);

  return { ok: false, code: 'INTERNAL', message: 'Não foi possível concluir a operação com a chave da API.' };
}

/**
 * Grava uma recusa. Nunca lança (`recordAudit` já engole a falha), e NUNCA
 * inclui a chave: só o motivo e, quando houve chave, o índice SHA-256.
 */
async function auditRefusal(input: {
  tenantId: string;
  eventId: string | null;
  reason: EventApiRefusalReason;
  presentedKey: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  await recordAudit({
    tenantId: input.tenantId,
    userId: null,
    action: 'READ',
    entityType: 'event_api_key',
    entityId: input.eventId,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    changes: {
      motivo: { from: null, to: input.reason },
      ...(input.presentedKey
        ? { chaveHash: { from: null, to: hashEventApiKey(input.presentedKey) } }
        : {}),
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Gera a chave, sela, grava o índice e devolve a chave EM CLARO UMA vez.
 *
 * Quem chama (a Server Action da fatia 3) exibe o valor e não o guarda; depois
 * disso, só `revealEventApiKey` a traz de volta.
 */
export async function createEventApiKey(input: {
  tenantId: string;
  eventId: string;
  actorUserId?: string | null;
}): Promise<EventApiKeyResult<{ chave: string; criadaEm: Date; secoes: EventApiSectionToggles }>> {
  try {
    const chave = createEventApiKeySecret();
    const chaveSelada = sealEventApiKey(chave);

    if (!chaveSelada) {
      return {
        ok: false,
        code: 'SEAL_UNAVAILABLE',
        message:
          'O servidor não consegue guardar chaves agora (segredo da aplicação ausente ou curto). A chave não foi criada.',
      };
    }

    const criadaEm = new Date();
    const config = buildEventApiConfig({
      chaveSelada,
      chaveHash: hashEventApiKey(chave),
      criadaEm,
    });

    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) return { kind: 'NOT_FOUND' as const };

      const stored = readEventApiConfig(event.settings);

      /**
       * Só uma chave ATIVA bloqueia a criação. Uma configuração torta é
       * substituída (como no formulário da F70): o organizador não pode ficar
       * preso a um JSON que a leitura tolerante recusa — mas o `problems` vai
       * para a trilha, para a substituição não ser silenciosa.
       */
      if (stored.configured && stored.config && !isEventApiKeyRevoked(stored.config)) {
        return { kind: 'ALREADY_EXISTS' as const };
      }

      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            ...settingsObject(event.settings),
            api: config,
          } as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorUserId ?? null,
          action: 'CREATE',
          entityType: 'event_api_key',
          entityId: event.id,
          changes: {
            criadaEm: { from: null, to: criadaEm.toISOString() },
            /** O ÍNDICE, nunca a chave. */
            chaveHash: { from: null, to: config.chaveHash },
            secoes: { from: null, to: JSON.stringify(config.secoes) },
            ...(stored.problems.length > 0
              ? { configuracaoSubstituida: { from: stored.problems.join(' '), to: null } }
              : {}),
          },
        },
        tx,
      );

      return { kind: 'CREATED' as const };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    if (outcome.kind === 'ALREADY_EXISTS') {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: 'Já existe uma chave ativa para este evento. Revogue-a antes de gerar outra.',
      };
    }

    return { ok: true, chave, criadaEm, secoes: config.secoes };
  } catch (error) {
    return internalFailure('criar', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revogar
// ───────────────────────────────────────────────────────────────────────────────
/** A revogação é um ATO: grava `revogadaEm` e vale na requisição seguinte. */
export async function revokeEventApiKey(input: {
  tenantId: string;
  eventId: string;
  actorUserId?: string | null;
  reason?: string;
}): Promise<EventApiKeyResult<{ revogadaEm: Date }>> {
  try {
    const revogadaEm = new Date();

    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) return { kind: 'NOT_FOUND' as const };

      const stored = readEventApiConfig(event.settings);

      if (!stored.configured || !stored.config) {
        return { kind: 'NOT_CONFIGURED' as const };
      }

      if (isEventApiKeyRevoked(stored.config)) {
        return { kind: 'REVOKED' as const };
      }

      const config: EventApiStoredConfig = {
        ...stored.config,
        revogadaEm: revogadaEm.toISOString(),
      };

      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            ...settingsObject(event.settings),
            api: config,
          } as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorUserId ?? null,
          action: 'DELETE',
          entityType: 'event_api_key',
          entityId: event.id,
          changes: {
            revogadaEm: { from: null, to: config.revogadaEm },
            ...(input.reason ? { motivo: { from: null, to: input.reason } } : {}),
          },
        },
        tx,
      );

      return { kind: 'REVOKED_NOW' as const };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    if (outcome.kind === 'NOT_CONFIGURED') {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Este evento não tem chave de API.' };
    }

    if (outcome.kind === 'REVOKED') {
      return { ok: false, code: 'REVOKED', message: 'Esta chave já está revogada.' };
    }

    return { ok: true, revogadaEm };
  } catch (error) {
    return internalFailure('revogar', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reexibir
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Abre o selo para o organizador copiar a chave de novo.
 *
 * Não entra na trilha: reexibir é a operação normal da tela da fatia 3, e uma
 * linha por abertura afogaria o sinal de abuso. O que a trilha registra é o ATO
 * de criar e o de revogar.
 */
export async function revealEventApiKey(input: {
  tenantId: string;
  eventId: string;
}): Promise<EventApiKeyResult<{ chave: string; config: EventApiStoredConfig }>> {
  try {
    const stored = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { settings: true },
      });

      if (!event) return { kind: 'NOT_FOUND' as const };

      const read = readEventApiConfig(event.settings);

      if (!read.configured || !read.config) return { kind: 'NOT_CONFIGURED' as const };
      if (isEventApiKeyRevoked(read.config)) return { kind: 'REVOKED' as const };

      return { kind: 'FOUND' as const, config: read.config };
    });

    if (stored.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    if (stored.kind === 'NOT_CONFIGURED') {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Este evento não tem chave de API.' };
    }

    if (stored.kind === 'REVOKED') {
      return {
        ok: false,
        code: 'REVOKED',
        message: 'Esta chave foi revogada e não pode mais ser exibida. Gere outra.',
      };
    }

    const chave = openEventApiKey(stored.config.chaveSelada);

    if (!chave) {
      return {
        ok: false,
        code: 'SEAL_UNAVAILABLE',
        message:
          'O servidor não consegue abrir o selo desta chave (segredo da aplicação girado ou ausente). A chave antiga continua valendo para quem já a tem; gere outra para reexibir.',
      };
    }

    return { ok: true, chave, config: stored.config };
  } catch (error) {
    return internalFailure('reexibir', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Interruptores por seção (a tela da fatia 3 usa)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Liga/desliga as seções expostas na API.
 *
 * A operação exige uma chave já criada: interruptor sem chave não expõe nada e
 * só confundiria a tela. O `from`/`to` da trilha é o estado dos três booleanos.
 */
export async function updateEventApiSections(input: {
  tenantId: string;
  eventId: string;
  actorUserId?: string | null;
  secoes: Partial<EventApiSectionToggles>;
}): Promise<EventApiKeyResult<{ secoes: EventApiSectionToggles }>> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) return { kind: 'NOT_FOUND' as const };

      const stored = readEventApiConfig(event.settings);

      if (!stored.configured || !stored.config) {
        return { kind: 'NOT_CONFIGURED' as const };
      }

      if (isEventApiKeyRevoked(stored.config)) {
        return { kind: 'REVOKED' as const };
      }

      /** Só booleano muda; valor de outro tipo é ignorado (a tela manda booleano). */
      const secoes: EventApiSectionToggles = {
        palestrantes:
          typeof input.secoes.palestrantes === 'boolean'
            ? input.secoes.palestrantes
            : stored.config.secoes.palestrantes,
        patrocinadores:
          typeof input.secoes.patrocinadores === 'boolean'
            ? input.secoes.patrocinadores
            : stored.config.secoes.patrocinadores,
        chamadas:
          typeof input.secoes.chamadas === 'boolean'
            ? input.secoes.chamadas
            : stored.config.secoes.chamadas,
      };

      const config: EventApiStoredConfig = { ...stored.config, secoes };

      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            ...settingsObject(event.settings),
            api: config,
          } as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorUserId ?? null,
          action: 'UPDATE',
          entityType: 'event_api_key',
          entityId: event.id,
          changes: {
            secoes: {
              from: JSON.stringify(stored.config.secoes),
              to: JSON.stringify(secoes),
            },
          },
        },
        tx,
      );

      return { kind: 'UPDATED' as const, secoes };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
    }

    if (outcome.kind === 'NOT_CONFIGURED') {
      return { ok: false, code: 'NOT_CONFIGURED', message: 'Este evento não tem chave de API.' };
    }

    if (outcome.kind === 'REVOKED') {
      return { ok: false, code: 'REVOKED', message: 'Esta chave foi revogada. Gere outra.' };
    }

    return { ok: true, secoes: outcome.secoes };
  } catch (error) {
    return internalFailure('atualizar as seções de', error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Verificar (o caminho da ROTA)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Confere a chave apresentada e devolve a configuração (com os interruptores).
 *
 * `presentedKey === null` é "sem chave": não é preciso tocar no banco para
 * recusar, mas a recusa VAI para a trilha com o `eventId` quando ele é conhecido
 * — por isso o chamador pode passar `eventId` já resolvido; a rota não resolve,
 * e a trilha fica com `entityId` nulo nesse caso, o que é honesto: não houve
 * leitura de evento nenhum.
 *
 * A ordem das recusas é deliberada: evento inexistente e chave divergente
 * respondem o MESMO `INVALID_KEY` para quem sonda, e o motivo detalhado fica só
 * na trilha.
 */
export async function verifyEventApiKey(input: {
  tenantId: string;
  eventSlug: string;
  presentedKey: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<VerifyEventApiKeyResult> {
  if (!input.presentedKey) {
    await auditRefusal({
      tenantId: input.tenantId,
      eventId: null,
      reason: 'AUSENTE',
      presentedKey: null,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return { ok: false, code: 'INVALID_KEY', reason: 'AUSENTE' };
  }

  try {
    const event = await withTenant(input.tenantId, (tx) =>
      tx.event.findFirst({
        where: { slug: input.eventSlug, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      }),
    );

    if (!event) {
      await auditRefusal({
        tenantId: input.tenantId,
        eventId: null,
        reason: 'EVENTO_INEXISTENTE',
        presentedKey: input.presentedKey,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { ok: false, code: 'INVALID_KEY', reason: 'EVENTO_INEXISTENTE' };
    }

    const stored = readEventApiConfig(event.settings);

    if (!stored.configured || !stored.config) {
      const reason: EventApiRefusalReason =
        stored.problems.length > 0 ? 'CONFIGURACAO_INVALIDA' : 'SEM_CHAVE_CONFIGURADA';

      if (stored.problems.length > 0) {
        console.error(`[api] chave da API inválida em settings do evento ${event.id}: ${stored.problems.join(' ')}`);
      }

      await auditRefusal({
        tenantId: input.tenantId,
        eventId: event.id,
        reason,
        presentedKey: input.presentedKey,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { ok: false, code: 'INVALID_KEY', reason };
    }

    if (isEventApiKeyRevoked(stored.config)) {
      await auditRefusal({
        tenantId: input.tenantId,
        eventId: event.id,
        reason: 'REVOGADA',
        presentedKey: input.presentedKey,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { ok: false, code: 'INVALID_KEY', reason: 'REVOGADA' };
    }

    if (!eventApiKeyMatchesHash(input.presentedKey, stored.config.chaveHash)) {
      await auditRefusal({
        tenantId: input.tenantId,
        eventId: event.id,
        reason: 'DIVERGENTE',
        presentedKey: input.presentedKey,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });

      return { ok: false, code: 'INVALID_KEY', reason: 'DIVERGENTE' };
    }

    return { ok: true, eventId: event.id, config: stored.config };
  } catch (error) {
    /**
     * Falha de banco na verificação é fail-closed: a rota responde 401 genérico
     * (o mesmo de chave inválida) e o log guarda a causa. Deixar passar seria
     * abrir a API porque o banco piscou.
     */
    console.error(`[api] falha ao verificar a chave do evento: ${errorMessage(error)}`);

    return { ok: false, code: 'INVALID_KEY', reason: 'DIVERGENTE' };
  }
}
