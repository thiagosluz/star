'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download, Inbox, UserRound } from 'lucide-react';

import { MessageComposer } from '@/components/participants/message-composer';
import type { ParticipantActionState } from '@/app/actions/participant-actions';

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
 *  Diretório de participantes (FASE 32)
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
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ParticipantDirectory({
  entries,
  tenantSlug,
  action,
  exportPath,
  canMessage,
  selectedEventId,
}: {
  entries: readonly DirectoryEntry[];
  tenantSlug: string;
  action: (prev: ParticipantActionState | null, formData: FormData) => Promise<ParticipantActionState>;
  exportPath: string;
  canMessage: boolean;
  selectedEventId: string | null;
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);

  const toggle = (userId: string, checked: boolean): void => {
    setSelected((current) =>
      checked ? [...new Set([...current, userId])] : current.filter((id) => id !== userId),
    );
  };

  const allSelected = entries.length > 0 && entries.every((entry) => selected.includes(entry.userId));

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

          <a
            href={exportPath}
            data-testid="directory-export"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
          >
            <Download className="size-3.5" aria-hidden />
            Exportar CSV
          </a>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="directory-empty">
          Nenhum participante encontrado com estes filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm" data-testid="participant-list">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {canMessage ? <th className="w-8 px-2 py-2" aria-label="Selecionar" /> : null}
                <th className="px-3 py-2 text-left">Pessoa</th>
                <th className="px-3 py-2 text-left">Participação</th>
                <th className="px-3 py-2 text-left">Presença</th>
                <th className="px-3 py-2 text-left">Entrega</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.userId} className="border-t border-border/60" data-testid={`participant-row-${entry.userId}`}>
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
                    <Link
                      href={`/t/${tenantSlug}/participantes/${entry.userId}`}
                      data-testid={`participant-open-${entry.userId}`}
                      className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4"
                    >
                      <UserRound className="size-3.5" aria-hidden />
                      Abrir ficha
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

