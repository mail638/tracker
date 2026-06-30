'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ActivityType = 'kraft' | 'cardio' | 'erholung';
type TrainingLog = Record<string, ActivityType>;
type WeekLog = Record<string, Record<string, boolean>>;
type Allocation = { label: string; amount: number };
type WealthEntry = { date: string; total: number; alloc: Allocation[] };
type LinkedinEntry = { date: string; followers: number; contacts: number };
type SleepEntry = { date: string; score: number; hours: number };
type TextMap = Record<string, string>;
type TrackerState = {
  training: TrainingLog;
  weeks: WeekLog;
  wealth: WealthEntry[];
  linkedin: LinkedinEntry[];
  sleep: SleepEntry[];
  reviews: TextMap;
  goals: TextMap;
};
type SyncResponse = { configured: boolean; state: TrackerState | null; saved?: boolean; error?: string };
type PortfolioImportResult = { error: string } | { entries: WealthEntry[]; bad: number; positions: number };
type LinkedinImportResult = { error: string } | { series: Array<{ month: string; contacts: number }>; parsed: number; bad: number; total: number };

const C = {
  bg: '#14171a',
  panel: '#1c2024',
  panelHi: '#22272c',
  line: '#2d343a',
  ink: '#e8ecef',
  inkSoft: '#8a949c',
  inkFaint: '#5b656d',
  teal: '#3fb6a8',
  tealDim: '#1f3d3b',
  amber: '#d3a24c',
  warn: '#d98b5f',
  red: '#c75d57',
  green: '#5fae7e',
};
const SANS = 'Inter, -apple-system, system-ui, sans-serif';
const MONO = 'JetBrains Mono, SF Mono, ui-monospace, monospace';
const namespace = 'ftrack_v2_';
const syncEndpoint = '/api/tracker-state';
const dayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const activityTypes: Array<{ key: ActivityType; label: string; real: boolean }> = [
  { key: 'kraft', label: 'Kraft', real: true },
  { key: 'cardio', label: 'Cardio', real: true },
  { key: 'erholung', label: 'Erholung', real: false },
];
const ranges = [
  { key: '1M', label: '1M', days: 31 },
  { key: '3M', label: '3M', days: 92 },
  { key: '6M', label: '6M', days: 183 },
  { key: '1J', label: '1J', days: 366 },
  { key: 'ALL', label: 'Max', days: Infinity },
];
const donutColors = ['#3fb6a8', '#d3a24c', '#6a8fc7', '#c77f9e', '#7fb069', '#b07f5f', '#9a8fc7'];
const emptyState: TrackerState = { training: {}, weeks: {}, wealth: [], linkedin: [], sleep: [], reviews: {}, goals: {} };

const today = () => new Date().toISOString().slice(0, 10);
const curMonth = () => today().slice(0, 7);
const eur = (value: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value || 0);

function fmtDate(iso: string) {
  if (!iso) return '-';
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}.${month}.${year.slice(2)}` : iso;
}

function isoWeek(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 864e5 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekDays(reference = new Date()) {
  const date = new Date(reference);
  const day = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - day);
  return dayLabels.map((label, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return { date: current.toISOString().slice(0, 10), label };
  });
}

function readKey<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(namespace + key);
    return value != null ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveKey(key: string, value: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(namespace + key, JSON.stringify(value));
  } catch (error) {
    console.error('tracker save failed', error);
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeTraining(value: unknown): TrainingLog {
  const raw = normalizeRecord(value);
  const next: TrainingLog = {};
  for (const [date, type] of Object.entries(raw)) {
    if (type === 'kraft' || type === 'cardio' || type === 'erholung') next[date] = type;
    else if (type === true) next[date] = 'cardio';
  }
  return next;
}

function normalizeTextMap(value: unknown): TextMap {
  return Object.fromEntries(Object.entries(normalizeRecord(value)).map(([key, text]) => [key, String(text || '')]));
}

function normalizeWealth(value: unknown): WealthEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = normalizeRecord(entry);
      const alloc = Array.isArray(raw.alloc)
        ? raw.alloc.map((item) => {
            const row = normalizeRecord(item);
            return { label: String(row.label || 'Sonstiges'), amount: Number(row.amount) || 0 };
          })
        : [];
      return { date: String(raw.date || today()), total: Number(raw.total ?? raw.value) || 0, alloc };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeLinkedin(value: unknown): LinkedinEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = normalizeRecord(entry);
      const date = raw.date ? String(raw.date) : String(raw.month || curMonth()) + '-01';
      return { date, followers: Number(raw.followers) || 0, contacts: Number(raw.contacts) || 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeSleep(value: unknown): SleepEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = normalizeRecord(entry);
      const date = raw.date ? String(raw.date) : String(raw.month || curMonth()) + '-01';
      return { date, score: Number(raw.score) || 0, hours: Number(raw.hours) || 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeTrackerState(value: unknown): TrackerState {
  if (!value || typeof value !== 'object') return emptyState;
  const raw = value as Partial<TrackerState> & { walkLog?: Record<string, boolean>; snapshots?: Record<string, { marketValue?: number }> };
  const legacyTraining = raw.training ?? (raw.walkLog ? Object.fromEntries(Object.keys(raw.walkLog).map((date) => [date, 'cardio'])) : {});
  const legacyWealth = raw.wealth ?? (raw.snapshots ? Object.entries(raw.snapshots).map(([date, snapshot]) => ({ date, total: Number(snapshot.marketValue) || 0, alloc: [] })) : []);
  return {
    training: normalizeTraining(legacyTraining),
    weeks: normalizeRecord(raw.weeks) as WeekLog,
    wealth: normalizeWealth(legacyWealth),
    linkedin: normalizeLinkedin(raw.linkedin),
    sleep: normalizeSleep(raw.sleep),
    reviews: normalizeTextMap(raw.reviews),
    goals: normalizeTextMap(raw.goals),
  };
}

function readLocalState(): TrackerState {
  return normalizeTrackerState({
    training: readKey('training', {}),
    weeks: readKey('weeks', {}),
    wealth: readKey('wealth', []),
    linkedin: readKey('linkedin', []),
    sleep: readKey('sleep', []),
    reviews: readKey('reviews', {}),
    goals: readKey('goals', {}),
  });
}

function saveLocalState(state: TrackerState) {
  saveKey('training', state.training);
  saveKey('weeks', state.weeks);
  saveKey('wealth', state.wealth);
  saveKey('linkedin', state.linkedin);
  saveKey('sleep', state.sleep);
  saveKey('reviews', state.reviews);
  saveKey('goals', state.goals);
}

function activityStreak(training: TrainingLog) {
  let streak = 0;
  const date = new Date();
  while (training[date.toISOString().slice(0, 10)]) {
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function parseCSV(text: string) {
  const quote = String.fromCharCode(34);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;
  for (let index = 0; index < text.replace(/^\uFEFF/, '').length; index += 1) {
    const char = text[index];
    if (inQuote) {
      if (char === quote) {
        if (text[index + 1] === quote) {
          field += quote;
          index += 1;
        } else {
          inQuote = false;
        }
      } else {
        field += char;
      }
    } else if (char === quote) {
      inQuote = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((items) => items.some((item) => item.trim() !== ''));
}

function parseMoney(value: string | undefined) {
  let text = String(value || '').replace(/[^\d.,-]/g, '');
  if (text.includes(',') && text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(/,/g, '');
  return Number(text) || 0;
}

function portfolioFromCSV(text: string): PortfolioImportResult {
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: 'Keine Datenzeilen gefunden.' };
  const header = rows[0].map((item) => item.trim().toLowerCase());
  const columnIndex = (names: string[]) => header.findIndex((item) => names.some((name) => item.includes(name)));
  const dateColumn = columnIndex(['datum', 'date']);
  const classColumn = columnIndex(['klasse', 'class', 'kategorie', 'typ', 'asset']);
  let valueColumn = columnIndex(['wert', 'value', 'betrag', 'amount', 'summe']);
  if (valueColumn < 0) valueColumn = rows[0].length - 1;
  const byDate: Record<string, Record<string, number>> = {};
  let bad = 0;
  for (const row of rows.slice(1)) {
    const rawDate = (dateColumn >= 0 ? row[dateColumn] : '').trim();
    const match = rawDate.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    const date = match ? `${match[3]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today();
    const label = (classColumn >= 0 ? row[classColumn] : '').trim() || 'Sonstiges';
    const amount = parseMoney(row[valueColumn]);
    if (!amount) {
      bad += 1;
      continue;
    }
    byDate[date] = byDate[date] || {};
    byDate[date][label] = (byDate[date][label] || 0) + amount;
  }
  const entries = Object.keys(byDate).sort().map((date) => {
    const alloc = Object.entries(byDate[date]).map(([label, amount]) => ({ label, amount }));
    return { date, alloc, total: alloc.reduce((sum, item) => sum + item.amount, 0) };
  });
  return entries.length ? { entries, bad, positions: rows.length - 1 - bad } : { error: 'Keine gueltigen Werte erkannt.' };
}

function contactsFromCSV(text: string): LinkedinImportResult {
  const rows = parseCSV(text);
  if (rows.length < 2) return { error: 'Keine Datenzeilen gefunden.' };
  const header = rows[0].map((item) => item.trim().toLowerCase());
  const datePattern = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
  let dateColumn = header.findIndex((item) => item.includes('verbunden') || item.includes('connected') || item.includes('datum') || item.includes('date'));
  if (dateColumn < 0) {
    for (let column = 0; column < rows[0].length; column += 1) {
      if (rows.slice(1, 21).filter((row) => datePattern.test((row[column] || '').trim())).length >= 5) {
        dateColumn = column;
        break;
      }
    }
  }
  if (dateColumn < 0) return { error: 'Keine Datumsspalte im Format TT.MM.JJJJ erkannt.' };
  const monthCount: Record<string, number> = {};
  let parsed = 0;
  let bad = 0;
  for (const row of rows.slice(1)) {
    const match = (row[dateColumn] || '').trim().match(datePattern);
    if (!match) {
      if ((row[dateColumn] || '').trim()) bad += 1;
      continue;
    }
    const month = `${match[3]}-${String(Number(match[2])).padStart(2, '0')}`;
    monthCount[month] = (monthCount[month] || 0) + 1;
    parsed += 1;
  }
  let cumulative = 0;
  const series = Object.keys(monthCount).sort().map((month) => {
    cumulative += monthCount[month];
    return { month, contacts: cumulative };
  });
  return { series, parsed, bad, total: parsed };
}

export default function WalkingTracker() {
  const [tab, setTab] = useState('day');
  const [loaded, setLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Lokaler Speicher bereit.');
  const [training, setTraining] = useState<TrainingLog>({});
  const [weeks, setWeeks] = useState<WeekLog>({});
  const [wealth, setWealth] = useState<WealthEntry[]>([]);
  const [linkedin, setLinkedin] = useState<LinkedinEntry[]>([]);
  const [sleep, setSleep] = useState<SleepEntry[]>([]);
  const [reviews, setReviews] = useState<TextMap>({});
  const [goals, setGoals] = useState<TextMap>({});
  const [supabaseReady, setSupabaseReady] = useState(false);
  const lastSyncedSignature = useRef('');
  const syncingSignature = useRef('');

  const state = useMemo<TrackerState>(() => ({ training, weeks, wealth, linkedin, sleep, reviews, goals }), [training, weeks, wealth, linkedin, sleep, reviews, goals]);
  const stateSignature = useMemo(() => JSON.stringify(state), [state]);
  const currentWeek = isoWeek();

  const applyState = useCallback((next: TrackerState) => {
    setTraining(next.training);
    setWeeks(next.weeks);
    setWealth(next.wealth);
    setLinkedin(next.linkedin);
    setSleep(next.sleep);
    setReviews(next.reviews);
    setGoals(next.goals);
  }, []);

  useEffect(() => {
    const local = readLocalState();
    applyState(local);
    setLoaded(true);
    setSyncStatus('Lokaler Stand geladen.');

    async function loadRemote() {
      try {
        const response = await fetch(syncEndpoint, { cache: 'no-store' });
        if (!response.ok) throw new Error('Sync HTTP ' + response.status);
        const payload = (await response.json()) as SyncResponse;
        if (!payload.configured) {
          setSyncStatus('Supabase noch nicht konfiguriert.');
          return;
        }
        setSupabaseReady(true);
        if (payload.state) {
          const remote = normalizeTrackerState(payload.state);
          applyState(remote);
          lastSyncedSignature.current = JSON.stringify(remote);
          setSyncStatus('Supabase-Stand geladen.');
        } else {
          setSyncStatus('Supabase bereit. Lokaler Stand wird hochgeladen.');
        }
      } catch {
        setSyncStatus('Supabase nicht erreichbar. Lokal gesichert.');
      }
    }

    void loadRemote();
  }, [applyState]);

  useEffect(() => {
    if (!loaded) return;
    saveLocalState(state);
  }, [loaded, state, stateSignature]);

  useEffect(() => {
    if (!loaded || !supabaseReady) return;
    if (stateSignature === lastSyncedSignature.current || stateSignature === syncingSignature.current) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      syncingSignature.current = stateSignature;
      try {
        setSyncStatus('Speichere in Supabase ...');
        const response = await fetch(syncEndpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(state),
          signal: controller.signal,
        });
        const payload = (await response.json()) as SyncResponse;
        if (!response.ok || payload.saved === false) throw new Error(payload.error || 'Sync fehlgeschlagen');
        lastSyncedSignature.current = stateSignature;
        setSyncStatus('Mit Supabase synchronisiert.');
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') setSyncStatus('Supabase-Speichern fehlgeschlagen. Lokal gesichert.');
      } finally {
        if (syncingSignature.current === stateSignature) syncingSignature.current = '';
      }
    }, 650);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [loaded, supabaseReady, state, stateSignature]);

  const setTrainingDay = useCallback((date: string, type: ActivityType) => {
    setTraining((previous) => {
      const next = { ...previous };
      if (next[date] === type) delete next[date];
      else next[date] = type;
      return next;
    });
  }, []);

  const upsertWealth = useCallback((entry: WealthEntry) => {
    setWealth((previous) => [...previous.filter((item) => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)));
  }, []);
  const deleteWealth = useCallback((date: string) => setWealth((previous) => previous.filter((item) => item.date !== date)), []);
  const importWealth = useCallback((entries: WealthEntry[]) => {
    setWealth((previous) => {
      const byDate = Object.fromEntries(previous.map((item) => [item.date, item]));
      entries.forEach((entry) => { byDate[entry.date] = entry; });
      return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    });
  }, []);
  const upsertLinkedin = useCallback((entry: LinkedinEntry) => {
    setLinkedin((previous) => [...previous.filter((item) => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)));
  }, []);
  const deleteLinkedin = useCallback((date: string) => setLinkedin((previous) => previous.filter((item) => item.date !== date)), []);
  const importContacts = useCallback((series: Array<{ month: string; contacts: number }>) => {
    setLinkedin((previous) => {
      const byDate = Object.fromEntries(previous.map((item) => [item.date, { ...item }]));
      series.forEach(({ month, contacts }) => {
        const [year, monthNumber] = month.split('-').map(Number);
        const lastDay = new Date(year, monthNumber, 0).getDate();
        const date = `${month}-${String(lastDay).padStart(2, '0')}`;
        byDate[date] = { ...(byDate[date] || { date, followers: 0, contacts: 0 }), contacts };
      });
      return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    });
  }, []);
  const upsertSleep = useCallback((entry: SleepEntry) => {
    setSleep((previous) => [...previous.filter((item) => item.date !== entry.date), entry].sort((a, b) => a.date.localeCompare(b.date)));
  }, []);
  const deleteSleep = useCallback((date: string) => setSleep((previous) => previous.filter((item) => item.date !== date)), []);
  const saveReview = useCallback((text: string) => setReviews((previous) => ({ ...previous, [curMonth()]: text })), []);
  const saveGoal = useCallback((key: string, text: string) => setGoals((previous) => ({ ...previous, [key]: text })), []);

  if (!loaded) return <div style={{ fontFamily: SANS, padding: 40, color: C.inkSoft }}>Laedt ...</div>;

  const tabs = [['day', 'Aktivitaet'], ['portfolio', 'Portfolio'], ['sleep', 'Sleep'], ['linkedin', 'LinkedIn']];
  return (
    <main style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: SANS }}>
      <TrackerStyles />
      <div className='wrap'>
        <div className='topline'>
          <div>
            <div className='eyebrow'>Personal Operating System</div>
            <h1>Steuerungs-Tracker</h1>
            <div className='sub'>{currentWeek.replace('-W', ' - KW ')} - Aktivitaet, Portfolio, Sleep und LinkedIn als Zeitreihen.</div>
          </div>
          <div className='sync'>{syncStatus}</div>
        </div>
        <div className='tabs'>{tabs.map(([key, label]) => <button key={key} className={`tab ${tab === key ? 'on' : ''}`} onClick={() => setTab(key)}>{label}</button>)}</div>
        {tab === 'day' && <DayTab training={training} onSet={setTrainingDay} goal={goals.health} onSaveGoal={(text) => saveGoal('health', text)} />}
        {tab === 'portfolio' && <PortfolioTab wealth={wealth} onUpsert={upsertWealth} onDelete={deleteWealth} onImport={importWealth} goal={goals.fin} onSaveGoal={(text) => saveGoal('fin', text)} />}
        {tab === 'sleep' && <SleepTab sleep={sleep} onUpsert={upsertSleep} onDelete={deleteSleep} reviews={reviews} onSaveReview={saveReview} goal={goals.health} />}
        {tab === 'linkedin' && <LinkedinTab linkedin={linkedin} onUpsert={upsertLinkedin} onDelete={deleteLinkedin} onImport={importContacts} goal={goals.net} onSaveGoal={(text) => saveGoal('net', text)} />}
      </div>
    </main>
  );
}

function TrackerStyles() {
  return <style>{`
    * { box-sizing: border-box; }
    body { background:${C.bg}; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 28px 18px 90px; }
    .topline { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; }
    .eyebrow { font-family:${MONO}; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:${C.teal}; }
    h1 { margin:6px 0 2px; font-size:26px; line-height:1.12; letter-spacing:0; }
    .sub { font-size:13px; color:${C.inkSoft}; line-height:1.5; }
    .sync { max-width:220px; border:1px solid ${C.line}; border-radius:999px; color:${C.inkSoft}; font-family:${MONO}; font-size:10px; padding:7px 10px; text-align:right; }
    .tabs { display:flex; gap:2px; margin:24px 0 20px; background:${C.panel}; padding:4px; border-radius:11px; border:1px solid ${C.line}; }
    .tab { flex:1; font-family:${MONO}; font-size:11px; letter-spacing:0; text-transform:uppercase; background:none; border:none; padding:9px 4px; color:${C.inkSoft}; cursor:pointer; border-radius:8px; white-space:nowrap; }
    .tab.on { background:${C.tealDim}; color:${C.teal}; }
    .card { background:${C.panel}; border:1px solid ${C.line}; border-radius:12px; padding:18px; margin-bottom:12px; }
    .card-h { font-family:${MONO}; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:${C.inkFaint}; margin-bottom:14px; }
    .row { display:flex; align-items:center; justify-content:space-between; gap:14px; }
    .label { font-size:15px; font-weight:600; }
    .desc { font-size:12.5px; color:${C.inkSoft}; margin-top:2px; }
    .metric { font-family:${MONO}; font-weight:700; letter-spacing:0; }
    .seg { display:flex; gap:6px; }
    .segbtn { font-family:${MONO}; font-size:12px; letter-spacing:0; padding:8px 12px; border-radius:8px; border:1px solid ${C.line}; background:${C.panelHi}; color:${C.inkSoft}; cursor:pointer; }
    .segbtn.on-real { background:${C.teal}; border-color:${C.teal}; color:#06201d; font-weight:700; }
    .segbtn.on-rest { background:${C.amber}; border-color:${C.amber}; color:#241a06; font-weight:700; }
    .days { display:grid; grid-template-columns:repeat(7,1fr); gap:7px; }
    .day { border-radius:10px; border:1px solid ${C.line}; background:${C.panelHi}; padding:10px 4px; text-align:center; min-width:0; }
    .day.kraft,.day.cardio { background:${C.tealDim}; border-color:${C.teal}; }
    .day.erholung { background:#3a2f17; border-color:${C.amber}; }
    .dl { font-family:${MONO}; font-size:10px; color:${C.inkFaint}; letter-spacing:1px; }
    .dn { font-family:${MONO}; font-size:13px; font-weight:700; margin-top:2px; }
    .dt { font-size:9px; margin-top:3px; color:${C.inkSoft}; text-transform:uppercase; }
    input, textarea { font-family:${SANS}; font-size:14px; padding:10px 12px; border:1px solid ${C.line}; border-radius:8px; background:${C.panelHi}; color:${C.ink}; width:100%; }
    input:focus, textarea:focus { outline:1px solid ${C.teal}; border-color:${C.teal}; }
    input[type=date] { color-scheme: dark; }
    .inp-mono { font-family:${MONO}; }
    .btn { font-family:${MONO}; font-size:12px; letter-spacing:0; text-transform:uppercase; padding:10px 14px; border-radius:8px; border:1px solid ${C.teal}; background:${C.teal}; color:#06201d; font-weight:700; cursor:pointer; white-space:nowrap; }
    .btn.ghost { background:none; color:${C.inkSoft}; border-color:${C.line}; }
    .pill { font-family:${MONO}; font-size:12px; padding:4px 10px; border-radius:999px; background:${C.tealDim}; color:${C.teal}; }
    .pill.warn { background:#3a2f17; color:${C.amber}; }
    .delta-up { color:${C.green}; }
    .delta-dn { color:${C.red}; }
    .goal { display:grid; gap:7px; margin-top:10px; }
    .goal-text { font-size:13px; color:${C.teal}; }
    svg text { font-family:${MONO}; fill:${C.inkFaint}; }
    .field-lbl { font-family:${MONO}; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:${C.inkFaint}; margin-bottom:5px; }
    .alloc-row { display:grid; grid-template-columns:1fr 120px 34px; gap:6px; margin-bottom:6px; }
    .iconbtn { background:none; border:1px solid ${C.line}; color:${C.inkSoft}; border-radius:7px; cursor:pointer; font-size:14px; min-height:34px; }
    .hist { width:100%; border-collapse:collapse; margin-top:8px; }
    .hist td, .hist th { padding:7px 4px; border-top:1px solid ${C.line}; font-size:13px; }
    .hist th { font-family:${MONO}; font-size:10px; letter-spacing:1px; text-transform:uppercase; color:${C.inkFaint}; text-align:left; border:none; }
    .hist .num { text-align:right; font-family:${MONO}; }
    @media (max-width: 680px) { .topline { display:block; } .sync { margin-top:12px; max-width:none; text-align:left; } .row { align-items:flex-start; } .seg { flex-direction:column; } .alloc-row { grid-template-columns:1fr; } }
  `}</style>;
}

function GoalEditor({ value, onSave }: { value?: string; onSave: (text: string) => void }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  return <div className='goal'><div className='field-lbl'>Ziel</div><input value={draft} placeholder='Ziel oder Fokus' onChange={(event) => setDraft(event.target.value)} onBlur={() => onSave(draft)} />{draft && <div className='goal-text'>◆ {draft}</div>}</div>;
}

function DayTab({ training, onSet, goal, onSaveGoal }: { training: TrainingLog; onSet: (date: string, type: ActivityType) => void; goal?: string; onSaveGoal: (text: string) => void }) {
  const days = weekDays();
  const currentDate = today();
  const currentType = training[currentDate] || null;
  const realThisWeek = days.filter((day) => training[day.date] === 'kraft' || training[day.date] === 'cardio').length;
  const activeThisWeek = days.filter((day) => training[day.date]).length;
  const streak = activityStreak(training);
  return <>
    <section className='card'>
      <div className='row' style={{ marginBottom: 16 }}><div><div className='card-h' style={{ marginBottom: 4 }}>Heute - {fmtDate(currentDate)}</div><div className='label'>Training erfasst?</div></div><div style={{ textAlign: 'right' }}><div className='metric' style={{ fontSize: 30, color: C.teal }}>{streak}</div><div className='desc'>Tage aktiv in Folge</div></div></div>
      <div className='seg'>{activityTypes.map((type) => <button key={type.key} className={`segbtn ${currentType === type.key ? type.real ? 'on-real' : 'on-rest' : ''}`} onClick={() => onSet(currentDate, type.key)} style={{ flex: 1 }}>{type.label}</button>)}</div>
      <GoalEditor value={goal} onSave={onSaveGoal} />
    </section>
    <section className='card'>
      <div className='row' style={{ marginBottom: 12 }}><div className='card-h' style={{ margin: 0 }}>Diese Woche</div><div style={{ display: 'flex', gap: 8 }}><span className='pill'>{realThisWeek} Training</span><span className='pill warn'>{activeThisWeek} aktiv</span></div></div>
      <div className='days'>{days.map((day) => { const type = training[day.date]; const future = day.date > currentDate; const label = activityTypes.find((item) => item.key === type)?.label.slice(0, 4) || '-'; return <div key={day.date} className={`day ${type || ''}`} style={{ opacity: future ? 0.4 : 1 }}><div className='dl'>{day.label}</div><div className='dn'>{Number(day.date.slice(8))}</div><div className='dt'>{label}</div></div>; })}</div>
    </section>
  </>;
}

function PortfolioTab({ wealth, onUpsert, onDelete, onImport, goal, onSaveGoal }: { wealth: WealthEntry[]; onUpsert: (entry: WealthEntry) => void; onDelete: (date: string) => void; onImport: (entries: WealthEntry[]) => void; goal?: string; onSaveGoal: (text: string) => void }) {
  return <><WealthCard wealth={wealth} onUpsert={onUpsert} onDelete={onDelete} onImport={onImport} /><section className='card'><div className='card-h'>Finanzziel</div><GoalEditor value={goal} onSave={onSaveGoal} /></section></>;
}

function WealthCard({ wealth, onUpsert, onDelete, onImport }: { wealth: WealthEntry[]; onUpsert: (entry: WealthEntry) => void; onDelete: (date: string) => void; onImport: (entries: WealthEntry[]) => void }) {
  const [date, setDate] = useState(today());
  const [alloc, setAlloc] = useState<Array<{ label: string; amount: string }>>([{ label: '', amount: '' }]);
  const [simple, setSimple] = useState('');
  const [useAlloc, setUseAlloc] = useState(false);
  const [range, setRange] = useState('ALL');
  const [preview, setPreview] = useState<PortfolioImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const last = wealth[wealth.length - 1];
  const previous = wealth.length > 1 ? wealth[wealth.length - 2] : null;
  const delta = last && previous ? last.total - previous.total : null;
  const deltaPct = delta != null && previous?.total ? (delta / previous.total) * 100 : null;
  const latestAlloc = last?.alloc?.length ? last.alloc : null;

  useEffect(() => {
    const existing = wealth.find((entry) => entry.date === date);
    if (!existing) return;
    if (existing.alloc.length) {
      setUseAlloc(true);
      setAlloc(existing.alloc.map((item) => ({ label: item.label, amount: String(item.amount) })));
    } else {
      setUseAlloc(false);
      setSimple(String(existing.total));
    }
  }, [date, wealth]);

  const allocSum = alloc.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const submit = () => {
    const entry = useAlloc
      ? { date, total: allocSum, alloc: alloc.filter((item) => item.label || item.amount).map((item) => ({ label: item.label.trim() || 'Sonstiges', amount: Number(item.amount) || 0 })) }
      : { date, total: Number(simple) || 0, alloc: [] };
    onUpsert(entry);
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(portfolioFromCSV(String(reader.result)));
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  };

  return <section className='card'>
    <div className='card-h'>Gesamtvermoegen - Zeitreihe</div>
    <div className='row' style={{ alignItems: 'flex-end', marginBottom: 8 }}><div><div className='metric' style={{ fontSize: 34 }}>{last ? eur(last.total) : '-'}</div><div className='desc'>{last ? `Stand ${fmtDate(last.date)}` : 'noch kein Eintrag'}{delta != null && <><span> - </span><span className={delta >= 0 ? 'delta-up' : 'delta-dn'}>{delta >= 0 ? '▲' : '▼'} {eur(Math.abs(delta))}{deltaPct != null ? ` (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)} %)` : ''}</span></>}</div></div></div>
    <WealthChart wealth={wealth} range={range} setRange={setRange} />
    {latestAlloc && <AllocDonut alloc={latestAlloc} total={last.total} date={last.date} />}
    <div style={{ background: C.panelHi, border: `1px dashed ${C.line}`, borderRadius: 8, padding: 14, marginBottom: 14, marginTop: 8 }}>
      <div className='field-lbl'>Portfolio-CSV importieren</div><input ref={fileRef} type='file' accept='.csv,text/csv' onChange={onFile} style={{ display: 'none' }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><button className='btn ghost' onClick={() => fileRef.current?.click()}>CSV waehlen</button><span className='sub' style={{ margin: 0 }}>Datum, Klasse und Wert werden erkannt.</span></div>
      {preview && 'error' in preview && <div className='desc' style={{ color: C.warn, marginTop: 10 }}>! {preview.error}</div>}
      {preview && 'entries' in preview && <div style={{ marginTop: 12 }}><div className='desc' style={{ color: C.ink }}>{preview.positions} Positionen - {preview.entries.length} Stichtag(e){preview.bad > 0 && <span style={{ color: C.warn }}> - {preview.bad} ohne Wert uebersprungen</span>}</div>{preview.entries.map((entry) => <div key={entry.date} className='desc' style={{ marginTop: 4 }}>{fmtDate(entry.date)}: <span style={{ color: C.ink }}>{eur(entry.total)}</span> ({entry.alloc.map((item) => `${item.label} ${eur(item.amount)}`).join(' - ')})</div>)}<div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className='btn' onClick={() => { onImport(preview.entries); setPreview(null); }}>Importieren</button><button className='btn ghost' onClick={() => setPreview(null)}>Abbrechen</button></div></div>}
    </div>
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}><div style={{ flex: 1 }}><div className='field-lbl'>Datum</div><input className='inp-mono' type='date' value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></div><div style={{ display: 'flex', alignItems: 'flex-end' }}><button className='btn ghost' onClick={() => setUseAlloc((value) => !value)}>{useAlloc ? 'Eine Summe' : 'Aufteilen'}</button></div></div>
      {!useAlloc ? <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><div className='field-lbl'>Gesamtsumme aus getquin</div><input className='inp-mono' type='number' inputMode='decimal' placeholder='z. B. 42500' value={simple} onChange={(event) => setSimple(event.target.value)} /></div><button className='btn' onClick={submit}>Speichern</button></div> : <><div className='field-lbl'>Allokation</div>{alloc.map((item, index) => <div className='alloc-row' key={index}><input placeholder='Aktien / Tagesgeld / Crypto' value={item.label} onChange={(event) => setAlloc((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} /><input className='inp-mono' type='number' placeholder='EUR' value={item.amount} onChange={(event) => setAlloc((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: event.target.value } : row))} /><button className='iconbtn' onClick={() => setAlloc((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>x</button></div>)}<div className='row' style={{ marginTop: 4 }}><button className='btn ghost' onClick={() => setAlloc((rows) => [...rows, { label: '', amount: '' }])}>+ Klasse</button><div><span className='desc'>Summe </span><span className='metric' style={{ fontSize: 18 }}>{eur(allocSum)}</span></div></div><button className='btn' style={{ width: '100%', marginTop: 10 }} onClick={submit}>Speichern</button></>}
    </div>
    {wealth.length > 0 && <HistoryTable headers={['Datum', 'Summe', 'Aufteilung', '']} rows={[...wealth].reverse().map((entry) => [fmtDate(entry.date), eur(entry.total), entry.alloc.length ? entry.alloc.map((item) => item.label).join(' - ') : '-', <button key={entry.date} className='iconbtn' onClick={() => onDelete(entry.date)}>x</button>])} />}
  </section>;
}

function WealthChart({ wealth, range, setRange }: { wealth: WealthEntry[]; range: string; setRange: (range: string) => void }) {
  const cfg = ranges.find((item) => item.key === range) || ranges[ranges.length - 1];
  let data = wealth;
  if (cfg.days !== Infinity) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cfg.days);
    const key = cutoff.toISOString().slice(0, 10);
    data = wealth.filter((entry) => entry.date >= key);
  }
  return <div style={{ marginBottom: 8 }}><RangeButtons range={range} setRange={setRange} /><LineChart rows={data} getValue={(entry) => entry.total} formatValue={eur} /></div>;
}

function LineChart<T extends { date: string }>({ rows, getValue, formatValue, color = C.teal, height = 190 }: { rows: T[]; getValue: (row: T) => number; formatValue: (value: number) => string; color?: string; height?: number }) {
  const width = 660;
  const padL = 56;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  if (rows.length < 2) return <svg viewBox={`0 0 ${width} ${height}`} width='100%' style={{ display: 'block' }}><text x={padL} y={height / 2} style={{ fontSize: 12 }}>Mind. zwei Werte im Zeitraum noetig.</text></svg>;
  const values = rows.map(getValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (index: number) => padL + (index / (rows.length - 1)) * (width - padL - padR);
  const y = (value: number) => height - padB - ((value - min) / span) * (height - padT - padB);
  const path = rows.map((row, index) => `${index ? 'L' : 'M'}${x(index)},${y(getValue(row))}`).join(' ');
  const area = `${path} L${x(rows.length - 1)},${height - padB} L${x(0)},${height - padB} Z`;
  const trendColor = values[values.length - 1] >= values[0] ? C.green : C.red;
  const lineColor = color === C.teal ? trendColor : color;
  return <svg viewBox={`0 0 ${width} ${height}`} width='100%' style={{ display: 'block' }}><defs><linearGradient id={`fill-${height}`} x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stopColor={lineColor} stopOpacity='0.22' /><stop offset='100%' stopColor={lineColor} stopOpacity='0' /></linearGradient></defs>{[max, (max + min) / 2, min].map((value, index) => <g key={index}><line x1={padL} y1={y(value)} x2={width - padR} y2={y(value)} stroke={C.line} strokeDasharray='2 4' /><text x={padL - 6} y={y(value) + 3} textAnchor='end' style={{ fontSize: 10 }}>{formatValue(value)}</text></g>)}<path d={area} fill={`url(#fill-${height})`} /><path d={path} fill='none' stroke={lineColor} strokeWidth='2.5' />{rows.length <= 26 && rows.map((row, index) => <circle key={row.date} cx={x(index)} cy={y(getValue(row))} r='3.5' fill={lineColor} />)}<text x={padL} y={height - 6} style={{ fontSize: 10 }}>{fmtDate(rows[0].date)}</text><text x={width - padR} y={height - 6} textAnchor='end' style={{ fontSize: 10 }}>{fmtDate(rows[rows.length - 1].date)}</text></svg>;
}

function AllocDonut({ alloc, total, date }: { alloc: Allocation[]; total: number; date: string }) {
  if (!total) return null;
  const outer = 58;
  const inner = 36;
  const center = 70;
  let acc = 0;
  const segments = alloc.map((item, index) => {
    const fraction = item.amount / total;
    const start = acc * 2 * Math.PI - Math.PI / 2;
    acc += fraction;
    const end = acc * 2 * Math.PI - Math.PI / 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = center + outer * Math.cos(start);
    const y1 = center + outer * Math.sin(start);
    const x2 = center + outer * Math.cos(end);
    const y2 = center + outer * Math.sin(end);
    const xi2 = center + inner * Math.cos(end);
    const yi2 = center + inner * Math.sin(end);
    const xi1 = center + inner * Math.cos(start);
    const yi1 = center + inner * Math.sin(start);
    return { ...item, fraction, color: donutColors[index % donutColors.length], d: `M${x1},${y1} A${outer},${outer} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${inner},${inner} 0 ${large} 0 ${xi1},${yi1} Z` };
  });
  return <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}` }}><svg viewBox='0 0 140 140' width='120' height='120' style={{ flex: 'none' }}>{segments.map((segment, index) => <path key={index} d={segment.d} fill={segment.color} />)}</svg><div style={{ flex: 1 }}><div className='field-lbl' style={{ marginBottom: 8 }}>Allokation - {fmtDate(date)}</div>{segments.map((segment, index) => <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: segment.color, flex: 'none' }} /><span style={{ fontSize: 13, flex: 1 }}>{segment.label || '-'}</span><span className='metric' style={{ fontSize: 12, color: C.inkSoft }}>{(segment.fraction * 100).toFixed(0)} %</span><span className='metric' style={{ fontSize: 12, width: 70, textAlign: 'right' }}>{eur(segment.amount)}</span></div>)}</div></div>;
}

function SleepTab({ sleep, onUpsert, onDelete, reviews, onSaveReview, goal }: { sleep: SleepEntry[]; onUpsert: (entry: SleepEntry) => void; onDelete: (date: string) => void; reviews: TextMap; onSaveReview: (text: string) => void; goal?: string }) {
  const month = curMonth();
  const [review, setReview] = useState(reviews[month] || '');
  useEffect(() => setReview(reviews[month] || ''), [reviews, month]);
  return <><SleepCard sleep={sleep} onUpsert={onUpsert} onDelete={onDelete} goal={goal} /><section className='card'><div className='card-h'>Monatsrueckblick - {month}</div><textarea rows={4} value={review} placeholder='Was lief, was nicht, Fokus fuer naechsten Monat' onChange={(event) => setReview(event.target.value)} onBlur={() => onSaveReview(review)} /><div className='sub' style={{ marginTop: 8 }}>Wird beim Verlassen des Feldes gespeichert.</div></section></>;
}

function SleepCard({ sleep, onUpsert, onDelete, goal }: { sleep: SleepEntry[]; onUpsert: (entry: SleepEntry) => void; onDelete: (date: string) => void; goal?: string }) {
  const [date, setDate] = useState(today());
  const [score, setScore] = useState('');
  const [hours, setHours] = useState('');
  useEffect(() => { const existing = sleep.find((entry) => entry.date === date); if (existing) { setScore(String(existing.score)); setHours(String(existing.hours)); } }, [date, sleep]);
  const last = sleep[sleep.length - 1];
  const previous = sleep.length > 1 ? sleep[sleep.length - 2] : null;
  const delta = last && previous ? last.score - previous.score : null;
  return <section className='card'><div className='card-h'>Schlaf - Fitbit-Score - Zeitreihe</div><div className='row' style={{ marginBottom: 14, alignItems: 'flex-end' }}><div><div className='metric' style={{ fontSize: 30, color: C.teal }}>{last ? last.score : '-'}</div><div className='desc'>{last ? `Score - ${last.hours} h - ${fmtDate(last.date)}` : 'noch kein Eintrag'}{delta != null && <><span> - </span><span className={delta >= 0 ? 'delta-up' : 'delta-dn'}>{delta >= 0 ? '+' : ''}{delta}</span></>}</div></div>{sleep.length >= 2 && <Bars data={sleep.map((entry) => entry.score)} />}</div><div style={{ display: 'flex', gap: 8, marginBottom: 10 }}><div style={{ flex: 1 }}><div className='field-lbl'>Datum</div><input className='inp-mono' type='date' value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></div></div><div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><div className='field-lbl'>Score</div><input className='inp-mono' type='number' placeholder='0-100' value={score} onChange={(event) => setScore(event.target.value)} /></div><div style={{ flex: 1 }}><div className='field-lbl'>Stunden</div><input className='inp-mono' type='number' step='0.1' placeholder='7.2' value={hours} onChange={(event) => setHours(event.target.value)} /></div><button className='btn' onClick={() => onUpsert({ date, score: Number(score) || 0, hours: Number(hours) || 0 })}>Speichern</button></div>{goal && <div className='goal-text' style={{ marginTop: 10 }}>◆ {goal}</div>}{sleep.length > 0 && <HistoryTable headers={['Datum', 'Score', 'Stunden', '']} rows={[...sleep].reverse().map((entry) => [fmtDate(entry.date), entry.score, entry.hours, <button key={entry.date} className='iconbtn' onClick={() => onDelete(entry.date)}>x</button>])} />}</section>;
}

function LinkedinTab({ linkedin, onUpsert, onDelete, onImport, goal, onSaveGoal }: { linkedin: LinkedinEntry[]; onUpsert: (entry: LinkedinEntry) => void; onDelete: (date: string) => void; onImport: (series: Array<{ month: string; contacts: number }>) => void; goal?: string; onSaveGoal: (text: string) => void }) {
  return <><LinkedinCard linkedin={linkedin} onUpsert={onUpsert} onDelete={onDelete} onImport={onImport} /><section className='card'><div className='card-h'>Netzwerkziel</div><GoalEditor value={goal} onSave={onSaveGoal} /></section></>;
}

function LinkedinCard({ linkedin, onUpsert, onDelete, onImport }: { linkedin: LinkedinEntry[]; onUpsert: (entry: LinkedinEntry) => void; onDelete: (date: string) => void; onImport: (series: Array<{ month: string; contacts: number }>) => void }) {
  const [date, setDate] = useState(today());
  const [contacts, setContacts] = useState('');
  const [preview, setPreview] = useState<LinkedinImportResult | null>(null);
  const [range, setRange] = useState('ALL');
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { const existing = linkedin.find((entry) => entry.date === date); if (existing) setContacts(String(existing.contacts)); }, [date, linkedin]);
  const last = linkedin[linkedin.length - 1];
  const previous = linkedin.length > 1 ? linkedin[linkedin.length - 2] : null;
  const delta = last && previous ? last.contacts - previous.contacts : null;
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPreview(contactsFromCSV(String(reader.result)));
    reader.readAsText(file, 'utf-8');
    event.target.value = '';
  };
  return <section className='card'><div className='card-h'>LinkedIn-Kontakte - Zeitreihe</div><div style={{ marginBottom: 14 }}><div className='field-lbl'>Kontakte</div><div className='metric' style={{ fontSize: 30 }}>{last ? last.contacts : '-'}</div>{delta != null && <div className='desc'><span className={delta >= 0 ? 'delta-up' : 'delta-dn'}>{delta >= 0 ? '+' : ''}{delta}</span> gegenueber Vorwert</div>}</div><LinkedinChart data={linkedin} range={range} setRange={setRange} /><div style={{ background: C.panelHi, border: `1px dashed ${C.line}`, borderRadius: 8, padding: 14, marginBottom: 14 }}><div className='field-lbl'>Kontakte aus LinkedIn-Export</div><input ref={fileRef} type='file' accept='.csv,text/csv' onChange={onFile} style={{ display: 'none' }} /><div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><button className='btn ghost' onClick={() => fileRef.current?.click()}>CSV waehlen</button><span className='sub' style={{ margin: 0 }}>Spalte Verbunden am wird kumuliert.</span></div>{preview && 'error' in preview && <div className='desc' style={{ color: C.warn, marginTop: 10 }}>! {preview.error}</div>}{preview && 'series' in preview && <div style={{ marginTop: 12 }}><div className='desc' style={{ color: C.ink }}>{preview.parsed} Kontakte erkannt - {preview.series.length} Monatspunkte{preview.bad > 0 && <span style={{ color: C.warn }}> - {preview.bad} ohne Datum uebersprungen</span>}</div><div className='desc' style={{ marginTop: 4 }}>{preview.series[0]?.month} ({preview.series[0]?.contacts}) bis {preview.series[preview.series.length - 1]?.month} ({preview.series[preview.series.length - 1]?.contacts})</div><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button className='btn' onClick={() => { onImport(preview.series); setPreview(null); }}>Importieren</button><button className='btn ghost' onClick={() => setPreview(null)}>Abbrechen</button></div></div>}</div><div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}><div style={{ flex: 1 }}><div className='field-lbl'>Datum</div><input className='inp-mono' type='date' value={date} max={today()} onChange={(event) => setDate(event.target.value)} /></div><div style={{ flex: 1 }}><div className='field-lbl'>Kontakte</div><input className='inp-mono' type='number' value={contacts} onChange={(event) => setContacts(event.target.value)} /></div><button className='btn' onClick={() => onUpsert({ date, followers: 0, contacts: Number(contacts) || 0 })}>Speichern</button></div>{linkedin.length > 0 && <HistoryTable headers={['Datum', 'Kontakte', '']} rows={[...linkedin].reverse().map((entry) => [fmtDate(entry.date), entry.contacts, <button key={entry.date} className='iconbtn' onClick={() => onDelete(entry.date)}>x</button>])} />}</section>;
}

function LinkedinChart({ data, range, setRange }: { data: LinkedinEntry[]; range: string; setRange: (range: string) => void }) {
  const cfg = ranges.find((item) => item.key === range) || ranges[ranges.length - 1];
  let rows = data;
  if (cfg.days !== Infinity) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - cfg.days);
    rows = data.filter((entry) => entry.date >= cutoff.toISOString().slice(0, 10));
  }
  const growth = rows.map((entry, index) => index === 0 ? 0 : entry.contacts - rows[index - 1].contacts);
  return <div style={{ marginBottom: 14 }}><RangeButtons range={range} setRange={setRange} /><LineChart rows={rows} getValue={(entry) => entry.contacts} formatValue={(value) => String(Math.round(value))} color={C.teal} height={220} />{rows.length >= 2 && <><div className='field-lbl' style={{ marginTop: 10, marginBottom: 4 }}>Kontaktwachstum / Periode</div><Bars data={growth} wide /></>}</div>;
}

function RangeButtons({ range, setRange }: { range: string; setRange: (range: string) => void }) {
  return <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>{ranges.map((item) => <button key={item.key} onClick={() => setRange(item.key)} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 0, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${range === item.key ? C.teal : C.line}`, background: range === item.key ? C.tealDim : 'transparent', color: range === item.key ? C.teal : C.inkSoft }}>{item.label}</button>)}</div>;
}

function Bars({ data, wide = false }: { data: number[]; wide?: boolean }) {
  const width = wide ? 660 : 180;
  const height = wide ? 60 : 56;
  const max = Math.max(1, ...data.map((value) => Math.abs(value)));
  const barWidth = width / Math.max(1, data.length);
  return <svg viewBox={`0 0 ${width} ${height}`} width={wide ? '100%' : width} height={wide ? undefined : height}>{data.map((value, index) => { const barHeight = Math.abs(value) / max * (height - 8); return <rect key={index} x={index * barWidth + 2} y={height - barHeight - 4} width={Math.max(1, barWidth - 4)} height={barHeight} rx='2' fill={value >= 0 ? C.teal : C.red} opacity={index === data.length - 1 ? 1 : 0.55} />; })}</svg>;
}

function HistoryTable({ headers, rows }: { headers: string[]; rows: Array<Array<React.ReactNode>> }) {
  return <table className='hist'><thead><tr>{headers.map((header, index) => <th key={index} style={index === 1 ? { textAlign: 'right' } : undefined}>{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className={typeof cell === 'number' || (typeof cell === 'string' && cell.startsWith('€')) ? 'num' : undefined} style={cellIndex === row.length - 1 ? { textAlign: 'right' } : undefined}>{cell}</td>)}</tr>)}</tbody></table>;
}
