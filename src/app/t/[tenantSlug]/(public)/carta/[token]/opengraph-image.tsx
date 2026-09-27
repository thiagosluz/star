import { ImageResponse } from 'next/og';

import { getTenantContext } from '@/lib/events/event-repository';
import { readSharedCard } from '@/lib/gamification/card-share-service';
import { RARITY_LABELS } from '@/domain/gamification/card-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  IMAGEM DA CARTA COMPARTILHADA — a prévia do link (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISSO IMPORTA MAIS DO QUE PARECE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Sem imagem, o link colado num grupo de WhatsApp vira uma tarja cinza. A pessoa
 *  compartilha uma CARTA — e é a carta que precisa aparecer. Esta rota desenha a
 *  carta (arte, paleta, nome, raridade) para os rastreadores das redes sociais.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CARTA É DESENHADA, E NÃO FOTOGRAFADA DA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Gerar a imagem a partir do HTML exigiria um navegador no servidor; a partir da
 *  arte (uma URL externa) exigiria buscar a imagem por rede a cada raspagem, com o
 *  silêncio da falha caindo na prévia de quem compartilhou. Aqui o desenho é
 *  VETOR: paleta da carta + geometria, com a arte do template ao fundo quando ela
 *  existe e é alcançável.
 *
 *  As cores são as DA CARTA (dado validado por allowlist) e neutras em `rgb()`.
 *  Nenhum hex literal: a trava do sistema de design vale para `src/app` — e a
 *  saída não é DOM, é imagem, então não há token de interface a usar aqui.
 *
 *  A fonte é a que o `next/og` embute (Geist): arrastar um arquivo de fonte para o
 *  repositório só para a prévia do link seria peso em todo deploy por um detalhe
 *  que ninguém compara lado a lado com a interface.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export const alt = 'Carta colecionável conquistada';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default async function CardShareImage({
  params,
}: {
  params: Promise<{ tenantSlug: string; token: string }>;
}) {
  const { tenantSlug, token } = await params;

  const tenant = await getTenantContext(tenantSlug);
  const shared = tenant
    ? await readSharedCard({ tenantId: tenant.tenantId, token, timezone: tenant.timezone })
    : null;

  /**
   * Link quebrado ainda precisa de imagem: as redes já buscaram a página, e uma
   * rota que responde erro deixa a prévia vazia. O cartão neutro diz o que houve.
   */
  if (!shared || !shared.ok) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgb(15 23 42)',
            color: 'rgb(226 232 240)',
            fontSize: 40,
          }}
        >
          Carta não encontrada
        </div>
      ),
      size,
    );
  }

  const { card } = shared;
  /** A paleta chega RESOLVIDA pelo serviço (`resolvePalette`), nunca nula. */
  const palette = card.palette;
  const rarity = RARITY_LABELS[card.rarity] ?? card.rarity;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 48,
          padding: 64,
          background: `linear-gradient(140deg, ${palette.secondary} 0%, ${palette.primary} 100%)`,
          color: palette.text,
          fontFamily: 'sans-serif',
        }}
      >
        {/* ── A carta desenhada ─────────────────────────────────────────────── */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 340,
            height: 470,
            borderRadius: 22,
            border: `3px solid ${palette.glow}`,
            background: card.imageUrl
              ? `linear-gradient(160deg, ${palette.secondary} 0%, ${palette.primary} 100%)`
              : `linear-gradient(160deg, ${palette.primary} 0%, ${palette.secondary} 100%)`,
            boxShadow: `0 30px 60px -20px ${palette.glow}`,
            overflow: 'hidden',
          }}
        >
          {card.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a arte vive no bucket da instituição
            <img
              src={card.imageUrl}
              alt=""
              width={340}
              height={470}
              style={{ position: 'absolute', inset: 0, objectFit: 'cover', opacity: 0.85 }}
            />
          ) : null}

          {/* Anéis concêntricos: a assinatura visual da carta colecionável. */}
          {[0, 1, 2, 3].map((ring) => (
            <div
              key={ring}
              style={{
                position: 'absolute',
                display: 'flex',
                width: 200 + ring * 46,
                height: 300 + ring * 30,
                borderRadius: '50%',
                border: `2px solid ${palette.glow}`,
                opacity: 0.35,
              }}
            />
          ))}

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              zIndex: 2,
            }}
          >
            {/* Losango desenhado: um caractere decorativo dependeria do glifo existir
                na fonte embutida — e o que falta vira quadrado vazio na prévia. */}
            <div
              style={{
                width: 34,
                height: 34,
                transform: 'rotate(45deg)',
                borderRadius: 6,
                background: palette.text,
              }}
            />
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 2,
              }}
            >
              {rarity}
            </div>
          </div>
        </div>

        {/* ── Os fatos ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 640 }}>
          <div style={{ fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', opacity: 0.8 }}>
            {tenant?.name ?? 'EventFlow'}
          </div>

          <div style={{ fontSize: 58, fontWeight: 700, lineHeight: 1.1 }}>
            {card.cardName.length > 42 ? `${card.cardName.slice(0, 41)}…` : card.cardName}
          </div>

          {/*
            `display: flex` é OBRIGATÓRIO aqui: o texto interpolado são DOIS nós
            (a frase e o nome), e o satori recusa `<div>` com mais de um filho sem
            display explícito — a imagem responde 500 e a prévia do link nasce vazia.
          */}
          <div style={{ display: 'flex', gap: 10, fontSize: 30, opacity: 0.95 }}>
            <span>Conquistada por</span>
            <span>{card.displayName}</span>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 22 }}>
            <div
              style={{
                padding: '8px 18px',
                borderRadius: 999,
                border: `2px solid ${palette.glow}`,
                opacity: 0.95,
              }}
            >
              {rarity}
            </div>
            {card.isFoil ? (
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: 999,
                  border: `2px solid ${palette.glow}`,
                  opacity: 0.95,
                }}
              >
                Holográfica
              </div>
            ) : null}
            {card.grantedAt ? (
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: 999,
                  border: `2px solid ${palette.glow}`,
                  opacity: 0.95,
                }}
              >
                {card.back.lines.find((line) => line.key === 'granted')?.value ?? ''}
              </div>
            ) : null}
          </div>

          <div style={{ fontSize: 20, opacity: 0.7, marginTop: 10 }}>
            Esta prévia mostra apenas esta carta.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
