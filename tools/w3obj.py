"""Parser for Warcraft III Object Editor data files (.w3t/.w3u/.w3a/.w3o).

Each table holds two sections: "original" entries patch a stock object in place
(their new-id is four NUL bytes), "custom" entries derive a fresh object from a
stock base.
"""
import struct

# file kinds whose modifications carry a level + data-pointer field
LEVELED = {'w3a', 'w3q', 'w3d', 'w3b'}


class _Reader:
    def __init__(self, b):
        self.b, self.i = b, 0

    def u32(self):
        v = struct.unpack_from('<I', self.b, self.i)[0]; self.i += 4; return v

    def i32(self):
        v = struct.unpack_from('<i', self.b, self.i)[0]; self.i += 4; return v

    def f32(self):
        v = struct.unpack_from('<f', self.b, self.i)[0]; self.i += 4; return v

    def id4(self):
        v = self.b[self.i:self.i + 4]; self.i += 4
        return v.decode('latin-1')

    def cstr(self):
        e = self.b.index(b'\x00', self.i)
        v = self.b[self.i:e].decode('utf-8', 'replace'); self.i = e + 1; return v


def _parse_table(r, kind, version):
    out = []
    for _ in range(r.u32()):
        base, new = r.id4(), r.id4()
        if not new.strip('\x00'):              # original-table entry patches base
            new = None
        if version >= 3:                       # Reforged variation-set list
            for _ in range(r.u32()):
                r.u32()
        mods = []
        for _ in range(r.u32()):
            mid, vt = r.id4(), r.u32()
            level = None
            if kind in LEVELED:
                level = r.u32(); r.u32()       # level, data-pointer
            val = {0: r.i32, 1: r.f32, 2: r.f32, 3: r.cstr}[vt]()
            r.i32()                            # end token
            mods.append({'id': mid, 'level': level, 'value': val})
        out.append({'base': base, 'new': new, 'id': new or base, 'mods': mods})
    return out


def parse(data, kind):
    """kind: 'w3t','w3u','w3a',... -> {'version','original','custom'}"""
    r = _Reader(data)
    v = r.u32()
    return {'version': v,
            'original': _parse_table(r, kind, v),
            'custom': _parse_table(r, kind, v)}


def index(parsed):
    """Collapse both tables into {object_id: {field_id: {level: value}}}.

    Custom entries win over original ones for the same id, and later entries
    win over earlier ones, matching how the World Editor layers its saves.
    """
    out = {}
    for entry in parsed['original'] + parsed['custom']:
        obj = out.setdefault(entry['id'], {})
        for m in entry['mods']:
            obj.setdefault(m['id'], {})[m['level'] or 0] = m['value']
    return out


def parse_wts(text):
    """war3map.wts -> {index: string}, for resolving TRIGSTR_nnn references."""
    out, lines, i = {}, text.splitlines(), 0
    while i < len(lines):
        s = lines[i].strip()
        if s.startswith('STRING'):
            try:
                key = int(s.split()[1])
            except (IndexError, ValueError):
                i += 1; continue
            while i < len(lines) and lines[i].strip() != '{':
                i += 1
            i += 1
            buf = []
            while i < len(lines) and lines[i].strip() != '}':
                buf.append(lines[i]); i += 1
            out[key] = '\n'.join(buf).strip()
        i += 1
    return out


def resolve(value, wts):
    """Swap a TRIGSTR_nnn placeholder for its war3map.wts text."""
    if isinstance(value, str) and value.startswith('TRIGSTR_'):
        try:
            return wts.get(int(value[8:]), value)
        except ValueError:
            pass
    return value
