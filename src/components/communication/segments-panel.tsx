import Link from 'next/link';
import { Filter, ListChecks, Users } from 'lucide-react';

import { CampaignSendForm } from '@/components/admin/campaign-send-form';
import { SegmentHistory } from '@/components/communication/campaign-history-panel';
import { ConditionParameters, SegmentSlot } from '@/components/communication/segment-condition-fields';
import {
  Alert,
  Card,
  Field,
  GetSearchForm,
  Input,
  SectionHeading,
  Select,
  Textarea,
  buttonClasses,
  fieldAria,
} from '@/components/ui';
import {
  CAMPAIGN_MARKER_HINT,
  CAMPAIGN_MARKERS,
  renderCampaignMarkers,
  unknownCampaignMarkers,
} from '@/domain/communication/campaign-markers';
import {
  MAX_CAMPAIGN_BODY_LENGTH,
  MAX_CAMPAIGN_SUBJECT_LENGTH,
  validateCampaignText,
} from '@/domain/communication/campaign-rules';
import { renderEmail } from '@/domain/communication/email-templates';
import {
  SEGMENT_CATALOG,
  SEGMENT_CONDITION_IDS,
  composeSegment,
  type SegmentDefinition,
} from '@/domain/communication/segments';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listCampaignHistory } from '@/lib/communication/campaign-history-service';
import {
  SEGMENT_BODY_FIELD,
  SEGMENT_EVENT_FIELD,
  SEGMENT_EXCEPT_FIELD,
  SEGMENT_REVIEW_FIELD,
  SEGMENT_SLOT_COUNT,
  SEGMENT_SUBJECT_FIELD,
  SEGMENT_SUBMIT_FIELD,
  encodeSegmentDefinition,
  isSegmentEventIdShaped,
  segmentExceptParamField,
  segmentFormCompositionInput,
  segmentFormFromSearchParams,
  segmentQuery,
  segmentScreenStep,
  type RawSearchParams,
} from '@/lib/communication/segment-form';
import { loadSegmentOptions } from '@/lib/communication/segment-options-service';
import { evaluateSegment, loadSegmentRecipients } from '@/lib/communication/segment-service';
import { unsubscribeUrl } from '@/lib/communication/unsubscribe-service';

const PREVIEW_LIMIT = 50;
const PREVIEW_UNSUBSCRIBE_TOKEN = 'exemplo-de-preview-000000000000000000000000';
const SUBJECT_HINT = 'Uma linha: é o título que a pessoa lê na caixa de entrada.';
const BODY_HINT =
  'O MESMO texto vai para todas as pessoas — o modelo da casa já abre com o nome de quem recebe e fecha com a assinatura da instituição.';

async function campaignPreview(input: {
  tenantId: string;
  userId: string;
  tenantName: string;
  tenantSlug: string;
  eventTitle: string | null;
  subject: string;
  body: string;
  recipientName: string | null;
}): Promise<{ subject: string; body: string; text: string; recipientLabel: string | null } | null> {
  const [author] = await loadSegmentRecipients({ tenantId: input.tenantId, userIds: [input.userId] });
  const recipientName = input.recipientName ?? '';

  const personalized = renderCampaignMarkers(input.body, {
    nome: recipientName,
    instituicao: input.tenantName,
    evento: input.eventTitle,
  });

  const rendered = renderEmail(
    'CAMPAIGN_MESSAGE',
    {
      recipientName,
      tenantName: input.tenantName,
      subject: input.subject,
      body: personalized,
      eventTitle: input.eventTitle,
      senderName: author?.name ?? null,
      unsubscribeUrl: unsubscribeUrl({ tenantSlug: input.tenantSlug, token: PREVIEW_UNSUBSCRIBE_TOKEN }),
    },
    { brandName: input.tenantName },
  );

  return {
    subject: rendered.subject,
    body: personalized,
    text: rendered.text,
    recipientLabel: input.recipientName,
  };
}

/** Aba 2 de Comunicação: montagem por GET, contagem, revisão pré-disparo e histórico. */
export async function SegmentsPanel({
  tenantSlug,
  tenantName,
  tenantId,
  userId,
  searchParams,
}: {
  tenantSlug: string;
  tenantName: string;
  tenantId: string;
  userId: string;
  searchParams: RawSearchParams;
}) {
  const state = segmentFormFromSearchParams(searchParams);
  const basePath = tenantPath(tenantSlug, '/administracao/comunicacao');

  const options = await loadSegmentOptions({
    tenantId,
    eventId: isSegmentEventIdShaped(state.eventId) ? state.eventId : null,
  });
  const history = await listCampaignHistory({ tenantId });

  const eventOk = isSegmentEventIdShaped(state.eventId);
  const composition = state.submitted ? composeSegment(segmentFormCompositionInput(state)) : null;

  const evaluation =
    composition?.ok && eventOk
      ? await evaluateSegment({
          tenantId,
          eventId: state.eventId,
          definition: composition.definition,
          limit: PREVIEW_LIMIT,
          withUnsubscribeReasons: true,
        })
      : null;

  const text = validateCampaignText({ subject: state.subject, body: state.body });
  const step = segmentScreenStep({
    submitted: state.submitted,
    compositionOk: composition?.ok ?? false,
    evaluationOk: evaluation?.ok ?? false,
    textOk: text.ok,
    reviewing: state.reviewing,
  });

  const refusal = !eventOk
    ? {
        message: 'O evento informado no endereço não é válido.',
        issues: ['Escolha um evento da lista e envie o formulário de novo.'],
      }
    : composition && !composition.ok
      ? { message: composition.message, issues: composition.issues.map((issue) => issue.message) }
      : evaluation && !evaluation.ok
        ? { message: evaluation.message, issues: evaluation.details ?? [] }
        : null;

  const warnings = composition?.issues.filter((issue) => !issue.blocking) ?? [];
  const unknownMarkers = unknownCampaignMarkers(state.body);

  let confirmed: {
    definition: SegmentDefinition;
    count: number;
    unsubscribed: number;
    firstName: string | null;
  } | null = null;
  let preview: { subject: string; body: string; text: string; recipientLabel: string | null } | null = null;

  if (step === 'confirmar' && composition && composition.ok && evaluation && evaluation.ok) {
    confirmed = {
      definition: composition.definition,
      count: evaluation.count,
      unsubscribed: evaluation.unsubscribed,
      firstName: evaluation.people[0]?.name ?? null,
    };

    preview = await campaignPreview({
      tenantId,
      userId,
      tenantName,
      tenantSlug,
      eventTitle: options.events.find((option) => option.id === state.eventId)?.label ?? null,
      subject: text.ok ? text.subject : state.subject,
      body: text.ok ? text.body : state.body,
      recipientName: confirmed.firstName,
    });
  }

  const baseQuery = segmentQuery(searchParams, { omit: [SEGMENT_REVIEW_FIELD] });
  const editableHref = baseQuery ? `${basePath}?${baseQuery}` : `${basePath}?aba=segmentos`;

  return (
    <>
      <section className="space-y-4" aria-labelledby="montar-segmento">
        <SectionHeading
          title="Montar o segmento"
          description="Escolha as condições do catálogo — todas precisam valer — e, se quiser, um “exceto quem…”. O endereço desta página guarda a seleção: dá para mandar o link para outra pessoa conferir."
        />

        <GetSearchForm action={basePath} className="space-y-6" data-testid="segment-form">
          <input type="hidden" name="aba" value="segmentos" />
          <input type="hidden" name={SEGMENT_SUBMIT_FIELD} value="1" />

          <Field
            name={SEGMENT_EVENT_FIELD}
            label="Evento da campanha"
            hint="As condições de evento (presença, inscrição, submissão) precisam dele. Em branco, a campanha é da instituição inteira — e só as condições que não recortam por evento podem ser usadas."
          >
            <Select {...fieldAria(SEGMENT_EVENT_FIELD)} defaultValue={state.eventId ?? ''}>
              <option value="">— a instituição inteira —</option>
              {options.events.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <fieldset className="space-y-4" data-testid="segment-conditions">
            <legend className="text-sm font-medium text-foreground">Condições (todas precisam valer)</legend>

            {Array.from({ length: SEGMENT_SLOT_COUNT }, (_, index) => (
              <SegmentSlot key={`slot-${index}`} index={index} slot={state.slots[index] ?? null} options={options} />
            ))}

            <Field
              name={SEGMENT_EXCEPT_FIELD}
              label="Exceto quem…"
              hint="Uma exclusão: quem cair nela não recebe, mesmo que satisfaça todas as condições acima."
            >
              <Select {...fieldAria(SEGMENT_EXCEPT_FIELD)} defaultValue={state.except?.id ?? ''}>
                <option value="">— sem exclusão —</option>
                {SEGMENT_CONDITION_IDS.map((id) => (
                  <option key={id} value={id}>
                    {SEGMENT_CATALOG[id].label}
                  </option>
                ))}
              </Select>
            </Field>

            {state.except ? (
              <ConditionParameters
                id={state.except.id}
                values={state.except.values}
                fieldName={segmentExceptParamField}
                options={options}
                idPrefix="exceto"
              />
            ) : null}
          </fieldset>

          <fieldset className="space-y-4 rounded-lg border border-border p-4" data-testid="segment-message">
            <legend className="px-1 text-sm font-medium text-foreground">A mensagem</legend>

            <Field
              name={SEGMENT_SUBJECT_FIELD}
              label="Assunto"
              hint={SUBJECT_HINT}
              required
              error={step === 'contar' && !text.ok ? text.message : null}
            >
              <Input
                {...fieldAria(SEGMENT_SUBJECT_FIELD, {
                  hint: SUBJECT_HINT,
                  error: step === 'contar' && !text.ok ? text.message : null,
                })}
                defaultValue={state.subject}
                maxLength={MAX_CAMPAIGN_SUBJECT_LENGTH}
              />
            </Field>

            <Field name={SEGMENT_BODY_FIELD} label="Corpo da mensagem" hint={BODY_HINT} required>
              <Textarea
                {...fieldAria(SEGMENT_BODY_FIELD, { hint: BODY_HINT })}
                defaultValue={state.body}
                rows={8}
                maxLength={MAX_CAMPAIGN_BODY_LENGTH}
              />
            </Field>

            <p className="text-xs text-muted-foreground" data-testid="segment-template-note">
              O modelo da casa (<code className="code-data">CAMPAIGN_MESSAGE</code>) monta o e-mail inteiro: abre
              com o nome de quem recebe, segue com o seu texto e fecha com “Você recebe esta mensagem porque
              participa de <em>instituição · evento</em>”, com o{' '}
              <strong className="font-medium">endereço de descadastro daquela pessoa</strong> e com a assinatura de
              quem envia.
            </p>

            <p className="text-xs text-muted-foreground" data-testid="segment-marker-note">
              <strong className="font-medium text-foreground">Personalize por pessoa:</strong> {CAMPAIGN_MARKER_HINT}
            </p>

            {unknownMarkers.length > 0 ? (
              <ul className="ml-5 list-disc text-xs text-muted-foreground" data-testid="segment-unknown-markers">
                {unknownMarkers.map((marker) => (
                  <li key={marker}>
                    <code className="code-data">{`{${marker}}`}</code> não existe: ele vai sair literal na
                    mensagem. Os marcadores conhecidos são{' '}
                    {CAMPAIGN_MARKERS.map((known) => `{${known}}`).join(', ')}.
                  </li>
                ))}
              </ul>
            ) : null}
          </fieldset>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              data-testid="segment-count-submit"
              className={buttonClasses({ variant: 'primary', size: 'sm' })}
            >
              <Filter className="size-3.5" aria-hidden />
              Ver a seleção
            </button>

            {step === 'contar' && text.ok ? (
              <button
                type="submit"
                name={SEGMENT_REVIEW_FIELD}
                value="1"
                data-testid="segment-review-submit"
                className={buttonClasses({ variant: 'outline', size: 'sm' })}
              >
                <ListChecks className="size-3.5" aria-hidden />
                Revisar e enviar
              </button>
            ) : null}
          </div>
        </GetSearchForm>
      </section>

      {step === 'recusado' && refusal ? (
        <Alert tone="warning" title="Segmento recusado — nada será enviado" data-testid="segment-refused">
          <p data-testid="segment-refused-message">{refusal.message}</p>
          {refusal.issues.length > 0 ? (
            <ul className="ml-5 list-disc text-xs" data-testid="segment-refused-issues">
              {refusal.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      {step !== 'montar' && !refusal && evaluation?.ok ? (
        <section className="space-y-4" aria-labelledby="resultado-do-segmento">
          <SectionHeading
            title="Quem vai receber"
            description="A contagem é do banco, no momento em que esta página foi montada. A lista é uma prévia interna — e não mostra e-mail de ninguém."
          />

          <Card className="space-y-4 p-4" data-testid="segment-result">
            <p className="flex flex-wrap items-baseline gap-2">
              <Users className="size-4 text-brand" aria-hidden />
              <span className="font-display text-title-lg text-foreground" data-testid="segment-count">
                {evaluation.count}
              </span>
              <span className="text-sm text-muted-foreground">
                {evaluation.count === 1 ? 'pessoa vai receber' : 'pessoas vão receber'}
              </span>
            </p>

            {evaluation.unsubscribed > 0 ? (
              <div className="space-y-1" data-testid="segment-unsubscribed">
                <p className="text-sm text-muted-foreground">
                  {evaluation.unsubscribed} de {evaluation.count + evaluation.unsubscribed} saíram do canal
                  desta instituição e <strong className="font-medium">não recebem</strong> — a contagem acima já
                  é sem elas.
                </p>
                {evaluation.unsubscribeReasons ? (
                  <p className="text-sm text-muted-foreground" data-testid="segment-unsubscribe-reasons">
                    Motivos de quem saiu: {evaluation.unsubscribeReasons}.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">O que você selecionou</h3>
              <ul className="space-y-1 text-sm text-foreground" data-testid="segment-explanation">
                {evaluation.explanation.map((phrase) => (
                  <li key={phrase}>{phrase}</li>
                ))}
              </ul>
              {evaluation.exclusion ? (
                <p className="text-sm text-foreground" data-testid="segment-exclusion">
                  <strong className="font-medium">Exceto:</strong> {evaluation.exclusion}
                </p>
              ) : null}
            </div>

            {warnings.length > 0 ? (
              <ul className="ml-5 list-disc text-xs text-muted-foreground" data-testid="segment-warnings">
                {warnings.map((issue) => (
                  <li key={`${issue.scope}-${issue.index}-${issue.code}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}

            <div className="space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prévia da lista ({evaluation.people.length} de {evaluation.count})
              </h3>

              {evaluation.people.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="segment-people-empty">
                  Ninguém satisfaz esta seleção agora.
                </p>
              ) : (
                <ul className="grid gap-1 text-sm text-foreground sm:grid-cols-2" data-testid="segment-people">
                  {evaluation.people.map((person) => (
                    <li
                      key={person.userId}
                      data-testid="segment-person"
                      data-masked={person.masked ? 'true' : 'false'}
                      className="flex flex-wrap items-baseline gap-2"
                    >
                      <span>{person.name}</span>
                      {person.masked ? (
                        <span className="text-xs text-muted-foreground" data-testid="segment-person-mask">
                          perfil oculto — nome abreviado na tela interna
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}

              {evaluation.truncated ? (
                <p className="text-xs text-muted-foreground" data-testid="segment-people-truncated">
                  A prévia mostra as primeiras {evaluation.people.length} de {evaluation.count} pessoas — a
                  contagem acima é a do banco.
                </p>
              ) : null}
            </div>
          </Card>

          {step === 'contar' && !text.ok ? (
            <Alert tone="info" title="Falta o texto da mensagem" data-testid="segment-text-missing">
              {text.message}
            </Alert>
          ) : null}

          {confirmed && preview ? (
            <Card className="space-y-4 p-4" data-testid="segment-confirmation">
              <h3 className="text-sm font-medium text-foreground">Confirmar o envio</h3>

              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">Assunto:</p>
                <p className="font-medium text-foreground" data-testid="segment-confirm-subject">
                  {preview.subject}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Prévia da mensagem com os dados reais da primeira pessoa da lista
                  {preview.recipientLabel ? ` (${preview.recipientLabel})` : ''}:
                </p>
                <p
                  className="whitespace-pre-wrap rounded-md border border-border bg-surface-low p-3 text-sm text-foreground"
                  data-testid="segment-body-preview"
                >
                  {preview.text}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                Quer mudar o segmento ou o texto?{' '}
                <Link href={editableHref} className="underline" data-testid="segment-back-to-edit">
                  Volte para a edição
                </Link>{' '}
                — nada foi enviado ainda.
              </p>

              <CampaignSendForm
                tenantSlug={tenantSlug}
                eventId={state.eventId}
                definicao={encodeSegmentDefinition(confirmed.definition)}
                assunto={preview.subject}
                corpo={preview.body}
                recipientCount={confirmed.count}
                unsubscribed={confirmed.unsubscribed}
              />
            </Card>
          ) : null}
        </section>
      ) : null}

      <SegmentHistory tenantSlug={tenantSlug} rows={history} />
    </>
  );
}
