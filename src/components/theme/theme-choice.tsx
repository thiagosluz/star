import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { setThemeModeAction } from '@/app/actions/theme-actions';
import { buttonClasses } from '@/components/ui/button';
import {
  THEME_MODES,
  THEME_MODE_DESCRIPTIONS,
  THEME_MODE_LABELS,
  type ThemeMode,
} from '@/lib/theme/theme-mode';
import { readThemeMode } from '@/lib/theme/theme-mode-server';
import { cn } from '@/lib/utils/cn';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CONTROLE DE TEMA — Claro · Escuro · Sistema (FASE 61 · dívida H3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  TRÊS BOTÕES DENTRO DE UM `<form>`, E NENHUM `useState`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada opção é um `<button type="submit" name="tema" value="...">`: o navegador
 *  envia o valor escolhido, a Server Action grava o cookie e o servidor redesenha
 *  o `<html>`. Não há estado no cliente, não há `onChange`, e o controle inteiro
 *  funciona ANTES de o JavaScript carregar — é o mesmo desenho do botão de recolher
 *  a barra (FASE 59) e das telas que a FASE 38 fez nascerem sem JavaScript.
 *
 *  Rádio nativo (`<input type="radio">`) foi considerado e recusado: um rádio só
 *  envia a escolha quando alguém aperta um botão de "salvar" (ou exige JavaScript
 *  para enviar no `change`), e um terceiro botão de "salvar" no meio de um menu de
 *  conta é ruído. O grupo de botões de submissão com `aria-pressed` é o primitivo
 *  que a casa já usa para "escolha que se aplica sozinha": o RÓTULO diz o que a
 *  opção faz, e `aria-pressed` diz qual está valendo agora.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE LÊ O COOKIE EM VEZ DE RECEBER O TEMA POR PROP
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ele aparece em dois lugares que não se conhecem (o menu de conta do casco e o
 *  `/conta`, que não tem casco). Ler o mesmo cookie na mesma requisição — o
 *  `cookies()` do Next é memoizado por requisição — mantém UM dono do estado em vez
 *  de criar um caminho paralelo para a mesma verdade, e é impossível o botão
 *  marcado como "atual" discordar do `<html>` que o servidor acabou de escrever.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O NOME ACESSÍVEL DO CONJUNTO E DE CADA OPÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O `<fieldset>` com `<legend>` é quem nomeia o grupo ("Tema da interface"):
 *  sem ele, quem usa leitor de tela ouviria três botões soltos sem saber do que
 *  eles tratam. Cada botão carrega, além do rótulo visível, a FRASE que explica a
 *  escolha — em `sr-only` no menu (onde não há espaço) e visível no `/conta` (onde
 *  a pessoa está justamente decidindo). O `title` atende quem usa o ponteiro.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARIANTE `public` É ESTA MESMA PEÇA, E NÃO UMA CÓPIA (FASE 63)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O visitante que nunca entrou — a aba anônima, o computador emprestado — também
 *  precisa discordar do tema, e o rodapé das páginas públicas da PLATAFORMA
 *  (`/`, `/organizacoes`, `/validar/**`) é onde ele procura por isso. Esses três
 *  rodapés nasceram em fases diferentes e continuam sendo de cada página (o texto
 *  de `/` não é o de `/validar`).
 *
 *  Copiar o `<form>` para dentro de cada um deles seria abrir três lugares para a
 *  MESMA verdade divergir: um quarto modo acrescentado em um arquivo só, uma
 *  classe de estado corrigida em dois de três — e o visitante lendo "Claro"
 *  marcado numa página e "Sistema" em outra, com o cookie dizendo uma terceira
 *  coisa. Aqui a lista `THEME_MODES`, o `aria-pressed`, o `name="tema"` e a Server
 *  Action existem UMA vez; o que cada rodapé decide é só onde o controle mora.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A VARIANTE PÚBLICA NÃO USA `<fieldset>` (e as outras duas usam)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `menu` e `account` são BLOCOS: o `<legend>` fica acima dos botões e é ele que
 *  nomeia o grupo. No rodapé a decisão é outra — a linha é UMA, com "Aparência:" e
 *  os três estados lado a lado —, e um `<legend>` não se posiciona em linha ao lado
 *  dos botões sem apostar no layout especial que cada navegador dá ao `fieldset`
 *  (a caixa que o `display: flex` do `fieldset` produz varia entre eles). O
 *  `role="group"` com `aria-labelledby` apontando para o texto VISÍVEL nomeia o
 *  conjunto do mesmo jeito, sem depender dessa aposta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O ícone de cada opção. Decorativo: o nome vem do texto, nunca do desenho. */
const ICONES: Readonly<Record<ThemeMode, ReactNode>> = {
  claro: <Sun className="size-4" aria-hidden />,
  escuro: <Moon className="size-4" aria-hidden />,
  sistema: <Monitor className="size-4" aria-hidden />,
};

/**
 * `menu` desenha a lista em coluna (cabe no painel do menu de conta);
 * `account` desenha os três lado a lado, com a explicação à mostra, no `/conta`;
 * `public` desenha a linha discreta do rodapé das páginas públicas da plataforma.
 */
export type ThemeChoiceVariant = 'menu' | 'account' | 'public';

/**
 * O `id` do rótulo visível que nomeia o grupo da variante pública.
 *
 * É um literal, e não um `useId`: `useId` é hook de componente de CLIENTE, e este
 * é um componente de SERVIDOR (o tema é lido do cookie na requisição). Duas
 * instâncias na mesma página repetiriam o `id` — e não existem duas: o controle do
 * rodapé é um por página.
 */
const ROTULO_DO_GRUPO = 'ef-aparencia';

/** O conteúdo de cada botão, por variante. */
function conteudoDaOpcao(modo: ThemeMode, variant: ThemeChoiceVariant): ReactNode {
  /**
   * Na variante pública o botão é só o RÓTULO: no rodapé o controle é uma linha
   * discreta ao lado de "Aparência:", e três botões com desenho pesariam mais do
   * que a própria escolha. A frase que explica a opção continua existindo, em
   * `sr-only` — "Sistema" sozinho não diz a ninguém que ele segue o sistema
   * operacional.
   */
  if (variant === 'public') {
    return (
      <>
        {THEME_MODE_LABELS[modo]}
        <span className="sr-only"> — {THEME_MODE_DESCRIPTIONS[modo]}</span>
      </>
    );
  }

  return (
    <>
      <span className="flex items-center gap-2 font-medium">
        {ICONES[modo]}
        {THEME_MODE_LABELS[modo]}
      </span>

      {variant === 'account' ? (
        <span className="text-xs">{THEME_MODE_DESCRIPTIONS[modo]}</span>
      ) : (
        <span className="sr-only"> — {THEME_MODE_DESCRIPTIONS[modo]}</span>
      )}
    </>
  );
}

export async function ThemeChoice({
  variant = 'menu',
  className,
}: {
  variant?: ThemeChoiceVariant;
  className?: string;
}) {
  const atual = await readThemeMode();

  const opcoes = THEME_MODES.map((modo) => {
    const selecionado = modo === atual;

    return (
      <button
        key={modo}
        type="submit"
        name="tema"
        value={modo}
        /**
         * `aria-pressed` é o que anuncia a opção ATUAL. Sem ele, os três
         * botões seriam idênticos para quem não vê a cor do preenchimento —
         * e "qual está valendo?" é a única pergunta que este controle
         * responde.
         */
        aria-pressed={selecionado}
        title={THEME_MODE_DESCRIPTIONS[modo]}
        data-testid={`theme-option-${modo}`}
        className={cn(
          buttonClasses({ variant: selecionado ? 'primary' : 'outline', size: 'sm' }),
          variant === 'menu' && 'w-full justify-start',
          variant === 'account' &&
            'h-auto min-w-52 flex-1 flex-col items-start justify-start gap-0.5 px-4 py-3 text-left whitespace-normal',
        )}
      >
        {conteudoDaOpcao(modo, variant)}
      </button>
    );
  });

  /**
   * O rodapé: uma linha, com o rótulo VISÍVEL ao lado dos três estados.
   *
   * O `className` de quem chama vai no `<form>` justamente para a página poder
   * decidir o alinhamento (o rodapé de `/` é centrado; o de `/organizacoes` é
   * alinhado à esquerda, como o resto da página) sem que este componente precise
   * conhecer a página em que está.
   */
  if (variant === 'public') {
    return (
      <form
        action={setThemeModeAction}
        data-testid="theme-choice"
        className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}
      >
        {/**
         * ─────────────────────────────────────────────────────────────────────────
         *  POR QUE ESTE RÓTULO USA `text-muted-foreground` E NÃO PODE SER ESMAECIDO
         * ─────────────────────────────────────────────────────────────────────────
         *  Ele nasceu `text-muted` e o portão de acessibilidade reprovou com UMA
         *  violação (`color-contrast`, séria) — a única da página pública, e dela:
         *  `text-muted` NÃO é um tom de texto, é o token da superfície de
         *  agrupamento (`--muted` → `--ef-surface-low`). Pintar texto com ele deixa
         *  o rótulo quase da cor do fundo: **1,05:1** no modo claro (`#f1f3ff` sobre
         *  `#f9f9ff`) e **1,08:1** no escuro (`#1d1f26` sobre `#17181e`), contra os
         *  4,5:1 que o WCAG AA pede para texto pequeno. O defeito era invisível em
         *  revisão porque a escolha das TRÊS PALAVRAS parecia certa — "muted" soa
         *  como "texto discreto" —, e só a medição separou o papel de FUNDO do papel
         *  de TEXTO.
         *
         *  `text-muted-foreground` (`--ef-on-surface-variant`) é o token de texto
         *  secundário, e é o mesmo que as outras duas variantes já usam no
         *  `<legend>`: **8,93:1** sobre a superfície do rodapé no claro e **10,43:1**
         *  no escuro. Os dois números estão presos em
         *  `tests/unit/f61-contraste-dos-dois-modos.test.ts`, no par "rótulo do grupo
         *  de aparência sobre o rodapé público".
         *
         *  E por que ele não pode descer mais um degrau de discrição: este `<span>`
         *  é o `aria-labelledby` do `role="group"` — é o NOME ACESSÍVEL do
         *  conjunto, e é a única coisa que diz a quem usa leitor de tela do que
         *  tratam os três botões. Quem enxerga pouco tem de poder lê-lo na tela
         *  pelo mesmo motivo que o leitor de tela o anuncia: um rótulo que nomeia um
         *  grupo não é enfeite de rodapé, é a pergunta que os botões respondem. O
         *  desenho discreto continua no tamanho (`text-xs`) e no peso
         *  (`font-medium`), que não custam contraste.
         */}
        <span id={ROTULO_DO_GRUPO} className="text-xs font-medium text-muted-foreground">
          Aparência:
        </span>

        <div
          role="group"
          aria-labelledby={ROTULO_DO_GRUPO}
          className="flex flex-wrap items-center gap-1.5"
        >
          {opcoes}
        </div>
      </form>
    );
  }

  return (
    <form action={setThemeModeAction} data-testid="theme-choice" className={className}>
      <fieldset className="min-w-0">
        <legend
          className={cn(
            'text-xs font-medium text-muted-foreground',
            variant === 'menu' && 'px-3 pt-2 pb-1',
          )}
        >
          Tema da interface
        </legend>

        <div className={cn(variant === 'menu' ? 'space-y-1 p-2 pt-0' : 'flex flex-wrap gap-2')}>
          {opcoes}
        </div>
      </fieldset>
    </form>
  );
}
