import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarClock, FileText, Megaphone, Mic } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listCallProposals, listCalls } from '@/lib/proposals/call-service';
import { getCallResultPanel } from '@/lib/proposals/call-result-service';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import {
  CALL_STATE_LABELS,
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_KIND_SHORT_LABELS,
} from '@/domain/proposals/call-rules';
import {
  inProgressDraftsLabel,
  receivedProposalsLabel,
} from '@/domain/proposals/proposal-receipt-rules';
import {
  deleteCallAction,
  saveCallAction,
  setCallPublishedAction,
} from '@/app/actions/call-actions';
import { SectionHeading } from '@/components/ui';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { RubricEditor } from '@/components/admin/rubric-editor';
import { TrackSection } from '@/components/admin/track-section';
import { CallResultCard } from '@/components/proposals/call-result-card';
import { rubricReviewCounts } from '@/lib/review/rubric-guard';

export const metadata = { title: 'Chamadas de propostas' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CHAMADAS DE PROPOSTAS DO EVENTO (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDOU EM RELAÇÃO À CHAMADA DE TRABALHOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 32 o evento tinha UMA chamada: a janela em `Event.cfpOpensAt`/
 *  `cfpClosesAt`, e as regras (rubrica, cegueira, limite) presas à trilha. Quem
 *  quisesse convidar PALESTRANTES ou receber propostas de MINICURSO não tinha onde:
 *  a janela era uma só e o formulário era o de artigo.
 *
 *  Agora cada chamada é uma linha própria (`call_for_proposals`), com o TIPO que ela
 *  pede, o próprio texto, a própria janela, a própria cegueira e o próprio limite por
 *  autor. A trilha continua existindo como dado científico e é ESCOLHA da chamada:
 *  chamada de palestrante não tem trilha, chamada de artigo tem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PAINEL MOSTRA AS PROPOSTAS DENTRO DA CHAMADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lista de submissões do comitê é organizada por trilha — e a proposta de
 *  palestrante não tem trilha. Sem esta seção, o organizador que recebeu uma proposta
 *  de minicurso não teria por onde chegar até ela. Cada linha leva ao painel do
 *  comitê, que é onde o aceite acontece (com o protocolo da FASE 33).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventCallsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * Quantos pareceres cada TRILHA já recebeu — decide se a rubrica dela está congelada.
   * A contagem das CHAMADAS já é feita logo abaixo; esta é a das trilhas, que passaram
   * a viver nesta tela na FASE 53 (antes ficavam na tela do evento).
   */
  const trackReviewCounts = (
    await rubricReviewCounts({ tenantId, trackIds: event.tracks.map((track) => track.id) })
  ).byTrack;

  /**
   * O instante vem de UMA leitura e é o mesmo para todas as chamadas: o estado de
   * cada uma (aberta, agendada, encerrada) é decidido contra ele. Duas leituras de
   * relógio no mesmo render fariam duas chamadas vizinhas discordarem por
   * milissegundos na virada do prazo.
   */
  const now = new Date();
  const callsResult = await listCalls({ tenantId, eventId, now });
  const calls = callsResult.ok ? callsResult.calls : [];

  /**
   * Quantos pareceres já existem por chamada — o que decide se a rubrica aparece
   * editável ou congelada (FASE 39). UMA consulta para todas as chamadas.
   */
  const callReviewCounts = (
    await rubricReviewCounts({ tenantId, callIds: calls.map((call) => call.id) })
  ).byCall;

  /**
   * As propostas são lidas só das chamadas que TÊM propostas — a contagem já veio na
   * lista. É uma consulta por chamada com proposta (poucas), e todas sob RLS.
   */
  const proposalsByCall = new Map(
    await Promise.all(
      calls
        .filter((call) => call.proposals > 0)
        .map(async (call) => {
          const result = await listCallProposals({ tenantId, callId: call.id });
          return [call.id, result.ok ? result.proposals : []] as const;
        }),
    ),
  );

  /**
   * ───────────────────────────────────────────────────────────────────────────────
   *  O RESULTADO DE CADA CHAMADA (FASE 73 · fatia 3)
   * ───────────────────────────────────────────────────────────────────────────────
   *  Uma leitura por chamada, e não uma global: o painel do resultado carrega a
   *  chamada, as submissões DELA e a projeção pública — tudo dentro do `withTenant`,
   *  com a RLS ligada. Não há consulta por submissão (a autoria vem aninhada), e o
   *  número de chamadas por evento já tem teto (CALL_LIST_LIMIT).
   *
   *  A leitura é feita para TODA chamada, inclusive a que nunca teve resultado e a
   *  que ainda não recebeu propostas: é exatamente nessas que o organizador precisa
   *  do formulário para começar. A falha de UMA não derruba a tela — o cartão daquela
   *  chamada mostra o aviso honesto, e as outras continuam utilizáveis.
   */
  const resultPanels = new Map(
    await Promise.all(
      calls.map(async (call) => {
        const result = await getCallResultPanel({ tenantId, callId: call.id });
        return [call.id, result] as const;
      }),
    ),
  );

  const kindOptions = PROPOSAL_KINDS.map((kind) => ({
    value: kind,
    label: PROPOSAL_KIND_LABELS[kind],
  }));

  const trackOptions = [
    { value: '', label: 'Sem trilha (chamada não científica)' },
    ...event.tracks.map((track) => ({ value: track.id, label: track.name })),
  ];

  /**
   * ───────────────────────────────────────────────────────────────────────────────
   *  OS TRÊS ESTADOS DA CEGUEIRA (FASE 74 · fatia 5)
   * ───────────────────────────────────────────────────────────────────────────────
   *  "Padrão do tipo" e "Herdar da trilha" parecem a mesma coisa ("não escolhi") e
   *  NÃO são:
   *
   *    • Padrão do tipo — grava `defaultBlindFor(tipo)` na coluna. A chamada passa a
   *      decidir sozinha com esse valor, e a trilha deixa de ser consultada.
   *    • Herdar da trilha — grava `NULL`. A chamada não se pronuncia e a TRILHA
   *      decide; sem trilha, vale o padrão do tipo.
   *
   *  O rótulo do primeiro diz qual é o padrão do tipo porque o formulário é sem
   *  JavaScript: o `kind` é outro campo e não há como o texto mudar ao trocá-lo.
   *  A frase do `hint` é a mesma nos dois formulários (criar e editar).
   */
  const blindOptions = [
    { value: '', label: 'Padrão do tipo (cego para artigo e pôster)' },
    { value: 'inherit', label: 'Herdar da trilha' },
    { value: 'on', label: 'Sim — os revisores não veem a autoria' },
    { value: 'off', label: 'Não — revisão aberta' },
  ];

  const blindHint =
    '“Padrão do tipo” grava o default do tipo na chamada (cego para artigo e pôster). ' +
    '“Herdar da trilha” deixa a chamada sem opinião: é o que faz uma trilha cega valer ' +
    'aqui — sem trilha, volta o padrão do tipo.';

  const callFields = (
    <>
      <SelectField label="Tipo de proposta" name="kind" options={kindOptions} defaultValue="PAPER" />
      <Field
        label="Identificador na URL"
        name="slug"
        required
        hint="Minúsculas, números e hífen. É o endereço público do formulário."
      />
      <Field label="Título da chamada" name="title" required />
      <Field label="Resumo" name="summary" hint="Uma linha que a página pública mostra no cartão." />
      <Field
        label="Orientações ao proponente"
        name="instructions"
        hint="O que precisa ser dito a quem vai propor: formato, critérios, o que anexar."
      />
      <Field label="Abre em" name="opensAt" type="datetime-local" hint={`No fuso do evento (${event.timezone}).`} />
      <Field label="Encerra em" name="closesAt" type="datetime-local" hint={`No fuso do evento (${event.timezone}).`} />
      <SelectField
        label="Revisão cega"
        name="requiresBlindReview"
        options={blindOptions}
        defaultValue=""
        hint={blindHint}
      />
      <Field
        label="Propostas por autor"
        name="maxSubmissionsPerAuthor"
        type="number"
        min={0}
        defaultValue={0}
        hint="0 = sem limite."
      />
      <SelectField
        label="Trilha"
        name="trackId"
        options={trackOptions}
        defaultValue=""
        hint="A trilha traz a rubrica e a afinidade dos revisores. Chamada de palestrante não precisa."
      />
      {/**
        * O editor de rubrica é o MESMO da trilha (FASE 39): número de critérios livre
        * até o teto, chave derivada do rótulo, e a FORMA congelada quando já existe
        * parecer — com a contagem no lugar dos campos.
        */}
      <RubricEditor criteria={[]} scope="CALL" scopeLabel="Nova chamada" testId="call-rubric" />
    </>
  );

  return (
    <main className="max-w-5xl space-y-8" data-testid="calls-panel">
      <header className="space-y-1.5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Organização</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Megaphone className="size-6 text-primary" aria-hidden />
          Chamadas de propostas
        </h1>
        <p className="text-sm text-muted-foreground">
          Cada chamada é um convite com tipo próprio: artigo, palestrante, minicurso, oficina,
          mesa-redonda ou outra atividade. Publicar a chamada é o que a torna visível — e o
          bloco “Chamadas de propostas” da página pública é onde você escolhe exibi-la.
        </p>
        <p className="flex flex-wrap items-center gap-4 text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="underline underline-offset-4"
          >
            ← Voltar ao evento
          </Link>
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`)}
            className="underline underline-offset-4"
            data-testid="calls-to-page-editor"
          >
            Editar a página pública →
          </Link>
        </p>
      </header>

      {/* ── Nova chamada ─────────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="create-call-section">
        <summary className="cursor-pointer text-base font-semibold">Criar chamada</summary>

        <div className="pt-4">
          <AdminForm action={saveCallAction} submitLabel="Criar chamada" testId="create-call">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="eventSlug" value={event.slug} />
            <input type="hidden" name="eventTimezone" value={event.timezone} />

            <div className="grid gap-3 sm:grid-cols-2">{callFields}</div>
          </AdminForm>
        </div>
      </details>

      {/* ── Chamadas do evento ───────────────────────────────────────────── */}
      <section className="space-y-4" aria-labelledby="lista-chamadas">
        <h2 id="lista-chamadas" className="text-lg font-semibold tracking-tight">
          Chamadas deste evento ({calls.length})
        </h2>

        {calls.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="calls-empty"
          >
            Nenhuma chamada criada. A janela antiga de submissão do evento continua valendo para o
            formulário de artigo — criar uma chamada aqui é o caminho para convidar palestrantes,
            receber minicursos e organizar mais de um prazo.
          </p>
        ) : (
          <ul className="space-y-4">
            {calls.map((call) => {
              const resultPanel = resultPanels.get(call.id);

              return (
              <li
                key={call.id}
                className="space-y-4 rounded-lg border border-border bg-card p-5"
                data-testid={`call-row-${call.id}`}
                data-call-state={call.state}
                data-call-published={String(call.isPublished)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {call.title}
                      <span className="ef-badge">{CALL_STATE_LABELS[call.state]}</span>
                      <span className="text-xs text-muted-foreground">
                        {PROPOSAL_KIND_SHORT_LABELS[call.kind]}
                      </span>
                    </p>
                    <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <CalendarClock className="size-3" aria-hidden />
                        {call.windowLabel}
                      </span>
                      {call.countdown ? <span>{call.countdown}</span> : null}
                      {/**
                        * ── O SELO FALA DE PROPOSTA RECEBIDA, E SÓ DISSO (F74) ────
                        *  O número e a frase saem da MESMA régua da lista logo
                        *  abaixo (`proposal-receipt-rules`), então o selo não pode
                        *  anunciar uma proposta que a lista não mostra. Rascunho de
                        *  tentativa que falhou não entra; rascunho COM arquivo é
                        *  trabalho em andamento e ganha frase própria — o
                        *  organizador mantém a visão de quem começou e parou sem
                        *  chamar de "recebido" o que ninguém enviou.
                        */}
                      <span data-testid={`call-proposals-selo-${call.id}`}>
                        {receivedProposalsLabel(call.proposals)} · {call.decided} decidida(s)
                      </span>
                      {call.proposalsInProgress !== null && call.proposalsInProgress > 0 ? (
                        <span data-testid={`call-proposals-in-progress-${call.id}`}>
                          {inProgressDraftsLabel(call.proposalsInProgress)}
                        </span>
                      ) : null}
                      {call.trackName ? <span>Trilha: {call.trackName}</span> : null}
                      {/**
                        * A frase diz o que VALE, e quando a chamada herda ela diz de
                        * quem: "Herdar da trilha (cega)" é informação diferente de
                        * "Revisão cega" — a segunda é uma decisão da chamada, a
                        * primeira é uma decisão da trilha que a chamada aceitou
                        * (FASE 74 · fatia 5). Sem trilha apontada, "herdar" não tem de
                        * quem herdar e quem decide é o tipo: dizer "herdar da trilha"
                        * ali seria prometer uma trilha que não existe.
                        */}
                      <span data-testid={`call-blind-${call.id}`}>
                        {call.requiresBlindReview === null
                          ? call.trackId === null
                            ? `Sem trilha — padrão do tipo (${call.effectiveRequiresBlindReview ? 'cega' : 'aberta'})`
                            : `Herdar da trilha (${call.effectiveRequiresBlindReview ? 'cega' : 'aberta'})`
                          : call.effectiveRequiresBlindReview
                            ? 'Revisão cega'
                            : 'Revisão aberta'}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Endereço público:{' '}
                      <Link
                        href={tenantPath(tenantSlug, `/eventos/${event.slug}/chamada/${call.slug}`)}
                        className="underline underline-offset-4"
                        data-testid={`call-public-link-${call.id}`}
                      >
                        /eventos/{event.slug}/chamada/{call.slug}
                      </Link>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-start gap-2">
                    <InlineActionForm
                      action={setCallPublishedAction}
                      submitLabel={call.isPublished ? 'Despublicar' : 'Publicar'}
                      testId={`publish-call-${call.id}`}
                      quietSuccess
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="eventSlug" value={event.slug} />
                      <input type="hidden" name="callId" value={call.id} />
                      <input
                        type="hidden"
                        name="isPublished"
                        value={call.isPublished ? 'off' : 'on'}
                      />
                    </InlineActionForm>

                    <InlineActionForm
                      action={deleteCallAction}
                      submitLabel="Excluir"
                      variant="destructive"
                      testId={`delete-call-${call.id}`}
                      confirm={{
                        title: `Excluir a chamada “${call.title}”?`,
                        description:
                          call.proposals > 0
                            ? 'Esta chamada já recebeu propostas: a exclusão será recusada e a resposta dirá para despublicar em vez de excluir.'
                            : /**
                               * A tela só conhece as propostas RECEBIDAS; um rascunho
                               * de tentativa que falhou não aparece aqui e mesmo assim
                               * impede a exclusão (ele é o caminho de volta do autor).
                               * Por isso o texto não promete que a exclusão passa.
                               */
                              'A chamada sai do painel e da página pública. Se houver rascunho de proposta ainda não enviado, a exclusão é recusada e a resposta diz o caminho.',
                        confirmLabel: 'Excluir chamada',
                      }}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="eventSlug" value={event.slug} />
                      <input type="hidden" name="callId" value={call.id} />
                    </InlineActionForm>
                  </div>
                </div>

                {call.summary ? (
                  <p className="text-sm text-muted-foreground">{call.summary}</p>
                ) : null}

                {/* ── Resultado publicado (FASE 73 · fatia 3) ────────────────── */}
                {/**
                 *  O cartão fica ANTES da edição da chamada e das propostas: publicar o
                 *  resultado é o ato que o organizador vem fazer nesta tela, e ele não
                 *  deve depender de abrir uma sanfona para achar o formulário.
                 *
                 *  O painel inteiro vem do serviço (`getCallResultPanel`), que já
                 *  derivou `acoesDisponiveis` da tabela do domínio e montou a prévia com
                 *  a MESMA projeção da página pública. A tela não recalcula nada.
                 */}
                {resultPanel?.ok ? (
                  <CallResultCard
                    tenantSlug={tenantSlug}
                    callId={call.id}
                    callTitle={call.title}
                    resultado={resultPanel.panel.resultado}
                    acoesDisponiveis={resultPanel.panel.acoesDisponiveis}
                    seletor={resultPanel.panel.seletor}
                    publico={resultPanel.panel.publico}
                    problems={resultPanel.panel.problems}
                    publicadoEmLabel={
                      resultPanel.panel.resultado.publicadoEm
                        ? formatZonedDateTime(
                            new Date(resultPanel.panel.resultado.publicadoEm),
                            event.timezone,
                          )
                        : null
                    }
                  />
                ) : (
                  <p
                    role="status"
                    className="rounded-md border border-warning bg-warning-soft p-3 text-xs text-warning-strong"
                    data-testid={`call-result-unavailable-${call.id}`}
                  >
                    Não foi possível carregar o resultado desta chamada agora. A chamada e as
                    propostas continuam funcionando; recarregue a página para ver o formulário do
                    resultado.
                  </p>
                )}

                {/* ── Edição ───────────────────────────────────────────────── */}
                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Editar chamada</summary>
                  <div className="pt-3">
                    <AdminForm
                      action={saveCallAction}
                      submitLabel="Salvar chamada"
                      testId={`call-form-${call.id}`}
                      compact
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="eventSlug" value={event.slug} />
                      <input type="hidden" name="eventTimezone" value={event.timezone} />
                      <input type="hidden" name="callId" value={call.id} />

                      <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                          label="Tipo de proposta"
                          name="kind"
                          options={kindOptions}
                          defaultValue={call.kind}
                          hint={
                            call.proposals > 0
                              ? 'Esta chamada já tem propostas: o tipo não pode mais mudar.'
                              : undefined
                          }
                        />
                        <Field
                          label="Identificador na URL"
                          name="slug"
                          required
                          defaultValue={call.slug}
                          hint="Mudar o endereço quebra links já divulgados."
                        />
                        <Field label="Título da chamada" name="title" required defaultValue={call.title} />
                        <Field label="Resumo" name="summary" defaultValue={call.summary} />
                        <Field
                          label="Orientações ao proponente"
                          name="instructions"
                          defaultValue={call.instructions}
                        />
                        <Field
                          label="Abre em"
                          name="opensAt"
                          type="datetime-local"
                          defaultValue={toLocalInput(call.opensAt)}
                          hint={`No fuso do evento (${event.timezone}).`}
                        />
                        <Field
                          label="Encerra em"
                          name="closesAt"
                          type="datetime-local"
                          defaultValue={toLocalInput(call.closesAt)}
                          hint={`No fuso do evento (${event.timezone}).`}
                        />
                        <SelectField
                          label="Revisão cega"
                          name="requiresBlindReview"
                          options={blindOptions}
                          defaultValue={blindOptionValue(call.requiresBlindReview)}
                          hint={blindHint}
                        />
                        <Field
                          label="Propostas por autor"
                          name="maxSubmissionsPerAuthor"
                          type="number"
                          min={0}
                          defaultValue={call.maxSubmissionsPerAuthor}
                          hint="0 = sem limite."
                        />
                        <SelectField
                          label="Trilha"
                          name="trackId"
                          options={trackOptions}
                          defaultValue={call.trackId ?? ''}
                        />
                        <RubricEditor
                          criteria={call.reviewRubric}
                          scope="CALL"
                          scopeLabel={call.title}
                          frozen={{ reviews: callReviewCounts[call.id] ?? 0 }}
                          testId={`call-rubric-${call.id}`}
                        />
                      </div>
                    </AdminForm>
                  </div>
                </details>

                {/* ── Propostas recebidas ──────────────────────────────────── */}
                {call.proposals > 0 ? (
                  <details className="rounded-md border border-border p-3" data-testid={`call-proposals-${call.id}`}>
                    <summary className="cursor-pointer text-xs font-medium">
                      Propostas recebidas ({call.proposals})
                    </summary>

                    <ul className="mt-3 space-y-2">
                      {(proposalsByCall.get(call.id) ?? []).map((proposal) => (
                        <li
                          key={proposal.id}
                          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border px-3 py-2"
                          data-testid={`call-proposal-${proposal.id}`}
                        >
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-sm">
                              <span className="code-data text-xs text-muted-foreground">
                                {proposal.protocol}
                              </span>{' '}
                              {proposal.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {proposal.authorName ?? 'Autoria não informada'}
                              {proposal.authorEmail ? ` · ${proposal.authorEmail}` : ''} ·{' '}
                              {/**
                                * O STATUS NA LINHA, EM PORTUGUÊS (FASE 74 · fatia 6).
                                *  A lista mostra o que foi ENVIADO — inclusive a
                                *  retirada, a cancelada e a recusada —, e é este
                                *  rótulo que diz o desfecho. Antes o painel escondia
                                *  essas três linhas e o organizador perdia a
                                *  informação de que a proposta existiu; agora ele vê
                                *  o que chegou e em que pé está. O texto vem do
                                *  serviço (domínio `SUBMISSION_STATUS_LABELS`), não
                                *  do enum cru do banco.
                                */}
                              <span data-testid={`call-proposal-status-${proposal.id}`}>
                                {proposal.statusLabel}
                              </span>
                              {proposal.finalScore !== null
                                ? ` · nota ${proposal.finalScore.toFixed(1)}`
                                : ''}
                            </p>
                            {proposal.data.length > 0 ? (
                              <p className="text-xs text-muted-foreground">
                                {proposal.data.map((field) => `${field.label}: ${field.value}`).join(' · ')}
                              </p>
                            ) : null}
                          </div>

                          <Link
                            href={tenantPath(tenantSlug, `/comite/${proposal.id}`)}
                            className="ef-button shrink-0"
                            data-testid={`call-proposal-review-${proposal.id}`}
                          >
                            <FileText className="size-3.5" aria-hidden />
                            Analisar e aceitar
                          </Link>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mic className="size-3" aria-hidden />
                      O aceite com criação de atividade e convite do palestrante fica no painel do
                      comitê de cada proposta.
                    </p>
                  </details>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </section>
      {/**
       * ─────────────────────────────────────────────────────────────────────────
       *  AS TRILHAS MORAVAM NA TELA DO EVENTO ATÉ A FASE 53
       * ─────────────────────────────────────────────────────────────────────────
       *  O organizador tinha DOIS lugares para o mesmo assunto: as trilhas (com as suas
       *  rubricas) na tela do evento, e as chamadas aqui. A trilha é o eixo temático que
       *  a CHAMADA usa para classificar a submissão — separá-las obrigava a adivinhar
       *  onde criar cada uma. Agora as duas ficam na mesma tela, nesta ordem: primeiro
       *  a chamada (o convite), depois a trilha (como a submissão é classificada).
       */}
      <SectionHeading
        title="Trilhas do evento"
        description="O eixo temático de cada submissão e a rubrica que o comitê usa para avaliar."
      />

      <TrackSection
        tenantSlug={tenantSlug}
        eventId={eventId}
        tracks={event.tracks}
        reviewCounts={trackReviewCounts}
      />
    </main>
  );
}

/**
 * O valor do `<select>` de cegueira que representa o estado GRAVADO (FASE 74 · fatia 5).
 *
 * `null` volta como `inherit` — é a única forma de o formulário reabrir no estado em
 * que a chamada está e de o organizador ver que ela HERDA em vez de decidir. Mapear
 * `null` para `off` (o que um `? 'on' : 'off'` faz) apagaria a diferença na primeira
 * abertura da tela: bastaria salvar para a herança virar uma decisão aberta.
 */
function blindOptionValue(value: boolean | null): string {
  if (value === null) return 'inherit';

  return value ? 'on' : 'off';
}

/**
 * Instante → valor de `<input type="datetime-local">`.
 *
 * O painel mostra a hora de parede que o organizador digitou. Sem esta conversão, o
 * campo apareceria em UTC e salvar de novo deslocaria a data (armadilha 38 na
 * direção inversa). O `toLocalInput` local usa o fuso do PROCESSO — o que é aceitável
 * aqui porque o valor é apenas o que a tela mostra; a interpretação de volta é feita
 * no fuso do evento, pela action.
 */
function toLocalInput(date: Date | null): string {
  if (!date) return '';

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
