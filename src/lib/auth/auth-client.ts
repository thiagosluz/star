'use client';

/**
 * Cliente do Better Auth para componentes de cliente.
 * Mantido deliberadamente mínimo: só o que o browser precisa saber.
 */
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
});

export const { signIn, signUp, signOut, useSession } = authClient;
