'use client';

import { useState } from 'react';

import { Input, Label, Textarea } from '@/components/ui';
import {
  TenantThemeFields,
  type TenantThemeFormValues,
} from '@/components/admin/tenant-theme-fields';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  IDENTIDADE E APARÊNCIA — os campos CONTROLADOS do editor (FASE 64 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTES DOIS CAMPOS NÃO SÃO `defaultValue` (armadilha 5)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 RESETA o formulário depois de uma Server Action: com campo não
 *  controlado, um "salvar" que falha (título vazio, cor fora do contrato) apaga o
 *  que a pessoa digitou e a obriga a redigitar sobre o valor do banco. O lugar onde
 *  isso dói mais é justamente este: o título e a descrição são o texto que a
 *  instituição escreveu sobre si.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A PALETA MORA DENTRO DO MESMO FORMULÁRIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Identidade e aparência são UM ato ("salvar a página"), e a página da instituição
 *  tem uma linha só (fatia 1): separar em dois formulários criaria dois "salvar"
 *  para a mesma gravação, e o segundo apagaria o primeiro se lesse um rascunho
 *  velho. Juntos, o que a tela mostra é o que a ação grava.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function TenantIdentityFields({
  title,
  description,
  theme,
}: {
  title: string;
  description: string;
  theme: TenantThemeFormValues;
}) {
  const [values, setValues] = useState({ title, description });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tenant-page-title">Título da página</Label>
        <Input
          id="tenant-page-title"
          name="title"
          value={values.title}
          onChange={(event) => setValues((current) => ({ ...current, title: event.target.value }))}
          maxLength={200}
          required
          data-testid="tenant-page-title-input"
        />
        <p className="text-xs text-muted-foreground">
          É o que aparece no topo da página e no título da aba do navegador.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tenant-page-description">Descrição</Label>
        <Textarea
          id="tenant-page-description"
          name="description"
          value={values.description}
          onChange={(event) =>
            setValues((current) => ({ ...current, description: event.target.value }))
          }
          rows={3}
          maxLength={2000}
          data-testid="tenant-page-description-input"
        />
        <p className="text-xs text-muted-foreground">
          Uma ou duas frases sobre a casa. Vazio usa a apresentação do diretório de instituições.
        </p>
      </div>

      <TenantThemeFields theme={theme} />
    </div>
  );
}
