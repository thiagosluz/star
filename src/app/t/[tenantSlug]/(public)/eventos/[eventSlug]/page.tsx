import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { buildEventMetadata } from '@/domain/events/landing-page';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listPublicRaffleResults } from '@/lib/raffles/raffle-service';
import { listPublicCalls } from '@/lib/proposals/call-service';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { getMyAgenda } from '@/lib/events/agenda-service';
import { buildEventAgendaView } from '@/lib/events/agenda-view';
import { EventLanding, type EventTab } from '@/components/events/event-landing';
import { agendaIcsUrl, agendaIcsToken } from '@/lib/events/agenda-export';
import { buildHappeningNow, type NowActivityFact } from '@/domain/agenda/now-rules';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';

export const dynamic = 'force-dynamic';

/**
 * A ABA pedida na URL — validada AQUI, e não no componente.
 *
 * Valor desconhecido (`?aba=qualquer-coisa`) cai na programação: a aba é navegação, e
 * uma URL adulterada não pode virar estado inválido na tela. A lista fechada mora no
 * componente (`EventTab`), que é quem desenha os links — deixar a validação lá
 * espalharia a leitura de `searchParams` por dois arquivos.
 */
function parseTab(value: string | undefined): EventTab {
  return value === 'agora' ? 'agora' : 'programacao';
}

/**
 * Esta pessoa opera o balcão de credenciamento deste evento?
 *
 * Os DOIS escopos são aceitos porque a permissão vem em dois formatos reais: a equipe
 * da instituição tem `registration:checkin` no tenant inteiro, e a equipe do DIA recebe
 * o papel por EVENTO (FASE 12/I7). Conferir só o escopo de tenant esconderia o link de
 * quem de fato está na porta — e a tela do balcão, que refaz a checagem, o receberia.
 */
async function canOperateCheckIn(input: {
  userId: string;
  tenantId: string;
  eventId: string;
}): Promise<boolean> {
  const principal = await loadPrincipal(input.userId, input.tenantId, 'ACTIVE');

  return (
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, { scope: 'TENANT' }) ||
    can(principal, PERMISSIONS.REGISTRATION_CHECKIN, {
      scope: 'EVENT',
      eventId: input.eventId,
    })
  );
}

/**
 * Metadados gerados a partir do evento.
 *
 * O organizador pode sobrescrever título e descrição pela página do evento
 * (`EventPage.metaTitle`/`metaDescription`); quando não o faz, montamos uma
 * descrição a partir de resumo, subtítulo, data e local — uma landing page sem
 * descrição perde muito em compartilhamento.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Evento não encontrado' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Evento não encontrado' };

  const meta = buildEventMetadata(event);
  const title = event.page?.metaTitle ?? meta.title;
  const description = event.page?.metaDescription ?? meta.description;

  return {
    title,
    description,
    openGraph: { ...meta.openGraph, title, description },
    alternates: { canonical: tenantPath(tenantSlug, `/eventos/${event.slug}`) },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Landing page pública do evento
 *
 *  Server Component: o HTML sai completo do servidor. Toda a composição vive em
 *  `EventLanding` (FASE 23), porque a PRÉ-VISUALIZAÇÃO do rascunho precisa renderizar
 *  exatamente o mesmo — e a página pública deixou de ser uma tela para ser um dos
 *  dois consumidores do componente.
 *
 *  Quem chega aqui vê a página PUBLICADA; quem está montando vê a mesma coisa em
 *  `/administracao/eventos/<id>/pagina/previa`, com a página atual (mesmo rascunho).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
  searchParams: Promise<{ agenda?: string; 'agenda-erro'?: string; aba?: string }>;
}) {
  const { tenantSlug, eventSlug } = await params;
  const { agenda: marcada, 'agenda-erro': erroDaAcao, aba } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  /**
   * Instante da renderização, resolvido UMA vez e passado adiante.
   *
   * Derivar status, janela de inscrição e contagem regressiva do MESMO instante evita
   * inconsistência (ex.: o selo dizer "inscrições abertas" enquanto a janela já
   * fechou por milissegundos), e mantém os componentes de renderização puros.
   */
  const now = new Date();

  const publicRaffles = await listPublicRaffleResults(tenant.tenantId, event.id);

  /**
   * As chamadas PUBLICADAS (FASE 33). A leitura é do servidor e traz o estado de cada
   * uma já decidido — o bloco da página só desenha, e por isso a chamada encerrada não
   * continua anunciando prazo.
   */
  const calls = await listPublicCalls({ tenantId: tenant.tenantId, eventId: event.id, now });

  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   *  A MINHA AGENDA NESTE EVENTO (FASE 65 · fatia 2)
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE A LEITURA ACONTECE NA PÁGINA, E NÃO DENTRO DO BLOCO
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O bloco da programação é componente de RENDERIZAÇÃO (como `now`): ele não
   *  conhece banco. Aqui a página pergunta uma vez — `getMyAgenda`, a fatia 1 — e
   *  entrega a grade pronta, com as marcas e os horários já no fuso do evento.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O VISITANTE ANÔNIMO NÃO PAGA NADA POR ISSO
   *  ─────────────────────────────────────────────────────────────────────────────
   *  `getAuthenticatedUser` é a variante LEVE (não carrega vínculos nem principal) e
   *  quem não tem sessão nem chega a tocar o banco: a página segue servindo a
   *  programação pública exatamente como antes, sem marca e sem botão.
   *
   *  ─────────────────────────────────────────────────────────────────────────────
   *  O `?agenda=<id>` DA VOLTA
   *  ─────────────────────────────────────────────────────────────────────────────
   *  Sem JavaScript, marcar é um POST que devolve a PÁGINA INTEIRA. O id volta pela
   *  URL (a Server Action o põe lá, junto do `#atividade-<id>` que rola até o cartão)
   *  para o cartão confirmar "Adicionada à sua agenda" — e o `?agenda-erro=` carrega o
   *  motivo quando o serviço recusou, no mesmo caminho, sem depender de estado de
   *  cliente.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  const viewer = await getAuthenticatedUser();

  const minhaAgenda = viewer
    ? await getMyAgenda({
        tenantId: tenant.tenantId,
        userId: viewer.id,
        eventId: event.id,
      })
    : null;

  /**
   * ── O ENDEREÇO DE DOWNLOAD DA GRADE (FASE 65 · fatia 3) ───────────────────────
   *
   *  O token opaco é derivado aqui, com o `userId` da SESSÃO — nunca recebido de
   *  fora. Sem segredo utilizável no servidor (ou sem sessão) o endereço é `null`, e a
   *  tela então NÃO oferece o botão: publicar um endereço que não abre seria pior do
   *  que dizer que a exportação está indisponível.
   */
  const calendarToken = viewer
    ? agendaIcsToken({ tenantId: tenant.tenantId, userId: viewer.id })
    : null;

  const agenda = buildEventAgendaView({
    authenticated: Boolean(viewer),
    agenda: minhaAgenda,
    exportHref:
      calendarToken && event.id
        ? agendaIcsUrl({ tenantSlug, token: calendarToken, eventId: event.id })
        : null,
  });

  /**
   * ── "ACONTECENDO AGORA" (FASE 65 · fatia 4) ───────────────────────────────────
   *
   *  A decisão é do SERVIDOR, com o instante resolvido uma vez (`now`) e o fuso do
   *  EVENTO — o mesmo par que a página já usa para status, janela de inscrição e
   *  contagem regressiva. Recalcular isto no navegador faria a aba mentir para quem
   *  abre a página com o relógio adiantado.
   */
  const happeningNow = buildHappeningNow({
    timezone: event.timezone,
    now,
    activities: event.activities.map(
      (activity): NowActivityFact => ({
        id: activity.id,
        title: activity.title,
        slug: activity.slug,
        status: activity.status,
        startsAt: activity.startsAt,
        endsAt: activity.endsAt,
        roomName: activity.roomName,
        speakerNames: activity.speakerNames,
      }),
    ),
  });

  /**
   * ── QUEM PODE ABRIR O BALCÃO (FASE 65 · fatia 4) ──────────────────────────────
   *
   *  A permissão é conferida AQUI, no servidor, e é a MESMA da tela de credenciamento
   *  (`registration:checkin`, aceitando o escopo de EVENTO — quem opera a porta é a
   *  equipe do dia). `loadPrincipal` só roda para quem tem vínculo ativo: o anônimo
   *  nem chega a tocar o banco.
   *
   *  Isto decide apenas se o LINK aparece; a tela do balcão refaz a checagem por conta
   *  própria. Autorização não é do link.
   */
  const canOperateCounter = viewer
    ? await canOperateCheckIn({ userId: viewer.id, tenantId: tenant.tenantId, eventId: event.id })
    : false;

  return (
    <EventLanding
      event={event}
      tenantSlug={tenantSlug}
      tenantName={tenant.name}
      now={now}
      publicRaffles={publicRaffles}
      publicCalls={calls.ok ? calls.calls : []}
      agenda={agenda}
      justMarkedActivityId={marcada ?? null}
      actionError={erroDaAcao ?? null}
      happeningNow={happeningNow}
      activeTab={parseTab(aba)}
      canOperateCounter={canOperateCounter}
    />
  );
}
