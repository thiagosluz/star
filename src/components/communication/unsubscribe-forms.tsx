'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS DECISÕES DA PÁGINA DE DESCADASTRO (FASE 67 · fatia 3 · FASE 69 · E88)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM COMPONENTE DE CLIENTE, SE A PÁGINA INTEIRA É DO SERVIDOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As duas ações são `POST` (Server Action) e o resultado precisa aparecer ao lado
 *  do botão, sem tirar a pessoa da página. `useActionState` é o caminho que o
 *  projeto já usa em toda tela com ação (convite, campanha, reenvio de e-mail), e
 *  ele exige o limite de cliente.
 *
 *  O que NÃO é de cliente: o texto da página, de quem é a instituição, o nome de
 *  quem está lendo, o que para e o que continua chegando. Tudo isso é renderizado
 *  no servidor e chega pronto — a página funciona como documento mesmo antes de a
 *  hidratação acontecer.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN VAI EM CAMPO OCULTO, E NÃO NA `action`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão do aceite de convite (FASE 15): ele já está no CAMINHO da barra de
 *  endereços, e repeti-lo na URL do formulário só o espalharia por log, histórico e
 *  referenciador. Ele viaja no `FormData`, e a ação o confere contra o HMAC antes de
 *  ler qualquer coisa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, BellRing, CheckCircle2, Loader2, MailX } from 'lucide-react';

import {
  confirmResubscribeAction,
  confirmUnsubscribeAction,
  type UnsubscribeActionState,
} from '@/app/actions/unsubscribe-actions';
import {
  MAX_UNSUBSCRIBE_REASON_LENGTH,
  UNSUBSCRIBE_REASON_CHOICES,
  UNSUBSCRIBE_REASON_FIELD,
  UNSUBSCRIBE_REASON_NOTE_FIELD,
} from '@/domain/communication/unsubscribe-reason-rules';
import { Input } from '@/components/ui/form';

function SubmitButton({
  label,
  testId,
  variant,
  icon,
}: {
  label: string;
  testId: string;
  variant: 'primary' | 'outline';
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid={testId}
      className={variant === 'primary' ? 'ef-button' : 'ef-button-outline'}
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {label}
    </button>
  );
}

function Feedback({ state, testId }: { state: UnsubscribeActionState | null; testId: string }) {
  if (!state?.message) return null;

  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      data-testid={testId}
      data-ok={state.ok ? 'true' : 'false'}
      className="flex items-start gap-2 text-sm"
    >
      {state.ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{state.message}</span>
    </p>
  );
}

/**
 * A CONFIRMAÇÃO DA SAÍDA. Uma decisão, um botão, e o resultado ao lado.
 *
 * O botão diz o que acontece ("Parar de receber os recados") e não "Confirmar":
 * quem chegou até aqui clicou em algo que prometia "cancelar o recebimento", e o
 * rótulo do botão é a última chance de a pessoa perceber que está no lugar certo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A PERGUNTA DO MOTIVO É DO MESMO FORMULÁRIO — E ISSO É O DESENHO (E88)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O motivo viaja no MESMO `POST` do botão de saída, e não em um segundo passo:
 *  separar "contar o motivo" de "sair" faria a cortesia virar pedágio — a pessoa
 *  responderia para só então conseguir sair, ou sairia sem responder e o pedido
 *  ficaria pela metade. Aqui os dois fatos entram na mesma requisição, e a saída
 *  não depende do que vier do outro lado (o domínio transforma qualquer valor
 *  estranho em "saiu sem dizer").
 *
 *  A ESCOLHA NÃO TEM ESTADO NO CLIENTE, de propósito: são `<input type="radio">`
 *  e um `<input type="text">` nativos, sem `useState` e sem `onChange`. É o que
 *  faz a pergunta funcionar ANTES de o JavaScript carregar — a página inteira é um
 *  formulário que o navegador sabe enviar sozinho, e nada aqui pode quebrar isso.
 *
 *  O campo de texto livre fica SEMPRE visível, e não só quando alguém marca "Outro
 *  motivo": mostrá-lo condicionalmente exigiria JavaScript, e sem JavaScript a
 *  pergunta existiria sem o campo. O rótulo diz quando ele serve.
 */
export function UnsubscribeForm({
  tenantSlug,
  token,
}: {
  tenantSlug: string;
  token: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeActionState | null, FormData>(
    confirmUnsubscribeAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4" data-testid="unsubscribe-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />

      <fieldset className="space-y-2" data-testid="unsubscribe-reason">
        <legend className="text-sm font-medium">Quer contar por quê? (opcional)</legend>
        <p className="text-muted-foreground text-xs">
          A sua saída não depende disto: você sai ao confirmar abaixo, com ou sem motivo. Se
          preferir não dizer, é só deixar como está.
        </p>

        <ul className="space-y-1.5">
          {UNSUBSCRIBE_REASON_CHOICES.map((choice, indice) => (
            <li key={choice}>
              {/*
                O rótulo ENVOLVE o rádio: sem `id`/`htmlFor` para divergir, e o
                nome acessível do controle passa a ser a própria frase da opção —
                que é o que o leitor de tela anuncia.
              */}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={UNSUBSCRIBE_REASON_FIELD}
                  value={choice}
                  className="accent-primary mt-0.5 size-3.5 shrink-0"
                  data-testid={`unsubscribe-reason-${indice}`}
                />
                <span>{choice}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="space-y-1">
          <label className="text-muted-foreground block text-xs" htmlFor="unsubscribe-reason-note">
            Se escolheu “Outro motivo”, escreva em poucas palavras (opcional)
          </label>
          <Input
            id="unsubscribe-reason-note"
            name={UNSUBSCRIBE_REASON_NOTE_FIELD}
            maxLength={MAX_UNSUBSCRIBE_REASON_LENGTH}
            data-testid="unsubscribe-reason-note"
          />
        </div>
      </fieldset>

      <SubmitButton
        label="Parar de receber os recados em massa"
        testId="unsubscribe-confirm-submit"
        variant="primary"
        icon={<MailX className="size-4" aria-hidden />}
      />

      <Feedback state={state} testId="unsubscribe-feedback" />
    </form>
  );
}

/**
 * O CAMINHO DE VOLTA. Sempre disponível, e não só depois de sair.
 *
 * Ele fica na página mesmo para quem está DENTRO: a dúvida "eu saí sem querer?"
 * chega por telefone, e a resposta honesta é dar o botão — em vez de explicar que
 * a pessoa precisa sair para poder voltar.
 */
export function ResubscribeForm({
  tenantSlug,
  token,
}: {
  tenantSlug: string;
  token: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeActionState | null, FormData>(
    confirmResubscribeAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" data-testid="resubscribe-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="token" value={token} />

      <SubmitButton
        label="Voltar a receber os recados"
        testId="resubscribe-submit"
        variant="outline"
        icon={<BellRing className="size-4" aria-hidden />}
      />

      <Feedback state={state} testId="resubscribe-feedback" />
    </form>
  );
}
