import type {
  AdminPayoutRow,
  BillingInfo,
  BillingInterval,
  CheckoutResponse,
  Earnings,
  Entitlement,
  Offer,
  OfferInput,
  PaidTier,
  Payout,
  PayoutAccount,
  ApiErrorBody,
  Course,
  CourseSection,
  Lesson,
  Upload,
  UploadPurpose,
  UploadTicket,
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
  sendMessage = (
    channelId: string,
    input: { content: string; replyToId?: string | null; nonce?: string; attachmentIds?: string[] },
  ) =>
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

  // Billing (teacher plans)
  getBilling = () => this.request<BillingInfo>("GET", "/billing");
  teacherCheckout = (tier: PaidTier, interval: BillingInterval) =>
    this.request<CheckoutResponse>("POST", "/billing/checkout", { tier, interval });

  // Offers and paid access
  listOffers = (serverId: string) => this.request<Offer[]>("GET", `/servers/${serverId}/offers`);
  createOffer = (serverId: string, input: OfferInput) => this.request<Offer>("POST", `/servers/${serverId}/offers`, input);
  updateOffer = (offerId: string, input: Partial<OfferInput> & { active?: boolean }) =>
    this.request<Offer>("PATCH", `/offers/${offerId}`, input);
  deleteOffer = (offerId: string) => this.request<void>("DELETE", `/offers/${offerId}`);
  offerCheckout = (offerId: string) => this.request<CheckoutResponse>("POST", `/offers/${offerId}/checkout`);
  setChannelAccess = (channelId: string, access: "free" | "paid") =>
    this.request<Channel>("PUT", `/channels/${channelId}/access`, { access });
  setLessonPreview = (lessonId: string, freePreview: boolean) =>
    this.request<Lesson>("PUT", `/lessons/${lessonId}/preview`, { freePreview });
  listEntitlements = (serverId: string) => this.request<Entitlement[]>("GET", `/servers/${serverId}/entitlements`);
  grantEntitlement = (serverId: string, userId: string, offerId: string) =>
    this.request<Entitlement>("POST", `/servers/${serverId}/entitlements`, { userId, offerId });
  revokeEntitlement = (id: string) => this.request<void>("DELETE", `/entitlements/${id}`);

  // Earnings and payouts
  getEarnings = () => this.request<Earnings>("GET", "/earnings");
  setPayoutAccount = (whopUsername: string) => this.request<PayoutAccount>("PUT", "/earnings/payout-account", { whopUsername });
  adminPayouts = () =>
    this.request<{ rows: AdminPayoutRow[]; history: Payout[]; minPayoutMinor: number; holdDays: number }>("GET", "/admin/payouts");
  markPaid = (input: { teacherId: string; currency: string; amountMinor: number; whopReference: string; note?: string }) =>
    this.request<Payout>("POST", "/admin/payouts", input);
  /** CSV as text (needs the auth header, so it can't be a plain link). */
  async adminPayoutsCsv(): Promise<string> {
    const token = this.opts.getToken();
    const res = await fetch(`${this.baseUrl}/admin/payouts.csv`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, "csv_failed");
    return res.text();
  }

  // Uploads
  createUpload = (serverId: string, input: { filename: string; contentType: string; size: number; purpose: UploadPurpose }) =>
    this.request<UploadTicket>("POST", `/servers/${serverId}/uploads`, input);
  completeUpload = (id: string) => this.request<Upload>("POST", `/uploads/${id}/complete`);
  cancelUpload = (id: string) => this.request<void>("DELETE", `/uploads/${id}`);

  /**
   * Uploads a file straight to storage (R2) with progress, then confirms it.
   * `body` is a Blob/File on web; on React Native pass `{ uri }` (see putFile).
   */
  async uploadFile(
    serverId: string,
    file: { name: string; type: string; size: number; body: Blob | { uri: string } },
    purpose: UploadPurpose,
    opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
  ): Promise<Upload> {
    const ticket = await this.createUpload(serverId, {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      purpose,
    });
    try {
      await putFile(ticket.put.url, ticket.put.headers, file.body, opts);
      return await this.completeUpload(ticket.upload.id);
    } catch (err) {
      void this.cancelUpload(ticket.upload.id).catch(() => undefined);
      throw err;
    }
  }

  // Courses (a course is a channel with type "course")
  createCourse = (serverId: string, input: { name: string; description?: string }) =>
    this.request<Channel>("POST", `/servers/${serverId}/channels`, { ...input, type: "course" });
  getCourse = (id: string) => this.request<Course>("GET", `/courses/${id}`);
  updateCourse = (id: string, input: { name?: string; description?: string; coverUploadId?: string | null }) =>
    this.request<Course>("PATCH", `/courses/${id}`, input);
  createSection = (courseId: string, title: string) => this.request<CourseSection>("POST", `/courses/${courseId}/sections`, { title });
  renameSection = (id: string, title: string) => this.request<void>("PATCH", `/sections/${id}`, { title });
  deleteSection = (id: string) => this.request<void>("DELETE", `/sections/${id}`);
  createLesson = (courseId: string, input: LessonInput & { sectionId: string; title: string }) =>
    this.request<Lesson>("POST", `/courses/${courseId}/lessons`, input);
  getLesson = (id: string) => this.request<Lesson>("GET", `/lessons/${id}`);
  updateLesson = (id: string, input: LessonInput) => this.request<Lesson>("PATCH", `/lessons/${id}`, input);
  deleteLesson = (id: string) => this.request<void>("DELETE", `/lessons/${id}`);
  reorderCourse = (courseId: string, sections: { id: string; lessonIds: string[] }[]) =>
    this.request<Course>("PUT", `/courses/${courseId}/order`, { sections });
  saveProgress = (lessonId: string, input: { completed?: boolean; positionSeconds?: number; durationSeconds?: number }) =>
    this.request<void>("PUT", `/lessons/${lessonId}/progress`, input);
}

export interface LessonInput {
  sectionId?: string;
  title?: string;
  body?: string;
  videoUploadId?: string | null;
  videoUrl?: string | null;
  durationSeconds?: number | null;
  attachmentIds?: string[];
}

/**
 * PUTs bytes with upload progress. XMLHttpRequest exists in browsers and in
 * React Native, where a `{ uri }` body is read from disk as a Blob first.
 */
export function putFile(
  url: string,
  headers: Record<string, string>,
  body: Blob | { uri: string },
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  // React Native: turn a local file URI into a native-backed Blob (not copied into JS memory).
  if (!(typeof Blob !== "undefined" && body instanceof Blob) && "uri" in body) {
    return fetch(body.uri)
      .then((r) => r.blob())
      .then((blob) => putFile(url, headers, blob, opts));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, "upload_failed")));
    xhr.onerror = () => reject(new ApiError(0, "upload_failed"));
    xhr.onabort = () => reject(new ApiError(0, "upload_cancelled"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body as Blob);
  });
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
