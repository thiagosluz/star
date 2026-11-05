import Link from 'next/link';
import { AlertTriangle, FileBadge, PencilRuler } from 'lucide-react';

import {
  CERTIFICATE_KIND_LABELS,
  type CertificateKind,
} from '@/domain/certificates/certificate-rules';
import type { EventTemplateKindInfo } from '@/lib/certificates/certificate-template-service';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  "MODELO DESTE EVENTO" — A PONTE ENTRE O DESENHO E A EMISSÃO (FASE 86 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA SEÇÃO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A emissão sempre resolveu o modelo pela precedência, mas a tela não dizia QUAL
 *  desenho ia sair: o organizador descobria olhando o PDF. Pior, quando o modelo
 *  escolhido tinha layout ilegível, `resolveTemplateWithTx` devolvia `null` e a
 *  emissão caía no desenho padrão EM SILÊNCIO — indistinguível de "não há modelo".
 *
 *  A lista é a LEITURA da mesma decisão do domínio (`selectEffectiveTemplate`), uma
 *  linha por tipo que o lote oferece. Ela não decide nada: só torna visível o que a
 *  emissão vai fazer — e, no caso `INVALID`, avisa que o padrão está no lugar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LINK É DA PERMISSÃO, NÃO DA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `certificate:issue` (a guarda desta página) NÃO implica `event:manage` — o CHAIR
 *  emite e não desenha. O link para os modelos só aparece para quem `can()` de fato
 *  abriria a página de modelos; para os demais, a seção diz a quem pedir, em vez de
 *  oferecer um clique que terminaria em redirecionamento (o defeito da F72).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function EventTemplateSummary({
  resolutions,
  modelsHref,
  canManage,
}: {
  resolutions: readonly EventTemplateKindInfo[];
  modelsHref: string;
  canManage: boolean;
}) {
  return (
    <section
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      aria-labelledby="modelo-do-evento"
      data-testid="event-template-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="modelo-do-evento" className="flex items-center gap-2 font-semibold">
            <FileBadge className="size-4 text-brand" aria-hidden /> Modelo deste evento
          </h2>
          <p className="text-sm text-muted-foreground">
            O modelo mais específico vence: evento + tipo, evento, instituição + tipo, instituição. Sem nenhum
            deles, o certificado sai no desenho padrão do sistema.
          </p>
        </div>

        {canManage ? (
          <Link
            href={modelsHref}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            data-testid="event-models-link"
          >
            <PencilRuler className="size-3.5" aria-hidden />
            Editar os modelos deste evento
          </Link>
        ) : null}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2" data-testid="event-template-list">
        {resolutions.map((resolution) => (
          <li
            key={resolution.kind}
            className="rounded-md border border-border p-3 text-sm"
            data-testid={`event-template-${resolution.kind}`}
            data-state={resolution.state}
          >
            <p className="font-medium">{CERTIFICATE_KIND_LABELS[resolution.kind as CertificateKind]}</p>

            {resolution.state === 'TEMPLATE' ? (
              <p className="text-xs text-muted-foreground" data-testid={`event-template-name-${resolution.kind}`}>
                {resolution.templateName} —{' '}
                {resolution.target === 'EVENT' ? 'modelo do evento' : 'modelo padrão da instituição'}
              </p>
            ) : null}

            {resolution.state === 'DEFAULT' ? (
              <p className="text-xs text-muted-foreground" data-testid={`event-template-name-${resolution.kind}`}>
                Desenho padrão do sistema — nenhum modelo configurado.
              </p>
            ) : null}

            {resolution.state === 'INVALID' ? (
              <p
                role="alert"
                className="mt-1 flex items-start gap-1.5 rounded-sm border border-warning bg-warning-soft p-2 text-xs text-warning-strong"
                data-testid={`event-template-invalid-${resolution.kind}`}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Modelo inválido (“{resolution.templateName}”, layout ilegível) → usando o desenho padrão.
                  {' '}
                  {canManage ? (
                    <Link href={modelsHref} className="font-medium underline underline-offset-2">
                      Corrija o modelo.
                    </Link>
                  ) : (
                    'Peça a quem administra a instituição para corrigir o modelo.'
                  )}
                </span>
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {!canManage ? (
        <p className="text-xs text-muted-foreground">
          Esta tela emite, mas não desenha: os modelos são editados por quem administra a instituição.
        </p>
      ) : null}
    </section>
  );
}
