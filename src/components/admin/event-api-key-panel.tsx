'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui';
import {
  eventApiKeyStateCopy,
  type EventApiKeyState,
} from '@/domain/api/event-api-organizer-rules';
import type { EventApiActionState } from '@/app/actions/event-api-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CHAVE DA API VISTA PELO ORGANIZADOR (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE PAINEL É CLIENTE, E POR QUE ELE FUNCIONA SEM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Gerar" e "Mostrar" devolvem a chave no RETORNO da ação — ela não pode ir para a
 *  URL (vazaria em histórico, Referer e log de acesso) nem para o banco em claro.
 *  O único lugar seguro para ela existir é o corpo da resposta da própria pessoa,
 *  e é exatamente o que `useActionState` faz: o `<form>` tem `action` de verdade,
 *  então o POST acontece com o bundle desligado, e o React renderiza o estado da
 *  ação na resposta do servidor (a prova está no E2E com `javaScriptEnabled:
 *  false`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REVOGAÇÃO TEM CONFIRMAÇÃO NATIVA, E ISSO É DECISÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O padrão da casa para ação destrutiva é o `ConfirmDialog`, que é um portão de
 *  JAVASCRIPT — e a tela inteira precisa funcionar sem ele (requisito desta fatia,
 *  a mesma régua da E50/F70). Por isso a confirmação é um `<details>` nativo: quem
 *  abre lê a consequência escrita e só então encontra o botão que NOMEIA o ato
 *  ("Revogar chave agora"). Perde-se o modal; não se perde o portão, e ele existe
 *  nos dois modos.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type EventApiFormAction = (
  prev: EventApiActionState | null,
  formData: FormData,
) => Promise<EventApiActionState>;

function SubmitButton({
  label,
  variant = 'primary',
  testId,
}: {
  label: string;
  variant?: 'primary' | 'outline' | 'destructive';
  testId: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} variant={variant} size="sm" data-testid={testId}>
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

/** O retorno da ação: erro anunciado, sucesso discreto (o efeito já está na tela). */
function ActionFeedback({ state, testId }: { state: EventApiActionState | null; testId: string }) {
  if (!state) return null;

  if (!state.ok) {
    return (
      <p
        role="alert"
        data-testid={`${testId}-feedback`}
        className="flex items-start gap-1.5 text-xs text-destructive"
      >
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {state.message}
      </p>
    );
  }

  return (
    <p
      role="status"
      data-testid={`${testId}-feedback`}
      className="flex items-start gap-1.5 text-xs text-success-strong"
    >
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {state.message}
    </p>
  );
}

/**
 * A chave em claro, uma vez.
 *
 * O aviso é parte do requisito, não enfeite: a chave não é mostrada de novo
 * "sozinha" (recarregar a tela não a traz), mas o selo existe justamente para o
 * organizador poder reexibi-la de propósito em "Mostrar chave".
 */
function KeyValue({ chave, testId }: { chave: string; testId: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-low p-3">
      <p className="text-sm font-medium text-foreground">Copie a chave agora</p>

      <pre
        tabIndex={0}
        aria-label="Chave da API do evento"
        data-testid={testId}
        className="code-data overflow-x-auto whitespace-pre-wrap break-all rounded-sm border border-border bg-card p-2 text-xs text-foreground"
      >
        {chave}
      </pre>

      <p className="text-xs text-muted-foreground" data-testid={`${testId}-notice`}>
        Esta é a única vez que a chave aparece sozinha. Ela não será mostrada de novo por
        acidente — recarregar a tela não a traz. Para vê-la outra vez, use{' '}
        <strong className="font-medium text-foreground">Mostrar chave</strong>: ela fica
        guardada de forma cifrada (AES-256-GCM) e o banco, sozinho, não consegue abri-la.
      </p>
    </div>
  );
}

export function EventApiKeyPanel({
  tenantSlug,
  eventId,
  state,
  criadaEmLabel,
  revogadaEmLabel,
  createAction,
  revealAction,
  revokeAction,
}: {
  tenantSlug: string;
  eventId: string;
  state: EventApiKeyState;
  criadaEmLabel: string | null;
  revogadaEmLabel: string | null;
  createAction: EventApiFormAction;
  revealAction: EventApiFormAction;
  revokeAction: EventApiFormAction;
}) {
  const [criacao, criarFormAction] = useActionState<EventApiActionState | null, FormData>(
    createAction,
    null,
  );
  const [revelacao, revelarFormAction] = useActionState<EventApiActionState | null, FormData>(
    revealAction,
    null,
  );
  const [revogacao, revogarFormAction] = useActionState<EventApiActionState | null, FormData>(
    revokeAction,
    null,
  );

  const copy = eventApiKeyStateCopy({
    state,
    criadaEmLabel,
    revogadaEmLabel,
  });

  return (
    <div className="space-y-4">
      <div
        className="space-y-2 rounded-lg border border-border bg-card p-4"
        data-testid="event-api-key-state"
      >
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <KeyRound className="size-4 shrink-0 text-primary" aria-hidden />
          <span data-testid="event-api-key-state-title">{copy.title}</span>
        </p>
        <p className="text-sm text-muted-foreground" data-testid="event-api-key-state-body">
          {copy.body}
        </p>
      </div>

      {state === 'ACTIVE' ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <form action={revelarFormAction} data-testid="event-api-reveal-form">
              <input type="hidden" name="tenantSlug" value={tenantSlug} />
              <input type="hidden" name="eventId" value={eventId} />
              <SubmitButton label="Mostrar chave" variant="outline" testId="event-api-reveal-submit" />
            </form>

            <ActionFeedback state={revelacao} testId="event-api-reveal" />
          </div>

          {revelacao?.ok && revelacao.chave ? (
            <KeyValue chave={revelacao.chave} testId="event-api-revealed-key" />
          ) : null}

          {/**
           * A revogação: `<details>` nativo + o botão que nomeia o ato. O texto diz
           * as duas coisas que importam — é imediata e não tem volta.
           */}
          <details
            className="rounded-lg border border-destructive/40 p-3"
            data-testid="event-api-revoke"
          >
            <summary className="cursor-pointer text-sm font-medium text-destructive">
              Revogar chave
            </summary>

            <div className="space-y-3 pt-3">
              <p className="text-sm text-foreground">
                Revogar é imediato: a próxima requisição com esta chave recebe 401 e quem a
                copiou perde o acesso na hora. Não há como desfazer — gerar outra chave é um ato
                novo.
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <form action={revogarFormAction} data-testid="event-api-revoke-form">
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="eventId" value={eventId} />
                  <SubmitButton
                    label="Revogar chave agora"
                    variant="destructive"
                    testId="event-api-revoke-submit"
                  />
                </form>

                <ActionFeedback state={revogacao} testId="event-api-revoke" />
              </div>
            </div>
          </details>
        </>
      ) : (
        <div className="space-y-3">
          <form action={criarFormAction} data-testid="event-api-create-form">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />
            <SubmitButton
              label={state === 'NONE' ? 'Gerar chave' : 'Gerar outra chave'}
              testId="event-api-create-submit"
            />
          </form>

          <ActionFeedback state={criacao} testId="event-api-create" />
        </div>
      )}

      {/**
       * A chave recém-criada aparece mesmo que o estado do servidor já tenha virado
       * ACTIVE (a revalidação acontece no mesmo gesto): o retorno da ação é a única
       * cópia que o organizador tem, e ela não pode desaparecer por causa de um
       * re-render. Depois de REVOGADA, porém, ela some: mostrar uma credencial morta
       * na mesma tela que anuncia o corte seria confuso — e o valor não vale mais.
       */}
      {criacao?.ok && criacao.chave && state !== 'REVOKED' ? (
        <KeyValue chave={criacao.chave} testId="event-api-new-key" />
      ) : null}

      {state === 'INVALID' ? (
        <p className="text-xs text-muted-foreground" data-testid="event-api-key-invalid">
          Gerar uma chave substitui a configuração inválida gravada neste evento.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground" data-testid="event-api-credential-warning">
        A chave é uma credencial: não a coloque no repositório, em código de cliente nem em
        página pública. Quem tem a chave lê tudo o que as seções ligadas expõem, e revogar é o
        único jeito de cortar esse acesso.
      </p>
    </div>
  );
}
