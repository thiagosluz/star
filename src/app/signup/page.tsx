import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { PageHeader } from '@/components/ui';
import { signUpAction } from '@/app/actions/auth-actions';
import { resolveEntryDestinationForUser } from '@/lib/auth/entry-destination';
import { isSafeEntryRedirect } from '@/domain/platform/entry-destination-rules';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Criar conta' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const params = await searchParams;

  /**
   * Quem já tem sessão não cria outra conta — e sai por onde a regra manda
   * (FASE 82): governança, painel do vínculo, seletor do convite ou descoberta.
   * O `redirectTo` continua vencendo, porque é a única resposta que a pessoa
   * escolheu.
   */
  const user = await getAuthenticatedUser();
  if (user) {
    redirect(await resolveEntryDestinationForUser(user.id, { redirectTo: params.redirectTo }));
  }

  // Aceita apenas caminho relativo. A validação é a da REGRA — `isSafeEntryRedirect`
  // recusa `//evil.com`, `/\evil.com`, `https://…` e as próprias telas de entrada,
  // evitando open redirect e o laço de volta ao formulário.
  const redirectTo = isSafeEntryRedirect(params.redirectTo) ? params.redirectTo : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <PageHeader
        title="Criar conta"
        description="Sua conta é única na plataforma: com ela você participa de quantas instituições quiser, com papéis diferentes em cada uma."
      />

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
