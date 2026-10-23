/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  O EXEMPLO QUE NÃO ESCREVE (FASE 77 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. A CATRACA — nenhum arquivo do demo importa banco, guarda de escrita, action
 *     ou `'use server'`; nenhum formulário/submit aparece; nenhuma chamada de
 *     `fetch`, `revalidatePath` ou `redirect` aparece.
 *  2. AS FIXTURES — um evento, duas atividades, uma chamada, uma inscrição, uma
 *     presença, uma carta e uma demanda; dado serializável (puro) e rótulos
 *     determinísticos no fuso da fixture.
 *  3. A TELA — renderizada de verdade, com o selo, o título e as seções, e sem
 *     nenhum elemento de escrita no HTML.
 *  4. A ENTRADA — o estado vazio da lista de eventos contém o link para
 *     `/exemplo`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CATRACA VARRE ARQUIVOS, E NÃO "CONFIA NO REVISOR"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O demo é a única tela do produto que se parece com uma tela de escrita e não
 *  pode escrever. Um `<form>` esquecido, um `action={...}` copiado de outra tela
 *  ou um `withTenant` "só para conferir" transformariam o exemplo em um caminho
 *  de gravação no dado real — e a pessoa que clicasse não teria como desfazer.
 *  O teste lê a fonte e reprova ANTES de a rota subir.
 *
 *  A varredura remove comentários: a explicação da decisão CITA `withTenant`,
 *  `revalidatePath` e `fetch` para dizer por que eles não estão lá, e comentário
 *  não executa. Procurar no texto cru daria falso positivo na própria justificativa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  DEMO_ACTIVITY_KIND_LABELS,
  DEMO_EVENT,
  DEMO_EVENT_STATUS_LABELS,
  demoDateLabel,
  demoDurationLabel,
  demoPeriodLabel,
  demoTimeLabel,
} from '../../src/domain/demo/demo-event';

// ───────────────────────────────────────────────────────────────────────────────
//  Dublês — a tela não tem dado nem formulário real; só a guarda e o Link do Next
// ───────────────────────────────────────────────────────────────────────────────
const guarda = vi.hoisted(() => ({ chamadas: [] as { tenantSlug: string }[] }));

vi.mock('../../src/lib/auth/guard-page', () => ({
  /** A tela do exemplo usa a porta de VÍNCULO. */
  requirePageMembership: async (input: { tenantSlug: string }) => {
    guarda.chamadas.push({ tenantSlug: input.tenantSlug });
    return {
      tenantId: 'tenant-do-exemplo',
      tenantName: 'Instituto Exemplo',
      userId: 'pessoa-do-exemplo',
    };
  },
  /** A lista de eventos do painel usa a porta de PERMISSÃO (não é o alvo do demo). */
  requirePagePermission: async () => ({ tenantId: 'tenant-do-exemplo' }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/t/instituto-exemplo/exemplo',
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

/** O Link vira âncora, mas PRESERVA os atributos: o teste precisa do href/testid. */
vi.mock('next/link', () => ({
  default: (props: { href: string; children?: unknown } & Record<string, unknown>) => {
    const { href, children, ...rest } = props;
    return createElement(
      'a',
      { href, ...(rest as Record<string, string>) },
      children as never,
    );
  },
}));

/** A lista de eventos e o formulário do painel não são o objeto desta fatia. */
vi.mock('../../src/lib/admin/catalog-service', () => ({
  listAdminEvents: async () => [],
}));

vi.mock('../../src/app/actions/admin-actions', () => ({
  saveEventAction: async () => ({ ok: true }),
}));

vi.mock('../../src/components/admin/admin-form', () => ({
  AdminForm: (props: { children?: unknown }) => createElement('div', null, props.children as never),
  Field: () => null,
  SelectField: () => null,
  CheckboxField: () => null,
}));

const { default: DemoEventPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/exemplo/page'
);
const { default: AdminEventsPage } = await import(
  '../../src/app/t/[tenantSlug]/(app)/administracao/eventos/page'
);

// ───────────────────────────────────────────────────────────────────────────────
//  A catraca
// ───────────────────────────────────────────────────────────────────────────────
const RAIZ = process.cwd();

/**
 * Os diretórios do demo. `src/app/**\/exemplo/**` é filtrado do diretório inteiro
 * (a rota pode ganhar arquivos: `layout.tsx`, `loading.tsx`, subpastas); o domínio
 * é varrido por inteiro. `src/components/demo` entra se existir, para o caso de a
 * tela ser dividida em um componente novo — a catraca não pode depender de a
 * pessoa lembrar de registrar o arquivo.
 */
const DIRETORIOS_FIXOS = ['src/domain/demo', 'src/components/demo'];

function listarArquivos(relativo: string): string[] {
  let absoluto: string;

  try {
    absoluto = join(RAIZ, relativo);
    if (!statSync(absoluto).isDirectory()) return [];
  } catch {
    return [];
  }

  const encontrados: string[] = [];

  for (const entrada of readdirSync(absoluto)) {
    const caminhoRelativo = `${relativo}/${entrada}`;

    if (statSync(join(RAIZ, caminhoRelativo)).isDirectory()) {
      encontrados.push(...listarArquivos(caminhoRelativo));
      continue;
    }

    if (/\.(?:ts|tsx)$/.test(entrada)) {
      encontrados.push(caminhoRelativo);
    }
  }

  return encontrados;
}

function arquivosDoDemo(): string[] {
  return [
    ...listarArquivos('src/app').filter((arquivo) => arquivo.includes('/exemplo/')),
    ...DIRETORIOS_FIXOS.flatMap((diretorio) => listarArquivos(diretorio)),
  ];
}

/** Remove comentários de bloco e de linha — o que sobra é o que executa. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const ARQUIVOS_DEMO = arquivosDoDemo();

describe('catraca — o demo não escreve', () => {
  it('a varredura alcança a página e as fixtures (não passa por lista vazia)', () => {
    expect(ARQUIVOS_DEMO.length).toBeGreaterThanOrEqual(2);
    expect(
      ARQUIVOS_DEMO.some((arquivo) => arquivo.endsWith('/exemplo/page.tsx')),
      'a página /exemplo precisa estar na varredura',
    ).toBe(true);
    expect(
      ARQUIVOS_DEMO.some((arquivo) => arquivo.startsWith('src/domain/demo/')),
      'as fixtures de src/domain/demo/** precisam estar na varredura',
    ).toBe(true);
  });

  it('nenhum arquivo importa banco, action ou declara uma Server Action', () => {
    const violacoes: string[] = [];

    for (const arquivo of ARQUIVOS_DEMO) {
      const codigo = semComentarios(readFileSync(join(RAIZ, arquivo), 'utf8'));

      if (/\bwithTenant\b/.test(codigo)) {
        violacoes.push(`${arquivo}: usa withTenant`);
      }
      if (/\badminPrisma\b/.test(codigo)) {
        violacoes.push(`${arquivo}: usa adminPrisma`);
      }
      if (/\bprisma\b/.test(codigo)) {
        violacoes.push(`${arquivo}: usa prisma`);
      }
      if (/\bfrom\s+['"][^'"]*\/lib\/db[^'"]*['"]/.test(codigo)) {
        violacoes.push(`${arquivo}: importa src/lib/db`);
      }
      if (/\bfrom\s+['"][^'"]*\/app\/actions[^'"]*['"]/.test(codigo)) {
        violacoes.push(`${arquivo}: importa src/app/actions/**`);
      }
      if (/['"]use server['"]/.test(codigo)) {
        violacoes.push(`${arquivo}: declara 'use server'`);
      }
    }

    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
  });

  it('nenhum arquivo tem formulário, submit ou action de escrita', () => {
    const violacoes: string[] = [];

    for (const arquivo of ARQUIVOS_DEMO) {
      const codigo = semComentarios(readFileSync(join(RAIZ, arquivo), 'utf8'));

      if (/<form\b/.test(codigo)) {
        violacoes.push(`${arquivo}: contém <form>`);
      }
      if (/\bmethod\s*=\s*['"`]?\s*(?:post|put|patch|delete)\b/i.test(codigo)) {
        violacoes.push(`${arquivo}: contém method de escrita`);
      }
      if (/\baction\s*=\s*\{/.test(codigo)) {
        violacoes.push(`${arquivo}: contém action={...}`);
      }
      if (/\btype\s*=\s*['"]submit['"]/.test(codigo)) {
        violacoes.push(`${arquivo}: contém type="submit"`);
      }
    }

    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
  });

  it('nenhum arquivo busca dado, revalida caminho ou redireciona', () => {
    const violacoes: string[] = [];

    for (const arquivo of ARQUIVOS_DEMO) {
      const codigo = semComentarios(readFileSync(join(RAIZ, arquivo), 'utf8'));

      if (/\bfetch\s*\(/.test(codigo)) {
        violacoes.push(`${arquivo}: chama fetch(`);
      }
      if (/\brevalidatePath\b/.test(codigo)) {
        violacoes.push(`${arquivo}: chama revalidatePath`);
      }
      if (/\bredirect\b/.test(codigo)) {
        violacoes.push(`${arquivo}: chama redirect`);
      }
    }

    /**
     * EXCEÇÃO DOCUMENTADA: não há exceção. O `redirect` legítimo da guarda vive em
     * `src/lib/auth/guard-page.ts` — fora do escopo varrido, porque ali ele é a
     * resposta certa para quem não tem vínculo. A página do demo NÃO importa
     * `redirect`: ela chama `requirePageMembership` e deixa a decisão com a guarda.
     * Se um dia a página precisar de um `redirect` próprio, a exceção entra aqui
     * com o motivo escrito — nunca em silêncio.
     */
    expect(violacoes, `\n${violacoes.join('\n')}\n`).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  As fixtures
// ───────────────────────────────────────────────────────────────────────────────
describe('fixtures — um evento pequeno, tipado e puro', () => {
  it('tem a forma completa: 2 atividades, 1 chamada, 1 inscrição, 1 presença, 1 carta, 1 demanda', () => {
    expect(DEMO_EVENT.activities).toHaveLength(2);
    expect(DEMO_EVENT.activities.map((atividade) => atividade.kind)).toEqual([
      'PALESTRA',
      'OFICINA',
    ]);
    expect(DEMO_EVENT.call.proposalsReceived).toBe(1);
    expect(DEMO_EVENT.registration.personName.length).toBeGreaterThan(0);
    expect(DEMO_EVENT.attendance.activityId).toBe(DEMO_EVENT.activities[1]?.id);
    expect(DEMO_EVENT.card.rarity).toBe('RARE');
    expect(DEMO_EVENT.demand.column.length).toBeGreaterThan(0);
  });

  it('é DADO serializável — nenhuma função, Date ou valor que só existe em runtime', () => {
    expect(JSON.parse(JSON.stringify(DEMO_EVENT))).toEqual(DEMO_EVENT);
  });

  it('os rótulos são determinísticos no fuso da fixture', () => {
    expect(demoDateLabel(DEMO_EVENT.startsAt)).toBe('12 de novembro de 2026');
    expect(demoTimeLabel(DEMO_EVENT.startsAt)).toBe('08:00');
    expect(demoPeriodLabel(DEMO_EVENT.startsAt, DEMO_EVENT.endsAt)).toBe(
      '12 de novembro de 2026, das 08:00 às 18:00',
    );
    expect(demoDurationLabel(177)).toBe('2 h 57 min');
    expect(demoDurationLabel(45)).toBe('45 min');
    expect(DEMO_ACTIVITY_KIND_LABELS.OFICINA).toBe('Oficina');
    expect(DEMO_EVENT_STATUS_LABELS.REGISTRATION_OPEN).toBe('Inscrições abertas');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A tela
// ───────────────────────────────────────────────────────────────────────────────
describe('a tela do exemplo', () => {
  it('renderiza o selo, o título e as seções — e nenhum elemento de escrita', async () => {
    guarda.chamadas.length = 0;

    const pagina = await DemoEventPage({
      params: Promise.resolve({ tenantSlug: 'instituto-exemplo' }),
    });
    const html = renderToStaticMarkup(pagina);

    /** A guarda foi consultada com o slug da URL — a tela não é pública. */
    expect(guarda.chamadas).toEqual([{ tenantSlug: 'instituto-exemplo' }]);

    /** O selo e o que ele afirma. */
    expect(html).toContain('data-testid="demo-banner"');
    expect(html).toContain('Exemplo com dados fictícios');
    expect(html).toContain('não pertence a');
    expect(html).toContain('Instituto Exemplo');
    expect(html).toContain('não aparece em nenhuma');

    /** A fixture é o que a pessoa vê. */
    expect(html).toContain(DEMO_EVENT.title);
    for (const secao of [
      'O evento',
      'Programação',
      'Chamada de propostas',
      'Inscrição',
      'Presença',
      'Carta conquistada',
      'Demanda da equipe',
    ]) {
      expect(html, `seção ausente: ${secao}`).toContain(secao);
    }

    /** ZERO escrita — a varredura é no HTML produzido, não só na fonte. */
    expect(html).not.toContain('<form');
    expect(html).not.toContain('method="post"');
    expect(html).not.toMatch(/<button[^>]*type="submit"/i);
    expect(html).not.toContain('action=');
    expect(html).not.toContain('data-testid="admin-submit"');
  });

  it('só navega para telas reais de leitura', async () => {
    const pagina = await DemoEventPage({
      params: Promise.resolve({ tenantSlug: 'instituto-exemplo' }),
    });
    const html = renderToStaticMarkup(pagina);

    expect(html).toContain('href="/t/instituto-exemplo/eventos"');
    expect(html).toContain('href="/t/instituto-exemplo/dashboard"');
    expect(html).toContain('data-testid="demo-real-events-link"');
  });
});

// ───────────────────────────────────────────────────────────────────────────────
//  A entrada pelo estado vazio
// ───────────────────────────────────────────────────────────────────────────────
describe('a entrada pelo estado vazio da lista de eventos', () => {
  it('o estado vazio tem o link para /exemplo, com o texto que a pessoa lê', async () => {
    const pagina = await AdminEventsPage({
      params: Promise.resolve({ tenantSlug: 'instituto-exemplo' }),
    });
    const html = renderToStaticMarkup(pagina);

    expect(html).toContain('data-testid="events-empty"');
    expect(html).toContain('data-testid="events-empty-demo-link"');
    expect(html).toContain('href="/t/instituto-exemplo/exemplo"');
    expect(html).toContain('Ver um evento de exemplo, sem cadastrar nada');
    expect(html).toContain('dados fictícios, nada é gravado');
  });
});
