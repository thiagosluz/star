'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Loader2, QrCode } from 'lucide-react';

import type { SponsorQrConfirmationState } from '@/app/actions/sponsor-qr-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CRIAÇÃO DE QR DO ESTANDE — AVISAR E CONFIRMAR (FASE 51 · dívida E57)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A DÍVIDA DESCREVIA, E O QUE A TELA FAZ AGORA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um patrocinador podia ter dez QRs no mesmo estande e o sistema não dizia nada.
 *  O crédito continuava correto (um XP por pessoa POR QR, garantido pelo índice
 *  único de `sponsor_scans`), mas cada código novo é uma chance nova de creditar a
 *  mesma gente — e a instituição só descobria olhando o painel depois.
 *
 *  A decisão aprovada é **avisar e confirmar**, não impor teto: o mesmo
 *  patrocinador pode legitimamente ter dois estandes, e um limite fixo recusaria um
 *  caso real (a instituição contornaria com dois cadastros, que é pior). Então o
 *  serviço CONTA, a tela AVISA com o número e o efeito, e o segundo passo grava.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMINHO SEM JAVASCRIPT É UM SEGUNDO PASSO POR QUERY STRING
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este componente monta o endereço da etapa 2 (`?confirmarQr=<sponsorId>`) e o
 *  formulário SEMPRE carrega o campo oculto `confirmar`. Com JavaScript desligado,
 *  o usuário clica no link "Continuar e criar o QR" — que é uma NAVEGAÇÃO, e o
 *  servidor redesenha a página com o aviso aberto e o campo marcado. Com
 *  JavaScript, o mesmo aviso aparece sem sair da página, e o campo já vem marcado.
 *
 *  Ou seja: os dois caminhos usam o MESMO `name="confirmar"` e a MESMA action. Um
 *  segundo formulário só para o caminho sem JS divergiria no primeiro ajuste — e o
 *  defeito apareceria como "o botão confirmar não grava a categoria escolhida".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function CreateButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      /**
       * `admin-submit` é o testid CONVENÇÃO das ações administrativas desta base — é o
       * que o E2E da FASE 42 procura neste mesmo formulário. Um testid novo aqui não é
       * detalhe de teste: quebrou a suíte inteira da experiência do patrocinador, porque
       * o botão ficou "invisível" para os testes que já existiam.
       */
      data-testid="admin-submit"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <QrCode className="size-4" aria-hidden />}
      {pending ? 'Criando…' : label}
    </button>
  );
}

export function SponsorQrCreateForm({
  action,
  tenantSlug,
  eventId,
  sponsorId,
  cardOptions,
  returnTo,
  /** O segundo passo já foi pedido por navegação (sem JavaScript)? */
  confirmedByNavigation = false,
  /**
   * O evento do crédito, para a tela dizer QUAL é. A tela de patrocinadores é por
   * evento (`/administracao/eventos/<eventId>/patrocinadores`), e o QR nasce sempre
   * preso a ele — dizer isso evita a dúvida de "o QR vale em que edição?".
   */
  eventLabel,
}: {
  action: (
    prev: SponsorQrConfirmationState | null,
    formData: FormData,
  ) => Promise<SponsorQrConfirmationState>;
  tenantSlug: string;
  eventId: string;
  sponsorId: string;
  cardOptions: readonly { value: string; label: string }[];
  /** O caminho desta tela, para o passo 2 sem JavaScript. */
  returnTo: string;
  confirmedByNavigation?: boolean;
  eventLabel: string;
}) {
  const [state, formAction] = useActionState<SponsorQrConfirmationState | null, FormData>(action, null);

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  OS CAMPOS SÃO CONTROLADOS — E A RAZÃO É O SEGUNDO PASSO (FASE 51 · dívida E57)
   * ─────────────────────────────────────────────────────────────────────────────
   *  O React 19 reseta o formulário depois de uma action, MESMO quando ela recusa
   *  (armadilha 5 desta base). No caminho da E57 isso é destrutivo: a primeira tentativa
   *  é RECUSADA de propósito para pedir a confirmação, e o segundo passo reenviaria o
   *  formulário em BRANCO — o `required` do nome bloquearia a submissão no navegador e
   *  a instituição veria "não acontece nada" ao confirmar.
   *
   *  O defeito foi encontrado pelo E2E (o segundo clique não gravava e o teste não sabia
   *  dizer por quê). Controlar os campos é o mesmo remédio que a edição do rascunho usa.
   */
  const [campos, setCampos] = useState({
    label: '',
    xpAmount: '0',
    consentDays: '90',
  });

  const update = (patch: Partial<typeof campos>) =>
    setCampos((anterior) => ({ ...anterior, ...patch }));

  /**
   * O aviso aparece em DOIS casos, e são o mesmo aviso:
   *   • o serviço recusou por falta de confirmação (`CONFIRMATION_REQUIRED`);
   *   • a página foi recarregada com `?confirmarQr=` (o passo 2 sem JavaScript).
   *
   * O número vem do serviço quando há recusa; na recarga ele é dito pela própria
   * mensagem do domínio, que já carrega a contagem e o efeito.
   */
  const needsConfirmation =
    state?.code === 'CONFIRMATION_REQUIRED' || confirmedByNavigation;

  /** O segundo passo do caminho SEM JavaScript já foi dado (a página recarregou). */
  const confirmedStepTwo = confirmedByNavigation;

  const existingInEvent =
    typeof state?.data?.existingInEvent === 'number' ? (state.data.existingInEvent as number) : null;

  /** O endereço do passo 2: volta para esta tela com o aviso aberto. */
  const stepTwoHref = useMemo(() => {
    const separator = returnTo.includes('?') ? '&' : '?';
    return `${returnTo}${separator}confirmarQr=${sponsorId}`;
  }, [returnTo, sponsorId]);

  const field = 'block w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

  return (
    <form action={formAction} className="space-y-3" data-testid={`qr-new-${sponsorId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="sponsorId" value={sponsorId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          Nome do QR
          <input
            name="label"
            required
            maxLength={120}
            placeholder="Estande — entrada"
            className={field}
            value={campos.label}
            onChange={(event) => update({ label: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          XP por visita
          <input
            name="xpAmount"
            type="number"
            min={0}
            max={500}
            className={field}
            value={campos.xpAmount}
            onChange={(event) => update({ xpAmount: event.target.value })}
          />
          <span className="block text-xs font-normal text-muted-foreground">0 = QR só de contato</span>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Carta da visita
          <select name="cardTemplateId" defaultValue="" className={field}>
            <option value="">Nenhuma carta</option>
            {cardOptions.map((card) => (
              <option key={card.value} value={card.value}>
                {card.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          Autorização (dias)
          <input
            name="consentDays"
            type="number"
            min={1}
            max={365}
            className={field}
            value={campos.consentDays}
            onChange={(event) => update({ consentDays: event.target.value })}
          />
          <span className="block text-xs font-normal text-muted-foreground">
            Por quanto tempo o contato fica visível
          </span>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        O evento do crédito é {eventLabel}. A leitura credita uma vez por pessoa{' '}
        <strong>por QR</strong>.
      </p>

      {needsConfirmation ? (
        <div
          role="status"
          data-testid={`qr-repeat-warning-${sponsorId}`}
          data-confirmed={confirmedStepTwo ? 'true' : 'false'}
          className="space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning-strong"
        >
          <p className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {state?.message ??
                'Este patrocinador já tem QR neste evento. Cada código novo é uma chance nova de creditar a mesma pessoa: quem ler os dois recebe o crédito duas vezes (um por código).'}
            </span>
          </p>

          {existingInEvent !== null ? (
            <p className="font-medium" data-testid={`qr-repeat-count-${sponsorId}`}>
              QRs já existentes neste evento: {existingInEvent}
            </p>
          ) : null}

          {/*
            ── O SEGUNDO PASSO, NOS DOIS AMBIENTES (E57) ────────────────────────────
            Com JavaScript, a caixa ao lado marca a confirmação e o mesmo formulário é
            reenviado. SEM JavaScript, o formulário seria um POST que o servidor não
            sabe ler — então o caminho é uma NAVEGAÇÃO por link: a página recarrega
            com `?confirmarQr=<sponsorId>`, o servidor MARCA a confirmação (o campo
            oculto abaixo) e o botão passa a gravar de verdade.
          */}
          {confirmedStepTwo ? (
            <>
              <input type="hidden" name="confirmado" value="true" />
              <p className="font-normal">
                Confirmação registrada para esta tentativa. Use o botão abaixo para criar o QR.
              </p>
            </>
          ) : (
            <>
              <a
                href={stepTwoHref}
                data-testid={`qr-repeat-continue-${sponsorId}`}
                className="inline-block underline underline-offset-4"
              >
                Continuar e criar o QR assim mesmo
              </a>

              <label className="flex items-start gap-2 text-xs font-normal">
                <input
                  type="checkbox"
                  name="confirmado"
                  value="true"
                  data-testid={`qr-repeat-confirm-${sponsorId}`}
                  className="mt-0.5 size-3.5"
                />
                <span>
                  Confirmo que são estandes diferentes e que cada QR vai creditar de novo quem o ler.
                </span>
              </label>
            </>
          )}
        </div>
      ) : null}

      <CreateButton label={needsConfirmation ? 'Criar o QR assim mesmo' : 'Criar QR'} />

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid={`qr-new-${sponsorId}-feedback`}
          className={`space-y-1 text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          <span className="block">{state.message}</span>
          {state.details?.length ? (
            <span className="block text-xs">{state.details.join(' · ')}</span>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
