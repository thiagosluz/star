'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PAINEL — O editor de UM campo do formulário de inscrição (FASE 70 · FASE 136)
 *
 *  Progressivo (ADR-529):
 *   • Com JavaScript ativo (`useIsInteractive()`), mostra APENAS os controles do
 *     tipo selecionado (`Limite de caracteres` para texto, `Mín/Máx` para número,
 *     `Opções` para escolha única) e oferece 5 presets de perguntas comuns em 1
 *     clique no cadastro de novo campo.
 *   • Sem JavaScript, renderiza todos os controles como fallback completo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useState, type ReactNode } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';

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
  type FormFieldType,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import {
  REGISTRATION_FIELD_PRESETS,
  fieldControlsForType,
  type RegistrationFieldPreset,
} from '@/domain/events/registration-ux-rules';
import { AdminForm } from '@/components/admin/admin-form';
import { Checkbox, Input, Label, Select, Textarea } from '@/components/ui';
import { useIsInteractive } from '@/hooks/use-is-interactive';
import { saveRegistrationFormFieldAction } from '@/app/actions/registration-form-actions';

export const FREE_TEXT_NOTICE_KEYS = THIRD_PARTY_FORBIDDEN_FORM_KEYS;

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
  field: RegistrationFormField | null;
  idPrefix: string;
  testId: string;
  submitLabel: string;
}) {
  const interactive = useIsInteractive();
  const [selectedType, setSelectedType] = useState<FormFieldType>(field?.type ?? 'SHORT_TEXT');
  const [label, setLabel] = useState(field?.label ?? '');
  const [help, setHelp] = useState(field?.help ?? '');
  const [optionsText, setOptionsText] = useState((field?.options ?? []).join('\n'));
  const [purpose, setPurpose] = useState(field?.purpose ?? '');

  const controls = fieldControlsForType(selectedType);
  const showMaxLength = !interactive || controls.showMaxLength;
  const showMinMax = !interactive || controls.showMinMax;
  const showOptions = !interactive || controls.showOptions;
  const purposeRequired = (field !== null || interactive) && controls.requiresPurpose;

  const applyPreset = (preset: RegistrationFieldPreset) => {
    setLabel(preset.label);
    setSelectedType(preset.type);
    setHelp(preset.help);
    setOptionsText((preset.options ?? []).join('\n'));
    setPurpose(preset.purpose ?? '');
  };

  return (
    <AdminForm
      action={saveRegistrationFormFieldAction}
      submitLabel={submitLabel}
      testId={testId}
      compact
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="originalKey" value={field?.key ?? ''} />

      {field === null && interactive ? (
        <div
          className="space-y-1.5 rounded-md border border-border bg-surface-low/60 p-3"
          data-testid="form-field-presets"
        >
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
            Perguntas prontas (preenchem os campos abaixo em 1 clique):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {REGISTRATION_FIELD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                data-testid={`form-field-preset-${preset.id}`}
                className="rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                + {preset.buttonLabel}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            data-testid={`${idPrefix}-label`}
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
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as FormFieldType)}
            data-testid={`${idPrefix}-type`}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </EditorField>

        {showMaxLength ? (
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
        ) : null}

        {showMinMax ? (
          <>
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
          </>
        ) : null}

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
            value={help}
            onChange={(event) => setHelp(event.target.value)}
            data-testid={`${idPrefix}-help`}
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

        <div className="space-y-1.5 sm:col-span-2">
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

      {showOptions ? (
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
            value={optionsText}
            onChange={(event) => setOptionsText(event.target.value)}
            data-testid={`${idPrefix}-options`}
          />
        </EditorField>
      ) : null}

      <EditorField
        id={`${idPrefix}-purpose`}
        label={purposeRequired ? 'Finalidade do dado (obrigatória)' : 'Finalidade do dado'}
        hint={`Para que a resposta serve, até ${FORM_PURPOSE_MAX} caracteres. Obrigatória no tipo Texto longo — o sistema recusa o texto longo sem ela, e é o que a LGPD pede.`}
      >
        <Textarea
          id={`${idPrefix}-purpose`}
          name="purpose"
          rows={2}
          aria-required={purposeRequired || undefined}
          aria-describedby={`${idPrefix}-purpose-hint`}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
          data-testid={`${idPrefix}-purpose`}
        />
      </EditorField>
    </AdminForm>
  );
}
