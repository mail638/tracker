# Supabase Setup

Die App nutzt Supabase als zentralen JSON-Speicher fuer den Steuerungs-Tracker. Der Browser spricht nicht direkt mit Supabase, sondern ausschliesslich mit der serverseitigen API `/api/tracker-state`. Der Supabase-Service-Role-Key bleibt serverseitig.

## 1. Projekt und Tabelle

Lege ein Supabase-Projekt an und fuehre `supabase/schema.sql` im SQL Editor aus. Die Tabelle `public.tracker_state` speichert je `owner_id` einen JSON-Stand fuer Training, Vermoegen, Schlaf, LinkedIn, Rueckblicke und Ziele.

Bei einer bestehenden Installation fuehre die Datei erneut aus, damit direkter Tabellenzugriff fuer die Rollen `anon` und `authenticated` widerrufen wird. Es ist keine Datenmigration erforderlich.

## 2. Serverseitige Umgebungsvariablen

Setze diese Werte als Secrets in der Hosting-Umgebung:

```bash
SUPABASE_URL=https://dein-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=dein-service-role-key
SUPABASE_TRACKER_OWNER_ID=florian
TRACKER_ACCESS_PASSWORD=zufaelliges-passwort-mit-mindestens-32-zeichen
TRACKER_SESSION_SECRET=zufaelliger-session-schluessel-mit-mindestens-32-zeichen
```

Erzeuge Passwort und Session-Schluessel unabhaengig voneinander, zum Beispiel:

```bash
openssl rand -base64 48
```

Setze beide Werte ausschliesslich serverseitig. Verwende fuer den Service-Role-Key, das Passwort und den Session-Schluessel keine `NEXT_PUBLIC_...`-Variablen.

`SUPABASE_TRACKER_OWNER_ID` muss dem bisherigen Wert entsprechen, damit bestehende Tracker-Daten erhalten bleiben. Diese feste interne Zeilen-ID ist keine Anmeldung.

## 3. Anmeldung und Synchronisierung

Der Tracker verlangt vor dem Laden persoenlicher Daten das Zugangspasswort. Nach erfolgreichem Login setzt die API ein signiertes, sieben Tage gueltiges Cookie mit `HttpOnly`, `SameSite=Strict` und bei HTTPS `Secure`. Das Passwort wird weder im Browser gespeichert noch an Supabase gesendet.

GET und PUT pruefen das signierte Cookie. Schreibzugriffe pruefen zusaetzlich den Origin-Header. Alle angemeldeten Geraete verwenden dasselbe App-Passwort und synchronisieren denselben `owner_id`-Datensatz. Zum Widerruf aller bestehenden Sitzungen rotiere `TRACKER_SESSION_SECRET`; beim Rotieren des Zugangspassworts muessen sich Nutzer erneut anmelden.

Ohne alle benoetigten Secrets antwortet die API geschlossen mit HTTP 503. Der Code in `.openai/hosting.json` enthaelt keine vorgelagerte Zugriffssperre; die API-Authentifizierung ist daher erforderlich.

## 4. Tests

Fuehre die automatisierten Authentifizierungs- und API-Sicherheitstests mit folgendem Befehl aus:

```bash
npm run test:security
```
