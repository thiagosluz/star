/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTE DE CATÁLOGO — O ID NA URL É VALIDADO ANTES DA CONSULTA
 *                                          (FASE 76 · fatias 1, 2 e 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM TESTE QUE LÊ ARQUIVOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As fatias 1 e 2 corrigiram 23 páginas e 8 rotas de API; a fatia 3 fechou mais
 *  uma rota e um param de query que esta catraca achou fora da lista. O risco de um mutirão
 *  assim não é apagar uma linha — é a PRÓXIMA página: alguém cria
 *  `eventos/[eventId]/relatorios/page.tsx`, esquece o `requireUuidParam` e o 500
 *  da armadilha 25 volta pela porta dos fundos. A correção não se defende sozinha;
 *  esta catraca é o que a defende.
 *
 *  O teste lê a árvore, extrai os segmentos `[<x>Id]` e o que cada arquivo chama,
 *  e compara com a lista abaixo. Página ou rota NOVA reprova; item da lista que
 *  perdeu a chamada também. A lista é o contrato: mudá-la é um ato deliberado, com
 *  o motivo escrito.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA, EM DUAS FRASES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • PÁGINA cujo segmento é `[<x>Id]` de banco chama
 *    `requireUuidParam(resolvedParams, '<xId>')` — o MESMO nome do segmento.
 *  • ROTA lê o id do caminho ou de um param de query e, antes de qualquer
 *    consulta, recusa o formato com `isUuid` (do domínio) + `tenantApiError`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LIMITE, DECLARADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Isto prova que a CHAMADA existe, com o NOME do segmento. Não prova que o valor
 *  validado é o valor usado: `const id = requireUuidParam(resolvedParams, 'eventId')`
 *  seguido de `where: { id: outroTexto }` passa aqui e estoura no banco. Quem fecha
 *  essa distância é o comportamento (`tests/e2e/f76-id-malformado.spec.ts`): um id
 *  malformado responde 404/400, e um 500 apareceria na tabela. A divisão é a mesma
 *  da catraca da F75: aqui se prende o INVENTÁRIO; lá, a resposta.
 *
 *  Também não se prova aqui que a guarda vem ANTES da consulta — só que ela existe
 *  e devolve o envelope. A ordem é medida pelo E2E: se o malformed chegasse ao
 *  Prisma, a resposta seria 500 e o caso ficaria vermelho.
 *
 *  Na QUERY, a descoberta é heurística: a catraca reconhece chaves terminadas em
 *  `Id` e as duas da agenda (`atividade`, `evento`). Uma chave nova sem sufixo `Id`
 *  não é adivinhada — é o limite declarado da descoberta. As rotas de query que
 *  existem hoje estão na lista e são presas por igualdade; a próxima que inventar
 *  um nome fora desses padrões entra por decisão humana, não por acidente.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FORA DA REGRA, DE PROPÓSITO, E COM O MOTIVO ESCRITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Nem todo `*Id` é uuid de banco e nem todo segmento é id:
 *
 *   • `blockId` (JSON do editor), o `id` do lead, `lattesId`/`orcidId`/`taxId`
 *     (identificadores externos) e `presetId` (nome do modelo de certificado) NÃO
 *     são uuid de endereço — chegam no corpo do formulário ou em JSON.
 *   • `[eventSlug]`, `[activitySlug]`, `[callSlug]`, `[cardSlug]`, `[token]`,
 *     `[code]`, `[username]` e `[tenantSlug]` são endereço, mas NÃO são id de
 *     recurso por chave primária: `isUuid`/`requireUuidParam` recusariam endereços
 *     legítimos.
 *   • Quatro páginas públicas já respondem 404 pelo catch-all da área
 *     (`[speakerId]`, `[raffleId]` ×3). A fatia 1 as deixou de fora DE PROPÓSITO
 *     (o plano §1 as declara como ponto de atenção: o catch-all mascara falha real
 *     como 404). A catraca as mantém na lista de exceções — se alguém fechar a
 *     validação nelas, o teste manda movê-las para a lista positiva.
 *   • UMA rota fica fora da lista positiva, com motivo: `sorteios/[raffleId]/ao-vivo`
 *     (o serviço engole o erro e a rota responde 404; a fatia 2 declarou "já responde
 *     certo, não tocar").
 *   • DOIS PARAMS que a fatia 2 não cobriu foram ACHADOS por esta catraca e FECHADOS
 *     na fatia 3: `certificados/zip?evento=` (respondia 400 `INTERNAL` depois do
 *     `catch`) e `raffle-live?activityId=` (500 `INTERNAL` no escopo de atividade).
 *     Os dois passaram por `isUuid` + `tenantApiError` e entraram para ROTAS — não
 *     são exceção. A LIÇÃO: a catraca de fonte não serve só para impedir a volta;
 *     ela também ACHA buraco em param que a lista anterior não viu.
 *
 *  A lista `IDS_QUE_NAO_SAO_UUID_DE_ENDERECO` abaixo é a fonte única dos nomes que a regra
 *  ignora; o teste sintético prova que a regra não os pega.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();
const DIR_APP = 'src/app';

// ───────────────────────────────────────────────────────────────────────────────
//  A LISTA POSITIVA DAS PÁGINAS — 23 páginas, 24 params
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O retrato da fatia 1. Cada entrada é `arquivo → segmentos uuid que ele valida`.
 * `demandas/[demandId]` aparece com DOIS params porque o caminho tem `eventId` e
 * `demandId`, e os dois são ids de banco — a página chama `requireUuidParam` duas
 * vezes, uma para cada.
 *
 * A ordem é a da árvore e não importa para a comparação (o teste ordena), mas
 * manter cada linha perto do lugar real torna a revisão do catálogo barata.
 */
interface PaginaEsperada {
  arquivo: string;
  params: readonly string[];
}

const PAGINAS: readonly PaginaEsperada[] = [
  { arquivo: 'src/app/superadmin/tenants/[tenantId]/page.tsx', params: ['tenantId'] },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/api/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/chamadas/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/confirmacoes/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/dados/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/demandas/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/demandas/[demandId]/page.tsx',
    params: ['eventId', 'demandId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/equipes/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/formulario/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/midia/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/previa/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/palestrantes/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/patrocinadores/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/programacao/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/reconhecimento/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/salas/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/sorteios/page.tsx',
    params: ['eventId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/comite/[submissionId]/page.tsx',
    params: ['submissionId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/participantes/[userId]/page.tsx',
    params: ['userId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/revisoes/[submissionId]/page.tsx',
    params: ['submissionId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(app)/submissoes/[submissionId]/page.tsx',
    params: ['submissionId'],
  },
];

/**
 * As quatro páginas com `*Id` que a fatia 1 NÃO tocou, de propósito.
 *
 * Elas já respondem 404 pelo catch-all da área pública — o teste E2E da F76 não as
 * inclui. O motivo está aqui, e não no relatório, para que quem leia o catálogo
 * saiba por que a igualdade exata não as cobra.
 */
const PAGINAS_FORA_DA_REGRA: readonly PaginaEsperada[] = [
  {
    arquivo:
      'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx',
    params: ['speakerId'],
  },
  {
    arquivo: 'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/page.tsx',
    params: ['raffleId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/auditoria/page.tsx',
    params: ['raffleId'],
  },
  {
    arquivo:
      'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/sorteios/[raffleId]/palco/page.tsx',
    params: ['raffleId'],
  },
];

// ───────────────────────────────────────────────────────────────────────────────
//  A LISTA POSITIVA DAS ROTAS — 9 rotas, 5 params de caminho e 6 de query
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As oito rotas da fatia 2 (as "7 + o QR") MAIS o ZIP de certificados, que a
 * primeira versão desta catraca achou fora da lista e a fatia 3 fechou. `paramsDoCaminho`
 * são segmentos `[<x>Id]`; `paramsDaQuery` são as chaves de `searchParams.get(...)`
 * que carregam uuid. `?userIds=` fica fora: é uma LISTA, não um id — e listas são
 * recusadas pelo serviço, não por `isUuid`.
 */
interface RotaEsperada {
  arquivo: string;
  paramsDoCaminho: readonly string[];
  paramsDaQuery: readonly string[];
}

const ROTAS: readonly RotaEsperada[] = [
  {
    arquivo: 'src/app/api/events/[eventId]/raffle-live/route.ts',
    paramsDoCaminho: ['eventId'],
    paramsDaQuery: ['activityId'],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/agenda/ics/route.ts',
    paramsDoCaminho: [],
    paramsDaQuery: ['atividade', 'evento'],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/certificados/zip/route.ts',
    paramsDoCaminho: [],
    paramsDaQuery: ['evento'],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/credenciamento/crachas/folha/route.ts',
    paramsDoCaminho: [],
    paramsDaQuery: ['eventId'],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/credenciamento/crachas/impressao/route.ts',
    paramsDoCaminho: [],
    paramsDaQuery: ['eventId'],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/exportacoes/[exportId]/arquivo/route.ts',
    paramsDoCaminho: ['exportId'],
    paramsDaQuery: [],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/midia/[assetId]/miniatura/route.ts',
    paramsDoCaminho: ['assetId'],
    paramsDaQuery: [],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/palestrantes/materiais/[materialId]/arquivo/route.ts',
    paramsDoCaminho: ['materialId'],
    paramsDaQuery: [],
  },
  {
    arquivo: 'src/app/api/t/[tenantSlug]/patrocinadores/qr/[qrId]/route.ts',
    paramsDoCaminho: ['qrId'],
    paramsDaQuery: [],
  },
];

/**
 * A rota com id na URL que fica FORA da regra, com o motivo.
 *
 * `ao-vivo` responde 404 pelo `catch` do serviço (o plano §3 mandou não tocá-la) e
 * não usa o envelope. Ela precisa continuar VISÍVEL: se alguém a fechar, o teste
 * manda movê-la para `ROTAS`.
 */
const ROTAS_FORA_DA_REGRA: readonly RotaEsperada[] = [
  {
    arquivo:
      'src/app/api/t/[tenantSlug]/eventos/[eventSlug]/sorteios/[raffleId]/ao-vivo/route.ts',
    paramsDoCaminho: ['raffleId'],
    paramsDaQuery: [],
  },
];

// ───────────────────────────────────────────────────────────────────────────────
//  OS NOMES QUE A REGRA NÃO PODE PEGAR
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Ids que NÃO são uuid de endereço. O motivo é o que impede alguém de "consertar"
 * o catálogo tratando `[blockId]` como id de banco no dia em que ele virar
 * segmento.
 *
 * `blockId` e o `id` do lead são uuid no banco em alguns caminhos, mas chegam pelo
 * CORPO do formulário — e em outros são texto opaco. `lattesId`, `orcidId` e
 * `taxId` têm formato próprio (nunca uuid). `presetId` é o NOME do modelo de
 * certificado, não um id de linha.
 */
interface IdQueNaoEUuidDeEndereco {
  nome: string;
  onde: string;
  motivo: string;
}

const IDS_QUE_NAO_SAO_UUID_DE_ENDERECO: readonly IdQueNaoEUuidDeEndereco[] = [
  {
    nome: 'blockId',
    onde: 'JSON/formulário do editor de página (landing-actions.ts, tenant-page-actions.ts)',
    motivo:
      'identificador de bloco de página; chega no corpo/JSON, não como segmento de URL (a coluna é uuid, o valor nem sempre é).',
  },
  {
    nome: 'id',
    onde: 'formulário de governança dos leads (platform-actions.ts)',
    motivo: 'id do lead chega no corpo do formulário de status; não é endereço.',
  },
  {
    nome: 'lattesId',
    onde: 'perfil público e conflito de interesse (public-profile-rules.ts, conflict-of-interest.ts)',
    motivo: 'identificador acadêmico externo (Lattes), formato próprio — nunca uuid.',
  },
  {
    nome: 'orcidId',
    onde: 'perfil público e conflito de interesse',
    motivo: 'identificador ORCID (0000-0000-0000-0000), formato próprio — nunca uuid.',
  },
  {
    nome: 'taxId',
    onde: 'patrocinador (sponsor-rules.ts, sponsor-actions.ts)',
    motivo: 'CPF/CNPJ mascarado no domínio; formato próprio — nunca uuid.',
  },
  {
    nome: 'presetId',
    onde: 'modelo de certificado (certificate-template-service.ts, certificate-actions.ts)',
    motivo: 'nome de um preset de layout (ex.: "classico"); não é id de linha e não vira segmento.',
  },
];

/**
 * Segmentos que são endereço, mas NÃO são id de recurso por chave primária.
 *
 * `tenantSlug` não estava na lista do plano, mas é o caso mais comum e precisa
 * estar aqui: a regra de nome `*Id` já o ignora, e a documentação evita que
 * alguém tente `requireUuidParam(params, 'tenantSlug')`.
 */
interface SegmentoQueNaoEId {
  nome: string;
  motivo: string;
}

const SEGMENTOS_QUE_NAO_SAO_ID: readonly SegmentoQueNaoEId[] = [
  { nome: 'tenantSlug', motivo: 'slug da instituição: resolvido pelo contexto; a ausência é 404 do tenant.' },
  { nome: 'eventSlug', motivo: 'slug estável do evento, usado em endereço público.' },
  { nome: 'activitySlug', motivo: 'slug da atividade na programação pública.' },
  { nome: 'callSlug', motivo: 'slug da chamada de propostas.' },
  { nome: 'cardSlug', motivo: 'slug da carta colecionável.' },
  { nome: 'token', motivo: 'token selado/hasheado (carta, convite, descadastro) — não é id de linha.' },
  { nome: 'code', motivo: 'código público de validação de certificado e de patrocínio.' },
  { nome: 'username', motivo: 'handle público (@) do perfil do participante.' },
];

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura da árvore
// ───────────────────────────────────────────────────────────────────────────────
interface PaginaEncontrada {
  arquivo: string;
  params: readonly string[];
  fonte: string;
}

interface RotaEncontrada {
  arquivo: string;
  paramsDoCaminho: readonly string[];
  paramsDaQuery: readonly string[];
  fonte: string;
}

function normalizar(caminho: string): string {
  return caminho.split('\\').join('/');
}

function listarArquivos(diretorio: string, nome: string): string[] {
  const encontrados: string[] = [];

  for (const entrada of readdirSync(join(RAIZ, diretorio), { withFileTypes: true })) {
    const caminho = `${diretorio}/${entrada.name}`;

    if (entrada.isDirectory()) {
      encontrados.push(...listarArquivos(caminho, nome));
    } else if (entrada.isFile() && entrada.name === nome) {
      encontrados.push(normalizar(caminho));
    }
  }

  return encontrados.sort();
}

/**
 * Os nomes entre colchetes do caminho. `[...all]` vira `...all`, que não termina
 * em `Id` e por isso não entra na regra — é o catch-all do Better Auth.
 */
function segmentosDoCaminho(caminho: string): string[] {
  return [...caminho.matchAll(/\[([^\]]+)\]/g)]
    .map((achado) => achado[1]!)
    .filter((segmento) => !segmento.startsWith('...'));
}

/** Um segmento é id de uuid quando o nome termina em `Id` e não é um dos declarados. */
function ehSegmentoDeUuid(segmento: string): boolean {
  return /Id$/.test(segmento) && !IDS_QUE_NAO_SAO_UUID_DE_ENDERECO.some((item) => item.nome === segmento);
}

function paramsUuidDoCaminho(caminho: string): string[] {
  return segmentosDoCaminho(caminho).filter(ehSegmentoDeUuid);
}

/** As chaves de query que a regra considera uuid: `*Id` e as duas da agenda. */
const CHAVES_DE_QUERY_CONHECIDAS = new Set(['atividade', 'evento']);

function paramsUuidDaQuery(fonte: string): string[] {
  const chaves = [...fonte.matchAll(/searchParams\.get\('([A-Za-z][A-Za-z0-9]*)'\)/g)].map(
    (achado) => achado[1]!,
  );

  return [...new Set(chaves.filter((chave) => /Id$/.test(chave) || CHAVES_DE_QUERY_CONHECIDAS.has(chave)))].sort();
}

function lerPaginas(): PaginaEncontrada[] {
  return listarArquivos(DIR_APP, 'page.tsx').map((arquivo) => ({
    arquivo,
    params: paramsUuidDoCaminho(arquivo),
    fonte: readFileSync(join(RAIZ, arquivo), 'utf8'),
  }));
}

function lerRotas(): RotaEncontrada[] {
  return listarArquivos(DIR_APP, 'route.ts').map((arquivo) => {
    const fonte = readFileSync(join(RAIZ, arquivo), 'utf8');

    return {
      arquivo,
      paramsDoCaminho: paramsUuidDoCaminho(arquivo),
      paramsDaQuery: paramsUuidDaQuery(fonte),
      fonte,
    };
  });
}

/**
 * As chamadas de `requireUuidParam` da página — só a forma canônica
 * `requireUuidParam(<identificador>, '<param>')`.
 *
 * O primeiro argumento é um identificador simples (`resolvedParams`); exigir isso
 * evita casar uma chamada inventada com string literal e mantém a leitura barata.
 */
function chamadasRequireUuid(fonte: string): string[] {
  return [
    ...fonte.matchAll(/requireUuidParam\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'\s*\)/g),
  ].map((achado) => achado[1]!);
}

/**
 * A janela de uma função de topo, do nome até a chave que fecha o corpo — a mesma
 * ideia da catraca da F75. Serve para `generateMetadata`: um `requireUuidParam` no
 * corpo da PÁGINA não pode valer como se estivesse no metadata.
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

function chamadasNoMetadata(fonte: string): string[] {
  const inicio = fonte.indexOf('generateMetadata');
  if (inicio === -1) return [];

  return chamadasRequireUuid(janelaDaFuncao(fonte, inicio));
}

/** `if (!isUuid(<param>)) { ... return tenantApiError(` — a guarda e o envelope. */
function temGuardaComEnvelope(fonte: string, param: string): boolean {
  const regex = new RegExp(
    `if\\s*\\(\\s*!isUuid\\(\\s*${param}\\s*\\)\\s*\\)\\s*\\{[\\s\\S]{0,320}?return tenantApiError\\(`,
  );

  return regex.test(fonte);
}

const PAGINAS_ENCONTRADAS = lerPaginas();
const ROTAS_ENCONTRADAS = lerRotas();

const CHAVES_DE_PAGINA_POSITIVAS = new Set(PAGINAS.map((pagina) => pagina.arquivo));
const CHAVES_DE_PAGINA_FORA = new Set(PAGINAS_FORA_DA_REGRA.map((pagina) => pagina.arquivo));
const CHAVES_DE_ROTA_POSITIVAS = new Set(ROTAS.map((rota) => rota.arquivo));
const CHAVES_DE_ROTA_FORA = new Set(ROTAS_FORA_DA_REGRA.map((rota) => rota.arquivo));

/**
 * A árvore só interessa quando tem segmento `[<x>Id]` (descontados os nomes
 * declarados) ou quando lê uma chave de query uuid. As demais páginas e rotas
 * (a maioria) ficam de fora da comparação e não geram ruído.
 */
const PAGINAS_COM_ID = PAGINAS_ENCONTRADAS.filter((pagina) => pagina.params.length > 0);
const ROTAS_COM_ID = ROTAS_ENCONTRADAS.filter(
  (rota) => rota.paramsDoCaminho.length > 0 || rota.paramsDaQuery.length > 0,
);

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 76 · o catálogo das páginas com id na URL', () => {
  it('a árvore tem EXATAMENTE as 23 páginas da lista positiva + as 4 exceções declaradas', () => {
    const encontradas = new Set(PAGINAS_COM_ID.map((pagina) => pagina.arquivo));

    const novas = [...encontradas].filter(
      (arquivo) => !CHAVES_DE_PAGINA_POSITIVAS.has(arquivo) && !CHAVES_DE_PAGINA_FORA.has(arquivo),
    );
    const sumidas = [...CHAVES_DE_PAGINA_POSITIVAS, ...CHAVES_DE_PAGINA_FORA].filter(
      (arquivo) => !encontradas.has(arquivo),
    );

    expect(
      novas,
      `Página(s) com id na URL fora do catálogo: ${novas.join(', ')}. ` +
        'Se o segmento é uuid de banco, chame `requireUuidParam(resolvedParams, \'<param>\')` ' +
        'para CADA segmento e acrescente a página à lista PAGINAS. ' +
        'Se não é uuid (slug/token/código), acrescente o nome a SEGMENTOS_QUE_NAO_SAO_ID ' +
        'com o motivo; se é exceção de catch-all, acrescente a PAGINAS_FORA_DA_REGRA.',
    ).toEqual([]);

    expect(
      sumidas,
      `O catálogo cita página(s) que não existem mais com id na URL: ${sumidas.join(', ')}. ` +
        'Se a página sumiu, atualize a lista DE PROPÓSITO (e o motivo); ' +
        'a tabela é o contrato, não um retrato que se ajusta sozinho.',
    ).toEqual([]);
  });

  it('são 23 páginas e 24 params — o número medido, não o esperado', () => {
    /**
     * 23 páginas, 24 chamadas: `demandas/[demandId]` tem `eventId` e `demandId`.
     * O segundo número é o que pega o caso "a página existe, mas só um dos dois
     * segmentos foi validado" — a igualdade por página já pega, e a contagem
     * torna a regressão visível de relance.
     */
    expect(PAGINAS).toHaveLength(23);
    expect(PAGINAS.reduce((total, pagina) => total + pagina.params.length, 0)).toBe(24);
    expect(PAGINAS_FORA_DA_REGRA).toHaveLength(4);

    const paramsEncontrados = PAGINAS_COM_ID.reduce(
      (total, pagina) => total + pagina.params.length,
      0,
    );
    expect(paramsEncontrados).toBe(28); // 24 positivos + 4 das exceções
  });

  it('cada página chama `requireUuidParam` com o MESMO param do segmento', () => {
    for (const pagina of PAGINAS) {
      const encontrada = PAGINAS_ENCONTRADAS.find((item) => item.arquivo === pagina.arquivo);

      expect(encontrada, `a página ${pagina.arquivo} sumiu da árvore`).toBeDefined();

      const chamados = [...new Set(chamadasRequireUuid(encontrada!.fonte))].sort();
      const esperados = [...pagina.params].sort();

      expect(
        chamados,
        `A página ${pagina.arquivo} chama requireUuidParam com ${JSON.stringify(chamados)} ` +
          `e o segmento pede ${JSON.stringify(esperados)}. ` +
          'O param tem de ser o NOME do segmento — validar `eventId` e usar `demandId` ' +
          '(ou esquecer um dos dois) é o defeito que esta catraca existe para pegar.',
      ).toEqual(esperados);
    }
  });

  it('as 4 exceções continuam SEM requireUuidParam — se fecharem, mova-as para a lista positiva', () => {
    for (const pagina of PAGINAS_FORA_DA_REGRA) {
      const encontrada = PAGINAS_ENCONTRADAS.find((item) => item.arquivo === pagina.arquivo);

      expect(encontrada, `a exceção ${pagina.arquivo} sumiu da árvore`).toBeDefined();
      expect(
        chamadasRequireUuid(encontrada!.fonte),
        `A exceção ${pagina.arquivo} passou a validar o id. ` +
          'Se o catch-all foi fechado, mova a página para PAGINAS e acrescente o caso ' +
          'ao E2E (tests/e2e/f76-id-malformado.spec.ts).',
      ).toEqual([]);
    }
  });

  it('se uma página positiva ganhar `generateMetadata`, o metadata também valida', () => {
    /**
     * `generateMetadata` roda ANTES do componente: um id malformado estouraria ali
     * primeiro. As páginas positivas não têm metadata hoje; a regra existe para a
     * próxima que tiver. O limite está no cabeçalho: a janela é a da função, mas a
     * prova de comportamento continua sendo o E2E.
     */
    for (const pagina of PAGINAS) {
      const encontrada = PAGINAS_ENCONTRADAS.find((item) => item.arquivo === pagina.arquivo)!;

      if (!encontrada.fonte.includes('generateMetadata')) continue;

      const chamados = [...new Set(chamadasNoMetadata(encontrada.fonte))].sort();
      expect(chamados, `o generateMetadata de ${pagina.arquivo} não valida o id`).toEqual(
        [...pagina.params].sort(),
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 76 · o catálogo das rotas de API com id', () => {
  it('a árvore tem EXATAMENTE as 9 rotas da lista positiva + a exceção declarada', () => {
    const encontradas = new Set(ROTAS_COM_ID.map((rota) => rota.arquivo));

    const novas = [...encontradas].filter(
      (arquivo) => !CHAVES_DE_ROTA_POSITIVAS.has(arquivo) && !CHAVES_DE_ROTA_FORA.has(arquivo),
    );
    const sumidas = [...CHAVES_DE_ROTA_POSITIVAS, ...CHAVES_DE_ROTA_FORA].filter(
      (arquivo) => !encontradas.has(arquivo),
    );

    expect(
      novas,
      `Rota(s) com id na URL fora do catálogo: ${novas.join(', ')}. ` +
        'Se o id é uuid, recuse o formato ANTES de consultar com ' +
        '`if (!isUuid(<param>)) return tenantApiError(...)` e acrescente a rota a ROTAS. ' +
        'Se não é uuid/é lista, acrescente o motivo a ROTAS_FORA_DA_REGRA.',
    ).toEqual([]);

    expect(
      sumidas,
      `O catálogo cita rota(s) que não existem mais: ${sumidas.join(', ')}. ` +
        'Atualize a lista de propósito — a catraca não se ajusta sozinha.',
    ).toEqual([]);
  });

  it('são 9 rotas — 5 params de caminho e 6 de query (11 no total)', () => {
    expect(ROTAS).toHaveLength(9);
    expect(ROTAS.reduce((total, rota) => total + rota.paramsDoCaminho.length, 0)).toBe(5);
    expect(ROTAS.reduce((total, rota) => total + rota.paramsDaQuery.length, 0)).toBe(6);
    expect(ROTAS_FORA_DA_REGRA).toHaveLength(1);
  });

  it('cada rota positiva importa `isUuid` + `tenantApiError` e recusa CADA param com o envelope', () => {
    for (const rota of ROTAS) {
      const encontrada = ROTAS_ENCONTRADAS.find((item) => item.arquivo === rota.arquivo);

      expect(encontrada, `a rota ${rota.arquivo} sumiu da árvore`).toBeDefined();

      const fonte = encontrada!.fonte;

      expect(
        /import\s*\{\s*isUuid\s*\}\s*from\s*'@\/domain\/validation\/id-rules'/.test(fonte),
        `${rota.arquivo} não importa \`isUuid\` do domínio — a regra de formato é uma só.`,
      ).toBe(true);
      expect(
        /import\s*\{\s*tenantApiError\s*\}\s*from\s*'@\/lib\/api\/tenant-api-error'/.test(fonte),
        `${rota.arquivo} não usa o envelope \`tenantApiError\` — corpo vazio não é contrato.`,
      ).toBe(true);

      for (const param of [...rota.paramsDoCaminho, ...rota.paramsDaQuery]) {
        expect(
          temGuardaComEnvelope(fonte, param),
          `A rota ${rota.arquivo} não recusa \`${param}\` com ` +
            '`if (!isUuid(\'' + param + '\')) return tenantApiError(...)` ANTES de consultar. ' +
            'É o defeito da armadilha 25: o texto torto desce ao Prisma e vira 500.',
        ).toBe(true);
      }
    }
  });

  it('a lista de params declarada é a que a rota realmente lê', () => {
    for (const rota of ROTAS) {
      const encontrada = ROTAS_ENCONTRADAS.find((item) => item.arquivo === rota.arquivo)!;

      expect(
        [...encontrada.paramsDoCaminho].sort(),
        `${rota.arquivo}: os params do caminho não batem com a lista`,
      ).toEqual([...rota.paramsDoCaminho].sort());
      expect(
        [...encontrada.paramsDaQuery].sort(),
        `${rota.arquivo}: os params de query não batem com a lista`,
      ).toEqual([...rota.paramsDaQuery].sort());
    }
  });

  it('a exceção `ao-vivo` continua sem `isUuid` — se fechar, mova-a para ROTAS', () => {
    for (const rota of ROTAS_FORA_DA_REGRA) {
      const encontrada = ROTAS_ENCONTRADAS.find((item) => item.arquivo === rota.arquivo);

      expect(encontrada, `a exceção ${rota.arquivo} sumiu da árvore`).toBeDefined();
      expect(
        encontrada!.fonte.includes('isUuid('),
        `A exceção ${rota.arquivo} passou a validar o id. ` +
          'Se a rota foi fechada, mova-a para ROTAS e acrescente o caso ao E2E.',
      ).toBe(false);
    }
  });

  it('os dois buracos que a catraca ACHOU estão fechados e na lista positiva', () => {
    /**
     * ─── A LIÇÃO DA FATIA 3 ─────────────────────────────────────────────────────
     *  A primeira versão desta catraca viu dois params de uuid que a fatia 2 não
     *  cobria: `certificados/zip?evento=` (400 `INTERNAL` depois do `catch`) e
     *  `raffle-live?activityId=` (500 `INTERNAL` no escopo de atividade). Eles não
     *  foram silenciados: foram DECLARADOS, o humano autorizou o fechamento e agora
     *  são rotas POSITIVAS. A catraca de fonte não só impede a volta — ela acha
     *  buraco. Este caso prende os dois como fechados para que a lição não se perca.
     */
    const zip = ROTAS.find(
      (rota) => rota.arquivo === 'src/app/api/t/[tenantSlug]/certificados/zip/route.ts',
    );
    const raffle = ROTAS.find(
      (rota) => rota.arquivo === 'src/app/api/events/[eventId]/raffle-live/route.ts',
    );

    expect(zip, 'o ZIP de certificados saiu da lista positiva').toBeDefined();
    expect(zip!.paramsDaQuery).toEqual(['evento']);
    expect(raffle, 'a prévia do sorteio saiu da lista positiva').toBeDefined();
    expect(raffle!.paramsDaQuery).toEqual(['activityId']);

    const fonteZip = ROTAS_ENCONTRADAS.find((rota) => rota.arquivo === zip!.arquivo)!.fonte;
    const fonteRaffle = ROTAS_ENCONTRADAS.find(
      (rota) => rota.arquivo === raffle!.arquivo,
    )!.fonte;

    expect(temGuardaComEnvelope(fonteZip, 'evento')).toBe(true);
    expect(temGuardaComEnvelope(fonteRaffle, 'activityId')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('FASE 76 · a catraca não pega o que não é uuid de endereço', () => {
  it('os ids declarados como NÃO uuid ficam fora da regra', () => {
    for (const item of IDS_QUE_NAO_SAO_UUID_DE_ENDERECO) {
      expect(
        ehSegmentoDeUuid(item.nome),
        `\`${item.nome}\` foi tratado como uuid de endereço. ` +
          `O motivo declarado é: ${item.motivo}`,
      ).toBe(false);
      expect(item.onde.length).toBeGreaterThan(0);
      expect(item.motivo.length).toBeGreaterThan(0);
    }
  });

  it('os segmentos que não são id ficam fora da regra', () => {
    for (const segmento of SEGMENTOS_QUE_NAO_SAO_ID) {
      expect(
        ehSegmentoDeUuid(segmento.nome),
        `\`[${segmento.nome}]\` foi tratado como id de uuid. Motivo: ${segmento.motivo}`,
      ).toBe(false);
    }
  });

  it('a forma do segmento é o NOME entre colchetes — nada de casar o caminho inteiro', () => {
    expect(ehSegmentoDeUuid('eventId')).toBe(true);
    expect(ehSegmentoDeUuid('demandId')).toBe(true);
    expect(ehSegmentoDeUuid('tenantId')).toBe(true);
    expect(ehSegmentoDeUuid('speakerId')).toBe(true); // é uuid; exceção é da LISTA, não da forma
    expect(ehSegmentoDeUuid('blockId')).toBe(false);
    expect(ehSegmentoDeUuid('eventSlug')).toBe(false);
  });

  it('o motivo da exceção `ao-vivo` continua verdadeiro no código', () => {
    /**
     * `ao-vivo` responde 404 pelo `catch` do serviço, não por `isUuid`. Se alguém
     * fechar a rota, o caso acima manda movê-la para ROTAS; aqui se prende o motivo
     * enquanto ela for exceção.
     */
    const aoVivo = ROTAS_ENCONTRADAS.find(
      (rota) =>
        rota.arquivo ===
        'src/app/api/t/[tenantSlug]/eventos/[eventSlug]/sorteios/[raffleId]/ao-vivo/route.ts',
    )!;

    expect(aoVivo.fonte).not.toContain('isUuid(');
    expect(aoVivo.fonte).toContain('getRaffleLiveState');
  });
});
