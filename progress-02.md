# Progress 02 – Návrh klíčových částí webu CineLumen

**Výstup:** interaktivní mid-fidelity prototyp („vibe-kódovaný“ základ webu) v čistém HTML, CSS a JavaScriptu.
**Spuštění:** otevřít `index.html` v prohlížeči. Nic se neinstaluje, funguje i offline (bez internetu jen se záložním písmem) ,nebo zde je link https://manolachelucian.github.io/cinelumen-prototyp-02/.
**Zdroje:** Projektová specifikace (výstup 01) a data `cinelumen_festival_data.json` (60 programových bloků, 60 hostů, 4 sály). Data jsou do prototypu vložena jako `js/data.js`, aby šel web otevřít přímo ze souboru.

## Struktura prototypu

| Část webu (dle sitemapy) | Adresa v prototypu |
| --- | --- |
| Úvodní stránka | `#/` |
| Program (seznam + časová osa sálů) | `#/program` |
| Katalog filmů → Detail filmu | `#/filmy` → `#/udalost/[id]` |
| Hosté → Profil hosta | `#/hoste` → `#/host/[id]` |
| Kina & mapa → Profil sálu | `#/kina` → `#/kino/[id]` |
| Vstupenky & akreditace | `#/vstupenky`, nákup `#/nakup/[id]`, potvrzení `#/potvrzeni/[id]` |
| Můj diář | `#/diar` |
| Praktické info & FAQ | `#/info` |
| Výsledky vyhledávání | `#/hledat?q=…` |

**Navigace a hierarchie**
- Mobile-first: horní lišta (logo, hledání, diář s počtem položek, přepínač tmavého režimu) a spodní fixní lišta *Domů | Program | Filmy | Můj diář | Více* přesně podle specifikace.
- Desktop (od 900 px): hlavní menu v hlavičce, CTA „Koupit vstupenku“, přihlášení CinePass, přepínač CZ/EN, pole hledání. Program má filtry v levém sloupci, detail filmu má rezervační panel vpravo, který zůstává viditelný při scrollu.
- Drobečková navigace na všech podstránkách (např. *Domů › Filmy › Ztraceni v čase › Nákup vstupenek*).
- Globální vyhledávání napříč programem, hosty a sály (bez ohledu na diakritiku).
- Výchozí tmavý režim (vhodný do potemnělých sálů, požadavek cílové skupiny 1), světlý režim podle systému nebo přepínačem.
- Propojení částí podle specifikace: detail filmu → sál → mapa; detail filmu → profil hosta → jeho další akce; detail filmu → další termíny téhož titulu.

## Navržené interaktivní funkce

| # | Funkce | Uživatelská potřeba / cílová skupina |
| --- | --- | --- |
| 1 | **Filtr programu** podle dne, sálu, typu programu (projekce / masterclass / debata / industry), přepínač „Pouze s debatou tvůrců (Q&A)“, „Skrýt vyprodané“ a fulltext. Přepínání *Seznam / Časová osa sálů*. Stav filtru je v URL, takže jde sdílet. | Cinefil chce rychle najít projekce s Q&A na konkrétní večer (scénář 1). Industry host filtruje odborný program. Časová osa ukazuje souběhy v sálech. |
| 2 | **Můj diář s detekcí kolizí**: uložení libovolného bloku jedním klepnutím, kontrola časového překryvu a pěšího přesunu mezi sály (tabulka vzdáleností). Při kolizi nabídne jiný termín téhož filmu a přesun jedním klikem, ukáže trasu na mapě. | Náročný divák s 4–5 filmy denně nechce počítat minuty ručně (scénář 3 ze specifikace, požadavek „kolizní filtr“). |
| 3 | **Rezervace na CinePass** (přihlášení číslem akreditace, rezervace za 0 Kč, QR kód v diáři, upozornění na potvrzení 10 min před začátkem) a **nákup jednotlivých vstupenek bez registrace** (počet ks, e-mail, platba, potvrzení s QR a mapou). | Hlavní konverzní cíl webu. Držitel pasu chce místo jistit z mobilu (scénář 1). Víkendový návštěvník nechce registraci (scénář 2). |
| 4 | **Kapacitní semafor** (Volno / Dochází / Vyprodáno + ukazatel obsazenosti), který se mění po rezervaci nebo nákupu. | Divák potřebuje okamžitě vědět, zda má smysl do sálu jít (cíl „aktuálnost během konání“). |
| 5 | **Vyhledávání hostů** podle jména, role a země, filtr profese a země, řazení A–Z / Z–A / podle počtu vystoupení, zvýraznění shody. | Fanoušek konkrétního tvůrce chce zjistit, kdy a kde ho potká na Q&A. |
| 6 | **Katalog filmů s řazením** (nejbližší termín, abecedně, nejvíc volných míst, stopáž) a filtry „S Q&A“ / „Pod širým nebem“. | Běžný divák vybírá 1–2 filmy a chce rychle porovnat termíny. |

Funkce 1–3 jsou hlavní (požadované minimum), 4–6 jsou doplňkové. Menu, banner ani mapa se jako funkce nepočítají.

## Klíčové scénáře průchodu

**Scénář 1 – Výběr filmu s debatou a rezervace na CinePass (mobil)**
Spodní lišta *Program* → den *Pá 16. 10.* → *Další filtry* → zaškrtnout *Pouze s debatou tvůrců (Q&A)* → *Ztraceni v čase* (20:45, Velký sál Alfa) → *Rezervovat na CinePass · 0 Kč* → přihlášení (tlačítko *Vyplnit ukázkové údaje*) → potvrzení s QR kódem a upozorněním „Potvrďte příchodem do 20:35“ → *Otevřít Můj diář*.

**Scénář 2 – Nákup 2 lístků do letního kina bez registrace**
Úvodní stránka → banner *Speciální projekce pod hvězdami* (otevře program Open-Air na sobotu) → *Klasický český noir pod hradbami* (So 18:30) → *Koupit jednotlivé lístky* → počet 2 → e-mail + Apple Pay / karta → souhrn → *Zaplatit* → potvrzovací stránka se 2 vstupenkami (QR, „Stáhnout PDF“) a mapou cesty na místo.

**Doplňkově scénář 3 – Kolize v diáři:** *Můj diář* → *Načíst ukázkový diář* → diář sám hlásí „Přesun Sál Beta → Sál Alfa: máte jen 15 min, běžná pěší vzdálenost je 18 min“. Pak detail *Monzunové echo* (Pá 13:00) → *Uložit do Mého diáře* → dialog s kolizí a nabídkou sobotní reprízy jedním klikem.

## Co bylo ověřováno a jak

| Co | Jak | Výsledek / úprava |
| --- | --- | --- |
| Průchodnost scénářů 1 a 2 | Automatizovaný průchod v prohlížeči Chromium (Playwright) na mobilu 390 × 844 a desktopu 1280 × 860: klikání přesně podle kroků scénáře, kontrola chyb v konzoli. | Oba scénáře projdou bez chyb. |
| Responzivita | Kontrola, že žádná stránka na šířce 390 px nescrolluje do strany. Screenshoty všech hlavních stránek. | Na mobilu se v hlavičce zobrazovala desktopová tlačítka a pole hledání → opraveno. Na desktopu 1280 px se hlavička nevešla → CZ/EN a pole hledání se schovají pod ikonu lupy do 1400 px. |
| Hierarchie na mobilu | Kontrola první obrazovky programu. | Filtry zabíraly celou obrazovku a výsledky nebyly vidět → den zůstává vždy viditelný, ostatní filtry jsou ve sbalitelné sekci s počtem aktivních filtrů. |
| Validace formulářů | Odeslání prázdného e-mailu, chybné číslo CinePassu. | Chybová hláška říká, co je špatně a jak to opravit. |
| Tmavý a světlý režim | Screenshoty s `prefers-color-scheme: dark / light`. | Čitelné v obou režimech. |
| Kolize v diáři | Ruční test kombinací (překryv, nedostatečný přesun, alternativní termín). | Hlášky a nabídka reprízy fungují. |

**Plánované ověření s uživateli (do další konzultace):** rychlý test se 3–5 spolužáky, úkoly = scénáře 1 a 2, metoda think-aloud, měříme dokončení úkolu, počet kliknutí a místa zaváhání.

## Odchylky a známá omezení

- **Data vs. specifikace:** specifikace uvádí Litoměřice, 16.–20. 9. 2027 a sály *Kino Máj*, *Hrad*. Dodaná data (`cinelumen_festival_data.json`) popisují Kutnou Horu, 15.–17. 10. 2026 a sály Alfa, Beta, Open-Air, Studio. Prototyp používá **data**. Scénáře jsou proto převedeny na odpovídající tituly z dat (místo *Půlnoční ticho* je to *Ztraceni v čase*, místo *Světlo v mlze* je to *Klasický český noir pod hradbami*). Doporučujeme sjednotit ve specifikaci (změna v rámci povolených ~15 %).
- Data neobsahují jazyk, titulky, zemi filmu ani příznak Q&A. Typ programu a Q&A jsou v prototypu **odvozené** (Q&A = projekce, které se účastní režisér/ka nebo herec/herečka), jazyk je zatím obecný text.
- Obsazenost sálů, pěší vzdálenosti, ceny, přihlášení, platba, QR kódy, PDF a Wallet jsou **simulované**. Diář a rezervace se ukládají jen do prohlížeče (localStorage).
- Anglická verze, press centrum a trailer jsou jen naznačené. „Dnes“ na úvodní stránce je pevně nastaveno na pátek 16. 10. 15:30 kvůli scénáři 1.

## Použití AI a ověření výstupů AI

- **Co AI dělala:** Claude (Anthropic) navrhl strukturu prototypu podle sitemapy ze specifikace, napsal HTML/CSS/JS, převedl JSON na `data.js`, odvodil typ programu a Q&A, navrhl texty rozhraní a připravil kostru tohoto dokumentu.
- **Co jsme ověřili:**
  - Každý scénář byl reálně proklikán v prohlížeči (mobil i desktop), konzole bez chyb.
  - Kontrola, že všechny tituly, časy, sály a hosté v UI odpovídají `data.json` (data se nepřepisují, jen zobrazují).
  - AI při kontrole sama našla nesoulad specifikace a dat (místo, datum, sály). Ponechali jsme data a nesoulad je zdokumentován výše.
  - Výpočty kolizí (přes půlnoc, např. 23:30–01:00) jsme zkontrolovali ručně na několika dvojicích.
  - Opravy po kontrole: hlavička na mobilu, přetékání hlavičky na desktopu, sbalitelné filtry, gramatika hlášky o přesunu.
- **Co zůstává na autorovi:** obsahová správnost textů FAQ a cen (smyšlené), výběr finální vizuální identity, test s uživateli.
