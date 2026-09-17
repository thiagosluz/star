import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2, Gauge, ShieldCheck, Users } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LAYOUT DO PAINEL DE PLATAFORMA — `/superadmin`
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
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const metadata: Metadata = {
  title: 'Governança da plataforma',
  robots: { index: false, follow: false },
};

const NAV = [
  { href: '/superadmin/metricas', label: 'Métricas', icon: Gauge },
  { href: '/superadmin/tenants', label: 'Instituições', icon: Building2 },
  { href: '/superadmin/governanca', label: 'Governança', icon: ShieldCheck },
] as const;

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const operator = await requirePlatformPermission();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              EventFlow · plataforma
            </p>
            <p className="truncate text-sm font-semibold text-foreground" data-testid="platform-operator">
              {operator.name}
            </p>
          </div>

          <nav className="flex flex-1 flex-wrap items-center gap-1" aria-label="Navegação da plataforma">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`platform-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href="/organizacoes"
            data-testid="platform-public-directory"
            className="inline-flex items-center gap-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <Users className="size-3.5" aria-hidden />
            Ver diretório público
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</div>

      <footer className="border-t border-border px-6 py-4 text-center text-[11px] text-muted-foreground">
        Painel de governança — ações registradas na trilha de auditoria da plataforma.
      </footer>
    </div>
  );
}
