/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 86 · FATIA 2 — O CORPO DO CERTIFICADO É DO ORGANIZADOR (domínio)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o elemento `BODY` (no máximo um por modelo; não substitui o bloco probatório);
 *  • a lista CANÔNICA do gabarito — as chaves de conteúdo menos `corpo`, e por que
 *    `hash`/`assinatura`/`chave` não podem ser interpolados dentro do texto;
 *  • a validação do gabarito: token desconhecido (com a lista dos válidos), `{{` sem
 *    fechar, vazio, o limite de 2.000 e a preservação das quebras de linha;
 *  • o "cabe?": quantas linhas o texto ocupa e o aviso ESTRUTURADO quando não cabe;
 *  • a resolução: todas as ocorrências substituídas e o que não é token preservado;
 *  • o RENDERIZADOR imprimindo `values.corpo` — nunca o gabarito;
 *  • a prévia dupla (tudo preenchido × opcionais vazios);
 *  • a PROVA de que o hash de documento antigo não muda: os serializadores estão
 *    presos a valores fixos, medidos com o código ANTERIOR à fase.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O HASH TEM TESTE AQUI (e não só a integração)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A armadilha da fase é invisível: `serializeContentValues` percorre o catálogo
 *  ATUAL e grava `''` para chave ausente, então ACRESCENTAR uma variável de conteúdo
 *  mudaria o hash de TODO certificado versão 2 já emitido, e a reverificação os
 *  marcaria como TAMPERED. Prender os serializadores a um valor fixo faz o contrário
 *  do defeito: qualquer campo novo (ou reordenação) reprova AQUI, antes de emitir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BODY_TEMPLATE_VARIABLES,
  BODY_TEMPLATE_VARIABLE_KEYS,
  CERTIFICATE_ELEMENT_KINDS,
  CERTIFICATE_ELEMENT_KIND_LABELS,
  CERTIFICATE_TEMPLATE_PRESETS,
  CONTENT_VARIABLE_KEYS,
  MAX_BODY_TEMPLATE_LENGTH,
  MAX_ELEMENT_TEXT,
  buildLayoutFromRows,
  certificateBodyElement,
  certificateBodyTemplate,
  certificatePreviewSample,
  contentValuesFrom,
  elementText,
  hashLayout,
  isCertificateBodyVariableKey,
  measureCertificateBody,
  resolveBodyTemplate,
  resolveCertificateVariables,
  sampleVariableValues,
  serializeContentValues,
  serializeLayout,
  validateBodyTemplate,
  validateLayout,
  visibleElements,
  type CertificateLayout,
  type CertificateLayoutElement,
  type CertificateVariableValues,
} from '../../src/domain/certificates/certificate-layout-rules';
import { drawLayoutSvg } from '../../src/lib/documents/layout-draw';

// ── Fixtures ───────────────────────────────────────────────────────────────────
function element(partial: Partial<CertificateLayoutElement> & { id: string }): CertificateLayoutElement {
  return {
    kind: 'TEXT',
    xMm: 20,
    yMm: 20,
    widthMm: 100,
    heightMm: 10,
    align: 'LEFT',
    font: 'HELVETICA',
    sizePt: 12,
    color: '#111827',
    lineHeight: 1.4,
    text: 'Texto',
    variable: null,
    ...partial,
  };
}

/** O bloco probatório que a validação exige — sem ele nenhum layout passa. */
function probatoryElements(): CertificateLayoutElement[] {
  return [
    element({ id: 'codigo', kind: 'VARIABLE', variable: 'codigo_validacao', text: null }),
    element({ id: 'url', kind: 'VARIABLE', variable: 'url_validacao', text: null }),
    element({ id: 'qr', kind: 'QR', text: null, widthMm: 30, heightMm: 30 }),
  ];
}

function bodyElement(text: string): CertificateLayoutElement {
  return element({
    id: 'corpo-gabarito',
    kind: 'BODY',
    xMm: 24,
    yMm: 90,
    widthMm: 249,
    heightMm: 40,
    sizePt: 13,
    lineHeight: 1.6,
    text,
  });
}

function layoutOf(elements: CertificateLayoutElement[]): CertificateLayout {
  return { page: 'A4_LANDSCAPE', background: null, elements };
}

const GABARITO =
  'Certificamos que {{nome}} participou de {{evento}}, em {{periodo}}, com carga horária de {{carga_horaria}}.';

const VALUES: CertificateVariableValues = resolveCertificateVariables({
  recipientName: 'Ana Souza',
  title: 'Certificado de conclusão de minicurso',
  bodyText: 'Certificamos que Ana Souza concluiu o minicurso.',
  eventTitle: 'Congresso 2026',
  activityTitle: 'Rust para iniciantes',
  workloadLabel: '4 horas',
  period: '12 a 14 de março de 2026',
  issuedAtLabel: '20/03/2026',
  tenantName: 'UFBA',
  validationCode: 'CERT-7KQ4M2XP',
  validationUrl: 'https://eventflow.test/validar/CERT-7KQ4M2XP',
  contentHash: 'b'.repeat(64),
  signature: 'assinatura',
  keyId: 'cert-2026-01',
  cpf: null,
  presentationTitle: null,
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o elemento BODY', () => {
  it('entra no catálogo de tipos, com rótulo humano', () => {
    expect(CERTIFICATE_ELEMENT_KINDS).toContain('BODY');
    expect(CERTIFICATE_ELEMENT_KIND_LABELS.BODY).toContain('Corpo');
  });

  it('um modelo com corpo válido e bloco probatório é aceito', () => {
    const verdict = validateLayout(layoutOf([...probatoryElements(), bodyElement(GABARITO)]));

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) expect(verdict.issues.map((issue) => issue.message)).toEqual([]);
  });

  it('recusa DOIS corpos, apontando o elemento repetido', () => {
    const verdict = validateLayout(
      layoutOf([...probatoryElements(), bodyElement(GABARITO), { ...bodyElement('Outro {{nome}}.'), id: 'corpo-2' }]),
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const duplicate = verdict.issues.filter((issue) => issue.code === 'DUPLICATE_BODY');
    expect(duplicate).toHaveLength(1);
    expect(duplicate[0]?.message).toContain('elemento 5');
  });

  it('recusa corpo VAZIO', () => {
    const verdict = validateLayout(layoutOf([...probatoryElements(), bodyElement('   ')]));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.issues.map((issue) => issue.code)).toContain('EMPTY_BODY_TEMPLATE');
  });

  it('recusa token desconhecido no corpo, com o motivo do domínio', () => {
    const verdict = validateLayout(layoutOf([...probatoryElements(), bodyElement('Olá {{apelido}}.')]));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const issue = verdict.issues.find((item) => item.code === 'UNKNOWN_BODY_TOKEN');
    expect(issue?.message).toContain('{{apelido}}');
    expect(issue?.message).toContain('{{nome}}');
  });

  it('o BODY NÃO substitui o bloco probatório: sem QR e sem as variáveis, recusa', () => {
    const verdict = validateLayout(layoutOf([bodyElement(GABARITO)]));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const messages = verdict.issues.filter((issue) => issue.code === 'MISSING_VALIDATION_BLOCK');
    expect(messages).toHaveLength(3);
    expect(messages.map((issue) => issue.message).join(' ')).toContain('QR Code');
  });

  it('{{codigo_validacao}} escrito DENTRO do corpo não conta como bloco probatório', () => {
    /**
     * A validação exige os ELEMENTOS. Um código citado no texto do organizador é
     * texto, não prova: se contasse, um modelo sem QR passaria e o certificado não
     * poderia ser validado na página pública.
     */
    const verdict = validateLayout(
      layoutOf([
        bodyElement('Documento {{codigo_validacao}} — confira em {{url_validacao}}.'),
        element({ id: 'qr', kind: 'QR', text: null, widthMm: 30, heightMm: 30 }),
      ]),
    );

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const messages = verdict.issues.filter((issue) => issue.code === 'MISSING_VALIDATION_BLOCK');
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.map((issue) => issue.message).join(' ')).toContain('código de validação');
  });

  it('o gabarito tem limite PRÓPRIO, maior que o do texto fixo', () => {
    expect(MAX_BODY_TEMPLATE_LENGTH).toBeGreaterThan(MAX_ELEMENT_TEXT);

    const withinLimit = 'a'.repeat(MAX_BODY_TEMPLATE_LENGTH);
    expect(validateBodyTemplate(withinLimit).ok).toBe(true);

    const overLimit = 'a'.repeat(MAX_BODY_TEMPLATE_LENGTH + 1);
    const verdict = validateBodyTemplate(overLimit);

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.issues.map((issue) => issue.code)).toContain('BODY_TEMPLATE_TOO_LONG');
  });

  it('as linhas do formulário preservam o gabarito e descartam corpo em branco', () => {
    const built = buildLayoutFromRows({
      page: 'A4_LANDSCAPE',
      background: null,
      ids: ['corpo', 'vazio', 'qr'],
      kinds: ['BODY', 'BODY', 'QR'],
      texts: [GABARITO, '   ', ''],
      variables: ['', '', ''],
      xMm: ['24', '24', '240'],
      yMm: ['90', '90', '158'],
      widthMm: ['249', '249', '34'],
      heightMm: ['40', '40', '34'],
      aligns: ['CENTER', 'CENTER', 'CENTER'],
      fonts: ['HELVETICA', 'HELVETICA', 'HELVETICA'],
      sizePt: ['13', '13', '12'],
      colors: ['#111827', '#111827', '#111827'],
      lineHeights: ['1.6', '1.4', '1.4'],
    });

    expect(built.elements).toHaveLength(2);
    expect(built.elements[0]?.kind).toBe('BODY');
    expect(built.elements[0]?.text).toBe(GABARITO);
    expect(built.elements[0]?.variable).toBeNull();
  });
});

/**
 * O `buildLayoutFromRows` é a PORTA do formulário (não a validação): ele monta o layout
 * que `validateLayout` depois julga.
 */

// ═══════════════════════════════════════════════════════════════════════════════
describe('a lista canônica do gabarito', () => {
  it('é o catálogo de CONTEÚDO menos `corpo` — 12 chaves', () => {
    expect(CONTENT_VARIABLE_KEYS).toHaveLength(13);
    expect(BODY_TEMPLATE_VARIABLE_KEYS).toHaveLength(12);

    const expected = CONTENT_VARIABLE_KEYS.filter((key) => key !== 'corpo');
    expect(BODY_TEMPLATE_VARIABLE_KEYS).toEqual(expected);
  });

  it('não aceita `corpo` (recursão) nem as chaves de auditoria', () => {
    /**
     * `corpo` dentro do corpo seria o texto contendo a si mesmo; `hash`, `assinatura` e
     * `chave` nascem do documento e não podem ser interpolados nele (o hash não pode
     * depender do texto que ele assina).
     */
    for (const forbidden of ['corpo', 'hash', 'assinatura', 'chave', 'xpto']) {
      expect(BODY_TEMPLATE_VARIABLE_KEYS).not.toContain(forbidden);
      expect(isCertificateBodyVariableKey(forbidden)).toBe(false);
    }
  });

  it('cada chave tem o rótulo humano do catálogo (a legenda do editor)', () => {
    const labels = new Map(BODY_TEMPLATE_VARIABLES.map((item) => [item.key, item.label]));

    expect(BODY_TEMPLATE_VARIABLES).toHaveLength(BODY_TEMPLATE_VARIABLE_KEYS.length);
    expect(labels.get('nome')).toBe('Nome do participante');
    expect(labels.get('evento')).toBe('Nome do evento');
    expect(labels.get('carga_horaria')).toBe('Carga horária');
    expect(labels.get('periodo')).toBe('Período do evento');

    for (const item of BODY_TEMPLATE_VARIABLES) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.label).not.toBe(item.key);
    }
  });

  it('o corpo do editor fala as chaves do CATÁLOGO, não os nomes da imagem de referência', () => {
    /**
     * A imagem que inspirou a fase usava `{{nome_participante}}`, `{{titulo_evento}}`,
     * `{{carga_horaria_horas}}` e `{{periodo_evento}}`. Renomear as chaves do catálogo
     * mudaria o hash de todo documento — a legenda é que traduz a chave para o humano.
     */
    for (const referenceName of ['nome_participante', 'titulo_evento', 'carga_horaria_horas', 'periodo_evento']) {
      expect(BODY_TEMPLATE_VARIABLE_KEYS).not.toContain(referenceName);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('validação do gabarito', () => {
  it('recusa token desconhecido E LISTA os válidos (não apaga em silêncio)', () => {
    const verdict = validateBodyTemplate('Certificamos que {{nome}} foi {{heroi}}.');

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;

    const issue = verdict.issues.find((item) => item.code === 'UNKNOWN_BODY_TOKEN');
    expect(issue?.message).toContain('{{heroi}}');

    for (const key of BODY_TEMPLATE_VARIABLE_KEYS) {
      expect(issue?.message).toContain(`{{${key}}}`);
    }
  });

  it('recusa `{{` sem fechar', () => {
    const semFechar = validateBodyTemplate('Certificamos que {{nome participou.');

    expect(semFechar.ok).toBe(false);
    if (semFechar.ok) return;
    expect(semFechar.issues.map((issue) => issue.code)).toContain('UNCLOSED_BODY_TOKEN');

    const sóFechando = validateBodyTemplate('Certificamos que nome}} participou.');
    expect(sóFechando.ok).toBe(false);
    if (sóFechando.ok) return;
    expect(sóFechando.issues.map((issue) => issue.code)).toContain('UNCLOSED_BODY_TOKEN');
  });

  it('recusa gabarito vazio ou só com espaços', () => {
    for (const empty of ['', '   ', '\n\n', ' \t ']) {
      const verdict = validateBodyTemplate(empty);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.issues.map((issue) => issue.code)).toEqual(['EMPTY_BODY_TEMPLATE']);
    }
  });

  it('aceita espaços dentro do token (`{{ nome }}`) e devolve as variáveis usadas', () => {
    const verdict = validateBodyTemplate('Olá {{ nome }}, bem-vindo(a) ao {{evento}}.');

    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.variables).toEqual(['nome', 'evento']);
  });

  it('preserva quebras de linha', () => {
    const duasLinhas = 'Certificamos que {{nome}} participou.\n\nCarga horária: {{carga_horaria}}.';
    expect(validateBodyTemplate(duasLinhas).ok).toBe(true);

    const resolved = resolveBodyTemplate(duasLinhas, VALUES);
    expect(resolved.split('\n')).toHaveLength(3);
  });

  it('token válido repetido não vira variável repetida na lista', () => {
    const verdict = validateBodyTemplate('{{nome}} — {{nome}} de novo.');

    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.variables).toEqual(['nome']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('resolução do gabarito', () => {
  it('substitui TODAS as ocorrências do mesmo token', () => {
    const resolved = resolveBodyTemplate('{{nome}} — sim, {{nome}}!', VALUES);

    expect(resolved).toBe('Ana Souza — sim, Ana Souza!');
  });

  it('mantém LITERAL o que não é token: chaves simples e token desconhecido', () => {
    const resolved = resolveBodyTemplate('100% de {{nome}} · {chaves} · {{desconhecida}} · fim', VALUES);

    expect(resolved).toBe('100% de Ana Souza · {chaves} · {{desconhecida}} · fim');
  });

  it('variável sem valor vira vazio (o buraco aparece, em vez do token)', () => {
    const resolved = resolveBodyTemplate('Carga: {{carga_horaria}}. CPF: {{cpf}}.', { ...VALUES, cpf: '' });

    expect(resolved).toBe('Carga: 4 horas. CPF: .');
  });

  it('resolve o período e a data de emissão formatados, não o Date', () => {
    const resolved = resolveBodyTemplate('{{periodo}} · emitido em {{data_emissao}}', VALUES);

    expect(resolved).toBe('12 a 14 de março de 2026 · emitido em 20/03/2026');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o corpo CABE na caixa', () => {
  /** Caixa de 100 mm, 10 pt e entrelinha 1,5: 21,5 mm de altura = 4 linhas. */
  const BOX = { widthMm: 100, heightMm: 21.5, sizePt: 10, lineHeight: 1.5 };

  it('conta as linhas e diz que cabe', () => {
    const fit = measureCertificateBody({ box: BOX, text: 'uma\nduas\ntres' });

    expect(fit.lineCount).toBe(3);
    expect(fit.maxLines).toBe(4);
    expect(fit.overflowLines).toBe(0);
    expect(fit.fits).toBe(true);
    expect(fit.warning).toBeNull();
  });

  it('EXATAMENTE no limite ainda cabe', () => {
    const fit = measureCertificateBody({ box: BOX, text: 'uma\nduas\ntres\nquatro' });

    expect(fit.lineCount).toBe(4);
    expect(fit.maxLines).toBe(4);
    expect(fit.fits).toBe(true);
    expect(fit.warning).toBeNull();
  });

  it('uma linha a mais NÃO cabe — e o aviso é estruturado, não um truncamento', () => {
    const fit = measureCertificateBody({ box: BOX, text: 'uma\nduas\ntres\nquatro\ncinco' });

    expect(fit.fits).toBe(false);
    expect(fit.lineCount).toBe(5);
    expect(fit.maxLines).toBe(4);
    expect(fit.overflowLines).toBe(1);
    expect(fit.warning?.code).toBe('BODY_DOES_NOT_FIT');
    expect(fit.warning?.lineCount).toBe(5);
    expect(fit.warning?.maxLines).toBe(4);
    expect(fit.warning?.message).toContain('5');
    expect(fit.warning?.message).toContain('4');

    // O texto medido continua INTEIRO: medir não é cortar.
    expect(fit.lines).toHaveLength(5);
  });

  it('a quebra por largura também conta linha (o texto longo enche a caixa)', () => {
    const words = Array.from({ length: 60 }, () => 'palavra').join(' ');
    const fit = measureCertificateBody({ box: { ...BOX, heightMm: 12 }, text: words });

    expect(fit.lineCount).toBeGreaterThan(fit.maxLines);
    expect(fit.fits).toBe(false);
    expect(fit.warning).not.toBeNull();
  });

  it('quebras de linha preservadas contam como linhas separadas', () => {
    const umParagrafo = measureCertificateBody({ box: BOX, text: 'uma duas tres quatro cinco seis sete oito' });
    const doisParagrafos = measureCertificateBody({
      box: BOX,
      text: 'uma duas tres quatro\ncinco seis sete oito',
    });

    expect(doisParagrafos.lineCount).toBe(umParagrafo.lineCount + 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o renderizador imprime o CORPO RESOLVIDO, nunca o gabarito', () => {
  const body = bodyElement(GABARITO);
  const wrapper = (): CertificateLayout => ({
    ...layoutOf([body, ...probatoryElements()]),
  });

  it('elementText devolve `values.corpo`', () => {
    expect(elementText(body, VALUES)).toBe(VALUES.corpo);
    expect(elementText(body, VALUES)).not.toContain('{{');
  });

  it('o corpo sem valor não desenha caixa vazia', () => {
    const semCorpo = { ...VALUES, corpo: '' } as CertificateVariableValues;

    expect(visibleElements(wrapper(), semCorpo).some((item) => item.kind === 'BODY')).toBe(false);
    expect(visibleElements(wrapper(), VALUES).some((item) => item.kind === 'BODY')).toBe(true);
  });

  it('o SVG desenhado tem o texto resolvido e nenhum `{{`', () => {
    /**
     * O caminho de verdade: a emissão resolve o gabarito e grava em `corpo`; o desenho
     * recebe esse valor. Aqui a resolução é feita à mão para provar que o desenho NÃO
     * reinterpreta nada — ele imprime o que veio em `values.corpo`.
     */
    const resolved = { ...VALUES, corpo: resolveBodyTemplate(GABARITO, VALUES) } as CertificateVariableValues;

    const svg = drawLayoutSvg({
      layout: wrapper(),
      values: resolved,
      qrPayload: VALUES.url_validacao,
    });

    expect(svg).toContain('Ana Souza');
    expect(svg).toContain('Congresso 2026');
    expect(svg).toContain('12 a 14 de março de 2026');
    expect(svg).not.toContain('{{');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('prévia dupla (amostragem)', () => {
  it('sem BODY, a amostra continua a do catálogo e não há medição', () => {
    const sample = certificatePreviewSample(layoutOf(probatoryElements()));

    expect(sample.variant).toBe('FULL');
    expect(sample.values.corpo).toBe(sampleVariableValues().corpo);
    expect(sample.bodyFit).toBeNull();
    expect(certificateBodyElement(layoutOf(probatoryElements()))).toBeNull();
  });

  it('com BODY, a prévia resolve o GABARITO (não mostra a frase de exemplo)', () => {
    const layout = layoutOf([bodyElement(GABARITO), ...probatoryElements()]);
    const sample = certificatePreviewSample(layout, 'FULL');

    expect(certificateBodyTemplate(layout)).toBe(GABARITO);
    expect(sample.values.corpo).not.toBe(sampleVariableValues().corpo);
    expect(sample.values.corpo).toContain('Ana Souza');
    expect(sample.values.corpo).toContain('Congresso de Tecnologia 2026');
    expect(sample.values.corpo).not.toContain('{{');
    expect(sample.bodyFit).not.toBeNull();
    expect(sample.bodyFit?.fits).toBe(true);
  });

  it('WORST_CASE esvazia os opcionais de CONTEÚDO e mantém a auditoria', () => {
    const layout = layoutOf([bodyElement('{{nome}} — {{atividade}} — {{cpf}} — {{periodo}}'), ...probatoryElements()]);
    const worst = certificatePreviewSample(layout, 'WORST_CASE');
    const full = certificatePreviewSample(layout, 'FULL');

    expect(worst.variant).toBe('WORST_CASE');
    expect(worst.values.atividade).toBe('');
    expect(worst.values.cpf).toBe('');
    expect(worst.values.periodo).toBe('');
    expect(worst.values.titulo_apresentacao).toBe('');
    expect(worst.values.nome).toBe(full.values.nome);
    expect(worst.values.hash).toBe(full.values.hash);
    expect(worst.values.assinatura).toBe(full.values.assinatura);

    // O pior caso do gabarito mostra os BURACOS — é para isso que ele existe.
    expect(worst.values.corpo).toContain('Ana Souza —  —  — ');
    expect(worst.values.corpo).not.toContain('{{');
  });

  it('a amostra padrão (`sampleVariableValues()`) não mudou', () => {
    const values = sampleVariableValues();

    expect(Object.keys(values)).toHaveLength(16);
    for (const key of CONTENT_VARIABLE_KEYS) expect(values[key]?.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o hash dos documentos ANTIGOS não muda', () => {
  /**
   * Os números abaixo foram MEDIDOS com o código de antes da FASE 86, e são o
   * contrato: um modelo SEM `BODY` tem de serializar exatamente como antes (o
   * elemento novo não acrescenta campo nem remove nada). Se algum dia alguém
   * acrescentar um campo ao layout ou uma variável ao conteúdo, ESTE teste reprova
   * antes de um único certificado ser reemitido.
   */
  const PINNED_LAYOUT_HASHES: Readonly<Record<string, string>> = {
    'classico-institucional': 'aa78741bc0f7bd6a6a726a85260a9d205b7d999c69c2178e845b5e9d654ed114',
    'faixa-lateral': 'b3ebc2f1e9eea9935b02dc65145f7e3d31f449c1d6cae225e9bfd497ad1d3a86',
    minimalista: '39714813aa5115a43127fa41c32fe72f0e117499dd5a6857700934084f84b319',
    diploma: 'fa7f669b0e540b71586534d509484ee5e264a6c7d1cf0755bc9039871b939d14',
    'formal-com-portaria': '7f176413216c5258015144ad3d1fc3bc98730cf69f349412dfd059533e15e6d7',
  };

  it('os cinco modelos prontos serializam com o MESMO hash de antes da fase', () => {
    for (const preset of CERTIFICATE_TEMPLATE_PRESETS) {
      expect(hashLayout(preset.layout), preset.id).toBe(PINNED_LAYOUT_HASHES[preset.id]);
    }
  });

  it('a serialização do layout não ganhou nem perdeu campo (JSON preso palavra por palavra)', () => {
    const small: CertificateLayout = layoutOf([
      element({
        id: 'corpo',
        kind: 'VARIABLE',
        variable: 'corpo',
        text: null,
        xMm: 24,
        yMm: 90,
        widthMm: 249,
        heightMm: 40,
        align: 'CENTER',
        sizePt: 13,
        lineHeight: 1.6,
      }),
      element({ id: 'qr', kind: 'QR', text: null, xMm: 240, yMm: 158, widthMm: 34, heightMm: 34, align: 'CENTER' }),
    ]);

    expect(serializeLayout(small)).toBe(
      '{"page":"A4_LANDSCAPE","background":null,"elements":[{"id":"corpo","kind":"VARIABLE","xMm":24,"yMm":90,"widthMm":249,"heightMm":40,"align":"CENTER","font":"HELVETICA","sizePt":13,"color":"#111827","lineHeight":1.6,"text":null,"variable":"corpo"},{"id":"qr","kind":"QR","xMm":240,"yMm":158,"widthMm":34,"heightMm":34,"align":"CENTER","font":"HELVETICA","sizePt":12,"color":"#111827","lineHeight":1.4,"text":null,"variable":null}]}',
    );
    expect(hashLayout(small)).toBe('bce67d38355c7047274d5323cebd572cef16bc3757cc56b203196975748c2aca');
  });

  it('o conteúdo canônico continua com as MESMAS 13 chaves, na mesma ordem', () => {
    expect(CONTENT_VARIABLE_KEYS).toEqual([
      'nome',
      'titulo',
      'corpo',
      'evento',
      'atividade',
      'carga_horaria',
      'periodo',
      'data_emissao',
      'instituicao',
      'codigo_validacao',
      'url_validacao',
      'cpf',
      'titulo_apresentacao',
    ]);

    const serialized = serializeContentValues(contentValuesFrom(sampleVariableValues()));
    expect(Object.keys(JSON.parse(serialized))).toEqual([...CONTENT_VARIABLE_KEYS]);

    // A impressão do JSON inteiro: qualquer valor de exemplo novo também aparece aqui.
    expect(createHash('sha256').update(serialized, 'utf8').digest('hex')).toBe(
      '81ea2923f5c76f08ad2f2cfb3f3ccb2ee08134f24ff8c63a571abdb1fdf5cbbf',
    );
  });
});
