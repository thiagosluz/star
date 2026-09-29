'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';

import { authorizeDataExport } from '@/lib/exports/export-access';
import { createDataExport, exportKindOf, revokeDataExport } from '@/lib/exports/export-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { EXPORT_KINDS } from '@/domain/exports/export-rules';

/**
 * O que a tela mostra quando o PEDIDO não deu certo. Não é o retorno da ação (o painel
 * é componente de servidor e recebe o motivo pela URL) — é o vocabulário do erro.
 */
export interface ExportActionState {
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Server Actions — Exportação de dados pessoais (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PEDIR EXPORTAÇÃO É UM POST; BAIXAR É UM GET
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Exportar deixou de ser um link que baixa o arquivo: passou a ser um PEDIDO, que
 *  cria uma linha em `data_exports` (autor, filtros, prazo). Pedido é escrita, e
 *  escrita é POST — a diferença importa porque um GET que cria registro seria
 *  disparado por pré-carregamento de link e por rastreador, enchendo a trilha de
 *  exportações que ninguém pediu.
 *
 *  Depois de criar, a ação VOLTA para a tela com `?exportacao=<id>`: o painel mostra
 *  o botão de baixar, o prazo e o nº de linhas. Funciona sem JavaScript (é um POST
 *  de formulário seguido de navegação), e o download continua sendo um GET — que é
 *  o que o navegador entende como arquivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const createSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  kind: z.enum(EXPORT_KINDS),
  /** Caminho interno para onde voltar (a própria tela que pediu). */
  returnTo: z.string().trim().min(1).max(300),
  busca: z.string().trim().max(120).optional(),
  evento: z.string().uuid().optional(),
  certificado: z.literal('1').optional(),
  presente: z.literal('1').optional(),
  sponsorId: z.string().uuid().optional(),
});

export async function createExportAction(formData: FormData): Promise<void> {
  const parsed = createSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    kind: formData.get('kind'),
    returnTo: formData.get('returnTo'),
    busca: formData.get('busca') || undefined,
    evento: formData.get('evento') || undefined,
    certificado: formData.get('certificado') || undefined,
    presente: formData.get('presente') || undefined,
    sponsorId: formData.get('sponsorId') || undefined,
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  ERRO VOLTA PELA URL, E NÃO PELO ESTADO DA AÇÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *  O painel é um componente de SERVIDOR: ele não tem `useActionState` para receber
   *  o que a ação devolveu. Então a falha volta como `?erro=<mensagem>` — o mesmo
   *  caminho que o sucesso usa (`?exportacao=<id>`) — e o aviso aparece sem depender
   *  de JavaScript, como todo o resto desta tela.
   */
  if (!parsed.success) {
    redirectWithError(formData, 'Dados inválidos para exportar.');
  }

  const kind = exportKindOf(parsed.data.kind);
  if (!kind) {
    redirectWithError(formData, 'Tipo de exportação desconhecido.');
  }

  const access = await authorizeDataExport({
    tenantSlug: parsed.data.tenantSlug,
    kind,
    sponsorId: parsed.data.sponsorId,
  });

  if (!access.ok) {
    redirectWithError(formData, access.message);
  }

  const requestHeaders = await headers();

  const created = await createDataExport({
    tenantId: access.tenantId,
    actorId: access.userId,
    kind,
    filters: {
      query: parsed.data.busca,
      eventId: parsed.data.evento,
      onlyWithCertificate: parsed.data.certificado === '1',
      onlyAttended: parsed.data.presente === '1',
      sponsorId: parsed.data.sponsorId,
    },
    ipAddress: requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: requestHeaders.get('user-agent'),
  });

  if (!created.ok) {
    redirectWithError(formData, created.message);
  }

  /** Volta para a tela com o identificador do pedido — o painel mostra o download. */
  const destination = safeReturnTo(parsed.data.returnTo, parsed.data.tenantSlug);
  const separator = destination.includes('?') ? '&' : '?';

  revalidatePath(destination);
  redirect(`${destination}${separator}exportacao=${created.exportId}`);
}

const revokeSchema = z.object({
  tenantSlug: z.string().trim().min(1).max(63),
  exportId: z.string().uuid(),
  kind: z.enum(EXPORT_KINDS),
  returnTo: z.string().trim().min(1).max(300),
  sponsorId: z.string().uuid().optional(),
});

export async function revokeExportAction(formData: FormData): Promise<void> {
  const parsed = revokeSchema.safeParse({
    tenantSlug: formData.get('tenantSlug'),
    exportId: formData.get('exportId'),
    kind: formData.get('kind'),
    returnTo: formData.get('returnTo'),
    sponsorId: formData.get('sponsorId') || undefined,
  });

  if (!parsed.success) {
    redirectWithError(formData, 'Dados inválidos para revogar.');
  }

  const kind = exportKindOf(parsed.data.kind);
  if (!kind) {
    redirectWithError(formData, 'Tipo de exportação desconhecido.');
  }

  const access = await authorizeDataExport({
    tenantSlug: parsed.data.tenantSlug,
    kind,
    sponsorId: parsed.data.sponsorId,
  });

  if (!access.ok) {
    redirectWithError(formData, access.message);
  }

  const result = await revokeDataExport({
    tenantId: access.tenantId,
    actorId: access.userId,
    exportId: parsed.data.exportId,
  });

  if (!result.ok) {
    redirectWithError(formData, result.message);
  }

  const destination = safeReturnTo(parsed.data.returnTo, parsed.data.tenantSlug);

  revalidatePath(destination);
  redirect(`${destination}${destination.includes('?') ? '&' : '?'}revogada=${parsed.data.exportId}`);
}

/**
 * Volta para a tela com o motivo da recusa na URL.
 *
 * O `returnTo` é validado pelo MESMO `safeReturnTo` do caminho de sucesso: mensagem
 * de erro não pode virar desculpa para redirecionar para fora da plataforma.
 */
function redirectWithError(formData: FormData, message: string): never {
  const returnTo = String(formData.get('returnTo') ?? '');
  const tenantSlug = String(formData.get('tenantSlug') ?? '');
  const destination = safeReturnTo(returnTo, tenantSlug);
  const separator = destination.includes('?') ? '&' : '?';

  redirect(`${destination}${separator}erro=${encodeURIComponent(message)}`);
}

/**
 * Só caminho INTERNO da própria instituição.
 *
 * `returnTo` chega do formulário, e um formulário é entrada de dado como qualquer
 * outra: sem esta trava, `?returnTo=https://outro.site` faria o redirect sair da
 * plataforma depois de um POST autenticado.
 */
function safeReturnTo(value: string, tenantSlug: string): string {
  const path = value.startsWith('/') ? value : tenantPath(tenantSlug, '/dashboard');
  const fallback = tenantPath(tenantSlug, '/dashboard');

  return path.startsWith(tenantPath(tenantSlug, '/')) ? path : fallback;
}
