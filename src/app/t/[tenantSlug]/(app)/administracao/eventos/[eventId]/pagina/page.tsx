import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, EyeOff, LayoutTemplate } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getLandingForEdit } from '@/lib/admin/landing-service';
import { listPageVersions } from '@/lib/admin/page-version-service';
import { listMediaLibrary } from '@/lib/admin/media-asset-service';
import { listSponsorBoard } from '@/lib/admin/sponsor-service';
import {
  BLOCK_LABELS,
  BLOCK_WITHOUT_RENDERER,
  MAX_PAGE_BLOCKS,
  PUBLICATION_STATE_LABELS,
  type PageBlockType,
} from '@/domain/events/landing-page';
import { formatZonedDateTime, instantToZonedWallTime } from '@/domain/events/scheduling-rules';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { LandingThemeFields } from '@/components/admin/landing-theme-fields';
import { BlockContentFields } from '@/components/admin/block-content-fields';
import { blockContentToValues } from '@/components/admin/block-content-values';
import { AssetUploader } from '@/components/admin/asset-uploader';
import {
  addBlockAction,
  confirmAssetUploadAction,
  deleteBlockAction,
  ensureHomePageAction,
  moveBlockAction,
  requestAssetUploadAction,
  restorePageVersionAction,
  savePageSettingsAction,
  seedRecommendedBlocksAction,
  updateBlockAction,
} from '@/app/actions/landing-actions';

export const metadata = { title: 'Página pública do evento' };
export const dynamic = 'force-dynamic';

const BLOCK_OPTIONS = (Object.keys(BLOCK_LABELS) as PageBlockType[]).map((type) => ({
  value: type,
  label: BLOCK_LABELS[type],
}));

/** `Date` → valor de `<input type="datetime-local">`, NO FUSO DO EVENTO (E17). */
function toLocalInput(date: Date | null, timeZone: string): string {
  if (!date) return '';
  return instantToZonedWallTime(date, timeZone);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDITOR DA PÁGINA PÚBLICA (FASE 17, itens E3 e E4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PÁGINA MOSTRA OS BLOCOS COMO UMA LISTA ORDENADA, E NÃO UM "PALCO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tentação é fazer um editor de arrastar e soltar que desenhe a página. Ele
 *  custaria uma biblioteca de drag-and-drop, não funcionaria no teclado e não
 *  resolveria o problema real: o organizador precisa saber O QUE está na página, em
 *  que ORDEM, e o que falta preencher. Uma lista com resumo por bloco responde isso
 *  em uma olhada — e o resultado final ele confere no link "ver página".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O AVISO DE "NÃO APARECE NA PÁGINA" NÃO É DETALHE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um bloco vazio existe na configuração e não é renderizado. O organizador que não
 *  souber disso conclui que o editor está quebrado. Cada bloco da lista diz o que
 *  tem (ou que está vazio), e os tipos sem renderizador são marcados como tal.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventLandingPageEditor({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PAGE_MANAGE,
  });

  const landing = await getLandingForEdit(tenantId, eventId);
  if (!landing) notFound();

  const [board, history, library] = await Promise.all([
    listSponsorBoard(tenantId, eventId),
    listPageVersions(tenantId, eventId),
    listMediaLibrary(tenantId),
  ]);

  const tierOptions = (board?.tiers ?? []).map((tier) => ({
    value: tier.id,
    label: `${tier.name} (${tier.sponsorCount} patrocinador(es))`,
  }));

  /**
   * Imagens do acervo para REUSO no bloco de galeria (FASE 24).
   *
   * A lista alimenta um seletor por linha: sem ela, reaproveitar uma imagem exigia
   * abrir a biblioteca, copiar a URL e voltar.
   */
  const libraryOptions = library.assets
    .filter((asset) => asset.mimeType.startsWith('image/'))
    .slice(0, 50)
    .map((asset) => ({
      value: asset.url,
      label: asset.eventTitle ? `${asset.fileName} · ${asset.eventTitle}` : asset.fileName,
    }));

  const page = landing.page;

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← {landing.eventTitle}
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">Página pública</h1>
        <p className="text-xs text-muted-foreground" data-testid="landing-status">
          {page
            ? PUBLICATION_STATE_LABELS[page.publicationState]
            : 'O evento ainda não tem página configurada.'}
        </p>
        <p className="flex flex-wrap items-center gap-4 text-xs">
          {/*
            A pré-visualização vem ANTES do link público de propósito: é o que o
            organizador precisa enquanto monta (FASE 23, item E9). Sem ela, a única
            forma de ver a página era publicar — e o rascunho ficava no ar no meio do
            caminho.
          */}
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina/previa`)}
            className="font-medium underline underline-offset-4"
            data-testid="preview-page"
          >
            Pré-visualizar →
          </Link>
          <Link
            href={tenantPath(tenantSlug, `/eventos/${landing.eventSlug}`)}
            target="_blank"
            className="underline underline-offset-4"
            data-testid="view-public-page"
          >
            Ver página pública →
          </Link>
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/patrocinadores`)}
            className="underline underline-offset-4"
            data-testid="sponsors-link"
          >
            Patrocinadores →
          </Link>
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina/midia`)}
            className="underline underline-offset-4"
            data-testid="media-link"
          >
            Biblioteca de mídia ({library.assets.length}) →
          </Link>
        </p>
      </header>

      {/* ── Sem página: criar ─────────────────────────────────────────────── */}
      {!page ? (
        <section className="space-y-3 rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Criar a página do evento</h2>
          <p className="text-sm text-muted-foreground">
            A página nasce como <strong>rascunho</strong>: você monta os blocos com calma e publica
            quando estiver pronta. Nada aparece para os visitantes antes disso.
          </p>

          <AdminForm action={ensureHomePageAction} submitLabel="Criar página" testId="create-page" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
          </AdminForm>
        </section>
      ) : (
        <>
          {/* ── Publicação, SEO e aparência ──────────────────────────────── */}
          <details
            className="rounded-xl border border-border bg-card p-5"
            data-testid="page-settings"
            open
          >
            <summary className="cursor-pointer text-base font-semibold">
              <LayoutTemplate className="mr-2 inline size-4" aria-hidden />
              Publicação e aparência
            </summary>

            <div className="space-y-4 pt-4">
              <AdminForm action={savePageSettingsAction} submitLabel="Salvar página" testId="save-page">
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={eventId} />
                {/*
                  O fuso do EVENTO viaja com o formulário (FASE 24, item E17): é o
                  fuso em que as datas foram DIGITADAS e mostradas. Lido no servidor,
                  seria o fuso do processo — e a conversão gravaria outra hora.
                */}
                <input type="hidden" name="eventTimezone" value={landing.eventTimezone} />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Título da página" name="title" required defaultValue={page.title} />
                  <Field
                    label="Título para busca (SEO)"
                    name="metaTitle"
                    defaultValue={page.metaTitle}
                    hint="Vazio usa o título do evento."
                  />
                  <Field
                    label="Descrição para busca"
                    name="metaDescription"
                    defaultValue={page.metaDescription}
                    hint="Até 320 caracteres. Vazio usa o resumo do evento."
                  />
                </div>

                <CheckboxField
                  label="Publicar a página agora"
                  name="isPublished"
                  defaultChecked={page.isPublished}
                  hint="Desmarcada, a página volta a ser rascunho e o agendamento é CANCELADO (senão ela voltaria ao ar sozinha na data marcada)."
                />

                <Field
                  label="Agendar para entrar no ar"
                  name="publishAt"
                  type="datetime-local"
                  defaultValue={toLocalInput(page.publishAt, landing.eventTimezone)}
                  hint={`No fuso do evento (${landing.eventTimezone}). Preencha esta data OU marque “publicar agora” — as duas juntas são recusadas.`}
                />

                {/*
                  Janela de exibição (FASE 24, item E16): a página SAI do ar sozinha.
                  Sem isso, uma campanha com prazo exigia alguém despublicando no dia
                  — e promoção vencida publicada é pior do que promoção atrasada.
                */}
                <Field
                  label="Sair do ar em"
                  name="unpublishAt"
                  type="datetime-local"
                  defaultValue={toLocalInput(page.unpublishAt, landing.eventTimezone)}
                  hint="Opcional. A página sai do ar sozinha nesta data, sem perder a configuração — você pode publicar de novo depois."
                />

                {page.publishAt || page.unpublishAt ? (
                  <p className="text-xs text-muted-foreground" data-testid="publication-window">
                    Janela de exibição:{' '}
                    {page.publishAt
                      ? `entra em ${formatZonedDateTime(page.publishAt, landing.eventTimezone)}`
                      : 'entra imediatamente'}
                    {page.unpublishAt
                      ? ` e sai em ${formatZonedDateTime(page.unpublishAt, landing.eventTimezone)}`
                      : ' (sem data de saída)'}
                    {' · '}
                    {landing.eventTimezone}
                  </p>
                ) : null}

                <LandingThemeFields
                  theme={{
                    primaryColor: String(landing.theme.primaryColor ?? ''),
                    secondaryColor: String(landing.theme.secondaryColor ?? ''),
                    accentColor: String(landing.theme.accentColor ?? ''),
                    backgroundColor: String(landing.theme.backgroundColor ?? ''),
                    textColor: String(landing.theme.textColor ?? ''),
                    colorMode: String(landing.theme.colorMode ?? 'light'),
                    radius: Number(landing.theme.radius ?? 12),
                    fontFamily: String(landing.theme.fontFamily ?? 'inter'),
                    spacing: String(landing.theme.spacing ?? 'normal'),
                    heroStyle: String(landing.theme.heroStyle ?? 'gradient'),
                    animation: String(landing.theme.animation ?? 'fade'),
                  }}
                />
              </AdminForm>

              {!landing.themeIsValid ? (
                <p className="text-xs text-warning-strong" role="alert">
                  O tema gravado no evento é inválido e a página está usando o padrão do sistema.
                  Salvar a aparência acima corrige isso.
                </p>
              ) : null}
            </div>
          </details>

          {/* ── Imagem de capa e logotipo ────────────────────────────────── */}
          <details className="rounded-xl border border-border bg-card p-5" data-testid="page-assets">
            <summary className="cursor-pointer text-base font-semibold">Imagem de capa e logotipo</summary>
            <div className="space-y-4 pt-4">
              <AssetUploader
                tenantSlug={tenantSlug}
                eventId={eventId}
                target="COVER"
                currentUrl={landing.coverImageUrl}
                requestUploadAction={requestAssetUploadAction}
                confirmUploadAction={confirmAssetUploadAction}
              />
              <AssetUploader
                tenantSlug={tenantSlug}
                eventId={eventId}
                target="LOGO"
                currentUrl={landing.logoUrl}
                requestUploadAction={requestAssetUploadAction}
                confirmUploadAction={confirmAssetUploadAction}
              />
            </div>
          </details>

          {/* ── Blocos ───────────────────────────────────────────────────── */}
          <section className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="block-editor">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">
                Blocos ({page.blocks.length}/{MAX_PAGE_BLOCKS})
              </h2>
              <p className="text-xs text-muted-foreground">
                A ordem abaixo é a ordem em que os blocos aparecem na página.
              </p>
            </div>

            {page.blocks.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground" data-testid="empty-blocks">
                  Nenhum bloco configurado. Sem blocos, a página pública usa a composição padrão
                  (apresentação, programação e patrocinadores).
                </p>
                <InlineActionForm
                  action={seedRecommendedBlocksAction}
                  submitLabel="Aplicar composição sugerida"
                  testId="seed-blocks"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                </InlineActionForm>
              </div>
            ) : (
              <ol className="space-y-3" data-testid="block-list">
                {page.blocks.map((block, index) => {
                  const values = blockContentToValues(block.type, block.content);
                  const empty = block.summary.includes('vazio') || block.summary.includes('nenhum');

                  return (
                    <li
                      key={block.id}
                      data-testid={`block-${block.id}`}
                      data-type={block.type}
                      className="space-y-3 rounded-lg border border-border p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <span className="code-data text-muted-foreground">{index + 1}.</span>
                            {BLOCK_LABELS[block.type]}
                            {!block.isVisible ? (
                              <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                                <EyeOff className="mr-1 inline size-3" aria-hidden />
                                oculto
                              </span>
                            ) : null}
                            {BLOCK_WITHOUT_RENDERER.has(block.type) ? (
                              <span
                                className="rounded border border-warning/40 px-1.5 py-0.5 text-xs text-warning-strong"
                                data-testid={`block-pending-${block.id}`}
                              >
                                não aparece na página
                              </span>
                            ) : null}
                            {empty ? (
                              <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                                vazio
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground" data-testid={`block-summary-${block.id}`}>
                            {block.summary}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-1">
                          <InlineActionForm
                            action={moveBlockAction}
                            submitLabel="Subir"
                            testId={`move-up-${block.id}`}
                            quietSuccess
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="blockId" value={block.id} />
                            <input type="hidden" name="direction" value="up" />
                          </InlineActionForm>

                          <InlineActionForm
                            action={moveBlockAction}
                            submitLabel="Descer"
                            testId={`move-down-${block.id}`}
                            quietSuccess
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="blockId" value={block.id} />
                            <input type="hidden" name="direction" value="down" />
                          </InlineActionForm>

                          <InlineActionForm
                            action={deleteBlockAction}
                            submitLabel="Remover"
                            variant="destructive"
                            testId={`delete-block-${block.id}`}
                            confirm={{
                              title: `Remover o bloco “${BLOCK_LABELS[block.type]}”?`,
                              description:
                                'O bloco sai da página na hora. O conteúdo atual continua no histórico de versões, e você pode restaurá-lo por lá.',
                              confirmLabel: 'Remover bloco',
                            }}
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="blockId" value={block.id} />
                          </InlineActionForm>
                        </div>
                      </div>

                      <details className="rounded-md border border-border p-3">
                        <summary className="cursor-pointer text-xs font-medium">
                          Editar conteúdo
                        </summary>
                        <div className="pt-3">
                          <AdminForm
                            action={updateBlockAction}
                            submitLabel="Salvar bloco"
                            testId={`block-form-${block.id}`}
                            compact
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="eventId" value={eventId} />
                            <input type="hidden" name="blockId" value={block.id} />
                            <input type="hidden" name="type" value={block.type} />

                            <BlockContentFields
                              type={block.type}
                              values={values}
                              tierOptions={tierOptions}
                              libraryOptions={libraryOptions}
                              uploadContext={{
                                tenantSlug,
                                eventId,
                                requestUploadAction: requestAssetUploadAction,
                                confirmUploadAction: confirmAssetUploadAction,
                              }}
                            />

                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                name="isVisible"
                                defaultChecked={block.isVisible}
                                className="size-4 accent-primary"
                              />
                              {block.isVisible ? (
                                <Eye className="size-3.5 text-muted-foreground" aria-hidden />
                              ) : (
                                <EyeOff className="size-3.5 text-muted-foreground" aria-hidden />
                              )}
                              Visível na página
                            </label>
                          </AdminForm>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* ── Adicionar bloco ───────────────────────────────────────── */}
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-medium">Adicionar bloco</h3>
              <AdminForm action={addBlockAction} submitLabel="Adicionar" testId="add-block" compact>
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={eventId} />
                <SelectField
                  label="Tipo de bloco"
                  name="type"
                  options={BLOCK_OPTIONS}
                  defaultValue="RICH_TEXT"
                  hint="O bloco entra no fim da página e é editado logo acima."
                />
              </AdminForm>
            </div>
          </section>

          {/* ── Histórico de versões (FASE 23, item E12) ─────────────────── */}
          <details className="rounded-xl border border-border bg-card p-5" data-testid="version-history">
            <summary className="cursor-pointer text-base font-semibold">
              Histórico de versões ({history?.versions.length ?? 0}/{history?.max ?? 20})
            </summary>

            <div className="space-y-3 pt-4">
              <p className="text-xs text-muted-foreground">
                Cada alteração relevante grava uma fotografia da página inteira (blocos incluídos).
                Restaurar devolve o conteúdo daquele momento — <strong>sem</strong> mexer em
                publicação: um “desfazer” que republicasse a página seria uma surpresa desagradável.
              </p>

              {history && history.versions.length > 0 ? (
                <ul className="divide-y divide-border rounded-lg border border-border" data-testid="version-list">
                  {history.versions.map((version) => (
                    <li
                      key={version.id}
                      data-testid={`version-${version.id}`}
                      data-current={version.isCurrent ? 'true' : 'false'}
                      className="flex flex-wrap items-start justify-between gap-3 p-3"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {version.reason}
                          {version.isCurrent ? (
                            <span
                              className="rounded border border-success/40 px-1.5 py-0.5 text-xs text-success-strong"
                              data-testid={`version-current-${version.id}`}
                            >
                              estado atual
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {version.createdAt.toLocaleString('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                          {version.actorName ? ` · ${version.actorName}` : ''} ·{' '}
                          {version.blockCount} bloco(s)
                          {version.isPublished ? ' · publicada' : ''}
                          {!version.isPublished && version.publishAt
                            ? ` · agendada para ${version.publishAt.toLocaleDateString('pt-BR')}`
                            : ''}
                        </p>
                      </div>

                      {version.isCurrent ? null : (
                        <InlineActionForm
                          action={restorePageVersionAction}
                          submitLabel="Restaurar"
                          testId={`restore-${version.id}`}
                          confirm={{
                            title: 'Restaurar esta versão?',
                            description:
                              'O conteúdo atual da página é substituído pelo desta versão. Nada se perde: a versão de agora continua no histórico.',
                            confirmLabel: 'Restaurar versão',
                            tone: 'default',
                          }}
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="eventId" value={eventId} />
                          <input type="hidden" name="versionId" value={version.id} />
                        </InlineActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="empty-versions">
                  Ainda não há versões: elas aparecem a partir da primeira alteração relevante.
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </main>
  );
}
