import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * O `tailwind-merge` padrão só conhece a escala tipográfica nativa (`text-xs`..`text-9xl`)
 * e trata tokens customizados (`text-label-caps`, `text-title`, `text-display`…) como
 * classes de COR (`text-*`), removendo-os quando combinados com `text-success-strong`,
 * `text-on-surface-variant`, etc. Registrar a escala do `globals.css` em `font-size`
 * impede que o `Badge` e os títulos percam o tamanho de fonte ao receberem cor.
 */
const customTwMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['display', 'display-sm', 'title-lg', 'title', 'body-lg', 'label-caps'],
        },
      ],
    },
  },
});

/** Combina classes Tailwind resolvendo conflitos (a última vence). */
export function cn(...inputs: ClassValue[]): string {
  return customTwMerge(clsx(inputs));
}
