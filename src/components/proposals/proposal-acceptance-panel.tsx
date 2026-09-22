'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { AlertCircle, CalendarPlus, CheckCircle2, Loader2, Mail } from 'lucide-react';

import type { CallActionState } from '@/app/actions/call-actions';
import { Button, Checkbox, Input, Label, Select, Textarea } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PROTOCOLO DE ACEITE DE UMA PROPOSTA (FASE 33)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS COISAS SÃO ESCOLHA, E A TELA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Aceitar a proposta é a decisão (o botão "Registrar aceite" registra o ACCEPTED pelo
 *  MESMO motor do comitê). Criar a atividade na programação e convidar o proponente
 *  como palestrante são passos SEPARADOS, cada um com a sua caixa — e as duas vêm
 *  marcadas porque é o desfecho comum, não porque são automáticas. Quem não quer
 *  criar a atividade agora desmarca e o aceite continua valendo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A AGENDA NÃO VEM PREENCHIDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A proposta NÃO pede horário: quem monta a grade é a organização, e o formulário
 *  público pede no máximo uma disponibilidade em texto. Pré-preencher com um horário
 *  inventado criaria uma atividade falsa na programação pública — que é exatamente o
 *  que a FASE 3 proíbe (`saveActivity` exige agenda real).
 *
 *  As datas digitadas são interpretadas no FUSO DO EVENTO, que viaja em campo oculto:
 *  é o fuso que o formulário mostrou a quem digitou (lição da FASE 24).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="acceptance-submit">
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <CheckCircle2 className="size-4" aria-hidden />
      )}
      {pending ? 'Registrando…' : label}
    </Button>
  );
}

export function ProposalAcceptancePanel({
  tenantSlug,
  eventSlug,
  eventId,
  submissionId,
  eventTimeZone,
  kindLabel,
  callTitle,
  proposedTitle,
  workloadMinutes,
  authorName,
  authorEmail,
  activityType,
  activityTypeOptions,
  roomOptions,
  decidedStatus,
  decidedAt,
  action,
}: {
  tenantSlug: string;
  eventSlug: string;
  /** Para o atalho da programação depois da decisão. */
  eventId: string;
  submissionId: string;
  eventTimeZone: string;
  kindLabel: string;
  callTitle: string;
  proposedTitle: string;
  workloadMinutes: number;
  authorName: string | null;
  authorEmail: string | null;
  /** Tipo de atividade sugerido pelo tipo da proposta. */
  activityType: string;
  activityTypeOptions: readonly { value: string; label: string }[];
  roomOptions: readonly { value: string; label: string }[];
  /**
   * Situação da proposta quando ela JÁ tem decisão (nulo = ainda sem decisão).
   *
   * Existe porque a seção sobrevive ao re-render que vem depois do aceite: sem isso, o
   * painel voltaria a oferecer o formulário para uma proposta já decidida — ou, pior,
   * desapareceria levando a confirmação junto (armadilha 76).
   */
  decidedStatus: string | null;
  decidedAt: Date | null;
  action: (prev: CallActionState | null, formData: FormData) => Promise<CallActionState>;
}) {
  const [state, formAction] = useActionState<CallActionState | null, FormData>(action, null);
  const [createActivity, setCreateActivity] = useState(true);
  const [inviteSpeaker, setInviteSpeaker] = useState(Boolean(authorEmail));

  if (state?.ok) {
    const inviteToken = typeof state.data?.inviteToken === 'string' ? state.data.inviteToken : null;

    return (
      <div
        className="space-y-3 rounded-lg border border-success/40 bg-card p-5"
        data-testid="acceptance-recorded"
      >
        <p className="font-medium text-success-strong">{state.message}</p>

        {inviteToken ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Link do convite (aparece uma vez — o convite fica gravado como hash):
            </p>
            <code
              className="block overflow-x-auto rounded border border-border bg-background px-2 py-1 text-xs"
              data-testid="acceptance-invite-token"
            >
              {`/t/${tenantSlug}/palestrante/convite?codigo=${inviteToken}`}
            </code>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          A decisão está registrada na auditoria. A proposta aparece em “Submissões” e a
          atividade criada, na programação do evento.
        </p>
      </div>
    );
  }

  /**
   * Proposta já decidida: o painel diz o que aconteceu, onde conferir e nada mais. Não
   * é uma segunda decisão — o motor recusaria a transição —, e a tela não pode fingir
   * que o aceite nunca aconteceu (era o que a versão anterior fazia, ao sumir).
   */
  if (decidedStatus) {
    return (
      <div
        className="space-y-3 rounded-lg border border-border bg-background p-4"
        data-testid="acceptance-decided"
      >
        <p className="text-sm font-medium">
          Esta proposta já tem decisão registrada:{' '}
          <span className="font-semibold">
            {decidedStatus === 'ACCEPTED'
              ? 'aceita'
              : decidedStatus === 'REJECTED'
                ? 'rejeitada'
                : 'revisão solicitada'}
          </span>
          {decidedAt ? ` em ${decidedAt.toLocaleDateString('pt-BR')}` : ''}.
        </p>

        <p className="text-xs text-muted-foreground">
          O aceite (e o que o organizador escolheu criar ou convidar) fica registrado na
          trilha de auditoria. A atividade criada aparece na programação do evento.
        </p>

        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            href={`/t/${tenantSlug}/administracao/eventos/${eventId}`}
            className="underline underline-offset-4"
            data-testid="acceptance-go-to-program"
          >
            Ver a programação do evento →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" data-testid="acceptance-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="submissionId" value={submissionId} />
      {/* O fuso em que as datas digitadas abaixo devem ser interpretadas. */}
      <input type="hidden" name="eventTimezone" value={eventTimeZone} />

      <p className="text-xs text-muted-foreground">
        Proposta da chamada <span className="font-medium text-foreground">{callTitle}</span> (
        {kindLabel}).
      </p>

      {/* ── 1. Criar a atividade? ─────────────────────────────────────────── */}
      <section className="space-y-4 rounded-md border border-border p-4">
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox
            name="createActivity"
            className="mt-0.5"
            checked={createActivity}
            onChange={(event) => setCreateActivity(event.target.checked)}
            data-testid="acceptance-create-activity"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <CalendarPlus className="size-3.5" aria-hidden />
              Criar a atividade na programação
            </span>
            <span className="block text-xs text-muted-foreground">
              Título, resumo, tipo e carga horária ({workloadMinutes} min) vêm da proposta. A
              agenda é sua: a proposta não pede horário.
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              Título na programação: <span className="font-medium text-foreground">{proposedTitle}</span>
            </span>
          </span>
        </label>

        {createActivity ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="activityType">Tipo da atividade</Label>
              <Select
                id="activityType"
                name="activityType"
                defaultValue={activityType}
                aria-label="Tipo da atividade"
              >
                {activityTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="roomId">Sala</Label>
              <Select id="roomId" name="roomId" defaultValue="" aria-label="Sala">
                {roomOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="startsAt">Início</Label>
              <Input
                id="startsAt"
                name="startsAt"
                type="datetime-local"
                required
                aria-label="Início"
                data-testid="acceptance-starts-at"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="endsAt">Término</Label>
              <Input
                id="endsAt"
                name="endsAt"
                type="datetime-local"
                required
                aria-label="Término"
                data-testid="acceptance-ends-at"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="capacity">Vagas</Label>
              <Input
                id="capacity"
                name="capacity"
                type="number"
                min={0}
                aria-label="Vagas"
                placeholder="Sem limite"
              />
            </div>

            <label className="flex items-start gap-2.5 self-end text-sm">
              <Checkbox name="requiresRegistration" className="mt-0.5" />
              <span className="text-xs text-muted-foreground">
                Exige inscrição própria (sem marcar, a atividade é aberta a quem está inscrito no
                evento).
              </span>
            </label>
          </div>
        ) : null}
      </section>

      {/* ── 2. Convidar o proponente? ─────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border p-4">
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox
            name="inviteSpeaker"
            className="mt-0.5"
            checked={inviteSpeaker}
            disabled={!authorEmail}
            onChange={(event) => setInviteSpeaker(event.target.checked)}
            data-testid="acceptance-invite-speaker"
          />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Mail className="size-3.5" aria-hidden />
              Convidar {authorName ?? 'o proponente'} como palestrante
            </span>
            <span className="block text-xs text-muted-foreground">
              {authorEmail
                ? `Gera o convite e envia o e-mail para ${authorEmail}. O perfil nasce vinculado a esta atividade.`
                : 'A proposta não tem e-mail de proponente: sem endereço não há como convidar (o convite prova a posse do link e do e-mail).'}
            </span>
          </span>
        </label>
      </section>

      <div className="space-y-1.5">
        <Label htmlFor="acceptance-notes">Justificativa / observações</Label>
        <Textarea
          id="acceptance-notes"
          name="notes"
          rows={3}
          maxLength={2000}
          aria-label="Justificativa / observações"
          placeholder={`Ex.: aprovado para a grade de ${eventTimeZone}, com a carga horária declarada.`}
        />
      </div>

      {state && !state.ok ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          data-testid="acceptance-error"
        >
          <AlertCircle className="mr-1.5 inline size-3.5" aria-hidden />
          {state.message}
        </p>
      ) : null}

      <SubmitButton label="Registrar aceite" />
    </form>
  );
}
