/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — As operações do editor do formulário (FASE 70 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO NÃO MORA NO MÓDULO DE DOMÍNIO JÁ ENTREGUE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `registration-form-spec-rules.ts` responde duas perguntas: "este campo declarado
 *  está coerente?" e "o que entra das respostas?". Ele NÃO responde "como a lista
 *  muda quando o organizador acrescenta, edita, remove ou reordena um campo" — e
 *  essa pergunta nasce do GESTO da tela (o `<form>` que chegou), não do dado. Ela
 *  fica aqui, e nada neste arquivo decide se um campo é válido: quem decide é o
 *  validador do domínio, chamado logo abaixo com o texto de recusa que ele já tem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A LISTA INTEIRA VAI PARA O VALIDADOR, E NÃO SÓ O CAMPO NOVO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Validar só o candidato diria "o campo 1 não tem rótulo" sobre o QUARTO campo da
 *  tela, e deixaria passar dois campos com o mesmo identificador — o validador
 *  compara a `key` com as chaves VISTAS até ali, e uma lista de um item não tem com
 *  o que comparar. A lista inteira custa o mesmo e responde as duas coisas, com o
 *  índice certo em cada mensagem.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE ESTE MÓDULO NÃO FAZ: VALIDAR REMOÇÃO E REORDENAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Tirar um item e trocar dois de lugar não podem invalidar uma lista que já era
 *  válida — o validador só olha campo a campo, e nenhum campo muda. Revalidar ali
 *  seria trabalho sem resposta nova; o que a remoção e a reordenação precisam
 *  conferir é só que a `key` existe, e isso é feito aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  resolveRegistrationFieldKey,
  validateRegistrationFormSpec,
  type FormSpecProblem,
  type RegistrationFormField,
} from '@/domain/events/registration-form-spec-rules';
import { moveWithinList } from '@/domain/events/demand-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  O `<form>` do organizador vira CANDIDATO do domínio
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Lê um campo de texto do formulário. Ausente vira string vazia — e vazia é como o
 * domínio lê "não declarei isto" (`MISSING_KEY`, `MISSING_LABEL`, `MISSING_TYPE`).
 */
function text(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Inteiro OPCIONAL: campo em branco vira AUSENTE, e não zero.
 *
 * É o mesmo cuidado do `toOptionalInt` do painel, com uma diferença de propósito:
 * aqui o texto que não é número vira `NaN` em vez de `null`. `null` significaria
 * "não declarei", e o campo seria ignorado — quem digitou "abc" no limite ficaria
 * com o teto do tipo sem saber. Com `NaN`, o VALIDADOR do domínio recusa e diz, com
 * as palavras dele, que o limite precisa ser um número inteiro.
 */
function optionalNumber(formData: FormData, name: string): number | null {
  const raw = text(formData, name).trim();
  if (raw.length === 0) return null;

  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** As opções da escolha única: uma por linha, na ordem em que foram digitadas. */
function optionsFromLines(formData: FormData, name: string): string[] {
  return text(formData, name)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Monta o candidato a partir do formulário do editor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  A REGRA DESTA TRADUÇÃO É "BRANCO NÃO É DECLARAÇÃO"
 * ─────────────────────────────────────────────────────────────────────────────
 *  O domínio RECUSA propriedade que não pertence ao tipo do campo (`options` numa
 *  data, `min` num texto curto). Se o editor mandasse sempre os nove campos, um
 *  `min` vazio viraria `NaN` e o organizador leria "o mínimo precisa ser um número
 *  inteiro" num campo de data em que ele nunca digitou nada. Por isso só entram as
 *  propriedades com conteúdo: o que ele não preencheu não é uma declaração — e o
 *  que ele preencheu no lugar errado É recusado, com o motivo do domínio.
 *
 *  `label`, `help` e `purpose` viajam sempre (vazios inclusive): são strings, e o
 *  próprio domínio sabe ler a vazia — `help` e `purpose` simplesmente não entram na
 *  normalização, e `label` vazia é `MISSING_LABEL`. A `key` também viaja como veio,
 *  sem `trim`: o domínio declara que ela nunca é aparada, e aparar aqui gravaria uma
 *  chave que o organizador não escreveu.
 */
export function registrationFieldFromFormData(formData: FormData): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    key: text(formData, 'key'),
    label: text(formData, 'label'),
    type: text(formData, 'type'),
    required: formData.get('required') === 'on',
    help: text(formData, 'help'),
    purpose: text(formData, 'purpose'),
  };

  const maxLength = optionalNumber(formData, 'maxLength');
  if (maxLength !== null) candidate.maxLength = maxLength;

  const min = optionalNumber(formData, 'min');
  if (min !== null) candidate.min = min;

  const max = optionalNumber(formData, 'max');
  if (max !== null) candidate.max = max;

  const options = optionsFromLines(formData, 'options');
  if (options.length > 0) candidate.options = options;

  return candidate;
}

// ───────────────────────────────────────────────────────────────────────────────
//  As quatro operações sobre a lista declarada
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O que o organizador pediu. É uma união fechada em vez de quatro funções soltas
 * porque as três operações compartilham a MESMA leitura e a MESMA gravação (uma
 * transação, uma entrada na trilha) — e o serviço não precisa de três caminhos para
 * escrever a mesma chave de `Event.settings`.
 */
export type RegistrationFormOperation =
  | {
      kind: 'SAVE';
      /** A `key` do campo que está sendo editado; `null` = campo novo. */
      originalKey: string | null;
      /** O candidato montado por `registrationFieldFromFormData`. */
      field: unknown;
    }
  | { kind: 'REMOVE'; key: string }
  | { kind: 'MOVE'; key: string; direction: 'up' | 'down' };

export type RegistrationFormOperationErrorCode =
  /** O campo declarado não passou pelo validador (a lista inteira foi conferida). */
  | 'INVALID_FIELD'
  /** A `key` da operação não existe na lista atual. */
  | 'FIELD_NOT_FOUND'
  /** Subir o primeiro (ou descer o último) não muda nada. */
  | 'AT_THE_EDGE';

export type RegistrationFormOperationResult =
  | { ok: true; fields: readonly RegistrationFormField[]; message: string }
  | {
      ok: false;
      code: RegistrationFormOperationErrorCode;
      message: string;
      /**
       * Os problemas do domínio, INTEIROS — com `index` e `key` —, quando a recusa
       * veio do validador. Vão como objeto (e não como lista de frases) porque o
       * índice do campo é informação do domínio que a tela usa para apontar QUAL
       * campo está torto: achatá-lo em texto aqui perderia a coordenada.
       */
      problems?: readonly FormSpecProblem[];
    };

/**
 * Aplica a operação e devolve a lista NOVA (ou o motivo da recusa).
 *
 * Não recebe o evento nem fala com o banco: quem lê e grava é o serviço. Assim a
 * regra das quatro operações é provada sem infraestrutura — que é a régua do
 * domínio deste projeto.
 */
export function applyRegistrationFormOperation(
  current: readonly RegistrationFormField[],
  operation: RegistrationFormOperation,
): RegistrationFormOperationResult {
  switch (operation.kind) {
    case 'SAVE': {
      const index =
        operation.originalKey === null
          ? -1
          : current.findIndex((field) => field.key === operation.originalKey);

      if (operation.originalKey !== null && index < 0) {
        return {
          ok: false,
          code: 'FIELD_NOT_FOUND',
          message: `Não há campo com o identificador "${operation.originalKey}" neste formulário.`,
        };
      }

      /**
       * ─────────────────────────────────────────────────────────────────────────────
       *  A CHAVE É RESOLVIDA AQUI — E É O ÚNICO LUGAR QUE PODE FAZÊ-LO (FASE 70)
       * ─────────────────────────────────────────────────────────────────────────────
       *  A tela manda o identificador, mas quem ORGANIZA escreve RÓTULO — e a chave
       *  técnica é a propriedade do JSON de respostas. O derivador do domínio
       *  (`registrationFieldKeyFromLabel`) existe desde a fatia 1 e não tinha
       *  chamador: sem esta linha, deixar o identificador em branco continuava sendo
       *  `MISSING_KEY`, e o organizador lia "campo sem identificador" sobre um campo
       *  que ele acabou de nomear.
       *
       *  A ORDEM do derivador é a do domínio e é o que preserva o dado recebido:
       *  **a chave digitada ganha de tudo**, a chave que JÁ EXISTE ganha do rótulo, e
       *  só o campo NOVO deriva. Renomear o rótulo de um campo com respostas não pode
       *  trocar a chave sob a qual elas foram gravadas — `originalKey` é o que diz
       *  que o campo está sendo EDITADO, e não criado.
       *
       *  Roda ANTES do validador de propósito: a lista que vai para ele é a lista com
       *  as chaves resolvidas, e é ele que recusa duas chaves iguais (`DUPLICATE_KEY`)
       *  quando dois rótulos derivam para o mesmo nome. Derivar aqui não valida nada —
       *  quem decide se o campo serve é o domínio, logo abaixo.
       */
      const resolved: Record<string, unknown> = {
        ...(operation.field as Record<string, unknown>),
      };

      resolved.key = resolveRegistrationFieldKey({
        postedKey: typeof resolved.key === 'string' ? resolved.key : '',
        originalKey: operation.originalKey,
        label: typeof resolved.label === 'string' ? resolved.label : '',
      });

      /**
       * Os campos que já existem voltam como candidatos porque a forma normalizada
       * usa exatamente as propriedades que o validador aceita — então revalidar a
       * lista não "suja" nada e é o que pega a `key` repetida.
       */
      const candidates: unknown[] = current.map((field) => ({ ...field }));

      if (index < 0) candidates.push(resolved);
      else candidates[index] = resolved;

      const validation = validateRegistrationFormSpec(candidates);

      if (!validation.ok) {
        /**
         * A PRIMEIRA mensagem do domínio é a que a tela mostra em destaque. Nenhuma
         * frase é inventada aqui: a lista inteira de problemas viaja como veio, e é
         * ela que a tela do organizador exibe.
         */
        const [first] = validation.problems;

        return {
          ok: false,
          code: 'INVALID_FIELD',
          message: first?.message ?? 'A configuração do formulário ficou inválida.',
          problems: validation.problems,
        };
      }

      return { ok: true, fields: validation.fields, message: 'Campo salvo no formulário.' };
    }

    case 'REMOVE': {
      const index = current.findIndex((field) => field.key === operation.key);

      if (index < 0) {
        return {
          ok: false,
          code: 'FIELD_NOT_FOUND',
          message: `Não há campo com o identificador "${operation.key}" neste formulário.`,
        };
      }

      return {
        ok: true,
        fields: current.filter((_, position) => position !== index),
        message: 'Campo removido do formulário.',
      };
    }

    case 'MOVE': {
      const index = current.findIndex((field) => field.key === operation.key);

      if (index < 0) {
        return {
          ok: false,
          code: 'FIELD_NOT_FOUND',
          message: `Não há campo com o identificador "${operation.key}" neste formulário.`,
        };
      }

      const target = operation.direction === 'up' ? index - 1 : index + 1;

      /**
       * Nas pontas nada é escrito, e a resposta diz por quê. Gravar a mesma ordem
       * seria uma entrada na trilha para um movimento que não aconteceu — "ordem
       * salva" sem nada ter mudado é a mentira que ninguém consegue conferir.
       */
      if (target < 0 || target >= current.length) {
        return {
          ok: false,
          code: 'AT_THE_EDGE',
          message:
            operation.direction === 'up'
              ? 'Este campo já é o primeiro do formulário.'
              : 'Este campo já é o último do formulário.',
        };
      }

      /**
       * A ordem é calculada com a MESMA função do quadro de demandas e da ordem das
       * equipes (`moveWithinList`): dois gestos iguais para "esta vem antes daquela"
       * não podem ter duas contas diferentes — `splice` com o índice deslocado é o
       * erro clássico, e ele já está resolvido lá.
       */
      const order = moveWithinList(
        current.map((field) => field.key),
        index,
        target,
      );

      const byKey = new Map(current.map((field) => [field.key, field]));

      return {
        ok: true,
        fields: order
          .map((key) => byKey.get(key))
          .filter((field): field is RegistrationFormField => field !== undefined),
        message: 'Ordem dos campos salva.',
      };
    }
  }
}

/**
 * A lista em uma frase — o que a TRILHA registra em "de" e "para".
 *
 * A trilha não guarda o objeto inteiro (uma trilha que copia o dado para outra
 * tabela é problema de privacidade, não solução de auditoria). O que interessa a
 * quem investiga depois é QUANTOS campos havia e QUAIS eram: o resto o formulário
 * ainda mostra.
 */
export function describeRegistrationForm(fields: readonly RegistrationFormField[]): string {
  if (fields.length === 0) return 'nenhum campo declarado';

  const count = `${fields.length} ${fields.length === 1 ? 'campo' : 'campos'}`;

  return `${count}: ${fields.map((field) => field.key).join(', ')}`;
}
