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
import { ASSET_TARGET_LABELS, imageFormatLabel, type AssetTarget } from '@/domain/events/image-rules';
import { MEDIA_LIBRARY_LIMIT, MEDIA_NO_SOURCE_EVENT } from '@/domain/events/media-filter-rules';

export type MediaErrorCode = 'NOT_FOUND' | 'IN_USE' | 'STORAGE' | 'INTERNAL';

export type MediaResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: MediaErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Registro
// ───────────────────────────────────────────────────────────────────────────────
export interface RegisterAssetInput {
  tenantId: string;
  /**
   * Evento de origem. `null` é o ACERVO DA INSTITUIÇÃO — o caso previsto na coluna
   * desde a FASE 24 e usado de verdade pela capa/logotipo da página da instituição
   * (FASE 64). O comentário vive aqui, e não só no modelo, porque é esta assinatura
   * que diz quem pode passar `null`.
   */
  eventId: string | null;
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
  kind: 'EVENT_COVER' | 'EVENT_LOGO' | 'SPONSOR_LOGO' | 'PAGE_BLOCK' | 'SPEAKER_AVATAR';
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

/**
 * Filtros do acervo (dívida E19).
 *
 * Todos opcionais e COMBINÁVEIS, e todos aplicados no BANCO — ver o bloco
 * "POR QUE O FILTRO É NO BANCO" em `listMediaLibrary`.
 */
export interface MediaLibraryFilters {
  /** Texto livre: procura no nome do arquivo e na URL. */
  search?: string | null;
  /** Tipo GRAVADO (`image/webp`, `image/png`…) — o mesmo que a tela exibe. */
  mimeType?: string | null;
  /** Evento de origem, ou `MEDIA_NO_SOURCE_EVENT` para o que não tem evento. */
  sourceEventId?: string | null;
  /** `true` = só em uso · `false` = só sem uso · `null`/ausente = todos. */
  inUse?: boolean | null;
}

/** Uma opção dos seletores, com quantas imagens ela alcança AGORA. */
export interface MediaLibraryOption {
  value: string;
  label: string;
  count: number;
}

export interface MediaLibrary {
  assets: MediaAssetRow[];
  /** Soma dos bytes do RESULTADO (o que a lista mostra). */
  totalBytes: number;
  /** Soma do resultado dividida por MB, arredondada. */
  totalMegabytes: number;
  /** Quantas imagens o filtro alcançou no banco — pode ser maior que `assets.length`. */
  matchedCount: number;
  /** Teto aplicado à lista (`MEDIA_LIBRARY_LIMIT`). */
  limit: number;
  /** `true` quando o resultado não coube no teto: a tela avisa "mostrando N de M". */
  truncated: boolean;
  /**
   * Números do ACERVO INTEIRO (sem os filtros da pessoa, respeitando só o escopo da
   * tela). É o cabeçalho: "N imagem(ns) no acervo · M em uso · X MB".
   */
  library: { count: number; inUse: number; bytes: number; megabytes: number };
  /** Opções do filtro de tipo, tiradas do PRÓPRIO acervo. */
  typeOptions: MediaLibraryOption[];
  /** Opções do filtro de evento de origem, tiradas do próprio acervo. */
  eventOptions: MediaLibraryOption[];
}

/**
 * Lista o acervo com o uso de cada imagem.
 *
 * O uso é calculado numa passada só: carrega eventos, patrocinadores e blocos da
 * instituição e procura cada URL. Fazer uma consulta por imagem seria mais simples
 * de escrever e muito pior de usar — a lista tem dezenas de itens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FILTRO É NO BANCO (dívida E19)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A tentação era trazer as 200 mais recentes — como sempre — e filtrar em memória.
 *  Isso NÃO resolve o problema: com 200 linhas em mãos, "só as que estão em uso" na
 *  verdade significa "as que estão em uso ENTRE as 200 mais recentes". Numa
 *  instituição com dois anos de acervo, a imagem que a pessoa procura é justamente a
 *  que ficou fora da janela, e o filtro responderia "nada encontrado" sobre um arquivo
 *  que existe. Filtrar em memória também não mudaria a quantidade de trabalho: as 200
 *  linhas já teriam sido lidas e transferidas.
 *
 *  Então as quatro condições viram cláusula de `where`, e o teto passa a cortar o
 *  RESULTADO do filtro, não o acervo. O uso continua vindo da MESMA função da tela
 *  (`collectUsages`): o filtro "em uso" consulta o conjunto de URLs que ela devolve,
 *  em vez de reimplementar a regra — duas implementações da mesma pergunta divergem
 *  no primeiro caso de borda (URL com barra final, imagem externa num bloco).
 */
export async function listMediaLibrary(
  tenantId: string,
  options: {
    eventId?: string;
    includeEverywhere?: boolean;
    filters?: MediaLibraryFilters;
  } = {},
): Promise<MediaLibrary> {
  const filters = options.filters ?? {};

  return withTenant(tenantId, async (tx) => {
    /**
     * Escopo da tela (instituição × evento), ANTES dos filtros da pessoa. Os números
     * do cabeçalho saem daqui: o "N em uso" do acervo não pode encolher porque
     * alguém filtrou por tipo.
     */
    const scope = {
      tenantId,
      deletedAt: null,
      ...(options.eventId && !options.includeEverywhere ? { eventId: options.eventId } : {}),
    };

    const search = filters.search?.trim();
    const sourceEventId = filters.sourceEventId ?? null;

    const where = {
      ...scope,
      ...(search
        ? {
            OR: [
              { fileName: { contains: search, mode: 'insensitive' as const } },
              /**
               * A URL entra na busca porque o caminho do objeto carrega o nome do
               * arquivo e a pasta do alvo (`.../assets/gallery/…`): é por ela que se
               * acha o que foi enviado para a galeria quando o nome na tela já foi
               * trocado. A LEGENDA fica de fora de propósito — ela pertence ao bloco
               * da página, não ao arquivo, e o mesmo arquivo pode ter várias.
               */
              { url: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(filters.mimeType ? { mimeType: filters.mimeType } : {}),
      ...(sourceEventId === MEDIA_NO_SOURCE_EVENT
        ? { eventId: null }
        : sourceEventId
          ? { eventId: sourceEventId }
          : {}),
    };

    const usage = await collectUsages(tx, tenantId);
    /**
     * O conjunto de URLs usadas é o MESMO que a tela já calcula para dizer "em uso" em
     * cada linha. O tamanho dele é limitado pelo que a instituição tem (eventos,
     * patrocinadores, fotos e blocos) — e o `in`/`notIn` é o preço de responder
     * "quais dá para apagar" sem reimplementar a regra de uso.
     */
    const usedUrls = [...usage.keys()];

    const withUsage =
      filters.inUse === true
        ? { ...where, url: { in: usedUrls } }
        : filters.inUse === false
          ? { ...where, url: { notIn: usedUrls } }
          : where;

    const [aggregate, inUseCount, matchedCount, assets, typeGroups, eventGroups] =
      await Promise.all([
        tx.mediaAsset.aggregate({
          where: scope,
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        tx.mediaAsset.count({ where: { ...scope, url: { in: usedUrls } } }),
        tx.mediaAsset.count({ where: withUsage }),
        tx.mediaAsset.findMany({
          where: withUsage,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MEDIA_LIBRARY_LIMIT,
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
        }),
        /**
         * As opções dos seletores saem do ACERVO, não de uma lista fixa no código.
         * Tipo que a instituição não tem não vira opção inútil, e tipo que ela venha a
         * ter (outro formato, outro alvo) aparece sozinho — sem mexer na tela.
         */
        tx.mediaAsset.groupBy({
          by: ['mimeType'],
          where: scope,
          _count: { _all: true },
          orderBy: { mimeType: 'asc' },
        }),
        tx.mediaAsset.groupBy({
          by: ['eventId'],
          where: scope,
          _count: { _all: true },
        }),
      ]);

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

    const eventIds = eventGroups
      .map((group) => group.eventId)
      .filter((id): id is string => Boolean(id));

    const events = eventIds.length
      ? await tx.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true },
        })
      : [];

    const eventTitleById = new Map(events.map((event) => [event.id, event.title]));
    const withoutEvent = eventGroups.find((group) => group.eventId === null);

    const totalBytes = rows.reduce((sum, row) => sum + row.sizeBytes, 0);
    const libraryBytes = aggregate._sum.sizeBytes ?? 0;

    return {
      assets: rows,
      totalBytes,
      totalMegabytes: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
      matchedCount,
      limit: MEDIA_LIBRARY_LIMIT,
      truncated: matchedCount > rows.length,
      library: {
        count: aggregate._count._all,
        inUse: inUseCount,
        bytes: libraryBytes,
        megabytes: Math.round((libraryBytes / 1024 / 1024) * 10) / 10,
      },
      typeOptions: typeGroups.map((group) => ({
        value: group.mimeType,
        label: imageFormatLabel(group.mimeType),
        count: group._count._all,
      })),
      eventOptions: [
        ...(withoutEvent
          ? [
              {
                value: MEDIA_NO_SOURCE_EVENT,
                label: 'Sem evento (acervo da instituição)',
                count: withoutEvent._count._all,
              },
            ]
          : []),
        ...eventGroups
          .filter((group): group is typeof group & { eventId: string } => Boolean(group.eventId))
          .map((group) => ({
            value: group.eventId,
            label: eventTitleById.get(group.eventId) ?? 'Evento removido',
            count: group._count._all,
          }))
          .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR')),
      ],
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
export async function collectUsages(tx: TxClient, tenantId: string): Promise<Map<string, AssetUsage[]>> {
  const [events, sponsors, pages, speakers] = await Promise.all([
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
    /**
     * Foto de palestrante (FASE 25).
     *
     * Entrou na varredura junto com o alvo `SPEAKER_AVATAR`: sem isto, a biblioteca
     * ofereceria "excluir" para a foto que está na vitrine pública — e o visitante
     * veria um avatar quebrado sem ninguém entender por quê.
     */
    tx.speakerProfile.findMany({
      where: { tenantId, deletedAt: null, avatarUrl: { not: null } },
      select: { name: true, avatarUrl: true },
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

  for (const speaker of speakers) {
    add(speaker.avatarUrl, { kind: 'SPEAKER_AVATAR', label: `Foto do palestrante "${speaker.name}"` });
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
