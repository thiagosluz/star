/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — A ELIMINAÇÃO DAS RESPOSTAS DO FORMULÁRIO (FASE 70 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE SERVIÇO FAZ — E O QUE ELE NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa apaga as RESPOSTAS que deu no formulário do organizador **sem cancelar a
 *  inscrição**. A vaga continua reservada, o histórico continua vivo, o certificado
 *  continua emissível: o que sai é o CONTEÚDO PESSOAL, não o FATO de ela estar
 *  inscrita.
 *
 *  Hoje cancelar é `status = 'CANCELED'` e as respostas FICAM (`registration-service`)
 *  — quer dizer: não existia caminho nenhum para apagar o que a pessoa escreveu sem
 *  perder junto a vaga, o XP, o certificado e a presença. Este é esse caminho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A POSSE VEM DA SESSÃO, E O `where` É QUEM A GARANTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `userId` é PARÂMETRO da função e é a SESSÃO que o fornece (na action, de
 *  `context.userId`) — nunca um campo de formulário. Aqui ele entra em TODAS as
 *  consultas: a leitura da inscrição, o `UPDATE` e a trilha. Um pedido que nomeie
 *  outra pessoa não tem por onde nomeá-la: não existe campo de alvo. Quem não tem
 *  inscrição viva naquele evento recebe `NOT_REGISTERED` — o mesmo código e o mesmo
 *  texto da porta de "completar meus dados" (`updateEventRegistrationData`), porque
 *  as duas respondem à pergunta "esta pessoa tem inscrição para mexer?".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VARREDURA É DE TODAS AS LINHAS DA PESSOA NAQUELE EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição no EVENTO é a dona do formulário, mas as necessidades de acessibilidade
 *  são COPIADAS para as linhas das atividades abertas no ato da inscrição
 *  (`enrollEventRegistrationInOpenActivities`). Apagar só a linha do evento deixaria a
 *  cópia viva na linha da atividade — e a pessoa, que pediu para apagar, teria o texto
 *  dela guardado num lugar que ela não vê. O escopo é o par (evento, pessoa), que é
 *  exatamente o que a frase "apagar as minhas respostas NAQUELE evento" promete.
 */
import { withTenant } from '@/lib/db/tenant-client';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import { registrationIsLive, type RegistrationStatus } from '@/domain/events/registration-rules';
import { erasePersonalFormResponses } from '@/domain/events/registration-form-spec-rules';

export type EraseMyFormResponsesErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'NOT_REGISTERED'
  | 'INTERNAL';

export type EraseMyFormResponsesOutcome =
  | {
      ok: true;
      registrationId: string;
      /** As chaves que saíram do depósito, na ordem em que estavam. */
      removedKeys: readonly string[];
      /** As linhas em que a nota de acessibilidade foi limpa (evento + atividades). */
      clearedAccessibilityNotes: number;
      /** `false` = não havia nada a apagar; o pedido é idempotente. */
      erased: boolean;
    }
  | { ok: false; code: EraseMyFormResponsesErrorCode; message: string };

/**
 * Apaga as respostas da PRÓPRIA pessoa naquele evento.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A IDEMPOTÊNCIA É POR LEITURA, E NÃO POR CONFIANÇA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Apagar duas vezes tem de mudar NADA — nem no dado, nem na resposta. O serviço
 *  compara o que existe com o que ficaria ANTES de escrever: sem isso, a segunda
 *  chamada reescreveria o mesmo JSON e registraria na trilha um fato que não aconteceu
 *  (a mesma mentira que o serviço do formulário evita ao recusar o movimento nas
 *  pontas da lista).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TRILHA GUARDA O ATO E AS CHAVES — NUNCA OS VALORES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A eliminação é ato sobre dado pessoal, e é isso que a trilha precisa provar: quem
 *  pediu, quando, em que inscrição, e QUANTOS/QUAIS campos saíram. Copiar os valores
 *  para `audit_logs` seria transferir o dado pessoal para uma tabela que a instituição
 *  lê por outro caminho — o oposto do pedido. As chaves são identificadores escolhidos
 *  pelo organizador (configuração, não dado).
 *
 *  A entrada é gravada mesmo quando não havia nada a apagar, com "nada a apagar" no
 *  lugar: o PEDIDO é um fato auditável (é o que responde "a pessoa pediu e o sistema
 *  atendeu?"), e uma trilha que só registra o que mudou não conseguiria distinguir
 *  "não pediu" de "pediu e já estava apagado".
 */
export async function eraseMyFormResponses(input: {
  tenantId: string;
  userId: string;
  eventSlug: string;
}): Promise<EraseMyFormResponsesOutcome> {
  const { tenantId, userId, eventSlug } = input;

  try {
    return await withTenant(tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { slug: eventSlug, deletedAt: null },
        select: { id: true, title: true },
      });

      if (!event) {
        throw new RegistrationResponseError('EVENT_NOT_FOUND', 'Evento não encontrado.');
      }

      /**
       * A inscrição do EVENTO é a dona do formulário — e é ela que diz que a pessoa
       * está inscrita. Sem ela, não há resposta a apagar (as linhas de atividade não
       * recebem `formResponses`), e a resposta é a mesma da porta de completar dados.
       */
      const eventRegistration = await tx.registration.findFirst({
        where: { eventId: event.id, userId, activityId: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, formResponses: true },
      });

      if (
        !eventRegistration ||
        !registrationIsLive(eventRegistration.status as RegistrationStatus)
      ) {
        throw new RegistrationResponseError(
          'NOT_REGISTERED',
          'Você não tem inscrição ativa neste evento — não há respostas suas para apagar.',
        );
      }

      const { kept, removedKeys } = erasePersonalFormResponses(eventRegistration.formResponses);

      /** As linhas da pessoa neste evento: a do evento e as das atividades dela. */
      const lines = await tx.registration.findMany({
        where: { eventId: event.id, userId, deletedAt: null },
        select: { id: true, activityId: true, accessibilityNotes: true },
      });

      const withNotes = lines.filter((line) => line.accessibilityNotes !== null);

      if (removedKeys.length === 0 && withNotes.length === 0) {
        await recordAudit(
          {
            tenantId,
            userId,
            action: 'DELETE',
            entityType: 'registration',
            entityId: eventRegistration.id,
            changes: {
              evento: { from: null, to: event.title },
              respostas: { from: null, to: 'nada a apagar' },
            },
          },
          tx,
        );

        return {
          ok: true as const,
          registrationId: eventRegistration.id,
          removedKeys: [],
          clearedAccessibilityNotes: 0,
          erased: false,
        };
      }

      await tx.registration.update({
        where: { id: eventRegistration.id },
        data: { formResponses: kept as object },
      });

      /**
       * A NOTA DE ACESSIBILIDADE SAI JUNTO, e a decisão é deliberada: ela é dado
       * pessoal da MESMA família que a fase chama de sensível (o campo pede
       * "necessidades de acessibilidade **ou restrições alimentares**", e restrição
       * alimentar é dado de saúde). Mantê-la faria a tela prometer "apaguei as suas
       * respostas" e guardar justamente a mais sensível delas. O que a operação perde
       * é a logística de acessibilidade daquela pessoa — e é isso que uma eliminação
       * pedida por ela significa.
       */
      if (withNotes.length > 0) {
        await tx.registration.updateMany({
          where: { id: { in: withNotes.map((line) => line.id) } },
          data: { accessibilityNotes: null },
        });
      }

      await recordAudit(
        {
          tenantId,
          userId,
          action: 'DELETE',
          entityType: 'registration',
          entityId: eventRegistration.id,
          changes: {
            evento: { from: null, to: event.title },
            respostas: {
              from: `${removedKeys.length} campo(s)`,
              to: 'apagadas',
            },
            /** As CHAVES, não os valores: a trilha não copia dado pessoal. */
            ...(removedKeys.length > 0
              ? { campos: { from: null, to: removedKeys.join(', ') } }
              : {}),
            ...(withNotes.length > 0
              ? { acessibilidade: { from: 'preenchida', to: 'apagada' } }
              : {}),
          },
        },
        tx,
      );

      return {
        ok: true as const,
        registrationId: eventRegistration.id,
        removedKeys,
        clearedAccessibilityNotes: withNotes.length,
        erased: true,
      };
    });
  } catch (error) {
    if (error instanceof RegistrationResponseError) {
      return { ok: false, code: error.code, message: error.message };
    }

    console.error(
      `[inscricoes] falha ao apagar as respostas do formulário: ${errorMessage(error)}`,
    );

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível apagar as suas respostas agora. Tente novamente.',
    };
  }
}

/** Erro de negócio com código — o mesmo desenho dos outros serviços de inscrição. */
class RegistrationResponseError extends Error {
  constructor(
    readonly code: EraseMyFormResponsesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RegistrationResponseError';
  }
}
