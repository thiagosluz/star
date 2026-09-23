/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Inspeção dos arquivos enviados (FASE 36 · dívida A3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELE FAZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Percorre os arquivos que nasceram `PENDING`, inspeciona cada um e grava o
 *  veredito. Enquanto o veredito não chega, o arquivo **não é servido** ao comitê
 *  (regra em `canServeFile`) — é a promessa do pedido: inspecionar ANTES de
 *  disponibilizar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS DECISÕES QUE SUSTENTAM ESTE SERVIÇO
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. **Falha de infraestrutura não é veredito.** clamd fora do ar, timeout ou
 *       resposta ilegível deixam o arquivo `PENDING` (com o motivo em
 *       `scanMessage`) e a próxima passada tenta de novo. Marcar `INFECTED` por
 *       indisponibilidade bloquearia gente inocente; marcar `CLEAN` seria pior.
 *    2. **Um arquivo por vez, com teto por instituição.** A varredura é periódica e
 *       o lote pequeno mantém o worker responsivo — a fila não pode ficar presa
 *       atrás de uma inspeção.
 *    3. **A varredura é cross-tenant como as outras** (presenças, prazos,
 *       confirmação de vaga): lista as instituições ativas pelo cliente de sistema e
 *       abre UMA transação por instituição com `withTenant`, para que a leitura e a
 *       escrita continuem sob RLS.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { systemClient, withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { isScanningEnabled, scanStoredObject } from '@/lib/storage/scan-service';

export interface FileScanResult {
  tenants: number;
  /** Arquivos inspecionados nesta passada. */
  scanned: number;
  clean: number;
  infected: number;
  /** Inspeções que não puderam acontecer (ficam pendentes para a próxima). */
  failed: number;
}

/** Teto de arquivos por instituição em uma passada. */
const SCAN_BATCH = 25;

export async function runFileScan(input: { limit?: number } = {}): Promise<FileScanResult> {
  const limit = Math.min(Math.max(1, input.limit ?? SCAN_BATCH), 200);
  const result: FileScanResult = { tenants: 0, scanned: 0, clean: 0, infected: 0, failed: 0 };

  /**
   * Com a inspeção desligada não há o que varrer — e nada é marcado: os arquivos
   * ficam `SKIPPED` desde o nascimento (ver `initialScanStatus`).
   */
  if (!isScanningEnabled()) return result;

  const tenants = await systemClient().tenant.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });

  for (const tenant of tenants) {
    result.tenants += 1;

    const pending = await withTenant(tenant.id, async (tx) => {
      const [files, materials] = await Promise.all([
        tx.submissionFile.findMany({
          where: { tenantId: tenant.id, scanStatus: 'PENDING', deletedAt: null },
          orderBy: { createdAt: 'asc' },
          take: limit,
          select: {
            id: true,
            bucket: true,
            storageKey: true,
            submission: { select: { id: true, title: true, protocol: true } },
          },
        }),
        tx.speakerMaterial.findMany({
          where: {
            tenantId: tenant.id,
            scanStatus: 'PENDING',
            deletedAt: null,
            storageKey: { not: null },
            storageBucket: { not: null },
          },
          orderBy: { createdAt: 'asc' },
          take: limit,
          select: { id: true, storageBucket: true, storageKey: true, title: true },
        }),
      ]);

      return { files, materials };
    });

    for (const file of pending.files) {
      const outcome = await inspect(tenant.id, {
        bucket: file.bucket,
        objectKey: file.storageKey,
        entity: 'SubmissionFile',
        entityId: file.id,
        label: file.submission?.protocol ?? file.submission?.title ?? file.id,
      });

      countOutcome(result, outcome);
    }

    for (const material of pending.materials) {
      if (!material.storageBucket || !material.storageKey) continue;

      const outcome = await inspect(tenant.id, {
        bucket: material.storageBucket,
        objectKey: material.storageKey,
        entity: 'SpeakerMaterial',
        entityId: material.id,
        label: material.title,
      });

      countOutcome(result, outcome);
    }
  }

  return result;
}

type InspectionOutcome = 'CLEAN' | 'INFECTED' | 'FAILED';

function countOutcome(result: FileScanResult, outcome: InspectionOutcome): void {
  result.scanned += 1;
  if (outcome === 'CLEAN') result.clean += 1;
  if (outcome === 'INFECTED') result.infected += 1;
  if (outcome === 'FAILED') result.failed += 1;
}

/**
 * Inspeciona UM arquivo e grava o veredito.
 *
 * A gravação é condicional (`scanStatus: 'PENDING'`): se outra passada já decidiu
 * este arquivo, nada é sobrescrito — a mesma disciplina de concorrência do resto do
 * projeto (invariante nº 5).
 */
async function inspect(
  tenantId: string,
  input: {
    bucket: string;
    objectKey: string;
    entity: 'SubmissionFile' | 'SpeakerMaterial';
    entityId: string;
    label: string;
  },
): Promise<InspectionOutcome> {
  const scan = await scanStoredObject({ bucket: input.bucket, objectKey: input.objectKey });

  if (!scan.ok) {
    await withTenant(tenantId, (tx) =>
      updateScanned(tx, input, 'PENDING', `Inspeção indisponível: ${scan.message}`.slice(0, 300)),
    );

    console.error(`[scan] ${input.entity} ${input.entityId}: ${scan.message}`);

    return 'FAILED';
  }

  const message =
    scan.status === 'INFECTED'
      ? `Ameaça detectada: ${scan.signature ?? 'assinatura desconhecida'}`.slice(0, 300)
      : null;

  await withTenant(tenantId, async (tx) => {
    await updateScanned(tx, input, scan.status, message);

    /**
     * A ameaça entra na TRILHA com o arquivo e o que foi encontrado: é o fato que a
     * instituição precisa poder conferir depois ("o que aconteceu com o arquivo do
     * protocolo X?"). Arquivo limpo não gera linha — auditoria de rotina vira ruído.
     */
    if (scan.status === 'INFECTED') {
      await recordAudit(
        {
          tenantId,
          userId: null,
          action: 'UPDATE',
          entityType: input.entity,
          entityId: input.entityId,
          changes: {
            inspecao: { from: 'PENDING', to: 'INFECTED' },
            ameaca: { from: null, to: scan.signature ?? 'desconhecida' },
            referencia: { from: null, to: input.label },
          },
        },
        tx,
      );
    }
  });

  return scan.status === 'CLEAN' ? 'CLEAN' : 'INFECTED';
}

type TxClientLike = Parameters<Parameters<typeof withTenant>[1]>[0];

async function updateScanned(
  tx: TxClientLike,
  input: { entity: 'SubmissionFile' | 'SpeakerMaterial'; entityId: string },
  status: 'CLEAN' | 'INFECTED' | 'PENDING',
  message: string | null,
): Promise<void> {
  const data = { scanStatus: status, scannedAt: new Date(), scanMessage: message };

  if (input.entity === 'SubmissionFile') {
    await tx.submissionFile.updateMany({
      where: { id: input.entityId, scanStatus: 'PENDING' },
      data,
    });
    return;
  }

  await tx.speakerMaterial.updateMany({
    where: { id: input.entityId, scanStatus: 'PENDING' },
    data,
  });
}

/** Erro de varredura não derruba o worker: vira resultado com o motivo registrado. */
export async function runFileScanSafely(input: { limit?: number } = {}): Promise<FileScanResult> {
  try {
    return await runFileScan(input);
  } catch (error) {
    console.error(`[scan] falha na varredura de arquivos: ${errorMessage(error)}`);

    return { tenants: 0, scanned: 0, clean: 0, infected: 0, failed: 0 };
  }
}
