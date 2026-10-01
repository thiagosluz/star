'use client';

import { useActionState } from 'react';
import { BadgeCheck } from 'lucide-react';

import { Button } from '@/components/ui';
import {
  acceptPromotionAction,
  type RegistrationActionState,
} from '@/app/actions/registration-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O ACEITE DA VAGA OFERTADA PELA FILA (dívida E1)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE BOTÃO PRECISOU EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quando a promoção da lista de espera passou a reter a vaga com prazo, a vaga
 *  ofertada ficou sem QUEM a confirmasse: `confirmRegistration` (FASE 34) recusa
 *  quando a atividade não exige conferência — e recusa a inscrição do evento —, porque
 *  nessas atividades a vaga nasce confirmada na inscrição. Sem este botão, a vaga
 *  venceria em 48 h, iria para o próximo e venceria de novo: a fila giraria para sempre
 *  e ninguém entraria.
 *
 *  A régua de quem pode aceitar é do DOMÍNIO (`canAcceptPromotion`): o botão só aparece
 *  onde a decisão é da pessoa. Onde a atividade exige conferência da equipe, o
 *  componente nem é renderizado — quem fala ali é o aviso da FASE 34, com o checklist.
 *
 *  O prazo aparece escrito ao lado do botão, e não num lugar distante: é a informação
 *  que decide se a pessoa clica agora ou perde a vaga.
 */
export function AcceptPromotionButton({
  tenantSlug,
  eventSlug,
  registrationId,
  deadlineLabel,
}: {
  tenantSlug: string;
  eventSlug: string;
  registrationId: string;
  deadlineLabel: string;
}) {
  const [state, formAction] = useActionState<RegistrationActionState | null, FormData>(
    acceptPromotionAction,
    null,
  );

  if (state?.ok) {
    return (
      <span className="text-xs text-muted-foreground" data-testid="accept-promotion-result">
        {state.message}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="eventSlug" value={eventSlug} />
        <input type="hidden" name="registrationId" value={registrationId} />

        <Button type="submit" size="sm" data-testid="accept-promotion">
          <BadgeCheck className="size-3" aria-hidden />
          Aceitar a vaga
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Sua até <strong>{deadlineLabel}</strong> — depois disso ela vai para o próximo da
        fila.
      </p>

      {state && !state.ok && state.message ? (
        <p role="alert" className="text-xs text-destructive">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
