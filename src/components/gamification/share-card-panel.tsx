'use client';

import { useActionState, useEffect, useState } from 'react';
import { Check, Clock, Link2, Share2, Trash2 } from 'lucide-react';

import {
  DEFAULT_SHARE_VALIDITY,
  SHARE_CHANNELS,
  SHARE_CHANNEL_LABELS,
  SHARE_VALIDITY_CHOICES,
  shareIntent,
  type ShareChannel,
} from '@/domain/gamification/card-share-rules';
import type { GamificationActionState } from '@/app/actions/gamification-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COMPARTILHAR A CARTA (FASE 48) — com prazo, contagem e histórico (E70 · FASE 51)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM COMPARTILHA É O DONO, E A TELA DIZ O QUE VAI SAIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Antes de o link existir, a tela AVISA o que ele mostra: o nome público (ou o
 *  `@handle`, quando o nome é privado; ou um rótulo neutro, quando não há handle).
 *  Compartilhar sem saber o que aparece é o tipo de surpresa que faz a pessoa
 *  descobrir a exposição pelo grupo de WhatsApp de outra pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LINK PODE SER COPIADO MAIS DE UMA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Por isso o token é SELADO no banco (não só hasheado): fechar a tela e voltar
 *  depois devolve o MESMO endereço, sem invalidar o que já foi enviado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PRAZO NASCE EM "SEM PRAZO" (dívida E70)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `<select>` abre com a primeira opção do domínio — "Sem prazo" —, e o texto ao
 *  lado explica a escolha em vez de deixar a pessoa adivinhar: o link é dela e
 *  deve continuar abrindo até que ELA o revogue. O prazo é a exceção, não o
 *  contrário, e a data escolhida a mão só é usada pela opção "Escolher a data"
 *  (o campo fica sempre visível para a tela funcionar sem JavaScript).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NÚMERO DE ABERTURAS CONTA VISITA, NÃO PESSOA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A mesma carta aberta duas vezes conta duas — e a tela DIZ isso. Um número
 *  solto ao lado de uma carta é lido como "quantas pessoas viram", e a instituição
 *  responderia "quantas vezes esta carta foi vista?" com um dado errado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ShareHistoryItem {
  linkId: string;
  createdAtLabel: string;
  status: string;
  statusLabel: string;
  viewCount: number;
  viewsLabel: string;
}

export interface ShareCardPanelProps {
  tenantSlug: string;
  userCardId: string;
  /** Estado atual do link (vindo do servidor). */
  initialUrl: string | null;
  initialLinkId: string | null;
  initialText: string;
  initialDisplayName: string;
  showsRealName: boolean;
  /** Validade já rotulada ("sem prazo", "expira em 12/03/2027", "expirado"). */
  initialStatusLabel: string | null;
  initialViewCount: number;
  initialLastViewedLabel: string | null;
  /** Histórico de links do dono, do mais novo ao mais antigo. */
  initialHistory: readonly ShareHistoryItem[];
  createAction: (prev: GamificationActionState | null, formData: FormData) => Promise<GamificationActionState>;
  revokeAction: (prev: GamificationActionState | null, formData: FormData) => Promise<GamificationActionState>;
}

function textOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' ? value : fallback;
}

export function ShareCardPanel({
  tenantSlug,
  userCardId,
  initialUrl,
  initialLinkId,
  initialText,
  initialDisplayName,
  showsRealName,
  initialStatusLabel,
  initialViewCount,
  initialLastViewedLabel,
  initialHistory,
  createAction,
  revokeAction,
}: ShareCardPanelProps) {
  const [created, createFormAction, creating] = useActionState(createAction, null);
  const [revoked, revokeFormAction, revoking] = useActionState(revokeAction, null);

  const [copied, setCopied] = useState(false);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A REVOGAÇÃO MANDA, MESMO COM UM `created` ANTIGO NA MÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *  Os dois `useActionState` são independentes: `created` guarda o resultado da
   *  criação e CONTINUA preenchido depois de revogar. Ler `created.data.url`
   *  primeiro mostrava o endereço morto como se estivesse vivo — a pessoa copiava
   *  um link que não abre. O E2E pegou exatamente isto.
   *
   *  O mesmo vale para os NÚMEROS: o estado que veio da criação não pode continuar
   *  descrevendo um link que já foi revogado. Depois de revogar, quem conta a
   *  história é o HISTÓRICO — onde a linha revogada aparece com o que ela viveu.
   */
  const justRevoked = revoked?.ok === true;
  const fresh = !justRevoked && created?.ok === true ? created.data : undefined;

  const url = textOr(fresh?.url, justRevoked ? null : initialUrl);
  const linkId = textOr(fresh?.linkId, justRevoked ? null : initialLinkId);
  const text = textOr(fresh?.shareText, initialText) ?? initialText;
  const displayName = textOr(fresh?.shareDisplayName, initialDisplayName) ?? initialDisplayName;

  const statusLabel = textOr(fresh?.statusLabel, justRevoked ? null : initialStatusLabel);
  const viewCount = typeof fresh?.viewCount === 'number' ? fresh.viewCount : initialViewCount;
  const lastViewedLabel = textOr(fresh?.lastViewedLabel, initialLastViewedLabel);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_500);
    return () => clearTimeout(timer);
  }, [copied]);

  const channelUrl = url ?? '';
  const hasLink = statusLabel !== null;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="share-panel">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Share2 className="size-4" aria-hidden />
          Compartilhar esta carta
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="share-preview-of-name">
          {showsRealName
            ? `O link mostra o seu nome (${displayName}), a carta e a instituição — nada mais.`
            : `Como o seu nome não está público, o link mostra “${displayName}”, a carta e a instituição.`}
        </p>
        <p className="text-xs text-muted-foreground">
          Quem abrir vê apenas esta carta: o seu álbum, o seu XP e o seu perfil continuam privados.
        </p>
      </header>

      {url ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={url}
              className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
              data-testid="share-url"
              aria-label="Endereço público da carta"
            />

            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium"
              data-testid="share-copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                } catch {
                  /** Sem permissão de área de transferência, o campo continua selecionável. */
                  setCopied(false);
                }
              }}
            >
              {copied ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
          </div>

          <ul className="flex flex-wrap gap-2">
            {SHARE_CHANNELS.map((channel: ShareChannel) => (
              <li key={channel}>
                <a
                  href={shareIntent(channel, { url: channelUrl, text })}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium"
                  data-testid={`share-${channel}`}
                >
                  {SHARE_CHANNEL_LABELS[channel]}
                </a>
              </li>
            ))}
          </ul>

          <form action={revokeFormAction} className="flex items-center gap-2">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="linkId" value={linkId ?? ''} />
            <button
              type="submit"
              disabled={revoking || !linkId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-50"
              data-testid="share-revoke"
            >
              <Trash2 className="size-3.5" aria-hidden />
              {revoking ? 'Revogando…' : 'Revogar link'}
            </button>
            <span className="text-xs text-muted-foreground">
              {revoked?.ok
                ? revoked.message
                : 'Revogar corta o acesso imediatamente — quem já recebeu deixa de abrir.'}
            </span>
          </form>
        </div>
      ) : (
        <form action={createFormAction} className="space-y-3">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="userCardId" value={userCardId} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-medium">
              Prazo do link
              <select
                name="validade"
                defaultValue={DEFAULT_SHARE_VALIDITY}
                data-testid="share-validity"
                className="block min-w-48 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              >
                {SHARE_VALIDITY_CHOICES.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-xs font-medium">
              Data (só para “Escolher a data”)
              <input
                type="date"
                name="dia"
                data-testid="share-validity-day"
                className="block rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            data-testid="share-create"
          >
            {creating ? 'Preparando o link…' : 'Criar link público'}
          </button>

          <p className="text-xs text-muted-foreground">
            Sem prazo é o padrão: o link continua abrindo até você revogá-lo. Com prazo, ele para
            sozinho no fim do dia escolhido (no fuso da instituição).
          </p>
        </form>
      )}

      {hasLink ? (
        <dl
          className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-3"
          data-testid="share-metrics"
        >
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Validade</dt>
            <dd className="text-sm font-medium" data-testid="share-status">
              {statusLabel}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Aberturas</dt>
            <dd className="text-sm font-medium" data-testid="share-view-count">
              {viewCount}
            </dd>
            <dd className="text-xs text-muted-foreground">cada visita conta, não cada pessoa</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Última abertura</dt>
            <dd className="text-sm font-medium" data-testid="share-last-view">
              {lastViewedLabel ?? '—'}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Clock className="size-3.5" aria-hidden />
          Histórico de links desta carta
        </h3>

        {initialHistory.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="share-history-empty">
            Nenhum link criado ainda.
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="share-history">
            {initialHistory.map((item) => (
              <li
                key={item.linkId}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                data-testid={`share-history-${item.linkId}`}
                data-status={item.status}
              >
                <span className="text-muted-foreground">
                  Criado em {item.createdAtLabel} · {item.viewsLabel}
                </span>
                <span className="font-medium">{item.statusLabel}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs text-muted-foreground">
          O histórico guarda todos os endereços desta carta, inclusive os que já não abrem: revogado
          foi você quem fechou; expirado é o prazo que venceu.
        </p>
      </div>

      {created && !created.ok ? (
        <p className="text-sm text-destructive" data-testid="share-error">
          {created.message}
        </p>
      ) : null}

      {revoked && !revoked.ok ? (
        <p className="text-sm text-destructive" data-testid="share-revoke-error">
          {revoked.message}
        </p>
      ) : null}
    </section>
  );
}
