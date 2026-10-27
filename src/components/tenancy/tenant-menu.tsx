"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import {
  switchTenantAction,
  type SwitchContextState,
} from "@/app/actions/context-actions";
import { cn } from "@/lib/utils/cn";

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
  /**
   * O contexto atual, quando a casca sabe qual é.
   *
   * No painel de PLATAFORMA a pessoa não está "dentro" de instituição nenhuma:
   * o menu continua listando os vínculos (é a porta de volta), mas nenhum deles
   * é marcado como atual — daí o `undefined` ser legítimo aqui.
   */
  currentSlug?: string;
}) {
  const [state, formAction] = useActionState<SwitchContextState | null, FormData>(
    switchTenantAction,
    null,
  );
  const { pending } = useFormStatus();

  const isCurrent = currentSlug !== undefined && membership.tenantSlug === currentSlug;
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
  compact = false,
  label,
}: {
  memberships: readonly MembershipSummary[];
  /**
   * O contexto atual — opcional desde a FASE 82 · fatia 3.
   *
   * A casca da instituição sempre passa o slug da instituição ativa. A da
   * PLATAFORMA não tem "instituição atual" (o operador está na governança), mas
   * precisa do menu mesmo assim: é dele que saem "Minha conta" e "Ver todas as
   * instituições" — as duas portas que a ausência do bloco fechava. Sem slug,
   * nenhuma linha é marcada como atual e TODAS as ativas viram botão "Entrar".
   */
  currentSlug?: string;
  children: React.ReactNode;
  /**
   * Barra recolhida (FASE 59): o gatilho vira quadrado.
   *
   * O bloco de conta sumiria da barra se o menu não soubesse encolher — e com ele
   * iria o único caminho para trocar de instituição. O painel aberto continua com
   * a largura de sempre (`w-72`), porque encolher o menu suspenso deixaria os
   * nomes das instituições ilegíveis: quem está recolhido é a barra, não a
   * informação.
   */
  compact?: boolean;
  /**
   * Nome acessível explícito para o gatilho.
   *
   * Na barra recolhida o texto que nomeia o `<summary>` está em `sr-only` e o
   * avatar é decorativo: sem um rótulo, o gatilho chegaria ao leitor de tela como
   * um controle sem nome — a mesma falha que reprova um link só com ícone.
   */
  label?: string;
}) {
  return (
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O MENU DA CONTA ENCOLHE (FASE 61 — defeito de layout relatado)
     * ─────────────────────────────────────────────────────────────────────────────
     *  Este `<details>` é um ITEM FLEX dentro da linha do bloco de conta, ao lado do
     *  controle de tema e do botão de sair (dois `size-9`). Sem `min-w-0` aqui e no
     *  `<summary>`, o item não encolhe abaixo do próprio conteúdo — `min-width: auto`
     *  é o padrão do flexbox —, e a linha empurrava os dois botões para FORA da barra:
     *  o de sair aparecia cortado na borda.
     *
     *  Com `min-w-0` a cadeia inteira passa a poder truncar: o nome e o e-mail são
     *  `truncate`, o chevron não encolhe, e os botões mantêm o tamanho.
     */
    <details className="group relative min-w-0">
      <summary
        aria-label={label}
        data-testid="account-tenant-menu"
        className={cn(
          'flex min-w-0 cursor-pointer list-none items-center gap-2 rounded-md border border-border text-sm transition hover:bg-accent',
          compact ? 'size-9 justify-center p-0' : 'px-3 py-1.5',
        )}
      >
        {children}
        {compact ? null : (
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground transition group-open:rotate-180"
            aria-hidden
          />
        )}
      </summary>

      <div className="absolute left-0 bottom-full z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
        <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Trocar de instituição
        </p>

        {/**
         * ───────────────────────────────────────────────────────────────────────────
         *  QUANDO A LISTA APARECE (FASE 82 · fatia 3)
         * ───────────────────────────────────────────────────────────────────────────
         *  Com UM vínculo e um contexto atual (a casca da instituição), a linha do
         *  seletor é "Contexto atual" — ela já é o lugar onde a pessoa está, e um
         *  botão "Entrar" ali não teria destino diferente do atual.
         *
         *  Na casca de PLATAFORMA não existe "contexto atual" (`currentSlug`
         *  ausente): TODOS os vínculos entram na lista, inclusive quando há um só.
         *  É o que dá ao operador o caminho DIRETO de volta para a instituição —
         *  a porta que a ausência do menu fechava. Sem vínculo nenhum a lista não
         *  teria conteúdo, e a frase abaixo diz a verdade em vez de "apenas esta
         *  instituição", que seria falsa.
         */}
        {memberships.length > 1 || (currentSlug === undefined && memberships.length > 0) ? (
          <ul className="max-h-72 overflow-y-auto py-1">
            {memberships.map((membership) => (
              <MenuItem
                key={membership.tenantId}
                membership={membership}
                currentSlug={currentSlug}
              />
            ))}
          </ul>
        ) : memberships.length === 1 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Você tem acesso a apenas esta instituição.
          </p>
        ) : (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Sua conta ainda não está vinculada a nenhuma instituição.
          </p>
        )}

        <div className="border-t border-border p-2">
          {/*
            "Minha conta" entra aqui, e não no menu lateral, porque é o único lugar que
            existe em TODAS as telas (dentro ou fora de instituição) e sempre ao lado do
            nome de quem está logado — que é o dado que a tela edita (FASE 47). A área é
            global: nome, e-mail, senha, segundo fator e dispositivos valem em qualquer
            casa.
          */}
          <a
            href="/conta"
            className="block rounded-md px-3 py-2 text-xs font-medium transition hover:bg-accent"
            data-testid="menu-my-account"
          >
            Minha conta
          </a>
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
