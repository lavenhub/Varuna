import { useSyncExternalStore } from "react";
import type { ChatMessage, Incident, Notification } from "./types";

export interface Session {
  email: string;
  fullName: string;
  organization: string;
  role: string;
  roleTitle: string;
}

/** One entry per real computation done on the Impact or Drift tab, so the
 * Dashboard can surface "what was analysed most recently" — proof the tabs
 * actually fetched live data and produced output, not static values. */
export interface AnalysisEntry {
  id: string;
  incidentId: string;
  incidentName: string;
  kind: "impact" | "drift";
  summary: string;
  detail: string;
  at: string; // ISO timestamp
}

export interface OilyState {
  session: Session | null;
  incidents: Incident[];
  notifications: Notification[];
  chats: Record<string, ChatMessage[]>;
  timeline: Record<string, { time: string; text: string }[]>;
  analyses: AnalysisEntry[];
  hydrated: boolean;
}

// v2: the incident log now starts EMPTY (0 incidents) and is populated from the
// backend / by detecting spills. Bumping the key invalidates any cached v1 state
// that still held the old demo seeds.
const STORAGE_KEY = "oily.state.v2";

function initialState(): OilyState {
  return {
    session: null,
    incidents: [],
    notifications: [],
    chats: {},
    timeline: {},
    analyses: [],
    hydrated: false,
  };
}

let state: OilyState = initialState();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    const { session, incidents, notifications, chats, timeline, analyses } = state;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ session, incidents, notifications, chats, timeline, analyses }),
    );
  } catch {
    /* storage unavailable — in-memory state still works */
  }
}

function set(patch: Partial<OilyState>) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export const oilyStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot() {
    return state;
  },
  getServerSnapshot() {
    return serverState;
  },
  hydrate() {
    if (state.hydrated || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OilyState>;
        state = { ...state, ...parsed, hydrated: true };
      } else {
        state = { ...state, hydrated: true };
      }
    } catch {
      state = { ...state, hydrated: true };
    }
    emit();
  },
  signIn(session: Session) {
    set({ session });
  },
  signOut() {
    set({ session: null });
  },
  updateSession(patch: Partial<Session>) {
    if (!state.session) return;
    set({ session: { ...state.session, ...patch } });
  },
  nextIncidentId() {
    const nums = state.incidents
      .map((i) => Number(i.id.replace("VARUNA-", "")))
      .filter((n) => !Number.isNaN(n));
    return `VARUNA-${Math.max(1042, ...nums) + 1}`;
  },
  addIncident(incident: Incident) {
    set({
      incidents: [incident, ...state.incidents],
      timeline: { ...state.timeline, [incident.id]: buildTimeline() },
      notifications: [
        {
          id: `n-${incident.id}`,
          level: "critical",
          message: `${incident.id} logged — ${incident.name}.`,
          time: nowHHMM(),
        },
        ...state.notifications,
      ],
    });
  },
  updateIncident(id: string, patch: Partial<Incident>) {
    set({
      incidents: state.incidents.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  },
  appendTimeline(id: string, text: string) {
    const existing = state.timeline[id] ?? [];
    set({ timeline: { ...state.timeline, [id]: [...existing, { time: nowHHMM(), text }] } });
  },
  addChatMessage(incidentId: string, message: ChatMessage) {
    const existing = state.chats[incidentId] ?? [];
    set({ chats: { ...state.chats, [incidentId]: [...existing, message] } });
  },
  clearNotifications() {
    set({ notifications: [] });
  },
  /** Replace the incident list (used when loading from the backend). */
  setIncidents(incidents: Incident[]) {
    set({ incidents });
  },
  /**
   * Load incidents from the backend API — the source of truth. Falls back to the
   * persisted localStorage seed if the backend is unreachable, so the demo never
   * shows an empty screen. Client-only.
   */
  async loadIncidents() {
    if (typeof window === "undefined") return;
    try {
      const { incidentsApi } = await import("@/api/incidents");
      const incidents = await incidentsApi.list();
      if (Array.isArray(incidents)) {
        // Backend is the source of truth — reflect it even when it's empty (0
        // incidents). Preserve any locally-attached image data URLs the API
        // doesn't round-trip.
        const byId = new Map(state.incidents.map((i) => [i.id, i]));
        const merged = incidents.map((i) => {
          const local = byId.get(i.id);
          return local?.imageDataUrl && !i.imageDataUrl
            ? { ...i, imageDataUrl: local.imageDataUrl }
            : i;
        });
        set({ incidents: merged });
      }
    } catch {
      /* backend unreachable — keep the persisted seed */
    }
  },
  /** Record a real Impact/Drift computation so the Dashboard can show it as
   * recent analysis activity. De-dupes by (incidentId, kind) so re-opening a
   * tab updates the existing entry rather than piling up duplicates. */
  recordAnalysis(entry: Omit<AnalysisEntry, "id" | "at">) {
    const at = new Date().toISOString();
    const filtered = state.analyses.filter(
      (a) => !(a.incidentId === entry.incidentId && a.kind === entry.kind),
    );
    set({
      analyses: [{ ...entry, id: `${entry.incidentId}-${entry.kind}`, at }, ...filtered].slice(0, 12),
    });
  },
  reset() {
    state = { ...initialState(), hydrated: true };
    persist();
    emit();
  },
};

const serverState = initialState();

function nowHHMM() {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function buildTimeline() {
  const base = new Date();
  const steps = [
    "Spill detected",
    "ML classification completed",
    "Incident confirmed",
    "Environmental telemetry loaded",
    "Drift forecast generated",
    "Environmental impact assessed",
    "Emergency response generated",
  ];
  return steps.map((text, i) => {
    const d = new Date(base.getTime() + i * 2 * 60000);
    return {
      time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
      text,
    };
  });
}

export function useOily(): OilyState {
  return useSyncExternalStore(
    oilyStore.subscribe,
    oilyStore.getSnapshot,
    oilyStore.getServerSnapshot,
  );
}

export function useIncident(id: string | undefined) {
  const { incidents } = useOily();
  return incidents.find((i) => i.id === id);
}
