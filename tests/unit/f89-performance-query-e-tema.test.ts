/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 89 — PERFORMANCE RSC NO SHELL E CONTEXTO (`React.cache` + `Promise.all`),
 *  QUERY `?evento=` DESCARTADA COM AVISO (`E89`) E FRONTEIRA DO `.ef-theme` (`E90`)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Três entregas testadas em isolamento e com catracas de código-fonte:
 *
 *    1. Fatia 1 (ADR-394): `getRequestContext` envelopado por `React.cache` em
 *       `src/lib/auth/session.ts` e portas do menu lateral paralelizadas com
 *       `Promise.all` em `src/app/t/[tenantSlug]/(app)/layout.tsx`.
 *    2. Fatia 2 (ADR-395 · Dívida E89 quitada): `resolveEventQuerySelection` e
 *       `discardedEventSelectionNotice` em `src/domain/validation/query-filter-rules.ts`
 *       + catraca nas 5 telas (`credenciamento`, `crachas`, `meu-cracha`,
 *       `minha-agenda` e `participantes`).
 *    3. Fatia 3 (ADR-396 · Dívida E90 quitada): nenhuma página ou componente de
 *       plataforma fora da árvore `.ef-theme` importa `event-theme.css` ou usa
 *       `.ef-card`, `.ef-button`, `.ef-button-outline` e `.ef-badge`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  discardedEventSelectionNotice,
  discardedFilterNotice,
  resolveEventQuerySelection,
} from '../../src/domain/validation/query-filter-rules';

const ROOT = process.cwd();
const UUID_A = '3f6c8a10-9d2b-4e7a-8c51-0a1b2c3d4e5f';
const UUID_B = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UUID_AUSENTE = '99999999-8888-4777-8666-555555555555';

const EVENTOS = [
  { id: UUID_A, title: 'Congresso A' },
  { id: UUID_B, title: 'Simpósio B' },
] as const;

function listarArquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const absoluto = join(dir, entrada);
    const stat = statSync(absoluto);
    if (stat.isDirectory()) {
      saida.push(...listarArquivosTs(absoluto));
    } else if (entrada.endsWith('.ts') || entrada.endsWith('.tsx')) {
      saida.push(relative(ROOT, absoluto).replaceAll('\\', '/'));
    }
  }
  return saida;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FATIA 1 — `getRequestContext` COM `React.cache` E `Promise.all` NO `TenantLayout`
// ═══════════════════════════════════════════════════════════════════════════════
describe('Fatia 1 (ADR-394) — getRequestContext memoizado por requisição e TenantLayout em paralelo', () => {
  it('src/lib/auth/session.ts envelopa getRequestContext com cache() do React', () => {
    const fonte = readFileSync(join(ROOT, 'src/lib/auth/session.ts'), 'utf8');

    expect(fonte).toMatch(/import\s*\{\s*cache\s*\}\s*from\s*['"]react['"]/);
    expect(fonte).toMatch(
      /const\s+readRequestContext\s*=\s*cache\(\s*async\s*\(\)\s*:\s*Promise<RequestContext\s*\|\s*null>\s*=>/,
    );
    expect(fonte).toMatch(
      /export\s+async\s+function\s+getRequestContext\(\)\s*:\s*Promise<RequestContext\s*\|\s*null>\s*\{\s*return\s+readRequestContext\(\);\s*\}/,
    );
  });

  it('src/app/t/[tenantSlug]/(app)/layout.tsx dispara as 3 portas do menu em Promise.all', () => {
    const fonte = readFileSync(
      join(ROOT, 'src/app/t/[tenantSlug]/(app)/layout.tsx'),
      'utf8',
    );

    expect(fonte).toMatch(
      /Promise\.all\(\[\s*hasPendingSpeakerInvite\([\s\S]*?hasPendingSponsorInvite\([\s\S]*?readSponsorAccess\(/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FATIA 2 — `resolveEventQuerySelection` E QUITAÇÃO DA DÍVIDA E89
// ═══════════════════════════════════════════════════════════════════════════════
describe('Fatia 2 (ADR-395 · E89) — resolveEventQuerySelection com fallback first', () => {
  it('sem ?evento=, vazio ou só espaço escolhe o 1º evento sem aviso', () => {
    for (const raw of [undefined, null, '', '   ', [] as string[]]) {
      expect(
        resolveEventQuerySelection({
          value: raw,
          events: EVENTOS,
          fallback: 'first',
        }),
      ).toEqual({
        selectedEventId: UUID_A,
        selectedEvent: EVENTOS[0],
        discardedNotice: null,
      });
    }
  });

  it('quando a lista de eventos está vazia e não há ?evento=, devolve null sem aviso', () => {
    expect(
      resolveEventQuerySelection({
        value: undefined,
        events: [],
        fallback: 'first',
      }),
    ).toEqual({
      selectedEventId: null,
      selectedEvent: null,
      discardedNotice: null,
    });
  });

  it('quando ?evento= é um UUID presente na lista (inclusive com espaços ao redor), seleciona-o sem aviso', () => {
    expect(
      resolveEventQuerySelection({
        value: `  ${UUID_B}  `,
        events: EVENTOS,
        fallback: 'first',
      }),
    ).toEqual({
      selectedEventId: UUID_B,
      selectedEvent: EVENTOS[1],
      discardedNotice: null,
    });
  });

  it('quando ?evento= é malformado ou repetido, cai no 1º evento e devolve o aviso invalid_format', () => {
    for (const raw of ['nao-e-uuid', UUID_A.slice(0, -1), [UUID_A, UUID_B]]) {
      expect(
        resolveEventQuerySelection({
          value: raw,
          events: EVENTOS,
          fallback: 'first',
        }),
      ).toEqual({
        selectedEventId: UUID_A,
        selectedEvent: EVENTOS[0],
        discardedNotice: discardedEventSelectionNotice({
          fallback: 'first',
          fallbackEventTitle: 'Congresso A',
          reason: 'invalid_format',
        }),
      });
    }
  });

  it('quando ?evento= tem forma de UUID mas não está na lista (inexistente, rascunho ou outra instituição), cai no 1º evento e devolve o aviso not_found', () => {
    expect(
      resolveEventQuerySelection({
        value: UUID_AUSENTE,
        events: EVENTOS,
        fallback: 'first',
      }),
    ).toEqual({
      selectedEventId: UUID_A,
      selectedEvent: EVENTOS[0],
      discardedNotice: discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: 'Congresso A',
        reason: 'not_found',
      }),
    });
  });

  it('quando a lista de eventos está vazia mas veio ?evento= na URL, devolve null E anuncia o descarte sem título de fallback', () => {
    expect(
      resolveEventQuerySelection({
        value: UUID_AUSENTE,
        events: [],
        fallback: 'first',
      }),
    ).toEqual({
      selectedEventId: null,
      selectedEvent: null,
      discardedNotice: discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: null,
        reason: 'not_found',
      }),
    });
  });
});

describe('Fatia 2 (ADR-395 · E89) — resolveEventQuerySelection com fallback all (/participantes)', () => {
  it('sem ?evento= mantém todos os eventos (selectedEventId = null) sem aviso', () => {
    expect(
      resolveEventQuerySelection({
        value: undefined,
        events: EVENTOS,
        fallback: 'all',
      }),
    ).toEqual({
      selectedEventId: null,
      selectedEvent: null,
      discardedNotice: null,
    });
  });

  it('com ?evento= válido e presente na lista, aplica o filtro sem aviso', () => {
    expect(
      resolveEventQuerySelection({
        value: UUID_B,
        events: EVENTOS,
        fallback: 'all',
      }),
    ).toEqual({
      selectedEventId: UUID_B,
      selectedEvent: EVENTOS[1],
      discardedNotice: null,
    });
  });

  it('com ?evento= malformado ou repetido, limpa o filtro (null) e devolve discardedFilterNotice("evento")', () => {
    for (const raw of ['nao-e-uuid', [UUID_A, UUID_B]]) {
      expect(
        resolveEventQuerySelection({
          value: raw,
          events: EVENTOS,
          fallback: 'all',
        }),
      ).toEqual({
        selectedEventId: null,
        selectedEvent: null,
        discardedNotice: discardedFilterNotice('evento'),
      });
    }
  });

  it('com ?evento= UUID ausente da instituição, limpa o filtro (null) e devolve o aviso not_found de lista completa', () => {
    expect(
      resolveEventQuerySelection({
        value: UUID_AUSENTE,
        events: EVENTOS,
        fallback: 'all',
      }),
    ).toEqual({
      selectedEventId: null,
      selectedEvent: null,
      discardedNotice: discardedEventSelectionNotice({
        fallback: 'all',
        reason: 'not_found',
      }),
    });
  });

  it('as frases do domínio explicam o descarte, o motivo e o destino aplicado', () => {
    expect(
      discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: 'Congresso A',
        reason: 'invalid_format',
      }),
    ).toBe(
      'O evento indicado no endereço foi descartado: o identificador não é válido. Exibindo "Congresso A".',
    );
    expect(
      discardedEventSelectionNotice({
        fallback: 'first',
        fallbackEventTitle: null,
        reason: 'not_found',
      }),
    ).toBe(
      'O evento indicado no endereço não foi encontrado ou não está disponível para o seu acesso. Exibindo o primeiro evento disponível.',
    );
    expect(
      discardedEventSelectionNotice({
        fallback: 'all',
        reason: 'not_found',
      }),
    ).toBe(
      'O filtro por evento foi descartado: o evento informado no endereço não foi encontrado nesta instituição. A lista continua sem esse filtro.',
    );
  });
});

describe('Fatia 2 (ADR-395 · E89) — catraca nas 5 telas do escopo', () => {
  const TELAS_E89 = [
    {
      arquivo: 'src/app/t/[tenantSlug]/(app)/credenciamento/page.tsx',
      testId: 'checkin-event-notice',
      fallback: 'first',
    },
    {
      arquivo: 'src/app/t/[tenantSlug]/(app)/credenciamento/crachas/page.tsx',
      testId: 'badge-event-notice',
      fallback: 'first',
    },
    {
      arquivo: 'src/app/t/[tenantSlug]/(app)/meu-cracha/page.tsx',
      testId: 'own-badge-event-notice',
      fallback: 'first',
    },
    {
      arquivo: 'src/app/t/[tenantSlug]/(app)/minha-agenda/page.tsx',
      testId: 'agenda-event-notice',
      fallback: 'first',
    },
    {
      arquivo: 'src/app/t/[tenantSlug]/(app)/participantes/page.tsx',
      testId: 'participant-event-notice',
      fallback: 'all',
    },
  ] as const;

  for (const tela of TELAS_E89) {
    it(`${tela.arquivo} resolve ?evento= pelo domínio (${tela.fallback}) e renderiza ${tela.testId}`, () => {
      const fonte = readFileSync(join(ROOT, tela.arquivo), 'utf8');

      expect(fonte).toContain('resolveEventQuerySelection');
      expect(fonte).toContain(`fallback: '${tela.fallback}'`);
      expect(fonte).toContain(`data-testid="${tela.testId}"`);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FATIA 3 — FRONTEIRA DO `.ef-theme` E QUITAÇÃO DA DÍVIDA E90
// ═══════════════════════════════════════════════════════════════════════════════
describe('Fatia 3 (ADR-396 · E90) — classes .ef-* e event-theme.css restritas à árvore .ef-theme', () => {
  /**
   * Lista fechada de arquivos em `src/` que vivem DENTRO de um ancestral
   * `.ef-theme` (páginas públicas do evento e suas subpáginas, `ThemeScope`,
   * `EventLanding` e os componentes da árvore do evento, mais `agenda-marks.tsx`
   * que só aplica `ef-badge` na variante `'tema'` e `call-result-public-view.tsx`
   * que desenha a projeção pública da chamada).
   */
  const ARQUIVOS_DENTRO_DE_EF_THEME = new Set([
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/page.tsx',
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/atividades/[activitySlug]/page.tsx',
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/chamada/[callSlug]/page.tsx',
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/inscricao/page.tsx',
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/palestrantes/[speakerId]/page.tsx',
    'src/app/t/[tenantSlug]/(public)/eventos/[eventSlug]/patrocinar/page.tsx',
    'src/app/t/[tenantSlug]/(app)/administracao/eventos/[eventId]/pagina/page.tsx',
    'src/components/admin/event-page-editor.tsx',
    'src/components/events/activity-card.tsx',
    'src/components/events/activity-materials.tsx',
    'src/components/events/agenda-marks.tsx',
    'src/components/events/block-renderer.tsx',
    'src/components/events/call-proposal-form.tsx',
    'src/components/events/event-blocks.tsx',
    'src/components/events/event-landing.tsx',
    'src/components/events/event-registration-data-form.tsx',
    'src/components/events/event-registration-form.tsx',
    'src/components/events/happening-now.tsx',
    'src/components/events/registration-form.tsx',
    'src/components/events/registration-panel.tsx',
    'src/components/events/schedule-browser.tsx',
    'src/components/events/speaker-card.tsx',
    'src/components/events/speaker-gallery.tsx',
    'src/components/events/sponsor-section.tsx',
    'src/components/events/theme-scope.tsx',
    'src/components/sponsors/sponsor-lead-form.tsx',
  ]);

  const PADRAO_CLASSE_EF = /\bef-(?:card|button|button-outline|badge)\b/;
  const PADRAO_IMPORT_EVENT_THEME = /import\s+['"][^'"]*event-theme\.css['"]/;

  it('nenhum arquivo em src/ fora da árvore .ef-theme usa .ef-card, .ef-button, .ef-button-outline ou .ef-badge', () => {
    const arquivos = listarArquivosTs(join(ROOT, 'src'));
    const violacoes: string[] = [];

    for (const arquivo of arquivos) {
      if (ARQUIVOS_DENTRO_DE_EF_THEME.has(arquivo)) continue;
      const fonte = readFileSync(join(ROOT, arquivo), 'utf8');
      if (PADRAO_CLASSE_EF.test(fonte)) {
        violacoes.push(arquivo);
      }
    }

    expect(violacoes).toEqual([]);
  });

  it('nenhum arquivo fora da árvore .ef-theme importa event-theme.css', () => {
    const arquivos = listarArquivosTs(join(ROOT, 'src'));
    const violacoes: string[] = [];

    for (const arquivo of arquivos) {
      if (ARQUIVOS_DENTRO_DE_EF_THEME.has(arquivo)) continue;
      const fonte = readFileSync(join(ROOT, arquivo), 'utf8');
      if (PADRAO_IMPORT_EVENT_THEME.test(fonte)) {
        violacoes.push(arquivo);
      }
    }

    expect(violacoes).toEqual([]);
  });
});
