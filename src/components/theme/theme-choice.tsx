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
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** O ícone de cada opção. Decorativo: o nome vem do texto, nunca do desenho. */
const ICONES: Readonly<Record<ThemeMode, ReactNode>> = {
  claro: <Sun className="size-4" aria-hidden />,
  escuro: <Moon className="size-4" aria-hidden />,
  sistema: <Monitor className="size-4" aria-hidden />,
};

export async function ThemeChoice({
  /**
   * `menu` desenha a lista em coluna (cabe no painel do menu de conta);
   * `account` desenha os três lado a lado, com a explicação à mostra, no `/conta`.
   */
  variant = 'menu',
  className,
}: {
  variant?: 'menu' | 'account';
  className?: string;
}) {
  const atual = await readThemeMode();

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
          {THEME_MODES.map((modo) => {
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
                  variant === 'menu'
                    ? 'w-full justify-start'
                    : 'h-auto min-w-52 flex-1 flex-col items-start justify-start gap-0.5 px-4 py-3 text-left whitespace-normal',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {ICONES[modo]}
                  {THEME_MODE_LABELS[modo]}
                </span>

                {variant === 'account' ? (
                  <span className="text-xs">{THEME_MODE_DESCRIPTIONS[modo]}</span>
                ) : (
                  <span className="sr-only"> — {THEME_MODE_DESCRIPTIONS[modo]}</span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>
    </form>
  );
}
