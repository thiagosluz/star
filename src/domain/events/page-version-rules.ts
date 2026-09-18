/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Versões da página pública (FASE 23, item E12)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A TRILHA DE AUDITORIA NÃO BASTAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `AuditLog` registra QUE houve alteração, com resumo ("2 pergunta(s) → 3
 *  pergunta(s)"). Isso responde "quem mudou e quando", e não permite voltar: o texto
 *  anterior não existe em lugar nenhum. Um bloco sobrescrito por engano só voltava
 *  se alguém tivesse guardado o conteúdo fora do sistema.
 *
 *  Aqui a unidade de recuperação é a PÁGINA INTEIRA (blocos incluídos), e não o
 *  bloco: restaurar um bloco isolado exige decidir o que fazer com a ordem, com os
 *  blocos removidos depois e com o que foi acrescentado — decisões que ninguém quer
 *  tomar no meio de um evento. Restaurar a página é uma operação que se explica
 *  sozinha.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CHECKSUM EXISTE PARA NÃO GUARDAR VERSÃO IGUAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Salvar o formulário sem mexer em nada não pode virar uma linha no histórico: em
 *  uma tarde de ajustes, vinte versões idênticas escondem a que importa. O snapshot
 *  é canonicalizado (chaves ordenadas) antes do hash, porque `JSON.stringify` de
 *  dois objetos iguais com ordem de chave diferente produz strings diferentes — e a
 *  deduplicação falharia silenciosamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

import { PAGE_BLOCK_TYPES, type PageBlockType } from '@/domain/events/landing-page';

/** Quantas versões ficam disponíveis por página. */
export const MAX_PAGE_VERSIONS = 20;

/**
 * Motivos canônicos de uma versão.
 *
 * São rótulos curtos em pt-BR porque quem lê o histórico é quem opera a página, e
 * "UPDATE/eventPage" não diz nada a essa pessoa. O tipo evita que cada serviço
 * invente o seu texto.
 */
export const PAGE_VERSION_REASONS = {
  CREATED: 'Página criada',
  CONTENT: 'Conteúdo alterado',
  BLOCK_ADDED: 'Bloco adicionado',
  BLOCK_REMOVED: 'Bloco removido',
  REORDERED: 'Ordem alterada',
  PUBLISHED: 'Publicada',
  UNPUBLISHED: 'Despublicada',
  SCHEDULED: 'Publicação agendada',
  RESTORED: 'Restaurada de uma versão anterior',
  COMPOSITION: 'Composição sugerida aplicada',
} as const;

export type PageVersionReason = (typeof PAGE_VERSION_REASONS)[keyof typeof PAGE_VERSION_REASONS];

/** Bloco como ele entra no snapshot — a forma que a restauração consome. */
export interface SnapshotBlock {
  type: PageBlockType;
  content: unknown;
  displayOrder: number;
  isVisible: boolean;
}

/** Fotografia da página: o suficiente para recriá-la inteira. */
export interface PageSnapshot {
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  isPublished: boolean;
  /** ISO 8601 ou `null`. `Date` não sobrevive ao `Json` do banco de forma estável. */
  publishAt: string | null;
  blocks: SnapshotBlock[];
}

/**
 * Converte um valor em JSON com CHAVES ORDENADAS, recursivamente.
 *
 * Ordem de chave é contrato aqui pelo mesmo motivo que é contrato no payload de
 * auditoria do sorteio: o hash precisa ser reproduzível a partir do mesmo conteúdo.
 * Array mantém a ordem (ela é o dado: a ordem das perguntas frequentes é escolha do
 * organizador).
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);

  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }

  return value;
}

/** SHA-256 do snapshot canonicalizado. */
export function snapshotChecksum(snapshot: PageSnapshot): string {
  return createHash('sha256').update(canonicalize(snapshot), 'utf8').digest('hex');
}

/**
 * Vale a pena gravar esta versão?
 *
 * `previousChecksum` é o da versão mais recente da página (`null` se não há
 * nenhuma). Comparar por checksum, e não por igualdade de objeto, é o que permite a
 * comparação vir do banco sem trazer o snapshot inteiro para a memória.
 */
export function shouldRecordVersion(
  previousChecksum: string | null,
  snapshot: PageSnapshot,
): boolean {
  return previousChecksum !== snapshotChecksum(snapshot);
}

export interface SnapshotSummary {
  blockCount: number;
  /** Tipos presentes, na ordem, para a lista do histórico. */
  types: PageBlockType[];
  isPublished: boolean;
  publishAt: string | null;
}

/**
 * Resumo legível do que a versão contém.
 *
 * Tipos desconhecidos são descartados em vez de quebrar a lista: uma versão gravada
 * antes da remoção de um tipo de bloco precisa continuar aparecendo no histórico.
 */
export function summarizeSnapshot(snapshot: unknown): SnapshotSummary {
  const source = typeof snapshot === 'object' && snapshot !== null
    ? (snapshot as Record<string, unknown>)
    : {};

  const known = new Set<string>(PAGE_BLOCK_TYPES);
  const blocks = Array.isArray(source.blocks) ? source.blocks : [];

  const types = blocks
    .map((block) =>
      typeof block === 'object' && block !== null
        ? (block as Record<string, unknown>).type
        : null,
    )
    .filter((type): type is PageBlockType => typeof type === 'string' && known.has(type));

  return {
    blockCount: blocks.length,
    types,
    isPublished: source.isPublished === true,
    publishAt: typeof source.publishAt === 'string' ? source.publishAt : null,
  };
}

/**
 * Ids das versões que devem sair para respeitar o teto.
 *
 * A lista chega ORDENADA da mais recente para a mais antiga (é como a consulta
 * devolve), então o corte é posicional. Um laço que reordenasse por conta própria
 * divergiria da consulta no dia em que a ordenação mudasse.
 */
export function versionsToPrune(
  versions: readonly { id: string }[],
  max: number = MAX_PAGE_VERSIONS,
): string[] {
  if (versions.length <= max) return [];
  return versions.slice(max).map((version) => version.id);
}

/**
 * Converte o snapshot em linhas de bloco para gravação.
 *
 * A ordem é reescrita de `BLOCK_ORDER_STEP` em `BLOCK_ORDER_STEP` em vez de copiar o
 * `displayOrder` gravado: o snapshot pode ter vindo de um estado antigo, com empates
 * ou buracos, e a restauração deve produzir uma página organizada — não ressuscitar
 * a bagunça que a fase anterior já tinha resolvido.
 */
export function snapshotToBlockRows(
  snapshot: PageSnapshot,
  step: number,
): { type: PageBlockType; content: unknown; displayOrder: number; isVisible: boolean }[] {
  return snapshot.blocks.map((block, index) => ({
    type: block.type,
    content: block.content,
    displayOrder: index * step,
    isVisible: block.isVisible,
  }));
}
