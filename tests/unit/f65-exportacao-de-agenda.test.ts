/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 65 · fatia 3 — OS CABEÇALHOS E O ENDEREÇO DO ARQUIVO
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  O CONTEÚDO do `.ics` já tem teste próprio desde a fatia 1 (`f65-ics.test.ts`).
 *  Aqui se prova o que a fatia 3 acrescentou e que não aparece em nenhum outro lugar:
 *
 *    1. o TOKEN do endereço é opaco e determinístico — não carrega `userId`, não muda
 *       entre duas chamadas (o endereço publicado tem de continuar valendo) e muda
 *       quando muda a PESSOA ou a INSTITUIÇÃO;
 *    2. o NOME DO ARQUIVO é saneado: o título é do organizador, e uma aspa no meio
 *       dele fecharia o `Content-Disposition` cedo (injeção de cabeçalho por dado);
 *    3. o endereço da GRADE leva token E evento, e o da ATIVIDADE leva só o id público;
 *    4. o item do botão do Google é o PRÓXIMO — e o que já terminou não conta.
 */
import { describe, expect, it } from 'vitest';

import {
  agendaIcsToken,
  agendaIcsUrl,
  activityIcsUrl,
  icsContentDisposition,
  icsFileName,
  nextAgendaItem,
} from '@/lib/events/agenda-export';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PESSOA = '22222222-2222-7222-8222-222222222222';
const OUTRA_PESSOA = '33333333-3333-7333-8333-333333333333';
const EVENTO = '44444444-4444-7444-8444-444444444444';

/**
 * O segredo da suíte. `BETTER_AUTH_SECRET` já existe no ambiente de teste (a assinatura
 * do cookie de contexto depende dele); fixá-lo aqui deixa o token determinístico mesmo
 * que a suíte rode sem o arquivo de ambiente.
 */
function comSegredo<T>(fn: () => T): T {
  const anterior = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = 'segredo-de-teste-da-fase-65-com-tamanho-suficiente';

  try {
    return fn();
  } finally {
    if (anterior === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = anterior;
  }
}

describe('o token do endereço da agenda', () => {
  it('é opaco e determinístico — o mesmo par devolve o mesmo endereço', () => {
    comSegredo(() => {
      const primeiro = agendaIcsToken({ tenantId: TENANT, userId: PESSOA });
      const segundo = agendaIcsToken({ tenantId: TENANT, userId: PESSOA });

      expect(primeiro).toBeTruthy();
      expect(primeiro).toBe(segundo);

      /** 32 bytes em base64url: 43 caracteres, seguros em URL (sem `+`, `/` nem `=`). */
      expect(primeiro).toHaveLength(43);
      expect(primeiro).not.toMatch(/[+/=]/);

      /** E o `userId` NÃO está no token — é isso que "opaco" quer dizer. */
      expect(primeiro).not.toContain(PESSOA);
      expect(primeiro!.toLowerCase()).not.toContain(PESSOA.slice(0, 8));
    });
  });

  it('muda com a PESSOA e com a INSTITUIÇÃO — o endereço de um não abre o do outro', () => {
    comSegredo(() => {
      const daPessoa = agendaIcsToken({ tenantId: TENANT, userId: PESSOA });
      const deOutra = agendaIcsToken({ tenantId: TENANT, userId: OUTRA_PESSOA });
      const deOutraCasa = agendaIcsToken({ tenantId: OUTRA_PESSOA, userId: PESSOA });

      expect(daPessoa).not.toBe(deOutra);
      expect(daPessoa).not.toBe(deOutraCasa);
    });
  });

  it('sem segredo utilizável devolve `null` — a tela então não oferece o download', () => {
    const anterior = process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    try {
      expect(agendaIcsToken({ tenantId: TENANT, userId: PESSOA })).toBeNull();
    } finally {
      if (anterior !== undefined) process.env.BETTER_AUTH_SECRET = anterior;
    }
  });
});

describe('os endereços', () => {
  it('o da GRADE leva token e evento, os dois codificados', () => {
    const url = agendaIcsUrl({ tenantSlug: 'ufba-demo', token: 'a+b/c=', eventId: EVENTO });

    expect(url.startsWith('/api/t/ufba-demo/agenda/ics?')).toBe(true);

    const params = new URLSearchParams(url.split('?')[1]);

    expect(params.get('token')).toBe('a+b/c=');
    expect(params.get('evento')).toBe(EVENTO);
  });

  it('o da ATIVIDADE leva só o id público — nenhum token, nenhum dado de pessoa', () => {
    const url = activityIcsUrl({ tenantSlug: 'ufba-demo', activityId: 'abc-123' });

    expect(url).toBe('/api/t/ufba-demo/agenda/ics?atividade=abc-123');
    expect(url).not.toContain('token');
  });
});

describe('o nome do arquivo e o cabeçalho', () => {
  it('sanea a aspa e o ponto e vírgula do título — injeção de cabeçalho por dado', () => {
    const nome = icsFileName({ base: 'Mesa "final"; aula' });

    expect(nome.ascii).not.toContain('"');
    expect(nome.ascii).not.toContain(';');
    expect(nome.utf8).not.toContain('"');
    expect(nome.utf8.endsWith('.ics')).toBe(true);
  });

  it('mantém o acento no `filename*` e o remove do `filename` antigo', () => {
    const nome = icsFileName({ base: 'Programação do Congresso' });

    expect(nome.utf8).toBe('Programação do Congresso.ics');
    expect(nome.ascii).toBe('Programacao do Congresso.ics');
  });

  it('título que vira vazio cai em "agenda" — nunca um arquivo sem nome', () => {
    expect(icsFileName({ base: '///' }).utf8).toBe('agenda.ics');
  });

  it('o `Content-Disposition` é ATTACHMENT e traz as duas formas do nome (RFC 6266)', () => {
    const header = icsContentDisposition(icsFileName({ base: 'Programação' }));

    expect(header.startsWith('attachment; ')).toBe(true);
    expect(header).toContain('filename="Programacao.ics"');
    expect(header).toContain("filename*=UTF-8''Programa%C3%A7%C3%A3o.ics");
  });
});

describe('nextAgendaItem — o item do botão do Google na grade', () => {
  const agora = new Date('2026-12-01T13:00:00Z');
  const horas = (h: number) => new Date(`2026-12-01T${String(h).padStart(2, '0')}:00:00Z`);

  it('escolhe o primeiro que ainda não terminou — inclusive o que está em curso', () => {
    const itens = [
      { id: 'passado', startsAt: horas(9), endsAt: horas(10) },
      { id: 'em-curso', startsAt: horas(12), endsAt: horas(14) },
      { id: 'depois', startsAt: horas(15), endsAt: horas(16) },
    ];

    expect(nextAgendaItem(itens, agora)?.id).toBe('em-curso');
  });

  it('o que TERMINA agora já não conta — a mesma borda do "acontecendo agora"', () => {
    const itens = [
      { id: 'termina-agora', startsAt: horas(12), endsAt: agora },
      { id: 'depois', startsAt: horas(15), endsAt: horas(16) },
    ];

    expect(nextAgendaItem(itens, agora)?.id).toBe('depois');
  });

  it('grade inteira no passado não tem próximo — e o botão não aparece', () => {
    expect(nextAgendaItem([{ id: 'passado', startsAt: horas(9), endsAt: horas(10) }], agora)).toBeNull();
    expect(nextAgendaItem([], agora)).toBeNull();
  });

  it('a ordem de entrada não decide: a mais PRÓXIMA vence', () => {
    const itens = [
      { id: 'tarde', startsAt: horas(20), endsAt: horas(21) },
      { id: 'logo', startsAt: horas(14), endsAt: horas(15) },
    ];

    expect(nextAgendaItem(itens, agora)?.id).toBe('logo');
  });
});
