import type {
  ApiErrorBody,
  AuthResponse,
  Channel,
  ClientEvent,
  Invite,
  LoginInput,
  Me,
  Member,
  Message,
  RegisterInput,
  Server,
  ServerDetail,
  ServerEvent,
} from "@majlis/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => string | null | undefined;
  onUnauthorized?: () => void;
}

/** Typed REST client shared by the web and mobile apps. Works anywhere `fetch` exists. */
export class ApiClient {
  constructor(private opts: ApiClientOptions) {}

  get baseUrl() {
    return this.opts.baseUrl.replace(/\/$/, "");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = this.opts.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) {
      const err = data as ApiErrorBody;
      if (res.status === 401) this.opts.onUnauthorized?.();
      throw new ApiError(res.status, err.error ?? "unknown_error", err.message, err.details);
    }
    return data as T;
  }

  // Auth
  register = (input: RegisterInput) => this.request<AuthResponse>("POST", "/auth/register", input);
  login = (input: LoginInput) => this.request<AuthResponse>("POST", "/auth/login", input);
  me = () => this.request<Me>("GET", "/me");
  updateMe = (input: Partial<Pick<Me, "displayName" | "locale" | "avatarUrl">>) =>
    this.request<Me>("PATCH", "/me", input);
  deleteMe = () => this.request<void>("DELETE", "/me");

  // Servers
  listServers = () => this.request<Server[]>("GET", "/servers");
  createServer = (name: string) => this.request<ServerDetail>("POST", "/servers", { name });
  getServer = (id: string) => this.request<ServerDetail>("GET", `/servers/${id}`);
  updateServer = (id: string, name: string) => this.request<Server>("PATCH", `/servers/${id}`, { name });
  deleteServer = (id: string) => this.request<void>("DELETE", `/servers/${id}`);
  leaveServer = (id: string) => this.request<void>("DELETE", `/servers/${id}/members/@me`);

  // Channels
  createChannel = (serverId: string, input: { name: string; type?: "text" | "category"; parentId?: string | null; topic?: string }) =>
    this.request<Channel>("POST", `/servers/${serverId}/channels`, input);
  deleteChannel = (channelId: string) => this.request<void>("DELETE", `/channels/${channelId}`);

  // Members & moderation
  kick = (serverId: string, userId: string) => this.request<void>("DELETE", `/servers/${serverId}/members/${userId}`);
  ban = (serverId: string, userId: string) => this.request<void>("PUT", `/servers/${serverId}/bans/${userId}`);
  setRole = (serverId: string, userId: string, role: "admin" | "member") =>
    this.request<Member>("PATCH", `/servers/${serverId}/members/${userId}`, { role });

  // Invites
  createInvite = (serverId: string, opts: { maxUses?: number | null; expiresInHours?: number | null } = {}) =>
    this.request<Invite>("POST", `/servers/${serverId}/invites`, opts);
  getInvite = (code: string) => this.request<Invite>("GET", `/invites/${encodeURIComponent(code)}`);
  acceptInvite = (code: string) => this.request<ServerDetail>("POST", `/invites/${encodeURIComponent(code)}`);

  // Messages
  listMessages = (channelId: string, opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.request<Message[]>("GET", `/channels/${channelId}/messages${qs ? `?${qs}` : ""}`);
  };
  sendMessage = (channelId: string, input: { content: string; replyToId?: string | null; nonce?: string }) =>
    this.request<Message>("POST", `/channels/${channelId}/messages`, input);
  editMessage = (messageId: string, content: string) =>
    this.request<Message>("PATCH", `/messages/${messageId}`, { content });
  deleteMessage = (messageId: string) => this.request<void>("DELETE", `/messages/${messageId}`);
  addReaction = (messageId: string, emoji: string) =>
    this.request<void>("PUT", `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  removeReaction = (messageId: string, emoji: string) =>
    this.request<void>("DELETE", `/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
  reportMessage = (messageId: string, reason: string) =>
    this.request<void>("POST", `/messages/${messageId}/report`, { reason });
  search = (serverId: string, q: string) =>
    this.request<Message[]>("GET", `/servers/${serverId}/search?q=${encodeURIComponent(q)}`);
}

type Listener = (event: ServerEvent) => void;
type StatusListener = (status: "connecting" | "open" | "closed") => void;

/**
 * Auto-reconnecting gateway client. Uses the global WebSocket available in
 * browsers and React Native.
 */
export class Gateway {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closedByUser = false;

  constructor(
    private baseUrl: string,
    private getToken: () => string | null | undefined,
  ) {}

  connect() {
    const token = this.getToken();
    if (!token) return;
    this.closedByUser = false;
    const url = `${this.baseUrl.replace(/^http/, "ws").replace(/\/$/, "")}/gateway?token=${encodeURIComponent(token)}`;
    this.emitStatus("connecting");
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.emitStatus("open");
      this.heartbeat = setInterval(() => this.send({ t: "PING" }), 25_000);
    };
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(String(e.data)) as ServerEvent;
        for (const l of this.listeners) l(event);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      this.cleanup();
      this.emitStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  disconnect() {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.cleanup();
  }

  send(event: ClientEvent) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(event));
  }

  sendTyping(channelId: string) {
    this.send({ t: "TYPING", d: { channelId } });
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitStatus(s: "connecting" | "open" | "closed") {
    for (const l of this.statusListeners) l(s);
  }

  private cleanup() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws = null;
  }

  private scheduleReconnect() {
    const delay = Math.min(30_000, 1000 * 2 ** this.attempts) + Math.random() * 500;
    this.attempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

/** Accepts "abc123", "majlis.app/invite/abc123", or a full URL and returns the code. */
export function parseInviteCode(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/invite\/([A-Za-z0-9_-]+)/);
  return m ? m[1]! : trimmed;
}
