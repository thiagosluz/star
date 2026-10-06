/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  TESTES DE UNIDADE — O token do descadastro e os marcadores (FASE 67 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTES TESTES PRENDEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *    • a DERIVAÇÃO: o mesmo par (instituição, pessoa) dá sempre o mesmo token, e
 *      pares diferentes dão tokens diferentes — inclusive "mesma pessoa, outra
 *      instituição" e "mesma instituição, outra pessoa", que são os dois jeitos de
 *      um endereço de descadastro atingir quem não devia;
 *    • o SEGREDO é REQUISITO: sem `BETTER_AUTH_SECRET` (ou com um curto demais) não
 *      há token — e quem chama mostra o rodapé sem link, em vez de publicar um
 *      endereço que qualquer um forja;
 *    • a comparação é em TEMPO CONSTANTE, e o teste diz como isso é verificado:
 *      comparar tempos de execução em teste é medida instável (o relógio da máquina
 *      oscila mais do que a diferença), então o que se prende é o USO da primitiva
 *      (`timingSafeEqual`) e o COMPORTAMENTO da função — iguais, diferentes do mesmo
 *      tamanho, tamanhos diferentes;
 *    • o RODAPÉ carrega o descadastro e o que continua chegando; o teste do template
 *      garante que nenhum OUTRO e-mail ganhou link de saída;
 *    • os MARCADORES: duas pessoas recebem corpos diferentes, marcador desconhecido
 *      sai literal (não vira texto vazio nem quebra o envio) e o valor inserido não
 *      é reprocessado.
 *
 *  Requer: nada além do Node (nenhum banco).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  hashUnsubscribeToken,
  isUnsubscribeTokenShaped,
  sameUnsubscribeToken,
  unsubscribeToken,
} from '../../src/domain/communication/unsubscribe-rules';
import {
  CAMPAIGN_MARKERS,
  CAMPAIGN_MARKER_HINT,
  campaignMarkerToken,
  campaignMarkersIn,
  renderCampaignMarkers,
  unknownCampaignMarkers,
} from '../../src/domain/communication/campaign-markers';
import { renderEmail } from '../../src/domain/communication/email-templates';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PESSOA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PESSOA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SEGREDO_REAL = process.env.BETTER_AUTH_SECRET;

/** Troca o segredo do processo — e devolve o anterior no fim de cada caso. */
function comSegredo(valor: string | undefined): void {
  if (valor === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
    return;
  }

  process.env.BETTER_AUTH_SECRET = valor;
}

afterEach(() => {
  comSegredo(SEGREDO_REAL);
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o token do descadastro é derivado, e não sorteado', () => {
  beforeEach(() => {
    comSegredo('segredo-de-teste-com-mais-de-dezesseis-caracteres');
  });

  it('o mesmo par (instituição, pessoa) dá SEMPRE o mesmo token', () => {
    const primeira = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const segunda = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });

    expect(primeira).not.toBeNull();
    expect(primeira).toBe(segunda);
    /**
     * A estabilidade é o que permite o rodapé existir ANTES de a linha do
     * descadastro nascer: o endereço é o mesmo hoje e no dia em que a pessoa sair.
     */
  });

  it('o token tem a forma que a página aceita — e é seguro em URL', () => {
    const token = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });

    expect(token).not.toBeNull();
    if (!token) return;

    // 32 bytes em base64url são 43 caracteres, sem `+`, `/` nem `=`.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isUnsubscribeTokenShaped(token)).toBe(true);
  });

  it('OUTRA PESSOA da mesma instituição recebe outro token', () => {
    const daPessoaA = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const daPessoaB = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_B });

    expect(daPessoaA).not.toBe(daPessoaB);
  });

  it('A MESMA PESSOA em outra instituição recebe outro token', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE ESTE CASO É O MAIS IMPORTANTE DA DERIVAÇÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Sem o `tenantId` no HMAC, o endereço de descadastro de uma pessoa valeria em
     *  TODAS as instituições de que ela participa — e o slug na URL seria a única
     *  coisa separando as duas. Como o slug é público (ele está na página do evento,
     *  no certificado, em qualquer link compartilhado), isso significaria que sair
     *  da mala direta da casa A tirava a pessoa da casa B, e que quem tivesse o
     *  endereço da casa A podia desinscrevê-la em qualquer outra.
     */
    const naCasaA = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const naCasaB = unsubscribeToken({ tenantId: TENANT_B, userId: PESSOA_A });

    expect(naCasaA).not.toBe(naCasaB);
  });

  it('a CAIXA do uuid não muda o token — o mesmo par escrito das duas formas', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE CASO NASCEU DO PRIMEIRO E2E DA FATIA, E É O DEFEITO MAIS SORRATEIRO DELA
     * ─────────────────────────────────────────────────────────────────────────────
     *  O uuid é o MESMO valor em `A1B2…` e `a1b2…`, e as duas formas chegam a este
     *  arquivo em execuções diferentes (a fixture cria com `randomUUID()` e o `id`
     *  que volta do banco pode vir em maiúsculas, dependendo do caminho). Sem
     *  normalizar, o token do rodapé não resolve de volta: o dono do endereço recebe
     *  404 na própria página de descadastro, e nada no log explica por quê.
     */
    const minusculo = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const maiusculo = unsubscribeToken({
      tenantId: TENANT_A.toUpperCase(),
      userId: PESSOA_A.toUpperCase(),
    });

    expect(minusculo).not.toBeNull();
    expect(maiusculo).toBe(minusculo);
  });

  it('trocar a ORDEM do par muda o token (instituição e pessoa não são intercambiáveis)', () => {    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE ESTE CASO SUBSTITUIU — E A LIÇÃO
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão deste teste tentava provar que o separador `:` impedia
     *  colisão na concatenação, com `tenantId = 'a'` e `userId = 'b:c'` contra
     *  `'a:b'` e `'c'`. **Ele reprovou**, e com razão: os dois concatenam em `a:b:c`,
     *  então o HMAC é o mesmo. A lição é que o `:` NÃO separa nada — o que garante a
     *  unicidade do par é o FORMATO dos dois lados (uuid: só hexadecimal e hífen),
     *  e não o delimitador.
     *
     *  A propriedade que dá para prender de verdade é a que importa: o par é ORDENADO
     *  (instituição primeiro, pessoa depois), então trocar os dois muda o token. Sem
     *  isso, o uuid da pessoa e o da instituição poderiam ser lidos em qualquer
     *  ordem e um endereço acabaria identificando o par errado.
     */
    const normal = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const trocado = unsubscribeToken({ tenantId: PESSOA_A, userId: TENANT_A });

    expect(normal).not.toBe(trocado);
  });

  it('trocar o segredo invalida TODOS os endereços já entregues', () => {
    const antes = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });

    comSegredo('outro-segredo-de-teste-com-tamanho-suficiente');

    const depois = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });

    expect(antes).not.toBe(depois);
  });

  it('o rótulo é PRÓPRIO: o token do descadastro não é o do `.ics` da agenda', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O SEGREDO É O MESMO — O RÓTULO É O QUE SEPARA OS CAMINHOS
     * ─────────────────────────────────────────────────────────────────────────────
     *  `agenda-export.ts` (FASE 65) e este arquivo derivam com `BETTER_AUTH_SECRET`
     *  e HMAC-SHA256. Sem rótulo distinto, o token de um caminho abriria o outro: o
     *  link de descadastro que a pessoa recebe no rodapé daria acesso à agenda dela,
     *  e o endereço da agenda (que ela cola no calendário) desinscreveria.
     *
     *  A prova é direta: os dois são HMAC do MESMO par sob o MESMO segredo, e os
     *  valores são diferentes. O rótulo faz a diferença.
     */
    const segredo = process.env.BETTER_AUTH_SECRET as string;
    const par = `${TENANT_A}:${PESSOA_A}`;

    const doDescadastro = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    const daAgenda = createHmac('sha256', `eventflow:agenda-ics:${segredo}`)
      .update(par, 'utf8')
      .digest('base64url');

    expect(doDescadastro).toBe(
      createHmac('sha256', `eventflow:descadastro:${segredo}`).update(par, 'utf8').digest('base64url'),
    );
    expect(doDescadastro).not.toBe(daAgenda);
  });

  it('SEM segredo utilizável não há token — e a tela tem de mostrar o rodapé sem link', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE O PISO DE TAMANHO EXISTE
     * ─────────────────────────────────────────────────────────────────────────────
     *  Um HMAC com chave de quatro caracteres é adivinhado por força bruta, e a
     *  consequência aqui não é ler um dado: é DESINSCREVER alguém (ou desfazer o
     *  descadastro de quem pediu para sair, que é pior — a pessoa pediu para não
     *  receber e volta a receber por ação de terceiro).
     *
     *  Recusar devolver token é o fail-closed: a mensagem sai sem o link de saída, e
     *  a tela de comunicação diz por quê. O que não pode acontecer é publicar um
     *  endereço que qualquer um forja.
     */
    comSegredo(undefined);
    expect(unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A })).toBeNull();

    comSegredo('curto');
    expect(unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A })).toBeNull();

    comSegredo('');
    expect(unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A })).toBeNull();

    comSegredo('dezesseis-caracter');
    expect(unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A })).not.toBeNull();
  });

  it('sem instituição ou sem pessoa não há token (nada de endereço para o vazio)', () => {
    expect(unsubscribeToken({ tenantId: '', userId: PESSOA_A })).toBeNull();
    expect(unsubscribeToken({ tenantId: TENANT_A, userId: '' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('a comparação do token é em TEMPO CONSTANTE', () => {
  it('usa `timingSafeEqual` — comparar com `===` vazaria o prefixo certo pelo tempo', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE A PROVA É O USO DA PRIMITIVA, E NÃO UM CRONÔMETRO
     * ─────────────────────────────────────────────────────────────────────────────
     *  Medir "quanto tempo levou" num teste é medida instável: o ruído do relógio da
     *  máquina e do coletor de lixo é maior que a diferença entre comparar 1 e 43
     *  caracteres, e o teste passaria ou falharia por sorte — catraca que pisca
     *  ensina a rodar de novo até dar verde.
     *
     *  O que dá para prender de forma determinística é o que importa: a função usa a
     *  comparação de tempo constante do Node, e não `===`. É a mesma escolha (e o
     *  mesmo motivo) do `.ics` da FASE 65 — e o teste lê o código-fonte para provar
     *  que ela continua lá, porque é a linha que alguém "simplifica" numa limpeza.
     */
    const fonte = readFileSync('src/domain/communication/unsubscribe-rules.ts', 'utf8');

    expect(fonte).toContain("from 'node:crypto'");
    expect(fonte).toContain('timingSafeEqual');
    expect(fonte).toMatch(/return timingSafeEqual\(/);
  });

  it('a resposta é a mesma para token igual, diferente do mesmo tamanho e de tamanho torto', () => {
    const token = 'a'.repeat(43);

    expect(sameUnsubscribeToken(token, token)).toBe(true);
    // Um caractere diferente no FIM: um `===` otimizado devolveria cedo, e é
    // exatamente esse "cedo" que revela o prefixo.
    expect(sameUnsubscribeToken(token, `${'a'.repeat(42)}b`)).toBe(false);
    // Um caractere diferente no COMEÇO: a resposta tem de ser idêntica à de cima.
    expect(sameUnsubscribeToken(token, `b${'a'.repeat(42)}`)).toBe(false);
    // Tamanhos diferentes não lançam: `timingSafeEqual` lança com buffers distintos.
    expect(sameUnsubscribeToken(token, 'curto')).toBe(false);
    expect(sameUnsubscribeToken('', token)).toBe(false);
    // Duas vazias são iguais (e é a resposta certa: nada é nada).
    expect(sameUnsubscribeToken('', '')).toBe(true);
  });

  it('o token derivado é comparável com o hash que a LINHA guarda', () => {
    /**
     * A linha em `communication_unsubscribes` guarda o SHA-256 do token do rodapé —
     * e o índice é ÚNICO por pessoa (o par instituição+pessoa é o que a tabela
     * garante). O hash é o que permite ao banco sozinho não virar uma lista de
     * endereços prontos para desfazer descadastros.
     */
    comSegredo('segredo-de-teste-com-mais-de-dezesseis-caracteres');

    const token = unsubscribeToken({ tenantId: TENANT_A, userId: PESSOA_A });
    expect(token).not.toBeNull();
    if (!token) return;

    const hash = hashUnsubscribeToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('os marcadores por destinatário', () => {
  const valores = {
    nome: 'Marta Nogueira',
    instituicao: 'Instituto do Recôncavo',
    evento: 'Congresso de 2027',
  };

  it('o catálogo de marcadores é curto, e cada um tem a sua forma escrita', () => {
    expect([...CAMPAIGN_MARKERS]).toEqual(['nome', 'instituicao', 'evento']);
    expect(campaignMarkerToken('nome')).toBe('{nome}');
    expect(CAMPAIGN_MARKER_HINT).toContain('{nome}');
    expect(CAMPAIGN_MARKER_HINT).toContain('{instituicao}');
    expect(CAMPAIGN_MARKER_HINT).toContain('{evento}');
  });

  it('DUAS PESSOAS recebem corpos DIFERENTES — é o que faz a mala direta', () => {
    const corpo = 'Olá, {nome}! A sua vaga em {evento} está retida. — {instituicao}';

    const paraMarta = renderCampaignMarkers(corpo, valores);
    const paraBeto = renderCampaignMarkers(corpo, { ...valores, nome: 'Beto Alves' });

    expect(paraMarta).toBe(
      'Olá, Marta Nogueira! A sua vaga em Congresso de 2027 está retida. — Instituto do Recôncavo',
    );
    expect(paraBeto).toContain('Olá, Beto Alves!');
    expect(paraMarta).not.toBe(paraBeto);
    // E o resto do texto é o MESMO: o que muda é só o valor do marcador.
    expect(paraMarta.replace('Marta Nogueira', 'X')).toBe(paraBeto.replace('Beto Alves', 'X'));
  });

  it('o mesmo marcador repetido no texto é trocado em TODAS as ocorrências', () => {
    const rendered = renderCampaignMarkers('{nome}, {nome}: confirme até sexta, {nome}.', valores);

    expect(rendered).toBe('Marta Nogueira, Marta Nogueira: confirme até sexta, Marta Nogueira.');
  });

  it('marcador DESCONHECIDO sai literal — não vira texto vazio', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  POR QUE "LITERAL" E NÃO "VAZIO"
     * ─────────────────────────────────────────────────────────────────────────────
     *  Apagar produz um e-mail que PARECE certo e diz menos do que o organizador
     *  escreveu ("nos vemos em ."), e quem recebe não avisa — o erro morre em
     *  silêncio. Literal, ele aparece na mensagem e o organizador descobre a chave
     *  errada no lugar onde pode corrigi-la.
     */
    const rendered = renderCampaignMarkers('Nos vemos em {cidade}, {nome}.', valores);

    expect(rendered).toBe('Nos vemos em {cidade}, Marta Nogueira.');
    expect(rendered).not.toContain('  ,');
  });

  it('a chave usada em código é lida como marcador — e fica LITERAL, sem estragar o texto', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O QUE O TESTE ESPERAVA, E O QUE ACONTECE
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão deste caso afirmava que `{ "a": 1 }` e `${x}` não são
     *  marcadores. **A segunda estava errada**: `${x}` casa o padrão (`{` + letra +
     *  `}`), porque o `$` fica FORA do casamento. O que o produto faz com isso é o
     *  que importa, e é o certo: `x` não é marcador conhecido, então ele sai
     *  LITERAL — o texto do organizador continua exatamente como ele escreveu.
     *
     *  `{ "a": 1 }` não casa (a chave começa com espaço), e o laço `{nome}` continua
     *  sendo trocado normalmente no meio do texto com chaves.
     */
    const corpo = 'A configuração é { "a": 1 } e o laço usa ${x}. Olá, {nome}!';

    expect(renderCampaignMarkers(corpo, valores)).toBe(
      'A configuração é { "a": 1 } e o laço usa ${x}. Olá, Marta Nogueira!',
    );
    expect(campaignMarkersIn(corpo)).toEqual(['nome', 'x']);
    // `x` é lido como chave, mas não é um marcador do produto: sai literal.
    expect(unknownCampaignMarkers(corpo)).toEqual(['x']);
  });

  it('o VALOR inserido não é reprocessado — a substituição é de UMA passada', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  ESTE CASO É O DEFEITO REAL QUE A FASE ENCONTROU
     * ─────────────────────────────────────────────────────────────────────────────
     *  A primeira versão de `renderCampaignMarkers` trocava marcador por marcador,
     *  num laço. Com o valor de `{nome}` igual a `{evento}`, a passada de `{evento}`
     *  vinha DEPOIS e trocava o que tinha acabado de entrar: o texto do organizador
     *  deixava de ser o texto que saiu, e o resultado passava a depender da ordem do
     *  catálogo. Este caso reprovou a versão do laço (`Congresso de 2027 e …` no
     *  lugar de `{evento} e …`) e é o que prende a correção.
     */
    const rendered = renderCampaignMarkers('{nome} e {instituicao}', {
      ...valores,
      nome: '{evento}',
    });

    expect(rendered).toBe('{evento} e Instituto do Recôncavo');
  });

  it('evento nulo (campanha da instituição inteira) mantém o marcador literal', () => {
    const rendered = renderCampaignMarkers('O evento {evento} começou. Olá, {nome}!', {
      ...valores,
      evento: null,
    });

    expect(rendered).toBe('O evento {evento} começou. Olá, Marta Nogueira!');
  });

  it('valor vazio não apaga o marcador: nada foi informado, e isso aparece', () => {
    const rendered = renderCampaignMarkers('{nome}', { ...valores, nome: '' });

    expect(rendered).toBe('{nome}');
  });

  it('a lista de marcadores usados separa os conhecidos dos desconhecidos', () => {
    const corpo = '{nome} {cidade} {evento} {cidade} {CEP}';

    expect(campaignMarkersIn(corpo)).toEqual(['CEP', 'cidade', 'evento', 'nome']);
    expect(unknownCampaignMarkers(corpo)).toEqual(['CEP', 'cidade']);
    expect(unknownCampaignMarkers('{nome} {evento}')).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('o rodapé de descadastro vive na campanha, e só nela', () => {
  const endereco =
    'http://localhost:3000/t/instituto/descadastro/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('a campanha leva o endereço, o que para e o que continua chegando', () => {
    const rendered = renderEmail(
      'CAMPAIGN_MESSAGE',
      {
        recipientName: 'Marta Nogueira',
        tenantName: 'Instituto do Recôncavo',
        subject: 'Sua vaga está retida',
        body: 'Confirme até sexta.',
        eventTitle: 'Congresso de 2027',
        senderName: 'Olga Organizadora',
        unsubscribeUrl: endereco,
      },
      { brandName: 'Instituto do Recôncavo' },
    );

    expect(rendered.html).toContain(endereco);
    expect(rendered.html).toContain('recados em massa');
    expect(rendered.html).toContain('continuam chegando');
    expect(rendered.text).toContain(endereco);
    expect(rendered.text).toContain('continuam chegando');

    /**
     * A LINHA DE ORIGEM APARECE UMA VEZ SÓ. O rodapé do layout e a linha de
     * descadastro são a MESMA frase: desenhar as duas faria o e-mail dizer "você
     * recebe esta mensagem porque participa de…" duas vezes, uma embaixo da outra.
     */
    const ocorrencias = rendered.html.split('porque participa de').length - 1;

    expect(ocorrencias).toBe(1);
  });

  it('sem endereço, o rodapé DIZ que o descadastro está fora — e não mostra botão que não abre', () => {
    const rendered = renderEmail(
      'CAMPAIGN_MESSAGE',
      {
        recipientName: 'Marta Nogueira',
        tenantName: 'Instituto do Recôncavo',
        subject: 'Sua vaga está retida',
        body: 'Confirme até sexta.',
        eventTitle: null,
        senderName: null,
        unsubscribeUrl: null,
      },
      { brandName: 'Instituto do Recôncavo' },
    );

    expect(rendered.html).toContain('descadastro está indisponível');
    expect(rendered.html).not.toContain('/descadastro/');
    expect(rendered.text).not.toContain('/descadastro/');
  });

  it('NENHUM outro template ganhou link de descadastro', () => {
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     *  O DESCADASTRO É DA CAMPANHA, E NÃO DO E-MAIL TRANSACIONAL
     * ─────────────────────────────────────────────────────────────────────────────
     *  "Descadastre-se" num aviso de vaga retida seria um convite a perder a vaga: a
     *  pessoa clicaria no rodapé do e-mail que EXISTE para ela confirmar o prazo. O
     *  transacional é obrigação da instituição, e a saída dele é a conversa — não um
     *  link de um clique.
     *
     *  O teste percorre a fonte e confere que a palavra `unsubscribeUrl` aparece só
     *  no payload da campanha e no caso dela do `switch`.
     */
    const fonte = readFileSync('src/domain/communication/email-templates.ts', 'utf8');
    const usos = fonte.split('unsubscribeUrl').length - 1;

    // Declaração no payload + leitura no caso da campanha (duas vezes) + comentário.
    expect(usos).toBeLessThanOrEqual(6);
    expect(fonte).toContain("case 'CAMPAIGN_MESSAGE':");

    // A prova comportamental: um template transacional renderizado não traz o
    // caminho de descadastro em lugar nenhum.
    const vaga = renderEmail(
      'REGISTRATION_PENDING',
      {
        recipientName: 'Marta Nogueira',
        eventTitle: 'Congresso de 2027',
        activityTitle: 'Oficina de Robótica',
        deadlineLabel: '20/03/2027, 23:59',
        requirements: ['1 kg de alimento'],
        place: 'Secretaria',
        instructions: null,
        registrationsUrl: 'http://localhost:3000/t/instituto/minhas-inscricoes',
      },
      { brandName: 'Instituto do Recôncavo' },
    );

    expect(vaga.html).not.toContain('/descadastro/');
    expect(vaga.text).not.toContain('recados em massa');
  });
});
