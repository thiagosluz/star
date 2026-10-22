/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DOMÍNIO — AS FRASES DA TELA DO ORGANIZADOR DO RESULTADO
 *                                                          (FASE 73 · fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE AS FRASES SÃO DOMÍNIO, E NÃO TEXTO SOLTO NO JSX
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Em cada um dos quatro estados, a tela precisa dizer DUAS coisas diferentes: o que
 *  aconteceu com o resultado e o que o PÚBLICO vê agora. São frases com consequência
 *  (RASCUNHO não aparece; PARCIAL continua editável; FINAL está travado), e é o
 *  organizador que decide o próximo clique lendo exatamente isso.
 *
 *  Se elas morassem no JSX, trocar "travado" por "bloqueado" passaria no `tsc`, no
 *  lint e no E2E (que procura o selo, não o significado) — e a tela prometeria uma
 *  coisa enquanto o domínio cumpre outra. Aqui a frase é DADO, e o teste a prende.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTE MÓDULO NÃO DECIDE LEGALIDADE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Quais gestos existem é resposta de `availableCallResultActions` (fatia 1), e a
 *  tela recebe a lista PRONTA do serviço (`acoesDisponiveis`). Aqui há só o rótulo e
 *  a consequência de cada gesto que o domínio JÁ autorizou — derivar a lista de novo
 *  criaria duas verdades sobre o que é legal, e a da tela venceria na percepção de
 *  quem usa. A explicação do REABRIR mora aqui porque é ela que precisa dizer, antes
 *  do clique, que o final DEIXA de ser final e que o ato fica na trilha.
 *
 *  O módulo é PURO: importa só o domínio do resultado, não lê relógio e não formata
 *  data. O rótulo da publicação chega pronto do SERVIDOR, já no fuso do evento — a
 *  mesma string no HTML e na hidratação (duas formatações divergiriam no navegador).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import {
  CALL_RESULT_ACTION_LABELS,
  CALL_RESULT_NEXT_STEPS_MAX,
  CALL_RESULT_STATE_LABELS,
  CALL_RESULT_TEXT_MAX,
  type CallResultAction,
  type CallResultState,
} from './call-result-rules';

// ───────────────────────────────────────────────────────────────────────────────
//  O estado: o rótulo, a consequência e o que o público vê
// ───────────────────────────────────────────────────────────────────────────────
export interface CallResultStateScreenCopy {
  /** O rótulo do estado — o MESMO que o domínio do resultado usa. */
  label: string;
  /** O que aconteceu, e o que o organizador pode fazer a seguir. */
  phrase: string;
  /** O que o público vê enquanto o resultado está neste estado. */
  publicNote: string;
  /** O estado não aceita edição: só REABRIR tira o resultado daqui. */
  locked: boolean;
}

/**
 * As quatro frases, uma por estado. O `Record` é catraca do `tsc`: um estado novo em
 * `CALL_RESULT_STATES` sem frase quebra o typecheck, em vez de virar um cartão mudo.
 *
 * Os textos de PUBLIC_NOTE são, de propósito, diferentes dos de PHRASE: a tela mostra
 * os dois lado a lado (o organizador e o público veem coisas diferentes no mesmo
 * instante), e repetir a mesma frase nos dois lugares esconderia justamente essa
 * diferença.
 */
export const CALL_RESULT_STATE_SCREEN: Readonly<Record<CallResultState, CallResultStateScreenCopy>> = {
  SEM_RESULTADO: {
    label: CALL_RESULT_STATE_LABELS.SEM_RESULTADO,
    phrase:
      'Esta chamada ainda não teve resultado. Escreva o texto, escolha a lista e salve um rascunho — ou publique direto.',
    publicNote: 'O público não vê nenhuma seção de resultado.',
    locked: false,
  },
  RASCUNHO: {
    label: CALL_RESULT_STATE_LABELS.RASCUNHO,
    phrase:
      'O resultado está salvo como rascunho e continua editável. Ninguém fora da organização o vê.',
    publicNote: 'Nada aparece no público enquanto você não publicar.',
    locked: false,
  },
  PARCIAL: {
    label: CALL_RESULT_STATE_LABELS.PARCIAL,
    phrase:
      'O resultado está publicado como parcial e continua editável: publicar de novo substitui a versão que está no ar.',
    publicNote: 'O público vê esta versão agora.',
    locked: false,
  },
  FINAL: {
    label: CALL_RESULT_STATE_LABELS.FINAL,
    phrase:
      'O resultado final está publicado e travado: para mudar o texto ou a lista, reabra o resultado final.',
    publicNote: 'O público vê esta versão final.',
    locked: true,
  },
};

// ───────────────────────────────────────────────────────────────────────────────
//  Os gestos: o rótulo e a consequência de cada um
// ───────────────────────────────────────────────────────────────────────────────
export interface CallResultActionScreenCopy {
  label: string;
  /** O que o clique FAZ — dito antes dele, não depois. */
  description: string;
  /** É gesto de publicação? (vai ao ar imediatamente) */
  publish: boolean;
}

export const CALL_RESULT_ACTION_SCREEN: Readonly<
  Record<CallResultAction, CallResultActionScreenCopy>
> = {
  SALVAR_RASCUNHO: {
    label: CALL_RESULT_ACTION_LABELS.SALVAR_RASCUNHO,
    description:
      'Salva o texto e a lista sem publicar. O público continua vendo o que já estava no ar.',
    publish: false,
  },
  PUBLICAR_PARCIAL: {
    label: CALL_RESULT_ACTION_LABELS.PUBLICAR_PARCIAL,
    description:
      'Publica agora e mantém editável. O público vê esta versão, e publicar de novo a substitui.',
    publish: true,
  },
  PUBLICAR_FINAL: {
    label: CALL_RESULT_ACTION_LABELS.PUBLICAR_FINAL,
    description:
      'Publica e TRAVA o resultado. Mudar depois exige reabrir o resultado final.',
    publish: true,
  },
  REABRIR: {
    label: CALL_RESULT_ACTION_LABELS.REABRIR,
    description:
      'O resultado final deixa de ser final e volta a ser um parcial editável. Ele continua no ar, e o ato fica na trilha de auditoria.',
    publish: false,
  },
};

/**
 * O aviso que fica PERTO DOS BOTÕES de publicação.
 *
 * Ele não é decoração: publicar muda a página que qualquer visitante lê no instante
 * seguinte (`revalidatePath` na action, FASE 73 · fatia 2), e quem clica precisa
 * saber disso ANTES. "Depois" seria tarde: o texto já estaria no ar.
 */
export const CALL_RESULT_PUBLISH_NOTICE =
  'Ao publicar, o texto e a lista vão ao ar na página pública da chamada imediatamente.';

/** O título do bloco que mostra a projeção REAL do domínio, e não uma cópia. */
export const CALL_RESULT_PREVIEW_TITLE = 'Prévia: o que o público vê agora';

/**
 * A frase da prévia vazia.
 *
 * Ela não diz só "nada aqui": explica de onde virá o conteúdo e por que a prévia é
 * confiável — é a MESMA projeção (`projectPublicCallResult`) que a página pública
 * consome, e não um desenho paralelo que envelhece no primeiro ajuste.
 */
export const CALL_RESULT_PREVIEW_EMPTY =
  'A prévia aparece aqui quando houver resultado publicado. Ela mostra exatamente o documento que o público vê — a mesma projeção que a página da chamada usa.';

/** O título do aviso de `problems`, com a contagem concordando em português. */
export function callResultProblemsTitle(total: number): string {
  if (total === 1) return 'Há 1 problema na configuração deste resultado:';
  return `Há ${total} problemas na configuração deste resultado:`;
}

// ───────────────────────────────────────────────────────────────────────────────
//  A data da publicação, e a frase honesta quando não há data
// ───────────────────────────────────────────────────────────────────────────────
/**
 * A frase da data.
 *
 * `publicadoEmLabel` chega FORMATADO do servidor (fuso do evento). `null` é o caso de
 * quem nunca publicou — e a frase usa o estado para não dizer a mesma coisa de um
 * rascunho e de um resultado publicado sem data.
 *
 * O último ramo é defesa para o dia em que o leitor tolerante mudar: hoje
 * PARCIAL/FINAL sem data são rebaixados a RASCUNHO por `readCallResult`, e inventar
 * "agora" seria a mentira que a fatia 1 recusou de propósito.
 */
export function callResultPublicationPhrase(input: {
  estado: CallResultState;
  publicadoEmLabel: string | null;
}): string {
  if (input.publicadoEmLabel !== null) {
    return `Publicado em ${input.publicadoEmLabel}.`;
  }

  if (input.estado === 'SEM_RESULTADO' || input.estado === 'RASCUNHO') {
    return 'Ainda não publicado: nada aparece no público por este cartão.';
  }

  return 'Sem data de publicação registrada.';
}

// ───────────────────────────────────────────────────────────────────────────────
//  Os tetos, escritos para quem digita
// ───────────────────────────────────────────────────────────────────────────────
/**
 * Separador de milhar DETERMINÍSTICO.
 *
 * `toLocaleString('pt-BR')` depende do ICU carregado: o mesmo número poderia sair
 * "4.000" no servidor e "4000" no navegador, e a diferença apareceria como erro de
 * hidratação. A expressão abaixo dá o mesmo resultado em qualquer runtime.
 */
export function callResultLimitLabel(limit: number): string {
  return String(limit).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * O teto VISÍVEL do texto público, e a consequência de publicá-lo.
 *
 * O número não é decoração: o organizador escreve um comunicado para ser lido, e o
 * limite existe para a página continuar legível. O `maxLength` do campo usa o MESMO
 * número; o teto que RECUSA continua sendo o do domínio.
 */
export const CALL_RESULT_TEXT_HINT = `Até ${callResultLimitLabel(
  CALL_RESULT_TEXT_MAX,
)} caracteres. O texto aparece no público exatamente como estiver escrito aqui.`;

/** O teto visível dos próximos passos (uma instrução, não um capítulo). */
export const CALL_RESULT_NEXT_STEPS_HINT = `Até ${callResultLimitLabel(
  CALL_RESULT_NEXT_STEPS_MAX,
)} caracteres. É a parte da página que diz o que a pessoa precisa fazer agora.`;

/** O que o seletor é, e de onde a pré-marcação vem — dito acima da lista. */
export const CALL_RESULT_SELECTOR_HELP =
  'A decisão do comitê aparece ao lado de cada trabalho. As aceitas já vêm marcadas no primeiro ato; depois, a escolha é sua, e desmarcar uma aceita continua valendo.';
