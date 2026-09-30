/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Exportação de dados pessoais (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O ARQUIVO SAI DA PLATAFORMA; A MARCA D'ÁGUA É O QUE VOLTA COM ELE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A trilha registra quem exportou (FASE 32), e isso protege a instituição do
 *  ESQUECIMENTO — não da cópia. O CSV com e-mail completo passa a viver em pasta
 *  compartilhada, anexo de e-mail e pen drive, e nada no arquivo dizia de onde ele
 *  veio. A dívida E44 pediu três coisas, e as três estão aqui: **marca d'água com
 *  autor e data**, **prazo declarado** e o caminho para a retenção.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MARCA APARECE DUAS VEZES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O bloco de procedência no topo conta a história inteira (autor, instituição,
 *  instante, filtros e validade) — mas ele MORRE na primeira linha copiada. Quem
 *  copia cinco nomes e cola num grupo leva só as células, e é esse o vazamento
 *  comum. Por isso a ÚLTIMA COLUNA repete autor, instante e validade em cada linha:
 *  a linha copiada continua dizendo de onde veio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESCAPE É UM SÓ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O CSV do diretório usava `csvCell` do domínio e o de contatos do patrocinador
 *  tinha a PRÓPRIA versão de escape. Duas cópias da mesma regra divergem — e a que
 *  divergiria primeiro é a de FÓRMULA (`=`, `+`, `-`, `@`), que é justamente a que
 *  impede o arquivo de virar execução na máquina de quem abre. Toda exportação
 *  passa por `buildWatermarkedCsv`, que aplica `csvCell` a TUDO — inclusive à marca
 *  d'água, porque o nome de quem exportou também é texto de fora.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { csvCell, type CsvValue } from '@/domain/participants/participant-rules';

export const EXPORT_KINDS = ['PARTICIPANTS_CSV', 'SPONSOR_CONTACTS_CSV'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_KIND_LABELS: Readonly<Record<ExportKind, string>> = {
  PARTICIPANTS_CSV: 'Diretório de participantes',
  SPONSOR_CONTACTS_CSV: 'Contatos de patrocinador',
};

/** Nome do arquivo (sem extensão) — o `slug` da instituição entra depois. */
export const EXPORT_KIND_FILE_SLUG: Readonly<Record<ExportKind, string>> = {
  PARTICIPANTS_CSV: 'participantes',
  SPONSOR_CONTACTS_CSV: 'contatos',
};

/**
 * Prazo do link: 24 horas.
 *
 * Curto o bastante para o arquivo não viver semanas numa pasta compartilhada, e
 * longo o bastante para quem exportou na reunião baixar de novo no dia seguinte —
 * que é o uso real. Passado o prazo, baixar exige uma NOVA exportação, e isso é o
 * ponto: cada liberação de dado pessoal é um ato com autor, e não um endereço que
 * existe para sempre.
 */
export const EXPORT_TTL_HOURS = 24;

/** Texto que a tela mostra ANTES de exportar (e que vai no arquivo). */
export const EXPORT_WATERMARK_NOTICE =
  'O arquivo leva o seu nome, a instituição, a data e a validade em cada linha, e o link para baixá-lo de novo vale ' +
  `${EXPORT_TTL_HOURS} horas.`;

/** Título da coluna final — a marca que sobrevive à cópia de uma linha. */
export const EXPORT_WATERMARK_COLUMN = 'Exportado por';

/**
 * O que a lista de exportações diz quando NINGUÉM baixou (dívida E73 · FASE 51).
 *
 * A linha fica, mesmo vazia de download: ausência de texto é lida como tela
 * quebrada, e a instituição não sabe se ninguém baixou ou se o sistema não conta.
 */
export const EXPORT_NO_DOWNLOADERS_LABEL = 'ninguém baixou ainda';

/**
 * Quem baixou, em uma linha.
 *
 * O contador (`downloadCount`) e a trilha podem discordar — a trilha vive em
 * partições mensais e a retenção das antigas é decisão em aberto (dívida B8). Nesse
 * caso a tela NÃO inventa autor nem afirma que ninguém baixou: diz o que sabe.
 *
 * Os instantes saem no fuso do processo, como a data da exportação na linha de
 * cima: as duas linhas da MESMA lista precisam falar a mesma língua.
 */
export function exportDownloadersLabel(input: {
  downloaders: readonly { name: string; at: Date }[];
  downloadCount: number;
}): string {
  if (input.downloaders.length === 0) {
    return input.downloadCount > 0 ? 'quem baixou não está na trilha exibida' : EXPORT_NO_DOWNLOADERS_LABEL;
  }

  const names = input.downloaders
    .map(
      (downloader) =>
        `${downloader.name} (${downloader.at.toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        })})`,
    )
    .join(', ');

  const hidden = input.downloadCount - input.downloaders.length;

  return `baixado por ${names}${hidden > 0 ? ` · +${hidden} download(s)` : ''}`;
}

export const EXPORT_FILTER_LABELS: Readonly<Record<string, string>> = {
  query: 'Busca',
  eventId: 'Evento',
  onlyWithCertificate: 'Só com certificado',
  onlyAttended: 'Só quem compareceu',
  sponsorId: 'Patrocinador',
};

export interface ExportFilterEntry {
  label: string;
  value: string;
}

/**
 * Filtros em uma linha legível — e só os que existem.
 *
 * Filtro vazio NÃO aparece: um arquivo que diz "Busca: (vazio)" faria quem o lê
 * anos depois procurar um recorte que nunca houve.
 */
export function exportFiltersLine(entries: readonly ExportFilterEntry[]): string | null {
  const parts = entries
    .map((entry) => ({
      label: entry.label.trim(),
      value: entry.value.trim(),
    }))
    .filter((entry) => entry.label.length > 0 && entry.value.length > 0)
    .map((entry) => `${entry.label}: ${entry.value}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

export interface ExportWatermark {
  kind: ExportKind;
  tenantName: string;
  authorName: string;
  authorEmail: string;
  /** Instante de geração, no fuso da instituição. */
  generatedAt: Date;
  expiresAt: Date;
  /** Fuso da instituição (o mesmo das telas e dos documentos). */
  timezone: string;
  /** Filtros já em texto, ou `null` quando a exportação é a base inteira. */
  filtersLabel: string | null;
  exportId: string;
}

/** `28/09/2026 14:32` — o leitor do arquivo lê o dia da instituição, não o do servidor. */
export function formatExportMoment(date: Date, timezone: string): string {
  const parts = zonedParts(date, timezone);
  return `${parts.date} ${parts.time}`;
}

function zonedParts(date: Date, timezone: string): { date: string; time: string } {
  try {
    const formatter = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const map = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const date$ = `${map.get('day') ?? '??'}/${map.get('month') ?? '??'}/${map.get('year') ?? '????'}`;
    const time = `${map.get('hour') ?? '??'}:${map.get('minute') ?? '??'}`;

    return { date: date$, time };
  } catch {
    /** Fuso inválido no banco não pode impedir a exportação: cai em UTC e segue. */
    const iso = date.toISOString();
    return { date: `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`, time: iso.slice(11, 16) };
  }
}

/** Identificador curto e estável que liga o ARQUIVO à linha da trilha. */
export function shortExportId(exportId: string): string {
  return exportId.replace(/-/g, '').slice(0, 8);
}

export function exportExpiresAt(from: Date, hours: number = EXPORT_TTL_HOURS): Date {
  return new Date(from.getTime() + hours * 3_600_000);
}

/** Vencido é vencido: o instante do prazo já não vale (mesma régua do resto do sistema). */
export function isExportExpired(input: { expiresAt: Date; now?: Date }): boolean {
  const now = input.now ?? new Date();
  return input.expiresAt.getTime() <= now.getTime();
}

export function exportFileName(input: {
  kind: ExportKind;
  tenantSlug: string;
  generatedAt: Date;
}): string {
  const stamp = input.generatedAt.toISOString().slice(0, 10);
  return `${EXPORT_KIND_FILE_SLUG[input.kind]}-${input.tenantSlug}-${stamp}.csv`;
}

/**
 * Bloco de procedência: as linhas de metadados que abrem o arquivo.
 *
 * Cada linha começa com `#` para o olho humano reconhecer o que NÃO é dado, e o
 * bloco termina com uma linha vazia — sem ela, a primeira linha de dado encosta no
 * metadados e some na leitura da planilha.
 */
export function watermarkHeaderLines(watermark: ExportWatermark): string[] {
  const generated = formatExportMoment(watermark.generatedAt, watermark.timezone);
  const expires = formatExportMoment(watermark.expiresAt, watermark.timezone);

  return [
    `# ${EXPORT_KIND_LABELS[watermark.kind]} — exportação ${shortExportId(watermark.exportId)}`,
    `# Exportado por: ${watermark.authorName} <${watermark.authorEmail}>`,
    `# Instituição: ${watermark.tenantName}`,
    `# Gerado em: ${generated} (${watermark.timezone})`,
    ...(watermark.filtersLabel ? [`# Filtros: ${watermark.filtersLabel}`] : []),
    `# Válido até: ${expires} — depois disso, exporte de novo`,
    '',
  ];
}

/** O valor da coluna final: sobrevive à cópia de UMA linha. */
export function watermarkRowValue(watermark: ExportWatermark): string {
  const generated = formatExportMoment(watermark.generatedAt, watermark.timezone);
  const expires = formatExportMoment(watermark.expiresAt, watermark.timezone);

  return `${watermark.authorName} <${watermark.authorEmail}> · ${generated} · válido até ${expires} · ${shortExportId(
    watermark.exportId,
  )}`;
}

/**
 * O arquivo inteiro: metadados, cabeçalho (com a coluna da marca), linhas e rodapé.
 *
 * A ordem das colunas é CONTRATO: quem monta a planilha de destino importa por
 * posição, então a marca vai SEMPRE no fim — acrescentar coluna no meio quebraria
 * todo mundo que já usa o arquivo.
 */
export function buildWatermarkedCsv(input: {
  header: readonly string[];
  rows: readonly (readonly CsvValue[])[];
  watermark: ExportWatermark;
}): string {
  const mark = watermarkRowValue(input.watermark);
  const lines: string[] = [];

  lines.push(...watermarkHeaderLines(input.watermark).map((line) => csvCell(line)));
  lines.push([...input.header, EXPORT_WATERMARK_COLUMN].map(csvCell).join(';'));

  for (const row of input.rows) {
    lines.push([...row, mark].map(csvCell).join(';'));
  }

  lines.push(csvCell(`# Fim — exportação ${shortExportId(input.watermark.exportId)}`));

  // O BOM é o que faz o Excel pt-BR abrir os acentos certos em vez de "Ã§Ã£o".
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
