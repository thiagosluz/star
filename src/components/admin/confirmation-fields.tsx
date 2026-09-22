import { Field, SelectField } from '@/components/admin/admin-form';
import {
  CONFIRMATION_POLICIES,
  CONFIRMATION_POLICY_LABELS,
  CONFIRMATION_REQUIREMENT_KINDS,
  CONFIRMATION_REQUIREMENT_KIND_LABELS,
  CONFIRMATION_WINDOW_DEFAULT_DAYS,
  CONFIRMATION_WINDOW_MAX_DAYS,
  CONFIRMATION_WINDOW_MIN_DAYS,
  type ConfirmationPolicy,
  type ConfirmationRequirement,
} from '@/domain/events/confirmation-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Confirmação de vaga com prazo (FASE 34) — campos do cadastro da atividade
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE BLOCO É UM COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A escolha da confirmação aparece nos DOIS formulários da Programação (criar e
 *  editar). Duplicar o bloco faria os dois divergirem na primeira manutenção — e o
 *  defeito seria invisível, porque cada tela continuaria "funcionando" com regras
 *  diferentes para a mesma atividade.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS LINHAS SÃO FIXAS, COMO A RUBRICA DA CHAMADA (FASE 33)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem JavaScript no cliente: um número fixo de linhas (três é a folga mínima) e
 *  linha em branco descartada na leitura. Adicionar/remover linha com botão exigiria
 *  um componente de cliente para um formulário que já é longo, e o organizador
 *  costuma ter poucas exigências (uma taxa, um item, um documento).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ConfirmationFields({
  policy,
  windowDays,
  requirements,
  place,
  instructions,
}: {
  policy: ConfirmationPolicy;
  windowDays: number | null;
  requirements: readonly ConfirmationRequirement[];
  place: string | null;
  instructions: string | null;
}) {
  /** Pelo menos três linhas: a primeira exigência cabe com folga. */
  const rows = Math.max(3, requirements.length);

  const policyOptions = CONFIRMATION_POLICIES.map((value) => ({
    value,
    label: CONFIRMATION_POLICY_LABELS[value],
  }));

  const requirementKindOptions = [
    { value: '', label: 'Categoria…' },
    ...CONFIRMATION_REQUIREMENT_KINDS.map((value) => ({
      value,
      label: CONFIRMATION_REQUIREMENT_KIND_LABELS[value],
    })),
  ];

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3 sm:col-span-2" data-testid="activity-confirmation">
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Confirmação de vaga (opcional)
      </legend>

      <p className="text-xs text-muted-foreground">
        Sem confirmação, a vaga é confirmada <strong>no ato da inscrição</strong> — o comportamento de
        sempre. Escolhendo <strong>“Exige confirmação”</strong>, a inscrição nasce reservada: a vaga fica
        retida até a equipe registrar a confirmação aqui na plataforma, e é liberada automaticamente se o
        prazo vencer. Não se aplica a atividade <strong>aberta</strong> a todos os inscritos do evento.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Confirmação de vaga"
          name="confirmationPolicy"
          options={policyOptions}
          defaultValue={policy}
          hint="A escolha vale para as inscrições NOVAS — quem já está confirmado não é desconvidado."
        />
        <Field
          label="Prazo para confirmar (dias)"
          name="confirmationWindowDays"
          type="number"
          min={CONFIRMATION_WINDOW_MIN_DAYS}
          max={CONFIRMATION_WINDOW_MAX_DAYS}
          defaultValue={windowDays ?? CONFIRMATION_WINDOW_DEFAULT_DAYS}
          hint={`Contado da inscrição de cada pessoa, vencendo no fim do dia (${CONFIRMATION_WINDOW_MIN_DAYS} a ${CONFIRMATION_WINDOW_MAX_DAYS} dias).`}
        />
        <Field
          label="Onde confirmar"
          name="confirmationPlace"
          defaultValue={place ?? ''}
          placeholder="Secretaria do bloco B, térreo — das 9h às 18h"
          hint="O lugar que a pessoa procura. Aparece no e-mail e no aviso da plataforma."
        />
        <Field
          label="Orientações (opcional)"
          name="confirmationInstructions"
          defaultValue={instructions ?? ''}
          placeholder="Leve o comprovante impresso."
          hint="Texto livre de apoio, além da lista de exigências."
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          O que é preciso para confirmar
        </p>

        {Array.from({ length: rows }, (_, index) => {
          const requirement = requirements[index];

          return (
            <div key={index} className="grid gap-2 sm:grid-cols-3">
              {/**
                * Os três rótulos são específicos E nenhum contém o outro: "Tipo" colidiria
                * com o campo homônimo da atividade, e "Exigência 1" é SUBSTRING de
                * "Categoria da exigência 1" — o casamento de rótulo é por substring (no
                * Playwright e em leitor de tela, que anuncia o nome inteiro). Rótulo de
                * formulário é identificador: precisa ser único na tela inteira
                * (armadilha 81).
                */}
              <SelectField
                label={`Categoria da exigência ${index + 1}`}
                name="requirementKind"
                options={requirementKindOptions}
                defaultValue={requirement?.kind ?? ''}
              />
              <Field
                label={`Descrição da exigência ${index + 1}`}
                name="requirementLabel"
                placeholder="1 kg de alimento não perecível"
                defaultValue={requirement?.label}
              />
              <Field
                label={`Observação da exigência ${index + 1}`}
                name="requirementNote"
                placeholder="Vale qualquer marca"
                defaultValue={requirement?.note}
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
