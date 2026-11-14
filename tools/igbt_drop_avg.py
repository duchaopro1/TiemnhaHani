#!/usr/bin/env python3
"""Mean/Max of the 4 IGBT Tj signals in the 1 s window before a sudden drop.

Usage:
    python3 tools/igbt_drop_avg.py [file.tsv] [--window 1.0] [--threshold 1.0]
                                   [--detect VAR_BCC_tIGBTTj_f32] [--pick first|last|largest]

Drop = step between 2 consecutive samples <= -threshold (degC). t0 is the sample
BEFORE the step (still at the high level). Window = [t0 - window, t0].
"""
import argparse
import csv
import sys

SIGNALS = [
    "VAR_BCC_tIGBTTj_f32",
    "VAR_BCC_tIGBTUTj_f32",
    "VAR_BCC_tIGBTVTj_f32",
    "VAR_BCC_tIGBTWTj_f32",
    "VAR_BCC_tIGBTUHTj_f32",
    "VAR_BCC_tIGBTULTj_f32",
    "VAR_BCC_tIGBTVHTj_f32",
    "VAR_BCC_tIGBTVLTj_f32",
    "VAR_BCC_tIGBTWHTj_f32",
    "VAR_BCC_tIGBTWLTj_f32",
    "VAR_Hspf_tDBCTempU_f32",
    "VAR_Hspf_tDBCTempV_f32",
    "VAR_Hspf_tDBCTempW_f32",
    "VAR_BCC_tCoolantU_f32",
    "VAR_BCC_tCoolantV_f32",
    "VAR_BCC_tCoolantW_f32",
]
HEAD = ("Signal", "Mean", "Min", "Max", "t(Min) [s]", "t(Max) [s]")


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f, delimiter="\t") if r]
    # ten cot dang "VAR_xxx\XCP:1" -> bo phan sau dau '\'
    names = [c.split("\\")[0].strip() for c in rows[0]]
    # bo tien to "[1] " neu co (copy tu oscilloscope)
    names = [n[3:].strip() if n.startswith("[") and "]" in n[:4] else n for n in names]
    cols = {n: i for i, n in enumerate(names)}
    t_idx = cols.get("time", 0)
    time = [float(r[t_idx].replace(",", ".")) for r in rows[1:]]
    data = {}
    for s in SIGNALS:
        if s in cols:
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
        path = filedialog.askopenfilename(title="Select TSV file", filetypes=[("TSV", "*.tsv"), ("All", "*.*")])
        root.destroy()
    except Exception:
        path = input("Enter path to .tsv file: ").strip().strip('"')
    if not path:
        sys.exit("No file selected.")
    return path


def fmt_row(row):
    """Row -> list of strings (N/A if the signal is missing in the file)."""
    s, mean, lo, hi, tlo, thi = row
    if mean is None:
        return [s] + ["N/A"] * 5
    return [s, f"{mean:.4f}", f"{lo:.4f}", f"{hi:.4f}", f"{tlo:.3f}", f"{thi:.3f}"]


def analyze(path, window=1.0, threshold=1.0, detect=SIGNALS[0], pick="first"):
    """Returns dict: drop/window info and rows (signal, mean, min, max, t_min, t_max). Raises ValueError on error."""
    time, data, _, _ = load(path)
    det = data.get(detect)
    if det is None:
        raise ValueError(f"Detect signal '{detect}' not found in file.")
    drops = find_drops(det, threshold)
    if not drops:
        steps = min(det[k + 1] - det[k] for k in range(len(det) - 1))
        raise ValueError(f"No drop >= {threshold} found. Largest single-step decrease: {steps:.3f}. Try a lower threshold.")
    if pick == "first":
        k = drops[0]
    elif pick == "last":
        k = drops[-1]
    else:
        k = min(drops, key=lambda i: det[i + 1] - det[i])
    t0 = time[k]
    idx = [i for i, t in enumerate(time) if t0 - window <= t <= t0]
    rows = []  # (signal, mean, min, max, t_min, t_max); None values if signal missing in file
    for s in SIGNALS:
        if s not in data:
            rows.append((s, None, None, None, None, None))
            continue
        vals = [data[s][i] for i in idx]
        lo, hi = min(vals), max(vals)
        rows.append((s, sum(vals) / len(vals), lo, hi,
                     time[idx[vals.index(lo)]], time[idx[vals.index(hi)]]))
    return {
        "detect": detect, "v_before": det[k], "v_after": det[k + 1],
        "t_drop": t0, "t_after": time[k + 1], "n_drops": len(drops),
        "t_start": time[idx[0]], "t_end": time[idx[-1]], "n_samples": len(idx),
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help=".tsv file (omit to open a file dialog)")
    ap.add_argument("--window", type=float, default=1.0, help="window length in s (default 1.0)")
    ap.add_argument("--threshold", type=float, default=1.0, help="decrease per sample counted as a sudden drop, degC (default 1.0)")
    ap.add_argument("--detect", default=SIGNALS[0], help="signal used to detect the drop")
    ap.add_argument("--pick", choices=["first", "last", "largest"], default="first")
    a = ap.parse_args()
    if not a.file:
        a.file = pick_file()
    try:
        r = analyze(a.file, a.window, a.threshold, a.detect, a.pick)
    except ValueError as e:
        sys.exit(str(e))
    print(f"Drop starts at t0 = {r['t_drop']:.3f}s (next sample: {r['t_after']:.3f}s)")
    print(f"Drop on {r['detect']}: {r['v_before']:.3f} -> {r['v_after']:.3f}, "
          f"{r['n_drops']} drop(s) >= {a.threshold} found")
    print(f"Window: [{r['t_start']:.3f}s, {r['t_end']:.3f}s], {r['n_samples']} samples\n")
    w = max(len(x) for x in SIGNALS) + 2
    print(f"{HEAD[0]:<{w}}" + "".join(f"{h:>13}" for h in HEAD[1:]))
    for row in r["rows"]:
        f = fmt_row(row)
        print(f"{f[0]:<{w}}" + "".join(f"{x:>13}" for x in f[1:]))

if __name__ == "__main__":
    main()
