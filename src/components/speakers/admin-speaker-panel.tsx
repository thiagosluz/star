'use client';

import { useActionState, useRef, useState } from 'react';
import { Copy, Loader2, Plus, RefreshCw, Unlink, UserPlus } from 'lucide-react';

import { Alert, Button, ConfirmDialog, Field, Input, Select, fieldAria } from '@/components/ui';
import { SPEAKER_ROLE_TITLES } from '@/domain/speakers/speaker-rules';
import type { SpeakerActionState } from '@/app/actions/speaker-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL DE PALESTRANTES DA ORGANIZAÇÃO (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CÓDIGO DE CONVITE APARECE UMA VEZ, E A TELA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O servidor devolve o token em claro SÓ na resposta que o gerou (o banco guarda o
 *  SHA-256). Se o organizador fechar a página sem copiar, o caminho é gerar outro —
 *  por isso o aviso é explícito ao lado do código, e não uma nota de rodapé.
 *
 *  A partir daqui o convite é entregue à mão (a plataforma ainda não envia e-mail: é
 *  a F15, planejada). Esconder isso faria o organizador esperar por um e-mail que
 *  nunca chega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

type Action = (prev: SpeakerActionState | null, formData: FormData) => Promise<SpeakerActionState>;

function Feedback({ state }: { state: SpeakerActionState | null }) {
  if (!state) return null;

  return (
    <Alert tone={state.ok ? 'success' : 'danger'} data-testid="admin-speaker-feedback">
      <span>{state.message ?? (state.ok ? 'Pronto.' : 'Não foi possível concluir.')}</span>
      {state.details && state.details.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs">
          {state.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/** Código de convite + botão de copiar (o que o organizador precisa fazer com ele). */
export function InviteTokenBox({ token, expiresAt }: { token: string; expiresAt: string | null }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3" data-testid="invite-token-box">
      <p className="text-xs font-medium">
        Código de convite — entregue ao palestrante. Ele não aparece de novo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="code-data break-all" data-testid="invite-token">
          {token}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(token);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          data-testid="copy-invite-token"
        >
          <Copy className="size-3.5" aria-hidden />
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      {expiresAt ? (
        <p className="text-xs text-muted-foreground">
          Válido até {new Date(expiresAt).toLocaleDateString('pt-BR')}. Depois disso, gere outro.
        </p>
      ) : null}
    </div>
  );
}

export function SpeakerCreateForm({
  tenantSlug,
  activities,
  action,
}: {
  tenantSlug: string;
  activities: readonly { id: string; title: string }[];
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [open, setOpen] = useState(false);

  const token = typeof state?.data?.inviteToken === 'string' ? state.data.inviteToken : null;
  const expiresAt = typeof state?.data?.inviteExpiresAt === 'string' ? state.data.inviteExpiresAt : null;

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" onClick={() => setOpen((value) => !value)} data-testid="toggle-speaker-form">
        <UserPlus className="size-4" aria-hidden />
        {open ? 'Fechar cadastro' : 'Cadastrar palestrante'}
      </Button>

      {open ? (
        <form action={formAction} className="space-y-3 rounded-lg border border-border bg-card p-4" data-testid="speaker-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="name" label="Nome">
              <Input {...fieldAria('name')} required minLength={3} maxLength={160} data-testid="speaker-name" />
            </Field>

            <Field
              name="email"
              label="E-mail"
              hint="É o que identifica a pessoa no convite e no portal."
            >
              <Input {...fieldAria('email')} type="email" maxLength={255} data-testid="speaker-email" />
            </Field>

            <Field name="institution" label="Instituição">
              <Input {...fieldAria('institution')} maxLength={200} data-testid="speaker-institution" />
            </Field>

            <Field name="speaker-roleTitle" label="Papel padrão">
              <Input
                id="speaker-roleTitle"
                name="roleTitle"
                list="speaker-role-titles"
                maxLength={120}
                placeholder="Keynote, Instrutor(a)…"
                data-testid="speaker-role"
              />
            </Field>
          </div>

          <datalist id="speaker-role-titles">
            {SPEAKER_ROLE_TITLES.map((title) => (
              <option key={title} value={title} />
            ))}
          </datalist>

          <Field name="bio" label="Minibiografia" hint="Aparece na vitrine pública.">
            <Input {...fieldAria('bio')} maxLength={4000} data-testid="speaker-bio" />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPublic" defaultChecked />
            Mostrar na vitrine pública do evento
          </label>

          <p className="text-xs text-muted-foreground">
            Ao salvar, o sistema gera um código de convite (quando há e-mail) para o palestrante
            assumir o próprio perfil.
          </p>

          <Feedback state={state} />

          {token ? <InviteTokenBox token={token} expiresAt={expiresAt} /> : null}

          <Button type="submit" disabled={pending} data-testid="save-speaker">
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            Salvar palestrante
          </Button>
        </form>
      ) : null}

      {/* A lista de atividades fica fora do formulário: o vínculo é um segundo passo. */}
      <p className="sr-only" aria-hidden>
        {activities.length} atividades disponíveis para vínculo.
      </p>
    </div>
  );
}

export function SpeakerLinkForm({
  tenantSlug,
  speakerProfileId,
  activities,
  action,
}: {
  tenantSlug: string;
  speakerProfileId: string;
  activities: readonly { id: string; title: string }[];
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  if (activities.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhuma atividade cadastrada neste evento ainda.</p>;
  }

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2" data-testid={`link-speaker-${speakerProfileId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="speakerProfileId" value={speakerProfileId} />

      <Field name={`link-activity-${speakerProfileId}`} label="Vincular a atividade">
        <Select
          id={`link-activity-${speakerProfileId}`}
          name="activityId"
          required
          aria-label="Atividade"
          data-testid={`link-activity-${speakerProfileId}`}
        >
          {activities.map((activity) => (
            <option key={activity.id} value={activity.id}>
              {activity.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field name={`link-roleTitle-${speakerProfileId}`} label="Papel nesta atividade">
        <Input
          id={`link-roleTitle-${speakerProfileId}`}
          name="roleTitle"
          list="speaker-role-titles"
          maxLength={120}
          placeholder="Keynote"
        />
      </Field>

      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="isKeynote" />
        Keynote
      </label>

      <Button type="submit" variant="outline" disabled={pending} data-testid={`submit-link-${speakerProfileId}`}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        Vincular
      </Button>

      <div className="w-full">
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function SpeakerInviteButton({
  tenantSlug,
  speakerProfileId,
  action,
}: {
  tenantSlug: string;
  speakerProfileId: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const token = typeof state?.data?.inviteToken === 'string' ? state.data.inviteToken : null;
  const expiresAt = typeof state?.data?.inviteExpiresAt === 'string' ? state.data.inviteExpiresAt : null;

  return (
    <div className="space-y-2">
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="speakerProfileId" value={speakerProfileId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={pending}
          data-testid={`regenerate-invite-${speakerProfileId}`}
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
          Novo convite
        </Button>
      </form>

      {token ? <InviteTokenBox token={token} expiresAt={expiresAt} /> : null}
      <Feedback state={state} />
    </div>
  );
}

export function SpeakerUnlinkButton({
  tenantSlug,
  linkId,
  activityTitle,
  action,
}: {
  tenantSlug: string;
  linkId: string;
  activityTitle: string;
  action: Action;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={formAction} className="inline-flex">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="linkId" value={linkId} />

      {/* O botão abre o diálogo do sistema; o envio continua no `<form>` (revisão de UI). */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setConfirming(true)}
        data-testid={`unlink-speaker-${linkId}`}
      >
        <Unlink className="size-3.5" aria-hidden />
        Remover
      </Button>

      <ConfirmDialog
        open={confirming}
        title={`Desvincular de “${activityTitle}”?`}
        description="O palestrante sai da agenda desta atividade e os materiais que ele publicou nela saem da página. O cadastro dele na instituição continua."
        confirmLabel="Desvincular"
        cancelLabel="Voltar"
        testId={`unlink-speaker-${linkId}-confirm`}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          formRef.current?.requestSubmit();
        }}
      />

      <Feedback state={state} />
    </form>
  );
}
