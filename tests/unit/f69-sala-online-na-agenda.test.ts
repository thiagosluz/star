/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 69 · A SALA ONLINE NA "MINHA AGENDA" — A PROJEÇÃO E A CATRACA DA TELA
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PRENDE, E O QUE ELE NÃO PRECISA SUBIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A "minha agenda" passou a mostrar o endereço da sala online (FASE 69) reusando a
 *  régua e o serviço da FASE 68. O E2E da fase
 *  (`tests/e2e/f69-sala-online-na-minha-agenda.spec.ts`) prova a pilha inteira — sessão,
 *  banco, `page.content()` nos dois sentidos. O que ele NÃO consegue provar barato é a
 *  REGRA DA PROJEÇÃO isolada: quais fatos, em que combinação, entram no mapa. Aqui isso
 *  custa microssegundos e não precisa de navegador nem de banco.
 *
 *  A segunda metade é a CATRACA DA TELA: o endereço tem de ser desenhado a partir do
 *  que a projeção liberou (`salaDaAtividade` / `salaDoEvento`), e nunca direto do dado
 *  cru. É a diferença entre "hoje ninguém escreveu o `href` errado" e "o `href` errado
 *  reprova o build" — e ela é provada por mutação.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  registrationSeesOnlineRoom,
  seesActivityOnlineRoom,
  seesEventOnlineRoom,
  type OnlineRoomViewer,
} from '@/domain/events/online-room-rules';
import {
  visibleOnlineRoomsByActivity,
  type OnlineRoomActivityFact,
} from '@/lib/events/online-room-service';

// ═══════════════════════════════════════════════════════════════════════════════
//  Os FATOS — montados à mão, como a régua do domínio os recebe
// ═══════════════════════════════════════════════════════════════════════════════
const FECHADA = 'https://sala.exemplo.test/fechada';
const ABERTA = 'https://sala.exemplo.test/aberta';

const ATIVIDADES: OnlineRoomActivityFact[] = [
  { id: 'fechada', requiresRegistration: true, onlineUrl: FECHADA },
  { id: 'aberta', requiresRegistration: false, onlineUrl: ABERTA },
  { id: 'sem-sala', requiresRegistration: true, onlineUrl: null },
];

/** O visitante anônimo: nenhum fato, nenhum lugar. */
const ANONIMO: OnlineRoomViewer = {
  isEventTeam: false,
  eventRegistration: null,
  activityRegistrations: new Map(),
};

function visitante(input: {
  eventRegistration?: OnlineRoomViewer['eventRegistration'];
  atividades?: Record<string, NonNullable<OnlineRoomViewer['eventRegistration']>>;
  isEventTeam?: boolean;
}): OnlineRoomViewer {
  return {
    isEventTeam: input.isEventTeam ?? false,
    eventRegistration: input.eventRegistration ?? null,
    activityRegistrations: new Map(Object.entries(input.atividades ?? {})),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  (1) A PROJEÇÃO — o mapa só tem o que esta pessoa pode ver
// ═══════════════════════════════════════════════════════════════════════════════
describe('a projeção da sala online na agenda', () => {
  it('o anônimo não recebe endereço nenhum, e o mapa sai vazio', () => {
    const mapa = visibleOnlineRoomsByActivity(ANONIMO, ATIVIDADES);

    expect(mapa.size).toBe(0);
    expect(mapa.get('fechada')).toBeUndefined();
    expect(mapa.get('aberta')).toBeUndefined();
  });

  it('a inscrição NA ATIVIDADE abre a sala dela — e só ela', () => {
    const mapa = visibleOnlineRoomsByActivity(
      visitante({ atividades: { fechada: 'CONFIRMED' } }),
      ATIVIDADES,
    );

    expect(mapa.get('fechada')).toBe(FECHADA);
    /** A atividade ABERTA continua fechada para quem não tem inscrição no evento. */
    expect(mapa.has('aberta')).toBe(false);
    /** E a atividade sem endereço gravado não entra no mapa nem para a equipe. */
    expect(mapa.has('sem-sala')).toBe(false);
  });

  it('a atividade ABERTA é liberada pela inscrição no EVENTO — a revisão da FASE 3', () => {
    const mapa = visibleOnlineRoomsByActivity(visitante({ eventRegistration: 'CONFIRMED' }), ATIVIDADES);

    expect(mapa.get('aberta')).toBe(ABERTA);
    /**
     * E a FECHADA continua fora: a inscrição no evento não dá lugar no minicurso que
     * exige inscrição própria. É esta linha que separa "tem lugar no evento" de "tem
     * lugar nesta sala".
     */
    expect(mapa.has('fechada')).toBe(false);
  });

  it('a LISTA DE ESPERA não abre nada — nem a atividade, nem o evento', () => {
    const mapa = visibleOnlineRoomsByActivity(
      visitante({ eventRegistration: 'WAITLISTED', atividades: { fechada: 'WAITLISTED' } }),
      ATIVIDADES,
    );

    expect(mapa.size).toBe(0);
  });

  it('a inscrição que RETÉM vaga (PENDING) abre — a vaga é dela até o prazo', () => {
    const mapa = visibleOnlineRoomsByActivity(
      visitante({ eventRegistration: 'PENDING', atividades: { fechada: 'PENDING' } }),
      ATIVIDADES,
    );

    expect(mapa.get('fechada')).toBe(FECHADA);
    expect(mapa.get('aberta')).toBe(ABERTA);
  });

  it('a EQUIPE abre tudo o que tem endereço, sem inscrição nenhuma', () => {
    const mapa = visibleOnlineRoomsByActivity(visitante({ isEventTeam: true }), ATIVIDADES);

    expect(mapa.get('fechada')).toBe(FECHADA);
    expect(mapa.get('aberta')).toBe(ABERTA);
    expect(mapa.size).toBe(2);
  });

  it('a régua que ele reusa é a MESMA do domínio — o mapa não tem opinião própria', () => {
    /**
     * A prova de que a projeção não inventou uma segunda régua: para cada combinação,
     * o mapa concorda com `seesActivityOnlineRoom`. Se alguém "otimizar" a projeção
     * com um `if` paralelo, esta igualdade quebra.
     */
    const view = visitante({ atividades: { fechada: 'CONFIRMED' } });
    const mapa = visibleOnlineRoomsByActivity(view, ATIVIDADES);

    for (const atividade of ATIVIDADES) {
      expect(mapa.has(atividade.id), `o mapa e a régua discordam em ${atividade.id}`).toBe(
        Boolean(atividade.onlineUrl) &&
          seesActivityOnlineRoom(view, {
            id: atividade.id,
            requiresRegistration: atividade.requiresRegistration,
          }),
      );
    }

    expect(seesEventOnlineRoom(view)).toBe(false);
    expect(registrationSeesOnlineRoom('WAITLISTED')).toBe(false);
    expect(registrationSeesOnlineRoom(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  (2) A CATRACA DA TELA — o `href` sai do que a projeção liberou
// ═══════════════════════════════════════════════════════════════════════════════
/**
 * O arquivo SEM comentário: o próprio docblock da página cita `onlineUrl` e explica por
 * que o dado cru NÃO vai para o JSX — varrer o comentário reprovaria a explicação.
 */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (achado) => achado.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');
}

const PAGINA = semComentarios(
  readFileSync('src/app/t/[tenantSlug]/(app)/minha-agenda/page.tsx', 'utf8'),
);

describe('a catraca da tela "minha agenda"', () => {
  it('a página resolve a visibilidade pelo serviço da FASE 68', () => {
    expect(PAGINA).toContain('visibleOnlineRoomsByActivity');
    expect(PAGINA).toContain('resolveOnlineRoomViewer');
    expect(PAGINA).toContain('seesEventOnlineRoom');
  });

  it('o `href` do endereço sai do valor RESOLVIDO, nunca do dado cru', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTA CATRACA IMPEDE, E POR QUE ELA É DE TEXTO
     * ─────────────────────────────────────────────────────────────────────────────
     *  O erro que ela prende é de uma linha: trocar `href={salaDaAtividade}` por
     *  `href={onlineRoom.onlineUrl}` (o dado cru que o serviço devolve). A tela
     *  continuaria bonita, o teste funcional da própria pessoa passaria — e o endereço
     *  vazaria para quem NÃO tem lugar, que é exatamente o defeito que a FASE 68 fechou
     *  na página do evento. Nenhum teste de comportamento pega isso; a leitura do
     *  arquivo pega.
     */
    expect(PAGINA).toMatch(/href=\{salaDaAtividade\}/);
    expect(PAGINA).toMatch(/href=\{salaDoEvento\}/);

    /** Nenhum `href` montado direto de um campo `onlineUrl` cru. */
    expect(PAGINA).not.toMatch(/href=\{[^}]*onlineUrl/);
  });

  it('o endereço é desenhado em LINKS, e não escondido por CSS', () => {
    /**
     * A invariante da fase: o que não pode ser visto NÃO É ENTREGUE — não há `hidden`,
     * não há `className` com `hidden`/`invisible` sobre o endereço, e não há `display:
     * none`. Esconder por CSS deixaria o endereço no HTML (e no `Ctrl+U`), que é
     * precisamente o vazamento.
     */
    expect(PAGINA).not.toMatch(/hidden[^\n]*onlineUrl/);
    expect(PAGINA).not.toMatch(/minha-agenda-sala-online[^\n]*className="[^"]*hidden/);
    /** E há um `data-testid` para o E2E escopar a prova — os dois, evento e atividade. */
    expect(PAGINA).toContain('minha-agenda-sala-online-evento');
    expect(PAGINA).toContain('minha-agenda-sala-online-');
  });
});
