"""Recover Mini-Dota's real item/ability tooltips from war3map.wts.

The published ladder map is optimised: the object-data text fields (utub, utip,
ides, unam) are stripped, so World Editor shows the inherited base-game text
instead. The map's own tooltip strings survive in the string table, still
carrying <AbilCode,DataA1> placeholders that the game substitutes at runtime.
This module pairs those strings back to objects and fills the placeholders in
from war3map.w3a.
"""
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# <AbilCode,Field[level][,format]> -- the game substitutes these at runtime.
# Field is DataA..DataF or one of the generic ones below; format is % (scale a
# fraction to a percentage) or . (keep decimals).
PLACEHOLDER = re.compile(r'<([A-Za-z0-9]{4}),([A-Za-z]+)(\d+)?(?:,([%.!]))?>')
COLOR = re.compile(r'\|c[0-9a-fA-F]{8}|\|r')
DATA_SLOT = 'ABCDEF'
GENERIC = {'area': 'aare', 'cost': 'amcs', 'cool': 'acdn', 'dur': 'adur',
           'herodur': 'ahdu', 'rng': 'aran', 'range': 'aran'}


def _pick(levels, level):
    """The field's value at `level`, or None. Never another level's value.

    Object data lists only the levels the map overrides, so a gap means the
    stock value applies -- and the levels the map *does* carry are the ones
    guaranteed to differ from it. Falling back to the lowest of them put Storm
    Bolt's rank 6 duration at 4.0 (its rank 1) instead of 5.0, and made every
    Evasion tooltip read "Level 1 - Grants 18% dodge" when level 1 is 10%.

    None leaves the placeholder unexpanded, which is the honest outcome: the
    number is not in the map and belongs to Liquipedia, not to a neighbour.
    """
    return levels.get(level)


# An item ability's data fields are named after what they do (Iarp, Idic, Idam),
# not after their slot, so DataA..DataF cannot be found by position the way a
# unit ability's Hhb1/Uau2 can. Each entry lists the fields in slot order; the
# pairing is read off the tooltip that references them.
ITEM_DATA_FIELDS = {
    'A00K': ['Idic', 'Iarp'],   # Corruption: +N Damage, armor by N
    'CB20': ['Idic', 'Iarp'],   # Greater Corruption, same shape
    'A01F': ['Idam'],           # Frost/Lightning Claws bonus damage
    'A035': ['Idam'],           # Firehand Gauntlets bonus damage
    'A02Z': ['Icfd'],           # Deathguard immolation, damage per second
    'AIm2': ['Impg'],           # Mana Stone, mana restored
}


def ability_data(abils, code, field, level):
    """Value of an ability field named the way a tooltip refers to it, or None.

    Data fields are named <base-letter><3-char><index>, e.g. Holy Light's DataA
    is Hhb1. The index maps A->1 .. F->6, so the field is found by position.

    A unit ability leads with its race letter in caps; an item ability leads
    with a lowercase 'i' (the Lesser Clarity Potion's DataB is irl2). Both are
    data fields. Only the generic 'a'-prefixed ones (aare, acdn, adur, ...) are
    not, and those are handled above by name.
    """
    obj = abils.get(code)
    if not obj:
        return None
    key = field.lower()
    if key in GENERIC:
        levels = obj.get(GENERIC[key])
        return _pick(levels, level) if levels else None
    if not key.startswith('data') or len(field) != 5:
        return None
    want = DATA_SLOT.index(field[4].upper()) + 1
    slots = ITEM_DATA_FIELDS.get(code)
    if slots:
        if want > len(slots):
            return None
        levels = obj.get(slots[want - 1])
        return _pick(levels, level) if levels else None
    for name, levels in sorted(obj.items()):
        if (name[:1].isupper() or name[:1] == 'i') and \
                name[-1:].isdigit() and int(name[-1]) == want:
            return _pick(levels, level)
    return None


def fill(text, abils, level=1):
    """Substitute <Code,DataX> placeholders with their real numbers."""
    def sub(m):
        code, field, lvl, fmt = m.groups()
        val = ability_data(abils, code, field, int(lvl) if lvl else level)
        if val is None:
            return m.group(0)
        if fmt == '%' and isinstance(val, float) and abs(val) <= 1:
            val *= 100
        if isinstance(val, float):
            val = round(val) if abs(val - round(val)) < 1e-4 else round(val, 2)
        return str(val)
    return PLACEHOLDER.sub(sub, text)


def strip_colors(text):
    return COLOR.sub('', text)


def clean(text, abils, level=1):
    """Tooltip as the site would show it: placeholders filled, colours dropped."""
    out = strip_colors(fill(text, abils, level))
    return re.sub(r'[ \t]+', ' ', out).strip()


# A heading is a coloured span followed by a dash. Requiring the dash matters:
# descriptions colour their numbers too ("|cffff8c00700|r damage"), and without
# it every highlighted value is read as another ability.
ABILITY_BLOCK = re.compile(
    r'\|c[0-9a-fA-F]{8}([^|]*[A-Za-z][^|]*?)\|r[ \t]*[-–][ \t]*'
    r'(.*?)(?=\|c[0-9a-fA-F]{8}[^|]*[A-Za-z][^|]*?\|r[ \t]*[-–]|\Z)', re.S)


def abilities_from_tooltip(raw, abils):
    """Split a unit's extended tooltip into its abilities.

    Mini-Dota writes them as a coloured heading followed by the description,
    e.g. "|cffffcc00Kaboom!|r - Causes a powerful area explosion...".
    Placeholders naming a stock ability the map never overrides have no value to
    substitute; they become "?" rather than leaking "<Afae,DataA1>" to the page.
    """
    out = []
    for name, body in ABILITY_BLOCK.findall(raw or ''):
        name = strip_colors(name).strip(' -–:')
        body = clean(body, abils).strip()
        if not name or len(name) > 40:
            continue
        unresolved = bool(PLACEHOLDER.search(body))
        body = PLACEHOLDER.sub('?', body)
        entry = {'name': name, 'type': 'Active', 'description': body}
        if unresolved:
            entry['from_base_game'] = True
        out.append(entry)
    return out


# A spell's tooltip ends in a block the map author keeps by hand:
#
#     Cooldown 20/18/16/14/12/10
#     Mana 90
#     Range 550/550/600/650/700/750
#
# One number means the value holds at every level. This is often the only place
# a number exists at all -- the object data leaves a field alone when it matches
# the base game, so the site showed no cooldown for half the spells while the
# map stated it in plain text all along.
FOOTER_LINE = re.compile(
    r'^(Cooldown|Mana|Range|Area|Bounty|Summon Count|Units Duration|Duration)'
    r'[ \t]+([0-9][0-9./ ]*)(?:[ \t]*\(([0-9][0-9./]*)\))?[ \t]*$', re.M)

FOOTER_KEYS = {
    'Cooldown': 'cooldown', 'Mana': 'mana', 'Range': 'range', 'Area': 'area',
    'Bounty': 'bounty', 'Summon Count': 'summons',
    'Units Duration': 'duration_units', 'Duration': 'duration',
}


def footer_values(text):
    """{key: [value per level]} from the trailing Cooldown/Mana/Range block.

    A flat value comes back as a one-element list; the caller spreads it over
    every level. "Duration 45 (60)" is a hero duration with the unit duration
    in brackets, the way the game writes it.
    """
    out = {}
    for label, values, bracket in FOOTER_LINE.findall(text or ''):
        nums = [float(v) for v in values.strip().split('/') if v.strip()]
        if not nums:
            continue
        key = FOOTER_KEYS[label]
        if key == 'duration' and bracket:
            out['duration_heroes'] = nums
            out['duration_units'] = [float(v) for v in bracket.split('/') if v]
        else:
            out[key] = nums
    return out


# "Level 3 - 700 hit points, 31 - 32 damage, 2 armor." -- every summon spell
# spells its unit out this way, and the numbers are nowhere else: the summoned
# unit is a stock object the map never overrides.
SUMMON_LINE = re.compile(
    r'^Level (\d+) - ([\d]+) hit points, ([\d]+) - ([\d]+) damage, ([\d]+) armor',
    re.M)


def summon_levels(text):
    """{level: {'hp':.., 'damage_min':.., 'damage_max':.., 'armor':..}}"""
    return {int(lvl): {'hp': int(hp), 'damage_min': int(lo),
                       'damage_max': int(hi), 'armor': int(ar)}
            for lvl, hp, lo, hi, ar in SUMMON_LINE.findall(text or '')}


def index_by_ability(wts):
    """{ability_code: [wts_index, ...]} for every code named in a tooltip."""
    ref = {}
    for idx, txt in wts.items():
        for code in set(PLACEHOLDER.findall(txt)):
            ref.setdefault(code[0], []).append(idx)
    return ref


# The bullet line the map appends to every upgrade rung ("Upgradable ••••").
# The site already states this twice -- as the Upgradable category and as the
# "Stackable xN" tag -- so repeating it in the description is pure noise.
UPGRADE_LINE = re.compile(r'^[ \t]*Upgradable[ \t•]*$', re.M | re.I)


def drop_upgrade_line(text):
    """Tooltip without the map's 'Upgradable ••••' footer."""
    out = UPGRADE_LINE.sub('', text or '')
    return re.sub(r'\n{3,}', '\n\n', out).strip()


# Every orb opens on the same boilerplate, which buries the one line a reader
# actually came for. The flat damage bonus reads last -- and the STATS grid
# shows it as a number anyway.
CARRIED_DMG = re.compile(
    r'^\s*(Adds \d+(?:\.\d+)? bonus damage to the attack of an? hero'
    r'(?: when carried)?\.)\s*', re.I)

# "become ranged" is the map's shorthand for the thing that actually matters
# about an orb on a melee hero: the attack can now reach air units. Where the
# map states it as its own sentence it is boilerplate too and travels with the
# damage line; where it is fused into the effect ("become ranged and slow...")
# it has to stay put, so the air note follows as a sentence of its own.
RANGED = re.compile(r'attacks? (?:also )?becomes? ranged', re.I)
STANDALONE_RANGED = re.compile(
    r"\s*(?:The )?[Hh]ero'?s attacks? ((?:also )?becomes? ranged)\.", re.I)
MENTIONS_AIR = re.compile(r'\bair\b', re.I)
AIR_NOTE = 'Ranged attacks can hit air units.'


def orb_effect_first(text):
    """Tooltip led by what the item does, not by the shared orb boilerplate.

    Both stock sentences -- the flat damage bonus and a bare "Hero's attacks
    become ranged." -- move to the end, so the line the reader came for is the
    one they read first.
    """
    if not text:
        return text
    tail = []
    m = CARRIED_DMG.search(text)
    if m:
        text, _ = text[:m.start()] + text[m.end():], tail.append(m.group(1))
    m = STANDALONE_RANGED.search(text)
    if m:
        text = (text[:m.start()] + ' ' + text[m.end():]).strip()
        tail.append("Hero's attacks %s and can hit air units." % m.group(1))
    return ' '.join([text.strip()] + tail).strip()


def note_air_attack(text):
    """Spell out that an attack turned ranged can reach air."""
    if not text or not RANGED.search(text) or MENTIONS_AIR.search(text):
        return text
    return '%s %s' % (text.rstrip(), AIR_NOTE)


# The map closes most tooltips with a "Characteristic" block listing the flat
# bonuses. The site puts every one of those in the STATS grid already, so in the
# description they are the same numbers a second time. "Aura Characteristic"
# heads a different thing -- the aura list -- and stays.
CHARACTERISTIC = re.compile(
    r'(?<!Aura )^[ \t]*Characteristic[ \t]*$'      # the heading, on its own line
    r'(?:\n[ \t]*[+-][^\n]*)*',                    # and the +N lines under it
    re.M)


# Some items skip the heading and just list the bonuses, e.g. the Boots of
# Health open on "+60 Movement Speed". Same duplication, so the same treatment.
STAT_LINE = re.compile(r'^[ \t]*[+-][\d.]+%?[ \t]+[A-Za-z][^\n]*$\n?', re.M)


def drop_characteristic(text):
    """Tooltip without the flat-bonus list the STATS grid already shows.

    Bare bonus lines only go when the tooltip says something besides them --
    stripping every line off "+5 HP Regeneration" would leave the Ring of
    Regeneration with no description at all.
    """
    out = CHARACTERISTIC.sub('', text or '')
    stripped = STAT_LINE.sub('', out)
    if stripped.strip():
        out = stripped
    return re.sub(r'\n{3,}', '\n\n', out).strip()


# The map writes an effect as a bare heading line and then its text. Read as a
# paragraph the heading runs straight into the sentence, so it gets a colon --
# "Trueshot Aura:" then what the aura does.
HEADING = re.compile(r'^(?P<h>[A-Z][A-Za-z\' ]{2,38}(?:\([A-Za-z]+\))?)'
                     r'(?<![.:!?])$\n(?=[ \t]*\S)', re.M)


def heading_colon(text):
    """Tooltip whose effect headings end in a colon."""
    return HEADING.sub(lambda m: m.group('h') + ':\n', text or '')


def polish(text):
    """Every wording rule the site applies to an imported description."""
    return heading_colon(note_air_attack(
        orb_effect_first(drop_characteristic(drop_upgrade_line(text)))))


def tier(text):
    """Upgrade tier encoded as filled vs grey bullets, e.g. '••' of 4 -> (2, 4)."""
    bullets = re.findall(r'\|c(ffffcc00|ff808080)((?:•)+)\|r', text)
    if not bullets:
        return None
    filled = sum(len(b) for c, b in bullets if c == 'ffffcc00')
    total = sum(len(b) for _, b in bullets)
    return filled, total


def item_tooltips(items, wts, abils):
    """{item_code: {'text','raw','tier','abilities'}} for items we can pair."""
    ref = index_by_ability(wts)
    out = {}
    for code, obj in items.items():
        raw_abils = list(obj.get('iabi', {}).values())
        if not raw_abils:
            continue
        granted = [c for c in str(raw_abils[0]).split(',') if c]
        idxs = [i for c in granted for i in ref.get(c, [])]
        if not idxs:
            continue
        best = min(set(idxs), key=lambda i: -len(wts[i]))
        raw = wts[best]
        out[code] = {'text': clean(raw, abils), 'raw': raw,
                     'tier': tier(raw), 'abilities': granted, 'wts': best}
    return out


def main():
    from mpq import MPQArchive
    import w3obj
    import import_map as im

    a = MPQArchive(im.find_map())
    wts = w3obj.parse_wts(a.read_file('war3map.wts').decode('utf-8', 'replace'))
    items = w3obj.index(w3obj.parse(a.read_file('war3map.w3t'), 'w3t'))
    abils = w3obj.index(w3obj.parse(a.read_file('war3map.w3a'), 'w3a'))

    found = item_tooltips(items, wts, abils)
    gold = lambda c: list(items[c].get('igol', {}).values() or [None])[0]
    for code in sorted(found, key=lambda c: (gold(c) or 0)):
        d = found[code]
        t = '%d/%d' % d['tier'] if d['tier'] else '-'
        print('%-6s gold=%-6s tier=%-5s %s' % (code, gold(code), t, d['text'][:150]))
    print('\n%d z %d itemow ma odzyskany opis' % (len(found), len(items)))


if __name__ == '__main__':
    main()
