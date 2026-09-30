/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Cadastro de palestrantes pela instituição (FASE 25)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PALESTRANTE PODE NÃO TER CONTA — E ISSO NÃO É UM CASO DE BORDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem organiza um evento conhece o convidado pelo nome e pelo e-mail institucional
 *  dele, não pelo id da conta na plataforma. Exigir cadastro prévio inverteria a
 *  ordem real do trabalho: o convite acontece ANTES de a pessoa entrar.
 *
 *  Por isso o fluxo é:
 *    1. a instituição cadastra o PERFIL (`speaker_profiles`, sem `userId`);
 *    2. vincula o perfil à atividade com o papel daquela atividade;
 *    3. gera um convite (token) e o entrega — por e-mail quando a F15 existir, hoje
 *       copiando o código na tela;
 *    4. a pessoa entra, reivindica o perfil e passa a ter o portal.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O TOKEN APARECE UMA VEZ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O que é gravado é o SHA-256. O token em claro é devolvido UMA vez, na resposta
 *  que o gerou, para o organizador copiar — depois disso nem a plataforma consegue
 *  mostrá-lo. É o mesmo desenho de uma chave de API, e é o que impede que um dump do
 *  banco (backup, suporte, relatório) permita reivindicar o perfil de alguém.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage, isUniqueViolation } from '@/lib/db/prisma-errors';
import { recordAudit, diffFields } from '@/lib/admin/audit';
import {
  DEFAULT_ROLE_TITLE,
  MAX_ROLE_TITLE_LENGTH,
  PHOTO_AUTHORIZATION_CHANNEL_LABELS,
  PHOTO_AUTHORIZATION_VERSION,
  evaluatePhotoAuthorization,
  hashInviteToken,
  inviteExpiryFrom,
  newInviteToken,
  normalizeSpeakerProfile,
  normalizePhotoAuthorizationChannel,
  photoAuthorizationChannelLabel,
  readSocialLinks,
  type PhotoAuthorizationChannel,
  type SocialLinks,
  type SpeakerAvatarSource,
} from '@/domain/speakers/speaker-rules';

export type SpeakerErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'DUPLICATE_EMAIL'
  | 'ALREADY_LINKED'
  | 'INTERNAL';

export type SpeakerResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: SpeakerErrorCode; message: string; details?: readonly string[] };

// ───────────────────────────────────────────────────────────────────────────────
//  Perfil
// ───────────────────────────────────────────────────────────────────────────────
export interface SaveSpeakerProfileInput {
  tenantId: string;
  actorId: string;
  /** Ausente cria; presente atualiza. */
  speakerProfileId?: string;
  name: string;
  email?: string | null;
  institution?: string | null;
  company?: string | null;
  roleTitle?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  /**
   * Declaração da organização de que TEM autorização do palestrante para publicar a
   * foto enviada (FASE 46).
   *
   * É a única prova que a plataforma pode guardar de um consentimento que acontece
   * fora dela — por e-mail, por telefone, no contrato do evento. Publicar a foto de
   * alguém sem esta confirmação é dado pessoal de terceiro sem base declarada.
   */
  photoAuthorization?: boolean;
  /**
   * POR ONDE o consentimento veio (FASE 51 · dívida E66).
   *
   * Obrigatório quando a foto é NOVA e a caixa acima está marcada: sem o canal, o
   * perfil diria que existe autorização sem registrar COMO ela foi obtida — que é
   * metade do que se precisa demonstrar.
   */
  photoAuthorizationChannel?: string | null;
  socialLinks?: Record<string, unknown>;
  displayOrder?: number;
  isPublic?: boolean;
}

export interface SaveSpeakerProfileOutput {
  speakerProfileId: string;
  created: boolean;
  /**
   * Token de convite em CLARO — devolvido apenas quando um convite novo é gerado.
   * Depois disso só existe o hash.
   */
  inviteToken: string | null;
  inviteExpiresAt: string | null;
}

/**
 * Cria ou atualiza o perfil do palestrante.
 *
 * O convite sai automaticamente quando há e-mail e o perfil ainda não tem conta: é
 * o momento em que o organizador está com o dado na mão, e pedir um segundo clique
 * ("agora gere o convite") é onde o convite deixa de ser enviado.
 */
export async function saveSpeakerProfile(
  input: SaveSpeakerProfileInput,
): Promise<SpeakerResult<SaveSpeakerProfileOutput>> {
  const normalization = normalizeSpeakerProfile({
    name: input.name,
    email: input.email,
    institution: input.institution,
    company: input.company,
    roleTitle: input.roleTitle,
    bio: input.bio,
    socialLinks: input.socialLinks,
  });

  if (!normalization.ok) {
    return { ok: false, code: 'INVALID_INPUT', message: normalization.errors[0]!, details: normalization.errors };
  }

  const draft = normalization.draft;

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const existing = input.speakerProfileId
        ? await tx.speakerProfile.findFirst({
            where: { id: input.speakerProfileId, tenantId: input.tenantId, deletedAt: null },
            select: {
              id: true,
              name: true,
              email: true,
              institution: true,
              company: true,
              roleTitle: true,
              bio: true,
              avatarUrl: true,
              avatarSource: true,
              socialLinks: true,
              displayOrder: true,
              isPublic: true,
              userId: true,
              // A declaração vigente entra na leitura porque a trilha registra o que
              // SAI quando a foto é removida (FASE 51 · dívida E66).
              photoAuthorizationText: true,
              photoAuthorizationVersion: true,
              photoAuthorizationChannel: true,
              photoAuthorizationAt: true,
            },
          })
        : null;

      if (input.speakerProfileId && !existing) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Palestrante não encontrado.' };
      }

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  A FOTO AUSENTE PRESERVA; A FOTO VAZIA APAGA (FASE 46)
       * ─────────────────────────────────────────────────────────────────────────────
       *  Se `avatarUrl` ausente virasse `null`, editar o NOME de um palestrante
       *  apagaria a foto que ele subiu no portal — sem aviso e sem como desfazer. É a
       *  mesma armadilha do `taxId` do patrocinador (FASE 17) e do campo de contatos
       *  do perfil público (FASE 45): campo que a tela não manda não pode ser
       *  decidido por omissão.
       *
       *  Quem enviou a foto é decidido aqui também: URL igual é a MESMA foto (a
       *  origem não muda); URL nova, enviada pela organização, é `ORGANIZATION`.
       */
      const currentAvatarUrl = existing?.avatarUrl ?? null;
      const nextAvatarUrl =
        input.avatarUrl === undefined ? currentAvatarUrl : input.avatarUrl?.trim() || null;

      const nextAvatar: { url: string | null; source: SpeakerAvatarSource | null } = {
        url: nextAvatarUrl,
        source:
          nextAvatarUrl === null
            ? null
            : nextAvatarUrl === currentAvatarUrl
              ? (existing?.avatarSource ?? null)
              : 'ORGANIZATION',
      };

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  FOTO NOVA SEM DECLARAÇÃO É RECUSA (FASE 46) — E SEM CANAL TAMBÉM (E66)
       * ─────────────────────────────────────────────────────────────────────────────
       *  A checagem é no SERVIÇO, e não na tela, porque é aqui que se sabe se a foto
       *  MUDOU: exigir a declaração a cada gravação transformaria a caixa em ruído
       *  (o organizador marcaria sem ler para salvar uma correção de nome), e a
       *  declaração precisa significar alguma coisa no dia em que for questionada.
       *
       *  A partir da E66 a foto nova também exige o CANAL: o texto e a versão dizem
       *  O QUE foi aceito, o canal diz COMO o consentimento chegou, e a data diz
       *  QUANDO. Faltando o canal, o perfil voltaria a guardar só a afirmação — que é
       *  exatamente a dívida que esta fase quita.
       */
      const declaration = evaluatePhotoAuthorization({
        previousPhotoUrl: currentAvatarUrl,
        nextPhotoUrl: nextAvatar.url,
        declared: input.photoAuthorization === true,
        channel: input.photoAuthorizationChannel,
        at: new Date(),
      });

      if (!declaration.ok) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: declaration.message,
        };
      }

      const data = {
        name: draft.name,
        email: draft.email,
        institution: draft.institution,
        company: draft.company,
        roleTitle: draft.roleTitle,
        bio: draft.bio,
        socialLinks: draft.socialLinks as unknown as object,
        avatarUrl: nextAvatar.url,
        avatarSource: nextAvatar.source,
        displayOrder: input.displayOrder ?? existing?.displayOrder ?? 0,
        isPublic: input.isPublic ?? existing?.isPublic ?? true,
        /**
         * ─────────────────────────────────────────────────────────────────────────────
         *  OS QUATRO CAMPOS DA DECLARAÇÃO ANDAM JUNTOS (FASE 51 · dívida E66)
         * ─────────────────────────────────────────────────────────────────────────────
         *  Texto, versão, canal e data entram na MESMA gravação: guardar a data sem o
         *  canal (ou o canal sem o texto) deixaria a prova pela metade — e a metade que
         *  falta é justamente a que alguém questionaria depois.
         *
         *  Ausente PRESERVA (é o que faz "trocar só o nome" não reescrever a declaração
         *  vigente) e a REMOÇÃO limpa os quatro: a declaração era sobre aquela foto, e
         *  o perfil não pode afirmar base legal para uma imagem que saiu do ar. O fato
         *  não se perde — a trilha guarda o que foi retirado, com autor e hora.
         */
        ...(declaration.write
          ? {
              photoAuthorizationText: declaration.write.text,
              photoAuthorizationVersion: declaration.write.version,
              photoAuthorizationChannel: declaration.write.channel,
              photoAuthorizationAt: declaration.write.at,
            }
          : declaration.clear
            ? {
                photoAuthorizationText: null,
                photoAuthorizationVersion: null,
                photoAuthorizationChannel: null,
                photoAuthorizationAt: null,
              }
            : {}),
      };

      if (!existing) {
        const id = randomUUID();
        const invite = draft.email ? newInviteToken() : null;

        await tx.speakerProfile.create({
          data: {
            id,
            tenantId: input.tenantId,
            ...data,
            createdById: input.actorId,
            inviteTokenHash: invite ? hashInviteToken(invite) : null,
            inviteExpiresAt: invite ? inviteExpiryFrom(new Date()) : null,
            inviteSentAt: invite ? new Date() : null,
          },
        });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'CREATE',
            entityType: 'speakerProfile',
            entityId: id,
            changes: {
              name: { from: null, to: draft.name },
              email: { from: null, to: draft.email },
              convite: { from: null, to: invite ? 'gerado' : 'sem e-mail' },
              // A declaração de autorização da foto vale no NASCIMENTO do perfil
              // também — é aqui que ela costuma acontecer, com a foto já em mãos.
              // Desde a E66 o canal e a versão da redação entram junto: quem lê a
              // trilha não precisa adivinhar sob qual texto a autorização foi dada.
              ...(declaration.write
                ? {
                    foto: { from: null, to: 'enviada pela organização' },
                    autorizacaoDaFoto: { from: null, to: 'declarada pela organização' },
                    canalDaAutorizacao: {
                      from: null,
                      to: PHOTO_AUTHORIZATION_CHANNEL_LABELS[declaration.write.channel],
                    },
                    versaoDaAutorizacao: { from: null, to: declaration.write.version },
                  }
                : {}),
            },
          },
          tx,
        );

        return {
          ok: true as const,
          speakerProfileId: id,
          created: true,
          inviteToken: invite,
          inviteExpiresAt: invite ? inviteExpiryFrom(new Date()).toISOString() : null,
        };
      }

      /**
       * E-mail é a chave do vínculo automático. Trocá-lo num perfil já
       * reivindicado desvincularia a pessoa na prática (o convite por e-mail
       * apontaria para o perfil de outro), então a troca é recusada com o motivo.
       */
      if (existing.userId && draft.email !== existing.email) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message:
            'O e-mail de um palestrante já vinculado a uma conta não pode ser alterado por aqui — é ele que identifica a pessoa no portal.',
        };
      }

      await tx.speakerProfile.update({ where: { id: existing.id }, data });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'speakerProfile',
          entityId: existing.id,
          changes: {
            ...diffFields(
              {
                name: existing.name,
                email: existing.email,
                institution: existing.institution,
                company: existing.company,
                roleTitle: existing.roleTitle,
                bio: existing.bio,
                avatarUrl: existing.avatarUrl,
                // A trilha guarda a TROCA DE ORIGEM da foto: quem lê a auditoria
                // entende que a imagem publicada passou a ser da organização.
                avatarSource: existing.avatarSource,
                displayOrder: existing.displayOrder,
                isPublic: existing.isPublic,
              },
              data,
              [
                'name',
                'email',
                'institution',
                'company',
                'roleTitle',
                'bio',
                'avatarUrl',
                'avatarSource',
                'displayOrder',
                'isPublic',
              ],
            ),
            /**
             * A DECLARAÇÃO entra na trilha como fato próprio, e não misturada à foto:
             * se um dia o uso da imagem for questionado, o que se procura é QUEM
             * declarou ter autorização e QUANDO — e a trilha responde isso sem
             * depender de interpretar a mudança da coluna. Desde a E66 o texto
             * (versão) e o canal vão junto: é a trilha que reconstrói o que foi
             * aceito depois que a foto sai do ar e os campos do perfil são limpos.
             */
            ...(declaration.write
              ? {
                  autorizacaoDaFoto: { from: null, to: 'declarada pela organização' },
                  canalDaAutorizacao: {
                    from: null,
                    to: PHOTO_AUTHORIZATION_CHANNEL_LABELS[declaration.write.channel],
                  },
                  versaoDaAutorizacao: { from: null, to: declaration.write.version },
                }
              : {}),
            ...(declaration.clear
              ? {
                  autorizacaoDaFoto: {
                    from:
                      existing.photoAuthorizationVersion === null
                        ? 'declarada pela organização'
                        : `declarada pela organização (${existing.photoAuthorizationVersion})`,
                    to: 'retirada com a foto',
                  },
                  canalDaAutorizacao: {
                    from: photoAuthorizationChannelLabel(existing.photoAuthorizationChannel),
                    to: null,
                  },
                }
              : {}),
          },
        },
        tx,
      );

      return {
        ok: true as const,
        speakerProfileId: existing.id,
        created: false,
        inviteToken: null,
        inviteExpiresAt: null,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false as const,
        code: 'DUPLICATE_EMAIL' as const,
        message: 'Já existe um palestrante com este e-mail nesta instituição.',
      };
    }

    console.error(`[speakers] falha ao salvar perfil: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível salvar o palestrante.' };
  }
}

/**
 * Gera um convite novo, invalidando o anterior.
 *
 * Regerar é a operação normal quando o convite expira ou quando o organizador
 * percebe que mandou o código para o contato errado — e é justamente por isso que o
 * convite antigo precisa morrer aqui: dois tokens válidos para o mesmo perfil
 * significam que o vazamento do primeiro continua funcionando.
 */
export async function regenerateSpeakerInvite(input: {
  tenantId: string;
  actorId: string;
  speakerProfileId: string;
}): Promise<SpeakerResult<{ inviteToken: string; inviteExpiresAt: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const profile = await tx.speakerProfile.findFirst({
        where: { id: input.speakerProfileId, tenantId: input.tenantId, deletedAt: null },
        select: { id: true, email: true, userId: true, inviteTokenHash: true },
      });

      if (!profile) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Palestrante não encontrado.' };
      }

      if (!profile.email) {
        return {
          ok: false as const,
          code: 'INVALID_INPUT' as const,
          message: 'Cadastre o e-mail do palestrante antes de gerar um convite.',
        };
      }

      if (profile.userId) {
        return {
          ok: false as const,
          code: 'ALREADY_LINKED' as const,
          message: 'Este palestrante já tem conta vinculada — não há convite a gerar.',
        };
      }

      const token = newInviteToken();
      const expiresAt = inviteExpiryFrom(new Date());

      await tx.speakerProfile.update({
        where: { id: profile.id },
        data: {
          inviteTokenHash: hashInviteToken(token),
          inviteExpiresAt: expiresAt,
          inviteSentAt: new Date(),
        },
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'speakerProfile',
          entityId: profile.id,
          changes: {
            convite: {
              from: profile.inviteTokenHash ? 'anterior (invalidado)' : null,
              to: 'novo convite gerado',
            },
          },
        },
        tx,
      );

      return { ok: true as const, inviteToken: token, inviteExpiresAt: expiresAt.toISOString() };
    });
  } catch (error) {
    console.error(`[speakers] falha ao gerar convite: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível gerar o convite.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Vínculo com a atividade
// ───────────────────────────────────────────────────────────────────────────────
export interface LinkSpeakerInput {
  tenantId: string;
  actorId: string;
  activityId: string;
  speakerProfileId: string;
  roleTitle?: string | null;
  isKeynote?: boolean;
  displayOrder?: number;
  /** Sobrepõe a carga da atividade para este palestrante (divisão de um minicurso). */
  workloadMinutes?: number | null;
}

/**
 * Vincula o palestrante a uma atividade.
 *
 * A identidade continua no PERFIL e é copiada para as colunas legadas do vínculo
 * (`guestName`, `guestEmail`, `userId`) para que a agenda, o certificado e o
 * repositório público continuem funcionando sem conhecer o perfil. É a única
 * duplicação aceita nesta fase, e ela é mantida em um lugar só (aqui e no serviço do
 * portal), nunca em duas telas.
 */
export async function linkSpeakerToActivity(
  input: LinkSpeakerInput,
): Promise<SpeakerResult<{ linkId: string; created: boolean }>> {
  const roleTitle = (input.roleTitle ?? '').trim();

  if (roleTitle.length > MAX_ROLE_TITLE_LENGTH) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `O papel na atividade deve ter até ${MAX_ROLE_TITLE_LENGTH} caracteres.`,
    };
  }

  try {
    return await withTenant(input.tenantId, async (tx) => {
      const [profile, activity] = await Promise.all([
        tx.speakerProfile.findFirst({
          where: { id: input.speakerProfileId, tenantId: input.tenantId, deletedAt: null },
          select: { id: true, name: true, email: true, institution: true, bio: true, userId: true, roleTitle: true },
        }),
        tx.activity.findFirst({
          where: { id: input.activityId, tenantId: input.tenantId, deletedAt: null },
          select: { id: true, eventId: true, workloadMinutes: true },
        }),
      ]);

      if (!profile) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Palestrante não encontrado.' };
      }

      if (!activity) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Atividade não encontrada.' };
      }

      const existing = await tx.activitySpeaker.findFirst({
        where: { tenantId: input.tenantId, activityId: activity.id, speakerProfileId: profile.id },
        select: { id: true, roleTitle: true, isKeynote: true, displayOrder: true, workloadMinutes: true },
      });

      const data = {
        speakerProfileId: profile.id,
        userId: profile.userId,
        guestName: profile.name,
        guestEmail: profile.email,
        guestInstitution: profile.institution,
        guestBio: profile.bio,
        roleTitle: roleTitle.length > 0 ? roleTitle : (profile.roleTitle ?? DEFAULT_ROLE_TITLE),
        isKeynote: input.isKeynote ?? existing?.isKeynote ?? false,
        displayOrder: input.displayOrder ?? existing?.displayOrder ?? 0,
        workloadMinutes:
          input.workloadMinutes === undefined
            ? (existing?.workloadMinutes ?? activity.workloadMinutes)
            : input.workloadMinutes,
      };

      if (existing) {
        await tx.activitySpeaker.update({ where: { id: existing.id }, data });

        await recordAudit(
          {
            tenantId: input.tenantId,
            userId: input.actorId,
            action: 'UPDATE',
            entityType: 'activitySpeaker',
            entityId: existing.id,
            changes: diffFields(existing, data, ['roleTitle', 'isKeynote', 'displayOrder', 'workloadMinutes']),
          },
          tx,
        );

        return { ok: true as const, linkId: existing.id, created: false };
      }

      const linkId = randomUUID();

      await tx.activitySpeaker.create({ data: { id: linkId, tenantId: input.tenantId, activityId: activity.id, ...data } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'CREATE',
          entityType: 'activitySpeaker',
          entityId: linkId,
          changes: {
            palestrante: { from: null, to: profile.name },
            papel: { from: null, to: data.roleTitle },
          },
        },
        tx,
      );

      return { ok: true as const, linkId, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false as const,
        code: 'ALREADY_LINKED' as const,
        message: 'Este palestrante já está vinculado à atividade.',
      };
    }

    console.error(`[speakers] falha ao vincular palestrante: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível vincular o palestrante.' };
  }
}

/** Desfaz o vínculo (a atividade continua; o palestrante continua cadastrado). */
export async function unlinkSpeakerFromActivity(input: {
  tenantId: string;
  actorId: string;
  linkId: string;
}): Promise<SpeakerResult<{ linkId: string }>> {
  try {
    return await withTenant(input.tenantId, async (tx) => {
      const link = await tx.activitySpeaker.findFirst({
        where: { id: input.linkId, tenantId: input.tenantId },
        select: { id: true, activityId: true, guestName: true, speakerProfileId: true },
      });

      if (!link) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Vínculo não encontrado.' };
      }

      /**
       * ─────────────────────────────────────────────────────────────────────────
       *  OS MATERIAIS DO VÍNCULO SAEM JUNTO — E ISSO É DELIBERADO
       * ─────────────────────────────────────────────────────────────────────────
       *  Material é do PAR (palestrante × atividade). Se o vínculo deixou de
       *  existir, o material perderia o dono e continuaria aparecendo na página
       *  pública — um PDF que ninguém mais responde por ele. Desvinculamos por
       *  exclusão lógica (a trilha guarda quem enviou) em vez de apagar de facto.
       */
      const materials = await tx.speakerMaterial.updateMany({
        where: {
          tenantId: input.tenantId,
          activityId: link.activityId,
          ...(link.speakerProfileId ? { speakerProfileId: link.speakerProfileId } : {}),
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });

      await tx.activitySpeaker.delete({ where: { id: link.id } });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'DELETE',
          entityType: 'activitySpeaker',
          entityId: link.id,
          changes: {
            palestrante: { from: link.guestName, to: null },
            materiaisDespublicados: { from: materials.count, to: 0 },
          },
        },
        tx,
      );

      return { ok: true as const, linkId: link.id };
    });
  } catch (error) {
    console.error(`[speakers] falha ao desvincular palestrante: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível desvincular o palestrante.' };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
//  Leitura para a tela da organização
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A declaração de autorização da foto publicada, como a tela precisa dela
 * (FASE 51 · dívida E66).
 *
 * `null` quando não há declaração gravada — o caso das fotos publicadas antes desta
 * fase e o da foto que o próprio palestrante enviou (ele não declara nada: ele é o
 * titular). A tela diz QUAL redação está valendo em vez de um rótulo genérico.
 */
export interface SpeakerPhotoDeclaration {
  text: string;
  version: string | null;
  channel: PhotoAuthorizationChannel | null;
  /** Rótulo em português do canal gravado (o valor cru não vai para a tela). */
  channelLabel: string | null;
  at: Date | null;
  /** A redação gravada ainda é a vigente? `false` = aceita sob texto anterior. */
  versionIsCurrent: boolean;
}

export interface AdminSpeakerRow {
  speakerProfileId: string;
  name: string;
  email: string | null;
  institution: string | null;
  company: string | null;
  roleTitle: string | null;
  bio: string | null;
  avatarUrl: string | null;
  /** Quem enviou a foto (FASE 46) — a tela marca a que veio da organização. */
  avatarSource: SpeakerAvatarSource | null;
  /** Declaração vigente da foto publicada (FASE 51 · dívida E66). */
  photoDeclaration: SpeakerPhotoDeclaration | null;
  isPublic: boolean;
  isConfirmed: boolean;
  hasAccount: boolean;
  hasPendingInvite: boolean;
  inviteExpiresAt: Date | null;
  socialLinks: SocialLinks;
  activities: { linkId: string; activityId: string; title: string; roleTitle: string | null; isKeynote: boolean }[];
  materialCount: number;
}

/** Palestrantes da instituição (com os vínculos de um evento, quando informado). */
export async function listSpeakers(input: {
  tenantId: string;
  eventId?: string;
}): Promise<AdminSpeakerRow[]> {
  return withTenant(input.tenantId, async (tx) => {
    const profiles = await tx.speakerProfile.findMany({
      where: {
        tenantId: input.tenantId,
        deletedAt: null,
        /**
         * ─────────────────────────────────────────────────────────────────────────────
         *  QUEM NÃO ESTÁ EM NENHUMA ATIVIDADE APARECE SEMPRE (FASE 25)
         * ─────────────────────────────────────────────────────────────────────────────
         *  Filtrar só por "tem vínculo neste evento" fazia o palestrante recém-cadastrado
         *  DESAPARECER da tela antes de ser vinculado: o organizador salvava, lia
         *  "cadastrado" e não achava mais o convite que acabara de gerar — nem o botão de
         *  regerá-lo. Um perfil sem vínculo nenhum está em CADASTRO, e é justamente na
         *  tela do evento onde ele vai ser vinculado.
         */
        ...(input.eventId
          ? {
              OR: [
                { activityLinks: { some: { activity: { eventId: input.eventId } } } },
                { activityLinks: { none: {} } },
              ],
            }
          : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      take: 300,
      select: {
        id: true,
        name: true,
        email: true,
        institution: true,
        company: true,
        roleTitle: true,
        bio: true,
        avatarUrl: true,
        avatarSource: true,
        // A declaração vigente vai para a TELA: quem publica precisa poder conferir
        // sob qual redação, por qual canal e quando a autorização foi declarada —
        // e não apenas ver uma caixa marcada (FASE 51 · dívida E66).
        photoAuthorizationText: true,
        photoAuthorizationVersion: true,
        photoAuthorizationChannel: true,
        photoAuthorizationAt: true,
        socialLinks: true,
        isPublic: true,
        isConfirmed: true,
        userId: true,
        inviteTokenHash: true,
        inviteExpiresAt: true,
        activityLinks: {
          where: input.eventId ? { activity: { eventId: input.eventId } } : {},
          orderBy: { displayOrder: 'asc' },
          select: {
            id: true,
            activityId: true,
            roleTitle: true,
            isKeynote: true,
            activity: { select: { title: true } },
          },
        },
        _count: { select: { materials: true } },
      },
    });

    return profiles.map((profile) => ({
      speakerProfileId: profile.id,
      name: profile.name,
      email: profile.email,
      institution: profile.institution,
      company: profile.company,
      roleTitle: profile.roleTitle,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      avatarSource: profile.avatarSource,
      photoDeclaration:
        profile.photoAuthorizationText === null && profile.photoAuthorizationAt === null
          ? null
          : {
              text: profile.photoAuthorizationText ?? '',
              version: profile.photoAuthorizationVersion,
              channel: normalizePhotoAuthorizationChannel(profile.photoAuthorizationChannel),
              channelLabel: photoAuthorizationChannelLabel(profile.photoAuthorizationChannel),
              at: profile.photoAuthorizationAt,
              versionIsCurrent: profile.photoAuthorizationVersion === PHOTO_AUTHORIZATION_VERSION,
            },
      isPublic: profile.isPublic,
      isConfirmed: profile.isConfirmed,
      hasAccount: profile.userId !== null,
      hasPendingInvite: profile.userId === null && profile.inviteTokenHash !== null,
      inviteExpiresAt: profile.inviteExpiresAt,
      socialLinks: readSocialLinks(profile.socialLinks),
      activities: profile.activityLinks.map((link) => ({
        linkId: link.id,
        activityId: link.activityId,
        title: link.activity?.title ?? 'Atividade',
        roleTitle: link.roleTitle,
        isKeynote: link.isKeynote,
      })),
      materialCount: profile._count.materials,
    }));
  });
}

/**
 * Ementa/requisitos/bibliografia de UMA atividade, para a página pública.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE SÓ UM CONJUNTO, E DO PRIMEIRO QUE ESCREVEU
 * ─────────────────────────────────────────────────────────────────────────────
 *  A contribuição é do VÍNCULO (palestrante × atividade), então um minicurso com dois
 *  instrutores pode ter dois textos. A página pública mostra o do primeiro na ordem
 *  da agenda — e diz de quem é (`speakerName`). Concatenar os dois produziria um
 *  texto que nenhuma das duas pessoas escreveu; e escolher "o mais recente" faria a
 *  ementa mudar sozinha conforme quem editou por último.
 *
 *  Devolve `null` quando nenhum vínculo escreveu nada — a página simplesmente não
 *  mostra a seção.
 */
export async function loadActivityNotes(
  tenantId: string,
  activityId: string,
): Promise<{
  speakerProfileId: string | null;
  speakerName: string;
  syllabus: string | null;
  requirements: string | null;
  bibliography: string | null;
} | null> {
  return withTenant(tenantId, async (tx) => {
    const links = await tx.activitySpeaker.findMany({
      where: {
        tenantId,
        activityId,
        OR: [{ syllabus: { not: null } }, { requirements: { not: null } }, { bibliography: { not: null } }],
      },
      orderBy: [{ isKeynote: 'desc' }, { displayOrder: 'asc' }],
      take: 5,
      select: {
        speakerProfileId: true,
        syllabus: true,
        requirements: true,
        bibliography: true,
        guestName: true,
        user: { select: { name: true } },
        speakerProfile: { select: { name: true, isPublic: true, deletedAt: true } },
      },
    });

    const first = links.find((link) => {
      const hasText =
        (link.syllabus?.trim().length ?? 0) > 0 ||
        (link.requirements?.trim().length ?? 0) > 0 ||
        (link.bibliography?.trim().length ?? 0) > 0;

      if (!hasText) return false;

      /**
       * Perfil oculto ou removido não ASSINA texto na página pública: o palestrante
       * pediu para não aparecer, e assinar a ementa é aparecer.
       */
      if (link.speakerProfile && (!link.speakerProfile.isPublic || link.speakerProfile.deletedAt !== null)) {
        return false;
      }

      return true;
    });

    if (!first) return null;

    return {
      speakerProfileId: first.speakerProfileId,
      speakerName: first.speakerProfile?.name ?? first.user?.name ?? first.guestName ?? 'Palestrante',
      syllabus: first.syllabus,
      requirements: first.requirements,
      bibliography: first.bibliography,
    };
  });
}

/** Atividades do evento (para o seletor do vínculo). */
export async function listEventActivitiesForSpeakers(  tenantId: string,
  eventId: string,
): Promise<{ id: string; title: string; startsAt: Date }[]> {
  return withTenant(tenantId, (tx) =>
    tx.activity.findMany({
      where: { tenantId, eventId, deletedAt: null },
      orderBy: { startsAt: 'asc' },
      take: 200,
      select: { id: true, title: true, startsAt: true },
    }),
  );
}

/**
 * Registra o aceite do convite: vincula a conta ao perfil e concede o papel.
 *
 * Roda em UMA transação porque as três coisas precisam acontecer juntas: o vínculo,
 * a confirmação e o papel. Se o papel falhar, a pessoa entraria no portal para não
 * poder fazer nada; se o vínculo falhar, o papel daria acesso a nenhum dado.
 */
export async function attachSpeakerAccount(
  tx: TxClient,
  input: {
    tenantId: string;
    userId: string;
    speakerProfileId: string;
    /** Novo e-mail a gravar no perfil (divergência entre convite e conta). */
    updateEmailTo: string | null;
    actorId: string;
  },
): Promise<void> {
  const profile = await tx.speakerProfile.findFirst({
    where: { id: input.speakerProfileId, tenantId: input.tenantId },
    select: { id: true, name: true, email: true, userId: true },
  });

  if (!profile) return;

  await tx.speakerProfile.update({
    where: { id: profile.id },
    data: {
      userId: input.userId,
      isConfirmed: true,
      // O convite morre ao ser usado: um token válido depois do aceite permitiria a
      // um terceiro reivindicar o mesmo perfil.
      inviteTokenHash: null,
      inviteExpiresAt: null,
      ...(input.updateEmailTo ? { email: input.updateEmailTo } : {}),
    },
  });

  /**
   * O vínculo antigo (`activity_speakers.userId`) é preenchido agora: é ele que a
   * agenda pública, o certificado e o credenciamento consultam. Sem isso, o
   * palestrante acabaria de reivindicar o perfil e continuaria invisível para o
   * resto do sistema.
   */
  await tx.activitySpeaker.updateMany({
    where: { tenantId: input.tenantId, speakerProfileId: profile.id, userId: null },
    data: { userId: input.userId },
  });

  const links = await tx.activitySpeaker.findMany({
    where: { tenantId: input.tenantId, speakerProfileId: profile.id },
    select: { activityId: true, activity: { select: { eventId: true } } },
  });

  const live = await tx.roleAssignment.findMany({
    where: { tenantId: input.tenantId, userId: input.userId, role: 'SPEAKER', revokedAt: null },
    select: { activityId: true, eventId: true, scope: true },
  });

  for (const link of links) {
    const eventId = link.activity?.eventId ?? null;
    const alreadyGranted = live.some(
      (assignment) => assignment.scope === 'ACTIVITY' && assignment.activityId === link.activityId,
    );

    if (alreadyGranted) continue;

    /**
     * Escopo `ACTIVITY`, e não `EVENT`: o papel de palestrante vale no que ele
     * ministra. Conceder no evento inteiro daria a um convidado de um minicurso a
     * mesma visibilidade de quem coordena a programação.
     */
    try {
      await tx.roleAssignment.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          role: 'SPEAKER',
          scope: 'ACTIVITY',
          activityId: link.activityId,
          eventId,
          reason: 'Reivindicação de perfil de palestrante (FASE 25)',
        },
      });
    } catch (error) {
      // Corrida esperada: a concessão é idempotente por natureza (índice único
      // parcial de concessão vigente). O papel que ela queria conceder já existe.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  await recordAudit(
    {
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'PERMISSION_CHANGE',
      entityType: 'speakerProfile',
      entityId: profile.id,
      changes: {
        conta: { from: null, to: 'vinculada' },
        email: { from: profile.email, to: input.updateEmailTo ?? profile.email },
        papel: { from: null, to: `SPEAKER (${links.length} atividade(s))` },
      },
    },
    tx,
  );
}
