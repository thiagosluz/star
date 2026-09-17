/**
 * Route handler do Better Auth.
 * Todas as rotas `/api/auth/*` (login, cadastro, sessão, logout) são atendidas aqui.
 */
import { auth } from '@/lib/auth/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(auth);
