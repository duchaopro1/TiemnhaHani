#!/usr/bin/env python3
"""GUI: double click -> chon file TSV -> bang ket qua (Mean/Max) co the copy."""
import os
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from igbt_drop_avg import analyze

HEAD = ("Signal", "Mean", "Max", "t(Max) [s]")


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("IGBT Tj - Mean/Max truoc khi giam dot ngot")
        self.geometry("720x330")
        self.path = None
        self.result = None

        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")
        ttk.Button(top, text="Chon file TSV...", command=self.choose).pack(side="left")
        ttk.Label(top, text="  Cua so (s):").pack(side="left")
        self.window = tk.StringVar(value="1.0")
        ttk.Entry(top, textvariable=self.window, width=6).pack(side="left")
        ttk.Label(top, text="  Nguong giam (degC):").pack(side="left")
        self.thr = tk.StringVar(value="1.0")
        ttk.Entry(top, textvariable=self.thr, width=6).pack(side="left")
        ttk.Button(top, text="Tinh lai", command=self.run).pack(side="left", padx=8)

        self.info = tk.StringVar(value="Chua chon file")
        ttk.Label(self, textvariable=self.info, padding=(8, 0), wraplength=700).pack(fill="x")

        self.tree = ttk.Treeview(self, columns=HEAD, show="headings", height=5, selectmode="extended")
        for c in HEAD:
            self.tree.heading(c, text=c)
            self.tree.column(c, width=260 if c == "Signal" else 130, anchor="w" if c == "Signal" else "e")
        self.tree.pack(fill="both", expand=True, padx=8, pady=8)
        self.tree.bind("<Control-c>", lambda e: self.copy_all())

        bot = ttk.Frame(self, padding=(8, 0, 8, 8))
        bot.pack(fill="x")
        ttk.Button(bot, text="Copy bang (paste vao Excel)", command=self.copy_all).pack(side="left")
        self.status = tk.StringVar()
        ttk.Label(bot, textvariable=self.status).pack(side="left", padx=10)

        self.after(200, self.choose)

    def choose(self):
        p = filedialog.askopenfilename(parent=self, title="Chon file TSV",
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
            self.info.set(f"{os.path.basename(self.path)}: loi")
            messagebox.showerror("Loi", str(e), parent=self)
            return
        r = self.result
        self.info.set(f"{os.path.basename(self.path)} | drop {r['v_before']:.2f} -> {r['v_after']:.2f} "
                      f"tai t={r['t_drop']:.3f}s | cua so [{r['t_start']:.3f}s, {r['t_end']:.3f}s], "
                      f"{r['n_samples']} sample")
        self.tree.delete(*self.tree.get_children())
        for s, mean, m, tm in r["rows"]:
            self.tree.insert("", "end", values=(s, f"{mean:.4f}", f"{m:.4f}", f"{tm:.3f}"))

    def copy_all(self):
        if not self.result:
            return
        lines = ["\t".join(HEAD)]
        for s, mean, m, tm in self.result["rows"]:
            lines.append(f"{s}\t{mean:.4f}\t{m:.4f}\t{tm:.3f}")
        self.clipboard_clear()
        self.clipboard_append("\n".join(lines))
        self.status.set("Da copy!")
        self.after(2000, lambda: self.status.set(""))


if __name__ == "__main__":
    App().mainloop()
