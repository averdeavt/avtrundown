# avtrundown

Rundown (run of show) som kjører som en liten server på eget nett. Ingen skytjeneste, ingen kontoer, ingen internett nødvendig.
Én produsent styrer cuene, alle andre åpner siden i nettleseren (PC, Mac, nettbrett, mobil) og følger med.

## Funksjoner
- Tiles med aktiv cue forstørret, nedtelling og fremdriftslinje
- Produsent: Neste / Forrige / Stopp / Hopp hit (piltaster og mellomrom virker også)
- Andre følger live automatisk, kan pause (også automatisk når de skriver notat) og hoppe tilbake til live
- Egne, private notater per cue. Innlogging med navn (ikke passord)
- Redigering for produsent: rader, rekkefølge, starttid. Starttider regnes ut fra varigheter
- Import fra Excel (.xlsx/.xls) og .csv. Kolonner: Element (eller Tittel/Navn), Varighet, Ansvarlig, Status, Notat
- QR-kode og adresse for å koble til fra andre enheter (Produsent → Del / QR)

## Kjøre fra kildekode
Krever Node 18 eller nyere.

```
npm install
npm start
```

Åpne `http://localhost:3000`. Port settes med miljøvariabelen `PORT`. `--no-open` hindrer at nettleseren åpnes automatisk.

## Bygge ferdige programmer (én fil, ingen installasjon)
Krever [Bun](https://bun.sh).

```
npm run build:mac-arm     # Mac med Apple-chip
npm run build:mac-intel   # Mac med Intel
npm run build:win         # Windows
```

Filene havner i `dist/`. Programmene er ikke signert, så Mac og Windows viser en advarsel første gang.
På Mac: `xattr -dr com.apple.quarantine <mappe>` eller høyreklikk → Åpne.

## Data og sikkerhet
- Alt lagres i mappen `rundown-data/` ved siden av programmet: `rundown.json`, `config.json` (produsentkode) og `notes/`.
- Produsent er man automatisk på maskinen serveren kjører på. Andre enheter logger inn med den 4-sifrede koden som vises i serververdinduet.
- Navn-innloggingen skiller bare notater fra hverandre. Hvem som helst på nettet kan skrive inn et annet navn og se de notatene.
- Serveren er laget for et lukket, pålitelig lokalt nett. Ikke eksponer den mot internett.

## Oppbygging
- `server.js`: HTTP-server uten avhengigheter, Server-Sent Events for live-oppdatering, JSON-filer for lagring
- `public/index.html`: hele klienten (HTML, CSS og JS)
- `build-assets.js`: pakker siden og bibliotekene (xlsx, qrcode-generator) inn i `assets.js`, slik at serveren blir én fil
