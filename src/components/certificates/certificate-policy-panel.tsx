'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Lock, ShieldCheck } from 'lucide-react';

import type { CertificateActionState } from '@/app/actions/certificate-actions';
import {
  CERTIFICATE_POLICY_LIMITS,
  policyPercent,
  type CertificatePolicy,
} from '@/domain/certificates/certificate-policy-rules';
import { Button, Field, Input, fieldAria } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A REGRA DE PRESENÇA DO EVENTO — leitura para a equipe, edição para quem manda
 *  (FASE 86 · fatia 5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA SEÇÃO RESPONDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Por que esta pessoa recebeu (ou não) o certificado?" — com a régua EM VIGOR
 *  na frente de quem lê, e não escondida em um JSON. A leitura é de quem tem
 *  `certificate:issue` (a permissão da página); a edição é de quem tem
 *  `event:manage`, a mesma permissão que já governa os modelos do evento. Quem só
 *  lê vê a regra e o motivo de não poder mexer — controle escondido sem
 *  explicação vira chamado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `useActionState` SEM PERDER O FORMULÁRIO NATIVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `<form action={formAction}>` continua sendo um formulário de verdade: com o
 *  JavaScript desligado o POST chega à Server Action e a tela é revalidada. Com
 *  JavaScript, a resposta aparece ao lado do botão sem recarregar. Os dois campos
 *  têm `label` ligado por `htmlFor`, `hint` com os limites e `aria-describedby`
 *  (via `fieldAria`), então o leitor de tela anuncia o intervalo aceito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA NÃO DEIXA ESCOLHER (e por que está escrito)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `requireCheckOut` e `aggregateBy` NÃO são campos: nesta versão o check-out é
 *  obrigatório e a soma é por atividade. Mostrar um checkbox que o servidor
 *  recusaria seria prometer uma escolha que não existe; a linha "fixo nesta
 *  versão" é a informação honesta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function CertificatePolicyPanel({
  tenantSlug,
  eventId,
  policy,
  problems,
  canManage,
  action,
}: {
  tenantSlug: string;
  eventId: string;
  policy: CertificatePolicy;
  /** Configuração gravada recusada pelo leitor — a tela mostra, não esconde. */
  problems: readonly string[];
  /** `event:manage` (instituição ou evento) — decide se o formulário existe. */
  canManage: boolean;
  action: (
    prev: CertificateActionState | null,
    formData: FormData,
  ) => Promise<CertificateActionState>;
}) {
  const [state, formAction] = useActionState<CertificateActionState | null, FormData>(action, null);

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-5"
      aria-labelledby="certificate-policy-title"
      data-testid="certificate-policy"
    >
      <header className="space-y-1">
        <h2 id="certificate-policy-title" className="flex items-center gap-2 text-base font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Regra de presença do evento
        </h2>
        <p className="text-xs text-muted-foreground">
          É esta a régua que a simulação acima e a emissão aplicam para decidir quem recebe
          certificado. Mudar aqui não altera documento já emitido: cada certificado guarda a
          política do dia em que nasceu.
        </p>
      </header>

      {/*
        A política EM VIGOR vem do leitor tolerante do domínio. Se a configuração
        gravada estiver torta, o que aparece é o PADRÃO — e a lista de problemas
        abaixo diz exatamente o que foi recusado.
      */}
      <dl
        className="grid gap-3 rounded-lg border border-border bg-background/40 p-3 text-sm sm:grid-cols-2"
        data-testid="certificate-policy-current"
        data-min-ratio={String(policy.minRatio)}
        data-min-minutes={String(policy.minMinutes)}
      >
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Percentual mínimo
          </dt>
          <dd className="font-medium">{policyPercent(policy.minRatio)} % da carga da atividade</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Piso em minutos</dt>
          <dd className="font-medium">{policy.minMinutes} min</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Check-out</dt>
          <dd className="font-medium">
            Obrigatório <span className="font-normal text-muted-foreground">(fixo nesta versão)</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Soma da presença</dt>
          <dd className="font-medium">
            Por atividade{' '}
            <span className="font-normal text-muted-foreground">(fixo nesta versão)</span>
          </dd>
        </div>
      </dl>

      {problems.length > 0 ? (
        <div
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive-soft p-4"
          data-testid="certificate-policy-problems"
        >
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
            A política gravada está inválida — o padrão está em vigor
          </p>
          <ul className="ml-5 list-disc space-y-1 text-sm text-foreground">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        <form action={formAction} className="space-y-4" data-testid="certificate-policy-form">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              name="minRatioPercent"
              label="Percentual mínimo da carga (%)"
              required
              hint={`De ${policyPercent(CERTIFICATE_POLICY_LIMITS.minRatio.min)} a ${policyPercent(
                CERTIFICATE_POLICY_LIMITS.minRatio.max,
              )}. Abaixo disso a presença não conta — 0 % é recusado porque emitiria para quem não participou.`}
            >
              <Input
                {...fieldAria('minRatioPercent')}
                type="number"
                inputMode="numeric"
                min={policyPercent(CERTIFICATE_POLICY_LIMITS.minRatio.min)}
                max={policyPercent(CERTIFICATE_POLICY_LIMITS.minRatio.max)}
                step={1}
                defaultValue={policyPercent(policy.minRatio)}
                required
                data-testid="certificate-policy-min-ratio"
              />
            </Field>

            <Field
              name="minMinutes"
              label="Piso em minutos"
              required
              hint={`De ${CERTIFICATE_POLICY_LIMITS.minMinutes.min} a ${CERTIFICATE_POLICY_LIMITS.minMinutes.max}. O mínimo nunca fica abaixo disto, mesmo quando a atividade não declara carga.`}
            >
              <Input
                {...fieldAria('minMinutes')}
                type="number"
                inputMode="numeric"
                min={CERTIFICATE_POLICY_LIMITS.minMinutes.min}
                max={CERTIFICATE_POLICY_LIMITS.minMinutes.max}
                step={1}
                defaultValue={policy.minMinutes}
                required
                data-testid="certificate-policy-min-minutes"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <SaveButton />

            {state && !state.ok ? (
              <div
                role="alert"
                data-testid="certificate-policy-feedback"
                className="text-xs text-destructive"
              >
                <p className="flex items-start gap-1.5 font-medium">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {state.message}
                </p>
                {state.details && state.details.length > 0 ? (
                  <ul className="ml-5 mt-1 list-disc space-y-0.5" data-testid="certificate-policy-details">
                    {state.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {state?.ok ? (
              <p
                role="status"
                data-testid="certificate-policy-feedback"
                className="flex items-start gap-1.5 text-xs text-success-strong"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {state.message}
              </p>
            ) : null}
          </div>
        </form>
      ) : (
        <p
          className="flex items-start gap-2 rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground"
          data-testid="certificate-policy-readonly"
        >
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Você pode consultar a regra, mas não alterá-la: editar a política exige a permissão
          <code className="mx-1 rounded-xs bg-muted px-1 py-0.5">event:manage</code>
          neste evento.
        </p>
      )}
    </section>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="sm"
      disabled={pending}
      data-testid="certificate-policy-save"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      Salvar regra de presença
    </Button>
  );
}
