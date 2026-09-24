/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SERVIÇO — Modelo visual do certificado (arte de fundo e layout)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LAYOUT É VALIDADO ANTES DE SER GRAVADO, E NÃO NA HORA DE RENDERIZAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um layout inválido descoberto na emissão é o pior momento possível: o
 *  participante pediu o certificado, o worker pegou o job e o documento falha por um
 *  elemento 2 mm fora da página que o organizador posicionou semanas antes. Então a
 *  porta de entrada é única e valida: `save` recusa, com a lista de problemas, e o
 *  banco só guarda layout que passa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ARTE É VALIDADA PELOS BYTES, E A QUOTA VEM ANTES DO UPLOAD
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O tipo GRAVADO é o detectado (regra da FASE 17), e o arquivo precisa ser o JPEG
 *  que o PDF escrito à mão sabe embutir. A conferência da quota acontece ANTES do
 *  `putObjectBuffer` — recusar depois deixaria o objeto no bucket, pago e órfão
 *  (FASE 21).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TROCAR A ARTE APAGA A ANTERIOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A arte é chave de objeto única do modelo, e não um histórico: guardar as versões
 *  antigas faria a instituição pagar por artes que ninguém consegue escolher. Os
 *  certificados JÁ emitidos não dependem dela — o layout congelado aponta para a
 *  chave que existia na emissão, e é por isso que a exclusão de um modelo não sai
 *  apagando objetos: quem manda no passado é o snapshot.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  buildLayoutFromRows,
  backgroundFitNotice,
  defaultLayout,
  findPreset,
  normalizeLayout,
  pageFormat,
  parsePageFormat,
  selectEffectiveTemplate,
  validateCertificateBackground,
  validateLayout,
  type CertificateBackground,
  type CertificateLayout,
  type CertificatePageFormat,
} from '@/domain/certificates/certificate-layout-rules';
import { CERTIFICATE_KINDS, type CertificateKind } from '@/domain/certificates/certificate-rules';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { BUCKETS, deleteObject, getObjectBuffer, putObjectBuffer } from '@/lib/storage/s3-client';
import { ensureStorageRoom } from '@/lib/storage/storage-quota';

export type TemplateErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_BACKGROUND'
  | 'INTERNAL';

export type TemplateResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; code: TemplateErrorCode; message: string; details?: readonly string[] };

export interface CertificateTemplateSummary {
  id: string;
  name: string;
  eventId: string | null;
  eventTitle: string | null;
  kind: string | null;
  elementCount: number;
  page: CertificatePageFormat;
  hasBackground: boolean;
  backgroundBytes: number;
  backgroundNotice: string | null;
  updatedAt: Date;
}

export interface CertificateTemplateRecord {
  id: string;
  tenantId: string;
  eventId: string | null;
  kind: string | null;
  name: string;
  layout: CertificateLayout;
  backgroundBytes: number;
  createdById: string | null;
  updatedAt: Date;
}

/** Chave do objeto da arte — particionada por instituição desde o primeiro segmento. */
export function templateBackgroundKey(tenantId: string, templateId: string): string {
  return `tenants/${tenantId}/certificate-templates/${templateId}/fundo.jpg`;
}

/**
 * Lê o layout gravado.
 *
 * O JSON do banco é tratado como NÃO confiável: ele passou pela validação quando foi
 * gravado, mas uma linha editada por fora (ou por uma versão anterior do código)
 * precisa ser recusada em vez de virar geometria absurda na página.
 */
export function readStoredLayout(value: unknown): CertificateLayout | null {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<CertificateLayout>;
  if (!raw.page || !Array.isArray(raw.elements)) return null;

  const page = parsePageFormat(raw.page);
  if (!page) return null;

  const background = raw.background ? (raw.background as CertificateBackground) : null;

  return normalizeLayout({
    page,
    background,
    elements: raw.elements.map((element) => ({ ...element })),
  });
}

function summarize(row: {
  id: string;
  name: string;
  eventId: string | null;
  kind: string | null;
  layout: unknown;
  backgroundBytes: bigint | null;
  updatedAt: Date;
  event?: { title: string } | null;
}): CertificateTemplateSummary {
  const layout = readStoredLayout(row.layout);
  const background = layout?.background ?? null;

  return {
    id: row.id,
    name: row.name,
    eventId: row.eventId,
    eventTitle: row.event?.title ?? null,
    kind: row.kind,
    elementCount: layout?.elements.length ?? 0,
    page: layout?.page ?? 'A4_LANDSCAPE',
    hasBackground: background !== null,
    backgroundBytes: Number(row.backgroundBytes ?? 0),
    /**
     * O aviso de recorte é do domínio — a tela não recalcula proporção por conta
     * própria, senão mostraria um aviso que o renderizador não confirma.
     */
    backgroundNotice: background && layout ? backgroundFitNotice(background, layout.page) : null,
    updatedAt: row.updatedAt,
  };
}

/** Modelos da instituição, do mais específico ao mais genérico. */
export async function listCertificateTemplates(tenantId: string): Promise<CertificateTemplateSummary[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.certificateTemplate.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        eventId: true,
        kind: true,
        layout: true,
        backgroundBytes: true,
        updatedAt: true,
        event: { select: { title: true } },
      },
      orderBy: [{ eventId: 'asc' }, { kind: 'asc' }, { name: 'asc' }],
    });

    return rows.map(summarize);
  });
}

export async function getCertificateTemplate(
  tenantId: string,
  templateId: string,
): Promise<CertificateTemplateRecord | null> {
  return withTenant(tenantId, async (tx) => {
    const row = await tx.certificateTemplate.findFirst({
      where: { id: templateId, tenantId },
      select: {
        id: true,
        tenantId: true,
        eventId: true,
        kind: true,
        name: true,
        layout: true,
        backgroundBytes: true,
        createdById: true,
        updatedAt: true,
      },
    });

    if (!row) return null;

    const layout = readStoredLayout(row.layout);
    if (!layout) return null;

    return {
      id: row.id,
      tenantId: row.tenantId,
      eventId: row.eventId,
      kind: row.kind,
      name: row.name,
      layout,
      backgroundBytes: Number(row.backgroundBytes ?? 0),
      createdById: row.createdById,
      updatedAt: row.updatedAt,
    };
  });
}

export interface SavedLayoutInput {
  page: string;
  ids: readonly string[];
  kinds: readonly string[];
  texts: readonly string[];
  variables: readonly string[];
  xMm: readonly string[];
  yMm: readonly string[];
  widthMm: readonly string[];
  heightMm: readonly string[];
  aligns: readonly string[];
  fonts: readonly string[];
  sizePt: readonly string[];
  colors: readonly string[];
  lineHeights: readonly string[];
}

function pageFromRaw(raw: string): CertificatePageFormat {
  return parsePageFormat(raw) ?? 'A4_LANDSCAPE';
}

/**
 * O tipo de certificado do alvo, ou `null` ("serve a qualquer tipo").
 *
 * Tipo desconhecido é RECUSADO em vez de virar `null` em silêncio: um valor digitado
 * errado criaria um modelo "genérico" que o organizador pensa ser específico.
 */
function kindFromRaw(raw: string | null | undefined): { ok: true; kind: CertificateKind | null } | { ok: false } {
  const value = (raw ?? '').trim().toUpperCase();
  if (!value) return { ok: true, kind: null };
  if (!(CERTIFICATE_KINDS as readonly string[]).includes(value)) return { ok: false };

  return { ok: true, kind: value as CertificateKind };
}

/**
 * Salva (cria ou atualiza) um modelo.
 *
 * A arte NÃO muda por aqui: `background` é preservado do registro atual, e trocar a
 * arte é ato separado (`setTemplateBackground`). Assim o formulário do editor pode ser
 * reenviado sem o arquivo e o desenho da instituição não some.
 */
export async function saveCertificateTemplate(input: {
  tenantId: string;
  actorId: string;
  templateId?: string | null;
  name: string;
  eventId?: string | null;
  kind?: string | null;
  presetId?: string | null;
  rows?: SavedLayoutInput | null;
}): Promise<TemplateResult<{ templateId: string }>> {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'O nome do modelo precisa ter entre 3 e 120 caracteres.',
    };
  }

  const kind = kindFromRaw(input.kind);
  if (!kind.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Tipo de certificado desconhecido.' };
  }

  return withTenant(input.tenantId, async (tx) => {
    const existing = input.templateId
      ? await tx.certificateTemplate.findFirst({
          where: { id: input.templateId, tenantId: input.tenantId },
          select: { id: true, layout: true },
        })
      : null;

    if (input.templateId && !existing) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Modelo não encontrado.' };
    }

    const currentLayout = existing ? readStoredLayout(existing.layout) : null;

    /**
     * A origem do layout, em ordem: o formulário → o modelo pronto escolhido → o que
     * já estava gravado → o padrão do código. O organizador pode partir de um modelo
     * pronto e personalizar sem perder a arte que já subiu.
     */
    let layout: CertificateLayout;

    if (input.rows) {
      layout = buildLayoutFromRows({
        page: pageFromRaw(input.rows.page),
        background: currentLayout?.background ?? null,
        ids: input.rows.ids,
        kinds: input.rows.kinds,
        texts: input.rows.texts,
        variables: input.rows.variables,
        xMm: input.rows.xMm,
        yMm: input.rows.yMm,
        widthMm: input.rows.widthMm,
        heightMm: input.rows.heightMm,
        aligns: input.rows.aligns,
        fonts: input.rows.fonts,
        sizePt: input.rows.sizePt,
        colors: input.rows.colors,
        lineHeights: input.rows.lineHeights,
      });
    } else if (input.presetId) {
      const preset = findPreset(input.presetId);
      if (!preset) {
        return { ok: false as const, code: 'INVALID_INPUT' as const, message: 'Modelo pronto desconhecido.' };
      }
      layout = normalizeLayout({
        page: pageFromRaw(preset.layout.page),
        background: currentLayout ? currentLayout.background : null,
        elements: preset.layout.elements.map((element) => ({ ...element })),
      });
    } else if (currentLayout) {
      layout = currentLayout;
    } else {
      const fallback = defaultLayout();
      layout = { page: fallback.page, background: null, elements: fallback.elements };
    }

    const verdict = validateLayout(layout);
    if (!verdict.ok) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT' as const,
        message: 'O modelo tem problemas que impedem salvar.',
        details: verdict.issues.map((issue) => issue.message),
      };
    }

    const backgroundBytes = layout.background ? BigInt(layout.background.sizeBytes) : null;

    if (existing) {
      await tx.certificateTemplate.update({
        where: { id: existing.id },
        data: {
          name,
          eventId: input.eventId?.trim() || null,
          kind: kind.kind,
          layout: layout as unknown as object,
          backgroundBytes,
        },
      });

      return { ok: true as const, templateId: existing.id };
    }

    const created = await tx.certificateTemplate.create({
      data: {
        tenantId: input.tenantId,
        eventId: input.eventId?.trim() || null,
        kind: kind.kind,
        name,
        layout: layout as unknown as object,
        backgroundBytes,
        createdById: input.actorId,
      },
      select: { id: true },
    });

    return { ok: true as const, templateId: created.id };
  }).catch((error: unknown) => {
    if (isUniqueViolation(error)) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT' as const,
        message:
          'Já existe um modelo para este evento e este tipo de certificado. Edite o existente ou escolha outro alvo.',
      };
    }

    console.error(`[certificate-templates] falha ao salvar: ${describe(error)}`);
    return {
      ok: false as const,
      code: 'INTERNAL' as const,
      message: 'Não foi possível salvar o modelo.',
    };
  });
}

/**
 * Troca a arte de fundo de um modelo.
 *
 * Os bytes vêm do formulário (a Server Action recebe o arquivo), e a validação é
 * feita AQUI e sobre eles: tipo detectado pela assinatura, formato que o PDF sabe
 * embutir e resolução mínima para a página do modelo.
 */
export async function setTemplateBackground(input: {
  tenantId: string;
  templateId: string;
  bytes: Uint8Array;
}): Promise<TemplateResult<{ checksum: string; notice: string | null }>> {
  const record = await getCertificateTemplate(input.tenantId, input.templateId);

  if (!record) {
    return { ok: false, code: 'NOT_FOUND', message: 'Modelo não encontrado.' };
  }

  const validation = validateCertificateBackground({ bytes: input.bytes, page: record.layout.page });

  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID_BACKGROUND',
      message: 'A arte de fundo não foi aceita.',
      details: validation.issues.map((issue) => issue.message),
    };
  }

  const objectKey = templateBackgroundKey(input.tenantId, input.templateId);
  const previousBytes = record.layout.background?.sizeBytes ?? 0;

  const room = await ensureStorageRoom({
    tenantId: input.tenantId,
    incomingBytes: validation.sizeBytes,
    replacingBytes: previousBytes,
  });

  if (!room.ok) {
    return { ok: false, code: 'QUOTA_EXCEEDED', message: room.message };
  }

  const background: CertificateBackground = {
    objectKey,
    checksum: validation.checksum,
    widthPx: validation.info.widthPx,
    heightPx: validation.info.heightPx,
    orientation: validation.info.orientation,
    colorComponents: validation.info.components,
    sizeBytes: validation.sizeBytes,
    fit: record.layout.background?.fit ?? 'COVER',
  };

  const layout = normalizeLayout({ ...record.layout, background });

  const verdict = validateLayout(layout);
  if (!verdict.ok) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'A arte não pôde ser aplicada ao modelo.',
      details: verdict.issues.map((issue) => issue.message),
    };
  }

  try {
    await putObjectBuffer({
      bucket: BUCKETS.certificates(),
      objectKey,
      body: Buffer.from(input.bytes),
      contentType: 'image/jpeg',
      metadata: { checksum: validation.checksum, 'template-id': input.templateId },
    });

    const saved = await persistLayout(input.tenantId, input.templateId, layout);

    if (!saved) {
      return { ok: false, code: 'NOT_FOUND', message: 'Modelo não encontrado.' };
    }

    return {
      ok: true,
      checksum: validation.checksum,
      notice: backgroundFitNotice(background, layout.page),
    };
  } catch (error) {
    console.error(`[certificate-templates] falha ao subir a arte: ${describe(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível guardar a arte de fundo.' };
  }
}

/** Remove a arte do modelo (o objeto sai do bucket; o layout volta ao fundo branco). */export async function clearTemplateBackground(input: {
  tenantId: string;
  templateId: string;
}): Promise<TemplateResult> {
  const record = await getCertificateTemplate(input.tenantId, input.templateId);

  if (!record) {
    return { ok: false, code: 'NOT_FOUND', message: 'Modelo não encontrado.' };
  }

  if (!record.layout.background) {
    return { ok: true };
  }

  const objectKey = record.layout.background.objectKey;
  const layout = normalizeLayout({ ...record.layout, background: null });

  const saved = await persistLayout(input.tenantId, input.templateId, layout);
  if (!saved) {
    return { ok: false, code: 'NOT_FOUND', message: 'Modelo não encontrado.' };
  }

  /**
   * O objeto só sai DEPOIS de o modelo deixar de apontar para ele: apagar primeiro
   * deixaria uma janela em que o modelo aponta para um objeto inexistente — e uma
   * emissão nessa janela falharia por causa da ordem, não do conteúdo.
   */
  await deleteObject(BUCKETS.certificates(), objectKey).catch((error: unknown) => {
    console.error(`[certificate-templates] arte órfã no bucket: ${describe(error)}`);
  });

  return { ok: true };
}

/**
 * Exclui o modelo.
 *
 * Os certificados emitidos com ele NÃO mudam: o layout está congelado em cada um. A
 * FK é `ON DELETE SET NULL`, então a rastreabilidade do modelo se perde e o documento
 * continua íntegro — que é a prioridade.
 */
export async function deleteCertificateTemplate(input: {
  tenantId: string;
  templateId: string;
}): Promise<TemplateResult> {
  return withTenant(input.tenantId, async (tx) => {
    const deleted = await tx.certificateTemplate.deleteMany({
      where: { id: input.templateId, tenantId: input.tenantId },
    });

    if (deleted.count === 0) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Modelo não encontrado.' };
    }

    return { ok: true as const };
  }).catch((error: unknown) => {
    console.error(`[certificate-templates] falha ao excluir: ${describe(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível excluir o modelo.' };
  });
}

/**
 * O modelo que vale para (evento, tipo), com o layout e os bytes da arte.
 *
 * `null` significa "nenhum modelo configurado": o chamador usa o desenho fixo do
 * código. Devolver um layout vazio aqui seria pior — a emissão sairia sem bloco
 * probatório.
 */
export async function resolveTemplateFor(input: {
  tenantId: string;
  eventId: string;
  kind: string;
}): Promise<{ templateId: string; layout: CertificateLayout } | null> {
  return withTenant(input.tenantId, (tx) => resolveTemplateWithTx(tx, input));
}

/**
 * A mesma resolução DENTRO de uma transação já aberta.
 *
 * A emissão precisa disto: ela já está em uma transação (o certificado, o código de
 * validação e o snapshot nascem juntos), e abrir uma segunda conexão só para ler o
 * modelo gastaria uma conexão do pool no caminho mais quente do módulo.
 */
export async function resolveTemplateWithTx(
  tx: TxClient,
  input: { tenantId: string; eventId: string; kind: string },
): Promise<{ templateId: string; layout: CertificateLayout } | null> {
  const rows = await tx.certificateTemplate.findMany({
    where: {
      tenantId: input.tenantId,
      OR: [{ eventId: input.eventId }, { eventId: null }],
      AND: [{ OR: [{ kind: input.kind as never }, { kind: null }] }],
    },
    select: { id: true, eventId: true, kind: true, layout: true },
  });

  const picked = selectEffectiveTemplate(
    rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      kind: row.kind as string | null,
      layout: row.layout,
    })),
    { eventId: input.eventId, kind: input.kind },
  );

  if (!picked) return null;

  const layout = readStoredLayout(picked.layout);
  if (!layout) return null;

  return { templateId: picked.id, layout };
}

/** Lê os bytes da arte do bucket. `null` quando o modelo não tem arte. */
export async function readTemplateBackground(layout: CertificateLayout): Promise<Buffer | null> {
  if (!layout.background) return null;

  return getObjectBuffer(BUCKETS.certificates(), layout.background.objectKey);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares
// ───────────────────────────────────────────────────────────────────────────────
async function persistLayout(
  tenantId: string,
  templateId: string,
  layout: CertificateLayout,
): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const updated = await tx.certificateTemplate.updateMany({
      where: { id: templateId, tenantId },
      data: {
        layout: layout as unknown as object,
        backgroundBytes: layout.background ? BigInt(layout.background.sizeBytes) : null,
      },
    });

    return updated.count > 0;
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Medida da página do modelo, para a tela mostrar o tamanho real do documento. */
export function templatePageSize(layout: CertificateLayout): { widthMm: number; heightMm: number } {
  return pageFormat(layout.page);
}
