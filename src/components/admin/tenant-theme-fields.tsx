'use client';

import { useState } from 'react';

import { Input, Label, Select } from '@/components/ui';
import { TENANT_PALETTE_ROLES } from '@/domain/tenancy/tenant-page-theme-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APARÊNCIA DA PÁGINA DA INSTITUIÇÃO — os campos do editor (FASE 64 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE COMPONENTE NÃO TEM "MODO DE COR", "FUNDO" NEM "TEXTO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O controle do EVENTO (`landing-theme-fields.tsx`) tem os três: lá o organizador
 *  decide a iluminação do cartaz, e o visitante não opina (ADR-325).
 *
 *  A página da INSTITUIÇÃO vive dentro do casco da plataforma, com o controle de
 *  aparência do visitante no rodapé (FASE 63). Se o campo de modo existisse aqui,
 *  a instituição poderia escolher "claro" e o visitante que pediu escuro receberia
 *  uma página clara — o defeito que esta fatia existe para não ter. E fundo/texto
 *  são os dois únicos papéis que PRECISAM acompanhar o modo (um fundo claro com
 *  texto escuro é ilegível no escuro).
 *
 *  Então o formulário escolhe a IDENTIDADE — a marca da casa nos três papéis que
 *  não dependem do modo — e a tela DIZ que fundo e texto seguem o visitante. Campo
 *  ausente sem explicação vira dúvida; campo ausente com explicação é uma decisão.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CAMPO É DE TEXTO, E NÃO `<input type="color">`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O seletor nativo não tem estado VAZIO: um campo sem valor envia `#000000`, e
 *  "vazio" aqui significa "usar o padrão da plataforma". A amostra ao lado mostra o
 *  que o valor digitado pinta, e a validação é a MESMA allowlist do domínio
 *  (`colorSchema` — hexadecimal ou `oklch()`), aplicada no servidor.
 *
 *  Controlado (e não `defaultValue`) porque o React 19 reseta o formulário depois de
 *  uma Server Action (armadilha 5): o que foi digitado continua na tela depois de um
 *  erro de validação, em vez de voltar ao valor do banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const HEX_OR_OKLCH = /^(#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|oklch\(.+\))$/;

export interface TenantThemeFormValues {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  radius: number;
  fontFamily: string;
  spacing: string;
  animation: string;
}

/** `GET` do formulário para a Server Action: só o que a página da instituição usa. */
export function tenantThemeFieldsValue(values: TenantThemeFormValues): string {
  return JSON.stringify({
    radius: values.radius,
    fontFamily: values.fontFamily,
    spacing: values.spacing,
    animation: values.animation,
  });
}

export function TenantThemeFields({ theme }: { theme: TenantThemeFormValues }) {
  const [values, setValues] = useState<TenantThemeFormValues>(theme);

  function set(name: keyof TenantThemeFormValues, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4" data-testid="tenant-theme">
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Paleta da instituição
      </legend>

      {/*
        O que o formulário NÃO manda viaja como campo oculto: são os papéis que a
        tela não oferece, e o servidor os lê do JSON em vez de inventar padrão.
      */}
      <input type="hidden" name="theme" value={tenantThemeFieldsValue(values)} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TENANT_PALETTE_ROLES.map((field) => {
          const value = String(values[field.key] ?? '');
          const valid = HEX_OR_OKLCH.test(value.trim());

          return (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key}>{field.label}</Label>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  data-testid={`tenant-theme-swatch-${field.key}`}
                  className="size-9 shrink-0 rounded-sm border border-border"
                  style={{ backgroundColor: valid ? value.trim() : undefined }}
                />
                <Input
                  id={field.key}
                  name={field.key}
                  value={value}
                  onChange={(event) => set(field.key, event.target.value)}
                  placeholder="#0f6f8c"
                  className="h-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {value.trim() === ''
                  ? `${field.hint}`
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
      </div>

      {/**
        * ─────────────────────────────────────────────────────────────────────────────
        *  A FRASE QUE EXPLICA O QUE O FORMULÁRIO NÃO PERGUNTA (e por quê)
        * ─────────────────────────────────────────────────────────────────────────────
        *  Sem ela, a ausência dos campos de fundo, texto e modo pareceria um editor
        *  incompleto. Com ela, é a decisão de produto desta fase: o visitante escolhe
        *  claro ou escuro no rodapé, e a paleta da casa é a identidade DENTRO do modo
        *  que ele escolheu.
        */}
      <p className="text-xs text-muted-foreground" data-testid="tenant-theme-mode-note">
        <strong>Fundo e texto seguem o visitante.</strong> Quem abre a página escolhe Claro, Escuro ou
        Sistema no rodapé, e a página acompanha — a paleta acima é a identidade da instituição dentro
        do modo escolhido. Por isso não há campo de fundo, de texto nem de modo aqui.
      </p>

      <p className="text-xs text-muted-foreground">
        A animação respeita <span className="code-data">prefers-reduced-motion</span>: quem pediu menos
        movimento no sistema não a vê.
      </p>
    </fieldset>
  );
}
