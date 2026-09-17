"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions/auth-actions";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Processando…" : label}
    </button>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {errors[0]}
    </p>
  );
}

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring/40";

export function AuthForm({
  mode,
  action,
  tenantSlug,
  redirectTo,
}: {
  mode: "signin" | "signup";
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  tenantSlug?: string;
  redirectTo?: string;
}) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    action,
    null,
  );

  const isSignUp = mode === "signup";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {tenantSlug ? <input type="hidden" name="tenantSlug" value={tenantSlug} /> : null}
      {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

      {state?.message ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}

      {isSignUp ? (
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Nome completo
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            minLength={3}
            maxLength={160}
            className={inputClass}
          />
          <FieldError errors={state?.fieldErrors?.name} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={255}
          className={inputClass}
        />
        <FieldError errors={state?.fieldErrors?.email} />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          required
          minLength={isSignUp ? 10 : undefined}
          maxLength={128}
          className={inputClass}
        />
        {isSignUp ? (
          <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres.</p>
        ) : null}
        <FieldError errors={state?.fieldErrors?.password} />
      </div>

      <SubmitButton label={isSignUp ? "Criar conta" : "Entrar"} />
    </form>
  );
}
