'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O PASSO DE CONFIRMAÇÃO DA CAMPANHA (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ENVIO TEM UM PASSO SÓ PARA ELE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O segmento é montado por um formulário `GET` (para o resultado ser um endereço
 *  compartilhável) — e um `GET` não pode enviar e-mail: o endereço ficaria no
 *  histórico do navegador, e uma recarga reenviaria a campanha. Então o envio vive
 *  num `POST` (a Server Action), e o que atravessa é o SNAPSHOT da definição já
 *  validada, num `hidden`.
 *
 *  A consequência é boa por si: disparar mensagem para uma lista é irreversível, e
 *  agora ele tem uma tela de confirmação com a contagem no rótulo do botão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RESULTADO MOSTRADO É O DO SERVIÇO — NUNCA UM "ENVIADO" OTIMISTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ação devolve os números REAIS da passada (quantos entraram na fila, quantos já
 *  existiam, quantos falharam, quantos sobraram para a próxima) e, quando o serviço
 *  recusou, a recusa — com o motivo que ele deu. Esta tela não inventa "sucesso":
 *  ela mostra o que voltou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Send, TestTube2 } from 'lucide-react';

import { campaignSendAction, type CommunicationActionState } from '@/app/actions/communication-actions';
import { Button } from '@/components/ui';

function SubmitButton({
  acao,
  label,
  testId,
  variant,
  icon,
}: {
  acao: 'teste' | 'disparar';
  label: string;
  testId: string;
  variant: 'outline' | 'primary';
  icon: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      name="acao"
      value={acao}
      disabled={pending}
      variant={variant}
      size="sm"
      data-testid={testId}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </Button>
  );
}

export function CampaignSendForm({
  tenantSlug,
  eventId,
  definicao,
  assunto,
  corpo,
  recipientCount,
  unsubscribed,
}: {
  tenantSlug: string;
  eventId: string | null;
  /** JSON da definição VALIDADA — reconferida pela ação (`parseStoredDefinition`). */
  definicao: string;
  assunto: string;
  corpo: string;
  /** Quantos vão receber hoje (já sem quem saiu). */
  recipientCount: number;
  /** Quantos do segmento saíram e não recebem. */
  unsubscribed: number;
}) {
  const [state, formAction] = useActionState<CommunicationActionState | null, FormData>(
    campaignSendAction,
    null,
  );

  const people = recipientCount === 1 ? '1 pessoa' : `${recipientCount} pessoas`;

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  DEPOIS DO DISPARO, ESTE FORMULÁRIO PARA DE ENVIAR — E A RAZÃO É A CHAVE DO FATO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A chave que impede a mensagem repetida é `campanha + pessoa`. Um SEGUNDO
   *  clique aqui criaria OUTRA campanha (com chave nova) e mandaria a mesma
   *  mensagem de novo para todo mundo — o `dedupeKey` não cobre dois atos
   *  diferentes, e não deve: são dois fatos.
   *
   *  Então, depois de uma passada concluída, os botões SAEM DE CENA — os dois. O
   *  caminho que fica é o REENVIO da MESMA campanha, no histórico: lá o `dedupeKey`
   *  protege de verdade, e quem já entrou volta como "já existia". O `disabled` do
   *  `pending` já cobre o clique duplo; isto cobre o clique repetido depois do
   *  resultado — inclusive o teste depois do disparo, que devolveria o botão de
   *  enviar à tela (o estado de uma ação substitui o da outra).
   */
  const dispatched = state?.ok === true && typeof state.data?.campaignId === 'string';

  return (
    <form action={formAction} className="space-y-4" data-testid="campaign-send-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      {eventId ? <input type="hidden" name="evento" value={eventId} /> : null}
      <input type="hidden" name="definicao" value={definicao} />
      <input type="hidden" name="assunto" value={assunto} />
      <input type="hidden" name="corpo" value={corpo} />

      <p className="text-sm text-muted-foreground" data-testid="campaign-send-summary">
        A mensagem será registrada no outbox <strong className="font-medium text-foreground">uma vez por
        pessoa</strong> — {people} agora — e entregue pelo worker. Reenviar depois não duplica quem já
        entrou: a chave do fato é a campanha mais a pessoa.
        {unsubscribed > 0 ? ` ${unsubscribed} saíram do canal e não recebem.` : ''}
      </p>

      {dispatched ? (
        <p className="text-xs text-muted-foreground" data-testid="campaign-dispatched-note">
          A campanha está no <strong className="font-medium">histórico abaixo</strong>. Para alcançar
          quem sobrou (ou repetir uma falha), use{' '}
          <strong className="font-medium">Reenviar esta campanha</strong> na linha dela: a chave do fato
          garante que ninguém receba duas vezes.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton
            acao="teste"
            label="Enviar um teste só para mim"
            testId="campaign-test-submit"
            variant="outline"
            icon={<TestTube2 className="size-3.5" aria-hidden />}
          />
          <SubmitButton
            acao="disparar"
            label={`Confirmar e enviar para ${people}`}
            testId="campaign-dispatch-submit"
            variant="primary"
            icon={<Send className="size-3.5" aria-hidden />}
          />
        </div>
      )}

      {state ? (
        <div
          role={state.ok ? 'status' : 'alert'}
          data-testid="campaign-send-feedback"
          data-ok={state.ok ? 'true' : 'false'}
          className={`space-y-1.5 rounded-md border border-border bg-surface-low p-3 text-sm ${
            state.ok ? 'text-success-strong' : 'text-destructive'
          }`}
        >
          <p className="flex items-start gap-1.5">
            {state.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span className="font-medium">{state.message}</span>
          </p>

          {state.details?.length ? (
            <ul className="ml-5 list-disc space-y-0.5 text-xs text-muted-foreground">
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
