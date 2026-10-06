/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Os marcadores de personalização da campanha (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CORPO PRECISA DE MARCADORES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui o corpo da campanha era o MESMO texto para todo mundo, e o que a
 *  pessoa recebia de pessoal era só a saudação que o template monta. Isso serve
 *  para um aviso geral — e não para a mala direta, que é o uso real: "Olá, {nome},
 *  a sua vaga em {evento} está retida". Sem marcador, o organizador escreveria
 *  "sua vaga" para 300 pessoas e o e-mail perderia justamente o que faz alguém
 *  abrir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A SUBSTITUIÇÃO ACONTECE NO DISPARO, E NÃO NA ENTREGA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O outbox grava o HTML RENDERIZADO no enfileiramento (FASE 15) — é o que faz a
 *  linha responder "o que esta pessoa recebeu?", e não "o que o template diz
 *  hoje". Então o texto personalizado tem de estar pronto ANTES do `queueEmail`:
 *  o que fica gravado é o corpo daquela pessoa, com o nome dela dentro. Trocar o
 *  marcador na entrega gravaria um HTML genérico e a personalização sumiria do
 *  registro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  MARCADOR DESCONHECIDO NÃO VIRA TEXTO VAZIO — E ISSO É DECISÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As duas alternativas foram descartadas por medição:
 *
 *    • **apagar** o marcador desconhecido (`{cidade}` → ``) produz um e-mail que
 *      PARECE certo e diz menos do que o organizador escreveu — "nos vemos em
 *      ." —, e ninguém descobre o erro, porque quem recebe não avisa;
 *    • **recusar o envio** faria uma chave a mais no texto derrubar uma campanha
 *      de mil pessoas já revisada; o marcador é enfeite, e enfeite não derruba
 *      fluxo (invariante nº 8).
 *
 *  O que fica é o marcador LITERAL no lugar: o e-mail sai com `{cidade}` visível,
 *  e é assim que quem escreveu descobre o que não existe. O defeito aparece no
 *  lugar onde ele pode ser corrigido.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE NÃO É MARCADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Só casa `{` + letra + letras/dígitos + `}`. Chave usada em código, JSON ou
 *  cifra — `{ "a": 1 }`, `${…}` — não vira marcador, e um texto com chaves
 *  soltas continua saindo como foi escrito.
 *
 *  O valor também não é reprocessado: o que entra no lugar do marcador sai como
 *  está, mesmo que ele próprio contenha chaves. Nome de pessoa com `{}` no meio é
 *  improvável, mas a diferença importa — e ela foi MEDIDA: a primeira versão deste
 *  arquivo substituía marcador por marcador, e um valor igual a `{evento}` era
 *  trocado de novo na passada seguinte. O resultado dependia da ORDEM das
 *  substituições, e ordem não é contrato. A substituição é de UMA passada, com o
 *  valor resolvido no lugar do casamento — e é o teste que prende isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE ARQUIVO NÃO CONHECE TEMPLATE, PRISMA NEM TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele recebe texto e um mapa de valores e devolve texto. Quem monta os valores é
 *  o disparo (`campaign-service.ts`), e o escape do HTML é do template — uma
 *  camada só, no lugar onde o HTML é montado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const CAMPAIGN_MARKERS = ['nome', 'instituicao', 'evento'] as const;
export type CampaignMarker = (typeof CAMPAIGN_MARKERS)[number];

/**
 * O modelo do marcador como o organizador o escreve.
 *
 * A forma (`{nome}`) mora aqui, e não em cada lugar que a cita: a tela mostra
 * esta lista, o disparo substitui por este padrão e o teste percorre as três
 * coisas — escrever `{nome}` num arquivo e `{ nome }` em outro faria o texto de
 * ajuda mentir sobre o que funciona (o espaço não casa).
 */
export function campaignMarkerToken(marker: CampaignMarker): string {
  return `{${marker}}`;
}

export const CAMPAIGN_MARKER_LABELS: Readonly<Record<CampaignMarker, string>> = {
  nome: 'nome de quem recebe',
  instituicao: 'nome da instituição',
  evento: 'nome do evento da campanha',
};

/** O que a tela diz sobre os marcadores, em uma frase — e sem prometer o que não há. */
export const CAMPAIGN_MARKER_HINT =
  'Escreva {nome}, {instituicao} ou {evento} onde quiser: cada pessoa recebe o texto com o valor dela. ' +
  'Marcador que não existe sai literal na mensagem — é assim que você vê que errou a chave.';

/** Valores disponíveis por destinatário. `evento` é nulo na campanha da instituição. */
export interface CampaignMarkerValues {
  nome: string;
  instituicao: string;
  evento: string | null;
}

const MARKER_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/**
 * Uma cópia NOVA do padrão a cada uso.
 *
 * `String.replace` com `g` zera o `lastIndex` sozinho, mas `matchAll` NÃO — e um
 * `lastIndex` deixado para trás faria a próxima leitura de marcadores começar no
 * meio do texto, devolvendo uma lista incompleta de forma dependente de quem
 * chamou primeiro. Duas linhas custam menos do que um bug de ordem.
 */
function markerPattern(): RegExp {
  return new RegExp(MARKER_PATTERN.source, MARKER_PATTERN.flags);
}

function isCampaignMarker(value: string): value is CampaignMarker {
  return (CAMPAIGN_MARKERS as readonly string[]).includes(value);
}

/**
 * Troca os marcadores conhecidos pelos valores, em UMA passada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PASSADA, E NÃO UM LAÇO DE `replaceAll` POR MARCADOR
 * ─────────────────────────────────────────────────────────────────────────────
 *  O laço é o caminho natural de escrever — e ele foi escrito primeiro. O defeito
 *  que o teste pegou: com o valor de `{nome}` igual a `{evento}`, o laço inseria
 *  `{evento}` no texto e a passada SEGUINTE trocava o que tinha acabado de entrar.
 *  O texto de quem escreveu deixava de ser o texto que saiu, e o resultado passava a
 *  depender da ORDEM do catálogo — ordem não é contrato, e um catálogo reordenado
 *  mudaria e-mails que já estavam prontos.
 *
 *  Com o `replace` de uma passada, o valor entra e o casamento seguinte continua a
 *  partir do ponto onde o anterior terminou: nada que foi inserido é relido.
 *
 *  O marcador conhecido SEM valor (o `evento` nulo da campanha da instituição
 *  inteira) fica LITERAL, como um desconhecido: apagá-lo faria "o evento {evento}
 *  começou" sair como "o evento  começou" — uma frase que parece pronta e não é.
 */
export function renderCampaignMarkers(body: string, values: CampaignMarkerValues): string {
  return body.replace(markerPattern(), (match, key: string) => {
    if (!isCampaignMarker(key)) return match;

    const value = key === 'evento' ? values.evento : values[key];

    if (value === null || value.length === 0) return match;

    return value;
  });
}

/**
 * Os marcadores que o texto USA — conhecidos ou não.
 *
 * Serve a duas leituras: o teste que prende "todo marcador do catálogo tem
 * valor" e a tela que quiser avisar antes do envio que há uma chave escrita que
 * o produto não conhece. Não é erro: é informação.
 */
export function campaignMarkersIn(body: string): readonly string[] {
  const found = new Set<string>();

  for (const match of body.matchAll(markerPattern())) {
    const key = match[1];
    if (key) found.add(key);
  }

  return [...found].sort();
}

/** Marcadores escritos no texto que o produto NÃO sabe preencher. */
export function unknownCampaignMarkers(body: string): readonly string[] {
  return campaignMarkersIn(body).filter((key) => !isCampaignMarker(key));
}
