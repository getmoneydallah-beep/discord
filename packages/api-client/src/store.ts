import { createStore } from "zustand/vanilla";
import type { Channel, Course, Locale, Me, Member, Message, Role, Server, ServerEvent } from "@majlis/shared";
import { newId } from "@majlis/shared";
import { ApiClient, Gateway } from "./index";

/** Async key/value storage: localStorage on web, SecureStore on mobile. */
export interface TokenStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface ServerState {
  channels: Channel[];
  members: Member[];
  myRole: Role;
}

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
}

export interface PendingMessage extends Message {
  pending?: boolean;
  failed?: boolean;
}

export interface Preferences {
  locale: Locale;
  easternDigits: boolean;
}

export interface AppState {
  status: "booting" | "signedOut" | "ready";
  token: string | null;
  me: Me | null;
  connection: "connecting" | "open" | "closed";
  servers: Server[];
  serverState: Record<string, ServerState>;
  messages: Record<string, ChannelMessages>;
  online: Record<string, true>;
  /** channelId → userId → { name, until } */
  typing: Record<string, Record<string, { name: string; until: number }>>;
  /** Loaded courses by id (course id = channel id). */
  courses: Record<string, Course>;
  prefs: Preferences;
}

const TOKEN_KEY = "majlis.token";
const PREFS_KEY = "majlis.prefs";
const PAGE = 50;

export function createAppStore(opts: { baseUrl: string; storage: TokenStorage; defaultLocale?: Locale }) {
  const { storage } = opts;
  let tokenRef: string | null = null;

  const api = new ApiClient({
    baseUrl: opts.baseUrl,
    getToken: () => tokenRef,
    onUnauthorized: () => void actions.signOut(),
  });
  const gateway = new Gateway(opts.baseUrl, () => tokenRef);

  const store = createStore<AppState>(() => ({
    status: "booting",
    token: null,
    me: null,
    connection: "closed",
    servers: [],
    serverState: {},
    messages: {},
    online: {},
    typing: {},
    courses: {},
    prefs: { locale: opts.defaultLocale ?? "ar", easternDigits: false },
  }));
  const set = store.setState;
  const get = store.getState;

  /* ------------------------------ helpers ------------------------------ */

  const patchChannelMessages = (channelId: string, fn: (items: PendingMessage[]) => PendingMessage[]) => {
    const cur = get().messages[channelId];
    if (!cur) return;
    set({ messages: { ...get().messages, [channelId]: { ...cur, items: fn(cur.items) } } });
  };
  const patchMessage = (channelId: string, id: string, fn: (m: PendingMessage) => PendingMessage) =>
    patchChannelMessages(channelId, (items) => items.map((m) => (m.id === id ? fn(m) : m)));

  const patchServerState = (serverId: string, fn: (s: ServerState) => ServerState) => {
    const cur = get().serverState[serverId];
    if (cur) set({ serverState: { ...get().serverState, [serverId]: fn(cur) } });
  };

  const dropServer = (serverId: string) => {
    const s = get();
    const channelIds = new Set(s.serverState[serverId]?.channels.map((c) => c.id));
    const { [serverId]: _, ...serverState } = s.serverState;
    set({
      servers: s.servers.filter((x) => x.id !== serverId),
      serverState,
      messages: Object.fromEntries(Object.entries(s.messages).filter(([cid]) => !channelIds.has(cid))),
    });
  };

  /* --------------------------- gateway events --------------------------- */

  function handleEvent(e: ServerEvent) {
    const s = get();
    switch (e.t) {
      case "READY":
        set({ online: Object.fromEntries(e.d.online.map((id) => [id, true as const])) });
        // Refresh data that may have changed while disconnected.
        void actions.refresh();
        break;
      case "MESSAGE_CREATE": {
        const ch = s.messages[e.d.channelId];
        if (!ch) break; // not loaded yet; will be fetched on open
        const exists = ch.items.some((m) => m.id === e.d.id || (e.d.nonce && m.nonce === e.d.nonce));
        if (exists) {
          patchChannelMessages(e.d.channelId, (items) =>
            items.map((m) => (m.nonce && m.nonce === e.d.nonce ? { ...e.d } : m)),
          );
        } else {
          patchChannelMessages(e.d.channelId, (items) => [...items, e.d]);
        }
        // Author stopped typing.
        clearTyping(e.d.channelId, e.d.author.id);
        break;
      }
      case "MESSAGE_UPDATE":
        patchMessage(e.d.channelId, e.d.id, (m) => ({ ...m, content: e.d.content, editedAt: e.d.editedAt }));
        break;
      case "MESSAGE_DELETE":
        patchChannelMessages(e.d.channelId, (items) => items.filter((m) => m.id !== e.d.id));
        break;
      case "REACTION_ADD":
      case "REACTION_REMOVE": {
        const isMe = e.d.userId === s.me?.id;
        const delta = e.t === "REACTION_ADD" ? 1 : -1;
        patchMessage(e.d.channelId, e.d.messageId, (m) => {
          // Our own optimistic update already applied the change.
          const existing = m.reactions.find((r) => r.emoji === e.d.emoji);
          if (isMe && existing && existing.me === (delta === 1)) return m;
          let reactions = existing
            ? m.reactions.map((r) =>
                r.emoji === e.d.emoji ? { ...r, count: r.count + delta, me: isMe ? delta === 1 : r.me } : r,
              )
            : delta === 1
              ? [...m.reactions, { emoji: e.d.emoji, count: 1, me: isMe }]
              : m.reactions;
          reactions = reactions.filter((r) => r.count > 0);
          return { ...m, reactions };
        });
        break;
      }
      case "TYPING_START": {
        if (e.d.userId === s.me?.id) break;
        const chan = { ...(s.typing[e.d.channelId] ?? {}) };
        chan[e.d.userId] = { name: e.d.displayName, until: Date.now() + 8000 };
        set({ typing: { ...s.typing, [e.d.channelId]: chan } });
        break;
      }
      case "PRESENCE_UPDATE": {
        const online = { ...s.online };
        if (e.d.status === "online") online[e.d.userId] = true;
        else delete online[e.d.userId];
        set({ online });
        break;
      }
      case "CHANNEL_CREATE":
        patchServerState(e.d.serverId, (st) =>
          st.channels.some((c) => c.id === e.d.id) ? st : { ...st, channels: [...st.channels, e.d] },
        );
        break;
      case "CHANNEL_DELETE":
        patchServerState(e.d.serverId, (st) => ({ ...st, channels: st.channels.filter((c) => c.id !== e.d.id) }));
        break;
      case "CHANNEL_UPDATE":
        patchServerState(e.d.serverId, (st) => ({ ...st, channels: st.channels.map((c) => (c.id === e.d.id ? e.d : c)) }));
        if (s.courses[e.d.id]) void actions.loadCourse(e.d.id);
        break;
      case "COURSE_UPDATE":
        // Refetch only courses we're looking at; others load fresh when opened.
        if (s.courses[e.d.courseId]) void actions.loadCourse(e.d.courseId).catch(() => undefined);
        break;
      case "MEMBER_ADD":
        if (e.d.user.id === s.me?.id) {
          void actions.refresh();
          break;
        }
        patchServerState(e.d.serverId, (st) =>
          st.members.some((m) => m.user.id === e.d.user.id) ? st : { ...st, members: [...st.members, e.d] },
        );
        break;
      case "MEMBER_UPDATE":
        patchServerState(e.d.serverId, (st) => ({
          ...st,
          members: st.members.map((m) => (m.user.id === e.d.user.id ? e.d : m)),
          myRole: e.d.user.id === s.me?.id ? e.d.role : st.myRole,
        }));
        break;
      case "MEMBER_REMOVE":
        if (e.d.userId === s.me?.id) dropServer(e.d.serverId);
        else
          patchServerState(e.d.serverId, (st) => ({
            ...st,
            members: st.members.filter((m) => m.user.id !== e.d.userId),
          }));
        break;
      case "SERVER_CREATE":
        if (!s.servers.some((x) => x.id === e.d.id)) set({ servers: [...s.servers, e.d] });
        break;
      case "SERVER_UPDATE":
        set({ servers: s.servers.map((x) => (x.id === e.d.id ? e.d : x)) });
        break;
      case "SERVER_DELETE":
        dropServer(e.d.id);
        break;
      case "PONG":
        break;
    }
  }

  function clearTyping(channelId: string, userId: string) {
    const chan = get().typing[channelId];
    if (!chan?.[userId]) return;
    const { [userId]: _, ...rest } = chan;
    set({ typing: { ...get().typing, [channelId]: rest } });
  }

  gateway.on(handleEvent);
  gateway.onStatus((connection) => set({ connection }));

  /* ------------------------------ actions ------------------------------ */

  const actions = {
    async boot() {
      const [token, prefsRaw] = await Promise.all([storage.get(TOKEN_KEY), storage.get(PREFS_KEY)]);
      if (prefsRaw) {
        try {
          set({ prefs: { ...get().prefs, ...(JSON.parse(prefsRaw) as Partial<Preferences>) } });
        } catch {
          /* ignore */
        }
      }
      if (!token) return set({ status: "signedOut" });
      tokenRef = token;
      try {
        const me = await api.me();
        set({ token, me, status: "ready" });
        await actions.refresh();
        gateway.connect();
      } catch {
        await actions.signOut();
      }
    },

    async signIn(token: string, me: Me) {
      tokenRef = token;
      await storage.set(TOKEN_KEY, token);
      set({ token, me, status: "ready" });
      await actions.setPrefs({ locale: me.locale });
      await actions.refresh();
      gateway.connect();
    },

    async signOut() {
      gateway.disconnect();
      tokenRef = null;
      await storage.remove(TOKEN_KEY);
      set({ status: "signedOut", token: null, me: null, servers: [], serverState: {}, messages: {}, online: {}, typing: {}, courses: {} });
    },

    async deleteAccount() {
      await api.deleteMe();
      await actions.signOut();
    },

    async setPrefs(p: Partial<Preferences>) {
      const prefs = { ...get().prefs, ...p };
      set({ prefs });
      await storage.set(PREFS_KEY, JSON.stringify(prefs));
      if (p.locale && get().me && get().me!.locale !== p.locale) {
        const me = await api.updateMe({ locale: p.locale }).catch(() => null);
        if (me) set({ me });
      }
    },

    async refresh() {
      const servers = await api.listServers();
      set({ servers });
      // Reload detail for servers we've opened before.
      await Promise.all(Object.keys(get().serverState).map((id) => actions.loadServer(id).catch(() => undefined)));
    },

    async loadServer(serverId: string) {
      const d = await api.getServer(serverId);
      set({
        serverState: { ...get().serverState, [serverId]: { channels: d.channels, members: d.members, myRole: d.myRole } },
        servers: get().servers.some((s) => s.id === serverId)
          ? get().servers.map((s) => (s.id === serverId ? d.server : s))
          : [...get().servers, d.server],
      });
      return d;
    },

    async createServer(name: string) {
      const d = await api.createServer(name);
      set({
        servers: get().servers.some((s) => s.id === d.server.id) ? get().servers : [...get().servers, d.server],
        serverState: { ...get().serverState, [d.server.id]: { channels: d.channels, members: d.members, myRole: d.myRole } },
      });
      return d;
    },

    async joinInvite(code: string) {
      const d = await api.acceptInvite(code);
      set({
        servers: get().servers.some((s) => s.id === d.server.id) ? get().servers : [...get().servers, d.server],
        serverState: { ...get().serverState, [d.server.id]: { channels: d.channels, members: d.members, myRole: d.myRole } },
      });
      return d;
    },

    async leaveServer(serverId: string) {
      await api.leaveServer(serverId);
      dropServer(serverId);
    },

    async deleteServer(serverId: string) {
      await api.deleteServer(serverId);
      dropServer(serverId);
    },

    /** Adds a channel returned by a REST call without waiting for the gateway echo. */
    applyChannel(c: Channel) {
      handleEvent({ t: "CHANNEL_CREATE", d: c });
    },

    async createChannel(serverId: string, name: string) {
      const c = await api.createChannel(serverId, { name });
      handleEvent({ t: "CHANNEL_CREATE", d: c });
      return c;
    },

    async loadMessages(channelId: string, force = false) {
      const cur = get().messages[channelId];
      if (cur && !force) return;
      set({ messages: { ...get().messages, [channelId]: { items: cur?.items ?? [], hasMore: true, loading: true } } });
      const items = await api.listMessages(channelId, { limit: PAGE });
      set({ messages: { ...get().messages, [channelId]: { items, hasMore: items.length === PAGE, loading: false } } });
    },

    async loadOlder(channelId: string) {
      const cur = get().messages[channelId];
      if (!cur || cur.loading || !cur.hasMore) return;
      const oldest = cur.items.find((m) => !(m as PendingMessage).pending);
      set({ messages: { ...get().messages, [channelId]: { ...cur, loading: true } } });
      const older = await api.listMessages(channelId, { before: oldest?.id, limit: PAGE });
      const now = get().messages[channelId]!;
      set({
        messages: {
          ...get().messages,
          [channelId]: { items: [...older, ...now.items], hasMore: older.length === PAGE, loading: false },
        },
      });
    },

    async loadCourse(courseId: string) {
      const course = await api.getCourse(courseId);
      set({ courses: { ...get().courses, [courseId]: course } });
      return course;
    },

    /** Saves progress and updates the cached course so checkmarks/progress bars move instantly. */
    async setLessonCompleted(courseId: string, lessonId: string, completed: boolean) {
      const c = get().courses[courseId];
      if (c) {
        let delta = 0;
        const sections = c.sections.map((s) => ({
          ...s,
          lessons: s.lessons.map((l) => {
            if (l.id !== lessonId || l.completed === completed) return l;
            delta = completed ? 1 : -1;
            return { ...l, completed };
          }),
        }));
        const flat = sections.flatMap((s) => s.lessons);
        set({
          courses: {
            ...get().courses,
            [courseId]: {
              ...c,
              sections,
              progress: {
                ...c.progress,
                completed: c.progress.completed + delta,
                nextLessonId: (flat.find((l) => !l.completed) ?? flat[0])?.id ?? null,
                lastLessonId: lessonId,
              },
            },
          },
        });
      }
      await api.saveProgress(lessonId, { completed });
    },

    /** Optimistic send: shows the message immediately, reconciles via nonce. */
    async sendMessage(
      channelId: string,
      serverId: string,
      content: string,
      replyToId?: string | null,
      attachments: import("@majlis/shared").Attachment[] = [],
    ) {
      const me = get().me;
      if (!me) return;
      const nonce = newId();
      const temp: PendingMessage = {
        id: `pending-${nonce}`,
        nonce,
        channelId,
        serverId,
        author: { id: me.id, username: me.username, displayName: me.displayName, avatarUrl: me.avatarUrl },
        content,
        replyToId: replyToId ?? null,
        editedAt: null,
        createdAt: new Date().toISOString(),
        reactions: [],
        attachments,
        pending: true,
      };
      patchChannelMessages(channelId, (items) => [...items, temp]);
      try {
        const msg = await api.sendMessage(channelId, { content, replyToId, nonce, attachmentIds: attachments.map((a) => a.id) });
        patchChannelMessages(channelId, (items) => {
          const already = items.some((m) => m.id === msg.id);
          return already ? items.filter((m) => m.nonce !== nonce || m.id === msg.id) : items.map((m) => (m.nonce === nonce ? msg : m));
        });
      } catch (err) {
        patchMessage(channelId, temp.id, (m) => ({ ...m, pending: false, failed: true }));
        throw err;
      }
    },

    async editMessage(m: Message, content: string) {
      const updated = await api.editMessage(m.id, content);
      patchMessage(m.channelId, m.id, (x) => ({ ...x, content: updated.content, editedAt: updated.editedAt }));
    },

    async deleteMessage(m: Message) {
      if ((m as PendingMessage).failed) return patchChannelMessages(m.channelId, (items) => items.filter((x) => x.id !== m.id));
      await api.deleteMessage(m.id);
      patchChannelMessages(m.channelId, (items) => items.filter((x) => x.id !== m.id));
    },

    async toggleReaction(m: Message, emoji: string) {
      const mine = m.reactions.find((r) => r.emoji === emoji)?.me ?? false;
      // Optimistic
      patchMessage(m.channelId, m.id, (x) => {
        const existing = x.reactions.find((r) => r.emoji === emoji);
        const reactions = existing
          ? x.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + (mine ? -1 : 1), me: !mine } : r))
          : [...x.reactions, { emoji, count: 1, me: true }];
        return { ...x, reactions: reactions.filter((r) => r.count > 0) };
      });
      try {
        if (mine) await api.removeReaction(m.id, emoji);
        else await api.addReaction(m.id, emoji);
      } catch {
        void actions.loadMessages(m.channelId, true);
      }
    },

    sendTyping(channelId: string) {
      gateway.sendTyping(channelId);
    },

    /** Removes expired typing entries; call on an interval from the UI. */
    pruneTyping() {
      const now = Date.now();
      const t = get().typing;
      let changed = false;
      const next: AppState["typing"] = {};
      for (const [cid, users] of Object.entries(t)) {
        const kept = Object.fromEntries(Object.entries(users).filter(([, v]) => v.until > now));
        if (Object.keys(kept).length !== Object.keys(users).length) changed = true;
        next[cid] = kept;
      }
      if (changed) set({ typing: next });
    },
  };

  return { store, api, gateway, actions };
}

export type AppStore = ReturnType<typeof createAppStore>;
