'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOTÃO "EXECUTAR AGORA" DE UMA ROTINA (FASE 36)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE SE ATUALIZA SOZINHO DEPOIS DE RESPONDER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O pedido vai para a FILA: quem roda é o worker (ver `runJobNowAction`). A lista do
 *  painel lê `job_runs`, e a linha só nasce quando o worker terminar — alguns
 *  segundos depois da resposta. Sem o `router.refresh()` o operador leria "pedido
 *  enviado" e veria a lista intacta, sem saber se funcionou.
 *
 *  O atraso é deliberado e o `ref` garante UM refresh por resposta: uma rotina de
 *  varredura leva segundos, e recarregar na mesma hora mostraria a lista velha de
 *  novo (armadilha 78 — "ainda não chegou" não é "não aconteceu").
 *
 *  `router.refresh()` re-renderiza o servidor SEM remontar o componente cliente, então
 *  a mensagem de retorno continua na tela enquanto a lista se atualiza.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2, Play } from 'lucide-react';

import { runJobNowAction, type PlatformActionState } from '@/app/actions/platform-actions';

const INITIAL: PlatformActionState | null = null;

/** Tempo para o worker pegar o job e gravar o registro antes de reler a lista. */
const REFRESH_DELAY_MS = 2_500;

function Trigger({ job, label }: { job: string; label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Executar agora a rotina ${label}`}
      data-testid={`run-job-submit-${job}`}
      className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-surface-low disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Play className="size-3.5" aria-hidden />
      )}
      {pending ? 'Pedindo…' : 'Executar agora'}
    </button>
  );
}

export function RunJobButton({ job, label }: { job: string; label: string }) {
  const [state, action] = useActionState(runJobNowAction, INITIAL);
  const router = useRouter();
  const handled = useRef<PlatformActionState | null>(null);

  useEffect(() => {
    if (!state?.ok || handled.current === state) return;

    handled.current = state;
    const timer = setTimeout(() => router.refresh(), REFRESH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [state, router]);

  return (
    <div className="flex flex-col items-end gap-1.5" data-testid={`run-job-${job}`}>
      <form action={action}>
        <input type="hidden" name="job" value={job} />
        <Trigger job={job} label={label} />
      </form>

      {state ? (
        <p
          data-testid={`run-job-feedback-${job}`}
          data-ok={state.ok ? 'true' : 'false'}
          role="status"
          className={`max-w-[22rem] text-right text-xs ${
            state.ok ? 'text-muted-foreground' : 'text-destructive'
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
