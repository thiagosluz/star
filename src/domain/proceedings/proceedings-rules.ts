/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Regras de publicação dos Anais do evento (FASE 111)
 *
 *  Módulo 100% puro: não importa Prisma nem Next. Modela curadoria de volumes,
 *  autorização de publicação de versão final, normalização de identificadores
 *  gratuitos/externos (ISBN, ISSN, DOI) e projeção pública fail-closed.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { normalizeApiFieldName } from '@/domain/api/public-api-contract';
import type { SubmissionFileKind } from '@/domain/review/submission-rules';

export const PROCEEDINGS_STATUS_VALUES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ProceedingsStatus = (typeof PROCEEDINGS_STATUS_VALUES)[number];

export const PROCEEDINGS_STATUS_LABELS: Readonly<Record<ProceedingsStatus, string>> = {
  DRAFT: 'Rascunho',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
};

export const PROCEEDINGS_PUBLICATION_TERM_VERSION = '2026.11-v1';
export const PROCEEDINGS_PUBLICATION_TERM_TEXT =
  'Autorizo a publicação de título, resumo, autoria, afiliação e versão final do trabalho nos Anais públicos do evento e sua indexação acadêmica aberta (Google Acadêmico, OAI-PMH e formatos bibliográficos), preservando integralmente os direitos autorais dos autores.';

/**
 * Apenas artefatos explicitamente identificados podem virar PDF público nos Anais.
 * `BLIND_PDF` contém o manuscrito anônimo da revisão cega e NUNCA entra aqui.
 */
export const PROCEEDINGS_PUBLIC_FILE_KINDS = ['CAMERA_READY', 'IDENTIFIED_PDF'] as const;
export type ProceedingsPublicFileKind = (typeof PROCEEDINGS_PUBLIC_FILE_KINDS)[number];

export function canUseFileKindInProceedings(
  kind: SubmissionFileKind | (string & {}) | null | undefined,
): kind is ProceedingsPublicFileKind {
  return kind === 'CAMERA_READY' || kind === 'IDENTIFIED_PDF';
}

export function normalizePublicFileKindInput(
  raw: string | null | undefined,
): { ok: true; kind: ProceedingsPublicFileKind | null } | { ok: false; message: string } {
  const trimmed = (raw ?? '').trim().toUpperCase();
  if (!trimmed || trimmed === 'NONE' || trimmed === 'METADATA_ONLY') {
    return { ok: true, kind: null };
  }
  if (trimmed === 'CAMERA_READY' || trimmed === 'IDENTIFIED_PDF') {
    return { ok: true, kind: trimmed };
  }
  return {
    ok: false,
    message:
      'Somente a versão final (camera-ready) ou a versão identificada pode ser disponibilizada nos anais públicos.',
  };
}

export function normalizeExternalDoi(
  raw: string | null | undefined,
): { ok: true; doi: string | null } | { ok: false; message: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: true, doi: null };

  const withoutPrefix = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .trim();

  if (withoutPrefix.length > 200 || !/^10\.\d{4,9}\/\S+$/.test(withoutPrefix)) {
    return {
      ok: false,
      message: 'DOI externo inválido. Informe no formato 10.xxxx/sufixo ou URL https://doi.org/...',
    };
  }

  return { ok: true, doi: withoutPrefix };
}

export function normalizeIssn(
  raw: string | null | undefined,
): { ok: true; issn: string | null } | { ok: false; message: string } {
  const trimmed = (raw ?? '').trim().toUpperCase();
  if (!trimmed) return { ok: true, issn: null };

  const compact = trimmed.replace(/[^0-9X]/g, '');
  if (!/^\d{7}[\dX]$/.test(compact)) {
    return { ok: false, message: 'ISSN inválido. Use 8 dígitos no formato 1234-567X.' };
  }

  return { ok: true, issn: `${compact.slice(0, 4)}-${compact.slice(4)}` };
}

export function normalizeIsbn(
  raw: string | null | undefined,
): { ok: true; isbn: string | null } | { ok: false; message: string } {
  const trimmed = (raw ?? '').trim().toUpperCase();
  if (!trimmed) return { ok: true, isbn: null };

  const compact = trimmed.replace(/[^0-9X]/g, '');
  if (!/^\d{9}[\dX]$/.test(compact) && !/^97[89]\d{10}$/.test(compact)) {
    return { ok: false, message: 'ISBN inválido. Informe um ISBN-10 ou ISBN-13 válido.' };
  }

  return { ok: true, isbn: trimmed.slice(0, 32) };
}

export function validatePageRange(
  pageStart: number | null | undefined,
  pageEnd: number | null | undefined,
): { ok: true; pageStart: number | null; pageEnd: number | null } | { ok: false; message: string } {
  const start = pageStart ?? null;
  const end = pageEnd ?? null;

  if (start !== null && (!Number.isInteger(start) || start < 1 || start > 100_000)) {
    return { ok: false, message: 'Página inicial deve ser um inteiro positivo.' };
  }
  if (end !== null && (!Number.isInteger(end) || end < 1 || end > 100_000)) {
    return { ok: false, message: 'Página final deve ser um inteiro positivo.' };
  }
  if (start !== null && end !== null && end < start) {
    return { ok: false, message: 'Página final não pode ser menor que a página inicial.' };
  }

  return { ok: true, pageStart: start, pageEnd: end };
}

export interface ProceedingsVolumeInput {
  title: string;
  subtitle?: string | null;
  volumeLabel?: string | null;
  editionYear: number;
  editors?: string | null;
  isbn?: string | null;
  issn?: string | null;
  publisherName?: string | null;
  preface?: string | null;
}

export interface NormalizedProceedingsVolumeInput {
  title: string;
  subtitle: string | null;
  volumeLabel: string | null;
  editionYear: number;
  editors: string | null;
  isbn: string | null;
  issn: string | null;
  publisherName: string | null;
  preface: string | null;
}

function trimNullable(raw: string | null | undefined, max: number): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function validateProceedingsVolumeInput(
  input: ProceedingsVolumeInput,
):
  | { ok: true; value: NormalizedProceedingsVolumeInput }
  | { ok: false; message: string } {
  const title = input.title.trim();
  if (title.length < 5 || title.length > 300) {
    return { ok: false, message: 'Título dos anais deve ter entre 5 e 300 caracteres.' };
  }

  if (!Number.isInteger(input.editionYear) || input.editionYear < 1900 || input.editionYear > 2100) {
    return { ok: false, message: 'Ano da edição inválido.' };
  }

  const isbn = normalizeIsbn(input.isbn);
  if (!isbn.ok) return isbn;

  const issn = normalizeIssn(input.issn);
  if (!issn.ok) return issn;

  return {
    ok: true,
    value: {
      title,
      subtitle: trimNullable(input.subtitle, 400),
      volumeLabel: trimNullable(input.volumeLabel, 80),
      editionYear: input.editionYear,
      editors: trimNullable(input.editors, 500),
      isbn: isbn.isbn,
      issn: issn.issn,
      publisherName: trimNullable(input.publisherName, 200),
      preface: trimNullable(input.preface, 5000),
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Projeção pública fail-closed e snapshot congelado na publicação
// ───────────────────────────────────────────────────────────────────────────────
export interface ProceedingsAuthorView {
  name: string;
  institution: string | null;
  orcidId: string | null;
  order: number;
  isCorresponding: boolean;
}

export interface ProceedingsEntrySnapshot {
  protocol: string;
  title: string;
  abstract: string;
  keywords: string[];
  language: string;
  sectionName: string | null;
  authors: ProceedingsAuthorView[];
  publishedAt: string;
}

const FORBIDDEN_PROCEEDINGS_FIELDS = new Set([
  'email',
  'guestemail',
  'cpf',
  'document',
  'finalscore',
  'score',
  'reviews',
  'decisionnotes',
  'blindsnapshot',
  'blindpdf',
  'passwordhash',
  'submittedbyid',
  'token',
]);

/**
 * Garante em profundidade que nenhum dado confidencial da avaliação ou dado pessoal
 * privado (e-mail, CPF, notas, pareceres, snapshot cego) vaze para a superfície
 * pública dos Anais. Falha ruidosamente (fail-closed) se alguém violar o contrato.
 */
export function assertProceedingsSemCampoProibido(payload: unknown): void {
  const seen = new Set<object>();

  function visit(node: unknown, path: string): void {
    if (node === null || node === undefined || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const normalized = normalizeApiFieldName(key);
      if (FORBIDDEN_PROCEEDINGS_FIELDS.has(normalized)) {
        throw new Error(
          `Campo proibido na projeção pública dos Anais: "${path ? `${path}.${key}` : key}".`,
        );
      }
      visit(value, path ? `${path}.${key}` : key);
    }
  }

  visit(payload, '');
}

export function buildProceedingsEntrySnapshot(input: {
  protocol: string;
  title: string;
  abstract: string;
  keywords: readonly string[];
  language: string;
  sectionName: string | null;
  authors: readonly ProceedingsAuthorView[];
  publishedAt: Date;
}): ProceedingsEntrySnapshot {
  const snapshot: ProceedingsEntrySnapshot = {
    protocol: input.protocol.trim(),
    title: input.title.trim(),
    abstract: input.abstract.trim(),
    keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
    language: input.language.trim() || 'pt-BR',
    sectionName: input.sectionName?.trim() || null,
    authors: [...input.authors]
      .sort((a, b) => a.order - b.order)
      .map((author) => ({
        name: author.name.trim(),
        institution: author.institution?.trim() || null,
        orcidId: author.orcidId?.trim() || null,
        order: author.order,
        isCorresponding: Boolean(author.isCorresponding),
      })),
    publishedAt: input.publishedAt.toISOString(),
  };

  assertProceedingsSemCampoProibido(snapshot);
  return snapshot;
}
