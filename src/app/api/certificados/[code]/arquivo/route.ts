import { NextResponse } from 'next/server';

import { getPublicCertificateDownloadUrl } from '@/lib/certificates/certificate-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Download público do certificado pelo código de validação
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ENDPOINT EXISTE (E POR QUE NÃO BASTA A PÁGINA)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PDF vive no storage e é servido por URL ASSINADA e temporária — nenhum bucket
 *  é público, porque certificado contém dado pessoal. Esta rota é a ponte: recebe o
 *  código, confere o estado do documento e redireciona para a URL assinada.
 *
 *  A checagem de revogação acontece AQUI, e não só na página: quem guardou o link
 *  direto do download não pode continuar baixando um documento revogado.
 *
 *  O código é a credencial (está impresso no documento e no QR). Por isso ele é
 *  longo, sem caracteres ambíguos e com entropia criptográfica — e por isso esta
 *  rota não é indexável.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await context.params;

  const result = await getPublicCertificateDownloadUrl(decodeURIComponent(code));

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'INVALID_CODE' ? 400 : 409;

    return NextResponse.json(
      {
        ok: false,
        code: result.code,
        message: result.message,
      },
      {
        status,
        headers: {
          // Documento com dado pessoal não pode ser indexado nem cacheado por proxy.
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
        },
      },
    );
  }

  /**
   * `redirect: 'manual'` mantém o redirecionamento no cliente: o usuário sai desta
   * aplicação direto para o storage, sem o PDF passar pelo processo Node.
   */
  return NextResponse.redirect(result.url, 302);
}
