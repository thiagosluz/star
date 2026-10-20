'use client';

import { useActionState } from 'react';
import { Send, CheckCircle2, AlertCircle } from 'lucide-react';

import {
  submitInstitutionLeadAction,
  type PlatformActionState,
} from '@/app/actions/platform-actions';

const INITIAL_STATE: PlatformActionState = { ok: false, message: '' };

export function InstitutionLeadForm() {
  const [state, action, isPending] = useActionState(
    submitInstitutionLeadAction,
    INITIAL_STATE,
  );

  if (state.ok) {
    return (
      <div
        className="rounded-2xl border border-success/40 bg-success/10 p-8 text-center space-y-4"
        data-testid="lead-form-success"
      >
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-success/20 text-success">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          Contato recebido com sucesso!
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          {state.message}
        </p>
        <p className="text-xs text-muted-foreground pt-2">
          Nossos especialistas em gestão de eventos e implantação entrarão em contato pelo e-mail ou telefone informado.
        </p>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="space-y-5 rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm"
      data-testid="institution-lead-form"
    >
      <div className="space-y-1">
        <h3 className="text-xl font-bold tracking-tight text-foreground">
          Fale com nossa equipe de expansão
        </h3>
        <p className="text-xs text-muted-foreground">
          Preencha os dados abaixo para receber uma demonstração personalizada e proposta sob medida para sua instituição.
        </p>
      </div>

      {state.message && !state.ok ? (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive"
          data-testid="lead-form-error"
        >
          <AlertCircle className="size-4 shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-1">
            <p className="font-semibold">{state.message}</p>
            {state.details && state.details.length > 0 ? (
              <ul className="list-disc pl-4 space-y-0.5">
                {state.details.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lead-name" className="text-xs font-semibold text-foreground">
            Nome do responsável <span className="text-destructive">*</span>
          </label>
          <input
            id="lead-name"
            type="text"
            name="name"
            required
            placeholder="Ex: Profa. Maria Silva"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lead-email" className="text-xs font-semibold text-foreground">
            E-mail institucional / corporativo <span className="text-destructive">*</span>
          </label>
          <input
            id="lead-email"
            type="email"
            name="email"
            required
            placeholder="maria@universidade.edu.br"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lead-org" className="text-xs font-semibold text-foreground">
            Nome da organização / instituição <span className="text-destructive">*</span>
          </label>
          <input
            id="lead-org"
            type="text"
            name="organization"
            required
            placeholder="Ex: Universidade Federal / Sociedade Médica"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lead-role" className="text-xs font-semibold text-foreground">
            Cargo / Função na instituição
          </label>
          <input
            id="lead-role"
            type="text"
            name="role"
            placeholder="Ex: Coordenador de Eventos / Pró-Reitor"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="lead-phone" className="text-xs font-semibold text-foreground">
            Telefone / WhatsApp para contato
          </label>
          <input
            id="lead-phone"
            type="tel"
            name="phone"
            placeholder="(11) 98765-4321"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="lead-events" className="text-xs font-semibold text-foreground">
            Estimativa de eventos anuais
          </label>
          <select
            id="lead-events"
            name="estimatedEvents"
            defaultValue="3 a 5 eventos por ano"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-hidden"
          >
            <option value="1 a 2 eventos por ano">1 a 2 eventos por ano</option>
            <option value="3 a 5 eventos por ano">3 a 5 eventos por ano</option>
            <option value="6 a 12 eventos por ano">6 a 12 eventos por ano</option>
            <option value="Mais de 12 eventos por ano">Mais de 12 eventos por ano</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="lead-message" className="text-xs font-semibold text-foreground">
          Conte sobre suas principais necessidades
        </label>
        <textarea
          id="lead-message"
          name="message"
          rows={3}
          placeholder="Ex: Precisamos de submissão com pareceristas e emissão automática de certificados para nosso congresso nacional..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
        />
      </div>

      <div className="pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          {isPending ? (
            <span>Enviando solicitação…</span>
          ) : (
            <>
              <span>Enviar solicitação de contato</span>
              <Send className="size-4" aria-hidden />
            </>
          )}
        </button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Ao enviar, você concorda em receber contato da nossa equipe para fins de atendimento institucional.
      </p>
    </form>
  );
}
