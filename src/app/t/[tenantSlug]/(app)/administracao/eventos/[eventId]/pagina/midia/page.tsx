import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HardDrive, ImageIcon } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listMediaLibrary } from '@/lib/admin/media-asset-service';
import { formatBytes, imageFormatLabel } from '@/domain/events/image-rules';
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
 *  BIBLIOTECA DE MÍDIA DA INSTITUIÇÃO (FASE 24, item E14)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA RESPONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *      • o que já foi enviado, por quem e quando;
 *      • quanto a instituição ocupa no storage;
 *      • ONDE cada imagem está sendo usada — e, portanto, se pode ser apagada.
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
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventMediaLibraryPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PAGE_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * O acervo é da INSTITUIÇÃO (`includeEverywhere`), não só deste evento: uma
   * imagem enviada na edição passada é exatamente o que se quer reaproveitar agora.
   */
  const library = await listMediaLibrary(tenantId, { eventId, includeEverywhere: true });

  const usedCount = library.assets.filter((asset) => asset.inUse).length;

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
          {library.assets.length} imagem(ns) no acervo da instituição · {usedCount} em uso ·{' '}
          {library.totalMegabytes} MB ocupados
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

      {/* ── Acervo ───────────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5" data-testid="media-library">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <HardDrive className="size-4" aria-hidden />
            Acervo ({library.assets.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            A imagem em uso não pode ser excluída — a tela diz onde ela está.
          </p>
        </div>

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
