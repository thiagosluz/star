import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { planEventCertificateZip } from '@/lib/certificates/certificate-service';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { zipFileName, zipWebStream, type ZipEntry } from '@/lib/documents/zip-writer';
import { recordAudit } from '@/lib/admin/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CERTIFICADOS DO EVENTO EM UM ZIP (FASE 36)
 *  `GET /api/t/<slug>/certificados/zip?evento=<eventId>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA, E NÃO UMA SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É download: o navegador precisa receber um arquivo com nome e tipo, não um estado
 *  de formulário. A rota vive no MESMO NÍVEL da tela de certificados
 *  (`/certificados/zip`) com o evento na QUERY — pela armadilha 69, o Next não aceita
 *  dois nomes de segmento dinâmico no mesmo nível, e já existe
 *  `/api/t/[tenantSlug]/eventos/[eventSlug]/...`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A MEMÓRIA NÃO CRESCE COM O EVENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O corpo é um FLUXO: cada PDF é lido do storage e escrito no ZIP enquanto é
 *  enviado. O processo carrega **um** arquivo por vez, e não os 3.000 de um congresso —
 *  é a diferença entre esta rota funcionar e ela derrubar o servidor no dia da entrega
 *  dos certificados. Pela mesma razão, `planEventCertificateZip` devolve só o PLANO
 *  (chave, bucket e nome): os bytes nunca são todos carregados para decidir o lote.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TRILHA REGISTRA O LOTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `AuditAction.EXPORT` com o evento, quantos certificados foram e QUEM baixou.
 *  Documento com dado pessoal saindo em lote é exatamente o fato que a instituição
 *  precisa poder conferir depois (a mesma decisão do CSV da FASE 32). A entrada é
 *  gravada ANTES do primeiro byte pelo motivo de sempre: a trilha registra a
 *  AUTORIZAÇÃO do acesso, e uma queda de rede no meio do download não pode apagar o
 *  fato de que o lote foi liberado.
 *
 *  A autorização é `certificate:issue`: quem emite é quem entrega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);
  const eventId = url.searchParams.get('evento')?.trim();

  if (!eventId) {
    return NextResponse.json(
      { ok: false, code: 'INVALID_INPUT', message: 'Informe o evento.' },
      { status: 400 },
    );
  }

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  });

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.state.code, message: auth.state.message },
      { status: auth.state.code === 'NOT_AUTHENTICATED' ? 401 : 403 },
    );
  }

  const plan = await planEventCertificateZip({ tenantId: auth.tenantId, eventId });

  if (!plan.ok) {
    /**
     * `NOT_STORED` é 409, e não 400: o pedido está certo, o EVENTO é que ainda não
     * tem PDF. A mensagem do serviço já diz qual dos dois casos é (gerando agora ×
     * nenhum certificado emitido), e é ela que a tela mostra.
     */
    const status =
      plan.code === 'NOT_FOUND' ? 404 : plan.code === 'NOT_STORED' ? 409 : 400;

    return NextResponse.json(
      { ok: false, code: plan.code, message: plan.message },
      { status, headers: { 'cache-control': 'no-store' } },
    );
  }

  /**
   * Daqui para baixo o lote é o ramo de SUCESSO. A cópia em `lote` existe para o
   * gerador abaixo: dentro de uma função declarada, o TypeScript não mantém o
   * estreitamento do `plan` (a declaração é hasteada) — e o tipo do ramo de erro não
   * tem `entries`.
   */
  const lote = plan;

  const headerList = await headers();

  await recordAudit({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'EXPORT',
    entityType: 'certificate_batch',
    entityId: eventId,
    changes: {
      evento: { from: null, to: lote.eventTitle },
      certificados: { from: null, to: `${lote.entries.length} arquivo(s)` },
      fora_do_lote: { from: null, to: `${lote.pending} sem PDF` },
    },
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  /**
   * As entradas são produzidas sob demanda, e um objeto que FALHOU é PULADO em vez de
   * derrubar o lote: um PDF ausente no bucket não pode impedir a instituição de baixar
   * os outros 299. O que ficou de fora sai no log e no cabeçalho
   * `x-certificados-fora-do-lote`, porque um ZIP menor sem explicação é o defeito que
   * ninguém consegue diagnosticar depois.
   */
  async function* zipEntries(): AsyncGenerator<ZipEntry> {
    for (const entry of lote.entries) {
      try {
        const content = await getObjectBuffer(entry.bucket, entry.storageKey);

        yield { name: entry.fileName, content };
      } catch (error) {
        console.error(
          `[certificates] certificado ${entry.certificateId} ficou fora do lote: ${
            error instanceof Error ? error.message : 'erro desconhecido'
          }`,
        );
      }
    }
  }

  return new Response(zipWebStream(zipEntries()), {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${zipFileName(lote.eventSlug, new Date())}"`,
      /** O lote é montado na hora; nada pode ser cacheado no caminho. */
      'cache-control': 'no-store',
      'x-certificados-fora-do-lote': String(lote.pending),
    },
  });
}
