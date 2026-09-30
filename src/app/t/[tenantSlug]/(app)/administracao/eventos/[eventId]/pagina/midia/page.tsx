import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HardDrive, ImageIcon, Search } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listMediaLibrary } from '@/lib/admin/media-asset-service';
import { formatBytes, imageFormatLabel } from '@/domain/events/image-rules';
import {
  MEDIA_USAGE_EM_USO,
  MEDIA_USAGE_LIVRE,
  normalizeMediaMimeType,
  normalizeMediaSearch,
  parseMediaSourceEvent,
  parseMediaUsageFilter,
} from '@/domain/events/media-filter-rules';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { AssetUploader } from '@/components/admin/asset-uploader';
import {
  confirmAssetUploadAction,
  deleteMediaAssetAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';

export const metadata = { title: 'Biblioteca de mídia' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BIBLIOTECA DE MÍDIA DA INSTITUIÇÃO (FASE 24, item E14 · filtros na FASE 51, E19)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA RESPONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *      • o que já foi enviado, por quem e quando;
 *      • quanto a instituição ocupa no storage;
 *      • ONDE cada imagem está sendo usada — e, portanto, se pode ser apagada;
 *      • QUAL imagem, entre centenas (filtros da dívida E19).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A EXCLUSÃO É RECUSADA QUANDO A IMAGEM ESTÁ EM USO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A referência da imagem é a URL (o conteúdo do bloco aceita imagem externa, e
 *  mudar isso quebraria páginas publicadas), então não há chave estrangeira para o
 *  banco proteger. O serviço procura a URL na capa do evento, no logotipo do
 *  patrocinador e no conteúdo dos blocos — e recusa dizendo ONDE ela está.
 *
 *  Apagar uma imagem em uso deixaria a página pública com um ícone quebrado, e o
 *  organizador não teria como saber por quê.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FILTRO É UM `<form method="get">`, E ISSO É DECISÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É o mesmo padrão do quadro de demandas e do diretório de participantes: a escolha
 *  mora na URL, então a tela funciona sem JavaScript, o resultado é compartilhável
 *  por link ("olha o que sobrou sem uso") e o botão "voltar" do navegador desfaz o
 *  filtro como desfaz qualquer navegação. Um filtro em estado de cliente daria o
 *  oposto nos três pontos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventMediaLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{ busca?: string; tipo?: string; evento?: string; uso?: string }>;
}) {
  const { tenantSlug, eventId } = await params;
  const { busca, tipo, evento, uso } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PAGE_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O QUE VEIO DA URL É NORMALIZADO ANTES DE VIRAR CONSULTA (dívida E19)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A URL é texto livre. `parseMediaSourceEvent` descarta id malformado (em vez de
   *  deixar a consulta lançar) e `normalizeMediaMimeType` acerta a caixa; o estado já
   *  limpo é o que alimenta o serviço E os campos do formulário, para que o que está
   *  escrito na tela seja exatamente o que foi aplicado.
   */
  const filters = {
    search: normalizeMediaSearch(busca),
    mimeType: normalizeMediaMimeType(tipo),
    sourceEventId: parseMediaSourceEvent(evento),
    inUse: parseMediaUsageFilter(uso),
  };

  const hasFilter =
    Boolean(filters.search) ||
    Boolean(filters.mimeType) ||
    Boolean(filters.sourceEventId) ||
    filters.inUse !== null;

  /**
   * O acervo é da INSTITUIÇÃO (`includeEverywhere`), não só deste evento: uma
   * imagem enviada na edição passada é exatamente o que se quer reaproveitar agora.
   */
  const library = await listMediaLibrary(tenantId, {
    eventId,
    includeEverywhere: true,
    filters,
  });

  const basePath = `/administracao/eventos/${eventId}/pagina/midia`;
  const mediaPath = tenantPath(tenantSlug, basePath);

  /**
   * O valor do campo "Uso" sai do filtro JÁ NORMALIZADO, e não da URL crua: o que está
   * escrito no formulário tem de ser exatamente o que foi aplicado na consulta.
   */
  const usageValue =
    filters.inUse === true ? MEDIA_USAGE_EM_USO : filters.inUse === false ? MEDIA_USAGE_LIVRE : '';

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`)}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Página pública
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">Biblioteca de mídia</h1>
        <p className="text-xs text-muted-foreground" data-testid="media-summary">
          {library.library.count} imagem(ns) no acervo da instituição · {library.library.inUse} em
          uso · {library.library.megabytes} MB ocupados
        </p>
        <p className="text-xs text-muted-foreground">
          O acervo é da instituição inteira: uma imagem enviada em outra edição pode ser
          reaproveitada aqui. A quota de armazenamento do plano ainda não bloqueia o envio
          (dívida C4) — esta tela apenas mede.
        </p>
      </header>

      {/* ── Envio ────────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ImageIcon className="size-4" aria-hidden />
          Enviar imagem
        </h2>

        <AssetUploader
          tenantSlug={tenantSlug}
          eventId={eventId}
          target="GALLERY"
          currentUrl={null}
          requestUploadAction={requestAssetUploadAction}
          confirmUploadAction={confirmAssetUploadAction}
        />

        <p className="text-xs text-muted-foreground">
          A imagem entra no acervo assim que o envio é confirmado. Para publicá-la, use o
          bloco de galeria no editor da página e escolha a imagem em “usar imagem do acervo”.
        </p>
      </section>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <form
        method="get"
        action={mediaPath}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
        data-testid="media-filters"
      >
        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Buscar</span>
          <input
            type="search"
            name="busca"
            defaultValue={filters.search ?? ''}
            placeholder="nome do arquivo ou URL"
            className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="media-filter-search"
          />
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Tipo</span>
          <select
            name="tipo"
            defaultValue={filters.mimeType ?? ''}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="media-filter-type"
          >
            <option value="">todos</option>
            {library.typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Evento de origem</span>
          <select
            name="evento"
            defaultValue={filters.sourceEventId ?? ''}
            className="max-w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="media-filter-event"
          >
            <option value="">todos</option>
            {library.eventOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-muted-foreground">Uso</span>
          <select
            name="uso"
            defaultValue={usageValue}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            data-testid="media-filter-usage"
          >
            <option value="">todos</option>
            <option value={MEDIA_USAGE_EM_USO}>em uso</option>
            <option value={MEDIA_USAGE_LIVRE}>sem uso (dá para excluir)</option>
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
          data-testid="media-filter-submit"
        >
          <Search className="mr-1 inline size-3.5" aria-hidden />
          Filtrar
        </button>

        <Link
          href={mediaPath}
          className="text-xs text-muted-foreground underline"
          data-testid="media-filter-clear"
        >
          limpar
        </Link>
      </form>

      {/* ── Acervo ───────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="media-library">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <HardDrive className="size-4" aria-hidden />
            Acervo ({library.matchedCount})
          </h2>
          <p className="text-xs text-muted-foreground">
            A imagem em uso não pode ser excluída — a tela diz onde ela está.
          </p>
        </div>

        {/**
          * ───────────────────────────────────────────────────────────────────────
          *  O TETO SE ANUNCIA (dívida E19)
          * ───────────────────────────────────────────────────────────────────────
          *  O mesmo padrão do quadro de demandas ("mostrando N de M"): esconder imagem
          *  em silêncio faria a pessoa concluir que o arquivo não existe. Aqui NÃO há
          *  link de "ver mais" como no quadro — o teto das 200 é o desenho da tela (a
          *  F24 o definiu assim), e o caminho para ver o resto é o que a dívida E19
          *  trouxe: FILTRAR. O aviso diz exatamente isso.
          */}
        <p className="text-xs text-muted-foreground" data-testid="media-result-count">
          {library.truncated
            ? `Mostrando ${library.assets.length} de ${library.matchedCount} imagens — refine os filtros para chegar no resto.`
            : `${library.matchedCount} imagem(ns) ${hasFilter ? 'no resultado' : 'no acervo'}.`}
        </p>

        {library.assets.length > 0 ? (
          <ul className="space-y-3" data-testid="media-list">
            {library.assets.map((asset) => (
              <li
                key={asset.id}
                data-testid={`media-${asset.id}`}
                data-in-use={asset.inUse ? 'true' : 'false'}
                className="flex flex-wrap items-start gap-4 rounded-lg border border-border p-3"
              >
                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.fileName} className="size-full object-cover" />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium">{asset.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset.targetLabel} · {imageFormatLabel(asset.mimeType)} ·{' '}
                    {formatBytes(asset.sizeBytes)} · {asset.createdAt.toLocaleDateString('pt-BR')}
                    {asset.uploadedByName ? ` · ${asset.uploadedByName}` : ''}
                    {asset.eventTitle ? ` · ${asset.eventTitle}` : ''}
                  </p>

                  {asset.inUse ? (
                    <ul className="space-y-0.5" data-testid={`media-usage-${asset.id}`}>
                      {asset.usages.map((usage) => (
                        <li key={usage.label} className="text-xs text-success-strong">
                          em uso: {usage.label}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">não está em uso</p>
                  )}

                  {/*
                    URL em campo somente leitura: o caminho manual de reuso (copiar e
                    colar) continua existindo para quem preferir — e é ele que permite
                    usar a imagem em outro sistema da instituição.
                  */}
                  <input
                    readOnly
                    value={asset.url}
                    aria-label={`URL de ${asset.fileName}`}
                    data-testid={`media-url-${asset.id}`}
                    className="code-data w-full rounded-sm border border-border bg-surface-low px-2 py-1 text-xs text-muted-foreground"
                  />
                </div>

                <InlineActionForm
                  action={deleteMediaAssetAction}
                  submitLabel="Excluir"
                  variant="destructive"
                  testId={`delete-media-${asset.id}`}
                  confirm={{
                    title: `Excluir “${asset.fileName}”?`,
                    description:
                      'O arquivo sai do acervo e do armazenamento — não há como desfazer. O registro de quem enviou fica na trilha de auditoria.',
                    confirmLabel: 'Excluir imagem',
                  }}
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <input type="hidden" name="assetId" value={asset.id} />
                </InlineActionForm>
              </li>
            ))}
          </ul>
        ) : hasFilter ? (
          /**
           * "Nada encontrado" e "acervo vazio" são coisas DIFERENTES, e a tela não
           * pode confundi-las: dizer "envie a primeira imagem" a quem filtrou por um
           * arquivo inexistente faria a pessoa procurar o botão de envio achando que o
           * acervo tinha se perdido.
           */
          <p className="text-sm text-muted-foreground" data-testid="empty-media-filtered">
            Nenhuma imagem corresponde aos filtros. O acervo tem {library.library.count}{' '}
            imagem(ns) —{' '}
            <Link href={mediaPath} className="underline underline-offset-4">
              limpar os filtros
            </Link>{' '}
            para ver todas.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="empty-media">
            Nenhuma imagem no acervo ainda. Envie a primeira acima — capa, logotipos e
            imagens de galeria entram todas aqui automaticamente.
          </p>
        )}
      </section>
    </main>
  );
}
