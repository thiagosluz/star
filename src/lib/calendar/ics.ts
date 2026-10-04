/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FORMATAÇÃO — Arquivo de calendário (.ics, RFC 5545) e URL do Google Calendar
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO MORA NO DOMÍNIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O domínio decide QUEM entra na grade, com que marca e em que ordem
 *  (`src/domain/agenda/agenda-rules.ts`). Aqui não há decisão nenhuma: há
 *  FORMATAÇÃO de um padrão externo — e trocar o formato do arquivo não pode
 *  mudar a regra, nem a regra pode depender dos caprichos do RFC.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS ARMADILHAS DO RFC 5545 QUE QUEBRAM EM SILÊNCIO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um `.ics` malformado não dá erro em lugar nenhum: o arquivo abre, o programa
 *  não reclama e o compromisso simplesmente NÃO APARECE — ou aparece cortado, com
 *  o título pela metade. Cada item abaixo existe por causa disso, e cada um tem
 *  teste próprio:
 *
 *    1. CRLF EM TODA LINHA. O RFC exige `\r\n`; há cliente que ignora o arquivo
 *       inteiro se a primeira linha vier com `\n`. Aqui a quebra é montada UMA vez,
 *       no fim (`foldAndJoin`) — nenhuma propriedade carrega quebra própria.
 *
 *    2. DOBRA DE LINHA EM 75 OCTETOS, CONTADA EM **BYTES**. O limite do RFC é de
 *       octetos, não de caracteres: uma linha com acento (`ç` = 2 bytes, `ã` = 2)
 *       estoura o limite antes do que a contagem de caracteres sugere. E a dobra
 *       NÃO PODE PARTIR UM CARACTERE UTF-8 NO MEIO: cortar `ç` em um byte produz
 *       sequência inválida e o cliente descarta a propriedade — foi assim que
 *       "Introdução à Computação" virou evento sem nome. A dobra aqui percorre
 *       CODE POINTS e mede o tamanho de cada um em bytes.
 *
 *    3. ESCAPE DE `\`, `,`, `;` E QUEBRA DE LINHA. O `,` separa valores de uma
 *       mesma propriedade e o `;` separa PARÂMETROS: sem escape, "Silva, Ana"
 *       vira dois valores e o `;` de um título partido transforma o resto em
 *       parâmetro — em qualquer um dos casos o texto sai diferente do que a
 *       pessoa escreveu.
 *
 *    4. `UID` ESTÁVEL. O identificador do evento é o que faz o aplicativo
 *       ATUALIZAR o compromisso em vez de criar outro. Derivá-lo do título ou do
 *       horário faria cada edição da atividade virar um evento duplicado na agenda
 *       de quem já importou. Aqui ele sai do ID DA ATIVIDADE e de mais nada.
 *
 *    5. `DTSTAMP` OBRIGATÓRIO. É o instante em que o arquivo foi gerado. Sem ele,
 *       há cliente que recusa o VEVENT inteiro. Ele é injetável (`now`) porque
 *       teste com relógio de parede é teste que falha no dia seguinte.
 *
 *    6. HORÁRIO EM UTC. O compromisso é gravado com `Z` (UTC) a partir do
 *       INSTANTE da atividade — que já é UTC no banco (`TIMESTAMPTZ`). O fuso do
 *       evento NÃO entra na conversão do instante (ele não muda o instante!);
 *       entra no rótulo legível da descrição, que é o que a pessoa lê no celular.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { formatZonedDateTime, isValidTimeZone } from '@/domain/events/scheduling-rules';

/** Limite de octetos por linha física, SEM o CRLF (RFC 5545, §3.1). */
const FOLD_LIMIT = 75;

/** A linha de continuação começa com UM espaço — e ele conta no limite. */
const FOLD_CONTINUATION = '\r\n ';
const CONTINUATION_LIMIT = FOLD_LIMIT - 1;

const DEFAULT_PRODID = '-//EventFlow//Agenda do participante//PT-BR';
const DEFAULT_UID_DOMAIN = 'eventflow';

/** O que o gerador precisa saber sobre uma atividade — nada mais. */
export interface CalendarItem {
  /** Id da atividade: é dele que sai o `UID` estável (ver armadilha 4). */
  activityId: string;
  title: string;
  /** Instantes (UTC). O banco guarda `TIMESTAMPTZ`; não há hora de parede aqui. */
  startsAt: Date;
  endsAt: Date;
  /** Fuso do EVENTO, só para o rótulo legível da descrição. */
  timezone: string;
  location?: string | null;
  description?: string | null;
}

export interface IcsOptions {
  /** Relógio do `DTSTAMP`. Injetável para o teste ser determinístico. */
  now?: Date;
  /** `PRODID` do arquivo — identifica quem gerou. */
  prodId?: string;
  /** Sufixo do `UID`. Trocar o domínio gera eventos NOVOS no cliente. */
  uidDomain?: string;
  /** Nome do calendário (`X-WR-CALNAME`), exibido pelo aplicativo. */
  calendarName?: string;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Texto: escape e dobra
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Escapa um valor de TEXTO do RFC 5545.
 *
 * A ordem importa: a barra invertida vem PRIMEIRO, senão as barras que o próprio
 * escape acabou de inserir seriam escapadas de novo (`\,` viraria `\\,`).
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Codificador UTF-8 do runtime — é ele que dá o tamanho REAL em octetos. */
const utf8 = new TextEncoder();

/**
 * Dobra uma linha lógica no limite de 75 octetos (armadilha 2).
 *
 * A iteração é por CODE POINT (`for...of` percorre a string por pontos de código,
 * não por unidades UTF-16): assim um caractere fora do BMP (emoji, por exemplo)
 * nunca é partido no meio do par substituto — e, medido em bytes, nunca é partido
 * no meio da sequência UTF-8.
 *
 * A primeira linha usa os 75 octetos inteiros; as continuações usam 74, porque o
 * espaço inicial de cada uma É parte da linha física.
 */
export function foldIcsLine(line: string): string {
  const pieces: string[] = [];
  let current = '';
  let used = 0;
  let limit = FOLD_LIMIT;

  for (const character of line) {
    const size = utf8.encode(character).length;

    /**
     * `used > 0` na condição: um caractere sozinho maior que o limite (impossível
     * em UTF-8, cujo máximo é 4 octetos) entraria em laço infinito de quebras. Com
     * a guarda, ele é aceito na linha e o arquivo continua legível.
     */
    if (used > 0 && used + size > limit) {
      pieces.push(current);
      current = '';
      used = 0;
      limit = CONTINUATION_LIMIT;
    }

    current += character;
    used += size;
  }

  pieces.push(current);

  return pieces.join(FOLD_CONTINUATION);
}

/** Junta as linhas lógicas com CRLF (armadilha 1), dobrando cada uma. */
function foldAndJoin(lines: readonly string[]): string {
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  Datas
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Instante → selo UTC do RFC 5545 (`20261201T210000Z`).
 *
 * Lança para data inválida de propósito: `toISOString()` de um `Date` inválido
 * lança `RangeError`, e a alternativa seria gravar "NaN" no arquivo — o
 * compromisso desapareceria sem ninguém saber por quê. Falhar alto aqui é a mesma
 * escolha do `db` sem contexto de tenant.
 */
export function toUtcStamp(instant: Date): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error('Data inválida: não é possível gerar o selo UTC do calendário.');
  }

  const iso = instant.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/**
 * A descrição que o arquivo leva: o texto do organizador MAIS o horário local.
 *
 * O `DTSTART` sai em UTC (é o que o cliente precisa); quem abre o compromisso em
 * Salvador, porém, lê a hora que está no corpo do evento. Sem esta linha, uma
 * atividade das 18:00 apareceria como 21:00 para quem lesse a descrição.
 */
function describeItem(item: CalendarItem): string {
  const timezone = isValidTimeZone(item.timezone) ? item.timezone : 'UTC';
  const own = item.description?.trim();

  const localLabel = `Horário local: ${formatZonedDateTime(item.startsAt, timezone)} a ${formatZonedDateTime(item.endsAt, timezone)} (${timezone})`;

  return own ? `${own}\n${localLabel}` : localLabel;
}

/** O `UID` estável de uma atividade (armadilha 4). */
function uidFor(item: CalendarItem, domain: string): string {
  return `${item.activityId}@${domain}`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  VEVENT / VCALENDAR
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As linhas lógicas de UM VEVENT (sem dobra e sem CRLF — quem junta é `foldAndJoin`).
 *
 * A ordem das propriedades não é contrato do RFC; é a ordem em que qualquer pessoa
 * lê o arquivo aberto no editor de texto: identificação, quando, o quê, onde.
 */
function veventLines(item: CalendarItem, options: Required<Pick<IcsOptions, 'now' | 'uidDomain'>>): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uidFor(item, options.uidDomain)}`,
    `DTSTAMP:${toUtcStamp(options.now)}`,
    `DTSTART:${toUtcStamp(item.startsAt)}`,
    `DTEND:${toUtcStamp(item.endsAt)}`,
    `SUMMARY:${escapeIcsText(item.title)}`,
  ];

  const location = item.location?.trim();
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  /**
   * A descrição NUNCA é vazia: ela sempre carrega o horário local (`describeItem`),
   * então não há ramo "sem descrição" a tratar — e um `if` que nunca é falso é
   * ruído.
   */
  lines.push(`DESCRIPTION:${escapeIcsText(describeItem(item))}`);

  lines.push('END:VEVENT');

  return lines;
}

/**
 * O `.ics` de UMA atividade.
 *
 * Lança quando a atividade não tem horário válido: um arquivo com `VCALENDAR` e
 * nenhum evento é um arquivo que não faz nada, e engolir o erro esconderia o
 * defeito de quem chamou.
 */
export function buildActivityIcs(item: CalendarItem, options: IcsOptions = {}): string {
  return calendarLines(
    [item],
    options,
    options.calendarName ?? item.title,
  );
}

/**
 * O `.ics` da GRADE INTEIRA — um VEVENT por atividade.
 *
 * Item sem horário válido é PULADO, e não motivo de falha: a grade vem do banco e
 * um único item corrompido não pode custar o arquivo inteiro a quem vai viajar.
 * (É a mesma régua da sobreposição: sem horário, o item não ocupa tempo.)
 */
export function buildScheduleIcs(items: readonly CalendarItem[], options: IcsOptions = {}): string {
  const valid = items.filter(
    (item) =>
      item.startsAt instanceof Date &&
      item.endsAt instanceof Date &&
      Number.isFinite(item.startsAt.getTime()) &&
      Number.isFinite(item.endsAt.getTime()),
  );

  return calendarLines(valid, options, options.calendarName ?? 'Minha agenda');
}

/** O corpo comum aos dois arquivos: cabeçalho, VEVENTs e rodapé. */
function calendarLines(
  items: readonly CalendarItem[],
  options: IcsOptions,
  calendarName: string,
): string {
  const now = options.now ?? new Date();
  const uidDomain = options.uidDomain ?? DEFAULT_UID_DOMAIN;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${options.prodId ?? DEFAULT_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const item of items) {
    lines.push(...veventLines(item, { now, uidDomain }));
  }

  lines.push('END:VCALENDAR');

  return foldAndJoin(lines);
}

// ───────────────────────────────────────────────────────────────────────────────
//  Google Calendar (a fatia 3 só consome)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * URL do "adicionar ao Google Calendar" para UMA atividade.
 *
 * O formulário é `https://calendar.google.com/calendar/render?action=TEMPLATE`, e
 * o parâmetro `dates` é `inicio/fim` no MESMO selo UTC do `.ics`
 * (`20261201T210000Z/20261201T223000Z`) — é o formato que o Google documenta, e
 * mandar hora de parede com fuso no lugar dele agenda no horário errado.
 *
 * `URLSearchParams` faz a codificação: vírgula, acento, `&` e o próprio `/` do
 * intervalo saem escapados, que é o que impede um título com `&` de partir a URL
 * em dois parâmetros.
 */
export function googleCalendarUrl(item: CalendarItem): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates: `${toUtcStamp(item.startsAt)}/${toUtcStamp(item.endsAt)}`,
    details: describeItem(item),
  });

  const location = item.location?.trim();
  if (location) params.set('location', location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
