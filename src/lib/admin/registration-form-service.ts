/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — O formulário do evento vira DADO (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM SERVIÇO PRÓPRIO, E NÃO O `catalog-service.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O evento, a sala, a atividade e a trilha vivem no `catalog-service.ts` porque
 *  são CATÁLOGO: existem como linha, com coluna própria. O formulário não existe
 *  como linha — ele é uma chave de `Event.settings` (JSON), como a política de
 *  inscrição da FASE 12. O serviço de um assunto é um arquivo (a casa já faz isso em
 *  `landing-service.ts`, `sponsor-service.ts` e `demand-service.ts`), e o assunto
 *  aqui tem três operações e uma validação próprias.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM CAMINHO DE ESCRITA SÓ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `applyRegistrationFormOperation` é o ÚNICO lugar que grava
 *  `settings.registrationForm`. Ler, decidir, gravar e auditar acontecem na MESMA
 *  transação com contexto de instituição (`withTenant`), e é isso que garante que a
 *  lista lida seja a lista que está sendo reescrita — e que a trilha não registre um
 *  fato que não aconteceu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LEITURA É A TOLERANTE, E A CONFIGURAÇÃO TORTA NÃO TRAVA A TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lista atual vem de `readRegistrationForm` — o leitor que o próprio domínio
 *  entrega, e o MESMO que a página usa. Quando a configuração gravada está inválida
 *  (só um caminho de fora do sistema chega lá: o serviço recusa spec torto), a
 *  leitura devolve a lista VAZIA com os problemas, e a gravação passa a substituir a
 *  configuração inválida pelo que o organizador montar. Isso é anunciado na TELA
 *  antes do gesto ("o que você salvar aqui substitui a configuração inválida") — o
 *  silêncio, aqui, seria apagar em silêncio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import { readRegistrationForm } from '@/domain/events/registration-form-spec-rules';
import {
  applyRegistrationFormOperation,
  describeRegistrationForm,
  type RegistrationFormOperation,
} from '@/lib/admin/registration-form-editing';

export type RegistrationFormErrorCode =
  | 'NOT_FOUND'
  /** O campo declarado não passou pelo validador do domínio. */
  | 'INVALID_FIELD'
  /** A `key` da operação não existe na lista atual. */
  | 'FIELD_NOT_FOUND'
  /** Subir o primeiro (ou descer o último) não muda nada. */
  | 'AT_THE_EDGE'
  | 'INTERNAL';

export type RegistrationFormWriteResult =
  | { ok: true; fields: number; message: string }
  | {
      ok: false;
      code: RegistrationFormErrorCode;
      message: string;
      details?: readonly string[];
    };

/** `settings` é JSON livre: qualquer coisa que não seja objeto é tratada como vazio. */
function settingsObject(settings: unknown): Record<string, unknown> {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return {};

  return settings as Record<string, unknown>;
}

/**
 * Aplica UMA operação sobre o formulário declarado do evento.
 *
 * As três operações (salvar um campo, remover, reordenar) chegam por aqui com a
 * mesma guarda de transação e a mesma entrada de trilha: três caminhos de escrita
 * separados divergiriam no primeiro ajuste — e o modo de falha seria a trilha com
 * buraco justamente no formulário, que é onde o dado pessoal entra.
 */
export async function applyRegistrationFormOperationOnEvent(input: {
  tenantId: string;
  actorId: string;
  eventId: string;
  operation: RegistrationFormOperation;
}): Promise<RegistrationFormWriteResult> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      /** O leitor TOLERANTE do domínio — nunca o JSON cru desta chave. */
      const stored = readRegistrationForm(event.settings);

      const applied = applyRegistrationFormOperation(stored.fields, input.operation);

      if (!applied.ok) {
        return {
          ok: false as const,
          code: applied.code,
          message: applied.message,
          /**
           * As frases são as do DOMÍNIO, uma por problema — a tela do painel exibe
           * esta lista como veio, sem reescrever nem resumir. Quando a recusa não vem
           * do validador (a `key` não existe, o campo já é o primeiro) não há
           * problema de campo a listar, e o `details` fica ausente.
           */
          details: applied.problems?.map((problem) => problem.message),
        };
      }

      /**
       * MERGE, não substituição: `settings` é campo livre e guarda chaves de outras
       * fases (`registrationRequiresMembership`, da FASE 12). Gravar só a chave do
       * formulário apagaria a política de inscrição do evento em silêncio — o mesmo
       * cuidado que o `saveEvent` toma.
       */
      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            ...settingsObject(event.settings),
            registrationForm: applied.fields,
          } as unknown as object,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'event',
          entityId: event.id,
          changes: {
            registrationForm: {
              /**
               * `from` diz a VERDADE quando a configuração gravada estava torta: a
               * leitura tolerante devolveu a lista vazia, e registrar "nenhum campo"
               * faria parecer que o organizador tinha um formulário em branco.
               */
              from:
                stored.problems.length > 0
                  ? 'configuração gravada inválida'
                  : describeRegistrationForm(stored.fields),
              to: describeRegistrationForm(applied.fields),
            },
          },
        },
        tx,
      );

      return { ok: true as const, fields: applied.fields.length, message: applied.message };
    });
  } catch (error) {
    console.error(
      `[admin] falha ao salvar o formulário de inscrição do evento: ${errorMessage(error)}`,
    );

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível salvar o formulário de inscrição.',
    };
  }
}
