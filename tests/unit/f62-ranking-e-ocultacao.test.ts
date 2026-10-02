/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — A IDENTIDADE DO RANKING PASSA PELA OCULTAÇÃO
 *  (FASE 62 · dívida E80)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM, E POR QUE CADA UM IMPORTA
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a decisão da dívida é a MÁSCARA, e ela é verificável sem banco: quem está
 *      oculto sai com nome abreviado e sem `@handle`/foto, e quem NÃO está sai
 *      byte a byte como entrou (a régua é da pessoa, não um blecaute da lista);
 *    • a pergunta "pode citar?" continua fail-closed: sem a coluna (`undefined`),
 *      a resposta é "oculto" — o erro vira gente abreviada, que se investiga, e
 *      não identidade publicada, que não se investiga;
 *    • a abreviação é UMA só: o `maskName` do sorteio (F16) e o `maskPersonName` da
 *      fonte única são a MESMA função — a E79 mostrou que régua copiada diverge.
 *
 *  O que só o banco prova (a decisão real da moderação e o serviço de verdade) está
 *  em `tests/integration/f62-ranking-e-ocultacao.test.ts`, e o que só o navegador
 *  prova está em `tests/e2e/f62-ranking-e-ocultacao.spec.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  leaderboardIdentity,
  type LeaderboardPersonSource,
} from '../../src/domain/gamification/leaderboard-rules';
import { isPersonPubliclyVisible, maskPersonName } from '../../src/domain/profile/public-profile-rules';
import { maskName } from '../../src/domain/raffles/raffle-rules';

/** A data da decisão de moderação: o conteúdo é irrelevante, o FATO é o que conta. */
const OCULTADA_EM = new Date('2026-05-04T12:00:00Z');

const FOTO = 'https://acervo.exemplo.test/ana.webp';

function pessoa(overrides: Partial<LeaderboardPersonSource> = {}): LeaderboardPersonSource {
  return {
    name: 'Ana Souza',
    publicHandle: 'ana-souza',
    image: FOTO,
    publicProfileHiddenAt: null,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 62 · E80 — a identidade do ranking', () => {
  it('quem NÃO foi ocultado sai exatamente como entrou', () => {
    const identity = leaderboardIdentity(pessoa());

    expect(identity).toEqual({
      name: 'Ana Souza',
      publicHandle: 'ana-souza',
      image: FOTO,
      masked: false,
    });
  });

  it('quem foi ocultado CONTINUA no ranking, com o nome abreviado e sem identidade', () => {
    const identity = leaderboardIdentity(pessoa({ publicProfileHiddenAt: OCULTADA_EM }));

    /**
     * A linha não desaparece: `leaderboardIdentity` não remove nada, só troca a
     * identidade. É a decisão da dívida (posição e contagem são o conteúdo) presa no
     * lugar onde ela é tomada.
     */
    expect(identity.name).toBe('Ana S.');
    expect(identity.publicHandle).toBeNull();
    expect(identity.image).toBeNull();
    expect(identity.masked).toBe(true);
  });

  it('a abreviação preserva o que não identifica: nome de uma palavra só', () => {
    const identity = leaderboardIdentity(
      pessoa({ name: 'Ana', publicProfileHiddenAt: OCULTADA_EM }),
    );

    /** `A.` não identificaria nem para quem convive com a pessoa (régua da F16). */
    expect(identity.name).toBe('Ana');
  });

  it('nome composto é abreviado pela régua do sorteio, e não por outra', () => {
    const identity = leaderboardIdentity(
      pessoa({ name: 'Ana Maria de Souza', publicProfileHiddenAt: OCULTADA_EM }),
    );

    expect(identity.name).toBe('Ana M. S.');
  });

  it('sem a coluna da ocultação (`undefined`), a pessoa é tratada como OCULTA (fail-closed)', () => {
    /**
     * O caso do `select` que esquece a coluna: o tipo já reprova no `tsc`, e este é o
     * cinto para o que escapar do tipo (um `select` montado em runtime, um cast). A
     * resposta errada aqui publicaria a identidade de quem a moderação tirou do ar —
     * por isso ela é "abreviado e sem handle", que se investiga.
     */
    const semColuna = {
      name: 'Ana Souza',
      publicHandle: 'ana-souza',
      image: FOTO,
      publicProfileHiddenAt: undefined,
    } as unknown as LeaderboardPersonSource;

    expect(isPersonPubliclyVisible(semColuna)).toBe(false);

    const identity = leaderboardIdentity(semColuna);

    expect(identity.name).toBe('Ana S.');
    expect(identity.publicHandle).toBeNull();
    expect(identity.image).toBeNull();
  });

  it('a abreviação é UMA só — a do sorteio e a da fonte única são a mesma função', () => {
    /**
     * A E79 deixou a lição: régua copiada nasce sem a checagem na superfície seguinte.
     * O `maskName` do sorteio passou a ser um apelido de `maskPersonName`; este caso
     * impede que alguém reintroduza uma segunda implementação com o mesmo nome.
     */
    expect(maskName).toBe(maskPersonName);
    expect(maskName('Ana Souza')).toBe('Ana S.');
  });
});
