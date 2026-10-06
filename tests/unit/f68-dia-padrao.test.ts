/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES UNITÁRIOS — O PADRÃO DE UM DIA DO FORMULÁRIO DE EVENTO (FASE 68 · fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTES CASOS PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formulário de criação nascia com o término em `início + 3 dias` e com a HORA do
 *  início vinda do relógio de render — o print do humano mostrou "12:27", que é o
 *  minuto em que a página foi montada. O efeito não era cosmético: todo evento criado
 *  por descuido anunciava três dias na página pública e na descrição de
 *  compartilhamento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTES CASOS SÃO ESCRITOS EM HORA LOCAL, E NÃO EM UTC
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As asserções usam `getHours()`/`getDate()` de propósito. O valor que a função
 *  produz vai para um `<input type="datetime-local">`, que é lido no relógio LOCAL de
 *  quem usa a tela — converter a expectativa para UTC faria o teste medir outra coisa
 *  e passar com o defeito de volta. O caso funciona em qualquer máquina que rode a
 *  suíte, exatamente como funciona para quem cria um evento.
 *
 *  A única asserção que depende de fuso é a da HORA (09 e 18). Em fusos com
 *  deslocamento de meia hora (Índia, +05:30) a hora local é 09:00 igualmente, porque
 *  `setHours` escreve no relógio local — a hora pretendida é preservada; o que muda é
 *  o INSTANTE, que é justamente o que o formulário de um evento NOVO não tem como
 *  saber melhor (não existe `Event.timezone` ainda).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from 'vitest';

import {
  DIAS_ATE_O_EVENTO_PADRAO,
  HORA_PADRAO_DE_INICIO,
  HORA_PADRAO_DE_TERMINO,
  defaultEventPeriod,
  onlineRoomFieldVisibility,
} from '../../src/domain/events/event-form-defaults';
import { toLocalInput } from '../../src/lib/events/activity-presentation';

/** O dia local de uma data, como número (1..31). */
function diaLocal(date: Date): number {
  return date.getDate();
}

describe('defaultEventPeriod()', () => {
  it('nasce com UM dia: 09:00 → 18:00 no mesmo dia', () => {
    const agora = new Date('2026-11-05T12:27:43.812');
    const { startsAt, endsAt } = defaultEventPeriod(agora);

    expect(startsAt.getHours()).toBe(HORA_PADRAO_DE_INICIO);
    expect(endsAt.getHours()).toBe(HORA_PADRAO_DE_TERMINO);

    /** O MESMO dia — era "início + 3 dias", e o rótulo dizia "05/11 a 08/11". */
    expect(diaLocal(endsAt)).toBe(diaLocal(startsAt));
    expect(endsAt.getMonth()).toBe(startsAt.getMonth());
    expect(endsAt.getFullYear()).toBe(startsAt.getFullYear());
  });

  it('não herda o minuto do render — nem no início, nem no término', () => {
    /**
     * Duas chamadas com o MESMO dia e minutos DIFERENTES: o padrão não pode variar.
     * Era exatamente isto que o print do humano denunciava ("12:27").
     */
    const cedo = defaultEventPeriod(new Date('2026-11-05T08:07:11.000'));
    const tarde = defaultEventPeriod(new Date('2026-11-05T23:59:59.999'));

    for (const periodo of [cedo, tarde]) {
      expect(periodo.startsAt.getMinutes()).toBe(0);
      expect(periodo.startsAt.getSeconds()).toBe(0);
      expect(periodo.startsAt.getMilliseconds()).toBe(0);
      expect(periodo.endsAt.getMinutes()).toBe(0);
      expect(periodo.endsAt.getSeconds()).toBe(0);
      expect(periodo.endsAt.getMilliseconds()).toBe(0);
    }

    /** E as duas chamadas produzem o MESMO par — só o dia muda com o dia. */
    expect(cedo.startsAt.getTime()).toBe(tarde.startsAt.getTime());
    expect(cedo.endsAt.getTime()).toBe(tarde.endsAt.getTime());
  });

  it('o DIA sugerido continua vindo do relógio: trinta dias à frente', () => {
    const agora = new Date('2026-11-05T12:27:43.812');
    const { startsAt } = defaultEventPeriod(agora);

    const esperado = new Date(agora.getTime() + DIAS_ATE_O_EVENTO_PADRAO * 86_400_000);

    expect(startsAt.getFullYear()).toBe(esperado.getFullYear());
    expect(startsAt.getMonth()).toBe(esperado.getMonth());
    expect(startsAt.getDate()).toBe(esperado.getDate());
  });

  it('os dois extremos são o que o `datetime-local` mostra: 09:00 e 18:00', () => {
    const { startsAt, endsAt } = defaultEventPeriod(new Date('2026-11-05T12:27:43.812'));

    /**
     * O valor REAL que o organizador vê no campo é o do `toLocalInput` — e é ele que
     * a Server Action relê ao salvar. Prender a função pura sem prender a conversão
     * deixaria a ponta solta: um `toLocalInput` que devolvesse "T12:27" reintroduziria
     * o defeito sem tocar em `defaultEventPeriod`.
     */
    expect(toLocalInput(startsAt).endsWith('T09:00')).toBe(true);
    expect(toLocalInput(endsAt).endsWith('T18:00')).toBe(true);

    /** O MESMO dia nos dois campos, e o término é o MAIOR (a leitura de `saveEvent`). */
    expect(toLocalInput(startsAt).slice(0, 10)).toBe(toLocalInput(endsAt).slice(0, 10));
    expect(endsAt.getTime()).toBeGreaterThan(startsAt.getTime());
  });

  it('um evento de 09:00 a 18:00 no mesmo dia PASSA na validação — é o caso real', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  A AFIRMAÇÃO QUE IMPORTA
     * ─────────────────────────────────────────────────────────────────────────────
     *  `saveEvent` recusa `endsAt <= startsAt` com `INVALID_INPUT`
     *  (`src/lib/admin/catalog-service.ts:168-174`). O padrão novo SÓ serve se passar
     *  ali — um "mesmo dia" mal construído (os dois extremos no mesmo instante) daria
     *  ao organizador um formulário que recusa o que ele mesmo sugeriu.
     *
     *  A comparação é feita AQUI, sobre o mesmo predicado do serviço, porque a versão
     *  de INTEGRAÇÃO (que grava pelo `saveEvent` de verdade, contra o banco) vive em
     *  `tests/integration/f68-dia-padrao.test.ts`. As duas metades são necessárias: uma
     *  prende a régua sem infraestrutura, a outra prende que o serviço concorda.
     */
    const { startsAt, endsAt } = defaultEventPeriod(new Date('2026-11-05T12:27:43.812'));

    expect(endsAt.getTime() > startsAt.getTime()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  QUANDO O CAMPO DO ENDEREÇO DA SALA ONLINE APARECE (FASE 68 · ajuste do humano)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Dois cuidados do pedido, e cada um vira um caso:
 *
 *   1. **esconder o campo não pode esconder o DADO** — com a modalidade trocada para
 *      Presencial, o campo continua desenhado enquanto houver endereço gravado, COM a
 *      frase que explica por que ele está ali;
 *   2. **a decisão é do SERVIDOR** — a função não tem estado, não olha o navegador e
 *      devolve `show: false`, que faz a marcação simplesmente não existir. Não há
 *      `hidden`, não há CSS: é por isso que o formulário funciona igual sem
 *      JavaScript.
 *
 *  A modalidade do EVENTO e a da ATIVIDADE usam a MESMA função: a régua é uma só, e
 *  é a atividade que diz se a atividade tem sala online (um evento híbrido pode ter
 *  uma oficina presencial — o caso é o terceiro bloco abaixo).
 */
describe('onlineRoomFieldVisibility()', () => {
  it('mostra o campo em evento ONLINE e em evento HÍBRIDO', () => {
    for (const modality of ['ONLINE', 'HYBRID'] as const) {
      const resultado = onlineRoomFieldVisibility({ modality });

      expect(resultado.show).toBe(true);
      expect(resultado.reason).toBe('MODALITY');
      /** Sem endereço gravado não há o que explicar: a frase fica de fora. */
      expect(resultado.notice).toBeNull();
    }
  });

  it('esconde o campo em evento PRESENCIAL sem endereço gravado', () => {
    const resultado = onlineRoomFieldVisibility({ modality: 'IN_PERSON', existingUrl: null });

    expect(resultado.show).toBe(false);
    expect(resultado.reason).toBeNull();
    expect(resultado.notice).toBeNull();
  });

  it('um valor de modalidade desconhecido NÃO mostra o campo', () => {
    /**
     * A projeção do painel entrega `modality` como `string` (o valor vem do banco).
     * Um valor que este código não conhece cai na leitura conservadora: não convidar
     * a preencher o que não vale.
     */
    const resultado = onlineRoomFieldVisibility({ modality: 'TELEPATIA' });

    expect(resultado.show).toBe(false);
  });

  it('o endereço GRAVADO mantém o campo na tela, com a frase que explica a presença', () => {
    const resultado = onlineRoomFieldVisibility({
      modality: 'IN_PERSON',
      existingUrl: 'https://sala.exemplo.test/antiga',
    });

    expect(resultado.show).toBe(true);
    expect(resultado.reason).toBe('SAVED');

    /** A frase diz as DUAS coisas: por que está ali e que o valor continua valendo. */
    expect(resultado.notice).toContain('continua gravado');
    expect(resultado.notice).toContain('limpe o campo');
  });

  it('espaços em branco não são endereço gravado', () => {
    /** `'   '` não é valor: o campo não aparece só porque alguém digitou um espaço. */
    const resultado = onlineRoomFieldVisibility({ modality: 'IN_PERSON', existingUrl: '   ' });

    expect(resultado.show).toBe(false);
  });

  it('a dica pode ser trocada por quem tem a frase da ATIVIDADE', () => {
    /**
     * O evento fala de inscrição no evento; a atividade, de quem tem lugar NAQUELA
     * atividade. Uma frase só para os dois mentiria num dos dois — e as duas já
     * existiam na tela.
     */
    const doEvento = onlineRoomFieldVisibility({ modality: 'ONLINE' });
    const daAtividade = onlineRoomFieldVisibility({
      modality: 'ONLINE',
      hint: 'Só http:// ou https://. Mostrado apenas a quem tem lugar nesta atividade (ou à equipe).',
    });

    expect(doEvento.hint).toContain('inscrição');
    expect(daAtividade.hint).toContain('nesta atividade');
    expect(doEvento.hint).not.toBe(daAtividade.hint);
  });

  it('a modalidade da ATIVIDADE decide, e não a do evento (evento híbrido, oficina presencial)', () => {
    /**
     * O caso que o humano citou: um evento HÍBRIDO pode ter uma oficina PRESENCIAL, e
     * é a oficina que decide. Se a função olhasse a modalidade do evento, a oficina
     * presencial ganharia um campo de sala online que não faz sentido — e o inverso
     * (atividade online num evento presencial) ficaria sem o campo que ela precisa.
     */
    const oficinaPresencial = onlineRoomFieldVisibility({ modality: 'IN_PERSON' });
    const oficinaOnline = onlineRoomFieldVisibility({ modality: 'ONLINE' });

    expect(oficinaPresencial.show).toBe(false);
    expect(oficinaOnline.show).toBe(true);
  });
});
