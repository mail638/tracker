# Supabase Setup

Die App nutzt Supabase als zentralen JSON-Speicher fuer den Steuerungs-Tracker. Der Browser spricht nicht direkt mit Supabase, sondern mit `/api/tracker-state`. Dadurch bleibt der Service-Role-Key serverseitig.

## 1. Projekt anlegen

Lege in Supabase ein neues Projekt an und oeffne danach den SQL Editor. Die Repository-Konfiguration `.openai/hosting.json` enthaelt keine vorgelagerte Zugriffssperre; die API setzt deshalb die eigene Anmeldung zwingend voraus.

## 2. Tabelle erstellen

Fuehre den Inhalt aus `supabase/schema.sql` im SQL Editor aus. Bei einer bestehenden Installation fuehre die Datei erneut aus, damit die Rechte fuer `anon` und `authenticated` explizit entzogen werden.

Die Tabelle `public.tracker_state` speichert pro `owner_id` genau einen JSON-Stand:

- `training`: Kraft, Cardio und Erholung pro Tag
- `weeks`: optionale Wochenflags aus aelteren Versionen
- `wealth`: Vermoegenswerte, Allokation und CSV-Import-Ergebnisse
- `linkedin`: Kontakte als Zeitreihe und LinkedIn-CSV-Import
- `sleep`: Fitbit-Score und Schlafstunden
- `reviews`: Monatsrueckblicke
- `goals`: Ziele fuer Gesundheit, Finanzen und Netzwerk

## 3. Environment setzen

Setze diese Variablen in deiner Hosting-Umgebung:

```bash
SUPABASE_URL=https://dein-projekt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=dein-service-role-key
SUPABASE_TRACKER_OWNER_ID=florian
TRACKER_ACCESS_PASSWORD=ein-langes-einzigartiges-passwort
TRACKER_SESSION_SECRET=ein-zufaelliger-geheimer-wert-mit-mindestens-32-zeichen
```

`SUPABASE_TRACKER_OWNER_ID` kann frei gewaehlt werden. Wichtig ist nur, dass alle Geraete dieselbe gehostete App mit derselben Variable verwenden.

## 4. Erwartetes Verhalten

- Ohne Supabase-Variablen nutzt die App lokalen Browser-Speicher.
- Mit Supabase-Variablen laedt die App beim Start den zentralen Stand.
- Aenderungen werden nach kurzer Verzoegerung automatisch nach Supabase geschrieben.
- Wenn Supabase temporaer nicht erreichbar ist, bleiben Aenderungen lokal gesichert.

## Sicherheit

Verwende den Service-Role-Key nur als serverseitige Umgebungsvariable. Nicht in `.env`, Screenshots, Browser-Code oder `NEXT_PUBLIC_...` Variablen veroeffentlichen.## Anmeldung und Zugriffsschutz

Die App ist fuer einen berechtigten Nutzer vorgesehen. Beim Login wird ein signiertes, sieben Tage gueltiges Sitzungscookie gesetzt. Es ist `HttpOnly`, `SameSite=Strict` und bei HTTPS `Secure`; das Passwort wird weder im Browser gespeichert noch an Supabase gesendet. Tracker-GET und -PUT verlangen dieses Cookie und pruefen bei Schreibzugriffen zusaetzlich den Origin-Header.

Erzeuge `TRACKER_ACCESS_PASSWORD` als zufaelliges, nur fuer diese App verwendetes Passwort (zum Beispiel mit `openssl rand -base64 32`) und `TRACKER_SESSION_SECRET` auf einen zufaelligen Wert mit mindestens 32 Zeichen. Beide Werte muessen als serverseitige Hosting-Secrets konfiguriert werden. Ein Beispiel fuer einen Session-Schluessel:

```bash
openssl rand -base64 48
```

`SUPABASE_TRACKER_OWNER_ID` bleibt eine feste, interne Zeilen-ID und muss dem bisherigen Wert entsprechen, damit bestehende Daten weiterverwendet werden. Sie ist keine Anmeldung. Alle Geraete melden sich mit demselben App-Passwort an und synchronisieren so weiterhin denselben Datensatz. Das Passwort kann durch Aendern des Hosting-Secrets rotiert werden; zum sofortigen Beenden aller Sitzungen muss zusaetzlich `TRACKER_SESSION_SECRET` geaendert werden.

Ohne alle erforderlichen Secrets antwortet die API geschlossen mit HTTP 503. Es gibt keinen ungeschuetzten lokalen Fallback fuer die gehostete API.

## Erwartetes Verhalten

- Ohne Supabase-Konfiguration ist die zentrale Synchronisierung nicht verfuegbar.
- Nach erfolgreicher Anmeldung laedt die App den zentralen Stand und synchronisiert Aenderungen zwischen Geraeten.
- Bei voruebergehendem Supabase-Ausfall bleiben Aenderungen lokal gesichert.

## Sicherheit

Verwende den Service-Role-Key nur als serverseitige Umgebungsvariable. Nicht in `.env`, Screenshots, Browser-Code oder `NEXT_PUBLIC_...` Variablen veroeffentlichen.


## Sicherheitstests

Fuehre die automatisierten Authentifizierungs- und API-Zugriffstests mit `npm run test:security` aus.
