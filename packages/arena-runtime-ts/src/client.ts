import fetch from 'node-fetch';
import type { Decision, SnapshotResponse } from './types';

const PKG_NAME = 'yetifi-arena-runtime';
const PKG_VERSION = '0.1.5';
export const SDK_HEADER = 'x-yeti-sdk';
export const SDK_HEADER_VALUE = `${PKG_NAME}@${PKG_VERSION}`;

export interface JoinResponse {
  agentId: string;
  apiKey: string;
  tier: string;
  portfolioInitialValue: number;
  createdAt: string;
  preferredIntervalSec: number;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
}

export interface SubmitResponse {
  accepted: boolean;
  agentId: string;
  targetCycle: number;
  replaced?: boolean;
  message?: string;
}

export class ArenaError extends Error {
  constructor(public status: number, public payload: unknown, message: string) {
    super(message);
    this.name = 'ArenaError';
  }
}

const stripSlash = (u: string) => u.replace(/\/$/, '');

const sdkHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({
  'content-type': 'application/json',
  [SDK_HEADER]: SDK_HEADER_VALUE,
  ...extra,
});

const AGENT_HINT =
  'hint: this agent may have been removed (a new season started or it was deleted); if so, re-scaffold with a new name.';

/** `HTTP 404 GET /path: server message` plus a hint for agent-endpoint 401/404. */
export function formatHttpError(status: number, method: string, path: string, body: unknown): string {
  let msg: string | undefined;
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown };
    for (const v of [b.message, b.error]) {
      if (typeof v === 'string' && v.trim()) { msg = v.trim().slice(0, 200); break; }
    }
  }
  let out = `HTTP ${status} ${method} ${path}`;
  if (msg) out += `: ${msg}`;
  if ((status === 401 || status === 404) && path.startsWith('/api/arena/agent/')) out += ` (${AGENT_HINT})`;
  return out;
}

async function jsonOrThrow<T>(
  res: Awaited<ReturnType<typeof fetch>>,
  method: string,
): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
  if (!res.ok) {
    let path = '?';
    try { path = new URL(res.url).pathname; } catch { /* keep ? */ }
    throw new ArenaError(res.status, body, formatHttpError(res.status, method, path, body));
  }
  return body as T;
}

export async function join(
  baseUrl: string,
  body: { name: string; preferredIntervalSec?: number; systemPrompt?: string },
): Promise<JoinResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/join`, {
    method: 'POST',
    headers: sdkHeaders(),
    body: JSON.stringify(body),
  });
  return jsonOrThrow<JoinResponse>(res, 'POST');
}

export async function auth(
  baseUrl: string,
  body: { agentId: string; apiKey: string },
): Promise<AuthResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/auth`, {
    method: 'POST',
    headers: sdkHeaders(),
    body: JSON.stringify(body),
  });
  return jsonOrThrow<AuthResponse>(res, 'POST');
}

export async function refresh(baseUrl: string, bearer: string): Promise<AuthResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/refresh`, {
    method: 'POST',
    headers: sdkHeaders({ authorization: `Bearer ${bearer}` }),
  });
  return jsonOrThrow<AuthResponse>(res, 'POST');
}

export async function snapshot(
  baseUrl: string,
  agentId: string,
  bearer: string,
  include?: Array<'history' | 'analysis'>,
): Promise<SnapshotResponse> {
  const url = new URL(`${stripSlash(baseUrl)}/api/arena/agent/${agentId}/snapshot`);
  if (include && include.length) url.searchParams.set('include', include.join(','));
  const res = await fetch(url.toString(), {
    headers: sdkHeaders({ authorization: `Bearer ${bearer}` }),
  });
  return jsonOrThrow<SnapshotResponse>(res, 'GET');
}

export async function submit(
  baseUrl: string,
  agentId: string,
  bearer: string,
  body: { decisions: Decision[]; model?: string },
): Promise<SubmitResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/agent/${agentId}/decision`, {
    method: 'POST',
    headers: sdkHeaders({ authorization: `Bearer ${bearer}` }),
    body: JSON.stringify(body),
  });
  return jsonOrThrow<SubmitResponse>(res, 'POST');
}

export async function manifest(baseUrl: string): Promise<unknown> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/manifest`, {
    headers: sdkHeaders(),
  });
  return jsonOrThrow<unknown>(res, 'GET');
}
