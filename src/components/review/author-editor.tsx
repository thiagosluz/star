'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react';

import type { ActionState } from '@/app/actions/review-actions';
import { Button, Input } from '@/components/ui';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AUTORIA DA SUBMISSÃO — COAUTORES (FASE 17, item E6)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ORDEM NA TELA É A ORDEM DE CRÉDITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quem é o primeiro autor define citação, currículo e bolsa — não é preferência de
 *  layout. Por isso a lista tem "subir"/"descer" e a numeração é explícita, em vez
 *  de a ordem depender da sequência em que o organizador clicou em "adicionar".
 *
 *  O primeiro da lista é o autor correspondente por PADRÃO (é o que a academia
 *  espera); a marcação é um único `radio`, então não existe estado "dois
 *  correspondentes" na tela. O servidor reforça a regra de qualquer forma
 *  (`normalizeAuthors`).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE OS CAMPOS SÃO LISTAS PARALELAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Server Action recebe `FormData`, não JSON. Cada linha gera um `authorName`,
 *  um `authorEmail`, … e a ORDEM DELAS é a ordem de crédito. É simples e é o que o
 *  domínio espera — ele reindexa a ordem de qualquer forma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export interface AuthorRow {
  userId: string | null;
  name: string;
  email: string | null;
  institution: string | null;
  orcidId: string | null;
  isCorresponding: boolean;
}

export function AuthorEditor({
  tenantSlug,
  submissionId,
  authors: initialAuthors,
  action,
  editable,
}: {
  tenantSlug: string;
  submissionId: string;
  authors: AuthorRow[];
  action: (prev: ActionState | null, formData: FormData) => Promise<ActionState>;
  /** Falso depois do envio: a lista fica somente leitura, com o motivo na tela. */
  editable: boolean;
}) {
  const [authors, setAuthors] = useState<AuthorRow[]>(
    initialAuthors.length > 0
      ? initialAuthors
      : [{ userId: null, name: '', email: null, institution: null, orcidId: null, isCorresponding: true }],
  );
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(action, null);

  function update(index: number, patch: Partial<AuthorRow>) {
    setAuthors((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function move(index: number, direction: -1 | 1) {
    setAuthors((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  }

  function remove(index: number) {
    setAuthors((current) => {
      // A lista nunca fica vazia: uma submissão tem ao menos um autor, e deixar zero
      // linhas obrigaria a recarregar a página para voltar a ter onde digitar.
      if (current.length <= 1) return current;
      const next = current.filter((_, i) => i !== index);
      // Se o removido era o correspondente, o primeiro assume.
      if (!next.some((row) => row.isCorresponding) && next[0]) {
        next[0] = { ...next[0], isCorresponding: true };
      }
      return next;
    });
  }

  const correspondingIndex = Math.max(
    0,
    authors.findIndex((row) => row.isCorresponding),
  );

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-5" data-testid="author-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Autoria ({authors.length})</h2>
        {!editable ? (
          <p className="text-xs text-muted-foreground">
            A submissão já foi enviada — a autoria está congelada na versão avaliada.
          </p>
        ) : null}
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="submissionId" value={submissionId} />

        <ol className="space-y-3">
          {authors.map((author, index) => (
            <li
              key={index}
              data-testid={`author-row-${index}`}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {index + 1}º autor{index === 0 ? ' (primeiro)' : ''}
                </span>

                {editable ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Mover ${author.name || `autor ${index + 1}`} para cima`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Mover ${author.name || `autor ${index + 1}`} para baixo`}
                      disabled={index === authors.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-3.5" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remover ${author.name || `autor ${index + 1}`}`}
                      disabled={authors.length <= 1}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  name="authorName"
                  value={author.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="Nome completo"
                  aria-label={`Nome do autor ${index + 1}`}
                  readOnly={!editable || author.userId !== null}
                  required
                />
                <Input
                  name="authorEmail"
                  type="email"
                  value={author.email ?? ''}
                  onChange={(event) => update(index, { email: event.target.value })}
                  placeholder="email@instituicao.br"
                  aria-label={`E-mail do autor ${index + 1}`}
                  readOnly={!editable}
                />
                <Input
                  name="authorInstitution"
                  value={author.institution ?? ''}
                  onChange={(event) => update(index, { institution: event.target.value })}
                  placeholder="Instituição"
                  aria-label={`Instituição do autor ${index + 1}`}
                  readOnly={!editable}
                />
                <Input
                  name="authorOrcid"
                  value={author.orcidId ?? ''}
                  onChange={(event) => update(index, { orcidId: event.target.value })}
                  placeholder="0000-0000-0000-0000"
                  aria-label={`ORCID do autor ${index + 1}`}
                  readOnly={!editable}
                />
              </div>

              {/*
                Nome de quem tem CONTA não é editável aqui, e o motivo é dito na
                tela: o crédito usa o nome cadastrado na conta (`user.name`), então
                permitir digitar outro nome só criaria a expectativa de que ele
                valeria. Quem precisa trocar o próprio nome troca no perfil.
              */}
              {author.userId ? (
                <p className="text-xs text-muted-foreground">
                  Nome e e-mail vêm da conta de {author.name}. O crédito usa sempre o nome
                  cadastrado no perfil.
                </p>
              ) : null}

              {/* O vínculo de conta é preservado de forma invisível. */}
              <input type="hidden" name="authorUserId" value={author.userId ?? ''} />

              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="authorCorresponding"
                  value={index}
                  checked={correspondingIndex === index}
                  onChange={() => setAuthors((current) => current.map((row, i) => ({ ...row, isCorresponding: i === index })))}
                  disabled={!editable}
                  className="size-3.5 accent-primary"
                />
                Autor correspondente (responde pelo trabalho)
              </label>
            </li>
          ))}
        </ol>

        {editable ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="add-author-row"
              onClick={() =>
                setAuthors((current) => [
                  ...current,
                  {
                    userId: null,
                    name: '',
                    email: null,
                    institution: null,
                    orcidId: null,
                    isCorresponding: false,
                  },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Adicionar coautor
            </Button>

            <Button type="submit" size="sm" data-testid="save-authors" disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {pending ? 'Salvando…' : 'Salvar autoria'}
            </Button>
          </div>
        ) : null}

        {state ? (
          <div
            role={state.ok ? 'status' : 'alert'}
            data-testid="author-feedback"
            className={`space-y-1 text-sm ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
          >
            <p className="flex items-center gap-1.5">
              {state.ok ? (
                <CheckCircle2 className="size-4" aria-hidden />
              ) : (
                <AlertCircle className="size-4" aria-hidden />
              )}
              {state.message}
            </p>
            {state.details?.length ? (
              <ul className="ml-5 list-disc text-xs">
                {state.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>

      <p className="text-xs text-muted-foreground">
        O e-mail é opcional, mas quando ele corresponde a uma conta da instituição o coautor passa a
        ver o próprio crédito. A ordem acima é a ordem de citação do trabalho.
      </p>
    </section>
  );
}
