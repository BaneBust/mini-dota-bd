"""Build data/campaign_items.json and its icons from the installed game.

The Rebirth campaign (patch 3.0) added 365 items to the base game. None of them
sit in the map, so the importer cannot see them: they live in the game's own
data files -- units/itemdata.slk for numbers, units/itemstrings.txt for text,
units/abilitydata.slk for the numbers the tooltip placeholders point at. This
reads all of that straight out of the CASC storage of the installed game (no
CascView, no extraction step) and writes the same shape data/items.json uses.

    python tools/campaign_items.py            # report only
    python tools/campaign_items.py --write    # write data + icons/campaign-*.png

The campaign items are the ones itemdata.slk marks `version=2`; the older
`version` 0/1 rows are the classic and Frozen Throne stock.
"""
import argparse
import collections
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from casc import Casc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JSON = os.path.join(ROOT, 'data', 'campaign_items.json')
OUT_ICONS = os.path.join(ROOT, 'icons')

COLOR = re.compile(r'\|c[0-9a-fA-F]{8}|\|r')
PLACEHOLDER = re.compile(r'<([A-Za-z0-9]{4}),([A-Za-z]+)(\d+)?(?:,([%.!]))?>')

# The first line of every tooltip names the item's kind; the site's category is
# the slot, and the rarity becomes a tag.
RARITIES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']
SLOTS = {
    'Primary Weapon': 'Primary Weapon', 'Secondary Weapon': 'Secondary Weapon',
    'Helm': 'Helm', 'Armor': 'Armor', 'Gloves': 'Gloves', 'Boots': 'Boots',
    'Accessory': 'Accessory', 'Trinket': 'Trinket',
}
# Equipment-slot fallback for tooltips whose first line is not "<Rarity> <Slot>".
SLOT_BY_EQUIP = {
    'Primary': 'Primary Weapon', 'Offhand': 'Secondary Weapon', 'Head': 'Helm',
    'Chest': 'Armor', 'Gloves': 'Gloves', 'Boots': 'Boots', 'Ring': 'Accessory',
    'Trinket': 'Trinket',
}
# Name colours the game paints rarity in.
RARITY_BY_COLOR = {
    'aeaeae': 'Common', '40da00': 'Uncommon', '6295e3': 'Rare',
    '7c2abb': 'Epic', 'f28302': 'Legendary',
}
CATEGORY_ORDER = ['Primary Weapon', 'Secondary Weapon', 'Helm', 'Armor', 'Gloves',
                  'Boots', 'Accessory', 'Trinket', 'Consumable', 'Quest Item',
                  'Miscellaneous']

# Stat lines are "+N Name". Names the site already has a key for keep that key so
# the STATS grid labels them the way the shop items are labelled; anything else
# is slugged and the label is rebuilt from the words.
STAT_KEYS = {
    'strength': 'str', 'agility': 'agi', 'intelligence': 'int',
    'hit points': 'hp', 'mana': 'mana', 'damage': 'bonus_dmg', 'armor': 'armor',
    'movement speed': 'move_speed', 'attack speed': 'attack_speed_pct',
    'evasion': 'evasion_pct', 'lifesteal': 'life_steal_pct',
    'hit point regeneration': 'hp_regen', 'health regeneration': 'hp_regen',
    'hit points regeneration': 'hp_regen',
    'mana regeneration': 'mana_regen', 'magic resistance': 'spell_dmg_reduction_pct',
    # the game says attack rate, the site says attack speed -- same key the shop uses
    'attack rate': 'attack_speed_pct',
    'all stats': 'all_stats',
}


def slug(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def plain(s):
    return COLOR.sub('', s or '').replace('|n', '\n').replace('\r', '')


def unquote(s):
    return s[1:-1] if s and len(s) >= 2 and s[0] == '"' and s[-1] == '"' else s


class Game:
    def __init__(self):
        self.c = Casc()
        self.fl = self.c.list_files()

    def read(self, name):
        for pre in ('war3.w3mod:_locales/enus.w3mod:', 'war3.w3mod:'):
            if pre + name in self.fl:
                return self.c.read(pre + name, self.fl).decode('utf8', 'replace')
        raise KeyError(name)

    def slk(self, name, key):
        cells, y = {}, 0
        for line in self.read(name).splitlines():
            if not line.startswith('C;'):
                continue
            x = k = None
            for p in line.split(';')[1:]:
                if p.startswith('X'):
                    x = int(p[1:])
                elif p.startswith('Y'):
                    y = int(p[1:])
                elif p.startswith('K'):
                    k = p[1:].strip('"')
            if x is not None and k is not None:
                cells[(y, x)] = k
        head = {x: v for (yy, x), v in cells.items() if yy == 1}
        rows = {}
        for (yy, x), v in cells.items():
            if yy > 1:
                rows.setdefault(yy, {})[head.get(x, x)] = v
        return {r.get(key): r for r in rows.values() if r.get(key)}

    def ini(self, name):
        out, cur = {}, None
        for l in self.read(name).splitlines():
            l = l.rstrip('\r')
            if l.startswith('[') and l.endswith(']'):
                cur = l[1:-1]
                out.setdefault(cur, {})
            elif cur and '=' in l and not l.startswith('//'):
                k, v = l.split('=', 1)
                out[cur][k.strip()] = v.strip()
        return out

    def icon(self, art):
        """Decoded RGBA image for an art path, whatever extension it really has."""
        stem = art.replace('\\', '/').rsplit('/', 1)[-1].rsplit('.', 1)[0].lower()
        for ext in ('.dds', '.blp', '.tga'):
            key = 'war3.w3mod:replaceabletextures/commandbuttons/' + stem + ext
            if key in self.fl:
                return Image.open(io.BytesIO(self.c.read(key, self.fl))).convert('RGBA')
        return None


def fill(text, abils):
    """Replace <Code,DataA1,%> placeholders with the numbers from abilitydata.slk."""
    def sub(m):
        code, field, lvl, fmt = m.groups()
        row = abils.get(code)
        if not row:
            return m.group(0)
        key = field + (lvl or '1')
        val = row.get(key)
        if val in (None, '', '-', '_'):
            return m.group(0)
        try:
            num = float(val)
        except ValueError:
            return str(val)
        if fmt == '%' and abs(num) <= 1:
            num *= 100
        return str(round(num)) if abs(num - round(num)) < 1e-4 else str(round(num, 2))
    return PLACEHOLDER.sub(sub, text)


def parse_stats(lines):
    """{key: value} from the "+N Name" lines, and the lines that were not one."""
    stats, rest = {}, []
    for l in lines:
        m = re.match(r'^\+(-?[\d.]+)(%?)\s+(.+?)\s*$', l)
        if not m:
            rest.append(l)
            continue
        num, pct, name = m.groups()
        val = float(num)
        val = int(val) if val == int(val) else val
        key = STAT_KEYS.get(name.lower())
        if key is None:
            key = re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')
            if pct:
                key += '_pct'
        elif pct and not key.endswith('_pct'):
            key += '_pct'
        stats[key] = val
    return stats, rest


def build(game):
    itemdata = game.slk('units/itemdata.slk', 'itemID')
    abils = game.slk('units/abilitydata.slk', 'alias')
    strings = game.ini('units/itemstrings.txt')
    func = game.ini('units/itemfunc.txt')
    skin = game.ini('units/itemskin.txt')
    abilstr = game.ini('units/itemabilitystrings.txt')

    out, unresolved = [], collections.Counter()
    for code, row in sorted(itemdata.items()):
        if row.get('version') != '2':
            continue
        s = strings.get(code, {})
        raw_name = unquote(s.get('Name', ''))
        name = plain(raw_name).strip()
        m = re.match(r'\|c..([0-9a-fA-F]{6})', raw_name)
        rarity = RARITY_BY_COLOR.get(m.group(1).lower()) if m else None

        # Two copies of the tooltip: one with the game's |cAARRGGBB colour codes
        # kept, for the page to paint, and a plain one every decision below is
        # made on. The codes hold no newlines, so both split into the same
        # paragraphs and the plain text's indices carry over.
        filled = fill(unquote(s.get('Ubertip', '')), abils).replace('|n', '\n').replace('\r', '')
        tip = COLOR.sub('', filled)
        for ph in PLACEHOLDER.findall(unquote(s.get('Ubertip', ''))):
            if PLACEHOLDER.search(fill('<%s,%s%s%s>' % (ph[0], ph[1], ph[2], ',' + ph[3] if ph[3] else ''), abils)):
                unresolved[ph[0]] += 1
        paras_col = [p.strip() for p in re.split(r'\n\s*\n', filled) if COLOR.sub('', p).strip()]
        paras = [COLOR.sub('', p).strip() for p in paras_col]
        assert len(paras) == len(paras_col)
        label = paras[0].split('\n')[0].strip() if paras else ''

        # category + rarity from the label line, slot/class as the fallback
        cat = None
        lm = re.match(r'^(Common|Uncommon|Rare|Epic|Legendary)\s+(.+)$', label)
        if lm and lm.group(2) in SLOTS:
            cat = SLOTS[lm.group(2)]
            rarity = rarity or lm.group(1)
        elif label in SLOTS:
            cat = SLOTS[label]
        elif label.startswith('Quest Item'):
            cat = 'Quest Item'
        elif label.startswith('Consumable') or row.get('perishable') == '1' or re.match(r'^(Heals|Restores)\b', label):
            cat = 'Consumable'
        elif 'Legendary' in label and 'Accessory' in label:
            cat, rarity = 'Accessory', rarity or 'Legendary'
        elif row.get('equipment') in SLOT_BY_EQUIP:
            cat = SLOT_BY_EQUIP[row['equipment']]
        else:
            cat = 'Miscellaneous'

        # the label paragraph is the site's own tags; what follows is the item.
        # A tooltip that opens on a sentence ("Click to open your backpack...")
        # has no label at all, and that sentence is the description.
        labelled = bool(paras) and (lm or label in SLOTS or label.startswith(('Quest Item', 'Consumable'))
                                    or ('Legendary' in label and 'Accessory' in label))
        body = paras[1:] if labelled else paras
        body_col = paras_col[1:] if labelled else paras_col
        label_col = paras_col[0].split('\n')[0].strip() if labelled else ''
        if not labelled:
            label = ''
        notes = notes_col = ''
        if len(body) >= 2 and not re.match(r'^(\+|Equip:|Use:)', body[-1]):
            notes, notes_col = body[-1], body_col[-1]
            body, body_col = body[:-1], body_col[:-1]
        elif len(body) == 1 and cat == 'Quest Item':
            notes, notes_col, body, body_col = body[0], body_col[0], [], []
        lines = [l.strip() for p in body for l in p.split('\n') if l.strip()]
        stats, rest = parse_stats(lines)

        grants = any('Grants an additional ability' in p for p in paras[:1])
        effect_type = []
        if stats:
            effect_type.append('passive')
        if any(l.startswith('Equip:') for l in rest):
            effect_type.append('passive')
        if grants or any(l.startswith('Use:') for l in rest) or cat == 'Consumable':
            effect_type.append('active')
        effect_type = '+'.join(dict.fromkeys(effect_type)) or ('passive' if cat != 'Quest Item' else 'passive')

        desc_lines = [label] if label else []
        stat_lines = ['+%s%s %s' % (v, '%' if k.endswith('_pct') else '', statname(k)) for k, v in stats.items()]
        desc = '\n'.join(desc_lines + stat_lines + rest).strip()
        # The coloured copy keeps the game's own lines: they are the same stat
        # and effect lines, only painted, and the label line is painted too.
        desc_col = '\n'.join(([label_col] if label_col else [])
                             + [l.strip() for p in body_col for l in p.split('\n') if COLOR.sub('', l).strip()]).strip()

        tags = []
        if rarity:
            tags.append(rarity)
        src = row.get('tag') or ''
        if src in ('Boss Drop', 'Shop', 'World', 'Quest Reward', 'Secret'):
            tags.append(src)

        out.append({
            'id': 'campaign_' + slug(name) if slug(name) else 'campaign_' + code,
            'name': name,
            'category': cat,
            'rarity': rarity,
            'source': src if src not in ('Undefined', '') else None,
            'level': int(row.get('Level') or 0),
            'cost': int(row.get('goldcost') or 0),
            'cost_lumber': int(row.get('lumbercost') or 0),
            'effect_type': effect_type,
            'description': desc,
            # same text with the game's |cAARRGGBB..|r colour codes, which the
            # page turns into coloured spans -- only the campaign tab does this
            'description_colored': desc_col,
            'stats': stats,
            'notes': notes,
            'notes_colored': notes_col,
            'tags': tags,
            'icon': None,
            'raw_code': code,
            'art': (skin.get(code, {}).get('Art') or func.get(code, {}).get('Art') or ''),
        })
    out.sort(key=lambda i: (CATEGORY_ORDER.index(i['category']), i['level'], i['cost'], i['name']))
    return out, unresolved


# The first name listed for a key is the site's wording ("Attack Speed", not the
# game's "Attack Rate"), so a key that several names map to prints as that one.
STAT_NAMES = {}
for _name, _key in STAT_KEYS.items():
    STAT_NAMES.setdefault(_key, _name)


def statname(key):
    base = key[:-4] if key.endswith('_pct') and key not in STAT_NAMES else key
    name = STAT_NAMES.get(key) or STAT_NAMES.get(base) or base.replace('_', ' ')
    return name.title()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()

    game = Game()
    items, unresolved = build(game)
    print('%d campaign items' % len(items))
    print('categories:', dict(collections.Counter(i['category'] for i in items)))
    print('rarity:', dict(collections.Counter(i['rarity'] for i in items)))
    print('source:', dict(collections.Counter(i['source'] for i in items)))
    print('effect_type:', dict(collections.Counter(i['effect_type'] for i in items)))
    if unresolved:
        print('unresolved placeholders:', unresolved.most_common())
    stats = collections.Counter(k for i in items for k in i['stats'])
    print('stat keys:', stats.most_common())

    # A duplicate id would make two cards open the same panel.
    ids = collections.Counter(i['id'] for i in items)
    dupes = [k for k, n in ids.items() if n > 1]
    for i in items:
        if i['id'] in dupes:
            i['id'] += '_' + i['raw_code'].lower()
    if dupes:
        print('ids disambiguated by code:', dupes)

    missing, used = [], set()
    if args.write:
        os.makedirs(OUT_ICONS, exist_ok=True)
    for it in items:
        im = game.icon(it['art']) if it['art'] else None
        if im is None:
            missing.append(it['name'])
            continue
        rel = 'icons/campaign-%s.png' % slug(it['name'])
        if rel in used:                       # two items of one name, own art each
            rel = rel[:-4] + '-' + it['raw_code'].lower() + '.png'
        used.add(rel)
        if args.write:
            im.save(os.path.join(ROOT, rel))
        it['icon'] = rel
    for it in items:
        del it['art']
    print('icons: %d found, %d missing %s' % (len(items) - len(missing), len(missing), missing[:10]))

    if args.write:
        with open(OUT_JSON, 'w', encoding='utf-8') as f:
            json.dump({'items': items}, f, ensure_ascii=False, indent=2)
            f.write('\n')
        print('wrote', OUT_JSON)
    else:
        print('nothing written; --write writes data/campaign_items.json and icons/campaign-*.png')


if __name__ == '__main__':
    main()
