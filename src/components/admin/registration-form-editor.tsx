/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL — O editor de UM campo do formulário de inscrição (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO NÃO TEM `'use client'`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O editor mostra o que o DOMÍNIO exige, e quem sabe o que o domínio exige é o
 *  servidor: os tipos da allowlist, os tetos de cada campo e a finalidade obrigatória
 *  do texto longo saem daqui lidos dos módulos de domínio — não de uma lista copiada
 *  para o cliente, que divergiria no dia em que um tipo novo entrasse. O envio fica
 *  com o `AdminForm` (FASE 7), que é a moldura provada sem JavaScript.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TODOS OS CAMPOS DO EDITOR APARECEM DE UMA VEZ, E ISSO É DE PROPÓSITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Seria mais bonito mostrar só os campos do tipo escolhido (o `maxLength` quando é
 *  texto, as opções quando é escolha única). Isso exige JavaScript: sem ele o
 *  organizador escolheria "Escolha única" e não teria onde digitar as opções. Aqui
 *  todos aparecem, cada um com a dica dizendo a que tipo pertence — e quem preencher
 *  um campo do tipo errado é RECUSADO pelo domínio, com o motivo escrito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `id` DE CADA CONTROLE CARREGA O PREFIXO, E O `name` NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela tem um editor por campo, e todos repetem `label`, `type`, `purpose`… Como
 *  `name`, isso é o que o `<form>` precisa. Como `id`, seria um documento com o
 *  mesmo identificador N vezes e um `<label for>` apontando para o controle de OUTRO
 *  formulário — a armadilha que o `AdminForm` documenta. Por isso o `id` é prefixado
 *  (`field-<key>-label`), e é ele que o `<label>` procura.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  FORM_CHOICE_OPTIONS_MAX,
  FORM_CHOICE_OPTION_MAX,
  FORM_FIELD_KEY_MAX,
  FORM_FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  FORM_HELP_MAX,
  FORM_LABEL_MAX,
  FORM_LONG_TEXT_MAX,
  FORM_PURPOSE_MAX,
  FORM_SHORT_TEXT_MAX,
  THIRD_PARTY_FORBIDDEN_FORM_KEYS,
  formFieldRequiresPurpose,
  type FormFieldType,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import { AdminForm } from '@/components/admin/admin-form';
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui';
import { saveRegistrationFormFieldAction } from '@/app/actions/registration-form-actions';

/**
 * O texto do aviso. Existe como constante porque é REQUISITO, não enfeite: foi ele
 * que o humano escolheu ao liberar o texto livre, e ele é lido pela página e pelo
 * teste.
 */
export const FREE_TEXT_NOTICE_KEYS = THIRD_PARTY_FORBIDDEN_FORM_KEYS;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O AVISO DO TEXTO LIVRE
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE É REQUISITO, E NÃO UMA NOTA DE RODAPÉ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O sistema NÃO OFERECE campo de dado sensível: a allowlist de tipos é curta e
 *  fechada, e um tipo inventado (`CPF`) é recusado com o motivo escrito. O que essa
 *  garantia NÃO cobre — e prometer que cobre seria propaganda — é alguém DIGITAR um
 *  CPF num campo de texto livre: texto curto é texto curto, e o sistema não tem como
 *  reconhecer a string como documento. Quem cobre esse risco é este aviso e o
 *  caminho de ELIMINAÇÃO das respostas. Ele fica ao lado do editor porque é ali que
 *  a decisão de pedir acontece.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS CORES SÃO AS MEDIDAS DA FASE 52
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `warning-strong` sobre `warning-soft` (6,44:1 no claro; 9,17:1 na escala escura)
 *  e o corpo do texto no token de texto do TEMA (`text-foreground`). Nada de
 *  `opacity` em texto — é a família do defeito da FASE 66.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function FreeTextFieldNotice() {
  return (
    <section
      aria-label="Aviso sobre os campos de texto livre"
      data-testid="free-text-notice"
      className="space-y-2 rounded-lg border border-warning-strong/40 bg-warning-soft p-4"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-warning-strong">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        Quem organiza responde pelo que pergunta
      </p>

      <div className="space-y-2 text-sm text-foreground">
        <p>
          O sistema <strong>não oferece</strong> campo de dado sensível: CPF ou documento, saúde,
          religião, biometria, raça/cor, orientação sexual e filiação partidária ou sindical não têm
          tipo aqui — não viram coluna, não entram em relatório nem em exportação, e um tipo com esse
          nome é recusado com o motivo escrito.
        </p>

        <p>
          Isso não impede que alguém <strong>digite</strong> um dado desses num campo de texto livre, e
          o sistema não tem como reconhecer isso sozinho. Por isso: <strong>não peça dado sensível em
          texto livre</strong> — o que for digitado nele fica guardado como texto comum, sem proteção
          nenhuma por cima.
        </p>

        <p>
          E as respostas deste formulário <strong>não saem</strong> em superfície de terceiro: nem no
          CSV de participantes, nem no perfil público. As chaves que o sistema mantém fora dessas
          superfícies hoje são{' '}
          {FREE_TEXT_NOTICE_KEYS.map((key, index) => (
            <span key={key}>
              <code className="code-data">{key}</code>
              {index < FREE_TEXT_NOTICE_KEYS.length - 1 ? ', ' : '.'}
            </span>
          ))}
        </p>
      </div>
    </section>
  );
}

/** Rótulo de verdade + dica, com o `id` prefixado que separa um editor do outro. */
function EditorField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const TYPE_OPTIONS = FORM_FIELD_TYPES.map((type) => ({
  value: type,
  label: FORM_FIELD_TYPE_LABELS[type],
}));

/**
 * O editor de UM campo — usado tanto para o campo NOVO quanto para editar um que já
 * existe. Um só desenho para os dois: dois formulários parecidos divergiriam no
 * primeiro ajuste, e o organizador veria campos diferentes conforme o caminho.
 */
export function RegistrationFieldForm({
  tenantSlug,
  eventId,
  field,
  idPrefix,
  testId,
  submitLabel,
}: {
  tenantSlug: string;
  eventId: string;
  /** `null` = campo novo (a `key` ainda não existe). */
  field: RegistrationFormField | null;
  /** Prefixo dos `id` desta instância — é o que evita id repetido entre editores. */
  idPrefix: string;
  testId: string;
  submitLabel: string;
}) {
  const type: FormFieldType = field?.type ?? 'SHORT_TEXT';

  /**
   * A finalidade é OBRIGATÓRIA no texto longo (`formFieldRequiresPurpose`), e o
   * `required` do HTML só pode ser afirmado quando o TIPO JÁ EXISTE — no campo novo
   * ele seria uma promessa sobre uma escolha que ainda não foi feita (e marcar
   * `required` sempre recusaria o texto curto sem finalidade, que o domínio aceita).
   * Quem fecha a porta do texto longo sem finalidade, nos dois casos, é o validador
   * do domínio — e é a mensagem dele que aparece.
   */
  const purposeRequired = field !== null && formFieldRequiresPurpose(type);

  return (
    <AdminForm
      action={saveRegistrationFormFieldAction}
      submitLabel={submitLabel}
      testId={testId}
      compact
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />
      {/**
        * A `key` de ORIGEM: é ela que diz qual campo está sendo editado. Sem isto,
        * renomear um identificador criaria um campo a mais em vez de mudar o que
        * existe — e o antigo ficaria no formulário perguntando o que ninguém mais
        * quer perguntar.
        */}
      <input type="hidden" name="originalKey" value={field?.key ?? ''} />

      <div className="grid gap-3 sm:grid-cols-2">
        <EditorField
          id={`${idPrefix}-label`}
          label="Rótulo do campo"
          hint={`O que o participante lê, até ${FORM_LABEL_MAX} caracteres.`}
        >
          <Input
            id={`${idPrefix}-label`}
            name="label"
            aria-describedby={`${idPrefix}-label-hint`}
            required
            maxLength={FORM_LABEL_MAX}
            defaultValue={field?.label ?? ''}
            data-testid={`${idPrefix}-label`}
          />
        </EditorField>

        <EditorField
          id={`${idPrefix}-key`}
          label="Identificador (opcional)"
          hint={`É a chave com que a resposta é gravada. Em branco, o sistema deriva do rótulo (ex.: "Restrição alimentar" → restricao_alimentar). Mudar o identificador de um campo já salvo deixa as respostas recebidas sob a chave antiga — e renomear o RÓTULO não troca a chave de quem já respondeu.`}
        >
          <Input
            id={`${idPrefix}-key`}
            name="key"
            aria-describedby={`${idPrefix}-key-hint`}
            maxLength={FORM_FIELD_KEY_MAX}
            defaultValue={field?.key ?? ''}
            placeholder="em branco = derivado do rótulo"
            data-testid={`${idPrefix}-key`}
          />
        </EditorField>

        <EditorField
          id={`${idPrefix}-type`}
          label="Tipo do campo"
          hint={`Só estes ${FORM_FIELD_TYPES.length} tipos existem — dado sensível não tem tipo no sistema.`}
        >
          <Select
            id={`${idPrefix}-type`}
            name="type"
            aria-describedby={`${idPrefix}-type-hint`}
            defaultValue={type}
            data-testid={`${idPrefix}-type`}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </EditorField>

        <EditorField
          id={`${idPrefix}-maxLength`}
          label="Limite de caracteres"
          hint={`Só para texto curto (até ${FORM_SHORT_TEXT_MAX}) e texto longo (até ${FORM_LONG_TEXT_MAX}). Em branco vale o teto do tipo.`}
        >
          <Input
            id={`${idPrefix}-maxLength`}
            name="maxLength"
            type="number"
            min={1}
            max={FORM_LONG_TEXT_MAX}
            aria-describedby={`${idPrefix}-maxLength-hint`}
            defaultValue={field?.maxLength ?? ''}
            data-testid={`${idPrefix}-maxLength`}
          />
        </EditorField>

        <EditorField
          id={`${idPrefix}-min`}
          label="Valor mínimo"
          hint="Só para o tipo Número, em inteiros. Os limites são aceitos (18 passa numa faixa 18..99)."
        >
          <Input
            id={`${idPrefix}-min`}
            name="min"
            type="number"
            aria-describedby={`${idPrefix}-min-hint`}
            defaultValue={field?.min ?? ''}
            data-testid={`${idPrefix}-min`}
          />
        </EditorField>

        <EditorField
          id={`${idPrefix}-max`}
          label="Valor máximo"
          hint="Só para o tipo Número, em inteiros."
        >
          <Input
            id={`${idPrefix}-max`}
            name="max"
            type="number"
            aria-describedby={`${idPrefix}-max-hint`}
            defaultValue={field?.max ?? ''}
            data-testid={`${idPrefix}-max`}
          />
        </EditorField>

        <EditorField
          id={`${idPrefix}-help`}
          label="Texto de ajuda"
          hint={`Aparece abaixo do campo para o participante, até ${FORM_HELP_MAX} caracteres.`}
        >
          <Input
            id={`${idPrefix}-help`}
            name="help"
            aria-describedby={`${idPrefix}-help-hint`}
            maxLength={FORM_HELP_MAX}
            defaultValue={field?.help ?? ''}
            data-testid={`${idPrefix}-help`}
          />
        </EditorField>

        <div className="space-y-1.5">
          <span className="flex items-center gap-2">
            <Checkbox
              id={`${idPrefix}-required`}
              name="required"
              defaultChecked={field?.required ?? false}
              aria-describedby={`${idPrefix}-required-hint`}
              data-testid={`${idPrefix}-required`}
            />
            <Label htmlFor={`${idPrefix}-required`}>Resposta obrigatória</Label>
          </span>
          <p id={`${idPrefix}-required-hint`} className="text-xs text-muted-foreground">
            Campo obrigatório vazio recusa a inscrição e diz qual campo faltou.
          </p>
        </div>
      </div>

      <EditorField
        id={`${idPrefix}-options`}
        label="Opções da escolha única"
        hint={`Só para o tipo Escolha única: uma por linha, até ${FORM_CHOICE_OPTIONS_MAX} opções de ${FORM_CHOICE_OPTION_MAX} caracteres. Opção repetida é recusada.`}
      >
        <Textarea
          id={`${idPrefix}-options`}
          name="options"
          rows={3}
          aria-describedby={`${idPrefix}-options-hint`}
          defaultValue={(field?.options ?? []).join('\n')}
          data-testid={`${idPrefix}-options`}
        />
      </EditorField>

      <EditorField
        id={`${idPrefix}-purpose`}
        label="Finalidade do dado"
        hint={`Para que a resposta serve, até ${FORM_PURPOSE_MAX} caracteres. Obrigatória no tipo Texto longo — o sistema recusa o texto longo sem ela, e é o que a LGPD pede.`}
      >
        <Textarea
          id={`${idPrefix}-purpose`}
          name="purpose"
          rows={2}
          required={purposeRequired}
          aria-describedby={`${idPrefix}-purpose-hint`}
          defaultValue={field?.purpose ?? ''}
          data-testid={`${idPrefix}-purpose`}
        />
      </EditorField>
    </AdminForm>
  );
}
