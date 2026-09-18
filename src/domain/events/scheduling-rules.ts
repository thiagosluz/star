/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Data/hora em fuso (FASE 24, item E17)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTE MÓDULO CORRIGE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `<input type="datetime-local">` envia `AAAA-MM-DDTHH:MM` **sem fuso**. Até a
 *  FASE 23, `new Date(texto)` interpretava esse valor no fuso do PROCESSO — que em
 *  produção é UTC. O organizador digitava "seis da tarde" e a página entrava no ar
 *  às três da tarde, três horas antes, sem nenhum erro e sem nada na tela
 *  explicando por quê.
 *
 *  A correção usa o fuso do EVENTO (o mesmo que a página pública exibe no rodapé:
 *  "Horários em America/Bahia"). É o fuso em que o organizador pensa quando marca
 *  uma data para o PRÓPRIO evento — e não depende de onde ele está no momento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CONVERSÃO É FEITA EM DUAS PASSAGENS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O deslocamento de um fuso depende do INSTANTE (horário de verão). Para converter
 *  a hora de parede em instante, é preciso saber o deslocamento — que depende do
 *  instante que ainda não conhecemos. A saída é iterar: o primeiro palpite usa o
 *  deslocamento da hora de parede tratada como UTC e o segundo corrige com o
 *  deslocamento do instante encontrado. Duas passagens bastam para todos os fusos
 *  reais (as transições acontecem em blocos de 30/60 minutos, e a diferença entre
 *  a hora de parede e o resultado é de poucas horas).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Formato aceito: o que `<input type="datetime-local">` envia (segundos opcionais). */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Nome do fuso do processo, usado como último recurso. */
export function processTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * O fuso é válido (e suportado pelo runtime)?
 *
 * Validar importa porque o valor vem de `Event.timezone` — campo de texto que já
 * existia. Um fuso inválido não pode virar data errada em silêncio: quem chama
 * decide entre recusar e cair no UTC.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Partes da hora de parede em um fuso, para um instante. */
function zonedParts(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(instant);
  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type)?.value ?? '0';
    const value = Number(found);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // Alguns runtimes devolvem "24" para a meia-noite mesmo com `h23`.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/**
 * Deslocamento do fuso, em minutos, no instante informado.
 *
 * Positivo a leste de Greenwich (Europa/Brasília… não: Brasília é UTC-3, logo
 * −180), negativo a oeste.
 */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Converte hora de parede + fuso em instante.
 *
 * `"2026-12-01T18:00"` + `"America/Bahia"` → `2026-12-01T21:00:00.000Z`.
 *
 * Devolve `null` quando o texto não é uma data/hora válida ou o fuso é
 * desconhecido — o chamador transforma isso em mensagem para o organizador.
 */
export function zonedWallTimeToInstant(wallTime: string, timeZone: string): Date | null {
  const match = WALL_TIME.exec(wallTime.trim());
  if (!match) return null;

  if (!isValidTimeZone(timeZone)) return null;

  const [, year, month, day, hour, minute, second] = match;
  const wallAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    second ? Number(second) : 0,
  );

  if (!Number.isFinite(wallAsUtc)) return null;

  // Duas passagens (ver o cabeçalho): o primeiro palpite trata a hora de parede
  // como UTC só para descobrir o deslocamento; o segundo usa o do instante achado.
  const firstGuess = new Date(wallAsUtc - zoneOffsetMinutes(timeZone, new Date(wallAsUtc)) * 60_000);
  return new Date(wallAsUtc - zoneOffsetMinutes(timeZone, firstGuess) * 60_000);
}

/**
 * Caminho inverso: instante → valor para `<input type="datetime-local">`.
 *
 * Sem isto, o campo mostraría a hora em UTC e o organizador veria "21:00" onde
 * digitou "18:00" — e salvar de novo deslocaria a data outra vez.
 */
export function instantToZonedWallTime(instant: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const parts = zonedParts(instant, zone);

  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Data/hora legível no fuso do evento, para mensagens e listas (pt-BR). */
export function formatZonedDateTime(instant: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: zone,
  }).format(instant);
}
