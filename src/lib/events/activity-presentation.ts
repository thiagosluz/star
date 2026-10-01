/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APRESENTAÇÃO DA PROGRAMAÇÃO (FASE 55, fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO SAIU DO ARQUIVO DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Estes três ajudantes moravam no `page.tsx` da raiz do evento junto com o resto do
 *  arquivo. Quando a Programação virou PÁGINA própria, eles ficaram órfãos: o
 *  `toLocalInput` já era usado também pelo formulário de dados do evento, e as outras
 *  duas funções são a régua que a tela mostra para o organizador.
 *
 *  Copiar e colar entre as duas páginas garantiria que em algum momento elas
 *  divergissem — a vaga efetiva é a MESMA conta do servidor
 *  (`effectiveActivityCapacity`), e uma cópia desatualizada mentiria na tela.
 *
 *  ⚠️ Não confundir com regra de negócio: a decisão de vaga continua no domínio. Aqui
 *  é só a FRASE (e o formato de input) que a interface usa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { effectiveActivityCapacity } from '@/domain/events/event-rules';

/** O valor que `<input type="datetime-local">` espera, no fuso do navegador. */
export function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * As vagas REAIS da atividade, com a sala no lugar de onde ela limita.
 *
 * O organizador digita "80 vagas" numa sala de 40, e a tela dizia 80 — um número que
 * o sistema nunca entregaria. A conta é a mesma do servidor
 * (`effectiveActivityCapacity`), e a frase explica de onde vem o número menor em vez
 * de simplesmente trocá-lo (revisão da FASE 3).
 */
export function activitySeatsLabel(activity: {
  capacity: number | null;
  roomCapacity: number | null;
}): string {
  const effective = effectiveActivityCapacity(activity.capacity, activity.roomCapacity);

  const limitedByRoom =
    activity.roomCapacity !== null &&
    (activity.capacity === null || activity.capacity > activity.roomCapacity);

  const base = effective === null ? 'sem limite' : `${effective} vaga(s)`;

  return limitedByRoom ? `${base} — a sala comporta ${activity.roomCapacity}` : base;
}

/**
 * Atividade ABERTA numa sala pequena para o público do evento.
 *
 * Atividade aberta não tem fila nem recusa: quem se inscreve no evento entra nela
 * (decisão da revisão da FASE 3). O aviso existe porque a sala é física — se o evento
 * tem 300 inscritos e a sala comporta 40, o organizador precisa saber ANTES do dia,
 * e o sistema não pode resolver isso negando acesso em silêncio.
 */
export function openActivityOverflowsRoom(
  activity: { requiresRegistration: boolean; roomCapacity: number | null },
  eventRegistrationCount: number,
): boolean {
  return (
    !activity.requiresRegistration &&
    activity.roomCapacity !== null &&
    eventRegistrationCount > activity.roomCapacity
  );
}
