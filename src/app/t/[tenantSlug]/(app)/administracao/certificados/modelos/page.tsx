import Link from 'next/link';
import { CheckCircle2, FileBadge, Image as ImageIcon, Plus, Sparkles } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import {
  CERTIFICATE_KIND_LABELS,
  CERTIFICATE_KINDS,
  type CertificateKind,
} from '@/domain/certificates/certificate-rules';
import {
  CERTIFICATE_TEMPLATE_PRESETS,
  CERTIFICATE_PAGE_FORMAT_LABELS,
  backgroundFitNotice,
  findPreset,
  sampleVariableValues,
  type CertificateLayout,
} from '@/domain/certificates/certificate-layout-rules';
import {
  getCertificateTemplate,
  listCertificateTemplates,
  readTemplateBackground,
} from '@/lib/certificates/certificate-template-service';
import { renderCertificateLayoutSvg } from '@/lib/certificates/layout-renderer';
import { Card, CardContent, SectionHeading } from '@/components/ui';
import {
  CertificateTemplateEditor,
  type EditorElement,
  type EditorModel,
} from '@/components/admin/certificate-template-editor';
import {
  clearTemplateBackgroundAction,
  deleteCertificateTemplateFormAction,
  previewCertificateTemplateAction,
  saveCertificateTemplateAction,
  uploadTemplateBackgroundAction,
} from '@/app/actions/certificate-actions';

export const metadata = { title: 'Modelos de certificado' };
export const dynamic = 'force-dynamic';

const KIND_OPTIONS = CERTIFICATE_KINDS.map((kind: CertificateKind) => ({
  value: kind,
  label: CERTIFICATE_KIND_LABELS[kind],
}));

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** O que a galeria mostra: alvo, tamanho e se tem arte. */
function targetLabel(template: { eventTitle: string | null; kind: string | null }): string {
  const event = template.eventTitle ?? 'Todos os eventos';
  const kind = template.kind
    ? CERTIFICATE_KIND_LABELS[template.kind as CertificateKind] ?? template.kind
    : 'Qualquer tipo';

  return `${event} · ${kind}`;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Modelos de certificado — arte de fundo e variáveis (FASE 40)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GALERIA VEM ANTES DO EDITOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A instituição tem UMA identidade e vários documentos: modelo do evento inteiro,
 *  modelo do minicurso, modelo do palestrante. A tela abre na lista — com o alvo de
 *  cada modelo à vista — porque a pergunta que o organizador chega fazendo é "qual
 *  desenho vale para este certificado?", e não "como eu desenho uma caixa?".
 *
 *  A precedência (evento+tipo → evento → instituição+tipo → instituição) é a mesma
 *  do domínio, e é ela que decide sem ambiguidade: os índices únicos parciais do
 *  banco garantem UM modelo por combinação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CertificateTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ modelo?: string; novo?: string; evento?: string; salvo?: string }>;
}) {
  const { tenantSlug } = await params;
  const { modelo, novo, evento, salvo } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  const [templates, events] = await Promise.all([listCertificateTemplates(tenantId), listAdminEvents(tenantId)]);

  const eventOptions = events.map((event) => ({ value: event.id, label: event.title }));

  // ── Editor: modelo existente ou um modelo pronto como ponto de partida ────────
  const editing = modelo ? await getCertificateTemplate(tenantId, modelo) : null;
  const preset = novo ? findPreset(novo) : null;

  let editorModel: EditorModel | null = null;

  if (editing) {
    const backgroundHref = await backgroundDataUri(editing.layout);

    editorModel = {
      templateId: editing.id,
      name: editing.name,
      eventId: editing.eventId ?? '',
      kind: editing.kind ?? '',
      page: editing.layout.page,
      backgroundHref,
      backgroundNotice: editing.layout.background
        ? backgroundFitNotice(editing.layout.background, editing.layout.page)
        : null,
      backgroundBytes: editing.backgroundBytes,
      previewSvg: renderPreview({
        layout: editing.layout,
        backgroundBytes: editing.layout.background ? await readTemplateBackground(editing.layout) : null,
      }),
      elements: toEditorElements(editing.layout),
    };
  } else if (preset) {
    editorModel = {
      templateId: null,
      name: preset.name,
      eventId: evento ?? '',
      kind: '',
      page: preset.layout.page,
      backgroundHref: null,
      backgroundNotice: null,
      backgroundBytes: 0,
      previewSvg: renderPreview({ layout: preset.layout, backgroundBytes: null }),
      elements: toEditorElements(preset.layout),
    };
  }

  /**
   * Esta é a única tela que desenha uma página FÍSICA em milímetros: o palco e a
   * prévia precisam de largura para o organizador enxergar a caixa de 4 mm.
   */
  return (
    <main className="max-w-7xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao/certificados')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Certificados
          </Link>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileBadge className="size-6 text-brand" aria-hidden />
          Modelos de certificado
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          A arte de fundo é da instituição (logotipo no topo, chancelas no rodapé) e o texto é montado com variáveis —
          nome, evento, atividade, carga horária, código de validação. O desenho fica <strong>congelado</strong> em cada
          certificado no momento da emissão: editar o modelo depois não altera documento já emitido.
        </p>
      </header>

      {/* ── Modelos da instituição ─────────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="modelos">
        <SectionHeading
          title="Modelos da instituição"
          description="Quando dois modelos servem ao mesmo certificado, vale o mais específico."
        />

        {templates.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="templates-empty">
            Nenhum modelo configurado. Sem modelo, o certificado sai no desenho padrão do sistema — escolha um modelo
            pronto abaixo para começar a personalizar.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2" data-testid="template-list">
            {templates.map((template) => (
              <li key={template.id}>
                <Card>
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium" data-testid={`template-name-${template.id}`}>
                          {template.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{targetLabel(template)}</p>
                      </div>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`template-art-${template.id}`}>
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

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={tenantPath(tenantSlug, `/administracao/certificados/modelos?modelo=${template.id}`)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
                        data-testid={`template-edit-${template.id}`}
                      >
                        Editar modelo
                      </Link>

                      <form action={deleteCertificateTemplateFormAction}>
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="templateId" value={template.id} />
                        <button
                          type="submit"
                          data-testid={`template-delete-${template.id}`}
                          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                        >
                          Excluir
                        </button>
                      </form>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

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
                    href={tenantPath(tenantSlug, `/administracao/certificados/modelos?novo=${item.id}`)}
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
      {editorModel ? (
        <section className="space-y-4" aria-labelledby="editor">
          <SectionHeading
            title={editing ? `Editando: ${editing.name}` : `Novo modelo a partir de "${preset?.name}"`}
            description="Arraste no palco para posicionar ou digite as medidas. A prévia sai do mesmo renderizador do PDF emitido."
          />

          {/**
           * O aviso vem da URL, não do estado da ação: salvar um modelo NOVO navega para
           * o endereço do modelo (o estado da Server Action não sobrevive à navegação) —
           * e é essa navegação que faz a tela reabrir com identificador, arte e layout.
           */}
          {salvo === '1' ? (
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
            model={editorModel}
            events={eventOptions}
            kinds={KIND_OPTIONS}
            saveAction={saveCertificateTemplateAction}
            previewAction={previewCertificateTemplateAction}
            uploadAction={uploadTemplateBackgroundAction}
            clearBackgroundAction={clearTemplateBackgroundAction}
          />
        </section>
      ) : null}
    </main>
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
 * (`sampleVariableValues`, tirados do catálogo de variáveis).
 */
function renderPreview(input: { layout: CertificateLayout; backgroundBytes: Buffer | null }): string {
  return renderCertificateLayoutSvg({
    values: sampleVariableValues(),
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
