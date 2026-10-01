import { describe, expect, it } from 'vitest';

import {
  CPF_FORM_FIELD,
  cpfDigits,
  cpfFromFormResponses,
  formatCpf,
  isValidCpf,
} from '../../src/domain/events/registration-form-rules';
import { resolveCertificateVariables } from '../../src/domain/certificates/certificate-layout-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O CPF QUE VAI PARA O CERTIFICADO (FASE 56 · dívida E54)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O CPF é pedido no formulário de INSCRIÇÃO (não no perfil), é validado pelos dois
 *  dígitos verificadores e sai formatado no documento. Cada uma dessas três decisões
 *  tem um teste aqui, porque cada uma tem uma forma de dar errado em silêncio:
 *  guardar máscara, aceitar `111.111.111-11` e imprimir onze dígitos crus.
 */
const CPF_VALIDO = '52998224725';
const CPF_VALIDO_COM_MASCARA = '529.982.247-25';

describe('isValidCpf()', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(isValidCpf(CPF_VALIDO)).toBe(true);
    expect(isValidCpf(CPF_VALIDO_COM_MASCARA)).toBe(true);
    expect(isValidCpf(' 529 982 247 25 ')).toBe(true);
  });

  it('recusa quando o dígito verificador não fecha', () => {
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('52998224735')).toBe(false);
  });

  it('recusa a sequência repetida — ela passa nas contas e não é CPF de ninguém', () => {
    for (let digit = 0; digit <= 9; digit += 1) {
      expect(isValidCpf(String(digit).repeat(11)), `${digit} repetido`).toBe(false);
    }
  });

  it('recusa o que nem tem onze dígitos', () => {
    expect(isValidCpf('')).toBe(false);
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247251')).toBe(false);
    expect(isValidCpf('abcdefghijk')).toBe(false);
  });
});

describe('formatCpf()', () => {
  it('formata para imprimir', () => {
    expect(formatCpf(CPF_VALIDO)).toBe(CPF_VALIDO_COM_MASCARA);
    expect(formatCpf(CPF_VALIDO_COM_MASCARA)).toBe(CPF_VALIDO_COM_MASCARA);
  });

  it('devolve `null` — e não string vazia — quando não é válido', () => {
    expect(formatCpf('123')).toBeNull();
    expect(formatCpf('11111111111')).toBeNull();
  });

  it('cpfDigits() é só os números: guardar máscara obrigaria a desformatar em toda leitura', () => {
    expect(cpfDigits(CPF_VALIDO_COM_MASCARA)).toBe(CPF_VALIDO);
  });
});

describe('cpfFromFormResponses()', () => {
  it('lê o campo do formulário em dígitos', () => {
    expect(cpfFromFormResponses({ [CPF_FORM_FIELD]: CPF_VALIDO })).toBe(CPF_VALIDO);
    expect(cpfFromFormResponses({ [CPF_FORM_FIELD]: CPF_VALIDO_COM_MASCARA })).toBe(CPF_VALIDO);
  });

  it('devolve `null` para ausente, inválido ou de outro tipo', () => {
    expect(cpfFromFormResponses({})).toBeNull();
    expect(cpfFromFormResponses({ [CPF_FORM_FIELD]: '123' })).toBeNull();
    expect(cpfFromFormResponses({ [CPF_FORM_FIELD]: 52998224725 })).toBeNull();
    expect(cpfFromFormResponses(null)).toBeNull();
    expect(cpfFromFormResponses('52998224725')).toBeNull();
  });
});

describe('as duas variáveis novas do certificado', () => {
  const documento = {
    recipientName: 'Ana Souza',
    title: 'Certificado de participação',
    bodyText: 'Participou do evento.',
    eventTitle: 'Simpósio de 2026',
    activityTitle: 'Mesa de abertura',
    workloadLabel: '8 horas',
    period: '10 a 12 de outubro de 2026',
    issuedAtLabel: '01/01/2026',
    tenantName: 'Instituição Exemplo',
    validationCode: 'ABC123',
    validationUrl: 'https://exemplo.test/validar/ABC123',
    contentHash: 'hash',
    signature: 'assinatura',
    keyId: 'chave-1',
  };

  it('o CPF sai FORMATADO no documento', () => {
    const values = resolveCertificateVariables({
      ...documento,
      cpf: CPF_VALIDO,
      presentationTitle: null,
    });

    expect(values.cpf).toBe(CPF_VALIDO_COM_MASCARA);
  });

  it('CPF inválido ou ausente vira vazio — o elemento não sai no certificado', () => {
    expect(
      resolveCertificateVariables({ ...documento, cpf: '123', presentationTitle: null }).cpf,
    ).toBe('');
    expect(
      resolveCertificateVariables({ ...documento, cpf: null, presentationTitle: null }).cpf,
    ).toBe('');
  });

  it('o título da apresentação é o do trabalho enviado', () => {
    const values = resolveCertificateVariables({
      ...documento,
      cpf: null,
      presentationTitle: 'Aprendizado de máquina na vigilância epidemiológica',
    });

    expect(values.titulo_apresentacao).toBe(
      'Aprendizado de máquina na vigilância epidemiológica',
    );
  });

  it('quem não submeteu trabalho tem a variável vazia — e não a palavra "null"', () => {
    const values = resolveCertificateVariables({
      ...documento,
      cpf: null,
      presentationTitle: null,
    });

    expect(values.titulo_apresentacao).toBe('');
  });
});
