import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";

type TrackerState = {
  walkLog?: Record<string, boolean>;
  positions?: unknown[];
  snapshots?: Record<string, unknown>;
};

type SupabaseConfig = {
  url: string;
  key: string;
  ownerId: string;
};

const tableName = "tracker_state";
const emptyState = { walkLog: {}, positions: [], snapshots: {} };

function readEnv(name: string): string {
  const workerValue = (env as Record<string, string | undefined>)[name];
  const processValue = typeof process !== "undefined" ? process.env[name] : undefined;
  return String(workerValue || processValue || "").trim();
}

function getSupabaseConfig(): SupabaseConfig | null {
  const url = readEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  const ownerId = readEnv("SUPABASE_TRACKER_OWNER_ID") || "default";

  if (!url || !key) return null;
  return { url, key, ownerId };
}

function supabaseHeaders(config: SupabaseConfig, extra?: HeadersInit): HeadersInit {
  return {
    apikey: config.key,
    Authorization: "Bearer " + config.key,
    "Content-Type": "application/json",
    ...extra,
  };
}

function normalizeState(value: unknown): Required<TrackerState> {
  if (!value || typeof value !== "object") return emptyState;
  const state = value as TrackerState;
  return {
    walkLog: state.walkLog && typeof state.walkLog === "object" ? state.walkLog : {},
    positions: Array.isArray(state.positions) ? state.positions : [],
    snapshots: state.snapshots && typeof state.snapshots === "object" ? state.snapshots : {},
  };
}

export async function GET() {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ configured: false, state: null });
  }

  const params = new URLSearchParams({
    owner_id: "eq." + config.ownerId,
    select: "state,updated_at",
    limit: "1",
  });
  const response = await fetch(config.url + "/rest/v1/" + tableName + "?" + params.toString(), {
    cache: "no-store",
    headers: supabaseHeaders(config),
  });

  if (!response.ok) {
    return NextResponse.json(
      { configured: true, error: "Supabase konnte nicht gelesen werden." },
      { status: 502 },
    );
  }

  const rows = (await response.json()) as Array<{ state?: unknown; updated_at?: string }>;
  return NextResponse.json({
    configured: true,
    state: rows[0] ? normalizeState(rows[0].state) : null,
    updatedAt: rows[0]?.updated_at ?? null,
  });
}

export async function PUT(request: Request) {
  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json({ configured: false, saved: false });
  }

  const state = normalizeState(await request.json());
  const response = await fetch(config.url + "/rest/v1/" + tableName + "?on_conflict=owner_id", {
    method: "POST",
    headers: supabaseHeaders(config, { Prefer: "resolution=merge-duplicates" }),
    body: JSON.stringify({
      owner_id: config.ownerId,
      state,
      updated_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    return NextResponse.json(
      { configured: true, saved: false, error: "Supabase konnte nicht gespeichert werden." },
      { status: 502 },
    );
  }

  return NextResponse.json({ configured: true, saved: true });
}
