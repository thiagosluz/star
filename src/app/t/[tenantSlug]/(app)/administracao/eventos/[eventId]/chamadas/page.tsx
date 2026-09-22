import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarClock, FileText, Megaphone, Mic } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listCallProposals, listCalls } from '@/lib/proposals/call-service';
import {
  CALL_STATE_LABELS,
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_KIND_SHORT_LABELS,
} from '@/domain/proposals/call-rules';
import type { RubricCriterion } from '@/domain/review/review-rules';
import {
  deleteCallAction,
  saveCallAction,
  setCallPublishedAction,
} from '@/app/actions/call-actions';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';

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
   * O instante vem de UMA leitura e é o mesmo para todas as chamadas: o estado de
   * cada uma (aberta, agendada, encerrada) é decidido contra ele. Duas leituras de
   * relógio no mesmo render fariam duas chamadas vizinhas discordarem por
   * milissegundos na virada do prazo.
   */
  const now = new Date();
  const callsResult = await listCalls({ tenantId, eventId, now });
  const calls = callsResult.ok ? callsResult.calls : [];

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

  const kindOptions = PROPOSAL_KINDS.map((kind) => ({
    value: kind,
    label: PROPOSAL_KIND_LABELS[kind],
  }));

  const trackOptions = [
    { value: '', label: 'Sem trilha (chamada não científica)' },
    ...event.tracks.map((track) => ({ value: track.id, label: track.name })),
  ];

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
        options={[
          { value: '', label: 'Padrão do tipo' },
          { value: 'on', label: 'Sim — os revisores não veem a autoria' },
          { value: 'off', label: 'Não — revisão aberta' },
        ]}
        defaultValue=""
        hint="O padrão do tipo é cego para artigo e pôster, aberto para os demais."
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
      <RubricFieldset criteria={[]} />
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
            {calls.map((call) => (
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
                      <span>
                        {call.proposals} proposta(s) · {call.decided} decidida(s)
                      </span>
                      {call.trackName ? <span>Trilha: {call.trackName}</span> : null}
                      <span>{call.requiresBlindReview ? 'Revisão cega' : 'Revisão aberta'}</span>
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
                            : 'A chamada sai do painel e da página pública. Sem propostas recebidas, não há histórico a perder.',
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
                          options={[
                            { value: '', label: 'Padrão do tipo' },
                            { value: 'on', label: 'Sim — os revisores não veem a autoria' },
                            { value: 'off', label: 'Não — revisão aberta' },
                          ]}
                          defaultValue={call.requiresBlindReview ? 'on' : 'off'}
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
                        <RubricFieldset criteria={call.reviewRubric} />
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
                              {proposal.status}
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
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Rubrica própria da chamada (FASE 33).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CHAMADA TEM RUBRICA, SE A TRILHA JÁ TEM
 * ─────────────────────────────────────────────────────────────────────────────
 *  A trilha é o eixo TEMÁTICO (e é por ela que os revisores são escolhidos por
 *  afinidade); a chamada é o CONVITE. Uma chamada de minicurso aponta a trilha
 *  "Extensão" para achar quem entende do assunto e ainda assim julga por critérios
 *  próprios — "viabilidade da oficina", "clareza do plano de aula" — que não fazem
 *  sentido para um artigo científico. A precedência é CHAMADA → TRILHA → PADRÃO, e
 *  vazio aqui significa "use a da trilha".
 *
 *  O campo é o MESMO da tela de trilhas (quatro colunas por linha, sem JSON): quem
 *  organiza um evento já conhece o formulário.
 */
function RubricFieldset({ criteria }: { criteria: readonly RubricCriterion[] }) {
  /** Sempre ao menos três linhas em branco: a primeira rubrica caber numa folga. */
  const rows = Math.max(3, criteria.length);

  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3 sm:col-span-2">
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Rubrica da chamada (opcional — vazio usa a da trilha, e a padrão sem trilha)
      </legend>

      {Array.from({ length: rows }, (_, index) => {
        const criterion = criteria[index];

        return (
          <div key={index} className="grid gap-2 sm:grid-cols-4">
            <Field
              label={`Critério ${index + 1}`}
              name="rubricKey"
              placeholder="feasibility"
              defaultValue={criterion?.key}
            />
            <Field
              label="Rótulo"
              name="rubricLabel"
              placeholder="Viabilidade da oficina"
              defaultValue={criterion?.label}
            />
            <Field
              label="Peso"
              name="rubricWeight"
              type="number"
              min={1}
              defaultValue={criterion?.weight ?? (index === 0 ? 3 : 1)}
            />
            <Field
              label="Nota máxima"
              name="rubricMaxScore"
              type="number"
              min={1}
              defaultValue={criterion?.maxScore ?? 10}
            />
          </div>
        );
      })}
    </fieldset>
  );
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
