import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { signInAction } from '@/app/actions/auth-actions';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  // Já autenticado não tem o que fazer aqui.
  if (await getAuthenticatedUser()) {
    redirect('/selecionar-instituicao');
  }

  const params = await searchParams;
  const redirectTo =
    params.redirectTo && params.redirectTo.startsWith('/') && !params.redirectTo.startsWith('//')
      ? params.redirectTo
      : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted-foreground">
          Acesse com sua conta para gerenciar seus eventos e inscrições.
        </p>
      </header>

      <AuthForm mode="signin" action={signInAction} redirectTo={redirectTo} />

      <p className="text-center text-sm text-muted-foreground">
        Não tem conta?{' '}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Cadastre-se
        </Link>
      </p>
    </main>
  );
}
