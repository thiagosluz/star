'use client';

import { useState } from 'react';

import {
  THEME_COLOR_PRESETS,
  toColorPickerHex,
  type ThemeColorFieldKey,
} from '@/domain/events/landing-page';
import { Input, Label, Select } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TEMA DA PÁGINA PÚBLICA — CAMPOS CONTROLADOS (FASE 17, item E3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE NÃO É UM `<input type="color">`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O seletor nativo de cor NÃO TEM ESTADO VAZIO: um campo sem valor envia
 *  `#000000`. Num formulário cujo "vazio" significa "usar o token da plataforma",
 *  isso transformaria "não mexi na cor" em "pintei tudo de preto" — e o organizador
 *  não teria como desfazer, porque não existe como apagar um `type="color"`.
 *
 *  Aqui o campo é de TEXTO com amostra ao lado: vazio devolve o token do sistema,
 *  e o valor digitado é validado no servidor pela MESMA allowlist do domínio
 *  (`colorSchema` — hexadecimal ou `oklch()`). A amostra só aparece quando o valor
 *  tem cara de cor; um texto inválido fica visível e é recusado ao salvar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE CONTROLADO, E NÃO COM `defaultValue`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 RESETA o formulário depois de uma Server Action (armadilha 5 do
 *  AGENTS.md). Com campos controlados, o que o organizador digitou continua na tela
 *  depois de um erro de validação — em vez de voltar ao valor do banco e obrigá-lo a
 *  redigitar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const HEX_OR_OKLCH = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|oklch\(.+\))$/;

interface ThemeValues {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  colorMode: string;
  radius: number;
  fontFamily: string;
  spacing: string;
  heroStyle: string;
  animation: string;
}

const COLOR_FIELDS: { name: ThemeColorFieldKey; label: string; hint: string }[] = [
  { name: 'primaryColor', label: 'Cor principal', hint: 'Botões e destaques' },
  { name: 'secondaryColor', label: 'Cor secundária', hint: 'Detalhes e apoio' },
  { name: 'accentColor', label: 'Cor de destaque', hint: 'Selos e ênfase' },
  { name: 'backgroundColor', label: 'Fundo', hint: 'Fundo da página' },
  { name: 'textColor', label: 'Texto', hint: 'Cor do texto corrido' },
];

export function LandingThemeFields({ theme }: { theme: ThemeValues }) {
  const [values, setValues] = useState<ThemeValues>(theme);

  function set(name: keyof ThemeValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4">
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Aparência da página pública
      </legend>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COLOR_FIELDS.map((field) => {
          const value = String(values[field.name] ?? '');
          const valid = HEX_OR_OKLCH.test(value.trim());
          const presets = THEME_COLOR_PRESETS[field.name];

          return (
            <div key={field.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={field.name}>{field.label}</Label>
                {value.trim() !== '' ? (
                  <button
                    type="button"
                    aria-label="Restaurar padrão do sistema"
                    data-testid={`theme-clear-${field.name}`}
                    onClick={() => set(field.name, '')}
                    className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Padrão
                  </button>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <label
                  data-testid={`theme-swatch-${field.name}`}
                  title="Clique para abrir o seletor visual de cor"
                  className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-sm border border-border transition hover:ring-2 hover:ring-ring/40"
                  style={{ backgroundColor: valid ? value.trim() : undefined }}
                >
                  <input
                    type="color"
                    aria-label="Abrir seletor visual de cor"
                    data-testid={`theme-picker-${field.name}`}
                    value={toColorPickerHex(value, field.name)}
                    onChange={(event) => set(field.name, event.target.value)}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={value}
                  onChange={(event) => set(field.name, event.target.value)}
                  placeholder="#4f46e5"
                  className="h-9"
                />
              </div>
              <div
                className="flex flex-wrap items-center gap-1.5 pt-0.5"
                data-testid={`theme-presets-${field.name}`}
              >
                {presets.map((preset) => {
                  const isSelected = value.trim().toLowerCase() === preset.value.toLowerCase();
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={`${preset.label} (${preset.value})`}
                      aria-label={`Sugestão ${preset.label}`}
                      aria-pressed={isSelected}
                      data-testid={`theme-preset-${field.name}-${preset.id}`}
                      onClick={() => set(field.name, preset.value)}
                      className={`size-5 rounded-full border transition hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring ${
                        isSelected ? 'border-foreground ring-2 ring-ring/50' : 'border-border'
                      }`}
                      style={{ backgroundColor: preset.value }}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {value.trim() === ''
                  ? `${field.hint} · escolha uma cor ou digite o código`
                  : valid
                    ? field.hint
                    : 'Valor inválido: use #rrggbb ou oklch(…)'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="radius">Arredondamento (0–48)</Label>
          <Input
            id="radius"
            name="radius"
            type="number"
            min={0}
            max={48}
            value={values.radius}
            onChange={(event) => set('radius', event.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fontFamily">Tipografia</Label>
          <Select
            id="fontFamily"
            name="fontFamily"
            value={values.fontFamily}
            onChange={(event) => set('fontFamily', event.target.value)}
            className="h-9"
          >
            <option value="inter">Inter</option>
            <option value="geist">Geist</option>
            <option value="system">Sistema</option>
            <option value="serif">Serifada</option>
            <option value="mono">Monoespaçada</option>
            <option value="rounded">Arredondada</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="spacing">Densidade</Label>
          <Select
            id="spacing"
            name="spacing"
            value={values.spacing}
            onChange={(event) => set('spacing', event.target.value)}
            className="h-9"
          >
            <option value="compact">Compacta</option>
            <option value="normal">Normal</option>
            <option value="spacious">Espaçosa</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="heroStyle">Cabeçalho</Label>
          <Select
            id="heroStyle"
            name="heroStyle"
            value={values.heroStyle}
            onChange={(event) => set('heroStyle', event.target.value)}
            className="h-9"
          >
            <option value="gradient">Degradê</option>
            <option value="solid">Cor sólida</option>
            <option value="image">Imagem de capa</option>
            <option value="minimal">Minimalista</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="animation">Animação de entrada</Label>
          <Select
            id="animation"
            name="animation"
            value={values.animation}
            onChange={(event) => set('animation', event.target.value)}
            className="h-9"
          >
            <option value="fade">Suave</option>
            <option value="slide">Deslizar</option>
            <option value="none">Nenhuma</option>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="colorMode">Modo de cor</Label>
          <Select
            id="colorMode"
            name="colorMode"
            value={values.colorMode}
            onChange={(event) => set('colorMode', event.target.value)}
            className="h-9"
          >
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
            <option value="auto">Automático</option>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        A animação respeita <span className="code-data">prefers-reduced-motion</span>: quem pediu menos
        movimento no sistema não a vê.
      </p>
    </fieldset>
  );
}
