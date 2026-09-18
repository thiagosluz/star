import { Trophy } from 'lucide-react';

import { Section } from '@/components/events/theme-scope';
import type { PublicRaffleResult } from '@/lib/raffles/raffle-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RESULTADO PÚBLICO DOS SORTEIOS (FASE 16, item G5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A SEÇÃO EXISTE, E POR QUE ELA NÃO É UM BLOCO DA LANDING PAGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O resultado vivia só no painel: quem estava no evento não tinha onde conferir, e
 *  a instituição não tinha onde apontar. Aqui ele aparece na página do evento —
 *  apenas quando a instituição marcou o sorteio como publicado (opt-in explícito).
 *
 *  Não é um bloco da landing page porque o editor visual de blocos ainda não existe
 *  (dívida E3): exigir que o organizador "componha" a seção seria exigir uma tela
 *  que não há. Quando o editor chegar, isto vira um bloco — o conteúdo já está
 *  pronto e é o mesmo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME SAI MASCARADO POR PADRÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `Ana Souza` vira `Ana S.` para quem não tem perfil público: quem se credenciou não
 *  consentiu com publicação de nome na internet. Junto do nome vai a PROVA (hash do
 *  resultado, compromisso e semente) — publicar só o nome transformaria o sorteio em
 *  promessa, e promessa não se confere.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function RaffleResults({ results }: { results: readonly PublicRaffleResult[] }) {
  if (results.length === 0) return null;

  return (
    <Section>
      <div className="space-y-6" data-testid="public-raffle-results">
        <header className="space-y-2">
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Trophy className="size-5" aria-hidden />
            Resultados dos sorteios
          </h2>
          <p className="text-sm opacity-75">
            Apuração por presença real, com gerador verificável: o compromisso da semente foi
            publicado antes do sorteio e a semente revelada depois. Qualquer pessoa pode conferir.
          </p>
        </header>

        <ul className="space-y-5">
          {results.map((raffle) => (
            <li
              key={raffle.id}
              data-testid={`public-raffle-${raffle.id}`}
              className="space-y-3 rounded-xl border p-5"
              style={{
                borderColor: 'color-mix(in oklab, var(--ef-text) 14%, transparent)',
                background: 'color-mix(in oklab, var(--ef-surface) 92%, transparent)',
              }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-semibold">{raffle.title}</h3>
                <span className="text-xs opacity-70">
                  {raffle.drawnAt.toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </span>
              </div>

              {raffle.description ? (
                <p className="text-sm opacity-75">{raffle.description}</p>
              ) : null}

              <ol className="grid gap-2 sm:grid-cols-2">
                {raffle.winners.map((winner) => (
                  <li
                    key={`${raffle.id}-${winner.position}`}
                    data-testid={`public-winner-${winner.position}`}
                    data-masked={winner.masked ? 'true' : 'false'}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                    style={{ borderColor: 'color-mix(in oklab, var(--ef-text) 12%, transparent)' }}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                      style={{ background: 'color-mix(in oklab, var(--ef-primary) 18%, transparent)' }}
                    >
                      {winner.position}º
                    </span>
                    <span className="truncate text-sm font-medium">{winner.name}</span>
                  </li>
                ))}
              </ol>

              {raffle.alternates.length > 0 ? (
                <details className="text-xs opacity-80">
                  <summary className="cursor-pointer">
                    {raffle.alternates.length} suplente(s) — entregam em caso de ausência
                  </summary>
                  <ol className="mt-2 space-y-1" data-testid={`public-alternates-${raffle.id}`}>
                    {raffle.alternates.map((alternate) => (
                      <li key={`${raffle.id}-alt-${alternate.position}`}>
                        {alternate.position}º {alternate.name}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}

              <div className="space-y-0.5 text-xs opacity-60">
                {raffle.resultHash ? (
                  <p className="break-all code-data">resultado (SHA-256): {raffle.resultHash}</p>
                ) : null}
                {raffle.seedCommitment ? (
                  <p className="break-all code-data">
                    compromisso: {raffle.seedCommitment}
                    {raffle.seedRevealed ? ` · semente: ${raffle.seedRevealed}` : ''}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
