# Rezeptbox

Eine kleine App, in der du Rezepte aus **Instagram, TikTok, YouTube, Pinterest** und von Rezept-Webseiten sammelst. Du schickst ihr einen Beitrag über **Teilen**, und sie speichert ihn mit Vorschaubild, liest Zutaten und Zubereitung aus und sortiert ihn automatisch in Kategorien wie *Pasta*, *Vegetarisch*, *Airfryer* oder *Schnell & Einfach*.

Die Rezeptbox ist eine Web-App (PWA): Sie läuft im Browser, lässt sich aber wie eine normale App auf den Startbildschirm legen, auf iPhone und Android.

## Was die App kann

- **Teilen aus Instagram & TikTok**: Unter Android erscheint die Rezeptbox direkt im Teilen-Menü. Auf dem iPhone übernimmt das ein Kurzbefehl (Anleitung in der App).
- **Automatisch ausgelesen**: Titel, Autor, Vorschaubild und Bildunterschrift werden geladen. Steht das Rezept in der Beschreibung („Zutaten: … Zubereitung: …“), werden Zutatenliste und Schritte daraus erstellt. Bei Rezept-Webseiten werden die strukturierten Rezeptdaten der Seite übernommen.
- **Automatisch kategorisiert**: 19 Kategorien (Frühstück, Pasta, Fleisch, Hähnchen, Fisch, Vegetarisch, Vegan, Suppen, Salate & Bowls, Snacks, Backen, Desserts, Getränke, Saucen, Asiatisch, Airfryer, Meal Prep, Schnell & Einfach, High Protein). Eigene Kategorien wie „Weihnachten“ kannst du jederzeit ergänzen.
- **Optional mit KI** (Claude): saubere Titel, vollständige Zutaten und Schritte aus unordentlichen Beschreibungen, Übersetzung ins Deutsche und eine treffsichere Einordnung, auch mithilfe des Vorschaubilds.
- **Finden statt Suchen**: Volltextsuche (auch nach Zutaten, z. B. „Zucchini“ oder „#feta“), Filter nach Kategorie, Favoriten, „Nachgekocht“ und ein Zufallsrezept für „Was koche ich heute?“.
- **Beim Kochen**: Zutaten abhaken, nummerierte Schritte, eigene Notizen und ein Kochmodus, der das Display anlässt.
- **Doppelte Links** werden erkannt, Tracking-Parameter entfernt, Vorschaubilder lokal gespeichert (die Links von Instagram und TikTok laufen nach einiger Zeit ab).
- Hell- und Dunkelmodus, offline lesbar, Sicherung als JSON-Download.

## Rezepte in die App schicken

| Gerät | So geht’s |
|---|---|
| **Android** | Rezeptbox in Chrome öffnen → Menü ⋮ → *App installieren*. Danach in Instagram/TikTok auf **Teilen** → **Rezeptbox**. |
| **iPhone / iPad** | Einmalig einen Kurzbefehl anlegen, der den geteilten Link an die Rezeptbox schickt. Die Schritt-für-Schritt-Anleitung mit deiner persönlichen Adresse und deinem Schlüssel steht in der App unter **Einstellungen** (Schieberegler-Symbol oben rechts). Danach: Teilen → *Teilen über …* / *Mehr* → **In Rezeptbox speichern**. Weitere iPhones (z. B. in der Familie) bekommen den fertigen Kurzbefehl per iCloud-Link. |
| **Überall** | In Instagram/TikTok *Link kopieren*, in der Rezeptbox auf **+ Rezept** → **Einfügen**. |

Falls Instagram einmal keine Details herausgibt (das passiert gelegentlich, weil Instagram Beiträge hinter einem Login versteckt), zeigt die App ein Feld an, in das du die Bildunterschrift einfügen kannst. Daraus wird dann das Rezept erstellt.

## Installation

Die App muss dauerhaft im Internet erreichbar sein, damit ihr von jedem Gerät aus Rezepte schicken könnt, und zwar über **HTTPS** (sonst funktionieren Installation und Teilen nicht). Gespeichert wird alles in einer SQL-Datenbank, auch die Vorschaubilder.

### Kostenlos: Cloudflare (empfohlen, geht komplett vom iPhone aus)

Die App läuft als Cloudflare Worker mit einer D1-Datenbank. Der kostenlose Tarif (100.000 Aufrufe pro Tag, 5 GB Datenbank) reicht für eine private Sammlung bei Weitem, eine Kreditkarte ist nicht nötig.

1. Auf [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) ein kostenloses Konto anlegen.
2. **Workers & Pages → Create → Import a repository**. GitHub verbinden und Cloudflare den Zugriff auf die Organisation bzw. dieses Repository erlauben, dann das Repository auswählen.
3. Als Namen **`rezeptbox`** eintragen (muss zum Namen in `wrangler.jsonc` passen), die übrigen Build-Einstellungen so lassen (Deploy-Befehl `npx wrangler deploy`) und **Deploy** tippen. Beim ersten Deploy wird die Datenbank automatisch angelegt.
4. Im Worker unter **Settings → Variables and Secrets → Add**: Typ **Secret**, Name `APP_PASSWORD`, Wert = euer gemeinsames Passwort. Optional genauso `ANTHROPIC_API_KEY`. Bis das Passwort gesetzt ist, zeigt die App nur einen Hinweis an.
5. Die Adresse steht im Worker unter **Domains** bzw. „Visit“, z. B. `https://rezeptbox.dein-name.workers.dev`.
6. Die Adresse in Safari öffnen, anmelden, über **Teilen → „Zum Home-Bildschirm“** als App ablegen. Danach in der App unter **Einstellungen** den Kurzbefehl einrichten und per iCloud-Link an weitere iPhones schicken.

Jeder neue Stand im Repository wird automatisch neu veröffentlicht; die Rezepte bleiben in der Datenbank erhalten.

Falls der erste Deploy mit einer Fehlermeldung zur D1-Datenbank abbricht: unter **Storage & Databases → D1** eine Datenbank namens `rezeptbox` anlegen und den Deploy wiederholen.

### Alternative: Railway (ca. 5 $ im Monat)

[Railway](https://railway.com) baut die App direkt aus diesem GitHub-Repository und stellt eine HTTPS-Adresse bereit. Der Hobby-Tarif kostet 5 US-$ im Monat, 5 $ Nutzung sind darin enthalten – für eine private Rezeptsammlung reicht das normalerweise (Stand Oktober 2026, aktuelle Preise auf der Railway-Website prüfen).

1. Auf railway.com mit dem GitHub-Konto anmelden und den Hobby-Tarif wählen.
2. **New Project → Deploy from GitHub repo** → dieses Repository auswählen (Railway dabei den Zugriff auf die GitHub-Organisation erlauben). Falls nötig unter *Settings → Source* den Branch mit der Rezeptbox einstellen.
3. Unter **Variables** `APP_PASSWORD` mit eurem gemeinsamen Passwort anlegen, optional `ANTHROPIC_API_KEY`.
4. Ein **Volume** hinzufügen und an den Service hängen, **Mount Path `/data`**. Ohne Volume sind die Rezepte nach dem nächsten Update weg.
5. *Settings → Networking → **Generate Domain*** (falls nach einem Port gefragt wird, den vorgeschlagenen übernehmen). Ergebnis ist eine Adresse wie `https://rezeptbox-production.up.railway.app`.
6. Die Adresse in Safari öffnen, anmelden, über **Teilen → „Zum Home-Bildschirm“** als App ablegen. Danach in der App unter **Einstellungen** den Kurzbefehl einrichten und per iCloud-Link an weitere iPhones schicken.

Neue Versionen im Branch baut Railway automatisch.

### Mit Docker auf eigenem Server oder NAS

```bash
cp .env.example .env        # APP_PASSWORD setzen, optional ANTHROPIC_API_KEY
docker compose up -d --build
```

Die App läuft dann auf Port 3000. Davor gehört ein Reverse-Proxy mit HTTPS, z. B. [Caddy](https://caddyserver.com) – dafür reicht diese `Caddyfile`:

```
rezepte.deine-domain.de {
    reverse_proxy localhost:3000
}
```

Das funktioniert auf einem eigenen Server, einem VPS oder einem NAS mit Docker-Unterstützung (z. B. Synology). Bei anderen Docker-Anbietern gilt wie bei Railway: Ein **persistenter Speicher unter `/data`** ist Pflicht, sonst gehen die Rezepte beim nächsten Neustart verloren.

### Ohne Docker

Voraussetzung ist Node.js 22.13 oder neuer.

```bash
npm ci
cp .env.example .env        # APP_PASSWORD eintragen
npm start                   # http://localhost:3000
```

## Einstellungen

| Variable | Bedeutung |
|---|---|
| `APP_PASSWORD` | Passwort für die Anmeldung. **Pflicht im Betrieb**: Auf Cloudflare zeigt die App ohne Passwort nur einen Hinweis, mit `NODE_ENV=production` (Docker-Image) startet sie nicht. Ändern meldet alle Geräte ab und macht den alten iPhone-Kurzbefehl-Schlüssel ungültig. |
| `ANTHROPIC_API_KEY` | Optional. Schaltet die KI-Analyse ein. Ohne Schlüssel sortiert die App anhand von Stichwörtern und Hashtags. |
| `ANTHROPIC_MODEL` | Optional. Standard ist `claude-opus-5-5`. |
| `PORT` / `HOST` | Standard `3000` / `0.0.0.0`. |
| `DATA_DIR` | Nur Node/Docker: Speicherort der Datenbank. Standard `./data`, im Docker-Image `/data`. |

### KI-Analyse

Mit einem API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) wird jeder neue Link zusätzlich von Claude ausgewertet: Bildunterschrift und Vorschaubild gehen an die API, zurück kommen Titel, Kategorien, Zutaten, Schritte, Zeit und Portionen. Die KI erfindet keine Zutaten: Steht das Rezept nur im Video (gesprochen) und nicht in der Beschreibung, bleibt die Zutatenliste leer.

Die Kosten liegen grob bei einem bis wenigen Cent pro gespeichertem Rezept. Wer sparen will, setzt `ANTHROPIC_MODEL=claude-haiku-5-5`. Lehnt das Modell eine Anfrage einmal ab, springt automatisch ein Ersatzmodell ein („server-side fallback“). Schlägt die KI fehl, greift die Stichwort-Sortierung, und über **Neu analysieren** lässt sich das Rezept später erneut auswerten.

## Daten & Sicherung

- Auf Cloudflare liegt alles in der D1-Datenbank `rezeptbox`, die ihr im Cloudflare-Dashboard unter **Storage & Databases → D1** findet.
- Auf einem eigenen Server liegt alles in `DATA_DIR/rezeptbox.db` (SQLite, inkl. Bilder und Anmelde-Schlüssel). Zum Sichern diese Datei bzw. das Docker-Volume kopieren.
- In der App unter **Einstellungen → Sicherung herunterladen** gibt es alle Rezepte zusätzlich als JSON-Datei.

## Bekannte Grenzen

- Instagram und TikTok bieten keine offizielle Schnittstelle für fremde Beiträge. Die App nutzt die öffentlichen Vorschaudaten (wie bei Link-Vorschauen in Messengern). Ändern die Plattformen das, kann das Auslesen zeitweise ausfallen; der Link bleibt trotzdem gespeichert.
- Rezepte, die nur im Video gesprochen werden, kann die App nicht auslesen. Dafür gibt es die Notizen und **Bearbeiten**.
- Die App ist für eine Person bzw. einen Haushalt gedacht: ein gemeinsames Passwort, eine gemeinsame Sammlung.

## Entwicklung

```bash
npm ci
npm test                 # Unit- und API-Tests (node:test)
npm run dev              # Node-Server mit Auto-Reload
npm run dev:cloudflare   # dieselbe App lokal in der Cloudflare-Laufzeit (wrangler dev)
```

Aufbau – derselbe Code läuft auf Node und auf Cloudflare Workers:

```
server/
  app.js         API als Fetch-Handler (Request → Response), Validierung
  auth.js        Passwort-Login, Sitzungs-Cookie, API-Schlüssel für Kurzbefehle
  store.js       Datenbankzugriff, Treiber für Cloudflare D1
  sqlite.js      Treiber für node:sqlite
  fetcher.js     Links auflösen, Metadaten von TikTok/Instagram/YouTube/Webseiten, Bilder laden
  parse.js       URL-Normalisierung, Meta-Tags, schema.org-Rezepte, Zutaten aus Beschreibungen
  categories.js  Kategorien und Stichwort-Sortierung
  ai.js          Optionale Auswertung mit Claude
  enrich.js      Analyse neuer Links im Hintergrund
  node.js        Node-HTTP-Server mit statischen Dateien
  index.js       Start auf Node/Docker
worker/index.js  Start auf Cloudflare Workers
wrangler.jsonc   Cloudflare-Konfiguration (Worker, statische Dateien, D1)
public/          Web-App (ohne Build-Schritt), Manifest mit Share Target, Service Worker
test/            Tests
```
