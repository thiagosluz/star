/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O MOTIVO DO DESCADASTRO (FASE 69 · dívida E88)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MOTIVO É PERGUNTA, NUNCA PEDÁGIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem chega à página de descadastro já decidiu: quer parar de receber. Este
 *  arquivo existe para que a instituição consiga entender POR QUE as pessoas
 *  saem — e a primeira regra é a que impede a curiosidade de atrapalhar a saída:
 *  o motivo é OPCIONAL em todos os caminhos, e nenhuma função daqui devolve
 *  recusa. Um valor torto, ausente, desconhecido ou gigante vira `null` (ou o
 *  texto aparado), e a saída acontece igual.
 *
 *  A alternativa descartada era validar o motivo com o mesmo rigor dos outros
 *  campos do produto (recusar o formulário e pedir para escolher). Ela produziria
 *  o pior resultado possível: a pessoa que quer sair, presa numa tela pedindo
 *  justificativa — e o caminho mais curto daí é o botão "spam", que é exatamente
 *  o que a página sem login existe para evitar (ADR-338).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O VALOR GRAVADO É A PRÓPRIA FRASE — E ISSO É DECISÃO, NÃO PREGUIÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A coluna `communication_unsubscribes.reason` é `VarChar(300)` e já recebe
 *  TEXTO LIVRE do caminho `MANUAL` (o pedido que a equipe registra por telefone,
 *  escrito por uma pessoa). Guardar um código (`TOO_MANY_MESSAGES`) criaria DOIS
 *  dialetos na mesma coluna: quem abrisse o banco leria `TOO_MANY_MESSAGES` ao
 *  lado de "ligou pedindo para parar" e não saberia qual dos dois é o motivo.
 *  Guardando a frase, a coluna continua legível por gente em todos os caminhos —
 *  e a leitura (a linha agregada da tela de comunicação) não precisa de tabela de
 *  tradução para mostrar o que a pessoa disse.
 *
 *  O custo é declarado: **renomear uma opção é migração de dado** (as linhas
 *  antigas guardam a frase antiga). É um custo pequeno e visível, e ele é menor do
 *  que o custo de manter duas linguagens na mesma coluna.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "PREFIRO NÃO DIZER" É UMA ESCOLHA VISÍVEL, E NÃO A AUSÊNCIA DELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O grupo de rádio tem uma opção explícita de não responder. Sem ela, o
 *  formulário mostraria quatro alternativas e nenhuma marcada — e um grupo de
 *  rádio sem escolha PARECE obrigatório, que é o que não pode. A opção explícita
 *  diz em uma linha que não dizer é permitido, e o valor dela é `null` (não é uma
 *  frase gravada: "prefiro não dizer" não é motivo de nada).
 *
 *  Ela também NÃO vem marcada por padrão: a pergunta aparece em branco, e quem
 *  quiser responder responde. Pré-marcar "não dizer" ensinaria a pular a única
 *  pergunta da tela.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * As opções de motivo — e o valor delas É o texto gravado.
 *
 * A ordem é a da tela, e ela vai do mais comum ao mais raro: excesso de mensagem
 * é a causa mais frequente de descadastro em mala direta, e a mais acionável
 * (quem lê "recebo mensagens demais" sabe o que fazer). "Outro motivo" fica por
 * último, antes de "prefiro não dizer", porque é a saída de quem não se reconhece
 * em nenhuma das anteriores.
 */
export const UNSUBSCRIBE_REASON_OPTIONS = [
  'Recebo mensagens demais',
  'Não é do meu interesse',
  'Não participo mais desta instituição',
  'Outro motivo',
] as const;

export type UnsubscribeReasonOption = (typeof UNSUBSCRIBE_REASON_OPTIONS)[number];

/**
 * "Outro motivo" aceita texto livre — e é a ÚNICA que aceita.
 *
 * Sem isso, quem sai por um motivo que a lista não previu não teria onde escrever
 * e a instituição perderia a informação mais útil que existe (a causa que ela não
 * imaginou).
 */
export const UNSUBSCRIBE_REASON_OTHER: UnsubscribeReasonOption = 'Outro motivo';

/** A opção de NÃO responder: existe na tela e vale `null` no banco. */
export const UNSUBSCRIBE_REASON_DECLINE = 'Prefiro não dizer';

/** O que o grupo de rádio desenha, na ordem. */
export const UNSUBSCRIBE_REASON_CHOICES = [
  ...UNSUBSCRIBE_REASON_OPTIONS,
  UNSUBSCRIBE_REASON_DECLINE,
] as const;

export type UnsubscribeReasonChoice = (typeof UNSUBSCRIBE_REASON_CHOICES)[number];

/**
 * Os nomes dos campos do formulário — o CONTRATO entre a tela e a ação.
 *
 * Eles moram aqui, e não em cada lado, pelo mesmo motivo dos marcadores da
 * campanha: um `<input name="motivo">` que a ação lesse como `reason` gravaria
 * vazio em silêncio, e o sintoma seria "a pergunta não grava nada" — que já
 * custaria uma depuração. E não podem morar no arquivo da ação: um módulo
 * `'use server'` só exporta função assíncrona, então uma constante lá dentro nem
 * chegaria ao formulário.
 */
export const UNSUBSCRIBE_REASON_FIELD = 'motivo';
export const UNSUBSCRIBE_REASON_NOTE_FIELD = 'motivoTexto';

/**
 * Teto do texto livre.
 *
 * É de PRODUTO, não do banco (a coluna tem 300): a pergunta é uma cortesia no fim
 * de uma saída, e um campo que aceita um parágrafo convida a escrever uma carta
 * que ninguém vai ler. O que passar disso é APARADO, nunca recusado — pela regra
 * do topo deste arquivo.
 */
export const MAX_UNSUBSCRIBE_REASON_LENGTH = 200;

/** O valor recebido é uma das opções que a tela oferece? */
export function isUnsubscribeReasonChoice(value: unknown): value is UnsubscribeReasonChoice {
  return (
    typeof value === 'string' &&
    (UNSUBSCRIBE_REASON_CHOICES as readonly string[]).includes(value)
  );
}

/** O valor recebido é uma das opções que VÃO PARA O BANCO? */
export function isUnsubscribeReasonOption(value: unknown): value is UnsubscribeReasonOption {
  return (
    typeof value === 'string' &&
    (UNSUBSCRIBE_REASON_OPTIONS as readonly string[]).includes(value)
  );
}

/**
 * Espaços em branco colapsados.
 *
 * Duas razões, e as duas são de desenho: um texto com quebra de linha gravado no
 * banco viraria uma linha quebrada no meio da frase agregada da tela; e a
 * comparação por igualdade (o agrupamento da leitura) trataria "excesso  de
 * mensagens" e "excesso de mensagens" como dois motivos diferentes.
 */
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * O QUE VAI PARA A COLUNA `reason` — a única função que a ação de saída usa.
 *
 * As quatro respostas possíveis, e nenhuma delas é erro:
 *
 *  • **opção conhecida e diferente de "Outro motivo"** → a própria frase;
 *  • **"Outro motivo" com texto** → o texto escrito (aparado, espaços colapsados);
 *  • **"Outro motivo" sem texto** → a frase "Outro motivo" — a pessoa disse que
 *    tem um motivo fora da lista, e isso é informação, mesmo sem a descrição;
 *  • **qualquer outra coisa** (nada escolhido, "prefiro não dizer", valor
 *    desconhecido, tipo errado) → `null`, que é "a pessoa saiu sem dizer por quê".
 *
 * Repare que o texto livre NÃO é aceito sozinho, sem a opção: quem escreve no
 * campo sem escolher "Outro motivo" não declarou motivo nenhum, e gravar um texto
 * solto faria a coluna receber recado de outra natureza — o caminho para isso são
 * os comentários, não a linha do descadastro.
 */
export function unsubscribeReasonFor(input: {
  option: unknown;
  note?: unknown;
}): string | null {
  if (!isUnsubscribeReasonOption(input.option)) return null;

  if (input.option !== UNSUBSCRIBE_REASON_OTHER) return input.option;

  const note = typeof input.note === 'string' ? collapse(input.note) : '';

  return note ? note.slice(0, MAX_UNSUBSCRIBE_REASON_LENGTH) : UNSUBSCRIBE_REASON_OTHER;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A LEITURA: o que a equipe vê
// ───────────────────────────────────────────────────────────────────────────────
/** Quantas pessoas saíram por um motivo (`null` = saíram sem dizer). */
export interface UnsubscribeReasonTally {
  reason: string | null;
  count: number;
}

/**
 * Teto de motivos DIFERENTES mostrados na frase.
 *
 * O caminho `MANUAL` grava texto livre, então dois pedidos por telefone já são
 * dois motivos distintos — sem teto, uma instituição com 200 saídas por telefone
 * produziria um parágrafo de 200 itens no meio da tela. Os que sobram continuam
 * contados na frase ("N com outros motivos"); o texto de cada um está no banco.
 */
const MAX_SUMMARY_BUCKETS = 3;

/** Quanto do motivo cabe na frase agregada, antes de virar reticências. */
const MAX_SUMMARY_REASON_LENGTH = 60;

/** Junta as partes com vírgulas e um "e" antes da última. */
function joinParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';

  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1] ?? ''}`;
}

/**
 * A LINHA AGREGADA — "2 por “Recebo mensagens demais” e 1 sem motivo informado".
 *
 * A frase é do DOMÍNIO e não da tela porque ela é uma LEITURA do dado, com
 * regras: quantos motivos aparecem, em que ordem, o que fazer com o texto livre
 * escrito pela equipe e o que dizer de quem saiu sem responder. Escrita dentro do
 * JSX, essas decisões ficariam presas ao desenho e sem teste.
 *
 * A ordem é DECIDIDA, não a do banco: mais gente primeiro e, no empate, o texto
 * em ordem — duas execuções sobre o mesmo dado têm de produzir a mesma frase
 * (uma linha que troca de ordem a cada leitura parece que mudou de conteúdo).
 *
 * `null` quando ninguém saiu: a tela não desenha frase nenhuma, e não "0 por —".
 */
export function summarizeUnsubscribeReasons(
  tallies: readonly UnsubscribeReasonTally[],
): string | null {
  const porMotivo = new Map<string, number>();
  let semMotivo = 0;

  for (const tally of tallies) {
    /**
     * Contagem que não é número positivo é DESCARTADA em vez de virar `NaN` na
     * frase: um `groupBy` do banco devolve inteiro, e um número torto aqui só
     * pode ter vindo de chamada errada — que não deve produzir "NaN por —".
     */
    if (!Number.isFinite(tally.count) || tally.count <= 0) continue;

    const texto = typeof tally.reason === 'string' ? collapse(tally.reason) : '';

    if (!texto) {
      semMotivo += tally.count;
      continue;
    }

    porMotivo.set(texto, (porMotivo.get(texto) ?? 0) + tally.count);
  }

  const total = semMotivo + [...porMotivo.values()].reduce((soma, valor) => soma + valor, 0);

  if (total === 0) return null;

  const ordenados = [...porMotivo.entries()].sort((a, b) =>
    b[1] === a[1] ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1],
  );

  const mostrados = ordenados.slice(0, MAX_SUMMARY_BUCKETS);
  const restantes = ordenados
    .slice(MAX_SUMMARY_BUCKETS)
    .reduce((soma, [, count]) => soma + count, 0);

  const partes = mostrados.map(([texto, count]) => {
    const curto =
      texto.length > MAX_SUMMARY_REASON_LENGTH
        ? `${texto.slice(0, MAX_SUMMARY_REASON_LENGTH - 1).trimEnd()}…`
        : texto;

    return `${count} por “${curto}”`;
  });

  if (semMotivo > 0) partes.push(`${semMotivo} sem motivo informado`);
  if (restantes > 0) partes.push(`${restantes} com outros motivos`);

  return joinParts(partes);
}
