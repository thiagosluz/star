"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Check } from "lucide-react";

import {
  switchTenantAction,
  type SwitchContextState,
} from "@/app/actions/context-actions";
import { cn } from "@/lib/utils/cn";

export interface TenantOption {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  roles: readonly string[];
  isPrivileged: boolean;
}

/**
 * Botão de troca de contexto.
 *
 * A troca é um POST para uma Server Action que revalida o vínculo no banco e
 * reescreve apenas o cookie de contexto. A sessão de autenticação permanece
 * intacta — nenhum novo login acontece.
 */
function SwitchButton({ disabled, isCurrent }: { disabled: boolean; isCurrent: boolean }) {
  const { pending } = useFormStatus();

  if (isCurrent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <Check className="size-3.5" aria-hidden />
        Contexto atual
      </span>
    );
  }

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition",
        disabled
          ? "cursor-not-allowed border border-border text-muted-foreground opacity-60"
          : "bg-primary text-primary-foreground hover:opacity-90",
      )}
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

function TenantRow({
  option,
  isCurrent,
  redirectTo,
}: {
  option: TenantOption;
  isCurrent: boolean;
  redirectTo: string;
}) {
  const [state, formAction] = useActionState<SwitchContextState | null, FormData>(
    switchTenantAction,
    null,
  );

  const isInvite = option.status === "INVITED";

  return (
    <li className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {option.tenantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={option.tenantLogoUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            <Building2 className="size-4 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0">
          <p className="truncate font-medium">{option.tenantName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {option.roles.length > 0 ? option.roles.join(" · ") : "Sem papel atribuído"}
            {isInvite ? " · convite pendente" : ""}
          </p>
          {state?.message ? (
            <p role="alert" className="text-xs text-destructive">
              {state.message}
            </p>
          ) : null}
        </div>
      </div>

      <form action={formAction} className="shrink-0">
        <input type="hidden" name="tenantSlug" value={option.tenantSlug} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <SwitchButton disabled={isInvite} isCurrent={isCurrent} />
      </form>
    </li>
  );
}

export function TenantSwitcher({
  options,
  currentSlug,
  redirectTo,
}: {
  options: readonly TenantOption[];
  currentSlug: string | null;
  redirectTo: string;
}) {
  return (
    <ul className="space-y-3" data-testid="tenant-options">
      {options.map((option) => (
        <TenantRow
          key={option.tenantId}
          option={option}
          isCurrent={option.tenantSlug === currentSlug}
          redirectTo={redirectTo}
        />
      ))}
    </ul>
  );
}
