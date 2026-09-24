/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O QR QUE A ORGANIZAÇÃO E O PATROCINADOR IMPRIMEM (FASE 42)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QR NASCE NO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A imagem é gerada aqui, no servidor — como o QR do certificado, o da folha de
 *  crachás e o do palco do sorteio. Um serviço externo de QR faria o endereço do
 *  evento (e o código do estande) sair para terceiros, e o estande é justamente
 *  onde a organização não controla a rede.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ENDEREÇO É ABSOLUTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem aponta a câmera NÃO tem a página aberta para completar o caminho: um QR
 *  com `/t/ufba-demo/patrocinio/ABC12345` não abre nada. A URL absoluta vem de
 *  `publicBaseUrl()` — a mesma função do certificado e do telão, para que os três
 *  não apontem para hosts diferentes (armadilha 55).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM PODE IMPORTAR ISTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Só o servidor: página (Server Component) e rota de API. O pacote `qrcode`
 *  carrega um gerador inteiro, e importá-lo de um componente cliente jogaria esse
 *  peso no navegador de quem só queria ver a lista de contatos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import QRCode from 'qrcode';

import { tenantPath } from '@/domain/tenancy/resolution';
import { publicBaseUrl } from '@/lib/public-url';

/** Caminho interno da página pública de leitura do QR. */
export function sponsorQrPath(tenantSlug: string, code: string): string {
  return tenantPath(tenantSlug, `/patrocinio/${code.trim().toUpperCase()}`);
}

/**
 * Endereço ABSOLUTO — o que vai dentro da imagem.
 *
 * O código é normalizado em maiúsculas porque é impresso e ditado no balcão: o
 * domínio aceita as duas formas, e o QR nunca deve carregar uma que a etiqueta não
 * mostra.
 */
export function sponsorQrUrl(tenantSlug: string, code: string): string {
  return `${publicBaseUrl()}${sponsorQrPath(tenantSlug, code)}`;
}

/**
 * Largura da imagem embutida na tela (px). 240 é o tamanho de exibição em telas
 * densas: menor que isso o leitor de um celular antigo começa a errar o estande.
 */
export const SPONSOR_QR_IMAGE_WIDTH = 240;

/**
 * Largura do arquivo baixado: a organização imprime o QR em cartaz e em adesivo de
 * balcão, e um PNG de 240 px ampliado sai serrilhado. 1024 px é o menor tamanho que
 * aguenta uma folha A4 sem borrar as bordas dos módulos.
 */
export const SPONSOR_QR_FILE_WIDTH = 1024;

export const SPONSOR_QR_FORMATS = ['png', 'svg'] as const;

export type SponsorQrFormat = (typeof SPONSOR_QR_FORMATS)[number];

export function isSponsorQrFormat(value: string | null | undefined): value is SponsorQrFormat {
  return value === 'png' || value === 'svg';
}

export interface SponsorQrSheet {
  /** Caminho interno, para link e para a trilha. */
  path: string;
  /** Endereço absoluto que a imagem carrega. */
  url: string;
  /** A imagem pronta para o `<img>` — PNG em data URL, sem requisição extra. */
  dataUrl: string;
}

/**
 * A imagem que a TELA mostra.
 *
 * Nível de correção `M` (o mesmo do certificado): o QR fica atrás de um vidro, num
 * estande com luz ruim, e às vezes amassado — `L` deixaria o código grande demais
 * para o mesmo espaço, e `M` é o equilíbrio que o projeto já usa.
 */
export async function sponsorQrSheet(input: {
  tenantSlug: string;
  code: string;
  width?: number;
}): Promise<SponsorQrSheet> {
  const path = sponsorQrPath(input.tenantSlug, input.code);
  const url = `${publicBaseUrl()}${path}`;

  return {
    path,
    url,
    dataUrl: await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: input.width ?? SPONSOR_QR_IMAGE_WIDTH,
    }),
  };
}

export interface SponsorQrFile {
  body: Buffer | string;
  contentType: string;
  fileName: string;
}

/**
 * O arquivo que a organização baixa e leva para a gráfica (ou imprime na hora).
 *
 * PNG para quem vai colar no documento, SVG para quem vai ampliar sem perder
 * qualidade — o vetor é o formato certo para cartaz, e o PNG é o que abre em
 * qualquer lugar. Os dois saem da MESMA URL, então não há como divergirem.
 */
export async function sponsorQrFile(input: {
  tenantSlug: string;
  code: string;
  format: SponsorQrFormat;
  width?: number;
}): Promise<SponsorQrFile> {
  const url = sponsorQrUrl(input.tenantSlug, input.code);
  const fileName = `qr-${input.code.trim().toUpperCase()}.${input.format}`;

  if (input.format === 'svg') {
    return {
      body: await QRCode.toString(url, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        width: input.width ?? SPONSOR_QR_FILE_WIDTH,
      }),
      contentType: 'image/svg+xml; charset=utf-8',
      fileName,
    };
  }

  return {
    body: await QRCode.toBuffer(url, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: input.width ?? SPONSOR_QR_FILE_WIDTH,
    }),
    contentType: 'image/png',
    fileName,
  };
}
