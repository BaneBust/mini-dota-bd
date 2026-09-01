"""Regenerate data/*.json from a Mini-Dota .w3x map.

    python tools/import_map.py                 # newest map found, write + report
    python tools/import_map.py --dry-run       # report only
    python tools/import_map.py --map PATH.w3x

Object data lives in two places. war3map.* holds gameplay values, and
war3mapSkin.* holds the presentation layer -- names, tooltips, icons. Both are
read and overlaid, so names and descriptions come from the map too; only the
site's own additions (icon spritesheets, categories, notes) are left alone.
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tooltips as tt
import w3obj
from mpq import MPQArchive
from wc3_codes import (ABILITY_FIELD_ORDER, ABILITY_FIELDS, ATTRIBUTE_BONUS,
                       HEROES, ITEM_FIELDS, UNIT_FIELDS)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
BINDINGS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ability_fields.json')

# Object data only lists fields the map overrides, so a missing lumber price
# means the item costs no lumber -- the site must not keep an older number.
ZERO_WHEN_ABSENT = {'ilum'}

MAP_GLOBS = [
    os.path.expanduser(r'~/Downloads/*ini*Dota*.w3x'),
    os.path.expanduser(r'~/OneDrive/Dokumenty/Warcraft III/Maps/**/*ini*Dota*.w3x'),
    os.path.expanduser(r'~/Documents/Warcraft III/Maps/**/*ini*Dota*.w3x'),
]


def find_map():
    seen = {}
    for pattern in MAP_GLOBS:
        for p in glob.glob(pattern, recursive=True):
            try:
                seen[os.path.realpath(p)] = os.path.getmtime(p)
            except OSError:
                pass
    if not seen:
        sys.exit('No Mini-Dota map found. Pass one with --map PATH.w3x')
    return max(seen.items(), key=lambda kv: kv[1])[0]


class Report:
    def __init__(self):
        self.changes, self.notes = [], []

    def change(self, where, what, old, new):
        self.changes.append((where, what, old, new))

    def note(self, text):
        self.notes.append(text)

    def dump(self):
        by_where = {}
        for where, what, old, new in self.changes:
            by_where.setdefault(where, []).append((what, old, new))
        for where in sorted(by_where):
            print('\n  %s' % where)
            for what, old, new in by_where[where]:
                print('      %-26s %s -> %s' % (what, old, new))
        if self.notes:
            print('\n  --- do sprawdzenia ---')
            for n in self.notes:
                print('      %s' % n)
        print('\n%d zmian, %d uwag' % (len(self.changes), len(self.notes)))


SELECTOR = re.compile(r"SaveStr\(HeroSelector_Hash,\s*0,\s*'(\w{4})',\s*\"([^\"]+)\"\)")

# The same hero selector also files every hero under one or more roles -- the
# categories the pick screen lets you filter by. They are declared as a bitmask
# in HeroSelectorAction_InitHeroes and then handed out one call per hero:
#
#     local integer categoryJungler= 16
#     call HeroSelectorAddUnitCategory('Nbst' , categoryJungler)
#
# Read rather than transcribed, so a hero who picks up a role in a later version
# picks it up here too.
ROLE_DECL = re.compile(r"local integer category(\w+)=\s*\d+")
ROLE_ASSIGN = re.compile(
    r"HeroSelectorAddUnitCategory\(\s*'(\w{4})'\s*,\s*category(\w+)\s*\)")


def hero_roles(script):
    """{hero code: [role, ...]} in the order the selector declares the roles."""
    order = {name: i for i, name in enumerate(ROLE_DECL.findall(script))}
    roles = collections.defaultdict(set)
    for code, role in ROLE_ASSIGN.findall(script):
        roles[code].add(role)
    # Sorted by the bitmask's own order, not alphabetically: Carry before Mage
    # is the sequence the pick screen shows its filter buttons in.
    return {code: sorted(rs, key=lambda r: order.get(r, 99))
            for code, rs in roles.items()}


def merge(base, skin):
    """Overlay the skin table on the gameplay table, per object and field.

    Reforged splits object data in two: war3map.* holds gameplay values, while
    war3mapSkin.* holds the presentation layer -- names, tooltips and icons.
    Reading only the former makes a map look like it has no text at all.
    """
    out = {code: dict(fields) for code, fields in base.items()}
    for code, fields in skin.items():
        out.setdefault(code, {}).update(fields)
    return out


def load(path):
    a = MPQArchive(path)
    wts = w3obj.parse_wts(a.read_file('war3map.wts').decode('utf-8', 'replace'))
    raw = {k: w3obj.parse(a.read_file('war3map.' + k), k)
           for k in ('w3u', 'w3t', 'w3a')}
    skin = {}
    for k in ('w3u', 'w3t', 'w3a'):
        blob = a.read_file('war3mapSkin.' + k)
        skin[k] = w3obj.index(w3obj.parse(blob, k)) if blob else {}
    script = a.read_file('war3map.j') or b''
    custom_text = (a.read_file('war3map.wct') or b'').decode('utf-8', 'replace')
    code_uses = collections.Counter(
        re.findall(r"'(\w{4})'", script.decode('utf-8', 'replace') + custom_text))
    # The hero selector lists each hero's spells in the order the game shows
    # them, which is the order the site uses. uhab is the internal order and
    # disagrees for about a third of the heroes, so prefer this.
    script_text = script.decode('utf-8', 'replace')
    selector = {code: abils.split(',') for code, abils
                in SELECTOR.findall(script_text)}
    return {'wts': wts, 'raw': raw, 'selector': selector, 'skin': skin,
            'roles': hero_roles(script_text),
            'uses': code_uses,
            'units': merge(w3obj.index(raw['w3u']), skin['w3u']),
            'items': merge(w3obj.index(raw['w3t']), skin['w3t']),
            'abils': merge(w3obj.index(raw['w3a']), skin['w3a'])}


def text(m, obj, field):
    """A string field with its TRIGSTR reference resolved, or None."""
    val = one(obj, field)
    if val is None:
        return None
    val = w3obj.resolve(val, m['wts'])
    return str(val).strip() if val is not None else None


def one(obj, field):
    """Value of a non-leveled field."""
    return list(obj[field].values())[0] if field in obj else None


def num(v):
    """Collapse WC3 floats that are really integers."""
    if isinstance(v, float):
        return round(v) if abs(v - round(v)) < 1e-4 else round(v, 3)
    return v


# --------------------------------------------------------------------------
# heroes

def hero_ability_codes(units, code):
    uhab = one(units.get(code, {}), 'uhab')
    if not uhab:
        return None
    return [c for c in str(uhab).split(',') if c and c != ATTRIBUTE_BONUS]


# The tooltip never spells the level out in words -- it draws a row of bullets,
# filled ones in a colour that climbs green -> yellow -> orange -> red and the
# rest padded out in grey (808080). So the level is the count of filled bullets,
# and the scale is the count of all of them.
DIFFICULTY_ROW = re.compile(
    r'\|c(?:ff)?[0-9a-fA-F]{6}Difficulty\|r\s*'
    r'\|c(?:ff)?[0-9a-fA-F]{6}(•*)\|r'
    r'(?:\|c(?:ff)?808080(•*)\|r)?')


def hero_difficulty(m, code):
    """(filled, total) bullets from a hero's difficulty row, or (None, None).

    Blood Mage is drawn on five bullets where the other twenty-three get four,
    so the total is counted off the tooltip rather than assumed to be four.
    """
    obj = m['skin']['w3u'].get(code)
    tip = text(m, obj, 'utub') if obj else None
    hit = DIFFICULTY_ROW.search(tip or '')
    if not hit:
        return None, None
    filled = len(hit.group(1))
    return filled, filled + len(hit.group(2) or '')


def update_heroes(m, bindings, rep):
    path = os.path.join(DATA, 'heroes.json')
    doc = json.load(open(path, encoding='utf-8'))
    by_name = {h['name']: h for h in doc['heroes']}

    # flag heroes the map defines more than once with different spell lists
    variants = {}
    for entry in m['raw']['w3u']['original'] + m['raw']['w3u']['custom']:
        for mod in entry['mods']:
            if mod['id'] == 'uhab':
                variants.setdefault(entry['id'], set()).add(mod['value'])

    for code, name in sorted(HEROES.items(), key=lambda kv: kv[1]):
        hero = by_name.get(name)
        if hero is None:
            rep.note('bohater %s (%s) jest w mapie, brak go na stronie' % (name, code))
            continue
        if hero.get('raw_code') != code:
            rep.change('heroes / ' + name, 'raw_code', hero.get('raw_code'), code)
            hero['raw_code'] = code
        if len(variants.get(code, ())) > 1:
            rep.note('%s (%s): mapa ma %d roznych list spelli, uzyto ostatniej'
                     % (name, code, len(variants[code])))
        roles = m['roles'].get(code)
        if roles and hero.get('roles') != roles:
            rep.change('heroes / ' + name, 'roles', hero.get('roles'), roles)
            hero['roles'] = roles
        elif not roles:
            rep.note('%s: selektor nie przypisuje zadnej roli' % name)
        diff, diff_max = hero_difficulty(m, code)
        if diff is None:
            rep.note('%s: tooltip nie ma paska trudnosci' % name)
        else:
            for key, new in (('difficulty', diff), ('difficulty_max', diff_max)):
                if hero.get(key) != new:
                    rep.change('heroes / ' + name, key, hero.get(key), new)
                    hero[key] = new
        codes = m['selector'].get(code) or hero_ability_codes(m['units'], code)
        if not codes:
            rep.note('%s: brak listy spelli w selektorze i w uhab, pomijam' % name)
            continue
        ordered = code in m['selector']
        for acode, sab in pair_abilities(name, codes, hero.get('abilities', []),
                                         rep, ordered):
            update_ability(m, acode, sab, '%s / %s' % (name, sab.get('name', acode)),
                           bindings, rep)
    return path, doc


def pair_abilities(hero_name, codes, site_abils, rep, ordered=False):
    """Match map ability codes to the site's abilities.

    When the codes come from the hero selector their order is the game's own
    display order and matches the site, so pair by position and use the name
    table only to flag disagreements. Falling back to uhab means the order is
    the internal one, which disagrees for about a third of the heroes -- there,
    pair by name and let custom A0xx codes fall out by elimination.
    """
    from wc3_codes import ABILITY_NAMES, normalize

    if ordered:
        if len(codes) != len(site_abils):
            rep.note('%s: selektor ma %d spelli, strona %d - pomijam'
                     % (hero_name, len(codes), len(site_abils)))
            return []
        pairs = []
        for code, sab in zip(codes, site_abils):
            stock = ABILITY_NAMES.get(code)
            if stock and normalize(stock) != normalize(sab.get('name')):
                rep.note('%s: selektor daje %s (%s) tam gdzie strona ma "%s"'
                         % (hero_name, code, stock, sab.get('name')))
            pairs.append((code, sab))
        return pairs

    remaining = list(site_abils)
    pairs, unknown_codes = [], []
    for code in codes:
        stock = ABILITY_NAMES.get(code)
        if stock is None:
            unknown_codes.append(code)
            continue
        hit = next((s for s in remaining if normalize(s.get('name')) == normalize(stock)), None)
        if hit is None:
            rep.note('%s: %s (%s) nie ma odpowiednika na stronie' % (hero_name, stock, code))
            continue
        remaining.remove(hit)
        pairs.append((code, hit))

    if len(unknown_codes) == 1 and len(remaining) == 1:
        pairs.append((unknown_codes[0], remaining[0]))
        rep.note('%s: custom ability %s przypisano do "%s" przez eliminacje'
                 % (hero_name, unknown_codes[0], remaining[0].get('name')))
    else:
        for code in unknown_codes:
            rep.note('%s: nieznany kod %s (kandydaci: %s)'
                     % (hero_name, code, ', '.join(s.get('name', '?') for s in remaining) or 'brak'))
    return pairs


def update_ability(m, acode, sab, where, bindings, rep):
    obj = m['abils'].get(acode)
    if not obj:
        return
    levels = {lv['rank']: lv for lv in sab.get('levels', [])}
    if not levels:
        return

    # generic fields first, then the ability-specific Data A-F bindings
    applied_keys = set()
    for fid in ABILITY_FIELD_ORDER:
        if fid not in obj:
            continue
        # ...under the name this ability already uses for it. Writing the
        # canonical name blind is what put an "Area" column next to Blizzard's
        # "Area of Effect", the same number twice.
        key = site_key(levels, ABILITY_FIELDS[fid])
        for lvl, val in obj[fid].items():
            # A key the site does not carry yet still gets written: the map
            # stating a cooldown is the whole reason to show one, and matching
            # only existing keys meant Blizzard's 6.5-8.5 sat in the map for
            # good while the site quietly showed no cooldown at all.
            if lvl and lvl in levels:
                apply_value(levels[lvl], key, num(val), '%s  rank %d' % (where, lvl), rep)
                applied_keys.add(key)

    # Data A-F fields also carry unit ids, buff ids and target flags; only the
    # purely numeric ones describe a stat the site shows.
    def numeric(field):
        return all(isinstance(v, (int, float)) for k, v in obj[field].items() if k)

    data_fields = sorted(f for f in obj if f[:1].isupper() and numeric(f))
    unexplained = sorted({k for lv in levels.values() for k in lv
                          if k != 'rank'} - applied_keys)
    for fid in data_fields:
        bind = bindings.get('%s.%s' % (acode, fid))
        if bind is None and len(data_fields) == 1 and len(unexplained) == 1:
            bind = unexplained[0]
            bindings['%s.%s' % (acode, fid)] = bind
            rep.note('auto-powiazano %s.%s -> "%s" (%s)' % (acode, fid, bind, where))
        if bind is None:
            vals = [num(v) for k, v in sorted(obj[fid].items()) if k]
            rep.note('%s: nieprzypisane pole %s = %s (kandydaci: %s)'
                     % (where, fid, vals, ', '.join(unexplained) or 'brak'))
            continue
        for lvl, val in obj[fid].items():
            if lvl and lvl in levels:
                apply_value(levels[lvl], bind, num(val), '%s  rank %d' % (where, lvl), rep)

    # Last: the numbers the map only writes as prose -- and only those. A key
    # object data carries for any level is off limits to the tooltip, including
    # the levels object data skips.
    apply_tooltip(m, obj, levels, where, rep, applied_keys)


# The site names the same number differently from spell to spell -- a summon
# count is "wolves" on the Far Seer and "locusts" on the Crypt Lord. A value
# read out of a tooltip goes into the name the ability already uses; only when
# it carries none does the canonical name get created.
KEY_SYNONYMS = {
    'area': ['area', 'aoe', 'reveal_area', 'final_area', 'lizard_area'],
    'summons': ['summons', 'wolves', 'locusts', 'treants', 'illusions',
                'max_beetles', 'max_spawns', 'units_revived', 'summon_count'],
    'hp': ['hp', 'skeleton_hp', 'owl_hp', 'treant_hp', 'goblin_hp', 'raised_hp'],
    'armor': ['armor', 'skeleton_armor', 'owl_armor', 'treant_armor', 'raised_armor'],
    'damage_min': ['damage_min', 'dmg_min', 'skeleton_dmg_min', 'owl_dmg_min',
                   'treant_damage_min'],
    'damage_max': ['damage_max', 'dmg_max', 'skeleton_dmg_max', 'owl_dmg_max',
                   'treant_damage_max'],
    # adur is what a unit gets, ahdu what a hero gets. A spell that shows both
    # names them after the effect -- Storm Bolt calls them Stun Duration -- so
    # the pair has to be found under those names before a bare "duration" is
    # created beside them, saying the same thing a third time.
    'duration_heroes': ['duration_heroes', 'stun_heroes', 'duration'],
    'duration_units': ['duration_units', 'stun_units', 'duration'],
}


def site_key(levels, canonical):
    """The name this ability already uses for `canonical`, or the canonical one."""
    for name in KEY_SYNONYMS.get(canonical, [canonical]):
        if any(name in lv for lv in levels.values()):
            return name
    return canonical


def apply_tooltip(m, obj, levels, where, rep, from_object_data=frozenset()):
    """Numbers the map only ever states in the spell's own tooltip text.

    A footer is a slash list with one slot per level, so the author has to write
    six numbers even where the map overrides fewer. The filler is the neighbour:
    Summon Water Elemental reads "Cooldown 18/18/16/14/12/10" while its object
    data sets levels 2-6 only, leaving level 1 at the stock 20 -- the tooltip's
    leading 18 is a repeat of level 2, not a value. Quilbeast does it twice over
    ("23/23/..." and "80/80/80/80/85/85").

    So a key object data speaks for at any level is skipped outright, including
    the levels object data leaves alone: those are stock values, and the site
    fills them from Liquipedia rather than from a slash list.
    """
    raw = list(obj.get('arut', {}).values()) or list(obj.get('aub1', {}).values())
    if not raw:
        return
    text = tt.clean(str(w3obj.resolve(raw[0], m['wts'])), m['abils'])

    for canonical, values in tt.footer_values(text).items():
        key = site_key(levels, canonical)
        if key in from_object_data:
            continue
        for lvl in sorted(levels):
            # one value covers every level; a list is read level by level
            val = values[0] if len(values) == 1 else (
                values[lvl - 1] if lvl <= len(values) else None)
            if val is not None:
                apply_value(levels[lvl], key, num(val), '%s  rank %d' % (where, lvl), rep)

    for lvl, stats in tt.summon_levels(text).items():
        if lvl not in levels:
            continue
        for canonical, val in stats.items():
            apply_value(levels[lvl], site_key(levels, canonical), val,
                        '%s  rank %d' % (where, lvl), rep)


def apply_value(level_dict, key, new, where, rep):
    # The map stores a chance as a fraction; a `_pct` key is a percentage, and
    # the site prints the number with a % after it. Written raw, Evasion's 0.18
    # showed up as "0.18%". Same rule the tooltip filler uses for <...,%>.
    if key.endswith('_pct') and isinstance(new, float) and 0 < abs(new) <= 1:
        new = round(new * 100, 2)
    old = level_dict.get(key)
    if isinstance(old, float) and isinstance(new, (int, float)) and abs(old - new) < 1e-6:
        return
    if old == new:
        return
    level_dict[key] = new
    rep.change(where, key, old, new)


# --------------------------------------------------------------------------
# items and mercs

def update_by_raw_code(m, filename, collection, source, fields, label, rep):
    """Update entries that carry a raw_code linking them to a map object."""
    path = os.path.join(DATA, filename)
    doc = json.load(open(path, encoding='utf-8'))
    entries = doc[collection]

    linked = unknown = 0
    for entry in entries:
        code = entry.get('raw_code')
        if not code:
            continue
        obj = m[source].get(code)
        if obj is None:
            unknown += 1
            rep.note('%s / %s: raw_code %s nie wystepuje w mapie'
                     % (label, entry.get('name'), code))
            continue
        linked += 1
        for fid, key in fields.items():
            val = one(obj, fid)
            if val is None:
                continue
            old = entry.get(key)
            if old != num(val):
                entry[key] = num(val)
                rep.change('%s / %s' % (label, entry['name']), key, old, num(val))

    missing = sum(1 for e in entries if not e.get('raw_code'))
    if missing:
        rep.note('%s: %d z %d bez raw_code - te wpisy sie nie aktualizuja'
                 % (label, missing, len(entries)))
    return path, doc


def norm_name(text):
    return re.sub(r'[^a-z0-9]', '', str(text).lower())


def link_by_name(m, entries, source, name_field, rep, label):
    """Fill in raw_code for entries the map names identically."""
    index = {}
    for code, obj in m[source].items():
        nm = text(m, obj, name_field)
        if nm:
            index.setdefault(norm_name(nm), []).append(code)

    linked = 0
    for entry in entries:
        if entry.get('raw_code'):
            continue
        hits = index.get(norm_name(entry.get('name')))
        if not hits:
            continue
        if len(hits) > 1:
            # a renamed stock item and its custom clone can share a name;
            # the price the site records decides between them
            # A renamed stock item and an unused custom clone can share name
            # and price. The one the map's script actually references is the
            # live object; the clone is left over.
            ranked = sorted(hits, key=lambda c: -m['uses'].get(c, 0))
            if m['uses'].get(ranked[0], 0) <= m['uses'].get(ranked[1], 0):
                rep.note('%s / %s: nazwa pasuje do %d obiektow (%s) - pomijam'
                         % (label, entry['name'], len(hits), ','.join(hits)))
                continue
            hits = ranked[:1]
        entry['raw_code'] = hits[0]
        linked += 1
        rep.change('%s / %s' % (label, entry['name']), 'raw_code', None, hits[0])
    return linked


def stem(name):
    """An upgrade ladder's name without its tier value: 'Claws of Attack +15'
    and 'Claws of Attack +45' both reduce to 'clawsofattack'."""
    return norm_name(re.sub(r'[+]?\s*\d+\s*%?\s*$', '', str(name)))


def link_ladder_bases(m, entries, rep):
    """Link tier-1 items to the stock object their custom tiers derive from.

    Mini-Dota builds each upgrade ladder as custom items deriving from one stock
    base -- Belt of Giant Strength +12/+18/+24 all have base bgst. The map only
    renames the higher tiers, so tier 1 keeps its stock name and has no unam to
    match on; but it *is* that shared base, which is solid evidence.
    """
    ladders = {}
    for entry in m['raw']['w3t']['custom']:
        field = m['skin']['w3t'].get(entry['id'], {}).get('unam')
        if not field:
            continue
        nm = w3obj.resolve(list(field.values())[0], m['wts'])
        ladders.setdefault(stem(nm), set()).add(entry['base'])

    claimed = {e['raw_code'] for e in entries if e.get('raw_code')}
    for entry in entries:
        if entry.get('raw_code'):
            continue
        bases = ladders.get(stem(entry['name']))
        if not bases or len(bases) != 1:
            continue
        base = next(iter(bases))
        if base in claimed or base not in m['items']:
            continue
        entry['raw_code'] = base
        claimed.add(base)
        rep.change('items / ' + entry['name'], 'raw_code (baza drabinki)', None, base)


def link_by_shop(m, entries, rep):
    """Match a shop's stock list against the site category it corresponds to.

    Each shop sells a closed set, so matching inside it is far better
    constrained than across all 246 map items: the nine codes stocked by the
    map's "Goblin Merchant" shop unit line up with the nine Library entries --
    note that unit is the tome shop, not the site's Goblin Laboratory category,
    which is the shop the map calls a Laboratory. Unique abbreviations go first,
    then a single leftover on each side is forced by elimination.
    """
    from link_items import is_mnemonic

    claimed = {e['raw_code'] for e in entries if e.get('raw_code')}
    for shop, obj in sorted(m['units'].items()):
        stock = str(one(obj, 'usei') or '')
        codes = [c for c in stock.split(',') if c and c not in claimed]
        if not codes:
            continue

        free = [e for e in entries if not e.get('raw_code')]
        pairs, matched_cats = {}, []
        for code in codes:
            hits = [e for e in free if is_mnemonic(code, e['name'])]
            if len(hits) == 1:
                pairs[code] = hits[0]
                matched_cats.append(hits[0].get('category'))

        if not matched_cats:
            continue
        category = collections.Counter(matched_cats).most_common(1)[0][0]
        for code, entry in pairs.items():
            if entry.get('category') != category:
                continue
            entry['raw_code'] = code
            claimed.add(code)
            rep.change('items / ' + entry['name'], 'raw_code (sklep %s)' % shop, None, code)

        # abbreviations miss where the map and the site word things differently
        # (tdx2 is a Tome of Agility); inside one shop an exact price is enough
        for code in [c for c in codes if c not in claimed]:
            cost = one(m['items'].get(code, {}), 'igol')
            if cost is None:
                continue
            hits = [e for e in entries if not e.get('raw_code')
                    and e.get('category') == category and e.get('cost') == cost]
            if len(hits) == 1:
                hits[0]['raw_code'] = code
                claimed.add(code)
                rep.change('items / ' + hits[0]['name'],
                           'raw_code (cena w %s)' % shop, None, code)

        left_codes = [c for c in codes if c not in claimed]
        left_items = [e for e in entries
                      if not e.get('raw_code') and e.get('category') == category]
        if len(left_codes) == 1 and len(left_items) == 1:
            left_items[0]['raw_code'] = left_codes[0]
            claimed.add(left_codes[0])
            rep.change('items / ' + left_items[0]['name'],
                       'raw_code (eliminacja w %s)' % shop, None, left_codes[0])
        elif left_codes and left_items:
            rep.note('sklep %s (%s): zostaly kody %s i pozycje %s'
                     % (shop, category, ','.join(left_codes),
                        ', '.join(e['name'] for e in left_items)))


def update_items(m, rep):
    import tooltips as tt

    from link_items import is_mnemonic

    path = os.path.join(DATA, 'items.json')
    doc = json.load(open(path, encoding='utf-8'))
    link_by_name(m, doc['items'], 'items', 'unam', rep, 'items')

    link_ladder_bases(m, doc["items"], rep)
    link_by_shop(m, doc["items"], rep)

    # Items the map never renames keep their stock name, so there is no unam to
    # match on. Their raw code is itself an abbreviation of that name (ocor ->
    # Orb of Corruption), which together with an exact price is enough.
    claimed = {i['raw_code'] for i in doc['items'] if i.get('raw_code')}
    for item in doc['items']:
        if item.get('raw_code'):
            continue
        hits = [c for c, obj in m['items'].items()
                if c not in claimed
                and text(m, obj, 'unam') is None
                and one(obj, 'igol') == item.get('cost')
                and is_mnemonic(c, item['name'])]
        if len(hits) == 1:
            item['raw_code'] = hits[0]
            claimed.add(hits[0])
            rep.change('items / ' + item['name'], 'raw_code (heurystyka)', None, hits[0])
        elif len(hits) > 1:
            rep.note('items / %s: heurystyka daje %s - rozstrzygnij recznie'
                     % (item['name'], ','.join(hits)))

    for item in doc['items']:
        code = item.get('raw_code')
        obj = m['items'].get(code) if code else None
        if obj is None:
            continue
        where = 'items / ' + item['name']
        for fid, key in ITEM_FIELDS.items():
            val = one(obj, fid)
            # A cost the map never sets is zero, not "leave whatever the site
            # says". Treating absence as no-op let Serathil and the Runed
            # Bracers keep a lumber price the map had dropped.
            if val is None and fid in ZERO_WHEN_ABSENT:
                val = 0
            if val is not None and item.get(key) != num(val):
                old = item.get(key)
                item[key] = num(val)
                rep.change(where, key, old, num(val))
        # An item's display name lives in utip, not unam -- unam is the name of
        # the unit an item spawns. Reading only unam left two dozen items
        # unmatchable by name, so their prices were never checked at all.
        nm = text(m, obj, 'utip') or text(m, obj, 'unam')
        if nm and nm != item.get('name'):
            rep.change(where, 'name', item.get('name'), nm)
            item['name'] = nm
        tip = text(m, obj, 'utub') or text(m, obj, 'ides')
        if tip:
            desc = tt.polish(tt.clean(w3obj.resolve(tip, m['wts']), m['abils']))
            # Placeholders naming a stock ability the map never overrides have
            # no value to substitute. Publishing "<AIcb,DataB1>" would be worse
            # than the wording already on the site, so keep what is there.
            left = tt.PLACEHOLDER.findall(desc or '')
            if left:
                rep.note('%s: opis zostawiony, nierozwiniete %s'
                         % (where, ', '.join(sorted({c for c, _, _, _ in left}))))
            elif desc and desc != item.get('description'):
                rep.change(where, 'description', (item.get('description') or '')[:40],
                           desc[:40])
                item['description'] = desc

    report_rename_candidates(m, doc['items'], rep)

    missing = [i['name'] for i in doc['items'] if not i.get('raw_code')]
    if missing:
        rep.note('items: %d bez raw_code, np. %s'
                 % (len(missing), ', '.join(missing[:6])))
    return path, doc


def report_rename_candidates(m, entries, rep):
    """Surface items the map appears to have renamed.

    Linking is done by name, so a rename severs the link precisely when the new
    name most needs applying -- "Shield of the Deathlord" became "Deathguard"
    and simply stopped matching. Matching renames automatically is not safe
    (cost collides and tooltips are rewritten too), so they are reported for a
    one-line confirmation instead: set raw_code and the next run applies it.
    """
    claimed = {e['raw_code'] for e in entries if e.get('raw_code')}
    site_names = {e['name'] for e in entries}

    orphans = []
    for code, obj in m['items'].items():
        name = text(m, obj, 'unam')
        if name and name not in site_names and code not in claimed:
            orphans.append((code, name, one(obj, 'igol')))

    for entry in entries:
        if entry.get('raw_code'):
            continue
        # a tier rung and a plain item are never the same thing, and price
        # alone collides constantly across the tier ladders
        tiered = bool(re.search(r'\d', entry['name']))
        same_cost = [o for o in orphans
                     if o[2] is not None and o[2] == entry.get('cost')
                     and bool(re.search(r'\d', o[1])) == tiered]
        if same_cost:
            rep.note('items / %s: byc moze przemianowany -> %s'
                     % (entry['name'],
                        '; '.join('%s "%s"' % (c, n) for c, n, _ in same_cost[:4])))


def unit_name(m, obj):
    """Units keep stock names, so unam is usually absent; utip carries it."""
    return text(m, obj, 'unam') or text(m, obj, 'utip')


def update_mercs(m, rep):
    from wc3_codes import MERC_SHOPS
    import tooltips as tt

    path = os.path.join(DATA, 'mercs.json')
    doc = json.load(open(path, encoding='utf-8'))

    # roster = every unit either mercenary building sells, tagged with which
    roster = {}
    for shop in MERC_SHOPS:
        if shop['from_map']:
            stock = str(one(m['units'].get(shop['code'], {}), 'useu') or '')
            codes = [c for c in stock.split(',') if c]
            if not codes:
                rep.note('mercs: %s (%s) nie ma listy sprzedazy w mapie'
                         % (shop['building'], shop['code']))
        else:
            codes = shop['units']
        for code in codes:
            nm = unit_name(m, m['units'].get(code, {}))
            if nm:
                roster[code] = (nm, shop)
            else:
                rep.note('mercs: %s nie ma nazwy w mapie, pomijam' % code)

    # units the site still files under items belong here instead
    items_path = os.path.join(DATA, 'items.json')
    items_doc = json.load(open(items_path, encoding='utf-8'))
    names = {nm for nm, _ in roster.values()}
    moved = [i for i in items_doc['items'] if i['name'] in names]
    if moved:
        items_doc['items'] = [i for i in items_doc['items'] if i['name'] not in names]
        with open(items_path, 'w', encoding='utf-8') as f:
            json.dump(items_doc, f, ensure_ascii=False, indent=2)
            f.write('\n')
        for i in moved:
            rep.change('items / ' + i['name'], 'PRZENIESIONY do Mercenaries',
                       i.get('category'), 'jednostka, nie item')

    by_name = {mc['name']: mc for mc in doc['mercs']}
    for old in moved:
        by_name.setdefault(old['name'], None)
    for code, (name, shop) in roster.items():
        merc = by_name.get(name)
        if merc is None:
            src = next((i for i in moved if i['name'] == name), {})
            merc = {'id': re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_'),
                    'name': name, 'description': src.get('description', ''),
                    'buffs': [], 'abilities': [], 'notes': src.get('notes', ''),
                    # app.js only guards on icon, so pointing at a sheet without
                    # an index renders slot 0 -- another unit's portrait
                    'icon': None, 'icon_index': None,
                    'icon_cols': 4, 'icon_rows': 3}
            doc['mercs'].append(merc)
            by_name[name] = merc
            rep.change('mercs / ' + name, 'DODANY (%s)' % shop['building'], None, code)
        merc['raw_code'] = code
        if merc.get('building') != shop['building']:
            rep.change('mercs / ' + name, 'building', merc.get('building'),
                       shop['building'])
            merc['building'] = shop['building']

    dropped = [mc for mc in doc['mercs'] if mc.get('raw_code') not in roster]
    for mc in dropped:
        rep.change('mercs / ' + mc['name'], 'USUNIETY',
                   'zaden oboz go nie sprzedaje', None)
    doc['mercs'] = [mc for mc in doc['mercs'] if mc.get('raw_code') in roster]

    for merc in doc['mercs']:
        obj = m['units'].get(merc['raw_code'], {})
        for fid, key in UNIT_FIELDS.items():
            val = one(obj, fid)
            if val is not None and merc.get(key) != num(val):
                old = merc.get(key)
                merc[key] = num(val)
                rep.change('mercs / ' + merc['name'], key, old, num(val))
        raw_tip = text(m, obj, 'utub')
        if not raw_tip:
            continue
        found = tt.abilities_from_tooltip(raw_tip, m['abils'])
        if found and not merc.get('abilities'):
            merc['abilities'] = found
            rep.change('mercs / ' + merc['name'], 'abilities', 0,
                       ', '.join(a['name'] for a in found))
        if not merc.get('description'):
            desc = tt.clean(raw_tip, m['abils'])
            if desc and not tt.PLACEHOLDER.findall(desc):
                merc['description'] = desc
                rep.change('mercs / ' + merc['name'], 'description', '', desc[:40])
    return path, doc


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--map')
    ap.add_argument('--dry-run', action='store_true')
    # Descriptions on the site are hand-curated on top of what the map says --
    # a stat that already has its own box does not get repeated in prose -- so
    # a run aimed at hero spells must be able to leave items.json alone.
    ap.add_argument('--only', choices=['heroes', 'items', 'mercs'],
                    help='przelicz tylko jeden plik')
    args = ap.parse_args()

    path = args.map or find_map()
    print('mapa: %s' % path)
    m = load(path)
    print('  units=%d items=%d abilities=%d strings=%d'
          % (len(m['units']), len(m['items']), len(m['abils']), len(m['wts'])))

    bindings = json.load(open(BINDINGS, encoding='utf-8')) if os.path.exists(BINDINGS) else {}
    rep = Report()
    jobs = {'heroes': lambda: update_heroes(m, bindings, rep),
            'items': lambda: update_items(m, rep),
            'mercs': lambda: update_mercs(m, rep)}
    outputs = [job() for name, job in jobs.items()
               if args.only is None or args.only == name]
    rep.dump()

    if args.dry_run:
        print('\n--dry-run: nic nie zapisano')
        return
    for out_path, doc in outputs:
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write('\n')
    with open(BINDINGS, 'w', encoding='utf-8') as f:
        json.dump(bindings, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write('\n')
    print('\nzapisano data/*.json - sprawdz i odpal update.bat')


if __name__ == '__main__':
    main()
