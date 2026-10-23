import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { signOutAction } from '@/app/actions/auth-actions';
import { PageHeader } from '@/components/ui';
import { TenantSwitcher } from '@/components/tenancy/tenant-switcher';

export const metadata = { title: 'Selecionar instituição' };

/**
 * Seletor de instituição.
 *
 * Ponto de encontro de um usuário multi-instituição: mostra todos os vínculos
 * e permite entrar em cada um sem novo login.
 */
export default async function SelectTenantPage() {
  const context = await getRequestContext();

  if (!context) {
    redirect('/login');
  }

  const { user, memberships, activeTenant } = context;

  if (memberships.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-16">
        <PageHeader
          title="Nenhuma instituição vinculada"
          icon={<Building2 className="size-6 text-muted-foreground" aria-hidden />}
          description="Sua conta ainda não está ligada a nenhuma instituição. Peça um convite ao organizador do evento, ou aguarde a aprovação do seu cadastro."
        />
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-muted-foreground underline underline-offset-4"
          >
            Sair da conta
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6 py-16">
      <PageHeader
        title={`Olá, ${user.name.split(' ')[0]}`}
        description={
          <>
            Você tem acesso a {memberships.length}{' '}
            {memberships.length === 1 ? 'instituição' : 'instituições'}. Escolha onde deseja
            trabalhar — você pode trocar a qualquer momento sem sair da conta.
          </>
        }
      />

      <TenantSwitcher
        options={memberships}
        currentSlug={activeTenant?.tenantSlug ?? null}
        redirectTo="/dashboard"
      />

      <footer className="flex items-center justify-between text-sm">
        <Link href="/" className="text-muted-foreground underline underline-offset-4">
          Página inicial
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-muted-foreground underline underline-offset-4"
          >
            Sair da conta
          </button>
        </form>
      </footer>
    </main>
  );
}
