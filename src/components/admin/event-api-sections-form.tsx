'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { Button, Checkbox } from '@/components/ui';
import {
  EVENT_API_SECTION_INFO,
  type EventApiKeyState,
} from '@/domain/api/event-api-organizer-rules';
import type { EventApiSectionToggles } from '@/domain/api/event-api-key-rules';
import type { EventApiActionState } from '@/app/actions/event-api-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OS INTERRUPTORES DAS SEÇÕES (FASE 72 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CADA INTERRUPTOR TEM O NOME DO RECURSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `name="palestrantes"` não é decoração: é o campo que a Server Action lê, e o
 *  recurso que ele liga é o mesmo `/palestrantes`. Um único booleano "expor tudo"
 *  faria o organizador escolher entre expor demais e não expor nada.
 *
 *  `defaultChecked` (e não estado controlado) é o que mantém o gesto nativo: com o
 *  bundle desligado o checkbox funciona e o POST leva o campo; com JavaScript, a
 *  resposta revalida a tela e o formulário redesenha o estado gravado.
 *
 *  O formulário só aparece quando há chave ATIVA — o serviço recusa interruptor sem
 *  chave, e um controle que só pode falhar é pior do que um controle ausente com a
 *  explicação ao lado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function EventApiSectionsForm({
  tenantSlug,
  eventId,
  state,
  secoes,
  action,
}: {
  tenantSlug: string;
  eventId: string;
  state: EventApiKeyState;
  secoes: EventApiSectionToggles;
  action: (
    prev: EventApiActionState | null,
    formData: FormData,
  ) => Promise<EventApiActionState>;
}) {
  const [retorno, formAction] = useActionState<EventApiActionState | null, FormData>(action, null);

  if (state !== 'ACTIVE') {
    return (
      <ul className="divide-y divide-border rounded-lg border border-border" data-testid="event-api-sections-static">
        {EVENT_API_SECTION_INFO.map((info) => (
          <li key={info.section} className="space-y-1 p-3">
            <p className="text-sm font-medium text-foreground">
              {info.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">desligada</span>
            </p>
            <p className="text-xs text-muted-foreground">{info.description}</p>
          </li>
        ))}

        <li className="p-3 text-xs text-muted-foreground">
          Os interruptores ficam disponíveis quando houver uma chave ativa.
        </li>
      </ul>
    );
  }

  return (
    <form action={formAction} data-testid="event-api-sections-form" className="space-y-4">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />

      <ul className="divide-y divide-border rounded-lg border border-border">
        {EVENT_API_SECTION_INFO.map((info) => {
          const id = `event-api-section-${info.section}`;

          return (
            <li key={info.section} className="flex items-start gap-3 p-3">
              <Checkbox
                id={id}
                name={info.section}
                value="on"
                defaultChecked={secoes[info.section]}
                data-testid={id}
                className="mt-0.5"
              />

              <label htmlFor={id} className="min-w-0 space-y-1">
                <span className="block text-sm font-medium text-foreground">{info.label}</span>
                <span className="block text-xs text-muted-foreground">{info.description}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitSecoes />

        {retorno && !retorno.ok ? (
          <p
            role="alert"
            data-testid="event-api-sections-feedback"
            className="flex items-start gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {retorno.message}
          </p>
        ) : null}

        {retorno?.ok ? (
          <p
            role="status"
            data-testid="event-api-sections-feedback"
            className="flex items-start gap-1.5 text-xs text-success-strong"
          >
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {retorno.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

function SubmitSecoes() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} size="sm" data-testid="event-api-sections-submit">
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      Salvar seções
    </Button>
  );
}
