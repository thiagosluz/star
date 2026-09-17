import { ShieldCheck } from 'lucide-react';

import { RevokeSuperAdminButton, SuperAdminGrantForm } from '@/components/platform/platform-forms';
import { requirePlatformPermission } from '@/lib/platform/guard';
import { listSuperAdmins } from '@/lib/platform/tenant-service';
import { listPlatformAudit } from '@/lib/platform/global-repository';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GOVERNANÇA — quem pode governar a plataforma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PAPEL DE PLATAFORMA NÃO É O TOPO DA HIERARQUIA DAS INSTITUIÇÕES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ser SuperAdmin dá `platform:manage` — provisionar e suspender instituições —
 *  e MAIS NADA. O escopo `PLATFORM` não cobre `TENANT`: o SuperAdmin não abre o
 *  painel de uma instituição, não lê submissões, não vê inscritos. Essa separação
 *  é o que impede que a governança da plataforma se torne acesso universal aos
 *  dados de terceiros.
 *
 *  Por isso esta tela também é o lugar de dizer NÃO: a revogação é explícita, o
 *  último SuperAdmin não pode ser revogado, e toda concessão/revoção entra na
 *  trilha.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PlatformGovernancePage() {
  const operator = await requirePlatformPermission();

  const [superAdmins, audit] = await Promise.all([listSuperAdmins(), listPlatformAudit({ limit: 20 })]);

  const permissionAudit = audit.filter((entry) => entry.action === 'PERMISSION_CHANGE');

  return (
    <div className="space-y-8" data-testid="platform-governance">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Governança</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {superAdmins.length} pessoa(s) com governança de plataforma. Você está operando como{' '}
          <span className="font-medium text-foreground">{operator.email}</span>.
        </p>
      </header>

      <SuperAdminGrantForm />

      <section className="rounded-xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border p-5">
          <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
          <h2 className="text-base font-semibold text-foreground">SuperAdmins vigentes</h2>
        </header>

        {superAdmins.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground" data-testid="superadmins-empty">
            Nenhuma concessão de plataforma vigente.
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid="superadmins-list">
            {superAdmins.map((admin) => (
              <li
                key={admin.userId}
                data-testid="superadmin-row"
                data-user-id={admin.userId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 p-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {admin.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{admin.email}</span>
                </span>

                <span className="text-xs text-muted-foreground">
                  desde {admin.grantedAt.toISOString().slice(0, 10)}
                  {admin.reason ? ` · ${admin.reason}` : ''}
                </span>

                {admin.userId === operator.userId ? (
                  <span className="text-xs uppercase text-muted-foreground">você</span>
                ) : (
                  <RevokeSuperAdminButton userId={admin.userId} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-foreground">Mudanças de permissão</h2>

        {permissionAudit.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="governance-audit-empty">
            Nenhuma concessão ou revogação registrada ainda.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border" data-testid="governance-audit">
            {permissionAudit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 py-3 text-sm">
                <span className="label-caps text-muted-foreground">
                  {entry.action}
                </span>
                <span className="text-foreground">{entry.entityType}</span>
                <span className="text-xs text-muted-foreground">{entry.actorName ?? 'sistema'}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
