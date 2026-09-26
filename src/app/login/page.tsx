import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { signInAction } from '@/app/actions/auth-actions';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; senha?: string }>;
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

      {params.senha === 'redefinida' ? (
        <p
          className="rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success-strong"
          role="status"
          data-testid="login-password-reset"
        >
          Senha redefinida. Entre com a senha nova — as sessões antigas foram encerradas.
        </p>
      ) : null}

      <AuthForm mode="signin" action={signInAction} redirectTo={redirectTo} />

      <div className="space-y-3 text-center text-sm text-muted-foreground">
        <p>
          <Link
            href="/esqueci-senha"
            className="font-medium text-foreground underline underline-offset-4"
            data-testid="login-forgot-password"
          >
            Esqueci minha senha
          </Link>
        </p>

        <p>
          Não tem conta?{' '}
          <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
            Cadastre-se
          </Link>
        </p>
      </div>
    </main>
  );
}
