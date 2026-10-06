/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 69 · OS RÓTULOS DE MODALIDADE — A FONTE ÚNICA E A PROVA DE QUE NADA MUDOU
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRECISA PROVAR (e por que não basta "o teste passou")
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fase trocou SEIS cópias dos rótulos "Presencial · Online · Híbrido" por uma fonte
 *  única no domínio (`event-modality-rules.ts`). O risco de uma troca dessas não é o
 *  código não compilar — é o texto MUDAR em uma das seis telas e ninguém ver: a etiqueta
 *  da página pública é decoração para quem revisa, e "Híbrido" virando "Hibrido" passaria
 *  em qualquer revisão de olho.
 *
 *  Por isso o teste tem TRÊS camadas, e as três são necessárias:
 *
 *    1. **O contrato do texto** — as três palavras, uma a uma, presas em igualdade.
 *    2. **O ORÁCULO** — o ternário aninhado ANTIGO reescrito aqui, comparado com a função
 *       nova para toda a matriz de entradas (inclusive as que NÃO são modalidade válida).
 *       É o que transforma "eu conferi as telas" em "o texto não mudou, e está medido".
 *    3. **A CATRACA da fonte** — nenhum arquivo do `src/` volta a escrever o rótulo à mão.
 *       Sem ela, a fonte única dura até a próxima tela que precisar de uma etiqueta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MATRIZ INCLUI VALORES QUE NÃO SÃO MODALIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Porque era assim que o código antigo se comportava: `modality` chega do banco como
 *  `string`, e o ternário antigo escrevia "Presencial" para QUALQUER coisa que não fosse
 *  `ONLINE` ou `HYBRID` — inclusive para `''`, para `'TELEPATIA'` e para `null`. Se a
 *  função nova resolvesse "melhor" (devolvendo vazio, ou o valor cru), a tela de um dado
 *  antigo mudaria de texto — e o teste abaixo reprovaria, que é o que se quer.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EVENT_MODALITY_LABELS,
  EVENT_MODALITY_OPTIONS,
  eventModalityLabel,
  type EventModalityValue,
} from '@/domain/events/event-modality-rules';

// ═══════════════════════════════════════════════════════════════════════════════
//  O ORÁCULO — o desenho ANTIGO, reescrito aqui de propósito
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * O ternário aninhado que estava em `event-landing.tsx`, `tenant-page.tsx` e
 * `public-event-list.tsx` (e a lista de opções que estava nas três telas de
 * administração). Ele vive AQUI como contrato: é a resposta que a tela dava antes da
 * fase, e a resposta que ela tem de continuar dando.
 *
 * Reescrever o oráculo é mais forte do que copiar o resultado esperado: ele cobre a
 * matriz inteira, e não os três casos que alguém lembrou de conferir.
 */
function rotuloAntigo(modality: string | null | undefined): string {
  if (modality === 'ONLINE') return 'Online';
  if (modality === 'HYBRID') return 'Híbrido';

  return 'Presencial';
}

/** As entradas que a tela pode receber — as válidas, as vazias e as inesperadas. */
const MATRIZ: readonly (string | null | undefined)[] = [
  'IN_PERSON',
  'ONLINE',
  'HYBRID',
  '',
  '   ',
  'TELEPATIA',
  'online',
  'Online',
  'in_person',
  null,
  undefined,
];

// ═══════════════════════════════════════════════════════════════════════════════
//  (1) O CONTRATO DO TEXTO
// ═══════════════════════════════════════════════════════════════════════════════
describe('os rótulos de modalidade têm um só texto', () => {
  it('as três palavras são exatamente as que o produto já mostrava', () => {
    expect(EVENT_MODALITY_LABELS).toEqual({
      IN_PERSON: 'Presencial',
      ONLINE: 'Online',
      HYBRID: 'Híbrido',
    });
  });

  it('a lista do `<select>` é a mesma das três telas, na mesma ordem', () => {
    /**
     * A ordem é parte do que a tela entrega (`<select>` sem ordenação posterior), e os
     * três formulários a mostravam nesta sequência desde sempre.
     */
    expect(EVENT_MODALITY_OPTIONS).toEqual([
      { value: 'IN_PERSON', label: 'Presencial' },
      { value: 'ONLINE', label: 'Online' },
      { value: 'HYBRID', label: 'Híbrido' },
    ]);
  });

  it('cobre o enum sem sobra e sem falta (nenhuma modalidade sem rótulo)', () => {
    const valores: EventModalityValue[] = ['IN_PERSON', 'ONLINE', 'HYBRID'];

    expect(Object.keys(EVENT_MODALITY_LABELS).sort()).toEqual([...valores].sort());
    expect(EVENT_MODALITY_OPTIONS.map((opcao) => opcao.value)).toEqual(valores);
  });

  it('a opção e o rótulo não podem divergir (o select e a etiqueta leem o mesmo mapa)', () => {
    for (const opcao of EVENT_MODALITY_OPTIONS) {
      expect(opcao.label, `o rótulo da opção ${opcao.value}`).toBe(
        EVENT_MODALITY_LABELS[opcao.value],
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (2) O ORÁCULO — nenhuma palavra mudou, para nenhuma entrada
// ═══════════════════════════════════════════════════════════════════════════════
describe('nenhum rótulo mudou de texto (a prova pelo desenho antigo)', () => {
  it('a função nova responde o MESMO que o ternário antigo para toda a matriz', () => {
    for (const entrada of MATRIZ) {
      expect(eventModalityLabel(entrada), `o rótulo de ${JSON.stringify(entrada)}`).toBe(
        rotuloAntigo(entrada),
      );
    }
  });

  it('o que não é modalidade cai em "Presencial" — o mesmo fallback de antes', () => {
    /**
     * Este caso é o que impede a "melhoria" silenciosa: devolver string vazia, o valor
     * cru (`'TELEPATIA'`) ou um travessão seriam três desenhos defensáveis e NENHUM
     * deles o comportamento que o produto tinha. A fase não é sobre melhorar o fallback.
     */
    for (const entrada of ['', '   ', 'TELEPATIA', 'online', null, undefined]) {
      expect(eventModalityLabel(entrada)).toBe('Presencial');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (3) A CATRACA — a fonte única não pode voltar a ser seis
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * Os arquivos SEM comentário: este projeto comenta MUITO, e os comentários citam os
 * rótulos em português (inclusive o cabeçalho do próprio módulo da fonte única). Procurar
 * a palavra dentro de comentário daria uma reprovação que não é código — a varredura tem
 * de medir o que o componente ESCREVE, não o que ele explica.
 */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (achado) => achado.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');
}

const RAIZ = process.cwd();
const FONTE_UNICA = 'src/domain/events/event-modality-rules.ts';

/** Todos os `.ts`/`.tsx` do `src/` — a varredura não escolhe arquivo a dedo. */
function arquivosDoSrc(diretorio = 'src'): string[] {
  return readdirSync(join(RAIZ, diretorio)).flatMap((nome) => {
    const caminho = join(diretorio, nome);

    if (statSync(join(RAIZ, caminho)).isDirectory()) return arquivosDoSrc(caminho);

    return /\.tsx?$/.test(nome) ? [caminho.split('\\').join('/')] : [];
  });
}

describe('a catraca da fonte única', () => {
  it('nenhum outro arquivo do `src/` escreve o rótulo de modalidade à mão', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A VARREDURA PROCURA "Presencial" E "Híbrido", E NÃO "Online"
     * ─────────────────────────────────────────────────────────────────────────────
     *  Porque `Online` é uma palavra sobrecarregada no produto: o console do monitor de
     *  credenciamento diz "Online" para o estado da REDE, e varrer por ela reprovaria um
     *  texto que não tem nada a ver com modalidade. Já as outras duas não têm outro
     *  sentido — e o ternário antigo SEMPRE escrevia uma das duas, então qualquer
     *  reincidência do desenho antigo cai nesta varredura.
     */
    const infratores = arquivosDoSrc()
      .filter((caminho) => caminho !== FONTE_UNICA)
      .filter((caminho) => {
        const fonte = semComentarios(readFileSync(join(RAIZ, caminho), 'utf8'));

        return fonte.includes("'Presencial'") || fonte.includes("'Híbrido'");
      });

    expect(
      infratores,
      `Estes arquivos voltaram a escrever o rótulo de modalidade à mão (a fonte única é ${FONTE_UNICA}):\n${infratores.join('\n')}\n`,
    ).toEqual([]);
  });

  it('as três telas de formulário leem a lista do domínio, e não uma cópia', () => {
    const telas = [
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/dados/page.tsx',
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/page.tsx',
    ];

    for (const tela of telas) {
      const fonte = semComentarios(readFileSync(join(RAIZ, tela), 'utf8'));

      expect(fonte, `${tela} não importa a lista do domínio`).toContain('EVENT_MODALITY_OPTIONS');
      expect(fonte, `${tela} não usa a lista do domínio no formulário`).toMatch(
        /options=\{EVENT_MODALITY_OPTIONS\}/,
      );
    }
  });

  it('as três etiquetas públicas leem a função do domínio', () => {
    const etiquetas = [
      'src/components/events/event-landing.tsx',
      'src/components/tenancy/tenant-page.tsx',
      'src/components/tenancy/public-event-list.tsx',
    ];

    for (const componente of etiquetas) {
      const fonte = semComentarios(readFileSync(join(RAIZ, componente), 'utf8'));

      expect(fonte, `${componente} não importa o rótulo do domínio`).toContain(
        "from '@/domain/events/event-modality-rules'",
      );
      expect(fonte, `${componente} não usa a função do domínio`).toMatch(
        /eventModalityLabel\(event\.modality\)/,
      );
      expect(fonte, `${componente} voltou a comparar a modalidade à mão`).not.toMatch(
        /modality === 'ONLINE'/,
      );
    }
  });

  it('a união de modalidade é declarada UMA vez (a de `event-form-defaults` é re-export)', () => {
    /**
     * A FASE 68 declarou `EventModalityValue` em `event-form-defaults.ts`; a FASE 69
     * precisou do mesmo conjunto para os rótulos. Duas declarações da mesma união
     * compilam as duas e divergem em silêncio — que é o defeito que esta fase veio
     * fechar. Aqui a segunda é presa como RE-EXPORT, e não como declaração.
     */
    const padroes = semComentarios(
      readFileSync(join(RAIZ, 'src/domain/events/event-form-defaults.ts'), 'utf8'),
    );

    expect(padroes).toContain(
      "export type { EventModalityValue } from '@/domain/events/event-modality-rules'",
    );
    expect(padroes, 'a união voltou a ser declarada em dois lugares').not.toMatch(
      /export type EventModalityValue\s*=\s*'IN_PERSON'/,
    );
  });
});
