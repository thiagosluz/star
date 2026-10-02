/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — A identidade de quem aparece no RANKING (FASE 62 · dívida E80)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A IDEIA EM UMA FRASE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A pessoa que a moderação da plataforma ocultou **continua no ranking** — com o
 *  nome abreviado e sem `@handle` nem foto. A lista não encolhe.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DECISÃO: MASCARAR, E NÃO REMOVER — e por que ela é a coerente AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *
 *  A F60 fixou a fonte única (`isPersonPubliclyVisible`) e mostrou que o
 *  TRATAMENTO difere por superfície, porque o que cada uma publica é diferente:
 *
 *    • no bloco **"Equipe do evento"** a pessoa **sai** — o cartão É a pessoa
 *      (foto, nome e etiqueta), e não existe cartão sem citá-la;
 *    • no **link selado da carta** ela fica com **rótulo neutro** — a carta
 *      continua abrindo, porque fechar o link contaria a medida a quem tem o token;
 *    • no **sorteio** ela aparece **mascarada** — a lista assinada é lida junto com
 *      posição, prêmio e contagem, e sumir com a linha faria a conferência divergir
 *      da apuração.
 *
 *  Um **ranking** é do terceiro tipo, e por um motivo que não é estético: **posição e
 *  contagem SÃO o conteúdo**. A linha não é um cartão de visitas — é o "1º lugar,
 *  4.120 XP" que a pessoa lê para saber onde está. Tirar a pessoa ocultada:
 *
 *    1. **muda o tamanho da lista** e promove todo mundo abaixo dela um degrau — a
 *       lista passa a MENTIR sobre o fato que ela existe para mostrar;
 *    2. **contradiz o número do topo da própria tela**: o painel de conquistas
 *       calcula `rank` e `rankedCount` contando TODOS os perfis com XP
 *       (`getXpProfile`), então o "2º de 12" do cabeçalho passaria a conviver com
 *       uma lista de 11 — duas contagens do mesmo fato, divergindo no primeiro dia
 *       (a mesma régua da FASE 54: contagem que mente é pior que contagem ausente);
 *    3. **esconde o FATO e não a identidade** — o XP da pessoa é um lançamento no
 *       livro-razão, e apagá-lo da vista não o apaga do saldo.
 *
 *  Mascarar preserva as três coisas: a posição, o total e a contagem continuam
 *  verdadeiros, e o que sai é só o que identifica (nome completo, `@handle`, foto).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RÉGUA DAS SUPERFÍCIES, EM UMA FRASE (a E80 pediu que ela fosse fixada)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  **INTERNA** (membro autenticado da casa): a pessoa PERMANECE na lista — posição e
 *  contagem são o conteúdo —, com o nome abreviado pela régua que o sorteio já usa e
 *  sem `@handle` nem foto. **PÚBLICA** (internet aberta): a identidade não é
 *  publicada de forma nenhuma — a pessoa SAI da vitrine (onde o cartão é ela) ou
 *  recebe rótulo neutro (onde o artefato continua abrindo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A MÁSCARA É A MESMA DO SORTEIO, E SEM RÓTULO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `maskPersonName` é uma função só para as duas superfícies (`Ana Souza` → `Ana S.`):
 *  a lição da E79 é que régua copiada diverge, e o sorteio já era o dono do
 *  vocabulário. A abreviação mantém o ranking legível para quem convive com a pessoa
 *  e ilegível para quem só tem o link da tela — e não ganha legenda do tipo "perfil
 *  oculto": o `masked` existe para o TESTE, não para a tela. Anunciar a decisão da
 *  plataforma a colegas é exposição maior do que o próprio nome (é a lição que o link
 *  da carta fixou).
 *
 *  A máscara vale também para quem ESTÁ OLHANDO a própria linha, e isso é decisão
 *  herdada: no link selado da carta o dono vê o MESMO rótulo neutro que o visitante
 *  (F60), porque a tela que mostra dois nomes diferentes para o mesmo fato é a que
 *  denuncia a moderação.
 */
import { isPersonPubliclyVisible, maskPersonName } from '@/domain/profile/public-profile-rules';

/** O que o ranking precisa saber de uma pessoa para decidir como citá-la. */
export interface LeaderboardPersonSource {
  name: string;
  /** O `@handle` global — parte da identidade, e por isso sai quando ela é ocultada. */
  publicHandle: string | null;
  image: string | null;
  /**
   * O EFEITO da moderação da plataforma (FASE 56 · E62), lido pela fonte única.
   * OBRIGATÓRIO de propósito, como na vitrine da equipe e no sorteio: um `select` que
   * esqueça a coluna entrega `undefined` e o `tsc` acusa — e, para o que escapar do
   * tipo, a fonte única responde "não visível" (fail-closed). O erro visível é gente
   * abreviada numa lista que mostrava o nome; o invisível seria identidade publicada.
   */
  publicProfileHiddenAt: Date | null;
}

/** Como o ranking cita UMA pessoa. */
export interface LeaderboardIdentity {
  name: string;
  publicHandle: string | null;
  image: string | null;
  /** `true` = a identidade saiu pela régua da ocultação. É prova de teste, não de tela. */
  masked: boolean;
}

/**
 * A identidade de uma linha do ranking, já passada pela fonte única.
 *
 * Quem está visível sai **exatamente** como entrou (nenhum campo é reinterpretado
 * aqui); quem está oculto sai abreviado e sem `@handle`/foto. A função não decide
 * posição nem XP: ela só responde "como citar esta pessoa" — o que mantém a decisão
 * da E80 num lugar só, testável sem banco.
 */
export function leaderboardIdentity(person: LeaderboardPersonSource): LeaderboardIdentity {
  if (isPersonPubliclyVisible(person)) {
    return {
      name: person.name,
      publicHandle: person.publicHandle,
      image: person.image,
      masked: false,
    };
  }

  return {
    name: maskPersonName(person.name),
    publicHandle: null,
    image: null,
    masked: true,
  };
}
