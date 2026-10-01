/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TRILHAS DO EVENTO — O EIXO TEMÁTICO E A SUA RUBRICA (FASE 53)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU COMPONENTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Esta seção nasceu dentro da tela de gerenciar evento (FASE 39) e lá ficou até a
 *  FASE 53, quando o organizador apontou o óbvio: as TRILHAS e as CHAMADAS são o
 *  mesmo assunto em duas telas — a trilha é o eixo que a chamada usa para
 *  classificar a submissão. Quem quer criar uma trilha tinha de adivinhar que ela
 *  morava na tela do evento.
 *
 *  A extração para componente é o PASSO 1 da unificação, de propósito: mover 148
 *  linhas de JSX por corte de linha quebrou as duas páginas de uma vez (a fronteira
 *  do bloco encosta no `<details>` do reconhecimento do comitê). Extrair para um
 *  ARQUIVO não tem fronteira frágil — e o uso em cada tela passa a ser uma linha,
 *  trocada e verificada por vez.
 *
 *  O componente não conhece a página nem busca dado: recebe as trilhas e as
 *  contagens de parecer prontas (quem lê é a tela), e usa a MESMA action de sempre.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { FileText } from 'lucide-react';

import { saveTrackAction } from '@/app/actions/admin-actions';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { AdminForm, CheckboxField, Field } from '@/components/admin/admin-form';
import { RubricEditor } from '@/components/admin/rubric-editor';

export interface TrackSectionProps {
  tenantSlug: string;
  eventId: string;
  /** As trilhas do evento, como a tela as carregou. */
  tracks: NonNullable<Awaited<ReturnType<typeof getAdminEvent>>>['tracks'];
  /**
   * Quantos pareceres cada trilha já recebeu (`byTrack`), por id de trilha — é o que
   * decide se a rubrica está CONGELADA (FASE 39): com parecer, chave, peso e nota
   * máxima não mudam mais; rótulo, descrição e ordem seguem livres.
   */
  reviewCounts: Record<string, number>;
}

export function TrackSection({ tenantSlug, eventId, tracks, reviewCounts }: TrackSectionProps) {
  return (
    <details className="rounded-xl border border-border bg-card p-5" data-testid="tracks-section">
    <summary className="cursor-pointer text-base font-semibold">
    <FileText className="mr-2 inline size-4" aria-hidden />
    Chamada de trabalhos ({tracks.length})
    </summary>

    <div className="space-y-4 pt-4">
    {tracks.length > 0 ? (
    <ul className="divide-y divide-border rounded-lg border border-border" data-testid="track-list">
    {tracks.map((track) => (
    <li key={track.id} className="space-y-2 p-3 text-sm">
    <p className="font-medium">{track.name}</p>
    <p className="text-xs text-muted-foreground">
    {track.requiredReviews} parecer(es) · aceite ≥ {track.acceptanceThreshold} · rejeição &lt;{' '}
    {track.rejectThreshold} · {track.submissionCount} submissão(ões) ·{' '}
    {track.isActive ? 'ativa' : 'inativa'} ·{' '}
    {track.reviewRubric.length > 0
    ? `rubrica própria com ${track.reviewRubric.length} critério(s)`
    : 'usa a rubrica padrão'}
    </p>

    {/**
    * ─────────────────────────────────────────────────────────────
    *  A TRILHA PASSOU A SER EDITÁVEL (FASE 39)
    * ─────────────────────────────────────────────────────────────
    *  Ela nascia e não mudava mais: uma trilha com rubrica errada só se
    *  consertava criando outra. O formulário é o mesmo da criação, com
    *  os valores carregados e o `trackId` oculto — e a rubrica vem do
    *  `RubricEditor`, que mostra a FORMA congelada quando já existe
    *  parecer (com a contagem) em vez de campos que o servidor recusaria.
    */}
    <details className="rounded-lg border border-border p-2" data-testid={`track-edit-${track.id}`}>
    <summary className="cursor-pointer text-xs font-medium">Editar trilha</summary>

    <AdminForm
    action={saveTrackAction}
    submitLabel="Salvar trilha"
    testId={`edit-track-${track.id}`}
    compact
    >
    <input type="hidden" name="tenantSlug" value={tenantSlug} />
    <input type="hidden" name="eventId" value={eventId} />
    <input type="hidden" name="trackId" value={track.id} />

    <div className="grid gap-3 sm:grid-cols-2">
    <Field
    label="Identificador"
    name="slug"
    required
    defaultValue={track.slug}
    hint="Mudar o identificador muda o endereço público da trilha."
    />
    <Field label="Nome" name="name" required defaultValue={track.name} />
    <Field label="Cor" name="color" defaultValue={track.color} hint="Hexadecimal ou oklch()" />
    <Field
    label="Limite por autor (0 = ilimitado)"
    name="maxSubmissionsPerAuthor"
    type="number"
    min={0}
    defaultValue={track.maxSubmissionsPerAuthor}
    />
    <Field
    label="Pareceres exigidos"
    name="requiredReviews"
    type="number"
    min={1}
    defaultValue={track.requiredReviews}
    />
    <Field
    label="Nota de aceite"
    name="acceptanceThreshold"
    type="number"
    min={0}
    max={100}
    defaultValue={track.acceptanceThreshold}
    />
    <Field
    label="Nota de rejeição"
    name="rejectThreshold"
    type="number"
    min={0}
    max={100}
    defaultValue={track.rejectThreshold}
    />
    </div>

    <div className="flex flex-wrap gap-4">
    <CheckboxField
    label="Exigir revisão cega"
    name="requiresBlindReview"
    defaultChecked={track.requiresBlindReview}
    />
    <CheckboxField label="Trilha ativa" name="isActive" defaultChecked={track.isActive} />
    </div>

    <RubricEditor
    criteria={track.reviewRubric}
    scope="TRACK"
    scopeLabel={track.name}
    frozen={{ reviews: reviewCounts[track.id] ?? 0 }}
    testId={`track-rubric-${track.id}`}
    />
    </AdminForm>
    </details>
    </li>
    ))}
    </ul>
    ) : (
    <p className="text-sm text-muted-foreground">Nenhuma trilha criada.</p>
    )}

    <AdminForm action={saveTrackAction} submitLabel="Criar trilha" testId="create-track" compact>
    <input type="hidden" name="tenantSlug" value={tenantSlug} />
    <input type="hidden" name="eventId" value={eventId} />

    <div className="grid gap-3 sm:grid-cols-2">
    <Field label="Identificador" name="slug" required placeholder="tecnologia-educacional" />
    <Field label="Nome" name="name" required placeholder="Trilha de Tecnologia Educacional" />
    <Field label="Cor" name="color" placeholder="#1d4ed8" hint="Hexadecimal ou oklch()" />
    <Field label="Limite por autor (0 = ilimitado)" name="maxSubmissionsPerAuthor" type="number" min={0} defaultValue={3} />
    <Field label="Pareceres exigidos" name="requiredReviews" type="number" min={1} defaultValue={2} />
    <Field label="Nota de aceite" name="acceptanceThreshold" type="number" min={0} max={100} defaultValue={70} />
    <Field label="Nota de rejeição" name="rejectThreshold" type="number" min={0} max={100} defaultValue={45} />
    </div>

    <div className="flex flex-wrap gap-4">
    <CheckboxField label="Exigir revisão cega" name="requiresBlindReview" defaultChecked />
    <CheckboxField label="Trilha ativa" name="isActive" defaultChecked />
    </div>

    {/**
    * O número de critérios é escolha do organizador (FASE 39). O editor é o
    * MESMO da chamada de propostas: chave derivada do rótulo, teto de 12,
    * acrescentar/remover com JavaScript e as linhas do teto disponíveis para
    * quem está sem JavaScript.
    */}
    <RubricEditor
    criteria={[]}
    scope="TRACK"
    scopeLabel="Nova trilha"
    testId="track-rubric"
    />
    </AdminForm>
    </div>
    </details>
  );
}
