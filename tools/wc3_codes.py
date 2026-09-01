"""Stock Warcraft III raw codes and object-field ids used by the importer.

The map only stores *overrides*, so anything Mini-Dota leaves alone (names,
descriptions, base attributes) has to be identified by raw code rather than
read out of the archive.
"""

# Tavern heroes. Cross-checked against war3mapMisc.txt [HERO] DependencyOr,
# which is the map's own authoritative list of the 24 playable heroes.
HEROES = {
    'Hpal': 'Paladin',              'Hamg': 'Archmage',
    'Hmkg': 'Mountain King',        'Hblm': 'Blood Mage',
    'Obla': 'Blademaster',          'Ofar': 'Far Seer',
    'Otch': 'Tauren Chieftain',     'Oshd': 'Shadow Hunter',
    'Udea': 'Death Knight',         'Ulic': 'Lich',
    'Udre': 'Dreadlord',            'Ucrl': 'Crypt Lord',
    'Ekee': 'Keeper of the Grove',  'Emoo': 'Priestess of the Moon',
    'Edem': 'Demon Hunter',         'Ewar': 'Warden',
    'Nbst': 'Beastmaster',          'Nalc': 'Alchemist',
    'Nngs': 'Sea Witch',            'Npbm': 'Brewmaster',
    'Nplh': 'Pit Lord',             'Ntin': 'Tinker',
    'Nbrn': 'Dark Ranger',          'Nfir': 'Firelord',
}

# Ability fields whose meaning is identical for every ability, so they can be
# applied without any per-ability knowledge.
ABILITY_FIELDS = {
    'amcs': 'mana',
    'acdn': 'cooldown',
    'aran': 'range',
    'aare': 'area',
    # Two different numbers, resolved through KEY_SYNONYMS to whatever the
    # ability already calls them; both land on a bare "duration" when it has
    # only one, with ahdu winning by field order.
    'ahdu': 'duration_heroes',
    'adur': 'duration_units',
    'acas': 'cast_time',
}
# ahdu must be applied after adur so it overwrites it
ABILITY_FIELD_ORDER = ['adur', 'ahdu', 'amcs', 'acdn', 'aran', 'aare', 'acas']

# Attribute-bonus ability every hero carries; never a real spell.
ATTRIBUTE_BONUS = 'Aamk'

# Stock hero spells by raw code. The map never renames these, so this table is
# what lets abilities be matched by name instead of by position in uhab --
# the two orders disagree for about a third of the heroes.
ABILITY_NAMES = {
    # human
    'AHbz': 'Blizzard', 'AHwe': 'Summon Water Elemental',
    'AHab': 'Brilliance Aura', 'AHmt': 'Mass Teleport',
    'AHhb': 'Holy Light', 'AHds': 'Divine Shield',
    'AHad': 'Devotion Aura', 'AHre': 'Resurrection',
    'AHtb': 'Storm Bolt', 'AHtc': 'Thunder Clap',
    'AHbh': 'Bash', 'AHav': 'Avatar',
    'AHfs': 'Flame Strike', 'AHbn': 'Banish',
    'AHdr': 'Siphon Mana', 'AHpx': 'Phoenix',
    'AHfa': 'Searing Arrows',
    # orc
    'AOwk': 'Wind Walk', 'AOcr': 'Critical Strike',
    'AOmi': 'Mirror Image', 'AOww': 'Bladestorm',
    'AOcl': 'Chain Lightning', 'AOfs': 'Far Sight',
    'AOsf': 'Feral Spirit', 'AOeq': 'Earthquake',
    'AOsh': 'Shockwave', 'AOws': 'War Stomp',
    'AOae': 'Endurance Aura', 'AOre': 'Reincarnation',
    'AOhw': 'Healing Wave', 'AOhx': 'Hex',
    'AOsw': 'Serpent Ward', 'AOvd': 'Big Bad Voodoo',
    # undead
    # dp = death pact, au = aura unholy, cs = carrion swarm, av = aura vampiric
    'AUdc': 'Death Coil', 'AUdp': 'Death Pact',
    'AUau': 'Unholy Aura', 'AUan': 'Animate Dead', 'AUa2': 'Animate Dead',
    'AUfn': 'Frost Nova', 'AUfu': 'Frost Armor',
    'AUdr': 'Dark Ritual', 'AUdd': 'Death and Decay',
    'AUcs': 'Carrion Swarm', 'AUsl': 'Sleep',
    'AUav': 'Vampiric Aura', 'AUin': 'Inferno',
    'AUim': 'Impale', 'AUts': 'Spiked Carapace',
    'AUcb': 'Carrion Beetles', 'AUls': 'Locust Swarm',
    # night elf
    'AEmb': 'Mana Burn', 'AEim': 'Immolation',
    'AEev': 'Evasion', 'AEme': 'Metamorphosis',
    'AEer': 'Entangling Roots', 'AEfn': 'Force of Nature',
    'AEah': 'Thorns Aura', 'AEtq': 'Tranquility',
    'AEst': 'Scout', 'AEar': 'Trueshot Aura', 'AEsf': 'Starfall',
    'AEbl': 'Blink', 'AEfk': 'Fan of Knives',
    'AEsh': 'Shadow Strike', 'AEsv': 'Vengeance',
    # neutral
    'ANbf': 'Breath of Fire', 'ANdh': 'Drunken Haze',
    'ANdb': 'Drunken Brawler', 'ANef': 'Storm, Earth and Fire',
    'ANsg': 'Summon Bear', 'ANsq': 'Summon Quilbeast',
    'ANsw': 'Summon Hawk', 'ANst': 'Stampede',
    'ANhs': 'Healing Spray', 'ANab': 'Acid Bomb',
    'ANcr': 'Chemical Rage', 'ANtm': 'Transmute',
    'ANfl': 'Forked Lightning', 'ANfa': 'Frost Arrows',
    'ANms': 'Mana Shield', 'ANto': 'Tornado',
    'ANca': 'Cleaving Attack', 'ANrf': 'Rain of Fire',
    'ANht': 'Howl of Terror', 'ANdo': 'Doom',
    'ANsy': 'Pocket Factory', 'ANcs': 'Cluster Rockets',
    'ANeg': 'Engineering Upgrade', 'ANrg': 'Robo-Goblin',
    'ANsi': 'Silence', 'ANba': 'Black Arrow',
    'ANdr': 'Life Drain', 'ANch': 'Charm',
    'ANia': 'Incinerate', 'ANso': 'Soul Burn',
    'ANlm': 'Summon Lava Spawn', 'ANvc': 'Volcano',
}

# Where the site spells a stock ability differently.
ABILITY_ALIASES = {
    'goblinfactory': 'pocketfactory',
    'waterelemental': 'summonwaterelemental',
    'summonlavaspawn': 'summonlavaspawn',
    'stormearthandfire': 'stormearthandfire',
}


def normalize(name):
    key = ''.join(ch for ch in str(name).lower() if ch.isalnum())
    return ABILITY_ALIASES.get(key, key)

# The two buildings that sell mercenaries. Unit names come from the map itself
# (utip), so only the roster needs declaring here.
#
# The Mercenary Camp publishes its stock in the unit's useu field, so it stays
# in sync on its own. The Goblin Laboratory -- the map names the building
# "Workshop" -- leaves its stock at the stock Voodoo Lounge default, so nothing
# in the object data says what it sells and the three units are listed by hand.
MERC_SHOPS = [
    {'code': 'nmer', 'building': 'Mercenary Camp', 'from_map': True},
    {'code': 'o009', 'building': 'Goblin Laboratory', 'from_map': False,
     'units': ['nzep', 'ngsp', 'ngir']},
]

UNIT_FIELDS = {
    'uhpm': 'health',
    'umpm': 'mana_max',
    'udef': 'armor',
    'ua1b': 'damage_base',
    'ubdi': 'damage_dice',
    'ubsi': 'damage_sides',
    'umvs': 'move_speed',
    'ugol': 'cost',
    'ulum': 'cost_lumber',
    'ua1c': 'attack_speed',
}

ITEM_FIELDS = {
    'igol': 'cost',
    'ilum': 'cost_lumber',
    'ilev': 'level',
    'iusa': 'uses',
    'isto': 'stock_max',
}
