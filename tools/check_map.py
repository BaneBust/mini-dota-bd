"""Porownuje data/heroes.json z polami mapy i wypisuje rozbieznosci.

Nie zapisuje niczego. Sprawdza tylko te pola, ktore mapa trzyma wprost i ktore
maja jednoznaczny odpowiednik w naszych danych:

    aare -> area        acdn -> cooldown     amcs -> mana      aran -> range
    adur -> stun_units / duration_units
    ahdu -> stun_heroes / duration_heroes

Poziom, ktorego mapa nie nadpisuje, ma wartosc bazowej gry -- ta lezy w
GameDataFiles/units/abilitydata.slk i tez jest sprawdzana, bo wlasnie tam
chowaja sie bledy: Blink mial na stronie 2.6 na kazdym z pierwszych trzech
poziomow, a gra daje 10 i 5, bo mapa nadpisuje dopiero poziom 3. Gdy plikow
gry nie ma na dysku, te poziomy sa pomijane jak wczesniej.

    python tools/check_map.py
    python tools/check_map.py --map "C:/.../mapa.w3x"
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_map as im
import slk

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# map field -> the keys it may appear under, in order of preference
# pole mapy -> (klucze, pod ktorymi moze wystapic; kolumna w abilitydata.slk)
FIELDS = [
    ('aare', ['area', 'aoe'], 'Area'),
    ('acdn', ['cooldown'], 'Cool'),
    ('amcs', ['mana'], 'Cost'),
    ('aran', ['range'], 'Rng'),
    ('adur', ['stun_units', 'duration_units', 'duration'], 'Dur'),
    ('ahdu', ['stun_heroes', 'duration_heroes', 'duration'], 'HeroDur'),
]

TOLERANCE = 0.011      # the map stores floats as 1.7999999523162842


def close(a, b):
    try:
        return abs(float(a) - float(b)) <= TOLERANCE
    except (TypeError, ValueError):
        return a == b


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map', dest='map_path')
    args = ap.parse_args()

    m = im.load(args.map_path or im.find_map())
    doc = json.load(open(os.path.join(ROOT, 'data', 'heroes.json'), encoding='utf-8'))

    root = slk.game_data()
    stock = slk.read(os.path.join(root, 'units', 'abilitydata.slk')) if root else {}
    if not stock:
        print('brak GameDataFiles -- poziomy bez nadpisania beda pominiete')
    base_of = {e['id']: e['base'] for e in m['raw']['w3a']['custom']}

    problems = 0
    unpaired = []
    for hero in doc['heroes']:
        code = hero.get('raw_code')
        codes = m['selector'].get(code) or im.hero_ability_codes(m['units'], code)
        abils = hero.get('abilities', [])
        if not codes or len(codes) != len(abils):
            unpaired.append('%s: mapa ma %d spelli, plik %d'
                            % (hero['name'], len(codes or []), len(abils)))
            continue
        for acode, ab in zip(codes, abils):
            fields = m['abils'].get(acode) or {}
            for field, keys, column in FIELDS:
                per_level = fields.get(field) or {}
                base = base_of.get(acode, acode)
                key = next((k for k in keys
                            if any(k in lv for lv in ab.get('levels', []))), None)
                # Wartosc, ktora spell podaje raz, stoi obok tabeli poziomow
                # (`"mana": 10` na samej umiejetnosci) i tez sie liczy.
                flat = None if key else next((k for k in keys if k in ab), None)
                if key is None and flat is None:
                    if not per_level:
                        continue
                    # Jedna kolumna "duration" wystarcza, gdy mapa trzyma te
                    # sama liczbe dla jednostek i bohaterow -- porownanie
                    # zrobil juz ahdu.
                    twin = fields.get('ahdu' if field == 'adur' else 'adur') or {}
                    has_plain = ('duration' in ab
                                 or any('duration' in lv for lv in ab.get('levels', [])))
                    if has_plain and twin == per_level:
                        continue
                    vals = sorted(per_level.items())
                    problems += 1
                    print('%-22s %-20s %s: brak kolumny %s (mapa: %s)'
                          % (hero['name'], ab['name'], field, ' / '.join(keys),
                             ', '.join('L%d=%g' % (l, v) for l, v in vals)))
                    continue
                for lv in ab.get('levels', []):
                    got = lv.get(key) if key else ab.get(flat)
                    if got is None:
                        continue
                    want, src = per_level.get(lv['rank']), 'mapa'
                    if want is None:
                        # Goly `duration` to kolumna bohaterow; poza tym, co
                        # mapa mowi wprost, pod ta nazwa moze siedziec co
                        # innego (czas zycia wulkanu, czas Dooma), wiec
                        # wartosci bazowej gry tu nie porownujemy.
                        if (key or flat) == 'duration':
                            continue
                        want, src = slk.level(stock, base, column, lv['rank']), 'gra'
                    if want is None or want == '-':
                        continue
                    if not close(got, want):
                        problems += 1
                        print('%-22s %-20s L%d %s: plik %s, %s %s'
                              % (hero['name'], ab['name'], lv['rank'],
                                 key or flat, got, src, want))

    if unpaired:
        print('\nNiesparowane (sprawdz recznie):')
        for u in unpaired:
            print('  ' + u)
    print('\nRozbieznosci: %d' % problems)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
