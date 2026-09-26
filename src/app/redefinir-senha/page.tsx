import Link from 'next/link';
import { Alert, Card, CardContent } from '@/components/ui';

import { ResetPasswordForm } from '@/components/auth/password-recovery-forms';
import { resetPasswordAction } from '@/app/actions/auth-actions';

export const metadata = { title: 'Definir nova senha' };

/**
 * Definição da nova senha — o DESTINO do link que o e-mail carrega.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  COMO O TOKEN CHEGA AQUI
 * ─────────────────────────────────────────────────────────────────────────────
 *  O e-mail aponta para a rota da biblioteca
 *  (`/api/auth/reset-password/<token>?callbackURL=/redefinir-senha`), que confere a
 *  validade e devolve a pessoa para cá com `?token=…` — ou com `?error=INVALID_TOKEN`
 *  quando o link venceu (60 minutos) ou já foi usado.
 *
 *  O token só é aceito como campo oculto do formulário: ele não é guardado em cookie,
 *  não é registrado em log e não sobrevive ao envio (a biblioteca o consome no
 *  primeiro uso).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token.trim() : '';
  const linkProblem = typeof params.error === 'string' && params.error.length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1.5">
        <h1 className="font-display text-headline text-foreground">Definir nova senha</h1>
        <p className="text-sm text-muted-foreground">
          Escolha uma senha nova para a sua conta. Ela passa a valer imediatamente, e as sessões
          abertas são encerradas.
        </p>
      </header>

      {linkProblem ? (
        <Alert tone="warning" title="Este link não vale mais" data-testid="reset-invalid-token">
          <p>
            O link de redefinição vence em 60 minutos e só pode ser usado uma vez. Peça outro para
            continuar.
          </p>
        </Alert>
      ) : token ? (
        <ResetPasswordForm action={resetPasswordAction} token={token} />
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-5 text-sm text-muted-foreground">
            <p data-testid="reset-missing-token">
              Este endereço precisa do link completo que enviamos por e-mail — ele carrega o código
              da redefinição.
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-muted-foreground">
        {linkProblem || !token ? (
          <Link
            href="/esqueci-senha"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Pedir um link novo
          </Link>
        ) : (
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Voltar para a entrada
          </Link>
        )}
      </p>
    </main>
  );
}
