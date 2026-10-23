import Link from 'next/link';
import { Clock, Download, FileSpreadsheet, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { ExportRecordView } from '@/lib/exports/export-service';
import { createExportAction, revokeExportAction } from '@/app/actions/export-actions';
import {
  EXPORT_KIND_ACTION_LABELS,
  EXPORT_KIND_FILE_SLUG,
  EXPORT_KIND_LABELS,
  EXPORT_TTL_HOURS,
  EXPORT_WATERMARK_NOTICE,
  exportDownloadersLabel,
  type ExportKind,
} from '@/domain/exports/export-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL DE EXPORTAÇÃO (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA DIZ ANTES DE O ARQUIVO SAIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Que o arquivo leva o nome de quem exportou, a instituição, a data e a validade em
 *  CADA linha — e que o link vale 24 horas. Avisar depois seria aviso inútil: o CSV
 *  já estaria na pasta compartilhada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FUNCIONA SEM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Pedir é um POST de formulário e a ação volta para a MESMA tela com
 *  `?exportacao=<id>`; então o botão de baixar e a lista de exportações recentes são
 *  HTML servido pelo servidor. Nada aqui depende do bundle carregar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DOIS TIPOS, UM PAINEL (FASE 77 · fatia 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz do evento oferece DOIS arquivos com o mesmo recorte — inscritos e
 *  presenças por atividade —, e eles são a mesma pergunta ("quem está neste
 *  evento?") com granularidades diferentes. Por isso são dois BOTÕES no mesmo
 *  painel, e não dois painéis:
 *
 *   • dois painéis repetiriam aviso de marca d'água, prazo e lista de recentes, e a
 *     tela passaria a ter duas seções fazendo a mesma pergunta;
 *   • um `<select>` de tipo esconderia a segunda opção atrás de um clique e faria o
 *     organizador escolher antes de saber o que existe;
 *   • dois botões mostram as duas opções e qual é qual, e cada um continua sendo um
 *     submit de formulário — nada de JavaScript.
 *
 *  Cada botão carrega o `kind` no próprio `name`/`value`, então o POST diz o que foi
 *  clicado sem estado no cliente (o `hidden` de tipo que existia antes não convive
 *  com dois botões: o formulário enviaria os dois valores).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM BAIXOU APARECE NA PRÓPRIA LISTA (dívida E73 · FASE 51)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O nome de quem baixou estava só na trilha de auditoria: quem quisesse saber
 *  precisava sair da tela e abrir a auditoria. Aqui a linha DIZ — nome e instante
 *  dos últimos downloads —, e quando não houve nenhum ela diz "ninguém baixou
 *  ainda", porque uma linha sem essa informação é lida como tela quebrada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ExportPanelFilters {
  busca?: string;
  evento?: string;
  /** Atividade do recorte, quando a exportação é de presenças por atividade. */
  atividade?: string;
  certificado?: boolean;
  presente?: boolean;
  sponsorId?: string;
}

export interface ExportPanelProps {
  tenantSlug: string;
  /** Os tipos que ESTE painel oferece — um botão por tipo. */
  kinds: readonly ExportKind[];
  /** Caminho interno para onde voltar depois de pedir (a própria tela). */
  returnTo: string;
  filters?: ExportPanelFilters;
  /** Exportação recém-criada (`?exportacao=<id>`), quando a tela volta do pedido. */
  created?: ExportRecordView | null;
  /** Exportações recentes do mesmo tipo. */
  recent?: readonly ExportRecordView[];
  /** Patrocinador do pedido, quando é exportação de contatos (autorização e revogação). */
  sponsorId?: string;
  /** Título da seção (o diretório e o painel do patrocinador usam textos diferentes). */
  title?: string;
  /** `data-testid` do formulário — o E2E precisa distinguir os dois painéis. */
  testId: string;
  /** Motivo da recusa, quando a tela volta com `?erro=<mensagem>` (FASE 49). */
  error?: string | null;
  /**
   * O elemento raiz. `section` é o padrão; `div` existe porque a raiz do evento
   * tem CINCO `<section>` no DOM por contrato (prontidão + quatro grupos) e o painel
   * entra DENTRO de "Operar" — uma seção aninhada seria a sexta.
   */
  surface?: 'section' | 'div';
}

export function ExportPanel({
  tenantSlug,
  kinds,
  returnTo,
  filters = {},
  created = null,
  recent = [],
  sponsorId,
  title,
  testId,
  error = null,
  surface = 'section',
}: ExportPanelProps) {
  /**
   * A exportação recém-criada só aparece no painel do patrocinador QUE a pediu: a
   * página de patrocínio mostra vários, e mostrar o botão de baixar no cartão errado
   * entregaria o arquivo de outra empresa.
   */
  const ready = created && (sponsorId === undefined || created.sponsorId === sponsorId) ? created : null;
  const singleKind = kinds.length === 1 ? kinds[0] : null;
  const heading = title ?? `Exportar ${(singleKind ? EXPORT_KIND_LABELS[singleKind] : 'dados').toLowerCase()} (CSV)`;

  const Root = surface === 'section' ? 'section' : 'div';

  return (
    <Root className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid={testId}>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4 text-primary" aria-hidden />
          {heading}
        </h2>
        <p className="text-xs text-muted-foreground" data-testid={`${testId}-notice`}>
          {EXPORT_WATERMARK_NOTICE}
        </p>
      </header>

      {error ? (
        <p
          className="rounded-lg border border-destructive/40 bg-destructive-soft/40 p-2 text-xs text-destructive"
          data-testid={`${testId}-error`}
        >
          {error}
        </p>
      ) : null}

      {ready ? (
        <ReadyBox tenantSlug={tenantSlug} record={ready} testId={testId} showKind={kinds.length > 1} />
      ) : null}

      <form action={createExportAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="returnTo" value={returnTo} />
        {filters.busca ? <input type="hidden" name="busca" value={filters.busca} /> : null}
        {filters.evento ? <input type="hidden" name="evento" value={filters.evento} /> : null}
        {filters.atividade ? <input type="hidden" name="atividade" value={filters.atividade} /> : null}
        {filters.certificado ? <input type="hidden" name="certificado" value="1" /> : null}
        {filters.presente ? <input type="hidden" name="presente" value="1" /> : null}
        {sponsorId ? <input type="hidden" name="sponsorId" value={sponsorId} /> : null}

        {kinds.map((kind) => (
          <button
            key={kind}
            type="submit"
            name="kind"
            value={kind}
            /**
             * Com um tipo só, o testid continua `-create`: é o que o E2E da F49
             * clica desde a fase. Com dois, cada botão precisa do próprio nome para
             * o teste (e a pessoa) não confundir um com o outro.
             */
            data-testid={
              singleKind === null ? `${testId}-create-${EXPORT_KIND_FILE_SLUG[kind]}` : `${testId}-create`
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            {singleKind === null ? EXPORT_KIND_ACTION_LABELS[kind] : 'Gerar exportação'}
          </button>
        ))}

        <span className="text-xs text-muted-foreground">
          Vale {EXPORT_TTL_HOURS} horas · arquivo com marca d&apos;água
        </span>
      </form>

      <RecentList
        tenantSlug={tenantSlug}
        showKind={kinds.length > 1}
        returnTo={returnTo}
        sponsorId={sponsorId}
        recent={recent}
        testId={testId}
      />
    </Root>
  );
}

/** O arquivo está pronto: link de download, prazo e contagem. */
function ReadyBox({
  tenantSlug,
  record,
  testId,
  showKind,
}: {
  tenantSlug: string;
  record: ExportRecordView;
  testId: string;
  /** Com dois tipos no painel, o "Pronto" diz QUAL arquivo está pronto. */
  showKind: boolean;
}) {
  const downloadPath = exportDownloadPath(tenantSlug, record.id);

  return (
    <div
      className="space-y-1 rounded-lg border border-success/40 bg-success-soft/40 p-3"
      data-testid={`${testId}-ready`}
      data-kind={record.kind}
    >
      <p className="text-xs font-medium text-success-strong">
        Pronto: {record.rowCount} linha(s){showKind ? ` · ${EXPORT_KIND_LABELS[record.kind]}` : ''}
        {record.truncated ? ' (lista truncada pelo teto)' : ''}.
      </p>
      <p className="text-xs text-muted-foreground">
        Válido por {record.hoursLeft} hora(s) — até{' '}
        {record.expiresAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.
      </p>
      <Link
        href={downloadPath}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        data-testid={`${testId}-download`}
      >
        <Download className="size-3.5" aria-hidden />
        Baixar o arquivo agora
      </Link>
    </div>
  );
}

function RecentList({
  tenantSlug,
  showKind,
  returnTo,
  sponsorId,
  recent,
  testId,
}: {
  tenantSlug: string;
  /** Com mais de um tipo no painel, a linha diz QUAL arquivo ela é. */
  showKind: boolean;
  returnTo: string;
  sponsorId?: string;
  recent: readonly ExportRecordView[];
  testId: string;
}) {
  if (recent.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`${testId}-recent-empty`}>
        Nenhuma exportação recente. O que sai daqui fica registrado na trilha da instituição.
      </p>
    );
  }

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Clock className="size-3.5" aria-hidden />
        Exportações recentes
      </h3>

      <ul className="space-y-2" data-testid={`${testId}-recent`}>
        {recent.map((record) => (
          <li
            key={record.id}
            className="flex flex-wrap items-center justify-between gap-2 text-xs"
            data-testid={`${testId}-recent-${record.id}`}
            data-status={record.status}
            data-kind={record.kind}
          >
            <span className="space-y-0.5">
              <span className="block text-muted-foreground">
                {showKind ? `${EXPORT_KIND_LABELS[record.kind]} · ` : ''}
                {record.createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                {record.authorName} · {record.rowCount} linha(s)
                {record.downloadCount > 0 ? ` · ${record.downloadCount} download(s)` : ''}
              </span>

              {/*
                O TEXTO de quem baixou é montado pelo DOMÍNIO
                (`exportDownloadersLabel`): a regra "sem download diz que ninguém
                baixou" fica presa por teste, e a tela só imprime.
              */}
              <span
                className="block text-muted-foreground"
                data-testid={`${testId}-downloaders-${record.id}`}
              >
                {exportDownloadersLabel({
                  downloaders: record.downloaders,
                  downloadCount: record.downloadCount,
                })}
              </span>
            </span>

            <span className="flex items-center gap-2">
              <StatusBadge status={record.status} hoursLeft={record.hoursLeft} />

              {record.status === 'ATIVA' ? (
                <Link
                  href={exportDownloadPath(tenantSlug, record.id)}
                  className="underline underline-offset-4"
                  data-testid={`${testId}-redownload-${record.id}`}
                >
                  Baixar de novo
                </Link>
              ) : null}

              {record.status !== 'REVOGADA' ? (
                <form action={revokeExportAction} className="inline-flex items-center gap-1">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  {/**
                   * O tipo vem do REGISTRO, não do painel: o mesmo painel pode
                   * oferecer dois, e revogar com o tipo errado pediria autorização
                   * para outro dado.
                   */}
                  <input type="hidden" name="kind" value={record.kind} />
                  <input type="hidden" name="exportId" value={record.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  {sponsorId ? <input type="hidden" name="sponsorId" value={sponsorId} /> : null}
                  <button
                    type="submit"
                    className="text-destructive underline underline-offset-4"
                    data-testid={`${testId}-revoke-${record.id}`}
                  >
                    Revogar
                  </button>
                </form>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Cada download entra na trilha com quem baixou e quantas linhas saíram. Passado o prazo,
        exportar de novo é um ato novo.
      </p>
    </div>
  );
}

function StatusBadge({ status, hoursLeft }: { status: ExportRecordView['status']; hoursLeft: number }) {
  if (status === 'ATIVA') {
    return (
      <Badge tone="success">
        válida por {hoursLeft} h
      </Badge>
    );
  }

  return <Badge tone="neutral">{status === 'EXPIRADA' ? 'expirada' : 'revogada'}</Badge>;
}

export function exportDownloadPath(tenantSlug: string, exportId: string): string {
  return `/api/t/${tenantSlug}/exportacoes/${exportId}/arquivo`;
}
