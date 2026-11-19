'use client';

import { useActionState } from 'react';
import { BookOpen, CheckCircle2, Download, ExternalLink, Globe, Import } from 'lucide-react';

import {
  Alert,
  AppLink,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FormStatusButton,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui';
import type { ProceedingsActionState } from '@/app/actions/proceedings-actions';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import type { AdminProceedingsEntryView, AdminProceedingsOverview } from '@/lib/proceedings/proceedings-service';
import {
  PROCEEDINGS_PUBLIC_FILE_KINDS,
  PROCEEDINGS_STATUS_LABELS,
} from '@/domain/proceedings/proceedings-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

function EntryEditorRow(props: {
  tenantSlug: string;
  eventId: string;
  entry: AdminProceedingsEntryView;
  updateAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
}) {
  const [state, formAction] = useActionState(props.updateAction, null);

  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      data-testid={`proceedings-entry-${props.entry.protocol}`}
    >
      <input type="hidden" name="tenantSlug" value={props.tenantSlug} />
      <input type="hidden" name="eventId" value={props.eventId} />
      <input type="hidden" name="entryId" value={props.entry.id} />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-border px-2 py-0.5 text-xs font-mono text-muted-foreground">
              {props.entry.protocol}
            </span>
            {props.entry.trackName ? (
              <Badge tone="neutral">{props.entry.trackName}</Badge>
            ) : null}
            {props.entry.authorPermissionAcceptedAt ? (
              <Badge tone="success">Termo aceito pelo autor</Badge>
            ) : (
              <Badge tone="warning">Sem aceite expresso do autor</Badge>
            )}
          </div>
          <p className="text-sm font-medium">{props.entry.title}</p>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id={`include-${props.entry.id}`}
            name="includeInProceedings"
            defaultChecked={props.entry.includeInProceedings}
          />
          <Label htmlFor={`include-${props.entry.id}`} className="text-xs font-medium">
            Incluir no volume
          </Label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1.5">
          <Label htmlFor={`order-${props.entry.id}`}>Ordem</Label>
          <Input
            id={`order-${props.entry.id}`}
            name="displayOrder"
            type="number"
            min={1}
            max={9999}
            defaultValue={props.entry.displayOrder}
          />
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor={`section-${props.entry.id}`}>Seção / Eixo</Label>
          <Input
            id={`section-${props.entry.id}`}
            name="sectionName"
            defaultValue={props.entry.sectionName ?? ''}
            placeholder="Ex.: Trilha Principal"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`pstart-${props.entry.id}`}>Página inicial</Label>
          <Input
            id={`pstart-${props.entry.id}`}
            name="pageStart"
            type="number"
            min={1}
            defaultValue={props.entry.pageStart ?? ''}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`pend-${props.entry.id}`}>Página final</Label>
          <Input
            id={`pend-${props.entry.id}`}
            name="pageEnd"
            type="number"
            min={1}
            defaultValue={props.entry.pageEnd ?? ''}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`file-${props.entry.id}`}>Arquivo público</Label>
          <Select
            id={`file-${props.entry.id}`}
            name="publicFileKind"
            defaultValue={props.entry.publicFileKind ?? ''}
          >
            <option value="">Apenas metadados e resumo</option>
            {PROCEEDINGS_PUBLIC_FILE_KINDS.map((kind) => {
              const available = props.entry.availableFiles.find((f) => f.kind === kind);
              return (
                <option key={kind} value={kind} disabled={!available}>
                  {kind === 'CAMERA_READY' ? 'Versão final (camera-ready)' : 'PDF identificado'}
                  {available ? ` (v${available.version})` : ' — indisponível'}
                </option>
              );
            })}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor={`doi-${props.entry.id}`}>DOI externo (opcional, ex.: Zenodo)</Label>
          <Input
            id={`doi-${props.entry.id}`}
            name="externalDoi"
            defaultValue={props.entry.externalDoi ?? ''}
            placeholder="10.5281/zenodo.1234567"
          />
        </div>

        <FormStatusButton
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium hover:bg-secondary/80 disabled:opacity-60"
          pendingContent="Salvando..."
        >
          Salvar item
        </FormStatusButton>
      </div>

      {state ? (
        <Alert tone={state.ok ? 'success' : 'danger'} title={state.ok ? 'Salvo' : 'Erro'}>
          {state.message}
        </Alert>
      ) : null}
    </form>
  );
}

export function ProceedingsAdminPanel(props: {
  tenantSlug: string;
  overview: AdminProceedingsOverview;
  saveVolumeAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
  importAcceptedAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
  updateEntryAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
  publishAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
  unpublishAction: (
    prev: ProceedingsActionState | null,
    formData: FormData,
  ) => Promise<ProceedingsActionState>;
}) {
  const { overview, tenantSlug } = props;
  const volume = overview.volume;
  const isPublished = volume?.status === 'PUBLISHED';

  const [saveState, saveFormAction] = useActionState(props.saveVolumeAction, null);
  const [importState, importFormAction] = useActionState(props.importAcceptedAction, null);
  const [publishState, publishFormAction] = useActionState(props.publishAction, null);
  const [unpublishState, unpublishFormAction] = useActionState(props.unpublishAction, null);
  const { isCopied, copy } = useCopyToClipboard(2_000);
  const copiedOai = isCopied();

  const publicProceedingsHref = tenantPath(tenantSlug, `/eventos/${overview.event.slug}/anais`);
  const oaiRelativePath = `/api/t/${tenantSlug}/eventos/${overview.event.slug}/oai?verb=ListRecords&metadataPrefix=oai_dc`;

  function copyOaiEndpoint() {
    const fullUrl = `${window.location.origin}/api/t/${tenantSlug}/eventos/${overview.event.slug}/oai`;
    void copy(fullUrl);
  }

  return (
    <div className="space-y-8">
      {/* ── Status e Publicação ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle>Estado da publicação</CardTitle>
              <Badge tone={isPublished ? 'success' : 'neutral'} data-testid="proceedings-status-badge">
                {volume ? PROCEEDINGS_STATUS_LABELS[volume.status] : 'Não criado'}
              </Badge>
            </div>
            <CardDescription>
              Trabalhos aceitos só ficam visíveis publicamente e indexáveis após a publicação explícita deste volume.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isPublished ? (
              <>
                <AppLink
                  href={publicProceedingsHref}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                  data-testid="open-public-proceedings"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  Abrir página pública dos Anais
                </AppLink>

                <form action={unpublishFormAction}>
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={overview.event.id} />
                  <FormStatusButton
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-60"
                    pendingContent="Retirando..."
                  >
                    Voltar para rascunho
                  </FormStatusButton>
                </form>
              </>
            ) : (
              <form action={publishFormAction}>
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="eventId" value={overview.event.id} />
                <FormStatusButton
                  data-testid="publish-proceedings-button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  pendingContent="Publicando anais..."
                  showSpinner
                >
                  <Globe className="size-3.5" aria-hidden />
                  Publicar Anais
                </FormStatusButton>
              </form>
            )}
          </div>
        </CardHeader>

        {publishState ? (
          <CardContent className="pt-0">
            <Alert tone={publishState.ok ? 'success' : 'danger'} title={publishState.ok ? 'Publicado' : 'Atenção'}>
              {publishState.message}
            </Alert>
          </CardContent>
        ) : null}

        {unpublishState ? (
          <CardContent className="pt-0">
            <Alert tone={unpublishState.ok ? 'success' : 'danger'} title={unpublishState.ok ? 'Atualizado' : 'Erro'}>
              {unpublishState.message}
            </Alert>
          </CardContent>
        ) : null}
      </Card>

      {/* ── Ficha catalográfica do volume ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" aria-hidden />
            Ficha editorial do volume
          </CardTitle>
          <CardDescription>
            Esses metadados alimentam ABNT, APA, BibTeX, RIS, metatags do Google Acadêmico e protocolo OAI-PMH.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveFormAction} className="space-y-4">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={overview.event.id} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="title" label="Título dos Anais" required className="sm:col-span-2">
                <Input
                  id="title"
                  name="title"
                  required
                  defaultValue={volume?.title ?? `Anais — ${overview.event.title}`}
                />
              </Field>

              <Field name="subtitle" label="Subtítulo (opcional)" className="sm:col-span-2">
                <Input
                  id="subtitle"
                  name="subtitle"
                  defaultValue={volume?.subtitle ?? ''}
                />
              </Field>

              <Field name="volumeLabel" label="Volume / Edição">
                <Input
                  id="volumeLabel"
                  name="volumeLabel"
                  defaultValue={volume?.volumeLabel ?? ''}
                  placeholder="Ex.: v. 1"
                />
              </Field>

              <Field name="editionYear" label="Ano da edição" required>
                <Input
                  id="editionYear"
                  name="editionYear"
                  type="number"
                  min={1900}
                  max={2100}
                  required
                  defaultValue={volume?.editionYear ?? overview.event.editionYear}
                />
              </Field>

              <Field name="editors" label="Organizadores / Editores">
                <Input
                  id="editors"
                  name="editors"
                  defaultValue={volume?.editors ?? ''}
                  placeholder="Ex.: Maria Silva; João Souza"
                />
              </Field>

              <Field name="publisherName" label="Editora / Selo institucional">
                <Input
                  id="publisherName"
                  name="publisherName"
                  defaultValue={volume?.publisherName ?? ''}
                />
              </Field>

              <Field name="issn" label="ISSN (opcional)">
                <Input
                  id="issn"
                  name="issn"
                  defaultValue={volume?.issn ?? ''}
                  placeholder="1234-5678"
                />
              </Field>

              <Field name="isbn" label="ISBN (opcional)">
                <Input
                  id="isbn"
                  name="isbn"
                  defaultValue={volume?.isbn ?? ''}
                  placeholder="978-65-00000-00-0"
                />
              </Field>

              <Field name="preface" label="Apresentação / Prefácio (opcional)" className="sm:col-span-2">
                <Textarea
                  id="preface"
                  name="preface"
                  rows={3}
                  defaultValue={volume?.preface ?? ''}
                />
              </Field>
            </div>

            {saveState ? (
              <Alert tone={saveState.ok ? 'success' : 'danger'} title={saveState.ok ? 'Volume salvo' : 'Erro'}>
                {saveState.message}
              </Alert>
            ) : null}

            <FormStatusButton
              data-testid="save-proceedings-volume"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              pendingContent="Salvando volume..."
              showSpinner
            >
              Salvar ficha do volume
            </FormStatusButton>
          </form>
        </CardContent>
      </Card>

      {/* ── Curadoria de trabalhos aceitos ─────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Trabalhos aceitos no volume ({overview.entries.length})</CardTitle>
            <CardDescription>
              {overview.pendingAcceptedCount > 0
                ? `${overview.pendingAcceptedCount} ${overview.pendingAcceptedCount === 1 ? 'trabalho aceito ainda não importado' : 'trabalhos aceitos ainda não importados'}.`
                : 'Todos os trabalhos aceitos já estão listados abaixo.'}
            </CardDescription>
          </div>

          <form action={importFormAction}>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={overview.event.id} />
            <FormStatusButton
              data-testid="import-accepted-submissions"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-medium hover:bg-secondary/80 disabled:opacity-60"
              pendingContent="Importando..."
              showSpinner
            >
              <Import className="size-3.5" aria-hidden />
              Importar trabalhos aceitos
            </FormStatusButton>
          </form>
        </CardHeader>

        <CardContent className="space-y-4">
          {importState ? (
            <Alert tone={importState.ok ? 'success' : 'danger'} title={importState.ok ? 'Importação concluída' : 'Erro'}>
              {importState.message}
            </Alert>
          ) : null}

          {overview.entries.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nenhum trabalho no volume ainda. Aceite submissões no comitê e clique em “Importar trabalhos aceitos”.
            </p>
          ) : (
            <div className="space-y-3">
              {overview.entries.map((entry) => (
                <EntryEditorRow
                  key={entry.id}
                  tenantSlug={tenantSlug}
                  eventId={overview.event.id}
                  entry={entry}
                  updateAction={props.updateEntryAction}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Indexação aberta e colheita OAI-PMH ────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Indexação acadêmica gratuita</CardTitle>
          <CardDescription>
            Ativa automaticamente ao publicar: metatags Highwire Press + Dublin Core, JSON-LD ScholarlyArticle, Sitemap dinâmico e OAI-PMH 2.0 (sem custos de infraestrutura).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <code className="rounded bg-muted px-2.5 py-1.5 text-xs">{oaiRelativePath}</code>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyOaiEndpoint}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              {copiedOai ? (
                <>
                  <CheckCircle2 className="size-3.5 text-success-strong" aria-hidden />
                  URL OAI copiada
                </>
              ) : (
                <>
                  <Download className="size-3.5" aria-hidden />
                  Copiar URL OAI-PMH
                </>
              )}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
