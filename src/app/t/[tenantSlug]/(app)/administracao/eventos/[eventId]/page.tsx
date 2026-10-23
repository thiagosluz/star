import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Award,
  BadgeCheck,
  Building2,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  DoorOpen,
  ExternalLink,
  FileText,
  GraduationCap,
  Handshake,
  IdCard,
  KeyRound,
  ListChecks,
  Mic,
  Settings2,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import {
  EMPTY_EVENT_AREA_COUNTS,
  eventAreaMetric,
  findEventAreaByTestId,
  groupEventAreas,
  visibleEventAreas,
  type EventAreaGroupView,
} from '@/domain/events/event-areas';
import {
  EVENT_LAUNCH_NOTE,
  EVENT_LAUNCH_STATE_LABEL,
  eventLaunchPath,
} from '@/domain/events/event-launch-path';
import { getEventAreaCounts } from '@/lib/events/event-area-counts';
import { eventReadiness } from '@/domain/events/event-readiness';
import { canExportEventData } from '@/domain/exports/export-rules';
import { getDataExport, listRecentDataExports, RECENT_EXPORTS_LIMIT, type ExportRecordView } from '@/lib/exports/export-service';
import { EventExportPanel } from '@/components/exports/event-export-panel';
import { isUuid } from '@/domain/validation/id-rules';
import { tenantPath } from '@/domain/tenancy/resolution';
import { formatEventPeriod } from '@/domain/events/event-rules';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { Badge, Card, CardContent, PageHeader, SectionHeading } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

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
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  /**
   * Opcional porque a página também é renderizada FORA do roteador — o teste de
   * integração da FASE 77 (caminho de partida) chama o componente com `params` só.
   * No Next, `searchParams` sempre chega.
   */
  searchParams?: Promise<{
    /** Exportação recém-criada: a tela volta com o identificador do pedido (FASE 49). */
    exportacao?: string;
    /** Motivo da recusa, quando o pedido não deu certo. */
    erro?: string;
  }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;
  const { exportacao, erro } = (await searchParams) ?? {};

  const { tenantId, principal } = await requirePagePermission({
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
   *
   * O principal vem da GUARDA (FASE 75 · fatia 4): ela já o resolveu para decidir
   * `event:update`, e resolver de novo aqui era a mesma transação de RLS duas vezes
   * por render — sem chance de dar resposta diferente.
   */

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

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  A CHAMADA DE TRABALHOS É OPCIONAL (FASE 68)
   * ─────────────────────────────────────────────────────────────────────────────
   *  Os dois fatos da chamada vêm da ENTIDADE da FASE 33 — chamadas publicadas e
   *  quantas delas não têm prazo —, e não mais do par `cfpOpensAt`/`cfpClosesAt`, que
   *  ninguém escrevia. Era isso que produzia o falso alarme: um evento com a janela
   *  preenchida e ZERO chamadas fazia o painel cobrar uma trilha e mandar o
   *  organizador para uma tela vazia.
   *
   *  O `usesCall` do evento OU a existência de chamada publicada ligam a cobrança: uma
   *  chamada publicada é, por si só, o evento dizendo que recebe trabalhos.
   */
  const usaChamada = event.usesCall || event.calls.published > 0;

  const pendencias = eventReadiness({
    status: event.status,
    activityCount: event.activityCount,
    registrationCount: event.registrationCount,
    trackCount: event.trackCount,
    pendingConfirmations,
    roomsWithoutCapacity: event.rooms.filter((room) => room.capacity === null).length,
    roomCount: event.rooms.length,
    usesCall: usaChamada,
    hasPublishedCall: event.calls.published > 0,
    callWithoutDeadline: event.calls.withoutDeadline > 0,
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

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  O CAMINHO DE PARTIDA (FASE 77 · fatia 1)
   * ═══════════════════════════════════════════════════════════════════════════
   *  Três fatias, os MESMOS fatos que a prontidão e o selo já carregaram: nenhuma
   *  consulta nova. O guia não é o painel — ele responde "por onde começo", e o
   *  painel responde "o que atrapalha agora" —, por isso os dois convivem na mesma
   *  seção sem que um corrija o outro.
   */
  const caminhoDePartida = eventLaunchPath({
    registrationHasDeadline: event.registrationClosesAt !== null,
    activityCount: event.activityCount,
    pagePublished: contagens.pagePublished,
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  A EXPORTAÇÃO DO EVENTO (FASE 77 · fatia 2)
   * ═══════════════════════════════════════════════════════════════════════════
   *  O painel da F49 existia inteiro e não tinha porta na raiz: quem queria os
   *  inscritos de UM evento saía da tela, ia ao diretório e escolhia no `<select>` —
   *  que esconde eventos em `DRAFT`. Aqui o recorte do evento já vem preenchido.
   *
   *  A LEITURA só acontece para quem pode exportar (`participant:read`): a raiz
   *  exige `event:update`, e as duas permissões não vêm juntas. Quem não tem a
   *  segunda não vê o painel e não paga a consulta.
   *
   *  A lista de recentes é filtrada pelo EVENTO (e não a da instituição): uma linha
   *  de "3 linhas · Ana" de outro evento faria o organizador achar que o arquivo
   *  dele já existe.
   */
  const podeExportarDados = canExportEventData(principal);

  let createdExport: ExportRecordView | null = null;
  let exportacoesRecentes: ExportRecordView[] = [];

  if (podeExportarDados) {
    /**
     * `?exportacao=` é consulta, não endereço: id malformado não pode derrubar a
     * tela (a régua da FASE 76) — aqui ele simplesmente não é um pedido.
     *
     * A janela de recentes é maior que a que a tela mostra (`limit: 30`) porque o
     * filtro pelo EVENTO acontece DEPOIS: pedir só as 5 últimas da instituição faria
     * a exportação deste evento sumir da lista assim que cinco outros eventos
     * exportassem. É a mesma janela que a tela de patrocínio usa.
     */
    const [recentesParticipantes, recentesPresencas, pedido] = await Promise.all([
      listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV', limit: 30 }),
      listRecentDataExports({ tenantId, kind: 'ATTENDANCES_CSV', limit: 30 }),
      exportacao && isUuid(exportacao)
        ? getDataExport({ tenantId, exportId: exportacao })
        : Promise.resolve(null),
    ]);

    createdExport = pedido && pedido.eventId === event.id ? pedido : null;
    exportacoesRecentes = [...recentesParticipantes, ...recentesPresencas]
      .filter((registro) => registro.eventId === event.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, RECENT_EXPORTS_LIMIT);
  }

  const painelDeExportacao = (
    <EventExportPanel
      tenantSlug={tenantSlug}
      eventId={event.id}
      principal={principal}
      created={createdExport}
      recent={exportacoesRecentes}
      error={erro ?? null}
    />
  );

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
    formulario: ClipboardList,
    /** A API de leitura do evento (FASE 72): a chave é uma configuração, não um arquivo. */
    api: KeyRound,
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
   *
   *  `extra` é o conteúdo que entra DEPOIS dos cartões do grupo, dentro da mesma
   *  seção — hoje só o painel de exportação em "Operar". Ele não vira um cartão (o
   *  mapa continua com 17) nem uma seção nova: a raiz tem CINCO `<section>` e o
   *  painel entra como um bloco de `div` dentro da quarta.
   *
   *  O parâmetro é OPCIONAL e as chamadas passam uma função explícita: `.map(funcao)`
   *  passaria o ÍNDICE como segundo argumento, e o React renderizaria "0"/"1"/"2"
   *  no meio da página.
   */
  const grupoDeAreas = (grupo: EventAreaGroupView, extra?: ReactNode) => (
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

          {extra}
        </section>
  );

  return (
    <main className="max-w-5xl space-y-8">
      {/**
        * ─────────────────────────────────────────────────────────────────────────
        *  A MESMA RÉGUA DA PÁGINA PÚBLICA (FASE 68 · fatia 4)
        * ─────────────────────────────────────────────────────────────────────────
        *  Aqui havia `toLocaleDateString('pt-BR')` colado dos DOIS lados, e isso
        *  produzia dois defeitos de uma vez: um evento de um dia virava "05/11/2026
        *  a 05/11/2026" (duas vezes a mesma data), e a conversão usava o fuso do
        *  PROCESSO — a família de defeito que já foi consertada duas vezes nesta
        *  casa. `formatEventPeriod` trata o mesmo dia e formata no fuso do EVENTO,
        *  que é o que a programação e a vitrine já usam.
        */}
      <PageHeader
        title={event.title}
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description={
          <>
            {formatEventPeriod(event, event.timezone)} ·{' '}
            {event.registrationCount} inscrição(ões) · {event.activityCount} atividade(s) ·{' '}
            {event.trackCount} trilha(s)
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title },
        ]}
      />

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

        {/**
         * ───────────────────────────────────────────────────────────────────────
         *  O CAMINHO DE PARTIDA (FASE 77 · fatia 1)
         * ───────────────────────────────────────────────────────────────────────
         *  Fica DENTRO da seção de prontidão, acima da lista — não é uma 6ª seção.
         *  A raiz tem 5 `<section>` no DOM e 17 cartões; uma seção nova entre a
         *  prontidão e o mapa empurraria os cartões de Configurar para baixo da
         *  dobra, e o organizador perderia justamente o atalho que o guia promete.
         *
         *  A lista é um `<ol>` de verdade e os números são TEXTO ("1.", "2.", "3."):
         *  leitor de tela anuncia a sequência sem depender de contador de CSS, e a
         *  tela funciona sem JavaScript (são links do servidor).
         */}
        <Card
          elevated={false}
          className="space-y-2 px-4 py-3"
          data-testid="event-launch-path"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-medium text-foreground">Por onde começar</h3>
            <p className="text-xs text-muted-foreground" data-testid="event-launch-path-summary">
              {caminhoDePartida.summary}
            </p>
          </div>

          <p className="text-xs text-muted-foreground">{EVENT_LAUNCH_NOTE}</p>

          <ol className="divide-y divide-border/60">
            {caminhoDePartida.steps.map((step, indice) => {
              const area = findEventAreaByTestId(step.targetTestId);

              const conteudo = (
                <>
                  <span className="font-medium text-foreground">
                    {indice + 1}. {step.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{step.hint}</span>
                  <span className="ml-auto">
                    <Badge
                      tone={step.state === 'DONE' ? 'success' : 'neutral'}
                      size="sm"
                      withDot
                    >
                      {EVENT_LAUNCH_STATE_LABEL[step.state]}
                    </Badge>
                  </span>
                </>
              );

              const classeLinha =
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1 py-1.5 text-sm';

              return (
                <li key={step.id}>
                  {area ? (
                    <Link
                      href={area.href(areaContext)}
                      className={`${classeLinha} hover:bg-surface-high`}
                      data-testid={`event-launch-path-step-${step.id}`}
                    >
                      {conteudo}
                    </Link>
                  ) : (
                    /**
                     * Inalcançável enquanto o catálogo tiver as três áreas (o domínio
                     * derruba a renderização se não tiver), mas o fallback não inventa
                     * link: melhor uma linha sem destino do que um href para lugar
                     * nenhum.
                     */
                    <span className={classeLinha}>{conteudo}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

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
              /**
               * A resolução do alvo é a MESMA do cartão e do caminho de partida
               * (`eventAreaTestId`), e não uma segunda regra escrita aqui: era essa
               * duplicação que deixava uma pendência apontar para um alvo morto.
               */
              const atalho = findEventAreaByTestId(item.targetTestId);
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
      {gruposDeAreas.filter((grupo) => grupo.group === 'CONFIGURAR').map((grupo) => grupoDeAreas(grupo))}




      {/* ── Trilhas ──────────────────────────────────────────────────────── */}

      {/**
       * Os outros três grupos fecham a página: eles são só navegação (cada cartão leva a
       * uma tela), enquanto o que se edita AQUI está no grupo Configurar, acima.
       *
       * O painel de exportação entra no fim de "Operar" — DEPOIS dos quatro cartões do
       * grupo, para o mapa de 17 cartões não se mover: os cartões continuam na mesma
       * ordem e nas mesmas posições, e o bloco novo fica onde a tarefa acontece (a
       * exportação é trabalho do dia do evento, não configuração e nem resultado).
       */}
      {gruposDeAreas
        .filter((grupo) => grupo.group !== 'CONFIGURAR')
        .map((grupo) => grupoDeAreas(grupo, grupo.group === 'OPERAR' ? painelDeExportacao : undefined))}

      {/**
       * O RECONHECIMENTO DO COMITÊ FICA NO RESULTADO, e não em Configurar: ele não
       * configura nada — ele PREMIA. É o ranking de quem mais revisou e a concessão da
       * carta, ou seja, o que fica DEPOIS do trabalho do comitê, junto dos certificados.
       * (O humano apontou isso ao ver a seção no fim do grupo Configurar.)
       */}

    </main>
  );
}
