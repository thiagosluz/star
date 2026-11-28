import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Award, ExternalLink } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CERTIFICATE_KIND_LABELS, CERTIFICATE_KINDS } from '@/domain/certificates/certificate-rules';
import {
  DEFAULT_BATCH_KINDS,
  estimateGenerationTime,
  summarizeEventPreview,
} from '@/domain/certificates/certificate-preview-rules';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { previewEventCertificates } from '@/lib/certificates/certificate-service';
import { resolveEventTemplateKinds } from '@/lib/certificates/certificate-template-service';
import { certificateDurationSample, certificateQueueStats } from '@/lib/certificates/queue';
import { IssueBatchPanel } from '@/components/certificates/issue-panel';
import { CertificatePolicyPanel } from '@/components/certificates/certificate-policy-panel';
import { EventTemplateSummary } from '@/components/certificates/event-template-summary';
import { PageHeader, Skeleton } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import {
  issueEventCertificatesAction,
  saveCertificatePolicyAction,
} from '@/app/actions/certificate-actions';

export const metadata = { title: 'Certificados do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A EMISSÃO EM LOTE É DO EVENTO (FASE 85 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cartão "Certificados" da raiz do evento fica no grupo RESULTADO e promete "a
 *  emissão do evento" — mas o `href` dele era `/administracao/certificados`, que é o
 *  INVENTÁRIO da instituição: a tela lista os documentos de todos os eventos e não
 *  emite nada. O painel de lote existia, porém morava em `/certificados` (a tela de
 *  "meus certificados"), misturando duas perguntas de donos diferentes: o
 *  participante vê os documentos DELE e a equipe emite para o EVENTO.
 *
 *  Aqui a permissão e o escopo batem com o cartão: `certificate:issue` abre a tela e
 *  o `eventId` vem da ROTA — não de um `<select>` que escondia eventos em rascunho.
 *  O inventário continua onde estava e é alcançado por um link que já leva o filtro
 *  deste evento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ID É VALIDADO ANTES DE QUALQUER CONSULTA (a régua da FASE 76)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um texto que não é uuid chegaria ao Prisma e viraria `P2023` → HTTP 500. As
 *  páginas irmãs do evento chamam `requireUuidParam` antes da guarda e antes da
 *  consulta, e é essa a ordem que a catraca da F76 lê. Recurso inexistente (uuid
 *  bem formado mas que não é deste tenant) continua sendo o 404 de baixo, na
 *  consulta — são duas perguntas diferentes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventCertificatesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  /**
   * O pertencimento é conferido pela própria consulta (`tenantId` no `where`) e a
   * exclusão lógica também: evento de outra instituição e evento apagado são, para
   * quem está aqui, o mesmo 404.
   */
  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * Os mesmos tipos que a tela da instituição oferecia. `MERIT` fica de fora porque
   * é concessão nominal do comitê, e não um documento que o lote saiba distribuir.
   */
  const kindOptions = CERTIFICATE_KINDS.filter((kind) => kind !== 'MERIT').map((kind) => ({
    value: kind,
    label: CERTIFICATE_KIND_LABELS[kind],
  }));

  /**
   * ─── A SIMULAÇÃO (FASE 85 · fatia 2) ─────────────────────────────────────────
   *
   *  Roda no SERVIDOR, com o MESMO serviço da emissão (`previewEventCertificates`)
   *  e a MESMA função de domínio que decide elegibilidade. A tela recebe números
   *  prontos — nenhuma regra é recalculada no navegador, então não existe uma
   *  segunda verdade que possa divergir da emissão.
   *
   *  Os três dados vão juntos porque respondem a perguntas independentes:
   *  o preview (quem recebe), a fila (o que está acontecendo agora) e a amostra de
   *  duração (quanto custa cada PDF). Redis fora do ar devolve `null` nos dois
   *  últimos — e a tela diz isso, em vez de inventar número.
   */
  const templateResolutions = await resolveEventTemplateKinds({
    tenantId,
    eventId,
    kinds: kindOptions.map((option) => option.value),
  });

  /**
   * O filtro do inventário é `?evento=<uuid>` e ele EXISTE de verdade (a F76 só
   * descarta o valor MALFORMADO, anunciando): o link leva o recorte deste evento,
   * em vez de prometer um filtro que a tela ignoraria.
   */
  const inventoryHref = tenantPath(
    tenantSlug,
    `/administracao/certificados?evento=${eventId}`,
  );

  /**
   * ─── EMITIR NÃO É DESENHAR (FASE 86) ────────────────────────────────────────
   *
   *  A guarda desta página é `certificate:issue`; o editor de modelos exige
   *  `event:manage`. O CHAIR tem a primeira e não a segunda — por isso o link para
   *  os modelos é decidido por `can()`, e não pela permissão da tela. Mostrá-lo a
   *  quem não pode abrir seria o defeito da F72 dentro da própria seção.
   */
  const canManageModels = can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' });
  const modelsHref = tenantPath(
    tenantSlug,
    `/administracao/eventos/${eventId}/certificados/modelos`,
  );

  /**
   * ─── QUEM EDITA A POLÍTICA (FASE 86 · fatia 5) ─────────────────────────────
   *
   *  A tela é aberta por `certificate:issue` (quem lê a política). EDITAR exige a
   *  permissão mais estreita, `event:manage`, e nos DOIS escopos: coordenar o
   *  evento pela instituição e ser a equipe do evento são o caso normal. Um CHAIR
   *  tem `certificate:issue` e não tem `event:manage` — ele lê a regra e vê por que
   *  não pode mexer, em vez de um formulário que o servidor recusaria.
   */
  const canManagePolicy =
    can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'EVENT', eventId }) ||
    can(principal, PERMISSIONS.EVENT_MANAGE, { scope: 'TENANT' });

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Certificados do evento"
        /**
         * O `eyebrow` é o GRUPO DE NAVEGAÇÃO da fonte única (a F78 reprova qualquer
         * outro literal). O grupo de trabalho do cartão é "Resultado", mas ele não
         * existe na navegação da instituição — a tela irmã do mesmo grupo
         * (`reconhecimento`) usa `operacao`, e inventar um quinto grupo aqui seria
         * uma segunda lista que envelhece sozinha.
         */
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Award className="size-6 text-primary" aria-hidden />}
        description={
          <>
            {event.title} · emita os documentos do evento para quem tem presença, submissão ou
            parecer registrados. O resultado informa quantos foram emitidos e quantos ficaram de
            fora por falta de fato.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Certificados' },
        ]}
      />

      {/*
        O painel recebe SÓ o evento da rota: a lista de eventos deixou de existir aqui
        porque o escopo é o da URL. O `eventId` viaja no formulário como campo oculto,
        então a Server Action continua lendo o mesmo `name="eventId"` — nenhuma
        mudança no caminho de emissão.
      */}
      {/*
        A ponte com o desenho fica ANTES do disparo: quem vai emitir precisa saber
        qual documento sai — e se o modelo configurado está legível. O link de
        edição só existe para quem `can()` abriria a tela de modelos.
      */}
      <ol
        className="grid gap-3 sm:grid-cols-3"
        aria-label="Etapas da certificação do evento"
        data-testid="certificates-journey-steps"
      >
        <li className="rounded-lg border border-border bg-card p-3.5 text-xs">
          <p className="font-semibold text-foreground">1. Aparência do certificado</p>
          <p className="mt-1 text-muted-foreground">
            Escolha ou personalize o modelo visual com arte de fundo e variáveis.
          </p>
          {canManageModels ? (
            <Link
              href={modelsHref}
              className="mt-2 inline-flex font-medium text-brand underline-offset-4 hover:underline"
            >
              Abrir estúdio de modelos →
            </Link>
          ) : null}
        </li>
        <li className="rounded-lg border border-border bg-card p-3.5 text-xs">
          <p className="font-semibold text-foreground">2. Regras de presença</p>
          <p className="mt-1 text-muted-foreground">
            Defina a carga mínima e como a presença nas atividades é apurada.
          </p>
          <a
            href="#politica-certificados"
            className="mt-2 inline-flex font-medium text-brand underline-offset-4 hover:underline"
          >
            Revisar regras ↓
          </a>
        </li>
        <li className="rounded-lg border border-border bg-card p-3.5 text-xs">
          <p className="font-semibold text-foreground">3. Simular e emitir</p>
          <p className="mt-1 text-muted-foreground">
            Confira quem está elegível e dispare a geração em lote com rastreio.
          </p>
          <a
            href="#emissao-lote"
            className="mt-2 inline-flex font-medium text-brand underline-offset-4 hover:underline"
          >
            Ir para emissão ↓
          </a>
        </li>
      </ol>

      <EventTemplateSummary
        resolutions={templateResolutions}
        modelsHref={modelsHref}
        canManage={canManageModels}
      />

      <div id="politica-certificados">
        <CertificatePolicyPanel
          tenantSlug={tenantSlug}
          eventId={eventId}
          policy={event.certificatePolicy.policy}
          problems={event.certificatePolicy.problems}
          canManage={canManagePolicy}
          action={saveCertificatePolicyAction}
        />
      </div>

      <div id="emissao-lote">
        <Suspense fallback={<IssueBatchSkeleton />}>
          <EventCertificatesIssueSection
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            event={{ id: event.id, title: event.title }}
            kinds={kindOptions}
          />
        </Suspense>
      </div>

      <nav className="flex flex-wrap items-center gap-4 text-sm">
        <Link
          href={inventoryHref}
          data-testid="certificate-inventory-link"
          className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Ver os certificados deste evento no inventário
        </Link>
      </nav>
    </main>
  );
}

async function EventCertificatesIssueSection({
  tenantId,
  tenantSlug,
  event,
  kinds,
}: {
  tenantId: string;
  tenantSlug: string;
  event: { id: string; title: string };
  kinds: { value: string; label: string }[];
}) {
  const [previewResult, queue, durationSample] = await Promise.all([
    previewEventCertificates({ tenantId, eventId: event.id, kinds: DEFAULT_BATCH_KINDS }),
    certificateQueueStats(),
    certificateDurationSample(),
  ]);

  const simulation = previewResult.ok
    ? summarizeEventPreview({
        scope: previewResult.preview.scope,
        people: previewResult.preview.people,
      })
    : null;

  const estimate = simulation
    ? estimateGenerationTime({
        certificates: simulation.certificatesToIssue,
        sample: durationSample,
      })
    : null;

  return (
    <IssueBatchPanel
      tenantSlug={tenantSlug}
      event={event}
      kinds={kinds}
      action={issueEventCertificatesAction}
      simulation={simulation}
      simulationProblem={previewResult.ok ? null : previewResult.message}
      estimate={estimate}
      queue={queue}
    />
  );
}

function IssueBatchSkeleton() {
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-6"
      aria-busy="true"
      aria-label="Calculando simulação de certificados"
    >
      <Skeleton className="h-5 w-52" />
      <div className="grid gap-3 sm:grid-cols-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
      <Skeleton className="h-10 w-48 rounded-md" />
    </section>
  );
}
