/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Mascaramento de endereço IP (FASE 110)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MASCARAR NA TRILHA DE AUDITORIA, E NÃO SÓ NO LOG
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `logger` operacional já omitia segredos e mascarava e-mail no stdout, que é
 *  efêmero. A trilha de auditoria (`audit_logs`, `identity_audit_logs`) e os
 *  registros de consentimento vivem anos no banco de dados. Guardar IP exato em
 *  claro permite individualizar a residência ou dispositivo do titular sem
 *  necessidade operacional: truncar IPv4 para `/24` e IPv6 para `/48` preserva o
 *  diagnóstico de rede/ASN/região e evita armazenar dado pessoal direto.
 *
 *  Esta função é pura e idempotente: mascarar um IP já mascarado devolve o mesmo
 *  resultado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

function normalizeCandidateIp(raw: string): string | null {
  const first = raw.split(',')[0]?.trim();
  if (!first) return null;

  // IPv6 com colchetes e porta: `[2001:db8::1]:443`
  if (first.startsWith('[')) {
    const close = first.indexOf(']');
    if (close > 1) return first.slice(1, close).trim();
  }

  // IPv4 com porta: `203.0.113.42:51234` (exatamente 3 pontos e 1 dois-pontos)
  const colonCount = (first.match(/:/g) ?? []).length;
  if (colonCount === 1 && first.includes('.')) {
    return first.slice(0, first.indexOf(':')).trim();
  }

  return first;
}

function maskIpv4(candidate: string): string | null {
  const parts = candidate.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });

  if (octets.some((num) => Number.isNaN(num) || num < 0 || num > 255)) {
    return null;
  }

  return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
}

function expandIpv6Hextets(candidate: string): string[] | null {
  // Remove zone ID se existir (`fe80::1%eth0`)
  const withoutZone = candidate.split('%')[0] ?? '';
  if (!withoutZone.includes(':')) return null;

  const doubleColonParts = withoutZone.split('::');
  if (doubleColonParts.length > 2) return null;

  const leftRaw = doubleColonParts[0] ? doubleColonParts[0].split(':') : [];
  const rightRaw = doubleColonParts[1] ? doubleColonParts[1].split(':') : [];

  // IPv4-mapped IPv6 no final (ex.: `::ffff:203.0.113.42`)
  const lastRight = rightRaw[rightRaw.length - 1];
  if (lastRight && lastRight.includes('.')) {
    const maskedV4 = maskIpv4(lastRight);
    if (!maskedV4) return null;
    const prefix = doubleColonParts.length === 2
      ? `${leftRaw.join(':')}::${rightRaw.slice(0, -1).join(':')}`
      : leftRaw.slice(0, -1).join(':');
    const cleanPrefix = prefix.replace(/:+$/, '');
    return [`__V4MAPPED__${cleanPrefix || '::'}:${maskedV4}`];
  }

  const missing = 8 - (leftRaw.length + rightRaw.length);
  if (doubleColonParts.length === 1 && leftRaw.length !== 8) return null;
  if (doubleColonParts.length === 2 && missing < 1) return null;

  const expanded =
    doubleColonParts.length === 2
      ? [...leftRaw, ...Array<string>(missing).fill('0'), ...rightRaw]
      : leftRaw;

  if (expanded.length !== 8) return null;
  if (expanded.some((hextet) => !/^[0-9a-fA-F]{1,4}$/.test(hextet))) return null;

  return expanded.map((hextet) => hextet.toLowerCase().replace(/^0+/, '') || '0');
}

/**
 * Mascara um endereço IP para prefixo de sub-rede (`/24` em IPv4, `/48` em IPv6).
 *
 * Devolve `null` se a entrada for vazia ou não reconhecida como IP válido — assim
 * um cabeçalho malformado nunca grava texto arbitrário na coluna de IP.
 */
export function maskIpAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  const candidate = normalizeCandidateIp(raw);
  if (!candidate) return null;

  const ipv4 = maskIpv4(candidate);
  if (ipv4) return ipv4;

  const expanded = expandIpv6Hextets(candidate);
  if (!expanded) return null;

  if (expanded.length === 1 && expanded[0]?.startsWith('__V4MAPPED__')) {
    const rawMapped = expanded[0].slice('__V4MAPPED__'.length);
    return rawMapped.startsWith(':::') ? `::${rawMapped.slice(3)}` : rawMapped;
  }

  // `/48`: preserva os 3 primeiros hextetos e zera o restante.
  const prefix = expanded.slice(0, 3);
  if (prefix.every((h) => h === '0')) return '::';
  return `${prefix.join(':')}::`;
}
