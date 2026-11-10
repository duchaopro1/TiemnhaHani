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

    time, data, _, _ = load(a.file)
    det = data.get(a.detect)
    if det is None:
        sys.exit(f"--detect phai la 1 trong {SIGNALS}")

    drops = find_drops(det, a.threshold)
    if not drops:
        steps = min(det[k + 1] - det[k] for k in range(len(det) - 1))
        sys.exit(f"Khong tim thay drop >= {a.threshold}. Buoc giam lon nhat: {steps:.3f}. Thu giam --threshold.")

    if a.pick == "first":
        k = drops[0]
    elif a.pick == "last":
        k = drops[-1]
    else:
        k = min(drops, key=lambda i: det[i + 1] - det[i])

    t0 = time[k]
    idx = [i for i, t in enumerate(time) if t0 - a.window <= t <= t0]
    print(f"Drop tren {a.detect}: {det[k]:.3f} -> {det[k+1]:.3f} "
          f"(t={t0:.3f}s -> {time[k+1]:.3f}s), tim thay {len(drops)} drop >= {a.threshold}")
    print(f"Cua so: [{time[idx[0]]:.3f}s, {time[idx[-1]]:.3f}s], {len(idx)} sample\n")
    print(f"{'Signal':<24}{'Mean':>10}{'Max':>10}{'t(Max)':>11}")
    for s in SIGNALS:
        vals = [data[s][i] for i in idx]
        m = max(vals)
        t_max = time[idx[vals.index(m)]]
        print(f"{s:<24}{sum(vals)/len(vals):>10.4f}{m:>10.4f}{t_max:>10.3f}s")

if __name__ == "__main__":
    main()
