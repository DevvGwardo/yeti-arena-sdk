import { auth as doAuth, refresh as doRefresh, ArenaError } from './client';

const REFRESH_LEAD_MS = 60_000;

export class TokenManager {
  private token: string | undefined;
  private expiresAtMs: number | undefined;
  private refreshing: Promise<string> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly agentId: string,
    private readonly apiKey: string,
    initialToken?: string,
    initialExpiresAt?: string,
  ) {
    if (initialToken && initialExpiresAt) {
      this.token = initialToken;
      this.expiresAtMs = Date.parse(initialExpiresAt);
    }
  }

  async get(): Promise<string> {
    const now = Date.now();
    if (this.token && this.expiresAtMs && this.expiresAtMs - now > REFRESH_LEAD_MS) {
      return this.token;
    }
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.acquire();
    try {
      return await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async acquire(): Promise<string> {
    if (this.token) {
      try {
        const r = await doRefresh(this.baseUrl, this.token);
        this.token = r.token;
        this.expiresAtMs = Date.parse(r.expiresAt);
        return r.token;
      } catch (err) {
        if (!(err instanceof ArenaError) || err.status !== 401) throw err;
      }
    }
    const fresh = await doAuth(this.baseUrl, { agentId: this.agentId, apiKey: this.apiKey });
    this.token = fresh.token;
    this.expiresAtMs = Date.parse(fresh.expiresAt);
    return fresh.token;
  }
}
