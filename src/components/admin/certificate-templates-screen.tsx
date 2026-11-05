import Link from 'next/link';
import { CheckCircle2, FileBadge, Image as ImageIcon, Plus, Sparkles } from 'lucide-react';

import {
  CERTIFICATE_KIND_LABELS,
  CERTIFICATE_KINDS,
  type CertificateKind,
} from '@/domain/certificates/certificate-rules';
import {
  CERTIFICATE_PAGE_FORMAT_LABELS,
  CERTIFICATE_TEMPLATE_PRESETS,
  backgroundFitNotice,
  certificatePreviewSample,
  findPreset,
  selectEffectiveTemplate,
  type CertificateLayout,
  type CertificatePreviewVariant,
} from '@/domain/certificates/certificate-layout-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { resolveUuidQueryFilter } from '@/domain/validation/query-filter-rules';
import {
  getCertificateTemplate,
  listCertificateTemplates,
  readTemplateBackground,
  type CertificateTemplateSummary,
} from '@/lib/certificates/certificate-template-service';
import { renderCertificateLayoutSvg } from '@/lib/certificates/layout-renderer';
import {
  CertificateTemplateEditor,
  type EditorElement,
  type EditorModel,
} from '@/components/admin/certificate-template-editor';
import { Alert, Card, CardContent, SectionHeading } from '@/components/ui';
import {
  clearTemplateBackgroundAction,
  deleteCertificateTemplateFormAction,
  previewCertificateTemplateAction,
  saveCertificateTemplateAction,
  uploadTemplateBackgroundAction,
} from '@/app/actions/certificate-actions';

const KIND_OPTIONS = CERTIFICATE_KINDS.map((kind: CertificateKind) => ({
  value: kind,
  label: CERTIFICATE_KIND_LABELS[kind],
}));

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** O alvo do modelo, em uma linha. O evento já está no título da seção. */
function kindLabel(template: { kind: string | null }): string {
  return template.kind
    ? CERTIFICATE_KIND_LABELS[template.kind as CertificateKind] ?? template.kind
    : 'Qualquer tipo de certificado';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A GALERIA, OS MODELOS PRONTOS E O EDITOR — UMA TELA, DOIS ALVOS (FASE 86)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE MÓDULO É DIVIDIDO EM CARREGAR + RENDERIZAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As telas de modelo do EVENTO e da INSTITUIÇÃO mostram a mesma bancada: lista,
 *  modelos prontos, editor com palco e as duas prévias. Duplicar isso seriam duas
 *  cópias do mesmo comportamento — a primeira correção feita só em uma delas faria
 *  o desenho depender de qual endereço a pessoa abriu.
 *
 *  O carregamento (`loadCertificateTemplatesScreen`) e o desenho
 *  (`CertificateTemplatesScreen`) são separados porque o segundo é SÍNCRONO: as
 *  páginas são `async` e o teste de integração renderiza o elemento devolvido por
 *  elas com `renderToStaticMarkup`, que não espera um componente-assíncrono filho
 *  (ele suspende). O que muda entre as duas rotas é o ALVO, e ele vem do endereço,
 *  não de um campo de formulário.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA DO EVENTO MOSTRA DA INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Só os modelos padrão que ainda SERVEM de fallback para algum tipo — isto é, os
 *  que nenhum modelo do evento substitui pela precedência. Mostrar todos faria a
 *  lista prometer um desenho que a emissão não usaria naquele evento. Eles são
 *  somente LEITURA: o alvo do modelo é imutável, então editar um padrão a partir do
 *  evento o transformaria em outra coisa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface CertificateTemplatesScreenData {
  tenantSlug: string;
  /** `null` = modelos padrão da instituição. */
  event: { id: string; title: string } | null;
  basePath: string;
  filterNotice: string | null;
  outOfScope: boolean;
  own: CertificateTemplateSummary[];
  inherited: CertificateTemplateSummary[];
  institutionalCount: number;
  editingName: string | null;
  presetName: string | null;
  editorModel: EditorModel | null;
  salvo: boolean;
}

/**
 * Lê tudo o que a bancada precisa, preso ao alvo da rota.
 *
 * `filter.eventId` é o alvo: a tela do evento pede o que é dela + os padrões, e a
 * da instituição pede só os padrões. O `getCertificateTemplate` usa o MESMO alvo,
 * então `?modelo=` de outro evento não abre o editor (e não pode ser salvo).
 */
export async function loadCertificateTemplatesScreen(input: {
  tenantId: string;
  tenantSlug: string;
  event: { id: string; title: string } | null;
  query: { modelo?: string; novo?: string; salvo?: string };
}): Promise<CertificateTemplatesScreenData> {
  const { tenantId, tenantSlug, event, query } = input;

  /**
   * ─── O `?modelo=` É FILTRO, NÃO ENDEREÇO (FASE 76 · fatia 2) ────────────────
   * O endereço da tela é fixo; `modelo` decide qual editor abrir. Um texto que não é
   * uuid chegava ao Prisma e a tela respondia 500. Agora o filtro é descartado (a
   * galeria abre sem editor) e a tela ANUNCIA o descarte — a frase é do domínio.
   */
  const templateFilter = resolveUuidQueryFilter({ value: query.modelo, label: 'modelo' });
  const selectedTemplateId = templateFilter?.kind === 'applied' ? templateFilter.value : null;

  const own = await listCertificateTemplates(tenantId, { eventId: event?.id ?? null });
  const institutional = event ? await listCertificateTemplates(tenantId, { eventId: null }) : [];

  /**
   * O que a instituição ainda oferece de fallback PARA ESTE EVENTO.
   *
   * A conta é a MESMA precedência da emissão (`selectEffectiveTemplate`): se para
   * algum tipo o vencedor é um modelo sem evento, ele ainda vale e aparece aqui. Um
   * padrão que todo tipo já substituiu não entra — a tela não lista o que não pode
   * ser usado.
   */
  const inherited = event
    ? institutional.filter((template) =>
        CERTIFICATE_KINDS.some((kind) => {
          const picked = selectEffectiveTemplate([...own, ...institutional], {
            eventId: event.id,
            kind,
          });

          return picked?.id === template.id;
        }),
      )
    : [];

  const editing = selectedTemplateId
    ? await getCertificateTemplate(tenantId, selectedTemplateId, {
        eventId: event?.id ?? null,
      })
    : null;
  const preset = query.novo ? findPreset(query.novo) : null;

  /**
   * O `?modelo=` válido que NÃO pertence a este alvo não abre o editor. A tela diz
   * por quê em vez de simplesmente ignorar o parâmetro: quem chegou por um link
   * antigo precisa saber que o modelo é de outro evento.
   */
  const outOfScope = selectedTemplateId !== null && editing === null && preset === null;

  const basePath = event
    ? tenantPath(tenantSlug, `/administracao/eventos/${event.id}/certificados/modelos`)
    : tenantPath(tenantSlug, '/administracao/certificados/modelos');

  let editorModel: EditorModel | null = null;

  if (editing) {
    const backgroundHref = await backgroundDataUri(editing.layout);
    /**
     * Os BYTES da arte são lidos UMA vez para as duas prévias: a leitura vai ao
     * storage, e repeti-la só porque a variante mudou pagaria duas vezes o mesmo
     * objeto (o mesmo cuidado da dívida I10 com o `listSponsorAccess`).
     */
    const backgroundBytes = editing.layout.background
      ? await readTemplateBackground(editing.layout)
      : null;

    editorModel = {
      templateId: editing.id,
      name: editing.name,
      eventId: event?.id ?? '',
      kind: editing.kind ?? '',
      page: editing.layout.page,
      backgroundHref,
      backgroundNotice: editing.layout.background
        ? backgroundFitNotice(editing.layout.background, editing.layout.page)
        : null,
      backgroundBytes: editing.backgroundBytes,
      previewSvg: renderPreview({ layout: editing.layout, backgroundBytes, variant: 'FULL' }),
      previewWorstSvg: renderPreview({ layout: editing.layout, backgroundBytes, variant: 'WORST_CASE' }),
      elements: toEditorElements(editing.layout),
    };
  } else if (preset) {
    editorModel = {
      templateId: null,
      name: preset.name,
      eventId: event?.id ?? '',
      kind: '',
      page: preset.layout.page,
      backgroundHref: null,
      backgroundNotice: null,
      backgroundBytes: 0,
      previewSvg: renderPreview({ layout: preset.layout, backgroundBytes: null, variant: 'FULL' }),
      previewWorstSvg: renderPreview({ layout: preset.layout, backgroundBytes: null, variant: 'WORST_CASE' }),
      elements: toEditorElements(preset.layout),
    };
  }

  return {
    tenantSlug,
    event,
    basePath,
    filterNotice: templateFilter?.kind === 'discarded' ? templateFilter.notice : null,
    outOfScope,
    own,
    inherited,
    institutionalCount: institutional.length,
    editingName: editing?.name ?? null,
    presetName: preset?.name ?? null,
    editorModel,
    salvo: query.salvo === '1',
  };
}

/** A bancada. Síncrona de propósito: ver o cabeçalho do módulo. */
export function CertificateTemplatesScreen({ data }: { data: CertificateTemplatesScreenData }) {
  const { tenantSlug, event, basePath, own, inherited } = data;

  return (
    <>
      {data.filterNotice ? (
        <Alert tone="warning" data-testid="template-filter-notice">
          {data.filterNotice}
        </Alert>
      ) : null}

      {data.outOfScope ? (
        <Alert tone="warning" data-testid="template-scope-notice">
          Este modelo não pertence a este alvo — ele pode ser de outro evento ou um padrão da instituição.
          Abra a tela do alvo dele para editá-lo.
        </Alert>
      ) : null}

      {/* ── Modelos do alvo ──────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="modelos">
        <SectionHeading
          title={event ? 'Modelos deste evento' : 'Modelos padrão da instituição'}
          description={
            event
              ? 'Valem primeiro para este evento. Quando não há modelo do tipo, a emissão procura o padrão da instituição e, por último, o desenho do sistema.'
              : 'O desenho que vale quando o evento não tem modelo próprio. É o fallback de todos os eventos da instituição.'
          }
        />

        {own.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="templates-empty"
          >
            {event
              ? 'Nenhum modelo deste evento ainda. Sem modelo do evento, o certificado usa o padrão da instituição (quando houver) ou o desenho do sistema.'
              : 'Nenhum modelo padrão configurado. Sem modelo, o certificado sai no desenho padrão do sistema — escolha um modelo pronto abaixo para começar a personalizar.'}
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="template-list">
            {own.map((template) => (
              <li key={template.id}>
                <TemplateCard
                  template={template}
                  tenantSlug={tenantSlug}
                  basePath={basePath}
                  eventId={event?.id ?? ''}
                  badge={event ? 'Do evento' : 'Padrão da instituição'}
                  editable
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Herdados da instituição (somente leitura) ────────────────────────── */}
      {event ? (
        <section className="space-y-4" aria-labelledby="herdados">
          <SectionHeading
            title="Herdados da instituição"
            description="Os modelos padrão que ainda valem para algum tipo deste evento, porque nenhum modelo do evento os substitui. Eles são editados na tela dos modelos padrão."
          />

          {inherited.length === 0 ? (
            <p
              className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
              data-testid="inherited-empty"
            >
              {data.institutionalCount === 0
                ? 'A instituição não tem modelos padrão. Sem modelo do evento, o certificado sai no desenho do sistema.'
                : 'Todos os modelos padrão da instituição já foram substituídos por modelos deste evento.'}
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" data-testid="inherited-template-list">
              {inherited.map((template) => (
                <li key={template.id}>
                  <TemplateCard
                    template={template}
                    tenantSlug={tenantSlug}
                    basePath={basePath}
                    eventId={event.id}
                    badge="Herdado"
                    editable={false}
                  />
                </li>
              ))}
            </ul>
          )}

          <Link
            href={tenantPath(tenantSlug, '/administracao/certificados/modelos')}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline underline-offset-4"
            data-testid="institution-models-link"
          >
            <FileBadge className="size-3.5" aria-hidden />
            Ver e editar os modelos padrão da instituição
          </Link>
        </section>
      ) : null}

      {/* ── Modelos prontos ───────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="prontos">
        <SectionHeading
          title="Começar de um modelo pronto"
          description="Cinco pontos de partida. Todos deixam o topo livre para o logotipo e o rodapé para as chancelas da arte."
        />

        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="preset-list">
          {CERTIFICATE_TEMPLATE_PRESETS.map((item) => (
            <li key={item.id}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col justify-between gap-3">
                  <div className="space-y-1">
                    <p className="flex items-center gap-2 font-medium">
                      <Sparkles className="size-4 text-brand" aria-hidden />
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </div>

                  <Link
                    href={`${basePath}?novo=${item.id}`}
                    className="inline-flex w-fit items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                    data-testid={`preset-use-${item.id}`}
                  >
                    <Plus className="size-3.5" aria-hidden /> Usar este modelo
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Editor ───────────────────────────────────────────────────────────── */}
      {data.editorModel ? (
        <section className="space-y-4" aria-labelledby="editor">
          <SectionHeading
            title={
              data.editingName
                ? `Editando: ${data.editingName}`
                : `Novo modelo a partir de "${data.presetName ?? 'modelo pronto'}"`
            }
            description="Arraste no palco para posicionar ou digite as medidas. A prévia sai do mesmo renderizador do PDF emitido."
          />

          {/**
           * O aviso vem da URL, não do estado da ação: salvar um modelo NOVO navega para
           * o endereço do modelo (o estado da Server Action não sobrevive à navegação) —
           * e é essa navegação que faz a tela reabrir com identificador, arte e layout.
           */}
          {data.salvo ? (
            <p
              className="flex items-center gap-2 rounded-md border border-success bg-success-soft p-3 text-sm text-success-strong"
              data-testid="template-saved"
            >
              <CheckCircle2 className="size-4" aria-hidden /> Modelo criado. Agora você pode aplicar a arte de fundo e
              ajustar os elementos dele.
            </p>
          ) : null}

          <CertificateTemplateEditor
            tenantSlug={tenantSlug}
            model={data.editorModel}
            eventTitle={event?.title ?? null}
            kinds={KIND_OPTIONS}
            saveAction={saveCertificateTemplateAction}
            previewAction={previewCertificateTemplateAction}
            uploadAction={uploadTemplateBackgroundAction}
            clearBackgroundAction={clearTemplateBackgroundAction}
          />
        </section>
      ) : null}
    </>
  );
}

function TemplateCard({
  template,
  tenantSlug,
  basePath,
  eventId,
  badge,
  editable,
}: {
  template: CertificateTemplateSummary;
  tenantSlug: string;
  basePath: string;
  /** `''` = padrão da instituição; o id do evento = modelo do evento. */
  eventId: string;
  badge: string;
  editable: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium" data-testid={`template-name-${template.id}`}>
              {template.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {kindLabel(template)} · <span className="font-medium">{badge}</span>
            </p>
          </div>
          <span
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-testid={`template-art-${template.id}`}
          >
            {template.hasBackground ? (
              <>
                <ImageIcon className="size-3.5" aria-hidden />
                {formatBytes(template.backgroundBytes)}
              </>
            ) : (
              'Sem arte'
            )}
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          {CERTIFICATE_PAGE_FORMAT_LABELS[template.page]} · {template.elementCount} elemento(s)
        </p>

        {template.backgroundNotice ? (
          <p className="text-xs text-warning-strong">{template.backgroundNotice}</p>
        ) : null}

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`${basePath}?modelo=${template.id}`}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
              data-testid={`template-edit-${template.id}`}
            >
              Editar modelo
            </Link>

            <form action={deleteCertificateTemplateFormAction}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="templateId" value={template.id} />
              {/**
               * O alvo da exclusão vai no formulário: sem ele, o serviço excluiria
               * qualquer modelo da instituição que o `templateId` apontasse.
               */}
              <input type="hidden" name="eventId" value={eventId} />
              <button
                type="submit"
                data-testid={`template-delete-${template.id}`}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
              >
                Excluir
              </button>
            </form>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid={`template-readonly-${template.id}`}>
            Somente leitura aqui — o alvo do modelo não muda.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Auxiliares de tela
// ───────────────────────────────────────────────────────────────────────────────
function toEditorElements(layout: CertificateLayout): EditorElement[] {
  return layout.elements.map((element) => ({
    id: element.id,
    kind: element.kind,
    text: element.text ?? '',
    variable: element.variable ?? '',
    xMm: element.xMm,
    yMm: element.yMm,
    widthMm: element.widthMm,
    heightMm: element.heightMm,
    align: element.align,
    font: element.font,
    sizePt: element.sizePt,
    color: element.color,
    lineHeight: element.lineHeight,
  }));
}

/**
 * A prévia do editor é o MESMO renderizador do documento, com dados de exemplo
 * (`certificatePreviewSample`, tirados do catálogo de variáveis) — e, quando o modelo
 * tem elemento `BODY`, com o CORPO já resolvido a partir do gabarito do organizador.
 *
 * São DUAS amostras (FASE 86 · fatia 3): `FULL` mostra o documento com todos os dados,
 * e `WORST_CASE` esvazia os opcionais — é onde o organizador vê se o texto dele fica
 * com buraco. As duas saem do mesmo renderizador; não há um desenho paralelo na tela.
 */
function renderPreview(input: {
  layout: CertificateLayout;
  backgroundBytes: Buffer | null;
  variant: CertificatePreviewVariant;
}): string {
  return renderCertificateLayoutSvg({
    values: certificatePreviewSample(input.layout, input.variant).values,
    layout: input.layout,
    backgroundBytes: input.backgroundBytes,
    issuedAt: new Date('2026-01-01T12:00:00.000Z'),
  });
}

/** A arte vira `data:` URI para o palco: o bucket é privado e não tem URL pública. */
async function backgroundDataUri(layout: CertificateLayout): Promise<string | null> {
  if (!layout.background) return null;

  const bytes = await readTemplateBackground(layout).catch(() => null);
  if (!bytes) return null;

  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}
