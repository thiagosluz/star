import Link from 'next/link';
import { ArrowRight, Banknote, Handshake, QrCode, Tags } from 'lucide-react';

import type { SponsorKpiSummary } from '@/domain/events/sponsor-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

/**
 * Faixa executiva fixa do cockpit de patrocínio (FASE 125).
 *
 * Mantém visíveis os 4 sinais comerciais e operacionais essenciais no topo sem
 * depender de qual aba (`patrocinadores`, `cotas`, `estandes`) está aberta e cria
 * ponte direta para `/financeiro`.
 */
export function SponsorKpiCards({
  summary,
  tenantSlug,
  eventId,
}: {
  summary: SponsorKpiSummary;
  tenantSlug: string;
  eventId: string;
}) {
  const financeHref = tenantPath(tenantSlug, `/administracao/eventos/${eventId}/financeiro`);

  return (
    <section
      aria-label="Indicadores de patrocínio"
      data-testid="sponsor-kpi-strip"
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      {/* 1. Marcas & Vitrine */}
      <article
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="sponsor-kpi-brands"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Marcas & vitrine</span>
          <Handshake className="size-4" aria-hidden />
        </div>
        <p className="mt-1.5 text-xl font-semibold text-foreground">
          {summary.totalSponsors} patrocinador(es)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.publicCount} visível(is) · {summary.hiddenCount} oculto(s)
          {summary.withoutLogoCount > 0 ? ` · ${summary.withoutLogoCount} sem logo` : ''}
        </p>
      </article>

      {/* 2. Receita Contratada + ponte com Financeiro */}
      <article
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="sponsor-kpi-contracts"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Receita contratada</span>
          <Banknote className="size-4" aria-hidden />
        </div>
        <p className="mt-1.5 text-xl font-semibold text-foreground">
          {formatMoney(summary.totalContractValueCents)}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-xs">
          <span
            className={
              summary.expiredContractsCount > 0 ? 'text-destructive' : 'text-muted-foreground'
            }
          >
            {summary.activeContractsCount} vigente(s)
            {summary.expiredContractsCount > 0
              ? ` · ${summary.expiredContractsCount} vencido(s)`
              : ''}
          </span>
          <Link
            href={financeHref}
            data-testid="sponsor-finance-link"
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            Ver no Financeiro
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
      </article>

      {/* 3. Cotas & Ocupação */}
      <article
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="sponsor-kpi-tiers"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Cotas & ocupação</span>
          <Tags className="size-4" aria-hidden />
        </div>
        <p className="mt-1.5 text-xl font-semibold text-foreground">
          {summary.totalTiers} cota(s)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.totalLimitedSlots > 0
            ? `${summary.occupiedLimitedSlots}/${summary.totalLimitedSlots} vaga(s) limitada(s) ocupada(s)`
            : 'Sem teto de vagas definido'}
        </p>
      </article>

      {/* 4. Estandes & Consentimento LGPD */}
      <article
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        data-testid="sponsor-kpi-experience"
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Estandes & leads LGPD</span>
          <QrCode className="size-4" aria-hidden />
        </div>
        <p className="mt-1.5 text-xl font-semibold text-foreground">
          {summary.leadCount} contato(s)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary.activeQrCount} QR(s) ativo(s) · {summary.visitCount} visita(s) ·{' '}
          {summary.consentRatePercent !== null
            ? `${summary.consentRatePercent}% de consentimento`
            : 'sem visitas ainda'}
        </p>
      </article>
    </section>
  );
}
