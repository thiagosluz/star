'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';

import type { AdminActionState } from '@/app/actions/admin-actions';
import { Checkbox, Input, Select } from '@/components/ui';

/**
 * Moldura do campo do painel: rótulo envolvente + dica.
 *
 * Sem `htmlFor`/`id` de propósito — ver a nota em `Field`.
 */
function AdminFieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint ? <span className="block text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

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
          className={`space-y-1 text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
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

/**
 * Campo de texto do painel — agora sobre os primitivos do SISTEMA (FASE 11B).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ASSINATURA FOI MANTIDA, E POR QUE NÃO HÁ `id`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Estes três componentes existiam desde a FASE 7 com marcação e classes próprias
 *  (`rounded-md border bg-background px-3 py-2`), enquanto a FASE 11A criou o
 *  `Field` do sistema. Eram dois "campos" no mesmo produto: alturas diferentes,
 *  foco diferente e nenhum `aria-describedby`.
 *
 *  A unificação poderia reescrever as cinco páginas do painel… ou fazer o
 *  componente antigo USAR os controles do sistema. A segunda opção entrega o mesmo
 *  resultado visual e de acessibilidade sem tocar em telas já testadas.
 *
 *  A diferença para o `Field` do sistema é uma só: **aqui o rótulo é envolvente e
 *  não há `htmlFor`/`id`**. Motivo concreto: o painel tem vários formulários na
 *  MESMA página (criar sala, criar atividade, criar trilha) e eles repetem nomes de
 *  campo como `capacity`. Com `id={name}`, o documento ficaria com ids duplicados e
 *  o `for` poderia apontar para o controle de OUTRO formulário — foi assim que o
 *  E2E da jornada da FASE 7 quebrou (`getByLabel('Capacidade')` dentro do formulário
 *  de sala não encontrava o controle). Rótulo envolvente nomeia o controle sem
 *  depender de identificador único.
 *
 *  Para telas NOVAS, use `Field`/`fieldAria` do sistema (ids únicos por página).
 */
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
    <AdminFieldShell label={label} hint={hint}>
      <Input
        name={name}
        aria-label={label}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
      />
    </AdminFieldShell>
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
    <AdminFieldShell label={label} hint={hint}>
      <Select name={name} aria-label={label} defaultValue={defaultValue ?? undefined}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </AdminFieldShell>
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
    <label className="flex items-start gap-2.5 text-sm">
      <Checkbox name={name} defaultChecked={defaultChecked} className="mt-0.5" />
      <span className="min-w-0">
        <span className="font-medium text-foreground">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}
