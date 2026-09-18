/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Autoria da submissão (FASE 17, item E6)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTAVA FALTANDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `SubmissionAuthor` nasce com UMA linha — o autor que submeteu — criada pelo
 *  serviço de submissão desde a FASE 4. Não havia como adicionar coautor, corrigir
 *  a ordem de crédito nem marcar o correspondente: a tela de submissão chegava a
 *  exibir o bloqueio "Informe ao menos um autor", sem oferecer campo para isso.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SUBSTITUIÇÃO TOTAL, E POR QUE ISSO IMPORTA MAIS DO QUE PARECE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `submission_authors` tem índice ÚNICO em `(submissionId, authorOrder)`. Atualizar
 *  a ordem linha a linha trocando dois autores (1↔2) violaria o índice no meio da
 *  operação: o PostgreSQL verifica a unicidade a cada `UPDATE`, não no fim da
 *  transação. A saída seria uma dança de valores temporários — frágil e invisível.
 *
 *  Por isso a edição REMOVE todas as linhas da submissão e recria na ordem nova,
 *  dentro da mesma transação. É mais simples de ler e de provar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O VÍNCULO DE CONTA É PRESERVADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Recriar as linhas derrubaria o `userId` de quem tem conta (é o que dá ao coautor
 *  acesso ao próprio crédito). Por isso, antes de apagar, os vínculos existentes são
 *  lidos por e-mail e reaplicados às linhas novas (`linkKnownAuthors`), e a busca de
 *  contas NA PLATAFORMA é restrita à instituição — casar e-mail contra a base global
 *  revelaria a existência de contas de outras instituições.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import { isEditableByAuthor, type SubmissionStatus } from '@/domain/review/submission-rules';
import {
  authorsDiffer,
  linkKnownAuthors,
  normalizeAuthors,
  toAuthorFormValues,
  type NormalizedAuthor,
} from '@/domain/review/author-rules';

export type AuthorErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'NOT_EDITABLE'
  | 'INVALID_INPUT'
  | 'INTERNAL';

export type AuthorResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AuthorErrorCode; message: string; details?: readonly string[] };

export interface SubmissionAuthorsView {
  submissionId: string;
  title: string;
  status: SubmissionStatus;
  editable: boolean;
  authors: ReturnType<typeof toAuthorFormValues>;
}

/**
 * Lê a autoria para a tela do autor.
 *
 * `editable` é calculado AQUI e não na tela: a mesma função de domínio
 * (`isEditableByAuthor`) decide o que a interface mostra e o que o serviço aceita,
 * então não existe janela em que o formulário esteja aberto e a gravação recuse.
 */
export async function getSubmissionAuthors(input: {
  tenantId: string;
  submissionId: string;
  userId: string;
}): Promise<SubmissionAuthorsView | null> {
  return withTenant(input.tenantId, async (tx) => {
    const submission = await tx.submission.findFirst({
      where: { id: input.submissionId, tenantId: input.tenantId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        submittedById: true,
        authors: {
          orderBy: { authorOrder: 'asc' },
          select: {
            userId: true,
            guestName: true,
            guestEmail: true,
            guestInstitution: true,
            guestOrcidId: true,
            institution: true,
            isCorresponding: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });

    if (!submission) return null;

    const authors = toAuthorFormValues(
      submission.authors.map((author) => ({
        userId: author.userId,
        // O nome canônico vem da CONTA quando existe: o organizador pode ter
        // digitado um apelido, e a lista de crédito deve trazer o nome cadastrado.
        name: author.user?.name ?? author.guestName,
        email: author.user?.email ?? author.guestEmail,
        institution: author.institution ?? author.guestInstitution,
        orcidId: author.guestOrcidId,
        isCorresponding: author.isCorresponding,
      })),
    );

    return {
      submissionId: submission.id,
      title: submission.title,
      status: submission.status as SubmissionStatus,
      editable: isEditableByAuthor(submission.status as SubmissionStatus),
      authors,
    };
  });
}

/**
 * Substitui a lista de autores de uma submissão.
 *
 * Regras de acesso: a submissão precisa estar em estado editável E quem edita ser o
 * autor que submeteu. Não é `:own` genérico — um coautor com conta não deve poder
 * reescrever a ordem de crédito dos outros.
 */
export async function saveSubmissionAuthors(input: {
  tenantId: string;
  submissionId: string;
  actorId: string;
  authors: readonly unknown[];
}): Promise<AuthorResult<{ count: number; changed: boolean }>> {
  try {
    const validation = normalizeAuthors(input.authors);
    if (!validation.ok) {
      return {
        ok: false as const,
        code: 'INVALID_INPUT' as const,
        message: 'A lista de autores não foi aceita.',
        details: validation.errors,
      };
    }

    return await withTenant(input.tenantId, async (tx) => {
      const submission = await tx.submission.findFirst({
        where: { id: input.submissionId, tenantId: input.tenantId, deletedAt: null },
        select: {
          id: true,
          status: true,
          submittedById: true,
          authors: {
            orderBy: { authorOrder: 'asc' },
            select: {
              userId: true,
              guestName: true,
              guestEmail: true,
              guestInstitution: true,
              guestOrcidId: true,
              institution: true,
              isCorresponding: true,
              user: { select: { name: true, email: true } },
            },
          },
        },
      });

      if (!submission) {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Submissão não encontrada.' };
      }

      if (submission.submittedById !== input.actorId) {
        return {
          ok: false as const,
          code: 'FORBIDDEN' as const,
          message: 'Apenas o autor que submeteu o trabalho pode alterar a autoria.',
        };
      }

      if (!isEditableByAuthor(submission.status as SubmissionStatus)) {
        return {
          ok: false as const,
          code: 'NOT_EDITABLE' as const,
          message:
            'A autoria só pode ser alterada antes do envio. Depois disso, o parecer aponta para a versão avaliada.',
        };
      }

      /**
       * Vínculos existentes por e-mail: preservados na recriação das linhas.
       * A chave é o e-mail em minúsculas porque é assim que o formulário devolve.
       */
      const existingByEmail = new Map<string, string>();
      for (const author of submission.authors) {
        const email = (author.user?.email ?? author.guestEmail)?.toLowerCase();
        if (author.userId && email) existingByEmail.set(email, author.userId);
      }

      /**
       * Contas conhecidas NA INSTITUIÇÃO, para o caso de o coautor já ter conta e o
       * autor só ter digitado o e-mail. A consulta é restrita ao tenant por DUAS
       * razões: casar e-mail contra a base global revelaria a existência de contas
       * de outras instituições, e a tela não lista a equipe de propósito — quem
       * submete um trabalho é, no papel `PARTICIPANT`, público do evento (armadilha
       * 24: `tenant:read` não autoriza ver a lista de pessoas da instituição).
       */
      const emails = validation.authors
        .map((author) => author.email?.toLowerCase())
        .filter((email): email is string => Boolean(email));

      const knownUsers =
        emails.length > 0
          ? await tx.user.findMany({
              where: {
                email: { in: emails, mode: 'insensitive' },
                memberships: { some: { tenantId: input.tenantId, deletedAt: null } },
              },
              select: { id: true, email: true },
            })
          : [];

      const knownMap = new Map<string, string>();
      for (const user of knownUsers) {
        knownMap.set(user.email.toLowerCase(), user.id);
      }
      for (const [email, userId] of existingByEmail) {
        if (!knownMap.has(email)) knownMap.set(email, userId);
      }

      const authors: NormalizedAuthor[] = linkKnownAuthors(validation.authors, knownMap);

      const before = toAuthorFormValues(
        submission.authors.map((author) => ({
          userId: author.userId,
          name: author.user?.name ?? author.guestName,
          email: author.user?.email ?? author.guestEmail,
          institution: author.institution ?? author.guestInstitution,
          orcidId: author.guestOrcidId,
          isCorresponding: author.isCorresponding,
        })),
      );

      const after = toAuthorFormValues(authors);

      if (!authorsDiffer(before, after)) {
        // Nada mudou: não escreve e não audita. Uma trilha cheia de "autoria
        // alterada" sem alteração esconderia a alteração que importa.
        return { ok: true as const, count: authors.length, changed: false };
      }

      /**
       * Substituição total (ver o cabeçalho): apagar e recriar dentro da mesma
       * transação. A ordem nova é contígua (1..N), então o índice único
       * `(submissionId, authorOrder)` nunca é violado.
       */
      await tx.submissionAuthor.deleteMany({ where: { submissionId: submission.id } });

      await tx.submissionAuthor.createMany({
        data: authors.map((author) => ({
          id: randomUUID(),
          tenantId: input.tenantId,
          submissionId: submission.id,
          userId: author.userId,
          guestName: author.userId ? null : author.name,
          guestEmail: author.userId ? null : author.email,
          guestInstitution: author.userId ? null : author.institution,
          guestOrcidId: author.userId ? null : author.orcidId,
          institution: author.institution,
          authorOrder: author.authorOrder,
          isCorresponding: author.isCorresponding,
        })),
      });

      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.actorId,
          action: 'UPDATE',
          entityType: 'submission',
          entityId: submission.id,
          changes: {
            authors: {
              from: before.map((author) => author.name).join(' · '),
              to: after.map((author) => author.name).join(' · '),
            },
            correspondingAuthor: {
              from: before.find((author) => author.isCorresponding)?.name ?? null,
              to: after.find((author) => author.isCorresponding)?.name ?? null,
            },
          },
        },
        tx,
      );

      return { ok: true as const, count: authors.length, changed: true };
    });
  } catch (error) {
    console.error(`[authors] falha ao salvar autoria: ${errorMessage(error)}`);
    return { ok: false as const, code: 'INTERNAL' as const, message: 'Não foi possível salvar a lista de autores.' };
  }
}
