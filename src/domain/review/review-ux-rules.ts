/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — UX do Comitê Científico, Chamadas e Pareceres (FASE 137)
 *
 *  Regras puras (sem Prisma nem Next) para a Onda 3:
 *    1. Rótulos humanos em português para enums que vazavam em inglês no comitê
 *       (`RECOMMENDATION_LABELS`, `ASSIGNMENT_STATUS_LABELS`, `SUBMISSION_STATUS_LABELS`);
 *    2. Tom semântico de status da submissão (`submissionStatusTone`);
 *    3. Contagem de palavras-chave válidas no formulário público (`countProposalKeywords`);
 *    4. Orientação contextual por tipo de chamada (`describeProposalKindDefaults`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ProposalKind } from '@/domain/proposals/call-rules';

export const RECOMMENDATION_LABELS: Readonly<Record<string, string>> = {
  ACCEPT: 'Aceitar',
  MINOR_REVISION: 'Aceitar com revisões menores',
  MAJOR_REVISION: 'Revisões maiores',
  REJECT: 'Rejeitar',
};

export function formatRecommendationLabel(value: string): string {
  return RECOMMENDATION_LABELS[value] ?? value;
}

export const ASSIGNMENT_STATUS_LABELS: Readonly<Record<string, string>> = {
  ASSIGNED: 'Atribuído',
  IN_PROGRESS: 'Em andamento',
  SUBMITTED: 'Parecer enviado',
  DECLINED: 'Recusado',
};

export function formatAssignmentStatusLabel(value: string): string {
  return ASSIGNMENT_STATUS_LABELS[value] ?? value;
}

export const SUBMISSION_STATUS_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Rascunho',
  SUBMITTED: 'Aguardando atribuição',
  UNDER_REVIEW: 'Em avaliação',
  REVISION_REQUESTED: 'Revisão solicitada',
  ACCEPTED: 'Aceita',
  REJECTED: 'Rejeitada',
  WITHDRAWN: 'Retirada',
  CANCELED: 'Cancelada',
};

export function formatSubmissionStatusLabel(status: string): string {
  return SUBMISSION_STATUS_LABELS[status] ?? status;
}

export type SubmissionStatusTone = 'success' | 'warning' | 'info' | 'destructive' | 'neutral';

export function submissionStatusTone(status: string): SubmissionStatusTone {
  switch (status) {
    case 'ACCEPTED':
      return 'success';
    case 'UNDER_REVIEW':
    case 'REVISION_REQUESTED':
      return 'warning';
    case 'SUBMITTED':
      return 'info';
    case 'REJECTED':
      return 'destructive';
    default:
      return 'neutral';
  }
}

/**
 * Conta palavras-chave distintas separadas por vírgula, espelhando a validação
 * do motor de submissões sem depender de regex pesada.
 */
export function countProposalKeywords(raw: string): number {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const normalized = part.trim().toLowerCase();
    if (normalized.length > 0) {
      seen.add(normalized);
    }
  }
  return seen.size;
}

export function describeProposalKindDefaults(kind: ProposalKind): string {
  if (kind === 'PAPER' || kind === 'POSTER') {
    return 'Chamada científica: revisão cega por padrão, PDF anonimizado recomendado e vínculo com trilha para afinidade dos revisores.';
  }
  return 'Chamada de atividade/palestra: revisão aberta por padrão e trilha opcional — ideal para convidar palestrantes, minicursos e oficinas.';
}
