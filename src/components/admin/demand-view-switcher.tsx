/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SELETOR DE VISTAS DO QUADRO DE DEMANDAS (FASE 57)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS VISTAS SÃO A MESMA TELA, E O ENDEREÇO DIZ QUAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Kanban, Gantt e calendário não são três páginas: são três DESENHOS das mesmas
 *  demandas, e a escolha é um parâmetro de URL (`?vista=`). Isso mantém o que já
 *  funcionava — o quadro sem JavaScript, os `data-testid`, o arrastar — e faz cada
 *  vista ser um endereço que se pode mandar para outra pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SÃO LINKS, E NÃO ABAS DE CLIENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um seletor com estado de cliente exigiria hidratação para funcionar: sem JavaScript
 *  a pessoa ficaria presa na vista em que chegou. Link é a única forma que funciona nos
 *  dois mundos (a mesma lição da dívida E50) — e o estado ativo é DERIVADO do parâmetro,
 *  não guardado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS FILTROS SOBREVIVEM À TROCA DE VISTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Trocar de vista e perder o filtro mostraria OUTRA lista: quem filtrou por "Atrasadas"
 *  e foi para o calendário veria o mês inteiro, e concluiria que o filtro não vale ali.
 *  Os cinco parâmetros da barra de filtros viajam junto.
 */
import Link from 'next/link';

import { tenantPath } from '@/domain/tenancy/resolution';
import { cn } from '@/lib/utils/cn';

export const DEMAND_VIEWS = ['kanban', 'gantt', 'calendario'] as const;

export type DemandView = (typeof DEMAND_VIEWS)[number];

/**
 * Valor desconhecido cai no Kanban — a vista que já existia.
 *
 * Um `?vista=planilha` colado à mão não pode virar tela em branco: a resposta honesta é
 * mostrar o padrão.
 */
export function isDemandView(value: unknown): value is DemandView {
  return typeof value === 'string' && (DEMAND_VIEWS as readonly string[]).includes(value);
}

/** Os filtros da barra do quadro, como chegaram pela URL. */
export interface DemandViewFilters {
  responsavel?: string;
  equipe?: string;
  situacao?: string;
  busca?: string;
  cartoes?: string;
}

const VIEW_LABELS: Record<DemandView, string> = {
  kanban: 'Kanban',
  gantt: 'Gantt',
  calendario: 'Calendário',
};

/**
 * A query de um endereço de vista: a vista, os filtros da tela e, quando há, o período.
 *
 * O período (`de` no Gantt, `mes` no calendário) é do DESENHO, não do filtro: ele entra
 * por último porque só a navegação de cada vista o define.
 */
export function demandViewQuery(
  view: DemandView,
  filters: DemandViewFilters,
  period?: { key: 'de' | 'mes'; value: string },
): string {
  const query = new URLSearchParams();

  query.set('vista', view);

  if (filters.responsavel) query.set('responsavel', filters.responsavel);
  if (filters.equipe) query.set('equipe', filters.equipe);
  if (filters.situacao) query.set('situacao', filters.situacao);
  if (filters.busca) query.set('busca', filters.busca);
  if (filters.cartoes) query.set('cartoes', filters.cartoes);

  if (period) query.set(period.key, period.value);

  return query.toString();
}

export function DemandViewSwitcher({
  tenantSlug,
  eventId,
  current,
  filters,
}: {
  tenantSlug: string;
  eventId: string;
  current: DemandView;
  filters: DemandViewFilters;
}) {
  const basePath = `/administracao/eventos/${eventId}/demandas`;

  return (
    <nav
      aria-label="Vistas das demandas"
      data-testid="demand-view-switcher"
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {DEMAND_VIEWS.map((view) => {
        const active = view === current;

        return (
          <Link
            key={view}
            href={`${tenantPath(tenantSlug, basePath)}?${demandViewQuery(view, filters)}`}
            /**
             * `aria-current="page"` é o que diz ao leitor de tela em que vista a pessoa
             * está — a cor sozinha não informa nada a quem não a vê.
             */
            aria-current={active ? 'page' : undefined}
            data-testid={`demand-view-${view}`}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-primary font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {VIEW_LABELS[view]}
          </Link>
        );
      })}
    </nav>
  );
}
