/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — A exportação do evento (FASE 77 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE (sem banco e sem navegador)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  • o RECORTE muda a FORMA do arquivo: o CSV do evento não tem "Eventos",
 *    "Eventos com presença" nem "Rótulos" — colunas que, recortadas, valeriam 1 para
 *    todo mundo ou mudariam de significado;
 *  • o painel NÃO existe para quem não tem `participant:read` no TENANT (o mesmo
 *    gate que a Server Action aplica), e existe com DOIS botões para quem tem;
 *  • a raiz do evento continua com CINCO `<section>` e o mapa continua com 17
 *    cartões — o painel entra como bloco dentro de "Operar", depois dos cartões;
 *  • o formato longo das presenças: uma linha por SESSÃO, com as ausências ditas
 *    ("(sem atividade)", "(em aberto)") em vez de sumirem;
 *  • o teto de 5.000 linhas.
 *
 *  A prova com banco (o recorte de verdade, o DRAFT, o teto materializado) está em
 *  `tests/integration/f77-exportacao-do-evento.test.ts`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  canExportEventData,
  EXPORT_KIND_ACTION_LABELS,
  EXPORT_KIND_FILE_SLUG,
  EXPORT_KIND_LABELS,
  EXPORT_KINDS,
} from '../../src/domain/exports/export-rules';
import {
  ATTENDANCE_CSV_HEADER,
  ATTENDANCE_NO_ACTIVITY_LABEL,
  ATTENDANCE_OPEN_SESSION_LABEL,
  attendanceExportRow,
  resolveAttendanceExportSize,
} from '../../src/domain/exports/attendance-export-rules';
import {
  PARTICIPANT_CSV_HEADER,
  PARTICIPANT_EVENT_CSV_HEADER,
} from '../../src/lib/participants/participant-service';
import { CSV_MAX_ROWS } from '../../src/domain/participants/participant-rules';
import { EVENT_AREAS, groupEventAreas } from '../../src/domain/events/event-areas';
import type { Principal } from '../../src/domain/rbac/authorization';
import { EventExportPanel } from '../../src/components/exports/event-export-panel';

const RAIZ = process.cwd();
const PAGINA_DO_EVENTO = join(
  RAIZ,
  'src',
  'app',
  't',
  '[tenantSlug]',
  '(app)',
  'administracao',
  'eventos',
  '[eventId]',
  'page.tsx',
);
const PAINEL_DO_EVENTO = join(RAIZ, 'src', 'components', 'exports', 'event-export-panel.tsx');

/** Comentário que cita uma seção não é uma seção (a precaução das catracas da casa). */
function semComentarios(conteudo: string): string {
  return conteudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function principal(assignment: Principal['assignments'][number] | null): Principal {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    membershipStatus: 'ACTIVE',
    assignments: assignment ? [assignment] : [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('o recorte muda a FORMA do arquivo', () => {
  it('o cabeçalho da instituição continua com as 15 colunas, na MESMA ordem', () => {
    expect(PARTICIPANT_CSV_HEADER).toEqual([
      'Nome',
      'E-mail',
      'Origem',
      'Eventos',
      'Inscrições confirmadas',
      'Presenças',
      'Eventos com presença',
      'Visitas',
      'Minutos',
      'Comparecimento (%)',
      'Certificados',
      'Cartas',
      'XP',
      'Rótulos',
      'Última presença',
    ]);
  });

  it('o cabeçalho do EVENTO tira o que não tem recorte e mantém o resto', () => {
    expect(PARTICIPANT_EVENT_CSV_HEADER).toEqual([
      'Nome',
      'E-mail',
      'Origem',
      'Inscrições confirmadas',
      'Presenças',
      'Visitas',
      'Minutos',
      'Comparecimento (%)',
      'Certificados',
      'Cartas',
      'XP',
      'Última presença',
    ]);

    /**
     * As três colunas que SAEM: "Eventos" e "Eventos com presença" valeriam 1 para
     * todo mundo no recorte, e "Rótulos" é classificação da PESSOA (recalculá-la do
     * evento chamaria de novo quem participa há anos).
     */
    for (const proibida of ['Eventos', 'Eventos com presença', 'Rótulos']) {
      expect(PARTICIPANT_EVENT_CSV_HEADER, `"${proibida}" não deveria estar no CSV do evento`).not.toContain(
        proibida,
      );
    }

    /** A marca d'água continua sendo a ÚLTIMA coluna, acrescentada depois (F49). */
    expect(PARTICIPANT_EVENT_CSV_HEADER.at(-1)).toBe('Última presença');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o novo tipo de exportação', () => {
  it('existe, e todo tipo tem rótulo, nome de arquivo e rótulo de ação', () => {
    expect(EXPORT_KINDS).toContain('ATTENDANCES_CSV');
    expect(EXPORT_KIND_LABELS.ATTENDANCES_CSV).toBe('Presenças por atividade');
    expect(EXPORT_KIND_FILE_SLUG.ATTENDANCES_CSV).toBe('presencas');

    /** Catraca: um tipo novo sem os três textos sai com `undefined` na tela. */
    for (const kind of EXPORT_KINDS) {
      expect(EXPORT_KIND_LABELS[kind]?.length ?? 0).toBeGreaterThan(0);
      expect(EXPORT_KIND_FILE_SLUG[kind]?.length ?? 0).toBeGreaterThan(0);
      expect(EXPORT_KIND_ACTION_LABELS[kind]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('os três nomes de arquivo são diferentes (o arquivo não se confunde)', () => {
    const slugs = EXPORT_KINDS.map((kind) => EXPORT_KIND_FILE_SLUG[kind]);

    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o painel não existe sem `participant:read` no TENANT', () => {
  const render = (quem: Principal): string =>
    renderToStaticMarkup(
      createElement(EventExportPanel, {
        tenantSlug: 'ufba-demo',
        eventId: EVENT_ID,
        principal: quem,
      }),
    );

  it('sem a permissão, o painel NÃO rende NADA (nem botão, nem aviso)', () => {
    expect(render(principal({ role: 'REVIEWER', scope: 'TENANT' }))).toBe('');
    expect(canExportEventData(principal({ role: 'REVIEWER', scope: 'TENANT' }))).toBe(false);
  });

  it('permissão só por EVENTO não abre a exportação — a action exige TENANT', () => {
    const soNoEvento = principal({ role: 'ORGANIZER', scope: 'EVENT', eventId: EVENT_ID });

    expect(canExportEventData(soNoEvento)).toBe(false);
    expect(render(soNoEvento)).toBe('');
  });

  it('sem principal (sessão de outro caminho) também não rende', () => {
    expect(canExportEventData(null)).toBe(false);
    expect(canExportEventData(undefined)).toBe(false);
  });

  it('com a permissão, o painel rende os DOIS tipos e o aviso de prazo', () => {
    const html = render(principal({ role: 'ORGANIZER', scope: 'TENANT' }));

    expect(html).toContain('Inscritos no evento');
    expect(html).toContain('Presenças por atividade');
    expect(html).toContain('24 horas');
    expect(html).toContain('event-export-create-participantes');
    expect(html).toContain('event-export-create-presencas');
    /**
     * O tipo vai no PRÓPRIO botão (`name="kind"`), e não num campo escondido: com
     * dois botões, um `hidden` de tipo seria enviado junto e o POST diria sempre o
     * mesmo tipo.
     */
    expect(html).not.toContain('type="hidden" name="kind"');
    expect(html).toContain('value="PARTICIPANTS_CSV"');
    expect(html).toContain('value="ATTENDANCES_CSV"');
    expect(html.match(/name="kind"/g) ?? []).toHaveLength(2);
    /** O recorte do evento vai junto: é ele que o pedido grava. */
    expect(html).toContain(`name="evento" value="${EVENT_ID}"`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a raiz do evento não ganha a 6ª seção e o mapa não se move', () => {
  const pagina = semComentarios(readFileSync(PAGINA_DO_EVENTO, 'utf8'));
  const painel = semComentarios(readFileSync(PAINEL_DO_EVENTO, 'utf8'));

  it('o mapa continua com 17 cartões e o grupo "Operar" com 4', () => {
    expect(EVENT_AREAS).toHaveLength(17);
    expect(groupEventAreas(EVENT_AREAS).find((grupo) => grupo.group === 'OPERAR')?.areas).toHaveLength(4);
  });

  it('a página tem DUAS declarações de `<section>`: prontidão + o molde de UM grupo', () => {
    /**
     * A raiz tem cinco seções no DOM porque o molde é usado quatro vezes (um grupo
     * cada) e a prontidão é a primeira. Uma `<section>` a mais no arquivo seria a
     * sexta — e o teste do E2E da última fatia conta o DOM.
     */
    expect((pagina.match(/<section/g) ?? []).length).toBe(2);
  });

  it('o painel entra em "Operar" e DEPOIS dos cartões — a posição do mapa não muda', () => {
    expect(pagina).toContain("grupo.group === 'OPERAR' ? painelDeExportacao : undefined");

    /** `{extra}` vem depois do `</ul>` dos cartões: os 17 cartões ficam onde estão. */
    const fimDosCartoes = pagina.indexOf('</ul>');
    const posicaoDoExtra = pagina.indexOf('{extra}');

    expect(fimDosCartoes).toBeGreaterThan(0);
    expect(posicaoDoExtra).toBeGreaterThan(fimDosCartoes);
  });

  it('o painel é renderizado como `div` e não como uma seção nova', () => {
    expect(painel).toContain('surface="div"');
    /** A página NÃO monta o `<ExportPanel>` por conta própria: o gate está no componente. */
    expect(pagina).not.toContain('<ExportPanel');
    expect(pagina).toContain('<EventExportPanel');
    /** E o componente decide antes de renderizar — o gate é a primeira linha do corpo. */
    expect(painel).toContain('if (!canExportEventData(principal)) return null;');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('presenças em formato longo', () => {
  const entrada = new Date('2026-09-02T22:30:00Z'); // 19:30 em Salvador
  const saida = new Date('2026-09-02T23:30:00Z');

  it('a SESSÃO é a unidade: a mesma pessoa em duas atividades gera duas linhas', () => {
    const primeira = attendanceExportRow({
      activityTitle: 'Minicurso de Banco de Dados',
      personName: 'Ana Souza',
      checkedInAt: entrada,
      checkedOutAt: saida,
      minutes: 60,
      timezone: 'America/Bahia',
    });

    const segunda = attendanceExportRow({
      activityTitle: 'Mesa de abertura',
      personName: 'Ana Souza',
      checkedInAt: entrada,
      checkedOutAt: saida,
      minutes: 45,
      timezone: 'America/Bahia',
    });

    expect(ATTENDANCE_CSV_HEADER).toEqual(['Atividade', 'Pessoa', 'Entrada', 'Saída', 'Minutos']);
    expect(primeira).toHaveLength(ATTENDANCE_CSV_HEADER.length);
    expect(segunda).toHaveLength(ATTENDANCE_CSV_HEADER.length);

    /** Duas linhas da MESMA pessoa, com atividades e minutos diferentes. */
    expect(primeira[1]).toBe('Ana Souza');
    expect(segunda[1]).toBe('Ana Souza');
    expect(primeira[0]).not.toBe(segunda[0]);
    expect(primeira[4]).toBe(60);
    expect(segunda[4]).toBe(45);
  });

  it('o horário sai no fuso do EVENTO, com entrada e saída', () => {
    const linha = attendanceExportRow({
      activityTitle: 'Minicurso',
      personName: 'Ana Souza',
      checkedInAt: entrada,
      checkedOutAt: saida,
      minutes: 60,
      timezone: 'America/Bahia',
    });

    expect(linha[2]).toBe('02/09/2026 19:30');
    expect(linha[3]).toBe('02/09/2026 20:30');
  });

  it('chegada ao evento (sem atividade) aparece e DIZ que não tem atividade', () => {
    const linha = attendanceExportRow({
      activityTitle: null,
      personName: 'Bruno Lima',
      checkedInAt: entrada,
      checkedOutAt: null,
      minutes: null,
      timezone: 'America/Bahia',
    });

    expect(linha[0]).toBe(ATTENDANCE_NO_ACTIVITY_LABEL);
    /** Sessão aberta não inventa horário de saída… */
    expect(linha[3]).toBe(ATTENDANCE_OPEN_SESSION_LABEL);
    /** …nem transforma "não apurado" em zero minuto. */
    expect(linha[4]).toBeNull();
  });

  it('o teto de 5.000 linhas decide o `truncated`', () => {
    expect(resolveAttendanceExportSize(0)).toEqual({ rowCount: 0, truncated: false });
    expect(resolveAttendanceExportSize(1)).toEqual({ rowCount: 1, truncated: false });
    expect(resolveAttendanceExportSize(CSV_MAX_ROWS)).toEqual({
      rowCount: CSV_MAX_ROWS,
      truncated: false,
    });
    expect(resolveAttendanceExportSize(CSV_MAX_ROWS + 1)).toEqual({
      rowCount: CSV_MAX_ROWS,
      truncated: true,
    });
    expect(CSV_MAX_ROWS).toBe(5_000);
  });
});
