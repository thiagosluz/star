import { FileBadge } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import {
  CertificateTemplatesScreen,
  loadCertificateTemplatesScreen,
} from '@/components/admin/certificate-templates-screen';

export const metadata = { title: 'Modelos padrão da instituição' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MODELOS PADRÃO DA INSTITUIÇÃO — O FALLBACK, NÃO O EVENTO (FASE 86 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA PERDEU O "VALE PARA O EVENTO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela nasceu na FASE 40 com um `<select>` de eventos, e era por ali que a
 *  instituição criava modelo de UM evento — misturando dois alvos na mesma
 *  galeria. O modelo do evento agora nasce na rota do evento, onde o `eventId` é o
 *  endereço e não uma escolha; aqui sobrou o que é DESTA tela: o desenho PADRÃO,
 *  aquele que vale quando o evento não tem modelo próprio.
 *
 *  A tela NÃO desaparece: ela é o fallback de todos os eventos, e continua sendo o
 *  lugar de editar a identidade que a instituição usa quando não configurou nada
 *  por evento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A LISTA É SÓ `eventId = null`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mostrar modelo de evento aqui faria a tela prometer uma edição que mudaria o
 *  desenho de um evento — e o `getCertificateTemplate` desta página exige o alvo
 *  nulo, então nem um `?modelo=` forjado abre um modelo de evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CertificateTemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ modelo?: string; novo?: string; salvo?: string }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  const data = await loadCertificateTemplatesScreen({
    tenantId,
    tenantSlug,
    event: null,
    query,
  });

  /**
   * A bancada desenha uma página FÍSICA em milímetros: o palco e a prévia precisam
   * de largura para o organizador enxergar a caixa de 4 mm — a mesma largura que a
   * tela do evento usa, porque o editor é o MESMO componente.
   */
  return (
    <main className="max-w-7xl space-y-8">
      <PageHeader
        title="Modelos padrão da instituição"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<FileBadge className="size-6 text-brand" aria-hidden />}
        description={
          <>
            O desenho que vale quando o evento não tem modelo próprio. A arte de fundo é da instituição e o
            texto é montado com variáveis; o desenho fica <strong>congelado</strong> em cada certificado no
            momento da emissão. Para o desenho de um evento específico, abra os modelos dentro do evento.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Certificados', href: tenantPath(tenantSlug, '/administracao/certificados') },
          { label: 'Modelos padrão da instituição' },
        ]}
      />

      <CertificateTemplatesScreen data={data} />
    </main>
  );
}
