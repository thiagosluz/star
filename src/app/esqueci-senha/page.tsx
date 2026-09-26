import Link from 'next/link';
import { redirect } from 'next/navigation';

import { RequestResetForm } from '@/components/auth/password-recovery-forms';
import { requestPasswordResetAction } from '@/app/actions/auth-actions';
import { getAuthenticatedUser } from '@/lib/auth/session';

export const metadata = { title: 'Esqueci minha senha' };

/**
 * Pedido de redefinição de senha.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PORTA QUE FALTAVA (FASE 47)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O envio do e-mail existe desde a FASE 15 (`sendResetPassword` no `auth.ts`), com
 *  template, validade e limite de 3 pedidos por 5 minutos — mas **não havia tela
 *  nenhuma**: nem link no login, nem formulário de pedido, nem página para definir a
 *  nova senha. O link que o e-mail carregava caía em 404, e ninguém conseguia
 *  redefinir a senha sozinho.
 *
 *  Quem já está autenticado não tem o que fazer aqui (a troca de senha mora na área de
 *  conta, com a senha atual) — e devolver a pessoa evita o caminho torto de redefinir
 *  uma senha que ela conhece.
 */
export default async function ForgotPasswordPage() {
  if (await getAuthenticatedUser()) {
    redirect('/conta');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1.5">
        <h1 className="font-display text-headline text-foreground">Esqueci minha senha</h1>
        <p className="text-sm text-muted-foreground">
          Informe o e-mail da sua conta. Enviamos um link para você definir uma nova senha — a
          senha atual continua valendo até o link ser usado.
        </p>
      </header>

      <RequestResetForm action={requestPasswordResetAction} />

      <p className="text-center text-sm text-muted-foreground">
        Lembrou a senha?{' '}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </main>
  );
}
