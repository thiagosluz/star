import { RARITY_LABELS, resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import { CARD_RARITIES, CARD_TRIGGERS, type CardTrigger } from '@/domain/gamification/types';
import type { AdminCardRow } from '@/lib/admin/gamification-admin-service';
import { CheckboxField, Field, SelectField } from '@/components/admin/admin-form';

export const RARITY_OPTIONS = CARD_RARITIES.map((rarity) => ({
  value: rarity,
  label: RARITY_LABELS[rarity],
}));

/**
 * Rótulo CURTO do gatilho — o nome que cabe no seletor e no catálogo.
 *
 * Diferente de `CARD_TRIGGER_LABELS` (a frase que a PESSOA lê ao ganhar a carta,
 * em "Você submeteu um trabalho"): aqui é etiqueta de administração.
 *
 * O tipo é `Record<CardTrigger, string>`, e não `Record<string, string>`, de
 * propósito: foi assim que `SPONSOR_QR` apareceu CRU no seletor quando a FASE 42
 * acrescentou o gatilho — o mapa antigo aceitava qualquer chave e caía no `?? trigger`.
 * Com o tipo fechado, um gatilho novo sem rótulo não compila.
 */
export const TRIGGER_LABELS: Readonly<Record<CardTrigger, string>> = {
  CHECKIN: 'Credenciamento',
  ACTIVITY_COMPLETION: 'Presença em atividade',
  MINI_COURSE_COMPLETION: 'Conclusão de minicurso',
  SUBMISSION_SUBMITTED: 'Trabalho submetido',
  SUBMISSION_ACCEPTED: 'Trabalho aceito',
  REVIEW_COMPLETED: 'Parecer concluído',
  REVIEWER_TOP: 'Melhor revisor (manual)',
  XP_THRESHOLD: 'Limiar de XP',
  LEVEL_UP: 'Subida de nível',
  MANUAL_GRANT: 'Concessão manual',
  STREAK: 'Ofensiva (dias seguidos)',
  EVENT_ATTENDANCE_FULL: 'Presença em todo o evento',
  SPONSOR_QR: 'Visita a patrocinador',
  REGISTRATION_CONFIRMED: 'Inscrição confirmada',
  CERTIFICATE_ISSUED: 'Certificado emitido',
  RAFFLE_WON: 'Sorteio ganho',
};

export const TRIGGER_OPTIONS = CARD_TRIGGERS.map((trigger) => ({
  value: trigger,
  label: TRIGGER_LABELS[trigger] ?? trigger,
}));

/**
 * Os campos da carta, em UM lugar só (FASE 43 · FASE 95).
 *
 * O mesmo componente serve para CRIAR e para EDITAR. Duplicar os campos era a
 * alternativa óbvia, e a errada: no dia em que um campo novo entrar, o formulário de
 * edição esquecido passa a APAGAR o que não mostra (o serviço grava o que recebe), e
 * o defeito só aparece na carta de alguém.
 */
export function CardFormFields({
  triggerOptions = TRIGGER_OPTIONS,
  eventOptions,
  card,
  structured = false,
}: {
  triggerOptions?: { value: string; label: string }[];
  eventOptions: { value: string; label: string }[];
  card?: AdminCardRow;
  structured?: boolean;
}) {
  const palette = card ? resolvePalette(card.palette, card.rarity) : null;
  const art = card ? resolveArt(card.art) : null;
  const condition = (card?.triggerCondition ?? {}) as Record<string, unknown>;
  const conditionNumber = (key: string) =>
    typeof condition[key] === 'number' ? (condition[key] as number) : undefined;

  return (
    <div className="space-y-6">
      {/* ── IDENTIFICAÇÃO & NARRATIVA ── */}
      <div className="space-y-4">
        {structured && (
          <div className="border-b border-border pb-2">
            <h3 className="text-sm font-semibold text-foreground">Identificação e narrativa</h3>
            <p className="text-xs text-muted-foreground">
              Nome, identificador único (slug) e contexto histórico (lore) que acompanham a carta.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Identificador"
            name="slug"
            required
            placeholder="guardiao-do-metodo"
            defaultValue={card?.slug}
            hint={card ? 'Muda o identificador da carta já concedida — combine antes com a equipe.' : undefined}
          />
          <Field label="Nome" name="name" required placeholder="Guardião do Método" defaultValue={card?.name} />
          <Field
            label="Descrição"
            name="description"
            placeholder="Concedida por concluir um parecer"
            defaultValue={card?.description ?? undefined}
          />
          <Field
            label="História (lore)"
            name="lore"
            placeholder="O trabalho invisível que sustenta a ciência"
            defaultValue={card?.lore ?? undefined}
          />
        </div>
      </div>

      {/* ── REGRAS & ECONOMIA ── */}
      <div className="space-y-4">
        {structured && (
          <div className="border-b border-border pb-2">
            <h3 className="text-sm font-semibold text-foreground">Regras e economia</h3>
            <p className="text-xs text-muted-foreground">
              Raridade, gatilho de conquista, evento vinculado e limites de circulação.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Raridade"
            name="rarity"
            options={RARITY_OPTIONS}
            defaultValue={card?.rarity ?? 'COMMON'}
          />
          <SelectField
            label="Gatilho"
            name="trigger"
            options={triggerOptions}
            defaultValue={card?.trigger ?? 'CHECKIN'}
          />
          <SelectField label="Evento" name="eventId" options={eventOptions} defaultValue={card?.eventId ?? ''} />
          <Field
            label="Nível mínimo"
            name="levelRequired"
            type="number"
            min={1}
            defaultValue={card?.levelRequired ?? 1}
          />
          <Field
            label="Peso no sorteio"
            name="dropWeight"
            type="number"
            min={1}
            defaultValue={card?.dropWeight ?? 100}
            hint="Maior = mais comum"
          />
          <Field
            label="Tiragem (0 = ilimitada)"
            name="maxSupply"
            type="number"
            min={0}
            defaultValue={card?.maxSupply ?? 0}
          />
        </div>
      </div>

      {/* ── ARTE E APRESENTAÇÃO HOLOGRÁFICA 3D ── */}
      <div className="space-y-4">
        {structured && (
          <div className="border-b border-border pb-2">
            <h3 className="text-sm font-semibold text-foreground">Arte e apresentação holográfica 3D</h3>
            <p className="text-xs text-muted-foreground">
              Paleta cromática (hex ou oklch), ilustrações, efeitos visuais e reflexos no palco.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Cor primária" name="palettePrimary" placeholder="#7c3aed" defaultValue={palette?.primary} />
          <Field
            label="Cor secundária"
            name="paletteSecondary"
            placeholder="#3b0764"
            defaultValue={palette?.secondary}
          />
          <Field label="Cor de brilho" name="paletteGlow" placeholder="#c084fc" defaultValue={palette?.glow} />
          <Field label="Cor do texto" name="paletteText" placeholder="#faf5ff" defaultValue={palette?.text} />
          <Field
            label="URL da arte"
            name="artImageUrl"
            placeholder="https://..."
            defaultValue={art?.imageUrl ?? undefined}
          />
          <SelectField
            label="Animação"
            name="artAnimation"
            options={[
              { value: 'none', label: 'Nenhuma' },
              { value: 'shimmer', label: 'Brilho' },
              { value: 'float', label: 'Flutuar' },
              { value: 'pulse', label: 'Pulsar' },
            ]}
            defaultValue={art?.animation ?? 'none'}
          />
          <SelectField
            label="Partículas"
            name="artParticle"
            options={[
              { value: 'none', label: 'Nenhuma' },
              { value: 'sparkle', label: 'Faíscas' },
              { value: 'dust', label: 'Poeira' },
              { value: 'orbit', label: 'Órbita' },
            ]}
            defaultValue={art?.particle ?? 'none'}
          />
          <Field
            label="Brilho holográfico (0–100)"
            name="artSheen"
            type="number"
            min={0}
            max={100}
            defaultValue={art?.sheen}
            hint="Fora de 0–100 é descartado e vale o padrão"
          />
          <Field
            label="Inclinação 3D (0–100)"
            name="artTilt"
            type="number"
            min={0}
            max={100}
            defaultValue={art?.tilt}
            hint="0 deixa a carta parada no palco"
          />
          <Field
            label="URL da arte do verso"
            name="artBackUrl"
            placeholder="https://..."
            defaultValue={art?.backUrl ?? undefined}
            hint="Sem ela, o verso mostra a ficha da conquista"
          />
        </div>

        <div className="pt-1">
          <CheckboxField
            label="Brilho holográfico ligado"
            name="artHolo"
            hint="Realce premium que segue o ponteiro no álbum e no palco. A variante foil acende sozinha."
            defaultChecked={art?.holo ?? false}
          />
        </div>
      </div>

      {/* ── CONDIÇÕES ESPECÍFICAS & VISIBILIDADE ── */}
      <div className="space-y-4">
        {structured && (
          <div className="border-b border-border pb-2">
            <h3 className="text-sm font-semibold text-foreground">Condições específicas e visibilidade</h3>
            <p className="text-xs text-muted-foreground">
              Parâmetros opcionais para gatilhos de pontuação, ofensiva e status da carta na coleção.
            </p>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Limiar de XP"
            name="conditionThreshold"
            type="number"
            min={0}
            defaultValue={conditionNumber('threshold')}
            hint="Só para gatilho de limiar"
          />
          <Field
            label="Dias de ofensiva"
            name="conditionStreak"
            type="number"
            min={2}
            defaultValue={conditionNumber('streak')}
            hint="Só para gatilho de ofensiva"
          />
          <Field
            label="Nível do gatilho"
            name="conditionLevel"
            type="number"
            min={2}
            defaultValue={conditionNumber('level')}
            hint="Só para subida de nível"
          />
        </div>

        <div className="flex flex-wrap gap-6 pt-2">
          <CheckboxField label="Carta ativa" name="isActive" defaultChecked={card?.isActive ?? true} />
          <CheckboxField
            label="Carta secreta"
            hint="Some do álbum até ser conquistada"
            name="isSecret"
            defaultChecked={card?.isSecret ?? false}
          />
        </div>
      </div>
    </div>
  );
}

