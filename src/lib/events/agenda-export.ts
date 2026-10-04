/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — EXPORTAÇÃO DA AGENDA (FASE 65 · fatia 3)
 *
 *  Este arquivo responde DUAS perguntas, e nada mais:
 *
 *      1. QUAL é o endereço que o calendário do sistema vai abrir? (o token opaco)
 *      2. QUAIS itens o arquivo leva? (a leitura dos fatos, sob RLS)
 *
 *  A FORMA do arquivo não mora aqui: ela é do `src/lib/calendar/ics.ts` (fatia 1),
 *  que já tem teste contra os casos do RFC 5545. Duplicar escape, dobra ou selo UTC
 *  neste arquivo criaria duas versões do mesmo formato — e a que ficasse para trás
 *  produziria um `.ics` que abre e não mostra nada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CALENDÁRIO DO SISTEMA OBRIGA A UMA ROTA PÚBLICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem baixa o arquivo é o NAVEGADOR, no clique da pessoa — mas quem o reabre, nos
 *  dias seguintes, é o Apple Calendar, o Outlook ou o Thunderbird, que fazem uma
 *  requisição SEM cookie de sessão. Uma rota autenticada por sessão funcionaria no
 *  clique e falharia em toda tentativa seguinte. Então a rota é PÚBLICA e a
 *  credencial é o TOKEN NA URL — a mesma escolha do link da carta (FASE 48) e do QR
 *  do estande (FASE 42).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN É OPACO E DERIVADO — NÃO HÁ `userId` NA URL NEM TABELA NOVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A URL não pode carregar o `userId` (seria um identificador adivinhável e
 *  correlacionável entre instituições) nem um id de evento que sirva para ler a
 *  agenda de outra pessoa. O token é um HMAC-SHA256 sobre `tenantId` + `userId`, com
 *  rótulo próprio derivado de `BETTER_AUTH_SECRET` (o MESMO desenho do selo da carta
 *  e do cofre da semente): 43 caracteres em base64url, sem id dentro e sem nada que
 *  se possa reverter.
 *
 *  Duas consequências, declaradas:
 *
 *    • **não há revogação individual** — o token vale enquanto o vínculo valer.
 *      Desativar a pessoa (`status != ACTIVE`) corta o acesso na hora, porque a
 *      resolução confere o vínculo a cada requisição; mas "gerar um link novo" não
 *      existe, e a alternativa (token aleatório em tabela) exigiria a migração que a
 *      fatia 1 fechou — fica como dívida declarada no documento da fase;
 *    • **trocar `BETTER_AUTH_SECRET` invalida todos os endereços** já entregues. É o
 *      mesmo custo do link da carta e do cofre do sorteio; a diferença é que aqui a
 *      pessoa recupera o endereço sozinha, abrindo a tela de novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RESOLUÇÃO É POR VÍNCULO DA INSTITUIÇÃO — SEM VARREDURA GLOBAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um HMAC não se "desfaz": para achar a pessoa a partir do token é preciso
 *  RECALCULAR o token de cada candidato e comparar. Os candidatos são os vínculos
 *  ATIVOS daquela instituição (`user_tenant_profiles`, que tem `tenantId` e portanto
 *  entra por RLS) — nunca a tabela `user` inteira, que é global. Isso prende a
 *  resolução ao tamanho da casa e, mais importante, faz "não é desta instituição"
 *  responder 404 sem nem chegar a comparar com quem está fora.
 *
 *  A comparação é em TEMPO CONSTANTE (`timingSafeEqual`): comparar com `===`
 *  devolveria, pelo tempo de resposta, quantos caracteres do token estão certos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { isPubliclyVisible } from '@/domain/events/event-rules';
import {
  buildMyAgenda,
  type AgendaActivityStatus,
} from '@/domain/agenda/agenda-rules';
import { buildActivityIcs as buildActivityCalendar, buildScheduleIcs, type CalendarItem } from '@/lib/calendar/ics';

/** Rótulo próprio: vazar a chave da carta não abre a agenda, e vice-versa. */
const TOKEN_LABEL = 'eventflow:agenda-ics:';

/**
 * Mesmo piso do selo da carta e do cofre do sorteio: segredo curto não protege nada.
 * Abaixo dele a rota RECUSA gerar endereço — em vez de entregar um token que qualquer
 * um forjaria.
 */
const MIN_SECRET_LENGTH = 16;

function secret(): string | null {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) return null;

  return value;
}

/**
 * O token opaco de uma pessoa NESTA instituição.
 *
 * `null` quando não há segredo utilizável: o chamador então NÃO mostra o botão de
 * baixar (a tela informa que a exportação está indisponível), em vez de publicar um
 * endereço que não abre.
 */
export function agendaIcsToken(input: { tenantId: string; userId: string }): string | null {
  const key = secret();
  if (!key) return null;
  if (!input.tenantId || !input.userId) return null;

  return createHmac('sha256', `${TOKEN_LABEL}${key}`)
    .update(`${input.tenantId}:${input.userId}`, 'utf8')
    .digest('base64url');
}

/** Comparação em tempo constante — ver o cabeçalho. */
function sameToken(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

/**
 * O `userId` por trás do token, dentro desta instituição — ou `null`.
 *
 * A leitura roda em `withTenant` (RLS + FORCE em `user_tenant_profiles`): uma
 * instituição nunca enxerga os vínculos da outra, e o token de uma pessoa da casa A
 * não resolve na casa B nem com o slug certo na mão.
 */
export async function resolveAgendaIcsUser(input: {
  tenantId: string;
  token: string;
}): Promise<string | null> {
  const token = input.token.trim();
  if (token.length === 0) return null;

  return withTenant(input.tenantId, async (tx) => {
    const vinculos = await tx.userTenantProfile.findMany({
      where: { tenantId: input.tenantId, status: 'ACTIVE', deletedAt: null },
      select: { userId: true },
    });

    for (const vinculo of vinculos) {
      const candidato = agendaIcsToken({ tenantId: input.tenantId, userId: vinculo.userId });

      if (candidato && sameToken(candidato, token)) return vinculo.userId;
    }

    return null;
  });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Endereços e nome de arquivo
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O endereço do `.ics` da GRADE inteira de uma pessoa.
 *
 * Duas coisas vão na URL, e as duas são necessárias: o TOKEN identifica a pessoa e o
 * `evento` diz QUAL grade — a agenda é por evento (como o crachá), e sem ele o arquivo
 * teria de adivinhar entre os eventos em que a pessoa aparece.
 *
 * O token vai na QUERY, e não no caminho: um valor de 43 caracteres no `path` é
 * recortado por clientes de e-mail e por ferramentas que "limpam" a URL, e o arquivo
 * chega truncado — o sintoma é o calendário abrir vazio, sem erro em lugar nenhum.
 */
export function agendaIcsUrl(input: {
  tenantSlug: string;
  token: string;
  eventId: string;
}): string {
  const params = new URLSearchParams({ token: input.token, evento: input.eventId });

  return `/api/t/${input.tenantSlug}/agenda/ics?${params.toString()}`;
}

/**
 * O endereço do `.ics` de UMA atividade.
 *
 * A chave é o ID público da atividade — que já está na programação e em qualquer
 * link compartilhado do evento —, e não um token pessoal: o arquivo de uma atividade
 * é o MESMO para todo mundo e não carrega nada de ninguém. Isso é o que permite que o
 * endereço sobreviva ao compartilhamento (num e-mail para a turma, num QR na porta da
 * sala) sem que ninguém descubra a agenda de outra pessoa.
 */
export function activityIcsUrl(input: { tenantSlug: string; activityId: string }): string {
  return `/api/t/${input.tenantSlug}/agenda/ics?atividade=${encodeURIComponent(input.activityId)}`;
}

/**
 * Nome de arquivo legível, seguro para o cabeçalho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O NOME É SANEADO (E POR QUE ELE VAI DUPLICADO)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O título é do ORGANIZADOR: uma aspa no meio dele fecharia o `filename="..."`
 *  cedo e o resto viraria parâmetro do cabeçalho — injeção de cabeçalho por dado, o
 *  mesmo vetor que o `escapeIcsText` fecha no corpo do arquivo. Então tudo o que não
 *  for letra, número, espaço, hífen ou sublinhado vira hífen, e o resultado é
 *  limitado em tamanho.
 *
 *  O `filename*` (RFC 5987) leva a versão com acento, em UTF-8: é o que faz o
 *  arquivo chegar como "Programação do Congresso" no disco, e não como
 *  "Programa-o-do-Congresso". O `filename` simples fica com a versão sem acento,
 *  para o cliente antigo que só entende o parâmetro antigo.
 */
export function icsFileName(input: { base: string }): {
  ascii: string;
  utf8: string;
} {
  /**
   * O hífen das pontas é REMOVIDO: um título que é só pontuação ("///") viraria "-",
   * e o arquivo chegaria como "-.ics". O `replace` de novo no fim existe porque os
   * hífens das pontas só aparecem DEPOIS da substituição — tirá-los antes não faria
   * nada.
   */
  const limpo = input.base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} _-]+/gu, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 80);

  const comAcento = limpo.length > 0 ? limpo : 'agenda';
  const semAcento = comAcento
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]+/g, '-');

  return { ascii: `${semAcento}.ics`, utf8: `${comAcento}.ics` };
}

/** O valor do `Content-Disposition` — `attachment`, porque isto é um DOWNLOAD. */
export function icsContentDisposition(fileName: { ascii: string; utf8: string }): string {
  return `attachment; filename="${fileName.ascii}"; filename*=UTF-8''${encodeURIComponent(fileName.utf8)}`;
}

/**
 * O item que merece o botão "adicionar ao Google Calendar" na GRADE.
 *
 * "O que eu tenho de fazer em seguida": o primeiro item cujo FIM ainda não passou —
 * inclusive o que está em curso agora (é ele que a pessoa quer no celular). `null`
 * quando a grade inteira já terminou, e aí o botão não aparece: oferecer "adicionar a
 * próxima" quando não há próxima seria um botão que cria um evento no passado.
 *
 * O `if` do fim exclusivo é o MESMO do "acontecendo agora" (terminar agora não é estar
 * em curso); a régua não é recopiada, é a mesma decisão tomada no mesmo formato.
 */
export function nextAgendaItem<T extends { startsAt: Date; endsAt: Date }>(
  entries: readonly T[],
  now: Date,
): T | null {
  const futuros = entries
    .filter((entry) => entry.endsAt.getTime() > now.getTime())
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  return futuros[0] ?? null;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A leitura dos fatos
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O item de calendário MAIS o que a regra da grade precisa saber dele.
 *
 * O `status` e o `type` viajam junto porque quem monta a grade é a regra pura da
 * fatia 1 — e ela decide por eles (rascunho não entra, cancelada entra e não choca).
 * Reconstruir um status "provável" na aplicação faria a grade do arquivo discordar da
 * grade da tela no dia em que um status novo aparecesse.
 */
interface ExportItem extends CalendarItem {
  status: AgendaActivityStatus;
  type: string;
}

/**
 * O evento e as atividades visíveis dele.
 *
 * `null` quando o evento não existe NESTA instituição (a RLS o torna invisível) ou
 * quando ele não é público pela MESMA régua da vitrine (`isPubliclyVisible`): o
 * arquivo não pode ser um caminho de leitura paralelo ao da programação.
 */
async function readEventForExport(input: {
  tx: TxClient;
  tenantId: string;
  eventId: string;
}): Promise<{
  id: string;
  slug: string;
  title: string;
  timezone: string;
  activities: ExportItem[];
} | null> {
  const event = await input.tx.event.findFirst({
    where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
    select: { id: true, slug: true, title: true, timezone: true, status: true },
  });

  if (!event || !isPubliclyVisible(event.status)) return null;

  const activities = await input.tx.activity.findMany({
    where: { eventId: event.id, deletedAt: null, status: { not: 'DRAFT' } },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      type: true,
      status: true,
      startsAt: true,
      endsAt: true,
      room: { select: { name: true } },
    },
  });

  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    timezone: event.timezone,
    activities: activities.map((activity) => ({
      activityId: activity.id,
      title: activity.title,
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      timezone: event.timezone,
      location: activity.room?.name ?? null,
      status: activity.status,
      type: activity.type,
      /**
       * A descrição do organizador vai junto; o gerador acrescenta o horário local.
       * Cortar em 400 caracteres é deliberado: o corpo de um VEVENT não é lugar para
       * a ementa inteira, e um `DESCRIPTION` gigante é dobrado em dezenas de linhas
       * que ninguém lê no celular.
       */
      description: activity.description?.slice(0, 400) ?? null,
    })),
  };
}

export interface AgendaIcsOutcome {
  ok: true;
  ics: string;
  fileName: { ascii: string; utf8: string };
}

export type AgendaIcsErrorCode =
  | 'TOKEN_INVALID'
  | 'ATIVIDADE_NAO_ENCONTRADA'
  | 'EVENTO_NAO_ENCONTRADO'
  | 'INTERNAL';

export type AgendaIcsResult =
  | AgendaIcsOutcome
  | { ok: false; code: AgendaIcsErrorCode; message: string };

/**
 * O `.ics` da GRADE da pessoa.
 *
 * A grade é montada pela MESMA função da tela (`buildMyAgenda`, fatia 1) a partir dos
 * mesmos três fatos — atividades, favoritos e inscrições vivas —, e só então vira
 * arquivo. Recalcular "o que é agenda" aqui faria o `.ics` e a tela divergirem no dia
 * em que a regra mudasse: a pessoa baixaria um arquivo com itens que a tela não mostra.
 *
 * O `userId` NÃO vem de sessão (a rota é pública, aberta pelo calendário do sistema):
 * vem da resolução do token, que já conferiu o vínculo ativo com esta instituição.
 */
export async function exportAgendaIcs(input: {
  tenantId: string;
  userId: string;
  eventId: string;
}): Promise<AgendaIcsResult> {
  try {
    const dados = await withTenant(input.tenantId, async (tx) => {
      const event = await readEventForExport({
        tx,
        tenantId: input.tenantId,
        eventId: input.eventId,
      });

      if (!event) return null;

      const favorites = await tx.activityFavorite.findMany({
        where: { userId: input.userId, activity: { eventId: event.id } },
        select: { activityId: true },
      });

      const registrations = await tx.registration.findMany({
        where: { eventId: event.id, userId: input.userId, deletedAt: null },
        select: { activityId: true, status: true },
      });

      const agenda = buildMyAgenda({
        timezone: event.timezone,
        activities: event.activities.map((activity) => ({
          id: activity.activityId,
          title: activity.title,
          slug: activity.activityId,
          status: activity.status,
          startsAt: activity.startsAt,
          endsAt: activity.endsAt,
          type: activity.type,
          roomName: activity.location ?? null,
          workloadMinutes: Math.max(
            0,
            Math.round((activity.endsAt.getTime() - activity.startsAt.getTime()) / 60_000),
          ),
        })),
        favoriteActivityIds: favorites.map((favorite) => favorite.activityId),
        registrations: registrations.flatMap((row) =>
          row.activityId === null ? [] : [{ activityId: row.activityId, status: row.status }],
        ),
      });

      const porId = new Map(event.activities.map((item) => [item.activityId, item]));

      return {
        event,
        /**
         * Quem decide QUAIS itens entram é a regra (`agenda.entries`); o que se faz
         * aqui é só recuperar o fatos completos (descrição, sala) para o gerador.
         */
        itens: agenda.entries.flatMap((entry) => {
          const item = porId.get(entry.activityId);
          return item ? [item] : [];
        }),
      };
    });

    if (!dados) {
      return {
        ok: false,
        code: 'EVENTO_NAO_ENCONTRADO',
        message: 'Este evento não está disponível para exportação.',
      };
    }

    return {
      ok: true,
      ics: buildScheduleIcs(dados.itens, {
        calendarName: `Minha agenda · ${dados.event.title}`,
      }),
      fileName: icsFileName({ base: `Minha agenda - ${dados.event.title}` }),
    };
  } catch (error) {
    console.error(
      `[agenda] falha ao montar a grade para exportação (evento ${input.eventId}):`,
      error instanceof Error ? error.message : error,
    );

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível gerar o arquivo da agenda agora.',
    };
  }
}

/** O `.ics` de UMA atividade — o mesmo para qualquer pessoa, sem dado de ninguém. */
export async function exportActivityIcs(input: {
  tenantId: string;
  activityId: string;
}): Promise<AgendaIcsResult> {
  try {
    const dados = await withTenant(input.tenantId, async (tx) => {
      const activity = await tx.activity.findFirst({
        where: { id: input.activityId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          status: true,
          event: { select: { id: true, title: true, timezone: true, status: true, deletedAt: true } },
          room: { select: { name: true } },
        },
      });

      if (
        !activity ||
        activity.status === 'DRAFT' ||
        activity.event.deletedAt !== null ||
        !isPubliclyVisible(activity.event.status)
      ) {
        return null;
      }

      const item: CalendarItem = {
        activityId: activity.id,
        title: activity.title,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        timezone: activity.event.timezone,
        location: activity.room?.name ?? null,
        description: activity.description?.slice(0, 400) ?? null,
      };

      return { item, eventTitle: activity.event.title };
    });

    if (!dados) {
      return {
        ok: false,
        code: 'ATIVIDADE_NAO_ENCONTRADA',
        message: 'Atividade não encontrada.',
      };
    }

    return {
      ok: true,
      ics: buildActivityCalendar(dados.item),
      fileName: icsFileName({ base: dados.item.title }),
    };
  } catch (error) {
    console.error(
      `[agenda] falha ao montar o .ics da atividade ${input.activityId}:`,
      error instanceof Error ? error.message : error,
    );

    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível gerar o arquivo da atividade agora.',
    };
  }
}

/** A resposta HTTP do arquivo — cabeçalhos montados em UM lugar só. */
export function icsResponse(result: AgendaIcsOutcome): Response {
  return new Response(result.ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': icsContentDisposition(result.fileName),
      /**
       * `no-store` é decisão, não descuido: o conteúdo depende do VÍNCULO da pessoa,
       * que pode ser desativado a qualquer momento. Guardar em cache (de navegador ou
       * de CDN) manteria a agenda de quem saiu da instituição servível por um tempo
       * que ninguém controla.
       */
      'cache-control': 'no-store',
    },
  });
}
