/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O ANEXO NA PROPOSTA PÚBLICA (FASE 74 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A proposta científica NÃO se completa na página pública: os dados viram rascunho,
 *  e o anexo + o envio acontecem na área do autor, onde a esteira existe inteira.
 *  Esta é a escolha A, e ela é premissa de DESENHO — não um acidente. Por isso há
 *  catracas de fonte: trazer `requestUploadAction`/`SubmissionUploader` para a página
 *  pública (ou um `<input type="file">` para o formulário) exige uma decisão nova, e
 *  o teste falha antes de a segunda superfície de storage nascer.
 *
 *  O aviso do passo ("o rascunho fica salvo e você continua na sua área") é do
 *  DOMÍNIO, derivado da MESMA função que decide a exigência — a tela não escreve a
 *  frase, e uma chamada sem exigência de arquivo (`null`) não ganha aviso nenhum.
 *
 *  E o teto de rascunhos COM arquivo: o número é declarado, o N+1 é recusado com o
 *  número e o caminho na mensagem, e a contagem é por rascunho COM arquivo — o vazio
 *  é reciclado e não pode consumir a cota de quem está tentando enviar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  proposalAttachmentStepNotice,
  submissionArtifactRequirements,
} from '../../src/domain/review/submission-rules';
import {
  canStartAnotherDraftWithFile,
  MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL,
} from '../../src/domain/proposals/proposal-draft-rules';

const PAGINA_DA_CHAMADA =
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx';
const FORMULARIO = 'src/components/proposals/proposal-form.tsx';
const SERVICO = 'src/lib/review/submission-service.ts';
const DOMINIO_DO_TETO = 'src/domain/proposals/proposal-draft-rules.ts';

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fonte(caminho: string): string {
  return semComentarios(readFileSync(join(process.cwd(), caminho), 'utf8'));
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('proposalAttachmentStepNotice() — o passo do arquivo, antes do envio', () => {
  it('a chamada científica anuncia o passo: rascunho salvo e conclusão na área do autor', () => {
    for (const proposalKind of ['PAPER', 'POSTER'] as const) {
      const aviso = proposalAttachmentStepNotice({
        requiresBlindReview: true,
        proposalKind,
      });

      expect(aviso, proposalKind).toEqual(expect.any(String));
      expect(aviso, proposalKind).toContain('exige um arquivo');
      expect(aviso, proposalKind).toContain('rascunho fica salvo');
      expect(aviso, proposalKind).toContain('sua área');
      expect(aviso, proposalKind).toContain('envia para avaliação');
    }
  });

  it('a chamada cega de um tipo de programação também anuncia (a exigência é da cegueira)', () => {
    const aviso = proposalAttachmentStepNotice({
      requiresBlindReview: true,
      proposalKind: 'MINICOURSE',
    });

    expect(aviso).toEqual(expect.any(String));
  });

  it('a chamada científica SEM cegueira também anuncia — o PDF continua obrigatório', () => {
    const aviso = proposalAttachmentStepNotice({
      requiresBlindReview: false,
      proposalKind: 'PAPER',
    });

    expect(aviso).toEqual(expect.any(String));
  });

  it('a chamada de programação sem exigência de arquivo não ganha aviso (`null`)', () => {
    for (const proposalKind of ['SPEAKER', 'MINICOURSE', 'WORKSHOP', 'ROUNDTABLE', 'OTHER'] as const) {
      expect(
        proposalAttachmentStepNotice({ requiresBlindReview: false, proposalKind }),
        proposalKind,
      ).toBeNull();
    }
  });

  it('o aviso é GENÉRICO: quem nomeia o arquivo é a lista de exigências, não ele', () => {
    /**
     * A frase não diz "PDF anonimizado" — quem diz é `submissionArtifactRequirements`,
     * mostrada logo acima. Duas frases nomeando o arquivo seriam duas verdades: no dia
     * em que a exigência mudasse, uma delas ficaria para trás (o defeito da fatia 2).
     */
    const aviso = proposalAttachmentStepNotice({ requiresBlindReview: true, proposalKind: 'PAPER' });

    expect(aviso).not.toContain('PDF');
    expect(
      submissionArtifactRequirements({ requiresBlindReview: true, proposalKind: 'PAPER' })[0]
        ?.label,
    ).toContain('PDF');
  });

  it('o aviso nasce da MESMA função que decide a exigência (fonte única)', () => {
    const dominio = fonte('src/domain/review/submission-rules.ts');

    expect(dominio).toContain('export function proposalAttachmentStepNotice');
    expect(dominio).toContain('submissionArtifactRequirements(input).some');
    expect(dominio).toContain('requirement.required');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('canStartAnotherDraftWithFile() — o teto de rascunhos com arquivo', () => {
  it('o teto é declarado no DOMÍNIO e vale cinco', () => {
    /**
     * O número aparece no teste e na mensagem porque é uma decisão de produto — não
     * um detalhe de implementação. Mudá-lo é mudar a mensagem que a pessoa lê.
     */
    expect(MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL).toBe(5);
    expect(fonte(DOMINIO_DO_TETO)).toContain(
      `MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL = ${MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL}`,
    );
  });

  it('abaixo do teto começa outro trabalho; NO teto (o N+1) é recusado', () => {
    for (let draftsWithFile = 0; draftsWithFile < MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL; draftsWithFile += 1) {
      expect(canStartAnotherDraftWithFile({ draftsWithFile }), String(draftsWithFile)).toEqual({
        allowed: true,
      });
    }

    const recusa = canStartAnotherDraftWithFile({
      draftsWithFile: MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL,
    });

    expect(recusa.allowed).toBe(false);
    if (recusa.allowed) return;

    expect(recusa.code).toBe('DRAFT_FILE_LIMIT_REACHED');
    expect(recusa.message).toContain('5');
    expect(recusa.message).toContain('rascunhos com arquivo');
    /** O caminho que resolve, e não só o número: enviar ou excluir. */
    expect(recusa.message).toContain('Envie ou exclua');
    expect(recusa.details.join(' ')).toContain('armazenamento');
  });

  it('um acima do teto continua recusado (a regra não é uma igualdade acidental)', () => {
    expect(
      canStartAnotherDraftWithFile({ draftsWithFile: MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL + 3 })
        .allowed,
    ).toBe(false);
  });

  it('a recusa é de RASCUNHO, não de proposta: ela não menciona limite de propostas', () => {
    const recusa = canStartAnotherDraftWithFile({
      draftsWithFile: MAX_DRAFTS_WITH_FILE_PER_AUTHOR_PER_CALL,
    });

    if (recusa.allowed) throw new Error('O teto deveria recusar.');

    expect(recusa.message).not.toMatch(/limite de propostas/i);
    expect(recusa.message).not.toMatch(/propostas? por pessoa/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('as catracas do desenho A — a segunda superfície de storage não volta', () => {
  it('a página da chamada anuncia o passo e NÃO abre upload', () => {
    const pagina = fonte(PAGINA_DA_CHAMADA);

    expect(pagina).toContain('proposalAttachmentStepNotice');
    expect(pagina).toContain('data-testid="proposal-attachment-notice"');

    /**
     * A decisão da fatia: o upload mora na área do autor. Se alguém trouxer a esteira
     * de upload para cá, o aviso "você continua na sua área" passa a ser mentira — e é
     * este teste que impede a mentira de nascer.
     */
    expect(pagina).not.toContain('requestUploadAction');
    expect(pagina).not.toContain('confirmUploadAction');
    expect(pagina).not.toContain('SubmissionUploader');
    expect(pagina).not.toContain('type="file"');
  });

  it('o formulário público continua só de metadados — sem hash, sem PUT, sem uploader', () => {
    const formulario = fonte(FORMULARIO);

    expect(formulario).not.toContain('SubmissionUploader');
    expect(formulario).not.toContain('requestUploadAction');
    expect(formulario).not.toContain('confirmUploadAction');
    expect(formulario).not.toContain('crypto.subtle');
    expect(formulario).not.toContain('type="file"');

    /**
     * A saída da recusa com rascunho não mora mais no formulário: a action
     * REDIRECIONA para o rascunho (FASE 74 · ajuste da fatia 2), e o link "Continuar
     * na área do autor" deixou de existir. O caminho da página pública continua
     * sendo a área do autor — só que agora a navegação é do servidor.
     */
    expect(formulario).not.toContain('data-testid="proposal-draft-link"');
    expect(formulario).not.toContain('Continuar na área do autor');
  });

  it('a recusa do TETO também diz o caminho: um link para os rascunhos, não só o número', () => {
    const formulario = fonte(FORMULARIO);

    /**
     * A mensagem do teto manda "envie ou exclua um deles" — e o formulário precisa
     * levar aonde isso se faz. `submissionId` não serve aqui (são vários rascunhos);
     * o destino é a LISTA.
     */
    expect(formulario).toContain(`state.code === 'DRAFT_FILE_LIMIT_REACHED'`);
    expect(formulario).toContain('data-testid="proposal-draft-ceiling-link"');
    expect(formulario).toContain("/submissoes')");
  });

  it('o teto é aplicado no SERVIÇO, sobre rascunho COM arquivo, dentro da transação', () => {
    const servico = fonte(SERVICO);

    expect(servico).toContain('canStartAnotherDraftWithFile');
    expect(servico).toContain(`status: 'DRAFT'`);
    expect(servico).toContain('files: { some: { deletedAt: null } }');
    expect(servico).toContain('DRAFT_FILE_LIMIT_REACHED');
  });

  it('a retomada do rascunho vazio NÃO passa pelo teto (o mesmo trabalho não é outro)', () => {
    /**
     * O teto vive no `createSubmission`; a retomada (`findReusableDraft`) nem chega
     * lá. A catraca é sobre a ORDEM do arquivo da proposta: a busca do reusável vem
     * antes e não chama a criação.
     */
    const proposta = fonte('src/lib/proposals/proposal-service.ts');

    const reuso = proposta.indexOf('findReusableDraft({');
    const criacao = proposta.indexOf('createSubmission({');

    expect(reuso).toBeGreaterThan(-1);
    expect(criacao).toBeGreaterThan(reuso);
  });
});
