#!/usr/bin/env python3
"""Merge a calibration dataset (old A2L + HEX) into a new software (new A2L + HEX).

Replicates what INCA does when you load a dataset into a new software version:

  1. Start from the NEW software HEX (code + default calibration).
  2. Copy the old dataset's calibration segment (A2L MEMORY_SEGMENT ... DATA) over it,
     so bytes that do not belong to any characteristic are kept from the dataset.
  3. For every characteristic that MOVED address between the two A2Ls, reset its old
     location back to the new software's default bytes.
  4. For every characteristic present in BOTH A2Ls (matched by NAME), copy its raw bytes
     from the dataset (old address) to the new software (new address).
  5. Characteristics that exist only in the new A2L keep the new software default.
     Characteristics that exist only in the old A2L are dropped.

Usage:
    python merge_dataset.py --old-a2l OLD.a2l --old-hex OLD.hex \\
                            --new-a2l NEW.a2l --new-hex NEW.hex --out MERGED.hex [--report r.csv]
"""
import argparse
import csv
import os
import re
import sys

DT = {"UBYTE": 1, "SBYTE": 1, "UWORD": 2, "SWORD": 2, "ULONG": 4, "SLONG": 4,
      "A_UINT64": 8, "A_INT64": 8, "FLOAT16_IEEE": 2, "FLOAT32_IEEE": 4, "FLOAT64_IEEE": 8}


# --------------------------------------------------------------------------- Intel HEX
class Memory:
    """Sparse byte memory made of contiguous segments."""

    def __init__(self):
        self.segs = []  # sorted list of [start, bytearray]

    @classmethod
    def from_hex(cls, path):
        pieces, base = {}, 0
        with open(path, encoding="ascii", errors="replace") as f:
            for n, line in enumerate(f, 1):
                line = line.strip()
                if not line.startswith(":"):
                    continue
                try:
                    b = bytes.fromhex(line[1:])
                except ValueError:
                    raise ValueError(f"{os.path.basename(path)} line {n}: invalid hex record")
                if sum(b) & 0xFF:
                    raise ValueError(f"{os.path.basename(path)} line {n}: checksum error")
                cnt, addr, typ, data = b[0], (b[1] << 8) | b[2], b[3], b[4:4 + b[0]]
                if typ == 0:
                    pieces[base + addr] = data
                elif typ == 4:
                    base = ((data[0] << 8) | data[1]) << 16
                elif typ == 2:
                    base = ((data[0] << 8) | data[1]) << 4
                elif typ == 1:
                    break
        m = cls()
        for a in sorted(pieces):
            d = pieces[a]
            if m.segs and m.segs[-1][0] + len(m.segs[-1][1]) == a:
                m.segs[-1][1].extend(d)
            else:
                m.segs.append([a, bytearray(d)])
        return m

    def _find(self, addr, n):
        for s, buf in self.segs:
            if s <= addr and addr + n <= s + len(buf):
                return buf, addr - s
        return None

    def covers(self, addr, n):
        return self._find(addr, n) is not None

    def read(self, addr, n):
        r = self._find(addr, n)
        return None if r is None else bytes(r[0][r[1]:r[1] + n])

    def write(self, addr, data):
        r = self._find(addr, len(data))
        if r is None:
            return False
        r[0][r[1]:r[1] + len(data)] = data
        return True

    def copy(self):
        m = Memory()
        m.segs = [[s, bytearray(b)] for s, b in self.segs]
        return m

    def to_hex(self, path, line_bytes=32):
        def rec(addr, typ, data):
            b = bytes([len(data), (addr >> 8) & 0xFF, addr & 0xFF, typ]) + bytes(data)
            return ":" + (b + bytes([(-sum(b)) & 0xFF])).hex().upper()
        out = []
        for s, buf in self.segs:
            hi_cur = None
            pos = 0
            while pos < len(buf):
                a = s + pos
                hi = a >> 16
                if hi != hi_cur:
                    out.append(rec(0, 4, [(hi >> 8) & 0xFF, hi & 0xFF]))
                    hi_cur = hi
                n = min(line_bytes, len(buf) - pos, 0x10000 - (a & 0xFFFF))
                out.append(rec(a & 0xFFFF, 0, buf[pos:pos + n]))
                pos += n
        out.append(":00000001FF")
        with open(path, "w", newline="") as f:
            f.write("\r\n".join(out) + "\r\n")


# --------------------------------------------------------------------------- A2L
def _tokens(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.findall(r'"(?:[^"\\]|\\.)*"|[^\s"]+', text)


class A2L:
    def __init__(self, path):
        self.path = path
        self.chars = {}      # name -> dict
        self.layouts = {}    # name -> token list
        self.methods = {}    # name -> token tuple
        self.tabs = {}       # name -> token tuple
        self.data_segments = []  # (addr, size)
        self._parse()

    def _parse(self):
        with open(self.path, encoding="latin-1") as f:
            t = _tokens(f.read())
        n, i = len(t), 0
        while i < n:
            if t[i] != "/begin" or i + 1 >= n:
                i += 1
                continue
            kind = t[i + 1]
            if kind in ("CHARACTERISTIC", "AXIS_PTS"):
                i = self._block_char(t, i, kind)
            elif kind in ("RECORD_LAYOUT", "COMPU_METHOD", "COMPU_VTAB", "COMPU_TAB", "COMPU_VTAB_RANGE"):
                j = self._end(t, i + 2, kind)
                body = t[i + 3:j]
                if kind == "RECORD_LAYOUT":
                    self.layouts[t[i + 2]] = body
                elif kind == "COMPU_METHOD":
                    self.methods[t[i + 2]] = tuple(body)
                else:
                    self.tabs[t[i + 2]] = tuple(body)
                i = j
            elif kind == "MEMORY_SEGMENT":
                # name "desc" PRG_TYPE MEMORY_TYPE ATTRIBUTE addr size ...
                try:
                    if t[i + 4] == "DATA":
                        self.data_segments.append((int(t[i + 7], 0), int(t[i + 8], 0)))
                except (IndexError, ValueError):
                    pass
                i += 2
            else:
                i += 2

    @staticmethod
    def _end(t, j, kind):
        depth = 1
        while depth:
            if t[j] == "/begin":
                depth += 1
            elif t[j] == "/end":
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return j

    def _block_char(self, t, i, kind):
        j = i + 2
        if kind == "CHARACTERISTIC":
            name, _desc, typ, addr, layout, _md, conv, lo, hi = t[j:j + 9]
            j += 9
            maxpts = None
        else:  # AXIS_PTS: name desc addr input layout maxdiff conv maxpts lo hi
            name, _desc, addr, _inp, layout, _md, conv, maxpts, lo, hi = t[j:j + 10]
            typ = "AXIS_PTS"
            j += 10
            maxpts = int(maxpts, 0)
        ext, axes, depth = {}, [], 1
        while depth:
            tok = t[j]
            if tok == "/begin":
                depth += 1
                if depth == 2 and t[j + 1] == "AXIS_DESCR":
                    axes.append(t[j + 2:j + 8])
            elif tok == "/end":
                depth -= 1
            elif depth == 1 and tok == "NUMBER":
                ext["NUMBER"] = int(t[j + 1], 0)
            elif depth == 1 and tok == "MATRIX_DIM":
                d, m = [], j + 1
                while re.fullmatch(r"\d+", t[m]):
                    d.append(int(t[m]))
                    m += 1
                ext["DIM"] = d
            j += 1
        self.chars[name] = dict(type=typ, addr=int(addr, 0), layout=layout, conv=conv,
                                lo=lo, hi=hi, axes=axes, maxpts=maxpts, **ext)
        return j

    # ---- size in bytes of a characteristic
    def size(self, name):
        c = self.chars[name]
        body = self.layouts.get(c["layout"])
        if body is None:
            raise ValueError(f"record layout '{c['layout']}' not found")

        def item(key):
            if key in body:
                k = body.index(key)
                return DT[body[k + 2]]
            return None
        t = c["type"]
        if t == "AXIS_PTS":
            es = item("AXIS_PTS_X") or item("AXIS_PTS_Y") or item("AXIS_PTS_Z")
            return es * c["maxpts"]
        es = item("FNC_VALUES")
        if es is None:
            raise ValueError("layout without FNC_VALUES")
        if t == "VALUE":
            n = 1
        elif t == "VAL_BLK":
            n = 1
            for d in (c.get("DIM") or [c.get("NUMBER", 1)]):
                n *= d
        elif t in ("CURVE", "MAP", "CUBOID", "CUBE_4", "CUBE_5"):
            n = 1
            for a in c["axes"]:
                n *= int(a[3], 0)
        else:
            raise ValueError(f"unsupported type {t}")
        total = n * es
        # STD_AXIS: axis points are stored inside the characteristic record
        for a, key in zip(c["axes"], ("X", "Y", "Z")):
            if a[0] == "STD_AXIS":
                total += (item("AXIS_PTS_" + key) or 0) * int(a[3], 0) + (item("NO_AXIS_PTS_" + key) or 0)
        return total

    def conv_signature(self, name):
        conv = self.chars[name]["conv"]
        sig = self.methods.get(conv, (conv,))
        if "COMPU_TAB_REF" in sig:
            ref = sig[sig.index("COMPU_TAB_REF") + 1]
            sig = sig + self.tabs.get(ref, ())
        return sig


# --------------------------------------------------------------------------- merge
STATUS_ORDER = ["COPIED", "COPIED_MOVED", "NEW_DEFAULT", "REMOVED", "SKIPPED"]


def merge(old_a2l, old_hex, new_a2l, new_hex, out_hex=None, log=print):
    """Returns (rows, summary). rows: dicts name/status/old_addr/new_addr/size/note."""
    log("Parsing old A2L ...")
    A0 = A2L(old_a2l)
    log(f"  {len(A0.chars)} characteristics")
    log("Parsing new A2L ...")
    A1 = A2L(new_a2l)
    log(f"  {len(A1.chars)} characteristics")
    log("Reading HEX files ...")
    D = Memory.from_hex(old_hex)
    S = Memory.from_hex(new_hex)
    M = S.copy()

    if not A1.data_segments:
        raise ValueError("No MEMORY_SEGMENT ... DATA found in the new A2L (cannot locate calibration area).")

    # step 2: calibration segment of the dataset as base
    for addr, size in A1.data_segments:
        blk = D.read(addr, size)
        if blk is None:
            raise ValueError(f"Old HEX does not cover calibration segment 0x{addr:08X}..0x{addr + size - 1:08X}.")
        M.write(addr, blk)

    rows = []
    sizes0, sizes1 = {}, {}

    def sz(A, cache, name):
        if name not in cache:
            cache[name] = A.size(name)
        return cache[name]

    # step 3: reset old locations of moved characteristics
    for name, c in A0.chars.items():
        if name in A1.chars and A1.chars[name]["addr"] != c["addr"]:
            try:
                n = sz(A0, sizes0, name)
            except (ValueError, KeyError):
                continue
            blk = S.read(c["addr"], n)
            if blk is not None:
                M.write(c["addr"], blk)

    # step 4/5
    for name, c1 in A1.chars.items():
        row = dict(name=name, type=c1["type"], old_addr="", new_addr=f"0x{c1['addr']:08X}", size="", status="", note="")
        try:
            n1 = sz(A1, sizes1, name)
        except (ValueError, KeyError) as e:
            row.update(status="SKIPPED", note=f"cannot size in new A2L: {e}")
            rows.append(row)
            continue
        row["size"] = n1
        if name not in A0.chars:
            blk = S.read(c1["addr"], n1)
            if blk is not None:
                M.write(c1["addr"], blk)  # undo the dataset bytes that happen to sit there
            row.update(status="NEW_DEFAULT", note="only in new A2L: keeps new software default")
            rows.append(row)
            continue
        c0 = A0.chars[name]
        row["old_addr"] = f"0x{c0['addr']:08X}"
        try:
            n0 = sz(A0, sizes0, name)
        except (ValueError, KeyError) as e:
            row.update(status="SKIPPED", note=f"cannot size in old A2L: {e}")
            rows.append(row)
            continue
        if n0 != n1 or c0["type"] != c1["type"]:
            row.update(status="SKIPPED", note=f"type/size changed ({c0['type']} {n0}B -> {c1['type']} {n1}B): keeps new default")
            rows.append(row)
            continue
        blk = D.read(c0["addr"], n0)
        if blk is None or not M.covers(c1["addr"], n1):
            row.update(status="SKIPPED", note="address not covered by HEX: keeps new default")
            rows.append(row)
            continue
        M.write(c1["addr"], blk)
        notes = []
        if A0.layouts.get(c0["layout"]) != A1.layouts.get(c1["layout"]) or c0["layout"] != c1["layout"]:
            notes.append("record layout changed")
        if A0.conv_signature(name) != A1.conv_signature(name):
            notes.append("CONVERSION CHANGED: raw bytes copied, physical value may differ")
        row.update(status="COPIED_MOVED" if c0["addr"] != c1["addr"] else "COPIED", note="; ".join(notes))
        rows.append(row)

    for name, c0 in A0.chars.items():
        if name not in A1.chars:
            rows.append(dict(name=name, type=c0["type"], old_addr=f"0x{c0['addr']:08X}", new_addr="", size="",
                             status="REMOVED", note="only in old A2L: dropped"))

    summary = {s: sum(1 for r in rows if r["status"] == s) for s in STATUS_ORDER}
    summary["WARNINGS"] = sum(1 for r in rows if r["status"] in ("COPIED", "COPIED_MOVED") and r["note"])
    if out_hex:
        M.to_hex(out_hex)
        log(f"Written: {out_hex}")
    return rows, summary


def write_report(rows, path):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["name", "status", "type", "old_addr", "new_addr", "size", "note"])
        w.writeheader()
        w.writerows(rows)


def format_summary(summary, rows):
    lines = [
        f"Copied (same address)         : {summary['COPIED']}",
        f"Copied (address moved)        : {summary['COPIED_MOVED']}",
        f"New in new A2L (SW default)   : {summary['NEW_DEFAULT']}",
        f"Removed (only in old A2L)     : {summary['REMOVED']}",
        f"Skipped (see report)          : {summary['SKIPPED']}",
        f"Copied with warnings          : {summary['WARNINGS']}",
    ]
    for r in rows:
        if r["status"] in ("NEW_DEFAULT", "REMOVED", "SKIPPED") or (r["note"] and r["status"].startswith("COPIED")):
            lines.append(f"  [{r['status']}] {r['name']}" + (f" - {r['note']}" if r["note"] else ""))
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--old-a2l", required=True)
    ap.add_argument("--old-hex", required=True)
    ap.add_argument("--new-a2l", required=True)
    ap.add_argument("--new-hex", required=True)
    ap.add_argument("--out", required=True, help="output merged .hex")
    ap.add_argument("--report", help="optional CSV report")
    a = ap.parse_args()
    try:
        rows, summary = merge(a.old_a2l, a.old_hex, a.new_a2l, a.new_hex, a.out)
    except (ValueError, OSError) as e:
        sys.exit(f"ERROR: {e}")
    if a.report:
        write_report(rows, a.report)
    print(format_summary(summary, rows))


if __name__ == "__main__":
    main()
