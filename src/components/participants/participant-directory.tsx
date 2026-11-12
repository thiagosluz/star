'use client';

import { useEffect, useRef, useState } from 'react';
import { Inbox, UserRound } from 'lucide-react';

import { MessageComposer } from '@/components/participants/message-composer';
import type { ParticipantActionState } from '@/app/actions/participant-actions';
import { AppLink } from '@/components/ui/app-link';
import { tenantPath } from '@/domain/tenancy/resolution';

/** Linha do diretório já pronta para a tela (datas como texto, domínio aplicado). */
export interface DirectoryEntry {
  userId: string;
  name: string;
  emailMasked: string;
  originLabel: string;
  events: number;
  confirmed: number;
  attended: number;
  visits: number;
  minutes: number;
  certificates: number;
  cards: number;
  xp: number;
  rateLabel: string;
  ratePercent: number | null;
  engagement: readonly string[];
  lastActivityLabel: string | null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Diretório de participantes (FASE 32 / FASE 103 · ADR-431)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A SELEÇÃO VIVE AQUI, E NÃO NA URL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Marcar 12 pessoas para mandar um recado é uma ação de SEGUNDOS, no meio de uma
 *  tarefa: se cada clique virasse navegação, a pessoa perderia o texto que estava
 *  escrevendo e a seleção não sobreviveria a um filtro novo. A seleção é estado de
 *  tela; o que vai para o servidor é a lista de `userId` no envio.
 *
 *  O E-MAIL JÁ VEM MASCARADO DO SERVIDOR (`maskEmail`, no domínio): a lista é a tela
 *  mais copiada da instituição, e o endereço completo só aparece na ficha de quem
 *  decidiu abrir aquele cadastro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NAVEGAÇÃO POR TECLADO OPERACIONAL (FASE 103 · ADR-431)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Operadores que gerenciam listas longas de participantes utilizam:
 *    • `ArrowDown` / `ArrowUp` para circular pelas pessoas da tabela;
 *    • `Enter` para abrir a ficha do participante ativo;
 *    • `Espaço` para alternar a marcação da caixa de mensagem da pessoa ativa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ParticipantDirectory({
  entries,
  tenantSlug,
  action,
  canMessage,
  selectedEventId,
}: {
  entries: readonly DirectoryEntry[];
  tenantSlug: string;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
  canMessage: boolean;
  selectedEventId: string | null;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const toggle = (userId: string, checked: boolean): void => {
    setSelected((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );
  };

  const allSelected = entries.length > 0 && entries.every((entry) => selected.includes(entry.userId));

  useEffect(() => {
    if (entries.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (prev === null ? 0 : Math.min(prev + 1, entries.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (prev === null ? 0 : Math.max(prev - 1, 0)));
      } else if (e.key === 'Enter' && activeIndex !== null) {
        const activeUser = entries[activeIndex];
        if (activeUser) {
          const openLink = document.querySelector<HTMLAnchorElement>(
            `[data-testid="participant-open-${activeUser.userId}"]`,
          );
          if (openLink) {
            e.preventDefault();
            openLink.click();
          }
        }
      } else if (e.key === ' ' && activeIndex !== null && canMessage) {
        const activeUser = entries[activeIndex];
        if (activeUser) {
          e.preventDefault();
          toggle(activeUser.userId, !selected.includes(activeUser.userId));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entries, activeIndex, selected, canMessage]);

  const prevActiveIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (activeIndex === null || !entries[activeIndex]) {
      prevActiveIndexRef.current = activeIndex;
      return;
    }
    if (prevActiveIndexRef.current !== activeIndex) {
      prevActiveIndexRef.current = activeIndex;
      const activeUserId = entries[activeIndex].userId;
      const activeRow = document.querySelector<HTMLElement>(
        `[data-testid="participant-row-${activeUserId}"]`,
      );
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      activeRow?.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      });
    }
  }, [activeIndex, entries]);

  return (
    <div className="space-y-4">
      {canMessage ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="directory-messaging">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Inbox className="size-4 text-primary" aria-hidden />
              Enviar recado
            </h2>
            <p className="text-xs text-muted-foreground" data-testid="directory-selected-count">
              {selected.length === 0
                ? 'Ninguém selecionado — marque as pessoas na lista abaixo'
                : `${selected.length} pessoa(s) selecionada(s)`}
            </p>
          </header>

          {selected.length > 0 ? (
            <MessageComposer
              tenantSlug={tenantSlug}
              userIds={selected}
              eventId={selectedEventId}
              action={action}
              label={selected.length === 1 ? 'Enviar para 1 pessoa' : `Enviar para ${selected.length}`}
              compact
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              O recado vai por e-mail e fica na caixa de entrada do participante.
            </p>
          )}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" data-testid="directory-count">
          {entries.length} pessoa(s) nesta página
        </p>

        <div className="flex items-center gap-3">
          {canMessage && entries.length > 0 ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(event) =>
                  setSelected(event.target.checked ? entries.map((entry) => entry.userId) : [])
                }
                data-testid="directory-select-all"
                className="size-3.5"
              />
              Selecionar a página
            </label>
          ) : null}
        </div>
      </div>

      {entries.length === 0 ? (
        <div
          className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground flex flex-wrap items-center justify-between gap-3"
          data-testid="directory-empty"
        >
          <p>Nenhum participante encontrado com estes filtros.</p>
          <AppLink
            href={tenantPath(tenantSlug, '/participantes')}
            className="text-xs font-medium text-primary underline underline-offset-4"
            data-testid="directory-clear-filters"
          >
            Limpar todos os filtros
          </AppLink>
        </div>
      ) : (
        <>
          <div aria-live="polite" className="sr-only" data-testid="directory-live-region">
            {activeIndex !== null && entries[activeIndex]
              ? `Linha atual ${activeIndex + 1} de ${entries.length}: ${entries[activeIndex].name}`
              : ''}
          </div>

          <p className="sr-only" data-testid="directory-keyboard-hint">
            Use as setas para baixo e para cima para navegar nas linhas, Enter para abrir a ficha 360 e Espaço para selecionar.
          </p>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm" data-testid="participant-list">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  {/**
                    * A coluna de seleção e a de ações NÃO têm texto visível, e é por isso
                    * que trazem o rótulo em `sr-only` em vez de `aria-label`: o `aria-label`
                    * nomeia o cabeçalho para o leitor de tela, mas o `axe` continua vendo
                    * uma célula de cabeçalho VAZIA (`empty-table-header`) — o texto
                    * escondido resolve os dois, sem mudar um pixel da tabela.
                    */}
                  {canMessage ? (
                    <th className="w-8 px-2 py-2">
                      <span className="sr-only">Selecionar</span>
                    </th>
                  ) : null}
                  <th className="px-3 py-2 text-left">Pessoa</th>
                  <th className="px-3 py-2 text-left">Participação</th>
                  <th className="px-3 py-2 text-left">Presença</th>
                  <th className="px-3 py-2 text-left">Entrega</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr
                    key={entry.userId}
                    onClick={() => setActiveIndex(index)}
                    className={`border-t border-border/60 transition-colors cursor-pointer ${
                      activeIndex === index
                        ? 'bg-primary/5 ring-1 ring-inset ring-primary'
                        : 'hover:bg-muted/30'
                    }`}
                    data-testid={`participant-row-${entry.userId}`}
                    data-active-row={activeIndex === index ? 'true' : 'false'}
                  >
                    {canMessage ? (
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.includes(entry.userId)}
                          onChange={(event) => toggle(entry.userId, event.target.checked)}
                          aria-label={`Selecionar ${entry.name}`}
                          data-testid={`participant-select-${entry.userId}`}
                          className="size-3.5"
                        />
                      </td>
                    ) : null}

                    <td className="px-3 py-2 align-top">
                      <p className="font-medium" data-testid={`participant-name-${entry.userId}`}>
                        {entry.name}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`participant-email-${entry.userId}`}>
                        {entry.emailMasked}
                      </p>
                      <p className="text-xs text-muted-foreground">{entry.originLabel}</p>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {entry.engagement.map((tag) => (
                          <li
                            key={tag}
                            className="rounded-full border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground"
                          >
                            {tag}
                          </li>
                        ))}
                      </ul>
                    </td>

                    <td className="px-3 py-2 align-top text-xs">
                      <p>{entry.events} evento(s)</p>
                      <p className="text-muted-foreground">{entry.confirmed} inscrição(ões) confirmada(s)</p>
                    </td>

                    <td className="px-3 py-2 align-top text-xs">
                      <p data-testid={`participant-rate-${entry.userId}`}>{entry.rateLabel}</p>
                      <p className="text-muted-foreground">
                        {entry.visits} visita(s) · {entry.minutes} min
                      </p>
                    </td>

                    <td className="px-3 py-2 align-top text-xs">
                      <p>{entry.certificates} certificado(s)</p>
                      <p className="text-muted-foreground">
                        {entry.cards} carta(s) · {entry.xp} XP
                      </p>
                    </td>

                    <td className="px-3 py-2 align-top text-right">
                      <AppLink
                        href={`/t/${tenantSlug}/participantes/${entry.userId}`}
                        data-testid={`participant-open-${entry.userId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
                      >
                        <UserRound className="size-3.5" aria-hidden />
                        Abrir ficha
                      </AppLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
