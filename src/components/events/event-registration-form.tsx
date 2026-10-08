'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, UserPlus } from 'lucide-react';

import {
  registerForEventAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';
import type { RegistrationFormField } from '@/domain/events/registration-form-spec-rules';
import { RegistrationDeclaredFields } from '@/components/events/registration-declared-fields';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="ef-button w-full sm:w-auto" disabled={pending}>
      <UserPlus className="size-4" aria-hidden />
      {pending ? 'Processando…' : 'Confirmar inscrição no evento'}
    </button>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INSCRIÇÃO NO EVENTO (revisão da FASE 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA INSCRIÇÃO FAZ — E POR QUE A TELA DIZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ao confirmar, a pessoa entra no evento E nas atividades ABERTAS (palestras,
 *  mesas-redondas, pósieres), sem passar uma a uma. Os minicursos e oficinas
 *  continuam com inscrição própria — e é isso que a lista abaixo mostra antes do
 *  clique, para ninguém descobrir depois.
 *
 *  O consentimento de dados é obrigatório e validado no SERVIDOR (LGPD): desabilitar
 *  o botão aqui é conveniência, a regra vive na Server Action.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function EventRegistrationForm({
  tenantSlug,
  eventSlug,
  openActivities,
  individualActivities,
  fields = [],
}: {
  tenantSlug: string;
  eventSlug: string;
  /** Atividades em que a inscrição no evento inclui a pessoa automaticamente. */
  openActivities: readonly string[];
  /** Atividades que continuam exigindo inscrição própria. */
  individualActivities: readonly string[];
  /** Os campos DECLARADOS pelo organizador (FASE 70) — vazios no formulário de sempre. */
  fields?: readonly RegistrationFormField[];
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    registerForEventAction,
    null,
  );

  if (state?.ok) {
    return (
      <div className="ef-card space-y-2 p-5" data-testid="event-registration-success">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
          Inscrição no evento confirmada!
        </p>
        <p className="text-sm opacity-80" data-testid="event-registration-message">
          {state.message}
        </p>
        {/* Dentro do cartão de sucesso: `.ef-muted-on-card` (FASE 66) no lugar de
            `opacity-60`, que media 4,17:1 sobre o cartão do tema padrão claro. */}
        <p className="ef-muted-on-card text-xs">
          Acompanhe e cancele em “Minhas inscrições”.
        </p>
      </div>
    );
  }

  return (
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O TEXTO SECUNDÁRIO DO FORMULÁRIO SAIU DA OPACIDADE (FASE 66)
     * ─────────────────────────────────────────────────────────────────────────────
     *  O formulário é um `.ef-card`, e sobre o cartão do tema o `opacity-60` media
     *  **4,17:1** no tema padrão claro — abaixo dos 4,5:1 do AA. O papel que passa
     *  nas duas superfícies (cartão e fundo) é `.ef-muted-on-card`, preso em
     *  `tests/unit/f66-contraste-do-rotulo.test.ts`. O `opacity-80` do resumo
     *  continua onde está: ele mede 7,75:1 sobre o cartão e não é o defeito.
     */
    <form action={formAction} className="ef-card space-y-4 p-5" data-testid="event-registration-form">
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventSlug" value={eventSlug} />

      {state && !state.ok && state.message ? (
        <p role="alert" className="ef-badge w-full text-destructive" data-testid="event-registration-error">
          {state.message}
        </p>
      ) : null}

      {openActivities.length > 0 ? (
        <div className="space-y-1 text-sm" data-testid="event-open-activities">
          <p className="font-medium">Sua inscrição já inclui:</p>
          <ul className="list-disc pl-5 opacity-80">
            {openActivities.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {individualActivities.length > 0 ? (
        <div className="space-y-1 text-sm opacity-80" data-testid="event-individual-activities">
          <p className="font-medium">Estas têm inscrição própria:</p>
          <ul className="list-disc pl-5">
            {individualActivities.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/**
        * ─────────────────────────────────────────────────────────────────────────────
        *  O CPF É OPCIONAL, E A TELA DIZ PARA QUE ELE SERVE (dívida E54)
        * ─────────────────────────────────────────────────────────────────────────────
        *  Ele entra no CERTIFICADO. Pedir documento sem dizer a finalidade é o que a
        *  LGPD chama de coleta sem propósito — e quem não informa continua se
        *  inscrevendo normalmente: o certificado sai sem a linha do CPF.
        */}
      <div className="space-y-1.5">
        <label htmlFor="cpf" className="text-sm font-medium">
          CPF <span className="ef-muted-on-card font-normal">(opcional — sai no certificado)</span>
        </label>
        <input
          id="cpf"
          name="cpf"
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          className="w-full px-3 py-2 text-sm sm:max-w-xs"
          style={{
            borderRadius: 'var(--ef-radius)',
            border: '1px solid color-mix(in oklab, var(--ef-text) 20%, transparent)',
            backgroundColor: 'transparent',
          }}
          /* O que voltou da action: corrigir um dígito não custa redigitar o resto. */
          defaultValue={state?.values?.cpf ?? ''}
          placeholder="000.000.000-00"
          data-testid="event-registration-cpf"
        />
        <p className="ef-muted-on-card text-xs">
          Usado apenas para emitir o seu certificado. Sem ele, o certificado é emitido do
          mesmo jeito.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="accessibilityNotes" className="text-sm font-medium">
          Necessidades de acessibilidade ou restrições alimentares{' '}
          <span className="ef-muted-on-card font-normal">(opcional)</span>
        </label>
        <textarea
          id="accessibilityNotes"
          name="accessibilityNotes"
          rows={2}
          maxLength={600}
          className="w-full px-3 py-2 text-sm"
          style={{
            borderRadius: 'var(--ef-radius)',
            border: '1px solid color-mix(in oklab, var(--ef-text) 20%, transparent)',
            backgroundColor: 'transparent',
          }}
          defaultValue={state?.values?.accessibilityNotes ?? ''}
          placeholder="Ex.: intérprete de Libras, rampa de acesso, opção vegana"
        />
      </div>

      <fieldset className="space-y-2.5">
        <legend className="mb-1 text-sm font-medium">Consentimentos</legend>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consentData" className="mt-0.5" required />
          <span>
            Autorizo o tratamento dos meus dados pessoais para fins de organização deste
            evento. <span className="ef-muted-on-card">(obrigatório)</span>
          </span>
        </label>

        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="consentImage" className="mt-0.5" />
          <span>
            Autorizo o uso da minha imagem em registros e divulgação do evento.{' '}
            <span className="ef-muted-on-card">(opcional)</span>
          </span>
        </label>
      </fieldset>

      {/**
        * ─────────────────────────────────────────────────────────────────────────────
        *  AS PERGUNTAS DO EVENTO VÊM DEPOIS DOS CONSENTIMENTOS — E DEPOIS É O LUGAR
        * ─────────────────────────────────────────────────────────────────────────────
        *  Quem responde lê primeiro o que o sistema pede (CPF, necessidades) e o que
        *  autoriza; as perguntas do organizador vêm em seguida, com a finalidade
        *  declarada ao lado de cada uma. O `values` que a action devolve volta para o
        *  `defaultValue` de cada campo: o React 19 zera o formulário depois da
        *  resposta, e uma recusa (campo obrigatório em branco, opção fora da lista)
        *  apagaria tudo o que a pessoa digitou — a lição da E54.
        */}
      <RegistrationDeclaredFields fields={fields} values={state?.values?.declaredFields} />

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="ef-muted-on-card text-xs">
          Sua vaga no evento é reservada no momento da confirmação.
        </p>
        <SubmitButton />
      </div>
    </form>
  );
}