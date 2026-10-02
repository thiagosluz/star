'use server';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CASOS DE USO — Estado da barra lateral (FASE 59)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA AÇÃO NÃO DEVOLVE NADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela não decide, não valida permissão e não responde a ninguém: o valor do
 *  cookie é o ESTADO ATUAL, lido no servidor, e a ação apenas grava o inverso.
 *  Receber o destino pelo formulário (`value=full|rail`) daria ao cliente o poder
 *  de escolher o estado — e um formulário reenviado (voltar, F5, dois cliques)
 *  deixaria de ser idempotente. Invertendo a partir do que está gravado, repetir
 *  a ação sempre significa a mesma coisa: trocar de lado.
 *
 *  O contrato `() => Promise<void>` é o que permite passa-la ao `action` de um
 *  `<form>` sem `useActionState`: é o mesmo desenho do `signOutAction`, e é o que
 *  mantém o botão funcionando sem JavaScript.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

import {
  NAV_MODE_COOKIE,
  NAV_MODE_MAX_AGE_SECONDS,
  navModeFromValue,
  navModeToggle,
} from '@/lib/shell/nav-mode';

export async function toggleNavModeAction(): Promise<void> {
  const cookieStore = await cookies();
  const proximo = navModeToggle(
    navModeFromValue(cookieStore.get(NAV_MODE_COOKIE)?.value),
  );

  cookieStore.set(NAV_MODE_COOKIE, proximo, {
    /**
     * A preferência não é segredo — mas também não serve a ninguém fora do
     * servidor, e manter o cookie fora do alcance do JavaScript impede que um
     * script de terceiro na página reescreva o layout de quem está navegando.
     */
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: NAV_MODE_MAX_AGE_SECONDS,
  });

  /**
   * O shell é um LAYOUT: sem invalidar a raiz, a próxima navegação reusaria a
   * árvore já renderizada e o clique pareceria não ter feito nada até um
   * recarregamento completo. É a mesma linha que a troca de contexto usa.
   */
  revalidatePath('/', 'layout');
}
