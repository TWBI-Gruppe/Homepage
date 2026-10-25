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
| **iPhone / iPad** | Einmalig einen Kurzbefehl anlegen, der den geteilten Link an die Rezeptbox schickt. Die Schritt-für-Schritt-Anleitung mit deiner persönlichen Adresse und deinem Schlüssel steht in der App unter **Einstellungen** (Schieberegler-Symbol oben rechts). Danach: Teilen → *Teilen über …* / *Mehr* → **In Rezeptbox speichern**. |
| **Überall** | In Instagram/TikTok *Link kopieren*, in der Rezeptbox auf **+ Rezept** → **Einfügen**. |

Falls Instagram einmal keine Details herausgibt (das passiert gelegentlich, weil Instagram Beiträge hinter einem Login versteckt), zeigt die App ein Feld an, in das du die Bildunterschrift einfügen kannst. Daraus wird dann das Rezept erstellt.

## Installation

Die App braucht einen kleinen Server, der dauerhaft läuft, damit du von jedem Gerät aus Rezepte schicken kannst. Gespeichert wird alles in einer einzigen SQLite-Datei plus einem Bilderordner.

> **Wichtig:** Damit sich die App installieren lässt und das Teilen funktioniert, muss sie über **HTTPS** erreichbar sein (z. B. `https://rezepte.deine-domain.de`).

### Mit Docker (empfohlen)

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

Das funktioniert auf einem eigenen Server, einem VPS oder einem NAS mit Docker-Unterstützung (z. B. Synology). Alternativ lässt sich das Docker-Image bei Anbietern wie Railway, Fly.io oder Render betreiben; dort muss ein **persistenter Speicher (Volume) unter `/data`** eingehängt werden, sonst gehen die Rezepte beim nächsten Neustart verloren.

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
| `APP_PASSWORD` | Passwort für die Anmeldung. **Pflicht im Betrieb** (mit `NODE_ENV=production`, wie im Docker-Image, startet die App ohne Passwort nicht). Ändern meldet alle Geräte ab und macht den alten iPhone-Kurzbefehl-Schlüssel ungültig. |
| `ANTHROPIC_API_KEY` | Optional. Schaltet die KI-Analyse ein. Ohne Schlüssel sortiert die App anhand von Stichwörtern und Hashtags. |
| `ANTHROPIC_MODEL` | Optional. Standard ist `claude-opus-5-5`. |
| `PORT` / `HOST` | Standard `3000` / `0.0.0.0`. |
| `DATA_DIR` | Speicherort für Datenbank und Bilder. Standard `./data`, im Docker-Image `/data`. |

### KI-Analyse

Mit einem API-Schlüssel von [console.anthropic.com](https://console.anthropic.com) wird jeder neue Link zusätzlich von Claude ausgewertet: Bildunterschrift und Vorschaubild gehen an die API, zurück kommen Titel, Kategorien, Zutaten, Schritte, Zeit und Portionen. Die KI erfindet keine Zutaten: Steht das Rezept nur im Video (gesprochen) und nicht in der Beschreibung, bleibt die Zutatenliste leer.

Die Kosten liegen grob bei einem bis wenigen Cent pro gespeichertem Rezept. Wer sparen will, setzt `ANTHROPIC_MODEL=claude-haiku-5-5`. Lehnt das Modell eine Anfrage einmal ab, springt automatisch ein Ersatzmodell ein („server-side fallback“). Schlägt die KI fehl, greift die Stichwort-Sortierung, und über **Neu analysieren** lässt sich das Rezept später erneut auswerten.

## Daten & Sicherung

- Alles liegt in `DATA_DIR`: `rezeptbox.db` (SQLite), der Ordner `images/` und `secret.key` (Schlüssel für Anmeldungen). Zum Sichern diesen Ordner bzw. das Docker-Volume kopieren.
- In der App unter **Einstellungen → Sicherung herunterladen** gibt es alle Rezepte zusätzlich als JSON-Datei.

## Bekannte Grenzen

- Instagram und TikTok bieten keine offizielle Schnittstelle für fremde Beiträge. Die App nutzt die öffentlichen Vorschaudaten (wie bei Link-Vorschauen in Messengern). Ändern die Plattformen das, kann das Auslesen zeitweise ausfallen; der Link bleibt trotzdem gespeichert.
- Rezepte, die nur im Video gesprochen werden, kann die App nicht auslesen. Dafür gibt es die Notizen und **Bearbeiten**.
- Die App ist für eine Person bzw. einen Haushalt gedacht: ein gemeinsames Passwort, eine gemeinsame Sammlung.

## Entwicklung

```bash
npm ci
npm test        # Unit- und API-Tests (node:test)
npm run dev     # Server mit Auto-Reload
```

Aufbau:

```
server/
  index.js       Start, Konfiguration
  app.js         HTTP-Routen, Validierung, statische Dateien
  auth.js        Passwort-Login, Sitzungs-Cookie, API-Schlüssel für Kurzbefehle
  db.js          SQLite (node:sqlite)
  fetcher.js     Links auflösen, Metadaten von TikTok/Instagram/YouTube/Webseiten, Bilder laden
  parse.js       URL-Normalisierung, Meta-Tags, schema.org-Rezepte, Zutaten aus Beschreibungen
  categories.js  Kategorien und Stichwort-Sortierung
  ai.js          Optionale Auswertung mit Claude
  enrich.js      Hintergrund-Warteschlange, die neue Links analysiert
public/          Web-App (ohne Build-Schritt), Manifest mit Share Target, Service Worker
test/            Tests
```
