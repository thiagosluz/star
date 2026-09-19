/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E-MAIL DE CONTA — a ponte entre o Better Auth e o outbox
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTAS MENSAGENS NÃO TÊM INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Confirmação de e-mail e redefinição de senha acontecem na IDENTIDADE, que é
 *  global: quem pede a redefinição pode não ter vínculo com instituição alguma, e
 *  quem cria conta ainda não tem. Por isso `tenantId` é nulo — a linha do outbox fica
 *  invisível para qualquer instituição (a policy de RLS decide isso, não o código).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTAS FUNÇÕES NUNCA LANÇAM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Elas são chamadas DENTRO do fluxo de autenticação: `sendOnSignUp` roda no meio do
 *  cadastro e `sendResetPassword` no meio do pedido de redefinição. Uma exceção aqui
 *  viraria "não consegui criar conta porque o e-mail falhou" — o oposto do que se
 *  quer. A conta (ou o token) já existe; a mensagem é consequência.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { logger } from '@/lib/observability/logger';
import { queueEmail } from './email-service';

/** Validade do token de verificação, em horas — a MESMA usada no `auth.ts`. */
export const VERIFICATION_TOKEN_HOURS = 24;

/** Validade do token de redefinição, em minutos — a MESMA usada no `auth.ts`. */
export const RESET_TOKEN_MINUTES = 60;

/** Assinatura da plataforma: e-mail de identidade não pertence a instituição. */
const PLATFORM_BRAND = 'EventFlow';

export async function sendAccountEmail(input: {
  template: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  user: { id: string; email: string; name: string };
  url: string;
}): Promise<void> {
  try {
    if (!input.user.email) return;

    const result =
      input.template === 'EMAIL_VERIFICATION'
        ? await queueEmail({
            tenantId: null,
            to: input.user.email,
            toUserId: input.user.id,
            template: 'EMAIL_VERIFICATION',
            brandName: PLATFORM_BRAND,
            // Sem `dedupeKey`: pedir a confirmação de novo DEVE mandar outro e-mail.
            payload: {
              recipientName: input.user.name,
              verifyUrl: input.url,
              expiresInHours: VERIFICATION_TOKEN_HOURS,
            },
          })
        : await queueEmail({
            tenantId: null,
            to: input.user.email,
            toUserId: input.user.id,
            template: 'PASSWORD_RESET',
            brandName: PLATFORM_BRAND,
            payload: {
              recipientName: input.user.name,
              resetUrl: input.url,
              expiresInMinutes: RESET_TOKEN_MINUTES,
            },
          });

    if (!result.ok) {
      logger.warn('e-mail de conta não registrado', {
        template: input.template,
        userId: input.user.id,
        code: result.code,
      });
    }
  } catch (error) {
    logger.error('falha ao preparar e-mail de conta', {
      template: input.template,
      userId: input.user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
