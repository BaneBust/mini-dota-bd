"""Propose `raw_code` values for data/items.json by matching against the map.

The map carries no item names, so a link has to be argued from evidence. Three
independent signals are used and at least two must agree before a link is
accepted, then assignment is forced one-to-one so a single map item can never
claim two site entries:

  cost      the map's igol equals the site's cost exactly
  text      recovered tooltip (see tooltips.py) overlaps the site description
  mnemonic  the 4-letter code reads as an abbreviation of the name,
            e.g. vddl -> Voodoo Doll, mlst -> Maul of Strength

    python tools/link_items.py            # report proposals, write nothing
    python tools/link_items.py --write    # fill in raw_code where accepted
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_map as im
import tooltips as tt
import w3obj
from mpq import MPQArchive

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS = os.path.join(ROOT, 'data', 'items.json')

TEXT_FLOOR = 0.30      # jaccard below this is noise
ACCEPT = 2             # signals that must agree


def letters(text):
    return re.sub(r'[^a-z0-9]', '', str(text).lower())


def words(text):
    return set(re.findall(r'[a-z]{4,}', str(text).lower()))


STOPWORDS = {'of', 'the', 'a', 'and'}
HEAD = 5       # a code letter must land in the first 5 chars of a word


def is_mnemonic(code, name):
    """True if the code reads as an abbreviation built from word beginnings.

    A plain subsequence test is far too loose on long names -- it happily reads
    'rhth' (Ring of Health) out of "Crown of the Deathlord". Requiring each
    letter to sit near the start of a word, with words consumed left to right,
    keeps vddl -> Voodoo Doll while rejecting that.
    """
    parts = [w for w in re.split(r'[^a-z0-9]+', str(name).lower())
             if w and w not in STOPWORDS]
    if not parts:
        return False
    wi, pos = 0, 0
    for ch in letters(code):
        while wi < len(parts):
            hit = parts[wi].find(ch, pos)
            if hit != -1 and hit < HEAD:
                pos = hit + 1
                break
            wi, pos = wi + 1, 0
        else:
            return False
    return True


def score(item, code, obj, tooltip):
    cost = list(obj['igol'].values())[0] if 'igol' in obj else None
    signals, detail = 0, []

    if cost is not None and cost == item.get('cost'):
        signals += 1
        detail.append('cost')

    text = 0.0
    if tooltip:
        w1, w2 = words(item.get('description', '')), words(tooltip['text'])
        if w1 and w2:
            text = len(w1 & w2) / len(w1 | w2)
    if text >= TEXT_FLOOR:
        signals += 1
        detail.append('text=%.2f' % text)

    if is_mnemonic(code, item["name"]):
        signals += 1
        detail.append('mnemonic')

    return signals, text, detail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--map')
    args = ap.parse_args()

    a = MPQArchive(args.map or im.find_map())
    wts = w3obj.parse_wts(a.read_file('war3map.wts').decode('utf-8', 'replace'))
    items = w3obj.index(w3obj.parse(a.read_file('war3map.w3t'), 'w3t'))
    abils = w3obj.index(w3obj.parse(a.read_file('war3map.w3a'), 'w3a'))
    recovered = tt.item_tooltips(items, wts, abils)

    doc = json.load(open(ITEMS, encoding='utf-8'))
    site = doc['items']

    # score every pair, then hand out codes best-first so each is used once
    cands = []
    for item in site:
        for code, obj in items.items():
            n, text, detail = score(item, code, obj, recovered.get(code))
            if n >= ACCEPT:
                cands.append((n + text, n, item['id'], code, detail))
    cands.sort(reverse=True)

    taken_site, taken_code, links = set(), set(), []
    for total, n, sid, code, detail in cands:
        if sid in taken_site or code in taken_code:
            continue
        taken_site.add(sid)
        taken_code.add(code)
        links.append((sid, code, n, detail))

    by_id = {i['id']: i for i in site}
    print('%-30s %-6s %-3s %s' % ('item', 'code', 'sig', 'dowody'))
    for sid, code, n, detail in sorted(links, key=lambda r: -r[2]):
        print('%-30s %-6s %-3d %s' % (by_id[sid]['name'][:30], code, n, ', '.join(detail)))
    print('\npowiazano %d ze %d itemow' % (len(links), len(site)))
    missing = [i['name'] for i in site if i['id'] not in taken_site]
    print('bez kodu (%d): %s' % (len(missing), ', '.join(missing[:14])))

    if not args.write:
        print('\nnic nie zapisano; --write wpisuje raw_code')
        return
    found = dict((sid, code) for sid, code, _, _ in links)
    for item in site:
        item['raw_code'] = found.get(item['id'], item.get('raw_code'))
    with open(ITEMS, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('\nzapisano raw_code do data/items.json')


if __name__ == '__main__':
    main()
