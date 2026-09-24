import Link from 'next/link';
import { Download, Printer } from 'lucide-react';

import type { SponsorQrSheet } from '@/lib/sponsors/sponsor-qr-sheet';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O QR DO ESTANDE, PRONTO PARA IMPRIMIR (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A IMAGEM APARECE, E NÃO SÓ O CÓDIGO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A primeira versão desta fase mostrava o endereço e o código em texto — e o
 *  estande ficou sem peça. Quem lê o QR é o CELULAR do participante, e ninguém
 *  digita `PT3K9WQ2` no meio do pavilhão: sem a imagem, o crédito e o contato que a
 *  fase inteira promete só acontecem se alguém gerar o código por fora.
 *
 *  O arquivo (`/api/.../qr/<id>`) é o que vai para a gráfica: PNG para imprimir na
 *  hora, SVG para ampliar sem perder qualidade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É UM COMPONENTE DE SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A imagem chega pronta (`dataUrl` gerada no servidor), então nem a biblioteca de
 *  QR nem o endereço absoluto passam pelo navegador. Este componente é usado nos
 *  DOIS lugares que precisam da peça — o painel da organização e a área do
 *  patrocinador —, e é isto que garante que os dois mostrem a MESMA imagem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SponsorQrShare({
  tenantSlug,
  qrId,
  label,
  isActive,
  sheet,
}: {
  tenantSlug: string;
  qrId: string;
  label: string;
  isActive: boolean;
  sheet: SponsorQrSheet;
}) {
  const downloadBase = `/api/t/${tenantSlug}/patrocinadores/qr/${qrId}`;

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-md border border-border bg-surface-low p-3">
      {/*
        O QR é gerado no servidor e vem como PNG em data URL: nenhuma requisição
        extra e nenhuma chamada a serviço de terceiros com o endereço do evento.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sheet.dataUrl}
        alt={`QR Code de ${label}`}
        width={240}
        height={240}
        className="size-40 shrink-0 rounded-md border border-border bg-surface-lowest p-1"
        data-testid={`qr-image-${qrId}`}
        data-qr-url={sheet.url}
      />

      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-muted-foreground">
          Aponte a câmera do celular para o código. Baixe o arquivo para a gráfica ou imprima no
          tamanho que o estande pedir.
        </p>

        <code className="code-data block break-all text-xs" data-testid={`qr-url-${qrId}`}>
          {sheet.url}
        </code>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={downloadBase}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            data-testid={`qr-download-png-${qrId}`}
          >
            <Download className="size-3.5" aria-hidden />
            Baixar PNG
          </Link>

          <Link
            href={`${downloadBase}?formato=svg`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            data-testid={`qr-download-svg-${qrId}`}
          >
            <Download className="size-3.5" aria-hidden />
            Baixar SVG (vetor, para ampliar)
          </Link>

          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Printer className="size-3.5" aria-hidden />
            imprimir esta página (Ctrl+P) também funciona
          </span>
        </div>

        {!isActive ? (
          <p className="text-xs text-warning-strong">
            Este QR está <strong>desativado</strong>: quem ler não recebe crédito nem vira contato.
            Reative antes de imprimir a peça.
          </p>
        ) : null}
      </div>
    </div>
  );
}
