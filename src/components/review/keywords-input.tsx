'use client';

import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

import { Input } from '@/components/ui';
import { MAX_KEYWORDS, MIN_KEYWORDS, normalizeKeywords } from '@/domain/review/submission-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PALAVRAS-CHAVE — O CAMPO QUE CONTA O QUE FOI DIGITADO (revisão da FASE 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE COMPONENTE EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra "de 3 a 8 palavras-chave distintas" estava escrita na dica do campo e
 *  validada SÓ no envio. Quem digitava uma palavra salvava o rascunho, e o
 *  problema só aparecia no fim, sem dizer o que faltava — e sem onde corrigir.
 *
 *  Aqui a contagem aparece ENQUANTO se digita ("2 de 3"), com o número de distintas
 *  que o servidor vai contar (repetida conta uma vez). O servidor continua sendo a
 *  autoridade: esta é a MESMA função do domínio (`normalizeKeywords`), mostrada
 *  cedo — não uma segunda regra que pode divergir da primeira.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function KeywordsInput({
  name = 'keywords',
  id,
  defaultValue = '',
}: {
  name?: string;
  id?: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const fieldId = id ?? name;
  const counterId = `${fieldId}-count`;

  const count = normalizeKeywords(value.split(',')).length;
  const enough = count >= MIN_KEYWORDS && count <= MAX_KEYWORDS;

  return (
    <div className="space-y-1.5">
      <Input
        id={fieldId}
        name={name}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="aprendizado de máquina, saúde pública, epidemiologia"
        maxLength={600}
        aria-describedby={counterId}
        data-testid="keywords-input"
      />

      <p
        id={counterId}
        className={`flex items-center gap-1.5 text-xs ${enough ? 'text-success-strong' : 'text-warning-strong'}`}
        data-testid="keywords-count"
        data-count={count}
        data-enough={String(enough)}
        role="status"
      >
        {enough ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : null}
        {enough
          ? `${count} palavras-chave distintas — dentro do exigido (${MIN_KEYWORDS} a ${MAX_KEYWORDS}).`
          : `${count} de ${MIN_KEYWORDS} palavras-chave distintas. Separe por vírgula; repetidas contam uma vez.`}
      </p>
    </div>
  );
}
