import { ExportPanel } from '@/components/exports/export-panel';
import type { ExportRecordView } from '@/lib/exports/export-service';
import { canExportEventData } from '@/domain/exports/export-rules';
import type { Principal } from '@/domain/rbac/authorization';
import { tenantPath } from '@/domain/tenancy/resolution';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O PAINEL DE EXPORTAÇÃO NA RAIZ DO EVENTO (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE EXISTE (E NÃO UM `<ExportPanel>` SOLTO NA PÁGINA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A F49 deixou o painel pronto e sem porta na raiz do evento: quem queria os
 *  inscritos de UM evento saía da tela, ia ao diretório, escolhia no `<select>` — e
 *  o diretório esconde eventos em `DRAFT`, então o evento recém-criado nem aparecia
 *  lá. Aqui o painel nasce com o recorte do evento já preenchido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA ESCONDE O QUE A ACTION RECUSARIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz exige `event:update`, e a exportação exige `participant:read` — são
 *  permissões DIFERENTES, então cabe perfeitamente alguém que administra o evento e
 *  não lê o diretório de participantes. Para essa pessoa o painel NÃO rende nada: a
 *  Server Action da F49 já recusaria o pedido, e um botão que termina em erro ensina
 *  a não confiar na tela.
 *
 *  A decisão vem de `canExportEventData` (domínio), a MESMA função que o teste usa
 *  com os dois principals — e a action continua reconferindo por conta própria
 *  (a rota é a rota, não o botão).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS DOIS TIPOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Inscritos no evento" é o CSV do diretório RECORTADO pelo evento (as colunas
 *  passam a ser do evento) e "Presenças por atividade" é o formato longo, uma linha
 *  por sessão. São a mesma pergunta em duas granularidades, e o painel oferece as
 *  duas no mesmo lugar — ver o comentário de `ExportPanel`.
 */
export interface EventExportPanelProps {
  tenantSlug: string;
  eventId: string;
  principal: Principal;
  /** Exportação recém-criada (`?exportacao=<id>`), quando a tela volta do pedido. */
  created?: ExportRecordView | null;
  /** Exportações recentes DESTE evento (a página já filtra). */
  recent?: readonly ExportRecordView[];
  /** Motivo da recusa, quando o pedido volta com `?erro=`. */
  error?: string | null;
}

export function EventExportPanel({
  tenantSlug,
  eventId,
  principal,
  created = null,
  recent = [],
  error = null,
}: EventExportPanelProps) {
  if (!canExportEventData(principal)) return null;

  return (
    <ExportPanel
      tenantSlug={tenantSlug}
      kinds={['PARTICIPANTS_CSV', 'ATTENDANCES_CSV']}
      returnTo={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
      filters={{ evento: eventId }}
      created={created}
      recent={recent}
      error={error}
      testId="event-export"
      title="Exportar os dados deste evento (CSV)"
      /**
       * `div`, e não `section`: o painel entra DENTRO do grupo "Operar", e a raiz
       * tem cinco `<section>` por contrato (prontidão + quatro grupos). Uma sexta
       * seria a seção que a F53/F77 evitaram — e ela desceria o mapa de 17 cartões.
       */
      surface="div"
    />
  );
}
