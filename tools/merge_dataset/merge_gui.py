#!/usr/bin/env python3
"""GUI: pick old dataset (A2L+HEX) and new software (A2L+HEX) -> merged HEX."""
import glob
import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from merge_dataset import format_summary, merge, write_report


def sibling(path, ext):
    """Find the .a2l/.hex next to a picked file: same stem first, else the only one in the folder."""
    stem = os.path.splitext(path)[0]
    if os.path.isfile(stem + ext):
        return stem + ext
    found = glob.glob(os.path.join(os.path.dirname(path), "*" + ext))
    return found[0] if len(found) == 1 else ""


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Dataset Merge Tool")
        self.geometry("860x600")
        self.rows = None
        self.vars = {k: tk.StringVar() for k in ("old_hex", "old_a2l", "new_hex", "new_a2l", "out")}

        frm = ttk.Frame(self, padding=10)
        frm.pack(fill="x")
        spec = [
            ("old_hex", "Old dataset HEX", [("HEX", "*.hex *.s19 *.mhx"), ("All", "*.*")]),
            ("old_a2l", "Old dataset A2L", [("A2L", "*.a2l"), ("All", "*.*")]),
            ("new_hex", "New software HEX", [("HEX", "*.hex *.s19 *.mhx"), ("All", "*.*")]),
            ("new_a2l", "New software A2L", [("A2L", "*.a2l"), ("All", "*.*")]),
        ]
        for r, (key, label, ft) in enumerate(spec):
            ttk.Label(frm, text=label, width=18).grid(row=r, column=0, sticky="w", pady=2)
            ttk.Entry(frm, textvariable=self.vars[key]).grid(row=r, column=1, sticky="ew", pady=2)
            ttk.Button(frm, text="Browse...", command=lambda k=key, f=ft: self.browse(k, f)).grid(row=r, column=2, padx=4)
        ttk.Label(frm, text="Output HEX", width=18).grid(row=4, column=0, sticky="w", pady=2)
        ttk.Entry(frm, textvariable=self.vars["out"]).grid(row=4, column=1, sticky="ew", pady=2)
        ttk.Button(frm, text="Save as...", command=self.browse_out).grid(row=4, column=2, padx=4)
        frm.columnconfigure(1, weight=1)

        bar = ttk.Frame(self, padding=(10, 0))
        bar.pack(fill="x")
        ttk.Button(bar, text="Merge", command=self.run).pack(side="left")
        ttk.Button(bar, text="Save report (CSV)...", command=self.save_report).pack(side="left", padx=8)
        ttk.Button(bar, text="Copy log", command=self.copy_log).pack(side="left")

        self.log = tk.Text(self, wrap="none", font=("Consolas", 9))
        self.log.pack(fill="both", expand=True, padx=10, pady=10)

    def write(self, msg):
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.update_idletasks()

    def browse(self, key, ft):
        p = filedialog.askopenfilename(parent=self, filetypes=ft)
        if not p:
            return
        self.vars[key].set(p)
        side, ext = key.split("_")[0], (".a2l" if key.endswith("hex") else ".hex")
        other = f"{side}_{'a2l' if key.endswith('hex') else 'hex'}"
        if not self.vars[other].get():
            self.vars[other].set(sibling(p, ext))
        if key.startswith("new") and not self.vars["out"].get():
            self.vars["out"].set(os.path.splitext(self.vars["new_hex"].get() or p)[0] + "_Merged.hex")

    def browse_out(self):
        p = filedialog.asksaveasfilename(parent=self, defaultextension=".hex", filetypes=[("HEX", "*.hex")])
        if p:
            self.vars["out"].set(p)

    def run(self):
        v = {k: x.get().strip() for k, x in self.vars.items()}
        missing = [k for k, x in v.items() if not x]
        if missing:
            return messagebox.showwarning("Missing input", "Please fill in all five paths.", parent=self)
        if os.path.abspath(v["out"]) in (os.path.abspath(v["old_hex"]), os.path.abspath(v["new_hex"])):
            return messagebox.showwarning("Output", "Output must be a different file than the inputs.", parent=self)
        self.log.delete("1.0", "end")
        try:
            self.rows, summary = merge(v["old_a2l"], v["old_hex"], v["new_a2l"], v["new_hex"], v["out"], log=self.write)
        except Exception as e:
            self.rows = None
            self.write(f"ERROR: {e}")
            return messagebox.showerror("Error", str(e), parent=self)
        self.write("")
        self.write(format_summary(summary, self.rows))
        self.write("\nDone.")

    def save_report(self):
        if not self.rows:
            return messagebox.showinfo("Report", "Run a merge first.", parent=self)
        p = filedialog.asksaveasfilename(parent=self, defaultextension=".csv", filetypes=[("CSV", "*.csv")])
        if p:
            write_report(self.rows, p)
            self.write(f"Report saved: {p}")

    def copy_log(self):
        self.clipboard_clear()
        self.clipboard_append(self.log.get("1.0", "end"))


if __name__ == "__main__":
    App().mainloop()
