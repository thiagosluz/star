/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Preparação do lote de crachás para impressão (FASE 37)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU UM SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 31 tinha UMA rota (a folha A4) com toda a preparação dentro dela. A FASE 37
 *  acrescentou duas saídas — etiquetas adesivas em PDF e arquivo ZPL para a térmica — e
 *  as três fazem exatamente a mesma pergunta antes de imprimir: **quais crachás são
 *  VÁLIDOS, quais foram escolhidos e o que precisa ficar marcado como impresso**.
 *  Copiar isso três vezes faria a próxima mudança (um filtro novo, uma regra nova)
 *  valer para uma saída só — armadilha 55.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE **NÃO** ENTRA NO LOTE, E POR QUÊ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Crachá REVOGADO não se imprime: o código não vale mais no balcão, e uma etiqueta
 *  circulando com ele é um problema na porta (a leitura vai recusar a pessoa, que tem o
 *  papel na mão dizendo o contrário). Crachá não emitido também não — quem não tem
 *  código não tem o que imprimir.
 *
 *  A marcação de `printedAt`/`printedById` é feita AQUI, uma vez por lote, e não em cada
 *  rota: é o que permite à tela dizer "impresso" e a quem perdeu o crachá saber que a
 *  folha anterior já saiu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { listCredentialRoster } from '@/lib/events/credential-service';
import { resolveTheme } from '@/domain/events/landing-page';
import type { BadgeLabel, BadgeSheetTheme } from '@/lib/credentials/badge-renderer';

export interface BadgePrintBatch {
  tenantName: string;
  eventTitle: string;
  eventSlug: string;
  badges: BadgeLabel[];
  /**
   * A identidade do EVENTO (FASE 51 · E42) — a cor com que as três saídas de papel
   * desenham o crachá.
   *
   * Vem resolvida do BANCO (`Event.theme`, o mesmo dado que a `ThemeScope` aplica na
   * página pública), e não da tela: a folha é gerada por uma rota HTTP que ninguém
   * abre com o tema em mãos, e um parâmetro de query a mais seria uma segunda fonte
   * para a mesma cor — exatamente o que a F17 decidiu não ter.
   */
  theme: BadgeSheetTheme;
}

export type BadgePrintOutcome =
  | { ok: true; batch: BadgePrintBatch }
  | { ok: false; code: 'NOT_FOUND' | 'NO_ELIGIBLE' | 'INTERNAL'; message: string };

/**
 * Reúne os crachás que vão para o papel e registra a impressão.
 *
 * `userIds` vazio significa o evento inteiro — é o caso comum ("imprimir os crachás do
 * congresso"), e a seleção da tela existe para o caso de reimpressão de alguns.
 */
export async function prepareBadgePrint(input: {
  tenantId: string;
  eventId: string;
  actorId: string;
  userIds?: readonly string[];
}): Promise<BadgePrintOutcome> {
  const [tenant, event, roster] = await Promise.all([
    withTenant(input.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId }, select: { name: true } }),
    ),
    withTenant(input.tenantId, (tx) =>
      tx.event.findFirst({
        where: { id: input.eventId, tenantId: input.tenantId, deletedAt: null },
        select: { title: true, slug: true, theme: true },
      }),
    ),
    listCredentialRoster({ tenantId: input.tenantId, eventId: input.eventId }),
  ]);

  if (!event) {
    return { ok: false, code: 'NOT_FOUND', message: 'Evento não encontrado.' };
  }

  if (!roster.ok) {
    return { ok: false, code: 'INTERNAL', message: roster.message };
  }

  const chosen = roster.entries.filter(
    (entry) =>
      entry.credential !== null &&
      entry.credential.state === 'ACTIVE' &&
      (input.userIds === undefined ||
        input.userIds.length === 0 ||
        input.userIds.includes(entry.userId)),
  );

  if (chosen.length === 0) {
    return {
      ok: false,
      code: 'NO_ELIGIBLE',
      message:
        'Nenhum crachá válido para imprimir. Emita os crachás que faltam antes de gerar a impressão.',
    };
  }

  /**
   * A categoria entra em CADA etiqueta, e não no lote: a folha em massa mistura
   * categorias (40 participantes + 6 da equipe) e é justamente a cor de cada um que
   * faz a faixa servir para alguma coisa na porta.
   */
  const badges: BadgeLabel[] = chosen.map((entry) => ({
    name: entry.name,
    code: entry.credential!.code,
    category: entry.credential!.category,
    subtitle: `${event.title}${
      entry.registrations.length > 0 ? ` · ${entry.registrations.length} inscrição(ões)` : ''
    }`,
  }));

  await withTenant(input.tenantId, (tx) =>
    tx.eventCredential.updateMany({
      where: { tenantId: input.tenantId, id: { in: chosen.map((entry) => entry.credential!.id) } },
      data: { printedAt: new Date(), printedById: input.actorId },
    }),
  );

  /**
   * `resolveTheme` normaliza o que veio do banco e cai no padrão quando o JSON está
   * inválido — a mesma régua da página pública. O crachá nunca falha por causa do
   * tema: no pior caso ele sai com a cor de marca da plataforma, que é o desenho
   * anterior a esta fase.
   */
  const { theme } = resolveTheme(event.theme);

  return {
    ok: true,
    batch: {
      tenantName: tenant.name,
      eventTitle: event.title,
      eventSlug: event.slug,
      badges,
      theme: { primaryColor: theme.primaryColor ?? null },
    },
  };
}

/** Nome de arquivo previsível e seguro para as três saídas. */
export function badgeFileName(slug: string, extension: string): string {
  const base = slug
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60);

  return `crachas-${base.length > 0 ? base : 'evento'}.${extension}`;
}
