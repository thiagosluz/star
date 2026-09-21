'use client';

import { useState } from 'react';
import { BadgeCheck, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';

import {
  reproduceFromPool,
  type RafflePoolEntry,
} from '@/domain/raffles/draw-selection';
import { prepareWebRandomInt } from '@/domain/raffles/web-seeded-random';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONFERÊNCIA NO NAVEGADOR (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONTA RODA AQUI, SE O SERVIDOR JÁ DISSE "CONFERE"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O veredito do servidor é conveniência: quem audita não deveria precisar confiar
 *  em quem organizou. Este componente refaz, no navegador de quem lê, as TRÊS
 *  contas que sustentam o resultado:
 *
 *    1. `sha256(semente revelada)` == compromisso publicado na criação;
 *    2. `sha256(documento da lista)` == hash da lista assinado no resultado;
 *    3. a lista publicada + a semente reproduzem os MESMOS ganhadores, na mesma
 *       ordem.
 *
 *  A seleção vem do módulo compartilhado (`draw-selection`), o mesmo que o servidor
 *  usa — o que muda é só o gerador (WebCrypto aqui, `node:crypto` lá). A prova
 *  continua valendo fora daqui: a página publica o comando para refazer tudo com
 *  `node` ou `sha256sum`, sem passar por este site.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface AuditCheck {
  ok: boolean;
  label: string;
  detail: string;
}

export interface AuditReproductionPosition {
  position: number;
  expectedCode: string | null;
  reproducedCode: string | null;
  reason: string;
}

export interface RaffleAuditModel {
  /**
   * Rodada conferida (FASE 30). Uma instância deste painel vive por RODADA — cada
   * momento tem a própria semente —, e o número entra nos `data-testid` para que
   * dois painéis na mesma página não sejam confundidos por quem testa.
   */
  roundNumber: number;
  seedCommitment: string | null;
  seedRevealed: string | null;
  poolHash: string | null;
  poolDocument: string | null;
  pool: RafflePoolEntry[] | null;
  winnersCount: number;
  alternatesCount: number;
  weightByMinutes: boolean;
  storedWinners: { position: number; code: string | null }[];
  serverReproduction: {
    possible: boolean;
    reason: string | null;
    confirmed: boolean;
    matched: number;
    diverged: number;
    positions: AuditReproductionPosition[];
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Selo de conferência: verde quando confere, vermelho quando não, cinza sem dado. */
function CheckBadge({ check }: { check: AuditCheck | null }) {
  if (!check) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <RefreshCw className="size-3.5 animate-spin" aria-hidden />
        conferindo neste navegador…
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        check.ok ? 'text-success-strong' : 'text-destructive'
      }`}
      data-ok={check.ok ? 'true' : 'false'}
    >
      {check.ok ? (
        <BadgeCheck className="size-3.5" aria-hidden />
      ) : (
        <ShieldAlert className="size-3.5" aria-hidden />
      )}
      {check.label}
    </span>
  );
}

export function RaffleAuditPanel({ model }: { model: RaffleAuditModel }) {
  const [seedCheck, setSeedCheck] = useState<AuditCheck | null>(null);
  const [poolCheck, setPoolCheck] = useState<AuditCheck | null>(null);
  const [local, setLocal] = useState<AuditReproductionPosition[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Os `data-testid` são por RODADA: a página de auditoria mostra um painel por
   * momento, e um seletor sem o número casaria com vários elementos (foi o que o
   * E2E da FASE 30 pegou ao apurar duas rodadas).
   */
  const testId = (name: string): string => `${name}-${model.roundNumber}`;

  const runChecks = async () => {
    setError(null);
    setRunning(true);

    try {
      if (model.seedRevealed && model.seedCommitment) {
        const digest = await sha256Hex(model.seedRevealed);

        setSeedCheck({
          ok: digest === model.seedCommitment,
          label: digest === model.seedCommitment ? 'confere' : 'NÃO confere',
          detail: digest,
        });
      }

      if (model.poolDocument && model.poolHash) {
        const digest = await sha256Hex(model.poolDocument);

        setPoolCheck({
          ok: digest === model.poolHash,
          label: digest === model.poolHash ? 'confere' : 'NÃO confere',
          detail: digest,
        });
      }

      if (model.pool && model.seedRevealed) {
        const count = Math.min(model.pool.length, model.winnersCount + model.alternatesCount);
        const randomInt = await prepareWebRandomInt(model.seedRevealed);

        const reproduced = reproduceFromPool({
          pool: model.pool,
          count,
          weightByMinutes: model.weightByMinutes,
          randomInt,
        });

        const positions: AuditReproductionPosition[] = [];
        const size = Math.max(reproduced.length, model.storedWinners.length);

        for (let index = 0; index < size; index += 1) {
          const expected = model.storedWinners[index]?.code ?? null;
          const got = reproduced[index]?.code ?? null;

          positions.push({
            // A posição vem do resultado GRAVADO: as rodadas continuam a numeração
            // (a rodada 2 não recomeça em "1º"), e é assim que o balcão entrega.
            position: model.storedWinners[index]?.position ?? index + 1,
            expectedCode: expected,
            reproducedCode: got,
            reason:
              expected === got
                ? 'CONFIRMED'
                : expected === null
                  ? 'MISSING_STORED'
                  : got === null
                    ? 'MISSING_REPRODUCED'
                    : 'DIFFERENT_CODE',
          });
        }

        setLocal(positions);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível conferir neste navegador.');
    } finally {
      setRunning(false);
    }
  };

  const localConfirmed =
    local !== null && local.length > 0 && local.every((entry) => entry.reason === 'CONFIRMED');

  return (
    <section className="space-y-4" data-testid={testId('audit-checks')}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void runChecks()}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          data-testid={testId('audit-run-checks')}
        >
          <ShieldCheck className="size-4" aria-hidden />
          {running ? 'Conferindo…' : 'Conferir neste navegador'}
        </button>

        <span className="text-xs text-muted-foreground">
          As contas abaixo rodam no SEU navegador, com WebCrypto — não são a palavra do servidor.
        </span>
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert" data-testid={testId('audit-browser-error')}>
          {error}
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 rounded-lg border border-border bg-card p-3" data-testid={testId('audit-seed-check')}>
          <dt className="text-xs font-medium">1. A semente revelada é a comprometida?</dt>
          <dd className="space-y-1">
            <CheckBadge check={model.seedCommitment && model.seedRevealed ? seedCheck : null} />
            {seedCheck ? (
              <p className="break-all code-data text-xs text-muted-foreground">
                sha256(semente) = {seedCheck.detail}
              </p>
            ) : null}
          </dd>
        </div>

        <div className="space-y-1 rounded-lg border border-border bg-card p-3" data-testid={testId('audit-pool-check')}>
          <dt className="text-xs font-medium">2. A lista publicada é a lista assinada?</dt>
          <dd className="space-y-1">
            <CheckBadge check={model.poolDocument && model.poolHash ? poolCheck : null} />
            {poolCheck ? (
              <p className="break-all code-data text-xs text-muted-foreground">
                sha256(lista) = {poolCheck.detail}
              </p>
            ) : null}
          </dd>
        </div>
      </dl>

      <div className="space-y-2 rounded-lg border border-border bg-card p-3" data-testid={testId('audit-reproduction')}>
        <p className="text-xs font-medium">3. A lista e a semente produzem estes ganhadores?</p>

        {model.serverReproduction.possible ? (
          <>
            <p
              className={`text-xs ${model.serverReproduction.confirmed ? 'text-success-strong' : 'text-destructive'}`}
              data-testid={testId('audit-server-verdict')}
              data-confirmed={model.serverReproduction.confirmed ? 'true' : 'false'}
            >
              No servidor: {model.serverReproduction.matched} posição(ões) conferida(s)
              {model.serverReproduction.diverged > 0
                ? `, ${model.serverReproduction.diverged} divergente(s)`
                : ' e nenhuma divergência'}
              .
            </p>

            {local ? (
              <p
                className={`text-xs ${localConfirmed ? 'text-success-strong' : 'text-destructive'}`}
                data-testid={testId('audit-browser-verdict')}
                data-confirmed={localConfirmed ? 'true' : 'false'}
              >
                Neste navegador:{' '}
                {localConfirmed
                  ? `as ${local.length} posições saem exatamente iguais.`
                  : `divergência em ${local.filter((entry) => entry.reason !== 'CONFIRMED').length} posição(ões).`}
              </p>
            ) : null}

            <ol className="space-y-1" data-testid={testId('audit-positions')}>
              {(local ?? model.serverReproduction.positions).map((entry) => (
                <li key={entry.position} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="code-data text-muted-foreground">{entry.position}º</span>
                  <span className="code-data">{entry.expectedCode ?? '—'}</span>
                  <span
                    className={entry.reason === 'CONFIRMED' ? 'text-success-strong' : 'text-destructive'}
                    data-position-status={entry.reason}
                  >
                    {entry.reason === 'CONFIRMED' ? 'confere' : 'diverge'}
                  </span>
                  {entry.reason !== 'CONFIRMED' ? (
                    <span className="code-data text-muted-foreground">
                      (reproduzido: {entry.reproducedCode ?? '—'})
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid={testId('audit-reproduction-unavailable')}>
            {model.serverReproduction.reason ?? 'Não é possível reproduzir este sorteio.'}
          </p>
        )}
      </div>
    </section>
  );
}
