/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA — O CARTÃO ESCONDE O QUE A TELA RECUSA (FASE 72 · correção da fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ELA TORNA IMPOSSÍVEL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A raiz do evento mostra um cartão por área e filtra pela permissão DECLARADA
 *  no catálogo (`EVENT_AREAS`). Quatro cartões não declaravam nada — chamadas,
 *  confirmações de vaga, sorteios e credenciamento —, então apareciam para quem
 *  via a raiz e a página por trás redirecionava ao painel. O cartão prometia uma
 *  tela que recusava o clique.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COMO ELA LÊ O PAR (ÁREA → PÁGINA), E POR QUE ASSIM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lista escrita à mão ("chamadas exige event:manage") envelhece: no dia em que
 *  a página mudar a guarda, a lista continua dizendo o que era. Aqui a catraca
 *  resolve o `href` da área com um contexto sintético, encontra o `page.tsx` cuja
 *  ROTA casa com o caminho e lê a permissão do `requirePagePermission` daquele
 *  arquivo. É a mesma técnica das catracas de CSS/landmark da casa: lê o
 *  texto-fonte (sem comentários) em vez de confiar em uma segunda declaração.
 *
 *  A igualdade é EXATA, nos dois sentidos:
 *    • cartão sem permissão + tela com guarda = o defeito desta fase;
 *    • cartão com permissão mais fraca que a da tela = o mesmo defeito;
 *    • cartão com permissão mais forte = esconde de quem a tela deixaria entrar,
 *      que também é mentira sobre o que existe ali.
 *
 *  O que ela NÃO prova: que a permissão declarada é a única porta da página (a
 *  página pode ter guardas adicionais dentro) nem o ESCOPO em que a raiz avalia
 *  a permissão. O escopo é uma limitação conhecida e relatada: a raiz avalia no
 *  escopo TENANT; crachás aceita EVENT também, então quem só tem o papel por
 *  evento não vê o cartão embora consiga abrir a URL. A catraca prende o NOME da
 *  permissão, que é o que o defeito da fase quebrou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EVENT_AREAS, visibleEventAreas, type EventArea } from '../../src/domain/events/event-areas';
import { PERMISSIONS } from '../../src/domain/rbac/permissions';

const RAIZ = process.cwd();
const APP = join(RAIZ, 'src', 'app');

/** O contexto sintético: só o formato importa, os valores nunca chegam ao banco. */
const CONTEXTO = {
  tenantSlug: 'instituicao-de-teste',
  eventId: '00000000-0000-4000-8000-000000000000',
  eventSlug: 'evento-de-teste',
};

interface PaginaDeRota {
  arquivo: string;
  /** Segmentos da rota, sem grupos `(app)`/`(public)` e sem `page.tsx`. */
  segmentos: string[];
}

/** Comentário que CITA uma permissão não é uma permissão (a precaução da F52/F60). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function paginasDeRota(diretorio: string = APP): PaginaDeRota[] {
  const encontradas: PaginaDeRota[] = [];

  for (const entrada of readdirSync(diretorio)) {
    const caminho = join(diretorio, entrada);

    if (statSync(caminho).isDirectory()) {
      encontradas.push(...paginasDeRota(caminho));
      continue;
    }

    if (entrada !== 'page.tsx') continue;

    const relativo = relative(APP, caminho).split(sep).join('/');
    const segmentos = relativo
      .replace(/\/page\.tsx$/, '')
      .split('/')
      .filter((segmento) => !(segmento.startsWith('(') && segmento.endsWith(')')));

    encontradas.push({ arquivo: caminho, segmentos });
  }

  return encontradas;
}

/** Um segmento dinâmico (`[eventId]`, `[...slug]`) casa com qualquer valor. */
function segmentoCasa(segmentoDaRota: string, segmentoDoCaminho: string): boolean {
  if (/^\[\[?\.\.\..+\]\]?$/.test(segmentoDaRota)) return true;
  if (/^\[.+\]$/.test(segmentoDaRota)) return true;

  return segmentoDaRota === segmentoDoCaminho;
}

function paginasDoHref(href: string, paginas: readonly PaginaDeRota[]): PaginaDeRota[] {
  const caminho = new URL(href, 'http://eventflow.local').pathname;
  const segmentos = caminho.split('/').filter(Boolean).map(decodeURIComponent);

  return paginas.filter(
    (pagina) =>
      pagina.segmentos.length === segmentos.length &&
      pagina.segmentos.every((segmento, indice) => segmentoCasa(segmento, segmentos[indice] ?? '')),
  );
}

interface GuardaDaPagina {
  /** A página chama `requirePagePermission`? */
  temGuarda: boolean;
  /** O nome da constante lida do bloco da guarda (`EVENT_MANAGE`, …). */
  permissao: string | null;
}

/**
 * Lê a permissão do PRIMEIRO `requirePagePermission` do arquivo.
 *
 * A guarda é o portão da página; permissões citadas depois (`can(...)` para
 * esconder um botão) não decidem se a tela abre, e por isso não entram. Um bloco
 * de guarda sem `PERMISSIONS.<NOME>` literal é ERRO, não "sem permissão": a
 * catraca precisa enxergar o nome para comparar.
 */
function guardaDaPagina(arquivo: string): GuardaDaPagina {
  const fonte = semComentarios(readFileSync(arquivo, 'utf8'));
  const guarda = /requirePagePermission\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(fonte);

  if (!guarda) return { temGuarda: false, permissao: null };

  const permissao = /permission\s*:\s*PERMISSIONS\.([A-Z0-9_]+)/.exec(guarda[1]);

  return { temGuarda: true, permissao: permissao?.[1] ?? null };
}

interface AuditoriaDoCartao {
  area: EventArea;
  href: string;
  pagina: string | null;
  /** A permissão que a PÁGINA exige, como o valor do catálogo. */
  exigida: string | null;
  /** A permissão que o CARTÃO declara. */
  declarada: string | null;
  erro: string | null;
}

function auditar(area: EventArea, paginas: readonly PaginaDeRota[]): AuditoriaDoCartao {
  const href = area.href(CONTEXTO);
  const candidatas = paginasDoHref(href, paginas);

  if (candidatas.length !== 1) {
    return {
      area,
      href,
      pagina: null,
      exigida: null,
      declarada: area.permission ?? null,
      erro:
        candidatas.length === 0
          ? `nenhuma página em src/app casa com ${href}`
          : `${candidatas.length} páginas casam com ${href}: ${candidatas
              .map((pagina) => relative(RAIZ, pagina.arquivo))
              .join(', ')}`,
    };
  }

  const pagina = candidatas[0] as PaginaDeRota;
  const guarda = guardaDaPagina(pagina.arquivo);

  if (guarda.temGuarda && guarda.permissao === null) {
    return {
      area,
      href,
      pagina: relative(RAIZ, pagina.arquivo),
      exigida: null,
      declarada: area.permission ?? null,
      erro: 'a guarda da página não declara uma constante PERMISSIONS.<NOME>',
    };
  }

  const exigida = guarda.permissao
    ? ((PERMISSIONS as Record<string, string>)[guarda.permissao] ?? null)
    : null;

  return {
    area,
    href,
    pagina: relative(RAIZ, pagina.arquivo),
    exigida,
    declarada: area.permission ?? null,
    erro:
      guarda.permissao && exigida === null
        ? `PERMISSIONS.${guarda.permissao} não existe no catálogo`
        : null,
  };
}

describe('catraca — todo cartão declara a permissão que a tela dele exige', () => {
  const paginas = paginasDeRota();
  const auditoria = EVENT_AREAS.map((area) => auditar(area, paginas));

  it('toda área aponta para UMA página real do App Router', () => {
    const semPagina = auditoria
      .filter((linha) => linha.pagina === null)
      .map((linha) => `${linha.area.id} → ${linha.erro}`);

    expect(semPagina).toEqual([]);
  });

  it('o cartão e a página concordam na permissão — nos dois sentidos', () => {
    /**
     * O relatório é uma LISTA de divergências em vez de um `expect` por cartão:
     * assim a primeira execução depois de uma regressão mostra TODOS os cartões
     * errados de uma vez, e não só o primeiro.
     */
    const divergencias = auditoria
      .filter((linha) => linha.erro !== null || linha.exigida !== linha.declarada)
      .map((linha) => ({
        cartao: linha.area.id,
        pagina: linha.pagina,
        exigidaPelaTela: linha.exigida,
        declaradaNoCartao: linha.declarada,
        erro: linha.erro,
      }));

    expect(divergencias).toEqual([]);
  });

  it('a área pública não declara permissão, porque a tela dela não tem guarda', () => {
    const publica = auditoria.find((linha) => linha.area.publicView);

    expect(publica?.exigida).toBeNull();
    expect(publica?.declarada).toBeNull();
  });

  /**
   * O caso que abriu a TAREFA 1: quem consegue abrir a RAIZ (tem `event:update`)
   * mas não tem a permissão de uma das telas. Antes da correção, os quatro cartões
   * apareciam e o clique terminava em redirecionamento. A catraca prende o par
   * (área → página); este caso prende o EFEITO na lista visível, que é o que a
   * pessoa experimenta.
   */
  it('quem só tem a permissão da raiz NÃO vê os cartões cuja tela recusa', () => {
    const visiveis = visibleEventAreas({
      allowed: (permission) => permission === PERMISSIONS.EVENT_UPDATE,
    }).map((area) => area.id);

    for (const id of ['chamadas', 'confirmacoes', 'sorteios', 'crachas']) {
      expect(visiveis, `o cartão ${id} apareceu sem a permissão da tela`).not.toContain(id);
    }

    /** E o que a permissão da raiz realmente abre continua visível. */
    for (const id of ['dados', 'formulario', 'api', 'programacao', 'salas']) {
      expect(visiveis).toContain(id);
    }
  });
});
