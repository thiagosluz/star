import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  CalendarCog,
  ClipboardCheck,
  Clock,
  FileText,
  Handshake,
  LayoutDashboard,
  Mail,
  Mic,
  QrCode,
  Ticket,
  type LucideIcon,
} from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { activeRoles } from '@/domain/rbac/authorization';
import {
  DASHBOARD_BLOCK_META,
  dashboardBlockHref,
  dashboardBlocksFor,
  dashboardHiddenPhrase,
  type DashboardBlockId,
  type DashboardSubject,
} from '@/domain/platform/dashboard-blocks';
import { getAdminOverview } from '@/lib/admin/catalog-service';
import { listCertificates } from '@/lib/certificates/certificate-service';
import {
  listMyRegistrations,
  type MyRegistration,
} from '@/lib/events/registration-read-service';
import { listReviewerTasks } from '@/lib/review/review-service';
import { listMySubmissions } from '@/lib/review/submission-service';
import { listSponsorAccess } from '@/lib/sponsors/sponsor-portal-service';
import { DashboardContextLink } from '@/components/shell/dashboard-context';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { Card, CardContent, EmptyState, PageHeader, StatCard } from '@/components/ui';

export const metadata = { title: 'Painel' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL DA INSTITUIÇÃO — o painel passa a ser de QUEM OLHA (FASE 84 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA ERA, E POR QUE DEIXOU DE SER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 83 o painel era a prova viva do motor de RBAC: "Papéis acumulados
 *  neste contexto" com o UUID de evento e de atividade ao lado de cada papel, a
 *  lista crua de TODAS as permissões efetivas e dois contadores sem filtro de
 *  `deletedAt`. Era ótimo para depurar autorização e péssimo como tela de trabalho:
 *  o dono, o revisor e o participante viam exatamente a mesma lista, e nenhum dos
 *  três conseguia responder à pergunta que faz abrir o sistema de manhã — "o que,
 *  para MIM, importa aqui?".
 *
 *  A prova do RBAC não desapareceu: ela mudou de casa para `/conta` (fatia 1), que
 *  é GLOBAL e por isso é onde os papéis realmente se acumulam — a mesma pessoa pode
 *  ser organizadora de uma instituição e revisora de outra. A seção de lá mostra a
 *  instituição pelo nome, o papel pelo rótulo e um NÚMERO de permissões efetivas,
 *  sem UUID e sem chave crua. A tela que prova o motor é a identidade; o painel
 *  voltou a ser do trabalho.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DIVISÃO DE RESPONSABILIDADE — A PÁGINA NÃO DECIDE NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quais blocos aparecem, em que ordem, quantos cabem e quantos ficaram de fora é
 *  decisão de DOMÍNIO (`dashboardBlocksFor`, `dashboard-blocks.ts`, testada em 46
 *  casos). Esta página faz duas coisas e só: APURA os fatos do sujeito (com as
 *  leituras que ela já paga) e DESENHA o plano que recebeu. Nenhum `if` de perfil
 *  mora aqui — no dia em que um papel novo aparecer, o catálogo do domínio é o
 *  único lugar a mudar, e a matriz perfil × blocos continua provável sem banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CATRACA DAS CONSULTAS — 6 FONTES NO PIOR PERFIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel é a primeira tela que TODO MUNDO abre; por isso o orçamento de leitura
 *  é explícito e medido no relatório da fase. As regras:
 *
 *    • `getRequestContext()` é chamado UMA vez e o `principal` vem dele — a página
 *      NÃO chama `loadPrincipal` (o layout já pagava, e a catraca de integração da
 *      FASE 75 passou a cobrir o painel);
 *    • os vínculos, a sessão e o principal custam ZERO consultas extras nesta
 *      página: `hasPendingInvite` sai de `context.memberships` e `hasSpeakerProfile`,
 *      do papel `SPEAKER` que veio no principal (ver a decisão em `isSpeaker`);
 *    • `hasDeadlineAction` e o bloco `participacao` bebem da MESMA leitura de
 *      inscrições — é por isso que ela acontece antes do plano;
 *    • as leituras de cada bloco só acontecem se o bloco existir no plano, e o
 *      `getAdminOverview` só é lido quando há `gestao` (o perfil de gestão): é ele
 *      que alimenta os contadores, e ele já filtra `deletedAt` — a contagem antiga
 *      (`tx.event.count()` / `tx.activity.count()` sem filtro) incluía evento
 *      excluído e por isso saiu.
 *
 *  O pior perfil (OWNER/ADMIN, que vê cinco blocos) paga SEIS fontes de leitura:
 *  inscrições, certificados, submissões, pareceres, visão geral e vínculo de
 *  patrocinador. O teto é seis. O número por perfil está no relatório da fase.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Um ícone por bloco — decoração da fileira, nunca informação. */
const BLOCK_ICONS: Readonly<Record<DashboardBlockId, LucideIcon>> = {
  'acuacao-prazo': Clock,
  gestao: CalendarCog,
  participacao: Ticket,
  submissoes: FileText,
  pareceres: ClipboardCheck,
  palestrante: Mic,
  patrocinador: Handshake,
  equipe: QrCode,
  convite: Mail,
};

/**
 * A pessoa é PALESTRANTE nesta instituição?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PAPEL, E NÃO A PERMISSÃO (decisão declarada no relatório da fase)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A permissão `speaker:profile:update:own` parecia o atalho óbvio — e é o que o
 *  pedido da fase sugeria. Medido no catálogo: `OWNER` recebe TODAS as permissões
 *  de instituição e `ADMIN`, todas menos três; as duas incluem essa. Usar a
 *  permissão faria TODO dono e TODO administrador verem o cartão "Portal do
 *  palestrante — seu perfil e os materiais das suas atividades" sem ter perfil
 *  nenhum — exatamente o contrário do que a fase quer ("o painel é de quem olha").
 *
 *  O papel `SPEAKER` é concedido no ACEITE/reivindicação do perfil de palestrante
 *  (`speaker-service.ts`, FASE 25), com escopo de ATIVIDADE: ele só existe para
 *  quem tem perfil. É o mesmo fato com uma fonte que não vaza para a gestão, e sem
 *  consulta nenhuma — os papéis já vieram no principal.
 */
function isSpeaker(roles: readonly string[]): boolean {
  return roles.includes('SPEAKER');
}

/** "1 parecer" × "2 pareceres" — o rótulo não fica no formato de máquina. */
function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * A inscrição tem algo com PRAZO esperando a pessoa?
 *
 * Duas coisas contam, e nenhuma delas é o parecer (que tem bloco próprio): a OFERTA
 * de vaga da fila (`promotion`, decisão da pessoa) e a vaga RETIDA devendo
 * confirmação/checklist (`confirmation.state = 'PENDING'`). `EXPIRED` fica de fora
 * de propósito: o prazo já passou e não há mais ação a fazer — anunciar "pendente"
 * ali seria mandar a pessoa clicar num botão que não existe.
 */
function hasPendingDeadline(
  registration: Pick<MyRegistration, 'promotion' | 'confirmation'>,
): boolean {
  return registration.promotion !== null || registration.confirmation?.state === 'PENDING';
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const context = await getRequestContext();

  if (!context?.activeTenant) {
    redirect('/selecionar-instituicao');
  }

  /**
   * O principal veio na resolução do contexto (FASE 75) e a checagem é fail-closed:
   * ele só é nulo quando não há instituição ativa, e o `if` acima já redirecionou.
   * O `if` existe para o tipo ser honesto sem um `!` que esconderia a regra.
   */
  const principal = context.principal;
  if (!principal) {
    redirect('/selecionar-instituicao');
  }

  const tenantId = context.activeTenant.tenantId;
  const tenantName = context.activeTenant.tenantName;
  const roles = activeRoles(principal);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS DUAS LEITURAS QUE O SUJEITO EXIGE — e que o painel paga para TODO perfil
   * ─────────────────────────────────────────────────────────────────────────────
   *  · a lista de inscrições decide `hasDeadlineAction` (e é a MESMA que o bloco de
   *    participação usa; ler duas vezes seria N+1 numa tela que abre todo dia);
   *  · o vínculo de patrocinador é `sponsor_users` ativo, e não `sponsor:read` —
   *    a lição da FASE 59: a permissão está no pacote mínimo de todo mundo, e usá-la
   *    faria o bloco aparecer para revisor e dono, que não patrocinam nada.
   *
   *  O layout também lê `listSponsorAccess` (para o item do menu). São duas leituras
   *  da mesma tabela em camadas diferentes: a casca não pode passar dados para a
   *  página (elas não se falam), e transformar isso em cache de requisição seria um
   *  contrato novo de casca. A duplicata está declarada no relatório da fase.
   */
  const [registrations, sponsorAccess] = await Promise.all([
    listMyRegistrations(tenantId, context.user.id),
    listSponsorAccess(tenantId, context.user.id),
  ]);

  const subject: DashboardSubject = {
    roles,
    hasDeadlineAction: registrations.some(hasPendingDeadline),
    hasSpeakerProfile: isSpeaker(roles),
    hasSponsorLink: sponsorAccess.length > 0,
    /**
     * O convite de EQUIPE é um fato GLOBAL: o vínculo `INVITED` é de outra casa, e a
     * rota `t/<slug>/convite` sem código responde "não encontrado" (o aceite exige o
     * código do e-mail). Por isso o bloco aponta para `/conta`, e o fato é lido dos
     * vínculos que `getRequestContext` já trouxe — sem consulta nova.
     */
    hasPendingInvite: context.memberships.some((membership) => membership.status === 'INVITED'),
  };

  const plan = dashboardBlocksFor(subject);
  const visible = (id: DashboardBlockId) => plan.blocks.includes(id);
  const hiddenPhrase = dashboardHiddenPhrase(plan.hidden);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  AS LEITURAS DOS BLOCOS — só as que o plano pediu
   * ─────────────────────────────────────────────────────────────────────────────
   *  Cada fonte é barata e já existia no produto. O que NÃO entra, de propósito:
   *
   *    · prontidão por evento (12+ leituras) — o painel não abre evento nenhum;
   *    · `getMyAgenda` (exige `eventId`) — a agenda é uma tela, não um bloco;
   *    · `getSponsorPortal` (3+ leituras) — o bloco leva à área, que paga o portal.
   *
   *  `getAdminOverview` é a ÚNICA fonte dos contadores de eventos e atividades: ele
   *  filtra `deletedAt`, e ter uma fonte só impede o painel e a administração de
   *  discordarem sobre o mesmo número.
   */
  const [overview, certificateResult, submissions, reviewerTasks] = await Promise.all([
    visible('gestao') ? getAdminOverview(tenantId) : Promise.resolve(null),
    visible('participacao')
      ? listCertificates({ tenantId, userId: context.user.id, limit: 200 })
      : Promise.resolve(null),
    visible('submissoes') ? listMySubmissions(tenantId, context.user.id) : Promise.resolve(null),
    visible('pareceres') ? listReviewerTasks(tenantId, context.user.id) : Promise.resolve(null),
  ]);

  const deadlineRegistrations = registrations.filter(hasPendingDeadline);
  const pendingReviews = reviewerTasks?.filter((task) => !task.hasReview).length ?? 0;
  const certificateCount =
    certificateResult?.ok === true ? certificateResult.certificates.length : 0;

  /**
   * O FATO de cada bloco — o que a regra não sabe, porque depende do banco.
   *
   * O texto é curto e sempre da mesma forma: uma linha que diz o número. Bloco sem
   * fato (palestrante, equipe, convite) é um atalho puro — inventar um "0" ali seria
   * afirmar um número que ninguém contou.
   */
  const facts = new Map<DashboardBlockId, string>();

  const firstDeadline = deadlineRegistrations[0];

  if (firstDeadline) {
    const deadline =
      firstDeadline.promotion?.deadlineLabel ??
      firstDeadline.confirmation?.deadlineLabel ??
      null;

    facts.set(
      'acuacao-prazo',
      `${plural(deadlineRegistrations.length, 'inscrição com prazo', 'inscrições com prazo')}${
        deadline ? ` — até ${deadline}` : ''
      }`,
    );
  }

  if (visible('gestao') && overview) {
    facts.set('gestao', `${plural(overview.publishedEvents, 'evento no ar', 'eventos no ar')}`);
  }

  if (visible('participacao')) {
    facts.set(
      'participacao',
      `${plural(registrations.length, 'inscrição', 'inscrições')}${
        certificateCount > 0
          ? ` · ${plural(certificateCount, 'certificado', 'certificados')}`
          : ''
      }`,
    );
  }

  if (visible('submissoes') && submissions) {
    facts.set('submissoes', plural(submissions.total, 'submissão', 'submissões'));
  }

  if (visible('pareceres')) {
    facts.set('pareceres', plural(pendingReviews, 'parecer pendente', 'pareceres pendentes'));
  }

  if (visible('patrocinador') && sponsorAccess.length > 0) {
    facts.set(
      'patrocinador',
      `${sponsorAccess.map((access) => access.sponsorName).join(' · ')} — QR do estande`,
    );
  }

  return (
    <main className="max-w-6xl space-y-8">
      {/**
       * ───────────────────────────────────────────────────────────────────────────
       *  O TOPO NÃO MUDOU DE TEXTO — e isso é contrato (FASE 78/81)
       * ───────────────────────────────────────────────────────────────────────────
       *  Título e `eyebrow` são os mesmos de antes: quatro provas os pinam (o par de
       *  E2E do topo único, o `f75-vitrine-logado` e o `f62`). O que entra é o botão
       *  de contexto no slot `actions` — o caminho de SAÍDA ao lado de onde a pessoa
       *  percebe que está na instituição errada.
       */}
      <PageHeader
        title={`Painel de ${tenantName}`}
        eyebrow={TENANT_NAV_GROUPS.geral}
        description="Os atalhos que importam para o seu perfil nesta instituição — e o que está esperando por você."
        actions={<DashboardContextLink tenantName={tenantName} />}
      />

      {/**
       * ───────────────────────────────────────────────────────────────────────────
       *  OS CONTADORES SÓ EXISTEM PARA QUEM GERE — e essa é a resposta certa
       * ───────────────────────────────────────────────────────────────────────────
       *  `stats` é o contrato que o `f62` usa para saber que o painel do perfil de
       *  gestão renderizou (o perfil daquela suíte é OWNER). Para quem não tem o
       *  bloco `gestao`, não há contagem de instituição a mostrar: os números são de
       *  OUTRA pessoa. A seção some inteira em vez de aparecer zerada.
       */}
      {overview ? (
        <section className="grid gap-4 sm:grid-cols-2" data-testid="stats">
          <StatCard
            label="Eventos"
            value={overview.events}
            hint={`${plural(overview.publishedEvents, 'publicado', 'publicados')}`}
            icon={<CalendarCog className="size-4" aria-hidden />}
            tone="primary"
          />
          <StatCard
            label="Atividades"
            value={overview.activities}
            hint="sessões, oficinas e minicursos"
            icon={<ClipboardCheck className="size-4" aria-hidden />}
          />
        </section>
      ) : null}

      {plan.blocks.length > 0 ? (
        <section className="space-y-3" aria-labelledby="atalhos-do-painel">
          <h2 id="atalhos-do-painel" className="text-sm font-medium">
            Atalhos para o seu perfil
          </h2>

          <ul className="grid gap-4 sm:grid-cols-2" data-testid="dashboard-blocks">
            {plan.blocks.map((id) => {
              const meta = DASHBOARD_BLOCK_META[id];
              const Icon = BLOCK_ICONS[id];
              const fact = facts.get(id);

              return (
                <li key={id}>
                  {/**
                   * O cartão inteiro é UM link: o nome acessível é o texto visível
                   * (título + descrição + fato), e não um "clique aqui". É o mesmo
                   * desenho da grade de áreas da administração.
                   */}
                  <Link
                    href={dashboardBlockHref(id, tenantSlug)}
                    data-testid={`dashboard-block-${id}`}
                    className="block h-full"
                  >
                    <Card className="h-full transition-colors hover:border-primary/50">
                      <CardContent className="flex gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-brand">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 space-y-1">
                          <span className="block text-sm font-medium text-foreground">
                            {meta.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {meta.description}
                          </span>
                          {fact ? (
                            <span className="block border-t border-border pt-2 text-xs text-muted-foreground">
                              {fact}
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

          {/**
           * O QUE A TELA ESCONDE, ELA ANUNCIA (F50/F51) — a frase é do DOMÍNIO e diz
           * o número que a REGRA cortou, não uma conta feita de novo aqui. Sem isto,
           * o teto de cinco esconderia atalhos em silêncio.
           */}
          {hiddenPhrase ? (
            <p className="text-xs text-muted-foreground" data-testid="dashboard-hidden">
              …{hiddenPhrase}.
            </p>
          ) : null}
        </section>
      ) : (
        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  O PERFIL SEM BLOCO NÃO É UM ERRO — é um estado que a tela explica
         * ─────────────────────────────────────────────────────────────────────────
         *  `FINANCE` é o caso real: oito permissões (billing, patrocínio, analytics
         *  e leitura de inscrições) e nenhuma tela de financeiro/billing para onde
         *  apontar. Um bloco levaria a lugar nenhum, então o painel diz o que existe
         *  (os acessos em `/conta`) em vez de desenhar um cartão quebrado.
         */
        <EmptyState
          data-testid="dashboard-empty"
          icon={LayoutDashboard}
          title="Nenhum atalho para o seu perfil"
          description={
            <>
              O seu papel nesta instituição não tem atalhos no painel. Os papéis e as
              permissões que valem aqui estão em{' '}
              <Link href="/conta#seus-acessos" className="underline underline-offset-4">
                Minha conta
              </Link>
              . Se isso não estiver certo, fale com a organização.
            </>
          }
        />
      )}
    </main>
  );
}
