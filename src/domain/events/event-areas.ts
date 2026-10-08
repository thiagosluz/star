/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — AS ÁREAS DE GESTÃO DO EVENTO (FASE 53)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO É DADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela de gerenciar evento tinha uma FAIXA DE LINKS escrita à mão, na ordem em
 *  que as fases criaram as telas. Dois sintomas: as entradas quase idênticas
 *  ("Ver página pública" abria o site, "Página pública" abria o EDITOR) e nenhuma
 *  pista do que cada tela faz — quem nunca usou "Reconhecimento do comitê
 *  científico" tinha de clicar para descobrir.
 *
 *  Aqui as áreas são uma lista única, agrupada pelo TRABALHO de quem organiza (a
 *  divisão que o humano aprovou), com o propósito em uma linha. O cartão da tela é
 *  desenhado a partir disto — e o teste prova, sem navegador, que nenhum endereço
 *  se repete, que todo propósito existe e que os atalhos que os E2E já usavam
 *  continuam existindo (`legacyTestId`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DIVISÃO EM QUATRO, E POR QUE ELA NÃO É ENFEITE
 *  ─────────────────────────────────────────────────────────────────────────────
 *    CONFIGURAR  o que o evento é
 *    VITRINE     o que o público vê
 *    OPERAR      o que está acontecendo agora (as filas de trabalho)
 *    RESULTADO   o que fica depois
 *
 *  A ordem antiga misturava fila de trabalho com configuração: quem entrava para
 *  "arrumar os dados do evento" via "Confirmações de vaga" como se fosse a mesma
 *  espécie de coisa — e as vagas retidas vencem sozinhas.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';

export type EventAreaGroup = 'CONFIGURAR' | 'VITRINE' | 'OPERAR' | 'RESULTADO';

export interface EventAreaGroupInfo {
  group: EventAreaGroup;
  label: string;
  /** O que este grupo responde, em uma linha. */
  hint: string;
}

export const EVENT_AREA_GROUPS: readonly EventAreaGroupInfo[] = [
  { group: 'CONFIGURAR', label: 'Configurar', hint: 'O que o evento é.' },
  { group: 'VITRINE', label: 'Vitrine', hint: 'O que o público vê.' },
  { group: 'OPERAR', label: 'Operar', hint: 'O que está acontecendo agora.' },
  { group: 'RESULTADO', label: 'Resultado', hint: 'O que fica depois.' },
];

export interface EventAreaContext {
  tenantSlug: string;
  eventId: string;
  eventSlug: string;
}

export interface EventArea {
  id: string;
  label: string;
  /** Uma linha dizendo o que se faz ali. */
  purpose: string;
  group: EventAreaGroup;
  href: (context: EventAreaContext) => string;
  /** A permissão que a TELA exige (medida no `page.tsx` dela), quando há. */
  permission?: string;
  /**
   * O `data-testid` que a FAIXA ANTIGA usava neste atalho. Os specs E2E de outras
   * fases navegam por ele — tirar o endereço antigo já quebrou nove cenários uma
   * vez, e não vai quebrar de novo.
   */
  legacyTestId?: string;
  /** Abre o RESULTADO público (outra aba); não é tela de administração. */
  publicView?: boolean;
}

function route(context: EventAreaContext, suffix: string): string {
  return tenantPath(context.tenantSlug, `/administracao/eventos/${context.eventId}${suffix}`);
}

export const EVENT_AREAS: readonly EventArea[] = [
  {
    id: 'dados',
    label: 'Dados do evento',
    purpose: 'Nome, datas, local, modalidade, capacidade e os prazos de inscrição.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/dados'),
    permission: PERMISSIONS.EVENT_UPDATE,
  },
  {
    /**
     * ─── O FORMULÁRIO QUE O ORGANIZADOR MONTA (FASE 70 · fatia 3) ─────────────
     *
     *  A área entra logo depois de "Dados do evento" porque as duas respondem a
     *  mesma pergunta de quem organiza — "o que o evento é" —, e porque os PRAZOS de
     *  inscrição moram lá: quem acabou de declarar até quando aceita inscrição é
     *  quem quer decidir o que perguntar a quem se inscreve.
     */
    id: 'formulario',
    label: 'Formulário de inscrição',
    purpose: 'Os campos que o participante preenche ao se inscrever — tipo, limites e finalidade.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/formulario'),
    permission: PERMISSIONS.EVENT_UPDATE,
  },
  {
    id: 'programacao',
    label: 'Programação',
    purpose: 'As atividades do evento: horário, sala, vagas e o que a presença vale.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/programacao'),
    permission: PERMISSIONS.EVENT_UPDATE,
  },
  {
    id: 'salas',
    label: 'Salas',
    purpose: 'Os espaços do evento e a capacidade de cada um — o teto das vagas.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/salas'),
    permission: PERMISSIONS.EVENT_UPDATE,
  },
  {
    id: 'chamadas',
    label: 'Chamadas de trabalhos',
    purpose: 'Janelas de submissão, rubrica própria e as propostas recebidas.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/chamadas'),
    legacyTestId: 'calls-link',
  },
  {
    id: 'equipes',
    label: 'Equipes do evento',
    purpose: 'Quem trabalha no evento, com líder por equipe.',
    group: 'CONFIGURAR',
    href: (context) => route(context, '/equipes'),
    permission: PERMISSIONS.DEMAND_READ,
  },
  {
    id: 'pagina',
    label: 'Editar página',
    purpose: 'Blocos, tema, capa, logotipo e o acervo de imagens.',
    group: 'VITRINE',
    href: (context) => route(context, '/pagina'),
    permission: PERMISSIONS.PAGE_MANAGE,
    legacyTestId: 'landing-link',
  },
  {
    id: 'patrocinadores',
    label: 'Patrocinadores',
    purpose: 'Cotas, cores e logos; os contatos captados no estande.',
    group: 'VITRINE',
    href: (context) => route(context, '/patrocinadores'),
    permission: PERMISSIONS.SPONSOR_MANAGE,
    legacyTestId: 'sponsors-link',
  },
  {
    id: 'palestrantes',
    label: 'Palestrantes',
    purpose: 'Perfis, vínculo com as atividades, convite e materiais.',
    group: 'VITRINE',
    href: (context) => route(context, '/palestrantes'),
    permission: PERMISSIONS.SPEAKER_MANAGE,
    legacyTestId: 'speakers-link',
  },
  {
    id: 'confirmacoes',
    label: 'Confirmações de vaga',
    purpose: 'As inscrições que retêm vaga esperando conferência.',
    group: 'OPERAR',
    href: (context) => route(context, '/confirmacoes'),
    legacyTestId: 'confirmations-link',
  },
  {
    id: 'demandas',
    label: 'Demandas da equipe',
    purpose: 'O quadro de trabalho interno, com prazos e responsáveis.',
    group: 'OPERAR',
    href: (context) => route(context, '/demandas'),
    permission: PERMISSIONS.DEMAND_READ,
    legacyTestId: 'demands-link',
  },
  {
    id: 'sorteios',
    label: 'Sorteios',
    purpose: 'Rodadas, prêmios, telão público e auditoria do resultado.',
    group: 'OPERAR',
    href: (context) => route(context, '/sorteios'),
    legacyTestId: 'raffles-link',
  },
  {
    id: 'crachas',
    label: 'Credenciamento',
    purpose: 'Emissão de crachás, folha de impressão e o balcão de leitura.',
    group: 'OPERAR',
    href: (context) =>
      tenantPath(context.tenantSlug, `/credenciamento/crachas?evento=${context.eventId}`),
  },
  {
    id: 'reconhecimento',
    label: 'Reconhecimento do comitê',
    purpose: 'Quem mais revisou o evento e a carta concedida a essas pessoas.',
    group: 'RESULTADO',
    href: (context) => route(context, '/reconhecimento'),
    permission: PERMISSIONS.CARD_GRANT,
  },
  {
    id: 'certificados',
    label: 'Certificados',
    purpose: 'Emissão, modelos e o lote de documentos do evento.',
    group: 'RESULTADO',
    href: (context) => tenantPath(context.tenantSlug, '/administracao/certificados'),
    permission: PERMISSIONS.CERTIFICATE_ISSUE,
  },
  {
    id: 'publico',
    label: 'Ver página pública',
    purpose: 'A vitrine como o público vê — abre em outra aba.',
    group: 'VITRINE',
    href: (context) => tenantPath(context.tenantSlug, `/eventos/${context.eventSlug}`),
    publicView: true,
  },
];

/** As áreas que esta pessoa pode ver (o menu esconde o que a tela recusaria). */
export function visibleEventAreas(options: {
  allowed: (permission: string) => boolean;
  areas?: readonly EventArea[];
}): EventArea[] {
  const areas = options.areas ?? EVENT_AREAS;

  return areas.filter((area) => area.permission === undefined || options.allowed(area.permission));
}

export interface EventAreaGroupView extends EventAreaGroupInfo {
  areas: EventArea[];
}

/** Agrupa na ordem declarada e DESCARTA grupo que ficou sem área. */
export function groupEventAreas(
  areas: readonly EventArea[],
  groups: readonly EventAreaGroupInfo[] = EVENT_AREA_GROUPS,
): EventAreaGroupView[] {
  return groups
    .map((info) => ({ ...info, areas: areas.filter((area) => area.group === info.group) }))
    .filter((info) => info.areas.length > 0);
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O SELO DE CONTAGEM DE CADA ÁREA (FASE 54)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A FRASE É REGRA, E NÃO `{n} itens` NA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cartão diz o que se faz na área; o selo diz **quanto** há lá dentro — é o que
 *  faz o organizador olhar para "Confirmações de vaga" quando há fila e ignorá-la
 *  quando não há. Mas um selo genérico ("3 itens") não informa nada, e um selo
 *  inventado informa errado:
 *
 *  • **Zero é resposta, não ausência.** "nenhuma chamada" diz que falta criar; um
 *    selo vazio diria que o dado não foi carregado. Por isso o zero aparece.
 *  • **`null` é "não sei", e vira NADA.** Quando a contagem não vem (a área não tem
 *    número, ou a consulta não foi feita), o cartão sai sem selo — melhor sem selo
 *    do que com um número que o sistema não conferiu.
 *  • **Singular e plural em português**, porque "1 chamadas" faz o produto parecer
 *    quebrado justamente na primeira vez que o organizador usa.
 *  • **A página não é contagem, é ESTADO** ("publicada" × "rascunho") — contar
 *    blocos não diria a ninguém se o site está no ar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** As contagens do evento, como o serviço as carregou. `null` = não conferido. */
export interface EventAreaCounts {
  calls: number | null;
  rooms: number | null;
  activities: number | null;
  teams: number | null;
  sponsors: number | null;
  /** Inscrições que retêm vaga esperando conferência (a fila da equipe). */
  pendingConfirmations: number | null;
  openDemands: number | null;
  credentials: number | null;
  certificates: number | null;
  speakers: number | null;
  /**
   * Campos DECLARADOS no formulário de inscrição do evento (FASE 70).
   *
   * `null` aqui não é "não contei": é "não sei", e o cartão sai sem selo. A leitura
   * tolerante da configuração devolve lista VAZIA quando o que está gravado é torto —
   * e afirmar "nenhum campo declarado" sobre uma configuração inválida seria o selo
   * mentindo exatamente no caso em que o organizador precisa olhar para ela.
   */
  formFields: number | null;
  /** `null` quando a página do evento nunca foi criada. */
  pagePublished: boolean | null;
}

/**
 * Um número com o substantivo certo: `1 chamada`, `3 chamadas`, `nenhuma chamada`.
 *
 * O zero recebe a frase PRONTA em vez de ser deduzido do singular: "atividade" e
 * "chamada" são femininas, "crachá" e "patrocinador" não — deduzir pela terminação
 * produziu "nenhum atividade" na primeira versão (e o teste pegou).
 */
function quantidade(value: number, singular: string, plural: string, zero: string): string {
  if (value === 0) return zero;

  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * O texto do selo, por área. `null` = sem selo.
 *
 * O `publico` nunca tem selo: é a vitrine, e ela não guarda nada para contar.
 */
export function eventAreaMetric(areaId: string, counts: EventAreaCounts): string | null {
  switch (areaId) {
    case 'programacao':
      return counts.activities === null
        ? null
        : quantidade(counts.activities, 'atividade', 'atividades', 'nenhuma atividade');
    case 'salas':
      return counts.rooms === null ? null : quantidade(counts.rooms, 'sala', 'salas', 'nenhuma sala');
    case 'formulario':
      /**
       * A frase fala do que o PARTICIPANTE encontra: o evento sem formulário declarado
       * faz a pergunta de sempre, e é isso que "nenhum campo declarado" diz — sem
       * prometer que a inscrição não pergunta nada.
       */
      return counts.formFields === null
        ? null
        : quantidade(counts.formFields, 'campo declarado', 'campos declarados', 'nenhum campo declarado');
    case 'chamadas':
      return counts.calls === null ? null : quantidade(counts.calls, 'chamada', 'chamadas', 'nenhuma chamada');
    case 'equipes':
      return counts.teams === null ? null : quantidade(counts.teams, 'equipe', 'equipes', 'nenhuma equipe');
    case 'patrocinadores':
      return counts.sponsors === null
        ? null
        : quantidade(counts.sponsors, 'patrocinador', 'patrocinadores', 'nenhum patrocinador');
    case 'palestrantes':
      return counts.speakers === null ? null : quantidade(counts.speakers, 'palestrante', 'palestrantes', 'nenhum palestrante');
    case 'confirmacoes':
      /** A frase do zero já diz o que importa aqui — "vaga retida" é o nome do fato. */
      return counts.pendingConfirmations === null
        ? null
        : quantidade(
            counts.pendingConfirmations,
            'vaga retida',
            'vagas retidas',
            'nenhuma vaga retida',
          );
    case 'demandas':
      return counts.openDemands === null
        ? null
        : quantidade(counts.openDemands, 'demanda aberta', 'demandas abertas', 'nenhuma demanda aberta');
    case 'crachas':
      return counts.credentials === null
        ? null
        : quantidade(counts.credentials, 'crachá emitido', 'crachás emitidos', 'nenhum crachá emitido');
    case 'certificados':
      return counts.certificates === null
        ? null
        : quantidade(counts.certificates, 'certificado', 'certificados', 'nenhum certificado');
    case 'pagina':
      if (counts.pagePublished === null) return null;

      return counts.pagePublished ? 'publicada' : 'em rascunho';
    default:
      /** Sorteios e a vitrine pública ficam sem selo enquanto não houver contagem. */
      return null;
  }
}

/**
 * Todas as contagens DESCONHECIDAS — o ponto de partida quando a leitura falha.
 *
 * Zero e `null` são coisas diferentes: zero é "contei e não há", `null` é "não
 * contei". Começar do zero faria a tela afirmar "nenhuma chamada" para um evento
 * que tem três, só porque a consulta caiu.
 */
export const EMPTY_EVENT_AREA_COUNTS: EventAreaCounts = {
  calls: null,
  rooms: null,
  activities: null,
  teams: null,
  sponsors: null,
  pendingConfirmations: null,
  openDemands: null,
  credentials: null,
  certificates: null,
  speakers: null,
  formFields: null,
  pagePublished: null,
};
