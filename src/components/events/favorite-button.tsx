'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { Heart } from 'lucide-react';

import { toggleFavoriteAction } from '@/app/actions/agenda-actions';
import type { AgendaMarksVariant } from '@/components/events/agenda-marks';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ADICIONAR / REMOVER DA MINHA AGENDA (FASE 65 · fatia 2 / FASE 103 · ADR-429)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  100% OTIMISTA NO REACT 19 COM PROGRESSIVE ENHANCEMENT NATIVO PRESERVADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Na FASE 103 (ADR-429):
 *    • O componente adota `useOptimistic` e `useTransition` do React 19 para
 *      chavear a interface em 0ms (preenchimento do ícone de coração, texto do
 *      botão, aria-pressed e estilização de fundo imediata);
 *    • Preserva rigorosamente o `<form action={toggleFavoriteAction}>` para
 *      garantir que cenários sem JavaScript (`javaScriptEnabled: false` no E2E
 *      da F65) continuem executando o POST nativo e o redirecionamento do Next.js;
 *    • Quando o JavaScript está ativo, o `onSubmit` intercepta a submissão,
 *      dispara a mutação otimista na transição e executa a Server Action em
 *      segundo plano com reconexão automática ao estado real.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `userId` NÃO ESTÁ AQUI — E NÃO PODE ESTAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os campos escondidos carregam a ATIVIDADE e o CONTEXTO (instituição, evento e de
 *  onde voltar). Quem é a pessoa sai da SESSÃO, na Server Action: um `userId` no
 *  formulário seria o poder de marcar na agenda de outra pessoa, que é exatamente o
 *  que a ausência de uma permissão de favorito existe para impedir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O RÓTULO ACESSÍVEL DIZ A AÇÃO **E** O ALVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Favoritar" sozinho não diz o quê — e numa programação com vinte cartões, quem
 *  navega por leitor de tela ouve vinte vezes a mesma palavra. O nome acessível é
 *  "Adicionar à minha agenda: <título>" (e "Remover da minha agenda: <título>"), com
 *  o TEXTO VISÍVEL contido nele — que é o que mantém o comando de voz funcionando
 *  (WCAG 2.5.3, "rótulo no nome").
 *
 *  O estado do botão é `aria-pressed` (botão de alternância), e não um segundo
 *  rótulo: é o mesmo controle, com o mesmo alvo, em dois estados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function FavoriteButton({
  tenantSlug,
  eventId,
  eventSlug,
  activityId,
  activityTitle,
  favorited,
  origem,
  variant,
}: {
  tenantSlug: string;
  eventId: string;
  eventSlug: string;
  activityId: string;
  activityTitle: string;
  favorited: boolean;
  /** De onde a pessoa está marcando — decide o caminho de volta (ver a action). */
  origem: 'PROGRAMACAO' | 'MINHA_AGENDA';
  variant: AgendaMarksVariant;
}) {
  const [optimisticFavorited, setOptimisticFavorited] = useOptimistic(
    favorited,
    (_current, next: boolean) => next,
  );
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const rotuloVisivel = optimisticFavorited ? 'Remover da minha agenda' : 'Adicionar à minha agenda';

  const classes =
    variant === 'tema'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-1.5 text-xs font-medium transition hover:opacity-80'
      : 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent';

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    const nextState = !optimisticFavorited;
    startTransition(async () => {
      setOptimisticFavorited(nextState);
      try {
        await toggleFavoriteAction(formData);
      } catch (err) {
        unstable_rethrow(err);
        setFeedback('Não foi possível atualizar a agenda no momento.');
      }
    });
  };

  return (
    <form
      action={toggleFavoriteAction}
      onSubmit={handleSubmit}
      data-testid={`agenda-form-${activityId}`}
    >
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="origem" value={origem} />
      <input type="hidden" name="intencao" value={optimisticFavorited ? 'remover' : 'adicionar'} />

      <button
        type="submit"
        aria-pressed={optimisticFavorited}
        aria-label={`${rotuloVisivel}: ${activityTitle}`}
        data-testid={`agenda-favoritar-${activityId}`}
        data-favorited={String(optimisticFavorited)}
        data-pending={String(isPending)}
        className={classes}
        /**
         * O estado marcado também se VÊ: um leve tingimento tirado do `currentColor`
         * (a cor do texto do próprio contexto). Não é a única diferença — o ícone
         * enche, o texto muda de "Adicionar" para "Remover" e o `aria-pressed` diz o
         * estado —, mas sem ele o botão marcado não se distinguiria de relance.
         *
         * A mistura é com `currentColor` (e não com um token) porque este componente
         * é usado nos DOIS vocabulários: no tema do evento e no painel da plataforma.
         */
        style={
          optimisticFavorited
            ? { backgroundColor: 'color-mix(in oklab, currentColor 14%, transparent)' }
            : undefined
        }
      >
        <Heart
          className="size-3.5 shrink-0"
          aria-hidden
          fill={optimisticFavorited ? 'currentColor' : 'none'}
        />
        {rotuloVisivel}
      </button>

      <span aria-live="polite" className="sr-only" data-testid={`agenda-live-${activityId}`}>
        {optimisticFavorited ? 'Atividade adicionada à sua agenda' : 'Atividade removida da sua agenda'}
      </span>

      {feedback ? (
        <span
          role="alert"
          aria-live="assertive"
          className="mt-1 block text-xs text-destructive font-medium"
          data-testid={`agenda-error-${activityId}`}
        >
          {feedback}
        </span>
      ) : null}
    </form>
  );
}
