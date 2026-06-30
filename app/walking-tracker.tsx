"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type WalkLog = Record<string, boolean>;
type SnapshotLog = Record<string, PortfolioMetrics>;
type RawPosition = Partial<Position> & {
  value?: number;
  ticker?: string;
  entryPrice?: number;
  purchaseDate?: string;
};
type Position = {
  id: string;
  name: string;
  buyDate: string;
  shares: number;
  buyPrice: number;
  currentPrice: number;
  symbol: string;
  currency: string;
  lastPriceAt: string;
};
type DayItem = { key: string; label: string; dateLabel: string; isToday: boolean };
type PortfolioMetrics = {
  marketValue: number;
  costBasis: number;
  gain: number;
  gainPct: number;
  currency?: string;
};
type TrackerState = {
  walkLog: WalkLog;
  positions: Position[];
  snapshots: SnapshotLog;
};
type SyncResponse = {
  configured: boolean;
  state: TrackerState | null;
  saved?: boolean;
  error?: string;
};

const walkStorageKey = "geh-tracker-v1";
const positionStorageKey = "portfolio-positions-v2";
const legacyPositionStorageKey = "portfolio-positions-v1";
const snapshotStorageKey = "portfolio-snapshots-v2";
const legacySnapshotStorageKey = "portfolio-snapshots-v1";
const syncEndpoint = "/api/tracker-state";
const yahooChartBaseUrl = "https://query1.finance.yahoo.com/v8/finance/chart/";

const dayFormatter = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const dateFormatter = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const currencyFormatter = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function shiftedDate(offset: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date;
}

function buildWeek(): DayItem[] {
  return Array.from({ length: 7 }, (_, index) => {
    const offset = index - 6;
    const date = shiftedDate(offset);
    return {
      key: dateKey(date),
      label: offset === 0 ? "Heute" : dayFormatter.format(date),
      dateLabel: dateFormatter.format(date),
      isToday: offset === 0,
    };
  });
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizePosition(item: RawPosition): Position {
  const legacyValue = normalizeNumber(item.value);
  const buyPrice = normalizeNumber(item.buyPrice ?? item.entryPrice ?? legacyValue);
  const currentPrice = normalizeNumber(item.currentPrice ?? legacyValue ?? buyPrice);
  const shares = normalizeNumber(item.shares ?? (legacyValue > 0 && currentPrice > 0 ? legacyValue / currentPrice : 1));
  const name = String(item.name || item.ticker || item.symbol || "Position").trim() || "Position";
  const symbol = String(item.symbol || item.ticker || name).trim().toUpperCase();
  const currency = String(item.currency || "EUR").trim().toUpperCase();

  return {
    id: String(item.id || Date.now() + Math.random()),
    name,
    buyDate: String(item.buyDate || item.purchaseDate || dateKey(new Date())),
    shares: shares || 1,
    buyPrice,
    currentPrice: currentPrice || buyPrice,
    symbol,
    currency,
    lastPriceAt: String(item.lastPriceAt || ""),
  };
}

function normalizeWalkLog(value: unknown): WalkLog {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, active]) => [key, active === true]));
}

function normalizeSnapshot(value: unknown): PortfolioMetrics {
  if (value && typeof value === "object") {
    const data = value as Partial<PortfolioMetrics> & { totalValue?: number; value?: number };
    const marketValue = normalizeNumber(data.marketValue ?? data.totalValue ?? data.value);
    const costBasis = normalizeNumber(data.costBasis);
    const gain = Number.isFinite(Number(data.gain)) ? Number(data.gain) : marketValue - costBasis;
    return {
      marketValue,
      costBasis,
      gain,
      gainPct: costBasis > 0 ? (gain / costBasis) * 100 : 0,
      currency: String(data.currency || "EUR").toUpperCase(),
    };
  }
  return { marketValue: normalizeNumber(value), costBasis: 0, gain: 0, gainPct: 0, currency: "EUR" };
}

function normalizeTrackerState(value: unknown): TrackerState {
  if (!value || typeof value !== "object") {
    return { walkLog: {}, positions: [], snapshots: {} };
  }

  const state = value as Partial<TrackerState>;
  const snapshots = state.snapshots && typeof state.snapshots === "object" ? state.snapshots : {};
  return {
    walkLog: normalizeWalkLog(state.walkLog),
    positions: Array.isArray(state.positions) ? state.positions.map((item) => normalizePosition(item as RawPosition)) : [],
    snapshots: Object.fromEntries(Object.entries(snapshots).map(([key, snapshot]) => [key, normalizeSnapshot(snapshot)])),
  };
}

function readLocalTrackerState(): TrackerState {
  const currentPositions = readStorage<RawPosition[] | null>(positionStorageKey, null);
  const legacyPositions = readStorage<RawPosition[] | null>(legacyPositionStorageKey, null);
  const currentSnapshots = readStorage<Record<string, unknown> | null>(snapshotStorageKey, null);
  const legacySnapshots = readStorage<Record<string, unknown>>(legacySnapshotStorageKey, {});

  return normalizeTrackerState({
    walkLog: readStorage<WalkLog>(walkStorageKey, {}),
    positions: currentPositions ?? legacyPositions ?? [],
    snapshots: currentSnapshots ?? legacySnapshots,
  });
}

function saveLocalTrackerState(state: TrackerState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(walkStorageKey, JSON.stringify(state.walkLog));
  window.localStorage.setItem(positionStorageKey, JSON.stringify(state.positions));
  window.localStorage.setItem(snapshotStorageKey, JSON.stringify(state.snapshots));
}

function formatMoney(value: number, currency?: string): string {
  const code = String(currency || "EUR").toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat("de-DE", { style: "currency", currency: code }).format(value || 0);
    } catch {}
  }
  return currencyFormatter.format(value || 0) + " " + code;
}

function formatPercent(value: number): string {
  return percentFormatter.format(value || 0) + "%";
}

function positionCost(position: Position): number {
  return position.shares * position.buyPrice;
}

function positionValue(position: Position): number {
  return position.shares * position.currentPrice;
}

function positionGain(position: Position): number {
  return positionValue(position) - positionCost(position);
}

function positionGainPct(position: Position): number {
  const cost = positionCost(position);
  return cost > 0 ? (positionGain(position) / cost) * 100 : 0;
}

type YahooQuote = { price: number; currency: string; symbol: string; time: string };

function extractYahooPrice(payload: unknown): YahooQuote {
  const data = payload as { chart?: { result?: Array<{ meta?: Record<string, unknown>; indicators?: { quote?: Array<{ close?: unknown[] }> } }> } };
  const result = data.chart?.result?.[0];
  const meta = result?.meta ?? {};
  const close = result?.indicators?.quote?.[0]?.close ?? [];
  const lastClose = [...close].reverse().find((value) => Number.isFinite(Number(value)));
  const price = Number(meta.regularMarketPrice ?? meta.previousClose ?? lastClose);
  if (!Number.isFinite(price)) throw new Error("Kein Kurs gefunden");
  return {
    price,
    currency: String(meta.currency || "EUR").toUpperCase(),
    symbol: String(meta.symbol || ""),
    time: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString() : new Date().toISOString(),
  };
}

async function fetchYahooQuote(position: Position): Promise<YahooQuote> {
  const symbol = String(position.symbol || position.name).trim().toUpperCase();
  if (!symbol) throw new Error("Symbol fehlt");
  const response = await fetch(yahooChartBaseUrl + encodeURIComponent(symbol) + "?interval=1d&range=1d", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error("Yahoo HTTP " + response.status);
  const quote = extractYahooPrice(await response.json());
  return { ...quote, symbol: quote.symbol || symbol };
}

function countCurrentStreak(log: WalkLog): number {
  let streak = 0;
  for (let offset = 0; offset > -60; offset -= 1) {
    if (!log[dateKey(shiftedDate(offset))]) break;
    streak += 1;
  }
  return streak;
}

export default function WalkingTracker() {
  const [walkLog, setWalkLog] = useState<WalkLog>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotLog>({});
  const [name, setName] = useState("");
  const [buyDate, setBuyDate] = useState(dateKey(new Date()));
  const [shares, setShares] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [quoteStatus, setQuoteStatus] = useState("Yahoo Finance bereit.");
  const [syncStatus, setSyncStatus] = useState("Lokaler Speicher bereit.");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const lastSyncedSignature = useRef("");
  const syncingSignature = useRef("");

  const week = useMemo(() => buildWeek(), []);
  const todayKey = week[week.length - 1]?.key ?? dateKey(new Date());
  const walkedToday = Boolean(walkLog[todayKey]);
  const walkedThisWeek = week.filter((day) => walkLog[day.key]).length;
  const walkProgress = Math.round((walkedThisWeek / week.length) * 100);

  const metrics = useMemo<PortfolioMetrics>(() => {
    const marketValue = positions.reduce((sum, item) => sum + positionValue(item), 0);
    const costBasis = positions.reduce((sum, item) => sum + positionCost(item), 0);
    const gain = marketValue - costBasis;
    const currencies = [...new Set(positions.map((item) => item.currency || "EUR"))];
    return {
      marketValue,
      costBasis,
      gain,
      gainPct: costBasis > 0 ? (gain / costBasis) * 100 : 0,
      currency: currencies.length <= 1 ? currencies[0] || "EUR" : "GEMISCHT",
    };
  }, [positions]);

  const trackerState = useMemo<TrackerState>(() => ({ walkLog, positions, snapshots }), [walkLog, positions, snapshots]);
  const trackerSignature = useMemo(() => JSON.stringify(trackerState), [trackerState]);
  const recentSnapshots = Object.entries(snapshots).sort(([a], [b]) => b.localeCompare(a)).slice(0, 7);

  const applyTrackerState = useCallback((state: TrackerState) => {
    setWalkLog(state.walkLog);
    setPositions(state.positions);
    setSnapshots(state.snapshots);
  }, []);

  const saveTodaySnapshot = useCallback(() => {
    setSnapshots((current) => ({ ...current, [todayKey]: metrics }));
  }, [metrics, todayKey]);

  useEffect(() => {
    const localState = readLocalTrackerState();
    applyTrackerState(localState);
    setReady(true);
    setSyncStatus("Lokaler Stand geladen.");

    async function loadRemoteState() {
      try {
        const response = await fetch(syncEndpoint, { cache: "no-store" });
        if (!response.ok) throw new Error("Sync HTTP " + response.status);
        const payload = (await response.json()) as SyncResponse;

        if (!payload.configured) {
          setSyncStatus("Supabase noch nicht konfiguriert. Lokaler Speicher aktiv.");
          return;
        }

        setSupabaseReady(true);
        if (payload.state) {
          const remoteState = normalizeTrackerState(payload.state);
          applyTrackerState(remoteState);
          lastSyncedSignature.current = JSON.stringify(remoteState);
          setSyncStatus("Supabase-Stand geladen.");
        } else {
          setSyncStatus("Supabase bereit. Lokaler Stand wird hochgeladen.");
        }
      } catch {
        setSyncStatus("Supabase nicht erreichbar. Lokaler Speicher aktiv.");
      }
    }

    void loadRemoteState();
  }, [applyTrackerState]);

  useEffect(() => {
    if (!ready) return;
    saveLocalTrackerState(trackerState);
  }, [ready, trackerSignature, trackerState]);

  useEffect(() => {
    if (!ready || !supabaseReady) return;
    if (trackerSignature === lastSyncedSignature.current || trackerSignature === syncingSignature.current) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      syncingSignature.current = trackerSignature;
      try {
        setSyncStatus("Speichere in Supabase ...");
        const response = await fetch(syncEndpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trackerState),
          signal: controller.signal,
        });
        const payload = (await response.json()) as SyncResponse;
        if (!response.ok || payload.saved === false) throw new Error(payload.error || "Sync fehlgeschlagen");
        lastSyncedSignature.current = trackerSignature;
        setSyncStatus("Mit Supabase synchronisiert.");
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") {
          setSyncStatus("Supabase-Speichern fehlgeschlagen. Lokal gesichert.");
        }
      } finally {
        if (syncingSignature.current === trackerSignature) {
          syncingSignature.current = "";
        }
      }
    }, 650);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [ready, supabaseReady, trackerSignature, trackerState]);

  useEffect(() => {
    if (ready) saveTodaySnapshot();
  }, [ready, saveTodaySnapshot]);

  async function refreshYahooPrices() {
    if (!positions.length) {
      setQuoteStatus("Keine Positionen fuer Yahoo-Abfrage vorhanden.");
      return;
    }

    setQuoteLoading(true);
    setQuoteStatus("Yahoo Finance wird abgefragt ...");
    const results = await Promise.allSettled(positions.map((position) => fetchYahooQuote(position)));
    let updated = 0;
    const failed: string[] = [];

    setPositions((current) =>
      current.map((position, index) => {
        const result = results[index];
        if (result.status === "fulfilled") {
          updated += 1;
          return {
            ...position,
            symbol: result.value.symbol || position.symbol,
            currentPrice: result.value.price,
            currency: result.value.currency || position.currency,
            lastPriceAt: result.value.time,
          };
        }
        failed.push(position.symbol || position.name);
        return position;
      }),
    );

    setQuoteStatus(
      failed.length
        ? updated + "/" + positions.length + " Kurse aktualisiert. Fehler: " + failed.join(", ")
        : "Alle Kurse via Yahoo Finance aktualisiert.",
    );
    setQuoteLoading(false);
  }

  function addPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedShares = normalizeNumber(shares);
    const parsedBuyPrice = normalizeNumber(buyPrice);
    const parsedCurrentPrice = currentPrice === "" ? parsedBuyPrice : normalizeNumber(currentPrice);
    if (!name.trim() || parsedShares <= 0) return;

    setPositions((current) => [
      ...current,
      {
        id: String(Date.now()),
        name: name.trim(),
        symbol: name.trim().toUpperCase(),
        buyDate,
        shares: parsedShares,
        buyPrice: parsedBuyPrice,
        currentPrice: parsedCurrentPrice,
        currency: "EUR",
        lastPriceAt: "",
      },
    ]);
    setName("");
    setShares("");
    setBuyPrice("");
    setCurrentPrice("");
    setBuyDate(dateKey(new Date()));
  }

  return (
    <main className="min-h-screen bg-[#f4f7f4] text-[#17211b]">
      <section className="mx-auto grid min-h-screen w-full max-w-7xl gap-7 px-5 py-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-9 lg:py-7">
        <div className="flex min-w-0 flex-col justify-center gap-5">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-[#5f6b63]">Fitness</p>
              <h1 className="mt-2 text-4xl font-bold">Heute gegangen?</h1>
            </div>
            <div className="rounded-md bg-[#e35d44] px-4 py-2 text-sm font-bold text-white">{walkProgress}%</div>
          </header>

          <button
            type="button"
            aria-pressed={walkedToday}
            onClick={() => setWalkLog((current) => ({ ...current, [todayKey]: !walkedToday }))}
            className={(walkedToday ? "border-[#2d8a58] bg-[#dff3e2]" : "border-[#cad8cf] bg-white") + " min-h-[196px] rounded-lg border p-6 text-left"}
          >
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-sm font-black shadow-inner">{walkedToday ? "OK" : ""}</span>
            <span className="mt-6 block text-4xl font-bold">{walkedToday ? "Erledigt" : "Noch offen"}</span>
            <span className="mt-3 block text-[#566158]">{walkedToday ? "Der heutige Spaziergang zaehlt." : "Noch kein Haken fuer heute."}</span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#cad8cf] bg-white p-5">
              <p className="text-sm font-bold text-[#5f6b63]">Diese Woche</p>
              <strong className="mt-3 block text-4xl">{walkedThisWeek}/7</strong>
            </div>
            <div className="rounded-lg border border-[#cad8cf] bg-white p-5">
              <p className="text-sm font-bold text-[#5f6b63]">Streak</p>
              <strong className="mt-3 block text-4xl">{countCurrentStreak(walkLog)}</strong>
            </div>
          </div>

          <div className="h-3 overflow-hidden rounded bg-[#dfe8e1]">
            <div className="h-full rounded bg-[#2d8a58]" style={{ width: walkProgress + "%" }} />
          </div>

          <div className="grid grid-cols-7 gap-2">
            {week.map((day) => {
              const active = Boolean(walkLog[day.key]);
              return (
                <button
                  key={day.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setWalkLog((current) => ({ ...current, [day.key]: !active }))}
                  className={(active ? "border-[#2d8a58] bg-[#2d8a58] text-white" : day.isToday ? "border-[#e35d44] bg-white" : "border-[#cad8cf] bg-white text-[#5a6259]") + " flex min-h-[76px] flex-col items-center justify-between rounded-lg border px-1 py-2 text-center"}
                >
                  <span className="text-xs font-bold">{day.label}</span>
                  <span className="text-[11px] font-bold">{day.dateLabel}</span>
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white/70 text-[10px] font-black text-[#17211b]">{active ? "OK" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-w-0 flex-col justify-center gap-4">
          <header className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-[#5f6b63]">Portfolio</p>
              <h2 className="mt-2 text-4xl font-bold">Tagaktueller Stand</h2>
              <p className="mt-2 text-sm font-bold text-[#5f6b63]">Kurse per Yahoo Finance aktualisieren und Tagesstand speichern.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" disabled={quoteLoading} onClick={refreshYahooPrices} className="rounded-md border border-[#2f6f8f] bg-[#2f6f8f] px-4 py-2 text-sm font-bold text-white">
                Kurse von Yahoo laden
              </button>
              <button type="button" onClick={saveTodaySnapshot} className="rounded-md border border-[#cad8cf] bg-white px-4 py-2 text-sm font-bold">
                Tagesstand speichern
              </button>
              <p className="basis-full text-right text-xs font-bold text-[#5f6b63]">{quoteStatus}</p>
              <p className="basis-full text-right text-xs font-bold text-[#5f6b63]">{syncStatus}</p>
            </div>
          </header>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-[#cad8cf] bg-[#e3f1f6] p-4">
              <p className="text-sm font-bold text-[#5f6b63]">Marktwert heute</p>
              <strong className="mt-2 block break-words text-3xl">{formatMoney(metrics.marketValue, metrics.currency)}</strong>
            </div>
            <div className="rounded-lg border border-[#cad8cf] bg-white p-4">
              <p className="text-sm font-bold text-[#5f6b63]">Einstand</p>
              <strong className="mt-2 block break-words text-2xl">{formatMoney(metrics.costBasis, metrics.currency)}</strong>
            </div>
            <div className="rounded-lg border border-[#cad8cf] bg-white p-4">
              <p className="text-sm font-bold text-[#5f6b63]">Performance</p>
              <strong className={(metrics.gain >= 0 ? "text-[#1f7b50]" : "text-[#a34836]") + " mt-2 block break-words text-2xl"}>
                {(metrics.gain >= 0 ? "+" : "-") + formatMoney(Math.abs(metrics.gain), metrics.currency)}
              </strong>
            </div>
            <div className="rounded-lg border border-[#cad8cf] bg-white p-4">
              <p className="text-sm font-bold text-[#5f6b63]">Performance %</p>
              <strong className={(metrics.gainPct >= 0 ? "text-[#1f7b50]" : "text-[#a34836]") + " mt-2 block break-words text-2xl"}>
                {(metrics.gainPct >= 0 ? "+" : "-") + formatPercent(Math.abs(metrics.gainPct))}
              </strong>
            </div>
          </div>

          <form onSubmit={addPosition} className="grid gap-3 rounded-lg border border-[#cad8cf] bg-white p-4 md:grid-cols-6 md:items-end">
            <label className="grid gap-2 text-xs font-bold text-[#5f6b63]">
              Aktie / Ticker
              <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-[#cad8cf] px-3 py-2 text-base text-[#17211b]" placeholder="z. B. AAPL" />
            </label>
            <label className="grid gap-2 text-xs font-bold text-[#5f6b63]">
              Kaufdatum
              <input value={buyDate} onChange={(event) => setBuyDate(event.target.value)} type="date" className="rounded-md border border-[#cad8cf] px-3 py-2 text-base text-[#17211b]" />
            </label>
            <label className="grid gap-2 text-xs font-bold text-[#5f6b63]">
              Stuecke
              <input value={shares} onChange={(event) => setShares(event.target.value)} type="number" min="0" step="0.0001" className="rounded-md border border-[#cad8cf] px-3 py-2 text-base text-[#17211b]" />
            </label>
            <label className="grid gap-2 text-xs font-bold text-[#5f6b63]">
              Einstandskurs
              <input value={buyPrice} onChange={(event) => setBuyPrice(event.target.value)} type="number" min="0" step="0.01" className="rounded-md border border-[#cad8cf] px-3 py-2 text-base text-[#17211b]" />
            </label>
            <label className="grid gap-2 text-xs font-bold text-[#5f6b63]">
              Kurs heute
              <input value={currentPrice} onChange={(event) => setCurrentPrice(event.target.value)} type="number" min="0" step="0.01" className="rounded-md border border-[#cad8cf] px-3 py-2 text-base text-[#17211b]" />
            </label>
            <button type="submit" className="rounded-md border border-[#2f6f8f] bg-[#2f6f8f] px-4 py-2 font-bold text-white">
              Position anlegen
            </button>
          </form>

          <section className="space-y-2">
            <div className="flex justify-between gap-3">
              <h3 className="font-bold">Positionen</h3>
              <p className="text-sm font-bold text-[#5f6b63]">{positions.length} {positions.length === 1 ? "Position" : "Positionen"}</p>
            </div>
            {positions.length ? (
              positions.map((item) => {
                const gain = positionGain(item);
                const pct = positionGainPct(item);
                return (
                  <div key={item.id} className="grid gap-3 rounded-lg border border-[#cad8cf] bg-white p-3 lg:grid-cols-[1.2fr_0.5fr_0.7fr_0.7fr_0.8fr_0.9fr_auto]">
                    <div>
                      <strong className="break-words">{item.name}</strong>
                      <span className="mt-1 block text-xs font-bold text-[#5f6b63]">Kauf {new Date(item.buyDate + "T12:00:00").toLocaleDateString("de-DE")}</span>
                    </div>
                    <div>
                      <small className="block text-xs font-bold text-[#5f6b63]">Stuecke</small>
                      <strong>{item.shares}</strong>
                    </div>
                    <div>
                      <small className="block text-xs font-bold text-[#5f6b63]">Einstand</small>
                      <strong>{formatMoney(item.buyPrice, item.currency)}</strong>
                    </div>
                    <label className="grid gap-1 text-xs font-bold text-[#5f6b63]">
                      Kurs heute
                      <input
                        value={item.currentPrice}
                        onChange={(event) => setPositions((current) => current.map((position) => (position.id === item.id ? { ...position, currentPrice: normalizeNumber(event.target.value) } : position)))}
                        type="number"
                        min="0"
                        step="0.01"
                        className="rounded-md border border-[#cad8cf] px-2 py-2 text-base text-[#17211b]"
                      />
                    </label>
                    <div>
                      <small className="block text-xs font-bold text-[#5f6b63]">Marktwert</small>
                      <strong>{formatMoney(positionValue(item), item.currency)}</strong>
                    </div>
                    <div>
                      <small className="block text-xs font-bold text-[#5f6b63]">Performance</small>
                      <strong className={gain >= 0 ? "text-[#1f7b50]" : "text-[#a34836]"}>
                        {(gain >= 0 ? "+" : "-") + formatMoney(Math.abs(gain), item.currency) + " / " + (pct >= 0 ? "+" : "-") + formatPercent(Math.abs(pct))}
                      </strong>
                    </div>
                    <button type="button" onClick={() => setPositions((current) => current.filter((position) => position.id !== item.id))} className="border-0 bg-transparent font-black text-[#8a4a3d]">
                      Entfernen
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-[#cad8cf] p-4 font-bold text-[#5f6b63]">Noch keine Position eingetragen.</div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex justify-between gap-3">
              <h3 className="font-bold">Tagesverlauf</h3>
              <p className="text-sm font-bold text-[#5f6b63]">letzte 7 Tage</p>
            </div>
            {recentSnapshots.length ? (
              recentSnapshots.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[1fr_auto] rounded-lg border border-[#cad8cf] bg-white p-3">
                  <span>{new Date(key + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
                  <strong>{formatMoney(value.marketValue, value.currency)} / {(value.gainPct >= 0 ? "+" : "-") + formatPercent(Math.abs(value.gainPct))}</strong>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-[#cad8cf] p-4 font-bold text-[#5f6b63]">Noch kein Tagesstand gespeichert.</div>
            )}
          </section>

          <p className="text-sm font-bold leading-6 text-[#5f6b63]">
            Hinweis: Yahoo Finance liefert Kurse je nach Boerse ggf. verzoegert. Keine Anlageberatung; bei gemischten Waehrungen erfolgt keine FX-Umrechnung.
          </p>
        </div>
      </section>
    </main>
  );
}
