'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Eraser } from 'lucide-react';

import {
  eraseMyFormResponsesAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="ef-button-outline text-xs" disabled={pending}>
      <Eraser className="size-3.5" aria-hidden />
      {pending ? 'Apagando…' : 'Apagar as minhas respostas'}
    </button>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APAGAR AS MINHAS RESPOSTAS DO FORMULÁRIO (FASE 70 · fatia 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO É ESTA TELA, E NÃO A INSCRIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa chega aqui por "Minhas inscrições" — o lugar onde ela já vê o que tem,
 *  e o mesmo onde ela cancela. Não é a página do evento: a eliminação é sobre a
 *  INSCRIÇÃO dela, e a página pública do evento é de todo mundo. E não há item de menu
 *  novo: um menu a mais mexeria na barra inteira (e nas linhas de base de pixel da
 *  F62) para oferecer um caminho que já está a um clique daqui.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM JAVASCRIPT, E SEM JANELA DE CONFIRMAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `<details>` nativo abre por clique do navegador e o envio é um POST de
 *  formulário de verdade (a mesma moldura do "Completar meus dados", da F70, e do
 *  editor do organizador). A confirmação é o PRÓPRIO `<details>`: ele mostra, antes do
 *  botão, o que sai e o que fica. Isso é mais honesto do que um diálogo — o texto fica
 *  na tela depois do clique, e não desaparece com ele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS CORES SÃO TOKENS DO TEMA — NADA DE OPACIDADE EM TEXTO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O corpo usa `text-muted-foreground` (o papel do tema, preso pelo contraste do
 *  design system) e o aviso do que FICA usa `text-foreground`. A família do defeito da
 *  F66 é texto sobre superfície com `opacity`, e ela não volta por aqui.
 */
export function EraseFormResponsesButton({
  tenantSlug,
  eventSlug,
}: {
  tenantSlug: string;
  eventSlug: string;
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    eraseMyFormResponsesAction,
    null,
  );

  if (state?.ok) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="erase-form-responses-result">
        {state.message}
      </p>
    );
  }

  return (
    <details className="w-full" data-testid="erase-form-responses">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Apagar as minhas respostas do formulário
      </summary>

      <div className="mt-2 space-y-2 rounded-md border border-border p-3">
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">Sai:</strong> o que você respondeu
          nos campos que a organização declarou, e a sua anotação de acessibilidade ou
          restrição alimentar.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium text-foreground">Fica:</strong> a sua inscrição, a
          sua vaga, o seu histórico e o direito ao certificado. Ficam também o seu CPF (é
          ele que identifica o seu certificado) e os seus consentimentos (é a prova de que
          você autorizou o tratamento dos seus dados).
        </p>

        <form action={formAction} className="space-y-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventSlug" value={eventSlug} />

          {state && !state.ok && state.message ? (
            <p
              role="alert"
              className="text-xs text-destructive"
              data-testid="erase-form-responses-error"
            >
              {state.message}
            </p>
          ) : null}

          <SubmitButton />
        </form>
      </div>
    </details>
  );
}
