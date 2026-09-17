/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE APLICAÇÃO — Submissões de trabalhos
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FLUXO DE UPLOAD, EM TRÊS ETAPAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. `requestUpload`   reserva a chave e devolve a URL pré-assinada
 *      2. (navegador envia o PDF direto ao storage)
 *      3. `confirmUpload`   confere o objeto e registra o artefato
 *
 *  A etapa 3 é o que transforma um upload em um ARTEFATO ACEITO: sem ela, um
 *  arquivo no bucket não passa de um blob sem proveniência. Só depois da
 *  confirmação a submissão pode ser enviada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VERSÃO IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Reenviar o arquivo depois do envio NÃO sobrescreve: cria uma versão nova e
 *  marca a anterior como não-corrente. O parecer aponta para a versão que o
 *  revisor efetivamente leu, então preservar o histórico é o que mantém a
 *  avaliação auditável.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomBytes } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import {
  BUCKETS,
  buildObjectKey,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  inspectObject,
} from '@/lib/storage/s3-client';
import {
  MAX_FILE_SIZE_BYTES,
  evaluateSubmissionReadiness,
  fileReplacementCreatesVersion,
  isEditableByAuthor,
  requiresNewVersionForResubmission,
  validateSubmissionFile,
  verifyStoredObject,
  type SubmissionFileKind,
  type SubmissionStatus,
} from '@/domain/review/submission-rules';
import {
  DEFAULT_RUBRIC,
  canAccessSubmissionFile,
  parseRubric,
  type RubricCriterion,
  type ViewerRole,
} from '@/domain/review/review-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  Erros
// ───────────────────────────────────────────────────────────────────────────────
export type SubmissionErrorCode =
  | 'NOT_FOUND'
  | 'NOT_EDITABLE'
  | 'INVALID_TRANSITION'
  | 'FILE_INVALID'
  | 'INTEGRITY_FAILED'
  | 'UPLOAD_MISSING'
  | 'TRACK_NOT_FOUND'
  | 'TRACK_LIMIT_REACHED'
  | 'CFP_CLOSED'
  | 'NOT_READY'
  | 'FORBIDDEN'
  | 'INTERNAL';

export class SubmissionError extends Error {
  constructor(
    readonly code: SubmissionErrorCode,
    message: string,
    readonly details?: readonly string[],
  ) {
    super(message);
    this.name = 'SubmissionError';
  }
}

export type Result<T> =
  | ({ ok: true } & T)
  | { ok: false; code: SubmissionErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Protocolo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Gera o protocolo público da submissão.
 *
 * Formato: `AAAAT-XXXX` (ano + 4 caracteres). Legível o suficiente para o autor
 * citar por telefone, e o ano facilita o suporte localizar a edição.
 *
 * O alfabeto EXCLUI caracteres ambíguos (`I`, `O`, `0`, `1`) — um protocolo é
 * frequentemente lido em voz alta ou copiado à mão, e confundir `0` com `O`
 * gera chamados de suporte evitáveis.
 */
const PROTOCOL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateProtocol(year: number, entropy: () => number = Math.random): string {
  let suffix = '';
  for (let index = 0; suffix.length < 4; index += 1) {
    const value = entropy();
    if (!Number.isFinite(value) || value < 0 || value >= 1) continue;
    suffix += PROTOCOL_ALPHABET[Math.floor(value * PROTOCOL_ALPHABET.length)];
  }
  return `${year}-${suffix}`;
}

/** Protocolo a partir de bytes aleatórios criptograficamente seguros. */
export function secureProtocol(year: number): string {
  const bytes = randomBytes(4);
  let suffix = '';
  for (let index = 0; index < 4; index += 1) {
    suffix += PROTOCOL_ALPHABET[bytes[index]! % PROTOCOL_ALPHABET.length];
  }
  return `${year}-${suffix}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criação
// ───────────────────────────────────────────────────────────────────────────────
export interface CreateSubmissionInput {
  tenantId: string;
  eventId: string;
  trackId: string;
  userId: string;
  title: string;
  abstract: string;
  keywords: readonly string[];
  language?: string;
}

export interface CreateSubmissionResult {
  id: string;
  protocol: string;
  status: SubmissionStatus;
}

/**
 * Cria uma submissão em RASCUNHO.
 *
 * O rascunho é o estado natural de entrada: o autor precisa poder salvar e
 * voltar antes de enviar. A validação completa acontece no envio
 * (`submitSubmission`), não aqui — bloquear a criação impediria o trabalho
 * incremental, que é como submissões realmente são escritas.
 */
export async function createSubmission(
  input: CreateSubmissionInput,
): Promise<Result<CreateSubmissionResult>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const track = await tx.track.findFirst({
        where: { id: input.trackId, eventId: input.eventId, deletedAt: null },
        select: {
          id: true,
          maxSubmissionsPerAuthor: true,
          reviewRubric: true,
          requiresBlindReview: true,
        },
      });

      if (!track) {
        throw new SubmissionError('TRACK_NOT_FOUND', 'Trilha não encontrada.');
      }

      // ── Limite de submissões por autor ─────────────────────────────────────
      const maxPerAuthor = track.maxSubmissionsPerAuthor;
      if (maxPerAuthor > 0) {
        const existing = await tx.submission.count({
          where: {
            trackId: track.id,
            submittedById: input.userId,
            deletedAt: null,
            status: { notIn: ['WITHDRAWN', 'CANCELED', 'REJECTED'] },
          },
        });

        if (existing >= maxPerAuthor) {
          throw new SubmissionError(
            'TRACK_LIMIT_REACHED',
            `Limite de ${maxPerAuthor} submissão(ões) por autor nesta trilha já foi atingido.`,
          );
        }
      }

      const id = crypto.randomUUID();
      const protocol = await allocateProtocol(tx, input.tenantId, id);

      const created = await tx.submission.create({
        data: {
          id,
          tenantId: input.tenantId,
          eventId: input.eventId,
          trackId: track.id,
          protocol,
          title: input.title.trim(),
          abstract: input.abstract.trim(),
          keywords: [...input.keywords],
          language: input.language ?? 'pt-BR',
          status: 'DRAFT',
          submittedById: input.userId,
          version: 1,
        },
        select: { id: true, protocol: true, status: true },
      });

      /**
       * ─── O AUTOR CORRESPONDENTE É SEMPRE O PRIMEIRO AUTOR ─────────────────
       * Quem submete É autor do trabalho. Sem este registro, a validação de
       * prontidão bloquearia o envio com "informe ao menos um autor" — e o autor
       * teria de se adicionar manualmente à própria submissão, o que é absurdo.
       *
       * A lista de autoria é editável depois (coautores, ordem de crédito), mas
       * o ponto de partida precisa ser coerente com quem está submetendo.
       */
      await tx.submissionAuthor.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          submissionId: created.id,
          // `userId` é nulo quando o autor não tem conta na plataforma; aqui
          // temos o id de quem está autenticado, então vinculamos.
          userId: input.userId,
          authorOrder: 1,
          isCorresponding: true,
        },
      });

      return {
        ok: true as const,
        id: created.id,
        protocol: created.protocol,
        status: created.status as SubmissionStatus,
      };
    });
  } catch (error) {
    return toFailure('createSubmission', error);
  }
}

/**
 * Aloca um protocolo único.
 *
 * Tenta até 10 vezes: a colisão é improvável (32^4 ≈ 1 milhão de combinações por
 * ano), mas o índice único `(tenantId, protocol)` é a garantia definitiva — e é
 * melhor tentar de novo do que devolver erro ao autor por azar.
 */
async function allocateProtocol(
  tx: TxClient,
  tenantId: string,
  submissionId: string,
): Promise<string> {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = secureProtocol(year);
    const existing = await tx.submission.findFirst({
      where: { tenantId, protocol: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  // Último recurso: deriva do id (que é UUID) — colisão impossível na prática.
  return `${year}-${submissionId.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Upload — etapa 1
// ───────────────────────────────────────────────────────────────────────────────
export interface RequestUploadInput {
  tenantId: string;
  submissionId: string;
  userId: string;
  kind: SubmissionFileKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Checksum SHA-256 calculado pelo cliente (hex). */
  checksum: string;
  /** Bytes iniciais do arquivo, quando o cliente consegue enviá-los. */
  magicBytes?: readonly number[] | null;
}

export interface RequestUploadResult {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
  /** Versão reservada para este artefato. */
  version: number;
}

/**
 * Etapa 1 — reserva a chave do objeto e devolve a URL pré-assinada.
 *
 * A validação de formato e tamanho acontece AQUI, antes de o arquivo sair da
 * máquina do autor: gastar banda para depois recusar é ruim para quem tem
 * conexão lenta e é uma forma gratuita de abuso do storage.
 */
export async function requestUpload(
  input: RequestUploadInput,
): Promise<Result<RequestUploadResult>> {
  try {
    // ── Validação de formato ANTES de qualquer chamada ao storage ────────────
    const fileCheck = validateSubmissionFile({
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      magicBytes: input.magicBytes ?? null,
    });

    if (!fileCheck.valid) {
      throw new SubmissionError(
        'FILE_INVALID',
        fileCheck.errors[0]?.message ?? 'Arquivo inválido.',
        fileCheck.errors.map((error) => error.message),
      );
    }

    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: { id: true, eventId: true, status: true, version: true },
      });

      if (!submission) {
        throw new SubmissionError('NOT_FOUND', 'Submissão não encontrada.');
      }

      // ── Versão do artefato ─────────────────────────────────────────────────
      // Em rascunho, substitui a versão existente. Depois do envio, incrementa.
      const previous = await tx.submissionFile.findFirst({
        where: { submissionId: submission.id, kind: input.kind },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      const createsVersion = fileReplacementCreatesVersion(
        submission.status as SubmissionStatus,
      );
      const version = previous ? (createsVersion ? previous.version + 1 : previous.version) : 1;

      const bucket = BUCKETS.submissions();
      const objectKey = buildObjectKey({
        tenantId: input.tenantId,
        eventId: submission.eventId,
        submissionId: submission.id,
        kind: input.kind,
        version,
        fileName: input.fileName,
      });

      const ticket = await createUploadUrl({
        bucket,
        objectKey,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
      });

      return {
        ok: true as const,
        uploadUrl: ticket.uploadUrl,
        objectKey: ticket.objectKey,
        bucket: ticket.bucket,
        requiredHeaders: ticket.requiredHeaders,
        expiresInSeconds: ticket.expiresInSeconds,
        version,
      };
    });
  } catch (error) {
    return toFailure('requestUpload', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Upload — etapa 3
// ───────────────────────────────────────────────────────────────────────────────
export interface ConfirmUploadInput {
  tenantId: string;
  submissionId: string;
  userId: string;
  kind: SubmissionFileKind;
  objectKey: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  version: number;
}

export interface ConfirmUploadResult {
  fileId: string;
  version: number;
  sizeBytes: number;
  checksum: string;
}

/**
 * Etapa 3 — confere o objeto e registra o artefato.
 *
 * A ordem é deliberada: primeiro INSPECIONA o storage, depois valida, e só então
 * grava. Registrar antes de conferir deixaria uma linha apontando para um objeto
 * que talvez não exista — o pior tipo de inconsistência, porque só aparece no
 * momento em que alguém tenta abrir o arquivo.
 *
 * Quando a integridade falha, o objeto É REMOVIDO do bucket: manter um blob
 * órfão que sabemos ser inválido só acumula lixo e superfície de confusão.
 */
export async function confirmUpload(
  input: ConfirmUploadInput,
): Promise<Result<ConfirmUploadResult>> {
  try {
    const stored = await inspectObject(input.bucket, input.objectKey);

    if (!stored.exists) {
      throw new SubmissionError(
        'UPLOAD_MISSING',
        'O arquivo não foi encontrado no armazenamento. O envio pode ter falhado.',
      );
    }

    const integrity = verifyStoredObject({
      declaredSize: input.sizeBytes,
      storedSize: stored.sizeBytes,
      declaredChecksum: input.checksum,
      storedChecksum: stored.checksum,
    });

    if (!integrity.ok) {
      // Descarta o objeto inválido antes de falhar.
      await deleteObject(input.bucket, input.objectKey).catch(() => {
        // Se a remoção falhar, o erro de integridade continua sendo a resposta —
        // a limpeza é melhor-esforço.
      });

      throw new SubmissionError('INTEGRITY_FAILED', integrity.message);
    }

    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: { id: true, status: true },
      });

      if (!submission) {
        throw new SubmissionError('NOT_FOUND', 'Submissão não encontrada.');
      }

      /**
       * ─── IDEMPOTÊNCIA DA CONFIRMAÇÃO ──────────────────────────────────────
       * Se este MESMO objeto já foi confirmado, devolvemos o registro existente.
       *
       * Acontece de verdade: uma resposta de rede perdida faz o navegador repetir
       * a confirmação. Sem esta checagem, a segunda tentativa colidiria com o
       * índice único `(submissionId, kind, version)` e o autor veria um erro
       * para uma operação que, na prática, já havia dado certo.
       *
       * A comparação é pela CHAVE do objeto: reconfirmar o mesmo upload é
       * idempotente, mas confirmar um objeto DIFERENTE gera versão nova.
       */
      const existing = await tx.submissionFile.findFirst({
        where: { submissionId: submission.id, storageKey: input.objectKey },
        select: {
          id: true,
          version: true,
          sizeBytes: true,
          checksum: true,
        },
      });

      if (existing) {
        return {
          ok: true as const,
          fileId: existing.id,
          version: existing.version,
          sizeBytes: Number(existing.sizeBytes),
          checksum: existing.checksum,
        };
      }

      // ── Marca as versões anteriores como não-correntes ─────────────────────
      // `isCurrent` existe para que "o arquivo atual" seja uma consulta direta,
      // sem depender de ordenação por versão em cada leitura.
      await tx.submissionFile.updateMany({
        where: { submissionId: submission.id, kind: input.kind, isCurrent: true },
        data: { isCurrent: false },
      });

      const file = await tx.submissionFile.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: input.tenantId,
          submissionId: submission.id,
          kind: input.kind,
          storageKey: input.objectKey,
          bucket: input.bucket,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          checksum: input.checksum.toLowerCase(),
          version: input.version,
          isCurrent: true,
          // Sem antivírus configurado nesta fase: marcamos como ignorado em vez
          // de "limpo", para não afirmar algo que não verificamos.
          scanStatus: 'SKIPPED',
          uploadedById: input.userId,
        },
        select: { id: true, version: true, sizeBytes: true, checksum: true },
      });

      return {
        ok: true as const,
        fileId: file.id,
        version: file.version,
        sizeBytes: Number(file.sizeBytes),
        checksum: file.checksum,
      };
    });
  } catch (error) {
    return toFailure('confirmUpload', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Envio
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmitInput {
  tenantId: string;
  submissionId: string;
  userId: string;
}

/**
 * Envia a submissão para avaliação.
 *
 * Aqui roda a validação COMPLETA (`evaluateSubmissionReadiness`): conteúdo
 * mínimo, trilha, autores e o artefato obrigatório conforme a trilha exija
 * revisão cega ou não.
 *
 * O `blindSnapshot` é gravado no envio: é o retrato da autoria naquele instante,
 * e é dele que a revisão cega remove a identificação.
 */
export async function submitSubmission(
  input: SubmitInput,
): Promise<Result<{ status: SubmissionStatus; submittedAt: Date }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, deletedAt: null },
        select: {
          id: true,
          status: true,
          title: true,
          abstract: true,
          keywords: true,
          language: true,
          trackId: true,
          submittedById: true,
          files: {
            where: { isCurrent: true, deletedAt: null },
            select: { kind: true, checksum: true },
          },
          authors: {
            select: {
              authorOrder: true,
              userId: true,
              guestName: true,
              guestEmail: true,
              guestInstitution: true,
              guestOrcidId: true,
              institution: true,
              isCorresponding: true,
            },
          },
          track: { select: { requiresBlindReview: true } },
        },
      });

      if (!submission) {
        throw new SubmissionError('NOT_FOUND', 'Submissão não encontrada.');
      }

      if (submission.submittedById !== input.userId) {
        throw new SubmissionError(
          'FORBIDDEN',
          'Apenas o autor correspondente pode enviar esta submissão.',
        );
      }

      const currentStatus = submission.status as SubmissionStatus;
      if (!isEditableByAuthor(currentStatus)) {
        throw new SubmissionError(
          'NOT_EDITABLE',
          'Esta submissão não está em um estado que permita envio.',
        );
      }

      // ── Validação completa ────────────────────────────────────────────────
      const readiness = evaluateSubmissionReadiness({
        title: submission.title,
        abstract: submission.abstract,
        keywords: submission.keywords,
        language: submission.language,
        trackId: submission.trackId,
        files: submission.files.map((file) => ({
          kind: file.kind as SubmissionFileKind,
          checksum: file.checksum,
        })),
        requiresBlindReview: submission.track?.requiresBlindReview ?? true,
        authorCount: submission.authors.length,
      });

      if (!readiness.ready) {
        throw new SubmissionError(
          'NOT_READY',
          'A submissão está incompleta.',
          readiness.blockers,
        );
      }

      // ── Snapshot da autoria ───────────────────────────────────────────────
      // Guardado junto ao envio. É a fonte da versão cega: removemos estes
      // dados da resposta destinada ao revisor.
      const blindSnapshot = {
        capturedAt: new Date().toISOString(),
        authors: submission.authors
          .sort((a, b) => a.authorOrder - b.authorOrder)
          .map((author) => ({
            order: author.authorOrder,
            userId: author.userId,
            name: author.guestName,
            email: author.guestEmail,
            institution: author.institution ?? author.guestInstitution,
            orcidId: author.guestOrcidId,
            isCorresponding: author.isCorresponding,
          })),
      };

      const submittedAt = new Date();

      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: 'SUBMITTED',
          submittedAt,
          blindSnapshot,
        },
      });

      return { ok: true as const, status: 'SUBMITTED' as SubmissionStatus, submittedAt };
    });
  } catch (error) {
    return toFailure('submitSubmission', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura
// ───────────────────────────────────────────────────────────────────────────────
export interface SubmissionFileView {
  id: string;
  kind: SubmissionFileKind;
  fileName: string;
  sizeBytes: number;
  checksum: string;
  version: number;
  isCurrent: boolean;
  storageKey: string;
  bucket: string;
}

export interface SubmissionDetail {
  id: string;
  protocol: string;
  title: string;
  abstract: string;
  keywords: string[];
  language: string;
  status: SubmissionStatus;
  version: number;
  submittedAt: Date | null;
  trackId: string | null;
  trackName: string | null;
  requiresBlindReview: boolean;
  eventId: string;
  files: SubmissionFileView[];
  authors: {
    order: number;
    userId: string | null;
    name: string | null;
    email: string | null;
    institution: string | null;
    isCorresponding: boolean;
  }[];
  finalScore: number | null;
  decisionAt: Date | null;
  decisionNotes: string | null;
}

/** Rubrica efetiva da trilha (ou a padrão, quando a trilha não define uma). */
export async function resolveRubric(
  tenantId: string,
  trackId: string | null,
): Promise<readonly RubricCriterion[]> {
  if (!trackId) return DEFAULT_RUBRIC;

  const track = await withTenant(tenantId, (tx) =>
    tx.track.findFirst({
      where: { id: trackId },
      select: { reviewRubric: true },
    }),
  );

  return parseRubric(track?.reviewRubric).rubric;
}

/** Detalhe completo de uma submissão, sob RLS. */
export async function getSubmission(
  tenantId: string,
  submissionId: string,
  options: { onlyCurrentFiles?: boolean } = {},
): Promise<SubmissionDetail | null> {
  const submission = await withTenant(tenantId, (tx) =>
    tx.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      select: {
        id: true,
        protocol: true,
        title: true,
        abstract: true,
        keywords: true,
        language: true,
        status: true,
        version: true,
        submittedAt: true,
        trackId: true,
        eventId: true,
        finalScore: true,
        decisionAt: true,
        decisionNotes: true,
        track: { select: { name: true, requiresBlindReview: true } },
        files: {
          where: {
            deletedAt: null,
            ...(options.onlyCurrentFiles ? { isCurrent: true } : {}),
          },
          orderBy: [{ kind: 'asc' }, { version: 'desc' }],
          select: {
            id: true,
            kind: true,
            fileName: true,
            sizeBytes: true,
            checksum: true,
            version: true,
            isCurrent: true,
            storageKey: true,
            bucket: true,
          },
        },
        authors: {
          orderBy: { authorOrder: 'asc' },
          select: {
            authorOrder: true,
            userId: true,
            guestName: true,
            guestEmail: true,
            guestInstitution: true,
            institution: true,
            isCorresponding: true,
          },
        },
      },
    }),
  );

  if (!submission) return null;

  return {
    id: submission.id,
    protocol: submission.protocol,
    title: submission.title,
    abstract: submission.abstract,
    keywords: submission.keywords,
    language: submission.language,
    status: submission.status as SubmissionStatus,
    version: submission.version,
    submittedAt: submission.submittedAt,
    trackId: submission.trackId,
    trackName: submission.track?.name ?? null,
    requiresBlindReview: submission.track?.requiresBlindReview ?? true,
    eventId: submission.eventId,
    files: submission.files.map((file) => ({
      id: file.id,
      kind: file.kind as SubmissionFileKind,
      fileName: file.fileName,
      sizeBytes: Number(file.sizeBytes),
      checksum: file.checksum,
      version: file.version,
      isCurrent: file.isCurrent,
      storageKey: file.storageKey,
      bucket: file.bucket,
    })),
    authors: submission.authors.map((author) => ({
      order: author.authorOrder,
      userId: author.userId,
      name: author.guestName,
      email: author.guestEmail,
      institution: author.institution ?? author.guestInstitution,
      isCorresponding: author.isCorresponding,
    })),
    finalScore: submission.finalScore ? Number(submission.finalScore) : null,
    decisionAt: submission.decisionAt,
    decisionNotes: submission.decisionNotes,
  };
}

/** Submissões do autor autenticado nesta instituição. */
export async function listMySubmissions(
  tenantId: string,
  userId: string,
): Promise<
  {
    id: string;
    protocol: string;
    title: string;
    status: SubmissionStatus;
    submittedAt: Date | null;
    trackName: string | null;
    eventTitle: string;
  }[]
> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.submission.findMany({
      where: { submittedById: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        protocol: true,
        title: true,
        status: true,
        submittedAt: true,
        track: { select: { name: true } },
        event: { select: { title: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    protocol: row.protocol,
    title: row.title,
    status: row.status as SubmissionStatus,
    submittedAt: row.submittedAt,
    trackName: row.track?.name ?? null,
    eventTitle: row.event.title,
  }));
}

/** URL assinada de download de um artefato. Validade curta. */
/**
 * Emite a URL de download de um artefato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O `viewer` É OBRIGATÓRIO — E ISSO É A GARANTIA
 * ─────────────────────────────────────────────────────────────────────────────
 *  A regra da revisão cega é aplicada aqui, e não apenas na página que monta a
 *  lista de arquivos. Se ela vivesse só na UI, qualquer novo ponto de uso
 *  (um route handler de download, um e-mail com link, um relatório) poderia
 *  emitir uma URL assinada para a versão IDENTIFICADA — e uma URL assinada é
 *  acesso direto ao objeto, sem passar de novo pela aplicação.
 *
 *  Exigir o par (papel, sigilo) na assinatura torna impossível esquecer: o
 *  compilador cobra a decisão.
 */
export async function getFileDownloadUrl(
  tenantId: string,
  fileId: string,
  viewer: { role: ViewerRole; isBlind: boolean },
): Promise<Result<{ url: string; fileName: string; expiresInSeconds: number }>> {
  try {
    const file = await withTenant(tenantId, (tx) =>
      tx.submissionFile.findFirst({
        where: { id: fileId, deletedAt: null },
        select: { bucket: true, storageKey: true, fileName: true, kind: true },
      }),
    );

    if (!file) {
      throw new SubmissionError('NOT_FOUND', 'Arquivo não encontrado.');
    }

    if (
      !canAccessSubmissionFile({
        kind: file.kind as SubmissionFileKind,
        viewerRole: viewer.role,
        isBlind: viewer.isBlind,
      })
    ) {
      throw new SubmissionError(
        'FORBIDDEN',
        'Este arquivo não está disponível para você nesta avaliação.',
      );
    }

    const url = await createDownloadUrl({
      bucket: file.bucket,
      objectKey: file.storageKey,
      fileName: file.fileName,
    });

    return { ok: true as const, url, fileName: file.fileName, expiresInSeconds: 300 };
  } catch (error) {
    return toFailure('getFileDownloadUrl', error);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Conversão de erro
// ───────────────────────────────────────────────────────────────────────────────
function toFailure<T>(operation: string, error: unknown): Result<T> & { ok: false } {
  if (error instanceof SubmissionError) {
    return {
      ok: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  console.error(
    `[submission] falha inesperada em ${operation}:`,
    error instanceof Error ? error.message : error,
  );

  return {
    ok: false,
    code: 'INTERNAL',
    message: 'Não foi possível concluir a operação. Tente novamente.',
  };
}

export { MAX_FILE_SIZE_BYTES, requiresNewVersionForResubmission };
