# Supabase Setup

Die App nutzt Supabase als zentralen JSON-Speicher fuer einen privaten Tracker-Stand. Der Browser spricht nicht direkt mit Supabase, sondern mit `/api/tracker-state`. Dadurch bleibt der Service-Role-Key serverseitig.

## 1. Projekt anlegen

Lege in Supabase ein neues Projekt an und oeffne danach den SQL Editor.

## 2. Tabelle erstellen

Fuehre den Inhalt aus `supabase/schema.sql` im SQL Editor aus.

Die Tabelle `public.tracker_state` speichert pro `owner_id` genau einen JSON-Stand:

- `walkLog`: erledigte Spaziergangstage
- `positions`: Portfolio-Positionen
- `snapshots`: Tageswerte

## 3. Environment setzen

Setze diese Variablen in deiner Hosting-Umgebung:

```bash
SUPABASE_URL=https://dein-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=dein-service-role-key
SUPABASE_TRACKER_OWNER_ID=florian
```

`SUPABASE_TRACKER_OWNER_ID` kann frei gewaehlt werden. Wichtig ist nur, dass alle Geraete dieselbe gehostete App mit derselben Variable verwenden.

## 4. Erwartetes Verhalten

- Ohne Supabase-Variablen nutzt die App weiter lokalen Browser-Speicher.
- Mit Supabase-Variablen laedt die App beim Start den zentralen Stand.
- Aenderungen werden nach kurzer Verzoegerung automatisch nach Supabase geschrieben.
- Wenn Supabase temporaer nicht erreichbar ist, bleiben Aenderungen lokal gesichert.

## Sicherheit

Verwende den Service-Role-Key nur als serverseitige Umgebungsvariable. Nicht in `.env`, Screenshots, Browser-Code oder `NEXT_PUBLIC_...` Variablen veroeffentlichen.
