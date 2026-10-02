'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Tema da interface (FASE 61 · dívida H3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ESCOLHA É DA PESSOA NAQUELE NAVEGADOR — NÃO É DADO DE PERFIL
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa descartada foi uma coluna no banco (`user.theme`). Ela é pior em
 *  três frentes, e as três são do dia a dia: (a) o tema é do DISPOSITIVO — a mesma
 *  pessoa quer escuro no celular à noite e claro no monitor da secretaria de dia,
 *  e um valor por conta obrigaria a trocar toda vez que ela trocasse de aparelho;
 *  (b) o `<html>` precisa da resposta na PRIMEIRA resposta HTTP, e uma consulta ao
 *  banco no layout raiz seria uma ida ao Postgres por requisição (inclusive nas
 *  páginas públicas) para decidir uma preferência cosmética; (c) preferência de
 *  aparência não é fato auditável — gravá-la criaria dado pessoal novo sem que
 *  ninguém tivesse pedido.
 *
 *  O cookie é, portanto, o lugar certo: ele acompanha o NAVEGADOR, chega antes de
 *  qualquer renderização e não exige migração.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AQUI O VALOR VEM DO FORMULÁRIO (e na F59, não vinha)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O botão da barra lateral INVERTE o estado atual porque são dois valores e o
 *  inverso é sempre o outro. Com TRÊS não existe inverso: a ação precisa saber
 *  qual dos três a pessoa apontou, e o `name`/`value` do botão é o único veículo
 *  que continua funcionando sem JavaScript. O valor que chega é VALIDADO pela
 *  mesma regra que lê o cookie: qualquer coisa fora dos três vira `sistema`, então
 *  um formulário forjado não consegue gravar um estado que a interface não sabe
 *  desenhar.
 *
 *  A ação é idempotente por natureza: gravar duas vezes "escuro" deixa o mundo
 *  exatamente como estava (nada de inversão que surpreende no F5).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_SECONDS,
  themeModeFromValue,
} from '@/lib/theme/theme-mode';

/**
 * Grava a escolha de tema do navegador.
 *
 * O contrato `(formData: FormData) => Promise<void>` é o que permite passá-la ao
 * `action` de um `<form>` sem `useActionState`: é o mesmo desenho do
 * `toggleNavModeAction`, e é o que mantém o controle funcionando antes de
 * qualquer JavaScript carregar.
 */
export async function setThemeModeAction(formData: FormData): Promise<void> {
  const escolhido = themeModeFromValue(formData.get('tema'));

  const cookieStore = await cookies();

  cookieStore.set(THEME_COOKIE, escolhido, {
    /**
     * A preferência não é segredo — mas também não serve a ninguém fora do
     * servidor, e mantê-la fora do alcance do JavaScript impede que um script de
     * terceiro na página reescreva o tema de quem está navegando.
     */
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
  });

  /**
   * O `<html>` nasce no LAYOUT RAIZ: sem invalidar a raiz, a próxima navegação
   * reusaria a árvore já renderizada e o clique pareceria não ter feito nada até
   * um recarregamento completo. É a mesma linha que a troca de contexto e a
   * inversão da barra lateral usam.
   */
  revalidatePath('/', 'layout');
}
