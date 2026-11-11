#!/usr/bin/env python3
"""GUI: double click -> pick a TSV file -> copyable result table (Mean/Max)."""
import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from igbt_drop_avg import HEAD, analyze, fmt_row



def drop_rows(r):
    """Drop-point info rows, for cross-checking against the raw data."""
    return [
        ("Drop start (t0) [s]", f"{r['t_drop']:.3f}"),
        (f"{r['detect']} value at t0", f"{r['v_before']:.3f}"),
        ("First sample after drop [s]", f"{r['t_after']:.3f}"),
        (f"{r['detect']} value after drop", f"{r['v_after']:.3f}"),
        ("Window start [s]", f"{r['t_start']:.3f}"),
        ("Window end [s]", f"{r['t_end']:.3f}"),
        ("Samples in window", str(r["n_samples"])),
    ]


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("IGBT Tj - Mean/Max before sudden drop")
        self.geometry("900x700")
        self.path = None
        self.result = None

        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Button(top, text="Select TSV file...", command=self.choose).pack(side="left")
        ttk.Label(top, text="  Window (s):").pack(side="left")
        self.window = tk.StringVar(value="1.0")
        ttk.Entry(top, textvariable=self.window, width=6).pack(side="left")
        ttk.Label(top, text="  Drop threshold (degC):").pack(side="left")
        self.thr = tk.StringVar(value="1.0")
        ttk.Entry(top, textvariable=self.thr, width=6).pack(side="left")
        ttk.Button(top, text="Recalculate", command=self.run).pack(side="left", padx=8)

        self.info = tk.StringVar(value="No file selected")
        ttk.Label(self, textvariable=self.info, padding=(8, 0), wraplength=700).pack(fill="x")

        self.tree = ttk.Treeview(self, columns=HEAD, show="headings", height=16, selectmode="extended")
        for c in HEAD:
            self.tree.heading(c, text=c)
            self.tree.column(c, width=210 if c == "Signal" else 90, anchor="w" if c == "Signal" else "e")
        self.tree.pack(fill="both", expand=True, padx=8, pady=(8, 4))
        self.tree2 = ttk.Treeview(self, columns=("Item", "Value"), show="headings", height=7)
        self.tree2.heading("Item", text="Drop point info")
        self.tree2.heading("Value", text="Value")
        self.tree2.column("Item", width=420, anchor="w")
        self.tree2.column("Value", width=130, anchor="e")
        self.tree2.pack(fill="both", expand=True, padx=8, pady=(4, 8))
        self.bind("<Control-c>", lambda e: self.copy_all())

        bot = ttk.Frame(self, padding=(8, 0, 8, 8))
        bot.pack(fill="x")
        ttk.Button(bot, text="Copy tables (paste into Excel)", command=self.copy_all).pack(side="left")
        self.status = tk.StringVar()
        ttk.Label(bot, textvariable=self.status).pack(side="left", padx=10)

        self.after(200, self.choose)

    def choose(self):
        p = filedialog.askopenfilename(parent=self, title="Select TSV file",
                                       filetypes=[("TSV", "*.tsv"), ("All", "*.*")])
        if p:
            self.path = p
            self.run()

    def run(self):
        if not self.path:
            return self.choose()
        try:
            self.result = analyze(self.path, float(self.window.get()), float(self.thr.get()))
        except Exception as e:
            self.result = None
            self.tree.delete(*self.tree.get_children())
            self.tree2.delete(*self.tree2.get_children())
            self.info.set(f"{os.path.basename(self.path)}: error")
            messagebox.showerror("Error", str(e), parent=self)
            return
        r = self.result
        self.info.set(f"{os.path.basename(self.path)} | drop {r['v_before']:.2f} -> {r['v_after']:.2f} "
                      f"at t={r['t_drop']:.3f}s | window [{r['t_start']:.3f}s, {r['t_end']:.3f}s], "
                      f"{r['n_samples']} samples")
        self.tree.delete(*self.tree.get_children())
        for row in r["rows"]:
            self.tree.insert("", "end", values=fmt_row(row))
        self.tree2.delete(*self.tree2.get_children())
        for row in drop_rows(r):
            self.tree2.insert("", "end", values=row)

    def copy_all(self):
        if not self.result:
            return
        lines = ["\t".join(HEAD)]
        for row in self.result["rows"]:
            lines.append("\t".join(fmt_row(row)))
        lines.append("")
        lines.append("Drop point info\tValue")
        lines += [f"{k}\t{v}" for k, v in drop_rows(self.result)]
        self.clipboard_clear()
        self.clipboard_append("\n".join(lines))
        self.status.set("Copied!")
        self.after(2000, lambda: self.status.set(""))


if __name__ == "__main__":
    App().mainloop()
