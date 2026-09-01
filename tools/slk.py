"""Czytnik plikow .slk z danymi bazowej gry.

Mapa trzyma tylko nadpisania, wiec poziom, ktorego nie rusza, ma wartosc z
Warcrafta. Te wartosci leza na dysku w `GameDataFiles/units/*.slk` i to jest
jedyne miejsce, po ktorym da sie odtworzyc np. cooldown Blinka na poziomie 1.

    import slk
    tab = slk.read(os.path.join(slk.game_data(), 'units', 'abilitydata.slk'))
    tab['aebl']['Cool1']        # 10
"""
import io
import os

# Rozpakowane pliki gry. Kolejnosc ma znaczenie -- pierwszy istniejacy wygrywa.
CANDIDATES = [
    os.environ.get('WC3_GAME_DATA', ''),
    os.path.expanduser('~/OneDrive/Pulpit/v1.3.0.4/GameDataFiles'),
    os.path.expanduser('~/Pulpit/v1.3.0.4/GameDataFiles'),
    os.path.expanduser('~/Desktop/v1.3.0.4/GameDataFiles'),
]


def game_data():
    """Katalog GameDataFiles albo None, gdy go nie ma na dysku."""
    for path in CANDIDATES:
        if path and os.path.isdir(path):
            return path
    return None


def read(path):
    """{wartosc pierwszej kolumny (male litery): {nazwa kolumny: wartosc}}."""
    rows, cols, x, y = {}, {}, 1, 1
    for line in io.open(path, encoding='latin-1'):
        if not line.startswith('C;'):
            continue
        val = None
        for part in line.rstrip('\n').split(';')[1:]:
            if part.startswith('X'):
                x = int(part[1:])
            elif part.startswith('Y'):
                y = int(part[1:])
            elif part.startswith('K'):
                raw = part[1:]
                if raw.startswith('"'):
                    val = raw.strip('"')
                else:
                    try:
                        val = float(raw) if '.' in raw else int(raw)
                    except ValueError:
                        val = raw
        if val is None:
            continue
        if y == 1:
            cols[x] = val
        else:
            rows.setdefault(y, {})[x] = val
    out = {}
    first = min(cols) if cols else None
    for row in rows.values():
        key = row.get(first)
        if key is None:
            continue
        out[str(key).lower()] = {cols[i]: v for i, v in row.items() if i in cols}
    return out


def level(table, obj_id, column, lvl):
    """Wartosc `column` na poziomie `lvl`, z regula gry: brakujacy poziom
    dziedziczy ostatni zdefiniowany (stock ma zwykle 4 poziomy, mapa 6)."""
    row = table.get(str(obj_id).lower(), {})
    best = None
    for i in range(1, lvl + 1):
        v = row.get('%s%d' % (column, i))
        if v not in (None, '-', ''):
            best = v
    return best
