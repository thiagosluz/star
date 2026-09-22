import { NextResponse } from 'next/server';
import { headers } from 'next/headers';

import { guardAction } from '@/lib/auth/guard-action';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { exportParticipantsCsv } from '@/lib/participants/participant-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EXPORTAÇÃO DO DIRETÓRIO EM CSV (FASE 32)
 *  `GET /api/t/<slug>/participantes/exportar?busca=&evento=&certificado=1`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA, E NÃO UMA SERVER ACTION
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Exportar é DOWNLOAD: o navegador precisa receber um arquivo com nome e tipo, não
 *  um estado de formulário. Montar o CSV no cliente duplicaria a regra de escape —
 *  e é justamente o escape (aspas, ponto e vírgula, FÓRMULA) que precisa ser um só
 *  (`csvCell`, no domínio).
 *
 *  O `Content-Disposition: attachment` é deliberado: o arquivo BAIXA. Um CSV aberto
 *  na aba, servido como `text/csv`, é renderizado pelo navegador como texto — e o
 *  que a instituição quer é a planilha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ROTA É DO MESMO NÍVEL DA TELA (`/participantes/...`), E O EVENTO VEM NA QUERY
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Pela armadilha 69: o Next não aceita dois nomes de segmento dinâmico no mesmo
 *  nível, e já existe `/api/t/[tenantSlug]/eventos/[eventSlug]/...`.
 *
 *  A autorização é `participant:read` no escopo da INSTITUIÇÃO — a mesma da tela; o
 *  acesso fica na trilha (`AuditAction.EXPORT`, dentro do serviço) com autor, filtros
 *  e número de linhas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);

  const auth = await guardAction({
    tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_READ,
  });

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.state.code, message: auth.state.message },
      { status: 403 },
    );
  }

  const headerList = await headers();
  const result = await exportParticipantsCsv({
    tenantId: auth.tenantId,
    actorId: auth.userId,
    filters: {
      query: url.searchParams.get('busca')?.trim() || undefined,
      eventId: url.searchParams.get('evento')?.trim() || undefined,
      onlyWithCertificate: url.searchParams.get('certificado') === '1',
      onlyAttended: url.searchParams.get('presente') === '1',
    },
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: headerList.get('user-agent'),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status: 400 },
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const fileName = `participantes-${tenantSlug}-${stamp}.csv`;

  return new Response(result.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
