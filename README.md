# Steuerungs-Tracker

Privater Personal-Operating-System-Tracker fuer Aktivitaet, Vermoegen, Sleep, LinkedIn-Kontakte, Monatsrueckblicke und Ziele. Die App speichert Daten lokal im Browser und kann ueber Supabase synchronisieren, damit derselbe Stand auf mehreren Endgeraeten verfuegbar ist.

## Funktionen

- Aktivitaet: Kraft, Cardio oder Erholung pro Tag, Wochenuebersicht und Streak
- Portfolio: Gesamtvermoegen, Allokation, Verlauf und Portfolio-CSV-Import
- Sleep: Fitbit-Score, Stunden, Verlauf und Monatsrueckblick
- LinkedIn: Kontakte als Zeitreihe und CSV-Import aus dem LinkedIn-Export
- Ziele: Fokusfelder fuer Gesundheit, Finanzen und Netzwerk

## Lokal starten

```bash
npm install
npm run dev
```

## Supabase verbinden

1. Neues Supabase-Projekt anlegen.
2. `supabase/schema.sql` im Supabase SQL Editor ausfuehren.
3. Diese serverseitigen Umgebungsvariablen setzen:

```bash
SUPABASE_URL=https://dein-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=dein-service-role-key
SUPABASE_TRACKER_OWNER_ID=florian
TRACKER_ACCESS_PASSWORD=ein-langes-einzigartiges-passwort
TRACKER_SESSION_SECRET=ein-zufaelliger-geheimer-wert-mit-mindestens-32-zeichen
```

`SUPABASE_SERVICE_ROLE_KEY` bleibt serverseitig und darf nicht als `NEXT_PUBLIC_...` Variable gesetzt werden.

Die gehostete App verlangt das Zugangspasswort vor dem Anzeigen und Synchronisieren der Tracker-Daten. Passwort, Session-Schluessel und Supabase-Service-Role-Key muessen als serverseitige Hosting-Secrets gesetzt sein; sie duerfen nie als `NEXT_PUBLIC_...` Variablen veroeffentlicht werden.

Mehr Details und Konfigurationsschritte stehen in `docs/supabase.md`.

## Wichtige Befehle

```bash
npm run build
npm run lint
```
