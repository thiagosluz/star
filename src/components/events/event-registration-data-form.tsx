'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, PencilLine } from 'lucide-react';

import {
  completeEventRegistrationDataAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';
import type { RegistrationFormField } from '@/domain/events/registration-form-spec-rules';
import { RegistrationDeclaredFields } from '@/components/events/registration-declared-fields';

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="ef-button-outline w-full sm:w-auto" disabled={pending}>
      <PencilLine className="size-4" aria-hidden />
      {pending ? 'Salvando…' : 'Salvar meus dados'}
    </button>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COMPLETAR OS DADOS DA INSCRIÇÃO (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM PRECISA DESTE FORMULÁRIO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem entrou por uma ATIVIDADE. A inscrição no evento nasce automaticamente (é o
 *  conserto desta fase), mas nasce com as respostas HERDADAS do formulário da
 *  atividade — e esse formulário não tem CPF. Sem esta porta, o certificado de quem
 *  veio pela oficina sairia para sempre sem o CPF, e a pessoa não teria onde
 *  informá-lo: `registerForEvent` responde `DUPLICATE` para quem já tem inscrição.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE NÃO É O FORMULÁRIO DE INSCRIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que falta é o CPF, a necessidade de acessibilidade e AS PERGUNTAS DO
 *  ORGANIZADOR. Repetir o formulário inteiro de inscrição — com as listas de
 *  atividades incluídas e as de inscrição própria — diria à pessoa que ela está se
 *  inscrevendo de novo, e ela não está: a vaga dela já existe. O texto diz exatamente
 *  isso.
 *
 *  Os dois consentimentos continuam sendo coletados, e não por formalidade: o
 *  consentimento é do FATO (a inscrição no evento), e é ele que a trilha e o
 *  certificado leem. Sem a caixa marcada, o servidor recusa — a tela não é a guarda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS PERGUNTAS DO EVENTO ENTRARAM AQUI, E ESSA FOI A LACUNA FECHADA (FASE 70)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Até o fecho da fase, esta porta pedia CPF e necessidades — e mais nada. Quem tinha
 *  entrado pela oficina nunca via as perguntas que o organizador declarou, e o
 *  organizador, por consequência, não coletava delas o que ele mesmo pediu. Fechar a
 *  lacuna é renderizar OS MESMOS campos, com o MESMO componente
 *  (`RegistrationDeclaredFields`) e o MESMO validador na action — o que garante que o
 *  `name` de cada controle (`resposta_<key>`) é o que o servidor procura.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A PESSOA JÁ RESPONDEU APARECE PREENCHIDO (`respostas`)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A mescla do servidor preserva o que não foi respondido de novo — e é justamente por
 *  isso que o campo PRECISA mostrar o valor gravado. Um campo em branco faria a pessoa
 *  acreditar que a resposta dela se perdeu (ou que nunca existiu) e redigitá-la; pior,
 *  deixaria a tela devendo a única coisa que ela promete: dizer o que o sistema sabe.
 *  O valor devolvido pela action GANHA do gravado, porque é o que ela acabou de digitar.
 *
 *  O CPF e as necessidades seguem a mesma régua — e o CPF vai em claro no campo, como
 *  o dado da própria pessoa na própria inscrição, e não escondido por CSS.
 */
export function EventRegistrationDataForm({
  tenantSlug,
  eventSlug,
  fields = [],
  respostas = {},
  accessibilityNotes = null,
}: {
  tenantSlug: string;
  eventSlug: string;
  /** Os campos DECLARADOS pelo organizador (FASE 70) — vazios no formulário de sempre. */
  fields?: readonly RegistrationFormField[];
  /** O que a inscrição JÁ TEM gravado — o que a pessoa respondeu antes. */
  respostas?: Record<string, unknown>;
  /**
   * A nota de acessibilidade GRAVADA. Ela entra pelo mesmo motivo das respostas: este
   * formulário a reenvia, e o serviço grava o que chega — um campo em branco apagaria a
   * nota a cada passada por aqui. Com o valor no campo, reenviar é inofensivo, e quem
   * quiser apagar apaga à mão.
   */
  accessibilityNotes?: string | null;
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    completeEventRegistrationDataAction,
    null,
  );

  if (state?.ok) {
    return (
      <div className="ef-card space-y-2 p-4" data-testid="event-registration-data-success">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CheckCircle2 className="size-4 text-success-strong" aria-hidden />
          Dados atualizados
        </p>
        <p className="ef-muted-on-card text-xs" data-testid="event-registration-data-message">
          {state.message}
        </p>
      </div>
    );
  }

  /**
   * O CPF gravado volta para o campo; o que a pessoa digitou na resposta recusada ganha
   * dele. O valor do banco está em DÍGITOS, que é como ele é gravado (a máscara é de
   * impressão) — e é o que o mesmo campo aceita de volta.
   */
  const cpfGravado = typeof respostas.cpf === 'string' ? respostas.cpf : '';

  return (
    <details className="ef-card p-4" data-testid="event-registration-data-form">
      <summary className="cursor-pointer text-sm font-medium">
        Completar meus dados (CPF, acessibilidade
        {fields.length > 0 ? ' e as perguntas do evento' : ''})
      </summary>

      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventSlug" value={eventSlug} />

        <p className="ef-muted-on-card text-xs">
          Sua vaga já está reservada — isto não é uma nova inscrição. O CPF entra apenas no
          seu certificado.
        </p>

        {state && !state.ok && state.message ? (
          <p
            role="alert"
            className="ef-badge w-full text-destructive"
            data-testid="event-registration-data-error"
          >
            {state.message}
          </p>
        ) : null}

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
            defaultValue={state?.values?.cpf ?? cpfGravado}
            placeholder="000.000.000-00"
            data-testid="event-registration-data-cpf"
          />
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
            defaultValue={state?.values?.accessibilityNotes ?? accessibilityNotes ?? ''}
          />
        </div>

        <fieldset className="space-y-2">
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
          * AS PERGUNTAS DO EVENTO VÊM DEPOIS DOS CONSENTIMENTOS — a mesma ordem da tela
          * de inscrição, e pelo mesmo motivo: quem responde lê primeiro o que o sistema
          * pede e o que autoriza, e só então as perguntas do organizador.
          *
          * O `testId` é DIFERENTE do bloco da tela de inscrição (`event-declared-fields`)
          * de propósito: as duas portas podem estar na mesma página, e um teste que
          * contasse o bloco pela chave comum não saberia qual das duas mediu.
          */}
        <RegistrationDeclaredFields
          fields={fields}
          values={state?.values?.declaredFields}
          respostas={respostas}
          testId="event-registration-data-declared-fields"
        />

        <SubmitButton />
      </form>
    </details>
  );
}
