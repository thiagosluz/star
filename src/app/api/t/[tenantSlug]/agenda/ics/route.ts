import { getTenantContext } from '@/lib/events/event-repository';
import {
  exportActivityIcs,
  exportAgendaIcs,
  icsResponse,
  resolveAgendaIcsUser,
} from '@/lib/events/agenda-export';
import { tenantApiError } from '@/lib/api/tenant-api-error';
import { isUuid } from '@/domain/validation/id-rules';

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
    return tenantApiError(404, 'NOT_FOUND', 'Instituição não encontrada.');
  }

  // ── UMA ATIVIDADE ───────────────────────────────────────────────────────────
  if (atividade.length > 0) {
    /**
     * ─── AQUI O ID NA QUERY É O ENDEREÇO DO ARQUIVO (FASE 76) ──────────────────
     * `?atividade=` escolhe UMA atividade — não é recorte de lista, é o recurso que
     * o arquivo representa. A rota já responde 404 quando a atividade existe e não é
     * visível; um texto sem forma de uuid é a mesma resposta, decidida ANTES de
     * consultar. Sem isto, o serviço engolia o `P2023` num `catch` e a rota devolvia
     * 500 — para um endereço que simplesmente não é um id.
     */
    if (!isUuid(atividade)) {
      return tenantApiError(404, 'ATIVIDADE_NAO_ENCONTRADA', 'Atividade não encontrada.');
    }

    const result = await exportActivityIcs({
      tenantId: tenant.tenantId,
      activityId: atividade,
    });

    if (!result.ok) {
      return tenantApiError(result.code === 'INTERNAL' ? 500 : 404, result.code, result.message);
    }

    return icsResponse(result);
  }

  // ── A MINHA GRADE ───────────────────────────────────────────────────────────
  if (token.length === 0 || evento.length === 0) {
    return tenantApiError(
      400,
      'INVALID_INPUT',
      'Informe o endereço da sua agenda pessoal (token e evento).',
    );
  }

  /**
   * O `evento` também é id na query, e também chegava ao Prisma sem conferência: o
   * `catch` de `exportAgendaIcs` transformava o texto torto em 500 `INTERNAL`. A
   * resposta agora é a MESMA de um evento que existe e não é exportável — 404, com o
   * código que o serviço já usa. O formato é conferido antes de resolver o token
   * porque nenhum token válido torna `nao-e-uuid` um evento.
   */
  if (!isUuid(evento)) {
    return tenantApiError(
      404,
      'EVENTO_NAO_ENCONTRADO',
      'Este evento não está disponível para exportação.',
    );
  }

  const userId = await resolveAgendaIcsUser({ tenantId: tenant.tenantId, token });

  if (!userId) {
    return tenantApiError(
      404,
      'TOKEN_INVALID',
      'Este endereço de agenda não é válido.',
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
    return tenantApiError(result.code === 'INTERNAL' ? 500 : 404, result.code, result.message);
  }

  return icsResponse(result);
}
