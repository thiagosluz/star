import { tenantPath } from '@/domain/tenancy/resolution';

export type CheckinTab = 'balcao' | 'autocredenciamento';
export type CheckinQueueStatusFilter = 'all' | 'pending' | 'inside';

/**
 * Resolve a aba ativa do balcão de credenciamento via query string.
 * Valores desconhecidos caem em `balcao` para preservar a entrada principal da operação.
 */
export function resolveCheckinTab(raw?: string | null): CheckinTab {
  return raw === 'autocredenciamento' ? 'autocredenciamento' : 'balcao';
}

/**
 * Normaliza o filtro rápido da fila manual de participantes.
 */
export function resolveCheckinQueueStatusFilter(raw?: string | null): CheckinQueueStatusFilter {
  if (raw === 'pending' || raw === 'inside') return raw;
  return 'all';
}

/**
 * Constrói a URL canônica do balcão preservando evento, aba e filtros ativos sem vazamento entre abas.
 */
export function buildCheckinHref(input: {
  tenantSlug: string;
  eventId?: string | null;
  tab?: CheckinTab;
  query?: string | null;
  status?: CheckinQueueStatusFilter;
}): string {
  const params = new URLSearchParams();
  if (input.eventId) {
    params.set('evento', input.eventId);
  }
  if (input.tab === 'autocredenciamento') {
    params.set('aba', 'autocredenciamento');
  } else {
    if (input.query?.trim()) {
      params.set('q', input.query.trim());
    }
    if (input.status && input.status !== 'all') {
      params.set('situacao', input.status);
    }
  }

  const qs = params.toString();
  const base = tenantPath(input.tenantSlug, '/credenciamento');
  return qs ? `${base}?${qs}` : base;
}

/**
 * Informa explicitamente quando a fila manual foi truncada pelo limite da consulta.
 */
export function formatQueueTruncationNotice(
  renderedCount: number,
  totalCount: number,
): string | null {
  if (totalCount <= renderedCount) return null;
  return `Mostrando os ${renderedCount} primeiros de ${totalCount} registros — refine pela busca acima.`;
}

/**
 * Resume a política antifraude em uma frase legível para o cabeçalho recolhível de configuração.
 */
export function describeSelfCheckinPolicySummary(input: {
  enabled: boolean;
  hasEventCoordinates: boolean;
  requireGeo: boolean;
  geoRadiusMeters: number;
  blockConcurrentActivity: boolean;
  requireEventArrivalBeforeActivity: boolean;
}): string {
  if (!input.enabled) {
    return 'Autocredenciamento desativado neste evento.';
  }

  const parts: string[] = [];
  if (input.requireGeo) {
    parts.push(
      input.hasEventCoordinates
        ? `GPS ativo (raio ${input.geoRadiusMeters} m)`
        : 'GPS exigido (sem coordenadas salvas)',
    );
  } else {
    parts.push('GPS opcional');
  }

  parts.push(input.blockConcurrentActivity ? 'anti-ubiquidade ON' : 'anti-ubiquidade OFF');
  if (input.requireEventArrivalBeforeActivity) {
    parts.push('exige portaria prévia');
  }

  return parts.join(' · ');
}

export interface CheckinContextSelection {
  kind: 'EVENT' | 'ACTIVITY';
  activityId: string | null;
}

/**
 * Chave canônica do contexto de leitura (`'EVENT'` para portaria ou o UUID da atividade).
 */
export function checkinContextKey(context: CheckinContextSelection): string {
  return context.kind === 'ACTIVITY' && context.activityId ? context.activityId : 'EVENT';
}

/**
 * Descreve o destino ativo na fila manual por nome para que o operador saiba onde a confirmação será gravada.
 */
export function describeManualQueueTarget(input: {
  kind: 'EVENT' | 'ACTIVITY';
  activityTitle?: string | null;
  requiresRegistration?: boolean;
}): {
  badgeLabel: string;
  targetTitle: string;
  helperText: string;
} {
  if (input.kind === 'ACTIVITY' && input.activityTitle) {
    return {
      badgeLabel: 'Atividade',
      targetTitle: `Atividade: ${input.activityTitle}`,
      helperText: input.requiresRegistration
        ? 'Registra frequência nesta atividade (avisa se a pessoa não tiver inscrição prévia nela).'
        : 'Atividade aberta aos inscritos do evento — registra frequência diretamente nesta sessão.',
    };
  }

  return {
    badgeLabel: 'Portaria',
    targetTitle: 'Portaria do evento — registra a chegada',
    helperText: 'O clique abaixo registra a chegada ou saída geral do participante no evento.',
  };
}

/**
 * Resolve o rótulo contextual de vínculo do participante com o alvo ativo (Portaria vs. Atividade).
 */
export function describeParticipantContextEnrollment(input: {
  contextKind: 'EVENT' | 'ACTIVITY';
  activityId: string | null;
  requiresRegistration: boolean;
  hasEventRegistration: boolean;
  registeredActivityIds: readonly string[];
  activityTitles: readonly string[];
  fallbackActivityTitle: string | null;
}): {
  label: string;
  tone: 'neutral' | 'success' | 'warning';
} {
  if (input.contextKind === 'ACTIVITY' && input.activityId) {
    if (input.registeredActivityIds.includes(input.activityId)) {
      return { label: 'Inscrito nesta atividade', tone: 'success' };
    }
    if (!input.requiresRegistration) {
      return { label: 'Atividade aberta do evento', tone: 'neutral' };
    }
    return { label: 'Sem inscrição nesta atividade (presença avulsa)', tone: 'warning' };
  }

  if (input.hasEventRegistration) {
    if (input.activityTitles.length > 0) {
      return {
        label: `evento · +${input.activityTitles.length} atividade(s)`,
        tone: 'neutral',
      };
    }
    return { label: 'evento', tone: 'neutral' };
  }

  if (input.fallbackActivityTitle) {
    return { label: input.fallbackActivityTitle, tone: 'neutral' };
  }

  return { label: 'evento', tone: 'neutral' };
}
