/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Confirmação de vaga POR ITEM (FASE 37, dívida E48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FASE 34 fez a vaga nascer RETIDA quando a atividade cobra algo, e a confirmação
 *  era do CONJUNTO: a equipe marcava "confirmado" e pronto. Numa campanha com três
 *  itens, quem entregou dois ficava no mesmo estado de quem não entregou nada — e o
 *  balcão resolvia no olho, ou aceitava a confirmação parcial sem registro.
 *
 *  Aqui cada exigência tem o próprio estado (`PENDING`, `RECEIVED`, `WAIVED`) e o
 *  conjunto passa a ter uma REGRA: **quando todas as exigências obrigatórias estão
 *  satisfeitas, a vaga se confirma sozinha** — pela mesma transição que a equipe usaria,
 *  com o mesmo aviso e a mesma trilha. A inscrição continua com UM estado (a vaga é uma
 *  só); o que mudou é o caminho até ele.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS DECISÕES QUE ESTE MÓDULO TOMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Sem itens, não há confirmação automática.** Atividade que exige confirmação e
 *       não declara exigência nenhuma continua sendo confirmada pela EQUIPE (o
 *       comportamento da FASE 34): "nada a receber" não é o mesmo que "recebi tudo";
 *    2. **`WAIVED` conta como satisfeito.** A equipe pode dispensar um item (o
 *       participante não conseguiu trazer o brinquedo e a organização abriu mão) — e o
 *       registro diz que a dispensa foi DELA, com autor e hora;
 *    3. **Item opcional não segura a vaga.** Só as obrigatórias bloqueiam; o opcional
 *       aparece no checklist para o balcão conferir e não impede a confirmação.
 *
 *  Puro: sem Prisma, sem Next, sem relógio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ConfirmationRequirement } from '@/domain/events/confirmation-rules';

export const CONFIRMATION_ITEM_STATUSES = ['PENDING', 'RECEIVED', 'WAIVED'] as const;

export type ConfirmationItemStatus = (typeof CONFIRMATION_ITEM_STATUSES)[number];

export const CONFIRMATION_ITEM_STATUS_LABELS: Record<ConfirmationItemStatus, string> = {
  PENDING: 'A receber',
  RECEIVED: 'Recebido',
  WAIVED: 'Dispensado pela organização',
};

export function isConfirmationItemStatus(value: unknown): value is ConfirmationItemStatus {
  return (
    typeof value === 'string' && (CONFIRMATION_ITEM_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Valor desconhecido vira `PENDING` — e não `RECEIVED`.
 *
 * Mesma decisão do estado da inspeção de arquivos: um valor que o sistema não entende
 * não pode virar "recebido", porque isso confirmaria uma vaga sem ninguém ter olhado.
 */
export function normalizeItemStatus(value: unknown): ConfirmationItemStatus {
  return isConfirmationItemStatus(value) ? value : 'PENDING';
}

export function itemStatusLabel(value: unknown): string {
  return CONFIRMATION_ITEM_STATUS_LABELS[normalizeItemStatus(value)];
}

export interface ConfirmationItem {
  /** Ordem no checklist (0-based), fixada no snapshot. */
  position: number;
  kind: string;
  label: string;
  note: string | null;
  required: boolean;
  status: ConfirmationItemStatus;
}

/**
 * O checklist da inscrição, a partir do que a ATIVIDADE pedia.
 *
 * A exigência sem rótulo é descartada (mesma regra de `parseConfirmationRequirements`):
 * uma linha vazia no formulário da atividade não pode virar uma caixa vazia no balcão.
 */
export function snapshotRequirements(
  requirements: readonly ConfirmationRequirement[],
): ConfirmationItem[] {
  return requirements
    .filter((requirement) => requirement.label.trim().length > 0)
    .map((requirement, index) => ({
      position: index,
      kind: requirement.kind,
      label: requirement.label.trim(),
      note: requirement.note,
      required: requirement.required !== false,
      status: 'PENDING' as const,
    }));
}

/** O item já foi resolvido (recebido ou dispensado)? */
export function isItemSatisfied(item: { status: ConfirmationItemStatus }): boolean {
  return item.status !== 'PENDING';
}

/**
 * O MÍNIMO que uma regra de progresso precisa saber de um item.
 *
 * O tipo estreito existe porque nem toda tela carrega o item inteiro: a lista do
 * participante mostra rótulo e estado e não tem por que ler `kind`. Exigir o
 * `ConfirmationItem` completo ali obrigaria a consulta a trazer coluna que ninguém usa.
 */
export type ConfirmationItemLike = Pick<ConfirmationItem, 'label' | 'required' | 'status'>;

export interface ItemsProgress {
  total: number;
  required: number;
  satisfied: number;
  requiredSatisfied: number;
  pendingRequired: number;
  /** Os rótulos do que ainda falta das obrigatórias — é o que a tela e o aviso dizem. */
  missingLabels: string[];
  /** `true` quando o checklist existe E todas as obrigatórias estão resolvidas. */
  complete: boolean;
}

export function itemsProgress(items: readonly ConfirmationItemLike[]): ItemsProgress {
  const required = items.filter((item) => item.required);
  const satisfied = items.filter(isItemSatisfied);
  const requiredSatisfied = required.filter(isItemSatisfied);
  const missing = required.filter((item) => !isItemSatisfied(item));

  return {
    total: items.length,
    required: required.length,
    satisfied: satisfied.length,
    requiredSatisfied: requiredSatisfied.length,
    pendingRequired: missing.length,
    missingLabels: missing.map((item) => item.label),
    complete: items.length > 0 && missing.length === 0,
  };
}

export type AutoConfirmCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'NO_ITEMS' | 'ITEMS_PENDING';
      message: string;
      missingLabels: string[];
    };

/**
 * A vaga pode se confirmar SOZINHA?
 *
 * A recusa diz o que falta, com os rótulos: a mensagem é o que o balcão lê para saber se
 * ainda espera alguém — "faltam 2 itens" sem dizer quais não ajuda quem está na fila.
 */
export function canAutoConfirm(items: readonly ConfirmationItemLike[]): AutoConfirmCheck {
  if (items.length === 0) {
    return {
      ok: false,
      code: 'NO_ITEMS',
      message:
        'Esta atividade não tem exigências registradas: a confirmação da vaga é da equipe.',
      missingLabels: [],
    };
  }

  const progress = itemsProgress(items);

  if (!progress.complete) {
    const labels = progress.missingLabels.join('; ');

    return {
      ok: false,
      code: 'ITEMS_PENDING',
      message:
        progress.pendingRequired === 1
          ? `Falta receber: ${labels}.`
          : `Faltam ${progress.pendingRequired} itens obrigatórios: ${labels}.`,
      missingLabels: progress.missingLabels,
    };
  }

  return { ok: true };
}

/** "2 de 3 itens recebidos" — o resumo que a fila da equipe mostra por inscrição. */
export function itemsSummary(items: readonly ConfirmationItemLike[]): string {
  const progress = itemsProgress(items);

  if (progress.total === 0) return 'Sem exigências';

  return `${progress.satisfied} de ${progress.total} itens`;
}
