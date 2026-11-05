import { notFound } from 'next/navigation';
import { FileBadge } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import {
  CertificateTemplatesScreen,
  loadCertificateTemplatesScreen,
} from '@/components/admin/certificate-templates-screen';

export const metadata = { title: 'Modelos de certificado do evento' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OS MODELOS DE CERTIFICADO SÃO DO EVENTO (FASE 86 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ROTA EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O dado sempre soube ser por evento: `CertificateTemplate.eventId` é nulável, a
 *  precedência (EVENTO+TIPO → EVENTO → INSTITUIÇÃO+TIPO → INSTITUIÇÃO → padrão) é
 *  domínio testado e os índices únicos parciais garantem UM modelo por combinação.
 *  O que faltava era ENDEREÇO: a única tela de modelos era a da instituição, e o
 *  organizador criava ali um modelo "do evento" escolhendo no `<select>` — sem que
 *  nada conferisse que o evento era desta instituição, e sem uma tela que dissesse
 *  qual desenho o evento realmente usa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM DA GUARDA É CONTRATO (F70/F76/F72)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. `requireUuidParam` ANTES de tudo: um id malformado é 404, não `P2023` → 500;
 *  2. `EVENT_MANAGE` é a PRIMEIRA e ÚNICA `requirePagePermission` — desenhar o
 *     documento é ato de configuração, e quem só emite (`CERTIFICATE_ISSUE`) não
 *     muda a cara do certificado;
 *  3. o pertencimento do evento vem da CONSULTA (`getAdminEvent` com `tenantId` no
 *     `where` e `deletedAt`), e evento de outra instituição é o mesmo 404.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventCertificateTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{ modelo?: string; novo?: string; salvo?: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const query = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  /**
   * O pertencimento é conferido pela própria consulta (`tenantId` no `where`) e a
   * exclusão lógica também: evento de outra instituição e evento apagado são, para
   * quem está aqui, o mesmo 404.
   */
  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const data = await loadCertificateTemplatesScreen({
    tenantId,
    tenantSlug,
    event: { id: event.id, title: event.title },
    query,
  });

  /**
   * A emissão é a tela irmã — o link de volta é a MATERIALIZAÇÃO do caminho
   * "editei o modelo e quero emitir". A trilha declara o mesmo destino, e a volta
   * do `PageHeader` é derivada do penúltimo item (F78).
   */
  const certificatesHref = tenantPath(
    tenantSlug,
    `/administracao/eventos/${eventId}/certificados`,
  );

  return (
    <main className="max-w-7xl space-y-8">
      <PageHeader
        title="Modelos de certificado do evento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<FileBadge className="size-6 text-brand" aria-hidden />}
        description={
          <>
            {event.title} · o desenho que vale primeiro para este evento. Quando não há modelo do tipo aqui,
            a emissão procura o padrão da instituição e, por último, o desenho do sistema. O modelo fica{' '}
            <strong>congelado</strong> em cada certificado no momento da emissão.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Certificados', href: certificatesHref },
          { label: 'Modelos do evento' },
        ]}
      />

      <CertificateTemplatesScreen data={data} />
    </main>
  );
}
