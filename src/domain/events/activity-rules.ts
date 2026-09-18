/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Atividades: rótulos, abertura de inscrição e exclusão
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (revisão da FASE 3)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três problemas resolvidos aqui, todos com a mesma raiz — regra de produto
 *  espalhada pela interface:
 *
 *    1. **Rótulo em inglês na tela.** Os nomes dos tipos (`LECTURE`, `ROUND_TABLE`,
 *       `MINI_COURSE`) são o enum do BANCO, e vazaram para o painel do evento. O
 *       mapa de tradução existia em QUATRO arquivos de tela — e faltava justamente
 *       onde o organizador mais lê (a lista da programação). Agora há um mapa só,
 *       no domínio, e um teste que exige rótulo para TODO valor do enum.
 *
 *    2. **Inscrição individual obrigatória para tudo.** Uma palestra de abertura não
 *       tem (nem deveria ter) lista de inscritos: o público do evento é o público
 *       dela. O tipo define um PADRÃO (`defaultRequiresRegistration`), e a
 *       instituição pode ajustar por atividade — o padrão é conveniência, a decisão
 *       é da organização.
 *
 *    3. **Excluir atividade com gente inscrita.** Apagar levaria junto inscrições e
 *       presenças — e com elas o registro que sustenta certificado e XP. A regra
 *       abaixo RECUSA e diz o que fazer no lugar (cancelar).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type ActivityType =
  | 'LECTURE'
  | 'MINI_COURSE'
  | 'WORKSHOP'
  | 'ROUND_TABLE'
  | 'HACKATHON'
  | 'POSTER_SESSION'
  | 'ORAL_PRESENTATION'
  | 'CULTURAL'
  | 'OTHER';

export type ActivityStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'FULL'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELED';

/**
 * Rótulos de tipo — português do Brasil, e o ÚNICO lugar onde eles moram.
 *
 * `Record<ActivityType, string>` (e não `Record<string, string>`) é deliberado: ao
 * acrescentar um valor ao enum, o compilador exige o rótulo. Um tipo novo sem
 * tradução não compila — em vez de aparecer `SOME_NEW_TYPE` na cara do organizador.
 */
export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  LECTURE: 'Palestra',
  MINI_COURSE: 'Minicurso',
  WORKSHOP: 'Oficina',
  ROUND_TABLE: 'Mesa-redonda',
  HACKATHON: 'Maratona',
  POSTER_SESSION: 'Sessão de pôsteres',
  ORAL_PRESENTATION: 'Apresentação oral',
  CULTURAL: 'Atividade cultural',
  OTHER: 'Outra atividade',
};

export const ACTIVITY_STATUS_LABELS: Record<ActivityStatus, string> = {
  DRAFT: 'Rascunho',
  SCHEDULED: 'Programada',
  FULL: 'Lotada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELED: 'Cancelada',
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[];
export const ACTIVITY_STATUSES = Object.keys(ACTIVITY_STATUS_LABELS) as ActivityStatus[];

/** Rótulo do tipo, tolerante a valor desconhecido vindo do banco. */
export function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABELS[type as ActivityType] ?? 'Atividade';
}

/** Rótulo da situação, tolerante a valor desconhecido vindo do banco. */
export function activityStatusLabel(status: string): string {
  return ACTIVITY_STATUS_LABELS[status as ActivityStatus] ?? status;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Inscrição individual — padrão por tipo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Tipos que, por natureza, NÃO têm público próprio.
 *
 * A lista é a das atividades ABERTAS (o caso novo), e não a das que exigem
 * inscrição — a diferença importa para o valor desconhecido: um tipo que não está
 * aqui exige inscrição. Se o enum ganhar um valor novo e esta lista não for
 * atualizada, o resultado é a atividade continuar pedindo inscrição individual (o
 * comportamento de sempre); o contrário liberaria a entrada de todo mundo numa
 * atividade que talvez tenha turma e material contados.
 */
const TYPES_WITHOUT_OWN_REGISTRATION: readonly ActivityType[] = [
  'LECTURE',
  'ROUND_TABLE',
  'POSTER_SESSION',
  'ORAL_PRESENTATION',
  'CULTURAL',
  'OTHER',
];

/**
 * O tipo exige inscrição individual por PADRÃO?
 *
 * Padrão, não destino: a instituição pode marcar qualquer atividade como aberta (ou
 * exigir inscrição numa palestra com lugar limitado). O banco guarda a decisão
 * final em `Activity.requiresRegistration`.
 */
export function defaultRequiresRegistration(type: ActivityType | string): boolean {
  return !TYPES_WITHOUT_OWN_REGISTRATION.includes(type as ActivityType);
}

/**
 * A atividade é ABERTA a todos os inscritos no evento?
 *
 * Aberta significa três coisas, e as três juntas:
 *   • não recebe inscrição individual (a tela não oferece o formulário);
 *   • quem se inscreve no EVENTO entra nela automaticamente;
 *   • vagas e lista de espera não são aplicadas — o número na tela é informativo,
 *     porque o público é o do evento.
 */
export function isOpenActivity(input: { requiresRegistration: boolean }): boolean {
  return !input.requiresRegistration;
}

/**
 * A atividade aceita receber os inscritos do evento automaticamente?
 *
 * Cancelada não recebe ninguém — inscrever alguém numa atividade cancelada seria
 * criar uma inscrição que a organização já decidiu não realizar. Os demais estados
 * (inclusive rascunho) NÃO filtram: a inscrição no evento é do evento, e a
 * programação pode ser publicada depois. Filtrar por situação aqui faria a pessoa
 * ficar de fora de uma atividade só porque ela foi cadastrada mais tarde.
 */
export function acceptsAutoEnrollment(input: {
  requiresRegistration: boolean;
  status: ActivityStatus | string;
}): boolean {
  if (!isOpenActivity(input)) return false;
  return input.status !== 'CANCELED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão de atividade
// ───────────────────────────────────────────────────────────────────────────────
export interface ActivityDeletionInput {
  title: string;
  /** Inscrições vivas (PENDING/CONFIRMED/WAITLISTED/ATTENDED). */
  liveRegistrations: number;
  /** Presenças registradas (credenciamento). */
  attendances: number;
}

export type ActivityDeletionVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'HAS_REGISTRATIONS' | 'HAS_ATTENDANCE'; message: string };

/**
 * A atividade pode ser EXCLUÍDA?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE RECUSAR, E NÃO EXCLUIR EM CASCATA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `onDelete: Cascade` no schema tornaria a exclusão fácil — e destruiria registro
 *  científico: a presença que sustenta a carga horária do certificado, o XP da
 *  atividade e a própria lista de quem estava lá. "Excluir" é para a atividade que
 *  não chegou a existir na prática (cadastrada errada, duplicada); a que já tem
 *  gente é CANCELADA, que preserva tudo e diz na agenda que não aconteceu.
 *
 *  A mensagem diz QUANTOS e O QUE FAZER — negar sem explicar faz o organizador
 *  tentar de novo achando que foi falha do sistema.
 */
export function canDeleteActivity(input: ActivityDeletionInput): ActivityDeletionVerdict {
  if (input.attendances > 0) {
    return {
      allowed: false,
      reason: 'HAS_ATTENDANCE',
      message: `“${input.title}” já tem ${input.attendances} presença(s) registrada(s) no credenciamento. Cancele a atividade para preservar o histórico.`,
    };
  }

  if (input.liveRegistrations > 0) {
    return {
      allowed: false,
      reason: 'HAS_REGISTRATIONS',
      message: `“${input.title}” tem ${input.liveRegistrations} inscrição(ões) ativa(s). Cancele a atividade — assim quem se inscreveu é avisado e o histórico fica preservado.`,
    };
  }

  return { allowed: true };
}
