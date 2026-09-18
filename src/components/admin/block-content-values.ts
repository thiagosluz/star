import type { PageBlockType } from '@/domain/events/landing-page';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  VALORES INICIAIS DOS CAMPOS DE UM BLOCO (FASE 17)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO MORA DENTRO DO COMPONENTE DE CAMPOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O componente de campos é `'use client'`. Num módulo com essa diretiva, TODO
 *  export vira uma referência de cliente: um Server Component que importasse a
 *  função de conversão e a chamasse no servidor receberia um erro em tempo de
 *  execução ("Attempted to call … from the server"). Como quem MONTA os valores é a
 *  página (servidor) e quem os EDITA é o formulário (cliente), a conversão fica em
 *  um módulo neutro, que os dois podem importar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface BlockContentValues {
  title: string;
  body: string;
  label: string;
  description: string;
  ctaLabel: string;
  tierId: string;
  html: string;
  faq: { question: string; answer: string }[];
  gallery: { url: string; caption: string }[];
}

/**
 * Converte o `content` gravado nos valores que os campos esperam.
 *
 * Listas vazias ganham UMA linha em branco: abrir o editor de perguntas frequentes
 * num bloco recém-criado e encontrar "nenhuma pergunta" com um botão para adicionar
 * é um passo a mais para a única coisa que a pessoa quer fazer ali.
 */
export function blockContentToValues(
  type: PageBlockType,
  content: Record<string, unknown>,
): BlockContentValues {
  const text = (key: string) => (typeof content[key] === 'string' ? (content[key] as string) : '');

  const faq = Array.isArray(content.items)
    ? (content.items as Record<string, unknown>[]).map((item) => ({
        question: typeof item.question === 'string' ? item.question : '',
        answer: typeof item.answer === 'string' ? item.answer : '',
      }))
    : [];

  const gallery = Array.isArray(content.images)
    ? (content.images as Record<string, unknown>[]).map((image) => ({
        url: typeof image.url === 'string' ? image.url : '',
        caption: typeof image.caption === 'string' ? image.caption : '',
      }))
    : [];

  return {
    title: text('title'),
    body: text('body'),
    label: text('label'),
    description: text('description'),
    ctaLabel: text('ctaLabel'),
    tierId: text('tierId'),
    html: text('html'),
    faq: type === 'FAQ' ? (faq.length > 0 ? faq : [{ question: '', answer: '' }]) : [],
    gallery:
      type === 'GALLERY' ? (gallery.length > 0 ? gallery : [{ url: '', caption: '' }]) : [],
  };
}
