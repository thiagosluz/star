import Link from 'next/link';

import { TwoFactorChallengeForm } from '@/components/auth/password-recovery-forms';
import { verifyTwoFactorLoginAction } from '@/app/actions/auth-actions';

export const metadata = { title: 'Verificação em duas etapas' };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DESAFIO DO SEGUNDO FATOR (FASE 47)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA EXISTE, E POR QUE ELA NÃO TEM SESSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Com o segundo fator ligado, a senha correta NÃO entra: a biblioteca responde
 *  `twoFactorRedirect` e deixa um cookie assinado de curta duração que autoriza
 *  APENAS o desafio. Não há sessão aqui — e é isso que faz o segundo fator valer
 *  alguma coisa: quem tem a senha e não tem o código não chega a lugar nenhum.
 *
 *  O contexto (instituição e destino) viaja na URL porque o cookie do tenant só pode
 *  ser gravado DEPOIS do código aceito — gravá-lo antes entregaria contexto a quem
 *  ainda não provou o segundo fator.
 *
 *  O código de recuperação entra no mesmo campo: quem perdeu o celular está no pior
 *  momento para escolher entre abas, e a forma do código (6 dígitos × 10 caracteres)
 *  já distingue os dois.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function TwoFactorChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ tenantSlug?: string; redirectTo?: string }>;
}) {
  const params = await searchParams;
  const tenantSlug = typeof params.tenantSlug === 'string' ? params.tenantSlug : undefined;
  const redirectTo =
    typeof params.redirectTo === 'string' && params.redirectTo.startsWith('/')
      ? params.redirectTo
      : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="space-y-1.5">
        <h1 className="font-display text-headline text-foreground">Verificação em duas etapas</h1>
        <p className="text-sm text-muted-foreground">
          Sua conta tem o segundo fator ativo. Informe o código do aplicativo autenticador para
          concluir a entrada.
        </p>
      </header>

      <TwoFactorChallengeForm
        action={verifyTwoFactorLoginAction}
        tenantSlug={tenantSlug}
        redirectTo={redirectTo}
      />

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Entrar com outra conta
        </Link>
      </p>
    </main>
  );
}
