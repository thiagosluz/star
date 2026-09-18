import { Download, FileText, Link2, Lock, LogIn } from 'lucide-react';

import {
  MATERIAL_KIND_LABELS,
  type MaterialKind,
} from '@/domain/speakers/speaker-rules';
import { formatBytes } from '@/domain/events/image-rules';
import type { MaterialRow } from '@/lib/speakers/material-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MATERIAIS DE APOIO NA PÁGINA DA ATIVIDADE (FASE 25, item E20)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O DOWNLOAD NÃO É UM LINK DIRETO PARA O STORAGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bucket de materiais é PRIVADO: um `href` para o objeto exigiria bucket público
 *  (e aí o PDF de aula estaria acessível a quem descobrisse a chave) ou uma URL
 *  assinada embutida no HTML (que vaza no cache, no log e no Ctrl+C do visitante).
 *
 *  O link aponta para a rota da própria aplicação, que decide o acesso NA HORA e
 *  redireciona para uma URL assinada de poucos minutos. É o mesmo desenho do
 *  certificado — e é o único ponto do sistema onde "403 Forbidden" é literal.
 *
 *  O rótulo do material de inscritos continua VISÍVEL para o visitante anônimo, com o
 *  cadeado: esconder que existe material exclusivo tiraria dele a única pista de que
 *  vale a pena se inscrever.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ActivityMaterials({
  materials,
  activityTitle,
  tenantSlug,
  isAuthenticated,
  lockedCount = 0,
}: {
  materials: readonly MaterialRow[];
  activityTitle: string;
  tenantSlug: string;
  isAuthenticated: boolean;
  /** Materiais de inscritos que este visitante ainda não pode baixar. */
  lockedCount?: number;
}) {
  if (materials.length === 0 && lockedCount === 0) return null;

  return (
    <section aria-labelledby="materiais" className="space-y-3">
      <h2 id="materiais" className="text-lg font-semibold tracking-tight">
        Materiais de apoio
      </h2>
      <p className="text-xs opacity-70">
        Enviados por quem ministra <span className="font-medium">{activityTitle}</span>.
      </p>

      {materials.length > 0 ? (
        <ul className="space-y-2" data-testid="activity-materials">
          {materials.map((material) => (
            <li
              key={material.id}
              className="ef-card flex items-start gap-3 p-4"
              data-testid={`material-row-${material.id}`}
            >
              {material.isFile ? (
                <FileText className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
              ) : (
                <Link2 className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
              )}

              <div className="min-w-0 flex-1">
                <p className="font-medium">{material.title}</p>
                <p className="text-xs opacity-70">
                  {MATERIAL_KIND_LABELS[material.kind as MaterialKind] ?? material.kind}
                  {material.fileName ? ` · ${material.fileName}` : ''}
                  {material.sizeBytes ? ` · ${formatBytes(material.sizeBytes)}` : ''}
                  {material.visibility === 'ATTENDEES_ONLY' ? ' · exclusivo de inscritos' : ''}
                </p>
                {material.description ? (
                  <p className="mt-1 text-sm opacity-80">{material.description}</p>
                ) : null}
              </div>

              <a
                href={
                  material.externalUrl ??
                  `/api/t/${tenantSlug}/palestrantes/materiais/${material.id}/arquivo`
                }
                {...(material.externalUrl
                  ? { target: '_blank', rel: 'noopener noreferrer nofollow' }
                  : {})}
                data-testid={`material-${material.id}`}
                className="ef-button-outline shrink-0"
              >
                {material.externalUrl ? (
                  <Link2 className="size-3.5" aria-hidden />
                ) : (
                  <Download className="size-3.5" aria-hidden />
                )}
                {material.externalUrl ? 'Abrir' : 'Baixar'}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {lockedCount > 0 ? (
        <div
          className="ef-card flex items-start gap-3 p-4 text-sm"
          data-testid="activity-materials-locked"
        >
          <Lock className="mt-0.5 size-4 shrink-0 opacity-60" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">
              {lockedCount === 1
                ? '1 material exclusivo para inscritos'
                : `${lockedCount} materiais exclusivos para inscritos`}
            </p>
            <p className="opacity-75">
              {isAuthenticated
                ? 'Sua inscrição nesta atividade precisa estar confirmada para liberar o download.'
                : 'Entre na plataforma e garanta sua vaga para acessar o conteúdo completo.'}
            </p>
            {!isAuthenticated ? (
              <p className="flex items-center gap-1.5 text-xs opacity-70">
                <LogIn className="size-3" aria-hidden />
                A inscrição é feita nesta mesma página.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
