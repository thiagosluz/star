'use client';

import type { ReactNode } from 'react';

import { Input, Select } from '@/components/ui';
import type { EditorModel } from '@/components/admin/certificate-template/types';

/** Barra superior de identidade e salvamento do modelo de certificado (FASE 134 · ADR-526). */
export function TemplateIdentityBar({
  model,
  eventTitle,
  kinds,
  submitSlot,
}: {
  model: EditorModel;
  eventTitle: string | null;
  kinds: { value: string; label: string }[];
  submitSlot: ReactNode;
}) {
  return (
    <div
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      data-testid="template-identity-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="template-draft-badge"
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              model.templateId
                ? 'bg-success-soft text-success-strong'
                : 'bg-warning-soft text-warning-strong'
            }`}
          >
            {model.templateId ? 'Modelo salvo' : 'Rascunho não salvo'}
          </span>
          <span className="text-xs text-muted-foreground" data-testid="template-event-fixed">
            {model.eventId
              ? `Vale somente para este evento (${eventTitle ?? 'evento da rota'})`
              : 'Padrão de toda a instituição (todos os eventos)'}
          </span>
          {model.eventId ? <input type="hidden" name="eventId" value={model.eventId} /> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">{submitSlot}</div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-foreground">
          <span>Nome do modelo</span>
          <Input name="name" defaultValue={model.name} required maxLength={120} data-testid="template-name" />
        </label>

        <label className="space-y-1 text-xs font-medium text-foreground">
          <span>Para quem é este certificado?</span>
          <Select name="kind" defaultValue={model.kind} data-testid="template-kind">
            <option value="">Qualquer tipo de certificado</option>
            {kinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-1 text-xs font-medium text-foreground">
          <span>Formato da folha</span>
          <Select name="page" defaultValue={model.page} data-testid="template-page">
            <option value="A4_LANDSCAPE">A4 paisagem (297 × 210 mm)</option>
            <option value="A4_PORTRAIT">A4 retrato (210 × 297 mm)</option>
          </Select>
        </label>
      </div>
    </div>
  );
}
