'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { BadgeCheck, Ban, Loader2, Printer, Tags, Users } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { CredentialActionState } from '@/app/actions/credential-actions';
import type { CredentialCategoryActionState } from '@/app/actions/credential-category-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ÁREA DE CRACHÁS (FASE 31 · CATEGORIA NA FASE 51 · E42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA PRECISA RESOLVER, NA ORDEM DO BALCÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. "quem está inscrito?" — todos os inscritos no evento E nas atividades, com o
 *       que cada um pode frequentar;
 *    2. "quem ainda não tem crachá?" — é o que falta emitir (um clique emite todos);
 *    3. "quem já chegou?" — a situação de credenciamento, para o balcão conferir;
 *    4. "imprimir" — individual ou em massa (a folha A4 com QR, código e nome).
 *
 *  Emissão e impressão são atos DIFERENTES: emitir cria o código, imprimir registra
 *  que a etiqueta saiu. Quem reimprime uma folha perdida não deve gerar códigos novos
 *  — o crachá que está na mão de alguém continuaria valendo, e o novo o invalidaria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CATEGORIA É ESCOLHIDA EM DOIS LUGARES, E POR UM MOTIVO (FASE 51 · E42)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • **No LOTE** (`emitCategory`) — emitir 40 crachás de equipe de uma vez é o caso
 *    comum da secretaria, e obrigar a escolher pessoa por pessoa faria o organizador
 *    desistir e imprimir tudo na cor padrão, que é o defeito que a dívida quita;
 *  • **Na LINHA** (o seletor ao lado do código) — o caso da porta: a pessoa chega
 *    com a faixa errada e a recepção corrige ali. Trocar a categoria NÃO reemite o
 *    código, então o crachá que está na mão dela continua valendo no balcão.
 *
 *  O `tone` de cada linha vem do catálogo do domínio (o mesmo que o PDF e o ZPL
 *  usam) — o componente não escolhe cor, que é o que a trava do design system exige.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface RosterCategoryOption {
  value: string;
  label: string;
  /** Tom do primitivo `Badge` (E42) — a tela não escolhe cor. */
  tone: 'primary' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  /** O que a categoria significa, para o seletor explicar a escolha. */
  description: string;
}

export interface RosterEntry {
  userId: string;
  name: string;
  email: string;
  /** Id do CRACHÁ — é ele que a revogação usa (o usuário é quem a tela lista). */
  credentialId: string | null;
  code: string | null;
  state: 'ACTIVE' | 'REVOKED' | null;
  legacy: boolean;
  printed: boolean;
  arrivedLabel: string | null;
  activities: string[];
  registrationStatus: string | null;
  attendedActivities: number;
  minutesAttended: number;
  /**
   * Categoria GRAVADA no crachá, como está no banco (E42).
   *
   * Cru de propósito: é ele que o seletor da linha marca, e um valor fora do
   * catálogo (crachá antigo, importação) aparece como "—" em vez de mentir que
   * alguém escolheu "Participante".
   */
  category: string | null;
  /** Rótulo em português da categoria normalizada. */
  categoryLabel: string | null;
  /** Tom do `Badge` da categoria normalizada. */
  categoryTone: RosterCategoryOption['tone'] | null;
}

function EmitButton({ label, testId }: { label: string; testId: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <BadgeCheck className="size-4" aria-hidden />}
      {pending ? 'Emitindo…' : label}
    </button>
  );
}

/**
 * ─── AS OUTRAS DUAS SAÍDAS DE IMPRESSÃO (FASE 37) ─────────────────────────────
 *
 *  A folha A4 serve para recortar. Quem tem **folha de etiqueta adesiva** ou **impressora
 *  térmica** imprime direto, e as duas saídas dependem de MEDIDAS que só quem tem o
 *  material em mãos conhece: a grade da folha (mm) e o rolo da térmica (mm × dpi).
 *
 *  Por isso os números ficam aqui, editáveis, com o padrão já preenchido: a primeira
 *  impressão confere, e o que estiver 1 mm fora se acerta na tela — sem deploy, e sem
 *  ninguém precisar abrir chamado. Os dois botões levam a MESMA seleção da lista.
 */
function BadgePrintOptions({
  tenantSlug,
  eventId,
  selectedUserIds,
}: {
  tenantSlug: string;
  eventId: string;
  selectedUserIds: readonly string[];
}) {
  const [layout, setLayout] = useState({
    colunas: '3',
    linhas: '8',
    largura: '63,5',
    altura: '33,9',
    margemEsquerda: '9,75',
    margemSuperior: '12,9',
    espacoHorizontal: '0',
    espacoVertical: '0',
  });
  const [thermal, setThermal] = useState({
    dpi: '203',
    largura: '100',
    altura: '50',
    ampliacaoQr: '3',
  });

  const selection =
    selectedUserIds.length > 0 ? `&userIds=${selectedUserIds.join(',')}` : '';
  const base = `/api/t/${tenantSlug}/credenciamento/crachas/impressao?eventId=${eventId}`;

  const labelsHref = `${base}&formato=etiquetas&colunas=${encodeURIComponent(
    layout.colunas,
  )}&linhas=${encodeURIComponent(layout.linhas)}&largura=${encodeURIComponent(
    layout.largura,
  )}&altura=${encodeURIComponent(layout.altura)}&margem-esquerda=${encodeURIComponent(
    layout.margemEsquerda,
  )}&margem-superior=${encodeURIComponent(layout.margemSuperior)}&espaco-horizontal=${encodeURIComponent(
    layout.espacoHorizontal,
  )}&espaco-vertical=${encodeURIComponent(layout.espacoVertical)}${selection}`;

  const zplHref = `${base}&formato=zpl&dpi=${encodeURIComponent(thermal.dpi)}&largura=${encodeURIComponent(
    thermal.largura,
  )}&altura=${encodeURIComponent(thermal.altura)}&ampliacao-qr=${encodeURIComponent(
    thermal.ampliacaoQr,
  )}${selection}`;

  const field = 'w-20 rounded-md border border-border bg-background px-2 py-1 text-xs';

  return (
    <details
      className="rounded-lg border border-border bg-surface-low p-3 text-xs"
      data-testid="badge-print-options"
    >
      <summary className="cursor-pointer font-medium">
        Etiqueta adesiva e impressora térmica (medidas)
      </summary>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="font-medium text-foreground">Folha de etiquetas adesivas</p>
          <p className="text-muted-foreground">
            Padrão: 3 × 8 etiquetas de 63,5 × 33,9 mm centralizadas em A4. Confira na primeira
            impressão e ajuste aqui.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              Colunas
              <input
                value={layout.colunas}
                onChange={(event) => setLayout((c) => ({ ...c, colunas: event.target.value }))}
                inputMode="numeric"
                data-testid="label-columns"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Linhas
              <input
                value={layout.linhas}
                onChange={(event) => setLayout((c) => ({ ...c, linhas: event.target.value }))}
                inputMode="numeric"
                data-testid="label-rows"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Largura (mm)
              <input
                value={layout.largura}
                onChange={(event) => setLayout((c) => ({ ...c, largura: event.target.value }))}
                data-testid="label-width"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Altura (mm)
              <input
                value={layout.altura}
                onChange={(event) => setLayout((c) => ({ ...c, altura: event.target.value }))}
                data-testid="label-height"
                className={field}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              Margem esquerda
              <input
                value={layout.margemEsquerda}
                onChange={(event) => setLayout((c) => ({ ...c, margemEsquerda: event.target.value }))}
                data-testid="label-margin-left"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Margem superior
              <input
                value={layout.margemSuperior}
                onChange={(event) => setLayout((c) => ({ ...c, margemSuperior: event.target.value }))}
                data-testid="label-margin-top"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Espaço entre colunas
              <input
                value={layout.espacoHorizontal}
                onChange={(event) => setLayout((c) => ({ ...c, espacoHorizontal: event.target.value }))}
                data-testid="label-gap-x"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Espaço entre linhas
              <input
                value={layout.espacoVertical}
                onChange={(event) => setLayout((c) => ({ ...c, espacoVertical: event.target.value }))}
                data-testid="label-gap-y"
                className={field}
              />
            </label>
          </div>

          <a
            href={labelsHref}
            data-testid="badge-print-labels"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-muted"
          >
            <Printer className="size-3.5" aria-hidden />
            Baixar as etiquetas (PDF)
          </a>
        </div>

        <div className="space-y-2">
          <p className="font-medium text-foreground">Impressora térmica (ZPL II)</p>
          <p className="text-muted-foreground">
            Padrão: 203 dpi com etiqueta de 100 × 50 mm. O arquivo é texto — dá para abrir e
            conferir antes de gastar etiqueta.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              Resolução
              <select
                value={thermal.dpi}
                onChange={(event) => setThermal((c) => ({ ...c, dpi: event.target.value }))}
                data-testid="thermal-dpi"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="203">203 dpi</option>
                <option value="300">300 dpi</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              Largura (mm)
              <input
                value={thermal.largura}
                onChange={(event) => setThermal((c) => ({ ...c, largura: event.target.value }))}
                data-testid="thermal-width"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              Altura (mm)
              <input
                value={thermal.altura}
                onChange={(event) => setThermal((c) => ({ ...c, altura: event.target.value }))}
                data-testid="thermal-height"
                className={field}
              />
            </label>
            <label className="flex items-center gap-1">
              QR (1–10)
              <input
                value={thermal.ampliacaoQr}
                onChange={(event) => setThermal((c) => ({ ...c, ampliacaoQr: event.target.value }))}
                data-testid="thermal-qr"
                className={field}
              />
            </label>
          </div>

          <a
            href={zplHref}
            data-testid="badge-print-zpl"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-muted"
          >
            <Printer className="size-3.5" aria-hidden />
            Baixar o arquivo ZPL
          </a>
        </div>
      </div>
    </details>
  );
}

export function BadgeRoster({
  entries,
  tenantSlug,
  eventId,
  missingCount,
  categories,
  emitAction,
  revokeAction,
  categoryAction,
  pdfPath,
}: {
  entries: readonly RosterEntry[];
  tenantSlug: string;
  eventId: string;
  missingCount: number;
  /** O catálogo de categorias, do domínio — a tela não inventa nem ordena. */
  categories: readonly RosterCategoryOption[];
  emitAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  revokeAction: (prev: CredentialActionState | null, formData: FormData) => Promise<CredentialActionState>;
  /** Troca a categoria de UM crachá (E42) — o código continua o mesmo. */
  categoryAction: (
    prev: CredentialCategoryActionState | null,
    formData: FormData,
  ) => Promise<CredentialCategoryActionState>;
  /** Endereço-base da folha de crachás (PDF); o evento e a seleção vão na query. */
  pdfPath: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /**
   * A categoria do LOTE. Começa em branco ("Participante") porque é o padrão do
   * domínio e o crachá de quem já era emitido antes desta fase — e o valor viaja
   * dentro do MESMO formulário da emissão, para não existir um segundo clique que
   * alguém possa esquecer.
   */
  const [emitCategory, setEmitCategory] = useState<string>(categories[0]?.value ?? 'PARTICIPANT');
  const [emitState, emitFormAction] = useActionState<CredentialActionState | null, FormData>(emitAction, null);
  const [revokeState, revokeFormAction] = useActionState<CredentialActionState | null, FormData>(
    revokeAction,
    null,
  );
  const [categoryState, categoryFormAction] = useActionState<CredentialCategoryActionState | null, FormData>(
    categoryAction,
    null,
  );
  const [revoking, setRevoking] = useState<string | null>(null);

  const toggle = (userId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  /**
   * A folha leva os crachás SELECIONADOS (ou todos os que têm código, quando nada
   * está marcado): imprimir 300 crachás porque ninguém desmarcou nada seria uma
   * resma de papel — e a tela diz quantos vão para a impressora antes do clique.
   */
  const selectedWithCode = entries.filter((entry) => selected.has(entry.userId) && entry.code !== null);
  const printableCount = selectedWithCode.length > 0 ? selectedWithCode.length : null;

  const withEvent = (extra: string) => `${pdfPath}?eventId=${eventId}${extra}`;

  const sheetHref =
    printableCount === null
      ? withEvent('')
      : withEvent(`&userIds=${selectedWithCode.map((entry) => entry.userId).join(',')}`);

  return (
    <div className="space-y-4" data-testid="badge-roster">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-low p-3">
        <form action={emitFormAction} data-testid="badge-emit-form" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          {[...selected].map((userId) => (
            <input key={userId} type="hidden" name="userIds" value={userId} />
          ))}

          {/**
           * ── A CATEGORIA DO LOTE (E42) ─────────────────────────────────────────
           *  Um `select` com o catálogo do domínio: a emissão em massa é o caminho
           *  da secretaria (40 crachás de equipe), e escolher pessoa por pessoa ali
           *  faria o organizador desistir da cor.
           */}
          <label className="space-y-1 text-xs font-medium">
            Categoria do lote
            <select
              name="category"
              value={emitCategory}
              onChange={(event) => setEmitCategory(event.target.value)}
              aria-label="Categoria dos crachás emitidos"
              data-testid="badge-emit-category"
              className="block min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
            >
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>

          <EmitButton
            label={
              selected.size > 0
                ? `Emitir crachá para ${selected.size} selecionado(s)`
                : `Emitir crachás que faltam (${missingCount})`
            }
            testId="badge-emit"
          />
        </form>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <a
            href={sheetHref}
            data-testid="badge-print"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium hover:bg-muted"
          >
            <Printer className="size-3.5" aria-hidden />
            {printableCount === null
              ? 'Imprimir a folha (todos com crachá)'
              : `Imprimir a folha (${printableCount} selecionado(s))`}
          </a>
          <span className="text-muted-foreground">
            Folha A4 com 8 crachás por página: QR Code, código, nome e a faixa da categoria.
          </span>
        </div>
      </div>

      <BadgePrintOptions
        tenantSlug={tenantSlug}
        eventId={eventId}
        selectedUserIds={selectedWithCode.map((entry) => entry.userId)}
      />

      {emitState ? (
        <p
          role={emitState.ok ? 'status' : 'alert'}
          data-testid="badge-emit-feedback"
          className={`text-sm ${emitState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {emitState.message}
        </p>
      ) : null}

      {categoryState ? (
        <p
          role={categoryState.ok ? 'status' : 'alert'}
          data-testid="badge-category-feedback"
          className={`text-sm ${categoryState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {categoryState.message}
        </p>
      ) : null}

      {revokeState ? (
        <p
          role={revokeState.ok ? 'status' : 'alert'}
          data-testid="badge-revoke-feedback"
          className={`text-sm ${revokeState.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {revokeState.message}
        </p>
      ) : null}

      <ul className="space-y-2" data-testid="badge-list">
        {entries.map((entry) => (
          <li
            key={entry.userId}
            data-testid={`badge-row-${entry.userId}`}
            data-has-credential={entry.code ? 'true' : 'false'}
            data-credential-state={entry.state ?? 'NONE'}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
          >
            <label className="flex min-w-0 flex-1 items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={selected.has(entry.userId)}
                onChange={() => toggle(entry.userId)}
                aria-label={`Selecionar ${entry.name}`}
                data-testid={`badge-select-${entry.userId}`}
                className="mt-0.5 size-4"
              />
              <span className="min-w-0 space-y-0.5">
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{entry.email}</span>
                <span className="block text-xs text-muted-foreground">
                  {entry.activities.length > 0
                    ? entry.activities.join(' · ')
                    : 'Sem inscrição em atividade (crachá emitido à mão)'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {entry.arrivedLabel ? `Chegou às ${entry.arrivedLabel}` : 'Ainda não credenciado'}
                  {entry.attendedActivities > 0
                    ? ` · ${entry.attendedActivities} atividade(s) · ${entry.minutesAttended} min`
                    : ''}
                </span>
              </span>
            </label>

            <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
              {entry.code ? (
                <>
                  {/**
                   * ── A FAIXA DA CATEGORIA NA LISTA (E42) ────────────────────────
                   *  O mesmo tom que sai no papel: quem confere a lista antes de
                   *  imprimir vê a cor que vai para a etiqueta — e um crachá com
                   *  valor fora do catálogo aparece como "—", sem fingir que é
                   *  participante.
                   */}
                  {entry.categoryLabel && entry.categoryTone ? (
                    <Badge tone={entry.categoryTone} withDot size="sm" data-testid={`badge-category-${entry.userId}`}>
                      {entry.categoryLabel}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground" data-testid={`badge-category-${entry.userId}`}>
                      categoria não definida
                    </span>
                  )}

                  <span className="code-data" data-testid={`badge-code-${entry.userId}`}>
                    {entry.code}
                  </span>
                  <span
                    className={
                      entry.state === 'ACTIVE' ? 'text-success-strong' : 'text-destructive'
                    }
                    data-testid={`badge-state-${entry.userId}`}
                  >
                    {entry.state === 'ACTIVE' ? 'válido' : 'revogado'}
                    {entry.printed ? ' · impresso' : ''}
                    {entry.legacy ? ' · crachá anterior' : ''}
                  </span>

                  {/**
                   * ── TROCAR A CATEGORIA NA PORTA (E42) ──────────────────────────
                   *  Formulário próprio, com o `credentialId` do crachá: o código
                   *  NÃO muda, então a etiqueta que está na mão da pessoa continua
                   *  valendo — o que muda é a cor da próxima impressão e o que a
                   *  lista mostra.
                   */}
                  {entry.state === 'ACTIVE' && entry.credentialId ? (
                    <form action={categoryFormAction} className="flex items-center gap-1">
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="credentialId" value={entry.credentialId} />
                      <label className="sr-only" htmlFor={`category-${entry.userId}`}>
                        Categoria do crachá de {entry.name}
                      </label>
                      <select
                        id={`category-${entry.userId}`}
                        name="category"
                        defaultValue={entry.category ?? ''}
                        data-testid={`badge-category-select-${entry.userId}`}
                        className="rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                      >
                        {/* A opção vazia só existe para um valor FORA do catálogo:
                            sem ela o `select` mostraria "Participante" para um dado
                            que não é participante. Desabilitada, ela não é escolhível. */}
                        {entry.category === null || entry.categoryLabel === null ? (
                          <option value="" disabled>
                            Definir categoria…
                          </option>
                        ) : null}
                        {categories.map((category) => (
                          <option key={category.value} value={category.value}>
                            {category.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        data-testid={`badge-category-save-${entry.userId}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                      >
                        <Tags className="size-3" aria-hidden />
                        Trocar
                      </button>
                    </form>
                  ) : null}

                  {entry.state === 'ACTIVE' ? (
                    revoking === entry.userId ? (
                      <form action={revokeFormAction} className="flex items-center gap-1">
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={eventId} />
                        <input type="hidden" name="credentialId" value={entry.credentialId ?? ''} />
                        <input
                          name="reason"
                          required
                          minLength={5}
                          maxLength={300}
                          placeholder="Motivo da revogação"
                          aria-label={`Motivo da revogação do crachá de ${entry.name}`}
                          className="w-48 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                        />
                        <button
                          type="submit"
                          data-testid={`badge-revoke-confirm-${entry.userId}`}
                          className="rounded-md border border-destructive/50 px-2 py-0.5 text-destructive"
                        >
                          Revogar
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevoking(null)}
                          className="px-1 text-muted-foreground hover:underline"
                        >
                          cancelar
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRevoking(entry.userId)}
                        data-testid={`badge-revoke-${entry.userId}`}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                      >
                        <Ban className="size-3" aria-hidden />
                        Revogar
                      </button>
                    )
                  ) : null}

                  {entry.code ? (
                    <a
                      href={withEvent(`&userIds=${entry.userId}`)}
                      data-testid={`badge-print-one-${entry.userId}`}
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 hover:bg-muted"
                    >
                      <Printer className="size-3" aria-hidden />
                      Imprimir
                    </a>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground" data-testid={`badge-code-${entry.userId}`}>
                  sem crachá
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {entries.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          Nenhum participante encontrado com este filtro. A lista reúne quem tem inscrição no evento ou em
          atividades, e quem já recebeu crachá.
        </p>
      ) : null}
    </div>
  );
}
