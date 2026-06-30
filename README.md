# Tracker

Privater Geh- und Portfolio-Tracker. Die App speichert Daten lokal im Browser und kann ueber Supabase synchronisieren, damit derselbe Stand auf mehreren Endgeraeten verfuegbar ist.

## Lokal starten

```bash
npm install
npm run dev
```

## Supabase verbinden

1. Neues Supabase-Projekt anlegen.
2. `supabase/schema.sql` im Supabase SQL Editor ausfuehren.
3. Diese Umgebungsvariablen setzen:

```bash
SUPABASE_URL=https://dein-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=dein-service-role-key
SUPABASE_TRACKER_OWNER_ID=florian
```

`SUPABASE_SERVICE_ROLE_KEY` bleibt serverseitig und darf nicht als `NEXT_PUBLIC_...` Variable gesetzt werden.

Wenn die Variablen fehlen, laeuft die App weiter mit lokalem Browser-Speicher. Sobald sie gesetzt sind, liest die App den zentralen Supabase-Stand und speichert Aenderungen automatisch zurueck.

Mehr Details stehen in `docs/supabase.md`.

## Wichtige Befehle

```bash
npm run build
npm run lint
```
