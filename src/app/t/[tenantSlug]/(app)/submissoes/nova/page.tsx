import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getRequestContext } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { tenantPath } from '@/domain/tenancy/resolution';
import { createSubmissionAction } from '@/app/actions/review-actions';
import { CreateSubmissionForm } from '@/components/review/create-submission-form';

export const metadata = { title: 'Nova submissão' };
export const dynamic = 'force-dynamic';

/**
 * Página de criação de submissão.
 *
 * Carrega os eventos com chamada de trabalhos aberta e suas trilhas ativas.
 * A validação de janela acontece também no servidor (`cfpClosesAt`), mas a UI já
 * filtra para não oferecer um caminho que será recusado.
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

  const events = await withTenant(context.activeTenant.tenantId, (tx) =>
    tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'REGISTRATION_OPEN'] },
        deletedAt: null,
        OR: [{ cfpClosesAt: null }, { cfpClosesAt: { gt: new Date() } }],
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
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <nav>
        <Link
          href={tenantPath(tenantSlug, '/submissoes')}
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Minhas submissões
        </Link>
      </nav>

      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Nova submissão</h1>
        <p className="text-sm text-muted-foreground">
          O rascunho é salvo imediatamente. Você anexa o arquivo e envia para
          avaliação quando estiver pronto.
        </p>
      </header>

      <CreateSubmissionForm
        tenantSlug={tenantSlug}
        events={options}
        action={createSubmissionAction}
      />
    </main>
  );
}
