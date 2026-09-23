/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Materiais de apoio do palestrante (FASE 25, item E20)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MESMO FLUXO EM TRÊS ETAPAS DO RESTO DA PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. `requestMaterialUpload` → URL assinada, com tipo e TAMANHO travados
 *      2. (navegador → storage, fora da aplicação)
 *      3. `confirmMaterialUpload` → confere o objeto e cria o registro
 *
 *  O arquivo não passa pelo processo Node porque uma apresentação de 25 MB na
 *  memória do servidor é exatamente o problema que o upload direto resolve (mesma
 *  decisão da FASE 4 e da FASE 17). O que a aplicação NÃO vê é o conteúdo — por isso
 *  a confirmação lê o objeto de volta e confere tamanho e checksum antes de gravar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O MATERIAL USA O BUCKET PRIVADO DE DOCUMENTOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Slides trazem dado que não é público por natureza (um estudo de caso com
 *  paciente, um contrato em anexo). O bucket de imagens é PÚBLICO e serve a página
 *  — material não pode ir para lá.
 *
 *  Um bucket novo (`eventflow-materials`) seria mais explícito, mas teria de existir
 *  em toda instalação ANTES do primeiro upload: uma variável de ambiente a mais e um
 *  provisionamento a mais em cada deploy, para a mesma garantia (nenhum bucket de
 *  conteúdo é público; o download é sempre por URL assinada). O prefixo
 *  `.../palestrantes/...` dentro do bucket privado mantém os dois tipos de documento
 *  separáveis para ciclo de vida e para remoção por LGPD.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  BUCKETS,
  createDownloadUrl,
  createUploadUrl,
  deleteObject,
  inspectObject,
  sanitizeFileName,
  UPLOAD_URL_TTL_SECONDS,
} from '@/lib/storage/s3-client';
import { isSha256Hex, verifyStoredObject } from '@/domain/review/submission-rules';
import { ensureStorageRoom } from '@/lib/storage/storage-quota';
import { isScanningEnabled } from '@/lib/storage/scan-service';
import { canServeFile, initialScanStatus } from '@/domain/review/file-scan-rules';
import { formatBytes } from '@/domain/events/image-rules';
import {
  canAccessMaterial,
  canonicalMaterialExtension,
  MATERIAL_KINDS,
  MATERIAL_VISIBILITIES,
  MATERIAL_MIME_TYPES,
  MAX_MATERIAL_BYTES,
  validateExternalMaterialUrl,
  validateMaterialUpload,
  type MaterialKind,
  type MaterialMimeType,
  type MaterialViewer,
  type MaterialVisibility,
} from '@/domain/speakers/speaker-rules';

export type MaterialErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_INPUT'
  | 'INTEGRITY'
  /** A instituição esgotou a quota de armazenamento do plano (FASE 21). */
  | 'QUOTA_EXCEEDED'
  | 'STORAGE'
  | 'INTERNAL';

export type MaterialResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: MaterialErrorCode; message: string; details?: readonly string[] };

/** Bucket privado dos documentos do evento (ver o bloco do topo). */
export function materialBucket(): string {
  return BUCKETS.submissions();
}

/**
 * Chave do objeto.
 *
 * O identificador único fica no INÍCIO do nome: dois envios de `slides.pdf` não
 * colidem, e o segundo não sobrescreve o primeiro — o que deixaria o material antigo
 * apontando para o arquivo novo.
 */
export function buildMaterialObjectKey(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  mimeType: MaterialMimeType;
  fileName: string;
}): string {
  const base = sanitizeFileName(input.fileName).replace(/\.[a-z0-9]{2,5}$/i, '');
  const extension = canonicalMaterialExtension(input.mimeType);

  return [
    'tenants',
    input.tenantId,
    'eventos',
    input.eventId,
    'palestrantes',
    input.activityId,
    `${randomUUID()}-${base || 'material'}.${extension}`,
  ].join('/');
}

function materialPrefix(tenantId: string, eventId: string, activityId: string): string {
  return `tenants/${tenantId}/eventos/${eventId}/palestrantes/${activityId}/`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Etapa 1 — URL pré-assinada
// ───────────────────────────────────────────────────────────────────────────────
export interface MaterialUploadTicket {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  requiredHeaders: Record<string, string>;
  expiresInSeconds: number;
  mimeType: MaterialMimeType;
  maxBytes: number;
}

export async function requestMaterialUpload(input: {
  tenantId: string;
  eventId: string;
  activityId: string;
  speakerProfileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  magicBytes?: readonly number[] | null;
}): Promise<MaterialResult<MaterialUploadTicket>> {
  const validation = validateMaterialUpload({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    magicBytes: input.magicBytes ?? null,
  });

  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: validation.errors[0]?.message ?? 'Material não aceito.',
      details: validation.errors.map((error) => error.message),
    };
  }

  try {
    /**
     * O vínculo é conferido ANTES de assinar a URL: sem isso, uma atividade de outra
     * instituição (ou de outro evento) receberia um upload. A chave do objeto já
     * carrega o `tenantId`, mas assinar para um alvo inexistente deixaria um objeto
     * órfão no bucket — pago e sem dono.
     */
    const link = await withTenant(input.tenantId, (tx) =>
      tx.activitySpeaker.findFirst({
        where: {
          tenantId: input.tenantId,
          activityId: input.activityId,
          speakerProfileId: input.speakerProfileId,
          activity: { eventId: input.eventId, deletedAt: null },
        },
        select: { id: true },
      }),
    );

    if (!link) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Você não consta como ministrante desta atividade.',
      };
    }

    const objectKey = buildMaterialObjectKey({
      tenantId: input.tenantId,
      eventId: input.eventId,
      activityId: input.activityId,
      mimeType: validation.mimeType,
      fileName: input.fileName,
    });

    /**
     * A quota do plano é conferida ANTES de assinar a URL (FASE 21): o material é uma
     * adição (cada envio é um objeto novo, com o próprio registro), e recusar depois
     * deixaria o arquivo no bucket sem dono.
     */
    const room = await ensureStorageRoom({
      tenantId: input.tenantId,
      incomingBytes: input.sizeBytes,
    });

    if (!room.ok) {
      return {
        ok: false,
        code: 'QUOTA_EXCEEDED',
        message: room.message,
        details: [
          `A instituição ocupa ${formatBytes(room.usage.totalBytes)} de ${formatBytes(room.usage.maxBytes ?? 0)}.`,
        ],
      };
    }

    const bucket = materialBucket();

    const ticket = await createUploadUrl({
      bucket,
      objectKey,
      contentType: validation.mimeType,
      contentLength: input.sizeBytes,
    });

    return {
      ok: true,
      uploadUrl: ticket.uploadUrl,
      objectKey: ticket.objectKey,
      bucket: ticket.bucket,
      requiredHeaders: ticket.requiredHeaders,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      mimeType: validation.mimeType,
      maxBytes: validation.maxBytes,
    };
  } catch (error) {
    console.error(`[materials] falha ao preparar upload: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível preparar o envio do material.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Etapa 3 — confirmação
// ───────────────────────────────────────────────────────────────────────────────
export interface ConfirmMaterialInput {
  tenantId: string;
  actorId: string;
  eventId: string;
  activityId: string;
  speakerProfileId: string;
  title: string;
  description?: string | null;
  kind: string;
  visibility: string;
  objectKey: string;
  bucket: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

export async function confirmMaterialUpload(
  input: ConfirmMaterialInput,
): Promise<MaterialResult<{ materialId: string; objectKey: string }>> {
  if (!isSha256Hex(input.checksum)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Checksum SHA-256 inválido.' };
  }

  if (input.bucket !== materialBucket()) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Bucket de destino não permitido.' };
  }

  /**
   * A chave vem do cliente (foi ele que a recebeu), então é conferida contra o
   * prefixo da instituição/evento/atividade. Sem isso, uma chave arbitrária viraria
   * o material da atividade — e o organizador publicaria o PDF de outra pessoa.
   */
  if (!input.objectKey.startsWith(materialPrefix(input.tenantId, input.eventId, input.activityId))) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A chave do objeto não corresponde a esta instituição, evento e atividade.',
    };
  }

  const meta = validateMaterialMeta(input);
  if (!meta.ok) return meta;

  try {
    const link = await withTenant(input.tenantId, (tx) =>
      tx.activitySpeaker.findFirst({
        where: {
          tenantId: input.tenantId,
          activityId: input.activityId,
          speakerProfileId: input.speakerProfileId,
        },
        select: { id: true },
      }),
    );

    if (!link) {
      return { ok: false, code: 'NOT_FOUND', message: 'Você não consta como ministrante desta atividade.' };
    }

    const stored = await inspectObject(input.bucket, input.objectKey);

    const integrity = verifyStoredObject({
      declaredSize: input.sizeBytes,
      storedSize: stored.sizeBytes,
      declaredChecksum: input.checksum,
      storedChecksum: stored.checksum,
    });

    if (!integrity.ok) {
      // Objeto inválido é removido: deixá-lo no bucket só acumularia lixo pago.
      await deleteObject(input.bucket, input.objectKey).catch(() => undefined);
      return { ok: false, code: 'INTEGRITY', message: integrity.message };
    }

    const materialId = randomUUID();

    await withTenant(input.tenantId, async (tx) => {
      await tx.speakerMaterial.create({
        data: {
          id: materialId,
          tenantId: input.tenantId,
          activityId: input.activityId,
          speakerProfileId: input.speakerProfileId,
          title: meta.title,
          description: meta.description,
          kind: meta.kind,
          visibility: meta.visibility,
          storageBucket: input.bucket,
          storageKey: input.objectKey,
          fileName: input.fileName.slice(0, 300),
          mimeType: input.mimeType.slice(0, 120),
          sizeBytes: input.sizeBytes,
          checksum: input.checksum,
          /**
           * O arquivo NÃO ganha URL gravada: o bucket é privado e o endereço só existe
           * assinado, por alguns minutos. Guardar um endereço fixo aqui daria a
           * impressão de que o material é alcançável por ele — e alguém acabaria
           * colocando esse link na página por fora.
           */
          url: null,
          /**
           * O material nasce aguardando inspeção quando o driver está ligado (e
           * `SKIPPED` — "não inspecionado" — quando não está). O portão do download
           * usa este campo, então gravar o estado certo AQUI é o que faz a promessa
           * valer (FASE 36).
           */
          scanStatus: initialScanStatus(isScanningEnabled()),
          uploadedById: input.actorId,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'speakerMaterial',
          entityId: materialId,
          changes: {
            titulo: { from: null, to: meta.title },
            visibilidade: { from: null, to: meta.visibility },
            arquivo: { from: null, to: input.fileName },
            bytes: { from: null, to: input.sizeBytes },
          },
        },
        tx,
      );
    });

    return { ok: true, materialId, objectKey: input.objectKey };
  } catch (error) {
    console.error(`[materials] falha ao confirmar upload: ${errorMessage(error)}`);
    return { ok: false, code: 'STORAGE', message: 'Não foi possível confirmar o material enviado.' };
  }
}

/** Metadados comuns a arquivo e link, validados uma vez. */
function validateMaterialMeta(input: {
  title: string;
  description?: string | null;
  kind: string;
  visibility: string;
}):
  | { ok: true; title: string; description: string | null; kind: MaterialKind; visibility: MaterialVisibility }
  | { ok: false; code: MaterialErrorCode; message: string } {
  const title = input.title.trim();
  if (title.length < 3 || title.length > 200) {
    return { ok: false, code: 'INVALID_INPUT', message: 'O título do material deve ter entre 3 e 200 caracteres.' };
  }

  const kind = input.kind.trim().toUpperCase();
  if (!(MATERIAL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Tipo de material inválido.' };
  }

  const visibility = input.visibility.trim().toUpperCase();
  if (!(MATERIAL_VISIBILITIES as readonly string[]).includes(visibility)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Visibilidade inválida.' };
  }

  const description = input.description?.trim() ?? '';

  return {
    ok: true,
    title,
    description: description.length > 0 ? description.slice(0, 600) : null,
    kind: kind as MaterialKind,
    visibility: visibility as MaterialVisibility,
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Link externo
// ───────────────────────────────────────────────────────────────────────────────
export async function createMaterialLink(input: {
  tenantId: string;
  actorId: string;
  activityId: string;
  speakerProfileId: string;
  title: string;
  description?: string | null;
  kind: string;
  visibility: string;
  url: string;
}): Promise<MaterialResult<{ materialId: string; url: string }>> {
  const meta = validateMaterialMeta(input);
  if (!meta.ok) return meta;

  const link = validateExternalMaterialUrl(input.url);
  if (!link.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: link.message };
  }

  try {
    const materialId = randomUUID();

    return await withTenant(input.tenantId, async (tx) => {
      const membership = await tx.activitySpeaker.findFirst({
        where: {
          tenantId: input.tenantId,
          activityId: input.activityId,
          speakerProfileId: input.speakerProfileId,
        },
        select: { id: true },
      });

      if (!membership) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Você não consta como ministrante desta atividade.',
        };
      }

      await tx.speakerMaterial.create({
        data: {
          id: materialId,
          tenantId: input.tenantId,
          activityId: input.activityId,
          speakerProfileId: input.speakerProfileId,
          title: meta.title,
          description: meta.description,
          kind: meta.kind,
          visibility: meta.visibility,
          url: link.url,
          uploadedById: input.actorId,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'speakerMaterial',
          entityId: materialId,
          changes: {
            titulo: { from: null, to: meta.title },
            visibilidade: { from: null, to: meta.visibility },
            link: { from: null, to: link.url },
          },
        },
        tx,
      );

      return { ok: true as const, materialId, url: link.url };
    });
  } catch (error) {
    console.error(`[materials] falha ao criar link: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível salvar o material.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura e download
// ───────────────────────────────────────────────────────────────────────────────
export interface MaterialRow {
  id: string;
  activityId: string;
  activityTitle: string;
  speakerProfileId: string;
  speakerName: string;
  title: string;
  description: string | null;
  kind: string;
  visibility: MaterialVisibility;
  isFile: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  createdAt: Date;
}

/**
 * Materiais de UMA atividade, já filtrados pela visibilidade do visitante.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FUNÇÃO DEVOLVE TAMBÉM O QUE O VISITANTE NÃO PODE VER (FASE 25)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `lockedCount` é a quantidade de materiais que existem e NÃO estão liberados para
 *  este visitante. A página da atividade usa esse número para dizer "1 material
 *  exclusivo para inscritos" — sem ele, o material fechado seria invisível, e o
 *  visitante não teria pista alguma de que vale a pena se inscrever.
 *
 *  Uma segunda consulta só para contar faria a página pagar dois `findMany` sobre a
 *  mesma tabela. A contagem sai da MESMA varredura, e a decisão é do domínio
 *  (`canAccessMaterial`) — a tela não reinterpreta visibilidade.
 */
export async function listActivityMaterials(input: {
  tenantId: string;
  activityId: string;
  viewer: MaterialViewer;
}): Promise<{ materials: MaterialRow[]; lockedCount: number }> {
  const rows = await withTenant(input.tenantId, (tx) =>
    tx.speakerMaterial.findMany({
      where: { tenantId: input.tenantId, activityId: input.activityId, deletedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: {
        id: true,
        activityId: true,
        speakerProfileId: true,
        title: true,
        description: true,
        kind: true,
        visibility: true,
        storageKey: true,
        fileName: true,
        sizeBytes: true,
        url: true,
        createdAt: true,
        speakerProfile: { select: { name: true } },
        activity: { select: { title: true } },
      },
    }),
  );

  const visible = rows.filter(
    (row) =>
      canAccessMaterial({
        visibility: row.visibility as MaterialVisibility,
        viewer: input.viewer,
      }).allowed,
  );

  return {
    lockedCount: rows.length - visible.length,
    materials: visible.map((row) => ({
      id: row.id,
      activityId: row.activityId,
      activityTitle: row.activity?.title ?? 'Atividade',
      speakerProfileId: row.speakerProfileId,
      speakerName: row.speakerProfile?.name ?? 'Palestrante',
      title: row.title,
      description: row.description,
      kind: row.kind,
      visibility: row.visibility as MaterialVisibility,
      isFile: row.storageKey !== null,
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      externalUrl: row.storageKey === null ? row.url : null,
      createdAt: row.createdAt,
    })),
  };
}

/**
 * URL de download do material, já decidida pela visibilidade.
 *
 * Arquivo → URL ASSINADA e temporária (o bucket não é público). Link externo → o
 * próprio endereço. A decisão de acesso é do domínio, e o motivo da recusa sobe para
 * quem chamou — a rota HTTP o converte no status certo (401/403/404).
 */
export async function resolveMaterialDownload(input: {
  tenantId: string;
  materialId: string;
  viewer: MaterialViewer;
}): Promise<
  | { ok: true; kind: 'FILE' | 'LINK'; url: string; fileName: string | null }
  | { ok: false; code: MaterialErrorCode; httpStatus: 401 | 403 | 404; message: string }
> {
  try {
    const material = await withTenant(input.tenantId, (tx) =>
      tx.speakerMaterial.findFirst({
        where: { id: input.materialId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          visibility: true,
          storageBucket: true,
          storageKey: true,
          fileName: true,
          url: true,
          title: true,
          scanStatus: true,
        },
      }),
    );

    if (!material) {
      // Inexistente e não autorizado respondem igual (ver `canAccessMaterial`): a
      // existência de um rascunho não é informação de quem não participa.
      return { ok: false, code: 'NOT_FOUND', httpStatus: 404, message: 'Material não encontrado.' };
    }

    const verdict = canAccessMaterial({
      visibility: material.visibility as MaterialVisibility,
      viewer: input.viewer,
    });

    if (!verdict.allowed) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        httpStatus: verdict.httpStatus,
        message: verdict.reason,
      };
    }

    if (material.storageKey) {
      /**
       * ─── O PORTÃO DA INSPEÇÃO (FASE 36) ──────────────────────────────────────
       *  Material de palestrante é upload de gente de fora servido a INSCRITOS — o
       *  mesmo risco do arquivo de submissão, e a mesma decisão. A resposta é 403
       *  (não 404): o material existe e a pessoa pode vê-lo; o que não pode é
       *  receber os BYTES antes do veredito.
       */
      const serve = canServeFile({
        status: material.scanStatus,
        scanningEnabled: isScanningEnabled(),
      });

      if (!serve.ok) {
        return { ok: false, code: 'FORBIDDEN', httpStatus: 403, message: serve.message };
      }

      const url = await createDownloadUrl({
        bucket: material.storageBucket || materialBucket(),
        objectKey: material.storageKey,
        fileName: material.fileName ?? material.title,
      });

      return { ok: true, kind: 'FILE', url, fileName: material.fileName };
    }

    if (!material.url) {
      return { ok: false, code: 'NOT_FOUND', httpStatus: 404, message: 'Material sem conteúdo.' };
    }

    return { ok: true, kind: 'LINK', url: material.url, fileName: null };
  } catch (error) {
    console.error(`[materials] falha ao resolver download: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', httpStatus: 403, message: 'Não foi possível preparar o download.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Edição e remoção (com posse)
// ───────────────────────────────────────────────────────────────────────────────
export interface MaterialOwnership {
  /** Id do usuário dono do material (do perfil do palestrante). Nulo = sem conta. */
  ownerUserId: string | null;
}

/**
 * Carrega o material com o dono — para que a POSSE seja decidida com o dado real.
 *
 * Nenhuma escrita confia em um `speakerProfileId` vindo do formulário: ele é lido do
 * banco e comparado com os perfis que a pessoa reivindicou. É a diferença entre
 * "o formulário disse que é meu" e "o banco confirma que é meu".
 */
export async function loadMaterialOwnership(input: {
  tenantId: string;
  materialId: string;
}): Promise<(MaterialOwnership & { activityId: string; speakerProfileId: string }) | null> {
  return withTenant(input.tenantId, async (tx) => {
    const material = await tx.speakerMaterial.findFirst({
      where: { id: input.materialId, tenantId: input.tenantId, deletedAt: null },
      select: {
        activityId: true,
        speakerProfileId: true,
        speakerProfile: { select: { userId: true } },
      },
    });

    if (!material) return null;

    return {
      activityId: material.activityId,
      speakerProfileId: material.speakerProfileId,
      ownerUserId: material.speakerProfile?.userId ?? null,
    };
  });
}

export async function updateMaterial(input: {
  tenantId: string;
  actorId: string;
  materialId: string;
  title: string;
  description?: string | null;
  kind: string;
  visibility: string;
  displayOrder?: number;
}): Promise<MaterialResult<{ materialId: string }>> {
  const meta = validateMaterialMeta(input);
  if (!meta.ok) return meta;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const before = await tx.speakerMaterial.findFirst({
        where: { id: input.materialId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, title: true, description: true, kind: true, visibility: true, displayOrder: true },
      });

      if (!before) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Material não encontrado.' };
      }

      await tx.speakerMaterial.update({
        where: { id: before.id },
        data: {
          title: meta.title,
          description: meta.description,
          kind: meta.kind,
          visibility: meta.visibility,
          displayOrder: input.displayOrder ?? before.displayOrder,
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'speakerMaterial',
          entityId: before.id,
          changes: {
            titulo: { from: before.title, to: meta.title },
            visibilidade: { from: before.visibility, to: meta.visibility },
            tipo: { from: before.kind, to: meta.kind },
          },
        },
        tx,
      );

      return { ok: true as const, materialId: before.id };
    });
  } catch (error) {
    console.error(`[materials] falha ao atualizar material: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível atualizar o material.' };
  }
}

/**
 * Remove o material: exclusão LÓGICA do registro e FÍSICA do objeto.
 *
 * O registro fica para a trilha (quem enviou, quando, quanto pesava) e sai da
 * página; o objeto sai do bucket, que é o que custa dinheiro. A ordem importa: se o
 * storage falhar, a transação volta e o registro continua válido.
 */
export async function deleteMaterial(input: {
  tenantId: string;
  actorId: string;
  materialId: string;
}): Promise<MaterialResult<{ materialId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const material = await tx.speakerMaterial.findFirst({
        where: { id: input.materialId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, title: true, storageBucket: true, storageKey: true },
      });

      if (!material) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Material não encontrado.' };
      }

      if (material.storageKey) {
        await deleteObject(material.storageBucket || materialBucket(), material.storageKey);
      }

      await tx.speakerMaterial.update({ where: { id: material.id }, data: { deletedAt: new Date() } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'speakerMaterial',
          entityId: material.id,
          changes: { titulo: { from: material.title, to: null } },
        },
        tx,
      );

      return { ok: true as const, materialId: material.id };
    });
  } catch (error) {
    console.error(`[materials] falha ao remover material: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível remover o material.' };
  }
}

/** Aceita apenas tipos declarados (a assinatura real é conferida no servidor). */
export function isMaterialMimeType(value: string): value is MaterialMimeType {
  return (MATERIAL_MIME_TYPES as readonly string[]).includes(value.trim().toLowerCase());
}

/**
 * Monta o "quem está olhando" a partir do BANCO, nunca do formulário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS PERGUNTAS, NA ORDEM QUE IMPORTA
 * ─────────────────────────────────────────────────────────────────────────────
 *    1. É ministrante desta atividade? (`activity_speakers.userId` OU o perfil
 *       reivindicado apontando para esta conta) → vê até o próprio rascunho.
 *    2. É da equipe? → vê tudo, inclusive rascunho (é quem dá suporte ao palestrante).
 *    3. Tem inscrição viva nesta atividade (ou no evento, para atividade sem
 *       inscrição própria)? → vê o material de inscritos.
 *
 *  A inscrição no EVENTO conta porque nem toda atividade tem inscrição própria — e
 *  exigir uma segunda inscrição para baixar o material de uma palestra de auditório
 *  seria uma regra que ninguém entende.
 */
export async function resolveActivityViewer(input: {
  tenantId: string;
  activityId: string;
  userId: string | null;
  isOrganizer: boolean;
}): Promise<MaterialViewer> {
  if (!input.userId) return { kind: 'ANONYMOUS' };
  if (input.isOrganizer) return { kind: 'ORGANIZER', userId: input.userId };

  return withTenant(input.tenantId, async (tx) => {
    const [link, registration] = await Promise.all([
      tx.activitySpeaker.findFirst({
        where: {
          tenantId: input.tenantId,
          activityId: input.activityId,
          OR: [{ userId: input.userId }, { speakerProfile: { userId: input.userId } }],
        },
        select: { id: true },
      }),
      tx.registration.findFirst({
        where: {
          tenantId: input.tenantId,
          userId: input.userId!,
          deletedAt: null,
          status: { in: ['CONFIRMED', 'ATTENDED'] },
          OR: [{ activityId: input.activityId }, { activityId: null }],
        },
        select: { id: true },
      }),
    ]);

    if (link) {
      return { kind: 'SPEAKER', userId: input.userId!, owner: true } satisfies MaterialViewer;
    }

    return {
      kind: 'ATTENDEE',
      userId: input.userId!,
      confirmed: registration !== null,
    } satisfies MaterialViewer;
  });
}

/**
 * O mesmo, mas a partir do MATERIAL.
 *
 * A rota de download recebe o id do material, não o da atividade. A tradução acontece
 * AQUI, dentro de `withTenant`: localizar a atividade pela conexão administrativa
 * criaria um segundo caminho de leitura fora da policy, e é justamente o que a
 * separação de escopos da FASE 9 evita.
 */
export async function resolveMaterialViewer(input: {
  tenantId: string;
  materialId: string;
  userId: string | null;
  isOrganizer: boolean;
}): Promise<MaterialViewer> {
  if (!input.userId) return { kind: 'ANONYMOUS' };
  if (input.isOrganizer) return { kind: 'ORGANIZER', userId: input.userId };

  const material = await withTenant(input.tenantId, (tx) =>
    tx.speakerMaterial.findFirst({
      where: { id: input.materialId, tenantId: input.tenantId, deletedAt: null },
      select: { activityId: true },
    }),
  );

  /**
   * Material inexistente: o visitante é tratado como inscrito NÃO confirmado. Isso não
   * libera nada (o `resolveMaterialDownload` responde 404 antes de olhar a
   * visibilidade) e evita uma segunda consulta só para decidir o rótulo.
   */
  if (!material) {
    return { kind: 'ATTENDEE', userId: input.userId, confirmed: false };
  }

  return resolveActivityViewer({
    tenantId: input.tenantId,
    activityId: material.activityId,
    userId: input.userId,
    isOrganizer: false,
  });
}

export { MAX_MATERIAL_BYTES };
