'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { Button } from './button';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIÁLOGO — primitivo do sistema (revisão de UI, fora da numeração de fases)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O `window.confirm` FOI APOSENTADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A confirmação nativa resolvia o problema de "ação sem volta" com uma linha de
 *  JavaScript, mas cobrava um preço alto em três frentes:
 *
 *    1. **Visual** — a caixa cinza do navegador não pertence ao produto: aparece
 *       com o título "localhost:3000 diz", fonte do sistema, botões sem hierarquia
 *       e ordem diferente em cada navegador. É a única tela do sistema que o design
 *       não desenha.
 *    2. **Controle** — não há como dizer QUAL ação está sendo confirmada (o botão diz
 *       "OK", não "Remover bloco"), nem diferenciar visualmente o que destrói, nem
 *       mostrar o motivo da recusa depois.
 *    3. **Acessibilidade e teste** — o diálogo nativo bloqueia a thread da página e,
 *       no Playwright, é **dispensado automaticamente** quando ninguém o trata (o
 *       `confirm` devolve `false` e a ação é silenciosamente cancelada — armadilha 33).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE `<dialog>` NATIVO DENTRO DO NOSSO DESENHO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não é "usar o nativo de novo por preguiça": o ELEMENTO `<dialog>` com
 *  `showModal()` entrega de graça o que uma caixa própria precisaria reimplementar
 *  (e geralmente erra): *top layer* acima de qualquer `z-index`, fundo inerte
 *  (`inert`), **prender o foco** dentro do painel, `Esc` para fechar e devolução do
 *  foco ao elemento de origem. O que fica com o produto é o DESENHO — painel, cores,
 *  tipografia, botões e o rótulo que nomeia a ação.
 *
 *  O painel é o que o usuário vê; o `<dialog>` é só o mecanismo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Texto de apoio: explica a consequência ANTES do clique. */
  description?: ReactNode;
  children?: ReactNode;
  /** Ações do rodapé (botões). */
  footer?: ReactNode;
  size?: 'sm' | 'md';
  testId?: string;
  /** Confirmação destrutiva: `role="alertdialog"` para o leitor de tela anunciar. */
  tone?: 'default' | 'danger';
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'sm',
  testId,
  tone = 'default',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O PAINEL SÓ EXISTE NO DOM ENQUANTO ESTÁ ABERTO
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tentação era montar o `<dialog>` sempre e apenas alternar `showModal()` /
   *  `close()` — o elemento fechado fica invisível, então "não atrapalha". Não é
   *  verdade, e o custo apareceu no E2E: um diálogo fechado continua no DOM com
   *  `aria-labelledby` apontando para o título ("Remover o bloco 'Texto'?"), então
   *  `getByLabel('Texto')` passa a casar com DOIS elementos (o campo e o diálogo) e o
   *  locator estoura em `strict mode violation` — locator por nome acessível não
   *  filtra elemento invisível. De quebra, o editor de página desenhava um painel
   *  completo invisível por bloco.
   *
   *  Como o elemento passa a nascer JUNTO com a abertura, o efeito depende de `open` —
   *  e NÃO pode ter lista vazia: o `Modal` está montado mesmo fechado (quem o fecha é o
   *  `return null` abaixo), então um efeito de montagem rodaria no primeiro render, com
   *  `ref.current` ainda `null`, e nunca mais. O diálogo ficava no DOM sem o atributo
   *  `open` — invisível, com a ação sem acontecer e sem erro nenhum.
   *
   *  O `close()` no cleanup devolve o foco ao botão que abriu o diálogo: o `close()`
   *  nativo faz a devolução quando o nó ainda está no documento, e o `focus()` explícito
   *  cobre o caso em que o painel sai junto com o clique.
   */
  useEffect(() => {
    if (!open) return;

    const dialog = ref.current;
    if (!dialog) return;

    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();

    return () => {
      if (dialog.open) dialog.close();
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      // `Esc` dispara `cancel`: sem `preventDefault` o navegador fecharia o elemento
      // por conta própria e o estado do React ficaria dessincronizado (`open` ainda
      // seria `true` e a próxima abertura não aconteceria).
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Clique no fundo escurecido: o alvo é o próprio `<dialog>` (o painel é filho).
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      data-testid={testId}
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-border bg-card p-0 text-foreground shadow-card',
        'backdrop:bg-foreground/45',
        size === 'sm' ? 'max-w-md' : 'max-w-2xl',
      )}
    >
      <div className="space-y-4 p-5">
        <div className="flex gap-3">
          {tone === 'danger' ? (
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive-soft text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
            </span>
          ) : null}

          <div className="min-w-0 space-y-1.5">
            <h2 id={titleId} className="font-display text-title text-foreground">
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </div>
            ) : null}
            {children}
          </div>
        </div>

        {footer ? <div className="flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Rótulo que NOMEIA a ação ("Remover bloco"), em vez do "OK" genérico. */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

/**
 * Confirmação de ação sem volta.
 *
 * Duas decisões que valem a explicação:
 *
 *   • **O botão de confirmar é `type="button"`**, e quem envia o formulário é o
 *     componente que o chamou (`requestSubmit()`). Um `type="submit"` aqui dentro
 *     enviaria o formulário dono do `<dialog>` — funcionaria por acidente e
 *     quebraria no dia em que o diálogo fosse renderizado fora do formulário.
 *
 *   • **Em ação destrutiva, o foco inicial vai para "Cancelar"**. Quem aperta Enter
 *     por reflexo não apaga nada; a ação que destrói exige um clique deliberado.
 *
 *   O foco é dado por `useEffect`, e não pela prop `autoFocus`: os botões só existem
 *   quando o diálogo abre, e o `showModal()` — que roda no mesmo commit — foca o
 *   PRIMEIRO elemento focável do painel (sempre o "Cancelar"). Reafirmar a intenção
 *   depois dele é o que faz o caso não destrutivo levar o foco ao botão que executa.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'default',
  onConfirm,
  onCancel,
  testId = 'confirm-dialog',
}: ConfirmDialogProps) {
  /**
   * `useFormStatus` dentro do `<form>` do chamador (o diálogo é renderizado como
   * filho dele) dá o estado de envio sem que cada tela precise passá-lo. Fora de um
   * formulário ele devolve `pending: false`, então o componente continua válido.
   */
  const { pending } = useFormStatus();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Roda depois do efeito do `Modal` (efeitos de filho antes dos do pai), ou seja,
  // depois do `showModal()` — a ordem é o que faz este foco prevalecer.
  useEffect(() => {
    if (!open) return;
    (tone === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, [open, tone]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      tone={tone === 'danger' ? 'danger' : 'default'}
      testId={testId}
      footer={
        <>
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={tone === 'danger' ? 'destructive' : 'primary'}
            onClick={onConfirm}
            disabled={pending}
            data-testid={`${testId}-confirm`}
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

/**
 * Gatilho + confirmação, no formato que as telas usam.
 *
 * Encapsula a coreografia inteira — botão que abre, diálogo, envio do formulário e
 * trava contra envio duplo — para que nenhuma tela precise repetir (e para que a
 * próxima ação destrutiva do sistema nasça com o mesmo comportamento).
 */
export function ConfirmSubmitButton({
  label,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  formRef,
  variant = 'outline',
  size = 'sm',
  icon,
  testId,
}: {
  label: string;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'default' | 'danger';
  /** Formulário a enviar quando a confirmação é aceita. */
  formRef: React.RefObject<HTMLFormElement | null>;
  variant?: 'outline' | 'destructive' | 'ghost' | 'primary';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        data-testid={testId}
      >
        {icon}
        {label}
      </Button>

      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel ?? label}
        tone={tone}
        testId={`${testId}-dialog`}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          // Fecha antes de enviar: o painel sai da tela e o botão do formulário
          // assume o estado "enviando" (é ele que mostra o giro e o resultado).
          setOpen(false);
          formRef.current?.requestSubmit();
        }}
      />
    </>
  );
}
