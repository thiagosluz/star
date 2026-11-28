'use client';

import { useState } from 'react';

import { CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { ConfirmationFields } from '@/components/admin/confirmation-fields';
import { AppLink } from '@/components/ui';
import {
  EVENT_MODALITY_OPTIONS,
  type EventModalityValue,
} from '@/domain/events/event-modality-rules';
import { onlineRoomFieldVisibility } from '@/domain/events/event-form-defaults';
import {
  computeDurationMinutes,
  formatWorkloadHuman,
  slugifyTitle,
} from '@/domain/events/schedule-ux-rules';

interface OptionItem {
  value: string;
  label: string;
}

const DICA_SALA_ONLINE_DA_ATIVIDADE =
  'Só http:// ou https://. Mostrado apenas a quem tem lugar nesta atividade (ou à equipe).';

/**
 * Campos progressivos de criação de atividade (FASE 135 · ADR-527):
 *  - Título primeiro + auto-geração de slug (sem sobrescrever edição manual);
 *  - Carga horária recalculada automaticamente por `Término - Início` com rótulo humano;
 *  - Modalidade reativa revelando `onlineUrl` quando Online/Híbrido;
 *  - Atalho direto para `/salas` quando o evento ainda não tem salas cadastradas.
 */
export function ActivityCreateFields({
  activityTypes,
  activityStatus,
  roomOptions,
  hasRooms,
  roomsHref,
  defaultStartLocal,
  defaultEndLocal,
}: {
  activityTypes: readonly OptionItem[];
  activityStatus: readonly OptionItem[];
  roomOptions: readonly OptionItem[];
  hasRooms: boolean;
  roomsHref: string;
  defaultStartLocal: string;
  defaultEndLocal: string;
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [modality, setModality] = useState<EventModalityValue>('IN_PERSON');
  const [startsAt, setStartsAt] = useState(defaultStartLocal);
  const [endsAt, setEndsAt] = useState(defaultEndLocal);
  const [workload, setWorkload] = useState(
    String(computeDurationMinutes(defaultStartLocal, defaultEndLocal) ?? 60),
  );
  const [workloadTouched, setWorkloadTouched] = useState(false);

  const salaOnline = onlineRoomFieldVisibility({
    modality,
    hint: DICA_SALA_ONLINE_DA_ATIVIDADE,
  });

  const syncDuration = (nextStart: string, nextEnd: string) => {
    if (workloadTouched) return;
    const computed = computeDurationMinutes(nextStart, nextEnd);
    if (computed !== null) {
      setWorkload(String(computed));
    }
  };

  const parsedWorkload = Number(workload);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          1. O que é a atividade
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Título"
            name="title"
            required
            value={title}
            onChange={(event) => {
              const next = event.target.value;
              setTitle(next);
              if (!slugTouched) {
                setSlug(slugifyTitle(next));
              }
            }}
            placeholder="Minicurso: Rust para iniciantes"
          />

          <Field
            label="Identificador"
            name="slug"
            required
            value={slug}
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugTouched(true);
            }}
            placeholder="minicurso-rust"
            hint="Gerado automaticamente pelo título (editável se quiser)."
          />

          <SelectField label="Tipo" name="type" options={[...activityTypes]} defaultValue="LECTURE" />
          <SelectField label="Situação" name="status" options={[...activityStatus]} defaultValue="SCHEDULED" />

          <SelectField
            label="Modalidade"
            name="modality"
            options={EVENT_MODALITY_OPTIONS}
            value={modality}
            onChange={(event) => setModality(event.target.value as EventModalityValue)}
          />

          <div className="space-y-1.5">
            <SelectField label="Sala" name="roomId" options={[...roomOptions]} />
            {!hasRooms ? (
              <p className="text-xs text-muted-foreground" data-testid="activity-no-rooms-hint">
                Ainda não há salas cadastradas.{' '}
                <AppLink href={roomsHref} className="font-medium text-primary underline underline-offset-2">
                  Cadastrar salas
                </AppLink>
              </p>
            ) : null}
          </div>

          {salaOnline.show ? (
            <Field
              label="Endereço da sala online"
              name="onlineUrl"
              type="url"
              placeholder="https://sala.exemplo.com/entrar"
              notice={salaOnline.notice}
              hint={salaOnline.hint}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          2. Horário, duração e vagas
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Início"
            name="startsAt"
            type="datetime-local"
            required
            value={startsAt}
            onChange={(event) => {
              const next = event.target.value;
              setStartsAt(next);
              syncDuration(next, endsAt);
            }}
          />

          <Field
            label="Término"
            name="endsAt"
            type="datetime-local"
            required
            value={endsAt}
            onChange={(event) => {
              const next = event.target.value;
              setEndsAt(next);
              syncDuration(startsAt, next);
            }}
          />

          <div className="space-y-1">
            <Field
              label="Carga horária (min)"
              name="workloadMinutes"
              type="number"
              min={1}
              required
              value={workload}
              onChange={(event) => {
                setWorkload(event.target.value);
                setWorkloadTouched(true);
              }}
            />
            <span className="block text-xs text-muted-foreground" data-testid="activity-workload-human">
              Equivale a <strong>{formatWorkloadHuman(parsedWorkload)}</strong> (calculado automaticamente pelo horário).
            </span>
          </div>

          <Field
            label="Vagas"
            name="capacity"
            type="number"
            min={0}
            hint="Em branco = sem limite. A sala escolhida passa a ser o teto destas vagas."
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          3. Inscrição e presença
        </h3>
        <div className="flex flex-wrap gap-4">
          <CheckboxField label="Exige inscrição individual" name="requiresRegistration" defaultChecked />
          <CheckboxField label="Habilitar lista de espera" name="waitlistEnabled" />
          <CheckboxField label="Destacar na página" name="isFeatured" />
          <CheckboxField label="Habilitar credenciamento" name="checkInEnabled" defaultChecked />
        </div>

        <p className="text-xs text-muted-foreground">
          Desmarque <strong>“Exige inscrição individual”</strong> para atividades abertas (palestra,
          mesa-redonda): quem se inscrever no evento entra nelas automaticamente, e vagas/lista de espera
          não se aplicam. Minicursos e oficinas normalmente exigem inscrição própria.
        </p>

        <ConfirmationFields
          policy="AUTO"
          windowDays={null}
          requirements={[]}
          place={null}
          instructions={null}
        />
      </div>
    </div>
  );
}
