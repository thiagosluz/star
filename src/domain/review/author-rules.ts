/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CAMADA DE DOMÍNIO — Autoria de submissão (coautores)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A AUTORIA PRECISOU DE REGRA PRÓPRIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 16 a lista de autores tinha EXATAMENTE UMA linha: quem submeteu,
 *  inserido pelo serviço de criação. Não havia como errar porque não havia como
 *  editar — e o efeito colateral é que todo trabalho com coautoria nascia
 *  incompleto, com o crédito errado.
 *
 *  Abrir a edição traz três regras que o formulário não tem como garantir:
 *
 *    1. **Ordem de crédito é informação acadêmica.** Quem é o primeiro autor não é
 *       preferência de layout: define citação, currículo e bolsa. A ordem enviada
 *       é reescrita para 1..N, sem buracos e sem empates.
 *    2. **Autor correspondente é UM só.** É quem responde pelo trabalho; dois
 *       correspondentes fazem a secretaria não saber com quem falar.
 *    3. **Autoria só se edita enquanto o trabalho é editável.** Depois do envio, a
 *       lista está congelada no `blindSnapshot` — mudá-la em silêncio faria o
 *       parecer apontar para uma autoria que não foi avaliada.
 *
 *  As três são funções puras, testáveis sem banco.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { z } from 'zod';

/** Teto de coautores: acima disso a lista deixa de ser legível na página do parecer. */
export const MAX_SUBMISSION_AUTHORS = 20;

export const ORCID_PATTERN = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/**
 * Autor como o formulário envia.
 *
 * `userId` só é preenchido quando o coautor JÁ TEM CONTA na plataforma — e nesse
 * caso o vínculo é preservado, porque é ele que dá ao coautor acesso ao próprio
 * crédito. Sem conta, os dados são de convidado (`guest*`), que é o caso comum:
 * a maioria dos coautores não usa a plataforma.
 */
/**
 * Campo opcional que trata TEXTO VAZIO como ausente.
 *
 * O formulário de autoria envia uma linha por autor, e o que o organizador deixou
 * em branco chega como string vazia — não como campo ausente. Sem esta normalização,
 * `email: "  "` seria recusado como "e-mail inválido" e o autor não conseguiria
 * salvar a lista só porque não preencheu o e-mail do coautor. Vazio é ausência, não
 * erro.
 */
function optionalText<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

export const authorInputSchema = z.object({
  userId: optionalText(z.string().uuid()),
  name: z.string().trim().min(3, 'O nome do autor precisa ter ao menos 3 caracteres.').max(160),
  email: optionalText(z.email('E-mail do autor inválido.').max(255)),
  institution: optionalText(z.string().trim().max(200)),
  orcidId: optionalText(
    z
      .string()
      .trim()
      .regex(ORCID_PATTERN, 'ORCID deve estar no formato 0000-0000-0000-0000.'),
  ),
  isCorresponding: z.coerce.boolean().default(false),
});

export type AuthorInput = z.input<typeof authorInputSchema>;

/** Autor normalizado, pronto para gravação. */
export interface NormalizedAuthor {
  userId: string | null;
  name: string;
  email: string | null;
  institution: string | null;
  orcidId: string | null;
  isCorresponding: boolean;
  authorOrder: number;
}

export type AuthorsValidation =
  | { ok: true; authors: NormalizedAuthor[] }
  | { ok: false; errors: readonly string[] };

/**
 * Normaliza e valida a lista de autores.
 *
 * Regras aplicadas, nesta ordem:
 *   • a lista precisa ter ao menos um autor (uma submissão sem autor não existe);
 *   • a ordem RECEBIDA é a ordem de crédito — a lista é reindexada 1..N, o que
 *     elimina buracos e empates vindos do formulário;
 *   • e-mails repetidos e o MATCH por e-mail são tratados aqui, não na tela: dois
 *     registros do mesmo autor é o defeito clássico de quem adiciona "mais um" e
 *     esquece que já estava na lista;
 *   • exatamente um correspondente: se o formulário não marcar nenhum, o PRIMEIRO
 *     passa a ser (é o que a academia espera); se marcar vários, vale o primeiro.
 */
export function normalizeAuthors(raw: readonly unknown[]): AuthorsValidation {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, errors: ['Informe ao menos um autor.'] };
  }

  if (raw.length > MAX_SUBMISSION_AUTHORS) {
    return {
      ok: false,
      errors: [`Uma submissão aceita no máximo ${MAX_SUBMISSION_AUTHORS} autores.`],
    };
  }

  const errors: string[] = [];
  const parsed: z.output<typeof authorInputSchema>[] = [];

  raw.forEach((entry, index) => {
    const result = authorInputSchema.safeParse(entry);
    if (!result.success) {
      const position = index + 1;
      errors.push(
        ...result.error.issues.map((issue) => `Autor ${position}: ${issue.message}`),
      );
      return;
    }
    parsed.push(result.data);
  });

  if (errors.length > 0) return { ok: false, errors };

  // ── Duplicidade por e-mail ────────────────────────────────────────────────
  const seenEmails = new Set<string>();
  parsed.forEach((author, index) => {
    if (!author.email) return;
    const key = author.email.toLowerCase();
    if (seenEmails.has(key)) {
      errors.push(`Autor ${index + 1}: este e-mail já está na lista de autores.`);
      return;
    }
    seenEmails.add(key);
  });

  // ── Duplicidade por conta ─────────────────────────────────────────────────
  const seenUsers = new Set<string>();
  parsed.forEach((author, index) => {
    if (!author.userId) return;
    if (seenUsers.has(author.userId)) {
      errors.push(`Autor ${index + 1}: esta conta já está na lista de autores.`);
      return;
    }
    seenUsers.add(author.userId);
  });

  if (errors.length > 0) return { ok: false, errors };

  /**
   * O correspondente é decidido AQUI, e não pelo que veio marcado: se ninguém
   * marcou, o primeiro assume; se mais de um marcou, o primeiro marcado vence. A
   * lista nunca sai sem correspondente — e nunca sai com dois.
   */
  const markedIndex = parsed.findIndex((author) => author.isCorresponding);
  const correspondingIndex = markedIndex >= 0 ? markedIndex : 0;

  const authors: NormalizedAuthor[] = parsed.map((author, index) => ({
    userId: author.userId ?? null,
    name: author.name,
    email: author.email ?? null,
    institution: author.institution ?? null,
    orcidId: author.orcidId ?? null,
    isCorresponding: index === correspondingIndex,
    authorOrder: index + 1,
  }));

  return { ok: true, authors };
}

/**
 * Converte a lista para o formato do formulário (ida e volta pela tela).
 *
 * Vive no domínio porque a tela e o serviço precisam concordar sobre o que é
 * "ordem atual": se a tela montasse a lista por conta própria, um autor removido
 * voltaria na próxima edição por estar numa posição que o formulário ainda envia.
 */
export function toAuthorFormValues(
  authors: readonly {
    userId?: string | null;
    guestName?: string | null;
    name?: string | null;
    guestEmail?: string | null;
    email?: string | null;
    institution?: string | null;
    guestInstitution?: string | null;
    guestOrcidId?: string | null;
    orcidId?: string | null;
    isCorresponding?: boolean;
  }[],
): {
  userId: string | null;
  name: string;
  email: string | null;
  institution: string | null;
  orcidId: string | null;
  isCorresponding: boolean;
}[] {
  return authors.map((author) => ({
    userId: author.userId ?? null,
    name: (author.name ?? author.guestName ?? '').trim(),
    email: (author.email ?? author.guestEmail ?? null) || null,
    institution: (author.institution ?? author.guestInstitution ?? null) || null,
    orcidId: (author.orcidId ?? author.guestOrcidId ?? null) || null,
    isCorresponding: author.isCorresponding ?? false,
  }));
}

/**
 * A lista mudou? Comparação por conteúdo, campo a campo, na ordem de crédito.
 *
 * Usada para auditar só quando houve mudança real: registrar "autoria alterada" a
 * cada salvamento sem alteração transformaria a trilha em ruído e esconderia a
 * mudança que importa.
 */
export function authorsDiffer(
  before: readonly ReturnType<typeof toAuthorFormValues>[number][],
  after: readonly ReturnType<typeof toAuthorFormValues>[number][],
): boolean {
  if (before.length !== after.length) return true;

  return before.some((author, index) => {
    const other = after[index];
    if (!other) return true;

    return (
      author.name !== other.name ||
      author.email !== other.email ||
      author.institution !== other.institution ||
      author.orcidId !== other.orcidId ||
      author.isCorresponding !== other.isCorresponding ||
      author.userId !== other.userId
    );
  });
}

/**
 * Reaproveita o vínculo de conta pelo e-mail.
 *
 * Quando o organizador digita o e-mail de um coautor que TEM conta na plataforma,
 * o autor entra como pessoas vinculada — é o que permite ao coautor ver o próprio
 * crédito. `knownUsers` vem de uma consulta restrita à instituição: casar por
 * e-mail com a base GLOBAL seria vazar existência de conta entre instituições.
 */
export function linkKnownAuthors(
  authors: readonly NormalizedAuthor[],
  knownUsers: ReadonlyMap<string, string>,
): NormalizedAuthor[] {
  return authors.map((author) => {
    if (author.userId || !author.email) return author;

    const userId = knownUsers.get(author.email.toLowerCase());
    return userId ? { ...author, userId } : author;
  });
}
