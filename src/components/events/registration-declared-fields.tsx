'use client';

import {
  FORM_FIELD_TYPE_LABELS,
  formResponseFieldName,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AS PERGUNTAS QUE O ORGANIZADOR DECLAROU — UM DESENHO, DUAS PORTAS (FASE 70)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE COMPONENTE SAIU DO FORMULÁRIO DE INSCRIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 70 nasceu com uma lacuna de produto: quem entra pela ATIVIDADE nunca via as
 *  perguntas do organizador — a porta "Completar meus dados" só pedia CPF e
 *  necessidades, e as respostas que o organizador pediu não eram coletadas de quem veio
 *  pela oficina. Fechar a lacuna pedindo os mesmos campos exigia os MESMOS controles, o
 *  mesmo `name` prefixado, o mesmo `required` do HTML e o mesmo `data-testid`.
 *
 *  Copiar o bloco seria a alternativa — e seria a errada, pelo motivo de sempre: duas
 *  cópias divergem na primeira manutenção, e a divergência aqui é SILENCIOSA. O `name`
 *  do controle é o que a Server Action procura (`resposta_<key>`): uma cópia que
 *  esquecesse o prefixo faria a resposta chegar no lugar do CPF do sistema, e uma cópia
 *  que trocasse o `data-testid` deixaria a catraca de acessibilidade medindo um nó que
 *  não existe. Com um componente só, o que a pessoa que veio pela atividade responde é,
 *  por construção, o que a pessoa que se inscreveu pela porta comum responde.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM JAVASCRIPT, E SEM CAMPO CONDICIONAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada tipo vira o controle NATIVO que o navegador já valida sozinho: `input`,
 *  `textarea` e `select`. Nada de mostrar/esconder por tipo (exigiria hidratação) e
 *  nada de `onChange`. O `required` do HTML é a primeira barreira; quem decide é o
 *  domínio, na Server Action — e é a mensagem DELE que a pessoa lê.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SIM/NÃO É UM `select`, E NÃO UMA CAIXA DE SELEÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Uma caixa desmarcada chega ao servidor como AUSENTE — e ausente num campo
 *  obrigatório é "não respondeu", não "não". Com o `select`, "Não" é uma resposta
 *  declarada (`nao`), o domínio a normaliza para `false` e a caixa obrigatória não tem
 *  como ser enviada em branco pelo navegador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME DO CONTROLE LEVA PREFIXO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `resposta_<key>`, e não a `key` crua: um campo declarado com o identificador `cpf`
 *  sobrescreveria o CPF do sistema, que é o dado do certificado. O prefixo resolve por
 *  construção (ver `FORM_RESPONSE_FIELD_PREFIX` no domínio), e o domínio recusa `cpf`
 *  como `key` (`FORM_RESERVED_KEYS`) — são duas camadas, e as duas continuam de pé.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ENTRA EM `values` E O QUE *NÃO* ENTRA
 * ─────────────────────────────────────────────────────────────────────────────
 *  `values` é o mapa `key → texto CRU` que a Server Action devolve quando RECUSA. O
 *  React 19 zera o formulário depois da resposta, então sem isto uma recusa apagaria
 *  tudo o que a pessoa digitou (a lição da E54). Quando o mapa está vazio — a primeira
 *  renderização — quem manda é `respostas`, que é o que a inscrição JÁ TEM gravado:
 *  quem respondeu "UFBA" e volta à porta vê "UFBA", em vez de um campo em branco que
 *  sugeriria que a resposta nunca existiu. O valor devolvido pela action GANHA do
 *  gravado, porque ele é o que a pessoa acabou de digitar.
 */
export function RegistrationDeclaredFields({
  fields,
  values,
  respostas,
  /** O identificador do bloco — o mesmo campo aparece em duas portas diferentes. */
  testId = 'event-declared-fields',
}: {
  fields: readonly RegistrationFormField[];
  /** O que a pessoa digitou e a action devolveu na recusa (tem precedência). */
  values?: Record<string, string>;
  /** O que a inscrição já tem gravado (a resposta anterior, quando existe). */
  respostas?: Record<string, unknown>;
  testId?: string;
}) {
  if (fields.length === 0) return null;

  return (
    <fieldset className="space-y-3" data-testid={testId}>
      <legend className="mb-1 text-sm font-medium">Perguntas do evento</legend>

      {fields.map((field) => {
        const id = `campo-declarado-${field.key}`;
        const name = formResponseFieldName(field.key);
        const enviado = values?.[field.key];
        const gravado = respostas?.[field.key];
        const value = enviado ?? (typeof gravado === 'string' ? gravado : '');
        const helpId = field.help ? `${id}-help` : undefined;
        const purposeId = field.purpose ? `${id}-purpose` : undefined;

        const inputProps = {
          id,
          name,
          required: field.required,
          'aria-describedby': [helpId, purposeId].filter(Boolean).join(' ') || undefined,
          'data-testid': `event-declared-field-${field.key}`,
          className: 'w-full px-3 py-2 text-sm',
          style: {
            borderRadius: 'var(--ef-radius)',
            border: '1px solid color-mix(in oklab, var(--ef-text) 20%, transparent)',
            backgroundColor: 'transparent',
          },
        } as const;

        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {field.label}{' '}
              <span className="ef-muted-on-card font-normal">
                ({FORM_FIELD_TYPE_LABELS[field.type]}
                {field.required ? ' · obrigatório' : ''})
              </span>
            </label>

            {field.type === 'LONG_TEXT' ? (
              <textarea
                {...inputProps}
                rows={3}
                maxLength={field.maxLength}
                defaultValue={value}
              />
            ) : field.type === 'SINGLE_CHOICE' ? (
              <select {...inputProps} defaultValue={value}>
                <option value="">Selecione…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === 'YES_NO' ? (
              <select {...inputProps} defaultValue={value}>
                <option value="">Selecione…</option>
                <option value="sim">Sim</option>
                <option value="nao">Não</option>
              </select>
            ) : (
              /**
               * Texto curto, número e data compartilham o `input` e mudam só o `type`:
               * os três são validados pelo navegador sem uma linha de JavaScript, e o
               * teto do texto curto é o `maxLength` do domínio.
               */
              <input
                {...inputProps}
                type={
                  field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : 'text'
                }
                {...(field.type === 'NUMBER'
                  ? {
                      step: 1,
                      min: field.min,
                      max: field.max,
                      inputMode: 'numeric' as const,
                    }
                  : {})}
                {...(field.type === 'SHORT_TEXT' ? { maxLength: field.maxLength } : {})}
                defaultValue={value}
              />
            )}

            {field.help ? (
              <p id={helpId} className="ef-muted-on-card text-xs">
                {field.help}
              </p>
            ) : null}

            {/**
              * A FINALIDADE aparece para QUEM RESPONDE, e não só para quem pergunta. É o
              * que a LGPD pede (informar para que o dado serve) e o que o texto longo
              * obriga a declarar do outro lado.
              */}
            {field.purpose ? (
              <p id={purposeId} className="ef-muted-on-card text-xs">
                Para que serve: {field.purpose}
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
