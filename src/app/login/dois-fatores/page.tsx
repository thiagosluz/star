import Link from 'next/link';

import { TwoFactorChallengeForm } from '@/components/auth/password-recovery-forms';
import { PageHeader } from '@/components/ui';
import { verifyTwoFactorLoginAction } from '@/app/actions/auth-actions';
import { isSafeEntryRedirect } from '@/domain/platform/entry-destination-rules';

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

  /**
   * A validação do destino é a MESMA das outras portas de entrada (FASE 82):
   * `startsWith('/')` sozinho aceitava `//evil.test`, e o valor viaja na URL até o
   * `verifyTwoFactorLoginAction`. A action valida de novo — esta é a primeira das
   * duas camadas, não a única.
   */
  const redirectTo = isSafeEntryRedirect(params.redirectTo) ? params.redirectTo : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <PageHeader
        title="Verificação em duas etapas"
        description="Sua conta tem o segundo fator ativo. Informe o código do aplicativo autenticador para concluir a entrada."
      />

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
