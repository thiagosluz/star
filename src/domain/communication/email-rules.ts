/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  REGRAS DE ENVIO — decisões puras sobre driver, destinatário e retentativa
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PADRÃO DO DRIVER É A DECISÃO MAIS IMPORTANTE DESTE ARQUIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um sistema de e-mail mal configurado que ENVIA é pior do que um que não envia:
 *  mensagem real para endereço de pessoa real, sem ninguém esperando por ela, e sem
 *  como desfazer. Por isso a escolha segue esta ordem:
 *
 *    1. `EMAIL_DRIVER` explícito manda (é o que o operador decidiu);
 *    2. sem ele, `resend` SOMENTE em produção E com `RESEND_API_KEY` presente;
 *    3. em qualquer outro caso, `log` — grava no outbox, não sai da máquina.
 *
 *  O driver `log` não é um mock de teste: é um modo de operação legítimo (dev,
 *  demonstração, suíte E2E) em que o e-mail existe, fica registrado e pode ser lido
 *  na caixa de saída da instituição — exatamente o que se quer quando não há
 *  provedor configurado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { roleLabel } from '@/domain/rbac/permissions';

export const EMAIL_DRIVERS = ['resend', 'log'] as const;
export type EmailDriver = (typeof EMAIL_DRIVERS)[number];

export const EMAIL_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type EmailStatusValue = (typeof EMAIL_STATUSES)[number];

export const EMAIL_STATUS_LABELS: Record<EmailStatusValue, string> = {
  QUEUED: 'Na fila',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  SKIPPED: 'Não enviado',
};

export function emailStatusLabel(status: string): string {
  return EMAIL_STATUS_LABELS[status as EmailStatusValue] ?? status;
}

export interface EmailEnvironment {
  EMAIL_DRIVER?: string | undefined;
  RESEND_API_KEY?: string | undefined;
  NODE_ENV?: string | undefined;
}

/**
 * Driver efetivo. Ver o bloco acima para a ordem das regras — e note que
 * `EMAIL_DRIVER=resend` sem chave NÃO cai para `log`: a inconsistência é do
 * operador, e o envio falha com motivo escrito (`EMAIL_NOT_CONFIGURED`) em vez de
 * fingir que enviou.
 */
export function resolveEmailDriver(env: EmailEnvironment): EmailDriver {
  const declared = (env.EMAIL_DRIVER ?? '').trim().toLowerCase();

  if (declared === 'resend' || declared === 'log') return declared;

  const hasKey = Boolean((env.RESEND_API_KEY ?? '').trim());

  return env.NODE_ENV === 'production' && hasKey ? 'resend' : 'log';
}

/** O driver escolhido consegue entregar de verdade? */
export function isEmailDeliveryConfigured(env: EmailEnvironment): boolean {
  return resolveEmailDriver(env) === 'resend' && Boolean((env.RESEND_API_KEY ?? '').trim());
}

/**
 * Mascara o endereço para exibição em tela de leitura ampla.
 *
 * A caixa de saída mostra para QUEM foi — e `ana@example.test` é dado pessoal de
 * terceiro. O domínio fica (é o que identifica a instituição de origem) e a parte
 * local é reduzida: `an***@example.test`.
 */
export function maskEmailAddress(address: string): string {
  const [local = '', domain] = address.split('@');

  if (!domain) return '***';

  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

/** Normaliza endereço para comparação e gravação (minúsculas, sem espaços). */
export function normalizeEmailAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Endereço plausível? Deliberadamente frouxo (`algo@algo.algo`): quem valida
 * e-mail de verdade é o envio, e recusar endereço exótico mas válido é pior do que
 * aceitar e deixar a mensagem falhar com motivo.
 */
export function isPlausibleEmailAddress(address: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmailAddress(address));
}

/**
 * O erro do provedor merece nova tentativa?
 *
 * Chave inválida, remetente não verificado e endereço inexistente não melhoram com
 * retry — insistir só gasta cota e polui o log. Erro de rede, limite de taxa e 5xx
 * do provedor são transitórios e o BullMQ reentrega com backoff.
 */
export function isRetryableDeliveryError(status: number | null, message: string): boolean {
  if (status === null) return true; // falha de rede/timeout: transitória por natureza
  if (status === 429) return true;
  if (status >= 500) return true;

  const text = message.toLowerCase();

  return (
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('rate limit') ||
    text.includes('temporarily')
  );
}

/**
 * O remetente é o do MODO DE TESTE do Resend?
 *
 * Enquanto não existe domínio verificado, o Resend só aceita `onboarding@resend.dev`
 * como remetente — e só ENTREGA para o endereço dono da conta. Reconhecer o remetente
 * de teste permite AVISAR isso na tela, em vez de deixar o operador descobrir por um
 * "Falhou" sem explicação (o provedor devolve 403 com uma mensagem em inglês sobre
 * verificar domínio).
 */
export function isSandboxSender(from: string): boolean {
  return from.toLowerCase().includes('resend.dev');
}

/**
 * Rótulo do papel no convite de equipe.
 *
 * Vem do RBAC desde a FASE 21 (`ROLE_LABELS`): o rótulo é do PAPEL, e a tela de
 * equipe usa o mesmo texto nas caixas de seleção. Mantido como apelido porque o
 * convite é o único lugar que fala de "papel de quem foi convidado".
 */
export const invitationRoleLabel = roleLabel;
