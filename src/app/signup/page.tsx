import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { signUpAction } from '@/app/actions/auth-actions';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Criar conta' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  if (await getAuthenticatedUser()) {
    redirect('/selecionar-instituicao');
  }

  const params = await searchParams;
  // Aceita apenas caminho relativo: `//evil.com` e `https://evil.com` são
  // rejeitados, evitando open redirect.
  const redirectTo =
    params.redirectTo &&
    params.redirectTo.startsWith('/') &&
    !params.redirectTo.startsWith('//')
      ? params.redirectTo
      : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted-foreground">
          Sua conta é única na plataforma: com ela você participa de quantas
          instituições quiser, com papéis diferentes em cada uma.
        </p>
      </header>

      <AuthForm mode="signup" action={signUpAction} redirectTo={redirectTo} />

      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{' '}
        <Link
          href={redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : '/login'}
          className="font-medium text-foreground underline underline-offset-4"
        >
          Entrar
        </Link>
      </p>
    </main>
  );
}
