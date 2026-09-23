'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';

import { Button, Input } from '@/components/ui';
import { MAX_RUBRIC_CRITERIA, type RubricCriterion } from '@/domain/review/review-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  EDITOR DE RUBRICA — trilha e chamada usam o MESMO (FASE 39)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NÚMERO DE CRITÉRIOS É ESCOLHA DO ORGANIZADOR
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 38 a tela desenhava três linhas fixas. Agora o organizador decide
 *  quantas quer, e a chave técnica do critério (o campo de `Review.scores`) nasce do
 *  RÓTULO — quem organiza escreve "Originalidade" e pronto.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LINHA NOVA MANDA A CHAVE VAZIA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada linha carrega um campo oculto com a chave. Nas linhas que JÁ EXISTEM ele vem
 *  preenchido, e é o que permite corrigir um rótulo depois de avaliado sem que a chave
 *  mude (chave, peso e nota máxima são a FORMA congelada; rótulo não). Nas linhas
 *  novas ele vai vazio, e o domínio deriva do rótulo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SEM JAVASCRIPT O EDITOR NÃO FICA PELA METADE (a lição da E50)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os botões de acrescentar/remover e o atalho "usar a rubrica padrão" só aparecem
 *  DEPOIS da hidratação (`interactive`) — botão que não faz nada é pior que botão
 *  ausente. Quem está sem JavaScript tem, no lugar deles, um bloco `<noscript>` com as
 *  linhas restantes até o teto: preenche quantas quiser, e as vazias são descartadas
 *  (linha sem rótulo não é critério). Os campos do `<noscript>` existem no DOM também
 *  com JS ligado — vazios, e por isso descartados —, o que evita divergência de
 *  hidratação.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const MIN_ROWS = 3;

function clampRows(value: number): number {
  return Math.min(Math.max(value, 1), MAX_RUBRIC_CRITERIA);
}

/** Soma dos pesos preenchidos, lida do DOM (os campos são não controlados). */
function readWeightSum(container: HTMLFieldSetElement): number | null {
  const inputs = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[name="rubricWeight"]'),
  );

  let total = 0;
  let filled = 0;

  for (const input of inputs) {
    const value = Number(input.value);
    if (!Number.isFinite(value) || input.value.trim() === '') continue;

    total += value;
    filled += 1;
  }

  return filled > 0 ? total : null;
}

/**
 * O JavaScript já carregou?
 *
 * `false` no HTML do servidor e `true` no cliente, sem `setState` dentro de efeito (que
 * provocaria um segundo render em cascata — e o lint do React Compiler reprova). É o
 * que decide se os botões de acrescentar/remover podem aparecer: botão que não faz nada
 * é pior que botão ausente, e quem está sem JavaScript usa as linhas do `<noscript>`.
 */
function useIsInteractive(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function RubricEditor({
  criteria,
  frozen,
  scope = 'TRACK',
  scopeLabel,
  testId = 'rubric',
}: {
  criteria: readonly RubricCriterion[];
  /** Preenchido quando a forma está congelada: quantos pareceres já existem. */
  frozen?: { reviews: number } | null;
  /** Onde a rubrica vive — a frase da recusa fala da trilha ou da chamada. */
  scope?: 'TRACK' | 'CALL';
  /**
   * Nome do alvo, para os rótulos acessíveis ("Trilha X: rótulo do critério 2").
   *
   * ─────────────────────────────────────────────────────────────────────────────
   *  POR QUE ISTO EXISTE (armadilha 81, de novo)
   * ─────────────────────────────────────────────────────────────────────────────
   *  A tela do evento tem o formulário de CRIAÇÃO e um editor por trilha — todos com
   *  campos que se chamariam "Rótulo do critério 1". Rótulo de formulário é
   *  identificador, e o casamento é por substring: sem o nome do alvo, nem o leitor de
   *  tela nem o teste conseguem distinguir as caixas. O padrão cai no nome do escopo, e
   *  quem chama passa o nome da trilha ou da chamada.
   */
  scopeLabel?: string;
  testId?: string;
}) {
  const labelPrefix = scopeLabel ?? (scope === 'CALL' ? 'Chamada' : 'Trilha');
  const isFrozen = Boolean(frozen && frozen.reviews > 0);
  const [rows, setRows] = useState(() =>
    clampRows(Math.max(MIN_ROWS, criteria.length + 1)),
  );
  const interactive = useIsInteractive();
  const [weightSum, setWeightSum] = useState<number | null>(null);
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);

  /**
   * A soma dos pesos acompanha o que está digitado.
   *
   * Um ouvinte no conjunto inteiro em vez de um `onChange` por campo: a linha some e
   * aparece, e um ouvinte preso à linha ficaria para trás quando o "remover" tirasse
   * justamente a linha que mudou.
   */
  useEffect(() => {
    const container = fieldsetRef.current;
    if (!container) return;

    const handler = (): void => setWeightSum(readWeightSum(container));
    container.addEventListener('input', handler);

    return () => container.removeEventListener('input', handler);
  }, [rows, isFrozen]);

  /**
   * O CONGELAMENTO É APRESENTAÇÃO AQUI, E BARREIRA NO SERVIDOR.
   *
   * A tela mostra a rubrica em vigor sem campos de edição — e manda os valores atuais
   * em campos ocultos, para que salvar o formulário (para mudar o NOME da trilha, por
   * exemplo) não seja lido como "quero trocar a rubrica". A recusa de verdade vive em
   * `assertRubricShapeFree`, no serviço.
   */
  if (isFrozen) {
    return (
      <fieldset
        className="space-y-2 rounded-lg border border-border p-3 sm:col-span-2"
        data-testid={testId}
        data-rubric-frozen="true"
      >
        <legend className="flex items-center gap-1.5 px-1 text-xs uppercase tracking-wide text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          Rubrica — congelada por {frozen!.reviews} parecer(es) enviado(s)
        </legend>

        <ul className="space-y-1 text-sm" data-testid={`${testId}-frozen-list`}>
          {criteria.map((criterion) => (
            <li key={criterion.key} className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{criterion.label}</span>
              <span className="text-xs text-muted-foreground">
                chave: {criterion.key} · peso {criterion.weight} · nota máxima {criterion.maxScore}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          O número de critérios, as chaves, os pesos e as notas máximas não podem mais mudar: a
          nota de quem já avaliou deixaria de ser calculável. Rótulo, descrição e ordem continuam
          livres — e para avaliar por outros critérios, crie{' '}
          {scope === 'CALL' ? 'outra chamada' : 'outra trilha'}.
        </p>

        {/** A rubrica em vigor viaja intacta: salvar o resto do formulário não a altera. */}
        {criteria.map((criterion) => (
          <div key={criterion.key} className="hidden">
            <input type="hidden" name="rubricKey" value={criterion.key} />
            <input type="hidden" name="rubricLabel" value={criterion.label} />
            <input type="hidden" name="rubricWeight" value={criterion.weight} />
            <input type="hidden" name="rubricMaxScore" value={criterion.maxScore} />
          </div>
        ))}
      </fieldset>
    );
  }

  return (
    <fieldset
      ref={fieldsetRef}
      className="space-y-2 rounded-lg border border-border p-3 sm:col-span-2"
      data-testid={testId}
    >
      <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
        Rubrica (opcional — vazio usa a rubrica padrão; até {MAX_RUBRIC_CRITERIA} critérios)
      </legend>

      {Array.from({ length: rows }, (_, index) => {
        const criterion = criteria[index];

        return (
          <div
            key={`row-${index}`}
            className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]"
            data-testid={`${testId}-row-${index}`}
          >
            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Critério {index + 1}</span>
              <Input
                name="rubricLabel"
                defaultValue={criterion?.label ?? ''}
                placeholder={index === 0 ? 'Originalidade' : 'Rótulo do critério'}
                maxLength={120}
                aria-label={`${labelPrefix}: rótulo do critério ${index + 1}`}
                data-testid={`${testId}-label-${index}`}
              />
              {criterion ? (
                <span className="block text-xs text-muted-foreground">chave: {criterion.key}</span>
              ) : null}
            </label>

            {/** Preserva a chave da linha que já existe (ver o cabeçalho). */}
            <input type="hidden" name="rubricKey" value={criterion?.key ?? ''} />

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Peso</span>
              <Input
                name="rubricWeight"
                type="number"
                min={1}
                defaultValue={criterion?.weight ?? (index === 0 ? 3 : 1)}
                aria-label={`${labelPrefix}: peso do critério ${index + 1}`}
                data-testid={`${testId}-weight-${index}`}
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="block text-muted-foreground">Nota máxima</span>
              <Input
                name="rubricMaxScore"
                type="number"
                min={1}
                defaultValue={criterion?.maxScore ?? 10}
                aria-label={`${labelPrefix}: nota máxima do critério ${index + 1}`}
                data-testid={`${testId}-max-${index}`}
              />
            </label>

            <div className="flex items-end pb-1">
              {interactive && rows > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRows((current) => clampRows(current - 1))}
                  data-testid={`${testId}-remove-${index}`}
                  aria-label={`${labelPrefix}: remover o critério ${index + 1}`}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}

      {/**
       * As linhas que faltam para o teto, para quem está SEM JavaScript.
       *
       * O navegador só as exibe quando o script está desligado; com JS elas continuam no
       * DOM (vazias) e são descartadas pelo domínio — linha sem rótulo não é critério.
       */}
      <noscript>
        {Array.from({ length: Math.max(0, MAX_RUBRIC_CRITERIA - rows) }, (_, offset) => {
          const index = rows + offset;

          return (
            <div key={`ns-${index}`} className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto]">
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Critério {index + 1}</span>
                <Input
                  name="rubricLabel"
                  placeholder="Rótulo do critério"
                  maxLength={120}
                  aria-label={`${labelPrefix}: rótulo do critério ${index + 1}`}
                />
              </label>
              <input type="hidden" name="rubricKey" value="" />
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Peso</span>
                <Input name="rubricWeight" type="number" min={1} defaultValue={1} aria-label={`Peso do critério ${index + 1}`} />
              </label>
              <label className="space-y-1 text-xs">
                <span className="block text-muted-foreground">Nota máxima</span>
                <Input name="rubricMaxScore" type="number" min={1} defaultValue={10} aria-label={`Nota máxima do critério ${index + 1}`} />
              </label>
              <div />
            </div>
          );
        })}
      </noscript>

      {interactive ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rows >= MAX_RUBRIC_CRITERIA}
            onClick={() => setRows((current) => clampRows(current + 1))}
            data-testid={`${testId}-add`}
          >
            <Plus className="size-3.5" aria-hidden />
            Acrescentar critério
          </Button>

          {weightSum !== null ? (
            <span className="text-xs text-muted-foreground" data-testid={`${testId}-weight-sum`}>
              soma dos pesos: {weightSum}
            </span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
