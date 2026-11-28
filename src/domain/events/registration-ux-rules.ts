/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — UX de Formulário de Inscrição & Minhas Inscrições (FASE 136)
 *
 *  Regras puras (sem Prisma nem Next) para a Onda 2:
 *    1. Presets rápidos de perguntas seguras em 1 clique (`REGISTRATION_FIELD_PRESETS`);
 *    2. Visibilidade progressiva dos controles por tipo (`fieldControlsForType`);
 *    3. Resumo e tom semântico de status em `/minhas-inscricoes`
 *       (`summarizeMyRegistrations`, `registrationStatusTone`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  formFieldRequiresPurpose,
  type FormFieldType,
} from '@/domain/events/registration-form-spec-rules';

export interface RegistrationFieldPreset {
  readonly id: string;
  readonly buttonLabel: string;
  readonly label: string;
  readonly type: FormFieldType;
  readonly help: string;
  readonly options?: readonly string[];
  readonly purpose?: string;
}

export const REGISTRATION_FIELD_PRESETS: readonly RegistrationFieldPreset[] = [
  {
    id: 'instituicao',
    buttonLabel: 'Instituição / Afiliação',
    label: 'Instituição ou organização',
    type: 'SHORT_TEXT',
    help: 'Universidade, escola, empresa ou coletivo ao qual você pertence.',
  },
  {
    id: 'area-curso',
    buttonLabel: 'Curso ou área',
    label: 'Curso ou área de atuação',
    type: 'SHORT_TEXT',
    help: 'Ex.: Ciência da Computação, Pedagogia, Gestão Pública.',
  },
  {
    id: 'camiseta',
    buttonLabel: 'Tamanho da camiseta',
    label: 'Tamanho da camiseta',
    type: 'SINGLE_CHOICE',
    help: 'Usado apenas para planejar o kit do evento.',
    options: ['PP', 'P', 'M', 'G', 'GG', 'XG'],
  },
  {
    id: 'restricao-alimentar',
    buttonLabel: 'Restrição alimentar',
    label: 'Restrição alimentar',
    type: 'SHORT_TEXT',
    help: 'Opcional — apenas para apoio na organização dos intervalos.',
  },
  {
    id: 'como-soube',
    buttonLabel: 'Como soube do evento',
    label: 'Como você soube deste evento?',
    type: 'SINGLE_CHOICE',
    help: 'Ajuda a organização a divulgar melhor as próximas edições.',
    options: [
      'Redes sociais',
      'E-mail institucional',
      'Indicação de colega ou docente',
      'Site da instituição',
      'Outro',
    ],
  },
];

export interface FieldControlsVisibility {
  readonly showMaxLength: boolean;
  readonly showMinMax: boolean;
  readonly showOptions: boolean;
  readonly requiresPurpose: boolean;
}

export function fieldControlsForType(type: FormFieldType): FieldControlsVisibility {
  return {
    showMaxLength: type === 'SHORT_TEXT' || type === 'LONG_TEXT',
    showMinMax: type === 'NUMBER',
    showOptions: type === 'SINGLE_CHOICE',
    requiresPurpose: formFieldRequiresPurpose(type),
  };
}

export type RegistrationStatusTone = 'success' | 'warning' | 'info' | 'neutral';

export function registrationStatusTone(status: string): RegistrationStatusTone {
  switch (status) {
    case 'CONFIRMED':
    case 'ATTENDED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'WAITLISTED':
      return 'info';
    default:
      return 'neutral';
  }
}

export interface MyRegistrationsSummary {
  readonly total: number;
  readonly confirmed: number;
  readonly pendingConfirmation: number;
  readonly waitlisted: number;
  readonly attended: number;
}

export function summarizeMyRegistrations(
  items: readonly { status: string }[],
): MyRegistrationsSummary {
  let confirmed = 0;
  let pendingConfirmation = 0;
  let waitlisted = 0;
  let attended = 0;

  for (const item of items) {
    if (item.status === 'CONFIRMED') confirmed += 1;
    else if (item.status === 'PENDING') pendingConfirmation += 1;
    else if (item.status === 'WAITLISTED') waitlisted += 1;
    else if (item.status === 'ATTENDED') attended += 1;
  }

  return {
    total: items.length,
    confirmed,
    pendingConfirmation,
    waitlisted,
    attended,
  };
}
