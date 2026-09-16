"""Minimal read-only CASC (TVFS) reader for the local Warcraft III install."""
import struct, zlib, sys, pickle
from pathlib import Path

ROOT = Path(r"C:\Program Files (x86)\Warcraft III\Data")
BUILD_KEY = "3a9d8f26806936764d2d9ad526a65e04"
HERE = Path(__file__).parent
CACHE = HERE / "casc_files.pkl"


def read_config(h):
    d = {}
    for line in (ROOT / "config" / h[:2] / h[2:4] / h).read_text().splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            d[k.strip()] = v.split()
    return d


def load_indices():
    best = {}
    for f in (ROOT / "data").glob("*.idx"):
        b, v = int(f.name[:2], 16), int(f.name[2:10], 16)
        if b not in best or v > best[b][0]:
            best[b] = (v, f)
    idx = {}
    for _, f in best.values():
        data = f.read_bytes()
        hdr_len = struct.unpack_from("<I", data, 0)[0]
        ver, bucket, extra, szb, offb, keyb, offbits = struct.unpack_from("<HBBBBBB", data, 8)
        pos = (8 + hdr_len + 15) & ~15
        ent_len = struct.unpack_from("<I", data, pos)[0]
        pos += 8
        esz = szb + offb + keyb
        for i in range(ent_len // esz):
            o = pos + i * esz
            key = data[o:o + keyb]
            val = int.from_bytes(data[o + keyb:o + keyb + offb], "big")
            size = int.from_bytes(data[o + keyb + offb:o + esz], "little")
            if size:
                idx[key] = (val >> offbits, val & ((1 << offbits) - 1), size)
    return idx


class Encrypted(Exception):
    pass


def _chunk(c):
    m = c[:1]
    if m == b"N":
        return c[1:]
    if m == b"Z":
        return zlib.decompress(c[1:])
    if m == b"F":
        return blte(c[1:])
    if m == b"E":
        raise Encrypted()
    raise ValueError(f"unsupported BLTE mode {m!r}")


def blte(b):
    if b[:4] != b"BLTE":
        raise ValueError(f"bad BLTE magic {b[:4]!r}")
    hsize = struct.unpack_from(">I", b, 4)[0]
    if hsize == 0:
        return _chunk(b[8:])
    cnt = int.from_bytes(b[9:12], "big")
    sizes = [struct.unpack_from(">II", b, 12 + i * 24) for i in range(cnt)]
    pos, out = hsize, bytearray()
    for cs, _ in sizes:
        out += _chunk(b[pos:pos + cs])
        pos += cs
    return bytes(out)


class Casc:
    def __init__(self):
        self.cfg = read_config(BUILD_KEY)
        self.idx = load_indices()
        self._fh = {}
        self.vfs_keys = {bytes.fromhex(v[1])[:9]: k for k, v in self.cfg.items()
                         if k.startswith("vfs-") and not k.endswith("-size")}

    def read_ekey(self, ekey):
        arch, off, size = self.idx[ekey[:9]]
        fh = self._fh.get(arch)
        if fh is None:
            fh = self._fh[arch] = open(ROOT / "data" / f"data.{arch:03d}", "rb")
        fh.seek(off)
        return blte(fh.read(size)[30:])

    def list_files(self):
        if CACHE.exists():
            return pickle.loads(CACHE.read_bytes())
        files = {}
        root = self.read_ekey(bytes.fromhex(self.cfg["vfs-root"][1]))
        self._parse_tvfs(root, "", files)
        CACHE.write_bytes(pickle.dumps(files))
        return files

    def _parse_tvfs(self, data, prefix, files):
        assert data[:4] == b"TVFS", data[:4]
        eks = data[6]
        flags, pto, pts, vto, vts, cto, cts, _ = struct.unpack_from(">IIIIIIIH", data, 8)
        nb = lambda n: 1 if n <= 0xFF else 2 if n <= 0xFFFF else 3 if n <= 0xFFFFFF else 4
        cft_ob = nb(cts)
        path, vfs, cft = data[pto:pto + pts], data[vto:vto + vts], data[cto:cto + cts]

        def add_file(name, voff):
            cnt, q, spans = vfs[voff], voff + 1, []
            for _ in range(cnt):
                clen = struct.unpack_from(">I", vfs, q + 4)[0]
                q += 8
                co = int.from_bytes(vfs[q:q + cft_ob], "big")
                q += cft_ob
                spans.append((cft[co:co + eks], clen))
            if len(spans) == 1 and spans[0][0][:9] in self.vfs_keys:
                try:
                    sub = self.read_ekey(spans[0][0])
                    self._parse_tvfs(sub, name + ":", files)
                    return
                except (KeyError, Encrypted, ValueError, AssertionError):
                    pass
            files[name] = spans

        def walk(p, end, base):
            cur = base
            while p < end:
                pre = post = False
                name = b""
                if path[p] == 0:
                    pre, p = True, p + 1
                if p < end and path[p] != 0xFF:
                    n = path[p]
                    name, p = path[p + 1:p + 1 + n], p + 1 + n
                if p < end and path[p] == 0:
                    post, p = True, p + 1
                nv = None
                if p < end:
                    if path[p] == 0xFF:
                        nv, p = struct.unpack_from(">I", path, p + 1)[0], p + 5
                    else:
                        post = True
                cur = cur + ("/" if pre else "") + name.decode("utf8", "replace") + ("/" if post else "")
                if nv is None:
                    continue
                if nv & 0x80000000:
                    ln = (nv & 0x7FFFFFFF) - 4
                    walk(p, p + ln, cur)
                    p += ln
                else:
                    add_file(cur, nv)
                cur = base

        walk(0, len(path), prefix)

    def read(self, name, files=None):
        files = files or self.list_files()
        return b"".join(self.read_ekey(k) for k, _ in files[name])


if __name__ == "__main__":
    c = Casc()
    fl = c.list_files()
    print("files:", len(fl))
    out = HERE / "casc_listfile.txt"
    out.write_text("\n".join(sorted(fl)), encoding="utf8")
    print("listfile ->", out)
