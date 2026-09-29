import Link from 'next/link';
import { Fingerprint, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';

import { requirePlatformPermission } from '@/lib/platform/guard';
import { listPlatformAudit } from '@/lib/platform/global-repository';
import {
  IDENTITY_AUDIT_PAGE_SIZE,
  identityAuditSummary,
  listIdentityAudit,
} from '@/lib/platform/identity-audit-service';
import {
  IDENTITY_AUDIT_EVENTS,
  IDENTITY_AUDIT_EVENT_LABELS,
  IDENTITY_AUDIT_TONE_LABELS,
  identityAuditLabel,
  identityAuditTone,
} from '@/domain/identity/identity-audit-rules';
import { Badge, Card, EmptyState, PageHeader, SectionHeading } from '@/components/ui';

export const metadata = { title: 'Auditoria' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AUDITORIA DA PLATAFORMA E DA IDENTIDADE (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS TRILHAS, DUAS PERGUNTAS DIFERENTES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **Plataforma** (`audit_logs` com `tenantId` nulo, desde a FASE 9): o que a
 *    governança fez — provisionar, suspender, mudar plano, mexer em SuperAdmin.
 *  • **Identidade** (`identity_audit_logs`, criada nesta fase): o que aconteceu com
 *    a CONTA — senha, segundo fator, códigos de recuperação, troca de e-mail,
 *    sessões encerradas e pedidos de redefinição. São fatos globais: a conta existe
 *    sem instituição, e até aqui não havia onde perguntar "de onde veio esta troca
 *    de senha?" (dívida E67).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA TELA, E NÃO SÓ O BANCO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Trilha sem leitor é trilha que não existe para quem responde ao incidente: a
 *  pergunta chega no meio de um atendimento, com a pessoa esperando. Antes desta
 *  tela, a trilha de plataforma só aparecia espremida em "Métricas" (10 linhas) e em
 *  "Governança" (20), sem filtro e sem página.
 *
 *  O que a tela NÃO mostra: segredo. Senha, token, código de recuperação e semente
 *  TOTP são removidos no domínio (`sanitizeIdentityDetails`) antes de a linha existir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string; evento?: string; pagina?: string }>;
}) {
  await requirePlatformPermission();

  const { pessoa, evento, pagina } = await searchParams;
  const currentPage = Math.max(1, Number.parseInt(pagina ?? '1', 10) || 1);

  const [identity, platform, summary] = await Promise.all([
    listIdentityAudit({
      query: pessoa,
      event: evento,
      page: currentPage,
      pageSize: IDENTITY_AUDIT_PAGE_SIZE,
    }),
    listPlatformAudit({ limit: 20 }),
    identityAuditSummary({ days: 30 }),
  ]);

  const critical30d = Object.entries(summary)
    .filter(([event]) => identityAuditTone(event) === 'CRITICAL')
    .reduce((sum, [, count]) => sum + count, 0);

  const pageHref = (target: number): string => {
    const next = new URLSearchParams();
    if (pessoa) next.set('pessoa', pessoa);
    if (evento) next.set('evento', evento);
    next.set('pagina', String(target));

    return `/superadmin/auditoria?${next}`;
  };

  return (
    <div className="space-y-8" data-testid="platform-audit-page">
      <PageHeader
        title="Auditoria"
        description="Duas trilhas: as ações de governança da plataforma e os fatos de segurança das contas (senha, segundo fator, códigos, e-mail e sessões). Nenhuma delas guarda segredo."
        breadcrumbs={[{ label: 'Plataforma' }, { label: 'Auditoria' }]}
        badge={<Badge tone="primary">SuperAdmin</Badge>}
        actions={
          <p className="text-xs text-muted-foreground" data-testid="identity-critical-30d">
            {critical30d} fato(s) crítico(s) nos últimos 30 dias
          </p>
        }
      />

      {/* ── Trilha de identidade ─────────────────────────────────────────────── */}
      <section className="space-y-4" data-testid="identity-audit">
        <SectionHeading
          title="Segurança das contas"
          description="Quem mudou o quê na própria conta, de onde e quando. Fatos globais: valem em qualquer instituição."
        />

        <Card className="p-4">
          <form className="flex flex-wrap items-end gap-3" data-testid="identity-audit-filters">
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Pessoa (nome ou e-mail)</span>
              <input
                type="search"
                name="pessoa"
                defaultValue={pessoa ?? ''}
                placeholder="ana@ufba.br"
                className="w-56 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid="identity-filter-person"
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Tipo de fato</span>
              <select
                name="evento"
                defaultValue={evento ?? ''}
                className="w-64 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                data-testid="identity-filter-event"
              >
                <option value="">Todos</option>
                {IDENTITY_AUDIT_EVENTS.map((event) => (
                  <option key={event} value={event}>
                    {IDENTITY_AUDIT_EVENT_LABELS[event]}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              data-testid="identity-filter-apply"
            >
              Filtrar
            </button>

            <Link href="/superadmin/auditoria" className="text-xs underline underline-offset-4">
              Limpar
            </Link>
          </form>
        </Card>

        {identity.entries.length === 0 ? (
          <EmptyState
            icon={Fingerprint}
            title="Nenhum fato de segurança encontrado"
            description="Trocar a senha, ligar o segundo fator, usar um código de recuperação, pedir troca de e-mail e encerrar sessões aparecem aqui."
            data-testid="identity-audit-empty"
          />
        ) : (
          <>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border" data-testid="identity-audit-list">
                {identity.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="space-y-1 px-5 py-4"
                    data-testid={`identity-audit-${entry.id}`}
                    data-event={entry.event}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <Badge tone={toneToBadge(entry.tone)} size="sm" withDot>
                        {IDENTITY_AUDIT_TONE_LABELS[entry.tone]}
                      </Badge>
                      <span className="text-sm font-medium">{identityAuditLabel(entry.event)}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.subjectName ?? 'conta não identificada'}
                        {entry.subjectEmailMasked ? ` · ${entry.subjectEmailMasked}` : ''}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                      {entry.actorId ? <span>executado por outra conta</span> : <span>pela própria pessoa</span>}
                      {entry.ipAddress ? <span>IP {entry.ipAddress}</span> : null}
                      {entry.userAgent ? (
                        <span className="max-w-[28rem] truncate" title={entry.userAgent}>
                          {entry.userAgent}
                        </span>
                      ) : null}
                    </div>

                    {Object.keys(entry.details).length > 0 ? (
                      <p className="text-xs text-muted-foreground" data-testid="identity-audit-details">
                        {Object.entries(entry.details)
                          .map(([key, value]) => `${key}: ${formatDetail(value)}`)
                          .join(' · ')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>

            {identity.totalPages > 1 ? (
              <nav className="flex items-center gap-3 text-sm" data-testid="identity-audit-pagination">
                {identity.page > 1 ? (
                  <Link href={pageHref(identity.page - 1)} className="underline underline-offset-4">
                    Anterior
                  </Link>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  Página {identity.page} de {identity.totalPages} · {identity.total} fato(s)
                </span>
                {identity.page < identity.totalPages ? (
                  <Link href={pageHref(identity.page + 1)} className="underline underline-offset-4">
                    Próxima
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </section>

      {/* ── Trilha de plataforma ─────────────────────────────────────────────── */}
      <section className="space-y-4" data-testid="platform-audit">
        <SectionHeading
          title="Ações de governança"
          description="Provisionamento, suspensão, plano, quota e SuperAdmin — com autor e horário."
        />

        {platform.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="Nenhuma ação de governança registrada"
            description="Criar instituição, suspender e mudar plano aparecem aqui."
            data-testid="platform-audit-empty"
          />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border" data-testid="platform-audit-list">
              {platform.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                  <Badge tone="neutral" size="sm">
                    {entry.action}
                  </Badge>
                  <span className="text-sm text-foreground">{entry.entityType}</span>
                  <span className="text-xs text-muted-foreground">{entry.actorName ?? 'sistema'}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          A trilha de identidade mora numa tabela sem <code>tenantId</code> e a role de runtime não tem
          privilégio nela: quem lê é o painel de plataforma. As exportações de dado pessoal de cada
          instituição continuam na trilha DA instituição — e também aparecem em{' '}
          <strong>Exportações recentes</strong>, na tela que exporta.
        </p>
      </section>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <KeyRound className="size-3.5" aria-hidden />
        Segredos (senha, token, código de recuperação e semente TOTP) são removidos ANTES de a linha
        existir: o que aparece é o estado alterado, não a credencial.
      </p>
    </div>
  );
}

function toneToBadge(tone: 'INFO' | 'WARN' | 'CRITICAL'): 'neutral' | 'warning' | 'danger' {
  if (tone === 'CRITICAL') return 'danger';
  if (tone === 'WARN') return 'warning';
  return 'neutral';
}

/** Detalhe legível: booleano vira sim/não e objeto vira `{from} → {to}`. */
function formatDetail(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if ('from' in record || 'to' in record) {
      return `${formatDetail(record.from)} → ${formatDetail(record.to)}`;
    }

    return JSON.stringify(value);
  }

  return String(value);
}
