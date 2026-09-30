import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Layers, ShieldCheck } from 'lucide-react';

import { getTenantContext } from '@/lib/events/event-repository';
import { readSharedCard } from '@/lib/gamification/card-share-service';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';
import { HoloCard } from '@/components/gamification/holo-card';
import { tenantPath } from '@/domain/tenancy/resolution';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CARTA COMPARTILHADA — página pública (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA PÁGINA MOSTRA, E O QUE ELA NÃO TEM COMO MOSTRAR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma carta, o nome público de quem a conquistou e a instituição. É só isso que o
 *  serviço devolve — não há XP, álbum, certificado, evento ou e-mail no retorno,
 *  então não existe "filtro esquecido" que os deixe escapar para a tela.
 *
 *  A régua do NOME é a mesma do perfil público (FASE 44): nome publicado aparece;
 *  nome privado vira `@handle`; sem handle, um rótulo neutro. Quem compartilha vê
 *  essa decisão ANTES de enviar, na página da carta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE 404 EM TUDO QUE DÁ ERRADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Token inválido, revogado, vencido ou de outra instituição respondem IGUAL.
 *  Distinguir os casos contaria a quem tenta adivinhar que o token acertou alguma
 *  coisa — e quem criou o link não perde a explicação: a lista dele diz "expirado"
 *  ou "revogado", com o número de aberturas (FASE 51 · dívida E70).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SÓ A RENDERIZAÇÃO DA CARTA CONTA ABERTURA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Esta página lê o link DUAS vezes (metadados e corpo) e a rota da imagem de
 *  prévia lê uma terceira. Apenas o corpo pede `registerView`: contar as três
 *  faria de cada raspagem de robô uma "abertura" e o dono leria um número que
 *  ninguém viu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

interface PageProps {
  params: Promise<{ tenantSlug: string; token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tenantSlug, token } = await params;
  const tenant = await getTenantContext(tenantSlug);

  if (!tenant) return { title: 'Carta' };

  const shared = await readSharedCard({ tenantId: tenant.tenantId, token, timezone: tenant.timezone });

  /** Metadados de link quebrado não descrevem carta nenhuma. */
  if (!shared.ok) return { title: 'Carta não encontrada' };

  const title = `${shared.card.cardName} — ${RARITY_LABELS[shared.card.rarity]}`;
  const description = `${shared.card.displayName} conquistou esta carta em ${tenant.name}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: tenant.name,
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function SharedCardPage({ params }: PageProps) {
  const { tenantSlug, token } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const shared = await readSharedCard({
    tenantId: tenant.tenantId,
    token,
    timezone: tenant.timezone,
    registerView: true,
  });
  if (!shared.ok) notFound();

  const { card } = shared;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <header className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenant.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="shared-card-title">
          {card.cardName}
        </h1>
        <p className="text-sm text-muted-foreground" data-testid="shared-card-owner">
          Conquistada por {card.displayName}
        </p>
      </header>

      <div className="flex justify-center">
        <HoloCard
          name={card.cardName}
          rarity={card.rarity}
          palette={card.palette}
          imageUrl={card.imageUrl}
          isFoil={card.isFoil}
          backArtUrl={card.art.backUrl}
          stage={card.stage}
          back={card.back}
          quantity={card.quantity}
          variant="stage"
          size="lg"
        />
      </div>

      <section className="mx-auto max-w-xl space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Ficha da conquista</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Raridade</dt>
            <dd className="text-sm font-medium">{card.back.rarityLabel}</dd>
          </div>
          {card.back.lines.map((line) => (
            <div key={line.key}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{line.label}</dt>
              <dd className="text-sm font-medium">{line.value}</dd>
            </div>
          ))}
        </dl>
        {card.back.lore ? <p className="text-sm italic text-muted-foreground">{card.back.lore}</p> : null}
      </section>

      <footer className="space-y-3 text-center text-xs text-muted-foreground">
        <p className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" aria-hidden />
          Este link mostra apenas esta carta. O álbum, o XP e o perfil de quem a conquistou
          continuam privados.
        </p>
        <p>
          <Link
            href={tenantPath(tenantSlug, '/eventos')}
            className="inline-flex items-center gap-1.5 underline underline-offset-4"
          >
            <Layers className="size-3.5" aria-hidden />
            Ver os eventos de {tenant.name}
          </Link>
        </p>
      </footer>
    </main>
  );
}
