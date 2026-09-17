/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LOG ESTRUTURADO (FASE 13)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO CONTINUAR COM `console.error` SOLTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Havia 65 chamadas de `console.*` espalhadas, cada uma com um formato próprio:
 *  impossível agregar ("quantos erros de fila hoje?"), impossível filtrar por
 *  instituição e — o risco real — impossível garantir que dado pessoal não vaze
 *  para o log. O log passa a ser um OBJETO com campos fixos.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE NUNCA ENTRA NO LOG
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Senha, token, cookie, assinatura e o corpo de um documento. Chaves com esses
 *  nomes são substituídas por `[omitido]` em QUALQUER profundidade, e e-mail vira
 *  `a***@dominio` — o suficiente para correlacionar, insuficiente para identificar.
 *  Isso é o mesmo princípio da trilha de auditoria (`sanitizeChanges`), aplicado ao
 *  log operacional: quem lê o log de produção não deve aprender quem são as pessoas.
 *
 *  Em desenvolvimento a saída é legível (uma linha por evento); em produção é JSON
 *  de uma linha, que é o que coletores de log consomem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  /** Identificador da requisição/job — correlaciona as linhas de um mesmo fluxo. */
  requestId?: string;
  tenantId?: string;
  userId?: string;
  [key: string]: unknown;
}

/** Chaves que nunca aparecem com valor real, em qualquer profundidade. */
const FORBIDDEN_KEY = /pass|secret|token|cookie|authorization|signature|hmac|apikey|nonce/i;

/** Campos que identificam pessoa: mascarados, não omitidos. */
const PERSONAL_KEY = /email|document|cpf|phone|telefone/i;

const REDACTED = '[omitido]';

/** `ana.souza@ufba.br` → `a***@ufba.br` (dá para investigar, não para identificar). */
export function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return REDACTED;

  return `${value[0]}***${value.slice(at)}`;
}

export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[profundo]';

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) {
        result[key] = REDACTED;
        continue;
      }

      if (PERSONAL_KEY.test(key) && typeof item === 'string') {
        result[key] = maskEmail(item);
        continue;
      }

      result[key] = sanitizeLogValue(item, depth + 1);
    }

    return result;
  }

  return value;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const sanitized = sanitizeLogValue(fields) as Record<string, unknown>;
  const timestamp = new Date().toISOString();

  if (isProduction()) {
    const payload = JSON.stringify({ timestamp, level, event, ...sanitized });
    // Uma linha por evento, no stdout: é o formato que coletor de log consome.
    process.stdout.write(`${payload}\n`);
    return;
  }

  const details = Object.entries(sanitized)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');

  const line = `[${level}] ${event}${details ? ` ${details}` : ''}`;

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => {
    if (isProduction() && process.env.LOG_LEVEL !== 'debug') return;
    write('debug', event, fields);
  },
  info: (event: string, fields?: LogFields) => write('info', event, fields),
  warn: (event: string, fields?: LogFields) => write('warn', event, fields),
  error: (event: string, fields?: LogFields) => write('error', event, fields),
};

/** Logger com contexto fixo — evita repetir `tenantId` em cada linha do fluxo. */
export function withLogContext(base: LogFields) {
  return {
    debug: (event: string, fields?: LogFields) => logger.debug(event, { ...base, ...fields }),
    info: (event: string, fields?: LogFields) => logger.info(event, { ...base, ...fields }),
    warn: (event: string, fields?: LogFields) => logger.warn(event, { ...base, ...fields }),
    error: (event: string, fields?: LogFields) => logger.error(event, { ...base, ...fields }),
  };
}
