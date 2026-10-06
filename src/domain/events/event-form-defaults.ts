/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — OS PADRÕES DO FORMULÁRIO DE CRIAÇÃO DE EVENTO (FASE 68 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO CONSERTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formulário nascia com o término em `início + 3 dias` e com a hora do início
 *  vinda do RELÓGIO DE RENDER — o minuto em que a página foi montada. Quem abrisse o
 *  painel às 12:27 via "12:27", e quem abrisse às 12:31 via "12:31": o mesmo
 *  formulário, dois padrões diferentes, e nenhum deles escolhido por ninguém. Pior: a
 *  página do evento passa a anunciar três dias em todo evento criado por descuido —
 *  por isso o rótulo da raiz do painel dizia "05/11/2026 a 08/11/2026".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO: UM DIA, COM HORA EXPLÍCITA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O padrão é **09:00 → 18:00 no MESMO dia** (a janela de um dia útil de evento), com
 *  o DIA a trinta dias de hoje — o DIA continua vindo do relógio, porque o formulário
 *  precisa de uma data plausível e não há outra fonte para "quando o organizador está
 *  criando isto". O que não pode vir do relógio é a HORA: minuto de render não é
 *  decisão de produto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FUSO É O DO PROCESSO (e isso é dito, não escondido)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O valor vai para um `<input type="datetime-local">`, que é lido no relógio de quem
 *  usa a tela. O evento AINDA NÃO EXISTE — não há `Event.timezone` de onde tirar fuso
 *  —, e o formulário é o único ponto do sistema em que o fuso é o do navegador/
 *  processo de propósito. O campo "Fuso horário" logo abaixo é que declara o fuso do
 *  evento, e é ele que vale de verdade depois que o evento existe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE É FUNÇÃO PURA, E NÃO TRÊS LINHAS DENTRO DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito antigo não era o número "3 dias": era ninguém poder prendê-lo com teste,
 *  porque a conta vivia no meio de um Server Component. Aqui ela é verificável sem
 *  banco e sem navegador — inclusive a única afirmação que realmente importa
 *  ("um evento de 09:00 a 18:00 no mesmo dia PASSA na validação") fica presa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Os dias entre hoje e o dia sugerido para o evento novo. */
export const DIAS_ATE_O_EVENTO_PADRAO = 30;

/** A hora local em que o evento novo começa. */
export const HORA_PADRAO_DE_INICIO = 9;

/** A hora local em que o evento novo termina — no MESMO dia. */
export const HORA_PADRAO_DE_TERMINO = 18;

/**
 * A janela sugerida para um evento novo: 09:00 → 18:00, no MESMO dia, daqui a trinta
 * dias.
 *
 * `agora` é parâmetro (e não `new Date()` lá dentro) porque o instante é resolvido uma
 * vez na página e porque um teste precisa poder dizer "hoje é este dia" — sem isso a
 * única forma de verificar o padrão seria esperar 24 h.
 */
export function defaultEventPeriod(agora: Date): { startsAt: Date; endsAt: Date } {
  const startsAt = new Date(agora.getTime() + DIAS_ATE_O_EVENTO_PADRAO * 86_400_000);

  startsAt.setHours(HORA_PADRAO_DE_INICIO, 0, 0, 0);

  /**
   * O término nasce do INÍCIO já assentado e recebe a hora própria: somar dezoito
   * horas ao início funcionaria hoje e quebraria em qualquer dia que não tivesse
   * exatamente 24 h (horário de verão) — e o defeito seria "o evento termina às 17h",
   * que ninguém ligaria à causa.
   */
  const endsAt = new Date(startsAt.getTime());
  endsAt.setHours(HORA_PADRAO_DE_TERMINO, 0, 0, 0);

  return { startsAt, endsAt };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quando o campo do endereço da sala online APARECE no formulário
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As modalidades em que faz sentido ter sala online.
 *
 * Espelha o enum `EventModality` do schema, como todo o domínio desta casa: o
 * domínio não importa o ORM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A UNIÃO PASSOU A SER DECLARADA EM `event-modality-rules.ts` (FASE 69)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Ela nasceu aqui na FASE 68 e a FASE 69 precisou do MESMO conjunto para os rótulos
 *  ("Presencial · Online · Híbrido") que seis telas repetiam à mão. Duas declarações
 *  da mesma união divergiriam no dia em que um valor novo entrasse — e a divergência
 *  seria silenciosa, porque as duas continuariam compilando. A união mora agora no
 *  módulo dos rótulos; este re-export existe para os importadores antigos (o
 *  formulário de evento novo) continuarem funcionando sem mudança.
 */
export type { EventModalityValue } from '@/domain/events/event-modality-rules';

/** Por que o campo está na tela. */
export type OnlineRoomFieldReason = 'MODALITY' | 'SAVED';

export interface OnlineRoomFieldVisibility {
  /** O campo deve ser DESENHADO? (a decisão é do servidor — ver o bloco abaixo.) */
  show: boolean;
  /**
   * Por que ele está na tela — `null` quando não está.
   *
   * `MODALITY` é o caso comum: o evento/atividade é online ou híbrido e o endereço é
   * parte do que se preenche. `SAVED` é o caso que protege o DADO: a modalidade foi
   * trocada para presencial, mas há endereço gravado, e o organizador precisa poder
   * **ver e limpar** o que está salvo.
   */
  reason: OnlineRoomFieldReason | null;
  /** A frase que aparece ACIMA do campo quando ele veio de `SAVED`. */
  notice: string | null;
  /** A dica do campo (a frase de rodapé que já existia). */
  hint: string;
}

/**
 * O campo "Endereço da sala online" aparece?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS DUAS CONDIÇÕES, E POR QUE SÃO DUAS
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. **A modalidade é `ONLINE` ou `HYBRID`** — é quando o endereço é parte do que se
 *     preenche. Num evento presencial sem endereço gravado o campo é ruído: ele
 *     convida a colar um link que não vale para ninguém.
 *  2. **Já existe endereço gravado** (`existingUrl` não vazio) — e aqui a condição
 *     não é sobre o preenchimento, é sobre o DADO. O organizador que trocou a
 *     modalidade para Presencial continua com o endereço no banco; esconder o campo
 *     sem mais tiraria dele a única forma de VER e LIMPAR o que está salvo. Sumir com
 *     o valor da tela sem caminho de volta é o defeito — não o conserto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO É TOMADA NO SERVIDOR (e isso resolve o "sem JavaScript")
 * ─────────────────────────────────────────────────────────────────────────────
 *  A função é chamada na RENDERIZAÇÃO do formulário, e o campo simplesmente não é
 *  desenhado quando `show` é falso. Não há JavaScript, não há CSS escondendo nada e
 *  não há estado de cliente: o formulário funciona igual com o JS desligado, porque
 *  nunca houve JS nesta decisão.
 *
 *  A contrapartida é declarada, porque ela existe: trocar a modalidade no
 *  `<select>` **não** faz o campo aparecer na hora — não há hidratação olhando para
 *  o select. O organizador escolhe "Online", salva, e o campo está lá no formulário
 *  recarregado. É uma volta a mais no caso de quem CRIA um evento online, e é o preço
 *  de a regra ser uma só, no servidor, em vez de duas (uma no servidor e outra no
 *  cliente, que divergiriam).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  ISTO **NÃO** É A BARREIRA DE SEGURANÇA DO ENDEREÇO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Esconder o campo é conveniência de formulário. Quem vê o endereço GRAVADO é
 *  decidido pela regra da fatia 3 (`online-room-rules.ts`), no servidor, sobre a
 *  projeção — e ela vale igual para o endereço de um evento presencial que tenha
 *  ficado no banco. Um evento `IN_PERSON` com endereço gravado continua mostrando o
 *  endereço SÓ para quem tem lugar.
 */
export function onlineRoomFieldVisibility(input: {
  /**
   * A modalidade do EVENTO ou da ATIVIDADE.
   *
   * É `string` porque é assim que a projeção do painel entrega o campo
   * (`AdminEventDetail.modality`), e porque o valor vem do banco: um valor que este
   * código não conhece cai em "não mostra o campo", que é a leitura conservadora —
   * mostrar um campo de sala online num valor desconhecido seria convidar a preencher
   * o que não vale. Os valores reais estão em `EventModalityValue`.
   */
  modality: string;
  /** O endereço já gravado, se houver. */
  existingUrl?: string | null;
  /**
   * A dica do campo, quando o chamador tem uma frase melhor.
   *
   * O EVENTO fala de inscrição no evento; a ATIVIDADE fala de quem tem lugar NAQUELA
   * atividade (uma oficina aberta recebe pela inscrição no evento, um minicurso
   * fechado exige a dele). As duas frases já existiam e estão certas — o padrão daqui
   * é o do evento, e a programação passa o dela.
   */
  hint?: string;
}): OnlineRoomFieldVisibility {
  const hint =
    input.hint ?? 'Só http:// ou https://. Mostrado apenas a quem tem inscrição (ou à equipe).';

  const saved = (input.existingUrl ?? '').trim().length > 0;
  const byModality = input.modality === 'ONLINE' || input.modality === 'HYBRID';

  if (byModality) {
    return { show: true, reason: 'MODALITY', notice: null, hint };
  }

  if (saved) {
    return {
      show: true,
      reason: 'SAVED',
      /**
       * A frase diz as DUAS coisas que o organizador precisa saber: por que o campo
       * está ali (a modalidade não é mais online) e que o valor continua gravado.
       * Sem a segunda, a leitura natural seria "então já foi apagado".
       */
      notice:
        'Este endereço continua gravado mesmo com a modalidade atual. Ele segue valendo para quem tem lugar; limpe o campo se a sala não existe mais.',
      hint,
    };
  }

  return { show: false, reason: null, notice: null, hint };
}
