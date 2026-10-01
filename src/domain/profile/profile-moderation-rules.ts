/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Denúncia e moderação do perfil público (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A DECISÃO É DA PLATAFORMA, E NÃO DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `@handle` é GLOBAL (ADR-002): o MESMO perfil aparece na vitrine de todas as
 *  casas. Se cada instituição decidisse, o conteúdo seria julgado de formas
 *  diferentes — e quem foi ocultado numa casa continuaria publicado na vizinha,
 *  sem que ninguém enxergasse o conjunto.
 *
 *  Por isso a denúncia NASCE com o contexto de quem denunciou (a instituição em que
 *  a pessoa estava quando viu o perfil, com RLS e trilha) e a fila é lida pela
 *  PLATAFORMA, que decide uma vez para todas.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CATÁLOGO DE CATEGORIAS É FECHADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "O que estão denunciando" é a primeira pergunta de quem triagem — texto livre
 *  transformaria a fila numa pilha de relatos sem eixo. A categoria fixa dá o eixo;
 *  o campo de detalhes é o que a categoria não consegue dizer (e por isso é
 *  OBRIGATÓRIO em `OTHER`, onde não há eixo nenhum).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A NOTA DA DECISÃO É OBRIGATÓRIA NOS DOIS DESFECHOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Dispensada" sem justificativa é indistinguível de "ninguém olhou". Ocultar um
 *  perfil é uma medida grave — e a mesma régua vale para não ocultar: quem
 *  denunciou, quem foi denunciado e quem auditar precisam ler o MOTIVO.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  Categorias
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As categorias espelham o enum `ProfileReportCategory` do schema (o domínio não
 * importa o ORM — a união de string é a mesma lista, escrita à mão de propósito).
 */
export const PROFILE_REPORT_CATEGORIES = [
  'FALSE_IDENTITY',
  'OFFENSIVE_CONTENT',
  'PRIVACY',
  'SPAM',
  'OTHER',
] as const;

export type ProfileReportCategory = (typeof PROFILE_REPORT_CATEGORIES)[number];

/**
 * A categoria recebida é uma das conhecidas?
 *
 * O serviço grava a categoria numa coluna de enum: sem esta guarda, um valor
 * desconhecido (de um formulário adulterado) viraria erro do banco — e o chamador
 * leria "falha interna" em vez de "categoria inválida".
 */
export function isProfileReportCategory(value: unknown): value is ProfileReportCategory {
  return typeof value === 'string' && (PROFILE_REPORT_CATEGORIES as readonly string[]).includes(value);
}

export const PROFILE_REPORT_CATEGORY_LABELS: Readonly<Record<ProfileReportCategory, string>> = {
  FALSE_IDENTITY: 'Identidade falsa',
  OFFENSIVE_CONTENT: 'Conteúdo ofensivo',
  PRIVACY: 'Exposição de dado pessoal',
  SPAM: 'Spam ou propaganda',
  OTHER: 'Outro motivo',
};

/**
 * O que cada categoria significa, na tela de quem denuncia.
 *
 * O rótulo sozinho não basta: "Exposição de dado pessoal" é ambíguo para quem está
 * denunciando o PRÓPRIO dado ou o de terceiro — e quem triagem precisa que a
 * categoria tenha sido escolhida com o mesmo entendimento.
 */
export const PROFILE_REPORT_CATEGORY_MEANINGS: Readonly<Record<ProfileReportCategory, string>> = {
  FALSE_IDENTITY: 'O perfil usa o nome, a foto ou a identidade de outra pessoa.',
  OFFENSIVE_CONTENT: 'Ofensa, discurso de ódio, assédio ou conteúdo ilegal.',
  PRIVACY: 'Divulgação de dado pessoal (endereço, telefone, documento) sem consentimento.',
  SPAM: 'Propaganda, uso comercial ou conteúdo repetido sem relação com a instituição.',
  OTHER: 'Um motivo que não cabe nas opções acima — descreva nos detalhes.',
};

// ───────────────────────────────────────────────────────────────────────────────
//  Os detalhes do relato
// ───────────────────────────────────────────────────────────────────────────────
/** Teto da coluna `profile_reports.details` (`VarChar(2000)`). */
export const REPORT_DETAILS_MAX_LENGTH = 2000;

/**
 * Mínimo quando o detalhe é exigido.
 *
 * Um piso (e não "qualquer coisa") porque "spam" ou "..." não dão a quem decide
 * nada com que trabalhar — e a categoria `OTHER` é justamente a que não traz
 * informação própria.
 */
export const REPORT_DETAILS_MIN_LENGTH = 10;

export type ReportDetailsProblem = 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | null;

/** `OTHER` é a única categoria que não diz nada sozinha — logo, exige o relato. */
export function requiresDetails(category: ProfileReportCategory): boolean {
  return category === 'OTHER';
}

/**
 * O relato é aceitável para esta categoria?
 *
 * Devolve o MOTIVO em vez de `boolean` porque quem chama tem de dizer à pessoa o
 * que corrigir: "descreva o motivo" e "seu texto passou do limite" são correções
 * diferentes (mesma régua de `replyBodyProblem`).
 *
 * O teto vale sempre — a coluna é do banco, e um texto maior viraria falha de
 * gravação em vez de mensagem clara.
 */
export function detailsProblem(
  category: ProfileReportCategory,
  details: string | null | undefined,
): ReportDetailsProblem {
  const trimmed = (details ?? '').trim();

  if (trimmed.length === 0) return requiresDetails(category) ? 'REQUIRED' : null;
  if (trimmed.length > REPORT_DETAILS_MAX_LENGTH) return 'TOO_LONG';
  if (requiresDetails(category) && trimmed.length < REPORT_DETAILS_MIN_LENGTH) return 'TOO_SHORT';

  return null;
}

/** A frase que a tela (e a Server Action) mostra para cada recusa. */
export function detailsProblemMessage(problem: Exclude<ReportDetailsProblem, null>): string {
  switch (problem) {
    case 'REQUIRED':
      return 'Descreva o motivo da denúncia: a opção "Outro motivo" não diz nada sozinha.';
    case 'TOO_SHORT':
      return `Descreva o motivo com ao menos ${REPORT_DETAILS_MIN_LENGTH} caracteres.`;
    case 'TOO_LONG':
      return `O relato passou de ${REPORT_DETAILS_MAX_LENGTH} caracteres. Resuma o essencial.`;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O estado da denúncia
// ───────────────────────────────────────────────────────────────────────────────
/** Espelha o enum `ProfileReportStatus` do schema. */
export const PROFILE_REPORT_STATUSES = ['OPEN', 'DISMISSED', 'ACTIONED'] as const;

export type ProfileReportStatus = (typeof PROFILE_REPORT_STATUSES)[number];

export const PROFILE_REPORT_STATUS_LABELS: Readonly<Record<ProfileReportStatus, string>> = {
  OPEN: 'Aguardando decisão',
  DISMISSED: 'Analisada, sem ação',
  ACTIONED: 'Analisada, com ação',
};

/**
 * Só uma denúncia ABERTA aceita decisão.
 *
 * A checagem é de domínio porque DOIS caminhos perguntam a mesma coisa: a tela (que
 * esconde os botões) e o serviço (que recusa). Duas cópias divergiriam na primeira
 * manutenção — e aqui divergir significaria reescrever uma decisão já registrada.
 */
export function canDecideReport(status: ProfileReportStatus): boolean {
  return status === 'OPEN';
}

// ───────────────────────────────────────────────────────────────────────────────
//  As ações da moderação
// ───────────────────────────────────────────────────────────────────────────────
export const PROFILE_MODERATION_ACTIONS = ['DISMISS', 'HIDE'] as const;

export type ProfileModerationAction = (typeof PROFILE_MODERATION_ACTIONS)[number];

/** A ação recebida é uma das duas conhecidas? (Formulário é entrada não confiável.) */
export function isProfileModerationAction(value: unknown): value is ProfileModerationAction {
  return typeof value === 'string' && (PROFILE_MODERATION_ACTIONS as readonly string[]).includes(value);
}

export const PROFILE_MODERATION_ACTION_LABELS: Readonly<Record<ProfileModerationAction, string>> = {
  DISMISS: 'Dispensar a denúncia',
  HIDE: 'Ocultar o perfil',
};

/**
 * O que a ação FAZ, escrito para quem decide.
 *
 * A consequência é texto de domínio, e não legenda da tela, porque é ela que o
 * serviço aplica: `HIDE` grava `User.publicProfileHiddenAt` (o perfil deixa de
 * aparecer em TODAS as casas) e `DISMISS` não toca no perfil. A conta e o `@handle`
 * continuam existindo nos dois casos — ocultar NÃO é apagar.
 */
export const PROFILE_MODERATION_EFFECTS: Readonly<Record<ProfileModerationAction, string>> = {
  DISMISS: 'A denúncia é encerrada como analisada e nada muda no perfil.',
  HIDE: 'O perfil deixa de aparecer publicamente em todas as instituições. A conta e o @handle continuam existindo.',
};

export function profileModerationEffect(action: ProfileModerationAction): string {
  return PROFILE_MODERATION_EFFECTS[action];
}

// ───────────────────────────────────────────────────────────────────────────────
//  A nota da decisão
// ───────────────────────────────────────────────────────────────────────────────
/** Teto da coluna `profile_reports.decisionNote` (`VarChar(1000)`). */
export const DECISION_NOTE_MAX_LENGTH = 1000;

/** Mesmo piso do relato: "ok" não é justificativa de moderação. */
export const DECISION_NOTE_MIN_LENGTH = 10;

export type DecisionNoteProblem = 'REQUIRED' | 'TOO_SHORT' | 'TOO_LONG' | null;

export function decisionNoteProblem(note: string | null | undefined): DecisionNoteProblem {
  const trimmed = (note ?? '').trim();

  if (trimmed.length === 0) return 'REQUIRED';
  if (trimmed.length > DECISION_NOTE_MAX_LENGTH) return 'TOO_LONG';
  if (trimmed.length < DECISION_NOTE_MIN_LENGTH) return 'TOO_SHORT';

  return null;
}

export function decisionNoteProblemMessage(problem: Exclude<DecisionNoteProblem, null>): string {
  switch (problem) {
    case 'REQUIRED':
      return 'Escreva a justificativa da decisão.';
    case 'TOO_SHORT':
      return `A justificativa precisa de ao menos ${DECISION_NOTE_MIN_LENGTH} caracteres.`;
    case 'TOO_LONG':
      return `A justificativa passou de ${DECISION_NOTE_MAX_LENGTH} caracteres.`;
  }
}

/**
 * Teto da coluna `User.publicProfileHiddenReason` (`VarChar(500)`).
 *
 * É MENOR que a nota da decisão, e é por isso que a razão gravada no perfil é um
 * recorte da nota: sem o corte, uma justificativa de 800 caracteres faria o
 * `UPDATE` do usuário falhar — e a decisão de moderação se perderia por causa do
 * tamanho do texto, não do mérito dela.
 */
export const HIDDEN_REASON_MAX_LENGTH = 500;

/** O motivo exibido no perfil oculto quando a decisão não deixou um texto legível. */
export const HIDDEN_REASON_FALLBACK = 'decisão da moderação';
