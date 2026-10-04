import { NextResponse } from 'next/server';

import { getTenantContext } from '@/lib/events/event-repository';
import {
  exportActivityIcs,
  exportAgendaIcs,
  icsResponse,
  resolveAgendaIcsUser,
} from '@/lib/events/agenda-export';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ARQUIVO DE CALENDÁRIO (.ics) — FASE 65 · fatia 3
 *
 *  `GET /api/t/<slug>/agenda/ics?token=<opaco>&evento=<eventId>`   → a minha grade
 *  `GET /api/t/<slug>/agenda/ics?atividade=<activityId>`           → uma atividade
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA ROTA É PÚBLICA (E POR QUE ISSO É O CERTO AQUI)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A rota foi desenhada para o CALENDÁRIO DO SISTEMA, não para o navegador com
 *  sessão. Quem a consome dias depois é o Apple Calendar, o Outlook ou o Thunderbird,
 *  e nenhum deles manda cookie — uma rota autenticada por sessão funcionaria no clique
 *  e falharia em toda tentativa seguinte, sem erro visível: o compromisso simplesmente
 *  não apareceria na agenda de ninguém. `webcal://` (assinatura) fica como dívida
 *  declarada; a decisão de "arquivo + Google agora" é do humano.
 *
 *  Então a credencial é o TOKEN NA URL, e ele tem de ser opaco por dois motivos
 *  concretos: um `userId` na query é identificador adivinhável (e correlacionável
 *  entre instituições), e um id de atividade não pode servir para ler a agenda de
 *  outra pessoa. O desenho do token — HMAC derivado de `BETTER_AUTH_SECRET`, com
 *  rótulo próprio, resolvido pelos VÍNCULOS ATIVOS da instituição e comparado em
 *  tempo constante — está documentado em `src/lib/events/agenda-export.ts`, que é o
 *  único lugar onde ele é gerado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA ROTA RECUSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • sem parâmetro nenhum → 400 (não há "agenda de todo mundo");
 *  • token inválido, de outra pessoa ou de outra instituição → **404** (não 403: dizer
 *    "existe, mas não é seu" já contaria que aquele token existe);
 *  • atividade de outra instituição, em rascunho ou de evento não público → 404 (a RLS
 *    torna a linha invisível, e a régua é a MESMA da vitrine);
 *  • sem `BETTER_AUTH_SECRET` utilizável → 503, com uma frase honesta: o servidor não
 *    consegue emitir nem conferir endereços desta natureza.
 *
 *  A resposta é sempre `no-store`, e o conteúdo é gerado na hora — nada de arquivo
 *  guardado, nada de cache de CDN servindo a agenda de quem saiu da instituição.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ tenantSlug: string }> },
): Promise<Response> {
  const { tenantSlug } = await context.params;
  const url = new URL(request.url);

  const token = (url.searchParams.get('token') ?? '').trim();
  const atividade = (url.searchParams.get('atividade') ?? '').trim();
  const evento = (url.searchParams.get('evento') ?? '').trim();

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { ok: false, code: 'NOT_FOUND', message: 'Instituição não encontrada.' },
      { status: 404 },
    );
  }

  // ── UMA ATIVIDADE ───────────────────────────────────────────────────────────
  if (atividade.length > 0) {
    const result = await exportActivityIcs({
      tenantId: tenant.tenantId,
      activityId: atividade,
    });

    if (!result.ok) {
      const status = result.code === 'INTERNAL' ? 500 : 404;

      return NextResponse.json(
        { ok: false, code: result.code, message: result.message },
        { status },
      );
    }

    return icsResponse(result);
  }

  // ── A MINHA GRADE ───────────────────────────────────────────────────────────
  if (token.length === 0 || evento.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Informe o endereço da sua agenda pessoal (token e evento).',
      },
      { status: 400 },
    );
  }

  const userId = await resolveAgendaIcsUser({ tenantId: tenant.tenantId, token });

  if (!userId) {
    return NextResponse.json(
      { ok: false, code: 'TOKEN_INVALID', message: 'Este endereço de agenda não é válido.' },
      { status: 404 },
    );
  }

  /**
   * O evento é conferido DENTRO da exportação (`readEventForExport`), na mesma
   * transação e pela mesma régua da vitrine (`isPubliclyVisible`). Uma checagem a mais
   * aqui seria uma segunda leitura da mesma coisa — e, pior, uma segunda régua: bastava
   * as duas discordarem sobre "evento público" para o arquivo sair de um evento que a
   * programação esconde.
   */
  const result = await exportAgendaIcs({
    tenantId: tenant.tenantId,
    userId,
    eventId: evento,
  });

  if (!result.ok) {
    const status = result.code === 'INTERNAL' ? 500 : 404;

    return NextResponse.json(
      { ok: false, code: result.code, message: result.message },
      { status },
    );
  }

  return icsResponse(result);
}
