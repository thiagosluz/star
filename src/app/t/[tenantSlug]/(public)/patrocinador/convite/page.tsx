import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Handshake } from 'lucide-react';

import { getTenantContext } from '@/lib/events/event-repository';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { tenantPath } from '@/domain/tenancy/resolution';
import { AdminForm } from '@/components/admin/admin-form';
import { acceptSponsorInviteAction } from '@/app/actions/sponsor-portal-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ACEITE DO CONVITE DE PATROCINADOR (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ROTA É PÚBLICA (autenticada, mas fora do shell)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem aceita é, muitas vezes, o contato COMERCIAL da empresa: pode não ter
 *  vínculo nenhum com a instituição ainda. O layout de `/t/<slug>/(app)` exige
 *  vínculo ATIVO, e colocar o aceite lá dentro criaria o impasse que a FASE 25 já
 *  resolveu no portal do palestrante — sem vínculo não se aceita, e sem aceitar não
 *  há vínculo.
 *
 *  Aqui a prova é o CÓDIGO (o token do convite) somado ao E-MAIL da conta: o token
 *  prova a posse do link, o e-mail prova quem é. O vínculo com a instituição e o
 *  papel `SPONSOR` nascem COMO CONSEQUÊNCIA do aceite.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Convite de patrocinador' };

export default async function SponsorInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ codigo?: string }>;
}) {
  const { tenantSlug } = await params;
  const { codigo } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const user = await getAuthenticatedUser();
  const token = codigo?.trim() ?? '';
  const here = tenantPath(tenantSlug, `/patrocinador/convite${token ? `?codigo=${token}` : ''}`);

  return (
    <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenant.name}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Handshake className="size-6 text-primary" aria-hidden />
          Convite de patrocinador
        </h1>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        {!user ? (
          <>
            <p className="text-sm">
              Entre com a conta que recebeu o convite para confirmar o acesso à área do patrocinador.
            </p>
            <Link
              href={`/login?redirectTo=${encodeURIComponent(here)}`}
              data-testid="invite-login"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              Entrar e continuar
            </Link>
          </>
        ) : !token ? (
          <p className="text-sm">
            O link do convite está incompleto. Peça à organização para gerar um novo — o convite
            anterior é invalidado quando outro é emitido.
          </p>
        ) : (
          <>
            <p className="text-sm">
              Você está autenticado como <strong>{user.email}</strong>. O convite só é aceito se este
              for o endereço que a organização cadastrou.
            </p>
            <AdminForm
              action={acceptSponsorInviteAction}
              submitLabel="Aceitar convite"
              testId="sponsor-invite-form"
            >
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="token" value={token} />
            </AdminForm>
            <p className="text-xs text-muted-foreground">
              Ao aceitar, você passa a ver a cota, o contrato e os contatos autorizados do
              patrocinador. Nada nesta área é editável por você.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
