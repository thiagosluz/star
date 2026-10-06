/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Descadastro por instituição (FASE 67 · fatias 1 e 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SAIR É UM ATO REGISTRADO, E NÃO UM BOTÃO QUE APAGA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A linha guarda quem saiu, quando, por qual campanha e por qual canal, e a
 *  VOLTA entra na mesma linha (`resubscribedAt`): o disparo pula quem está fora
 *  consultando ESTE estado, e a operação consegue responder "quantas pessoas
 *  pediram para sair deste evento?" — que é a pergunta que diz se a comunicação
 *  está sendo bem-vinda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NADA AQUI AUTORIZA — EXCETO O TOKEN, NA PÁGINA SEM LOGIN
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Como os outros serviços de comunicação, este não decide permissão de equipe:
 *  quem chama é a Server Action. A exceção é a página sem login (`/descadastro/<token>`),
 *  cuja autorização é o TOKEN — e a ordem das operações lá é o desenho: o HMAC é
 *  CONFERIDO antes de qualquer leitura, e só depois de conferido é que a instituição
 *  é consultada. Um token torto não chega a tocar no banco.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A RESOLUÇÃO É POR VÍNCULO DA INSTITUIÇÃO — SEM VARREDURA GLOBAL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um HMAC não se "desfaz": para achar a pessoa a partir do token é preciso
 *  RECALCULAR o token de cada candidato e comparar em tempo constante. Os
 *  candidatos são os vínculos ATIVOS daquela instituição
 *  (`user_tenant_profiles`, que tem `tenantId` e portanto entra por RLS) — nunca a
 *  tabela `user` inteira, que é global. E o slug da URL não é credencial: o token
 *  de uma pessoa da casa A não resolve na casa B nem com o slug certo na mão,
 *  porque o HMAC é sobre `tenantId:userId`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A PESSOA CONTINUA RECEBENDO — E POR QUE A PÁGINA DIZ ISSO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O descadastro vale para a CAMPANHA (o recado em massa da instituição). O
 *  transacional continua chegando, e não por teimosia: aviso de vaga retida, prazo,
 *  material do palestrante e certificado são OBRIGAÇÃO da instituição com a pessoa —
 *  calar esses avisos faria alguém perder a vaga por não ter sido avisado, e faria o
 *  certificado existir sem que ninguém soubesse. A lista abaixo é a mesma frase que a
 *  página mostra, em um lugar só, para a tela e o teste não divergirem.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { errorMessage } from '@/lib/db/prisma-errors';
import { withTenant } from '@/lib/db/tenant-client';
import { logger } from '@/lib/observability/logger';
import { isUnsubscribeChannel, type UnsubscribeChannel } from '@/domain/communication/campaign-rules';
import {
  hashUnsubscribeToken,
  isCurrentlyUnsubscribed,
  isUnsubscribeTokenShaped,
  newUnsubscribeToken,
  sameUnsubscribeToken,
  unsubscribeToken,
} from '@/domain/communication/unsubscribe-rules';
import { appBaseUrl } from './links';

export type UnsubscribeResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_TOKEN' | 'INVALID_INPUT' | 'INTERNAL'; message: string };

// ───────────────────────────────────────────────────────────────────────────────
//  O endereço do rodapé
// ───────────────────────────────────────────────────────────────────────────────
/** O endereço RELATIVO da página sem login, com o token no CAMINHO. */
export function unsubscribePath(input: { tenantSlug: string; token: string }): string {
  /**
   * O token vai no CAMINHO (`/descadastro/<token>`) e não na query: o endereço é
   * lido por gente e colado em conversa, e o `?token=…` de 43 caracteres costuma
   * chegar cortado — o sintoma é a página abrir em "endereço inválido" sem que
   * ninguém entenda por quê. O caminho também é o que os clientes de e-mail
   * linkificam por inteiro.
   */
  return `/t/${input.tenantSlug}/descadastro/${input.token}`;
}

/** O endereço ABSOLUTO que vai no rodapé do e-mail. */
export function unsubscribeUrl(input: { tenantSlug: string; token: string }): string {
  return `${appBaseUrl()}${unsubscribePath(input)}`;
}

/**
 * O endereço de descadastro de UMA pessoa — ou `null` quando não há segredo.
 *
 * É a função que o DISPARO usa: ela resolve o token e monta o endereço. Devolver
 * `null` (em vez de um endereço que não abre) é o que faz a mensagem sair sem o
 * rodapé de descadastro quando o servidor não tem segredo utilizável — e a tela de
 * comunicação informa isso.
 */
export function unsubscribeUrlFor(input: {
  tenantSlug: string;
  tenantId: string;
  userId: string;
}): string | null {
  const token = unsubscribeToken({ tenantId: input.tenantId, userId: input.userId });
  if (!token) return null;

  return unsubscribeUrl({ tenantSlug: input.tenantSlug, token });
}

// ───────────────────────────────────────────────────────────────────────────────
//  Quem o token identifica
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O `userId` por trás do token, entre os vínculos ATIVOS desta instituição.
 *
 * `null` = o token não é de ninguém daqui: HMAC errado, instituição errada, pessoa
 * de outra casa ou vínculo desativado. As quatro respostas são a MESMA, e é
 * deliberado: distinguir "token válido de outra instituição" de "token inválido"
 * contaria a quem sonda que ele acertou o formato.
 */
export async function resolveUnsubscribeUser(input: {
  tenantId: string;
  token: string;
}): Promise<string | null> {
  const token = input.token.trim();

  /**
   * A forma do token é conferida ANTES de qualquer consulta: token curto, com
   * caractere estranho ou vazio nem chega ao banco (a mesma guarda do `.ics`).
   */
  if (!isUnsubscribeTokenShaped(token)) return null;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const vinculos = await tx.userTenantProfile.findMany({
        where: { tenantId: input.tenantId, status: 'ACTIVE', deletedAt: null },
        select: { userId: true },
      });

      for (const vinculo of vinculos) {
        const candidato = unsubscribeToken({ tenantId: input.tenantId, userId: vinculo.userId });

        if (candidato && sameUnsubscribeToken(candidato, token)) return vinculo.userId;
      }

      return null;
    });
  } catch (error) {
    logger.error('unsubscribe: falha ao resolver o token', { error: errorMessage(error) });

    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Registro da saída e da volta
// ───────────────────────────────────────────────────────────────────────────────
export interface UnsubscribePersonInput {
  tenantId: string;
  userId: string;
  /** A campanha que originou a saída, quando houve uma. */
  campaignId?: string | null;
  channel?: UnsubscribeChannel;
  reason?: string | null;
  /**
   * O token que originou a saída. Quando informado (o caminho do rodapé), o hash
   * gravado é o DELE — e não um valor novo, que seria um segundo endereço para a
   * mesma pessoa. Quando omitido (o pedido por telefone registrado pela equipe),
   * um token novo é sorteado e o hash dele é o que fica: sempre há um segredo
   * gravado, e ele nunca é o valor em claro.
   */
  token?: string | null;
}

export interface UnsubscribePersonOutput {
  /** O endereço da página sem login — exibido UMA vez, a quem acabou de sair. */
  token: string;
  /** `true` quando a pessoa já estava fora: a chamada não mudou nada. */
  alreadyOut: boolean;
}

/**
 * Registra que a pessoa saiu da lista desta instituição.
 *
 * Idempotente por (instituição, pessoa): sair duas vezes ATUALIZA o token e
 * mantém `unsubscribedAt` original? Não — a segunda saída é uma nova decisão e
 * ganha carimbo novo, mas a linha é a mesma (índice único). O que não pode
 * acontecer é a chamada falhar por já existir: quem clica duas vezes no link
 * precisa da mesma resposta.
 */
export async function unsubscribePerson(
  input: UnsubscribePersonInput,
): Promise<UnsubscribeResult<UnsubscribePersonOutput>> {
  const channel: UnsubscribeChannel = isUnsubscribeChannel(input.channel) ? input.channel : 'EMAIL';
  const token = input.token?.trim() || newUnsubscribeToken();

  try {
    const tokenHash = hashUnsubscribeToken(token);
    const now = new Date();

    return await withTenant(input.tenantId, async (tx) => {
      const existing = await tx.communicationUnsubscribe.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        select: { id: true, unsubscribedAt: true, resubscribedAt: true },
      });

      if (existing && isCurrentlyUnsubscribed(existing)) {
        return { ok: true as const, token, alreadyOut: true };
      }

      if (existing) {
        await tx.communicationUnsubscribe.update({
          where: { id: existing.id },
          data: {
            unsubscribedAt: now,
            resubscribedAt: null,
            campaignId: input.campaignId ?? null,
            channel,
            reason: (input.reason ?? '').trim().slice(0, 300) || null,
            tokenHash,
          },
        });

        return { ok: true as const, token, alreadyOut: false };
      }

      await tx.communicationUnsubscribe.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          tokenHash,
          unsubscribedAt: now,
          campaignId: input.campaignId ?? null,
          channel,
          reason: (input.reason ?? '').trim().slice(0, 300) || null,
        },
      });

      return { ok: true as const, token, alreadyOut: false };
    });
  } catch (error) {
    logger.error('unsubscribe: falha ao registrar a saída', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível registrar o descadastro.' };
  }
}

/**
 * Registra a saída de quem chegou PELO TOKEN do rodapé.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA FUNÇÃO EXISTE EM VEZ DE A PÁGINA CHAMAR `unsubscribePerson`
 * ─────────────────────────────────────────────────────────────────────────────
 *  A página sem login não tem `userId` — ela tem um token, e o `userId` só aparece
 *  DEPOIS que o HMAC é conferido. Esta função faz as duas coisas na ordem certa e
 *  devolve `INVALID_TOKEN` sem ter lido nada quando o token não presta: é o que
 *  torna impossível, por construção, uma página que consulta o banco antes de
 *  validar.
 *
 *  O canal é `LINK` e não `EMAIL`: quando a pessoa chega aqui, o e-mail já foi
 *  aberto e ela veio pela PÁGINA — e a operação quer saber se o rodapé funciona.
 *  O `EMAIL` fica reservado ao registro que a própria mensagem faria.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O MOTIVO CHEGA PRONTO, E AQUI NÃO SE JULGA O QUE ELE DIZ (E88)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Quem lê a escolha da pessoa é a AÇÃO, com a regra pura do domínio; este serviço
 *  recebe texto (ou `null`) e grava. A separação não é preciosismo: o mesmo
 *  parâmetro atende o caminho `MANUAL`, onde o texto é uma frase escrita pela
 *  equipe que nenhuma lista de opções conhece. Se a validação morasse aqui, ela
 *  teria de recusar o motivo do telefone ou aceitar qualquer coisa — e as duas
 *  respostas estão erradas.
 */
export async function unsubscribeByToken(input: {
  tenantId: string;
  token: string;
  /** O motivo já resolvido pelo domínio: frase conhecida, texto escrito ou `null`. */
  reason?: string | null;
}): Promise<UnsubscribeResult<UnsubscribePersonOutput & { userId: string }>> {
  const userId = await resolveUnsubscribeUser({ tenantId: input.tenantId, token: input.token });

  if (!userId) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Este endereço de descadastro não vale mais.' };
  }

  const recorded = await unsubscribePerson({
    tenantId: input.tenantId,
    userId,
    channel: 'LINK',
    token: input.token,
    reason: input.reason ?? null,
  });

  if (!recorded.ok) return recorded;

  return { ok: true, userId, token: recorded.token, alreadyOut: recorded.alreadyOut };
}

/**
 * O CAMINHO DE VOLTA, pelo mesmo token.
 *
 * A autorização é o TOKEN — a mesma decisão do aceite de convite (ADR-115): ele só
 * existe no endereço que a pessoa recebeu, e é a prova de posse sem exigir login.
 * Como o token é derivado, a volta não depende de a linha existir: `resubscribeByToken`
 * (o serviço da fatia 1, que procura pelo HASH) continua valendo para quem tem o
 * token aleatório gravado por um pedido antigo ou pela equipe, e
 * `resubscribeByUnsubscribeToken` atende o caminho novo — a página.
 *
 * `updateMany` condicional: dois cliques no mesmo link (ou dois dispositivos) não
 * são erro nem sobrescrevem a data da volta — o segundo recebe zero linhas, que é a
 * resposta "já estava dentro" (invariante nº 5).
 */
export async function resubscribeByUnsubscribeToken(input: {
  tenantId: string;
  token: string;
}): Promise<UnsubscribeResult<{ changed: boolean }>> {
  const userId = await resolveUnsubscribeUser({ tenantId: input.tenantId, token: input.token });

  if (!userId) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Este endereço de descadastro não vale mais.' };
  }

  try {
    const changed = await withTenant(input.tenantId, async (tx) => {
      const result = await tx.communicationUnsubscribe.updateMany({
        where: { userId, resubscribedAt: null },
        data: { resubscribedAt: new Date() },
      });

      return result.count > 0;
    });

    return { ok: true, changed };
  } catch (error) {
    logger.error('unsubscribe: falha ao desfazer o descadastro', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível desfazer o descadastro.' };
  }
}

export interface ResubscribeOutput {
  /** `false` quando a pessoa já estava dentro (nada mudou). */
  changed: boolean;
}

/**
 * A VOLTA pelo token SORTEADO (fatia 1).
 *
 * Continua existindo porque há dois tokens possíveis gravados na linha: o
 * determinístico (o do rodapé, escrito por `unsubscribePerson` quando recebe
 * `token`) e o sorteado (o pedido registrado pela equipe sem token informado, e as
 * linhas anteriores à fatia 3). Manter as duas portas custa uma função, e removê-la
 * deixaria sem volta justamente quem saiu por telefone.
 */
export async function resubscribeByToken(input: {
  tenantId: string;
  token: string;
}): Promise<UnsubscribeResult<ResubscribeOutput>> {
  if (!isUnsubscribeTokenShaped(input.token)) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Endereço de descadastro inválido.' };
  }

  const tokenHash = hashUnsubscribeToken(input.token.trim());

  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const row = await tx.communicationUnsubscribe.findFirst({
        where: { tokenHash },
        select: { id: true },
      });

      if (!row) return null;

      const result = await tx.communicationUnsubscribe.updateMany({
        where: { id: row.id, resubscribedAt: null },
        data: { resubscribedAt: new Date() },
      });

      return result.count > 0;
    });

    if (outcome === null) {
      return { ok: false, code: 'NOT_FOUND', message: 'Este endereço de descadastro não vale mais.' };
    }

    return { ok: true, changed: outcome };
  } catch (error) {
    logger.error('unsubscribe: falha ao desfazer o descadastro', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível desfazer o descadastro.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O estado vigente
// ───────────────────────────────────────────────────────────────────────────────
export interface UnsubscribeStateOutput {
  userId: string;
  isOut: boolean;
  unsubscribedAt: Date | null;
  resubscribedAt: Date | null;
  channel: string | null;
}

/** O estado vigente de uma pessoa nesta instituição. */
export async function readUnsubscribeState(input: {
  tenantId: string;
  userId: string;
}): Promise<UnsubscribeResult<UnsubscribeStateOutput>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const row = await tx.communicationUnsubscribe.findUnique({
        where: { tenantId_userId: { tenantId: input.tenantId, userId: input.userId } },
        select: { userId: true, unsubscribedAt: true, resubscribedAt: true, channel: true },
      });

      if (!row) {
        return {
          ok: true as const,
          userId: input.userId,
          isOut: false,
          unsubscribedAt: null,
          resubscribedAt: null,
          channel: null,
        };
      }

      return {
        ok: true as const,
        userId: row.userId,
        isOut: isCurrentlyUnsubscribed(row),
        unsubscribedAt: row.unsubscribedAt,
        resubscribedAt: row.resubscribedAt,
        channel: row.channel,
      };
    });
  } catch (error) {
    logger.error('unsubscribe: falha ao ler o estado', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível ler o descadastro.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  O que a página sem login mostra
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que a pessoa CONTINUA recebendo, mesmo depois de sair.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA LISTA É CÓDIGO, E NÃO TEXTO NA PÁGINA
 * ─────────────────────────────────────────────────────────────────────────────
 *  É uma promessa da instituição com a pessoa, e ela precisa ser dita com as
 *  mesmas palavras no e-mail que oferece o descadastro e na tela que o confirma.
 *  Escrita em dois lugares, o dia em que um deles mudasse faria a plataforma
 *  prometer coisas diferentes sobre o que continua chegando.
 *
 *  E a lista é sobre E-MAIL TRANSACIONAL de verdade, não sobre intenção: os quatro
 *  casos abaixo são mensagens que a plataforma já dispara e cujo silêncio causaria
 *  dano concreto (vaga perdida, prazo vencido, material não encontrado, certificado
 *  não emitido).
 */
export const TRANSACTIONAL_EMAILS: readonly string[] = [
  'Aviso de que a sua vaga está retida e precisa de confirmação, com o prazo.',
  'Aviso de que a vaga foi confirmada, liberada ou que você saiu da lista de espera.',
  'Material de apoio das atividades em que você se inscreveu ou das quais é palestrante.',
  'Certificado emitido, com o código de validação.',
] as const;

export interface UnsubscribePageState {
  /** O nome da instituição — é a primeira coisa que a pessoa precisa reconhecer. */
  tenantName: string;
  /** Como a pessoa é chamada. NUNCA o e-mail: ele não é necessário nesta tela. */
  userName: string;
  /** `true` = já está fora (a página oferece só a volta). */
  isOut: boolean;
  unsubscribedAt: Date | null;
  resubscribedAt: Date | null;
  /** Canal da saída registrada, quando houve uma. */
  channel: string | null;
  /** O que continua chegando — a promessa, em uma lista. */
  keepsReceiving: readonly string[];
}

/**
 * Resolve o token e devolve o que a página precisa mostrar — ou `null`.
 *
 * `null` cobre os quatro casos que a página trata igual: token torto, token de
 * outra pessoa, token de outra instituição e pessoa sem vínculo ativo. A conferência
 * do HMAC vem primeiro (`resolveUnsubscribeUser` recusa antes de ler qualquer
 * coisa); o nome da pessoa é lido DEPOIS, e só então para quem o token identificou.
 *
 * O nome da INSTITUIÇÃO chega por parâmetro em vez de ser consultado aqui: o layout
 * público já resolveu o tenant para desenhar o endereço e o cabeçalho, e uma segunda
 * leitura da mesma linha só criaria a chance de as duas discordarem. É também uma
 * consulta a menos no caminho de quem chegou de um link de e-mail.
 */
export async function readUnsubscribePage(input: {
  tenantId: string;
  token: string;
  tenantName: string;
}): Promise<UnsubscribeResult<UnsubscribePageState>> {
  const userId = await resolveUnsubscribeUser({ tenantId: input.tenantId, token: input.token });

  if (!userId) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Este endereço de descadastro não vale mais.' };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [user, row] = await Promise.all([
        tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
        tx.communicationUnsubscribe.findUnique({
          where: { tenantId_userId: { tenantId: input.tenantId, userId } },
          select: { unsubscribedAt: true, resubscribedAt: true, channel: true },
        }),
      ]);

      if (!user) {
        return {
          ok: false as const,
          code: 'NOT_FOUND' as const,
          message: 'Este endereço de descadastro não vale mais.',
        };
      }

      return {
        ok: true as const,
        tenantName: input.tenantName,
        userName: user.name,
        isOut: row ? isCurrentlyUnsubscribed(row) : false,
        unsubscribedAt: row?.unsubscribedAt ?? null,
        resubscribedAt: row?.resubscribedAt ?? null,
        channel: row?.channel ?? null,
        keepsReceiving: TRANSACTIONAL_EMAILS,
      };
    });
  } catch (error) {
    logger.error('unsubscribe: falha ao ler a página de descadastro', { error: errorMessage(error) });

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível abrir o descadastro agora.' };
  }
}
