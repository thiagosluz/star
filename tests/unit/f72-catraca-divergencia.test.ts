/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CATRACA — A PÁGINA E A API NÃO PODEM PROJETAR O EVENTO POR CAMINHOS DIFERENTES
 *                                                          (FASE 72 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CATRACA PRENDE, E POR QUE ESTA FORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O defeito que a fase quer tornar impossível não é "um campo com valor
 *  diferente": é um SEGUNDO CAMINHO para o banco. Enquanto a API chamar a mesma
 *  `getPublicEventView` da página, os valores não podem divergir por construção —
 *  a fonte é uma só. No dia em que alguém escrever `withTenant(...)`/`tx.event
 *  .findFirst(...)` no serviço da API (ou reconstruir o objeto na página), a
 *  divergência nasce antes de qualquer teste de valor perceber.
 *
 *  Por isso a prova é de IMPORTAÇÃO e de AUSÊNCIA DE CONSULTA, não um snapshot de
 *  HTML: o snapshot prenderia o desenho de hoje; o import prende a FONTE. A
 *  catraca lê o texto-fonte (sem comentários), como as catracas da casa já fazem
 *  para o `globals.css` e para o landmark.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ELA NÃO PROVA (e por isso não substitui as outras)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma consulta poderia ser escondida atrás de um helper novo importado de outro
 *  módulo. O teste de integração (`f72-api-projecao.test.ts`) mede o dado real; a
 *  unidade mede o recorte; esta catraca mede o CAMINHO declarado. As três juntas
 *  cobrem o que uma sozinha deixaria passar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();

const PAGINA = 'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx';
const VISAO = 'src/lib/events/public-event-view.ts';
const SERVICO = 'src/lib/api/event-api-service.ts';
const PROJECAO = 'src/lib/api/event-api-projection.ts';

/** Comentário que CITA a consulta não é consulta (a mesma precaução da F52/F60). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function ler(caminho: string): string {
  return semComentarios(readFileSync(join(RAIZ, caminho), 'utf8'));
}

describe('página e API leem o evento pelo MESMO caminho', () => {
  it('o caminho é `getPublicEventView`, importado pelos dois consumidores', () => {
    const pagina = ler(PAGINA);
    const servico = ler(SERVICO);

    expect(pagina).toContain("from '@/lib/events/public-event-view'");
    expect(pagina).toContain('getPublicEventView(');

    expect(servico).toContain("from '@/lib/events/public-event-view'");
    expect(servico).toContain('getPublicEventView(');

    /**
     * E a página NÃO chama mais o repositório por conta própria: a sequência
     * (ler + decidir quem vê a sala + aplicar) mora em um lugar só.
     */
    expect(pagina).not.toContain('getPublicEvent(');
    expect(servico).not.toContain('getPublicEvent(');
  });

  it('a visão compartilhada é a sequência única: ler, resolver quem vê, aplicar', () => {
    const visao = ler(VISAO);

    expect(visao).toContain('getPublicEvent(');
    expect(visao).toContain('resolveOnlineRoomViewer(');
    expect(visao).toContain('applyOnlineRoomVisibility(');
  });

  it('nem a página nem o serviço da API abrem consulta própria', () => {
    for (const arquivo of [PAGINA, SERVICO]) {
      const fonte = ler(arquivo);

      expect(fonte, `${arquivo}: withTenant é caminho novo para o banco`).not.toMatch(
        /\bwithTenant\s*\(/,
      );
      expect(fonte, `${arquivo}: adminPrisma é caminho novo para o banco`).not.toMatch(
        /\badminPrisma\b/,
      );
      expect(fonte, `${arquivo}: consulta Prisma direta`).not.toMatch(
        /\.(findFirst|findMany|findUnique|count)\s*\(/,
      );
      expect(fonte, `${arquivo}: SQL bruto`).not.toMatch(/\$queryRaw/);
    }
  });

  it('a página não monta um objeto próprio para os campos que a API projeta', () => {
    const pagina = ler(PAGINA);

    /**
     * A página recebe `event` da visão e o repassa. Se alguém voltar a montar
     * `{ sponsors: ..., speakers: ..., activities: ... }` na página (ou a decidir
     * `onlineUrl` ali), os dois lados passariam a ter uma segunda régua.
     */
    expect(pagina).not.toMatch(/\bsponsors\s*:/);
    expect(pagina).not.toMatch(/\bspeakers\s*:/);
    expect(pagina).not.toMatch(/\bonlineUrl\s*:/);

    expect(pagina).toMatch(/const\s+\{\s*event[^}]*\}\s*=\s*view\s*;/);
    expect(pagina).toContain('event={event}');
  });

  it('as chamadas saem da MESMA leitura pública do bloco da página', () => {
    const pagina = ler(PAGINA);
    const servico = ler(SERVICO);

    expect(pagina).toContain('listPublicCalls(');
    expect(servico).toContain('listPublicCalls(');
    expect(servico).toContain('view.event');
  });

  it('a projeção da API é pura: sem Prisma, sem relógio, sem gerador de id', () => {
    const projecao = ler(PROJECAO);

    expect(projecao).not.toMatch(/@\/lib\/db/);
    expect(projecao).not.toContain('Prisma');
    expect(projecao).not.toMatch(/\bwithTenant\s*\(/);
    expect(projecao).not.toMatch(/\bnew Date\s*\(/);
    expect(projecao).not.toMatch(/\bDate\.now\s*\(/);
    expect(projecao).not.toMatch(/\brandomUUID\s*\(/);
  });

  it('a projeção só aceita os read models públicos, nunca uma linha do banco', () => {
    const projecao = ler(PROJECAO);

    expect(projecao).toContain('PublicEventDetail');
    expect(projecao).toContain('CallView');
    expect(projecao).toContain("from '@/lib/events/event-repository'");
    expect(projecao).toContain("from '@/lib/proposals/call-service'");
  });
});
