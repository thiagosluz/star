/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Formatadores de citação acadêmica (FASE 111 · custo zero)
 *
 *  Gera referências bibliográficas prontas para copiar ou baixar nos padrões
 *  ABNT (NBR 6023), APA (7ª ed.), BibTeX (.bib) e RIS (.ris) sem API paga.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type { ProceedingsAuthorView } from '@/domain/proceedings/proceedings-rules';

export interface ProceedingsVolumeCitationMeta {
  title: string;
  volumeLabel: string | null;
  editionYear: number;
  editors: string | null;
  isbn: string | null;
  issn: string | null;
  publisherName: string | null;
  eventTitle: string;
  eventCity: string | null;
  institutionName: string;
}

export interface ProceedingsWorkCitationMeta {
  protocol: string;
  title: string;
  authors: readonly ProceedingsAuthorView[];
  sectionName: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  externalDoi: string | null;
  abstractUrl: string;
  pdfUrl: string | null;
  keywords: readonly string[];
  language: string;
}

const BRAZILIAN_SUFFIXES = new Set([
  'FILHO',
  'FILHA',
  'JUNIOR',
  'JÚNIOR',
  'NETO',
  'NETA',
  'SOBRINHO',
  'SOBRINHA',
]);

const PT_MONTHS_SHORT = [
  'jan.',
  'fev.',
  'mar.',
  'abr.',
  'maio',
  'jun.',
  'jul.',
  'ago.',
  'set.',
  'out.',
  'nov.',
  'dez.',
];

function splitPersonName(fullName: string): { surname: string; givenNames: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { surname: parts[0] ?? 'Autor', givenNames: '' };
  }

  const last = parts[parts.length - 1]!;
  if (parts.length >= 3 && BRAZILIAN_SUFFIXES.has(last.toUpperCase())) {
    const compoundSurname = `${parts[parts.length - 2]} ${last}`;
    return {
      surname: compoundSurname,
      givenNames: parts.slice(0, -2).join(' '),
    };
  }

  return {
    surname: last,
    givenNames: parts.slice(0, -1).join(' '),
  };
}

export function formatAbntAuthor(fullName: string): string {
  const { surname, givenNames } = splitPersonName(fullName);
  const upperSurname = surname.toLocaleUpperCase('pt-BR');
  return givenNames ? `${upperSurname}, ${givenNames}` : upperSurname;
}

export function formatApaAuthor(fullName: string): string {
  const { surname, givenNames } = splitPersonName(fullName);
  if (!givenNames) return surname;

  const particles = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const initials = givenNames
    .split(/\s+/)
    .filter((token) => token && !particles.has(token.toLowerCase()))
    .map((token) => `${token[0]!.toLocaleUpperCase('pt-BR')}.`)
    .join(' ');

  return initials ? `${surname}, ${initials}` : surname;
}

export function formatBibtexAuthor(fullName: string): string {
  const { surname, givenNames } = splitPersonName(fullName);
  return givenNames ? `${surname}, ${givenNames}` : surname;
}

function pageRangeText(pageStart: number | null, pageEnd: number | null): string | null {
  if (pageStart === null && pageEnd === null) return null;
  if (pageStart !== null && pageEnd !== null) {
    return pageStart === pageEnd ? `${pageStart}` : `${pageStart}-${pageEnd}`;
  }
  return `${pageStart ?? pageEnd}`;
}

function sortedAuthors(authors: readonly ProceedingsAuthorView[]): ProceedingsAuthorView[] {
  return [...authors].sort((a, b) => a.order - b.order);
}

/** Formatação ABNT NBR 6023 para trabalho em anais de evento. */
export function formatAbntCitation(
  work: ProceedingsWorkCitationMeta,
  volume: ProceedingsVolumeCitationMeta,
  accessDate: Date = new Date('2026-11-14T12:00:00Z'),
): string {
  const authors = sortedAuthors(work.authors);
  const authorsPart =
    authors.length === 0
      ? 'AUTOR DESCONHECIDO.'
      : authors.length > 3
        ? `${formatAbntAuthor(authors[0]!.name)} et al.`
        : `${authors.map((a) => formatAbntAuthor(a.name)).join('; ')}.`;

  const publisher = volume.publisherName?.trim() || volume.institutionName.trim();
  const city = volume.eventCity?.trim();
  const eventHeader = [volume.eventTitle.trim(), `${volume.editionYear}`, city]
    .filter(Boolean)
    .join(', ');

  const pages = pageRangeText(work.pageStart, work.pageEnd);
  const accessDay = String(accessDate.getUTCDate()).padStart(2, '0');
  const accessMonth = PT_MONTHS_SHORT[accessDate.getUTCMonth()] ?? 'nov.';
  const accessYear = accessDate.getUTCFullYear();

  const segments: string[] = [
    `${authorsPart} ${work.title.trim()}.`,
    `In: ${eventHeader}. Anais [...].`,
    `${city ? `${city}: ` : ''}${publisher}, ${volume.editionYear}.`,
  ];

  if (pages) segments.push(`p. ${pages}.`);
  if (volume.issn) segments.push(`ISSN ${volume.issn}.`);
  if (volume.isbn) segments.push(`ISBN ${volume.isbn}.`);
  if (work.externalDoi) segments.push(`DOI: ${work.externalDoi}.`);
  segments.push(`Disponível em: ${work.abstractUrl}. Acesso em: ${accessDay} ${accessMonth} ${accessYear}.`);

  return segments.join(' ').replace(/\.\./g, '.').replace(/\s+/g, ' ').trim();
}

/** Formatação APA 7ª edição. */
export function formatApaCitation(
  work: ProceedingsWorkCitationMeta,
  volume: ProceedingsVolumeCitationMeta,
): string {
  const authors = sortedAuthors(work.authors);
  const apaNames = authors.map((a) => formatApaAuthor(a.name));

  let authorsPart = 'Autor desconhecido';
  if (apaNames.length === 1) {
    authorsPart = apaNames[0]!;
  } else if (apaNames.length > 1 && apaNames.length <= 20) {
    authorsPart = `${apaNames.slice(0, -1).join(', ')}, & ${apaNames[apaNames.length - 1]}`;
  } else if (apaNames.length > 20) {
    authorsPart = `${apaNames.slice(0, 19).join(', ')}, ... ${apaNames[apaNames.length - 1]}`;
  }

  const publisher = volume.publisherName?.trim() || volume.institutionName.trim();
  const pages = pageRangeText(work.pageStart, work.pageEnd);
  const pagesPart = pages ? ` (p. ${pages})` : '';
  const container = volume.editors?.trim()
    ? `Em ${volume.editors.trim()} (Org.), ${volume.title.trim()}${pagesPart}.`
    : `Em ${volume.title.trim()}${pagesPart}.`;

  const locator = work.externalDoi
    ? `https://doi.org/${work.externalDoi}`
    : work.abstractUrl;

  return `${authorsPart} (${volume.editionYear}). ${work.title.trim()}. ${container} ${publisher}. ${locator}`
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeBibtex(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');
}

export function buildBibtexKey(protocol: string, year: number): string {
  const cleanProtocol = protocol.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `koveno_${year}_${cleanProtocol || 'trabalho'}`;
}

/** Gera entrada BibTeX `@inproceedings`. */
export function formatBibtexCitation(
  work: ProceedingsWorkCitationMeta,
  volume: ProceedingsVolumeCitationMeta,
): string {
  const authors = sortedAuthors(work.authors)
    .map((a) => formatBibtexAuthor(a.name))
    .join(' and ');

  const key = buildBibtexKey(work.protocol, volume.editionYear);
  const publisher = volume.publisherName?.trim() || volume.institutionName.trim();
  const pages = pageRangeText(work.pageStart, work.pageEnd);

  const fields: Array<[string, string]> = [
    ['author', authors || 'Autor desconhecido'],
    ['title', work.title.trim()],
    ['booktitle', volume.title.trim()],
    ['year', String(volume.editionYear)],
    ['publisher', publisher],
  ];

  if (volume.volumeLabel) fields.push(['volume', volume.volumeLabel.trim()]);
  if (volume.editors) fields.push(['editor', volume.editors.trim()]);
  if (volume.eventCity) fields.push(['address', volume.eventCity.trim()]);
  if (pages) fields.push(['pages', pages.replace('-', '--')]);
  if (volume.issn) fields.push(['issn', volume.issn]);
  if (volume.isbn) fields.push(['isbn', volume.isbn]);
  if (work.externalDoi) fields.push(['doi', work.externalDoi]);
  fields.push(['url', work.abstractUrl]);
  if (work.keywords.length > 0) fields.push(['keywords', work.keywords.join(', ')]);

  const lines = fields.map(([k, v]) => `  ${k} = {${escapeBibtex(v)}}`);
  return `@inproceedings{${key},\n${lines.join(',\n')}\n}\n`;
}

/** Gera registro RIS para gerenciadores de referências (Zotero, Mendeley, EndNote). */
export function formatRisCitation(
  work: ProceedingsWorkCitationMeta,
  volume: ProceedingsVolumeCitationMeta,
): string {
  const authors = sortedAuthors(work.authors);
  const publisher = volume.publisherName?.trim() || volume.institutionName.trim();

  const lines: string[] = [
    'TY  - CONF',
    `TI  - ${work.title.trim()}`,
    ...authors.map((a) => `AU  - ${formatBibtexAuthor(a.name)}`),
    `T2  - ${volume.title.trim()}`,
    `C3  - ${volume.eventTitle.trim()}`,
    `PY  - ${volume.editionYear}`,
    `PB  - ${publisher}`,
  ];

  if (volume.eventCity) lines.push(`CY  - ${volume.eventCity.trim()}`);
  if (volume.volumeLabel) lines.push(`VL  - ${volume.volumeLabel.trim()}`);
  if (work.pageStart !== null) lines.push(`SP  - ${work.pageStart}`);
  if (work.pageEnd !== null) lines.push(`EP  - ${work.pageEnd}`);
  if (volume.issn || volume.isbn) lines.push(`SN  - ${volume.issn ?? volume.isbn}`);
  if (work.externalDoi) lines.push(`DO  - ${work.externalDoi}`);
  lines.push(`UR  - ${work.abstractUrl}`);
  for (const kw of work.keywords) {
    if (kw.trim()) lines.push(`KW  - ${kw.trim()}`);
  }
  lines.push(`LA  - ${work.language}`);
  lines.push('ER  - ');

  return `${lines.join('\r\n')}\r\n`;
}
