/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — Descadastro: token e estado vigente (FASE 67 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN É GUARDADO COMO HASH, E O ENDEREÇO É MOSTRADO UMA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Mesma decisão do convite de equipe (FASE 15): o banco guarda o SHA-256 e o
 *  token em claro só existe no caminho de quem acabou de sair. Um despejo do
 *  banco não vira uma lista de endereços prontos para desfazer descadastros — e
 *  desfazer o descadastro de alguém é enviar mensagem a quem pediu para não
 *  receber, que é o defeito que esta fase existe para impedir.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "ESTÁ FORA" É UM FATO COM DATA, E NÃO UM BOOLEANO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A linha nasce quando a pessoa sai e `resubscribedAt` marca a volta. O estado
 *  vigente é DERIVADO (`unsubscribedAt` preenchido E `resubscribedAt` vazio) e não
 *  uma coluna `isOut`: com a coluna, a história de "saiu, voltou, saiu de novo"
 *  seria reescrita a cada transição — e a pergunta "esta pessoa já pediu para
 *  sair alguma vez?" perderia a resposta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O LINK DO RODAPÉ NÃO PODE NASCER DE UMA LINHA QUE AINDA NÃO EXISTE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Todo e-mail de campanha leva o endereço de descadastro — e o e-mail é montado
 *  ANTES de a pessoa sair. Se o token do rodapé fosse o valor aleatório gravado em
 *  `communication_unsubscribes` no momento da saída, não haveria o que colocar no
 *  rodapé: a linha ainda não existe. As saídas ruins dessa armadilha são conhecidas
 *  e todas piores que o custo de um token derivado:
 *
 *    • **criar a linha na hora do envio** ("pré-descadastro") marcaria como fora
 *      quem nunca pediu nada — e o disparo passaria a pular a instituição inteira;
 *    • **levar o `userId` na URL** entregaria um identificador adivinhável e
 *      correlacionável entre instituições (é o mesmo motivo pelo qual o `.ics` da
 *      FASE 65 não leva id nenhum);
 *    • **abrir uma tabela de tokens** por destinatário seria uma segunda fonte de
 *      verdade para o mesmo fato, com o mesmo dado pessoal parado no banco.
 *
 *  Então o token de descadastro é DETERMINÍSTICO por (instituição, pessoa):
 *  HMAC-SHA256 de um rótulo próprio sobre `tenantId:userId`, com o MESMO desenho do
 *  token `.ics` da FASE 65 e do selo da carta. Ele existe desde sempre, para quem
 *  está dentro e para quem está fora, e não depende de leitura nenhuma. O que a
 *  linha guarda é o SHA-256 DELE (`hashUnsubscribeToken`), e a razão de guardar
 *  continua valendo: o banco sozinho não vira uma lista de endereços que desfazem
 *  descadastros.
 *
 *  Consequência declarada: **não há revogação individual do endereço**. O token vale
 *  enquanto o vínculo valer — desativar a pessoa corta o acesso na hora, porque a
 *  página resolve o token contra os vínculos ATIVOS —, mas "gerar um link novo" não
 *  existe. É o mesmo custo do `.ics`, e a alternativa (token aleatório em tabela)
 *  custaria a linha que não existe no momento do envio.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Entropia do token: 256 bits em base64url (43 caracteres, seguros em URL). */
export const UNSUBSCRIBE_TOKEN_BYTES = 32;

/** Token novo, com `randomBytes` criptográfico (nunca `Math.random`). */
export function newUnsubscribeToken(): string {
  return randomBytes(UNSUBSCRIBE_TOKEN_BYTES).toString('base64url');
}

/** Índice da página sem login — SHA-256 em hexadecimal. */
export function hashUnsubscribeToken(token: string): string {
  return createHash('sha256').update(token.trim(), 'utf8').digest('hex');
}

/** O endereço parece um token nosso? (evita consulta com lixo na URL) */
export function isUnsubscribeTokenShaped(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(token.trim());
}

// ───────────────────────────────────────────────────────────────────────────────
//  O token DETERMINÍSTICO do rodapé (fatia 3)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Rótulo PRÓPRIO do descadastro.
 *
 * Existe porque o segredo é o mesmo (`BETTER_AUTH_SECRET`) para o `.ics` da agenda,
 * o selo da carta e o cofre do sorteio: sem o rótulo, o token de um caminho
 * abriria o outro. Vazar o endereço da agenda não pode desinscrever ninguém — e
 * desinscrever alguém não pode entregar a agenda dela.
 */
const TOKEN_LABEL = 'eventflow:descadastro:';

/**
 * Piso de tamanho do segredo — o mesmo do `.ics` e do selo da carta.
 *
 * Segredo curto não protege nada: um HMAC com chave de quatro caracteres é
 * adivinhado por força bruta, e a consequência aqui é desinscrever alguém (ou
 * desfazer o descadastro de quem pediu para sair, que é pior). Abaixo do piso a
 * derivação devolve `null` e quem chama NÃO mostra o link — em vez de publicar um
 * endereço que qualquer um forja.
 */
const MIN_SECRET_LENGTH = 16;

function secret(): string | null {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < MIN_SECRET_LENGTH) return null;

  return value;
}

/**
 * O token de descadastro de uma pessoa NESTA instituição.
 *
 * `null` quando não há segredo utilizável — e aí o rodapé não leva link (a
 * mensagem sai sem ele, e a tela diz por quê). Um endereço que não abre é pior do
 * que a ausência dele: a pessoa clica e conclui que a instituição não cumpre o que
 * promete.
 *
 * O separador é `:` porque o par é (uuid, uuid) e nenhum dos dois contém `:` — sem
 * isso, uma instituição `a` com pessoa `b:c` colidiria com `a:b` com pessoa `c`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A CAIXA DO UUID É NORMALIZADA — E ISSO FOI MEDIDO, NÃO SUPOSTO
 * ─────────────────────────────────────────────────────────────────────────────
 *  O uuid é o MESMO valor escrito de duas formas (`A1B2…` e `a1b2…`), e as duas
 *  chegam a este arquivo em execuções diferentes: a fixture que cria a pessoa com
 *  `randomUUID()` tem a string em minúsculas, e o `id` que VOLTA do banco pode vir
 *  em maiúsculas — dependendo do caminho (o driver, um `$queryRaw`, um `id` colado
 *  à mão). Sem normalizar, o HMAC de `A1B2…` e o de `a1b2…` são tokens diferentes
 *  para a MESMA pessoa: o link do rodapé não resolve, e o sintoma é uma página de
 *  descadastro que responde 404 para o dono do endereço.
 *
 *  Foi exatamente o que a fase encontrou ao montar o primeiro E2E — a resolução
 *  devolvia `null` para o token que ela mesma tinha acabado de gerar. `toLowerCase`
 *  nos dois lados é o conserto, e ele é do DOMÍNIO: quem chama não precisa saber
 *  disso.
 */
export function unsubscribeToken(input: { tenantId: string; userId: string }): string | null {
  const key = secret();
  if (!key) return null;
  if (!input.tenantId || !input.userId) return null;

  const pair = `${input.tenantId.toLowerCase()}:${input.userId.toLowerCase()}`;

  return createHmac('sha256', `${TOKEN_LABEL}${key}`).update(pair, 'utf8').digest('base64url');
}

/**
 * Comparação em TEMPO CONSTANTE.
 *
 * Comparar com `===` devolveria, pelo tempo de resposta, quantos caracteres do
 * token estão certos: é a mesma decisão (e o mesmo motivo) do `.ics` da FASE 65.
 * O tamanho DIFERENTE responde `false` antes — o `timingSafeEqual` lança com
 * buffers de tamanhos distintos, e o tamanho do token não é segredo (é o do
 * digest).
 */
export function sameUnsubscribeToken(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export interface UnsubscribeStateSource {
  unsubscribedAt: Date | null;
  resubscribedAt: Date | null;
}

/**
 * A pessoa está FORA agora?
 *
 * A ordem das perguntas é a regra: sem saída registrada não há o que desfazer; se
 * a volta veio DEPOIS da saída (o caso normal), está dentro. Uma volta anterior à
 * saída — impossível pelo serviço, possível num dado corrigido à mão — deixa a
 * pessoa FORA, porque a saída é o fato mais recente: entre errar enviando a quem
 * pediu para sair e deixar de enviar, o erro aceitável é o segundo.
 */
export function isCurrentlyUnsubscribed(state: UnsubscribeStateSource): boolean {
  if (!state.unsubscribedAt) return false;
  if (!state.resubscribedAt) return true;

  return state.resubscribedAt.getTime() < state.unsubscribedAt.getTime();
}
