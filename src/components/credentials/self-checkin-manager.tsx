'use client';

import { useState } from 'react';
import { QrCode, Search } from 'lucide-react';

import type { SelfCheckinActionState } from '@/app/actions/self-checkin-actions';
import { SelfCheckinPointRow } from '@/components/credentials/self-checkin-point-row';
import { SelfCheckinPolicyForm } from '@/components/credentials/self-checkin-policy-form';
import { Badge, Input } from '@/components/ui';
import type { SelfCheckinConsoleData } from '@/lib/events/self-checkin-service';

type ActionFn = (
  prev: SelfCheckinActionState | null,
  formData: FormData,
) => Promise<SelfCheckinActionState>;

/** Orquestrador da gestão de autocredenciamento por QR Code (política antifraude + pontos do evento). */
export function SelfCheckinManager({
  tenantSlug,
  data,
  eventTimeZone = 'America/Sao_Paulo',
  canManageSecurity,
  savePolicyAction,
  upsertPointAction,
  regeneratePointAction,
  deletePointAction,
}: {
  tenantSlug: string;
  data: SelfCheckinConsoleData;
  eventTimeZone?: string;
  canManageSecurity: boolean;
  savePolicyAction: ActionFn;
  upsertPointAction: ActionFn;
  regeneratePointAction: ActionFn;
  deletePointAction: ActionFn;
}) {
  const [enabled, setEnabled] = useState(data.policy.enabled);
  const [activitySearch, setActivitySearch] = useState('');
  const [onlyWithQr, setOnlyWithQr] = useState(false);

  const normalizedFilter = activitySearch.trim().toLowerCase();
  const filteredActivities = data.activities.filter((act) => {
    if (onlyWithQr && !act.point) return false;
    if (!normalizedFilter) return true;
    const haystack = `${act.title} ${act.roomName ?? ''}`.toLowerCase();
    return haystack.includes(normalizedFilter);
  });
  const showPortaria =
    (!onlyWithQr || Boolean(data.portariaPoint)) &&
    (!normalizedFilter || 'portaria entrada geral'.includes(normalizedFilter));

  return (
    <section
      className="space-y-6 rounded-xl border border-border bg-surface-low p-5"
      aria-labelledby="autocredenciamento"
      data-testid="self-checkin-manager"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="autocredenciamento" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <QrCode className="size-5 text-primary" aria-hidden />
            Check-in autônomo e cartazes por QR Code
          </h2>
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? 'Autocredenciamento ativo' : 'Desativado'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Gere QR Codes para imprimir e fixar na portaria ou projetar no telão das salas. O próprio
          participante lê o cartaz com o celular e passa pelas travas de localização (GPS), PIN de sala,
          código rotativo de 60 s e anti-ubiquidade.
        </p>
      </header>

      {canManageSecurity ? (
        <SelfCheckinPolicyForm
          tenantSlug={tenantSlug}
          data={data}
          enabled={enabled}
          onEnabledChange={setEnabled}
          savePolicyAction={savePolicyAction}
        />
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-card px-3 py-2.5">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={activitySearch}
              onChange={(e) => setActivitySearch(e.target.value)}
              placeholder="Filtrar por sala ou nome da atividade…"
              aria-label="Filtrar pontos de QR"
              data-testid="self-checkin-activity-filter"
              className="pl-8 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyWithQr}
              onChange={(e) => setOnlyWithQr(e.target.checked)}
              data-testid="self-checkin-only-generated"
              className="size-3.5 rounded border-border"
            />
            Somente com QR gerado
          </label>
        </div>

        {showPortaria ? (
          <SelfCheckinPointRow
            tenantSlug={tenantSlug}
            eventId={data.eventId}
            eventTimeZone={eventTimeZone}
            activity={null}
            point={data.portariaPoint}
            selfDeclaredCount={data.portariaSelfDeclaredCount}
            canManageSecurity={canManageSecurity}
            upsertAction={upsertPointAction}
            regenerateAction={regeneratePointAction}
            deleteAction={deletePointAction}
          />
        ) : null}

        {filteredActivities.map((activity) => (
          <SelfCheckinPointRow
            key={activity.activityId}
            tenantSlug={tenantSlug}
            eventId={data.eventId}
            eventTimeZone={eventTimeZone}
            activity={activity}
            point={activity.point}
            selfDeclaredCount={activity.selfDeclaredCount}
            canManageSecurity={canManageSecurity}
            upsertAction={upsertPointAction}
            regenerateAction={regeneratePointAction}
            deleteAction={deletePointAction}
          />
        ))}

        {!showPortaria && filteredActivities.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            Nenhum ponto corresponde ao filtro aplicado.
          </p>
        ) : null}
      </div>
    </section>
  );
}
