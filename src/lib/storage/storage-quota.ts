/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  QUOTA DE ARMAZENAMENTO — medir o que a instituição ocupa e recusar o que não cabe
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE CONTA (decisão de produto da FASE 21)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TUDO o que a plataforma guarda para a instituição, em quatro fontes:
 *
 *    • `submission_files`  — os PDFs enviados por autores (cega e identificada);
 *    • `media_assets`      — o acervo de mídia (capas, logotipos, galeria);
 *    • `speaker_materials` — os materiais de apoio dos palestrantes;
 *    • `certificates`      — os PDF/SVG emitidos (ficam no bucket do evento).
 *
 *  Medir só o que a instituição ENVIOU deixaria o número abaixo do real — e o teto
 *  do plano é sobre bytes guardados, não sobre bytes escolhidos. Os certificados
 *  ENTRAM na conta e NÃO são bloqueados por ela: o documento do participante não
 *  pode ficar refém da decisão de armazenamento da organização (ver
 *  `evaluateStorageQuota` e a dívida declarada no doc da fase).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A VERIFICAÇÃO ACONTECE ANTES DE ASSINAR A URL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `requestUpload` → `ensureStorageRoom` → `createUploadUrl`. Recusar DEPOIS do
 *  upload deixaria o objeto no bucket (pago, órfão e sem registro) e transformaria a
 *  recusa em lixo. Como o tamanho já é declarado pelo cliente para a assinatura
 *  (`ContentLength`), dá para decidir antes — e a recusa sai barata.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { evaluateQuotaUsage, evaluateStorageQuota, type QuotaUsage } from '@/domain/platform/platform-rules';

export interface StorageBreakdown {
  submissionBytes: number;
  mediaBytes: number;
  speakerMaterialBytes: number;
  certificateBytes: number;
}

export interface StorageUsage extends StorageBreakdown {
  /** Soma das quatro fontes. */
  totalBytes: number;
  maxBytes: number | null;
  usage: QuotaUsage;
}

/**
 * Uso de armazenamento da instituição, por origem.
 *
 * Uma leitura por fonte (quatro agregações) em vez de uma consulta por arquivo: o
 * número sai do banco, não de uma varredura do bucket — o objeto pode existir sem
 * registro apenas em caso de falha no meio do caminho, e nesse caso o certo é
 * reconciliar (dívida declarada), não somar o que ninguém registrou.
 *
 * `deletedAt` é respeitado nas três tabelas que o têm: material excluído não ocupa
 * conta — ainda que o objeto possa continuar no bucket até a limpeza.
 */
export async function storageUsage(tenantId: string): Promise<StorageUsage> {
  return withTenant(tenantId, async (tx) => {
    const [submissions, media, materials, certificates, tenant] = await Promise.all([
      tx.submissionFile.aggregate({
        where: { tenantId },
        _sum: { sizeBytes: true },
      }),
      tx.mediaAsset.aggregate({
        where: { tenantId, deletedAt: null },
        _sum: { sizeBytes: true },
      }),
      tx.speakerMaterial.aggregate({
        where: { tenantId, deletedAt: null },
        _sum: { sizeBytes: true },
      }),
      tx.certificate.aggregate({
        where: { tenantId, storageKey: { not: null } },
        _sum: { sizeBytes: true },
      }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { maxStorageBytes: true } }),
    ]);

    const submissionBytes = Number(submissions._sum.sizeBytes ?? 0);
    const mediaBytes = media._sum.sizeBytes ?? 0;
    const speakerMaterialBytes = materials._sum.sizeBytes ?? 0;
    const certificateBytes = Number(certificates._sum.sizeBytes ?? 0);

    const totalBytes = submissionBytes + mediaBytes + speakerMaterialBytes + certificateBytes;
    const maxBytes = tenant ? Number(tenant.maxStorageBytes) : null;

    return {
      submissionBytes,
      mediaBytes,
      speakerMaterialBytes,
      certificateBytes,
      totalBytes,
      maxBytes,
      usage: evaluateQuotaUsage(totalBytes, maxBytes),
    };
  });
}

export type StorageRoomResult =
  | { ok: true; usage: StorageUsage }
  | { ok: false; code: 'QUOTA_EXCEEDED'; message: string; usage: StorageUsage };

/**
 * Cabe mais este arquivo? Devolve o uso junto — a mensagem de recusa já foi montada
 * com os números, e a tela aproveita o mesmo cálculo para mostrar a barra.
 *
 * `replacingBytes` existe para o caso em que o envio SUBSTITUI um objeto pelo mesmo
 * caminho (a nova versão do PDF de uma submissão em rascunho, por exemplo): os bytes
 * que saem deixam de contar, e sem descontá-los a instituição seria recusada por um
 * arquivo que, na prática, não aumenta nada.
 */
export async function ensureStorageRoom(input: {
  tenantId: string;
  incomingBytes: number;
  replacingBytes?: number;
}): Promise<StorageRoomResult> {
  const usage = await storageUsage(input.tenantId);

  const decision = evaluateStorageQuota({
    currentBytes: Math.max(usage.totalBytes - (input.replacingBytes ?? 0), 0),
    incomingBytes: Math.max(input.incomingBytes, 0),
    maxBytes: usage.maxBytes,
  });

  if (!decision.allowed) {
    return {
      ok: false,
      code: 'QUOTA_EXCEEDED',
      message: decision.message ?? 'A quota de armazenamento desta instituição está esgotada.',
      usage,
    };
  }

  return { ok: true, usage };
}
