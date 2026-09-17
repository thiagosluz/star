import type { Metadata } from 'next';

import { AccountBlock } from '@/components/shell/account-block';
import { AppShell } from '@/components/shell/app-shell';
import { buildPlatformNav } from '@/components/shell/tenant-nav';
import { requirePlatformPermission } from '@/lib/platform/guard';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LAYOUT DO PAINEL DE PLATAFORMA — `/superadmin` (FASE 11A: shell do sistema)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA FICA NO LAYOUT, NÃO EM CADA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma rota nova dentro de `/superadmin` nasce protegida — não há como esquecer a
 *  checagem, porque ela não é escrita de novo em lugar nenhum. Foi o mesmo
 *  raciocínio da RLS: a garantia tem que estar no caminho, não na disciplina de
 *  quem escreve a próxima tela.
 *
 *  A resposta é 404 (`notFound()`), e não 403: um 403 confirmaria a existência do
 *  painel para quem não pode vê-lo. Ver `guard.ts`.
 *
 *  Desde a FASE 11A este painel usa o MESMO shell do painel da instituição, com o
 *  acento de plataforma. Governança e operação serem o mesmo produto não é
 *  detalhe estético: é o que permite aprender a interface uma vez só.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Governança da plataforma',
  robots: { index: false, follow: false },
};

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const operator = await requirePlatformPermission();

  return (
    <AppShell
      variant="platform"
      brand={{ label: 'EventFlow', tagline: 'Governança da plataforma' }}
      context={{ name: 'Plataforma', detail: operator.email, testId: 'platform-operator' }}
      navGroups={buildPlatformNav()}
      account={<AccountBlock user={{ name: operator.name, email: operator.email }} />}
    >
      {children}
    </AppShell>
  );
}
