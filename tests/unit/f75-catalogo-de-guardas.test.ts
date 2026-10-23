/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE CATÁLOGO — AS GUARDAS LOCAIS DAS SERVER ACTIONS
 *                                          (FASE 75 · fatias 1 e 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM TESTE QUE LÊ ARQUIVOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A fatia 2 substituiu as guardas locais por `guardAction` e deixou **4 exceções
 *  declaradas**. O risco de um refactor assim não é apagar uma guarda — é CRIAR a
 *  próxima cópia: alguém precisa de um caso ligeiramente diferente, escreve mais um
 *  `async function guard` no arquivo, e a duplicação volta pela porta dos fundos,
 *  agora com a bênção de "já foi refatorado".
 *
 *  Este teste é a CATRACA: ele lê a árvore de `src/app/actions`, extrai as guardas
 *  que existem de fato e compara com a lista esperada. Guarda nova REPROVA; guarda
 *  que sumiu também (a lista é o contrato, e migrar exige atualizá-la DE PROPÓSITO,
 *  com o motivo escrito). Depois da migração ele também prende, arquivo por
 *  arquivo, que as 17 portas migradas continuam chamando `guardAction`.
 *
 *  Ele não testa comportamento — quem faz isso é
 *  `tests/integration/f75-guardas-caracterizacao.test.ts`. Aqui se prende o
 *  INVENTÁRIO: quem é a guarda, onde ela mora, qual permissão ela pede, em que
 *  escopo, e qual é o SHAPE do `ok` que ela devolve.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS LINHAS SÃO UM RETRATO, NÃO UMA IGUALDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `linha` documenta onde a guarda estava quando este catálogo foi escrito. O teste
 *  NÃO compara a linha: exigir isso transformaria qualquer comentário novo acima da
 *  função numa falha — e catraca que quebra por motivo errado é catraca que se
 *  aprende a ignorar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '../../src/domain/rbac/permissions';

const DIRETORIO = 'src/app/actions';

/**
 * ───────────────────────────────────────────────────────────────────────────────
 *  A LISTA DEPOIS DA MIGRAÇÃO (FASE 75 · fatia 2)
 * ───────────────────────────────────────────────────────────────────────────────
 *  As **16** guardas classificadas `MIGRA` na fatia 1 não existem mais: cada uma
 *  virou uma chamada de `guardAction`, que passou a ser o DONO ÚNICO da checagem
 *  (sessão → instituição → vínculo → permissão). O que sobra nesta lista são as
 *  **4 exceções declaradas** — com o motivo escrito, para que ninguém as "migre"
 *  por engano — e `assertActivityOwnership`, que não autoriza pessoa nenhuma.
 *
 *  A contagem caiu de 21 para 4 porque a fase fez o TRABALHO, não porque alguém
 *  apagou uma linha da lista: o teste 1 continua exigindo igualdade EXATA entre o
 *  que existe na árvore e o que está aqui.
 */
type Classificacao = 'EXCECAO' | 'POSSE_DO_ALVO';

interface GuardaEsperada {
  nome: string;
  arquivo: string;
  /** Retrato medido na entrega da fatia 2 (documentação; não é asserção). */
  linha: number;
  /** Permissões que as CHAMADAS da guarda pedem hoje. Vazio = a guarda não pede nenhuma. */
  permissoes: readonly string[];
  escopo: 'TENANT' | 'EVENT' | 'ACTIVITY' | '—';
  classificacao: Classificacao;
  /** O que precisa continuar verdadeiro no código para a classificação valer. */
  nota: string;
  /** Fragmento normalizado do tipo de retorno `ok` — o shape que a fatia 2 preserva. */
  retornoOk: string;
}

const ESPERADAS: readonly GuardaEsperada[] = [
  {
    nome: 'guardAuthenticated',
    arquivo: 'sponsor-portal-actions.ts',
    linha: 61,
    permissoes: [],
    escopo: '—',
    classificacao: 'EXCECAO',
    nota: 'EXCEÇÃO (sem permissão): sessão + instituição, e NENHUM vínculo — o aceite de convite cria o vínculo.',
    retornoOk: 'ok: true; userId: string; tenantId: string; userEmail: string',
  },
  {
    nome: 'guardSession',
    arquivo: 'sponsor-portal-actions.ts',
    linha: 86,
    permissoes: [],
    escopo: '—',
    classificacao: 'EXCECAO',
    nota: 'EXCEÇÃO (sem permissão): sessão + vínculo ATIVO; a posse é o userId da sessão.',
    retornoOk: 'ok: true; userId: string; tenantId: string; userEmail: string',
  },
  {
    nome: 'speakerGuard',
    arquivo: 'speaker-actions.ts',
    linha: 155,
    permissoes: ['speaker:profile:update:own', 'speaker:material:manage:own'],
    escopo: 'ACTIVITY',
    classificacao: 'EXCECAO',
    nota: 'EXCEÇÃO (`holdsPermission` sem alvo): o papel concedido por ATIVIDADE entra; `can` com escopo TENANT recusaria.',
    retornoOk: 'GuardOk',
  },
  {
    nome: 'guard',
    arquivo: 'demand-actions.ts',
    linha: 60,
    permissoes: [
      'demand:assign',
      'demand:assign:own-team',
      'demand:manage',
      'demand:read',
      'demand:team:manage',
    ],
    escopo: 'EVENT',
    classificacao: 'EXCECAO',
    nota: 'EXCEÇÃO (OU de permissões): `demand:assign` × `demand:assign:own-team`, com alvo EVENT e `viaAlternate` decidindo o caminho no serviço.',
    retornoOk: 'ok: true; userId: string; tenantId: string; principal: Principal; viaAlternate: boolean',
  },
  {
    nome: 'assertActivityOwnership',
    arquivo: 'speaker-actions.ts',
    linha: 223,
    permissoes: [],
    escopo: '—',
    classificacao: 'POSSE_DO_ALVO',
    nota: 'NÃO autoriza a pessoa: confere se ela ministra AQUELA atividade. Entra na lista para não ser confundida com guarda de sessão.',
    retornoOk: '{ ok: true }',
  },
];

/**
 * ───────────────────────────────────────────────────────────────────────────────
 *  AS 17 PORTAS QUE PASSARAM A CHAMAR `guardAction`
 * ───────────────────────────────────────────────────────────────────────────────
 *  **16 diretas** (uma por guarda migrada) + a `registration-actions.ts`, que tem
 *  contrato próprio e passou por um wrapper de TRADUÇÃO (`requireRegistrationActor`:
 *  `null` para quem precisa entrar, exceção para quem não pode). São 17 ARQUIVOS
 *  porque cada guarda morava no seu.
 *
 *  A tabela é o registro da migração — e vira CATRACA junto com o teste 1: se
 *  alguém reescrever uma guarda local com outro nome (que o regex de `async
 *  function guard*` não pega), o arquivo deixa de citar `guardAction` e o teste
 *  reprova. As permissões listadas são as que cada porta precisa continuar pedindo:
 *  migrar não pode trocar a permissão de ninguém.
 */
const MIGRADAS: readonly { arquivo: string; permissoes: readonly string[] }[] = [
  { arquivo: 'admin-actions.ts', permissoes: ['event:update', 'activity:create', 'track:manage', 'registration:update:any', 'card-template:manage'] },
  { arquivo: 'attendance-actions.ts', permissoes: ['registration:checkin', 'registration:checkout'] },
  { arquivo: 'bigscreen-actions.ts', permissoes: ['event:manage'] },
  { arquivo: 'catalog-archive-actions.ts', permissoes: ['card-template:manage', 'task:manage'] },
  { arquivo: 'certificate-actions.ts', permissoes: ['certificate:issue', 'certificate:revoke', 'certificate:read:own', 'event:manage'] },
  { arquivo: 'communication-actions.ts', permissoes: ['tenant:member:invite', 'communication:read', 'participant:message'] },
  { arquivo: 'gamification-actions.ts', permissoes: ['xp:read:own', 'card:read:own', 'xp:adjust', 'card:grant'] },
  { arquivo: 'landing-actions.ts', permissoes: ['page:manage', 'sponsor:manage', 'speaker:manage'] },
  { arquivo: 'member-actions.ts', permissoes: ['tenant:role:assign', 'tenant:member:remove'] },
  { arquivo: 'raffle-actions.ts', permissoes: ['event:manage'] },
  { arquivo: 'registration-actions.ts', permissoes: ['registration:cancel:own', 'registration:create'] },
  { arquivo: 'review-actions.ts', permissoes: ['submission:create', 'submission:update:own', 'submission:assign-reviewer', 'review:submit:own', 'submission:decide'] },
  { arquivo: 'speaker-actions.ts', permissoes: ['speaker:manage'] },
  { arquivo: 'sponsor-actions.ts', permissoes: ['sponsor:manage'] },
  { arquivo: 'sponsor-portal-actions.ts', permissoes: ['sponsor:manage'] },
  { arquivo: 'team-order-actions.ts', permissoes: ['demand:team:manage'] },
  { arquivo: 'tenant-page-actions.ts', permissoes: ['page:manage'] },
];

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura da árvore
// ───────────────────────────────────────────────────────────────────────────────
interface GuardaEncontrada {
  nome: string;
  arquivo: string;
  linha: number;
  /** O texto da função, do `async function` até a chave que a fecha. */
  corpo: string;
}

function normalizar(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * A janela de UMA função de topo: do `async function` até a chave que fecha o CORPO.
 *
 * Não dá para procurar o primeiro `\n}`: metade destas guardas declara o tipo do
 * parâmetro em várias linhas (`input: { … }`), e esse `}` na coluna 0 fecharia a
 * janela antes da checagem de permissão — que é justamente o que se quer ler. Então
 * o fim é encontrado contando chaves a partir da chave do CORPO (a que vem depois do
 * `)` da lista de parâmetros ou do `>` do tipo de retorno).
 */
function janelaDaFuncao(fonte: string, inicio: number): string {
  let profundidade = 0;
  let inicioDoCorpo = -1;

  for (let indice = inicio; indice < fonte.length; indice += 1) {
    const caractere = fonte[indice]!;

    if (caractere === '{') {
      if (profundidade === 0) {
        let anterior = indice - 1;
        while (anterior >= inicio && /\s/.test(fonte[anterior]!)) anterior -= 1;

        const anteriorChar = fonte[anterior];

        if (anteriorChar === ')' || anteriorChar === '>') {
          inicioDoCorpo = indice;
          break;
        }
      }

      profundidade += 1;
    } else if (caractere === '}') {
      profundidade = Math.max(0, profundidade - 1);
    }
  }

  if (inicioDoCorpo === -1) return fonte.slice(inicio);

  profundidade = 0;

  for (let indice = inicioDoCorpo; indice < fonte.length; indice += 1) {
    const caractere = fonte[indice]!;

    if (caractere === '{') profundidade += 1;
    if (caractere === '}') {
      profundidade -= 1;
      if (profundidade === 0) return fonte.slice(inicio, indice + 1);
    }
  }

  return fonte.slice(inicio);
}

function lerGuardas(): GuardaEncontrada[] {
  const encontradas: GuardaEncontrada[] = [];

  for (const arquivo of readdirSync(DIRETORIO).sort()) {
    if (!arquivo.endsWith('.ts')) continue;

    const fonte = readFileSync(join(DIRETORIO, arquivo), 'utf8');
    const regex = /async function (guard\w*|\w*Guard|assertActivityOwnership)\s*\(/g;

    for (const achado of fonte.matchAll(regex)) {
      if (achado.index === undefined) continue;

      encontradas.push({
        nome: achado[1]!,
        arquivo,
        linha: fonte.slice(0, achado.index).split('\n').length,
        corpo: janelaDaFuncao(fonte, achado.index),
      });
    }
  }

  return encontradas;
}

const ENCONTRADAS = lerGuardas();

function chave(nome: string, arquivo: string): string {
  return `${arquivo}::${nome}`;
}

const CHAVES_ESPERADAS = new Set(ESPERADAS.map((guarda) => chave(guarda.nome, guarda.arquivo)));
const CHAVES_ENCONTRADAS = new Set(ENCONTRADAS.map((guarda) => chave(guarda.nome, guarda.arquivo)));

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 75 · o catálogo das guardas locais', () => {
  it('a árvore contém EXATAMENTE as guardas da lista — nenhuma nova, nenhuma a menos', () => {
    const novas = [...CHAVES_ENCONTRADAS].filter((chaveEncontrada) => !CHAVES_ESPERADAS.has(chaveEncontrada));
    const sumidas = [...CHAVES_ESPERADAS].filter((chaveEsperada) => !CHAVES_ENCONTRADAS.has(chaveEsperada));

    /**
     * A mensagem é o produto deste teste: quem criar a próxima guarda precisa saber
     * que a lista é o contrato, e que declarar o motivo é parte do trabalho.
     */
    expect(
      novas,
      `Guarda(s) nova(s) fora do catálogo: ${novas.join(', ')}. ` +
        'Se for uma exceção declarada, acrescente-a à lista com o MOTIVO; ' +
        'se não for, use `guardAction` em vez de escrever mais uma cópia.',
    ).toEqual([]);

    expect(
      sumidas,
      `O catálogo cita guarda(s) que não existem mais: ${sumidas.join(', ')}. ` +
        'Se a fatia 2 migrou, atualize a lista de propósito (e o motivo) — ' +
        'a rede de comportamento é `f75-guardas-caracterizacao`.',
    ).toEqual([]);
  });

  it('são 4 guardas + `assertActivityOwnership` — as 16 migráveis saíram', () => {
    const guardas = ENCONTRADAS.filter((guarda) => guarda.nome !== 'assertActivityOwnership');

    /**
     * ─── O NÚMERO CAIU PORQUE A FASE FEZ O TRABALHO ─────────────────────────────
     *  Na fatia 1 eram **21** guardas locais + `assertActivityOwnership` (**22**
     *  janelas). A fatia 2 migrou as 16 que cabiam em `TENANT + permissão +
     *  principal` e traduziu a da `registration` — sobram as **4 exceções
     *  declaradas**, e o número do teste é o que a árvore tem HOJE. Não é uma
     *  expectativa ajustada para passar: o teste 1 continua exigindo igualdade
     *  exata, então uma guarda nova reprova aqui antes de qualquer coisa.
     */
    expect(guardas).toHaveLength(4);
    expect(ENCONTRADAS).toHaveLength(5);
  });

  it('as 4 exceções são as declaradas, e nenhuma guarda migrável sobrou', () => {
    const porClassificacao = (classificacao: Classificacao) =>
      ESPERADAS.filter((guarda) => guarda.classificacao === classificacao);

    expect(porClassificacao('EXCECAO').map((guarda) => `${guarda.arquivo}::${guarda.nome}`)).toEqual([
      'sponsor-portal-actions.ts::guardAuthenticated',
      'sponsor-portal-actions.ts::guardSession',
      'speaker-actions.ts::speakerGuard',
      'demand-actions.ts::guard',
    ]);
    expect(porClassificacao('POSSE_DO_ALVO')).toHaveLength(1);

    /**
     * A lista NÃO tem mais nenhuma `MIGRA`: se alguém acrescentar uma entrada com
     * essa classificação, a fase estaria voltando atrás sem dizer por quê — o lugar
     * de uma guarda migrável é o `guardAction`, e a lista é só para o que NÃO cabe
     * nele.
     */
    expect(ESPERADAS).toHaveLength(5);
    expect(ESPERADAS.every((guarda) => guarda.nota.length > 0)).toBe(true);
  });

  it('as 17 portas migradas chamam `guardAction` e continuam pedindo a MESMA permissão', () => {
    /**
     * ─── A PROVA DE QUE A MIGRAÇÃO NÃO TROCOU A PORTE ───────────────────────────
     *  Migrar não é só apagar a guarda: é a MESMA permissão, no MESMO escopo, para a
     *  MESMA pessoa. Aqui se lê o arquivo de cada porta migrada e se confere que ele
     *  (a) chama `guardAction` e (b) ainda menciona cada permissão que a guarda
     *  pedia — pela constante ou pelo valor, como no teste anterior.
     *
     *  Isto é catraca, não documentação: quem "desmigrar" um arquivo (voltando a
     *  escrever a guarda com outro nome, que o regex de `async function guard*` não
     *  pega) faz o primeiro `expect` falhar.
     */
    const chavesPorValor = new Map<string, string>(
      Object.entries(PERMISSIONS).map(([chave, valor]) => [valor, chave]),
    );

    expect(MIGRADAS).toHaveLength(17);

    for (const { arquivo, permissoes } of MIGRADAS) {
      const fonte = readFileSync(join(DIRETORIO, arquivo), 'utf8');

      expect(
        fonte.includes('guardAction'),
        `${arquivo} não chama mais \`guardAction\` — a guarda local voltou pela porta dos fundos`,
      ).toBe(true);

      for (const permissao of permissoes) {
        const constante = chavesPorValor.get(permissao);

        expect(constante, `\`${permissao}\` não existe em PERMISSIONS`).toBeDefined();
        expect(
          fonte.includes(`PERMISSIONS.${constante}`) || fonte.includes(`'${permissao}'`),
          `${arquivo} não pede mais \`${permissao}\` — a migração trocou a porta`,
        ).toBe(true);
      }
    }
  });

  it('o SHAPE do `ok` de cada guarda é o de hoje (o contrato que a fatia 2 preserva)', () => {
    for (const esperada of ESPERADAS) {
      const encontrada = ENCONTRADAS.find(
        (guarda) => guarda.nome === esperada.nome && guarda.arquivo === esperada.arquivo,
      );

      expect(encontrada, `guarda ausente: ${esperada.arquivo}::${esperada.nome}`).toBeDefined();
      expect(
        normalizar(encontrada!.corpo),
        `o shape do ok de ${esperada.arquivo}::${esperada.nome} mudou`,
      ).toContain(normalizar(esperada.retornoOk));
    }
  });

  it('a permissão que cada guarda pede é a que a lista declara', () => {
    /**
     * O código pede a permissão pela CONSTANTE (`PERMISSIONS.PAGE_MANAGE`), e a
     * lista guarda o VALOR (`page:manage`). A conferência aceita as duas formas:
     * o que importa é que a permissão declarada ainda seja pedida naquele arquivo.
     */
    const chavesPorValor = new Map<string, string>(
      Object.entries(PERMISSIONS).map(([chave, valor]) => [valor, chave]),
    );

    for (const esperada of ESPERADAS) {
      const fonte = readFileSync(join(DIRETORIO, esperada.arquivo), 'utf8');

      for (const permissao of esperada.permissoes) {
        const constante = chavesPorValor.get(permissao);

        expect(constante, `\`${permissao}\` não existe em PERMISSIONS`).toBeDefined();
        expect(
          fonte.includes(`PERMISSIONS.${constante}`) || fonte.includes(`'${permissao}'`),
          `${esperada.arquivo} não pede mais \`${permissao}\` — a lista do catálogo mente`,
        ).toBe(true);
      }
    }
  });

  it('as guardas que checam permissão chamam `can()`; as exceções sem permissão não chamam nada', () => {
    const guardas = ENCONTRADAS.filter((guarda) => guarda.nome !== 'assertActivityOwnership');
    const comCan = guardas.filter((guarda) => guarda.corpo.includes('can('));

    /**
     * ─── O NÚMERO MEDIDO, NÃO O NÚMERO ESPERADO ─────────────────────────────────
     *  Na fatia 1 este número era **18** (as 17 que migrariam MAIS a `demand`, o
     *  OU de permissões). Depois da migração sobrou **1**: só a `demand`, que é
     *  exceção declarada, ainda chama `can()` — e chama DUAS vezes, de propósito.
     *  As outras três exceções não checam permissão nenhuma: a sessão do
     *  patrocinador entra por VÍNCULO e a do palestrante por `holdsPermission`.
     */
    expect(comCan).toHaveLength(1);

    const semCan = guardas.filter((guarda) => !guarda.corpo.includes('can('));

    expect(semCan.map((guarda) => `${guarda.arquivo}::${guarda.nome}`).sort()).toEqual([
      'speaker-actions.ts::speakerGuard',
      'sponsor-portal-actions.ts::guardAuthenticated',
      'sponsor-portal-actions.ts::guardSession',
    ]);

    for (const nome of ['guardAuthenticated', 'guardSession']) {
      const guarda = ENCONTRADAS.find(
        (candidata) => candidata.nome === nome && candidata.arquivo === 'sponsor-portal-actions.ts',
      );

      expect(guarda).toBeDefined();
      expect(guarda!.corpo.includes('can('), `${nome} passou a checar permissão`).toBe(false);
    }
  });

  it('o motivo de cada exceção continua verdadeiro no código', () => {
    const porNome = (nome: string, arquivo: string) =>
      ENCONTRADAS.find((guarda) => guarda.nome === nome && guarda.arquivo === arquivo)!;

    /** Exceção 1: o aceite de convite não confere vínculo — só sessão e instituição. */
    const autenticada = porNome('guardAuthenticated', 'sponsor-portal-actions.ts');
    expect(autenticada.corpo.includes('userTenantProfile')).toBe(false);
    expect(autenticada.corpo.includes('membership')).toBe(false);

    /** Exceção 2: a sessão confere vínculo e NÃO confere permissão. */
    const sessao = porNome('guardSession', 'sponsor-portal-actions.ts');
    expect(sessao.corpo.includes('membership')).toBe(true);
    expect(sessao.corpo.includes('can(')).toBe(false);
    expect(sessao.corpo.includes('holdsPermission')).toBe(false);

    /** Exceção 3: o palestrante entra por `holdsPermission`, sem alvo. */
    const palestrante = porNome('speakerGuard', 'speaker-actions.ts');
    expect(palestrante.corpo.includes('holdsPermission')).toBe(true);
    expect(palestrante.corpo.includes('can(')).toBe(false);

    /** Exceção 4: o OU de permissões e o alvo EVENT com `viaAlternate`. */
    const demanda = porNome('guard', 'demand-actions.ts');
    expect(demanda.corpo.includes('alternatePermission')).toBe(true);
    expect(demanda.corpo.includes('viaAlternate')).toBe(true);
    expect(demanda.corpo.includes("scope: 'EVENT'")).toBe(true);
  });

  it('`assertActivityOwnership` continua separada da autorização da pessoa', () => {
    const posse = ENCONTRADAS.find((guarda) => guarda.nome === 'assertActivityOwnership');

    expect(posse).toBeDefined();
    /** Ela lê o vínculo da atividade no banco; não chama `can` nem `holdsPermission`. */
    expect(posse!.corpo.includes('activitySpeaker')).toBe(true);
    expect(posse!.corpo.includes('can(')).toBe(false);
    expect(posse!.corpo.includes('holdsPermission')).toBe(false);
  });

  it('o retrato de linhas do catálogo continua próximo do arquivo real', () => {
    /**
     * Não é igualdade (comentário novo acima da função não pode reprovar), mas um
     * desvio grande significa que o retrato do plano envelheceu — e o plano é o
     * documento que a fatia 2 lê.
     */
    for (const esperada of ESPERADAS) {
      const encontrada = ENCONTRADAS.find(
        (guarda) => guarda.nome === esperada.nome && guarda.arquivo === esperada.arquivo,
      )!;

      expect(
        Math.abs(encontrada.linha - esperada.linha),
        `${esperada.arquivo}::${esperada.nome} está na linha ${encontrada.linha}, e o catálogo diz ${esperada.linha}`,
      ).toBeLessThanOrEqual(40);
    }
  });
});