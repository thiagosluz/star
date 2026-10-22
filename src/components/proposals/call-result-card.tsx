'use client';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CARTÃO DO RESULTADO NA TELA DE CHAMADAS (FASE 73 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A TELA NÃO DECIDE LEGALIDADE — ELA RECEBE A LISTA PRONTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `acoesDisponiveis` vem de `availableCallResultActions(estado)` (fatia 1) pelo
 *  serviço, e é a ÚNICA coisa que decide quais botões existem. Aqui não há um
 *  `if (estado === 'FINAL')` para esconder botão: quando o resultado está travado, a
 *  lista chega com REABRIR e só ele — e a tela desenha a lista. Se alguém tentar
 *  "consertar" a tela um dia acrescentando um botão por conta própria, a action
 *  continua recusando (a autorização e a regra moram no servidor), mas a tela teria
 *  prometido o impossível — por isso a derivação não é copiada para cá.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FORMULÁRIO É UM SÓ, COM QUATRO BOTÕES `formAction`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os quatro atos gravam o MESMO conteúdo (texto, próximos passos, lista): quatro
 *  formulários separados repetiriam os campos — e, repetidos, um deles ficaria para
 *  trás no primeiro ajuste. Um formulário só, com o `action` do "Salvar rascunho" e
 *  um `formAction` por gesto, mantém os campos em um lugar. O `useActionState` de
 *  cada gesto é independente (o padrão do editor de certificado e do console do
 *  sorteio) e o retorno exibido é o do gesto que acabou de ser clicado.
 *
 *  E funciona SEM JAVASCRIPT: `formAction` de Server Action também é renderizado como
 *  POST nativo. O E2E abre um contexto com `javaScriptEnabled: false` e publica de
 *  verdade — se isso dependesse de hidratação, o organizador no pavilhão não
 *  conseguiria publicar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA TELA NÃO FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não autoriza (a página tem `requirePagePermission(EVENT_MANAGE)` e as actions
 *  guardam `event:manage`), não recalcula a projeção pública (desenha
 *  `panel.publico`, que veio de `projectPublicCallResult`) e não traduz status por
 *  conta própria (importa `SUBMISSION_STATUS_LABELS` do domínio — não cria a quarta
 *  cópia do mapa).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import {
  publishFinalCallResultAction,
  publishPartialCallResultAction,
  reopenCallResultAction,
  saveCallResultDraftAction,
  type CallActionState,
} from '@/app/actions/call-actions';
import {
  CALL_RESULT_NEXT_STEPS_MAX,
  CALL_RESULT_TEXT_MAX,
  SUBMISSION_STATUS_LABELS,
  type CallResult,
  type CallResultAction,
  type CallResultSelectorOption,
  type CallResultState,
  type PublicCallResultView,
} from '@/domain/proposals/call-result-rules';
import {
  CALL_RESULT_ACTION_SCREEN,
  CALL_RESULT_NEXT_STEPS_HINT,
  CALL_RESULT_PREVIEW_EMPTY,
  CALL_RESULT_PREVIEW_TITLE,
  CALL_RESULT_PUBLISH_NOTICE,
  CALL_RESULT_SELECTOR_HELP,
  CALL_RESULT_STATE_SCREEN,
  CALL_RESULT_TEXT_HINT,
  callResultProblemsTitle,
  callResultPublicationPhrase,
} from '@/domain/proposals/call-result-organizer-rules';
import { Badge, Button, Field, Textarea, fieldAria, type BadgeTone } from '@/components/ui';
import { CheckboxField } from '@/components/admin/admin-form';
import { CallResultPublicView } from '@/components/proposals/call-result-public-view';

export interface CallResultCardProps {
  tenantSlug: string;
  callId: string;
  callTitle: string;
  /** O resultado GRAVADO, lido pelo leitor tolerante do domínio. */
  resultado: CallResult;
  /** Os gestos LEGAIS agora — o serviço já os derivou da tabela do domínio. */
  acoesDisponiveis: readonly CallResultAction[];
  /** TODAS as submissões da chamada, com a decisão e a pré-marcação. */
  seletor: readonly CallResultSelectorOption[];
  /** A projeção pública REAL (`null` = a seção não existe no público). */
  publico: PublicCallResultView | null;
  /** O que a leitura precisou descartar — config torta ou id publicado excluído. */
  problems: readonly string[];
  /** Data da publicação vigente, já formatada no fuso do evento. */
  publicadoEmLabel: string | null;
}

/**
 * O tom do selo por estado.
 *
 * É apresentação, e por isso vive aqui: o DOMÍNIO diz o que o estado significa
 * (`CALL_RESULT_STATE_SCREEN`), e a tela escolhe como pintá-lo. O rótulo nunca é só
 * cor — o `Badge` do sistema exige texto, e o texto é o do domínio.
 */
const ESTADO_TONE: Readonly<Record<CallResultState, BadgeTone>> = {
  SEM_RESULTADO: 'neutral',
  RASCUNHO: 'neutral',
  PARCIAL: 'info',
  FINAL: 'success',
};

/** O gesto → o `formAction` do hook correspondente. */
type GestoDoResultado = Exclude<CallResultAction, 'REABRIR'>;

export function CallResultCard({
  tenantSlug,
  callId,
  callTitle,
  resultado,
  acoesDisponiveis,
  seletor,
  publico,
  problems,
  publicadoEmLabel,
}: CallResultCardProps) {
  const [salvarState, salvarFormAction] = useActionState<CallActionState | null, FormData>(
    saveCallResultDraftAction,
    null,
  );
  const [parcialState, parcialFormAction] = useActionState<CallActionState | null, FormData>(
    publishPartialCallResultAction,
    null,
  );
  const [finalState, finalFormAction] = useActionState<CallActionState | null, FormData>(
    publishFinalCallResultAction,
    null,
  );
  const [reabrirState, reabrirFormAction] = useActionState<CallActionState | null, FormData>(
    reopenCallResultAction,
    null,
  );

  /**
   * Qual retorno mostrar.
   *
   * Os quatro `useActionState` guardam o retorno do PRÓPRIO gesto. Sem esta escolha,
   * dois gestos seguidos deixariam duas mensagens na tela — uma delas já velha. A
   * marca é posta no `onClick` (que só existe com JavaScript, e é só quando o
   * retorno é exibido); sem bundle, o POST recarrega a página e o estado novo é a
   * resposta.
   */
  const [ultimoGesto, setUltimoGesto] = useState<CallResultAction | null>(null);

  const retorno =
    ultimoGesto === 'SALVAR_RASCUNHO'
      ? salvarState
      : ultimoGesto === 'PUBLICAR_PARCIAL'
        ? parcialState
        : ultimoGesto === 'PUBLICAR_FINAL'
          ? finalState
          : ultimoGesto === 'REABRIR'
            ? reabrirState
            : null;

  const screen = CALL_RESULT_STATE_SCREEN[resultado.estado];
  const podeReabrir = acoesDisponiveis.includes('REABRIR');

  /**
   * Os três gestos de edição, na ordem em que a tela os mostra — e SÓ os que a lista
   * legal trouxe. O `filter` não inventa nada: em FINAL, a lista vem `['REABRIR']` e
   * este array sai vazio.
   */
  const gestos = acoesDisponiveis.filter(
    (acao): acao is GestoDoResultado => acao !== 'REABRIR',
  );

  const acoesDoGesto: Readonly<Record<GestoDoResultado, (formData: FormData) => void>> = {
    SALVAR_RASCUNHO: salvarFormAction,
    PUBLICAR_PARCIAL: parcialFormAction,
    PUBLICAR_FINAL: finalFormAction,
  };

  /** O nome do campo oculto único por chamada — o id do `Field` não pode repetir. */
  const textoField = `resultado-texto-${callId}`;
  const passosField = `resultado-passos-${callId}`;
  const previewId = `resultado-previa-${callId}`;
  const headingId = `resultado-${callId}`;

  return (
    <section
      className="space-y-4 rounded-md border border-border bg-surface-low p-3"
      data-testid={`call-result-${callId}`}
      data-result-state={resultado.estado}
      aria-labelledby={headingId}
    >
      <div className="space-y-1.5">
        <h3 id={headingId} className="text-sm font-semibold">
          Resultado da chamada <span className="font-normal">“{callTitle}”</span>
        </h3>

        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={ESTADO_TONE[resultado.estado]} size="sm">
            {screen.label}
          </Badge>
          {screen.locked ? (
            <Badge
              tone="warning"
              size="sm"
              withDot
              data-testid={`call-result-locked-${callId}`}
            >
              travado
            </Badge>
          ) : null}
        </p>

        <p className="text-sm text-foreground" data-testid={`call-result-state-${callId}`}>
          {screen.phrase}
        </p>

        <p className="text-xs text-muted-foreground" data-testid={`call-result-published-${callId}`}>
          {callResultPublicationPhrase({
            estado: resultado.estado,
            publicadoEmLabel,
          })}
        </p>
      </div>

      {/**
       * ── OS `problems` NÃO SÃO ESCONDIDOS ─────────────────────────────────────
       *
       *  O leitor tolerante nunca lança, e é isso que impede um JSON torto de derrubar
       *  a página. Mas tolerar não é ignorar: um id publicado que aponta para
       *  submissão excluída faz o item SAIR da lista pública, e o organizador precisa
       *  saber que o documento no ar está menor do que ele escolheu — em vez de
       *  descobrir por acaso. O aviso usa o par de aviso do sistema, cujo contraste é
       *  medido no portão WCAG AA (FASE 52).
       */}
      {problems.length > 0 ? (
        <div
          role="status"
          data-testid={`call-result-problems-${callId}`}
          className="space-y-1 rounded-sm border border-warning bg-warning-soft p-2.5 text-xs text-warning-strong"
        >
          <p className="font-medium">{callResultProblemsTitle(problems.length)}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {problems.map((problem, index) => (
              <li key={`${index}-${problem}`}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        action={salvarFormAction}
        className="space-y-4"
        data-testid={`call-result-form-${callId}`}
      >
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="callId" value={callId} />

        <Field name={textoField} label="Texto público" hint={CALL_RESULT_TEXT_HINT}>
          <Textarea
            {...fieldAria(textoField, { hint: CALL_RESULT_TEXT_HINT })}
            name="texto"
            rows={4}
            maxLength={CALL_RESULT_TEXT_MAX}
            defaultValue={resultado.texto}
            /* No final o conteúdo está travado: editar um campo que não salva mentiria. */
            readOnly={screen.locked}
            data-testid={`call-result-text-${callId}`}
          />
        </Field>

        <Field name={passosField} label="Próximos passos" hint={CALL_RESULT_NEXT_STEPS_HINT}>
          <Textarea
            {...fieldAria(passosField, { hint: CALL_RESULT_NEXT_STEPS_HINT })}
            name="proximosPassos"
            rows={3}
            maxLength={CALL_RESULT_NEXT_STEPS_MAX}
            defaultValue={resultado.proximosPassos}
            readOnly={screen.locked}
            data-testid={`call-result-next-steps-${callId}`}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground">Lista do resultado</legend>
          <p className="text-xs text-muted-foreground">{CALL_RESULT_SELECTOR_HELP}</p>

          {seletor.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid={`call-result-selector-empty-${callId}`}>
              Esta chamada ainda não recebeu propostas. O texto e os próximos passos podem ser
              publicados sem lista.
            </p>
          ) : (
            <ul className="space-y-2" data-testid={`call-result-selector-${callId}`}>
              {seletor.map((opcao) => (
                <li
                  key={opcao.id}
                  className="rounded-sm border border-border px-3 py-2"
                  data-testid={`call-result-option-${opcao.id}`}
                  data-decisao={opcao.decisao}
                >
                  {/**
                   * ── NO FINAL, A CAIXA TRAVA — MAS O VALOR VAI NO POST ────────────
                   *
                   *  O resultado final está travado também na LISTA: uma caixa editável
                   *  ao lado de um texto de leitura deixaria o organizador "mudar" a
                   *  seleção e só descobrir no reabrir que aquilo virou a lista nova.
                   *
                   *  Caixa `disabled` NÃO é enviada pelo formulário (regra do HTML), e o
                   *  REABRIR precisa do conteúdo atual para não gravar uma lista vazia.
                   *  Daí o campo oculto com o id que está publicado: o valor viaja, a
                   *  edição não.
                   */}
                  {screen.locked && opcao.jaPublicada ? (
                    <input type="hidden" name="publicados" value={opcao.id} />
                  ) : null}

                  <div className="flex flex-wrap items-start justify-between gap-2">
                    {/**
                     * `defaultChecked` (e não estado controlado) mantém o gesto nativo:
                     * com o bundle desligado a caixa funciona e o POST leva
                     * `publicados=<id>` (o nome repetido é lido por `getAll` na action).
                     */}
                    <CheckboxField
                      name="publicados"
                      value={opcao.id}
                      defaultChecked={opcao.marcada}
                      disabled={screen.locked}
                      label={opcao.titulo}
                      hint={`${SUBMISSION_STATUS_LABELS[opcao.decisao]} · ${opcao.tipo}${
                        opcao.autores.length > 0 ? ` · ${opcao.autores.join(', ')}` : ''
                      }`}
                    />

                    {/**
                     * O selo diz que o item está na VERSÃO NO AR — e não apenas na lista
                     * salva. Depois de salvar um rascunho de um parcial, `publicados`
                     * continua gravado, mas nada está no público: sem o `publico !== null`,
                     * o selo "já publicada" mentiria ao lado de uma prévia vazia.
                     */}
                    {publico !== null && opcao.jaPublicada ? (
                      <Badge tone="success" size="sm" withDot>
                        já publicada
                      </Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            A lista mostra o nome completo da autoria, inclusive de quem se oculta no perfil
            público: a lista de aprovados é documento público — é a exceção declarada da régua de
            ocultação.
          </p>
        </fieldset>

        {/**
         * ── OS GESTOS, E O QUE CADA UM FAZ ────────────────────────────────────────
         *
         *  O aviso de publicação fica AQUI, antes do clique: o `revalidatePath` da action
         *  põe o texto na página pública no instante seguinte, e quem publica precisa
         *  saber disso antes — depois seria tarde.
         */}
        <div className="space-y-2 border-t border-border pt-3">
          {gestos.length > 0 ? (
            <div className="flex flex-wrap items-start gap-3">
              {gestos.map((acao) => (
                <GestoButton
                  key={acao}
                  acao={acao}
                  callId={callId}
                  formAction={acoesDoGesto[acao]}
                  onClick={() => setUltimoGesto(acao)}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid={`call-result-locked-note-${callId}`}>
              O resultado final está travado: não há botão de salvar nem de publicar. Para mudar,
              reabra o resultado ao lado.
            </p>
          )}

          <p className="text-xs text-muted-foreground">{CALL_RESULT_PUBLISH_NOTICE}</p>

          {/**
           * ── REABRIR: CONFIRMAÇÃO NATIVA, SEM MODAL DE JAVASCRIPT ────────────────
           *
           *  `<details>`/`<summary>` é a confirmação que a FASE 70/FASE 72 adotou: abre
           *  sem script, diz a consequência ANTES do clique e não depende de diálogo
           *  nativo (que não tem o desenho do produto) nem de `useState` (que sumiria
           *  com o bundle desligado). O ato fica na trilha — dito aqui, não só no código.
           */}
          {podeReabrir ? (
            <details
              className="rounded-sm border border-warning bg-warning-soft p-2.5"
              data-testid={`call-result-reopen-${callId}`}
            >
              <summary className="cursor-pointer text-sm font-medium text-warning-strong">
                {CALL_RESULT_ACTION_SCREEN.REABRIR.label}
              </summary>

              <div className="space-y-2 pt-2.5">
                <p className="text-xs text-warning-strong">
                  {CALL_RESULT_ACTION_SCREEN.REABRIR.description}
                </p>

                <GestoButton
                  acao="REABRIR"
                  callId={callId}
                  formAction={reabrirFormAction}
                  onClick={() => setUltimoGesto('REABRIR')}
                  variant="outline"
                />
              </div>
            </details>
          ) : null}
        </div>

        {retorno ? (
          <div
            role={retorno.ok ? 'status' : 'alert'}
            data-testid={`call-result-feedback-${callId}`}
            className={`space-y-1 text-sm ${retorno.ok ? 'text-success-strong' : 'text-destructive'}`}
          >
            <p className="flex items-start gap-1.5">
              {retorno.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              {retorno.message}
            </p>

            {retorno.details?.length ? (
              <ul className="ml-5 list-disc text-xs">
                {retorno.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>

      {/**
       * ── A PRÉVIA É A PROJEÇÃO REAL, NÃO UMA CÓPIA ─────────────────────────────
       *
       *  `publico` é o `panel.publico` montado por `projectPublicCallResult` — a MESMA
       *  função que a página pública usa (fatia 4). O que está abaixo do formulário é,
       *  literalmente, o componente que desenha aquela projeção; a prévia não tem uma
       *  segunda marcação para envelhecer. A prévia fica FORA do formulário de
       *  propósito: ela é leitura, e não há campo dela que o POST deva levar.
       */}
      <section
        className="space-y-2 rounded-sm border border-border bg-card p-2.5"
        data-testid={`call-result-preview-${callId}`}
        aria-labelledby={previewId}
      >
        <h4 id={previewId} className="text-sm font-semibold">
          {CALL_RESULT_PREVIEW_TITLE}
        </h4>

        {publico && publicadoEmLabel !== null ? (
          <CallResultPublicView view={publico} publicadoEmLabel={publicadoEmLabel} />
        ) : (
          <p className="text-xs text-muted-foreground" data-testid={`call-result-preview-empty-${callId}`}>
            {screen.publicNote} {CALL_RESULT_PREVIEW_EMPTY}
          </p>
        )}
      </section>
    </section>
  );
}

/**
 * Um gesto do resultado: o botão e a consequência escrita ao lado.
 *
 * `formAction` é o dispatcher do `useActionState` daquele gesto — é ele que faz o
 * retorno aparecer. `type="submit"` é obrigatório: o `Button` do sistema nasce
 * `type="button"`.
 */
function GestoButton({
  acao,
  callId,
  formAction,
  onClick,
  variant = 'outline',
}: {
  acao: CallResultAction;
  callId: string;
  formAction: (formData: FormData) => void;
  onClick: () => void;
  variant?: 'primary' | 'outline';
}) {
  const { pending } = useFormStatus();
  const copy = CALL_RESULT_ACTION_SCREEN[acao];

  return (
    <div className="max-w-sm space-y-1">
      <Button
        type="submit"
        size="sm"
        variant={acao === 'PUBLICAR_PARCIAL' ? 'primary' : variant}
        formAction={formAction}
        onClick={onClick}
        disabled={pending}
        data-testid={`call-result-action-${acao}-${callId}`}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
        {copy.label}
      </Button>

      <p className="text-xs text-muted-foreground">{copy.description}</p>
    </div>
  );
}
