/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Gravar a política de presença do evento (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  UM CAMINHO DE ESCRITA SÓ, E ELE USA O MESMO LEITOR DA EMISSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A política vive em `Event.settings.certificatePolicy` (a mesma casa da política
 *  de inscrição, do formulário e da chave da API). Ler, validar, gravar e auditar
 *  acontecem na MESMA transação: se a gravação falhar, a trilha não registra um
 *  fato que não aconteceu.
 *
 *  A validação é `readCertificatePolicy` — o MESMO leitor que a emissão usa. Isso
 *  não é economia de código: é a garantia de que não existe um valor que a tela
 *  aceite e a emissão recuse (ou o contrário). Se o leitor devolve problema, a
 *  gravação é RECUSADA e a lista de motivos volta para a tela; nenhum campo
 *  inválido chega ao banco por este caminho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MERGE, NÃO SUBSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `settings` é campo livre e guarda chaves de outras fases
 *  (`registrationRequiresMembership`, `registrationForm`, `api`). Escrever só a
 *  chave nova apagaria as demais em silêncio — o mesmo cuidado que o `saveEvent`
 *  (FASE 68) e o formulário do organizador (FASE 70) tomam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { recordAudit } from '@/lib/admin/audit';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  readCertificatePolicy,
  type CertificatePolicy,
} from '@/domain/certificates/certificate-policy-rules';

export type CertificatePolicyErrorCode =
  | 'NOT_FOUND'
  /** O valor enviado não passou pelo leitor do domínio (ver `details`). */
  | 'INVALID_POLICY'
  | 'INTERNAL';

export type CertificatePolicyWriteResult =
  | { ok: true; policy: CertificatePolicy }
  | {
      ok: false;
      code: CertificatePolicyErrorCode;
      message: string;
      details?: readonly string[];
    };

/** `settings` é JSON livre: qualquer coisa que não seja objeto é tratada como vazio. */
function settingsObject(settings: unknown): Record<string, unknown> {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return {};

  return settings as Record<string, unknown>;
}

/**
 * Grava a política de presença do evento.
 *
 * O chamador (Server Action) já autorizou `event:manage`; aqui a pergunta é só de
 * NEGÓCIO: o valor é válido e o evento é desta instituição?
 */
export async function saveCertificatePolicy(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  policy: CertificatePolicy;
}): Promise<CertificatePolicyWriteResult> {
  /**
   * A validação vem ANTES da transação de propósito: um valor recusado não abre
   * transação nem toca no banco. A mensagem é a do domínio, uma por problema.
   */
  const read = readCertificatePolicy({ certificatePolicy: input.policy });

  if (read.problems.length > 0) {
    return {
      ok: false as const,
      code: 'INVALID_POLICY' as const,
      message: 'A política de presença foi recusada. Corrija os valores indicados.',
      details: read.problems,
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, settings: true },
      });

      if (!event) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Evento não encontrado.' };
      }

      const previousSettings = settingsObject(event.settings);

      await tx.event.update({
        where: { id: event.id },
        data: {
          settings: {
            ...previousSettings,
            certificatePolicy: read.policy,
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
            certificatePolicy: {
              from: previousSettings.certificatePolicy ?? null,
              to: read.policy,
            },
          },
        },
        tx,
      );

      return { ok: true as const, policy: read.policy };
    });
  } catch (error) {
    console.error(`[certificates] falha ao gravar a política de presença: ${errorMessage(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível gravar a política de presença agora.',
    };
  }
}
