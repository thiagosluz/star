'use client';

import { useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Gift, Loader2, Target } from 'lucide-react';

import type { GamificationActionState } from '@/app/actions/gamification-actions';
import { celebrate } from '@/components/gamification/celebration';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Painel de missões
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O RESGATE É UM BOTÃO, E NÃO AUTOMÁTICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A recompensa automática é invisível: o participante cumpre uma meta e nada
 *  acontece na tela. O resgate explícito transforma o cumprimento em um momento —
 *  com confete, XP aparecendo e carta sendo revelada. É o retorno que faz o
 *  sistema valer a pena para quem participa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface MissionItem {
  taskDefinitionId: string;
  name: string;
  description: string | null;
  kindLabel: string;
  triggerLabel: string;
  xpReward: number;
  rewardCardSlug: string | null;
  progress: number;
  target: number;
  ratio: number;
  status: string;
  claimable: boolean;
  statusLabel: string;
}

function ClaimButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="mission-claim"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Gift className="size-3.5" aria-hidden />
      )}
      {pending ? 'Resgatando…' : label}
    </button>
  );
}

function MissionRow({
  mission,
  tenantSlug,
  action,
}: {
  mission: MissionItem;
  tenantSlug: string;
  action: (prev: GamificationActionState | null, formData: FormData) => Promise<GamificationActionState>;
}) {
  const [state, formAction] = useActionState<GamificationActionState | null, FormData>(action, null);

  useEffect(() => {
    if (state?.ok && state.data) {
      const leveledUp = Boolean(state.data.leveledUp) || Boolean(state.data.prestiged);
      const cards = Array.isArray(state.data.cards) ? state.data.cards.length : 0;
      celebrate({ intensity: leveledUp ? 'high' : cards > 0 ? 'medium' : 'low' });
    }
  }, [state]);

  const percent = Math.round(mission.ratio * 100);

  return (
    <li
      className="space-y-2 rounded-lg border border-border bg-card p-4"
      data-testid={`mission-${mission.taskDefinitionId}`}
      data-status={mission.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Target className="size-3.5 text-muted-foreground" aria-hidden />
            {mission.name}
          </p>
          {mission.description ? (
            <p className="text-xs text-muted-foreground">{mission.description}</p>
          ) : null}
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {mission.kindLabel} · {mission.triggerLabel}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {mission.progress}/{mission.target}
          </span>

          {mission.xpReward > 0 ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium">
              +{mission.xpReward} XP
            </span>
          ) : null}

          {mission.claimable ? (
            <form action={formAction}>
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="taskDefinitionId" value={mission.taskDefinitionId} />
              <ClaimButton label="Resgatar" />
            </form>
          ) : (
            <span
              className="text-[11px] text-muted-foreground"
              data-testid={`mission-status-${mission.taskDefinitionId}`}
            >
              {mission.statusLabel}
            </span>
          )}
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            mission.status === 'CLAIMED'
              ? 'bg-green-600'
              : mission.claimable
                ? 'bg-amber-400'
                : 'bg-primary'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {state ? (
        <p
          role={state.ok ? undefined : 'alert'}
          className={`flex items-center gap-1.5 text-xs ${
            state.ok ? 'text-green-600' : 'text-destructive'
          }`}
          data-testid={`mission-feedback-${mission.taskDefinitionId}`}
        >
          {state.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

export function MissionList({
  missions,
  tenantSlug,
  action,
}: {
  missions: readonly MissionItem[];
  tenantSlug: string;
  action: (prev: GamificationActionState | null, formData: FormData) => Promise<GamificationActionState>;
}) {
  if (missions.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Nenhuma missão disponível no momento. Participe das atividades do evento para desbloquear
        novas metas.
      </p>
    );
  }

  return (
    <ul className="space-y-3" data-testid="mission-list">
      {missions.map((mission) => (
        <MissionRow key={mission.taskDefinitionId} mission={mission} tenantSlug={tenantSlug} action={action} />
      ))}
    </ul>
  );
}
