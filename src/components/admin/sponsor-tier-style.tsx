'use client';

import { useState } from 'react';

import {
  DEFAULT_SPONSOR_LOGO_SCALE,
  SPONSOR_LOGO_HEIGHT_PX,
  SPONSOR_LOGO_MAX_WIDTH_PX,
  SPONSOR_LOGO_SCALES,
  SPONSOR_LOGO_SCALE_LABELS,
  SPONSOR_TIER_COLOR_SUGGESTIONS,
  sponsorTierTint,
  type SponsorLogoScale,
} from '@/domain/events/sponsor-rules';
import { Input, Select } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VITRINE DA COTA: COR, TAMANHO DA LOGO E PRÉVIA (FASE 41)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PRÉVIA FICA NO MESMO COMPONENTE DOS DOIS CAMPOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cor e tamanho só fazem sentido JUNTOS: a pergunta que o organizador faz é "como
 *  esta cota vai aparecer na página?", e a resposta é o cartão — fundo tingido pela
 *  cor, logo no degrau escolhido. Separar os campos da prévia (ou pôr a prévia
 *  noutra tela) obrigaria a pessoa a sair do formulário para conferir o que acabou
 *  de escolher, que é exatamente o atrito que esta fase veio remover.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CAMPO DE COR É TEXTO, E CONTINUA FUNCIONANDO SEM JAVASCRIPT
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As amostras são ATALHO: elas escrevem no campo, que é quem carrega o valor para
 *  o servidor. Sem JavaScript, o campo continua ali com o valor gravado — a mesma
 *  régua do editor do certificado (o arrastar é o caminho rápido; o número é o
 *  caminho que sempre funciona).
 *
 *  O valor é validado no SERVIDOR (`colorSchema`: hexadecimal ou `oklch()`); aqui a
 *  prévia apenas mostra o que dá para mostrar, e uma cor inválida cai no cartão
 *  neutro em vez de virar CSS quebrado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function SponsorTierStyleFields({
  color,
  logoScale,
  testPrefix,
}: {
  color: string | null;
  logoScale: SponsorLogoScale;
  /** Prefixo dos `data-testid`, para os dois formulários da página não colidirem. */
  testPrefix: string;
}) {
  const [tierColor, setTierColor] = useState(color ?? '');
  const [scale, setScale] = useState<SponsorLogoScale>(logoScale ?? DEFAULT_SPONSOR_LOGO_SCALE);

  const tint = sponsorTierTint(tierColor);
  const height = SPONSOR_LOGO_HEIGHT_PX[scale];
  const maxWidth = SPONSOR_LOGO_MAX_WIDTH_PX[scale];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-sm font-medium text-foreground">
          <span>Cor da cota</span>
          <Input
            name="color"
            value={tierColor}
            onChange={(event) => setTierColor(event.target.value)}
            /**
             * O exemplo do campo vem do CATÁLOGO do domínio, e não de um literal
             * escrito aqui: o guard do design system reprova cor literal em
             * componente (`src/app`/`src/components`) — e com razão, porque a
             * próxima pessoa copiaria o valor achando que é token.
             */
            placeholder={SPONSOR_TIER_COLOR_SUGGESTIONS[0].value}
            aria-label="Cor da cota"
            data-testid={`${testPrefix}-color`}
          />
          <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {SPONSOR_TIER_COLOR_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.value}
                type="button"
                title={suggestion.label}
                aria-label={`Usar a cor ${suggestion.label}`}
                onClick={() => setTierColor(suggestion.value)}
                className="inline-flex size-6 items-center justify-center rounded-full border border-border transition hover:scale-105"
                style={{ backgroundColor: suggestion.value }}
                data-testid={`${testPrefix}-swatch-${suggestion.label.toLowerCase()}`}
              />
            ))}
            <button
              type="button"
              onClick={() => setTierColor('')}
              className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              data-testid={`${testPrefix}-color-clear`}
            >
              sem cor
            </button>
          </span>
          <span className="block text-xs font-normal text-muted-foreground">
            Aceita hexadecimal e <code>oklch()</code>. Sem cor, o cartão da cota fica neutro.
          </span>
        </label>

        <label className="block space-y-1.5 text-sm font-medium text-foreground">
          <span>Tamanho da logo</span>
          <Select
            name="logoScale"
            value={scale}
            onChange={(event) => setScale(event.target.value as SponsorLogoScale)}
            aria-label="Tamanho da logo"
            data-testid={`${testPrefix}-scale`}
          >
            {SPONSOR_LOGO_SCALES.map((option) => (
              <option key={option} value={option}>
                {SPONSOR_LOGO_SCALE_LABELS[option]}
              </option>
            ))}
          </Select>
          <span className="block text-xs font-normal text-muted-foreground">
            Esta é a hierarquia da cota na página: a logo sai com {height} px de altura.
          </span>
        </label>
      </div>

      <div className="space-y-1.5">
        <span className="text-sm font-medium text-foreground">Prévia do cartão</span>
        <div
          className="flex items-center justify-center rounded-lg border px-5 py-4"
          style={
            tint
              ? { backgroundColor: tint.surface, borderColor: tint.border }
              : { borderColor: 'color-mix(in oklab, var(--ef-text, currentColor) 12%, transparent)' }
          }
          data-testid={`${testPrefix}-preview`}
          data-preview-scale={scale}
        >
          <span
            className="flex items-center justify-center rounded-md border border-border bg-card/60 text-xs text-muted-foreground"
            style={{ height: `${height}px`, width: `${maxWidth}px` }}
            aria-hidden
          >
            logo do patrocinador
          </span>
        </div>
      </div>
    </>
  );
}
