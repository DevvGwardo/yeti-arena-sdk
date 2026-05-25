import fetch from 'node-fetch';
import type { Decision, SnapshotResponse } from './types';

const PKG_NAME = 'yetifi-arena-runtime';
const PKG_VERSION = '0.1.3';
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

async function jsonOrThrow<T>(res: Awaited<ReturnType<typeof fetch>>): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
  if (!res.ok) {
    const msg = (body as { message?: string; error?: string } | null)?.message
      || (body as { error?: string } | null)?.error
      || `HTTP ${res.status}`;
    throw new ArenaError(res.status, body, msg);
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
  return jsonOrThrow<JoinResponse>(res);
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
  return jsonOrThrow<AuthResponse>(res);
}

export async function refresh(baseUrl: string, bearer: string): Promise<AuthResponse> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/refresh`, {
    method: 'POST',
    headers: sdkHeaders({ authorization: `Bearer ${bearer}` }),
  });
  return jsonOrThrow<AuthResponse>(res);
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
  return jsonOrThrow<SnapshotResponse>(res);
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
  return jsonOrThrow<SubmitResponse>(res);
}

export async function manifest(baseUrl: string): Promise<unknown> {
  const res = await fetch(`${stripSlash(baseUrl)}/api/arena/manifest`, {
    headers: sdkHeaders(),
  });
  return jsonOrThrow<unknown>(res);
}
