import { redirect } from 'next/navigation';

import { getRequestContext, loadPrincipal } from '@/lib/auth/session';
import { withTenant } from '@/lib/db/tenant-client';
import { activeRoles, summarizeRoles } from '@/domain/rbac/authorization';
import { permissionsForRole } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

export const metadata = { title: 'Painel' };

/**
 * Painel da instituição.
 *
 * Serve de demonstração verificável da FASE 2: mostra o vínculo carregado sob
 * RLS, os papéis acumulados (com escopo) e as permissões efetivas. É a evidência
 * visual de que o RBAC está resolvendo escopo corretamente.
 */
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const context = await getRequestContext();

  if (!context?.activeTenant) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const principal = await loadPrincipal(
    context.user.id,
    tenantId,
    context.activeTenant.status,
  );

  const roles = activeRoles(principal);
  const scopeSummaries = summarizeRoles(principal);

  /**
   * Consulta de domínio REAL, sob RLS: usa `withTenant`, portanto roda com a
   * role `eventflow_app` e o contexto aplicado. Se o contexto estivesse errado,
   * esta consulta retornaria zero linhas — e não dados de outra instituição.
   */
  const [eventCount, activityCount] = await withTenant(tenantId, async (tx) => {
    return Promise.all([tx.event.count(), tx.activity.count()]);
  });

  const effectivePermissions = [
    ...new Set(roles.flatMap((role) => permissionsForRole(role))),
  ].sort();

  return (
    <main className="max-w-6xl space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Painel de {context.activeTenant.tenantName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Contexto ativo resolvido com isolamento por Row-Level Security.
        </p>
      </header>

      {/* ── Métricas lidas sob RLS ─────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-3" data-testid="stats">
        <StatCard label="Eventos" value={eventCount} />
        <StatCard label="Atividades" value={activityCount} />
        <StatCard label="Permissões efetivas" value={effectivePermissions.length} />
      </section>

      {/* ── Papéis acumulados ─────────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="role-summary">
        <h2 className="text-sm font-medium">Papéis acumulados neste contexto</h2>

        {scopeSummaries.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Nenhum papel atribuído. Você tem acesso de leitura como membro.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {scopeSummaries.map((summary, index) => (
              <li
                key={`${summary.role}-${summary.scope}-${index}`}
                className="rounded-lg border border-border bg-card p-3 text-sm"
              >
                <span className="font-medium">{summary.role}</span>
                <span className="ml-2 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                  {summary.scope}
                </span>
                {summary.eventId ? (
                  <p className="mt-1 code-data text-muted-foreground">
                    evento: {summary.eventId}
                  </p>
                ) : null}
                {summary.activityId ? (
                  <p className="mt-1 code-data text-muted-foreground">
                    atividade: {summary.activityId}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Permissões efetivas ───────────────────────────────────────────── */}
      <section className="space-y-3" data-testid="permissions">
        <h2 className="text-sm font-medium">Permissões efetivas</h2>
        <div className="flex flex-wrap gap-1.5">
          {effectivePermissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma permissão.</p>
          ) : (
            effectivePermissions.map((permission) => (
              <code
                key={permission}
                className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
              >
                {permission}
              </code>
            ))
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Próximas fases adicionam eventos, submissões e certificados a este painel.
        URL canônica: <code className="code-data">{tenantPath(tenantSlug, '/dashboard')}</code>
      </p>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
