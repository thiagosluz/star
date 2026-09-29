/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Testes unitários — marca d'água da exportação e trilha de identidade (FASE 49)
 *
 *  Duas famílias de regra que o produto usa em produção e que não podem depender
 *  de olhar a planilha nem de ler o banco:
 *   • o ARQUIVO que sai da plataforma (procedência, marca por linha, prazo);
 *   • o que a trilha de segurança pode e não pode gravar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { IDENTITY_ONLY_TABLES, PLATFORM_ONLY_TABLES } from '../../src/lib/db/schema-contract';

import {
  EXPORT_KIND_LABELS,
  EXPORT_TTL_HOURS,
  EXPORT_WATERMARK_COLUMN,
  buildWatermarkedCsv,
  exportExpiresAt,
  exportFileName,
  exportFiltersLine,
  formatExportMoment,
  isExportExpired,
  shortExportId,
  watermarkHeaderLines,
  watermarkRowValue,
  type ExportWatermark,
} from '../../src/domain/exports/export-rules';
import {
  IDENTITY_AUDIT_EVENTS,
  IDENTITY_AUDIT_EVENT_LABELS,
  IDENTITY_AUDIT_EVENT_TONES,
  identityAuditLabel,
  identityAuditTone,
  identityChange,
  isIdentityAuditEvent,
  sanitizeIdentityDetails,
} from '../../src/domain/identity/identity-audit-rules';

const WATERMARK: ExportWatermark = {
  kind: 'PARTICIPANTS_CSV',
  tenantName: 'Universidade Federal da Bahia',
  authorName: 'Ana Souza',
  authorEmail: 'ana@ufba.br',
  generatedAt: new Date('2026-09-28T17:32:00Z'), // 14:32 em Salvador
  expiresAt: new Date('2026-09-29T17:32:00Z'),
  timezone: 'America/Bahia',
  filtersLabel: 'Busca: silva · Só com certificado',
  exportId: '7f3c1a2b-9d4e-4f5a-8b6c-1d2e3f4a5b6c',
};

// ═══════════════════════════════════════════════════════════════════════════════
describe('prazo da exportação', () => {
  it('vale 24 horas a partir da geração', () => {
    const from = new Date('2026-09-28T17:32:00Z');
    const expires = exportExpiresAt(from);

    expect(expires.getTime() - from.getTime()).toBe(EXPORT_TTL_HOURS * 3_600_000);
    expect(EXPORT_TTL_HOURS).toBe(24);
  });

  it('o instante do prazo JÁ está vencido (vencido é vencido)', () => {
    const expiresAt = new Date('2026-09-29T17:32:00Z');

    expect(isExportExpired({ expiresAt, now: new Date('2026-09-29T17:31:59Z') })).toBe(false);
    expect(isExportExpired({ expiresAt, now: expiresAt })).toBe(true);
    expect(isExportExpired({ expiresAt, now: new Date('2026-09-30T00:00:00Z') })).toBe(true);
  });

  it('a hora é lida no fuso da INSTITUIÇÃO, não no do servidor', () => {
    // 17:32 UTC = 14:32 em Salvador (UTC-3).
    expect(formatExportMoment(WATERMARK.generatedAt, 'America/Bahia')).toBe('28/09/2026 14:32');
    expect(formatExportMoment(WATERMARK.generatedAt, 'UTC')).toBe('28/09/2026 17:32');
  });

  it('fuso inválido não impede a exportação (cai em UTC)', () => {
    expect(formatExportMoment(WATERMARK.generatedAt, 'Fuso/Inventado')).toBe('28/09/2026 17:32');
  });

  it('o nome do arquivo diz o tipo, a instituição e o dia', () => {
    expect(
      exportFileName({ kind: 'PARTICIPANTS_CSV', tenantSlug: 'ufba', generatedAt: WATERMARK.generatedAt }),
    ).toBe('participantes-ufba-2026-09-28.csv');
    expect(EXPORT_KIND_LABELS.SPONSOR_CONTACTS_CSV).toBe('Contatos de patrocinador');
  });
});

describe('filtros em texto', () => {
  it('junta os filtros preenchidos e ignora os vazios', () => {
    const line = exportFiltersLine([
      { label: 'Busca', value: 'silva' },
      { label: 'Evento', value: '' },
      { label: 'Só com certificado', value: '' },
    ]);

    expect(line).toBe('Busca: silva');
  });

  it('exportação da base inteira não inventa recorte', () => {
    expect(exportFiltersLine([])).toBeNull();
    expect(exportFiltersLine([{ label: 'Busca', value: '   ' }])).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('marca d\'água no arquivo', () => {
  it('o bloco de procedência diz autor, instituição, instante, filtros e validade', () => {
    const lines = watermarkHeaderLines(WATERMARK).join('\n');

    expect(lines).toContain('Exportado por: Ana Souza <ana@ufba.br>');
    expect(lines).toContain('Universidade Federal da Bahia');
    expect(lines).toContain('Gerado em: 28/09/2026 14:32 (America/Bahia)');
    expect(lines).toContain('Válido até: 29/09/2026 14:32');
    expect(lines).toContain('Filtros: Busca: silva · Só com certificado');
    expect(lines).toContain('7f3c1a2b');
  });

  it('sem filtros, a linha de filtros NÃO aparece', () => {
    const lines = watermarkHeaderLines({ ...WATERMARK, filtersLabel: null }).join('\n');
    expect(lines).not.toContain('Filtros:');
  });

  it('a coluna da marca vai no FIM, e TODA linha de dado a carrega', () => {
    const csv = buildWatermarkedCsv({
      header: ['Nome', 'E-mail'],
      rows: [
        ['Maria Silva', 'maria@ufba.br'],
        ['João Souza', 'joao@ufba.br'],
      ],
      watermark: WATERMARK,
    });

    const lines = csv.replace('\uFEFF', '').split('\r\n').filter((line) => line.length > 0);
    const headerLine = lines.find((line) => line.startsWith('Nome;E-mail'));

    expect(headerLine).toBe(`Nome;E-mail;${EXPORT_WATERMARK_COLUMN}`);

    const dataLines = lines.filter(
      (line) => line.startsWith('Maria Silva;') || line.startsWith('João Souza;'),
    );
    expect(dataLines).toHaveLength(2);

    for (const line of dataLines) {
      expect(line).toContain('Ana Souza <ana@ufba.br>');
      expect(line).toContain('válido até 29/09/2026 14:32');
    }
  });

  it('a ordem das colunas do dado é PRESERVADA (importação por posição)', () => {
    const csv = buildWatermarkedCsv({
      header: ['Nome', 'E-mail'],
      rows: [['Maria', 'maria@ufba.br']],
      watermark: WATERMARK,
    });

    const dataLine = csv.split('\r\n').find((line) => line.startsWith('Maria')) ?? '';
    expect(dataLine.split(';').slice(0, 2)).toEqual(['Maria', 'maria@ufba.br']);
  });

  it('o arquivo começa com BOM e termina com o rodapé do identificador', () => {
    const csv = buildWatermarkedCsv({ header: ['Nome'], rows: [['Maria']], watermark: WATERMARK });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.trimEnd().endsWith('7f3c1a2b')).toBe(true);
  });

  it('nome de quem exportou TAMBÉM é texto de fora: fórmula é neutralizada', () => {
    const csv = buildWatermarkedCsv({
      header: ['Nome'],
      rows: [['Maria']],
      watermark: { ...WATERMARK, authorName: '=HYPERLINK("http://mal")' },
    });

    // O apóstrofo é o que impede o Excel de executar a célula da marca.
    expect(csv).toContain(`"'=HYPERLINK(""http://mal"")`);
  });

  it('aspas e ponto e vírgula nos dados não desmontam a coluna', () => {
    const csv = buildWatermarkedCsv({
      header: ['Nome'],
      rows: [['Silva; "Maria"']],
      watermark: WATERMARK,
    });

    expect(csv).toContain('"Silva; ""Maria"""');
  });

  it('o valor da marca traz autor, instante, validade e o identificador curto', () => {
    const value = watermarkRowValue(WATERMARK);

    expect(value).toBe(
      'Ana Souza <ana@ufba.br> · 28/09/2026 14:32 · válido até 29/09/2026 14:32 · 7f3c1a2b',
    );
  });

  it('o identificador curto é estável e legível', () => {
    expect(shortExportId(WATERMARK.exportId)).toBe('7f3c1a2b');
    expect(shortExportId('00000000-0000-0000-0000-000000000000')).toBe('00000000');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('trilha de identidade — catálogo', () => {
  it('todo evento tem rótulo e gravidade', () => {
    for (const event of IDENTITY_AUDIT_EVENTS) {
      expect(IDENTITY_AUDIT_EVENT_LABELS[event], `rótulo de ${event}`).toBeTruthy();
      expect(IDENTITY_AUDIT_EVENT_TONES[event], `gravidade de ${event}`).toBeTruthy();
    }
  });

  it('reconhece só o que está no catálogo', () => {
    expect(isIdentityAuditEvent('PASSWORD_CHANGED')).toBe(true);
    expect(isIdentityAuditEvent('DROP_TABLE')).toBe(false);
    expect(identityAuditLabel('INVENTADO')).toBe('Evento de segurança');
    expect(identityAuditTone('PASSWORD_CHANGED')).toBe('CRITICAL');
    expect(identityAuditTone('INVENTADO')).toBe('WARN');
  });

  it('as duas portas de saída da conta são CRÍTICAS', () => {
    expect(identityAuditTone('PASSWORD_RESET_COMPLETED')).toBe('CRITICAL');
    expect(identityAuditTone('TWO_FACTOR_DISABLED')).toBe('CRITICAL');
    expect(identityAuditTone('EMAIL_CHANGE_REQUESTED')).toBe('CRITICAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('trilha de identidade — o que NUNCA é gravado', () => {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O DEFEITO QUE ESTE TESTE PRENDE (aconteceu na FASE 47)
   * ─────────────────────────────────────────────────────────────────────────────
   *  `docker/postgres/init/00-roles.sql` é REEXECUTADO por `npm run db:rls` — que faz
   *  parte de `db:setup` e de `db:migrate:deploy` — e ele concede CRUD em TODAS as
   *  tabelas antes de revogar as restritas. Uma tabela que esteja em
   *  `PLATFORM_ONLY_TABLES`/`IDENTITY_ONLY_TABLES` e NÃO esteja na lista do REVOKE
   *  volta a ser alcançável pela role de runtime no próximo `db:setup` — foi o que
   *  aconteceu com `two_factor` (a semente TOTP!), provado na FASE 49 rodando
   *  `npm run db:rls` e vendo o contrato reprovar.
   *
   *  Este teste é a catraca: lista nova sem REVOKE quebra aqui, e não em produção.
   */
  it('toda tabela restrita está no REVOKE do provisionamento', () => {
    const sql = readFileSync(
      new URL('../../docker/postgres/init/00-roles.sql', import.meta.url),
      'utf8',
    );

    for (const table of [...PLATFORM_ONLY_TABLES, ...IDENTITY_ONLY_TABLES]) {
      expect(sql, `REVOKE ausente para ${table}`).toContain(`'${table}'`);
    }

    expect(PLATFORM_ONLY_TABLES).toContain('job_runs');
    expect(IDENTITY_ONLY_TABLES).toContain('two_factor');
    expect(IDENTITY_ONLY_TABLES).toContain('identity_audit_logs');
  });
});

describe('trilha de identidade — o que NUNCA é gravado', () => {
  it('senha, token, segredo e códigos saem mesmo aninhados', () => {
    const sanitized = sanitizeIdentityDetails({
      password: 'segredo-do-usuario',
      data: { token: 'abc123', nested: { backupCodes: ['a', 'b'], secret: 'totp' } },
      recoveryCode: 'abcde-fghij',
      keep: 'isto fica',
    }) as Record<string, unknown>;

    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain('segredo-do-usuario');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('abcde-fghij');
    expect(serialized).not.toContain('totp');
    expect(serialized).toContain('[removido]');
    expect(serialized).toContain('isto fica');
  });

  it('campos de estado continuam legíveis (é o que a investigação precisa)', () => {
    const sanitized = sanitizeIdentityDetails({
      twoFactorEnabled: identityChange(false, true),
      sessionsRevoked: 3,
    }) as Record<string, unknown>;

    expect(sanitized.twoFactorEnabled).toEqual({ from: false, to: true });
    expect(sanitized.sessionsRevoked).toBe(3);
  });

  it('texto longo é cortado e lista enorme é limitada', () => {
    const sanitized = sanitizeIdentityDetails({
      note: 'x'.repeat(500),
      list: Array.from({ length: 50 }, (_, index) => index),
    }) as { note: string; list: number[] };

    expect(sanitized.note).toHaveLength(300);
    expect(sanitized.list).toHaveLength(20);
  });

  it('`null` e `undefined` não viram texto', () => {
    expect(sanitizeIdentityDetails(null)).toBeNull();
    expect(sanitizeIdentityDetails(undefined)).toBeNull();
  });
});
