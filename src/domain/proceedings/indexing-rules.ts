/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Indexação acadêmica gratuita (FASE 111)
 *
 *  Gera:
 *    1. Metatags Highwire Press (`citation_*`) + Dublin Core (`DC.*`) para
 *       indexação direta pelo Google Acadêmico, Zotero e Mendeley;
 *    2. JSON-LD Schema.org `ScholarlyArticle`;
 *    3. XML OAI-PMH 2.0 (`oai_dc`) para colheita por BDTD, OASISBR e repositórios.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import type {
  ProceedingsVolumeCitationMeta,
  ProceedingsWorkCitationMeta,
} from '@/domain/proceedings/citation-rules';

export type ScholarlyMetaRecord = Record<string, string | string[]>;

function formatScholarlyDate(publishedAt: Date | null, fallbackYear: number): string {
  if (!publishedAt) return String(fallbackYear);
  const y = publishedAt.getUTCFullYear();
  const m = String(publishedAt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(publishedAt.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${d}`;
}

/**
 * Monta metatags Highwire Press (`citation_*`) + Dublin Core (`DC.*`) aceitas
 * pelo crawler do Google Acadêmico e pelos extratores de citações de navegadores.
 */
export function buildScholarlyMetaTags(input: {
  work: ProceedingsWorkCitationMeta & {
    abstract: string;
    publishedAt: Date | null;
  };
  volume: ProceedingsVolumeCitationMeta;
}): ScholarlyMetaRecord {
  const { work, volume } = input;
  const sorted = [...work.authors].sort((a, b) => a.order - b.order);
  const authors = sorted.map((a) => a.name.trim()).filter(Boolean);
  const institutions = sorted.map((a) => a.institution?.trim()).filter((v): v is string => Boolean(v));
  const orcids = sorted
    .map((a) => (a.orcidId ? `https://orcid.org/${a.orcidId.replace(/^https?:\/\/orcid\.org\//i, '')}` : null))
    .filter((v): v is string => Boolean(v));

  const pubDate = formatScholarlyDate(work.publishedAt, volume.editionYear);
  const publisher = volume.publisherName?.trim() || volume.institutionName.trim();

  const meta: ScholarlyMetaRecord = {
    citation_title: work.title.trim(),
    citation_publication_date: pubDate,
    citation_online_date: pubDate,
    citation_conference_title: volume.eventTitle.trim(),
    citation_publisher: publisher,
    citation_language: work.language.trim() || 'pt-BR',
    citation_abstract_html_url: work.abstractUrl,
    'DC.title': work.title.trim(),
    'DC.date': work.publishedAt ? work.publishedAt.toISOString().slice(0, 10) : String(volume.editionYear),
    'DC.publisher': publisher,
    'DC.type': 'ConferenceObject',
    'DC.language': work.language.trim() || 'pt-BR',
    'DC.description': work.abstract.trim().slice(0, 2000),
    'DC.source': volume.title.trim(),
  };

  if (authors.length > 0) {
    meta.citation_author = authors;
    meta['DC.creator'] = authors;
  }
  if (institutions.length > 0) {
    meta.citation_author_institution = institutions;
  }
  if (orcids.length > 0) {
    meta.citation_author_orcid = orcids;
  }
  if (work.pdfUrl) {
    meta.citation_pdf_url = work.pdfUrl;
  }
  if (volume.volumeLabel) {
    meta.citation_volume = volume.volumeLabel.trim();
  }
  if (work.pageStart !== null) {
    meta.citation_firstpage = String(work.pageStart);
  }
  if (work.pageEnd !== null) {
    meta.citation_lastpage = String(work.pageEnd);
  }
  if (volume.issn) {
    meta.citation_issn = volume.issn;
  }
  if (volume.isbn) {
    meta.citation_isbn = volume.isbn;
  }
  if (work.externalDoi) {
    meta.citation_doi = work.externalDoi;
  }
  if (work.keywords.length > 0) {
    meta.citation_keywords = work.keywords.join('; ');
    meta['DC.subject'] = [...work.keywords];
  }

  const dcIdentifiers = [work.abstractUrl];
  if (work.externalDoi) dcIdentifiers.push(`doi:${work.externalDoi}`);
  meta['DC.identifier'] = dcIdentifiers;

  return meta;
}

export function buildScholarlyArticleJsonLd(input: {
  work: ProceedingsWorkCitationMeta & {
    abstract: string;
    publishedAt: Date | null;
  };
  volume: ProceedingsVolumeCitationMeta;
}): Record<string, unknown> {
  const { work, volume } = input;
  const sorted = [...work.authors].sort((a, b) => a.order - b.order);

  return {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    headline: work.title.trim(),
    name: work.title.trim(),
    abstract: work.abstract.trim(),
    inLanguage: work.language.trim() || 'pt-BR',
    datePublished: (work.publishedAt ?? new Date(Date.UTC(volume.editionYear, 0, 1)))
      .toISOString()
      .slice(0, 10),
    url: work.abstractUrl,
    ...(work.pdfUrl
      ? {
          encoding: {
            '@type': 'MediaObject',
            contentUrl: work.pdfUrl,
            encodingFormat: 'application/pdf',
          },
        }
      : {}),
    ...(work.externalDoi ? { sameAs: `https://doi.org/${work.externalDoi}` } : {}),
    ...(work.keywords.length > 0 ? { keywords: work.keywords.join(', ') } : {}),
    ...(work.pageStart !== null ? { pageStart: work.pageStart } : {}),
    ...(work.pageEnd !== null ? { pageEnd: work.pageEnd } : {}),
    author: sorted.map((author) => ({
      '@type': 'Person',
      name: author.name,
      ...(author.institution
        ? {
            affiliation: {
              '@type': 'Organization',
              name: author.institution,
            },
          }
        : {}),
      ...(author.orcidId ? { sameAs: `https://orcid.org/${author.orcidId}` } : {}),
    })),
    isPartOf: {
      '@type': 'PublicationVolume',
      name: volume.title.trim(),
      ...(volume.volumeLabel ? { volumeNumber: volume.volumeLabel.trim() } : {}),
      ...(volume.issn ? { issn: volume.issn } : {}),
      ...(volume.isbn ? { isbn: volume.isbn } : {}),
      publisher: {
        '@type': 'Organization',
        name: volume.publisherName?.trim() || volume.institutionName.trim(),
      },
    },
  };
}

/** Escapa `<` antes de serializar JSON-LD em `<script type="application/ld+json">`. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

// ───────────────────────────────────────────────────────────────────────────────
//  OAI-PMH 2.0 (XML `oai_dc` para colheita gratuita por repositórios acadêmicos)
// ───────────────────────────────────────────────────────────────────────────────
export const OAI_VERBS = [
  'Identify',
  'ListMetadataFormats',
  'ListSets',
  'ListIdentifiers',
  'ListRecords',
  'GetRecord',
] as const;

export type OaiVerb = (typeof OAI_VERBS)[number];

export interface OaiSetDescriptor {
  setSpec: string;
  setName: string;
}

export interface OaiRecordDescriptor {
  identifier: string;
  datestamp: string;
  setSpec: string;
  title: string;
  creators: readonly string[];
  subjects: readonly string[];
  description: string;
  publisher: string;
  date: string;
  source: string;
  language: string;
  identifiers: readonly string[];
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function oaiErrorXml(input: {
  requestUrl: string;
  responseDate: string;
  code:
    | 'badVerb'
    | 'badArgument'
    | 'badResumptionToken'
    | 'cannotDisseminateFormat'
    | 'idDoesNotExist'
    | 'noRecordsMatch'
    | 'noSetHierarchy';
  message: string;
  verbAttr?: string;
}): string {
  const attrs = input.verbAttr ? ` verb="${escapeXml(input.verbAttr)}"` : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">',
    `  <responseDate>${escapeXml(input.responseDate)}</responseDate>`,
    `  <request${attrs}>${escapeXml(input.requestUrl)}</request>`,
    `  <error code="${input.code}">${escapeXml(input.message)}</error>`,
    '</OAI-PMH>',
  ].join('\n');
}

function renderRecordHeader(record: OaiRecordDescriptor): string {
  return [
    '      <header>',
    `        <identifier>${escapeXml(record.identifier)}</identifier>`,
    `        <datestamp>${escapeXml(record.datestamp)}</datestamp>`,
    `        <setSpec>${escapeXml(record.setSpec)}</setSpec>`,
    '      </header>',
  ].join('\n');
}

function renderRecordMetadata(record: OaiRecordDescriptor): string {
  return [
    '      <metadata>',
    '        <oai_dc:dc xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/oai_dc/ http://www.openarchives.org/OAI/2.0/oai_dc.xsd">',
    `          <dc:title>${escapeXml(record.title)}</dc:title>`,
    ...record.creators.map((c) => `          <dc:creator>${escapeXml(c)}</dc:creator>`),
    ...record.subjects.map((s) => `          <dc:subject>${escapeXml(s)}</dc:subject>`),
    `          <dc:description>${escapeXml(record.description)}</dc:description>`,
    `          <dc:publisher>${escapeXml(record.publisher)}</dc:publisher>`,
    `          <dc:date>${escapeXml(record.date)}</dc:date>`,
    '          <dc:type>ConferenceObject</dc:type>',
    `          <dc:source>${escapeXml(record.source)}</dc:source>`,
    `          <dc:language>${escapeXml(record.language)}</dc:language>`,
    ...record.identifiers.map((id) => `          <dc:identifier>${escapeXml(id)}</dc:identifier>`),
    '        </oai_dc:dc>',
    '      </metadata>',
  ].join('\n');
}

export function buildOaiPmhResponseXml(input: {
  requestUrl: string;
  searchParams: Record<string, string | undefined>;
  repositoryName: string;
  adminEmail: string;
  earliestDatestamp: string;
  sets: readonly OaiSetDescriptor[];
  records: readonly OaiRecordDescriptor[];
  now?: Date;
}): string {
  const nowIso = (input.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const verb = input.searchParams.verb;

  if (!verb || !(OAI_VERBS as readonly string[]).includes(verb)) {
    return oaiErrorXml({
      requestUrl: input.requestUrl,
      responseDate: nowIso,
      code: 'badVerb',
      message: 'Verbo OAI-PMH ausente ou inválido.',
    });
  }

  if (input.searchParams.resumptionToken) {
    return oaiErrorXml({
      requestUrl: input.requestUrl,
      responseDate: nowIso,
      code: 'badResumptionToken',
      message: 'Token de paginação inválido ou expirado.',
      verbAttr: verb,
    });
  }

  const wrap = (body: string, extraAttrs = ''): string =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<OAI-PMH xmlns="http://www.openarchives.org/OAI/2.0/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.openarchives.org/OAI/2.0/ http://www.openarchives.org/OAI/2.0/OAI-PMH.xsd">',
      `  <responseDate>${escapeXml(nowIso)}</responseDate>`,
      `  <request verb="${escapeXml(verb)}"${extraAttrs}>${escapeXml(input.requestUrl)}</request>`,
      body,
      '</OAI-PMH>',
    ].join('\n');

  if (verb === 'Identify') {
    return wrap(
      [
        '  <Identify>',
        `    <repositoryName>${escapeXml(input.repositoryName)}</repositoryName>`,
        `    <baseURL>${escapeXml(input.requestUrl)}</baseURL>`,
        '    <protocolVersion>2.0</protocolVersion>',
        `    <adminEmail>${escapeXml(input.adminEmail)}</adminEmail>`,
        `    <earliestDatestamp>${escapeXml(input.earliestDatestamp)}</earliestDatestamp>`,
        '    <deletedRecord>no</deletedRecord>',
        '    <granularity>YYYY-MM-DDThh:mm:ssZ</granularity>',
        '  </Identify>',
      ].join('\n'),
    );
  }

  if (verb === 'ListMetadataFormats') {
    if (input.searchParams.identifier) {
      const exists = input.records.some((r) => r.identifier === input.searchParams.identifier);
      if (!exists) {
        return oaiErrorXml({
          requestUrl: input.requestUrl,
          responseDate: nowIso,
          code: 'idDoesNotExist',
          message: 'Identificador não encontrado neste repositório.',
          verbAttr: verb,
        });
      }
    }

    return wrap(
      [
        '  <ListMetadataFormats>',
        '    <metadataFormat>',
        '      <metadataPrefix>oai_dc</metadataPrefix>',
        '      <schema>http://www.openarchives.org/OAI/2.0/oai_dc.xsd</schema>',
        '      <metadataNamespace>http://www.openarchives.org/OAI/2.0/oai_dc/</metadataNamespace>',
        '    </metadataFormat>',
        '  </ListMetadataFormats>',
      ].join('\n'),
    );
  }

  if (verb === 'ListSets') {
    if (input.sets.length === 0) {
      return oaiErrorXml({
        requestUrl: input.requestUrl,
        responseDate: nowIso,
        code: 'noRecordsMatch',
        message: 'Nenhum conjunto publicado encontrado.',
        verbAttr: verb,
      });
    }

    const setNodes = input.sets.map(
      (s) =>
        `    <set>\n      <setSpec>${escapeXml(s.setSpec)}</setSpec>\n      <setName>${escapeXml(s.setName)}</setName>\n    </set>`,
    );
    return wrap(['  <ListSets>', ...setNodes, '  </ListSets>'].join('\n'));
  }

  const metadataPrefix = input.searchParams.metadataPrefix;
  if (!metadataPrefix) {
    return oaiErrorXml({
      requestUrl: input.requestUrl,
      responseDate: nowIso,
      code: 'badArgument',
      message: 'O argumento metadataPrefix é obrigatório.',
      verbAttr: verb,
    });
  }
  if (metadataPrefix !== 'oai_dc') {
    return oaiErrorXml({
      requestUrl: input.requestUrl,
      responseDate: nowIso,
      code: 'cannotDisseminateFormat',
      message: 'Formato não suportado. Utilize metadataPrefix=oai_dc.',
      verbAttr: verb,
    });
  }

  if (verb === 'GetRecord') {
    const id = input.searchParams.identifier;
    if (!id) {
      return oaiErrorXml({
        requestUrl: input.requestUrl,
        responseDate: nowIso,
        code: 'badArgument',
        message: 'O argumento identifier é obrigatório em GetRecord.',
        verbAttr: verb,
      });
    }

    const found = input.records.find((r) => r.identifier === id);
    if (!found) {
      return oaiErrorXml({
        requestUrl: input.requestUrl,
        responseDate: nowIso,
        code: 'idDoesNotExist',
        message: 'Identificador não encontrado neste repositório.',
        verbAttr: verb,
      });
    }

    return wrap(
      [
        '  <GetRecord>',
        '    <record>',
        renderRecordHeader(found),
        renderRecordMetadata(found),
        '    </record>',
        '  </GetRecord>',
      ].join('\n'),
      ` identifier="${escapeXml(id)}" metadataPrefix="oai_dc"`,
    );
  }

  const { set, from, until } = input.searchParams;
  const filtered = input.records.filter((record) => {
    if (set && record.setSpec !== set && !record.setSpec.startsWith(`${set}:`)) return false;
    const day = record.datestamp.slice(0, 10);
    if (from && day < from.slice(0, 10)) return false;
    if (until && day > until.slice(0, 10)) return false;
    return true;
  });

  if (filtered.length === 0) {
    return oaiErrorXml({
      requestUrl: input.requestUrl,
      responseDate: nowIso,
      code: 'noRecordsMatch',
      message: 'Nenhum registro publicado corresponde aos filtros informados.',
      verbAttr: verb,
    });
  }

  if (verb === 'ListIdentifiers') {
    return wrap(
      [
        '  <ListIdentifiers>',
        ...filtered.map((r) => renderRecordHeader(r)),
        '  </ListIdentifiers>',
      ].join('\n'),
      ' metadataPrefix="oai_dc"',
    );
  }

  return wrap(
    [
      '  <ListRecords>',
      ...filtered.map((r) => ['    <record>', renderRecordHeader(r), renderRecordMetadata(r), '    </record>'].join('\n')),
      '  </ListRecords>',
    ].join('\n'),
    ' metadataPrefix="oai_dc"',
  );
}
