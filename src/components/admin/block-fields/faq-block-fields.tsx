'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button, Input, Label, Textarea } from '@/components/ui';
import type { BlockContentValues } from '@/components/admin/block-content-values';

/** Editor de perguntas frequentes com estado local de linhas repetíveis. */
export function FaqBlockFields({ initialFaq }: { initialFaq: BlockContentValues['faq'] }) {
  const [faq, setFaq] = useState(initialFaq);

  return (
    <div className="space-y-3">
      <Label>Perguntas frequentes</Label>
      {faq.map((item, index) => (
        <div key={index} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Pergunta {index + 1}</span>
            {faq.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remover pergunta ${index + 1}`}
                onClick={() => setFaq((current) => current.filter((_, i) => i !== index))}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Remover
              </Button>
            ) : null}
          </div>
          <Input
            name="faqQuestion"
            defaultValue={item.question}
            placeholder="Onde será o evento?"
            aria-label={`Pergunta ${index + 1}`}
          />
          <Textarea
            name="faqAnswer"
            defaultValue={item.answer}
            rows={2}
            placeholder="No Centro de Convenções, com transmissão online."
            aria-label={`Resposta ${index + 1}`}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="add-faq-row"
        onClick={() => setFaq((current) => [...current, { question: '', answer: '' }])}
      >
        <Plus className="size-3.5" aria-hidden />
        Adicionar pergunta
      </Button>
    </div>
  );
}
