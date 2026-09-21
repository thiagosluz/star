'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, MonitorPlay, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LINK DO PALCO E DA AUDITORIA (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O QR CODE FICA NA TELA DE SORTEIOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  No dia do evento ninguém vai digitar um UUID. O organizador abre esta tela, copia
 *  o endereço ou aponta a câmera do computador do telão para o QR — e é o MESMO
 *  endereço que ele testou antes do evento, porque o link existe desde a criação do
 *  sorteio. O QR é gerado no servidor (o projeto já usa `qrcode` nos certificados) e
 *  chega aqui como imagem: nenhuma chamada a serviço externo, nada do endereço
 *  saindo para terceiros.
 *
 *  O aviso do cofre não é decorativo: um telão sem compromisso de semente mostra o
 *  resultado, mas a conferência que ele promete não existe — e é melhor descobrir
 *  isso aqui, com a internet calma, do que no palco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface StageLinkRaffle {
  raffleId: string;
  title: string;
  status: 'DRAFT' | 'DRAWN' | 'CANCELED';
  stagePath: string;
  stageUrl: string;
  auditPath: string;
  auditUrl: string;
  qrDataUrl: string;
  /** Rodada em cartaz no telão: a preparada ou, sem pendente, a última apurada. */
  roundNumber: number | null;
  /** Prêmio anunciado nessa rodada, quando informado (FASE 30). */
  prizeTitle: string | null;
  seedCommitment: string | null;
}

function CopyField({ label, value, testId }: { label: string; value: string; testId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="code-data min-w-0 break-all text-xs" data-testid={`${testId}-value`}>
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          data-testid={`${testId}-copy`}
        >
          <Copy className="size-3.5" aria-hidden />
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<StageLinkRaffle['status'], string> = {
  DRAFT: 'aguardando apuração',
  DRAWN: 'apurado',
  CANCELED: 'cancelado',
};

export function StageLinkPanel({
  raffles,
  vaultConfigured,
}: {
  raffles: readonly StageLinkRaffle[];
  vaultConfigured: boolean;
}) {
  if (raffles.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="stage-links-empty">
        Nenhum sorteio ainda. Crie um sorteio para obter o endereço do palco e da auditoria.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="stage-links">
      {!vaultConfigured ? (
        <p className="rounded-lg border border-border bg-card p-3 text-xs text-warning-strong">
          O cofre de sementes não está configurado neste ambiente: o palco funciona, mas o compromisso
          não existe e a auditoria não poderá reproduzir o resultado.
        </p>
      ) : null}

      <ul className="space-y-4">
        {raffles.map((raffle) => (
          <li
            key={raffle.raffleId}
            className="space-y-3 rounded-lg border border-border bg-card p-4"
            data-testid={`stage-link-${raffle.raffleId}`}
            data-stage-status={raffle.status}
          >
            <header className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-sm font-medium">
                <MonitorPlay className="size-4 text-primary" aria-hidden />
                {raffle.title}
              </p>
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[raffle.status]}</span>
            </header>

            <div className="flex flex-wrap items-start gap-6">
              <div className="min-w-0 flex-1 space-y-3">
                <CopyField
                  label="Endereço do telão (projete esta página no dia do evento)"
                  value={raffle.stageUrl}
                  testId={`stage-url-${raffle.raffleId}`}
                />

                <CopyField
                  label="Endereço da auditoria (para quem quiser conferir as contas)"
                  value={raffle.auditUrl}
                  testId={`audit-url-${raffle.raffleId}`}
                />

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <Link
                    href={raffle.stagePath}
                    target="_blank"
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                    data-testid={`open-stage-${raffle.raffleId}`}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                    Abrir o telão
                  </Link>
                  <Link
                    href={raffle.auditPath}
                    target="_blank"
                    className="inline-flex items-center gap-1 underline underline-offset-4"
                    data-testid={`open-audit-${raffle.raffleId}`}
                  >
                    <ShieldCheck className="size-3" aria-hidden />
                    Abrir a auditoria
                  </Link>
                </div>

                <p className="break-all code-data text-xs text-muted-foreground">
                  {raffle.roundNumber === null
                    ? 'compromisso: sem rodada preparada'
                    : `compromisso da rodada ${raffle.roundNumber}: `}
                  {raffle.roundNumber === null
                    ? ''
                    : (raffle.seedCommitment ?? 'sem compromisso (cofre de sementes não configurado)')}
                </p>
                {raffle.prizeTitle ? (
                  <p className="text-xs text-muted-foreground">
                    prêmio anunciado: <strong className="font-medium">{raffle.prizeTitle}</strong>
                  </p>
                ) : null}
              </div>

              {/**
               * O QR aponta para o TELÃO: é o que a câmera do computador da projeção
               * lê para abrir a página sem ninguém digitar.
               */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={raffle.qrDataUrl}
                alt={`QR Code do telão do sorteio ${raffle.title}`}
                className="size-32 shrink-0 rounded-md border border-border bg-surface-lowest p-1"
                data-testid={`stage-qr-${raffle.raffleId}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
