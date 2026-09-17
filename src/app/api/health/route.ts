import { NextResponse } from 'next/server';

/**
 * Healthcheck usado pelo `healthcheck` do container `web` no docker-compose.
 * Verifica apenas se o processo está de pé e respondendo — as dependências
 * (banco, Redis, storage) têm seus próprios healthchecks.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'eventflow-web',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  });
}
