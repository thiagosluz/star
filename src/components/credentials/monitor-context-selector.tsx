'use client';

export interface MonitorActivity {
  id: string;
  title: string;
  startsAtIso: string;
  endsAtIso: string;
  roomName: string | null;
  /** A atividade está acontecendo agora (sugestão de contexto). */
  isNow: boolean;
  /** O credenciamento dela está desligado — o monitor precisa saber antes de ler. */
  checkInEnabled: boolean;
}

export type MonitorContextKind = 'EVENT' | 'ACTIVITY';
export type MonitorMode = 'TOGGLE' | 'IN' | 'OUT';

/** Seletor de contexto (Portaria do evento vs. Atividade específica). */
export function MonitorContextCard({
  contextKind,
  activityId,
  activities,
  contextLabel,
  onContextKindChange,
  onActivityChange,
}: {
  contextKind: MonitorContextKind;
  activityId: string;
  activities: readonly MonitorActivity[];
  contextLabel: string;
  onContextKindChange: (kind: MonitorContextKind) => void;
  onActivityChange: (activityId: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-surface-low p-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs font-medium">
        Onde esta leitura vale
        <select
          value={contextKind}
          onChange={(event) => onContextKindChange(event.target.value as MonitorContextKind)}
          aria-label="Contexto da leitura"
          data-testid="monitor-context-kind"
          className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
        >
          <option value="EVENT">Portaria do evento — registra a chegada</option>
          <option value="ACTIVITY">Atividade — registra a frequência</option>
        </select>
      </label>

      {contextKind === 'ACTIVITY' ? (
        <label className="space-y-1 text-xs font-medium">
          Atividade
          <select
            value={activityId}
            onChange={(event) => onActivityChange(event.target.value)}
            aria-label="Atividade da leitura"
            data-testid="monitor-activity"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            {activities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.title}
                {activity.roomName ? ` · ${activity.roomName}` : ''}
                {activity.isNow ? ' (acontecendo agora)' : ''}
                {activity.checkInEnabled ? '' : ' · credenciamento desligado'}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="text-xs text-muted-foreground sm:col-span-2" data-testid="monitor-context-label">
        Lendo em: <strong className="font-medium text-foreground">{contextLabel}</strong>
      </p>
    </div>
  );
}

/** Seletor de sentido operacional da leitura (Entrada, Alternado ou Saída). */
export function MonitorModeSelector({
  mode,
  onChange,
}: {
  mode: MonitorMode;
  onChange: (nextMode: MonitorMode) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface-low p-3" data-testid="monitor-mode-selector">
      <span className="block text-xs font-medium text-foreground">Sentido da leitura / Modo de operação</span>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="monitor-mode-in"
          onClick={() => onChange('IN')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
            mode === 'IN'
              ? 'bg-success text-success-foreground border-success shadow-xs'
              : 'border-border bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          <span className="size-2 rounded-full bg-current" />
          Somente Entrada
        </button>
        <button
          type="button"
          data-testid="monitor-mode-toggle"
          onClick={() => onChange('TOGGLE')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
            mode === 'TOGGLE'
              ? 'bg-primary text-primary-foreground border-primary shadow-xs'
              : 'border-border bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          <span className="size-2 rounded-full bg-current" />
          Alternado (Entrada / Saída)
        </button>
        <button
          type="button"
          data-testid="monitor-mode-out"
          onClick={() => onChange('OUT')}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold border transition ${
            mode === 'OUT'
              ? 'bg-destructive text-destructive-foreground border-destructive shadow-xs'
              : 'border-border bg-background hover:bg-muted text-muted-foreground'
          }`}
        >
          <span className="size-2 rounded-full bg-current" />
          Somente Saída
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === 'IN'
          ? 'Em "Somente Entrada", leituras duplas em rajada avisam que a pessoa já está dentro sem fechar a presença.'
          : mode === 'OUT'
            ? 'Em "Somente Saída", fecha sessões em aberto sem registrar novas entradas.'
            : 'Em "Alternado", o sistema decide sozinho: entra quem está fora, sai quem está dentro.'}
      </p>
    </div>
  );
}
