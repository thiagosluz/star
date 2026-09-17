'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';

import type { AdminActionState } from '@/app/actions/admin-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Formulário do painel administrativo
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE GENÉRICO, E NÃO UM POR ENTIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Evento, sala, atividade, trilha, carta e missão têm o MESMO comportamento de
 *  formulário: enviar, mostrar "salvando", exibir o resultado (sucesso OU os
 *  motivos da recusa) e revalidar a página. Seis componentes quase idênticos
 *  divergiriam no primeiro ajuste — e a divergência apareceria como um formulário
 *  que não mostra o erro.
 *
 *  Os CAMPOS vêm como filhos (renderizados no servidor): o componente cuida do
 *  ciclo de envio, não do conteúdo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="admin-submit"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {pending ? 'Salvando…' : label}
    </button>
  );
}

export function AdminForm({
  action,
  submitLabel,
  testId,
  children,
  compact = false,
}: {
  action: (prev: AdminActionState | null, formData: FormData) => Promise<AdminActionState>;
  submitLabel: string;
  testId: string;
  children: React.ReactNode;
  /** Formulários de edição ficam fechados por padrão (ver `<details>` nas páginas). */
  compact?: boolean;
}) {
  const [state, formAction] = useActionState<AdminActionState | null, FormData>(action, null);

  return (
    <form action={formAction} className={compact ? 'space-y-3' : 'space-y-4'} data-testid={testId}>
      {children}

      <SubmitButton label={submitLabel} />

      {state ? (
        <div
          role={state.ok ? 'status' : 'alert'}
          data-testid={`${testId}-feedback`}
          className={`space-y-1 text-sm ${state.ok ? 'text-green-700' : 'text-destructive'}`}
        >
          <p className="flex items-center gap-1.5">
            {state.ok ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <AlertCircle className="size-4" aria-hidden />
            )}
            {state.message}
          </p>

          {state.details?.length ? (
            <ul className="ml-5 list-disc text-xs">
              {state.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

/** Campo de texto com rótulo, usado nas páginas do painel. */
export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required = false,
  placeholder,
  hint,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
}) {
  return (
    <label className="block space-y-1 text-xs font-medium">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
      />
      {hint ? <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Seleção com opções fixas (enums do domínio). */
export function SelectField({
  label,
  name,
  options,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string | null;
  hint?: string;
}) {
  return (
    <label className="block space-y-1 text-xs font-medium">
      {label}
      <select
        name={name}
        defaultValue={defaultValue ?? undefined}
        aria-label={label}
        className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Caixa de seleção (booleanos do domínio). */
export function CheckboxField({
  label,
  name,
  defaultChecked = false,
  hint,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-3.5" />
      <span>
        <span className="font-medium">{label}</span>
        {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
