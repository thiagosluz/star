import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Award, ExternalLink } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
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
import { certificateDurationSample, certificateQueueStats } from '@/lib/certificates/queue';
import { IssueBatchPanel } from '@/components/certificates/issue-panel';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { issueEventCertificatesAction } from '@/app/actions/certificate-actions';

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

  const { tenantId } = await requirePagePermission({
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
  const [previewResult, queue, durationSample] = await Promise.all([
    previewEventCertificates({ tenantId, eventId, kinds: DEFAULT_BATCH_KINDS }),
    certificateQueueStats(),
    certificateDurationSample(),
  ]);

  const simulation = previewResult.ok
    ? summarizeEventPreview({
        scope: previewResult.preview.scope,
        people: previewResult.preview.people,
      })
    : null;

  /**
   * `null` aqui significa "não há base para estimar" (menos de 5 PDFs medidos, ou
   * fila indisponível). A tela NÃO cai para uma constante: mostra "ainda sem
   * medição". O estimado é a soma do trabalho, não o relógio.
   */
  const estimate = simulation
    ? estimateGenerationTime({
        certificates: simulation.certificatesToIssue,
        sample: durationSample,
      })
    : null;

  /**
   * O filtro do inventário é `?evento=<uuid>` e ele EXISTE de verdade (a F76 só
   * descarta o valor MALFORMADO, anunciando): o link leva o recorte deste evento,
   * em vez de prometer um filtro que a tela ignoraria.
   */
  const inventoryHref = tenantPath(
    tenantSlug,
    `/administracao/certificados?evento=${eventId}`,
  );

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
      <IssueBatchPanel
        tenantSlug={tenantSlug}
        event={{ id: event.id, title: event.title }}
        kinds={kindOptions}
        action={issueEventCertificatesAction}
        simulation={simulation}
        simulationProblem={previewResult.ok ? null : previewResult.message}
        estimate={estimate}
        queue={queue}
      />

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
