import { describe, expect, it } from 'vitest';

import {
  CONFIRMATION_ITEM_STATUSES,
  CONFIRMATION_ITEM_STATUS_LABELS,
  canAutoConfirm,
  isConfirmationItemStatus,
  isItemSatisfied,
  itemStatusLabel,
  itemsProgress,
  itemsSummary,
  normalizeItemStatus,
  snapshotRequirements,
  type ConfirmationItem,
} from '../../src/domain/events/confirmation-item-rules';
import { parseConfirmationRequirements } from '../../src/domain/events/confirmation-rules';

/** Um item pronto, com o que o teste quer mudar por cima. */
function item(overrides: Partial<ConfirmationItem> = {}): ConfirmationItem {
  return {
    position: 0,
    kind: 'ITEM',
    label: 'Item',
    note: null,
    required: true,
    status: 'PENDING',
    ...overrides,
  };
}

describe('catálogo do checklist', () => {
  it('todo estado tem rótulo em português', () => {
    for (const status of CONFIRMATION_ITEM_STATUSES) {
      expect(CONFIRMATION_ITEM_STATUS_LABELS[status], status).toBeTruthy();
    }
  });

  it('reconhece estado válido e recusa o resto', () => {
    expect(isConfirmationItemStatus('PENDING')).toBe(true);
    expect(isConfirmationItemStatus('RECEIVED')).toBe(true);
    expect(isConfirmationItemStatus('WAIVED')).toBe(true);
    expect(isConfirmationItemStatus('received')).toBe(false);
    expect(isConfirmationItemStatus(null)).toBe(false);
  });

  /**
   * Valor que o sistema não entende NÃO pode virar "recebido": isso confirmaria uma vaga
   * sem ninguém ter olhado. Mesma decisão do estado da inspeção de arquivos.
   */
  it('estado desconhecido cai em A RECEBER, nunca em recebido', () => {
    expect(normalizeItemStatus('INVENTADO')).toBe('PENDING');
    expect(normalizeItemStatus(undefined)).toBe('PENDING');
    expect(itemStatusLabel('INVENTADO')).toBe(CONFIRMATION_ITEM_STATUS_LABELS.PENDING);
  });

  it('recebido e dispensado contam como resolvidos; pendente não', () => {
    expect(isItemSatisfied({ status: 'RECEIVED' })).toBe(true);
    expect(isItemSatisfied({ status: 'WAIVED' })).toBe(true);
    expect(isItemSatisfied({ status: 'PENDING' })).toBe(false);
  });
});

describe('snapshot das exigências na inscrição', () => {
  it('numera na ordem, limpa o rótulo e nasce pendente', () => {
    const items = snapshotRequirements(
      parseConfirmationRequirements([
        { kind: 'DONATION', label: '  1 kg de alimento ', note: '  ' },
        { kind: 'PAYMENT', label: 'Taxa de R$ 30', note: 'Pix na secretaria' },
      ]),
    );

    expect(items).toEqual([
      {
        position: 0,
        kind: 'DONATION',
        label: '1 kg de alimento',
        note: null,
        required: true,
        status: 'PENDING',
      },
      {
        position: 1,
        kind: 'PAYMENT',
        label: 'Taxa de R$ 30',
        note: 'Pix na secretaria',
        required: true,
        status: 'PENDING',
      },
    ]);
  });

  it('linha em branco não vira caixa vazia no balcão', () => {
    const items = snapshotRequirements([
      { kind: 'ITEM', label: '   ', note: null },
      { kind: 'ITEM', label: 'Brinquedo novo', note: null },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]!.label).toBe('Brinquedo novo');
    /** A posição é a do checklist gravado, e não o índice da lista original. */
    expect(items[0]!.position).toBe(0);
  });

  it('lista vazia devolve checklist vazio', () => {
    expect(snapshotRequirements([])).toEqual([]);
  });

  it('a exigência opcional entra no snapshot, marcada como opcional', () => {
    const items = snapshotRequirements([
      { kind: 'ITEM', label: 'Camiseta extra', note: null, required: false },
    ]);

    expect(items[0]!.required).toBe(false);
  });
});

describe('progresso do checklist', () => {
  it('conta o que falta e diz QUAIS obrigatórias faltam', () => {
    const progress = itemsProgress([
      item({ label: 'Taxa', status: 'RECEIVED' }),
      item({ label: 'Alimento', status: 'PENDING' }),
      item({ label: 'Brinquedo', status: 'PENDING' }),
    ]);

    expect(progress.total).toBe(3);
    expect(progress.satisfied).toBe(1);
    expect(progress.pendingRequired).toBe(2);
    expect(progress.missingLabels).toEqual(['Alimento', 'Brinquedo']);
    expect(progress.complete).toBe(false);
  });

  it('o item OPCIONAL pendente não segura a vaga', () => {
    const progress = itemsProgress([
      item({ label: 'Taxa', status: 'RECEIVED' }),
      item({ label: 'Camiseta extra', required: false, status: 'PENDING' }),
    ]);

    expect(progress.pendingRequired).toBe(0);
    expect(progress.complete).toBe(true);
    /** Ele continua contando no total — o balcão precisa vê-lo. */
    expect(progress.total).toBe(2);
    expect(progress.satisfied).toBe(1);
  });

  it('DISPENSAR resolve tanto quanto receber', () => {
    const progress = itemsProgress([
      item({ label: 'Taxa', status: 'WAIVED' }),
      item({ label: 'Alimento', status: 'RECEIVED' }),
    ]);

    expect(progress.complete).toBe(true);
    expect(progress.requiredSatisfied).toBe(2);
  });

  it('checklist vazio NUNCA está completo', () => {
    const progress = itemsProgress([]);

    expect(progress.total).toBe(0);
    expect(progress.complete).toBe(false);
  });
});

describe('confirmação automática da vaga', () => {
  /**
   * "Nada a receber" não é o mesmo que "recebi tudo": sem checklist, quem confirma é a
   * EQUIPE — é o comportamento da FASE 34 e ele não muda aqui.
   */
  it('sem exigências registradas, a confirmação continua sendo da equipe', () => {
    const check = canAutoConfirm([]);

    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('NO_ITEMS');
      expect(check.message).toMatch(/equipe/i);
    }
  });

  it('faltando obrigatória, recusa DIZENDO o que falta', () => {
    const check = canAutoConfirm([
      item({ label: 'Taxa de R$ 30', status: 'RECEIVED' }),
      item({ label: '1 kg de alimento', status: 'PENDING' }),
    ]);

    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.code).toBe('ITEMS_PENDING');
      expect(check.missingLabels).toEqual(['1 kg de alimento']);
      expect(check.message).toBe('Falta receber: 1 kg de alimento.');
    }
  });

  it('faltando mais de uma, a mensagem conta e lista', () => {
    const check = canAutoConfirm([
      item({ label: 'Alimento', status: 'PENDING' }),
      item({ label: 'Brinquedo', status: 'PENDING' }),
    ]);

    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toBe('Faltam 2 itens obrigatórios: Alimento; Brinquedo.');
  });

  it('com todas as obrigatórias resolvidas, a vaga se confirma sozinha', () => {
    expect(
      canAutoConfirm([
        item({ label: 'Taxa', status: 'RECEIVED' }),
        item({ label: 'Alimento', status: 'WAIVED' }),
        item({ label: 'Camiseta extra', required: false, status: 'PENDING' }),
      ]),
    ).toEqual({ ok: true });
  });
});

describe('resumo do checklist', () => {
  it('conta os resolvidos sobre o total', () => {
    expect(
      itemsSummary([
        item({ status: 'RECEIVED' }),
        item({ status: 'WAIVED' }),
        item({ status: 'PENDING' }),
      ]),
    ).toBe('2 de 3 itens');
  });

  it('sem item, diz que não há exigência em vez de "0 de 0"', () => {
    expect(itemsSummary([])).toBe('Sem exigências');
  });
});
