import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AuthForm } from '@/components/auth/auth-form';
import { PageHeader } from '@/components/ui';
import { signInAction } from '@/app/actions/auth-actions';
import { resolveEntryDestinationForUser } from '@/lib/auth/entry-destination';
import { isSafeEntryRedirect } from '@/domain/platform/entry-destination-rules';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; senha?: string }>;
}) {
  const params = await searchParams;

  /**
   * Já autenticado não tem o que fazer aqui — e o destino é o MESMO da entrada
   * (FASE 82): a regra decide entre governança, painel do vínculo, seletor do
   * convite e descoberta. Antes era `/selecionar-instituicao` para todo mundo, o
   * que devolvia o SuperAdmin ao seletor toda vez que ele caísse nesta tela.
   */
  const user = await getAuthenticatedUser();
  if (user) {
    redirect(await resolveEntryDestinationForUser(user.id, { redirectTo: params.redirectTo }));
  }

  /**
   * Aceita apenas caminho relativo. A validação é a da REGRA (`isSafeEntryRedirect`),
   * não uma segunda cópia: ela já recusa `//evil.com`, `/\evil.com`, `https://…` e
   * as próprias telas de entrada (voltar ao formulário que a pessoa acabou de
   * preencher é laço, não destino).
   */
  const redirectTo = isSafeEntryRedirect(params.redirectTo) ? params.redirectTo : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <PageHeader
        title="Entrar"
        description="Acesse com sua conta para gerenciar seus eventos e inscrições."
      />

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
