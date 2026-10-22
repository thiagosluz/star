/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — o que a TELA do organizador diz sobre a API do evento (FASE 72 · 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AS FRASES SÃO REGRA, E NÃO TEXTO COLADO NA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A tela da API tem quatro estados da chave (sem chave, ativa, revogada,
 *  configuração inválida), dois estados de publicação e três interruptores. Cada
 *  combinação produz uma frase que promete algo sobre o comportamento EXTERNO da
 *  API: "responde 401", "responde 404 como se não existisse". Promessa de
 *  comportamento é a parte da tela que pode mentir em silêncio — e a única forma de
 *  prendê-la sem navegador é tê-la como função pura.
 *
 *  Aqui mora o vocabulário; a página só desenha. Assim o teste de unidade prova o
 *  que o organizador LÊ sem precisar de banco, de servidor ou de imagem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O SELO DA ÁREA RESPEITA A CATRACA DA F54 (zero × `null`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "nenhuma chave" é o ZERO da área — aparece, porque dizer que falta gerar é a
 *  informação. `null` é "não sei" (a contagem não foi feita ou a configuração
 *  gravada está ilegível) e vira **sem selo**: afirmar "nenhuma chave" sobre uma
 *  configuração que o sistema não consegue ler seria o selo mentindo justo no caso
 *  em que o organizador precisa abrir a tela.
 *
 *  O módulo é PURO: não importa Prisma, Next, React nem relógio. As datas chegam
 *  já formatadas pela página, no fuso do evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  EVENT_API_SECTIONS,
  type EventApiSection,
  type ReadEventApiConfigResult,
} from './event-api-key-rules';
import type { ApiResource } from './public-api-contract';

// ───────────────────────────────────────────────────────────────────────────────
//  O estado da chave
// ───────────────────────────────────────────────────────────────────────────────
/**
 * `INVALID` é separado de `NONE` de propósito: "nunca houve chave" pede o botão
 * "Gerar chave"; "há uma configuração que o leitor tolerante recusa" pede a mesma
 * coisa MAIS a explicação de que gerar substitui o que está torto. Juntar os dois
 * esconderia do organizador que existe lixo gravado no evento.
 */
export type EventApiKeyState = 'NONE' | 'ACTIVE' | 'REVOKED' | 'INVALID';

/** Traduz a leitura tolerante de `settings.api` no estado que a tela mostra. */
export function readEventApiKeyState(read: ReadEventApiConfigResult): EventApiKeyState {
  if (!read.configured || !read.config) {
    return read.problems.length > 0 ? 'INVALID' : 'NONE';
  }

  /** Revogada é um estado da chave, não um JSON inválido (ver a leitura). */
  return read.config.revogadaEm !== null ? 'REVOKED' : 'ACTIVE';
}

export interface EventApiKeyStateCopy {
  title: string;
  body: string;
}

/**
 * O texto do estado da chave.
 *
 * `criadaEmLabel`/`revogadaEmLabel` chegam prontos (fuso do evento). Sem o rótulo,
 * a frase não inventa uma data: diz que a data não está disponível. Data inventada
 * numa credencial é pior do que data ausente.
 */
export function eventApiKeyStateCopy(input: {
  state: EventApiKeyState;
  criadaEmLabel?: string | null;
  revogadaEmLabel?: string | null;
}): EventApiKeyStateCopy {
  switch (input.state) {
    case 'NONE':
      return {
        title: 'Sem chave',
        body:
          'A API responde 401 até você gerar uma chave. Nenhum recurso deste evento é ' +
          'público sem ela.',
      };
    case 'ACTIVE':
      return {
        title: 'Chave ativa',
        body: `Criada em ${input.criadaEmLabel ?? 'data não disponível'}. Quem tem a chave lê o que as seções ligadas expõem.`,
      };
    case 'REVOKED':
      return {
        title: 'Chave revogada',
        body:
          `Revogada em ${input.revogadaEmLabel ?? 'data não disponível'}. ` +
          'A API responde 401 até você gerar outra chave.',
      };
    case 'INVALID':
      return {
        title: 'A configuração da chave está inválida',
        body:
          'O que está gravado nas configurações deste evento não pôde ser lido, e a API ' +
          'responde 401. Gerar uma chave substitui a configuração inválida.',
      };
  }
}

/** O selo do cartão da área: `null` = sem selo (não sei), nunca "0 chave". */
export function eventApiAreaMetric(state: EventApiKeyState | null): string | null {
  switch (state) {
    case 'ACTIVE':
      /** Uma chave por evento é a regra da fase — o número é sempre um. */
      return '1 chave ativa';
    case 'REVOKED':
      return 'chave revogada';
    case 'NONE':
      return 'nenhuma chave';
    default:
      /** `INVALID` e `null` são "não sei": o cartão sai sem selo. */
      return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O estado de publicação
// ───────────────────────────────────────────────────────────────────────────────
export interface EventApiPublicationCopy {
  live: boolean;
  title: string;
  body: string;
}

/**
 * A frase da publicação — a PORTA da API.
 *
 * `published` é decidido pela página com a régua da vitrine
 * (`isPublicEventStatus`), não por uma lista nova: se a página pública não mostra
 * o evento, a API também não pode mostrá-lo. `status` só escolhe a frase do
 * rascunho, porque é o caso em que o organizador está montando o evento agora.
 */
export function eventApiPublicationCopy(input: {
  published: boolean;
  status: string;
}): EventApiPublicationCopy {
  if (input.published) {
    return {
      live: true,
      title: 'O evento está no ar',
      body:
        'A API responde os recursos abaixo para quem apresentar a chave. A página pública ' +
        'e a API leem a MESMA projeção.',
    };
  }

  if (input.status === 'DRAFT') {
    return {
      live: false,
      title: 'O evento está em rascunho',
      body:
        'A API responde 404 enquanto o evento não estiver publicado — o mesmo código de ' +
        'evento inexistente, de propósito: distinguir os dois revelaria o rascunho.',
    };
  }

  return {
    live: false,
    title: 'O evento não está publicado',
    body:
      'A API só serve evento publicado. Enquanto ele não estiver no ar, todos os recursos ' +
      'respondem 404 — o mesmo código de evento inexistente, de propósito.',
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  As seções
// ───────────────────────────────────────────────────────────────────────────────
export interface EventApiSectionInfo {
  section: EventApiSection;
  label: string;
  /** O recurso que a seção liga/desliga. As duas listas têm os mesmos nomes. */
  resource: ApiResource;
  description: string;
}

export const EVENT_API_SECTION_INFO: readonly EventApiSectionInfo[] = [
  {
    section: 'palestrantes',
    label: 'Palestrantes',
    resource: 'palestrantes',
    description: 'Quem ministra as atividades do evento, com os campos públicos do perfil.',
  },
  {
    section: 'patrocinadores',
    label: 'Patrocinadores',
    resource: 'patrocinadores',
    description: 'As cotas e as empresas patrocinadoras, com logo e endereço.',
  },
  {
    section: 'chamadas',
    label: 'Chamadas de propostas',
    resource: 'chamadas',
    description: 'As chamadas publicadas: tipo, prazo e o link do formulário.',
  },
];

/** A frase que diz o que acontece com a seção DESLIGADA. */
export function eventApiSectionOffNotice(section: EventApiSection): string {
  const info = EVENT_API_SECTION_INFO.find((item) => item.section === section);

  return (
    `A seção ${info?.label ?? section} está desligada: o recurso /${info?.resource ?? section} ` +
    'responde 404 como se não existisse nesta API.'
  );
}

/**
 * As duas frases que a tela precisa dizer sobre o que NÃO se desliga.
 *
 * A primeira é a regra de "expor é decisão explícita" (decisão 3 do humano); a
 * segunda impede a leitura errada de que tudo é interruptável. As duas ficam aqui
 * porque são promessas de comportamento externo, como o resto do arquivo.
 */
export const EVENT_API_SECTIONS_BORN_OFF =
  'As seções nascem DESLIGADAS: só a sua escolha explícita expõe uma delas. Desligada, ' +
  'a seção responde 404 — como se não existisse nesta API — até você ligá-la.';

export const EVENT_API_FIXED_RESOURCES_NOTICE =
  'O evento e a programação NÃO têm interruptor: enquanto a chave valer e o evento ' +
  'estiver publicado, eles respondem sempre.';

// ───────────────────────────────────────────────────────────────────────────────
//  Os recursos
// ───────────────────────────────────────────────────────────────────────────────
export interface EventApiResourceDoc {
  resource: ApiResource;
  label: string;
  description: string;
}

/**
 * A documentação de cada recurso.
 *
 * A lista é ESCRITA e o teste prende que ela cobre `API_RESOURCES`: um recurso
 * novo no contrato sem documentação na tela é uma documentação que mente por
 * omissão — o cliente lê "são estes" e descobre o sexto por acaso.
 */
export const EVENT_API_RESOURCE_DOCS: readonly EventApiResourceDoc[] = [
  {
    resource: 'evento',
    label: 'O evento',
    description:
      'Identidade, datas, local, modalidade, tema, inscrição aberta × encerrada e vagas.',
  },
  {
    resource: 'atividades',
    label: 'A programação',
    description: 'As atividades: dia, sala, trilha, tipo, carga horária e vagas.',
  },
  {
    resource: 'palestrantes',
    label: 'Palestrantes',
    description: 'Quem ministra as atividades, com os campos públicos do perfil.',
  },
  {
    resource: 'patrocinadores',
    label: 'Patrocinadores',
    description: 'As cotas e as empresas patrocinadoras, com logo e endereço.',
  },
  {
    resource: 'chamadas',
    label: 'Chamadas de propostas',
    description: 'As chamadas publicadas: tipo, prazo e o link do formulário.',
  },
];

/**
 * O endereço COMPLETO do recurso, com o `eventSlug` real.
 *
 * A tela jamais desenha `<slug>`: um endereço de mentira num bloco copiável é pior
 * do que nenhum endereço — o cliente cola e recebe 404 sem saber por quê.
 */
export function eventApiResourcePath(input: {
  tenantSlug: string;
  eventSlug: string;
  resource: ApiResource;
}): string {
  const base = `/api/v1/t/${input.tenantSlug}/eventos/${input.eventSlug}`;

  return input.resource === 'evento' ? base : `${base}/${input.resource}`;
}

/** O método de todos os recursos: a API é somente leitura. */
export const EVENT_API_RESOURCE_METHOD = 'GET';

// ───────────────────────────────────────────────────────────────────────────────
//  Os limites e o que a API nunca devolve
// ───────────────────────────────────────────────────────────────────────────────
export interface EventApiLimitDoc {
  title: string;
  detail: string;
}

/** A documentação operacional da mesma tela — sem link para lugar nenhum. */
export const EVENT_API_LIMITS: readonly EventApiLimitDoc[] = [
  {
    title: '120 requisições por minuto por IP',
    detail:
      'Acima disso a resposta é 429 com Retry-After. O teto protege o servidor; não é ' +
      'autorização — quem autoriza é a chave.',
  },
  {
    title: 'ETag e 304',
    detail:
      'Toda resposta de leitura traz o ETag do conteúdo. Mandar If-None-Match com o mesmo ' +
      'valor recebe 304 sem corpo, e a leitura não custa de novo.',
  },
  {
    title: 'Cache de 60 segundos',
    detail:
      'As respostas de leitura pedem Cache-Control: public, max-age=60 e variam por ' +
      'Authorization, para um cache compartilhado não servir o corpo chaveado a outra ' +
      'requisição.',
  },
  {
    title: 'CORS aberto',
    detail:
      'Access-Control-Allow-Origin: * em todas as respostas, inclusive nas de erro: o site ' +
      'do cliente precisa poder ler o motivo de um 401 ou de um 429.',
  },
  {
    title: 'Authorization: Bearer <chave>',
    detail:
      'A chave vai no cabeçalho. Ausente, errada ou revogada, a resposta é 401 com ' +
      'WWW-Authenticate: Bearer — o mesmo corpo nos três casos.',
  },
  {
    title: 'Envelope',
    detail:
      'Sucesso: { "data": …, "meta": { "generatedAt", "etag" e "count" quando é lista } }. ' +
      'Erro: { "code", "message" }, no formato da casa.',
  },
  {
    title: 'Somente leitura',
    detail: 'GET, HEAD e OPTIONS. Qualquer outro método responde 405 com o cabeçalho Allow.',
  },
  {
    title: '404 também é o rascunho',
    detail: 'Evento não publicado e evento inexistente respondem exatamente o mesmo 404.',
  },
];

/** A lista fechada, dita em uma frase para quem integra — não em setenta campos. */
export const EVENT_API_NEVER_EXPOSED =
  'A API não devolve endereço de sala online, dado de participante, resposta de formulário, ' +
  'CPF, lista de espera, contador interno de operação nem campo de rascunho.';

/** A lista de seções, para a página não recriar a ordem do domínio. */
export const EVENT_API_TOGGLEABLE_SECTIONS: readonly EventApiSection[] = EVENT_API_SECTIONS;
