/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — O formulário de inscrição que o ORGANIZADOR monta (FASE 70 · fatia 1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UM ARQUIVO PRÓPRIO, E NÃO O `registration-form-rules.ts`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `registration-form-rules.ts` responde "onde está o CPF que vai para o
 *  certificado" — ele é o LEITOR do documento. Este arquivo responde outra
 *  pergunta: "quais campos o organizador declarou e o que entra das respostas".
 *  O primeiro é do certificado e não muda quando o formulário muda; o segundo é a
 *  CONFIGURAÇÃO. Misturar os dois faria a régua do documento depender do formulário
 *  do evento — e um campo novo derrubaria a emissão de certificado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O FORMULÁRIO É DADO, E O DADO É RECUSADO — NUNCA "CORRIGIDO"
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A lista de campos vive em `Event.settings` (JSON), sem migração (o precedente é
 *  `readEventRegistrationPolicy`). Isso dá ao organizador um formulário por evento —
 *  e dá ao sistema uma obrigação: quando o que ele declarou não é entendível, a
 *  resposta é NÃO, com o motivo em português. Adivinhar a intenção ("quis dizer
 *  número?"), trocar um tipo inválido pelo texto curto ou ignorar uma opção repetida
 *  seria pior do que recusar: o organizador acharia que pediu uma coisa e o
 *  participante responderia outra, e ninguém veria a diferença.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  OS TIPOS SENSÍVEIS SÃO PROIBIDOS POR CONSTRUÇÃO — E O QUE ISSO *NÃO* PROMETE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Proibido por construção" tem um sentido exato aqui, e a diferença importa:
 *
 *   • O sistema NÃO OFERECE um campo tipado de CPF/documento, saúde, religião,
 *     biometria, raça/cor, orientação sexual ou filiação partidária/sindical. Não
 *     existe tipo para isso — a allowlist é curta e fechada (`FORM_FIELD_TYPES`), e
 *     um spec que invente um tipo com esse nome é RECUSADO (`FORBIDDEN_TYPE`), com o
 *     motivo escrito. Ou seja: esses dados não ganham ESTRUTURA, não viram coluna,
 *     não entram em filtro, relatório nem exportação por tipo.
 *
 *   • O que este arquivo NÃO promete — porque seria mentira — é que "um texto livre
 *     nunca conterá um CPF digitado". Isso é impossível de garantir por TIPO: texto
 *     curto é texto curto, e quem digita `123.456.789-00` no campo "observações"
 *     está digitando uma string que o sistema não tem como reconhecer como
 *     documento. Quem cobre ESSE risco é outra coisa, e está declarada:
 *     (a) o AVISO ao organizador, na tela do formulário (fatia 3), dizendo que campo
 *     aberto pode receber dado sensível digitado à mão; e (b) o caminho de
 *     ELIMINAÇÃO das respostas (fatia 4), que é o que a LGPD pede quando o dado
 *     entrou.
 *
 *  Prometer o primeiro é engenharia; prometer o segundo é propaganda. O comentário
 *  existe para ninguém trocar um pelo outro numa próxima fase.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ───────────────────────────────────────────────────────────────────────────────
//  A allowlist de tipos (decisão do humano na FASE 70)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Os ÚNICOS tipos que existem. É allowlist, e não lista de proibidos, de propósito:
 * tipo novo entra aqui por decisão explícita, e um pedido inventado não "passa" por
 * omissão.
 */
export const FORM_FIELD_TYPES = Object.freeze([
  'SHORT_TEXT',
  'LONG_TEXT',
  'SINGLE_CHOICE',
  'YES_NO',
  'NUMBER',
  'DATE',
] as const);

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Rótulo do tipo como a tela do organizador mostra. */
export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  SHORT_TEXT: 'Texto curto',
  LONG_TEXT: 'Texto longo',
  SINGLE_CHOICE: 'Escolha única',
  YES_NO: 'Sim/Não',
  NUMBER: 'Número',
  DATE: 'Data',
};

/** Teto do campo de texto curto (mesma ordem de grandeza do texto de proposta). */
export const FORM_SHORT_TEXT_MAX = 300;

/** Teto do texto longo — ele existe porque a finalidade foi declarada. */
export const FORM_LONG_TEXT_MAX = 1_200;

/** Teto do rótulo que aparece para o participante. */
export const FORM_LABEL_MAX = 120;

/**
 * Teto da `finalidade`: é uma frase, não um parágrafo. Sem teto, a tela do
 * organizador e o aviso ao participante ficariam com um texto que ninguém lê.
 */
export const FORM_PURPOSE_MAX = 300;

/** Teto da ajuda curta exibida abaixo do campo. */
export const FORM_HELP_MAX = 200;

/** Teto do identificador do campo (`key`). */
export const FORM_FIELD_KEY_MAX = 40;

/** Quantidade de campos que um formulário pode declarar. */
export const FORM_FIELDS_MAX = 40;

/** Opções de uma escolha única: sem teto a tela vira um catálogo. */
export const FORM_CHOICE_OPTIONS_MAX = 30;

/** Teto da opção de escolha única. */
export const FORM_CHOICE_OPTION_MAX = 80;

/**
 * O identificador do campo, e por que ele é ESTREITO.
 *
 * `key` vai virar chave do JSON de respostas e vai ser lida por outras fatias (a
 * tela do organizador, o CSV, a eliminação). Aceitar `Nome Completo`, `nome-completo`
 * ou `NOME` faria três grafias para o mesmo campo — e a primeira leitura que errasse
 * a caixa devolveria "campo não respondido" em silêncio. Só minúsculas, números e
 * `_`, começando por letra.
 */
export const FORM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Chaves que NÃO podem ser usadas como identificador, mesmo passando no padrão.
 *
 * `__proto__` e `constructor` são nomes perigosos quando viram propriedade de objeto
 * (o objeto "herda" em vez de guardar, e a resposta desaparece); `id` e `evento`
 * colidiriam com o que o sistema já usa por fora do formulário.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  AS CHAVES DO FORMULÁRIO FIXO ENTRARAM AQUI NA FASE 70 — E O MOTIVO É O JSON
 * ─────────────────────────────────────────────────────────────────────────────
 *  `cpf`, `accessibilityNotes`, `consentData` e `consentImage` são respostas do
 *  formulário de SEMPRE, e o sistema as lê por esse nome: o certificado procura
 *  `cpf` em `registrations.formResponses` (`registration-form-rules.ts`). Se o
 *  organizador declarasse um campo com o identificador `cpf`, as duas respostas
 *  cairiam na MESMA propriedade do JSON — e o documento sairia com o número que ele
 *  digitou ali, não com o do CPF.
 *
 *  O prefixo do controle HTML (`FORM_RESPONSE_FIELD_PREFIX`) resolve a colisão do
 *  `<form>`; esta lista resolve a do DADO. São duas camadas de propósito: a primeira
 *  é do navegador e existiria mesmo que o dado fosse para outro lugar; a segunda é a
 *  que protege o leitor do certificado, e é ela que um `key` cru no JSON burlaria.
 */
export const FORM_RESERVED_KEYS: readonly string[] = [
  '__proto__',
  'prototype',
  'constructor',
  'key',
  'type',
  'id',
  'evento',
  'event',
  'cpf',
  'accessibilityNotes',
  'dietaryNotes',
  'consentData',
  'consentImage',
  'formResponses',
];

/**
 * O PREFIXO do controle HTML de um campo declarado (FASE 70 · fatia 4).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O CAMPO DECLARADO NÃO USA A `key` COMO `name`
 * ─────────────────────────────────────────────────────────────────────────────
 *  O formulário de inscrição tem controles FIXOS (`cpf`, `accessibilityNotes`,
 *  `consentData`, `consentImage`) que não são respostas do organizador — são
 *  obrigações do EVENTO, com leitor próprio no certificado e na trilha. A `key`
 *  declarada passa por uma allowlist de formato e por uma lista de nomes reservados
 *  (`FORM_RESERVED_KEYS`), e nenhuma das duas impede `cpf`: o organizador que der ao
 *  campo o identificador `cpf` teria o valor do participante entregue ao leitor do
 *  CERTIFICADO, e o CPF do formulário fixo sobrescrito pelo que ele digitou ali.
 *
 *  Prefisar o `name` resolve dentro do formulário, e resolve por CONSTRUÇÃO: com
 *  `resposta_cpf` o controle do organizador nunca colide com o do sistema, qualquer
 *  que seja a `key` declarada. Proibir `cpf` como identificador seria a alternativa —
 *  e seria pior: a lista de proibidos teria de acompanhar, para sempre, o nome de
 *  cada controle fixo que qualquer fase futura acrescentar.
 */
export const FORM_RESPONSE_FIELD_PREFIX = 'resposta_';

/** O `name` do controle de um campo declarado: `resposta_<key>`. */
export function formResponseFieldName(key: string): string {
  return `${FORM_RESPONSE_FIELD_PREFIX}${key}`;
}

/**
 * Os tipos sensíveis que este sistema NÃO oferece.
 *
 * A lista é usada como FRAGMENTO sobre o nome do tipo declarado, já em minúsculas e
 * sem separadores: é assim que `cpf`, `CPF` e `cpf_do_titular` caem no mesmo lugar.
 * Nenhum fragmento casa com os tipos da allowlist — há um teste que prende os dois
 * sentidos.
 */
export const FORBIDDEN_FIELD_TYPE_FRAGMENTS: readonly string[] = [
  'cpf',
  'cnpj',
  'rg',
  'document',
  'doc',
  'passaporte',
  'saude',
  'biometr',
  'religia',
  'raca',
  'corraca',
  'etnia',
  'orientacao',
  'sexual',
  'sexo',
  'genero',
  'filia',
  'partid',
  'sindical',
  'sindicato',
  'politic',
  'deficien',
  'doenca',
  'medicament',
  'sanguin',
  'dna',
  'senha',
  'password',
  'cartao',
  'credito',
  'bancari',
  'pis',
  'tituloeleitor',
  'eleitor',
];

/**
 * O tipo declarado é sensível?
 *
 * Normaliza antes de comparar — minúsculas, e FORA tudo o que não é letra ou número —
 * porque o organizador digita o tipo como quiser, e `CPF`, `Cpf`, `cpf_`, `c-p-f` e
 * `C P F` são o MESMO pedido. Deixar uma variante passar por causa de uma maiúscula ou
 * de um separador seria o buraco inteiro de volta. A resposta é o próprio fragmento
 * que casou: é ele que a mensagem de recusa cita, para o organizador saber QUAL dado o
 * sistema se recusa a estruturar.
 *
 * O preço do casamento por fragmento é falso positivo em nome parecido (`DOCENTE`
 * contém `doc`). O preço é aceitável e o erro é para o lado certo: a recusa é
 * explícita, com motivo, e o organizador escolhe outro rótulo de tipo. O contrário
 * (deixar passar) é exatamente o defeito que esta lista existe para impedir.
 */
export function forbiddenFieldTypeFragment(type: unknown): string | null {
  if (typeof type !== 'string') return null;

  const normalized = type.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length === 0) return null;

  return FORBIDDEN_FIELD_TYPE_FRAGMENTS.find((fragment) => normalized.includes(fragment)) ?? null;
}

/** O tipo declarado é um tipo SENSÍVEL (proibido por construção)? */
export function isForbiddenFieldType(type: unknown): boolean {
  return forbiddenFieldTypeFragment(type) !== null;
}

/** O valor declarado é um dos tipos da allowlist? */
export function isFormFieldType(value: unknown): value is FormFieldType {
  return typeof value === 'string' && (FORM_FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Só o texto longo exige finalidade declarada.
 *
 * Sim/Não e escolha única não a exigem porque a própria pergunta já é a finalidade
 * ("precisa de intérprete de Libras?"); o texto curto é curtinho o bastante para o
 * rótulo dizer para que serve. Já o texto longo é o único lugar em que cabe QUALQUER
 * coisa — é o campo em que "observações" vira depósito, e é ele que a LGPD manda
 * justificar.
 */
export const PURPOSE_REQUIRED_TYPES: readonly FormFieldType[] = ['LONG_TEXT'];

export function formFieldRequiresPurpose(type: FormFieldType): boolean {
  return PURPOSE_REQUIRED_TYPES.includes(type);
}

// ───────────────────────────────────────────────────────────────────────────────
//  O identificador DERIVADO do rótulo — o padrão da FASE 39
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O prefixo de socorro da chave derivada, e o que ele evita.
 *
 * Há dois rótulos que não podem virar chave como estão: o que começa com NÚMERO
 * ("3ª idade") e o que cai numa palavra RESERVADA do sistema ("ID" → `id`, "Evento" →
 * `evento`). Nos dois casos o prefixo resolve dentro do domínio, em vez de virar uma
 * recusa ("identificador inválido" / "identificador reservado") que o organizador não
 * tem como consertar mexendo no RÓTULO — que é a única coisa que a tela pede dele.
 */
const FORM_FIELD_KEY_PREFIX = 'campo_';

/** A chave de um rótulo que não produziu letra nem número nenhum ("***"). */
const FORM_FIELD_KEY_FALLBACK = 'campo';

/**
 * Rótulo → identificador do campo ("Restrição alimentar" → `restricao_alimentar`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A CHAVE DEIXOU DE SER OBRIGATÓRIA (o mesmo caminho da rubrica, F39)
 * ─────────────────────────────────────────────────────────────────────────────
 *  A chave é técnica: é a propriedade do JSON de respostas e obedece a um padrão
 *  estreito (minúsculas, dígitos e `_`, começando por letra). Pedir que quem organiza
 *  digite isso é pedir que erre — e o erro só aparecia DEPOIS do envio, com
 *  "identificador de campo inválido". Derivando do rótulo, ele escreve "Restrição
 *  alimentar" e pronto: o rótulo é o que as pessoas leem, a chave é o que o banco
 *  guarda.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  COLISÃO **NÃO** GANHA SUFIXO AQUI — DIFERENÇA DELIBERADA DA RUBRICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `criterionKeyFromLabel` (F39) desempata com `_2`, `_3` porque duas linhas com o
 *  mesmo rótulo são um deslize comum numa rubrica, e recusar a rubrica inteira por
 *  isso seria desproporcional. Aqui o desempate automático seria pior do que a
 *  recusa: a chave é o que guarda as respostas JÁ RECEBIDAS, e um `restricao_2`
 *  inventado em silêncio criaria um campo que ninguém pediu, com a resposta da
 *  pergunta antiga embaixo de um nome novo. Dois rótulos que geram a mesma chave são
 *  RECUSADOS pelo validador que já existe (`DUPLICATE_KEY`, em
 *  `validateRegistrationFormSpec`) — o mesmo lugar onde a chave repetida digitada à
 *  mão sempre foi recusada. Por isso este derivador NÃO recebe lista de chaves já
 *  usadas: ele não desempata, ele deriva.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS REGRAS SÃO AS DO VALIDADOR — NÃO HÁ UMA SEGUNDA RÉGUA AQUI
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O derivador REUSA `FORM_FIELD_KEY_PATTERN`, `FORM_FIELD_KEY_MAX` e
 *  `FORM_RESERVED_KEYS`, que são as listas do validador. Uma cópia local divergiria
 *  da original no primeiro ajuste — e a tela passaria a produzir uma chave que o
 *  próprio sistema recusa, que é o defeito inteiro de volta por outra porta. A
 *  promessa da função é forte e tem catraca: **toda** chave que sai daqui passa em
 *  `FORM_FIELD_KEY_PATTERN` e não é reservada.
 */
export function registrationFieldKeyFromLabel(label: string): string {
  const base = label
    .normalize('NFD')
    /** Marcas de acento separadas pela normalização NFD. */
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, FORM_FIELD_KEY_MAX);

  /** Rótulo só de símbolo/espaço: sem base não há de onde derivar. */
  if (base.length === 0) return FORM_FIELD_KEY_FALLBACK;

  if (/^[a-z]/.test(base) && !FORM_RESERVED_KEYS.includes(base)) return base;

  /**
   * O corte é feito no ESPAÇO QUE SOBRA para o prefixo, e não depois de colar os
   * dois: assim o resultado cabe no teto do validador por construção, em vez de
   * depender de o rótulo ter sido curto.
   */
  return `${FORM_FIELD_KEY_PREFIX}${base.slice(0, FORM_FIELD_KEY_MAX - FORM_FIELD_KEY_PREFIX.length)}`;
}

/**
 * A chave com que o campo será GRAVADO — a decisão que a tela não pode tomar sozinha.
 *
 * A ordem é: a chave DIGITADA, a chave que JÁ EXISTE, a chave derivada do rótulo.
 *
 *   • **A digitada ganha de tudo** porque digitar é o ato explícito do organizador, e
 *     a tela avisa o preço dele (as respostas antigas ficam sob a chave anterior).
 *   • **A que já existe ganha do rótulo** — e é aqui que mora o ponto: renomear o
 *     rótulo de um campo que já tem respostas NÃO pode trocar a chave, senão o
 *     parecer, o CSV ou a eliminação passariam a procurar a resposta sob um nome que
 *     ninguém escreveu. É o mesmo cuidado da rubrica (F39), pelo mesmo motivo.
 *   • **A derivada é o caso do campo NOVO**, que é o gesto que a tela passou a
 *     recomendar: escrever o rótulo e deixar o identificador em branco.
 *
 * Campo existente é identificado pela `key` de ORIGEM, e não pelo que veio digitado: é
 * ela que diz que o campo está sendo EDITADO, e não criado. Sem essa distinção, o
 * formulário que reenviasse o identificador vazio criaria um campo novo em vez de
 * preservar o que existe.
 */
export function resolveRegistrationFieldKey(input: {
  /** O que o `<form>` mandou no campo do identificador (vazio é o caso novo). */
  postedKey: string;
  /** A `key` do campo que está sendo editado; `null` = campo NOVO. */
  originalKey: string | null;
  /** O rótulo — a última fonte, e a única do campo novo. */
  label: string;
}): string {
  /**
   * Só espaço em branco conta como "não digitou". O valor que VAI para o banco não é
   * aparado: o validador declara que a chave nunca é aparada (" Nome" não é "nome"), e
   * aparar aqui gravaria uma chave que o organizador não escreveu.
   */
  if (input.postedKey.trim().length > 0) return input.postedKey;

  if (input.originalKey !== null && input.originalKey.length > 0) return input.originalKey;

  return registrationFieldKeyFromLabel(input.label);
}

// ───────────────────────────────────────────────────────────────────────────────
//  A forma do spec do campo (o que o organizador autora)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A especificação de UM campo, como o organizador a declarou.
 *
 * O que é comum a todos os tipos está aqui; o que é de um tipo só (`options` na
 * escolha, `min`/`max` no número) é opcional e só é aceito no tipo a que pertence —
 * `MISSING_OPTIONS`, `INVALID_OPTIONS` e `INVALID_RANGE` no validador do spec.
 * O validador não "conserta" nenhum desses: ou o conjunto é coerente inteiro, ou o
 * formulário inteiro é recusado.
 */
export interface RegistrationFormField {
  /** Identificador estável — é a chave com que a resposta é gravada. */
  key: string;
  /** O que o participante lê. */
  label: string;
  type: FormFieldType;
  /** Campo obrigatório: vazio RECUSA a inscrição (e diz qual campo). */
  required: boolean;
  /** Texto curto/longo. */
  maxLength?: number;
  /** Número (inteiro): faixa fechada — os limites SÃO aceitos. */
  min?: number;
  max?: number;
  /** Escolha única: valores possíveis, na ordem em que a tela os mostra. */
  options?: readonly string[];
  /** Texto de apoio abaixo do campo. */
  help?: string;
  /** PARA QUE O DADO SERVE — o que a LGPD pede e o que a tela mostra. */
  purpose?: string;
}

/** Lista de campos DECLARADOS, como ela é lida da configuração. */

// ───────────────────────────────────────────────────────────────────────────────
//  Validação do SPEC — erro como valor, um motivo por problema
// ───────────────────────────────────────────────────────────────────────────────
export type FormSpecErrorCode =
  | 'NOT_A_LIST'
  | 'TOO_MANY_FIELDS'
  | 'NOT_AN_OBJECT'
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'RESERVED_KEY'
  | 'DUPLICATE_KEY'
  | 'MISSING_LABEL'
  | 'INVALID_LABEL'
  | 'MISSING_TYPE'
  | 'FORBIDDEN_TYPE'
  | 'UNKNOWN_TYPE'
  | 'INVALID_REQUIRED'
  | 'MISSING_OPTIONS'
  | 'INVALID_OPTIONS'
  | 'INVALID_MAX_LENGTH'
  | 'INVALID_RANGE'
  | 'MISSING_PURPOSE'
  | 'INVALID_HELP'
  | 'UNKNOWN_PROPERTY';

export interface FormSpecProblem {
  code: FormSpecErrorCode;
  /** Mensagem em português, pronta para a tela do organizador. */
  message: string;
  /** Posição do campo na lista (1 é o primeiro); `null` para a lista inteira. */
  index: number | null;
  /** A `key` do campo, quando já se sabe qual é. */
  key: string | null;
  /** O que exatamente o sistema não entendeu — é diagnóstico, não texto de tela. */
  reason: string;
}

export type FormSpecValidation =
  | { ok: true; fields: readonly RegistrationFormField[] }
  | { ok: false; problems: readonly FormSpecProblem[] };

/** As propriedades que um spec pode ter. Chave fora daqui é recusada. */
const FORM_FIELD_PROPERTIES: readonly string[] = [
  'key',
  'label',
  'type',
  'required',
  'maxLength',
  'min',
  'max',
  'options',
  'help',
  'purpose',
];

const FORM_SPEC_ERROR_TITLES: Record<FormSpecErrorCode, string> = {
  NOT_A_LIST: 'O formulário precisa ser uma lista de campos',
  TOO_MANY_FIELDS: 'Campos demais no formulário',
  NOT_AN_OBJECT: 'Campo em formato que o sistema não entende',
  MISSING_KEY: 'Campo sem identificador',
  INVALID_KEY: 'Identificador de campo inválido',
  RESERVED_KEY: 'Identificador de campo reservado',
  DUPLICATE_KEY: 'Identificador de campo repetido',
  MISSING_LABEL: 'Campo sem rótulo',
  INVALID_LABEL: 'Rótulo de campo inválido',
  MISSING_TYPE: 'Campo sem tipo',
  FORBIDDEN_TYPE: 'Tipo de campo proibido',
  UNKNOWN_TYPE: 'Tipo de campo desconhecido',
  INVALID_REQUIRED: 'Obrigatoriedade inválida',
  MISSING_OPTIONS: 'Escolha única sem opções',
  INVALID_OPTIONS: 'Opções de escolha única inválidas',
  INVALID_MAX_LENGTH: 'Limite de caracteres inválido',
  INVALID_RANGE: 'Faixa do número inválida',
  MISSING_PURPOSE: 'Texto longo sem finalidade declarada',
  INVALID_HELP: 'Texto de ajuda inválido',
  UNKNOWN_PROPERTY: 'Propriedade desconhecida no campo',
};

function specProblem(input: {
  code: FormSpecErrorCode;
  detail: string;
  index: number | null;
  key: string | null;
  reason: string;
}): FormSpecProblem {
  return {
    code: input.code,
    message: `${FORM_SPEC_ERROR_TITLES[input.code]}: ${input.detail}`,
    index: input.index,
    key: input.key,
    reason: input.reason,
  };
}

/** Aceita só número inteiro finito — string, booleano e `NaN` são outra coisa. */
function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** Texto útil: string, aparada, não vazia. */
function isFilledText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** `YYYY-MM-DD` que existe no calendário — nunca "corrigido" para o dia seguinte. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const parsed = new Date(Date.UTC(year, month - 1, day));

  /**
   * A volta tem de dar o mesmo dia. `2026-02-30` vira 2 de março no `Date` do
   * JavaScript — aceitar isso seria gravar uma data que a pessoa não digitou.
   */
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** As opções, para caberem numa mensagem de recusa sem virar um parágrafo. */
function optionsPreview(options: readonly string[]): string {
  const shown = options.slice(0, 4).join(' · ');
  return options.length > 4 ? `${shown} · …` : shown;
}

/**
 * Valida UM campo. Devolve o problema, ou `null` quando ele está coerente — a lista
 * inteira de problemas é montada pelo chamador para que o organizador veja TUDO o que
 * precisa consertar, e não um erro por vez.
 */
function inspectField(
  raw: unknown,
  index: number,
  keysSeen: ReadonlySet<string>,
): FormSpecProblem | null {
  const position = index + 1;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return specProblem({
      code: 'NOT_AN_OBJECT',
      detail: `o item ${position} não é um campo (esperado um objeto com key, label e type)`,
      index: position,
      key: null,
      reason: `item ${position}: ${Array.isArray(raw) ? 'array' : typeof raw}`,
    });
  }

  const candidate = raw as Record<string, unknown>;

  const unknownProperty = Object.keys(candidate).find(
    (property) => !FORM_FIELD_PROPERTIES.includes(property),
  );

  /**
   * Propriedade desconhecida é RECUSADA, e não ignorada: quem declara
   * `sensitive: true` ou `visible: false` está pedindo algo que o sistema não faz, e
   * seguir em frente faria o organizador acreditar que foi atendido.
   */
  if (unknownProperty !== undefined) {
    return specProblem({
      code: 'UNKNOWN_PROPERTY',
      detail: `o campo ${position} tem a propriedade "${unknownProperty}", que o sistema não conhece`,
      index: position,
      key: isFilledText(candidate.key) ? candidate.key : null,
      reason: `propriedade desconhecida: ${unknownProperty}`,
    });
  }

  const rawKey = candidate.key;

  if (rawKey === undefined || rawKey === null || rawKey === '') {
    return specProblem({
      code: 'MISSING_KEY',
      detail: `o campo ${position} não tem identificador (key)`,
      index: position,
      key: null,
      reason: 'key ausente',
    });
  }

  if (typeof rawKey !== 'string') {
    return specProblem({
      code: 'INVALID_KEY',
      detail: `o identificador do campo ${position} precisa ser texto`,
      index: position,
      key: null,
      reason: `key: ${typeof rawKey}`,
    });
  }

  /**
   * A key NUNCA é aparada nem convertida: ` Nome` não é `nome`.
   *
   * O teste de reservada vem ANTES do teste de formato de propósito: `__proto__`
   * começa com `_` e cairia em `INVALID_KEY` — a recusa certa, pelo motivo errado. O
   * organizador precisa ler que o identificador é do sistema, e não que ele digitou
   * fora do padrão.
   */
  if (FORM_RESERVED_KEYS.includes(rawKey)) {
    return specProblem({
      code: 'RESERVED_KEY',
      detail: `"${rawKey}" é um identificador reservado do sistema; escolha outro`,
      index: position,
      key: rawKey,
      reason: `key reservada: ${rawKey}`,
    });
  }

  if (!FORM_FIELD_KEY_PATTERN.test(rawKey)) {
    return specProblem({
      code: 'INVALID_KEY',
      detail:
        `"${rawKey}" não serve como identificador: use até ${FORM_FIELD_KEY_MAX} caracteres, ` +
        'só minúsculas, números e "_", começando por letra (ex.: "restricao_alimentar")',
      index: position,
      key: rawKey,
      reason: `key fora do padrão: ${rawKey}`,
    });
  }

  if (keysSeen.has(rawKey)) {
    return specProblem({
      code: 'DUPLICATE_KEY',
      detail: `o identificador "${rawKey}" aparece mais de uma vez; cada campo precisa do seu`,
      index: position,
      key: rawKey,
      reason: `key repetida: ${rawKey}`,
    });
  }

  const label = candidate.label;

  if (label === undefined || label === null || label === '') {
    return specProblem({
      code: 'MISSING_LABEL',
      detail: `o campo "${rawKey}" não tem rótulo (label)`,
      index: position,
      key: rawKey,
      reason: 'label ausente',
    });
  }

  if (typeof label !== 'string' || label.trim().length === 0) {
    return specProblem({
      code: 'INVALID_LABEL',
      detail: `o rótulo do campo "${rawKey}" precisa ser texto não vazio`,
      index: position,
      key: rawKey,
      reason: `label: ${typeof label === 'string' ? 'vazio' : typeof label}`,
    });
  }

  if (label.trim().length > FORM_LABEL_MAX) {
    return specProblem({
      code: 'INVALID_LABEL',
      detail: `o rótulo do campo "${rawKey}" passa de ${FORM_LABEL_MAX} caracteres`,
      index: position,
      key: rawKey,
      reason: `label com ${label.trim().length} caracteres`,
    });
  }

  const rawType = candidate.type;

  if (rawType === undefined || rawType === null || rawType === '') {
    return specProblem({
      code: 'MISSING_TYPE',
      detail: `o campo "${rawKey}" não tem tipo`,
      index: position,
      key: rawKey,
      reason: 'type ausente',
    });
  }

  /**
   * A proibição vem ANTES da allowlist, e é por isso que ela existe em separado:
   * "tipo desconhecido" e "tipo proibido" são recusas diferentes, e o organizador que
   * digitou `CPF` precisa ler que o sistema não coleta esse dado — não que ele errou
   * a digitação.
   */
  const forbidden = forbiddenFieldTypeFragment(rawType);

  if (forbidden !== null) {
    return specProblem({
      code: 'FORBIDDEN_TYPE',
      detail:
        `o tipo "${String(rawType)}" (dado sensível: ${forbidden}) não é oferecido pelo ` +
        `sistema. Tipos possíveis: ${FORM_FIELD_TYPES.join(', ')}`,
      index: position,
      key: rawKey,
      reason: `tipo sensível proibido: ${String(rawType)} (fragmento: ${forbidden})`,
    });
  }

  if (!isFormFieldType(rawType)) {
    return specProblem({
      code: 'UNKNOWN_TYPE',
      detail:
        `o tipo "${String(rawType)}" do campo "${rawKey}" não existe. ` +
        `Tipos possíveis: ${FORM_FIELD_TYPES.join(', ')}`,
      index: position,
      key: rawKey,
      reason: `type desconhecido: ${JSON.stringify(rawType)}`,
    });
  }

  const type = rawType;

  // ── Finalidade: obrigatória no texto longo (é o que a LGPD pede) ────────────
  const rawPurpose = candidate.purpose;

  if (rawPurpose !== undefined && typeof rawPurpose !== 'string') {
    return specProblem({
      code: 'MISSING_PURPOSE',
      detail: `a finalidade do campo "${rawKey}" precisa ser texto`,
      index: position,
      key: rawKey,
      reason: `purpose: ${typeof rawPurpose}`,
    });
  }

  if (formFieldRequiresPurpose(type) && !isFilledText(rawPurpose)) {
    return specProblem({
      code: 'MISSING_PURPOSE',
      detail:
        `o texto longo "${rawKey}" precisa declarar a finalidade — para que o dado serve ` +
        '(é o que a LGPD pede e o que a tela mostra ao participante)',
      index: position,
      key: rawKey,
      reason: 'LONG_TEXT sem finalidade',
    });
  }

  if (isFilledText(rawPurpose) && rawPurpose.trim().length > FORM_PURPOSE_MAX) {
    return specProblem({
      code: 'MISSING_PURPOSE',
      detail: `a finalidade de "${rawKey}" passa de ${FORM_PURPOSE_MAX} caracteres`,
      index: position,
      key: rawKey,
      reason: `purpose com ${rawPurpose.trim().length} caracteres`,
    });
  }

  /**
   * `required` só é CONFERIDO aqui (a forma); o valor em si é passado adiante na
   * normalização do spec, que é quem monta o campo. Quem decide o que a
   * obrigatoriedade FAZ é o validador das respostas.
   */
  const rawRequired = candidate.required;

  if (rawRequired !== undefined && typeof rawRequired !== 'boolean') {
    return specProblem({
      code: 'INVALID_REQUIRED',
      detail: `"required" do campo "${rawKey}" precisa ser verdadeiro ou falso`,
      index: position,
      key: rawKey,
      reason: `required: ${JSON.stringify(rawRequired)}`,
    });
  }

  // ── Limite de caracteres: só onde há texto para limitar ─────────────────────
  const rawMaxLength = candidate.maxLength;

  if (rawMaxLength !== undefined) {
    if (type !== 'SHORT_TEXT' && type !== 'LONG_TEXT') {
      return specProblem({
        code: 'INVALID_MAX_LENGTH',
        detail: `o campo "${rawKey}" é ${FORM_FIELD_TYPE_LABELS[type]} e não usa limite de caracteres`,
        index: position,
        key: rawKey,
        reason: `maxLength em tipo ${type}`,
      });
    }

    const ceiling = type === 'SHORT_TEXT' ? FORM_SHORT_TEXT_MAX : FORM_LONG_TEXT_MAX;

    if (!isFiniteInteger(rawMaxLength) || rawMaxLength < 1 || rawMaxLength > ceiling) {
      return specProblem({
        code: 'INVALID_MAX_LENGTH',
        detail:
          `o limite do campo "${rawKey}" precisa ser um número inteiro entre 1 e ${ceiling}` +
          ` (teto do tipo ${FORM_FIELD_TYPE_LABELS[type]})`,
        index: position,
        key: rawKey,
        reason: `maxLength: ${JSON.stringify(rawMaxLength)}`,
      });
    }
  }

  // ── Faixa do número: inteiro, fechada, e só no tipo número ──────────────────
  const rawMin = candidate.min;
  const rawMax = candidate.max;

  if (rawMin !== undefined || rawMax !== undefined) {
    if (type !== 'NUMBER') {
      return specProblem({
        code: 'INVALID_RANGE',
        detail: `o campo "${rawKey}" é ${FORM_FIELD_TYPE_LABELS[type]} e não usa faixa de valores`,
        index: position,
        key: rawKey,
        reason: `min/max em tipo ${type}`,
      });
    }

    if (rawMin !== undefined && !isFiniteInteger(rawMin)) {
      return specProblem({
        code: 'INVALID_RANGE',
        detail: `o mínimo do campo "${rawKey}" precisa ser um número inteiro`,
        index: position,
        key: rawKey,
        reason: `min: ${JSON.stringify(rawMin)}`,
      });
    }

    if (rawMax !== undefined && !isFiniteInteger(rawMax)) {
      return specProblem({
        code: 'INVALID_RANGE',
        detail: `o máximo do campo "${rawKey}" precisa ser um número inteiro`,
        index: position,
        key: rawKey,
        reason: `max: ${JSON.stringify(rawMax)}`,
      });
    }

    if (
      isFiniteInteger(rawMin) &&
      isFiniteInteger(rawMax) &&
      rawMin > rawMax
    ) {
      return specProblem({
        code: 'INVALID_RANGE',
        detail: `no campo "${rawKey}" o mínimo (${rawMin}) é maior que o máximo (${rawMax})`,
        index: position,
        key: rawKey,
        reason: `min ${rawMin} > max ${rawMax}`,
      });
    }
  }

  // ── Escolha única: lista de opções distintas ───────────────────────────────
  const rawOptions = candidate.options;

  if (type === 'SINGLE_CHOICE') {
    if (rawOptions === undefined || rawOptions === null) {
      return specProblem({
        code: 'MISSING_OPTIONS',
        detail: `a escolha única "${rawKey}" não tem opções`,
        index: position,
        key: rawKey,
        reason: 'options ausente em SINGLE_CHOICE',
      });
    }

    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      return specProblem({
        code: 'INVALID_OPTIONS',
        detail: `as opções de "${rawKey}" precisam ser uma lista com pelo menos uma opção`,
        index: position,
        key: rawKey,
        reason: `options: ${Array.isArray(rawOptions) ? 'lista vazia' : typeof rawOptions}`,
      });
    }

    if (rawOptions.length > FORM_CHOICE_OPTIONS_MAX) {
      return specProblem({
        code: 'INVALID_OPTIONS',
        detail: `"${rawKey}" tem ${rawOptions.length} opções; o teto é ${FORM_CHOICE_OPTIONS_MAX}`,
        index: position,
        key: rawKey,
        reason: `options com ${rawOptions.length} itens`,
      });
    }

    const seen = new Set<string>();

    for (const option of rawOptions) {
      if (typeof option !== 'string' || option.trim().length === 0) {
        return specProblem({
          code: 'INVALID_OPTIONS',
          detail: `toda opção de "${rawKey}" precisa ser texto não vazio`,
          index: position,
          key: rawKey,
          reason: `opção: ${JSON.stringify(option)}`,
        });
      }

      if (option.trim().length > FORM_CHOICE_OPTION_MAX) {
        return specProblem({
          code: 'INVALID_OPTIONS',
          detail: `a opção "${option.trim().slice(0, 20)}…" de "${rawKey}" passa de ${FORM_CHOICE_OPTION_MAX} caracteres`,
          index: position,
          key: rawKey,
          reason: `opção com ${option.trim().length} caracteres`,
        });
      }

      /**
       * Opção repetida é recusada: o participante veria duas linhas iguais, escolheria
       * uma, e o relatório somaria a outra como zero.
       */
      if (seen.has(option.trim())) {
        return specProblem({
          code: 'INVALID_OPTIONS',
          detail: `a opção "${option.trim()}" de "${rawKey}" aparece mais de uma vez`,
          index: position,
          key: rawKey,
          reason: `opção repetida: ${option.trim()}`,
        });
      }

      seen.add(option.trim());
    }
  } else if (rawOptions !== undefined) {
    return specProblem({
      code: 'INVALID_OPTIONS',
      detail: `o campo "${rawKey}" é ${FORM_FIELD_TYPE_LABELS[type]} e não usa opções`,
      index: position,
      key: rawKey,
      reason: `options em tipo ${type}`,
    });
  }

  // ── Ajuda: texto curto, opcional ───────────────────────────────────────────
  const rawHelp = candidate.help;

  if (rawHelp !== undefined) {
    if (typeof rawHelp !== 'string' || rawHelp.trim().length > FORM_HELP_MAX) {
      return specProblem({
        code: 'INVALID_HELP',
        detail: `o texto de ajuda de "${rawKey}" precisa ser texto de até ${FORM_HELP_MAX} caracteres`,
        index: position,
        key: rawKey,
        reason: `help: ${JSON.stringify(rawHelp)}`,
      });
    }
  }

  return null;
}

/**
 * Valida a lista INTEIRA de campos e devolve a lista normalizada — ou os problemas,
 * sem normalizar nada.
 *
 * Devolver a lista normalizada (e não o que veio) é o mesmo motivo do
 * `validateProposalData`: o que não está no spec não entra. E devolver TODOS os
 * problemas, em vez de parar no primeiro, é o que faz a tela do organizador poder
 * apontar cada campo de uma vez em vez de fazê-lo descobrir um erro por gravação.
 */
export function validateRegistrationFormSpec(raw: unknown): FormSpecValidation {
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      problems: [
        specProblem({
          code: 'NOT_A_LIST',
          detail: 'a configuração do formulário precisa ser uma lista de campos',
          index: null,
          key: null,
          reason: `recebido: ${raw === null ? 'null' : typeof raw}`,
        }),
      ],
    };
  }

  if (raw.length > FORM_FIELDS_MAX) {
    return {
      ok: false,
      problems: [
        specProblem({
          code: 'TOO_MANY_FIELDS',
          detail: `a configuração tem ${raw.length} campos; o teto é ${FORM_FIELDS_MAX}`,
          index: null,
          key: null,
          reason: `campos: ${raw.length}`,
        }),
      ],
    };
  }

  const problems: FormSpecProblem[] = [];
  const fields: RegistrationFormField[] = [];
  /** As keys vistas ATÉ AGORA — é o que pega a duplicata na segunda ocorrência. */
  const keysSeen = new Set<string>();

  raw.forEach((item, index) => {
    const problem = inspectField(item, index, keysSeen);

    if (problem !== null) {
      problems.push(problem);
      return;
    }

    const candidate = item as Record<string, unknown>;
    const key = candidate.key as string;
    const type = candidate.type as FormFieldType;

    keysSeen.add(key);

    const field: RegistrationFormField = {
      key,
      label: (candidate.label as string).trim(),
      type,
      required: candidate.required === true,
    };

    if (typeof candidate.maxLength === 'number') field.maxLength = candidate.maxLength;
    if (typeof candidate.min === 'number') field.min = candidate.min;
    if (typeof candidate.max === 'number') field.max = candidate.max;
    if (isFilledText(candidate.help)) field.help = candidate.help.trim();
    if (isFilledText(candidate.purpose)) field.purpose = candidate.purpose.trim();

    if (Array.isArray(candidate.options)) {
      field.options = (candidate.options as string[]).map((option) => option.trim());
    }

    fields.push(field);
  });

  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, fields };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Validação das RESPOSTAS — devolve SÓ o que foi aceito
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Por que uma resposta não entrou. Cada código existe para a tela (fatia 4) poder
 * dizer o que houve sem inventar texto, e para o teste poder prender o motivo.
 *
 * Não há código para "chave desconhecida": chave fora do spec não é resposta com
 * defeito — ela simplesmente não faz parte deste formulário, e por isso não aparece em
 * `rejected` (que é a lista do que a PESSOA precisa corrigir). O que não está na
 * especificação não entra, calado e por desenho.
 */
export type FormResponseErrorCode =
  | 'WRONG_TYPE'
  | 'TOO_LONG'
  | 'NOT_AN_OPTION'
  | 'OUT_OF_RANGE'
  | 'INVALID_DATE';

export interface FormResponseRejection {
  code: FormResponseErrorCode;
  /** A `key` que não entrou. */
  key: string;
  /** O rótulo, para o texto da tela não depender da chave. */
  label: string;
  /** Mensagem em português, pronta para a tela. */
  message: string;
}

export interface FormResponseProblem {
  code: 'MISSING_REQUIRED' | 'SPEC_INVALID' | 'NOT_A_RECORD';
  /** A `key` do campo que barrou; `null` quando o spec inteiro é que está torto. */
  key: string | null;
  label: string | null;
  message: string;
}

export type FormResponsesValidation =
  | {
      ok: true;
      /** SÓ o que foi aceito — chave fora do spec não aparece aqui. */
      accepted: Record<string, unknown>;
      /** O que entrou. Repetido de propósito: é a leitura que o teste prende. */
      acceptedKeys: readonly string[];
      /** O que não entrou, com o motivo — o que a tela usa para avisar. */
      rejected: readonly FormResponseRejection[];
    }
  | { ok: false; problem: FormResponseProblem };

/**
 * Sentinelas dos caminhos de normalização.
 *
 * São `Symbol`, e não strings de erro, porque o valor normalizado pode ser QUALQUER
 * coisa que o campo aceita — inclusive a string `'WRONG_TYPE'` digitada por alguém. Um
 * símbolo não colide com resposta nenhuma.
 */
const WRONG_TYPE = Symbol('WRONG_TYPE');
const ANSWER_MISSING = Symbol('ANSWER_MISSING');
const TOO_LONG_SENTINEL = Symbol('TOO_LONG');
const NOT_AN_OPTION_SENTINEL = Symbol('NOT_AN_OPTION');
const INVALID_DATE_SENTINEL = Symbol('INVALID_DATE');

/** Texto de tela, sem a chave crua quando o rótulo já diz qual é o campo. */
function fieldName(label: string, key: string): string {
  return label.length > 0 ? `"${label}"` : `"${key}"`;
}

function parseNumberAnswer(text: string): number | null {
  const normalized = text.trim();

  /** Só dígitos, com sinal e parte decimal opcional: `12,5` é recusado, não adivinhado. */
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;

  const value = Number(normalized);

  return Number.isFinite(value) ? value : null;
}

/**
 * Interpreta Sim/Não.
 *
 * O formulário HTML manda `"on"` quando a caixa está marcada, e `""`/ausente quando
 * não está; um `POST` cru pode mandar `"true"`/`"1"`. Qualquer OUTRO texto é recusado
 * em vez de virar `true` por ser "não vazio" — `"talvez"` não é resposta de Sim/Não.
 */
function normalizeYesNo(value: unknown): boolean | typeof WRONG_TYPE {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return WRONG_TYPE;

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === 'on' || normalized === 'sim' || normalized === '1') {
    return true;
  }

  if (
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'nao' ||
    normalized === 'não' ||
    normalized === '0' ||
    normalized === ''
  ) {
    return false;
  }

  return WRONG_TYPE;
}

/**
 * Normaliza UMA resposta contra o seu campo.
 *
 * Devolve a sentinela `ANSWER_MISSING` quando o campo simplesmente não foi respondido
 * (quem decide se isso recusa é o `required`, adiante) e a sentinela `WRONG_TYPE`
 * quando o valor não é do tipo do campo. Nada aqui converte tipo em silêncio: um
 * número enviado como `"abc"` não vira `0`.
 */
function normalizeAnswer(
  field: RegistrationFormField,
  value: unknown,
): unknown {
  switch (field.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (value === undefined || value === null) return ANSWER_MISSING;
      if (typeof value !== 'string') return WRONG_TYPE;

      const text = value.trim();

      if (text.length === 0) return ANSWER_MISSING;

      const ceiling =
        field.maxLength ??
        (field.type === 'SHORT_TEXT' ? FORM_SHORT_TEXT_MAX : FORM_LONG_TEXT_MAX);

      /** O limite é medido no valor que SERIA gravado (aparado), não no cru. */
      if (text.length > ceiling) return TOO_LONG_SENTINEL;

      return text;
    }

    case 'SINGLE_CHOICE': {
      if (typeof value !== 'string') {
        return value === undefined || value === null ? ANSWER_MISSING : WRONG_TYPE;
      }

      const text = value.trim();

      if (text.length === 0) return ANSWER_MISSING;

      const options = field.options ?? [];

      /** Fora das opções não entra — nem para "normalizar" a caixa do texto. */
      if (!options.includes(text)) return NOT_AN_OPTION_SENTINEL;

      return text;
    }

    case 'YES_NO': {
      if (value === undefined || value === null || value === '') return ANSWER_MISSING;

      return normalizeYesNo(value);
    }

    case 'NUMBER': {
      if (value === undefined || value === null || value === '') return ANSWER_MISSING;

      const parsed =
        typeof value === 'number'
          ? Number.isFinite(value)
            ? value
            : null
          : typeof value === 'string'
            ? parseNumberAnswer(value)
            : null;

      if (parsed === null) return WRONG_TYPE;

      /**
       * Campo número é INTEIRO (o spec só aceita faixa inteira): `12.7` é recusado em
       * vez de truncado para 12 — truncar gravaria um número que ninguém digitou.
       */
      if (!Number.isInteger(parsed)) return WRONG_TYPE;

      return parsed;
    }

    case 'DATE': {
      if (value === undefined || value === null || value === '') return ANSWER_MISSING;
      if (typeof value !== 'string') return WRONG_TYPE;

      const text = value.trim();

      if (!isCalendarDate(text)) return INVALID_DATE_SENTINEL;

      return text;
    }
  }
}

/** As respostas cruas, quando vieram como objeto indexável. */
function asRecord(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;

  return raw as Record<string, unknown>;
}

/**
 * Valida as respostas contra a lista de campos e devolve SÓ O QUE FOI ACEITO.
 *
 * O contrato é o do `validateProposalData` (F33): o que não está na especificação não
 * entra — chave desconhecida (campo que o organizador não declarou, ou formulário de
 * outro evento), tipo errado, valor acima do limite, escolha fora das opções, número
 * fora da faixa e data que não existe. Nada é coagido: `"abc"` no campo número não
 * vira `0`, e `12,5` não vira `12.5`.
 *
 * Duas coisas o validador NÃO faz, e é bom que não faça:
 *  • NÃO decide por que caminho a recusa chega ao usuário — ele devolve `rejected`,
 *    com o motivo, e a tela (fatia 4) escolhe o que mostrar.
 *  • NÃO aceita um spec inválido. Adivinhar a intenção de um spec torto seria a
 *    mesma coisa que "corrigir em silêncio" o que a configuração declarou; o
 *    resultado é `SPEC_INVALID`, com os problemas do spec dentro.
 *
 * `required` vazio é DIFERENTE dos demais: ele recusa a inscrição inteira
 * (`MISSING_REQUIRED`), e a chave E o rótulo voltam para a tela poder apontar o campo.
 *
 * A lista de campos entra como `unknown` de propósito, e não como
 * `readonly RegistrationFormField[]`: quem chama tem um JSON lido do banco, e tipar a
 * entrada como "já validada" seria uma mentira que o compilador acreditaria — o tipo
 * errado `'CPF'` não apareceria em erro nenhum de `tsc` e chegaria aqui como se fosse
 * campo bom. A validação do spec acontece DENTRO, e é ela que recusa.
 */
export function validateFormResponses(
  fields: readonly unknown[],
  raw: unknown,
): FormResponsesValidation {
  const spec = validateRegistrationFormSpec(fields);

  if (!spec.ok) {
    return {
      ok: false,
      problem: {
        code: 'SPEC_INVALID',
        key: null,
        label: null,
        message: `A configuração deste formulário está inválida: ${spec.problems[0]?.message ?? 'sem motivo declarado'}`,
      },
    };
  }

  const source = asRecord(raw);

  if (source === null) {
    return {
      ok: false,
      problem: {
        code: 'NOT_A_RECORD',
        key: null,
        label: null,
        message: 'As respostas do formulário não chegaram em um formato que o sistema entenda.',
      },
    };
  }

  const normalized = spec.fields;
  const accepted: Record<string, unknown> = {};
  const rejected: FormResponseRejection[] = [];

  for (const field of normalized) {
    const value = normalizeAnswer(field, source[field.key]);

    if (value === ANSWER_MISSING) {
      if (field.required) {
        return {
          ok: false,
          problem: {
            code: 'MISSING_REQUIRED',
            key: field.key,
            label: field.label,
            message: `Preencha ${fieldName(field.label, field.key)}.`,
          },
        };
      }

      /** Campo opcional sem resposta simplesmente não entra no JSON. */
      continue;
    }

    if (value === WRONG_TYPE) {
      rejected.push({
        code: 'WRONG_TYPE',
        key: field.key,
        label: field.label,
        message: `${fieldName(field.label, field.key)} não foi preenchido no formato esperado (${FORM_FIELD_TYPE_LABELS[field.type]}) e não foi considerado.`,
      });
      continue;
    }

    if (value === TOO_LONG_SENTINEL) {
      const ceiling =
        field.maxLength ??
        (field.type === 'SHORT_TEXT' ? FORM_SHORT_TEXT_MAX : FORM_LONG_TEXT_MAX);

      rejected.push({
        code: 'TOO_LONG',
        key: field.key,
        label: field.label,
        message: `${fieldName(field.label, field.key)} passa de ${ceiling} caracteres e não foi considerado.`,
      });
      continue;
    }

    if (value === NOT_AN_OPTION_SENTINEL) {
      rejected.push({
        code: 'NOT_AN_OPTION',
        key: field.key,
        label: field.label,
        message: `${fieldName(field.label, field.key)} só aceita uma das opções: ${optionsPreview(field.options ?? [])}.`,
      });
      continue;
    }

    if (value === INVALID_DATE_SENTINEL) {
      rejected.push({
        code: 'INVALID_DATE',
        key: field.key,
        label: field.label,
        message: `${fieldName(field.label, field.key)} não é uma data válida (use o formato AAAA-MM-DD).`,
      });
      continue;
    }

    if (typeof value === 'number') {
      const belowMin = field.min !== undefined && value < field.min;
      const aboveMax = field.max !== undefined && value > field.max;

      /** Os limites SÃO aceitos: 18 passa quando a faixa é 18..99. */
      if (belowMin || aboveMax) {
        const range =
          field.min !== undefined && field.max !== undefined
            ? `entre ${field.min} e ${field.max}`
            : field.min !== undefined
              ? `a partir de ${field.min}`
              : `até ${field.max}`;

        rejected.push({
          code: 'OUT_OF_RANGE',
          key: field.key,
          label: field.label,
          message: `${fieldName(field.label, field.key)} precisa ficar ${range} e não foi considerado.`,
        });
        continue;
      }
    }

    accepted[field.key] = value;
  }

  return { ok: true, accepted, acceptedKeys: Object.keys(accepted), rejected };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O que é GRAVADO: o declarado, e as chaves do SISTEMA por último
// ───────────────────────────────────────────────────────────────────────────────
/**
 * O depósito de respostas como ele vai para o banco: o que o organizador declarou e,
 * por ÚLTIMO, o que é do SISTEMA.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A ORDEM É UMA FUNÇÃO, E NÃO UM ESPALHAMENTO EM CADA ACTION
 * ─────────────────────────────────────────────────────────────────────────────
 *  As duas portas de escrita (`registerForEventAction` e
 *  `completeEventRegistrationDataAction`) montam o mesmo objeto:
 *  `{ ...aceitoPeloOrganizador, cpf }`. A ordem não é estilo — é a última palavra sobre
 *  a chave `cpf`, que é o dado do CERTIFICADO. Escrita duas vezes, ela divergiria na
 *  primeira manutenção, e o modo de falha é o pior possível: o CPF do sistema trocado
 *  pelo que alguém digitou num campo do organizador, em silêncio, num documento.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE NÃO É CÓDIGO MORTO, MESMO COM O VALIDADOR JÁ RECUSANDO `cpf`
 * ─────────────────────────────────────────────────────────────────────────────
 *  Há uma camada acima: `FORM_RESERVED_KEYS` recusa `cpf` como identificador de campo,
 *  então `accepted` nunca deveria trazer essa chave. Esta função é a SEGUNDA camada, e
 *  ela existe por um motivo datado: a lista de reservadas precisa acompanhar, para
 *  sempre, o nome de cada controle fixo que qualquer fase futura acrescentar — e quem
 *  esquecer de acrescentar lá não vai lembrar daqui. Com a ordem fixada AQUI, uma chave
 *  de sistema nova ganha a última palavra sem que ninguém precise editar nada.
 *  A catraca de unidade passa um `accepted` com `cpf` de propósito: é a única forma de
 *  provar a promessa da função sem depender de um spec que o validador já barra.
 */
export function composeFormResponses(input: {
  /** O que o domínio ACEITOU das respostas do organizador. */
  declared: Record<string, unknown>;
  /** As chaves do sistema — elas ganham, sempre. */
  system: Record<string, unknown>;
}): Record<string, unknown> {
  return { ...input.declared, ...input.system };
}

// ───────────────────────────────────────────────────────────────────────────────
//  O leitor TOLERANTE da configuração
// ───────────────────────────────────────────────────────────────────────────────
/** De onde veio o formulário que a leitura devolveu. */
export type RegistrationFormSource = 'DEFAULT' | 'SETTINGS';

export interface ReadRegistrationFormResult {
  /**
   * Os campos DECLARADOS pelo organizador. Quando a configuração está ausente ou
   * torta, a lista volta VAZIA — e vazia significa "o formulário de sempre", que é o
   * que o serviço de inscrição continua fazendo (CPF, necessidades e consentimentos,
   * com o `cpf` gravado em `registrations.formResponses`). Esses campos NÃO são
   * recriados aqui de propósito: eles vivem no fluxo real de inscrição, e duplicá-los
   * neste spec criaria uma segunda fonte da verdade capaz de divergir da primeira.
   */
  fields: readonly RegistrationFormField[];
  source: RegistrationFormSource;
  /** Por que caiu no padrão — para a tela poder avisar o organizador. */
  problems: readonly FormSpecProblem[];
}

/**
 * Lê o formulário declarado de `Event.settings` (JSON), sem migração.
 *
 * O padrão do projeto para configuração por evento (`readEventRegistrationPolicy`,
 * F12) é o leitor TOLERANTE, e a tolerância é o ponto: `settings` é campo livre, e um
 * valor de outro tipo — texto, número, lista de strings, ausente — NÃO pode derrubar
 * a página de inscrição de um evento. Valor ausente ou inválido cai no formulário de
 * sempre, e a leitura devolve o MOTIVO junto (`problems`), para que a tela do
 * organizador possa dizer o que está torto em vez de mostrar um formulário vazio sem
 * explicação.
 */
export function readRegistrationForm(settings: unknown): ReadRegistrationFormResult {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return { fields: [], source: 'DEFAULT', problems: [] };
  }

  const raw = (settings as Record<string, unknown>).registrationForm;

  /** Ausente é o caso normal — o evento que nunca montou formulário —, não um erro. */
  if (raw === undefined || raw === null) {
    return { fields: [], source: 'DEFAULT', problems: [] };
  }

  const validation = validateRegistrationFormSpec(raw);

  if (!validation.ok) {
    return { fields: [], source: 'DEFAULT', problems: validation.problems };
  }

  return { fields: validation.fields, source: 'SETTINGS', problems: [] };
}

// ───────────────────────────────────────────────────────────────────────────────
//  Dado pessoal — o padrão é NÃO expor
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As chaves do formulário do evento que PODEM sair em superfície de terceiro.
 *
 * É allowlist, e não lista de proibidos, pelo mesmo motivo do pacote do perfil
 * público (F44) e do pacote do patrocinador (F42): a lista de campos do evento é
 * DADO, e cresce sem revisão de código. Uma lista de proibidos só continuaria correta
 * enquanto alguém lembrasse de acrescentar o campo novo — e o modo de falha é o dado
 * sensível saindo no CSV. Com allowlist, o campo novo nasce FORA, e o único jeito de
 * expor é uma decisão explícita, tomada aqui.
 *
 * As respostas do formulário do evento NÃO entram em superfície de terceiro por
 * decisão do humano na FASE 70 (nem no CSV da F49, nem no perfil público da F44). O
 * e-mail é a exceção que já era dada por outro caminho — ele é coluna da inscrição,
 * não resposta do formulário —, e por isso não há nenhuma chave a expor hoje. A lista
 * fica declarada mesmo assim: é o lugar onde a exceção futura vai morar, com autor.
 */
export const THIRD_PARTY_FORM_RESPONSE_KEYS: readonly string[] = [];

/**
 * As respostas que NÃO podem sair em superfície de terceiro.
 *
 * Existe para quem precisa ESCREVER essas linhas — o aviso ao organizador (fatia 3) e
 * o caminho de eliminação (fatia 4) — e para o teste provar que elas não saem.
 */
export const THIRD_PARTY_FORBIDDEN_FORM_KEYS: readonly string[] = [
  'cpf',
  'accessibilityNotes',
  'dietaryNotes',
  'consentData',
  'consentImage',
];

/**
 * Tira das respostas o que NÃO deve sair em superfície de terceiro.
 *
 * O padrão é NÃO EXPOR: o que não está em `THIRD_PARTY_FORM_RESPONSE_KEYS` sai da
 * cópia. Isso inclui o CPF e as necessidades de acessibilidade — que são dado
 * sensível de saúde quando descrevem restrição alimentar ou deficiência (art. 5º, II,
 * da LGPD) —, e inclui QUALQUER campo novo que o organizador declarar amanhã.
 *
 * Não mexe no objeto recebido (devolve cópia) porque quem chama costuma ter o JSON
 * original do banco em mãos e iria gravá-lo de volta depois.
 */
export function formResponsesWithoutPersonalData(
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const visible: Record<string, unknown> = {};

  for (const key of THIRD_PARTY_FORM_RESPONSE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(responses, key)) {
      visible[key] = responses[key];
    }
  }

  return visible;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A ELIMINAÇÃO DAS RESPOSTAS — o que SAI e o que FICA (FASE 70 · fatia 4)
// ───────────────────────────────────────────────────────────────────────────────
/**
 * As chaves do depósito de respostas que a ELIMINAÇÃO **NÃO** apaga.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE É UMA ALLOWLIST DO QUE FICA — E NÃO A LISTA DO QUE SAI
 * ─────────────────────────────────────────────────────────────────────────────
 *  A lista poderia ser "as chaves dos campos declarados" (tiradas do spec do
 *  formulário). Ela seria mais estreita e falharia no caso que importa: o organizador
 *  que REMOVE um campo do formulário depois de receber respostas. A `key` sai do spec
 *  e a resposta da pessoa deixa de pertencer a campo nenhum — e ficaria guardada para
 *  sempre, sem que ninguém pudesse apagá-la. Com a allowlist do que FICA, o que não é
 *  obrigação declarada do evento sai, tenha o campo sobrevivido ao formulário ou não.
 *  O modo de falha é o certo: na dúvida, apaga.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FICA, E POR QUÊ
 * ─────────────────────────────────────────────────────────────────────────────
 *  • **`cpf`** — é a base do CERTIFICADO. Apagá-lo não protegeria ninguém (o
 *    documento já foi emitido, e o número identifica a pessoa no documento) e
 *    quebraria a emissão de quem ainda vai pedir o seu: o certificado sairia sem CPF
 *    por causa de uma eliminação que a pessoa fez sobre OUTRO dado. A pessoa que
 *    quiser apagar o CPF também tem o caminho de corrigir a própria inscrição — e o
 *    certificado já emitido é o documento que ela pediu.
 *  • **Os consentimentos** (`consentData`, `consentImage`) **não estão neste
 *    depósito**: eles são COLUNAS da inscrição. A eliminação não as toca — e não
 *    poderia: o consentimento é a BASE LEGAL do tratamento que restou (a inscrição, a
 *    vaga, o histórico). Apagar o registro de que a pessoa autorizou, mantendo o dado
 *    que ele autorizou, seria guardar o dado sem a prova de que ele podia ser
 *    guardado.
 *
 *  Nenhuma dessas chaves é resposta de campo declarado — `cpf` e as quatro do
 *  formulário fixo são identificadores RESERVADOS (`FORM_RESERVED_KEYS`), e é isso
 *  que impede um campo do organizador de cair aqui dentro.
 */
export const EVENT_OBLIGATION_FORM_KEYS: readonly string[] = ['cpf'];

export interface EraseFormResponsesResult {
  /** O que CONTINUA gravado — sempre um objeto novo, nunca o recebido. */
  kept: Record<string, unknown>;
  /** As chaves que saíram, na ordem em que estavam no depósito. */
  removedKeys: readonly string[];
}

/**
 * Tira do depósito de respostas tudo o que não é obrigação do evento.
 *
 * É regra PURA de propósito: o que a eliminação apaga é a decisão mais difícil desta
 * fatia (apagar demais quebra o certificado; apagar de menos é mentira na tela), e ela
 * precisa ser provável sem banco e sem tela. Quem lê e grava é o serviço.
 *
 * Não modifica o objeto recebido (devolve cópia) porque quem chama tem o JSON do banco
 * em mãos e iria gravá-lo de volta.
 *
 * Valor que não é objeto — `null`, texto, lista — é lido como depósito VAZIO: não há
 * chave nenhuma a preservar, e a resposta honesta é "não havia nada". Recusar aqui
 * faria a eliminação depender do formato de um dado que ela mesma vai substituir.
 */
export function erasePersonalFormResponses(responses: unknown): EraseFormResponsesResult {
  const kept: Record<string, unknown> = {};
  const removedKeys: string[] = [];

  if (typeof responses !== 'object' || responses === null || Array.isArray(responses)) {
    return { kept, removedKeys };
  }

  const source = responses as Record<string, unknown>;

  for (const key of Object.keys(source)) {
    if (EVENT_OBLIGATION_FORM_KEYS.includes(key)) {
      kept[key] = source[key];
      continue;
    }

    removedKeys.push(key);
  }

  return { kept, removedKeys };
}
