#!/usr/bin/env python3
"""Tinh trung binh 4 signal IGBT Tj trong 1s truoc thoi diem signal giam dot ngot.

Dung:
    python3 tools/igbt_drop_avg.py [file.tsv] [--window 1.0] [--threshold 1.0]
                                   [--detect VAR_BCC_tIGBTTj_f32] [--pick first|last|largest]

Drop = buoc nhay giua 2 sample lien tiep <= -threshold (degC). Thoi diem t0 la
sample CUA TRUOC buoc giam (con o muc cao). Cua so tinh = [t0 - window, t0].
"""
import argparse
import csv
import sys

SIGNALS = [
    "VAR_BCC_tIGBTTj_f32",
    "VAR_BCC_tIGBTUTj_f32",
    "VAR_BCC_tIGBTVTj_f32",
    "VAR_BCC_tIGBTWTj_f32",
]


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f, delimiter="\t") if r]
    # ten cot dang "VAR_xxx\XCP:1" -> bo phan sau dau '\'
    names = [c.split("\\")[0].strip() for c in rows[0]]
    cols = {n: i for i, n in enumerate(names)}
    t_idx = cols.get("time", 0)
    time = [float(r[t_idx].replace(",", ".")) for r in rows[1:]]
    data = {}
    for s in SIGNALS:
        if s not in cols:
            sys.exit(f"Khong thay signal '{s}' trong file. Cot co: {names}")
        data[s] = [float(r[cols[s]].replace(",", ".")) for r in rows[1:]]
    return time, data, cols, rows


def find_drops(values, threshold):
    """Tra ve list index k (sample truoc buoc giam) co values[k+1]-values[k] <= -threshold."""
    return [k for k in range(len(values) - 1) if values[k + 1] - values[k] <= -threshold]


def pick_file():
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(title="Chon file TSV", filetypes=[("TSV", "*.tsv"), ("All", "*.*")])
        root.destroy()
    except Exception:
        path = input("Nhap duong dan file .tsv: ").strip().strip('"')
    if not path:
        sys.exit("Chua chon file.")
    return path


def analyze(path, window=1.0, threshold=1.0, detect=SIGNALS[0], pick="first"):
    """Tra ve dict: info ve drop/cua so va list hang (signal, mean, max, t_max). Loi -> ValueError."""
    time, data, _, _ = load(path)
    det = data.get(detect)
    if det is None:
        raise ValueError(f"detect phai la 1 trong {SIGNALS}")
    drops = find_drops(det, threshold)
    if not drops:
        steps = min(det[k + 1] - det[k] for k in range(len(det) - 1))
        raise ValueError(f"Khong tim thay drop >= {threshold}. Buoc giam lon nhat: {steps:.3f}. Thu giam threshold.")
    if pick == "first":
        k = drops[0]
    elif pick == "last":
        k = drops[-1]
    else:
        k = min(drops, key=lambda i: det[i + 1] - det[i])
    t0 = time[k]
    idx = [i for i, t in enumerate(time) if t0 - window <= t <= t0]
    rows = []
    for s in SIGNALS:
        vals = [data[s][i] for i in idx]
        m = max(vals)
        rows.append((s, sum(vals) / len(vals), m, time[idx[vals.index(m)]]))
    return {
        "detect": detect, "v_before": det[k], "v_after": det[k + 1],
        "t_drop": t0, "t_after": time[k + 1], "n_drops": len(drops),
        "t_start": time[idx[0]], "t_end": time[idx[-1]], "n_samples": len(idx),
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="file .tsv (bo trong -> mo hop thoai chon file)")
    ap.add_argument("--window", type=float, default=1.0, help="do dai cua so (s), mac dinh 1.0")
    ap.add_argument("--threshold", type=float, default=1.0, help="muc giam/sample de coi la dot ngot (degC), mac dinh 1.0")
    ap.add_argument("--detect", default=SIGNALS[0], help="signal dung de tim diem giam")
    ap.add_argument("--pick", choices=["first", "last", "largest"], default="first")
    a = ap.parse_args()
    if not a.file:
        a.file = pick_file()
    try:
        r = analyze(a.file, a.window, a.threshold, a.detect, a.pick)
    except ValueError as e:
        sys.exit(str(e))
    print(f"Drop tren {r['detect']}: {r['v_before']:.3f} -> {r['v_after']:.3f} "
          f"(t={r['t_drop']:.3f}s -> {r['t_after']:.3f}s), tim thay {r['n_drops']} drop >= {a.threshold}")
    print(f"Cua so: [{r['t_start']:.3f}s, {r['t_end']:.3f}s], {r['n_samples']} sample\n")
    print(f"{'Signal':<24}{'Mean':>10}{'Max':>10}{'t(Max)':>11}")
    for s, mean, m, tm in r["rows"]:
        print(f"{s:<24}{mean:>10.4f}{m:>10.4f}{tm:>10.3f}s")


if __name__ == "__main__":
    main()
