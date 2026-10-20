/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Taxonomia de Categorias e Temas de Evento (FASE 71 · ADR-351)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA TAXONOMIA PADRONIZADA NO DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Deixar categorias como texto livre do organizador produz fragmentação imediata:
 *  "Tecnologia", "TI", "Tech", "Informática" virariam filtros desconexos e a busca
 *  pública na vitrine perderia relevância.
 *
 *  A lista fixa de 10 categorias padronizadas cobre todo o espectro do SaaS:
 *  eventos acadêmicos, corporativos e comunitários. O formulário do organizador
 *  apenas seleciona e a vitrine unificada `/eventos` filtra com precisão.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type EventCategoryKey =
  | 'TECNOLOGIA'
  | 'CIENCIA_ACADEMICO'
  | 'SAUDE_BEM_ESTAR'
  | 'EDUCACAO'
  | 'NEGOCIOS_GESTAO'
  | 'ENGENHARIA_INDUSTRIA'
  | 'DIREITO_GOVERNANCA'
  | 'ARTE_CULTURA'
  | 'MEIO_AMBIENTE'
  | 'OUTROS';

export interface EventCategoryDefinition {
  readonly key: EventCategoryKey;
  readonly label: string;
  readonly description: string;
  readonly iconName: string;
}

export const EVENT_CATEGORIES: readonly EventCategoryDefinition[] = [
  {
    key: 'TECNOLOGIA',
    label: 'Tecnologia & Inovação',
    description: 'Software, Inteligência Artificial, Startups, Hardware',
    iconName: 'Cpu',
  },
  {
    key: 'CIENCIA_ACADEMICO',
    label: 'Ciência, Pesquisa & Academia',
    description: 'Congressos, Simpósios, Encontros Científicos, Trabalhos',
    iconName: 'GraduationCap',
  },
  {
    key: 'SAUDE_BEM_ESTAR',
    label: 'Saúde, Medicina & Bem-estar',
    description: 'Medicina, Enfermagem, Psicologia, Esporte',
    iconName: 'HeartPulse',
  },
  {
    key: 'EDUCACAO',
    label: 'Educação & Pedagogia',
    description: 'Formação de Professores, Práticas Pedagógicas, Escolas',
    iconName: 'BookOpen',
  },
  {
    key: 'NEGOCIOS_GESTAO',
    label: 'Negócios & Empreendedorismo',
    description: 'Finanças, Liderança, Marketing, Vendas',
    iconName: 'TrendingUp',
  },
  {
    key: 'ENGENHARIA_INDUSTRIA',
    label: 'Engenharia & Indústria',
    description: 'Civil, Elétrica, Mecânica, Produção, Manufatura',
    iconName: 'Wrench',
  },
  {
    key: 'DIREITO_GOVERNANCA',
    label: 'Direito & Governança',
    description: 'Jurídico, Políticas Públicas, Terceiro Setor, Compliance',
    iconName: 'Scale',
  },
  {
    key: 'ARTE_CULTURA',
    label: 'Artes, Design & Cultura',
    description: 'Cinema, Teatro, Design, Música, Literatura',
    iconName: 'Palette',
  },
  {
    key: 'MEIO_AMBIENTE',
    label: 'Sustentabilidade & Meio Ambiente',
    description: 'Ecologia, Agro, Transição Energética, ESG',
    iconName: 'Leaf',
  },
  {
    key: 'OUTROS',
    label: 'Outros temas',
    description: 'Eventos de variedades ou multidisciplinares',
    iconName: 'Sparkles',
  },
] as const;

export const EVENT_CATEGORY_OPTIONS = EVENT_CATEGORIES.map((cat) => ({
  value: cat.key,
  label: cat.label,
}));

const CATEGORY_MAP = new Map<string, EventCategoryDefinition>(
  EVENT_CATEGORIES.map((cat) => [cat.key, cat]),
);

/** Valida se uma string é uma chave válida da taxonomia. */
export function isEventCategory(value: unknown): value is EventCategoryKey {
  return typeof value === 'string' && CATEGORY_MAP.has(value);
}

/** Tenta extrair a chave de categoria ou retorna null se inválida. */
export function parseEventCategory(value: unknown): EventCategoryKey | null {
  if (isEventCategory(value)) {
    return value;
  }
  return null;
}

/** Retorna o rótulo amigável em português para exibição em badges e cabeçalhos. */
export function getEventCategoryLabel(key: string | null | undefined): string {
  if (!key) return 'Geral';
  const def = CATEGORY_MAP.get(key);
  return def ? def.label : key;
}

/** Retorna a definição completa da categoria ou null. */
export function getEventCategoryDefinition(
  key: string | null | undefined,
): EventCategoryDefinition | null {
  if (!key) return null;
  return CATEGORY_MAP.get(key) ?? null;
}
