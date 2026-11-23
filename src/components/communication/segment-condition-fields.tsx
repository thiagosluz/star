import { Field, Input, Select, fieldAria } from '@/components/ui';
import {
  SEGMENT_CATALOG,
  SEGMENT_CONDITION_IDS,
  SEGMENT_PARAMETER_KIND_LABELS,
  isSegmentConditionId,
  segmentCondition,
} from '@/domain/communication/segments';
import {
  segmentSlotField,
  segmentSlotParamField,
  type SegmentFormCondition,
} from '@/lib/communication/segment-form';
import type { SegmentOptions } from '@/lib/communication/segment-options-service';

const OPTION_LIST_BY_PARAM: Readonly<Record<string, keyof SegmentOptions>> = {
  atividade: 'activities',
  sala: 'rooms',
  trilha: 'tracks',
  chamada: 'calls',
  carta: 'cards',
};

/** Campos dinâmicos declarados pela condição escolhida no catálogo de segmentos. */
export function ConditionParameters({
  id,
  values,
  fieldName,
  options,
  idPrefix,
}: {
  id: string;
  values: Readonly<Record<string, string>>;
  fieldName: (key: string) => string;
  options: SegmentOptions;
  idPrefix: string;
}) {
  if (!isSegmentConditionId(id)) return null;

  const condition = segmentCondition(id);

  if (condition.parameters.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-no-params`}>
        Esta condição não tem parâmetros: ela seleciona pelo fato, e o recorte é o evento da campanha.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {condition.parameters.map((parameter) => {
        const name = fieldName(parameter.key);
        const domId = `${idPrefix}-${parameter.key}`;
        const value = values[parameter.key] ?? '';
        const list = OPTION_LIST_BY_PARAM[parameter.key];
        const choices = list ? options[list] : [];
        const hint = `${parameter.hint} ${SEGMENT_PARAMETER_KIND_LABELS[parameter.kind]} · ${
          parameter.required ? 'obrigatório' : 'opcional'
        }`;
        const describedBy = `${domId}-hint`;
        const common = {
          id: domId,
          name,
          'aria-label': `${condition.label}: ${parameter.label}`,
          'aria-describedby': describedBy,
        } as const;

        return (
          <Field
            key={parameter.key}
            name={domId}
            label={parameter.label}
            hint={hint}
            required={parameter.required}
          >
            {parameter.kind === 'uuid' ? (
              <Select {...common} defaultValue={value}>
                <option value="">— não informado —</option>
                {choices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            ) : parameter.kind === 'data' ? (
              <Input {...common} type="date" defaultValue={value} />
            ) : parameter.kind === 'hora' ? (
              <Input {...common} type="time" defaultValue={value} />
            ) : (
              <Input
                {...common}
                type="number"
                inputMode="numeric"
                defaultValue={value}
                min={parameter.min}
                max={parameter.max}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}

/** Slot individual de filtro de condição dentro da montagem de segmento por URL. */
export function SegmentSlot({
  index,
  slot,
  options,
}: {
  index: number;
  slot: SegmentFormCondition | null;
  options: SegmentOptions;
}) {
  const field = segmentSlotField(index);
  const label = `Condição ${index + 1}`;
  const known = slot !== null && isSegmentConditionId(slot.id);

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3" data-testid={`segment-slot-${index}`}>
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</legend>

      <Field
        name={field}
        label="Qual condição"
        hint="Todas as condições escolhidas precisam valer ao mesmo tempo."
      >
        <Select {...fieldAria(field)} defaultValue={slot?.id ?? ''}>
          <option value="">— não usar —</option>
          {SEGMENT_CONDITION_IDS.map((id) => (
            <option key={id} value={id}>
              {SEGMENT_CATALOG[id].label}
            </option>
          ))}
        </Select>
      </Field>

      {slot && !known ? (
        <p className="text-xs text-destructive" data-testid={`segment-slot-${index}-unknown`}>
          Condição desconhecida: {slot.id}. Escolha outra na lista.
        </p>
      ) : null}

      {slot && known ? (
        <ConditionParameters
          id={slot.id}
          values={slot.values}
          fieldName={(key) => segmentSlotParamField(index, key)}
          options={options}
          idPrefix={`c${index}`}
        />
      ) : null}
    </fieldset>
  );
}
