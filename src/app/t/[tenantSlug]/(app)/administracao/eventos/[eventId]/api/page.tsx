import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, BookOpen, KeyRound, ShieldAlert } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getEventApiOrganizerState } from '@/lib/api/event-api-organizer-service';
import { buildEventApiPreviews, type EventApiPreview } from '@/lib/api/event-api-organizer-preview';
import { revealEventApiKey } from '@/lib/api/event-api-key-service';
import {
  EVENT_API_FIXED_RESOURCES_NOTICE,
  EVENT_API_LIMITS,
  EVENT_API_NEVER_EXPOSED,
  EVENT_API_RESOURCE_DOCS,
  EVENT_API_RESOURCE_METHOD,
  EVENT_API_SECTIONS_BORN_OFF,
  EVENT_API_SECTION_INFO,
  eventApiPublicationCopy,
  eventApiResourcePath,
  eventApiSectionOffNotice,
  type EventApiKeyState,
} from '@/domain/api/event-api-organizer-rules';
import { isEventApiSectionEnabled } from '@/domain/api/event-api-key-rules';
import {
  API_FIELD_ORDER,
  type ApiResource,
} from '@/domain/api/public-api-contract';
import { isPublicEventStatus } from '@/domain/events/public-registration-rules';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { SectionHeading } from '@/components/ui';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { EventApiKeyPanel } from '@/components/admin/event-api-key-panel';
import { EventApiSectionsForm } from '@/components/admin/event-api-sections-form';
import {
  createEventApiKeyAction,
  revealEventApiKeyAction,
  revokeEventApiKeyAction,
  updateEventApiSectionsAction,
} from '@/app/actions/event-api-actions';

export const metadata = { title: 'API do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A TELA DO ORGANIZADOR PARA A API DO EVENTO (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA EXISTE, E POR QUE O CONTEÚDO É REQUISITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A API responde 401 para todo mundo até alguém gerar a chave — e quem organiza
 *  não tem como adivinhar isso. Esta tela é o lugar onde o estado honesto aparece:
 *  sem chave, ativa (com a data), revogada (com a data), evento em rascunho. Cada
 *  frase promete um comportamento EXTERNO ("responde 401", "responde 404 como se
 *  não existisse") e por isso mora no domínio (`event-api-organizer-rules`), onde
 *  um teste a prende sem navegador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PRÉVIA É A ROTA DE VERDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela chama o MESMO handler que as rotas públicas montam, com a chave deste evento
 *  no `Authorization`. O que aparece no `<pre>` é o corpo que o cliente recebe
 *  hoje — inclusive o 404 de uma seção desligada e o 404 de um evento em rascunho.
 *  Um "exemplo bonito" escrito à mão mentiria no dia em que o interruptor mudasse;
 *  este não pode (ver `event-api-organizer-preview.ts`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PÁGINA É SERVIDOR; OS GESTOS SÃO FORMULÁRIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Gerar, mostrar, revogar e ligar/desligar seção são `<form>` POST de verdade. O
 *  E2E roda a jornada com `javaScriptEnabled: false`: se um gesto dependesse só do
 *  bundle, ele não apareceria lá. Nada aqui usa estado de cliente para decidir o
 *  que a tela diz — o estado vem do banco, na renderização.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A PERMISSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `event:update`. Não existe na casa uma permissão de "chave/segredo"; a chave é
 *  CONFIGURAÇÃO do evento (a mesma família de "Dados do evento" e do "Formulário de
 *  inscrição"), e não uma operação que afeta pessoas — que é o que `event:manage`
 *  cobre. As quatro actions reconferem a mesma permissão: esconder o cartão é
 *  conveniência, a barreira é a action.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventApiPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const lido = await getEventApiOrganizerState({ tenantId, eventId });

  if (!lido.ok) {
    if (lido.code === 'NOT_FOUND') notFound();

    return (
      <main className="max-w-3xl space-y-4" data-testid="event-api-page">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Voltar ao evento
          </Link>
        </nav>

        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive-soft p-4 text-sm text-foreground">
          {lido.message}
        </p>
      </main>
    );
  }

  const { event: apiEvent, state, config, problems } = lido.data;
  const published = isPublicEventStatus(apiEvent.status);
  const publication = eventApiPublicationCopy({ published, status: apiEvent.status });

  const criadaEmLabel = config
    ? formatZonedDateTime(new Date(config.criadaEm), apiEvent.timezone)
    : null;
  const revogadaEmLabel = config?.revogadaEm
    ? formatZonedDateTime(new Date(config.revogadaEm), apiEvent.timezone)
    : null;

  /**
   * A prévia exige a chave em claro para atravessar a MESMA porta da API. Se o selo
   * não abrir (segredo girado), a tela diz isso — não inventa um JSON.
   */
  let previews: Record<ApiResource, EventApiPreview> | null = null;
  let previewNote: string | null = null;

  if (state === 'ACTIVE') {
    const revelada = await revealEventApiKey({ tenantId, eventId });

    if (!revelada.ok) {
      previewNote = revelada.message;
    } else {
      const geradas = await buildEventApiPreviews({
        tenantSlug,
        eventSlug: apiEvent.slug,
        chave: revelada.chave,
      });

      if (geradas.ok) previews = geradas.previews;
      else previewNote = geradas.message;
    }
  } else {
    previewNote = previewUnavailableNote(state);
  }

  return (
    <main className="max-w-4xl space-y-8" data-testid="event-api-page">
      <PageHeader
        title="API do evento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description={`${apiEvent.title} · uma API somente leitura, por evento, para um site externo consumir o que já está publicado.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: apiEvent.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'API do evento' },
        ]}
      />

      {/* ── O ESTADO DE PUBLICAÇÃO: a porta da API ─────────────────────────── */}
      <section aria-label="Estado de publicação" data-testid="event-api-publication">
        <div
          className={
            publication.live
              ? 'flex gap-3 rounded-lg border border-success/40 bg-success-soft p-4'
              : 'flex gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4'
          }
        >
          {publication.live ? (
            <KeyRound className="mt-0.5 size-4 shrink-0 text-success-strong" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          )}

          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground" data-testid="event-api-publication-title">
              {publication.title}
            </p>
            <p className="text-sm text-foreground" data-testid="event-api-publication-body">
              {publication.body}
            </p>
          </div>
        </div>
      </section>

      {/* ── A CHAVE ────────────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-label="A chave da API">
        <SectionHeading
          title="A chave"
          description="Uma chave por evento, revogável. Toda leitura exige a chave deste evento no cabeçalho Authorization."
        />

        {problems.length > 0 ? (
          <div
            className="space-y-2 rounded-lg border border-destructive/40 bg-destructive-soft p-4"
            data-testid="event-api-problems"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              A configuração gravada está inválida
            </p>
            <ul className="ml-5 list-disc space-y-1 text-sm text-foreground">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <EventApiKeyPanel
          tenantSlug={tenantSlug}
          eventId={eventId}
          state={state}
          criadaEmLabel={criadaEmLabel}
          revogadaEmLabel={revogadaEmLabel}
          createAction={createEventApiKeyAction}
          revealAction={revealEventApiKeyAction}
          revokeAction={revokeEventApiKeyAction}
        />
      </section>

      {/* ── OS INTERRUPTORES POR SEÇÃO ─────────────────────────────────────── */}
      <section className="space-y-4" aria-label="O que a API expõe" data-testid="event-api-sections">
        <SectionHeading
          title="O que a API expõe"
          description="Palestrantes, patrocinadores e chamadas têm interruptor. O evento e a programação, não."
        />

        <p className="text-sm text-foreground" data-testid="event-api-sections-born-off">
          {EVENT_API_SECTIONS_BORN_OFF}
        </p>

        <p className="text-sm text-foreground" data-testid="event-api-fixed-resources">
          {EVENT_API_FIXED_RESOURCES_NOTICE}
        </p>

        <EventApiSectionsForm
          tenantSlug={tenantSlug}
          eventId={eventId}
          state={state}
          secoes={
            config?.secoes ?? { palestrantes: false, patrocinadores: false, chamadas: false }
          }
          action={updateEventApiSectionsAction}
        />
      </section>

      {/* ── OS RECURSOS, COM O ENDEREÇO REAL E A PRÉVIA REAL ──────────────── */}
      <section className="space-y-4" aria-label="Os recursos" data-testid="event-api-resources">
        <SectionHeading
          title="Os recursos"
          description="O endereço completo de cada recurso, o método e a resposta REAL de hoje."
        />

        {previewNote ? (
          <p className="text-sm text-muted-foreground" data-testid="event-api-preview-note">
            {previewNote}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          A prévia é o que a API devolve hoje: ela chama a mesma rota, com a chave deste
          evento, e mostra o corpo que o cliente recebe — inclusive o 404 de uma seção
          desligada.
        </p>

        <ul className="space-y-4">
          {EVENT_API_RESOURCE_DOCS.map((doc) => {
            const path = eventApiResourcePath({
              tenantSlug,
              eventSlug: apiEvent.slug,
              resource: doc.resource,
            });

            const preview = previews?.[doc.resource] ?? null;
            const sectionInfo = EVENT_API_SECTION_INFO.find(
              (info) => info.resource === doc.resource,
            );
            const desligada =
              sectionInfo !== undefined &&
              config !== null &&
              !isEventApiSectionEnabled(config, sectionInfo.section);

            return (
              <li
                key={doc.resource}
                className="space-y-3 rounded-lg border border-border bg-card p-4"
                data-testid={`event-api-resource-${doc.resource}`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{doc.label}</p>
                  <p className="text-xs text-muted-foreground">{doc.description}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="label-caps rounded-xs border border-border px-1.5 py-0.5 text-muted-foreground">
                    <span data-testid={`event-api-resource-method-${doc.resource}`}>
                      {EVENT_API_RESOURCE_METHOD}
                    </span>
                  </span>
                  <code
                    className="code-data break-all text-foreground"
                    data-testid={`event-api-resource-path-${doc.resource}`}
                  >
                    {path}
                  </code>
                </div>

                {sectionInfo && desligada ? (
                  <p className="text-xs text-foreground" data-testid={`event-api-resource-off-${doc.resource}`}>
                    {eventApiSectionOffNotice(sectionInfo.section)}
                  </p>
                ) : null}

                {preview ? (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-foreground">
                      Resposta de hoje:{' '}
                      <span
                        className={
                          preview.status >= 200 && preview.status < 300
                            ? 'text-success-strong'
                            : 'text-destructive'
                        }
                        data-testid={`event-api-preview-status-${doc.resource}`}
                      >
                        HTTP {preview.status}
                      </span>
                      {preview.etag ? (
                        <span className="ml-2 font-normal text-muted-foreground">
                          ETag {preview.etag}
                        </span>
                      ) : null}
                    </p>

                    <pre
                      tabIndex={0}
                      aria-label={`Resposta de hoje do recurso ${doc.label}`}
                      data-testid={`event-api-preview-${doc.resource}`}
                      className="code-data max-h-80 overflow-auto whitespace-pre rounded-sm border border-border bg-surface-low p-3 text-xs text-foreground"
                    >
                      {preview.body}
                    </pre>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── A DOCUMENTAÇÃO, NA MESMA TELA ─────────────────────────────────── */}
      <section className="space-y-4" aria-label="Documentação" data-testid="event-api-docs">
        <SectionHeading
          title="Documentação"
          description="Os campos de cada recurso e os limites da API. Nada aqui aponta para fora desta tela."
        />

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <BookOpen className="size-4 shrink-0 text-primary" aria-hidden />
            Campos por recurso
          </h3>

          <dl className="space-y-3">
            {EVENT_API_RESOURCE_DOCS.map((doc) => (
              <div
                key={doc.resource}
                className="space-y-1 rounded-lg border border-border bg-surface-low p-3"
              >
                <dt className="text-sm font-medium text-foreground">
                  {doc.label}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {eventApiResourcePath({ tenantSlug, eventSlug: apiEvent.slug, resource: doc.resource })}
                  </span>
                </dt>
                <dd className="text-xs text-foreground" data-testid={`event-api-fields-${doc.resource}`}>
                  {API_FIELD_ORDER[doc.resource].map((field) => (
                    <code key={field} className="code-data mr-2 inline-block">
                      {field}
                    </code>
                  ))}
                </dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-muted-foreground">
            A ordem acima é o CONTRATO: o campo que sai não muda de tipo nem de nome sem uma
            versão nova da API.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldAlert className="size-4 shrink-0 text-primary" aria-hidden />
            Limites e regras de acesso
          </h3>

          <dl className="space-y-2" data-testid="event-api-limits">
            {EVENT_API_LIMITS.map((limit) => (
              <div key={limit.title} className="rounded-lg border border-border bg-surface-low p-3">
                <dt className="text-sm font-medium text-foreground">{limit.title}</dt>
                <dd className="text-xs text-foreground">{limit.detail}</dd>
              </div>
            ))}
          </dl>

          <p className="text-xs text-foreground" data-testid="event-api-never">
            {EVENT_API_NEVER_EXPOSED}
          </p>
        </div>
      </section>
    </main>
  );
}

/**
 * O que a tela diz quando NÃO há prévia. Cada estado tem o seu motivo — "sem chave"
 * e "chave revogada" produzem o mesmo 401, mas o organizador precisa saber qual dos
 * dois é o dele para saber o que fazer.
 */
function previewUnavailableNote(state: EventApiKeyState): string {
  switch (state) {
    case 'NONE':
      return 'A prévia aparece quando houver uma chave ativa: sem chave, a API responde 401.';
    case 'REVOKED':
      return 'A chave está revogada: a API responde 401 e não há resposta para pré-visualizar. Gere outra chave.';
    case 'INVALID':
      return 'A configuração da chave está inválida: a API responde 401. Gere uma chave para ver a prévia.';
    default:
      return 'A prévia não está disponível agora.';
  }
}
