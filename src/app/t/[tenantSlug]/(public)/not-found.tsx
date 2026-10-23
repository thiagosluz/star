import type { Metadata } from 'next';

import { AreaNotFound } from '@/components/shell/area-not-found';
import { currentTenantSlug } from '@/lib/tenancy/tenant-slug-header';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NÃO ENCONTRADO — a área PÚBLICA da instituição (FASE 75 · decisão 4)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTA É A PÁGINA QUE O VISITANTE VÊ — e é a que mais importa
 * ─────────────────────────────────────────────────────────────────────────────
 *  A área pública é a que recebe link de campanha, de rede social e de mensagem
 *  antiga: um endereço que morreu é o caso NORMAL aqui, não a exceção. Antes desta
 *  página, o visitante recebia a tela padrão do Next — em inglês, sem a identidade da
 *  instituição e sem nenhum caminho de volta.
 *
 *  O levantamento da fase contou **35 chamadas de `notFound()` em 18 arquivos** nesta
 *  casca: evento, atividade, chamada, sorteio, palestrante, carta compartilhada,
 *  convite, descadastro, perfil público.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA NÃO REVELA
 * ─────────────────────────────────────────────────────────────────────────────
 *  Nem a existência do recurso, nem a da instituição: as três hipóteses vêm juntas na
 *  frase do domínio. É a mesma régua do `/404-tenant` (a resposta uniforme é decisão
 *  antiga do projeto) — e o link de volta aponta para a vitrine do slug que o Proxy
 *  JÁ validou, então ele não acrescenta informação nenhuma.
 */
export const metadata: Metadata = { title: 'Página não encontrada' };

export default async function PublicTenantNotFound() {
  return <AreaNotFound area="public" tenantSlug={await currentTenantSlug()} />;
}
