/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — Anais, Citações e Indexação Gratuita (FASE 111)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  assertProceedingsSemCampoProibido,
  buildProceedingsEntrySnapshot,
  canUseFileKindInProceedings,
  normalizeExternalDoi,
  normalizeIsbn,
  normalizeIssn,
  normalizePublicFileKindInput,
  validatePageRange,
  validateProceedingsVolumeInput,
} from '../../src/domain/proceedings/proceedings-rules';
import {
  buildBibtexKey,
  formatAbntAuthor,
  formatAbntCitation,
  formatApaAuthor,
  formatApaCitation,
  formatBibtexCitation,
  formatRisCitation,
  type ProceedingsVolumeCitationMeta,
  type ProceedingsWorkCitationMeta,
} from '../../src/domain/proceedings/citation-rules';
import {
  buildOaiPmhResponseXml,
  buildScholarlyArticleJsonLd,
  buildScholarlyMetaTags,
  serializeJsonLd,
  type OaiRecordDescriptor,
  type OaiSetDescriptor,
} from '../../src/domain/proceedings/indexing-rules';
import { canUploadSubmissionFile } from '../../src/domain/review/submission-rules';

const VOLUME: ProceedingsVolumeCitationMeta = {
  title: 'Anais do X Congresso Brasileiro de Ciência Aberta',
  eventTitle: 'X Congresso Brasileiro de Ciência Aberta',
  volumeLabel: 'v. 1',
  editionYear: 2026,
  editors: 'Maria Silva; João Souza',
  isbn: '978-65-12345-00-1',
  issn: '2595-1234',
  publisherName: 'Editora Universitária Federal',
  institutionName: 'Universidade Exemplo',
};

const WORK: ProceedingsWorkCitationMeta = {
  protocol: '2026-AB12',
  title: 'Arquiteturas Multi-Tenant com Isolamento por Linha em Eventos Científicos',
  language: 'pt-BR',
  keywords: ['Multi-tenant', 'RLS', 'Eventos Científicos'],
  pageStart: 12,
  pageEnd: 24,
  externalDoi: '10.5281/zenodo.9988776',
  abstractUrl: 'https://koveno.org/t/ufba/eventos/cbca-2026/anais/2026-AB12',
  pdfUrl: 'https://koveno.org/api/t/ufba/eventos/cbca-2026/anais/2026-AB12/arquivo',
  authors: [
    {
      name: 'Maria Clara Silva',
      institution: 'UFBA',
      orcidId: '0000-0001-2345-6789',
      order: 1,
      isCorresponding: true,
    },
    {
      name: 'João Pedro Souza',
      institution: 'USP',
      orcidId: null,
      order: 2,
      isCorresponding: false,
    },
  ],
};

describe('regras puras de publicação nos anais', () => {
  it('rejeita BLIND_PDF e outros artefatos não públicos em qualquer entrada', () => {
    expect(canUseFileKindInProceedings('CAMERA_READY')).toBe(true);
    expect(canUseFileKindInProceedings('IDENTIFIED_PDF')).toBe(true);
    expect(canUseFileKindInProceedings('BLIND_PDF')).toBe(false);
    expect(canUseFileKindInProceedings('SUPPLEMENTARY')).toBe(false);
    expect(canUseFileKindInProceedings(null)).toBe(false);

    expect(normalizePublicFileKindInput('BLIND_PDF').ok).toBe(false);
    expect(normalizePublicFileKindInput('CAMERA_READY')).toEqual({
      ok: true,
      kind: 'CAMERA_READY',
    });
    expect(normalizePublicFileKindInput('')).toEqual({ ok: true, kind: null });
  });

  it('valida DOI externo, ISSN, ISBN e faixa de páginas', () => {
    expect(normalizeExternalDoi('https://doi.org/10.5281/zenodo.12345')).toEqual({
      ok: true,
      doi: '10.5281/zenodo.12345',
    });
    expect(normalizeExternalDoi('doi:10.1000/xyz')).toEqual({
      ok: true,
      doi: '10.1000/xyz',
    });
    expect(normalizeExternalDoi('sem-prefixo').ok).toBe(false);

    expect(normalizeIssn('2595-123X')).toEqual({ ok: true, issn: '2595-123X' });
    expect(normalizeIssn('123').ok).toBe(false);

    expect(normalizeIsbn('978-65-12345-00-1').ok).toBe(true);
    expect(normalizeIsbn('abc').ok).toBe(false);

    expect(validatePageRange(10, 20)).toEqual({ ok: true, pageStart: 10, pageEnd: 20 });
    expect(validatePageRange(25, 10).ok).toBe(false);
    expect(validatePageRange(0, 5).ok).toBe(false);
  });

  it('valida ficha do volume e impõe guarda fail-closed contra campos proibidos', () => {
    expect(
      validateProceedingsVolumeInput({
        title: 'Anais do Simpósio 2026',
        editionYear: 2026,
        issn: '2595-1234',
      }).ok,
    ).toBe(true);

    expect(
      validateProceedingsVolumeInput({
        title: 'abc',
        editionYear: 2026,
      }).ok,
    ).toBe(false);

    const snapshot = buildProceedingsEntrySnapshot({
      protocol: WORK.protocol,
      title: WORK.title,
      abstract: 'Resumo público.',
      keywords: WORK.keywords,
      language: WORK.language,
      sectionName: 'Engenharia',
      authors: WORK.authors,
      publishedAt: new Date('2026-11-14T12:00:00Z'),
    });
    expect(() => assertProceedingsSemCampoProibido(snapshot)).not.toThrow();

    expect(() =>
      assertProceedingsSemCampoProibido({ ...snapshot, authors: [{ name: 'A', email: 'a@b.c' }] }),
    ).toThrow(/Campo proibido/);
    expect(() => assertProceedingsSemCampoProibido({ ...snapshot, finalScore: 95 })).toThrow();
    expect(() =>
      assertProceedingsSemCampoProibido({ nested: { blindSnapshot: {} } }),
    ).toThrow();
  });

  it('permite upload pós-aceite apenas de CAMERA_READY', () => {
    expect(canUploadSubmissionFile({ status: 'DRAFT', kind: 'BLIND_PDF' })).toBe(true);
    expect(canUploadSubmissionFile({ status: 'REVISION_REQUESTED', kind: 'IDENTIFIED_PDF' })).toBe(
      true,
    );
    expect(canUploadSubmissionFile({ status: 'ACCEPTED', kind: 'CAMERA_READY' })).toBe(true);
    expect(canUploadSubmissionFile({ status: 'ACCEPTED', kind: 'BLIND_PDF' })).toBe(false);
    expect(canUploadSubmissionFile({ status: 'ACCEPTED', kind: 'IDENTIFIED_PDF' })).toBe(false);
    expect(canUploadSubmissionFile({ status: 'REJECTED', kind: 'CAMERA_READY' })).toBe(false);
  });
});

describe('formatadores de citação (ABNT, APA, BibTeX, RIS)', () => {
  it('formata autores em ABNT e APA incluindo regra de et al. para 4+ autores', () => {
    expect(formatAbntAuthor('Maria Clara Silva')).toBe('SILVA, Maria Clara');
    expect(formatApaAuthor('Maria Clara Silva')).toBe('Silva, M. C.');

    const fourAuthors: ProceedingsWorkCitationMeta = {
      ...WORK,
      authors: [
        { name: 'Ana Beatriz Costa', institution: null, orcidId: null, order: 1, isCorresponding: true },
        { name: 'Bruno Lima', institution: null, orcidId: null, order: 2, isCorresponding: false },
        { name: 'Carla Dias', institution: null, orcidId: null, order: 3, isCorresponding: false },
        { name: 'Diego Nunes', institution: null, orcidId: null, order: 4, isCorresponding: false },
      ],
    };

    const abnt4 = formatAbntCitation(fourAuthors, VOLUME, new Date('2026-11-14T12:00:00Z'));
    expect(abnt4).toContain('COSTA, Ana Beatriz et al.');
    expect(abnt4).toContain('DOI: 10.5281/zenodo.9988776.');
    expect(abnt4).toContain('p. 12-24');

    const apa = formatApaCitation(WORK, VOLUME);
    expect(apa).toContain('Silva, M. C., & Souza, J. P. (2026).');
    expect(apa).toContain('(p. 12-24)');
    expect(apa).toContain('https://doi.org/10.5281/zenodo.9988776');
  });

  it('gera BibTeX e RIS válidos com chave determinística e todos os metadados', () => {
    expect(buildBibtexKey(WORK.protocol, 2026)).toBe('koveno_2026_2026-ab12');

    const bib = formatBibtexCitation(WORK, VOLUME);
    expect(bib).toContain('@inproceedings{koveno_2026_2026-ab12,');
    expect(bib).toContain('author = {Silva, Maria Clara and Souza, João Pedro},');
    expect(bib).toContain('pages = {12--24},');
    expect(bib).toContain('issn = {2595-1234},');
    expect(bib).toContain('doi = {10.5281/zenodo.9988776},');

    const ris = formatRisCitation(WORK, VOLUME);
    expect(ris).toContain('TY  - CONF');
    expect(ris).toContain('AU  - Silva, Maria Clara');
    expect(ris).toContain('AU  - Souza, João Pedro');
    expect(ris).toContain('SP  - 12');
    expect(ris).toContain('EP  - 24');
    expect(ris).toContain('DO  - 10.5281/zenodo.9988776');
    expect(ris.trimEnd().endsWith('ER  -')).toBe(true);
  });
});

describe('metatags Highwire Press, Dublin Core, JSON-LD e OAI-PMH 2.0', () => {
  it('monta metatags Google Scholar e JSON-LD ScholarlyArticle escapado', () => {
    const publishedAt = new Date('2026-11-14T15:00:00Z');
    const tags = buildScholarlyMetaTags({
      work: { ...WORK, abstract: 'Resumo técnico.', publishedAt },
      volume: VOLUME,
    });

    expect(tags.citation_title).toBe(WORK.title);
    expect(tags.citation_author).toEqual(['Maria Clara Silva', 'João Pedro Souza']);
    expect(tags.citation_author_orcid).toEqual(['https://orcid.org/0000-0001-2345-6789']);
    expect(tags.citation_publication_date).toBe('2026/11/14');
    expect(tags.citation_pdf_url).toBe(WORK.pdfUrl);
    expect(tags.citation_doi).toBe(WORK.externalDoi);
    expect(tags['DC.type']).toBe('ConferenceObject');

    const ld = buildScholarlyArticleJsonLd({
      work: { ...WORK, abstract: 'Texto <script>alert(1)</script>', publishedAt },
      volume: VOLUME,
    });
    expect(ld['@type']).toBe('ScholarlyArticle');
    const serialized = serializeJsonLd(ld);
    expect(serialized).not.toContain('<script>');
    expect(serialized).toContain('\\u003cscript>');
  });

  it('responde aos 6 verbos OAI-PMH 2.0 com filtro de datas, sets e escape XML', () => {
    const sets: OaiSetDescriptor[] = [
      { setSpec: 'ufba:cbca-2026', setName: 'Anais do X Congresso & Simpósio' },
    ];
    const records: OaiRecordDescriptor[] = [
      {
        identifier: 'oai:koveno:ufba:cbca-2026:2026-AB12',
        datestamp: '2026-11-14T15:00:00Z',
        setSpec: 'ufba:cbca-2026',
        title: 'Estudo sobre <RLS> & Segurança',
        creators: ['Maria Clara Silva'],
        subjects: ['RLS'],
        description: 'Resumo',
        publisher: 'UFBA',
        date: '2026-11-14',
        source: VOLUME.title,
        language: 'pt-BR',
        identifiers: [WORK.abstractUrl],
      },
    ];

    const baseInput = {
      requestUrl: 'https://koveno.org/api/oai',
      repositoryName: 'Koveno OAI',
      adminEmail: 'proceedings@koveno.org',
      earliestDatestamp: '2026-01-01T00:00:00Z',
      sets,
      records,
      now: new Date('2026-11-14T16:00:00Z'),
    };

    const identify = buildOaiPmhResponseXml({ ...baseInput, searchParams: { verb: 'Identify' } });
    expect(identify).toContain('<repositoryName>Koveno OAI</repositoryName>');
    expect(identify).toContain('<protocolVersion>2.0</protocolVersion>');

    const formats = buildOaiPmhResponseXml({
      ...baseInput,
      searchParams: { verb: 'ListMetadataFormats' },
    });
    expect(formats).toContain('<metadataPrefix>oai_dc</metadataPrefix>');

    const listSets = buildOaiPmhResponseXml({ ...baseInput, searchParams: { verb: 'ListSets' } });
    expect(listSets).toContain('Anais do X Congresso &amp; Simpósio');

    const listRecords = buildOaiPmhResponseXml({
      ...baseInput,
      searchParams: { verb: 'ListRecords', metadataPrefix: 'oai_dc', set: 'ufba:cbca-2026' },
    });
    expect(listRecords).toContain('<dc:title>Estudo sobre &lt;RLS&gt; &amp; Segurança</dc:title>');

    const getRecord = buildOaiPmhResponseXml({
      ...baseInput,
      searchParams: {
        verb: 'GetRecord',
        metadataPrefix: 'oai_dc',
        identifier: 'oai:koveno:ufba:cbca-2026:2026-AB12',
      },
    });
    expect(getRecord).toContain('<GetRecord>');

    const notFound = buildOaiPmhResponseXml({
      ...baseInput,
      searchParams: { verb: 'GetRecord', metadataPrefix: 'oai_dc', identifier: 'inexistente' },
    });
    expect(notFound).toContain('code="idDoesNotExist"');

    const badVerb = buildOaiPmhResponseXml({ ...baseInput, searchParams: { verb: 'Foo' } });
    expect(badVerb).toContain('code="badVerb"');

    const badFormat = buildOaiPmhResponseXml({
      ...baseInput,
      searchParams: { verb: 'ListRecords', metadataPrefix: 'marc21' },
    });
    expect(badFormat).toContain('code="cannotDisseminateFormat"');
  });
});
