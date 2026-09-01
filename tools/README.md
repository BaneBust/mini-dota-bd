# Import danych z mapy

Aktualizuje `data/*.json` prosto z pliku mapy `.w3x`, bez World Editora
i bez MPQ Editora.

```bash
python tools/import_map.py              # znajduje najnowszą mapę, zapisuje + raport
python tools/import_map.py --dry-run    # tylko raport, nic nie dotyka
python tools/import_map.py --map "C:/.../mapa.w3x"
```

Po przejrzeniu zmian odpal `update.bat`.

## Kontrola po imporcie

```bash
python tools/check_map.py --map "C:/.../mapa.w3x"
```

Porownuje `data/heroes.json` z mapa pole po polu i nic nie zapisuje. Od 1.3.9a
sprawdza takze poziomy, ktorych mapa **nie** nadpisuje -- ich wartosc bierze z
`GameDataFiles/units/abilitydata.slk` przez `tools/slk.py`. To wlasnie tam
chowaja sie bledy: Blink mial na stronie 2.6 sekundy na trzech pierwszych
poziomach, a gra daje 10 i 5, bo mapa nadpisuje dopiero poziom 3. Sciezke do
plikow gry mozna podac przez `WC3_GAME_DATA`; bez nich skrypt takie poziomy
pomija i mowi o tym na wejsciu.

## Skąd się bierze najnowsza mapa

Skrypt przeszukuje `~/Downloads` i `Warcraft III/Maps/**` wzorcem `*ini*Dota*.w3x`
i bierze plik z najnowszą datą modyfikacji. Ścieżki są na górze `import_map.py`
w `MAP_GLOBS`.

## Skąd się biorą dane

Object data w Reforged jest **rozbite na dwa komplety plików** i to jest
najważniejsza rzecz do zapamiętania przy grzebaniu w tej mapie:

| Plik | Co trzyma |
|---|---|
| `war3map.w3t` / `.w3u` / `.w3a` | wartości gameplayowe: ceny, HP, mana, cooldown, obrażenia |
| `war3mapSkin.w3t` / `.w3u` / `.w3a` | warstwa prezentacji: **nazwy (`unam`), tooltipy (`utub`), ikony (`iico`)** |

Czytanie samego `war3map.w3t` sprawia, że mapa wygląda jakby w ogóle nie miała
tekstu — `utub` ma tam zero wystąpień. Cały tekst siedzi w `war3mapSkin.w3t`
(208× `utub`, 144 nazwy). Importer czyta oba i nakłada skin na gameplay.

Tooltipy zawierają placeholdery `<AbilCode,DataA1>`, `<AbilCode,Cool1>` itd.,
które gra podstawia w runtime — `tooltips.py` rozwija je z danych `w3a`.

Poza mapą zostają tylko rzeczy dopisane na stronie: `icon`/`icon_index`
(spritesheety ze screenshotów), `category` i `notes`.

## Dopasowywanie umiejętności

Źródłem prawdy jest **hero selector z `war3map.j`**:

```jass
call SaveStr(HeroSelector_Hash, 0, 'Nalc', "ANhs,ANcr,ANab,ANtm")
```

To kolejność wyświetlania w grze i pokrywa się z kolejnością na stronie dla
wszystkich 24 bohaterów. Pole `uhab` w `war3map.w3u` trzyma kolejność
wewnętrzną, która rozjeżdża się mniej więcej u jednej trzeciej bohaterów
(Blademaster, Archmage, Mountain King, Far Seer…) — używane tylko awaryjnie,
gdy bohatera nie ma w selektorze, i wtedy pary powstają po nazwie, nie po
pozycji.

`ABILITY_NAMES` w `wc3_codes.py` służy jako kontrola krzyżowa: jeśli selector
i tabela nazw się nie zgadzają, importer to zgłasza. Ten mechanizm wyłapał
cztery zamienione kody (`AUdp`/`AUau`, `AUcs`/`AUav`) — warto go pilnować.

## Co trzeba uzupełnić raz

**`tools/ability_fields.json`** — pola Data A–F są specyficzne dla każdej
umiejętności, więc `Hhb1` samo z siebie nie mówi, że to „heal". Skrypt wiąże je
automatycznie, gdy umiejętność ma dokładnie jedno pole liczbowe i jedno wolne
miejsce w JSON-ie. Resztę wypisuje jako `nieprzypisane pole ... (kandydaci: ...)`
— wpisz ręcznie w formacie `"AHhb.Hhb1": "heal"` i przy kolejnym przebiegu
polecą automatem.

**`raw_code` w `data/*.json`** — 4-znakowy kod obiektu z mapy, np.
`"raw_code": "shhn"`. To jednoznaczny identyfikator i jedyne, po czym importer
wie, który wpis aktualizować. Bohaterowie mają komplet (24/24). Itemy dostają go
automatycznie na dwa sposoby:

1. **po nazwie** — gdy mapa item przemianowuje, więc ma `unam` w pliku skin;
   gdy nazwa pasuje do dwóch obiektów, wygrywa ten częściej referencowany
   w `war3map.j`/`.wct` (klony bywają nieużywanymi pozostałościami),
2. **heurystycznie** — gdy item zachowuje nazwę stockową, więc `unam` nie ma.
   Wymagana jest zgodna cena **i** mnemonika kodu (`ocor` → Orb of Corruption).
   Takie wpisy są w raporcie oznaczone `raw_code (heurystyka)` — warto rzucić
   okiem.

Reszcie trzeba wpisać `raw_code` ręcznie. Podejrzyj kandydatów przez
`python tools/tooltips.py`.
