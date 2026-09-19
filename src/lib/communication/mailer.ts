/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MAILER — a fronteira com o provedor
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O SDK DO RESEND É IMPORTADO DINAMICAMENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este módulo é alcançado pelo caminho de uma Server Action (o envio inline,
 *  quando a fila está fora do ar). Um `import` no topo colocaria o SDK no bundle do
 *  servidor em toda rota que toca comunicação — inclusive nas que nunca enviam
 *  e-mail. O `await import('resend')` acontece DENTRO do driver, no primeiro envio
 *  real: a dependência custa o que ela é usada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO **NÃO** FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não grava no outbox, não decide template e não conhece tenant. Ele recebe uma
 *  mensagem pronta (`subject`/`html`/`text`) e devolve sucesso ou um motivo de
 *  falha CLASSIFICADO (`retryable`) — a decisão de retentar é de quem chamou,
 *  porque só lá se sabe se o fato ainda importa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { logger } from '@/lib/observability/logger';
import {
  isRetryableDeliveryError,
  maskEmailAddress,
  resolveEmailDriver,
  type EmailDriver,
} from '@/domain/communication/email-rules';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Chave de idempotência repassada ao provedor (mesmo fato ⇒ uma entrega). */
  idempotencyKey?: string;
}

export interface DeliverySuccess {
  ok: true;
  driver: EmailDriver;
  providerId: string | null;
}

export interface DeliveryFailure {
  ok: false;
  driver: EmailDriver;
  code: 'EMAIL_NOT_CONFIGURED' | 'PROVIDER_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'INVALID_RECIPIENT';
  message: string;
  /** Vale nova tentativa? A resposta é o que separa falha de rede de chave errada. */
  retryable: boolean;
}

export type DeliveryResult = DeliverySuccess | DeliveryFailure;

/** Driver efetivo do processo (ver a ordem das regras em `email-rules.ts`). */
export function currentEmailDriver(): EmailDriver {
  return resolveEmailDriver({
    EMAIL_DRIVER: process.env.EMAIL_DRIVER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
}

/** Remetente único da plataforma. O nome da instituição vai no assunto e no corpo. */
export function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || 'EventFlow <nao-responda@eventflow.test>';
}

function replyToAddress(): string | null {
  const value = process.env.EMAIL_REPLY_TO?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Envia a mensagem pelo driver efetivo.
 *
 * Nunca lança: falha de e-mail não pode derrubar a ação que a originou (mesma
 * regra da gamificação — invariante nº 8). Quem chama decide o que fazer com o
 * resultado.
 */
export async function sendEmail(message: OutgoingEmail): Promise<DeliveryResult> {
  const driver = currentEmailDriver();

  if (driver === 'log') return sendWithLogDriver(message);

  return sendWithResend(message);
}

/**
 * Driver `log`: registra e NÃO envia.
 *
 * Não é um stub de teste — é o modo de operação quando não há provedor
 * configurado. O outbox guarda a mensagem inteira, e a caixa de saída da
 * instituição mostra o que teria saído. É o que permite desenvolver e testar o
 * fluxo de ponta a ponta sem disparar e-mail para endereço de pessoa real.
 */
function sendWithLogDriver(message: OutgoingEmail): DeliveryResult {
  logger.info('email: driver log (mensagem registrada, sem envio externo)', {
    to: maskEmailAddress(message.to),
    subject: message.subject,
    bytes: message.html.length,
  });

  return { ok: true, driver: 'log', providerId: null };
}

async function sendWithResend(message: OutgoingEmail): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    /**
     * `EMAIL_DRIVER=resend` sem chave é erro de configuração — e a resposta certa é
     * FALHAR com o motivo escrito, não cair para `log` em silêncio: cair para `log`
     * faria o operador acreditar que os e-mails estão saindo.
     */
    return {
      ok: false,
      driver: 'resend',
      code: 'EMAIL_NOT_CONFIGURED',
      message: 'RESEND_API_KEY ausente: o envio pelo Resend não está configurado.',
      retryable: false,
    };
  }

  try {
    const { Resend } = await import('resend');
    const client = new Resend(apiKey);

    const response = await client.emails.send(
      {
        from: emailFromAddress(),
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyToAddress() ? { replyTo: replyToAddress() as string } : {}),
      },
      message.idempotencyKey ? { idempotencyKey: message.idempotencyKey } : undefined,
    );

    if (response.error) {
      const status = (response.error as { statusCode?: number }).statusCode ?? null;
      const text = `${response.error.name}: ${response.error.message}`;

      /**
       * Resend responde 403 para chave inválida e 422 para remetente não
       * verificado. Nenhum dos dois melhora com retry; 429 e 5xx melhoram.
       */
      const retryable = isRetryableDeliveryError(status, text);

      return {
        ok: false,
        driver: 'resend',
        code: retryable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
        message: text.slice(0, 400),
        retryable,
      };
    }

    return { ok: true, driver: 'resend', providerId: response.data?.id ?? null };
  } catch (error) {
    const text = error instanceof Error ? error.message : 'erro desconhecido';

    // Exceção aqui é rede/DNS/timeout: o SDK só lança quando não houve resposta.
    return {
      ok: false,
      driver: 'resend',
      code: 'PROVIDER_UNAVAILABLE',
      message: `Falha de rede ao falar com o Resend: ${text}`.slice(0, 400),
      retryable: true,
    };
  }
}
