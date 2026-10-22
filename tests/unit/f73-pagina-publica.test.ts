/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A PÁGINA PÚBLICA DO RESULTADO (FASE 73 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM (sem banco e sem navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • a DECISÃO da página: `buildPublicCallResultSection` devolve `null` para
 *    SEM_RESULTADO/RASCUNHO (e para publicação sem data), e só o estado publicado
 *    vira seção — com o título do domínio e a data que o servidor formatou;
 *  • a TABELA DE VISIBILIDADE cobre os quatro estados e concorda com a régua da
 *    projeção (`isPublicCallResultState`) — duas réguas divergentes é como uma seção
 *    de rascunho aparece;
 *  • o selo da landing, que é a MESMA tabela (rascunho não ganha selo);
 *  • as FRASES, uma fonte só para as duas superfícies;
 *  • as CATRACAS DE FONTE: a página importa a leitura PÚBLICA e nunca o painel do
 *    organizador; o serviço público não importa o seletor nem pede campo proibido; o
 *    bloco da landing decide pelo ESTADO e nunca pelo JSON; o componente desenha as
 *    frases do domínio.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CATRACA É DE IMPORTAÇÃO E DE AUSÊNCIA DE CAMPO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A regra da fatia é "a leitura pública não é o painel do organizador". Um teste de
 *  valor não pega isso: o painel poderia ser importado e o valor sair igual HOJE, e
 *  vazar amanhã quando alguém usar o seletor. O import prende a FONTE (a mesma forma
 *  das catracas da F60/F72); a ausência dos campos no `select` prende a CONSULTA.
 *  Os comentários são removidos antes da leitura: citar `finalScore` numa explicação
 *  não é ler `finalScore`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CALL_RESULT_STATES,
  isPublicCallResultState,
  type CallResultState,
  type PublicCallResultView,
} from '../../src/domain/proposals/call-result-rules';
import {
  PUBLIC_CALL_RESULT_LANDING_BADGE,
  PUBLIC_CALL_RESULT_LANDING_LINK,
  PUBLIC_CALL_RESULT_LIST_TITLE,
  PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE,
  PUBLIC_CALL_RESULT_PUBLISHED_PREFIX,
  PUBLIC_CALL_RESULT_SECTION_TITLE,
  PUBLIC_CALL_RESULT_VISIBILITY,
  buildPublicCallResultSection,
  showsPublishedResultBadge,
  visibilityAgreesWithProjection,
} from '../../src/domain/proposals/call-result-public-rules';

const DOMINIO = 'src/domain/proposals/call-result-public-rules.ts';
const SERVICO = 'src/lib/proposals/call-result-public-service.ts';
const PAGINA =
  'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx';
const COMPONENTE = 'src/components/proposals/call-result-public-view.tsx';
const BLOCO = 'src/components/events/block-renderer.tsx';
const SERVICO_DA_CHAMADA = 'src/lib/proposals/call-service.ts';

/** Comentário que CITA o proibido não é o proibido (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function fonte(caminho: string): string {
  return semComentarios(readFileSync(join(process.cwd(), caminho), 'utf8'));
}

/** A projeção REAL da fatia 1, com o mínimo que a página desenha. */
function projecao(estado: 'PARCIAL' | 'FINAL' = 'PARCIAL'): PublicCallResultView {
  return {
    estado,
    publicadoEm: '2026-10-20T12:00:00.000Z',
    texto: 'A lista dos trabalhos aprovados está abaixo.',
    proximosPassos: 'Envie a versão final até 10 de novembro.',
    lista: [
      {
        protocoloOuIdEstavel: 'F73A',
        titulo: 'Saúde pública e território',
        tipo: 'Trabalho científico (artigo)',
        autores: ['Ana Souza', 'Convidada Externa'],
      },
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────────
//  A decisão de mostrar a seção
// ───────────────────────────────────────────────────────────────────────────────
describe('a seção do resultado na página da chamada', () => {
  it('existe para PARCIAL e FINAL, com o título do domínio e a data recebida', () => {
    for (const estado of ['PARCIAL', 'FINAL'] as const) {
      const view = projecao(estado);

      const secao = buildPublicCallResultSection({
        view,
        publicadoEmLabel: '20/10/2026 09:00',
      });

      expect(secao, estado).not.toBeNull();
      expect(secao?.title, estado).toBe(PUBLIC_CALL_RESULT_SECTION_TITLE);
      expect(secao?.title).toBe('Resultado');
      expect(secao?.publicadoEmLabel).toBe('20/10/2026 09:00');
      /** A view é a MESMA da projeção — a seção não remonta o documento. */
      expect(secao?.view).toBe(view);
      expect(secao?.view.estado).toBe(estado);
      expect(secao?.view.lista).toHaveLength(1);
    }
  });

  it('SEM_RESULTADO e RASCUNHO não produzem seção — nem título, nem espaço', () => {
    /**
     * A `view` nula é o que a projeção devolve nos dois estados (e o serviço público
     * devolve `null` nesses casos). A página não esconde a seção: ela não a cria.
     */
    for (const estado of ['SEM_RESULTADO', 'RASCUNHO'] as const) {
      expect(PUBLIC_CALL_RESULT_VISIBILITY[estado], estado).toBe('NADA');

      const secao = buildPublicCallResultSection({
        view: null,
        publicadoEmLabel: '20/10/2026 09:00',
      });

      expect(secao, estado).toBeNull();
    }
  });

  it('publicação SEM data não é anúncio: a seção não é montada', () => {
    /**
     * O leitor tolerante já rebaixa PARCIAL/FINAL sem data a RASCUNHO; este ramo é a
     * defesa do dia em que ele mudar. Anunciar "Publicado em" com data inventada
     * seria a mentira que a fatia 1 recusou.
     */
    expect(buildPublicCallResultSection({ view: projecao(), publicadoEmLabel: '' })).toBeNull();
    expect(
      buildPublicCallResultSection({ view: projecao(), publicadoEmLabel: '   ' }),
    ).toBeNull();
    expect(buildPublicCallResultSection({ view: null, publicadoEmLabel: '' })).toBeNull();
  });

  it('a tabela cobre os QUATRO estados e concorda com a régua da projeção', () => {
    expect(Object.keys(PUBLIC_CALL_RESULT_VISIBILITY).sort()).toEqual(
      [...CALL_RESULT_STATES].sort(),
    );

    for (const estado of CALL_RESULT_STATES) {
      expect(visibilityAgreesWithProjection(estado), estado).toBe(true);
    }

    /**
     * E a régua é a mesma do domínio: só PARCIAL e FINAL são públicos. Se alguém
     * mudasse a tabela para desenhar rascunho, as duas asserções acima cairiam.
     */
    const desenham = CALL_RESULT_STATES.filter(
      (estado) => PUBLIC_CALL_RESULT_VISIBILITY[estado] === 'SECAO',
    );

    expect(desenham).toEqual(['PARCIAL', 'FINAL']);
    expect(desenham.every((estado) => isPublicCallResultState(estado))).toBe(true);
  });

  it('a data chega já formatada, e a seção não a reformata', () => {
    /** O domínio não tem `Intl` nem relógio: o rótulo entra pronto do servidor. */
    const secao = buildPublicCallResultSection({
      view: projecao(),
      publicadoEmLabel: '20/10/2026 09:00',
    });

    expect(secao?.publicadoEmLabel).toBe('20/10/2026 09:00');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  O selo da landing
// ───────────────────────────────────────────────────────────────────────────────
describe('o selo do bloco de chamadas da landing', () => {
  it('só o resultado PUBLICADO ganha selo — rascunho não vaza nem como marca', () => {
    const esperado: Record<CallResultState, boolean> = {
      SEM_RESULTADO: false,
      RASCUNHO: false,
      PARCIAL: true,
      FINAL: true,
    };

    for (const estado of CALL_RESULT_STATES) {
      expect(showsPublishedResultBadge(estado), estado).toBe(esperado[estado]);
    }
  });

  it('o selo e o link dizem o que fazem sem repetir o documento', () => {
    expect(PUBLIC_CALL_RESULT_LANDING_BADGE).toBe('Resultado publicado');
    expect(PUBLIC_CALL_RESULT_LANDING_LINK.toLowerCase()).toContain('resultado');

    /**
     * O selo NÃO carrega texto, lista nem próximos passos: ele é uma marca e um
     * caminho. Repetir o documento na landing criaria a segunda cópia da verdade.
     */
    expect(PUBLIC_CALL_RESULT_LANDING_BADGE).not.toContain('\n');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  As frases
// ───────────────────────────────────────────────────────────────────────────────
describe('as frases do resultado público', () => {
  it('são as do documento, e nenhuma é vazia', () => {
    expect(PUBLIC_CALL_RESULT_SECTION_TITLE).toBe('Resultado');
    expect(PUBLIC_CALL_RESULT_PUBLISHED_PREFIX).toBe('Publicado em');
    expect(PUBLIC_CALL_RESULT_LIST_TITLE).toBe('Lista publicada');
    expect(PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE).toBe('Próximos passos');

    for (const frase of [
      PUBLIC_CALL_RESULT_SECTION_TITLE,
      PUBLIC_CALL_RESULT_PUBLISHED_PREFIX,
      PUBLIC_CALL_RESULT_LIST_TITLE,
      PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE,
    ]) {
      expect(frase.trim().length).toBeGreaterThan(0);
    }
  });

  it('o componente desenha as frases do DOMÍNIO — não a segunda cópia', () => {
    const componente = fonte(COMPONENTE);

    expect(componente).toContain("from '@/domain/proposals/call-result-public-rules'");
    expect(componente).toContain('{PUBLIC_CALL_RESULT_PUBLISHED_PREFIX} {publicadoEmLabel}');
    expect(componente).toContain('{PUBLIC_CALL_RESULT_LIST_TITLE} ({view.lista.length})');
    expect(componente).toContain('{PUBLIC_CALL_RESULT_NEXT_STEPS_TITLE}');

    /** Os literais antigos saíram: duas cópias divergem no primeiro ajuste de texto. */
    expect(componente).not.toContain('>Próximos passos<');
    expect(componente).not.toContain('Lista publicada (');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  Catracas de fonte
// ───────────────────────────────────────────────────────────────────────────────
describe('catraca da página da chamada', () => {
  it('importa a leitura PÚBLICA do resultado e nunca o painel do organizador', () => {
    const pagina = fonte(PAGINA);

    expect(pagina).toContain("from '@/lib/proposals/call-result-public-service'");
    expect(pagina).toContain('getPublicCallResult(');

    /**
     * O painel carrega o seletor (todas as submissões, com a decisão de cada uma) e
     * os `problems` da configuração. Ele não pode aparecer nesta página.
     */
    expect(pagina).not.toContain('call-result-service');
    expect(pagina).not.toContain('getCallResultPanel');
    expect(pagina).not.toContain('buildCallResultSelector');
    expect(pagina).not.toContain('acoesDisponiveis');
  });

  it('usa a decisão do DOMÍNIO e cria a seção em UM lugar só', () => {
    const pagina = fonte(PAGINA);

    expect(pagina).toContain("from '@/domain/proposals/call-result-public-rules'");
    expect(pagina).toContain('buildPublicCallResultSection(');

    /** A seção é CRIADA pelo condicional — não há seção escondida por CSS ou `hidden`. */
    expect(pagina).toContain('{secaoResultado ? (');
    expect(pagina).toContain('data-testid="call-result-section"');
    expect(pagina).not.toContain('hidden={');
    expect(pagina).not.toContain('sr-only');

    /** O componente compartilhado desenha o documento — a página não o remonta. */
    expect(pagina).toContain("from '@/components/proposals/call-result-public-view'");
    expect(pagina).toContain('<CallResultPublicView');

    /** Data formatada no servidor, no MESMO fuso do resto do sistema. */
    expect(pagina).toContain('formatZonedDateTime(');
  });

  it('mantém o 404 de hoje: a chamada é resolvida pelo caminho existente', () => {
    const pagina = fonte(PAGINA);

    /** O slug continua resolvido por `getCallBySlug` — não há segundo caminho. */
    expect(pagina).toContain('getCallBySlug(');
    expect(pagina).toContain("if (call.state === 'DRAFT') notFound();");
    expect(pagina).toContain('getPublicEvent(');
  });

  it('não injeta HTML e não usa `any`', () => {
    const pagina = fonte(PAGINA);

    expect(pagina).not.toContain('dangerouslySetInnerHTML');
    expect(pagina).not.toMatch(/:\s*any\b/);
    expect(pagina).not.toMatch(/as any\b/);
  });
});

describe('catraca do serviço público do resultado', () => {
  it('não importa o painel do organizador nem o seletor da lista', () => {
    const servico = fonte(SERVICO);

    expect(servico).toContain("from '@/lib/db/tenant-client'");
    expect(servico).toContain('withTenant(');

    expect(servico).not.toContain('call-result-service');
    expect(servico).not.toContain('getCallResultPanel');
    expect(servico).not.toContain('buildCallResultSelector');
    expect(servico).not.toContain('SUBMISSION_STATUS_LABELS');
    expect(servico).not.toContain('seletor');
    expect(servico).not.toContain('acoesDisponiveis');
  });

  it('projeta pelo DOMÍNIO e exige a chamada PUBLICADA no escopo da instituição', () => {
    const servico = fonte(SERVICO);

    expect(servico).toContain('projectPublicCallResult(');
    expect(servico).toContain('readCallResult(');

    expect(servico).toContain('isPublished: true');
    expect(servico).toContain('tenantId: input.tenantId');
    expect(servico).toContain('deletedAt: null');
  });

  it('busca SÓ os ids publicados — nunca a chamada inteira', () => {
    const servico = fonte(SERVICO);

    /** `id: { in: ... }` é o que impede a consulta de devolver o seletor por acidente. */
    expect(servico).toMatch(/id:\s*\{ in: \[\.\.\.ids\] \}/);
    expect(servico).toMatch(/ids\.length === 0/);
  });

  it('NÃO pede nota, parecer, revisor, e-mail, status nem `proposalData`', () => {
    const servico = fonte(SERVICO);

    /**
     * A lista dos campos que a consulta poderia pedir e não pede. A normalização não
     * está aqui porque estes são nomes do SCHEMA: quem escrevesse `finalScore: true`
     * no `select` cairia nesta asserção.
     */
    for (const campo of [
      'finalScore',
      'weightedScore',
      'scores',
      'decisionNotes',
      'decisionById',
      'decidedAt',
      'decisionAt',
      'proposalData',
      'abstract',
      'keywords',
      'reviews',
      'reviewerId',
      'assignments',
      'status',
      'email',
      'registrationId',
    ]) {
      expect(servico, `${campo} não pode ser consultado`).not.toMatch(
        new RegExp(`\\b${campo}\\s*:`),
      );
    }

    /** Os autores entram pelo nome e pelo SINAL da ocultação — e por mais nada. */
    expect(servico).toContain('publicProfileHiddenAt: true');
    expect(servico).not.toMatch(/\bemail\s*:\s*true/);
  });

  it('o `problems` vai para o LOG, nunca para a tela', () => {
    const servico = fonte(SERVICO);

    expect(servico).toContain('console.warn(');
    expect(servico).toContain('console.error(');
    /** A assinatura devolve a view ou `null` — não há canal para o visitante ver aviso. */
    expect(servico).toContain('Promise<PublicCallResultView | null>');
  });

  it('não usa `any`', () => {
    expect(fonte(SERVICO)).not.toMatch(/:\s*any\b/);
    expect(fonte(SERVICO)).not.toMatch(/as any\b/);
  });
});

describe('catraca do bloco de chamadas da landing', () => {
  it('decide o selo pelo ESTADO do resultado, nunca pelo JSON', () => {
    const bloco = fonte(BLOCO);

    expect(bloco).toContain('showsPublishedResultBadge(');
    expect(bloco).toContain('call.resultState');

    /** `call.result` seria o JSON cru na landing — o selo não precisa dele. */
    expect(bloco).not.toMatch(/call\.result\b/);
    expect(bloco).not.toContain('call.publicados');
    expect(bloco).not.toContain('proximosPassos');
  });

  it('mostra o selo E o caminho para a página da chamada', () => {
    const bloco = fonte(BLOCO);

    expect(bloco).toContain('PUBLIC_CALL_RESULT_LANDING_BADGE');
    expect(bloco).toContain('PUBLIC_CALL_RESULT_LANDING_LINK');
    expect(bloco).toContain('/chamada/${call.slug}');
    expect(bloco).toContain('data-testid="call-result-published"');
  });

  it('a projeção da chamada carrega o ESTADO derivado, e só ele', () => {
    const servico = fonte(SERVICO_DA_CHAMADA);

    expect(servico).toContain("from '@/domain/proposals/call-result-rules'");
    expect(servico).toContain('readCallResult(input.row.result).resultado.estado');
    expect(servico).toContain('resultState: CallResultState');
    /** O JSON é lido; o CONTEÚDO dele não vira campo do `CallView`. */
    expect(servico).not.toMatch(/\bproximosPassos\s*:/);
    expect(servico).not.toMatch(/\bpublicados\s*:/);
  });
});

describe('catraca de pureza do domínio da página pública', () => {
  it('não importa Prisma, Next nem infraestrutura', () => {
    const codigo = fonte(DOMINIO);

    expect(codigo).not.toContain('@prisma');
    expect(codigo).not.toContain('next/');
    expect(codigo).not.toContain('withTenant');
    expect(codigo).not.toContain('adminPrisma');
  });

  it('não lê relógio nem formata data (o rótulo chega pronto do servidor)', () => {
    const codigo = fonte(DOMINIO);

    expect(codigo).not.toContain('Date.now(');
    expect(codigo).not.toMatch(/new Date\(\s*\)/);
    expect(codigo).not.toContain('Intl.DateTimeFormat');
    expect(codigo).not.toContain('toLocaleString');
  });

  it('não usa `any`', () => {
    expect(fonte(DOMINIO)).not.toMatch(/:\s*any\b/);
    expect(fonte(DOMINIO)).not.toMatch(/as any\b/);
  });
});
