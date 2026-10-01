import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  hasParticipantReply,
  lastParticipantReplyAt,
  replyBodyProblem,
  replySubjectFor,
  threadRootFor,
} from '../../src/domain/communication/message-thread-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  A CONVERSA DO RECADO (FASE 56 · dívida E45)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Três decisões desta dívida são puras e têm consequência visível:
 *
 *    • a resposta aponta para a RAIZ — sem isso a conversa vira árvore e o indicador
 *      "respondeu" deixa de caber numa consulta;
 *    • o `Re:` entra UMA vez — responder a uma resposta não pode empilhar prefixos;
 *    • "respondeu" é DIREÇÃO, não contagem — duas mensagens da instituição não são
 *      uma resposta da pessoa.
 */
describe('threadRootFor()', () => {
  it('o recado original é a própria raiz', () => {
    expect(threadRootFor({ id: 'recado-1', parentId: null })).toBe('recado-1');
  });

  it('a resposta aponta para o pai, e a resposta da resposta continua na MESMA raiz', () => {
    expect(threadRootFor({ id: 'resposta-1', parentId: 'recado-1' })).toBe('recado-1');
    /** É isto que mantém a conversa PLANA: responder a resposta não cria um nível novo. */
    expect(threadRootFor({ id: 'resposta-2', parentId: 'recado-1' })).toBe('recado-1');
  });
});

describe('replySubjectFor()', () => {
  it('acrescenta o prefixo uma vez', () => {
    expect(replySubjectFor('Sobre o seu credenciamento')).toBe('Re: Sobre o seu credenciamento');
  });

  it('não empilha prefixos quando o assunto já é resposta', () => {
    expect(replySubjectFor('Re: Sobre o seu credenciamento')).toBe(
      'Re: Sobre o seu credenciamento',
    );
    expect(replySubjectFor('RE: outro assunto')).toBe('RE: outro assunto');
  });

  it('não estoura o teto da coluna — assunto longo é truncado, não recusado', () => {
    const longo = 'a'.repeat(MAX_SUBJECT_LENGTH);
    const resposta = replySubjectFor(longo);

    expect(resposta.length).toBe(MAX_SUBJECT_LENGTH);
    expect(resposta.startsWith('Re: ')).toBe(true);
  });

  it('apara o espaço das pontas', () => {
    expect(replySubjectFor('  Convite  ')).toBe('Re: Convite');
  });
});

describe('hasParticipantReply() e lastParticipantReplyAt()', () => {
  const recado = { id: 'recado-1', parentId: null, direction: 'OUTBOUND' as const };
  const resposta = { id: 'resposta-1', parentId: 'recado-1', direction: 'INBOUND' as const };

  it('sem resposta da pessoa, o indicador é falso', () => {
    expect(hasParticipantReply([recado])).toBe(false);
    expect(lastParticipantReplyAt([{ ...recado, sentAt: new Date('2026-01-01') }])).toBeNull();
  });

  it('a DIREÇÃO decide — a contagem de mensagens não', () => {
    const segundoRecado = { id: 'recado-2', parentId: null, direction: 'OUTBOUND' as const };

    expect(hasParticipantReply([recado, segundoRecado])).toBe(false);
    expect(hasParticipantReply([recado, resposta])).toBe(true);
  });

  it('devolve a resposta MAIS RECENTE, não a primeira da lista', () => {
    const antiga = { ...resposta, id: 'r1', sentAt: new Date('2026-01-05T10:00:00Z') };
    const nova = { ...resposta, id: 'r2', sentAt: new Date('2026-02-01T10:00:00Z') };

    expect(lastParticipantReplyAt([antiga, nova])).toEqual(nova.sentAt);
    expect(lastParticipantReplyAt([nova, antiga])).toEqual(nova.sentAt);
  });
});

describe('replyBodyProblem()', () => {
  it('texto só com espaços é vazio', () => {
    expect(replyBodyProblem('')).toBe('EMPTY');
    expect(replyBodyProblem('   \n  ')).toBe('EMPTY');
  });

  it('acima do teto é recusado com o motivo', () => {
    expect(replyBodyProblem('a'.repeat(MAX_MESSAGE_BODY_LENGTH + 1))).toBe('TOO_LONG');
    expect(replyBodyProblem('a'.repeat(MAX_MESSAGE_BODY_LENGTH))).toBeNull();
  });

  it('resposta normal passa', () => {
    expect(replyBodyProblem('Consigo chegar às 14h, obrigada!')).toBeNull();
  });
});
