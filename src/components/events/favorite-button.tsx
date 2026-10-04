import { Heart } from 'lucide-react';

import { toggleFavoriteAction } from '@/app/actions/agenda-actions';
import type { AgendaMarksVariant } from '@/components/events/agenda-marks';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ADICIONAR / REMOVER DA MINHA AGENDA (FASE 65 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  É UM `<form>` DE VERDADE, E ISSO É O REQUISITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nenhum `onClick`, nenhum `useActionState`, nenhum estado de cliente: o botão é a
 *  submissão nativa de um formulário cujo `action` é a Server Action. Sem JavaScript
 *  o POST acontece igual (o Next publica os campos de progressive enhancement no
 *  próprio HTML), e a resposta é a navegação de volta para a mesma página. O E2E
 *  desta fatia roda com `javaScriptEnabled: false` justamente para que trocar isto
 *  por um clique de cliente reprove na hora.
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
  const rotuloVisivel = favorited ? 'Remover da minha agenda' : 'Adicionar à minha agenda';

  const classes =
    variant === 'tema'
      ? 'inline-flex items-center gap-1.5 rounded-md border border-current px-3 py-1.5 text-xs font-medium transition hover:opacity-80'
      : 'inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent';

  return (
    <form action={toggleFavoriteAction} data-testid={`agenda-form-${activityId}`}>
      <input type="hidden" name="tenantSlug" value={tenantSlug} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="eventSlug" value={eventSlug} />
      <input type="hidden" name="activityId" value={activityId} />
      <input type="hidden" name="origem" value={origem} />
      <input type="hidden" name="intencao" value={favorited ? 'remover' : 'adicionar'} />

      <button
        type="submit"
        aria-pressed={favorited}
        aria-label={`${rotuloVisivel}: ${activityTitle}`}
        data-testid={`agenda-favoritar-${activityId}`}
        data-favorited={String(favorited)}
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
          favorited
            ? { backgroundColor: 'color-mix(in oklab, currentColor 14%, transparent)' }
            : undefined
        }
      >
        <Heart
          className="size-3.5 shrink-0"
          aria-hidden
          fill={favorited ? 'currentColor' : 'none'}
        />
        {rotuloVisivel}
      </button>
    </form>
  );
}
