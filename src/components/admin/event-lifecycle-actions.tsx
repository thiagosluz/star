'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  UI — Ações de Ciclo de Vida na Lista de Eventos (FASE 128)
 *
 *  Dispara os diálogos de Clonar (dados básicos), Arquivar/Restaurar e Excluir
 *  com confirmação por palavra-chave ("EXCLUIR") e senha atual. Os `<Modal>` só
 *  montam seus `<form>` quando abertos, preservando a invariante SSR da F90.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';
import { Archive, Copy, ExternalLink, RotateCcw, Trash2 } from 'lucide-react';

import {
  archiveEventAction,
  cloneEventAction,
  deleteEventAction,
  type EventLifecycleActionState,
} from '@/app/actions/event-lifecycle-actions';
import {
  ActionFeedback,
  AppLink,
  Button,
  Field,
  Input,
  Modal,
  SubmitButton,
  fieldAria,
} from '@/components/ui';
import {
  EVENT_DELETE_CONFIRMATION_WORD,
  buildClonedEventDefaults,
  canArchiveEvent,
  canRestoreArchivedEvent,
} from '@/domain/events/event-lifecycle-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

export interface EventLifecycleItemProps {
  id: string;
  slug: string;
  title: string;
  status: string;
  startsAtIso: string;
  endsAtIso: string;
}

type ActiveModal = 'clone' | 'archive' | 'delete' | null;

function toDatetimeLocalValue(date: Date): string {
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function EventLifecycleActions({
  tenantSlug,
  event,
  canCreate,
  canDelete,
}: {
  tenantSlug: string;
  event: EventLifecycleItemProps;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const canArchive = canArchiveEvent(event.status);
  const canRestore = canRestoreArchivedEvent(event.status);

  return (
    <>
      {canCreate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveModal('clone')}
          data-testid={`clone-event-trigger-${event.slug}`}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          Clonar
        </Button>
      ) : null}

      {canArchive || canRestore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setActiveModal('archive')}
          data-testid={`archive-event-trigger-${event.slug}`}
        >
          {canArchive ? (
            <>
              <Archive className="size-3.5" aria-hidden="true" />
              Arquivar
            </>
          ) : (
            <>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Restaurar
            </>
          )}
        </Button>
      ) : null}

      {canDelete ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setActiveModal('delete')}
          data-testid={`delete-event-trigger-${event.slug}`}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Excluir
        </Button>
      ) : null}

      {activeModal === 'clone' ? (
        <CloneEventModal
          tenantSlug={tenantSlug}
          event={event}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeModal === 'archive' ? (
        <ArchiveEventModal
          tenantSlug={tenantSlug}
          event={event}
          archive={canArchive}
          onClose={() => setActiveModal(null)}
        />
      ) : null}

      {activeModal === 'delete' ? (
        <DeleteEventModal
          tenantSlug={tenantSlug}
          event={event}
          onClose={() => setActiveModal(null)}
        />
      ) : null}
    </>
  );
}

function CloneEventModal({
  tenantSlug,
  event,
  onClose,
}: {
  tenantSlug: string;
  event: EventLifecycleItemProps;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<EventLifecycleActionState | null, FormData>(
    cloneEventAction,
    null,
  );

  const defaults = buildClonedEventDefaults({
    title: event.title,
    slug: event.slug,
    startsAt: new Date(event.startsAtIso),
    endsAt: new Date(event.endsAtIso),
  });

  const [title, setTitle] = useState(defaults.title);
  const [slug, setSlug] = useState(defaults.slug);
  const [startsAt, setStartsAt] = useState(() => toDatetimeLocalValue(defaults.startsAt));
  const [endsAt, setEndsAt] = useState(() => toDatetimeLocalValue(defaults.endsAt));

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
    }
  }, [state?.ok, router]);

  return (
    <Modal
      open
      onClose={onClose}
      title="Clonar dados básicos do evento"
      description="Cria um novo evento em rascunho copiando identificação, modalidade, local, tema e política base. Inscrições, programação, financeiro e chaves de API não são copiados."
      testId={`clone-event-modal-${event.slug}`}
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="sourceEventId" value={event.id} />

        <Field name="clone-title" label="Título do novo evento" required>
          <Input
            {...fieldAria('clone-title')}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={4}
            maxLength={200}
            data-testid="clone-event-title"
          />
        </Field>

        <Field
          name="clone-slug"
          label="Identificador na URL (slug)"
          hint="Use apenas letras minúsculas, números e hífens."
          required
        >
          <Input
            {...fieldAria('clone-slug')}
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            minLength={3}
            maxLength={63}
            data-testid="clone-event-slug"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="clone-startsAt" label="Início" required>
            <Input
              {...fieldAria('clone-startsAt')}
              name="startsAt"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              data-testid="clone-event-starts-at"
            />
          </Field>

          <Field name="clone-endsAt" label="Término" required>
            <Input
              {...fieldAria('clone-endsAt')}
              name="endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              data-testid="clone-event-ends-at"
            />
          </Field>
        </div>

        <ActionFeedback state={state} testId="clone-event-feedback" />

        {state?.ok && state.createdEventId ? (
          <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface-low p-3">
            <AppLink
              href={tenantPath(tenantSlug, `/administracao/eventos/${state.createdEventId}/dados`)}
              data-testid="clone-event-edit-link"
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
            >
              Editar dados do clone
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </AppLink>
            <AppLink
              href={tenantPath(tenantSlug, `/administracao/eventos/${state.createdEventId}`)}
              data-testid="clone-event-manage-link"
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              Abrir gestão
            </AppLink>
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {state?.ok ? 'Fechar' : 'Cancelar'}
          </Button>
          {!state?.ok ? (
            <SubmitButton
              size="sm"
              label="Clonar como rascunho"
              pendingLabel="Clonando..."
              data-testid="clone-event-submit"
            />
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function ArchiveEventModal({
  tenantSlug,
  event,
  archive,
  onClose,
}: {
  tenantSlug: string;
  event: EventLifecycleItemProps;
  archive: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<EventLifecycleActionState | null, FormData>(
    archiveEventAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state?.ok, router, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={archive ? `Arquivar "${event.title}"?` : `Restaurar "${event.title}"?`}
      description={
        archive
          ? 'O evento sai da listagem padrão de ativos e da vitrine pública, mas preserva inscrições, financeiro e certificados emitidos.'
          : 'O evento volta ao estado de rascunho para nova edição ou publicação.'
      }
      testId={`archive-event-modal-${event.slug}`}
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={event.id} />
        <input type="hidden" name="archive" value={archive ? 'true' : 'false'} />

        <ActionFeedback state={state} testId="archive-event-feedback" />

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <SubmitButton
            size="sm"
            label={archive ? 'Confirmar arquivamento' : 'Restaurar para rascunho'}
            pendingLabel={archive ? 'Arquivando...' : 'Restaurando...'}
            data-testid="archive-event-submit"
          />
        </div>
      </form>
    </Modal>
  );
}

function DeleteEventModal({
  tenantSlug,
  event,
  onClose,
}: {
  tenantSlug: string;
  event: EventLifecycleItemProps;
  onClose: () => void;
}) {
  const router = useRouter();
  const [confirmationWord, setConfirmationWord] = useState('');
  const [state, formAction] = useActionState<EventLifecycleActionState | null, FormData>(
    deleteEventAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state?.ok, router, onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      tone="danger"
      title={`Excluir "${event.title}"`}
      description="Esta ação remove o evento do acervo e libera seu identificador URL. Para evitar exclusões acidentais, confirme com a palavra-chave e sua senha atual."
      testId={`delete-event-modal-${event.slug}`}
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventId" value={event.id} />

        <Field
          name="delete-confirmationWord"
          label={`Digite ${EVENT_DELETE_CONFIRMATION_WORD} para confirmar`}
          required
        >
          <Input
            {...fieldAria('delete-confirmationWord')}
            name="confirmationWord"
            value={confirmationWord}
            onChange={(e) => setConfirmationWord(e.target.value)}
            autoComplete="off"
            placeholder={EVENT_DELETE_CONFIRMATION_WORD}
            required
            data-testid="delete-event-word"
          />
        </Field>

        <Field name="delete-currentPassword" label="Sua senha atual" required>
          <Input
            {...fieldAria('delete-currentPassword')}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            data-testid="delete-event-password"
          />
        </Field>

        <ActionFeedback state={state} testId="delete-event-feedback" />

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <SubmitButton
            variant="danger"
            size="sm"
            label="Excluir definitivamente"
            pendingLabel="Excluindo..."
            data-testid="delete-event-submit"
          />
        </div>
      </form>
    </Modal>
  );
}
