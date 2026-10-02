/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — compartilhamento de UMA carta (FASE 48)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTA CAMADA DECIDE (E O QUE ELA NÃO DEIXA A TELA DECIDIR)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  1. O link é do DONO da carta: toda escrita confere `userCardId + userId` no
 *     banco. O `userCardId` chega da tela e é tratado como palpite.
 *  2. O NOME que aparece no link passa pela régua da FASE 44 (`visibleProfileFields`
 *     para visitante ANÔNIMO + `resolvePublicDisplayName`): quem não publica o nome
 *     aparece como `@handle`, exatamente como no perfil público — e quem não tem
 *     handle aparece com um rótulo neutro, sem inventar identidade. Quem a moderação
 *     da plataforma ocultou (F56 · E62 → F60 · E79) também recebe o rótulo neutro:
 *     a carta continua abrindo, mas a identidade sai — ver `readSharedCard`.
 *  3. A página pública lê SÓ o que a carta precisa. Não há caminho, aqui, para XP,
 *     álbum, e-mail, outros certificados ou a lista de eventos da pessoa.
 *
 *  A leitura pública NÃO usa a conexão de plataforma: a instituição vem do slug da
 *  URL, então a consulta roda sob `withTenant` e a RLS é quem garante o isolamento
 *  (um token de outra instituição não é encontrado — fail-closed, sem consulta
 *  privilegiada).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PRAZO E A CONTAGEM DE ABERTURAS (dívida E70 · FASE 51)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Prazo e contagem são a MESMA leitura do link, vista de dois lados: quem abre
 *  (a carta aparece ou não) e quem criou (quantas vezes ela foi vista). A decisão
 *  de "abre agora?" é do domínio (`cardShareStatus`) — aqui só se aplica a
 *  resposta, para que a página pública e a lista do dono nunca discordem.
 *
 *  Duas regras deste arquivo existem para a medição não virar defeito:
 *
 *   1. **A contagem é pedida, não presumida** (`registerView`). A página chama
 *      `readSharedCard` TRÊS vezes por link: no `generateMetadata`, na própria
 *      página e na rota da imagem de prévia. Contar todas inflaria o número com o
 *      robô que só buscou a prévia para o WhatsApp — quem mede abertura é a
 *      renderização da CARTA;
 *   2. **A contagem falhar não fecha a carta** (invariante nº 8): o incremento roda
 *      na própria transação dele, depois de a carta já estar montada, e o erro vai
 *      para o log. Ninguém deixa de ver a conquista porque um contador falhou.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { recordAudit } from '@/lib/admin/audit';
import { withTenant } from '@/lib/db/tenant-client';
import { publicBaseUrl } from '@/lib/public-url';
import type { CardArt, CardPalette } from '@/domain/gamification/card-rules';
import { resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import type { CardStage } from '@/domain/gamification/card-presentation';
import { cardBackContent, resolveCardStage } from '@/domain/gamification/card-presentation';
import type { CardRarity } from '@/domain/gamification/types';
import {
  DEFAULT_SHARE_VALIDITY,
  cardShareStatus,
  cardShareUrl,
  isCardShareOpen,
  isValidShareToken,
  normalizeShareToken,
  shareExpiryFor,
  shareMomentLabel,
  shareTextFor,
  shareValidityLabel,
  shareViewCountLabel,
  type CardShareStatus,
} from '@/domain/gamification/card-share-rules';
import {
  isPersonPubliclyVisible,
  parseProfileAudiences,
  resolvePublicDisplayName,
  visibleProfileFields,
} from '@/domain/profile/public-profile-rules';
import { createShareToken, hashShareToken, openShareToken, sealShareToken } from './card-share-token';

export type CardShareErrorCode =
  | 'NOT_OWNED'
  | 'NOT_FOUND'
  | 'SEAL_UNAVAILABLE'
  | 'INVALID_TOKEN'
  | 'INVALID_VALIDITY'
  | 'INTERNAL';

export type CardShareResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: CardShareErrorCode; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rótulo de quem NÃO publica o nome e não tem `@handle`.
 *
 * Só aparece nesse caso: o perfil público exige handle para existir (FASE 44), e
 * sem handle não há identidade pública nenhuma para mostrar. Inventar o nome de
 * cadastro aqui seria publicar justamente o que a pessoa esconderia.
 */
export const NEUTRAL_SHARE_NAME = 'Uma pessoa desta instituição';

/** O que a tela do álbum precisa saber sobre o link desta carta. */
export interface CardShareState {
  userCardId: string;
  /** Link ATIVO (o mais recente não revogado) — `null` quando só há histórico. */
  linkId: string | null;
  /**
   * Endereço pronto para copiar.
   *
   * `null` quando não há link ativo **ou** quando o link ativo não abre mais
   * (expirado, ou com o selo ilegível porque o segredo da aplicação girou): um
   * campo com o endereço morto ao lado do botão "copiar" faz a pessoa enviar um
   * link que responde 404 — e ela só descobre pelo silêncio do outro lado.
   */
  url: string | null;
  createdAt: Date | null;
  revokedAt: Date | null;
  /** Estado do link ativo: `válido` · `expirado` · `revogado`; `null` sem link. */
  status: CardShareStatus | null;
  /** Rótulo já pronto para a tela ("sem prazo", "expira em 12/03/2027", "expirado"). */
  statusLabel: string | null;
  expiresAt: Date | null;
  /** Quantas vezes a página pública abriu ESTE link (conta leitura, não pessoa). */
  viewCount: number;
  lastViewedAt: Date | null;
  lastViewedLabel: string | null;
  /** Quantos links já foram criados para esta carta (histórico, inclui revogados). */
  historyCount: number;
  /** Cada link criado, do mais novo ao mais antigo — é a resposta a "quais estão vivos?". */
  history: CardShareLinkView[];
  /** **O que o link vai mostrar** — a tela avisa antes de a pessoa enviar. */
  shareDisplayName: string;
  /** Texto que acompanha o link nos canais. */
  shareText: string;
  /** `false` quando a pessoa não publica o nome (a tela explica o rótulo neutro). */
  showsRealName: boolean;
}

/** Uma linha do histórico de links do dono, com os números e o estado já decididos. */
export interface CardShareLinkView {
  linkId: string;
  createdAt: Date;
  createdAtLabel: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  status: CardShareStatus;
  statusLabel: string;
  viewCount: number;
  lastViewedAt: Date | null;
  lastViewedLabel: string | null;
  /** Mesmo texto pronto do estado — a lista inteira fala a mesma língua. */
  viewsLabel: string;
}

/** Campos do link que o estado e o histórico leem — nada além disso é buscado. */
const SHARE_LINK_SELECT = {
  id: true,
  tokenSealed: true,
  createdAt: true,
  revokedAt: true,
  expiresAt: true,
  viewCount: true,
  lastViewedAt: true,
} as const;

type ShareLinkRow = {
  id: string;
  tokenSealed: string;
  createdAt: Date;
  revokedAt: Date | null;
  expiresAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
};

function toLinkView(link: ShareLinkRow, now: Date, timeZone: string): CardShareLinkView {
  const status = cardShareStatus({ revokedAt: link.revokedAt, expiresAt: link.expiresAt, now });

  return {
    linkId: link.id,
    createdAt: link.createdAt,
    createdAtLabel: shareMomentLabel(link.createdAt, timeZone) ?? '',
    revokedAt: link.revokedAt,
    expiresAt: link.expiresAt,
    status,
    statusLabel: shareValidityLabel({ status, expiresAt: link.expiresAt, timeZone }),
    viewCount: link.viewCount,
    lastViewedAt: link.lastViewedAt,
    lastViewedLabel: shareMomentLabel(link.lastViewedAt, timeZone),
    viewsLabel: shareViewCountLabel(link.viewCount, timeZone, link.lastViewedAt),
  };
}

export interface SharedCardView {
  cardName: string;
  rarity: CardRarity;
  palette: CardPalette;
  art: CardArt;
  stage: CardStage;
  isFoil: boolean;
  quantity: number;
  level: number;
  grantedAt: Date | null;
  /** Ficha do verso (a mesma que o dono vê). */
  back: ReturnType<typeof cardBackContent>;
  imageUrl: string | null;
  /** Nome público de quem conquistou — já resolvido pela régua da FASE 44. */
  displayName: string;
  /** Foto do perfil, apenas quando o campo "Foto" está público. */
  avatarUrl: string | null;
  sharedAt: Date;
}

/**
 * Nome público do dono, pela régua da FASE 44 — e pela ocultação da FASE 56.
 *
 * A página da carta é lida por visitante ANÔNIMO (o link vai para um grupo), então
 * é essa a régua aplicada — a mesma que a página do perfil usa para quem não está
 * logado. Nome privado ⇒ `@handle`; sem handle ⇒ rótulo neutro.
 *
 * ─── O PERFIL OCULTO NÃO ASSINA A CARTA (FASE 60 · E79) ──────────────────────
 *
 *  A decisão da moderação (`publicProfileHiddenAt`) tira do ar a IDENTIDADE pública
 *  da pessoa — e o nome, o `@handle` e a foto são exatamente isso. Aqui eles caem para
 *  o rótulo NEUTRO pela fonte única (`isPersonPubliclyVisible`), e sem passar pela
 *  matriz de campos: a ocultação é medida da PLATAFORMA, e não um degrau a mais de
 *  visibilidade que a pessoa pudesse reverter sozinha.
 *
 *  O rótulo é o NEUTRO, e isso é decisão, não descuido: escrever "perfil oculto pela
 *  moderação" contaria a decisão a TODO mundo que tem o token — um grupo inteiro
 *  saberia que aquela pessoa foi moderada, exposição maior do que o próprio nome.
 *  Neutro, o visitante não distingue "não publica o nome" de "foi ocultada", que é
 *  o mínimo que a medida precisa preservar.
 */
function resolveShareName(input: {
  name: string | null;
  publicHandle: string | null;
  profileAudiences: unknown;
  publicProfileHiddenAt: Date | null;
}): { displayName: string; showsRealName: boolean } {
  if (!isPersonPubliclyVisible(input)) {
    return { displayName: NEUTRAL_SHARE_NAME, showsRealName: false };
  }

  const audiences = parseProfileAudiences(input.profileAudiences);
  const visible = new Set(visibleProfileFields({ audiences, viewer: 'ANONYMOUS' }));
  const showsRealName = visible.has('displayName');

  if (showsRealName) {
    return {
      displayName: resolvePublicDisplayName({
        displayName: input.name,
        username: input.publicHandle ?? '',
      }),
      showsRealName: true,
    };
  }

  if (input.publicHandle) {
    return { displayName: `@${input.publicHandle}`, showsRealName: false };
  }

  return { displayName: NEUTRAL_SHARE_NAME, showsRealName: false };
}

/** Campos de `user` que a régua do nome precisa — nada além disso é lido. */
const SHARE_NAME_SELECT = {
  name: true,
  publicHandle: true,
  profileAudiences: true,
  /** O efeito da moderação da plataforma (F56 · E62): o link não cita quem foi oculto. */
  publicProfileHiddenAt: true,
} as const;

// ───────────────────────────────────────────────────────────────────────────────
//  Estado do link da carta (dono)
// ───────────────────────────────────────────────────────────────────────────────
export async function getCardShareState(input: {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  /** Opcional: sem ele o nome da instituição vem da mesma consulta do fuso. */
  tenantName?: string;
  userCardId: string;
}): Promise<CardShareResult<{ state: CardShareState }>> {
  try {
    const data = await withTenant(input.tenantId, async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: input.userCardId, tenantId: input.tenantId, userId: input.userId },
        select: {
          id: true,
          isFoil: true,
          cardTemplate: { select: { name: true, rarity: true } },
          user: { select: SHARE_NAME_SELECT },
        },
      });

      if (!card) return null;

      const links = await tx.cardShareLink.findMany({
        where: { tenantId: input.tenantId, userId: input.userId, userCardId: input.userCardId },
        orderBy: { createdAt: 'desc' },
        select: SHARE_LINK_SELECT,
      });

      /**
       * Uma consulta a mais nesta transação, e não uma por link: o FUSO e o NOME da
       * instituição são necessários para rotular cada linha ("expira em 12/03",
       * "aberta em 12/03 às 14:32") — rótulo montado no fuso do servidor diria o dia
       * errado perto da meia-noite, e o texto de compartilhamento cita o nome.
       */
      const settings = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { name: true, timezone: true },
      });

      return { card, links, settings };
    });

    if (!data) {
      return { ok: false, code: 'NOT_OWNED', message: 'Esta carta não está no seu álbum.' };
    }

    const now = new Date();
    const timeZone = data.settings?.timezone ?? 'UTC';
    const tenantName = input.tenantName ?? data.settings?.name ?? 'a instituição';

    const history = data.links.map((link) => toLinkView(link, now, timeZone));
    const activeIndex = data.links.findIndex((link) => link.revokedAt === null);
    const active = activeIndex >= 0 ? data.links[activeIndex] : undefined;
    const activeView = activeIndex >= 0 ? (history[activeIndex] ?? null) : null;

    /**
     * O endereço só é exibido quando o link ABRE. O selo continua sendo aberto
     * mesmo para o link vencido (é o registro do que foi enviado), mas o que a tela
     * recebe é `null`: quem precisa do endereço antigo tem o histórico.
     */
    const opened = active ? openShareToken(active.tokenSealed) : null;
    const url =
      activeView && activeView.status === 'VALID' && opened
        ? cardShareUrl({ baseUrl: publicBaseUrl(), tenantSlug: input.tenantSlug, token: opened })
        : null;

    const name = resolveShareName(data.card.user);

    return {
      ok: true,
      state: {
        userCardId: input.userCardId,
        linkId: active?.id ?? null,
        url,
        createdAt: active?.createdAt ?? null,
        revokedAt: active?.revokedAt ?? null,
        status: activeView?.status ?? null,
        statusLabel: activeView?.statusLabel ?? null,
        expiresAt: active?.expiresAt ?? null,
        viewCount: activeView?.viewCount ?? 0,
        lastViewedAt: activeView?.lastViewedAt ?? null,
        lastViewedLabel: activeView?.lastViewedLabel ?? null,
        historyCount: data.links.length,
        history,
        shareDisplayName: name.displayName,
        showsRealName: name.showsRealName,
        shareText: shareTextFor({
          cardName: data.card.cardTemplate?.name ?? 'carta',
          rarity: data.card.cardTemplate?.rarity ?? 'COMMON',
          tenantName,
          displayName: name.displayName,
        }),
      },
    };
  } catch (error) {
    console.error(`[gamification] falha ao ler o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível ler o link desta carta.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Criar (ou reaproveitar) o link
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Compartilhar é IDEMPOTENTE: clicar duas vezes devolve o MESMO link.
 *
 * Criar um link novo a cada clique invalidaria, em silêncio, o endereço que a
 * pessoa acabou de colar num grupo — e ninguém descobriria até alguém reclamar que
 * "o link não abre". Para trocar o endereço existe a revogação, que é um ato.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA QUANDO O LINK ATIVO JÁ NÃO ABRE (E70)
 * ─────────────────────────────────────────────────────────────────────────────
 *  "Ativo" aqui é o link ainda NÃO revogado, e ele pode estar vencido. Nesse caso
 *  a criação é mesmo a resposta certa — mas ela só pode emitir outro endereço
 *  depois de REVOGAR o vencido, e com o motivo certo gravado. Sem isso a linha
 *  antiga ficaria "viva" no banco para sempre, e a lista do dono mostraria dois
 *  links válidos para a mesma carta (um deles respondendo 404). O motivo distingue
 *  os dois casos que chegam até aqui: prazo vencido ou selo ilegível.
 */
export async function ensureCardShareLink(input: {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  /** Opcional: sem ele o nome da instituição vem da consulta que já resolve o fuso. */
  tenantName?: string;
  userCardId: string;
  /** Escolha de prazo da tela; ausente = `sem prazo` (o padrão do domínio). */
  validity?: string;
  /** `"2027-03-12"` quando a escolha é "Escolher a data". */
  validityDay?: string | null;
}): Promise<CardShareResult<{ state: CardShareState }>> {
  const current = await getCardShareState(input);
  if (!current.ok) return current;

  /** Já existe link vivo e exibível: nada a fazer. */
  if (current.state.linkId && current.state.url) return current;

  if (current.state.linkId) {
    const expired = current.state.status === 'EXPIRED';

    const revoked = await revokeCardShareLink({
      tenantId: input.tenantId,
      userId: input.userId,
      linkId: current.state.linkId,
      reason: expired
        ? 'prazo do link vencido: a carta precisa de um endereço novo'
        : 'segredo girado: o link não podia mais ser exibido ao dono',
    });

    if (!revoked.ok) return revoked;
  }

  try {
    const token = createShareToken();
    const sealed = sealShareToken(token);

    if (!sealed) {
      return {
        ok: false,
        code: 'SEAL_UNAVAILABLE',
        message:
          'O servidor não consegue guardar links agora (segredo da aplicação ausente ou curto). O link não foi criado.',
      };
    }

    const validity = input.validity ?? DEFAULT_SHARE_VALIDITY;

    /**
     * Instituição, posse e criação na MESMA transação: o instante do prazo depende
     * do FUSO da instituição (a data escolhida vence às 23:59 locais), e ler o fuso
     * numa ida separada abriria a janela em que ele muda entre a leitura e a
     * gravação. A posse continua sendo conferida no banco — o `userCardId` chega da
     * tela e é tratado como palpite.
     */
    const created = await withTenant(input.tenantId, async (tx) => {
      const card = await tx.userCard.findFirst({
        where: { id: input.userCardId, tenantId: input.tenantId, userId: input.userId },
        select: { id: true },
      });

      if (!card) return { kind: 'NOT_OWNED' as const };

      const settings = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { timezone: true },
      });

      const expiry = shareExpiryFor({
        validity,
        day: input.validityDay,
        timeZone: settings?.timezone ?? 'UTC',
      });

      if (!expiry.ok) {
        return { kind: 'INVALID_VALIDITY' as const, code: expiry.code, message: expiry.message };
      }

      const row = await tx.cardShareLink.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          userCardId: input.userCardId,
          tokenHash: hashShareToken(token),
          tokenSealed: sealed,
          expiresAt: expiry.expiresAt,
        },
        select: { id: true, createdAt: true },
      });

      return { kind: 'CREATED' as const, row };
    });

    if (created.kind === 'NOT_OWNED') {
      return { ok: false, code: 'NOT_OWNED', message: 'Esta carta não está no seu álbum.' };
    }

    if (created.kind === 'INVALID_VALIDITY') {
      return { ok: false, code: 'INVALID_VALIDITY', message: created.message };
    }

    /**
     * A trilha guarda o ATO, nunca o token. `sanitizeChanges` já bloqueia chaves
     * como `token`, mas nem passar por lá: o que interessa a quem audita é qual
     * carta foi exposta, quando e com que prazo.
     */
    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'CREATE',
      entityType: 'card_share_link',
      entityId: created.row.id,
      changes: {
        userCardId: { from: null, to: input.userCardId },
        prazo: { from: null, to: input.validity ?? DEFAULT_SHARE_VALIDITY },
      },
    });

    const fresh = await getCardShareState(input);
    if (!fresh.ok) return fresh;

    return fresh;
  } catch (error) {
    console.error(`[gamification] falha ao criar o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível criar o link desta carta.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Revogar
// ───────────────────────────────────────────────────────────────────────────────
export async function revokeCardShareLink(input: {
  tenantId: string;
  userId: string;
  linkId: string;
  /**
   * Por que o link foi fechado. Revogação por ATO do dono não manda motivo; quem
   * fecha um link vencido (ou ilegível) manda — e o motivo vai para a trilha,
   * porque "por que este link parou de abrir?" é a pergunta que se faz depois.
   */
  reason?: string;
}): Promise<CardShareResult<{ revokedAt: Date }>> {
  try {
    const revokedAt = new Date();

    const updated = await withTenant(input.tenantId, (tx) =>
      /**
       * `updateMany` CONDICIONAL: só revoga o que ainda está ativo e é do dono. Um
       * `update` por id devolveria "revogado" para um link de outra pessoa se o id
       * vazasse — aqui, zero linhas é resposta de negócio.
       */
      tx.cardShareLink.updateMany({
        where: {
          id: input.linkId,
          tenantId: input.tenantId,
          userId: input.userId,
          revokedAt: null,
        },
        data: { revokedAt },
      }),
    );

    if (updated.count === 0) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'Este link não existe, não é seu ou já foi revogado.',
      };
    }

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.userId,
      action: 'DELETE',
      entityType: 'card_share_link',
      entityId: input.linkId,
      changes: {
        revokedAt: { from: null, to: revokedAt.toISOString() },
        ...(input.reason ? { motivo: { from: null, to: input.reason } } : {}),
      },
    });

    return { ok: true, revokedAt };
  } catch (error) {
    console.error(`[gamification] falha ao revogar o link da carta: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível revogar o link.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura PÚBLICA (sem sessão)
// ───────────────────────────────────────────────────────────────────────────────
/** A resposta ÚNICA de "este link não abre" — ver o porquê no comentário abaixo. */
const SHARE_NOT_FOUND = { ok: false, code: 'NOT_FOUND', message: 'Link não encontrado.' } as const;

/**
 * Conta a abertura de um link.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO PODE DERRUBAR A PÁGINA (invariante nº 8)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A contagem é EFEITO COLATERAL da visita: o fato que importa é a carta aparecer.
 *  Por isso o incremento roda na própria transação, DEPOIS de a carta já estar
 *  montada, e qualquer falha vira linha de log — nunca "não foi possível abrir
 *  este link". O `increment` é atômico no banco (`viewCount = viewCount + 1`), então
 *  duas aberturas simultâneas contam duas: ler o valor e somar em JavaScript
 *  perderia uma das duas.
 */
async function registerCardShareView(input: { tenantId: string; linkId: string }): Promise<void> {
  try {
    await withTenant(input.tenantId, (tx) =>
      tx.cardShareLink.update({
        where: { id: input.linkId },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      }),
    );
  } catch (error) {
    console.error(`[gamification] falha ao contar a abertura do link: ${errorMessage(error)}`);
  }
}

/**
 * A carta de um link, para quem não está logado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A RESPOSTA É A MESMA PARA INEXISTENTE, REVOGADO E VENCIDO
 * ─────────────────────────────────────────────────────────────────────────────
 *  Token inválido, de outra instituição, revogado ou fora do prazo respondem
 *  IGUAL — o mesmo `code` e a mesma mensagem, e a página vira o mesmo 404.
 *  Distinguir os casos entregaria informação a quem está do outro lado:
 *
 *   • "revogado" ou "expirado" confirma que aquele token EXISTIU, e confirmar um
 *     acerto é metade do trabalho de quem tenta adivinhar (o token tem 128 bits,
 *     mas quem varre não sabe disso);
 *   • o dono NÃO perde nada com o silêncio: a lista dele diz "expirado" ou
 *     "revogado", com o número de aberturas — a explicação mora onde ela serve.
 *
 *  `registerView` existe pelo motivo oposto ao sigilo: a página pública, a
 *  `generateMetadata` e a rota da imagem de prévia chamam esta função para o MESMO
 *  link. Contar todas transformaria a raspagem do link (robô de rede social
 *  buscando a prévia) em "aberturas" e o dono leria um número que ninguém viu.
 */
export async function readSharedCard(input: {
  tenantId: string;
  token: string;
  /** Fuso da instituição (vem do contexto público pelo slug): a data da conquista
   *  é lida no dia de quem a concedeu, e não no fuso do processo. */
  timezone: string;
  /** Conta a abertura. Só a renderização da PÁGINA passa `true`. */
  registerView?: boolean;
}): Promise<CardShareResult<{ card: SharedCardView }>> {
  const token = normalizeShareToken(input.token);

  if (!isValidShareToken(token)) {
    return { ok: false, code: 'INVALID_TOKEN', message: 'Link não encontrado.' };
  }

  try {
    const row = await withTenant(input.tenantId, (tx) =>
      tx.cardShareLink.findFirst({
        where: { tenantId: input.tenantId, tokenHash: hashShareToken(token) },
        select: {
          id: true,
          createdAt: true,
          revokedAt: true,
          expiresAt: true,
          userCard: {
            select: {
              isFoil: true,
              quantity: true,
              level: true,
              grantedAt: true,
              user: {
                select: { ...SHARE_NAME_SELECT, image: true, profileAudiences: true },
              },
              cardTemplate: {
                select: {
                  name: true,
                  rarity: true,
                  palette: true,
                  art: true,
                  description: true,
                  lore: true,
                  trigger: true,
                },
              },
            },
          },
        },
      }),
    );

    if (!row || !row.userCard.cardTemplate) return SHARE_NOT_FOUND;

    /** A MESMA pergunta da lista do dono — só que aqui ela fecha a porta. */
    if (!isCardShareOpen({ revokedAt: row.revokedAt, expiresAt: row.expiresAt })) {
      return SHARE_NOT_FOUND;
    }

    const { userCard } = row;
    const template = userCard.cardTemplate;
    const art = resolveArt(template.art);

    /**
     * ─── A CARTA CONTINUA ABRINDO; A IDENTIDADE NÃO (FASE 60 · E79) ─────────────
     *
     *  Decisão: quando a moderação oculta o perfil de quem conquistou a carta, o link
     *  NÃO responde 404 — ele mostra a MESMA carta, sem nome, sem `@handle` e sem foto.
     *  As razões, em ordem de peso:
     *
     *  1. **O link é COMPARTILHADO.** Quem tem o token é um terceiro (um grupo, uma
     *     turma) que não fez nada, e o endereço já está na conversa dele. Um 404 aqui
     *     é indistinguível de "revogado" e de "vencido" — a resposta ÚNICA que este
     *     serviço dá de propósito —, então o efeito prático seria a conquista sumir
     *     sem aviso, retroativamente, para quem só recebeu um link. A medida da
     *     moderação é sobre a PESSOA, e não sobre a carta de outra pessoa.
     *
     *  2. **O EFEITO DOCUMENTADO DA E62 É SOBRE O PERFIL.** "O perfil deixa de aparecer
     *     publicamente" — e a carta não é perfil: é conquista do evento, guardada no
     *     álbum de quem a ganhou. Estender a medida à exclusão do objeto seria mais do
     *     que a decisão diz, e destruiria o registro sem que ninguém tivesse pedido.
     *
     *  3. **OCULTAR NÃO É APAGAR.** A E62 já fixou isso para o `@handle`, que continua
     *     reservado mesmo com o perfil oculto. Apagar o link de uma carta jogaria fora,
     *     de quebra, o endereço que o dono talvez queira revogar ELE MESMO — e revogar
     *     é um ato dele, com botão e trilha (F48/E70), não um efeito colateral da
     *     moderação.
     *
     *  O que muda é só o que a medida tira: o nome, o `@handle` e a foto caem para o
     *  rótulo neutro (`NEUTRAL_SHARE_NAME`), que é o mesmo caminho de quem não publica
     *  o nome. A carta, a raridade, a ficha e a data permanecem — e o dono vê na tela
     *  dele o mesmo rótulo que o link publica (`getCardShareState` usa esta régua).
     */
    const name = resolveShareName(userCard.user);

    /**
     * A FOTO segue a MESMA pergunta do nome (F60 · E79): a ocultação tira a identidade
     * inteira, e a foto é identidade. Sem ela, o cartão da carta cai na inicial — o
     * caminho que já existe para quem não publica foto.
     */
    const audiences = parseProfileAudiences(userCard.user.profileAudiences);
    const avatarVisible =
      isPersonPubliclyVisible(userCard.user) &&
      visibleProfileFields({ audiences, viewer: 'ANONYMOUS' }).includes('avatar');

    const card: SharedCardView = {
      cardName: template.name,
      rarity: template.rarity,
      palette: resolvePalette(template.palette, template.rarity),
      art,
      stage: resolveCardStage({ art, isFoil: userCard.isFoil, rarity: template.rarity }),
      isFoil: userCard.isFoil,
      quantity: userCard.quantity,
      level: userCard.level,
      grantedAt: userCard.grantedAt,
      back: cardBackContent({
        rarity: template.rarity,
        trigger: template.trigger,
        description: template.description,
        lore: template.lore,
        quantity: userCard.quantity,
        isFoil: userCard.isFoil,
        level: userCard.level,
        grantedAt: userCard.grantedAt,
        timezone: input.timezone,
      }),
      imageUrl: art.imageUrl,
      displayName: name.displayName,
      avatarUrl: avatarVisible ? userCard.user.image : null,
      sharedAt: row.createdAt,
    };

    /** Contar vem DEPOIS: a carta já está pronta e a falha do contador não a alcança. */
    if (input.registerView) {
      await registerCardShareView({ tenantId: input.tenantId, linkId: row.id });
    }

    return { ok: true, card };
  } catch (error) {
    console.error(`[gamification] falha ao ler a carta compartilhada: ${errorMessage(error)}`);
    return { ok: false, code: 'INTERNAL', message: 'Não foi possível abrir este link.' };
  }
}
