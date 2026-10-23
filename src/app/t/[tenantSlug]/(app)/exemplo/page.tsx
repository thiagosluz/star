import Link from 'next/link';
import { CalendarDays, MapPin, MessageSquare, Ticket, Users } from 'lucide-react';

import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetaItem,
  MetaList,
  PageHeader,
  RarityBadge,
  SectionHeading,
  StatCard,
  Table,
  TableWrapper,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { requirePageMembership } from '@/lib/auth/guard-page';
import { tenantPath } from '@/domain/tenancy/resolution';
import { eventModalityLabel } from '@/domain/events/event-modality-rules';
import {
  DEMO_ACTIVITY_KIND_LABELS,
  DEMO_CALL_STATUS_LABELS,
  DEMO_DEMAND_PRIORITY_LABELS,
  DEMO_EVENT,
  DEMO_EVENT_STATUS_LABELS,
  DEMO_REGISTRATION_STATUS_LABELS,
  demoDateLabel,
  demoDurationLabel,
  demoPeriodLabel,
  demoTimeLabel,
  demoTimeRangeLabel,
} from '@/domain/demo/demo-event';

export const metadata = { title: 'Evento de exemplo' };

/**
 * O render lê sessão e cookie de contexto para a guarda, então a rota não pode
 * ser pré-renderizada como estática: o mesmo caminho responde de forma diferente
 * para quem está logado e para quem não está (o padrão das telas sob `(app)`).
 */
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A TELA DO EVENTO DE EXEMPLO (FASE 77 · fatia 3)
 *  `/t/<tenantSlug>/exemplo`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA É
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma VITRINE DE LEITURA. Os dados vêm de `DEMO_EVENT`, uma fixture imutável do
 *  domínio; a tela não consulta o banco, não recebe dado da instituição e não tem
 *  formulação de escrita. O selo `demo-banner` diz isso com todas as letras,
 *  porque um exemplo convincente demais seria confundido com o evento real — e a
 *  pessoa passaria a procurá-lo na lista, no relatório e na exportação, onde ele
 *  não existe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO HÁ AÇÃO DE ESCRITA (E POR QUE A CATRACA EXISTE)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa cogitada era um "modo demonstração" que criasse o evento de
 *  verdade. Ela foi recusada por medição: 29 das 43 tabelas do dataset não têm
 *  `deletedAt`, o produto não exclui evento, o guarda de atividade recusa apagar
 *  o que tem presença e a quota do tenant demo é 3 eventos. Sem desfazer, criar é
 *  sujar o dado real para sempre.
 *
 *  Esta tela escolhe o caminho oposto: NADA é gravado, então não existe desfazer
 *  a prometer. `tests/unit/f77-demo-de-leitura.test.ts` varre os arquivos do demo
 *  e reprova formulário, submit, banco, action e `fetch` — a garantia não depende
 *  de alguém lembrar da decisão na próxima alteração.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA É VÍNCULO, NÃO PERMISSÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `requirePageMembership` confere sessão + vínculo ATIVO na instituição da URL,
 *  sem exigir papel de organizador. Quem acabou de criar a instituição (o caso da
 *  entrada pelo estado vazio) e o participante comum entram; quem não tem vínculo
 *  cai no mesmo destino da casca (`/login` ou `/selecionar-instituicao`). O
 *  porquê está escrito na guarda.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function DemoEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const { tenantName } = await requirePageMembership({ tenantSlug });

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Evento de exemplo' },
        ]}
        title="Evento de exemplo"
        eyebrow={TENANT_NAV_GROUPS.geral}
        description="Uma amostra com dados fictícios para você ver a forma das telas antes de criar o primeiro evento. Nada aqui é real e nada é gravado."
        badge={
          <Badge tone="warning" withDot>
            Exemplo
          </Badge>
        }
      />

      {/**
       * O SELO. Ele não é um detalhe de rodapé: é a primeira coisa que a pessoa lê
       * depois do título, e diz o que o exemplo NÃO é (um evento da instituição),
       * para onde ele NÃO vai (lista, relatório, exportação, certificado) e o que
       * ele NÃO faz (gravar). `data-testid` prende a presença no render.
       */}
      <Alert
        tone="warning"
        data-testid="demo-banner"
        title="Exemplo com dados fictícios — não é um evento da instituição"
      >
        Este evento não existe e não pertence a {tenantName}. Ele não aparece em nenhuma
        lista, relatório, exportação ou certificado, e esta tela não grava nada: você pode
        navegar à vontade sem alterar o dado da instituição.
      </Alert>

      <section
        className="grid gap-4 sm:grid-cols-3"
        aria-label="Números do evento de exemplo"
        data-testid="demo-numeros"
      >
        <StatCard
          label="Atividades"
          value={DEMO_EVENT.activities.length}
          hint="uma palestra e uma oficina"
          icon={<CalendarDays className="size-4" aria-hidden />}
        />
        <StatCard
          label="Inscrições"
          value={DEMO_EVENT.registrationCount}
          hint="uma delas aparece como amostra"
          icon={<Users className="size-4" aria-hidden />}
        />
        <StatCard
          label="Presenças"
          value={DEMO_EVENT.attendanceCount}
          hint="registradas no dia do evento"
          icon={<Ticket className="size-4" aria-hidden />}
        />
      </section>

      {/* ── O evento ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3" aria-label="O evento de exemplo" data-testid="demo-evento">
        <SectionHeading
          title="O evento"
          description="Título, período, local e situação — o bloco que abre qualquer evento no painel."
        />

        <Card>
          <CardHeader>
            <div className="min-w-0 space-y-1">
              <CardTitle>{DEMO_EVENT.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{DEMO_EVENT.summary}</p>
            </div>
            <Badge tone="success" withDot>
              {DEMO_EVENT_STATUS_LABELS[DEMO_EVENT.status]}
            </Badge>
          </CardHeader>

          <CardContent className="space-y-5">
            <MetaList>
              <MetaItem label="Quando" icon={<CalendarDays className="size-4" aria-hidden />}>
                {demoPeriodLabel(DEMO_EVENT.startsAt, DEMO_EVENT.endsAt)}
              </MetaItem>
              <MetaItem label="Onde" icon={<MapPin className="size-4" aria-hidden />}>
                {DEMO_EVENT.venueName} · {DEMO_EVENT.city}/{DEMO_EVENT.state}
              </MetaItem>
              <MetaItem label="Modalidade">
                {eventModalityLabel(DEMO_EVENT.modality)}
              </MetaItem>
              <MetaItem label="Categoria">{DEMO_EVENT.categoryLabel}</MetaItem>
              <MetaItem label="Vagas">{DEMO_EVENT.capacity} pessoas</MetaItem>
              <MetaItem label="Fuso horário">{DEMO_EVENT.timezone}</MetaItem>
            </MetaList>

            <p className="text-sm text-foreground">{DEMO_EVENT.description}</p>
          </CardContent>
        </Card>
      </section>

      {/* ── Programação ──────────────────────────────────────────────────────── */}
      <section
        className="space-y-3"
        aria-label="Programação do evento de exemplo"
        data-testid="demo-programacao"
      >
        <SectionHeading
          title="Programação"
          description="Duas atividades: a palestra de abertura e a oficina da tarde."
        />

        <Card elevated={false} className="overflow-hidden">
          <TableWrapper>
            <Table aria-label="Atividades do evento de exemplo">
              <THead>
                <TR>
                  <TH>Horário</TH>
                  <TH>Atividade</TH>
                  <TH>Sala</TH>
                  <TH>Ministrante</TH>
                  <TH className="text-right">Vagas</TH>
                </TR>
              </THead>
              <TBody>
                {DEMO_EVENT.activities.map((activity) => (
                  <TR key={activity.id}>
                    <TD className="code-data whitespace-nowrap">
                      {demoTimeRangeLabel(activity.startsAt, activity.endsAt)}
                    </TD>
                    <TD>
                      <span className="font-medium">{activity.title}</span>
                      <Badge tone="info" size="sm" className="ml-2">
                        {DEMO_ACTIVITY_KIND_LABELS[activity.kind]}
                      </Badge>
                    </TD>
                    <TD>{activity.room}</TD>
                    <TD>{activity.speaker}</TD>
                    <TD numeric>
                      {activity.registered}/{activity.capacity}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      </section>

      {/* ── Chamada de propostas ─────────────────────────────────────────────── */}
      <section
        className="space-y-3"
        aria-label="Chamada de propostas do evento de exemplo"
        data-testid="demo-chamada"
      >
        <SectionHeading
          title="Chamada de propostas"
          description="A janela, o tipo e o que a proposta recebe — o mesmo bloco que a chamada real mostra."
        />

        <Card>
          <CardHeader>
            <div className="min-w-0 space-y-1">
              <CardTitle>{DEMO_EVENT.call.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{DEMO_EVENT.call.description}</p>
            </div>
            <Badge tone="info" withDot>
              {DEMO_CALL_STATUS_LABELS[DEMO_EVENT.call.status]}
            </Badge>
          </CardHeader>

          <CardContent>
            <MetaList>
              <MetaItem label="Tipo">{DEMO_EVENT.call.kindLabel}</MetaItem>
              <MetaItem label="Janela">
                {demoDateLabel(DEMO_EVENT.call.opensAt)} até{' '}
                {demoDateLabel(DEMO_EVENT.call.closesAt)}
              </MetaItem>
              <MetaItem label="Avaliação">{DEMO_EVENT.call.reviewLabel}</MetaItem>
              <MetaItem label="Propostas recebidas">
                {DEMO_EVENT.call.proposalsReceived}
              </MetaItem>
            </MetaList>
          </CardContent>
        </Card>
      </section>

      {/* ── Inscrição ────────────────────────────────────────────────────────── */}
      <section
        className="space-y-3"
        aria-label="Inscrição de exemplo"
        data-testid="demo-inscricao"
      >
        <SectionHeading
          title="Inscrição"
          description="Uma inscrição de amostra, com a situação e a origem que a lista real mostra."
        />

        <Card elevated={false} className="overflow-hidden">
          <TableWrapper>
            <Table aria-label="Inscrição do evento de exemplo">
              <THead>
                <TR>
                  <TH>Pessoa</TH>
                  <TH>Situação</TH>
                  <TH>Origem</TH>
                  <TH>Modalidade</TH>
                  <TH>Data</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD className="font-medium">{DEMO_EVENT.registration.personName}</TD>
                  <TD>
                    <Badge tone="success" withDot>
                      {DEMO_REGISTRATION_STATUS_LABELS[DEMO_EVENT.registration.status]}
                    </Badge>
                  </TD>
                  <TD>{DEMO_EVENT.registration.originLabel}</TD>
                  <TD>{DEMO_EVENT.registration.ticketLabel}</TD>
                  <TD className="code-data whitespace-nowrap">
                    {demoDateLabel(DEMO_EVENT.registration.registeredAt)}
                  </TD>
                </TR>
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      </section>

      {/* ── Presença ─────────────────────────────────────────────────────────── */}
      <section
        className="space-y-3"
        aria-label="Presença de exemplo"
        data-testid="demo-presenca"
      >
        <SectionHeading
          title="Presença"
          description="A presença é da pessoa NA atividade, com entrada, saída e minutos apurados."
        />

        <Card elevated={false} className="overflow-hidden">
          <TableWrapper>
            <Table aria-label="Presença do evento de exemplo">
              <THead>
                <TR>
                  <TH>Pessoa</TH>
                  <TH>Atividade</TH>
                  <TH>Contexto</TH>
                  <TH>Entrada</TH>
                  <TH>Saída</TH>
                  <TH className="text-right">Tempo</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD className="font-medium">{DEMO_EVENT.attendance.personName}</TD>
                  <TD>{DEMO_EVENT.attendance.activityTitle}</TD>
                  <TD>{DEMO_EVENT.attendance.contextLabel}</TD>
                  <TD className="code-data">{demoTimeLabel(DEMO_EVENT.attendance.checkedInAt)}</TD>
                  <TD className="code-data">{demoTimeLabel(DEMO_EVENT.attendance.checkedOutAt)}</TD>
                  <TD numeric>{demoDurationLabel(DEMO_EVENT.attendance.minutes)}</TD>
                </TR>
              </TBody>
            </Table>
          </TableWrapper>
        </Card>
      </section>

      {/* ── Carta ────────────────────────────────────────────────────────────── */}
      <section className="space-y-3" aria-label="Carta de exemplo" data-testid="demo-carta">
        <SectionHeading
          title="Carta conquistada"
          description="A recompensa aparece com raridade, motivo e data — o mesmo cartão que o álbum mostra."
        />

        <Card>
          <CardHeader>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{DEMO_EVENT.card.name}</CardTitle>
                <RarityBadge rarity={DEMO_EVENT.card.rarity} />
              </div>
              <p className="text-sm text-muted-foreground">{DEMO_EVENT.card.description}</p>
            </div>
          </CardHeader>

          <CardContent>
            <MetaList>
              <MetaItem label="Motivo">{DEMO_EVENT.card.reason}</MetaItem>
              <MetaItem label="Conquistada em">{demoDateLabel(DEMO_EVENT.card.earnedAt)}</MetaItem>
            </MetaList>
          </CardContent>
        </Card>
      </section>

      {/* ── Demanda interna ──────────────────────────────────────────────────── */}
      <section
        className="space-y-3"
        aria-label="Demanda interna de exemplo"
        data-testid="demo-demanda"
      >
        <SectionHeading
          title="Demanda da equipe"
          description="O trabalho interno do evento também tem forma: coluna, responsável, prazo e conversa."
        />

        <Card>
          <CardHeader>
            <div className="min-w-0 space-y-1">
              <CardTitle>{DEMO_EVENT.demand.title}</CardTitle>
              <p className="text-sm text-muted-foreground">{DEMO_EVENT.demand.description}</p>
            </div>
            <Badge tone="warning" withDot>
              {DEMO_EVENT.demand.column}
            </Badge>
          </CardHeader>

          <CardContent>
            <MetaList>
              <MetaItem label="Equipe">{DEMO_EVENT.demand.team}</MetaItem>
              <MetaItem label="Responsável">{DEMO_EVENT.demand.assignee}</MetaItem>
              <MetaItem label="Prazo">{demoDateLabel(DEMO_EVENT.demand.dueAt)}</MetaItem>
              <MetaItem label="Prioridade">
                {DEMO_DEMAND_PRIORITY_LABELS[DEMO_EVENT.demand.priority]}
              </MetaItem>
              <MetaItem
                label="Conversa"
                icon={<MessageSquare className="size-4" aria-hidden />}
              >
                {DEMO_EVENT.demand.comments} comentários
              </MetaItem>
            </MetaList>
          </CardContent>
        </Card>
      </section>

      {/**
       * O pé da tela só NAVEGA — e só para telas reais de LEITURA. Não existe
       * botão, formulário ou action: o caminho de volta é um link, como em
       * qualquer página, e o convite para começar de verdade aponta para a lista
       * de eventos da instituição.
       */}
      <section aria-label="Onde continuar" className="space-y-3">
        <Card elevated={false} className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">
            Este exemplo é uma tela fixa: nenhum botão grava, nenhum formulário envia e
            nenhuma informação sua ou da instituição é usada. Para começar de verdade, crie
            um evento na lista da instituição.
          </p>
          <p className="flex flex-wrap items-center gap-4 text-sm font-medium">
            <Link
              href={tenantPath(tenantSlug, '/eventos')}
              data-testid="demo-real-events-link"
              className="text-brand underline underline-offset-4"
            >
              Ver os eventos reais da instituição
            </Link>
            <Link
              href={tenantPath(tenantSlug, '/dashboard')}
              className="text-muted-foreground underline underline-offset-4"
            >
              Voltar ao painel
            </Link>
          </p>
        </Card>
      </section>
    </main>
  );
}
