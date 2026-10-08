import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, CalendarDays, LogIn, Users } from 'lucide-react';

import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { evaluateRegistrationWindow, formatDuration } from '@/domain/events/event-rules';
import { activityTypeLabel } from '@/domain/events/activity-rules';
import {
  publicRegistrationNotice,
  restrictedEventNotice,
} from '@/domain/events/public-registration-rules';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { findMyEventRegistration } from '@/lib/events/registration-service';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { EventRegistrationForm } from '@/components/events/event-registration-form';
import { EventRegistrationDataForm } from '@/components/events/event-registration-data-form';
import { Section, ThemeScope } from '@/components/events/theme-scope';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Inscrição no evento' };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INSCRIÇÃO NO EVENTO (revisão da FASE 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PÁGINA PRÓPRIA, E NÃO UM BOTÃO NA LANDING
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A inscrição no evento é o que dá acesso à programação aberta: ela merece
 *  endereço estável (para o organizador divulgar e para o crachá apontar), e a
 *  página pode EXPLICAR o que ela inclui — a lista das atividades que entram
 *  automaticamente e a das que continuam exigindo inscrição própria. Um botão na
 *  landing não caberia nessa explicação, e a pessoa descobriria depois.
 *
 *  A decisão de autorização é do SERVIDOR (Server Action); aqui espelhamos o
 *  resultado para não oferecer o que será recusado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventRegistrationPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}) {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  const window = evaluateRegistrationWindow({
    now: new Date(),
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    eventStatus: event.status,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
  });

  const user = await getAuthenticatedUser();

  let membershipStatus: string | null = null;
  let canRegister = false;
  let alreadyRegistered: string | null = null;
  /** A posição na FILA do evento, quando é isso que a pessoa tem (dívida E33). */
  let myWaitlistPosition: number | null = null;
  /**
   * O QUE A INSCRIÇÃO JÁ TEM GRAVADO (FASE 70).
   *
   * A porta "Completar meus dados" mostra estes valores em vez de abrir em branco: uma
   * resposta que existe e não aparece é uma resposta que a pessoa vai redigitar (ou
   * achar que perdeu). O CPF está em dígitos, que é como ele é gravado.
   */
  let myFormResponses: Record<string, unknown> = {};
  let myAccessibilityNotes: string | null = null;

  if (user) {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: user.id },
      select: { status: true, deletedAt: true },
    });
    membershipStatus = membership?.deletedAt ? 'REMOVED' : (membership?.status ?? null);

    if (membershipStatus === 'ACTIVE') {
      const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');
      canRegister = can(principal, PERMISSIONS.REGISTRATION_CREATE, { scope: 'TENANT' });

      const mine = await findMyEventRegistration(tenant.tenantId, user.id, event.id);
      if (mine && mine.status !== 'CANCELED') {
        alreadyRegistered = mine.status;
        myWaitlistPosition = mine.waitlistPosition;
        myFormResponses = mine.formResponses;
        myAccessibilityNotes = mine.accessibilityNotes;
      }
    } else {
      canRegister = membershipStatus !== 'SUSPENDED' && membershipStatus !== 'REMOVED';
    }
  }

  /**
   * A programação é dividida em duas listas, e a diferença NÃO é cosmética: uma
   * diz o que a inscrição já inclui, a outra o que exige um passo a mais.
   */
  const openActivities = event.activities.filter(
    (activity) => !activity.requiresRegistration && activity.status !== 'CANCELED',
  );
  const individualActivities = event.activities.filter(
    (activity) => activity.requiresRegistration && activity.status !== 'CANCELED',
  );

  const eventPageHref = tenantPath(tenantSlug, `/eventos/${eventSlug}`);
  const loginHref = `/login?redirectTo=${encodeURIComponent(
    tenantPath(tenantSlug, `/eventos/${eventSlug}/inscricao`),
  )}`;

  return (
    <ThemeScope theme={event.theme}>
      <main>
        <Section>
          {/**
            * ═══════════════════════════════════════════════════════════════════════════
            *  A PÁGINA DE INSCRIÇÃO ENTROU NO PORTÃO, E O PORTÃO ACHOU O QUE FALTAVA
            *  (FASE 70)
            *
            *  ───────────────────────────────────────────────────────────────────────────
            *  O DEFEITO NÃO ERA DESTA FASE — E SOBREVIVEU PORQUE A TELA NÃO ERA MEDIDA
            *  ───────────────────────────────────────────────────────────────────────────
            *  A FASE 70 pôs esta página no portão WCAG AA (era a única superfície da
            *  inscrição fora dele), e a varredura reprovou **3 violações** que já estavam
            *  aqui desde a FASE 3: 1 nó de `definition-list`, 4 de `dlitem` e **6 nós de
            *  `color-contrast`** — todos em marcação antiga (`dl > div > div > dt/dd` e
            *  `text-xs opacity-60`), nenhum nos campos declarados.
            *
            *  As duas correções são DECISÕES QUE A CASA JÁ TINHA TOMADO, e aplicá-las
            *  aqui não é escolha nova:
            *
            *   • **o `<dl>` que não era uma lista de definições** — a FASE 68 (fatia 5)
            *     achou o MESMO defeito na ficha da ATIVIDADE (`1 nó de definition-list e
            *     10 de dlitem`) e decidiu: o `div` que agrupa o ÍCONE com o rótulo é o
            *     desenho, então a marcação deixa de afirmar "lista de definições" e vira
            *     `div` com rótulo e valor. Esta página ficou de fora daquela correção
            *     porque não estava no portão — é a lição da "catraca que não cobria o
            *     alvo", com nome e número;
            *   • **o `opacity-60`** — a FASE 66 trocou a opacidade (que COMPÕE o texto com
            *     o fundo) pelo papel do tema `.ef-muted`, medido em **5,08:1** no claro e
            *     **5,91:1** no escuro sobre a `--ef-background`. Ela alcançou os nós do
            *     FORMULÁRIO e os dois da programação; os rótulos e os contadores desta
            *     PÁGINA continuaram em `opacity-60` (**4,44:1**) pelo mesmo motivo.
            *
            *  O desenho não muda: mesmos ícones, mesmas duas colunas, mesmo texto.
            * ═══════════════════════════════════════════════════════════════════════════
            */}
          <nav className="mb-6">
            <Link href={eventPageHref} className="ef-muted text-xs underline underline-offset-4">
              ← {event.title}
            </Link>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <header className="space-y-2">
                <p className="ef-muted text-xs uppercase tracking-wide">Inscrição</p>
                <h1 className="text-balance text-3xl font-semibold tracking-tight">
                  Inscreva-se no evento
                </h1>
                <p className="text-sm opacity-80">
                  Uma inscrição só: ela vale para o evento inteiro e já inclui as atividades
                  abertas a todos os participantes. Você não precisa se inscrever em cada
                  palestra da programação.
                </p>
              </header>

              <div
                className="grid gap-3 text-sm sm:grid-cols-2"
                data-testid="event-registration-summary"
              >
                <div className="flex items-center gap-2">
                  <CalendarDays className="ef-muted size-4 shrink-0" aria-hidden />
                  <div>
                    <span className="ef-muted block text-xs">Período</span>
                    <span className="block" data-testid="event-registration-period">
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'long',
                        timeZone: event.timezone,
                      }).format(event.startsAt)}
                      {' – '}
                      {new Intl.DateTimeFormat('pt-BR', {
                        dateStyle: 'long',
                        timeZone: event.timezone,
                      }).format(event.endsAt)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Users className="ef-muted size-4 shrink-0" aria-hidden />
                  <div>
                    <span className="ef-muted block text-xs">Vagas no evento</span>
                    <span className="block">
                      {event.remainingSeats === null
                        ? 'Vagas ilimitadas'
                        : `${event.remainingSeats} restantes`}
                    </span>
                  </div>
                </div>
              </div>

              {openActivities.length > 0 ? (
                <section className="space-y-2" data-testid="open-activities-list">
                  <h2 className="text-base font-semibold tracking-tight">
                    Incluídas automaticamente ({openActivities.length})
                  </h2>
                  <ul className="space-y-1.5 text-sm">
                    {openActivities.map((activity) => (
                      <li key={activity.id} className="flex flex-wrap items-center gap-2">
                        <span className="ef-badge">{activityTypeLabel(activity.type)}</span>
                        <span>{activity.title}</span>
                        <span className="ef-muted text-xs">
                          {formatDuration(activity.workloadMinutes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {individualActivities.length > 0 ? (
                <section className="space-y-2" data-testid="individual-activities-list">
                  <h2 className="text-base font-semibold tracking-tight">
                    Com inscrição própria ({individualActivities.length})
                  </h2>
                  <p className="ef-muted text-sm">
                    Estas têm turma e vagas: depois de se inscrever no evento, escolha as que
                    quiser na programação.
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {individualActivities.map((activity) => (
                      <li key={activity.id} className="flex flex-wrap items-center gap-2">
                        <span className="ef-badge">{activityTypeLabel(activity.type)}</span>
                        <Link
                          href={tenantPath(
                            tenantSlug,
                            `/eventos/${eventSlug}/atividades/${activity.slug}`,
                          )}
                          className="underline underline-offset-4"
                        >
                          {activity.title}
                        </Link>
                        <span className="ef-muted text-xs">
                          {activity.remainingSeats === null
                            ? 'vagas ilimitadas'
                            : `${activity.remainingSeats} vaga(s)`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
              {!window.open && !alreadyRegistered ? (
                <div className="ef-card space-y-2 p-5">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" aria-hidden />
                    Inscrições indisponíveis
                  </p>
                  <p className="text-sm opacity-70">{window.message}</p>
                </div>
              ) : alreadyRegistered ? (
                /**
                 * Já inscrito: a página passa a mostrar o ESTADO, e não o formulário —
                 * inclusive no instante seguinte ao clique, porque a action revalida o
                 * caminho. Por isso ela também LISTA o que a inscrição inclui: é aqui
                 * que a pessoa confere em que foi inscrita automaticamente.
                 */
                <div className="ef-card space-y-3 p-5" data-testid="event-registration-status">
                  {alreadyRegistered === 'WAITLISTED' ? (
                    /**
                     * ── QUEM ESTÁ NA FILA NÃO ESTÁ DENTRO (dívida E33) ───────────────────
                     *  A tela dizia "sua inscrição no evento está ativa" para quem apenas
                     *  ESPERA — e a pessoa sairia dali achando que tinha vaga. O achado foi
                     *  do E2E da fila, no primeiro minuto: a tela era a única peça do
                     *  caminho que ainda tratava fila como inscrição confirmada.
                     */
                    <>
                      <p className="font-medium" data-testid="event-waitlist-status">
                        Você está na lista de espera do evento
                      </p>
                      <p className="text-sm opacity-70">
                        {myWaitlistPosition ? `Sua posição é a ${myWaitlistPosition}ª. ` : ''}
                        Assim que uma vaga for liberada, você é chamado por e-mail e tem{' '}
                        <strong>48 h</strong> para aceitar. Não é preciso se inscrever de novo.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Sua inscrição no evento está ativa</p>
                      <p className="text-sm opacity-70">
                        Você já pode participar das atividades abertas. Os minicursos continuam
                        exigindo inscrição própria, na página de cada um.
                      </p>

                      {openActivities.length > 0 ? (
                        <ul className="space-y-1 text-sm opacity-80" data-testid="enrolled-open-activities">
                          {openActivities.map((activity) => (
                            <li key={activity.id}>· {activity.title}</li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}

                  <Link href={tenantPath(tenantSlug, '/minhas-inscricoes')} className="ef-button-outline w-full">
                    Ver minhas inscrições
                  </Link>

                  {/**
                    * ─────────────────────────────────────────────────────────────────────
                    *  "COMPLETAR MEUS DADOS" (FASE 70)
                    * ─────────────────────────────────────────────────────────────────────
                    *  A inscrição numa ATIVIDADE passou a materializar a linha do EVENTO —
                    *  e ela nasce com as respostas herdadas do formulário da atividade,
                    *  que não tem CPF. Esta é a porta para completar depois, e ela NÃO
                    *  aparece para quem está na FILA: quem espera vaga ainda não tem
                    *  inscrição, e "completar" os dados de uma vaga que não existe
                    *  confundiria as duas coisas.
                    *
                    *  Ela recebe OS MESMOS campos declarados que a tela de inscrição
                    *  (`event.registrationFormFields`, a leitura única do domínio) e as
                    *  respostas que a inscrição JÁ TEM (`mine.formResponses`), para a
                    *  pessoa ver o que respondeu em vez de um formulário em branco. A
                    *  lista vazia é o formulário de sempre: sem campos declarados, o
                    *  bloco não existe no DOM.
                    */}
                  {alreadyRegistered && alreadyRegistered !== 'WAITLISTED' ? (
                    <EventRegistrationDataForm
                      tenantSlug={tenantSlug}
                      eventSlug={eventSlug}
                      fields={event.registrationFormFields}
                      respostas={myFormResponses}
                      accessibilityNotes={myAccessibilityNotes}
                    />
                  ) : null}
                </div>
              ) : !user ? (
                <div className="ef-card space-y-3 p-5">
                  <p className="font-medium">Entre para se inscrever</p>
                  <p className="text-sm opacity-70">
                    Você precisa de uma conta na plataforma para reservar sua vaga. É rápido e
                    vale para todas as instituições.
                  </p>
                  <Link href={loginHref} className="ef-button w-full">
                    <LogIn className="size-4" aria-hidden />
                    Entrar e continuar
                  </Link>
                  <Link
                    href={`/signup?redirectTo=${encodeURIComponent(
                      tenantPath(tenantSlug, `/eventos/${eventSlug}/inscricao`),
                    )}`}
                    className="ef-button-outline w-full"
                  >
                    Criar conta
                  </Link>
                </div>
              ) : membershipStatus === 'SUSPENDED' || membershipStatus === 'REMOVED' ? (
                <div className="ef-card space-y-2 p-5">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" aria-hidden />
                    Acesso bloqueado
                  </p>
                  <p className="text-sm opacity-70">
                    Seu acesso a {tenant.name} está bloqueado. Fale com a organização do evento.
                  </p>
                </div>
              ) : event.registrationRequiresMembership && membershipStatus !== 'ACTIVE' ? (
                <div className="ef-card space-y-2 p-5" data-testid="event-restricted">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" aria-hidden />
                    Restrito à comunidade
                  </p>
                  <p className="text-sm opacity-70">{restrictedEventNotice(tenant.name)}</p>
                </div>
              ) : !canRegister ? (
                <div className="ef-card space-y-2 p-5">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertCircle className="size-4" aria-hidden />
                    Inscrição não permitida
                  </p>
                  <p className="text-sm opacity-70">
                    Seu perfil não tem permissão para se inscrever nesta instituição.
                  </p>
                </div>
              ) : (
                <>
                  {membershipStatus !== 'ACTIVE' ? (
                    <div
                      className="ef-card space-y-1 p-4 text-xs opacity-80"
                      data-testid="public-registration-notice"
                    >
                      <p>{publicRegistrationNotice(tenant.name)}</p>
                    </div>
                  ) : null}

                  <EventRegistrationForm
                    tenantSlug={tenantSlug}
                    eventSlug={eventSlug}
                    openActivities={openActivities.map((activity) => activity.title)}
                    individualActivities={individualActivities.map((activity) => activity.title)}
                    /**
                     * ─────────────────────────────────────────────────────────────────────
                     *  AS PERGUNTAS QUE O ORGANIZADOR DECLAROU (FASE 70 · fatia 4)
                     * ─────────────────────────────────────────────────────────────────────
                     *  Vêm da MESMA leitura que a Server Action usa para validar
                     *  (`readRegistrationForm`, dentro da projeção pública do evento): tela
                     *  e servidor não podem discordar sobre quais campos existem — a tela
                     *  desenharia um campo que o servidor recusaria, ou o contrário.
                     *
                     *  A lista VAZIA é o formulário de sempre (CPF, necessidades e
                     *  consentimentos): o evento que nunca montou formulário não ganha um
                     *  bloco vazio.
                     */
                    fields={event.registrationFormFields}
                  />
                </>
              )}
            </aside>
          </div>
        </Section>
      </main>
    </ThemeScope>
  );
}
