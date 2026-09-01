"""Convert Warcraft III command-button icons to PNGs the site can show.

Browsers cannot display .dds (the base-game format) or .blp (the format the map
imports), so both are decoded and written to icons/ as PNG. Entries in
data/*.json then point at a single image instead of a spritesheet offset.

    python tools/icons.py            # report what resolves, write nothing
    python tools/icons.py --write    # convert and update data/*.json
"""
import argparse
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_ICONS = os.path.join(ROOT, 'war3.w3mod', 'replaceabletextures', 'commandbuttons')
OUT_DIR = os.path.join(ROOT, 'icons')
OUT_REL = 'icons'

# The base-game icon file rarely matches the display name: units are named after
# what Mini-Dota calls them, the file after the stock Warcraft III unit. Values
# are tried in order, so a name with several plausible spellings can list them.
NAME_OVERRIDES = {
    'mudgolem': ['rockgolem'],
    'zeppelin': ['goblinzeppelin'],
    'sapper': ['goblinsapper'],
    # the Shredder reuses the Junk Golem art; there is no btnshredder
    'shredder': ['junkgolem'],
}


# Heroes are listed in full rather than guessed. Fuzzy matching on these names
# is actively dangerous: it silently hands Brewmaster the Blademaster portrait
# and Firelord the Dreadlord one, and a wrong icon looks like working data.
HERO_ICONS = {
    'Alchemist': 'heroalchemist',
    'Archmage': 'heroarchmage',
    'Beastmaster': 'beastmaster',
    'Blademaster': 'heroblademaster',
    'Blood Mage': 'herobloodelfprince',
    'Brewmaster': 'pandarenbrewmaster',
    'Crypt Lord': 'herocryptlord',
    'Dark Ranger': 'bansheeranger',
    'Death Knight': 'herodeathknight',
    'Demon Hunter': 'herodemonhunter',
    'Dreadlord': 'herodreadlord',
    'Far Seer': 'herofarseer',
    'Firelord': 'heroavatarofflame',
    'Keeper of the Grove': 'keeperofthegrove',
    'Lich': 'lichversion2',
    'Mountain King': 'heromountainking',
    'Paladin': 'heropaladin',
    'Pit Lord': 'pitlord',
    'Priestess of the Moon': 'priestessofthemoon',
    'Sea Witch': 'nagaseawitch',
    'Shadow Hunter': 'shadowhunter',
    'Tauren Chieftain': 'herotaurenchieftain',
    'Tinker': 'herotinker',
    'Warden': 'herowarden',
}


# Items whose art file is named after something other than the item. Same rule
# as the heroes: spelled out, never guessed.
ITEM_ICONS = {
    'Orb of Slow': 'orbofslowness',
    'Battle Standard': 'orcbattlestandard',
    'Flute of Accuracy': 'alleriaflute',
    'Warsong Battle Drums': 'drum',
    'Boots of Strength': 'wirtsleg',
    'Boots of Health': 'wirtsleg',       # pre-1.3.9 name
    'Scepter of Avarice': 'transmute',
    # the map calls it "Frost Claws"; the site still says "Frost Claw"
    'Frost Claw': 'shamanadept',
    'Frost Claws': 'shamanadept',
    'Lightning Claws': 'shamanmaster',
    'Firebrand Gauntlets': 'advancedunholystrength',
    'Firehand Gauntlets': 'advancedunholystrength',
    'Command Shield': 'arcanitearmor',
    'Voodoo Doll': 'shadowpact',
    'Potion of Invisibility': 'lesserinvisibility',
    'Scroll of Resurrection': 'snazzyscroll',
    'Frostguard': 'thoriummelee',
    'Tome of Experience': 'tomebrown',
    'Gem of True Seeing': 'gem',
    'Drake Egg': 'azuredragon',
    'Inferno Stone': 'infernalstone',
    'Deathguard': 'lightningshield',
    'Shield of the Deathlord': 'lightningshield',   # pre-rename name
    'Devotion Shield': 'humanarmorupthree',
    'Scroll of Speed': 'scrollofhaste',
    'Wand of the Wind': 'wandofcyclone',
    'Wand of Illusion': 'wand',
    'Sentry Wards': 'sentryward',
    'Sentry Ward': 'sentryward',
    # this one is not a base-game icon -- it is imported into the map itself
    'Claws of Attack +15': 'claws+15',
    'Killmaim': 'spiritwalkeradepttraining',
    'Searing Blade': 'arcanitemelee',
    'Maul of Strength': 'hammer',
    'Corrupted Gauntlets': 'improvedunholystrength',
    'Trueshot Shield': 'thoriumarmor',
    'Gold Coins': 'chestofgold',
    'Blink Dagger of Escape': 'daggerofescape',
    'Demonic Figurine': 'doomguard',
    'Tome of Intelligence +2': 'tome',
    'Goblin Land Mines': 'goblinlandmine',
    'Ancestral Staff': 'witchdoctormaster',
    'Cloak of Shadows': 'cloak',
    'Stone Token': 'rockgolem',
    # only in the map, same art the Tome of Power uses
    'Tome of Knowledge +1': 'tomeYellow',
    'Tome of Power': 'tomered',
}


# Abilities whose art file is not named after the spell. Same rule as the
# heroes and items: every one of these was read off the icon folder and matched
# by hand, never guessed. A spell that is not in here and whose btn<name>.dds
# does not exist keeps `"icon": null`, and the site draws a black tile -- a
# visible gap is worth more than a plausible wrong picture.
ABILITY_ICONS = {
    'Holy Light': 'holybolt',
    'Divine Shield': 'divineintervention',
    'Devotion Aura': 'devotion',
    'Brilliance Aura': 'brilliance',
    'Wind Walk': 'windwalkon',
    'Bladestorm': 'whirlwind',
    'Feral Spirit': 'spiritwolf',
    'Big Bad Voodoo': 'bigbadvoodoospell',
    'Inferno': 'infernal',
    'Carrion Beetles': 'carrionscarabs',
    'Thorns Aura': 'thorns',
    'Trueshot Aura': 'trueshot',
    'Immolation': 'immolationon',
    'Vengeance': 'spiritofvengeance',
    'Frost Arrows': 'coldarrows',
    'Black Arrow': 'theblackarrow',
    'Summon Lava Spawn': 'lavaspawn',
    'Summon Bear': 'grizzlybear',
    'Summon Quilbeast': 'quillbeast',
    'Storm, Earth and Fire': 'stormearth&fire',
    # the map renames the Tinker's Pocket Factory
    'Goblin Factory': 'pocketfactory',
    # read off the map's own aart paths, supplied by hand
    'Flame Strike': 'walloffire',
    'Siphon Mana': 'manadrain',
    'Phoenix': 'markoffire',
    'Endurance Aura': 'command',
    'Frost Nova': 'glacier',
    'Spiked Carapace': 'thornshield',
    'Force of Nature': 'ent',
    'Forked Lightning': 'monsoon',
    'Mana Shield': 'neutralmanashield',
    'Drunken Haze': 'strongdrink',
    'Drunken Brawler': 'drunkendodge',
    'Rain of Fire': 'fire',
    'Summon Hawk': 'wareagle',
}


def slug(name):
    return re.sub(r'[^a-z0-9]', '', str(name).lower())


def base_icon_path(name, uico=None):
    """Locate a .dds for a display name, preferring the map's own icon path."""
    stems = []
    if uico:
        stems.append(slug(os.path.basename(str(uico).replace('\\', '/')).rsplit('.', 1)[0]))
    key = slug(name)
    stems.extend(NAME_OVERRIDES.get(key, [key]))
    for stem in stems:
        stem = stem[3:] if stem.startswith('btn') else stem
        p = os.path.join(BASE_ICONS, 'btn%s.dds' % stem)
        if os.path.exists(p):
            return p
    return None


def convert(src, out_name):
    """Decode a .dds/.blp to RGBA PNG. Returns the site-relative path."""
    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, out_name + '.png')
    with Image.open(src) if isinstance(src, str) else Image.open(io.BytesIO(src)) as im:
        im.convert('RGBA').save(dest)
    return '%s/%s.png' % (OUT_REL, out_name)


def do_abilities(args):
    """One PNG per hero ability, replacing the screenshot spritesheets.

    The site's abilities carry no code of their own, so the pairing the
    importer already does -- hero selector order first, uhab by name second --
    is reused to reach each spell's object data. Stock spells (AHbz, AOwk...)
    never override `aart`, so their art is found by name against the base-game
    icons; only a spell the map itself re-skins resolves through the field.
    """
    import import_map as im
    from wc3_codes import HEROES
    from mpq import MPQArchive

    path = os.path.join(ROOT, 'data', 'heroes.json')
    doc = json.load(open(path, encoding='utf-8'))
    by_name = {h['name']: h for h in doc['heroes']}
    archive = MPQArchive(im.find_map())
    m = im.load(im.find_map())
    rep = im.Report()

    print('=== heroes.json / abilities ===')
    done, blank = [], []
    for code, name in sorted(HEROES.items(), key=lambda kv: kv[1]):
        hero = by_name.get(name)
        if hero is None:
            continue
        codes = m['selector'].get(code) or im.hero_ability_codes(m['units'], code)
        if not codes:
            rep.note('%s: brak listy spelli, pomijam' % name)
            continue
        for acode, sab in im.pair_abilities(name, codes, hero.get('abilities', []),
                                            rep, code in m['selector']):
            src = png = None
            art = im.one(m['abils'].get(acode, {}), 'aart')
            if art:                                   # the map re-skinned it
                blob = archive.read_file(str(art))
                if blob:
                    src, png = 'mapa/' + os.path.basename(str(art)), blob
                else:
                    cand = base_icon_path(sab['name'], art)
                    if cand:
                        src, png = os.path.basename(cand), cand
            if png is None:
                stem = ABILITY_ICONS.get(sab['name'], slug(sab['name']))
                cand = os.path.join(BASE_ICONS, 'btn%s.dds' % stem)
                if os.path.exists(cand):
                    src, png = os.path.basename(cand), cand
            if png is None:
                if args.write:
                    sab['icon'] = None                # the site draws a black tile
                blank.append('%s / %s' % (name, sab['name']))
                continue
            if args.write:
                sab['icon'] = convert(png, 'spell-' + slug(sab['name']))
            done.append(sab['name'])
            print('  %-22s %-26s %s' % (name[:22], sab['name'][:26], src))

    print('  -> %d z %d' % (len(done), len(done) + len(blank)))
    if blank:
        print('  czarny kafelek: %s' % ', '.join(blank))
    if args.write:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write('\n')
    for n in rep.notes:
        print('  uwaga: %s' % n)
    return len(done), blank


def do_items(args):
    """Every item the map can supply art for.

    Resolution order is the map's own iico field first -- the only
    authoritative statement of which art an item uses -- then an exact name
    match against the base-game icons; never a fuzzy one. Upgrade tiers
    (Claws of Attack +15 and friends) resolve through iico to BLPs imported
    into the map itself, so they come out of the archive rather than off disk.
    """
    import import_map as im
    from mpq import MPQArchive

    path = os.path.join(ROOT, 'data', 'items.json')
    doc = json.load(open(path, encoding='utf-8'))
    archive = MPQArchive(im.find_map())
    m = im.load(im.find_map())

    print('=== items.json ===')
    done, wanted = [], []
    for it in doc['items']:
        code = it.get('raw_code')
        uico = im.one(m['items'].get(code, {}), 'iico') if code else None
        src = png = None

        if it['name'] in ITEM_ICONS:
            stem = ITEM_ICONS[it['name']]
            cand = os.path.join(BASE_ICONS, 'btn%s.dds' % stem)
            if os.path.exists(cand):
                src, png, uico = os.path.basename(cand), cand, None
            else:   # fall back to a BLP imported into the map
                blob = archive.read_file(
                    'ReplaceableTextures\CommandButtons\BTN%s.blp' % stem)
                if blob:
                    src, png, uico = 'mapa/BTN%s.blp' % stem, blob, None
        if uico:
            blob = archive.read_file(str(uico))
            if blob:                                  # imported into the map
                src, png = 'mapa/' + os.path.basename(str(uico)), blob
            else:
                stem = slug(os.path.basename(str(uico).replace('\\', '/')).rsplit('.', 1)[0])
                stem = stem[3:] if stem.startswith('btn') else stem
                cand = os.path.join(BASE_ICONS, 'btn%s.dds' % stem)
                if os.path.exists(cand):
                    src, png = os.path.basename(cand), cand
                else:
                    wanted.append('btn%s.dds (%s)' % (stem, it['name']))
        if png is None:
            cand = os.path.join(BASE_ICONS, 'btn%s.dds' % slug(it['name']))
            if os.path.exists(cand):
                src, png = os.path.basename(cand), cand
            elif not uico:
                wanted.append('btn%s.dds (%s)' % (slug(it['name']), it['name']))
        if png is None:
            continue

        if args.write:
            it['icon'] = convert(png, slug(it['name']))
            it['icon_index'] = None
        done.append(it['name'])
        print('  %-30s %s' % (it['name'][:30], src))

    print('  -> %d podmienionych' % len(done))
    if args.write:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write('\n')
    return len(done), wanted


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    # Portraits and item art are settled; re-running those jobs only churns
    # data/*.json, so the ability pass can be asked for on its own.
    ap.add_argument('--abilities', action='store_true',
                    help='tylko ikony umiejetnosci bohaterow')
    args = ap.parse_args()

    if not os.path.isdir(BASE_ICONS):
        sys.exit('brak katalogu %s' % BASE_ICONS)

    if args.abilities:
        n, blank = do_abilities(args)
        if not args.write:
            print('\nnic nie zapisano; --write konwertuje i aktualizuje heroes.json')
        else:
            print('\nzapisano %d PNG do %s/' % (n, OUT_REL))
        return

    jobs = [('mercs.json', 'mercs', None),
            ('heroes.json', 'heroes', HERO_ICONS)]
    total_done, total_missing, written = 0, [], []

    for filename, key, table in jobs:
        path = os.path.join(ROOT, 'data', filename)
        doc = json.load(open(path, encoding='utf-8'))
        print('=== %s ===' % filename)
        done, missing = [], []
        for entry in doc[key]:
            name = entry['name']
            src = (os.path.join(BASE_ICONS, 'btn%s.dds' % table[name])
                   if table and name in table else base_icon_path(name))
            if not src or not os.path.exists(src):
                missing.append(name)
                continue
            if args.write:
                entry['icon'] = convert(src, slug(name))
                entry['icon_index'] = None   # a whole image, not a sheet offset
            done.append((name, os.path.basename(src)))
            print('  %-24s %s' % (name, os.path.basename(src)))
        print('  -> %d z %d' % (len(done), len(doc[key])))
        if missing:
            print('  brak: %s' % ', '.join(missing))
        total_done += len(done)
        total_missing += missing
        written.append((path, doc))

    n, wanted = do_items(args)
    total_done += n
    total_missing += wanted

    if not args.write:
        print('\nnic nie zapisano; --write konwertuje i aktualizuje data/*.json')
        return
    for path, doc in written:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write('\n')
    print('\nzapisano %d PNG do %s/' % (total_done, OUT_REL))
    if total_missing:
        print('bez ikony: %s' % ', '.join(total_missing))


if __name__ == '__main__':
    main()
