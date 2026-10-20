/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Métricas Agregadas e Formatação da Vitrine (FASE 71 · ADR-352)
 *
 *  Regras puras para exibição agregada e anônima de estatísticas da plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface PlatformMetricsSummary {
  readonly totalTenants: number;
  readonly totalEvents: number;
  readonly totalRegistrations: number;
  readonly totalCertificates: number;
}

/** Formata contagens de forma compacta e convidativa para a Landing Page (ex.: "1.2k+", "450+"). */
export function formatMetricCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) {
    return '0';
  }

  if (count >= 1_000_000) {
    const formatted = (count / 1_000_000).toFixed(1).replace('.0', '');
    return `${formatted}M+`;
  }

  if (count >= 1_000) {
    const formatted = (count / 1_000).toFixed(1).replace('.0', '');
    return `${formatted}k+`;
  }

  return `${count}+`;
}

/**
 * Formata carga horária total cumprida a partir de contagem estimada de horas.
 */
export function formatWorkHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) {
    return '0h';
  }
  if (hours >= 1_000) {
    const formatted = (hours / 1_000).toFixed(1).replace('.0', '');
    return `+${formatted}k horas`;
  }
  return `+${hours} horas`;
}
