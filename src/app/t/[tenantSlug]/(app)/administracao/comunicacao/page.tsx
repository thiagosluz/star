import Link from 'next/link';
import {
  AlertTriangle,
  Filter,
  History,
  ListChecks,
  Mail,
  MailCheck,
  MailX,
  Send,
  Users,
} from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listEmailMessages } from '@/lib/communication/email-service';
import { currentEmailDriver, emailFromAddress } from '@/lib/communication/mailer';
import {
  emailStatusLabel,
  isSandboxSender,
  maskEmailAddress,
} from '@/domain/communication/email-rules';
import {
  EMAIL_TEMPLATE_LABELS,
  renderEmail,
  type EmailTemplateKey,
} from '@/domain/communication/email-templates';
import {
  SEGMENT_CATALOG,
  SEGMENT_CONDITION_IDS,
  SEGMENT_PARAMETER_KIND_LABELS,
  composeSegment,
  isSegmentConditionId,
  segmentCondition,
  type SegmentDefinition,
} from '@/domain/communication/segments';
import {
  CAMPAIGN_STATUS_LABELS,
  MAX_CAMPAIGN_BODY_LENGTH,
  MAX_CAMPAIGN_SUBJECT_LENGTH,
  campaignStatusLabel,
  validateCampaignText,
} from '@/domain/communication/campaign-rules';
import {
  CAMPAIGN_MARKER_HINT,
  CAMPAIGN_MARKERS,
  renderCampaignMarkers,
  unknownCampaignMarkers,
} from '@/domain/communication/campaign-markers';
import { evaluateSegment, loadSegmentRecipients } from '@/lib/communication/segment-service';
import { loadSegmentOptions, type SegmentOptions } from '@/lib/communication/segment-options-service';
import { listCampaignHistory, type CampaignHistoryRow } from '@/lib/communication/campaign-history-service';
import { unsubscribeUrl } from '@/lib/communication/unsubscribe-service';
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
  segmentSlotField,
  segmentSlotParamField,
  type RawSearchParams,
  type SegmentFormCondition,
} from '@/lib/communication/segment-form';
import { campaignSendAction, retryEmailAction } from '@/app/actions/communication-actions';
import { CampaignSendForm } from '@/components/admin/campaign-send-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionHeading,
  Select,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableWrapper,
  Textarea,
  buttonClasses,
  fieldAria,
} from '@/components/ui';

export const metadata = { title: 'Comunicação' };
export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, 'primary' | 'success' | 'danger' | 'neutral'> = {
  QUEUED: 'primary',
  SENT: 'success',
  FAILED: 'danger',
  SKIPPED: 'neutral',
};

const FILTERS = [
  { value: null, label: 'Todas' },
  { value: 'SENT', label: 'Enviados' },
  { value: 'QUEUED', label: 'Na fila' },
  { value: 'FAILED', label: 'Falhas' },
] as const;

const CAMPAIGN_TONES: Record<string, 'primary' | 'success' | 'warning' | 'neutral'> = {
  DRAFT: 'neutral',
  SENDING: 'warning',
  SENT: 'success',
};

/** Teto da PRÉVIA da lista. A contagem nunca é limitada — a lista é que é. */
const PREVIEW_LIMIT = 50;

/**
 * O token de EXEMPLO que a prévia do passo de confirmação usa no rodapé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PRÉVIA NÃO USA O TOKEN DE VERDADE
 * ─────────────────────────────────────────────────────────────────────────────
 *  O token de descadastro é a credencial da caixa de descadastro da pessoa: quem
 *  tem o endereço pode desinscrevê-la (ou desfazer o descadastro dela). Uma tela de
 *  préVIA é lugar de mostrar o FORMATO, não de exibir credencial de terceiro — o
 *  mesmo cuidado que impede a tela de convite de mostrar o link que já pertence a
 *  outra pessoa.
 *
 *  Então o que a prévia mostra é o caminho real com um token que não resolve
 *  ninguém: 43 caracteres em base64url, do mesmo tamanho e do mesmo alfabeto do
 *  token derivado. O que ela PROVA — que o rodapé existe, que o endereço é o da
 *  instituição e que as frases do descadastro estão lá — continua provado; o que
 *  ela não faz é entregar um segredo.
 */
const PREVIEW_UNSUBSCRIBE_TOKEN = 'exemplo-de-preview-000000000000000000000000';

/**
 * De qual lista sai o parâmetro de entidade de cada condição.
 *
 * O catálogo declara o TIPO (`uuid`); quem sabe QUAL lista é a tela. Um parâmetro de
 * uuid sem lista aqui sairia como campo de texto livre — e texto livre para uuid é
 * a fábrica de segmento vazio.
 */
const OPTION_LIST_BY_PARAM: Readonly<Record<string, keyof SegmentOptions>> = {
  atividade: 'activities',
  sala: 'rooms',
  trilha: 'tracks',
  chamada: 'calls',
  carta: 'cards',
};

const SUBJECT_HINT = 'Uma linha: é o título que a pessoa lê na caixa de entrada.';
const BODY_HINT =
  'O MESMO texto vai para todas as pessoas — o modelo da casa já abre com o nome de quem recebe e fecha com a assinatura da instituição.';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  COMUNICAÇÃO DA INSTITUIÇÃO — `/t/<slug>/administracao/comunicacao`
 *  (FASE 15 · FASE 67 fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS ABAS, UM ENDEREÇO: o que já existia, e a campanha
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CAIXA DE SAÍDA responde "o que a plataforma enviou em nome da instituição?" —
 *  é conferência, mensagem a mensagem, com o motivo de cada falha. Os SEGMENTOS são
 *  o outro tempo do mesmo ofício: escolher GENTE por fatos reais e mandar o recado.
 *  As duas ficam na mesma tela porque são a mesma pergunta em dois momentos ("para
 *  quem eu falo?" e "o que saiu?").
 *
 *  A navegação é por LINK, com `aria-current` — a mesma forma dos filtros da caixa
 *  de saída. Aba que fosse só estado de cliente perderia o endereço
 *  compartilhável, que é metade do valor desta tela: quem organiza manda o link do
 *  segmento para o colega conferir antes de qualquer envio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A GUARDA DA PÁGINA É A DA CAIXA DE SAÍDA; A DO ENVIO É OUTRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ler a caixa de saída exige `communication:read`. MONTAR e DISPARAR campanha
 *  exige `participant:message` — a permissão que o catálogo criou exatamente para
 *  isto: *"quem só precisa conferir não deve poder disparar e-mail em massa"* (FASE
 *  32). Hoje os papéis que leem também enviam, então nada muda para ninguém; o que
 *  muda é o SIGNIFICADO, e é ele que sobrevive à próxima concessão estreita.
 *
 *  A aba some para quem não pode enviar (a tela esconde o que a action recusaria) —
 *  e a Server Action RECONFERE a permissão de qualquer forma, porque uma Server
 *  Action é um endpoint HTTP.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function CommunicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const { tenantSlug } = await params;
  const raw = await searchParams;
  const status = typeof raw.status === 'string' ? raw.status : null;
  const segmentTab = raw.aba === 'segmentos';

  const { tenantId, tenantName, userId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.COMMUNICATION_READ,
  });

  /** A permissão do ENVIO — a mesma que a Server Action reconfere do zero. */
  const canSend = can(principal, PERMISSIONS.PARTICIPANT_MESSAGE, { scope: 'TENANT' });

  const basePath = tenantPath(tenantSlug, '/administracao/comunicacao');
  const driver = currentEmailDriver();
  const from = emailFromAddress();
  const sandbox = isSandboxSender(from);

  const tabs = [
    { key: 'saida', label: 'Caixa de saída', href: basePath, active: !segmentTab },
    ...(canSend
      ? [
          {
            key: 'segmentos',
            label: 'Segmentos',
            href: `${basePath}?aba=segmentos`,
            active: segmentTab,
          },
        ]
      : []),
  ];

  return (
    <main className="space-y-8" data-testid="communication-page">
      <PageHeader
        title="Comunicação"
        description="O que a plataforma enviou em nome da instituição — e para quem: convites, avisos, conquistas, certificados e as campanhas segmentadas."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Comunicação' },
        ]}
        badge={<Badge tone="primary">{tenantName}</Badge>}
      />

      {driver === 'log' ? (
        <Alert tone="warning" title="Envio real desligado" data-testid="communication-driver-notice">
          O driver de e-mail deste ambiente é <strong className="font-medium">log</strong>: as mensagens
          são registradas aqui e <strong className="font-medium">não saem</strong> para o provedor. É o
          comportamento esperado em desenvolvimento e nos testes. Para enviar de verdade, defina{' '}
          <code className="code-data">EMAIL_DRIVER=resend</code> e{' '}
          <code className="code-data">RESEND_API_KEY</code>.
        </Alert>
      ) : null}

      {/**
       * O remetente de TESTE do Resend (`onboarding@resend.dev`) entrega apenas para o
       * endereço dono da conta do provedor. Sem este aviso, a instituição veria convite
       * "Falhou" com uma mensagem em inglês sobre verificar domínio — e concluiria que a
       * plataforma está quebrada.
       */}
      {driver === 'resend' && sandbox ? (
        <Alert tone="warning" title="Remetente de teste do Resend" data-testid="communication-sandbox-notice">
          O envio está ligado, mas o remetente é{' '}
          <code className="code-data">{from}</code> — o endereço de teste do Resend. Enquanto não houver
          um domínio verificado no provedor, o Resend <strong className="font-medium">só entrega</strong>{' '}
          para o endereço dono da conta: os demais destinatários voltam com erro e aparecem em{' '}
          <strong className="font-medium">Falhas</strong>. Verifique um domínio em resend.com/domains e
          troque <code className="code-data">EMAIL_FROM</code>.
        </Alert>
      ) : null}

      <nav className="flex flex-wrap gap-1 border-b border-border" aria-label="Seções da comunicação">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.active ? 'page' : undefined}
            data-testid={`communication-tab-${tab.key}`}
            className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
              tab.active
                ? 'border-primary font-medium text-brand'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {segmentTab ? (
        canSend ? (
          <SegmentsPanel
            tenantSlug={tenantSlug}
            tenantName={tenantName}
            tenantId={tenantId}
            userId={userId}
            searchParams={raw}
          />
        ) : (
          <Alert tone="warning" title="Permissão necessária" data-testid="segments-forbidden">
            Montar e disparar campanha exige a permissão{' '}
            <code className="code-data">participant:message</code>, que o seu papel não tem nesta
            instituição. A caixa de saída continua disponível.
          </Alert>
        )
      ) : (
        <OutboxPanel tenantSlug={tenantSlug} tenantId={tenantId} status={status} driver={driver} />
      )}
    </main>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aba 1 — a caixa de saída (FASE 15)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE MOSTRAR O QUE SAIU
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quando alguém diz "não recebi o convite", a pergunta real é "a plataforma
 *  enviou?". Sem esta lista, a resposta exigiria abrir o painel do provedor e cruzar
 *  endereço e horário na mão. Aqui está o registro da própria plataforma: qual
 *  mensagem, para quem, quando, por qual driver e — quando falhou — por quê.
 *
 *  O HTML enviado fica gravado no outbox (ver `email-service.ts`), então esta tela
 *  responde "o que a pessoa recebeu?", e não "o que o template diz hoje".
 *
 *  O ENDEREÇO APARECE MASCARADO: a tela é de administração e mostra para quem foi,
 *  mas quem audita o envio não precisa do endereço inteiro para reconhecer o
 *  destinatário. O domínio fica; a parte local é reduzida (`an***@exemplo.org`).
 */
async function OutboxPanel({
  tenantSlug,
  tenantId,
  status,
  driver,
}: {
  tenantSlug: string;
  tenantId: string;
  status: string | null;
  driver: string;
}) {
  const { rows, summary } = await listEmailMessages({ tenantId, status });
  const basePath = tenantPath(tenantSlug, '/administracao/comunicacao');

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="communication-stats">
        <StatCard
          label="Enviadas"
          value={summary.sent}
          hint="Entregues ao provedor"
          icon={<MailCheck className="size-4" aria-hidden />}
          data-testid="communication-sent-count"
        />
        <StatCard
          label="Na fila"
          value={summary.queued}
          hint="Aguardando entrega"
          icon={<Send className="size-4" aria-hidden />}
        />
        <StatCard
          label="Falhas"
          value={summary.failed}
          hint="Precisam de atenção"
          icon={<MailX className="size-4" aria-hidden />}
          tone={summary.failed > 0 ? 'warning' : 'primary'}
          data-testid="communication-failed-count"
        />
        <StatCard
          label="Automáticas"
          value={summary.sent + summary.queued + summary.failed}
          hint="Convites, avaliações, conquistas, certificados e campanhas"
          icon={<Mail className="size-4" aria-hidden />}
        />
      </section>

      <section className="space-y-4" aria-labelledby="caixa-de-saida">
        <SectionHeading
          title="Mensagens"
          description="Cada linha é uma mensagem que a plataforma registrou em nome da instituição."
          actions={
            <nav className="flex flex-wrap gap-1" aria-label="Filtrar por situação">
              {FILTERS.map((filter) => {
                const active = status === filter.value;
                const href = filter.value ? `${basePath}?status=${filter.value}` : basePath;

                return (
                  <Link
                    key={filter.label}
                    href={href}
                    aria-current={active ? 'true' : undefined}
                    data-testid={`communication-filter-${filter.value ?? 'all'}`}
                    className={buttonClasses({
                      variant: active ? 'primary' : 'outline',
                      size: 'sm',
                    })}
                  >
                    {filter.label}
                  </Link>
                );
              })}
            </nav>
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Mail}
            title="Nenhuma mensagem"
            description="Quando a plataforma enviar um convite, um aviso de avaliação, uma conquista, um certificado ou uma campanha, o registro aparece aqui."
          />
        ) : (
          <Card className="overflow-hidden">
            <TableWrapper>
              <Table>
                <THead>
                  <TR>
                    <TH>Mensagem</TH>
                    <TH>Destinatário</TH>
                    <TH>Situação</TH>
                    <TH>Quando</TH>
                    <TH>Ações</TH>
                  </TR>
                </THead>
                <TBody data-testid="communication-messages">
                  {rows.map((row) => (
                    <TR key={row.id} data-message-id={row.id} data-status={row.status}>
                      <TD>
                        <span className="block font-medium text-foreground">{row.subject}</span>
                        <span className="block text-xs text-muted-foreground">
                          {EMAIL_TEMPLATE_LABELS[row.template as EmailTemplateKey] ?? row.template}
                          {row.error ? ` · ${row.error}` : ''}
                        </span>
                      </TD>
                      <TD className="text-xs text-muted-foreground">{maskEmailAddress(row.to)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} size="sm">
                          {emailStatusLabel(row.status)}
                        </Badge>
                      </TD>
                      <TD className="text-xs text-muted-foreground">
                        {(row.sentAt ?? row.createdAt).toLocaleString('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                        {row.attempts > 1 ? ` · ${row.attempts} tentativas` : ''}
                      </TD>
                      <TD>
                        {row.status === 'FAILED' ? (
                          <InlineActionForm
                            action={retryEmailAction}
                            submitLabel="Tentar de novo"
                            testId={`retry-email-${row.id}`}
                            quietSuccess
                          >
                            <input type="hidden" name="tenantSlug" value={tenantSlug} />
                            <input type="hidden" name="emailMessageId" value={row.id} />
                          </InlineActionForm>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrapper>
          </Card>
        )}
      </section>

      <Alert tone="info" title="Como a entrega funciona">
        A mensagem nasce registrada (na fila) e é entregue pelo worker, com até cinco tentativas e espera
        crescente entre elas. Falha por chave inválida ou remetente não verificado não é retentada —
        insistir não resolveria —, e é o caso que aparece em{' '}
        <strong className="font-medium">Falhas</strong> com o motivo escrito.
        {driver === 'log' ? (
          <>
            {' '}
            <AlertTriangle className="inline size-3.5 align-text-bottom" aria-hidden /> Neste ambiente o
            envio externo está desligado.
          </>
        ) : null}
      </Alert>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
//  Aba 2 — os segmentos (FASE 67 · fatia 2)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A ABA "SEGMENTOS": montar, conferir, escrever, confirmar e ver o que saiu
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO DA TELA, E POR QUE ELE É ASSIM
 *  ─────────────────────────────────────────────────────────────────────────────
 *      1. **MONTAR** — um `<form method="GET">`: escolher as condições do catálogo
 *         (cada uma com os parâmetros que ela mesma declara) e um "exceto quem…".
 *         `GET` porque o resultado é um ENDEREÇO: quem organiza manda o link para o
 *         colega conferir a seleção antes de qualquer envio, e uma recarga da
 *         página não dispara nada;
 *      2. **CONFERIR** — a mesma tela mostra a CONTAGEM, as FRASES do catálogo (o que
 *         foi selecionado, em português, com o NOME no lugar do uuid), e a PRÉVIA da
 *         lista com o nome mascarado pela régua da F60. A prévia NÃO tem e-mail:
 *         endereço é dado de contato, e o único lugar que precisa dele é o disparo;
 *      3. **ESCREVER** — assunto e corpo, no MESMO formulário `GET`, para o texto
 *         sobreviver a cada ajuste no segmento;
 *      4. **CONFIRMAR** — o `POST` (a Server Action) com a definição VALIDADA num
 *         `hidden`. É o único passo que envia, e o botão diz para quantas pessoas;
 *      5. **HISTÓRICO** — o que a instituição já disparou, com o autor, as frases
 *         congeladas, a contagem e os números reais de cada passada.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não inventa mensagem de erro (todas vêm do domínio), não soma contagem em
 *  memória (contagem e resultado do disparo vêm do serviço) e não mostra e-mail de
 *  ninguém no segmento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function SegmentsPanel({
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
    /** Evento torto no endereço não pode esvaziar a lista que o organizador corrige. */
    eventId: isSegmentEventIdShaped(state.eventId) ? state.eventId : null,
  });
  const history = await listCampaignHistory({ tenantId });

  const eventOk = isSegmentEventIdShaped(state.eventId);
  const composition = state.submitted ? composeSegment(segmentFormCompositionInput(state)) : null;

  /**
   * A avaliação só roda com a definição DE PÉ e o evento em forma: contar um
   * segmento que o domínio recusou seria contar outra coisa.
   */
  const evaluation =
    composition?.ok && eventOk
      ? await evaluateSegment({
          tenantId,
          eventId: state.eventId,
          definition: composition.definition,
          limit: PREVIEW_LIMIT,
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

  /**
   * A recusa vem do DOMÍNIO, e a tela só a mostra. A única exceção é o evento torto
   * no endereço (URL editada à mão), que nem chega a ser avaliado — tratá-lo como
   * "sem evento" faria a campanha ser da instituição inteira.
   */
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

  /**
   * Os marcadores que o texto usa e o produto NÃO sabe preencher. Não bloqueiam
   * nada (o domínio manda mantê-los literais); a tela os ANUNCIA antes do envio,
   * porque o único aviso que existe do outro lado é a pessoa lendo `{cidade}` no
   * e-mail dela.
   */
  const unknownMarkers = unknownCampaignMarkers(state.body);

  /**
   * O passo de confirmação precisa das TRÊS coisas ao mesmo tempo — definição de pé,
   * contagem feita e texto válido —, e é aqui que elas se encontram. Sem o `if`, o
   * JSX teria de reconferir cada uma; com ele, o que a confirmação mostra é
   * exatamente o que foi validado.
   */
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

        <form method="GET" action={basePath} className="space-y-6" data-testid="segment-form">
          {/**
           * `aba` e `segmento` são o ENDEREÇO da própria tela: sem eles o envio cairia
           * na caixa de saída e a seleção se perderia.
           */}
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
            <legend className="text-sm font-medium text-foreground">
              Condições (todas precisam valer)
            </legend>

            {Array.from({ length: SEGMENT_SLOT_COUNT }, (_, index) => (
              <SegmentSlot
                key={`slot-${index}`}
                index={index}
                slot={state.slots[index] ?? null}
                options={options}
              />
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
              O modelo da casa (<code className="code-data">CAMPAIGN_MESSAGE</code>) monta o e-mail
              inteiro: abre com o nome de quem recebe, segue com o seu texto e fecha com “Você recebe
              esta mensagem porque participa de <em>instituição · evento</em>”, com o{' '}
              <strong className="font-medium">endereço de descadastro daquela pessoa</strong> e com a
              assinatura de quem envia.
            </p>

            <p className="text-xs text-muted-foreground" data-testid="segment-marker-note">
              <strong className="font-medium text-foreground">Personalize por pessoa:</strong>{' '}
              {CAMPAIGN_MARKER_HINT}
            </p>

            {unknownMarkers.length > 0 ? (
              /**
               * O aviso é informativo e NÃO bloqueia: o marcador desconhecido sai
               * literal na mensagem (decisão do domínio), então quem escreveu
               * precisa saber ANTES de enviar — e não descobrir pela resposta de
               * quem recebeu.
               */
              <ul className="ml-5 list-disc text-xs text-muted-foreground" data-testid="segment-unknown-markers">
                {unknownMarkers.map((marker) => (
                  <li key={marker}>
                    <code className="code-data">{`{${marker}}`}</code> não existe: ele vai sair
                    literal na mensagem. Os marcadores conhecidos são{' '}
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
        </form>
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
              <p className="text-sm text-muted-foreground" data-testid="segment-unsubscribed">
                {evaluation.unsubscribed} de {evaluation.count + evaluation.unsubscribed} saíram do canal
                desta instituição e <strong className="font-medium">não recebem</strong> — a contagem
                acima já é sem elas.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                O que você selecionou
              </h3>
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

/**
 * A prévia com os dados REAIS da primeira pessoa — renderizada pelo MESMO modelo
 * que o disparo usa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO MONTAR UM TEXTO DE EXEMPLO NA MÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Prévia escrita à parte diverge do e-mail no primeiro ajuste do template, e a
 *  divergência aparece como "o que eu vi não foi o que saiu". Aqui o texto sai de
 *  `renderEmail('CAMPAIGN_MESSAGE', …)` — as mesmas variáveis que o disparo
 *  preenche, inclusive a saudação, a origem da mensagem e o rodapé de descadastro.
 *
 *  O nome que entra é o que a LISTA mostra: mascarado quando a ocultação da F60
 *  vale. A máscara é das telas internas, e esta é uma delas — o e-mail que sai leva
 *  o nome inteiro, porque quem recebe é a própria pessoa.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS MARCADORES SÃO RESOLVIDOS, E O TOKEN DA PRÉVIA NÃO ABRE NADA
 * ─────────────────────────────────────────────────────────────────────────────
 *  O que a prévia precisa provar é que `{nome}` vira o nome de quem recebe e que o
 *  rodapé de descadastro está lá — então ela chama `renderCampaignMarkers` com
 *  exatamente os valores que o disparo monta (o nome da PRIMEIRA pessoa da lista, o
 *  nome da instituição, o título do evento).
 *
 *  O endereço de descadastro sai com um token de EXEMPLO, e não com o da pessoa: o
 *  token de verdade dá acesso à caixa de descadastro dela, e uma prévia não é
 *  lugar de exibir credencial — o mesmo cuidado que impede a tela de mostrar o
 *  link do convite de outra pessoa. O caminho, o formato e as frases são os reais;
 *  só o segredo é de mentira, e ele não abre nada.
 */
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
      unsubscribeUrl: unsubscribeUrl({
        tenantSlug: input.tenantSlug,
        token: PREVIEW_UNSUBSCRIBE_TOKEN,
      }),
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

// ───────────────────────────────────────────────────────────────────────────────
//  Um filtro do segmento
// ───────────────────────────────────────────────────────────────────────────────
function SegmentSlot({
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
        /**
         * O rótulo é "Qual condição" e o NÚMERO fica no `legend` do grupo: com o
         * mesmo texto nos dois, o leitor de tela anunciaria "Condição 1, Condição 1"
         * antes de cada campo.
         */
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
        /**
         * ─────────────────────────────────────────────────────────────────────────
         *  AQUI NÃO SAI A FRASE DO CATÁLOGO — E ISSO É DELIBERADO
         * ─────────────────────────────────────────────────────────────────────────
         *  A frase troca o parâmetro pelo NOME da coisa, e o nome depende da consulta
         *  de rótulos (`resolveSegmentLabels`, na fatia 1). Sem ela, "Quem está
         *  inscrito 9a48279c-…" é o que apareceria — um uuid no lugar de "Oficina de
         *  Robótica" não explica nada. As frases RESOLVIDAS são as que o resultado
         *  mostra, logo abaixo, e é lá que o organizador as lê antes de enviar.
         */
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

// ───────────────────────────────────────────────────────────────────────────────
//  Os parâmetros que a própria condição declara
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  A TELA NÃO SABE QUAIS PARÂMETROS EXISTEM — ELA PERGUNTA AO CATÁLOGO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Cada condição declara os próprios parâmetros (`kind`, rótulo, dica, limites).
 *  Desenhar campos por conta própria divergiria do que a composição valida: um
 *  parâmetro a mais aqui seria RECUSA lá (fail-closed), e um a menos seria um filtro
 *  que ninguém consegue preencher.
 */
function ConditionParameters({
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
  /** Prefixo dos `id`/`htmlFor`: a mesma condição pode aparecer em dois lugares. */
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

// ───────────────────────────────────────────────────────────────────────────────
//  O histórico das campanhas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O HISTÓRICO MOSTRA AS FRASES CONGELADAS
 * ─────────────────────────────────────────────────────────────────────────────
 *  O catálogo é código e vai mudar. Sem as frases gravadas no ATO, a mesma campanha
 *  passaria a se explicar com o texto de outra versão do produto — e a pergunta "por
 *  que esta pessoa recebeu?" ficaria sem resposta seis meses depois. O que esta
 *  lista mostra é o que o organizador LEU antes de enviar.
 *
 *  E o REENVIO fica na mesma linha, dizendo o que ele é: caminho de OPERAÇÃO. Uma
 *  passada pode parar no meio (limite de ritmo) ou falhar em parte do outbox; a
 *  chave do fato (`campaign:<campanha>:<pessoa>`) garante que reenviar não manda
 *  duas vezes para ninguém.
 */
function SegmentHistory({
  tenantSlug,
  rows,
}: {
  tenantSlug: string;
  rows: readonly CampaignHistoryRow[];
}) {
  return (
    <section className="space-y-4" aria-labelledby="historico-de-campanhas">
      <SectionHeading
        title="Histórico das campanhas"
        description="Cada linha é um disparo: quem mandou, o texto, a seleção congelada e o resultado real de cada passada."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={History}
          title="Nenhuma campanha ainda"
          description="Monte um segmento acima e confirme o envio: a campanha aparece aqui com as frases que a explicam e a contagem do dia."
        />
      ) : (
        <ul className="space-y-3" data-testid="campaign-history">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="space-y-3 p-4" data-testid="campaign-row" data-campaign-id={row.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium text-foreground" data-testid="campaign-subject">
                    {row.subject}
                  </p>
                  <Badge tone={CAMPAIGN_TONES[row.status] ?? 'neutral'} size="sm">
                    {campaignStatusLabel(row.status)}
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground" data-testid="campaign-meta">
                  {/**
                   * ─────────────────────────────────────────────────────────────────
                   *  POR QUE O CARIMBO É UM `<span>` PRÓPRIO
                   * ─────────────────────────────────────────────────────────────────
                   *  A regressão visual precisa esconder a DATA (que muda a cada dia)
                   *  e medir o resto da linha. Se a máscara cobrisse o `<p>` inteiro,
                   *  ela taparia também o AUTOR e o EVENTO — que são desenho, e não
                   *  dado de execução. E a `data-testid` no `<span>` é o que permite
                   *  mascarar só ele: o dia sai tapado e a célula continua medindo a
                   *  quebra e a altura da linha.
                   */}
                  <span data-testid="campaign-created-at">
                    {row.createdAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  {' · '}
                  {row.authorName ?? 'conta removida'}
                  {row.eventTitle ? ` · ${row.eventTitle}` : ' · instituição inteira'}
                </p>

                <div className="space-y-1">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    O que esta campanha selecionou
                  </h3>
                  <ul className="space-y-1 text-sm text-foreground" data-testid="campaign-explanation">
                    {row.explanation.map((phrase) => (
                      <li key={phrase}>{phrase}</li>
                    ))}
                  </ul>
                </div>

                <ul
                  className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
                  data-testid="campaign-counts"
                >
                  <li data-testid="campaign-recipients">Selecionados: {row.recipientCount}</li>
                  <li>No outbox: {row.reachedCount}</li>
                  <li>Falharam: {row.failedCount}</li>
                  <li>Saíram do canal: {row.skippedCount}</li>
                  {row.finishedAt ? (
                    /**
                     * `data-testid` PRÓPRIO pelo mesmo motivo do carimbo acima: o instante
                     * da última passada muda a cada execução, e a regressão visual precisa
                     * tapá-lo SEM tapar a linha — é dela que saem os números que a imagem
                     * mede.
                     */
                    <li data-testid="campaign-finished-at">
                      Última passada:{' '}
                      {row.finishedAt.toLocaleString('pt-BR', {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </li>
                  ) : null}
                </ul>

                {row.status === 'DRAFT' ? (
                  <p className="text-xs text-muted-foreground">
                    A campanha ainda não saiu por completo. Disparar de novo continua de onde parou.
                  </p>
                ) : null}

                {row.error ? (
                  <p className="text-xs text-destructive" role="alert" data-testid="campaign-error">
                    {row.error}
                  </p>
                ) : null}

                <InlineActionForm
                  action={campaignSendAction}
                  submitLabel="Reenviar esta campanha"
                  testId={`campaign-resend-${row.id}`}
                  variant="outline"
                >
                  <input type="hidden" name="tenantSlug" value={tenantSlug} />
                  <input type="hidden" name="acao" value="reenviar" />
                  <input type="hidden" name="campaignId" value={row.id} />
                </InlineActionForm>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Alert tone="info" title="Reenviar é caminho de operação, não erro">
        Uma passada pode parar no meio por causa do limite de ritmo do provedor, ou falhar em parte das
        mensagens. Reenviar a MESMA campanha continua de onde parou:{' '}
        <code className="code-data">campaign:&lt;campanha&gt;:&lt;pessoa&gt;</code> é a chave do fato, e
        quem já entrou no outbox volta como “já existia” — ninguém recebe duas vezes. Os estados são{' '}
        {Object.values(CAMPAIGN_STATUS_LABELS).join(' · ')}.
      </Alert>
    </section>
  );
}
