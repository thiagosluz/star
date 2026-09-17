/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Conflito de interesse (COI)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É O MÓDULO MAIS CRÍTICO DA AVALIAÇÃO POR PARES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um parecer emitido por alguém com conflito não é apenas "menos justo": ele
 *  invalida o processo. Se um autor avalia o próprio trabalho, ou um orientador
 *  avalia o orientando, a decisão perde legitimidade acadêmica — e a instituição
 *  não tem como se defender.
 *
 *  Por isso a postura aqui é ASSIMÉTRICA: o custo de recusar um revisor em
 *  dúvida é baixo (há outros); o custo de aceitar um revisor em conflito é alto
 *  (retratação, perda de credibilidade). Na dúvida, MARCA-SE O CONFLITO.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO **NÃO** FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não decide sozinho quem revisa quem. Ele APONTA conflitos; a atribuição é
 *  feita (ou confirmada) por uma pessoa do comitê. Um sistema que decide
 *  silenciosamente sobre conflito de interesse comete o mesmo pecado que quer
 *  evitar: retira a responsabilidade de quem responde por ela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type ConflictType =
  | 'SAME_INSTITUTION'
  | 'COAUTHOR'
  | 'ADVISOR_ADVISEE'
  | 'FINANCIAL_TIE'
  | 'PERSONAL_RELATIONSHIP'
  | 'SELF_DECLARED';

/** Como o conflito foi identificado. */
export type ConflictDetection = 'AUTOMATIC' | 'DECLARED';

export interface Conflict {
  type: ConflictType;
  detection: ConflictDetection;
  /** Explicação legível, exibida ao comitê. */
  reason: string;
  /** Nível de certeza. `UNCERTAIN` ainda bloqueia — apenas avisa que é heurístico. */
  confidence: 'CERTAIN' | 'UNCERTAIN';
}

/**
 * Bloqueia a atribuição por padrão, mesmo em conflito incerto.
 *
 * Exportado para que a política seja explícita e testável: um revisor com
 * SAME_INSTITUTION heurístico (domínio de e-mail compartilhado, sem afiliação
 * declarada) é tratado como bloqueado, não como "provável que seja seguro".
 */
export const BLOCK_ON_UNCERTAIN_CONFLICT = true;

// ───────────────────────────────────────────────────────────────────────────────
//  Normalização — a comparação precisa tolerar variações reais
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Normaliza nome de instituição para comparação.
 *
 * "Universidade Federal da Bahia", "UFBA" e "Universidade Federal da Bahia -
 * UFBA" precisam colidir. Fazemos isso removendo:
 *   • acentos (Unicode NFD + remoção de marcas)
 *   • sufixos legais e de forma (LTDA, S.A., ME, EIRELI)
 *   • pontuação, espaços repetidos e caixa
 *
 * A comparação é por CONTENÇÃO (ver `institutionsMatch`), o que resolve o caso
 * "UFBA" ⊂ "Universidade Federal da Bahia - UFBA" sem exigir uma tabela de
 * sinônimos.
 */
export function normalizeInstitution(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(ltda|s\.?a\.?|me|eireli|epp|inc|corp)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Instituições são equivalentes?
 *
 * Três estratégias, da mais forte para a mais fraca:
 *   1. igualdade exata após normalização;
 *   2. **sigla** — a declaração costuma trazer "(UFBA)" ou "UFBA" junto ao nome;
 *   3. contenção de um termo no outro, exigindo ao menos 4 caracteres.
 *
 * O caso da sigla é o mais comum na prática: autores escrevem a instituição de
 * formas diferentes dentro da mesma instituição ("Universidade Federal da Bahia",
 * "UFBA", "Universidade Federal da Bahia - UFBA"). Sem tratar sigla, o conflito
 * mais frequente passaria batido.
 */
export function institutionsMatch(a: string, b: string): boolean {
  const left = normalizeInstitution(a);
  const right = normalizeInstitution(b);

  if (left.length === 0 || right.length === 0) return false;
  if (left === right) return true;

  // ── Siglas ────────────────────────────────────────────────────────────────
  // Extraímos os grupos de letras isolados que pareçam sigla: palavra curta
  // (2–10 letras) escrita em caixa alta no texto ORIGINAL. Só a caixa alta
  // distingue "UFBA" de uma palavra comum como "bahia".
  const acronymsLeft = extractAcronyms(a);
  const acronymsRight = extractAcronyms(b);

  for (const acronym of acronymsLeft) {
    if (right.includes(acronym)) return true;
    if (acronymsRight.has(acronym)) return true;
  }
  for (const acronym of acronymsRight) {
    if (left.includes(acronym)) return true;
  }

  // ── Contenção ─────────────────────────────────────────────────────────────
  // Só vale para termos longos: "uf" contido em "ufba" geraria falso positivo.
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  if (shorter.length < 4) return false;

  return longer.includes(shorter);
}

/**
 * Extrai siglas de um nome de instituição.
 *
 * Considera apenas tokens com 2 a 10 letras que estejam em CAIXA ALTA no texto
 * original — é o sinal mais confiável de sigla. Tokens curtos vindos de
 * minúsculas (ex.: "da", "de") são ignorados.
 */
function extractAcronyms(value: string): Set<string> {
  const acronyms = new Set<string>();

  for (const token of value.split(/[\s\-–—/(),.]+/)) {
    const cleaned = token.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (cleaned.length < 2 || cleaned.length > 10) continue;
    if (cleaned !== cleaned.toUpperCase()) continue;
    // Precisa ser um token em caixa alta (UFBA), não um número ou "DE".
    const normalized = cleaned
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/^[a-z]+$/.test(normalized)) acronyms.add(normalized);
  }

  return acronyms;
}

/**
 * Domínios reservados para documentação, testes e redes internas
 * (RFC 2606 e RFC 6761). Nenhum deles identifica uma instituição real.
 *
 * `example.test` é o caso que motivou esta lista: em testes e demonstrações,
 * TODAS as contas usam o mesmo domínio, e tratá-lo como domínio institucional
 * fazia todo revisor parecer da mesma instituição que todo autor — o painel do
 * comitê ficava sem nenhum elegível.
 *
 * Também ficam de fora domínios de um único rótulo (`intranet`), que não são
 * comparáveis entre organizações diferentes.
 */
const RESERVED_DOMAIN_TLDS = new Set([
  'test',
  'example',
  'invalid',
  'localhost',
  'local',
  'internal',
  'home',
  'arpa',
]);

/**
 * O domínio é um domínio institucional utilizável como evidência?
 *
 * Exige um TLD de pelo menos um rótulo e recusa espaços reservados. É aplicado
 * tanto ao domínio do e-mail quanto ao domínio DECLARADO: uma declaração
 * preenchida com `example.test` produziria o mesmo falso positivo.
 */
export function isInstitutionalDomain(domain: string): boolean {
  const dot = domain.indexOf('.');
  if (dot <= 0 || dot === domain.length - 1) return false;
  const tld = domain.slice(domain.lastIndexOf('.') + 1);
  return !RESERVED_DOMAIN_TLDS.has(tld);
}

/** Normaliza um domínio declarado (`@UFBA.BR` → `ufba.br`). */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/^@+/, '');
  if (cleaned.length === 0) return null;
  return isInstitutionalDomain(cleaned) ? cleaned : null;
}

/**
 * Extrai o domínio institucional de um e-mail.
 *
 * Recusa domínios de provedores pessoais: um revisor com `@gmail.com` não pode
 * ser considerado da mesma instituição que um autor com `@gmail.com` — isso
 * bloquearia atribuições legítimas em massa. Pelo mesmo motivo recusa domínios
 * reservados (`@example.test`).
 */
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'protonmail.com',
  'proton.me',
  'aol.com',
  'gmx.com',
  'zoho.com',
  'bol.com.br',
  'uol.com.br',
  'terra.com.br',
]);

export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (domain.length === 0) return null;
  if (PERSONAL_EMAIL_DOMAINS.has(domain)) return null;
  if (!isInstitutionalDomain(domain)) return null;
  return domain;
}

/**
 * Dois domínios apontam para a mesma instituição?
 *
 * Igualdade OU subdomínio: `ufba.br` e `saude.ufba.br` são a mesma
 * universidade, e um revisor que declarou o domínio raiz precisa continuar
 * sendo reconhecido quando o autor usa o domínio do instituto.
 */
export function domainsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Normaliza um identificador pessoal (ORCID, Lattes) para comparação. */
export function normalizePersonalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase().replace(/[\s-]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/** Normaliza nome de pessoa, para detectar a mesma pessoa escrita de formas diferentes. */
export function normalizePersonName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ───────────────────────────────────────────────────────────────────────────────
//  Entrada para detecção
// ───────────────────────────────────────────────────────────────────────────────
export interface ReviewAuthorIdentity {
  userId?: string | null;
  name: string;
  email?: string | null;
  institution?: string | null;
  orcidId?: string | null;
  lattesId?: string | null;
  /** `true` quando é o autor correspondente (quem submeteu). */
  isCorresponding?: boolean;
}

export interface ReviewerIdentity {
  userId: string;
  name: string;
  email?: string | null;
  /** Afiliação declarada no perfil. */
  institution?: string | null;
  /** Domínio institucional declarado (preferido sobre o domínio do e-mail). */
  institutionalEmailDomain?: string | null;
  orcidId?: string | null;
  lattesId?: string | null;
  /** Ids de usuários de quem este revisor é (ou foi) orientador. */
  advisesUserIds?: readonly string[];
  /** Vínculo financeiro declarado (mesma empresa, consultoria, bolsa). */
  hasFinancialTie?: boolean;
  /** Declaração explícita de conflito feita pelo próprio revisor. */
  declaredConflict?: boolean;
  declaredConflictReason?: string | null;
}

export interface ConflictEvaluationInput {
  reviewer: ReviewerIdentity;
  authors: readonly ReviewAuthorIdentity[];
  /**
   * Autor correspondente (`Submission.submittedById`). Verificado mesmo que não
   * esteja na lista de autores — dado inconsistente não pode virar brecha.
   */
  submittedById?: string | null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Detecção
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Detecta todos os conflitos entre um revisor e os autores de uma submissão.
 *
 * Curto-circuita no primeiro conflito quando ele é CERTAIN: não há valor em
 * enumerar os demais se a atribuição já está impedida, e a razão mais forte é a
 * que deve ser exibida ao comitê.
 */
export function detectConflicts(input: ConflictEvaluationInput): Conflict[] {
  const { reviewer, authors, submittedById } = input;
  const conflicts: Conflict[] = [];

  // ── 0. Declaração do próprio revisor tem precedência absoluta ──────────────
  // Se a pessoa afirma ter conflito, não cabe ao sistema contestar.
  if (reviewer.declaredConflict) {
    return [
      {
        type: 'SELF_DECLARED',
        detection: 'DECLARED',
        reason:
          reviewer.declaredConflictReason?.trim() ||
          'O revisor declarou conflito de interesse.',
        confidence: 'CERTAIN',
      },
    ];
  }

  // ── 1. Avaliar o próprio trabalho ──────────────────────────────────────────
  for (const author of authors) {
    if (author.userId && author.userId === reviewer.userId) {
      return [
        {
          type: 'COAUTHOR',
          detection: 'AUTOMATIC',
          reason: `O revisor é autor desta submissão (${author.name}).`,
          confidence: 'CERTAIN',
        },
      ];
    }
  }

  if (submittedById && submittedById === reviewer.userId) {
    return [
      {
        type: 'COAUTHOR',
        detection: 'AUTOMATIC',
        reason: 'O revisor é o autor correspondente desta submissão.',
        confidence: 'CERTAIN',
      },
    ];
  }

  // ── 2. Orientador / orientando ─────────────────────────────────────────────
  const advised = new Set(reviewer.advisesUserIds ?? []);
  if (advised.size > 0) {
    for (const author of authors) {
      if (author.userId && advised.has(author.userId)) {
        return [
          {
            type: 'ADVISOR_ADVISEE',
            detection: 'AUTOMATIC',
            reason: `O revisor é orientador de ${author.name}, autor desta submissão.`,
            confidence: 'CERTAIN',
          },
        ];
      }
    }
    if (submittedById && advised.has(submittedById)) {
      return [
        {
          type: 'ADVISOR_ADVISEE',
          detection: 'AUTOMATIC',
          reason: 'O revisor é orientador do autor correspondente.',
          confidence: 'CERTAIN',
        },
      ];
    }
  }

  // ── 3. Mesmo identificador acadêmico (ORCID/Lattes) ────────────────────────
  const reviewerOrcid = normalizePersonalId(reviewer.orcidId);
  const reviewerLattes = normalizePersonalId(reviewer.lattesId);

  for (const author of authors) {
    const authorOrcid = normalizePersonalId(author.orcidId);
    const authorLattes = normalizePersonalId(author.lattesId);

    if (reviewerOrcid && authorOrcid && reviewerOrcid === authorOrcid) {
      return [
        {
          type: 'COAUTHOR',
          detection: 'AUTOMATIC',
          reason: `O revisor e ${author.name} compartilham o mesmo ORCID.`,
          confidence: 'CERTAIN',
        },
      ];
    }
    if (reviewerLattes && authorLattes && reviewerLattes === authorLattes) {
      return [
        {
          type: 'COAUTHOR',
          detection: 'AUTOMATIC',
          reason: `O revisor e ${author.name} compartilham o mesmo currículo Lattes.`,
          confidence: 'CERTAIN',
        },
      ];
    }
  }

  // ── 4. Vínculo financeiro declarado ────────────────────────────────────────
  if (reviewer.hasFinancialTie) {
    return [
      {
        type: 'FINANCIAL_TIE',
        detection: 'DECLARED',
        reason: 'O revisor declarou vínculo financeiro com os autores.',
        confidence: 'CERTAIN',
      },
    ];
  }

  // ── 5. Mesma instituição ───────────────────────────────────────────────────
  /**
   * O domínio DECLARADO substitui o do e-mail — não se soma a ele.
   *
   * Somar os dois criava evidência que ninguém declarou: um revisor com conta em
   * `@parceiro.com` e instituição declarada `ufba.br` era marcado como possível
   * colega de todo autor com conta em `@parceiro.com`. Quando a pessoa declara a
   * instituição, é essa declaração que vale; o domínio do e-mail é apenas o
   * substituto de quem não declarou nada.
   */
  const reviewerDomains = new Set<string>();
  const declaredDomain = normalizeDomain(reviewer.institutionalEmailDomain);
  if (declaredDomain) {
    reviewerDomains.add(declaredDomain);
  } else {
    const reviewerEmailDomain = emailDomain(reviewer.email);
    if (reviewerEmailDomain) reviewerDomains.add(reviewerEmailDomain);
  }

  /**
   * Duas passagens deliberadas, da evidência mais forte para a mais fraca.
   *
   * 1ª passagem: afiliação DECLARADA contra afiliação declarada → CERTAIN.
   * 2ª passagem: domínio de e-mail institucional → UNCERTAIN (heurístico).
   *
   * A ordem importa: se verificássemos o domínio dentro da mesma passagem,
   * um revisor com domínio coincidente seria classificado como INCERTO mesmo
   * quando houvesse evidência CERTA de mesma instituição adiante na lista —
   * e a mensagem mostrada ao comitê seria a mais fraca das duas.
   */
  for (const author of authors) {
    if (!reviewer.institution || !author.institution) continue;

    if (institutionsMatch(reviewer.institution, author.institution)) {
      return [
        {
          type: 'SAME_INSTITUTION',
          detection: 'AUTOMATIC',
          reason: `O revisor e ${author.name} declaram a mesma instituição (${author.institution}).`,
          confidence: 'CERTAIN',
        },
      ];
    }
  }

  if (reviewerDomains.size > 0) {
    for (const author of authors) {
      const authorDomain = emailDomain(author.email);
      if (
        authorDomain &&
        [...reviewerDomains].some((domain) => domainsMatch(authorDomain, domain))
      ) {
        conflicts.push({
          type: 'SAME_INSTITUTION',
          detection: 'AUTOMATIC',
          reason: `O revisor e ${author.name} compartilham o domínio institucional ${authorDomain}.`,
          confidence: 'UNCERTAIN',
        });
        break;
      }
    }
  }

  // ── 6. Nome idêntico como último recurso ───────────────────────────────────
  // Cobre o caso de o autor não ter conta mas o nome bater exatamente com o do
  // revisor (ex.: submissão duplicada por engano, cadastro duplicado).
  const reviewerName = normalizePersonName(reviewer.name);
  if (reviewerName.length >= 6) {
    for (const author of authors) {
      if (normalizePersonName(author.name) === reviewerName) {
        conflicts.push({
          type: 'COAUTHOR',
          detection: 'AUTOMATIC',
          reason: 'O nome do revisor coincide exatamente com o de um autor.',
          confidence: 'UNCERTAIN',
        });
        break;
      }
    }
  }

  return conflicts;
}

/** O revisor está impedido de avaliar esta submissão? */
export function hasBlockingConflict(conflicts: readonly Conflict[]): boolean {
  return conflicts.some(
    (conflict) =>
      conflict.confidence === 'CERTAIN' ||
      (BLOCK_ON_UNCERTAIN_CONFLICT && conflict.confidence === 'UNCERTAIN'),
  );
}

/**
 * Avalia o resultado da checagem de conflito para o comitê.
 *
 * Devolve um veredito legível em vez de um booleano solto, porque a UI precisa
 * explicar POR QUE um revisor foi recusado — e a decisão precisa ficar auditável.
 */
export interface ConflictVerdict {
  blocked: boolean;
  conflicts: readonly Conflict[];
  /** Conflitos de maior severidade, para exibição destacada. */
  primaryConflict: Conflict | null;
  message: string;
}

export function evaluateConflict(input: ConflictEvaluationInput): ConflictVerdict {
  const conflicts = detectConflicts(input);

  if (conflicts.length === 0) {
    return {
      blocked: false,
      conflicts,
      primaryConflict: null,
      message: 'Nenhum conflito de interesse identificado.',
    };
  }

  const primary = conflicts[0]!;

  return {
    blocked: hasBlockingConflict(conflicts),
    conflicts,
    primaryConflict: primary,
    message: primary.reason,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Filtro de candidatos
// ───────────────────────────────────────────────────────────────────────────────
export interface ConflictScreeningResult<T extends ReviewerIdentity> {
  eligible: readonly T[];
  blocked: readonly { reviewer: T; verdict: ConflictVerdict }[];
}

/**
 * Separa revisores elegíveis dos bloqueados por conflito.
 *
 * Recebe uma lista de candidatos já ranqueada por afinidade e devolve os
 * elegíveis — a atribuição continua sendo uma escolha humana, mas sobre um
 * conjunto onde nenhum nome apresenta conflito conhecido.
 */
export function screenReviewersForConflicts<T extends ReviewerIdentity>(
  candidates: readonly T[],
  authors: readonly ReviewAuthorIdentity[],
  submittedById?: string | null,
): ConflictScreeningResult<T> {
  const eligible: T[] = [];
  const blocked: { reviewer: T; verdict: ConflictVerdict }[] = [];

  for (const candidate of candidates) {
    const verdict = evaluateConflict({ reviewer: candidate, authors, submittedById });
    if (verdict.blocked) {
      blocked.push({ reviewer: candidate, verdict });
    } else {
      eligible.push(candidate);
    }
  }

  return { eligible, blocked };
}
