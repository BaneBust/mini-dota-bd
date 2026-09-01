"""Minimal MPQ archive reader, enough to pull war3map.* out of a .w3x/.w3m.

mpyq handles the hash/block tables but bails on encrypted files and on every
compression except zlib/bzip2. World Editor writes most war3map.* entries with
PKWARE implode, so this module adds file decryption, a blast.c port and the
sparse codec.
"""
import bz2
import struct
import zlib

MPQ_FILE_IMPLODE = 0x00000100
MPQ_FILE_COMPRESS = 0x00000200
MPQ_FILE_ENCRYPTED = 0x00010000
MPQ_FILE_FIX_KEY = 0x00020000
MPQ_FILE_SINGLE_UNIT = 0x01000000
MPQ_FILE_SECTOR_CRC = 0x04000000
MPQ_FILE_EXISTS = 0x80000000


def _build_crypt_table():
    t, seed = {}, 0x00100001
    for i in range(256):
        idx = i
        for _ in range(5):
            seed = (seed * 125 + 3) % 0x2AAAAB
            t1 = (seed & 0xFFFF) << 0x10
            seed = (seed * 125 + 3) % 0x2AAAAB
            t2 = seed & 0xFFFF
            t[idx] = t1 | t2
            idx += 0x100
    return t


CRYPT = _build_crypt_table()
HASH_TYPES = {'TABLE_OFFSET': 0, 'HASH_A': 1, 'HASH_B': 2, 'TABLE': 3}


def mpq_hash(string, hash_type):
    seed1, seed2 = 0x7FED7FED, 0xEEEEEEEE
    for ch in string.upper():
        value = CRYPT[(HASH_TYPES[hash_type] << 8) + ord(ch)]
        seed1 = (value ^ (seed1 + seed2)) & 0xFFFFFFFF
        seed2 = (ord(ch) + seed1 + seed2 + (seed2 << 5) + 3) & 0xFFFFFFFF
    return seed1


def decrypt(data, key):
    """Decrypt a run of little-endian uint32s with the MPQ stream cipher."""
    seed, out = 0xEEEEEEEE, bytearray()
    for i in range(len(data) // 4):
        seed = (seed + CRYPT[0x400 + (key & 0xFF)]) & 0xFFFFFFFF
        ch = struct.unpack_from('<I', data, i * 4)[0] ^ ((key + seed) & 0xFFFFFFFF)
        ch &= 0xFFFFFFFF
        key = (((~key << 0x15) + 0x11111111) | (key >> 0x0B)) & 0xFFFFFFFF
        seed = (ch + seed + (seed << 5) + 3) & 0xFFFFFFFF
        out += struct.pack('<I', ch)
    out += data[len(data) // 4 * 4:]          # trailing bytes stay as-is
    return bytes(out)


# --- PKWARE DCL "implode" decoder, ported from Mark Adler's blast.c ----------

_LITLEN = [11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8,
           9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5,
           7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12,
           8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27,
           44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45,
           44, 173]
_LENLEN = [2, 35, 36, 53, 38, 23]
_DISTLEN = [2, 20, 53, 230, 247, 151, 248]
_LENBASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264]
_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]
_MAXBITS = 13


class _Huffman:
    def __init__(self, rep):
        lengths = []
        for byte in rep:
            lengths += [byte & 15] * ((byte >> 4) + 1)
        n = len(lengths)
        self.count = [0] * (_MAXBITS + 1)
        for l in lengths:
            self.count[l] += 1
        offs = [0] * (_MAXBITS + 1)
        for i in range(1, _MAXBITS):
            offs[i + 1] = offs[i] + self.count[i]
        self.symbol = [0] * n
        for sym, l in enumerate(lengths):
            if l:
                self.symbol[offs[l]] = sym
                offs[l] += 1


_LITCODE, _LENCODE, _DISTCODE = _Huffman(_LITLEN), _Huffman(_LENLEN), _Huffman(_DISTLEN)


class _Bits:
    def __init__(self, data):
        self.d, self.pos, self.bitbuf, self.bitcnt = data, 0, 0, 0

    def bits(self, need):
        val = self.bitbuf
        while self.bitcnt < need:
            val |= self.d[self.pos] << self.bitcnt
            self.pos += 1
            self.bitcnt += 8
        self.bitbuf = val >> need
        self.bitcnt -= need
        return val & ((1 << need) - 1)

    def decode(self, h):
        code = first = index = 0
        for length in range(1, _MAXBITS + 1):
            code |= self.bits(1) ^ 1              # codes are stored inverted
            count = h.count[length]
            if code - count < first:
                return h.symbol[index + (code - first)]
            index += count
            first = (first + count) << 1
            code <<= 1
        raise ValueError('invalid implode code')


def explode(data):
    s = _Bits(data)
    lit, dictbits = s.bits(8), s.bits(8)
    if lit > 1 or not 4 <= dictbits <= 6:
        raise ValueError('bad implode header')
    out = bytearray()
    while True:
        if s.bits(1):                              # length/distance pair
            sym = s.decode(_LENCODE)
            length = _LENBASE[sym] + s.bits(_EXTRA[sym])
            if length == 519:
                break
            shift = 2 if length == 2 else dictbits
            dist = (s.decode(_DISTCODE) << shift) + s.bits(shift) + 1
            for _ in range(length):
                out.append(out[-dist])
        else:
            out.append(s.decode(_LITCODE) if lit else s.bits(8))
    return bytes(out)


def _sparse_decompress(data):
    out, i = bytearray(), 4                        # first 4 bytes: output size
    while i < len(data):
        ctrl = data[i]; i += 1
        if ctrl & 0x80:
            n = (ctrl & 0x7F) + 1
            out += data[i:i + n]; i += n
        else:
            out += b'\x00' * ((ctrl & 0x7F) + 3)
    return bytes(out)


def _decompress(data):
    """Multi-compression byte: bits say which codecs were stacked."""
    mask, body = data[0], data[1:]
    if mask & 0x40:
        raise ValueError('ADPCM audio compression not supported')
    if mask & 0x80:
        raise ValueError('ADPCM audio compression not supported')
    if mask & 0x01:
        raise ValueError('huffman compression not supported')
    if mask & 0x02:
        body = zlib.decompress(body)
    if mask & 0x08:
        body = explode(body)
    if mask & 0x10:
        body = bz2.decompress(body)
    if mask & 0x20:
        body = _sparse_decompress(body)
    if mask in (0x00,):
        return body
    if not mask & 0x3B:
        raise ValueError('unknown compression mask 0x%02X' % mask)
    return body


class MPQArchive:
    def __init__(self, path):
        raw = open(path, 'rb').read() if isinstance(path, str) else path
        off = raw.find(b'MPQ\x1a')                 # .w3x prepends a 512b header
        if off < 0:
            raise ValueError('no MPQ signature found')
        self.raw, self.base = raw, off
        (_, header_size, _, fmt, self.sector_shift,
         hash_pos, block_pos, hash_count, block_count) = struct.unpack_from(
            '<4sIIHHIIII', raw, off)
        self.hash_table = self._read_table(off + hash_pos, hash_count, 4, '(hash table)')
        self.block_table = self._read_table(off + block_pos, block_count, 4, '(block table)')

    def _read_table(self, pos, count, words, key_name):
        data = decrypt(self.raw[pos:pos + count * words * 4], mpq_hash(key_name, 'TABLE'))
        return [struct.unpack_from('<4I', data, i * 16) for i in range(count)]

    def _find(self, name):
        idx = mpq_hash(name, 'TABLE_OFFSET') & (len(self.hash_table) - 1)
        a, b = mpq_hash(name, 'HASH_A'), mpq_hash(name, 'HASH_B')
        for i in range(len(self.hash_table)):
            e = self.hash_table[(idx + i) % len(self.hash_table)]
            if e[3] == 0xFFFFFFFF:
                return None
            if e[0] == a and e[1] == b:
                return e[3]
        return None

    def read_file(self, name):
        bi = self._find(name)
        if bi is None or bi >= len(self.block_table):
            return None
        offset, archived, size, flags = self.block_table[bi]
        if not flags & MPQ_FILE_EXISTS or archived == 0:
            return None
        data = self.raw[self.base + offset:self.base + offset + archived]

        key = None
        if flags & MPQ_FILE_ENCRYPTED:
            key = mpq_hash(name.rsplit('\\', 1)[-1], 'TABLE')
            if flags & MPQ_FILE_FIX_KEY:
                key = ((key + offset) ^ size) & 0xFFFFFFFF

        compressed = flags & (MPQ_FILE_COMPRESS | MPQ_FILE_IMPLODE)
        if flags & MPQ_FILE_SINGLE_UNIT:
            if key is not None:
                data = decrypt(data, key)
            if compressed and size > archived:
                data = explode(data) if flags & MPQ_FILE_IMPLODE else _decompress(data)
            return data[:size]

        sector_size = 512 << self.sector_shift
        n = -(-size // sector_size)
        n_pos = n + 1 + (1 if flags & MPQ_FILE_SECTOR_CRC else 0)
        head = data[:4 * n_pos]
        if key is not None:
            head = decrypt(head, (key - 1) & 0xFFFFFFFF)
        positions = struct.unpack('<%dI' % n_pos, head)

        out, left = bytearray(), size
        for i in range(n):
            chunk = data[positions[i]:positions[i + 1]]
            if key is not None:
                chunk = decrypt(chunk, (key + i) & 0xFFFFFFFF)
            want = min(sector_size, left)
            if compressed and len(chunk) < want:
                chunk = explode(chunk) if flags & MPQ_FILE_IMPLODE else _decompress(chunk)
            out += chunk[:want]
            left -= want
        return bytes(out)
