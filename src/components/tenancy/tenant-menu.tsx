"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import {
  switchTenantAction,
  type SwitchContextState,
} from "@/app/actions/context-actions";

export interface MembershipSummary {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "REMOVED";
  roles: readonly string[];
}

function MenuItem({
  membership,
  currentSlug,
}: {
  membership: MembershipSummary;
  currentSlug: string;
}) {
  const [state, formAction] = useActionState<SwitchContextState | null, FormData>(
    switchTenantAction,
    null,
  );
  const { pending } = useFormStatus();

  const isCurrent = membership.tenantSlug === currentSlug;
  const isInvite = membership.status === "INVITED";

  return (
    <li>
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={membership.tenantSlug} />
        <input type="hidden" name="redirectTo" value="/dashboard" />
        <button
          type="submit"
          disabled={isCurrent || isInvite || pending}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-accent disabled:opacity-60 disabled:hover:bg-transparent"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{membership.tenantName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {membership.roles.join(" · ") || "Sem papel"}
              {isInvite ? " · convite pendente" : ""}
            </span>
          </span>
          {isCurrent ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
        </button>
      </form>
      {state?.message ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Menu de troca de instituição no cabeçalho.
 *
 * Cada opção é um formulário independente que chama a Server Action de troca.
 * Não há novo login: apenas o cookie de contexto é reescrito, então os
 * componentes de cliente permanecem montados.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O PAINEL ABRE PARA CIMA (FASE 15) E ANCORADO À ESQUERDA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O gatilho é o ÚLTIMO elemento de uma barra lateral de altura total: abrir o painel
 *  para baixo (`mt-2`) o coloca fora da tela em qualquer monitor de 720 px de altura, e
 *  o clique nunca acontece — o E2E da troca de contexto reprovava com "element is
 *  outside of the viewport", e na prática a troca de instituição parecia travada. Como
 *  o bloco de conta vive no rodapé do shell (desktop e gaveta), a direção certa é
 *  sempre para CIMA.
 *
 *  Além disso, o menu fica ancorado à ESQUERDA (`left-0`): como o bloco de conta fica
 *  na barra lateral esquerda (a 16 px da borda da tela), usar `right-0` projetava o
 *  painel de largura `w-72` ~60 px para fora da tela à esquerda, cortando o início
 *  dos textos.
 */
export function TenantMenu({
  memberships,
  currentSlug,
  children,
}: {
  memberships: readonly MembershipSummary[];
  currentSlug: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-accent">
        {children}
        <ChevronDown
          className="size-3.5 text-muted-foreground transition group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="absolute left-0 bottom-full z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Trocar de instituição
        </p>

        {memberships.length > 1 ? (
          <ul className="max-h-72 overflow-y-auto py-1">
            {memberships.map((membership) => (
              <MenuItem
                key={membership.tenantId}
                membership={membership}
                currentSlug={currentSlug}
              />
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Você tem acesso a apenas esta instituição.
          </p>
        )}

        <div className="border-t border-border p-2">
          <a
            href="/selecionar-instituicao"
            className="block rounded-md px-3 py-2 text-xs font-medium transition hover:bg-accent"
          >
            Ver todas as instituições
          </a>
        </div>
      </div>
    </details>
  );
}
