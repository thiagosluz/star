'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Trash2, Upload } from 'lucide-react';

import { Alert, Button, ConfirmDialog, Field, Input, Select, Textarea, fieldAria } from '@/components/ui';
import {
  MATERIAL_ACCEPT_ATTRIBUTE,
  MATERIAL_KINDS,
  MATERIAL_KIND_LABELS,
  MATERIAL_VISIBILITIES,
  MATERIAL_VISIBILITY_HINTS,
  MATERIAL_VISIBILITY_LABELS,
  MAX_MATERIAL_BYTES,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  SPEAKER_AVATAR_ORGANIZATION_NOTE,
  type SocialLinks,
  type SpeakerAvatarSource,
} from '@/domain/speakers/speaker-rules';
import { formatBytes } from '@/domain/events/image-rules';
import type { SpeakerActionState } from '@/app/actions/speaker-actions';
import { uploadSpeakerMaterial, type SpeakerUploadAction } from '@/components/speakers/material-upload';
import { SpeakerPhotoField } from '@/components/speakers/speaker-photo-field';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMULÁRIOS DO PORTAL DO PALESTRANTE (FASE 25)
 *
 *  Todos são componentes de CLIENTE porque têm estado de envio (arquivo, mensagem,
 *  botão desabilitado). A autorização NÃO mora aqui: cada formulário chama uma Server
 *  Action que reconfere vínculo, posse e permissão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

function Feedback({ state }: { state: SpeakerActionState | null }) {
  if (!state) return null;

  return (
    <Alert
      tone={state.ok ? 'success' : 'danger'}
      data-testid={state.ok ? 'speaker-feedback-ok' : 'speaker-feedback-error'}
    >
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

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil
// ───────────────────────────────────────────────────────────────────────────────
export function SpeakerProfileForm({
  tenantSlug,
  speakerProfileId,
  eventId,
  initial,
  updateAction,
  requestAvatarAction,
  confirmAvatarAction,
}: {
  tenantSlug: string;
  speakerProfileId: string;
  /** Evento usado para particionar a foto no storage (o primeiro da agenda). */
  eventId: string;
  initial: {
    name: string;
    email: string | null;
    institution: string | null;
    company: string | null;
    roleTitle: string | null;
    bio: string | null;
    avatarUrl: string | null;
    avatarSource: SpeakerAvatarSource | null;
    socialLinks: SocialLinks;
  };
  updateAction: SpeakerUploadAction;
  requestAvatarAction: SpeakerUploadAction;
  confirmAvatarAction: SpeakerUploadAction;
}) {
  const [state, formAction, pending] = useActionState(updateAction, null);

  return (
    <form action={formAction} className="space-y-4" data-testid={`speaker-profile-form-${speakerProfileId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="speakerProfileId" value={speakerProfileId} />

      <SpeakerPhotoField
        tenantSlug={tenantSlug}
        eventId={eventId}
        speakerProfileId={speakerProfileId}
        currentUrl={initial.avatarUrl}
        requestUploadAction={requestAvatarAction}
        confirmUploadAction={confirmAvatarAction}
        testId="speaker-avatar-field"
        successPrefix="Foto validada"
        successSuffix='Clique em "Salvar perfil" para publicá-la.'
        note={
          initial.avatarSource === 'ORGANIZATION' ? SPEAKER_AVATAR_ORGANIZATION_NOTE : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label="Nome público" hint="É o nome que aparece na vitrine e no certificado.">
          <Input {...fieldAria('name')} defaultValue={initial.name} required minLength={3} maxLength={160} />
        </Field>

          <Field name="email" label="E-mail de contato" hint="Usado pela organização; não aparece na página.">
            <Input {...fieldAria('email')} type="email" defaultValue={initial.email ?? ''} maxLength={255} />
          </Field>

          <Field name="institution" label="Instituição">
            <Input {...fieldAria('institution')} defaultValue={initial.institution ?? ''} maxLength={200} />
          </Field>

          <Field name="company" label="Empresa">
            <Input {...fieldAria('company')} defaultValue={initial.company ?? ''} maxLength={200} />
          </Field>

          <Field name="roleTitle" label="Como você quer ser apresentado" hint="Ex.: Keynote, Instrutor(a), Painelista.">
            <Input {...fieldAria('roleTitle')} defaultValue={initial.roleTitle ?? ''} maxLength={120} />
          </Field>
      </div>

      <Field name="bio" label="Biografia" hint="Aparece na vitrine do evento e na sua ficha. Até 4000 caracteres.">
        <Textarea {...fieldAria('bio')} defaultValue={initial.bio ?? ''} rows={6} maxLength={4000} />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Redes e páginas</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {SOCIAL_NETWORKS.map((network) => (
            <Field key={network} name={`social_${network}`} label={SOCIAL_NETWORK_LABELS[network]}>
              <Input
                {...fieldAria(`social_${network}`)}
                defaultValue={initial.socialLinks[network] ?? ''}
                placeholder={
                  network === 'website' ? 'https://seusite.com' : `https://${network}.com/...`
                }
                maxLength={300}
              />
            </Field>
          ))}
        </div>
      </fieldset>

      <Feedback state={state} />

      <Button type="submit" disabled={pending} data-testid="save-speaker-profile">
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        Salvar perfil
      </Button>
    </form>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Ementa da atividade
// ───────────────────────────────────────────────────────────────────────────────
export function SpeakerNotesForm({
  tenantSlug,
  linkId,
  activityId,
  activityTitle,
  initial,
  action,
}: {
  tenantSlug: string;
  linkId: string;
  activityId: string;
  activityTitle: string;
  initial: { syllabus: string | null; requirements: string | null; bibliography: string | null };
  action: SpeakerUploadAction;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <details className="ef-card p-4" data-testid={`speaker-notes-${linkId}`}>
      <summary className="cursor-pointer text-sm font-medium">
        Ementa, pré-requisitos e bibliografia — {activityTitle}
      </summary>

      <form action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="linkId" value={linkId} />
        <input type="hidden" name="activityId" value={activityId} />

        <Field
          name="syllabus"
          label="Conteúdo programático"
          hint="A ementa detalhada aparece na página pública assinada por você."
        >
          <Textarea {...fieldAria('syllabus')} defaultValue={initial.syllabus ?? ''} rows={5} maxLength={6000} />
        </Field>

        <Field name="requirements" label="Pré-requisitos e ferramentas" hint="Ex.: notebook com Python instalado.">
          <Textarea
            {...fieldAria('requirements')}
            defaultValue={initial.requirements ?? ''}
            rows={3}
            maxLength={6000}
          />
        </Field>

        <Field name="bibliography" label="Bibliografia recomendada">
          <Textarea
            {...fieldAria('bibliography')}
            defaultValue={initial.bibliography ?? ''}
            rows={3}
            maxLength={6000}
          />
        </Field>

        <Feedback state={state} />

        <Button type="submit" variant="outline" disabled={pending} data-testid={`save-notes-${linkId}`}>
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Salvar conteúdo
        </Button>
      </form>
    </details>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Materiais
// ───────────────────────────────────────────────────────────────────────────────
export function SpeakerMaterialUploader({
  tenantSlug,
  eventId,
  activityId,
  speakerProfileId,
  requestUploadAction,
  confirmUploadAction,
  saveLinkAction,
}: {
  tenantSlug: string;
  eventId: string;
  activityId: string;
  speakerProfileId: string;
  requestUploadAction: SpeakerUploadAction;
  confirmUploadAction: SpeakerUploadAction;
  saveLinkAction: SpeakerUploadAction;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<string>('SLIDES');
  const [visibility, setVisibility] = useState<string>('PRIVATE');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkState, linkFormAction, linkPending] = useActionState(saveLinkAction, null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setMessage(null);

    const result = await uploadSpeakerMaterial({
      file,
      tenantSlug,
      eventId,
      activityId,
      speakerProfileId,
      title: title.length > 0 ? title : file.name,
      description,
      kind,
      visibility,
      requestUploadAction,
      confirmUploadAction,
    });

    setBusy(false);

    if (!result.ok) {
      setMessage({ ok: false, text: result.message });
      return;
    }

    setTitle('');
    setDescription('');
    setMessage({ ok: true, text: 'Material enviado. A página da atividade já o exibe.' });
  }

  return (
    <div className="space-y-3" data-testid={`material-uploader-${activityId}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field name={`material-title-${activityId}`} label="Título do material">
          <Input
            id={`material-title-${activityId}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Slides da aula 1"
            maxLength={200}
            aria-label="Título do material"
          />
        </Field>

        <Field name={`material-kind-${activityId}`} label="Tipo">
          <Select
            id={`material-kind-${activityId}`}
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            aria-label="Tipo do material"
          >
            {MATERIAL_KINDS.map((option) => (
              <option key={option} value={option}>
                {MATERIAL_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>

        <Field name={`material-visibility-${activityId}`} label="Quem pode ver">
          <Select
            id={`material-visibility-${activityId}`}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
            aria-label="Visibilidade do material"
          >
            {MATERIAL_VISIBILITIES.map((option) => (
              <option key={option} value={option}>
                {MATERIAL_VISIBILITY_LABELS[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <p className="text-xs text-muted-foreground">{MATERIAL_VISIBILITY_HINTS[visibility as 'PUBLIC']}</p>

      <Field name={`material-description-${activityId}`} label="Descrição (opcional)">
        <Input
          id={`material-description-${activityId}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={600}
          aria-label="Descrição do material"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          data-testid={`send-material-${activityId}`}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
          Enviar arquivo
        </Button>

        <input
          ref={fileRef}
          type="file"
          aria-label="Arquivo do material"
          accept={MATERIAL_ACCEPT_ATTRIBUTE}
          className="sr-only"
          onChange={handleFile}
        />

        <span className="text-xs text-muted-foreground">
          PDF, PPTX, DOCX, XLSX, ZIP ou texto · até {formatBytes(MAX_MATERIAL_BYTES)}
        </span>
      </div>

      {message ? <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert> : null}

      <form action={linkFormAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="activityId" value={activityId} />
        <input type="hidden" name="speakerProfileId" value={speakerProfileId} />
        <input type="hidden" name="kind" value="LINK" />
        <input type="hidden" name="visibility" value={visibility} />

        <div className="min-w-56 flex-1">
          <Field name={`material-url-${activityId}`} label="Ou aponte um link" hint="Material que já está publicado em outro lugar.">
            <Input
              id={`material-url-${activityId}`}
              name="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
              maxLength={1024}
            />
          </Field>
        </div>

        <input type="hidden" name="title" value={title.length > 0 ? title : 'Material complementar'} />
        <input type="hidden" name="description" value={description} />

        <Button type="submit" variant="outline" disabled={linkPending} data-testid={`send-material-link-${activityId}`}>
          {linkPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Publicar link
        </Button>

        <div className="w-full">
          <Feedback state={linkState} />
        </div>
      </form>
    </div>
  );
}

/** Ações de um material já publicado: trocar visibilidade ou remover. */
export function SpeakerMaterialRow({
  tenantSlug,
  material,
  updateAction,
  deleteAction,
}: {
  tenantSlug: string;
  material: {
    id: string;
    title: string;
    kind: string;
    visibility: string;
    fileName: string | null;
    sizeBytes: number | null;
    isFile: boolean;
  };
  updateAction: SpeakerUploadAction;
  deleteAction: SpeakerUploadAction;
}) {
  const [updateState, updateFormAction, updating] = useActionState(updateAction, null);
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteAction, null);
  const [deletingMaterial, setDeletingMaterial] = useState(false);
  const deleteFormRef = useRef<HTMLFormElement>(null);

  return (
    <li className="ef-card space-y-3 p-4" data-testid={`portal-material-${material.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{material.title}</p>
          <p className="text-xs text-muted-foreground">
            {MATERIAL_KIND_LABELS[material.kind as 'SLIDES'] ?? material.kind}
            {material.fileName ? ` · ${material.fileName}` : ' · link externo'}
            {material.sizeBytes ? ` · ${formatBytes(material.sizeBytes)}` : ''}
          </p>
        </div>

        <span className="ef-badge" data-testid={`material-visibility-${material.id}`}>
          {MATERIAL_VISIBILITY_LABELS[material.visibility as 'PUBLIC'] ?? material.visibility}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <form action={updateFormAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="materialId" value={material.id} />
          <input type="hidden" name="title" value={material.title} />
          <input type="hidden" name="kind" value={material.kind} />

          <Field name={`visibility-${material.id}`} label="Quem pode ver">
            <Select
              id={`visibility-${material.id}`}
              name="visibility"
              defaultValue={material.visibility}
              aria-label={`Visibilidade de ${material.title}`}
            >
              {MATERIAL_VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {MATERIAL_VISIBILITY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>

          <Button type="submit" variant="outline" size="sm" disabled={updating} data-testid={`save-material-${material.id}`}>
            {updating ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
            Aplicar
          </Button>
        </form>

        <form ref={deleteFormRef} action={deleteFormAction}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="materialId" value={material.id} />

          {/* O botão abre o diálogo do sistema; o envio continua no `<form>` (revisão de UI). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={deleting}
            onClick={() => setDeletingMaterial(true)}
            data-testid={`delete-material-${material.id}`}
          >
            <Trash2 className="size-3.5" aria-hidden />
            Remover
          </Button>

          <ConfirmDialog
            open={deletingMaterial}
            title="Remover este material da página pública?"
            description="O material sai da página da atividade e o arquivo é removido do armazenamento. Não há como desfazer."
            confirmLabel="Remover material"
            cancelLabel="Voltar"
            testId={`delete-material-${material.id}-confirm`}
            onCancel={() => setDeletingMaterial(false)}
            onConfirm={() => {
              setDeletingMaterial(false);
              deleteFormRef.current?.requestSubmit();
            }}
          />
        </form>
      </div>

      <Feedback state={updateState} />
      <Feedback state={deleteState} />
    </li>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Convite
// ───────────────────────────────────────────────────────────────────────────────
export function ClaimInviteForm({
  tenantSlug,
  pendingInvites,
  action,
  defaultToken = '',
  redirectTo,
}: {
  tenantSlug: string;
  pendingInvites: {
    speakerProfileId: string;
    name: string;
    email: string | null;
    institution: string | null;
    activities: { activityId: string; title: string; eventTitle: string }[];
    /**
     * O prazo do CÓDIGO. Aqui ele é informativo, e não uma trava: o aceite por esta
     * lista se identifica pelo e-mail da conta (`evaluateClaim` sem token ignora a
     * validade, porque o link nem é usado), então um código vencido não impede a
     * pessoa de assumir o próprio perfil — e a tela diz isso.
     */
    hasValidToken: boolean;
    /** ISO, para não depender de `Date` atravessando a fronteira servidor → cliente. */
    inviteExpiresAt: string | null;
  }[];
  action: SpeakerUploadAction;
  /** Código que veio na URL do convite (quando a organização entregou o link). */
  defaultToken?: string;
  /** Para onde ir depois do aceite — o portal. */
  redirectTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const router = useRouter();

  /**
   * Depois do aceite, o destino é o portal: a pessoa acabou de ganhar acesso, e é lá
   * que ela vai querer ajustar o perfil. Sem o redirecionamento, quem veio pelo link
   * do convite ficaria numa tela de convite já usado sem entender que funcionou.
   */
  useEffect(() => {
    if (state?.ok && redirectTo) {
      router.push(redirectTo);
      router.refresh();
    }
  }, [state, redirectTo, router]);

  return (
    <div className="space-y-4">
      {pendingInvites.length > 0 ? (
        <ul className="space-y-3" data-testid="pending-invites">
          {pendingInvites.map((invite) => (
            <li
              key={invite.speakerProfileId}
              className="ef-card space-y-2 p-4"
              data-testid={`pending-invite-${invite.speakerProfileId}`}
              data-valid={String(invite.hasValidToken)}
            >
              <p className="font-medium">{invite.name}</p>
              <p className="text-xs text-muted-foreground">
                {invite.institution ? `${invite.institution} · ` : ''}
                {invite.activities.length} atividade(s):{' '}
                {invite.activities.map((activity) => activity.title).join(', ')}
              </p>
              <p className="text-xs text-muted-foreground">
                {invite.hasValidToken
                  ? invite.inviteExpiresAt
                    ? `Código do convite válido até ${new Date(invite.inviteExpiresAt).toLocaleDateString('pt-BR')}.`
                    : 'Convite válido.'
                  : 'O prazo do código terminou, mas assumir o perfil por aqui continua valendo: esta lista é identificada pelo e-mail da sua conta.'}
              </p>

              <form action={formAction}>
                <input type="hidden" name="tenantSlug" value={tenantSlug} />
                <input type="hidden" name="speakerProfileId" value={invite.speakerProfileId} />
                <Button
                  type="submit"
                  disabled={pending}
                  data-testid={`claim-invite-${invite.speakerProfileId}`}
                >
                  Sou eu — assumir este perfil
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="no-pending-invites">
          Nenhum convite pendente para o seu e-mail. Se a organização enviou um código, use o campo
          abaixo.
        </p>
      )}

      <details className="ef-card p-4" open={Boolean(defaultToken)}>
        <summary className="cursor-pointer text-sm font-medium">Tenho um código de convite</summary>

        <form action={formAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          {/**
           * Sem `speakerProfileId`: é o TOKEN que identifica o perfil neste caminho.
           * A ação distingue os dois casos pela presença do id.
           */}

          <div className="min-w-64 flex-1">
            <Field name="token" label="Código de convite" hint="O código que a organização entregou a você.">
              <Input
                {...fieldAria('token')}
                defaultValue={defaultToken}
                placeholder="ABCD2345EFGH6789..."
                maxLength={64}
                aria-label="Código de convite"
                data-testid="invite-token-input"
              />
            </Field>
          </div>

          <Button type="submit" variant="outline" disabled={pending} data-testid="claim-by-token">
            Usar código
          </Button>
        </form>
      </details>

      <Feedback state={state} />
    </div>
  );
}
