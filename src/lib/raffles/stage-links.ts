/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ENDEREÇOS DO PALCO E DA AUDITORIA (FASE 29)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE OS CAMINHOS VIVEM AQUI, E NÃO ESCRITOS NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Três lugares precisam do MESMO endereço: a tela de sorteios (para o organizador
 *  copiar e gerar o QR Code), a própria página do palco (que aponta para a
 *  auditoria) e os testes. Um caminho escrito à mão em cada um deles vira três
 *  caminhos que envelhecem em ritmos diferentes — e um link quebrado no telão é
 *  descoberto no dia do evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { tenantPath } from '@/domain/tenancy/resolution';
import { publicBaseUrl } from '@/lib/public-url';

/** Caminho do telão de um sorteio (o que o organizador projeta na parede). */
export function raffleStagePath(input: {
  tenantSlug: string;
  eventSlug: string;
  raffleId: string;
}): string {
  return tenantPath(input.tenantSlug, `/eventos/${input.eventSlug}/sorteios/${input.raffleId}/palco`);
}

/** Caminho da auditoria de um sorteio (a conferência das contas). */
export function raffleAuditPath(input: {
  tenantSlug: string;
  eventSlug: string;
  raffleId: string;
}): string {
  return tenantPath(
    input.tenantSlug,
    `/eventos/${input.eventSlug}/sorteios/${input.raffleId}/auditoria`,
  );
}

/** Caminho do resultado publicado (a página da FASE 22). */
export function raffleResultPath(input: {
  tenantSlug: string;
  eventSlug: string;
  raffleId: string;
}): string {
  return tenantPath(input.tenantSlug, `/eventos/${input.eventSlug}/sorteios/${input.raffleId}`);
}

/**
 * Endereço ABSOLUTO do telão — o que vai no QR Code e no que se cola no grupo.
 *
 * Relativo não serve para QR Code: quem aponta a câmera não tem a página aberta para
 * completar o caminho.
 */
export function raffleStageUrl(input: {
  tenantSlug: string;
  eventSlug: string;
  raffleId: string;
}): string {
  return `${publicBaseUrl()}${raffleStagePath(input)}`;
}

/** Endereço absoluto da auditoria. */
export function raffleAuditUrl(input: {
  tenantSlug: string;
  eventSlug: string;
  raffleId: string;
}): string {
  return `${publicBaseUrl()}${raffleAuditPath(input)}`;
}
