import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  Award,
  BadgeCheck,
  Building2,
  CalendarRange,
  CheckCircle2,
  DoorOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  Handshake,
  IdCard,
  ListChecks,
  Mic,
  Settings2,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import {
  EVENT_AREAS,
  groupEventAreas,
  visibleEventAreas,
  type EventAreaGroupView,
} from '@/domain/events/event-areas';
import {
  EMPTY_EVENT_AREA_COUNTS,
  eventAreaMetric,
} from '@/domain/events/event-areas';
import { getEventAreaCounts } from '@/lib/events/event-area-counts';
import { eventReadiness } from '@/domain/events/event-readiness';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { Card, CardContent, SectionHeading } from '@/components/ui';

export const metadata = { title: 'Gerenciar evento' };
export const dynamic = 'force-dynamic';



/**
 * Gestão de UM evento: dados, salas, programação e trilhas.
 *
 * Tudo em uma página porque as quatro coisas são decididas JUNTAS na prática:
 * mudar o horário do evento afeta a programação, e criar uma atividade exige saber
 * quais salas existem. Separar em quatro telas obrigaria a navegar para conferir o
 * que já foi configurado.
 */
export default async function AdminEventDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * Quantos pareceres já existem por trilha — é o que decide se a rubrica aparece
   * editável ou congelada. UMA consulta para todas as trilhas, não uma por linha.
   */

  /**
   * Ranking de revisores + permissão de premiar (FASE 16, item F1).
   *
   * A leitura do ranking é do evento; a CONCESSÃO da carta exige `card:grant`. Quem
   * só administra o evento vê o ranking e entende por que o botão não está ali — em
   * vez de clicar e receber um erro.
   */
  const context = await getRequestContext();
  const principal = context?.principal ?? null;


  /**
   * Quantas vagas estão RETIDAS esperando confirmação neste evento (FASE 34).
   *
   * Fica no topo porque é um número com prazo: cada dia sem confirmação é uma vaga
   * que a varredura vai devolver para a lista de espera — e o organizador precisa
   * saber disso ANTES, não depois de a fila se desfazer sozinha.
   */
  const pendingConfirmations = event.activities.reduce(
    (total, activity) => total + activity.pendingConfirmations,
    0,
  );

  /**
   * ───────────────────────────────────────────────────────────────────────────
   *  O PAINEL DE PRONTIDÃO E AS ÁREAS (FASE 53)
   * ───────────────────────────────────────────────────────────────────────────
   *  Os fatos vêm TODOS do que a tela já carregou: nenhuma consulta nova para
   *  dizer o que falta. E a lista de áreas é filtrada pela permissão da pessoa —
   *  o cartão esconde o que a tela por trás dele recusaria.
   */
  const areaContext = { tenantSlug, eventId: event.id, eventSlug: event.slug };

  const pendencias = eventReadiness({
    status: event.status,
    activityCount: event.activityCount,
    registrationCount: event.registrationCount,
    trackCount: event.trackCount,
    pendingConfirmations,
    roomsWithoutCapacity: event.rooms.filter((room) => room.capacity === null).length,
    roomCount: event.rooms.length,
    callWithoutDeadline: event.cfpOpensAt !== null && event.cfpClosesAt === null,
    hasPublishedCall: event.cfpOpensAt !== null,
    registrationHasDeadline: event.registrationClosesAt !== null,
  });

  /**
   * O SELO DE CADA CARTÃO (FASE 54). As contagens vêm de uma leitura só; a fila de
   * confirmações entra do número que ESTA tela já calculou, para não haver duas
   * verdades sobre o mesmo fato. Se a leitura falhar, os cartões saem sem selo.
   */
  const contagensLidas = await getEventAreaCounts({ tenantId, eventId: event.id });
  const contagens = {
    ...(contagensLidas.ok ? contagensLidas.counts : EMPTY_EVENT_AREA_COUNTS),
    pendingConfirmations,
  };

  const gruposDeAreas = groupEventAreas(
    visibleEventAreas({
      allowed: (permission) =>
        can(principal, permission as (typeof PERMISSIONS)[keyof typeof PERMISSIONS], {
          scope: 'TENANT',
        }),
    }),
  );

  /** O ícone de cada área: o domínio não conhece React, então o mapa vive aqui. */
  const AREA_ICONS: Record<string, LucideIcon> = {
    dados: Building2,
    programacao: CalendarRange,
    salas: DoorOpen,
    chamadas: FileText,
    equipes: Users,
    pagina: Settings2,
    patrocinadores: Handshake,
    palestrantes: Mic,
    confirmacoes: BadgeCheck,
    demandas: ListChecks,
    sorteios: Trophy,
    crachas: IdCard,
    certificados: Award,
    reconhecimento: GraduationCap,
    publico: ExternalLink,
  };

  /**
   *  UM grupo de áreas: título, dica e os cartões. Virou função porque a ORDEM na tela
   *  não é mais a ordem dos grupos — as seções que se editam nesta tela (dados, salas,
   *  programação, reconhecimento) entram logo depois do grupo "Configurar", que é o
   *  grupo a que elas pertencem.
   */
  const grupoDeAreas = (grupo: EventAreaGroupView) => (
        <section key={grupo.group} className="space-y-4" aria-labelledby={`areas-${grupo.group}`}>
          <SectionHeading title={grupo.label} description={grupo.hint} />

          <ul className="grid gap-4 sm:grid-cols-2" data-testid={`event-areas-${grupo.group}`}>
            {grupo.areas.map((area) => {
              const Icone = AREA_ICONS[area.id] ?? Settings2;
              const selo = eventAreaMetric(area.id, contagens);

              return (
                <li key={area.id}>
                  <Link
                    href={area.href(areaContext)}
                    data-testid={area.legacyTestId ?? `event-area-${area.id}`}
                    target={area.publicView ? '_blank' : undefined}
                    rel={area.publicView ? 'noreferrer' : undefined}
                    className="block h-full"
                  >
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardContent className="flex gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icone className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium text-foreground">
                            {area.label}
                            {area.publicView ? (
                              <ExternalLink className="ml-1 inline size-3.5 align-[-2px]" aria-hidden />
                            ) : null}
                          </span>
                          <span className="block text-xs text-muted-foreground">{area.purpose}</span>
                          {selo ? (
                            <span className="label-caps block pt-1" data-testid={`event-area-metric-${area.id}`}>
                              {selo}
                            </span>
                          ) : null}
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
  );

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao/eventos')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Eventos
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <p className="text-xs text-muted-foreground">
          {event.startsAt.toLocaleDateString('pt-BR')} a {event.endsAt.toLocaleDateString('pt-BR')} ·{' '}
          {event.registrationCount} inscrição(ões) · {event.activityCount} atividade(s) ·{' '}
          {event.trackCount} trilha(s)
        </p>
      </header>

      {/**
       * ═══════════════════════════════════════════════════════════════════════
       *  O QUE FALTA PARA ESTE EVENTO FICAR PRONTO (FASE 53)
       * ═══════════════════════════════════════════════════════════════════════
       *  A tela mostrava tudo o que EXISTE e nada sobre o que FALTA: quem organiza
       *  pela primeira vez não sabe que sala sem capacidade não limita vaga, nem que
       *  a chamada publicada sem prazo aceita proposta para sempre.
       *
       *  As regras vivem no domínio (`eventReadiness`) e o teste prova cada uma sem
       *  navegador — inclusive que um evento completo sai com a lista VAZIA, porque
       *  o painel precisa saber dizer "está tudo certo".
       */}
      <section className="space-y-4" aria-labelledby="prontidao" data-testid="event-readiness">
        <SectionHeading
          title="O que falta para este evento ficar pronto"
          description="Pendências que atrapalham o fluxo, com o caminho para resolver cada uma."
        />

        {pendencias.length === 0 ? (
          <p
            className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-foreground"
            data-testid="event-readiness-ok"
          >
            <CheckCircle2 className="size-4 shrink-0 text-success-strong" aria-hidden />
            Tudo em ordem: não há pendência que atrapalhe este evento.
          </p>
        ) : (
          <ul className="space-y-2" data-testid="event-readiness-list">
            {pendencias.map((item) => {
              const atalho = EVENT_AREAS.find(
                (area) => (area.legacyTestId ?? `event-area-${area.id}`) === item.targetTestId,
              );
              const bloqueante = item.severity === 'BLOCKING';

              return (
                <li
                  key={item.id}
                  className="flex gap-3 rounded-lg border border-border bg-card px-4 py-3"
                  data-testid={`event-readiness-${item.id}`}
                >
                  <AlertTriangle
                    className={
                      bloqueante
                        ? 'mt-0.5 size-4 shrink-0 text-warning-strong'
                        : 'mt-0.5 size-4 shrink-0 text-muted-foreground'
                    }
                    aria-hidden
                  />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">
                      {atalho ? (
                        <Link href={atalho.href(areaContext)} className="underline underline-offset-4">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/**
       * ═══════════════════════════════════════════════════════════════════════
       *  AS ÁREAS DE GESTÃO, NOS QUATRO GRUPOS DO TRABALHO (FASE 53)
       * ═══════════════════════════════════════════════════════════════════════
       *  Substitui a faixa de links soltos: cada área é um cartão com ícone, o que se
       *  faz ali e — quando existe — a contagem. É o MESMO desenho da tela de
       *  administração da instituição, de propósito: quem aprendeu a ler um já sabe
       *  ler o outro.
       *
       *  Os `data-testid` da faixa antiga estão preservados nos cartões
       *  (`calls-link`, `landing-link`, `confirmations-link`…): os E2E de outras fases
       *  navegam por eles, e mudar aparência não é motivo para quebrar contrato.
       */}
      {/**
       * O grupo Configurar vem PRIMEIRO e sozinho: as seções que se editam nesta tela
       * entram logo abaixo dele (dentro do mesmo grupo), e os outros três grupos fecham
       * a página — antes as seções apareciam soltas no fim, sem pertencer a grupo nenhum.
       */}
      {gruposDeAreas.filter((grupo) => grupo.group === 'CONFIGURAR').map(grupoDeAreas)}




      {/* ── Trilhas ──────────────────────────────────────────────────────── */}

      {/**
       * Os outros três grupos fecham a página: eles são só navegação (cada cartão leva a
       * uma tela), enquanto o que se edita AQUI está no grupo Configurar, acima.
       */}
      {gruposDeAreas.filter((grupo) => grupo.group !== 'CONFIGURAR').map(grupoDeAreas)}

      {/**
       * O RECONHECIMENTO DO COMITÊ FICA NO RESULTADO, e não em Configurar: ele não
       * configura nada — ele PREMIA. É o ranking de quem mais revisou e a concessão da
       * carta, ou seja, o que fica DEPOIS do trabalho do comitê, junto dos certificados.
       * (O humano apontou isso ao ver a seção no fim do grupo Configurar.)
       */}

    </main>
  );
}
