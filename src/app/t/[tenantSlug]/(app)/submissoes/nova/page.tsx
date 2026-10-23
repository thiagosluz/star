import { redirect } from 'next/navigation';

import { getRequestContext } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { tenantPath } from '@/domain/tenancy/resolution';
import { createSubmissionAction } from '@/app/actions/review-actions';
import { CreateSubmissionForm } from '@/components/review/create-submission-form';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Nova submissão' };
export const dynamic = 'force-dynamic';

/**
 * Página de criação de submissão.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  QUEM APARECE AQUI (FASE 68)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Os eventos com chamada publicada E ABERTA ficam de fora: a proposta deles entra
 *  pelo formulário da chamada (`/eventos/<slug>/chamada/<callSlug>`), e o serviço
 *  recusa este atalho com `CFP_CLOSED`. O caminho antigo continua valendo para o
 *  evento que NÃO tem chamada — e continua SEM PRAZO, porque quem diz se a chamada
 *  está aberta é a `CallForProposals` (FASE 33), nunca mais a janela do evento.
 */
export default async function NewSubmissionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(tenantPath(tenantSlug, '/submissoes/nova'))}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const agora = new Date();
  const events = await withTenant(context.activeTenant.tenantId, (tx) =>
    tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
        deletedAt: null,
        /** Ver o comentário de `/submissoes`: as duas condições juntas, no mesmo `none`. */
        calls: {
          none: {
            isPublished: true,
            deletedAt: null,
            OR: [{ opensAt: null }, { opensAt: { lte: agora } }],
            AND: [{ OR: [{ closesAt: null }, { closesAt: { gt: agora } }] }],
          },
        },
      },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        tracks: {
          where: { isActive: true, deletedAt: null },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, requiresBlindReview: true },
        },
      },
    }),
  );

  const options = events
    .filter((event) => event.tracks.length > 0)
    .map((event) => ({
      id: event.id,
      title: event.title,
      tracks: event.tracks,
    }));

  return (
    <main className="max-w-3xl space-y-8">
      <PageHeader
        title="Nova submissão"
        eyebrow={TENANT_NAV_GROUPS.participacao}
        description="O rascunho é salvo imediatamente. Você anexa o arquivo e envia para avaliação quando estiver pronto."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Minhas submissões', href: tenantPath(tenantSlug, '/submissoes') },
          { label: 'Nova submissão' },
        ]}
      />

      <CreateSubmissionForm
        tenantSlug={tenantSlug}
        events={options}
        action={createSubmissionAction}
      />
    </main>
  );
}
