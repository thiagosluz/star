/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Biblioteca de mídia da instituição (FASE 24, item E14)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE A TABELA RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 23 o bucket ERA a biblioteca: ninguém sabia o que havia sido enviado,
 *  por quem, quanto pesava nem onde cada imagem estava sendo usada. Duas
 *  consequências práticas:
 *
 *    • imagem enviada e não usada virava lixo pago e invisível;
 *    • apagar um arquivo era uma decisão às cegas — não havia como saber se ele
 *      estava na capa do evento, no logotipo de um patrocinador ou na galeria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  APAGAR CONFERE O USO ANTES, PORQUE A REFERÊNCIA É A URL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A URL continua sendo a referência (o conteúdo do bloco aceita imagem externa, e
 *  mudar isso quebraria páginas já publicadas). Então a exclusão não pode confiar
 *  em chave estrangeira: ela PROCURA a URL nos lugares onde uma imagem pode estar —
 *  colunas do evento, logotipo de patrocinador e conteúdo dos blocos — e recusa
 *  quando encontra, dizendo onde.
 *
 *  Isso é mais trabalhoso do que um `ON DELETE` e é o comportamento certo: apagar
 *  uma imagem em uso deixaria a página pública com um ícone quebrado, e o
 *  organizador não saberia por quê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { BUCKETS, deleteObject } from '@/lib/storage/s3-client';
import { ASSET_TARGET_LABELS, type AssetTarget } from '@/domain/events/image-rules';

export type MediaErrorCode = 'NOT_FOUND' | 'IN_USE' | 'STORAGE' | 'INTERNAL';

export type MediaResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: MediaErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Registro
// ───────────────────────────────────────────────────────────────────────────────
export interface RegisterAssetInput {
  tenantId: string;
  eventId: string;
  actorId: string;
  target: AssetTarget;
  bucket: string;
  objectKey: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
}

/**
 * Registra (ou reaproveita) a imagem enviada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O MESMO ARQUIVO DUAS VEZES NÃO OCUPA DOIS OBJETOS
 * ─────────────────────────────────────────────────────────────────────────────
 *  Antes de gravar, procura um registro com o MESMO checksum na instituição. Se
 *  existir, o objeto recém-enviado é apagado do bucket e o registro antigo é
 *  devolvido — a URL reaproveitada é idêntica, então a página não muda em nada.
 *
 *  É o ganho direto de ter o registro: sem ele, subir a mesma foto para a capa e
 *  para a galeria criava dois objetos iguais, cobrados duas vezes no storage.
 */
export async function registerAsset(
  tx: TxClient,
  input: RegisterAssetInput,
): Promise<{ assetId: string; url: string; deduplicated: boolean }> {
  const existing = await tx.mediaAsset.findFirst({
    where: { tenantId: input.tenantId, checksum: input.checksum, deletedAt: null },
    select: { id: true, url: true, sizeBytes: true, mimeType: true },
  });

  if (existing && existing.sizeBytes === input.sizeBytes && existing.mimeType === input.mimeType) {
    /**
     * O objeto novo é removido FORA da transação (é I/O de rede), e a falha ao
     * remover não pode desfazer a confirmação: o pior caso é um objeto órfão no
     * bucket, não um vínculo quebrado na página.
     */
    await deleteObject(input.bucket, input.objectKey).catch(() => undefined);

    return { assetId: existing.id, url: existing.url, deduplicated: true };
  }

  const assetId = randomUUID();

  await tx.mediaAsset.create({
    data: {
      id: assetId,
      tenantId: input.tenantId,
      eventId: input.eventId,
      bucket: input.bucket,
      objectKey: input.objectKey,
      url: input.url,
      fileName: input.fileName.slice(0, 300),
      mimeType: input.mimeType.slice(0, 120),
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      target: input.target,
      uploadedById: input.actorId,
    },
  });

  return { assetId, url: input.url, deduplicated: false };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Uso: onde a URL aparece
// ───────────────────────────────────────────────────────────────────────────────
export interface AssetUsage {
  kind: 'EVENT_COVER' | 'EVENT_LOGO' | 'SPONSOR_LOGO' | 'PAGE_BLOCK';
  label: string;
}

export interface MediaAssetRow {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  target: string;
  targetLabel: string;
  eventId: string | null;
  eventTitle: string | null;
  uploadedByName: string | null;
  createdAt: Date;
  usages: AssetUsage[];
  /** Está em uso em algum lugar? (a exclusão é recusada quando está) */
  inUse: boolean;
}

export interface MediaLibrary {
  assets: MediaAssetRow[];
  totalBytes: number;
  /** Soma dos bytes dividida por MB, arredondada — para o cabeçalho da tela. */
  totalMegabytes: number;
}

/**
 * Lista o acervo com o uso de cada imagem.
 *
 * O uso é calculado numa passada só: carrega eventos, patrocinadores e blocos da
 * instituição e procura cada URL. Fazer uma consulta por imagem seria mais simples
 * de escrever e muito pior de usar — a lista tem dezenas de itens.
 */
export async function listMediaLibrary(
  tenantId: string,
  options: { eventId?: string; includeEverywhere?: boolean } = {},
): Promise<MediaLibrary> {
  return withTenant(tenantId, async (tx) => {
    const assets = await tx.mediaAsset.findMany({
      where: {
        tenantId,
        deletedAt: null,
        // O padrão é o acervo da instituição; a tela do evento pode filtrar.
        ...(options.eventId && !options.includeEverywhere ? { eventId: options.eventId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: {
        id: true,
        url: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        target: true,
        eventId: true,
        createdAt: true,
        uploadedBy: { select: { name: true } },
        event: { select: { title: true } },
      },
    });

    const usage = await collectUsages(tx, tenantId);

    const rows: MediaAssetRow[] = assets.map((asset) => {
      const usages = usage.get(asset.url) ?? [];
      return {
        id: asset.id,
        url: asset.url,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        target: asset.target,
        targetLabel:
          ASSET_TARGET_LABELS[asset.target as AssetTarget] ?? asset.target,
        eventId: asset.eventId,
        eventTitle: asset.event?.title ?? null,
        uploadedByName: asset.uploadedBy?.name ?? null,
        createdAt: asset.createdAt,
        usages,
        inUse: usages.length > 0,
      };
    });

    const totalBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);

    return {
      assets: rows,
      totalBytes,
      totalMegabytes: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
    };
  });
}

/**
 * Mapa URL → onde ela é usada.
 *
 * `JSON.stringify` no conteúdo do bloco é deliberado: a URL pode estar em qualquer
 * profundidade (galeria, imagem de fundo de bloco), e procurar campo a campo
 * exigiria conhecer todos os schemas aqui — a fonte da verdade deles é o domínio.
 */
async function collectUsages(tx: TxClient, tenantId: string): Promise<Map<string, AssetUsage[]>> {
  const [events, sponsors, pages] = await Promise.all([
    tx.event.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, title: true, coverImageUrl: true, logoUrl: true },
    }),
    tx.sponsor.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true, logoUrl: true },
    }),
    tx.eventPage.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        title: true,
        event: { select: { title: true } },
        blocks: { select: { type: true, content: true } },
      },
    }),
  ]);

  const usage = new Map<string, AssetUsage[]>();

  const add = (url: string | null, entry: AssetUsage): void => {
    if (!url) return;
    const list = usage.get(url) ?? [];
    list.push(entry);
    usage.set(url, list);
  };

  for (const event of events) {
    add(event.coverImageUrl, { kind: 'EVENT_COVER', label: `Capa do evento "${event.title}"` });
    add(event.logoUrl, { kind: 'EVENT_LOGO', label: `Logotipo do evento "${event.title}"` });
  }

  for (const sponsor of sponsors) {
    add(sponsor.logoUrl, { kind: 'SPONSOR_LOGO', label: `Logotipo do patrocinador "${sponsor.name}"` });
  }

  for (const page of pages) {
    const pageLabel = page.event?.title ? `página de "${page.event.title}"` : `página "${page.title}"`;

    for (const block of page.blocks) {
      const text = safeStringify(block.content);
      if (!text) continue;

      const label = `Bloco ${block.type} na ${pageLabel}`;

      /**
       * As URLs são EXTRAÍDAS do conteúdo e procuradas no mapa, em vez de o mapa
       * ser varrido bloco a bloco. Duas razões: o custo cai de (blocos × imagens)
       * para o número de URLs escritas no conteúdo, e uma URL que o acervo não
       * conhece (imagem externa, ou enviada e ainda não registrada) também passa a
       * constar — o que protege a exclusão de liberar uma imagem em uso.
       */
      for (const url of extractUrls(text)) {
        const list = usage.get(url) ?? [];
        if (!list.some((entry) => entry.kind === 'PAGE_BLOCK' && entry.label === label)) {
          list.push({ kind: 'PAGE_BLOCK', label });
        }
        usage.set(url, list);
      }
    }
  }

  return usage;
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

/** URLs http(s) presentes em um texto — usado para achar referências fora do acervo. */
function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^"\\\s]+/g) ?? [];
  return [...new Set(found)];
}

// ───────────────────────────────────────────────────────────────────────────────
//  Exclusão
// ───────────────────────────────────────────────────────────────────────────────
export async function deleteMediaAsset(input: {
  tenantId: string;
  actorId: string;
  assetId: string;
}): Promise<MediaResult<{ assetId: string; deletedObjectKey: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const asset = await tx.mediaAsset.findFirst({
        where: { id: input.assetId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, url: true, bucket: true, objectKey: true, fileName: true },
      });

      if (!asset) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Imagem não encontrada.' };
      }

      const usage = await collectUsages(tx, input.tenantId);
      const usages = usage.get(asset.url) ?? [];

      if (usages.length > 0) {
        return {
          ok: false as const,
          code: 'IN_USE' as const,
          message: 'Esta imagem está em uso e não pode ser excluída.',
          details: usages.map((entry) => entry.label),
        };
      }

      /**
       * Remoção LÓGICA do registro e remoção FÍSICA do objeto.
       *
       * O registro fica para a trilha (quem enviou, quando, quanto pesava) e sai da
       * lista; o objeto sai do bucket, que é o que custa dinheiro. A ordem importa:
       * se o bucket falhar, a transação volta e o registro continua válido.
       */
      await deleteObject(asset.bucket || BUCKETS.assets(), asset.objectKey);

      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { deletedAt: new Date() },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'mediaAsset',
          entityId: asset.id,
          changes: { fileName: { from: asset.fileName, to: null } },
        },
        tx,
      );

      return { ok: true as const, assetId: asset.id, deletedObjectKey: asset.objectKey };
    });
  } catch (error) {
    console.error(`[media] falha ao excluir imagem: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível excluir a imagem.' };
  }
}

/**
 * Soma do acervo da instituição.
 *
 * Existe para a tela mostrar quanto a instituição ocupa. **Não** é a quota de
 * armazenamento do plano (dívida C4, F21): aqui só se mede; lá se recusa.
 */
export async function sumMediaBytes(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const result = await tx.mediaAsset.aggregate({
      where: { tenantId, deletedAt: null },
      _sum: { sizeBytes: true },
    });

    return result._sum.sizeBytes ?? 0;
  });
}
