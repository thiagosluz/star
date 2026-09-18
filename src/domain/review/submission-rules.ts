/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Ciclo de vida da submissão e integridade de arquivos
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PRINCÍPIO QUE ORGANIZA ESTE MÓDULO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma submissão científica tem valor de registro: ela documenta o que foi
 *  avaliado e quando. Por isso, tudo aqui é pensado para tornar difícil
 *  "reescrever a história":
 *
 *    • transições de status são uma máquina de estados explícita;
 *    • uma submissão enviada só volta a rascunho pelo comitê, com motivo;
 *    • o hash do arquivo é registrado e verificado — trocar o PDF depois de
 *      enviado é detectável;
 *    • reenviar durante a revisão cria uma VERSÃO NOVA, preservando a anterior.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SOBRE O LIMITE DE TAMANHO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O limite aqui é a última linha de defesa. O limite primário é aplicado na
 *  geração da URL pré-assinada (o S3 rejeita o corpo maior) e no `Content-Length`
 *  declarado. Mesmo assim validamos no domínio: nunca confie em uma única
 *  camada para uma regra que protege o sistema.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type SubmissionStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'REVISION_REQUESTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'CANCELED';

export type SubmissionFileKind =
  | 'BLIND_PDF'
  | 'IDENTIFIED_PDF'
  | 'SUPPLEMENTARY'
  | 'PRESENTATION'
  | 'CAMERA_READY';

// ───────────────────────────────────────────────────────────────────────────────
//  Máquina de estados
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Transições permitidas.
 *
 * Leia com atenção os estados TERMINAIS (lista vazia): `ACCEPTED` e `REJECTED`
 * não voltam atrás por ação do autor. Isso é intencional — o resultado de uma
 * avaliação é um registro, e "desfazer" um aceite publicado geraria inconsistência
 * entre o que o autor viu e o que o comitê decidiu. Mudanças nesses casos são
 * feitas por uma AÇÃO ADMINISTRATIVA explícita (que gera auditoria), não por uma
 * transição silenciosa.
 */
const ALLOWED_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  DRAFT: ['SUBMITTED', 'WITHDRAWN', 'CANCELED', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED'],
  SUBMITTED: ['UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELED'],
  UNDER_REVIEW: ['REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELED'],
  REVISION_REQUESTED: ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'CANCELED'],
  // Terminais para o autor.
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
  CANCELED: [],
};

export function canTransitionSubmission(
  from: SubmissionStatus,
  to: SubmissionStatus,
): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** O status é terminal (nenhuma transição de autor é possível)? */
export function isTerminalStatus(status: SubmissionStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** A submissão ainda aceita edição de conteúdo pelo autor? */
export function isEditableByAuthor(status: SubmissionStatus): boolean {
  return status === 'DRAFT' || status === 'REVISION_REQUESTED';
}

/**
 * O autor pode EXCLUIR esta submissão?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  SÓ O RASCUNHO — E A RAZÃO É O PRINCÍPIO DESTE MÓDULO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Uma submissão ENVIADA documenta o que foi avaliado e quando: existem
 *  atribuições de parecerista, pareceres e um `blindSnapshot` apontando para ela.
 *  Apagá-la seria "reescrever a história" — exatamente o que este módulo existe
 *  para impedir. Quem precisa desistir de um trabalho enviado usa a retirada
 *  (`WITHDRAWN`), que preserva o registro e o torna explícito.
 *
 *  O rascunho é outra coisa: nunca saiu da mão do autor, ninguém o avaliou e nada
 *  aponta para ele. Poder apagá-lo é o que permite corrigir um envio errado sem
 *  deixar lixo na própria lista.
 *
 *  Repare que `REVISION_REQUESTED` é EDITÁVEL (`isEditableByAuthor`) e mesmo assim
 *  NÃO é excluível: a essa altura já houve envio e já existe parecer que se refere
 *  a uma versão específica. Editar e excluir são perguntas diferentes.
 */
export function canDeleteSubmission(status: SubmissionStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Reenviar durante a revisão cria uma nova versão?
 *
 * Quando a submissão já está em análise, o autor pode ser autorizado a corrigir
 * o arquivo. Isso NÃO deve apagar o que foi avaliado: criamos uma versão nova e
 * preservamos a anterior, para que o parecer continue rastreável ao arquivo que
 * o originou.
 */
export function requiresNewVersionForResubmission(status: SubmissionStatus): boolean {
  return status === 'UNDER_REVIEW' || status === 'SUBMITTED' || status === 'REVISION_REQUESTED';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Requisitos de arquivo
// ───────────────────────────────────────────────────────────────────────────────
/** 25 MiB — suficiente para um artigo com figuras em alta resolução. */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Assinatura de arquivo PDF: `%PDF-`. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

export type FileValidationError =
  | { code: 'TOO_LARGE'; message: string }
  | { code: 'EMPTY'; message: string }
  | { code: 'NOT_PDF'; message: string }
  | { code: 'INVALID_MIME'; message: string };

export type FileValidation =
  | { valid: true }
  | { valid: false; errors: FileValidationError[] };

export interface FileDescriptor {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Primeiros bytes do arquivo, quando disponíveis (validação da assinatura). */
  magicBytes?: readonly number[] | null;
}

/**
 * Valida um arquivo de submissão.
 *
 * A checagem de `mimeType` sozinha é fraca: o tipo declarado pelo cliente é
 * arbitrário. Quando os bytes iniciais estão disponíveis, validamos a assinatura
 * real do PDF — a única forma confiável de afirmar "isto é um PDF".
 */
export function validateSubmissionFile(file: FileDescriptor): FileValidation {
  const errors: FileValidationError[] = [];

  if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
    errors.push({
      code: 'EMPTY',
      message: 'O arquivo está vazio.',
    });
  } else if (file.sizeBytes > MAX_FILE_SIZE_BYTES) {
    errors.push({
      code: 'TOO_LARGE',
      message: `O arquivo excede o limite de ${Math.floor(
        MAX_FILE_SIZE_BYTES / 1024 / 1024,
      )} MB.`,
    });
  }

  if (file.magicBytes && file.magicBytes.length > 0) {
    // Assinatura presente: é a evidência mais forte.
    if (!matchesPdfSignature(file.magicBytes)) {
      errors.push({
        code: 'NOT_PDF',
        message: 'O arquivo não é um PDF válido.',
      });
    }
  } else if (!isPdfMime(file.mimeType)) {
    // Sem assinatura, caímos no tipo declarado (mais fraco, mas melhor que nada).
    errors.push({
      code: 'INVALID_MIME',
      message: 'Envie o arquivo em PDF.',
    });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

function matchesPdfSignature(bytes: readonly number[]): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte);
}

function isPdfMime(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === 'application/pdf' || normalized === 'application/x-pdf';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Integridade do artefato
// ───────────────────────────────────────────────────────────────────────────────
/** SHA-256 em hexadecimal minúsculo. */
const SHA256_HEX = /^[a-f0-9]{64}$/;

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX.test(value);
}

export type IntegrityCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'HASH_MISMATCH' | 'SIZE_MISMATCH' | 'MISSING_OBJECT' | 'INVALID_HASH';
      message: string;
    };

/**
 * Confere o objeto armazenado contra o que foi declarado no upload.
 *
 * ─── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 * O upload vai direto para o S3 via URL pré-assinada: o arquivo NUNCA passa pelo
 * servidor da aplicação. Isso é bom (escala, memória) e é um risco: a aplicação
 * não vê o conteúdo. A conferência pós-upload é o que fecha essa lacuna —
 * comparamos o que o storage reporta (tamanho e metadados de checksum) com o que
 * o cliente declarou.
 *
 * Um hash divergente significa que o objeto mudou entre o upload e a
 * confirmação. Nunca aceitamos: o arquivo pode ter sido trocado.
 */
export function verifyStoredObject(input: {
  declaredSize: number;
  storedSize: number;
  declaredChecksum: string;
  /** Checksum reportado pelo storage (quando disponível). */
  storedChecksum?: string | null;
}): IntegrityCheckResult {
  const { declaredSize, storedSize, declaredChecksum, storedChecksum } = input;

  if (!isSha256Hex(declaredChecksum)) {
    return {
      ok: false,
      reason: 'INVALID_HASH',
      message: 'O hash declarado do arquivo é inválido.',
    };
  }

  if (storedSize <= 0) {
    return {
      ok: false,
      reason: 'MISSING_OBJECT',
      message: 'O arquivo não foi encontrado no armazenamento.',
    };
  }

  if (declaredSize !== storedSize) {
    return {
      ok: false,
      reason: 'SIZE_MISMATCH',
      message: `O tamanho do arquivo armazenado (${storedSize} bytes) difere do enviado (${declaredSize} bytes).`,
    };
  }

  // Só comparamos checksums quando o storage realmente fornece um. Alguns
  // backends S3 não calculam SHA-256, e exigir isso inviabilizaria a operação.
  if (storedChecksum && storedChecksum.toLowerCase() !== declaredChecksum.toLowerCase()) {
    return {
      ok: false,
      reason: 'HASH_MISMATCH',
      message:
        'O conteúdo do arquivo armazenado não corresponde ao enviado. Reenvie o arquivo.',
    };
  }

  return { ok: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conteúdo mínimo da submissão
// ───────────────────────────────────────────────────────────────────────────────
export const MIN_TITLE_LENGTH = 8;
export const MAX_TITLE_LENGTH = 300;
export const MIN_ABSTRACT_LENGTH = 150;
export const MAX_ABSTRACT_LENGTH = 5000;
export const MIN_KEYWORDS = 3;
export const MAX_KEYWORDS = 8;

export type ContentValidationError = {
  field: 'title' | 'abstract' | 'keywords' | 'language';
  code: 'TOO_SHORT' | 'TOO_LONG' | 'TOO_FEW' | 'TOO_MANY' | 'INVALID';
  message: string;
};

export type ContentValidation =
  | { valid: true }
  | { valid: false; errors: ContentValidationError[] };

/** Idioma aceito para o texto submetido (BCP-47 simplificado). */
const SUPPORTED_LANGUAGES = new Set(['pt-BR', 'en', 'es']);

/**
 * Valida o conteúdo textual de uma submissão.
 *
 * O resumo mínimo de 150 caracteres não é burocracia: um resumo muito curto
 * torna impossível avaliar o trabalho, e o revisor acaba recusando por falta de
 * informação em vez de por mérito.
 */
export function validateSubmissionContent(input: {
  title: string;
  abstract: string;
  keywords: readonly string[];
  language: string;
}): ContentValidation {
  const errors: ContentValidationError[] = [];

  const title = input.title.trim();
  if (title.length < MIN_TITLE_LENGTH) {
    errors.push({
      field: 'title',
      code: 'TOO_SHORT',
      message: `O título deve ter ao menos ${MIN_TITLE_LENGTH} caracteres.`,
    });
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.push({
      field: 'title',
      code: 'TOO_LONG',
      message: `O título deve ter no máximo ${MAX_TITLE_LENGTH} caracteres.`,
    });
  }

  const abstract = input.abstract.trim();
  if (abstract.length < MIN_ABSTRACT_LENGTH) {
    errors.push({
      field: 'abstract',
      code: 'TOO_SHORT',
      message: `O resumo deve ter ao menos ${MIN_ABSTRACT_LENGTH} caracteres para permitir avaliação.`,
    });
  } else if (abstract.length > MAX_ABSTRACT_LENGTH) {
    errors.push({
      field: 'abstract',
      code: 'TOO_LONG',
      message: `O resumo deve ter no máximo ${MAX_ABSTRACT_LENGTH} caracteres.`,
    });
  }

  // Normaliza palavras-chave: remove vazias e duplicatas (ignorando caixa).
  const seen = new Set<string>();
  const uniqueKeywords: string[] = [];
  for (const keyword of input.keywords) {
    const trimmed = keyword.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueKeywords.push(trimmed);
  }

  if (uniqueKeywords.length < MIN_KEYWORDS) {
    errors.push({
      field: 'keywords',
      code: 'TOO_FEW',
      message: `Informe ao menos ${MIN_KEYWORDS} palavras-chave distintas.`,
    });
  } else if (uniqueKeywords.length > MAX_KEYWORDS) {
    errors.push({
      field: 'keywords',
      code: 'TOO_MANY',
      message: `Informe no máximo ${MAX_KEYWORDS} palavras-chave.`,
    });
  }

  if (!SUPPORTED_LANGUAGES.has(input.language)) {
    errors.push({
      field: 'language',
      code: 'INVALID',
      message: 'Idioma não suportado. Use pt-BR, en ou es.',
    });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Prontidão para envio
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmissionReadinessInput {
  title: string;
  abstract: string;
  keywords: readonly string[];
  language: string;
  trackId?: string | null;
  /** Artefatos já confirmados (com integridade verificada). */
  files: readonly { kind: SubmissionFileKind; checksum: string | null }[];
  /** A trilha exige versão cega? */
  requiresBlindReview: boolean;
  /** Ao menos um autor precisa ter sido informado. */
  authorCount: number;
}

export interface SubmissionReadiness {
  ready: boolean;
  blockers: readonly string[];
  warnings: readonly string[];
}

/**
 * A submissão pode ser enviada?
 *
 * Separa BLOQUEIOS (impedem o envio) de AVISOS (o autor pode prosseguir, mas
 * merece saber). Misturar os dois faz o autor ignorar a lista inteira.
 */
export function evaluateSubmissionReadiness(
  input: SubmissionReadinessInput,
): SubmissionReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const content = validateSubmissionContent({
    title: input.title,
    abstract: input.abstract,
    keywords: input.keywords,
    language: input.language,
  });

  if (!content.valid) {
    for (const error of content.errors) {
      blockers.push(error.message);
    }
  }

  if (!input.trackId) {
    blockers.push('Selecione a trilha temática da submissão.');
  }

  if (input.authorCount === 0) {
    blockers.push('Informe ao menos um autor.');
  }

  // ── Artefato obrigatório ───────────────────────────────────────────────────
  const confirmed = input.files.filter((file) => file.checksum !== null);
  const hasBlind = confirmed.some((file) => file.kind === 'BLIND_PDF');
  const hasIdentified = confirmed.some((file) => file.kind === 'IDENTIFIED_PDF');

  if (input.requiresBlindReview) {
    if (!hasBlind) {
      blockers.push(
        'A trilha exige revisão cega: anexe a versão sem identificação dos autores.',
      );
    }
    if (!hasIdentified) {
      // A versão identificada é necessária para a publicação final, mas não
      // impede a avaliação — por isso é aviso, não bloqueio.
      warnings.push(
        'A versão com identificação dos autores ainda não foi anexada. Ela será necessária para a publicação.',
      );
    }
  } else if (!hasBlind && !hasIdentified) {
    blockers.push('Anexe o arquivo do trabalho em PDF.');
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}

/**
 * O artefato pode ser substituído?
 *
 * Depois de enviada, a substituição cria uma versão nova — nunca sobrepõe, para
 * que o parecer continue apontando para o arquivo que foi efetivamente avaliado.
 */
export function fileReplacementCreatesVersion(status: SubmissionStatus): boolean {
  return status !== 'DRAFT';
}
