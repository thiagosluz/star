/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FASE 65 · "ACONTECENDO AGORA" — a decisão é do SERVIDOR, à prova de relógio
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Este arquivo prova três coisas, e as três já custaram caro em outras fases:
 *
 *    1. QUEM está em curso é decidido a partir de um INSTANTE INJETADO — nunca de
 *       `Date.now()` dentro da regra. É o que permite afirmar o resultado sem
 *       depender da hora em que a suíte roda (a lição das contagens regressivas);
 *    2. as BORDAS não são reinterpretadas aqui: uma atividade que COMEÇA exatamente
 *       agora está em curso, e uma que TERMINA agora não está. A régua de sobreposição
 *       da agenda (`encostar não é choque`) é a régua dos PARES, não a do "agora" —
 *       misturar as duas faria o cartão dizer "em curso" para algo que acabou;
 *    3. o HORÁRIO que a tela mostra sai no FUSO DO EVENTO, pela função da FASE 24.
 *       O container do E2E e da produção roda em UTC: formatar sem `timeZone` faz uma
 *       atividade das 10:00 em Salvador aparecer como 13:00.
 */
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import {
  buildHappeningNow,
  formatRemainingTime,
  progressPercentOf,
  type NowActivityFact,
} from '@/domain/agenda/now-rules';
import { EVENT_THEME_PALETTE } from '@/domain/events/landing-page';
import { paraRgb, razaoDeContraste } from '@/domain/tenancy/tenant-page-theme-rules';

/** Salvador é UTC-3 o ano inteiro (o horário de verão brasileiro acabou em 2019). */
const FUSO = 'America/Bahia';

/** Instante UTC a partir da hora de PAREDE em Salvador — o inverso do que o teste mede. */
function emSalvador(hora: number, minuto = 0): Date {
  return new Date(Date.UTC(2026, 11, 1, hora + 3, minuto, 0, 0));
}

function atividade(over: Partial<NowActivityFact> & { id: string }): NowActivityFact {
  return {
    title: `Atividade ${over.id}`,
    slug: over.id,
    status: 'SCHEDULED',
    startsAt: emSalvador(10),
    endsAt: emSalvador(11),
    roomName: 'Sala A',
    speakerNames: [],
    ...over,
  };
}

const AGORA = emSalvador(10, 30);

describe('buildHappeningNow — quem está em curso AGORA', () => {
  it('inclui a atividade que contém o instante e ignora a que não contém', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'em-curso', startsAt: emSalvador(10), endsAt: emSalvador(11) }),
        atividade({ id: 'depois', startsAt: emSalvador(11), endsAt: emSalvador(12) }),
        atividade({ id: 'antes', startsAt: emSalvador(9), endsAt: emSalvador(10) }),
      ],
    });

    expect(view.rooms).toHaveLength(1);
    expect(view.rooms[0]!.items.map((item) => item.activityId)).toEqual(['em-curso']);
  });

  it('a BORDA: começar agora é estar em curso; terminar agora NÃO é', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'comeca-agora', startsAt: AGORA, endsAt: emSalvador(12) }),
        atividade({ id: 'termina-agora', startsAt: emSalvador(9), endsAt: AGORA }),
      ],
    });

    const ids = view.rooms.flatMap((room) => room.items.map((item) => item.activityId));

    expect(ids).toContain('comeca-agora');
    expect(ids).not.toContain('termina-agora');
  });

  it('CANCELADA e RASCUNHO não estão acontecendo — nem em curso, nem "a seguir"', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'cancelada', status: 'CANCELED' }),
        atividade({ id: 'rascunho', status: 'DRAFT' }),
        atividade({ id: 'valida' }),
      ],
    });

    const ids = view.rooms.flatMap((room) => room.items.map((item) => item.activityId));

    expect(ids).toEqual(['valida']);
  });

  it('sem nada em curso, a visão é VAZIA (a faixa não aparece na programação)', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: emSalvador(23),
      activities: [atividade({ id: 'manha', startsAt: emSalvador(10), endsAt: emSalvador(11) })],
    });

    expect(view.isEmpty).toBe(true);
    expect(view.rooms).toHaveLength(0);
    expect(view.totalItems).toBe(0);
  });

  it('agrupa por SALA e usa "Sem sala" quando a atividade não tem espaço físico', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'a', roomName: 'Auditório' }),
        atividade({ id: 'b', roomName: 'Sala 2' }),
        atividade({ id: 'c', roomName: null }),
      ],
    });

    expect(view.rooms.map((room) => room.roomName)).toEqual(['Auditório', 'Sala 2', 'Sem sala']);
  });

  it('o horário da sala sai no FUSO DO EVENTO, não no fuso do processo', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [atividade({ id: 'a', startsAt: emSalvador(10), endsAt: emSalvador(11) })],
    });

    const item = view.rooms[0]!.items[0]!;

    expect(item.startsAtLabel).toContain('10:00');
    expect(item.endsAtLabel).toContain('11:00');
  });

  it('conta o tempo restante em TEXTO, e ele nunca é negativo', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [atividade({ id: 'a', startsAt: emSalvador(10), endsAt: emSalvador(11, 20) })],
    });

    const item = view.rooms[0]!.items[0]!;

    expect(item.remainingLabel).toBe('termina em 50 min');
    expect(item.remainingMinutes).toBe(50);
  });

  it('diz o que começa em SEGUIDA na mesma sala — e não inventa quando não há', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'agora', roomName: 'Sala A', startsAt: emSalvador(10), endsAt: emSalvador(11) }),
        atividade({ id: 'proxima', roomName: 'Sala A', startsAt: emSalvador(11), endsAt: emSalvador(12) }),
        atividade({
          id: 'sozinha',
          roomName: 'Sala B',
          startsAt: emSalvador(10),
          endsAt: emSalvador(12),
        }),
      ],
    });

    const salaA = view.rooms.find((room) => room.roomName === 'Sala A')!;
    const salaB = view.rooms.find((room) => room.roomName === 'Sala B')!;

    expect(salaA.nextLabel).toBe('Atividade proxima');
    expect(salaA.nextStartsAtLabel).toContain('11:00');

    /** Na sala em que só há o que já começou, a tela diz isso — não anuncia nada. */
    expect(salaB.nextLabel).toBeNull();
    expect(salaB.nextStartsAtLabel).toBeNull();
  });

  it('a próxima é a mais PRÓXIMA — a ordem da entrada não decide', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'agora', roomName: 'Sala A', startsAt: emSalvador(10), endsAt: emSalvador(11) }),
        atividade({ id: 'mais-tarde', roomName: 'Sala A', startsAt: emSalvador(15), endsAt: emSalvador(16) }),
        atividade({ id: 'logo', roomName: 'Sala A', startsAt: emSalvador(11), endsAt: emSalvador(12) }),
      ],
    });

    expect(view.rooms[0]!.nextLabel).toBe('Atividade logo');
  });

  it('ordena as salas e os itens de forma DETERMINÍSTICA', () => {
    const view = buildHappeningNow({
      timezone: FUSO,
      now: AGORA,
      activities: [
        atividade({ id: 'z', roomName: 'Sala Z', startsAt: emSalvador(9), endsAt: emSalvador(11) }),
        atividade({ id: 'a', roomName: 'Sala A', startsAt: emSalvador(10), endsAt: emSalvador(11) }),
        atividade({ id: 'a2', roomName: 'Sala A', startsAt: emSalvador(10), endsAt: emSalvador(12) }),
      ],
    });

    expect(view.rooms.map((room) => room.roomName)).toEqual(['Sala A', 'Sala Z']);

    /** Mesmo início: o que TERMINA antes vem primeiro (a grade do dia é cronológica). */
    expect(view.rooms[0]!.items.map((item) => item.activityId)).toEqual(['a', 'a2']);
  });

  it('fuso inválido cai em UTC em vez de derrubar a leitura', () => {
    const view = buildHappeningNow({
      timezone: 'America/Bahiaa',
      now: AGORA,
      activities: [atividade({ id: 'a' })],
    });

    expect(view.timezone).toBe('UTC');
  });
});

describe('formatRemainingTime — o tempo restante em português, para o leitor de tela', () => {
  it('usa "faltam" quando ainda não começou e "termina em" quando está em curso', () => {
    expect(formatRemainingTime(15, 'antes')).toBe('faltam 15 min');
    expect(formatRemainingTime(15, 'em-curso')).toBe('termina em 15 min');
  });

  it('a partir de uma hora, sai em horas e minutos', () => {
    expect(formatRemainingTime(80, 'em-curso')).toBe('termina em 1 h 20 min');
    expect(formatRemainingTime(60, 'em-curso')).toBe('termina em 1 h');
  });

  it('menos de um minuto ainda é tempo — "menos de 1 min", nunca "0 min"', () => {
    expect(formatRemainingTime(0, 'em-curso')).toBe('termina em menos de 1 min');
  });
});

describe('progressPercentOf — a barra é DADO, não enfeite', () => {
  it('mede a fração decorrida do intervalo', () => {
    expect(
      progressPercentOf({ startsAt: emSalvador(10), endsAt: emSalvador(11), now: emSalvador(10, 15) }),
    ).toBe(25);
  });

  it('nunca sai de 0–100 (o instante pode cair fora do intervalo por relógio torto)', () => {
    expect(
      progressPercentOf({ startsAt: emSalvador(10), endsAt: emSalvador(11), now: emSalvador(9) }),
    ).toBe(0);
    expect(
      progressPercentOf({ startsAt: emSalvador(10), endsAt: emSalvador(11), now: emSalvador(13) }),
    ).toBe(100);
  });

  it('intervalo de duração ZERO não divide por zero', () => {
    expect(progressPercentOf({ startsAt: AGORA, endsAt: AGORA, now: AGORA })).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  O CONTRASTE DO "ACONTECENDO AGORA" — MEDIDO, NÃO SUPOSTO (FASE 65 · fatia 5)
// ═══════════════════════════════════════════════════════════════════════════════
/**
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE BLOCO EXISTE (ele nasceu de um VERMELHO, não de uma intenção)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A aba "Acontecendo agora" entrou no portão WCAG AA da fatia 5 e o portão REPROVOU
 *  a tela com uma violação e QUATRO nós — os quatro no mesmo caminho:
 *
 *    1. a migalha "← Todos os eventos de …" .......... `opacity-60` sobre a `--ef-background`;
 *    2. o tempo restante do cartão ................... `text-success-strong` sobre o `.ef-card`;
 *    3. e 4. os dois parágrafos do RODAPÉ ............. `opacity-60` sobre a `--ef-background`.
 *
 *  Nenhum dos quatro é um token novo que nasceu torto: os quatro são um papel da
 *  PLATAFORMA pintado sobre uma superfície do ORGANIZADOR. É a mesma armadilha que a
 *  FASE 52 escreveu para o token de aviso ("não existe um tom que sirva às duas
 *  superfícies") e a mesma que a FASE 61 resolveu para o tema do evento — aqui ela
 *  reaparece por outro caminho, e é por isso que a correção não troca um hex por
 *  outro: **dentro do tema, a cor vem do próprio tema**.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE ARQUIVO PASSOU A MEDIR, E COM QUE RÉGUA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A régua é a que já existia: `razaoDeContraste` (domínio, o mesmo par de funções
 *  que a catraca da FASE 64 usa), que lê hexadecimal e `oklch()` — as duas formas que o
 *  schema do tema aceita. O que NÃO existia em catraca nenhuma era a conta do
 *  **`color-mix(in oklab, …)`**, e é ela que decide as duas cores desta tela:
 *
 *    • `.ef-card`  = `color-mix(in oklab, var(--ef-background) 92%, var(--ef-text) 8%)`;
 *    • `.ef-muted` = `color-mix(in oklab, var(--ef-text) 60%, var(--ef-background))`.
 *
 *  Ela mora aqui porque o navegador não está disponível no teste de unidade, e um
 *  número copiado à mão não é catraca: mediria a revisão de quem copiou, não o CSS. A
 *  implementação é a do padrão (sRGB linear → LMS → cubo → oklab, e a volta), e os
 *  três testes de soma abaixo provam que ela reproduz o MOTOR — não a nossa conta: os
 *  valores presos em `MEDIDO_NO_NAVEGADOR` foram lidos do `getComputedStyle` do
 *  Chromium na página real, e a mistura calculada tem de cair neles.
 */
describe('a cor do "acontecendo agora" passa no AA nos dois modos', () => {
  /**
   * O CSS SEM COMENTÁRIOS: o recorte de bloco conta chaves, e os comentários deste
   * projeto citam `:root` e `@media` no TEXTO — procurar seletor dentro de comentário
   * daria o recorte errado (a mesma armadilha documentada no teste da F61).
   */
  const CSS_DO_SISTEMA = readFileSync('src/app/globals.css', 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  /** O CSS do tema do EVENTO — o arquivo que declara o `.ef-card` e o `.ef-muted`. */
  const CSS_DO_EVENTO = readFileSync(
    'src/app/t/[tenantSlug]/(public)/eventos/event-theme.css',
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  /**
   * A landing do evento — onde os dois `opacity-60` viviam antes da correção.
   *
   * O arquivo SEM comentários: os próprios comentários da correção citam
   * `opacity-60` ("no lugar de `opacity-60`"), e procurar a classe no texto cru daria
   * um vermelho que não é o defeito — a mesma armadilha que o recorte de bloco do CSS
   * já documenta acima.
   */
  const LANDING = readFileSync('src/components/events/event-landing.tsx', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /** Recorta um bloco contando chaves — `indexOf('}')` pararia num `color-mix(...)`. */
  function recortarBloco(fonte: string, seletor: string): string {
    const inicio = fonte.indexOf(seletor);
    if (inicio === -1) throw new Error(`bloco não encontrado: ${seletor}`);

    let profundidade = 0;
    let i = fonte.indexOf('{', inicio);

    for (; i < fonte.length; i += 1) {
      if (fonte[i] === '{') profundidade += 1;
      if (fonte[i] === '}') {
        profundidade -= 1;
        if (profundidade === 0) break;
      }
    }

    return fonte.slice(fonte.indexOf('{', inicio) + 1, i);
  }

  /** Os tokens `--ef-*: #hex` de um bloco do `globals.css`, pelo nome. */
  function tons(bloco: string): Map<string, string> {
    const mapa = new Map<string, string>();

    for (const achado of bloco.matchAll(/--(ef-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      if (achado[1] && achado[2]) mapa.set(achado[1], achado[2].toLowerCase());
    }

    return mapa;
  }

  const CLARO = tons(recortarBloco(CSS_DO_SISTEMA, ':root'));
  /** A classe que a fiação grava no `<html>` — o modo escuro EXPLÍCITO. */
  const ESCURO = tons(recortarBloco(CSS_DO_SISTEMA, '\n.dark {'));

  function cor(escala: Map<string, string>, nome: string): string {
    const valor = escala.get(nome);
    if (!valor) throw new Error(`token --${nome} não encontrado no globals.css`);

    return valor;
  }

  // ─── A conta do `color-mix(in oklab, …)` ────────────────────────────────────

  type Rgb = NonNullable<ReturnType<typeof paraRgb>>;

  /** Canal sRGB (0–255) → linear (0–1). É a MESMA função que a razão do WCAG usa. */
  function linearizar(canal: number): number {
    const s = canal / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }

  /** Linear (0–1) → canal sRGB (0–255), a volta da função acima. */
  function codificar(valor: number): number {
    const s = valor <= 0.0031308 ? 12.92 * valor : 1.055 * valor ** (1 / 2.4) - 0.055;

    return Math.max(0, Math.min(255, Math.round(s * 255)));
  }

  /**
   * sRGB → oklab. As matrizes são as do padrão (Björn Ottosson) e são o INVERSO exato
   * das que `oklchParaRgb` usa no domínio — a volta da conversão é reaproveitada de lá
   * (`paraRgb` sabe ler `oklch()`), e é por isso que este arquivo não tem duas
   * implementações da mesma cor.
   */
  function paraOklab(cor_: Rgb): { L: number; a: number; b: number } {
    const r = linearizar(cor_.r);
    const g = linearizar(cor_.g);
    const b = linearizar(cor_.b);

    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    return {
      L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
  }

  /** oklab → sRGB, pelas matrizes inversas (as mesmas de `oklchParaRgb`). */
  function paraSrgb(lab: { L: number; a: number; b: number }): Rgb {
    const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
    const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
    const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;

    return {
      r: codificar(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: codificar(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: codificar(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    };
  }

  /** Uma cor do CSS (hexadecimal ou `oklch()`) em RGB — ou erro, nunca `NaN` calado. */
  function corDoCss(valor: string): Rgb {
    const rgb = paraRgb(valor);

    if (!rgb) throw new Error(`o domínio não sabe ler a cor: ${valor}`);

    return rgb;
  }

  /**
   * `color-mix(in oklab, uma <peso>, outra)` — a conta do NAVEGADOR, presa aqui.
   *
   * A mistura acontece em oklab (é o que o CSS pede), e não em sRGB: misturar em sRGB
   * daria um tom mais escuro no caso do `.ef-muted` (4,43:1 em vez de 5,06:1), que é
   * exatamente a diferença entre o mecanismo antigo e o novo.
   *
   * A mistura sai em DOIS passos porque são duas perguntas diferentes: o `L` do oklab
   * é o que o navegador SERIALIZA (e o que se compara com `MEDIDO_NO_NAVEGADOR`), e o
   * sRGB é o que ele PINTA. Quantizar para 8 bits antes de medir o `L` moveria o número
   * na quarta decimal — pouco, mas o suficiente para o teste medir a nossa conversão em
   * vez da do motor.
   */
  function misturarEmOklab(
    uma: string,
    outra: string,
    pesoDaPrimeira: number,
  ): { L: number; a: number; b: number } {
    const a = paraOklab(corDoCss(uma));
    const b = paraOklab(corDoCss(outra));

    return {
      L: a.L * pesoDaPrimeira + b.L * (1 - pesoDaPrimeira),
      a: a.a * pesoDaPrimeira + b.a * (1 - pesoDaPrimeira),
      b: a.b * pesoDaPrimeira + b.b * (1 - pesoDaPrimeira),
    };
  }

  /** A mistura em sRGB — o que a tela pinta. */
  function misturarOklab(uma: string, outra: string, pesoDaPrimeira: number): Rgb {
    return paraSrgb(misturarEmOklab(uma, outra, pesoDaPrimeira));
  }

  /**
   * A composição do `opacity` — que o navegador faz em sRGB (alfa sobre o fundo), e
   * NÃO em oklab. É o mecanismo ANTIGO do texto secundário, e ele continua medido
   * abaixo para o defeito não voltar em silêncio.
   */
  function misturarSrgb(uma: string, outra: string, pesoDaPrimeira: number): Rgb {
    const a = corDoCss(uma);
    const b = corDoCss(outra);

    return {
      r: a.r * pesoDaPrimeira + b.r * (1 - pesoDaPrimeira),
      g: a.g * pesoDaPrimeira + b.g * (1 - pesoDaPrimeira),
      b: a.b * pesoDaPrimeira + b.b * (1 - pesoDaPrimeira),
    };
  }

  function paraHex(cor_: Rgb): string {
    const canal = (valor: number) =>
      Math.max(0, Math.min(255, Math.round(valor)))
        .toString(16)
        .padStart(2, '0');

    return `#${canal(cor_.r)}${canal(cor_.g)}${canal(cor_.b)}`;
  }

  /** A razão entre dois RGB já resolvidos — a mesma conta de `razaoDeContraste`. */
  function contrasteRgb(uma: Rgb, outra: Rgb): number {
    const razao = razaoDeContraste(paraHex(uma), paraHex(outra));

    if (razao === null) throw new Error('razão indeterminada entre duas cores resolvidas');

    return Math.round(razao * 100) / 100;
  }

  // ─── Os percentuais, LIDOS do CSS (mudar a receita reprova aqui) ─────────────

  /** O peso da tinta no `.ef-muted`, lido da regra de verdade. */
  function pesoDoMuted(): number {
    const regra = recortarBloco(CSS_DO_EVENTO, '\n.ef-muted');
    const achado = /color-mix\(in oklab, var\(--ef-text\)\s+([\d.]+)%,\s*var\(--ef-background\)\)/.exec(
      regra,
    );

    if (!achado?.[1]) throw new Error('o `.ef-muted` não declara a mistura esperada');

    return Number.parseFloat(achado[1]) / 100;
  }

  /** O peso do FUNDO no `.ef-card`, lido da regra de verdade. */
  function pesoDoCartao(): number {
    const regra = recortarBloco(CSS_DO_EVENTO, '\n.ef-card');
    const achado = /background-color:\s*color-mix\(in oklab, var\(--ef-background\)\s+([\d.]+)%,/.exec(
      regra,
    );

    if (!achado?.[1]) throw new Error('o `.ef-card` não declara a mistura esperada');

    return Number.parseFloat(achado[1]) / 100;
  }

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   *  O QUE O NAVEGADOR COMPUTOU — e por que estes valores estão presos
   * ─────────────────────────────────────────────────────────────────────────────
   *  Lidos do `getComputedStyle` do Chromium na página real (`?aba=agora`, tema
   *  PADRÃO claro do evento), em 04/10/2026, com o servidor servindo o código desta
   *  fase:
   *
   *      .ef-muted ....... oklab(0.529122 -0.00011043 -0.0130331)   → #686b73
   *      .ef-card (fundo)  oklab(0.923186  0.0019489  -0.00832323)   → #e4e5eb
   *      [agora-restante]  rgb(24, 28, 36)                          → #181c24  (= --ef-text)
   *
   *  Eles são a PROVA de que a conta acima é a do motor, e não uma fórmula plausível:
   *  o mesmo `L` do oklab e o mesmo hexadecimal. O `L` é medido na MISTURA (antes da
   *  quantização para 8 bits), porque é assim que o navegador guarda e serializa a cor
   *  computada; o hexadecimal é o que ele PINTA — e é ele que as razões do WCAG abaixo
   *  usam, porque é ele que a tela mostra e que o `axe` mede.
   *
   *  A distância entre os dois é de centésimos na razão (5,06 sobre a mistura crua ×
   *  5,08 sobre o pixel; 4,43 × 4,44 no defeito). Ela fica dita de propósito: número de
   *  contraste sem a cor que o produziu não é reproduzível.
   */
  const MEDIDO_NO_NAVEGADOR = {
    mutedClaro: { oklabL: 0.529122, hex: '#686b73' },
    cartaoClaro: { oklabL: 0.923186, hex: '#e4e5eb' },
    tintaClaro: '#181c24',
  } as const;

  // ─── (1) A BARRA DE PROGRESSO ───────────────────────────────────────────────

  it('a barra passa o mínimo de COMPONENTE (3:1) contra o trilho, nos dois modos', () => {
    /**
     * O preenchimento é DADO, não enfeite: a largura diz quanto falta. "Clarear um
     * pouquinho" o token numa revisão visual apagaria a barra no claro sem que ninguém
     * visse num diff — por isso o número está preso, e não só o mínimo.
     */
    expect(
      contrasteRgb(corDoCss(cor(CLARO, 'ef-success-strong')), corDoCss(cor(CLARO, 'ef-surface-high'))),
      'preenchimento claro sobre o trilho claro',
    ).toBeCloseTo(4.49, 2);

    expect(
      contrasteRgb(
        corDoCss(cor(ESCURO, 'ef-success-strong')),
        corDoCss(cor(ESCURO, 'ef-surface-high')),
      ),
      'preenchimento escuro sobre o trilho escuro',
    ).toBeCloseTo(9.12, 2);

    /** E os dois passam o mínimo do AA non-text — é o que o caso afirma de verdade. */
    expect(contrasteRgb(corDoCss(cor(CLARO, 'ef-success-strong')), corDoCss(cor(CLARO, 'ef-surface-high')))).toBeGreaterThanOrEqual(3);
    expect(contrasteRgb(corDoCss(cor(ESCURO, 'ef-success-strong')), corDoCss(cor(ESCURO, 'ef-surface-high')))).toBeGreaterThanOrEqual(3);
  });

  // ─── (2) O TEMPO RESTANTE EM TEXTO ──────────────────────────────────────────

  it('o tempo restante em TEXTO passa o mínimo de texto sobre o cartão do EVENTO', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O PAR ESTAVA MEDINDO OUTRA SUPERFÍCIE — e o portão pegou
     * ─────────────────────────────────────────────────────────────────────────────
     *  Até a varredura da fatia 5 a catraca media `ef-success-strong` sobre
     *  `ef-surface-lowest`: o cartão da PLATAFORMA (`#ffffff`, 5,48:1 no claro e
     *  10,03:1 no escuro). O parágrafo do tempo restante, porém, é desenhado DENTRO do
     *  cartão do EVENTO (`.ef-card`), cujo fundo é a mistura acima — a superfície que o
     *  ORGANIZADOR escolhe. Medido: **4,37:1** no claro e **3,19:1** no escuro. A
     *  catraca passava medindo um cartão que não existia naquela página.
     *
     *  A correção NÃO foi escolher outro tom da plataforma — foi tirar a plataforma do
     *  par: o texto passou a usar a cor do PRÓPRIO tema (`currentColor`), que é o que o
     *  aviso de choque já fazia e o que a régua da FASE 61 manda ("dentro do tema do
     *  evento, quem responde pela paleta é o organizador"). O semáforo de "em curso"
     *  não se perde: ele é o preenchimento da barra e, principalmente, o TEXTO.
     */
    for (const modo of ['light', 'dark'] as const) {
      const tema = EVENT_THEME_PALETTE[modo];
      const cartao = misturarOklab(tema.background, tema.text, pesoDoCartao());

      expect(
        contrasteRgb(corDoCss(tema.text), cartao),
        `o tempo restante (tinta do tema) sobre o .ef-card no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);

      /** E o tom da PLATAFORMA que estava ali REPROVA — o defeito, medido. */
      expect(
        contrasteRgb(corDoCss('#047857'), cartao),
        `o token da plataforma (#047857) sobre o .ef-card no modo ${modo}`,
      ).toBeLessThan(4.5);
    }

    /** Os números do par real, presos — sobre o pixel que a tela pinta. */
    expect(
      contrasteRgb(corDoCss(EVENT_THEME_PALETTE.light.text), misturarOklab(EVENT_THEME_PALETTE.light.background, EVENT_THEME_PALETTE.light.text, pesoDoCartao())),
    ).toBe(13.58);
    expect(
      contrasteRgb(corDoCss(EVENT_THEME_PALETTE.dark.text), misturarOklab(EVENT_THEME_PALETTE.dark.background, EVENT_THEME_PALETTE.dark.text, pesoDoCartao())),
    ).toBe(16.01);
    expect(
      contrasteRgb(corDoCss('#047857'), misturarOklab(EVENT_THEME_PALETTE.light.background, EVENT_THEME_PALETTE.light.text, pesoDoCartao())),
      'o token da plataforma sobre o cartão do evento, no claro',
    ).toBe(4.36);
  });

  // ─── (3) O TEXTO SECUNDÁRIO DO TEMA ─────────────────────────────────────────

  it('o `.ef-muted` passa nos dois modos, e é a mistura que o CSS declara', () => {
    /**
     *  O `opacity-60` que a migalha e o rodapé usavam compõe o texto com o fundo do
     *  ORGANIZADOR; a classe que o substituiu declara a MESMA ideia (o texto puxado na
     *  direção do fundo) com o valor explícito. Medido: **4,43:1** antes, **5,06:1**
     *  depois, no tema padrão claro — e nos 60% que a regra diz, não em "uns 60%".
     */
    const peso = pesoDoMuted();

    for (const modo of ['light', 'dark'] as const) {
      const tema = EVENT_THEME_PALETTE[modo];
      const apagado = misturarOklab(tema.text, tema.background, peso);

      expect(
        contrasteRgb(apagado, corDoCss(tema.background)),
        `o texto secundário do tema sobre a --ef-background no modo ${modo}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(peso, 'o peso declarado no `.ef-muted`').toBe(0.6);

    /** Os dois números presos — a mistura novo e a opacidade que ela substituiu. */
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, peso),
        corDoCss(EVENT_THEME_PALETTE.light.background),
      ),
    ).toBe(5.08);
    expect(
      contrasteRgb(
        misturarOklab(EVENT_THEME_PALETTE.dark.text, EVENT_THEME_PALETTE.dark.background, peso),
        corDoCss(EVENT_THEME_PALETTE.dark.background),
      ),
    ).toBe(5.91);
  });

  it('a OPACIDADE — o mecanismo antigo — reprova no modo claro', () => {
    /**
     *  Este caso é o que impede a "volta ao de antes" de passar despercebida: se
     *  alguém trocar o `ef-muted` por `opacity-60` (o desenho que a página tinha), a
     *  tinta passa a ser esta — e no claro ela NÃO alcança o AA. No escuro ela passava
     *  (6,75:1): o defeito era de UM modo, e é por isso que o par se mede nos dois.
     */
    const claro = misturarSrgb(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, 0.6);
    const escuro = misturarSrgb(EVENT_THEME_PALETTE.dark.text, EVENT_THEME_PALETTE.dark.background, 0.6);

    expect(paraHex(claro)).toBe('#72747c');
    expect(
      contrasteRgb(claro, corDoCss(EVENT_THEME_PALETTE.light.background)),
      'opacity-60 sobre a --ef-background no modo claro',
    ).toBe(4.44);
    expect(
      contrasteRgb(claro, corDoCss(EVENT_THEME_PALETTE.light.background)),
    ).toBeLessThan(4.5);

    expect(
      contrasteRgb(escuro, corDoCss(EVENT_THEME_PALETTE.dark.background)),
      'opacity-60 sobre a --ef-background no modo escuro (passava — o defeito era de um modo só)',
    ).toBe(6.75);
  });

  it('o `ef-muted` é o mecanismo do texto secundário na página do evento', () => {
    /**
     *  A catraca do MECANISMO, e não só a do número: `opacity` num texto sobre o tema
     *  do organizador é uma cor que a catraca não consegue prever (ela depende do fundo
     *  que ele escolher). Quem devolver a migalha ou o rodapé ao `opacity-60` reprova
     *  aqui, com o motivo escrito.
     */
    expect(LANDING, 'a migalha e o rodapé usam a classe do tema').toContain('ef-muted');
    expect(LANDING, 'o texto secundário não volta a ser opacidade').not.toContain('opacity-60');
  });

  it('o semáforo do "em curso" é a BARRA e o TEXTO — o token da plataforma não volta', () => {
    /**
     *  ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTE CASO PRENDE, E POR QUE NÃO BASTA MEDIR O PAR
     * ─────────────────────────────────────────────────────────────────────────────
     *  O par acima prova que `#047857` reprova sobre o cartão do evento. O que ele NÃO
     *  prende é onde a cor mora: alguém poderia "consertar" trocando o token por outro
     *  tom da plataforma (que passasse no tema PADRÃO e reprovasse no tema que o
     *  organizador escolher amanhã). A decisão da fase foi outra — **dentro do tema, a
     *  cor vem do tema** —, e é esta a forma dela:
     *
     *    • o texto do tempo restante NÃO usa cor de token (`text-success-strong` saiu);
     *    • o semáforo continua no PREENCHIMENTO da barra (`--success-strong`), que é
     *      onde ele é dado (a fração decorrida) e onde o mínimo é o de componente.
     */
    const agora = readFileSync('src/components/events/happening-now.tsx', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(agora, 'o tempo restante não usa o token de texto da plataforma').not.toContain(
      'text-success-strong',
    );
    expect(agora, 'o semáforo continua no preenchimento da barra').toContain(
      "backgroundColor: 'var(--success-strong)'",
    );
    expect(agora, 'o parágrafo do tempo restante continua sendo o fato em texto').toContain(
      'data-testid="agora-restante"',
    );
  });

  it('a conta da mistura reproduz o MOTOR — os valores computados pelo navegador', () => {
    /**
     *  Sem este caso, a catraca mediria a nossa própria fórmula. Com ele, a fórmula
     *  responde pelos valores que o Chromium COMPUTOU na página real (ver
     *  `MEDIDO_NO_NAVEGADOR`): o mesmo hexadecimal e o mesmo `L` do oklab.
     */
    const muted = misturarOklab(
      EVENT_THEME_PALETTE.light.text,
      EVENT_THEME_PALETTE.light.background,
      pesoDoMuted(),
    );

    expect(paraHex(muted)).toBe(MEDIDO_NO_NAVEGADOR.mutedClaro.hex);
    expect(
      misturarEmOklab(EVENT_THEME_PALETTE.light.text, EVENT_THEME_PALETTE.light.background, pesoDoMuted()).L,
    ).toBeCloseTo(MEDIDO_NO_NAVEGADOR.mutedClaro.oklabL, 3);

    const cartao = misturarOklab(
      EVENT_THEME_PALETTE.light.background,
      EVENT_THEME_PALETTE.light.text,
      pesoDoCartao(),
    );

    expect(paraHex(cartao)).toBe(MEDIDO_NO_NAVEGADOR.cartaoClaro.hex);
    expect(
      misturarEmOklab(EVENT_THEME_PALETTE.light.background, EVENT_THEME_PALETTE.light.text, pesoDoCartao()).L,
    ).toBeCloseTo(MEDIDO_NO_NAVEGADOR.cartaoClaro.oklabL, 3);

    /** E a tinta do tempo restante é a do tema — a cor que o navegador devolveu. */
    expect(paraHex(corDoCss(EVENT_THEME_PALETTE.light.text))).toBe(MEDIDO_NO_NAVEGADOR.tintaClaro);
  });
});
