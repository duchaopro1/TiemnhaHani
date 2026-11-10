#!/usr/bin/env python3
"""Dataset Merge Tool - GUI.

Pick the old dataset (A2L + HEX) and the new software (A2L + HEX), press MERGE.
"""
import glob
import os
import queue
import sys
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from merge_dataset import merge, write_report

# ----------------------------------------------------------------------------- theme
C = dict(
    bg="#0f172a", card="#1e293b", card2="#273449", border="#334155", input="#0b1220",
    text="#e2e8f0", muted="#94a3b8", accent="#6366f1", accent_hi="#818cf8", accent_dk="#4f46e5",
    ok="#22c55e", warn="#f59e0b", bad="#ef4444", info="#38bdf8", purple="#a78bfa",
)
FONT = "Segoe UI" if sys.platform.startswith("win") else "Helvetica"
F = lambda size, bold=False: (FONT, size, "bold" if bold else "normal")

# status -> (label, colour)
STATUS = {
    "COPIED": ("Copied", C["ok"]),
    "COPIED_MOVED": ("Moved", C["info"]),
    "NEW_DEFAULT": ("New", C["purple"]),
    "REMOVED": ("Removed", C["muted"]),
    "SKIPPED": ("Skipped", C["bad"]),
}
HEX_TYPES = [("HEX files", "*.hex *.s19 *.mhx"), ("All files", "*.*")]
A2L_TYPES = [("A2L files", "*.a2l"), ("All files", "*.*")]


def sibling(path, ext):
    """.a2l/.hex next to a picked file: same stem first, else the only one in the folder."""
    stem = os.path.splitext(path)[0]
    for e in (ext, ext.upper()):
        if os.path.isfile(stem + e):
            return stem + e
    found = glob.glob(os.path.join(os.path.dirname(path), "*" + ext))
    return found[0] if len(found) == 1 else ""


class HoverButton(tk.Label):
    """Flat button with hover colour."""

    def __init__(self, master, text, command, bg, hover, fg="white", font=None, padx=14, pady=6):
        super().__init__(master, text=text, bg=bg, fg=fg, font=font or F(10, True), padx=padx, pady=pady, cursor="hand2")
        self._bg, self._hover, self._cmd, self._enabled = bg, hover, command, True
        self.bind("<Enter>", lambda e: self._enabled and self.config(bg=self._hover))
        self.bind("<Leave>", lambda e: self._enabled and self.config(bg=self._bg))
        self.bind("<Button-1>", lambda e: self._enabled and self._cmd())

    def set_enabled(self, on):
        self._enabled = on
        self.config(bg=self._bg if on else C["border"], fg="white" if on else C["muted"],
                    cursor="hand2" if on else "arrow")


class FileRow(tk.Frame):
    def __init__(self, master, label, filetypes, on_pick):
        super().__init__(master, bg=C["card"])
        self.var = tk.StringVar()
        self.filetypes, self.on_pick = filetypes, on_pick
        tk.Label(self, text=label, bg=C["card"], fg=C["muted"], font=F(9), width=6, anchor="w").grid(row=0, column=0)
        self.dot = tk.Label(self, text="●", bg=C["card"], fg=C["border"], font=F(10))
        self.dot.grid(row=0, column=1, padx=(0, 6))
        self.entry = tk.Entry(self, textvariable=self.var, bg=C["input"], fg=C["text"], insertbackground=C["text"],
                              relief="flat", font=F(9), highlightthickness=1, highlightbackground=C["border"],
                              highlightcolor=C["accent"])
        self.entry.grid(row=0, column=2, sticky="ew", ipady=5)
        b = HoverButton(self, "Browse", self.pick, C["card2"], C["border"], fg=C["text"], font=F(9, True), padx=10, pady=4)
        b.grid(row=0, column=3, padx=(8, 0))
        self.columnconfigure(2, weight=1)
        self.var.trace_add("write", lambda *a: self.refresh())

    def refresh(self):
        p = self.var.get().strip()
        self.entry.after_idle(lambda: self.entry.xview_moveto(1.0))  # show the end of the path (file name)
        self.dot.config(fg=C["border"] if not p else (C["ok"] if os.path.isfile(p) else C["bad"]))

    def pick(self):
        p = filedialog.askopenfilename(parent=self, filetypes=self.filetypes)
        if p:
            self.var.set(p)
            self.on_pick(self, p)

    def valid(self):
        return os.path.isfile(self.var.get().strip())


class Card(tk.Frame):
    """Rounded-look card with a coloured top strip and a title."""

    def __init__(self, master, title, subtitle, colour, on_folder=None):
        super().__init__(master, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
        tk.Frame(self, bg=colour, height=4).pack(fill="x")
        head = tk.Frame(self, bg=C["card"])
        head.pack(fill="x", padx=14, pady=(10, 4))
        tk.Label(head, text=title, bg=C["card"], fg=C["text"], font=F(12, True)).pack(side="left")
        if on_folder:
            HoverButton(head, "Pick folder…", on_folder, C["card2"], C["border"], fg=C["text"],
                        font=F(8, True), padx=8, pady=2).pack(side="right")
        tk.Label(self, text=subtitle, bg=C["card"], fg=C["muted"], font=F(9)).pack(anchor="w", padx=14)
        self.body = tk.Frame(self, bg=C["card"])
        self.body.pack(fill="x", padx=14, pady=(8, 14))
        self.body.columnconfigure(0, weight=1)


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Dataset Merge Tool")
        self.geometry("1040x780")
        self.minsize(940, 700)
        self.configure(bg=C["bg"])
        self.rows, self.summary = [], None
        self.q = queue.Queue()
        self.running = False
        self.filter_status = None
        self._style()
        self._build()
        self._validate()
        self.after(60, self._poll)

    # ------------------------------------------------------------------ styling
    def _style(self):
        s = ttk.Style(self)
        s.theme_use("clam")
        s.configure("Treeview", background=C["card"], fieldbackground=C["card"], foreground=C["text"],
                    rowheight=26, borderwidth=0, font=F(9))
        s.configure("Treeview", bordercolor=C["card"], lightcolor=C["card"], darkcolor=C["card"])
        s.layout("Treeview", [("Treeview.treearea", {"sticky": "nswe"})])
        s.configure("Treeview.Heading", background=C["card2"], foreground=C["muted"], relief="flat",
                    font=F(9, True), padding=(8, 6))
        s.map("Treeview.Heading", background=[("active", C["border"])])
        s.map("Treeview", background=[("selected", C["accent_dk"])], foreground=[("selected", "white")])
        s.configure("Vertical.TScrollbar", background=C["card2"], troughcolor=C["card"], bordercolor=C["card"],
                    arrowcolor=C["muted"], relief="flat")
        s.configure("Accent.Horizontal.TProgressbar", troughcolor=C["card"], background=C["accent_hi"],
                    bordercolor=C["card"], lightcolor=C["accent_hi"], darkcolor=C["accent_hi"])

    # ------------------------------------------------------------------ layout
    def _build(self):
        # header
        hdr = tk.Frame(self, bg=C["accent_dk"])
        hdr.pack(fill="x")
        inner = tk.Frame(hdr, bg=C["accent_dk"])
        inner.pack(fill="x", padx=24, pady=14)
        tk.Label(inner, text="⇄", bg=C["accent_dk"], fg="white", font=F(26, True)).pack(side="left", padx=(0, 12))
        t = tk.Frame(inner, bg=C["accent_dk"])
        t.pack(side="left")
        tk.Label(t, text="Dataset Merge Tool", bg=C["accent_dk"], fg="white", font=F(17, True)).pack(anchor="w")
        tk.Label(t, text="Carry your calibration dataset over to a new software build – matched by name, like INCA",
                 bg=C["accent_dk"], fg="#c7d2fe", font=F(9)).pack(anchor="w")

        main = tk.Frame(self, bg=C["bg"])
        main.pack(fill="both", expand=True, padx=24, pady=(16, 16))

        # --- inputs: old -> new
        row = tk.Frame(main, bg=C["bg"])
        row.pack(fill="x")
        self.old = Card(row, "①  Old dataset", "A2L + HEX that contain your calibration values",
                        C["warn"], lambda: self.pick_folder("old"))
        self.new = Card(row, "②  New software", "A2L + HEX of the build you want to merge into",
                        C["ok"], lambda: self.pick_folder("new"))
        self.old.grid(row=0, column=0, sticky="nsew")
        tk.Label(row, text="➜", bg=C["bg"], fg=C["accent_hi"], font=F(22, True)).grid(row=0, column=1, padx=10)
        self.new.grid(row=0, column=2, sticky="nsew")
        row.columnconfigure((0, 2), weight=1, uniform="c")

        self.old_hex = FileRow(self.old.body, "HEX", HEX_TYPES, self.after_pick)
        self.old_a2l = FileRow(self.old.body, "A2L", A2L_TYPES, self.after_pick)
        self.new_hex = FileRow(self.new.body, "HEX", HEX_TYPES, self.after_pick)
        self.new_a2l = FileRow(self.new.body, "A2L", A2L_TYPES, self.after_pick)
        for i, r in enumerate((self.old_hex, self.old_a2l)):
            r.grid(row=i, column=0, sticky="ew", pady=3)
        for i, r in enumerate((self.new_hex, self.new_a2l)):
            r.grid(row=i, column=0, sticky="ew", pady=3)

        # --- output + merge button
        out = tk.Frame(main, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
        out.pack(fill="x", pady=(14, 0))
        o = tk.Frame(out, bg=C["card"])
        o.pack(fill="x", padx=14, pady=12)
        o.columnconfigure(1, weight=1)
        tk.Label(o, text="③  Output", bg=C["card"], fg=C["text"], font=F(12, True)).grid(row=0, column=0, padx=(0, 14))
        self.out_var = tk.StringVar()
        self.out_var.trace_add("write", lambda *a: self._validate())
        tk.Entry(o, textvariable=self.out_var, bg=C["input"], fg=C["text"], insertbackground=C["text"], relief="flat",
                 font=F(9), highlightthickness=1, highlightbackground=C["border"],
                 highlightcolor=C["accent"]).grid(row=0, column=1, sticky="ew", ipady=5)
        HoverButton(o, "Save as…", self.browse_out, C["card2"], C["border"], fg=C["text"], font=F(9, True),
                    padx=10, pady=4).grid(row=0, column=2, padx=8)
        self.merge_btn = HoverButton(o, "▶  MERGE", self.run, C["accent"], C["accent_hi"], font=F(12, True),
                                     padx=30, pady=8)
        self.merge_btn.grid(row=0, column=3)

        self.status = tk.Label(main, text="", bg=C["bg"], fg=C["muted"], font=F(9), anchor="w")
        self.status.pack(fill="x", pady=(8, 0))
        self.progress = ttk.Progressbar(main, mode="indeterminate", style="Accent.Horizontal.TProgressbar")

        # --- stat tiles
        self.tiles_frame = tk.Frame(main, bg=C["bg"])
        self.tiles_frame.pack(fill="x", pady=(8, 0))
        self.tiles = {}
        keys = ["COPIED", "COPIED_MOVED", "NEW_DEFAULT", "REMOVED", "SKIPPED"]
        for i, k in enumerate(keys):
            self.tiles_frame.columnconfigure(i, weight=1, uniform="t")
            self.tiles[k] = self._tile(i, k)

        # --- results table
        res = tk.Frame(main, bg=C["card"], highlightthickness=1, highlightbackground=C["border"])
        res.pack(fill="both", expand=True, pady=(12, 0))
        bar = tk.Frame(res, bg=C["card"])
        bar.pack(fill="x", padx=12, pady=10)
        tk.Label(bar, text="Characteristics", bg=C["card"], fg=C["text"], font=F(11, True)).pack(side="left")
        self.filter_lbl = tk.Label(bar, text="", bg=C["card"], fg=C["accent_hi"], font=F(9, True), cursor="hand2")
        self.filter_lbl.pack(side="left", padx=10)
        self.filter_lbl.bind("<Button-1>", lambda e: self.set_filter(None))
        HoverButton(bar, "Export CSV", self.save_report, C["card2"], C["border"], fg=C["text"], font=F(9, True),
                    padx=10, pady=3).pack(side="right")
        self.open_btn = HoverButton(bar, "Open folder", self.open_folder, C["card2"], C["border"], fg=C["text"],
                                    font=F(9, True), padx=10, pady=3)
        self.open_btn.pack(side="right", padx=6)
        self.search = tk.StringVar()
        self.search.trace_add("write", lambda *a: self.fill_table())
        tk.Entry(bar, textvariable=self.search, bg=C["input"], fg=C["text"], insertbackground=C["text"], relief="flat",
                 font=F(9), width=26, highlightthickness=1, highlightbackground=C["border"],
                 highlightcolor=C["accent"]).pack(side="right", padx=6, ipady=3)
        tk.Label(bar, text="Search", bg=C["card"], fg=C["muted"], font=F(9)).pack(side="right")

        cols = ("name", "status", "type", "old", "new", "size", "note")
        wrap = tk.Frame(res, bg=C["card"])
        wrap.pack(fill="both", expand=True, padx=1, pady=(0, 1))
        self.tree = ttk.Treeview(wrap, columns=cols, show="headings", selectmode="extended")
        for c, text, w, anc in [("name", "Name", 330, "w"), ("status", "Status", 80, "w"), ("type", "Type", 80, "w"),
                                ("old", "Old address", 100, "e"), ("new", "New address", 100, "e"),
                                ("size", "Bytes", 55, "e"), ("note", "Note", 260, "w")]:
            self.tree.heading(c, text=text)
            self.tree.column(c, width=w, anchor=anc, stretch=(c in ("name", "note")))
        for k, (_, col) in STATUS.items():
            self.tree.tag_configure(k, foreground=col)
        self.tree.tag_configure("odd", background=C["card2"])
        sb = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=sb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")
        self.empty = tk.Label(self.tree, text="Results appear here after the merge", bg=C["card"], fg=C["muted"],
                              font=F(10))
        self.empty.place(relx=0.5, rely=0.45, anchor="center")

    def _tile(self, col, key):
        label, colour = STATUS[key]
        f = tk.Frame(self.tiles_frame, bg=C["card"], highlightthickness=1, highlightbackground=C["border"], cursor="hand2")
        f.grid(row=0, column=col, sticky="ew", padx=(0 if col == 0 else 6, 0))
        tk.Frame(f, bg=colour, height=3).pack(fill="x")
        n = tk.Label(f, text="–", bg=C["card"], fg=colour, font=F(20, True))
        n.pack(pady=(6, 0))
        tk.Label(f, text=label, bg=C["card"], fg=C["muted"], font=F(9)).pack(pady=(0, 6))
        for w in (f, n) + tuple(f.winfo_children()):
            w.bind("<Button-1>", lambda e, k=key: self.set_filter(k))
        return n

    # ------------------------------------------------------------------ input handling
    def _rows(self):
        return {"old_hex": self.old_hex, "old_a2l": self.old_a2l, "new_hex": self.new_hex, "new_a2l": self.new_a2l}

    def after_pick(self, row, path):
        """Auto-fill the partner file and the output name."""
        pair = {self.old_hex: self.old_a2l, self.old_a2l: self.old_hex,
                self.new_hex: self.new_a2l, self.new_a2l: self.new_hex}[row]
        if not pair.var.get().strip():
            pair.var.set(sibling(path, ".a2l" if row in (self.old_hex, self.new_hex) else ".hex"))
        if row in (self.new_hex, self.new_a2l):
            self._default_out()
        self._validate()

    def _default_out(self):
        h = self.new_hex.var.get().strip()
        if h and not self.out_var.get().strip():
            self.out_var.set(os.path.splitext(h)[0] + "_Merged.hex")

    def pick_folder(self, which):
        d = filedialog.askdirectory(parent=self, title="Select the folder")
        if not d:
            return
        hx = sorted(glob.glob(os.path.join(d, "*.hex")))
        a2 = sorted(glob.glob(os.path.join(d, "*.a2l")))
        hrow, arow = (self.old_hex, self.old_a2l) if which == "old" else (self.new_hex, self.new_a2l)
        hrow.var.set(hx[0] if len(hx) == 1 else "")
        arow.var.set(a2[0] if len(a2) == 1 else "")
        if len(hx) != 1 or len(a2) != 1:
            messagebox.showinfo("Pick folder", f"Found {len(hx)} HEX and {len(a2)} A2L in this folder.\n"
                                "Exactly one of each is needed for auto-fill; please pick the files manually.",
                                parent=self)
        if which == "new":
            self._default_out()
        self._validate()

    def browse_out(self):
        p = filedialog.asksaveasfilename(parent=self, defaultextension=".hex", filetypes=[("HEX files", "*.hex")],
                                         initialfile=os.path.basename(self.out_var.get()))
        if p:
            self.out_var.set(p)

    def _validate(self):
        ok = all(r.valid() for r in self._rows().values()) and bool(self.out_var.get().strip())
        self.merge_btn.set_enabled(ok and not self.running)
        if not self.running and not self.rows:
            self.status.config(text="Select the four input files and an output path to enable MERGE." if not ok
                               else "Ready.  Press MERGE.", fg=C["muted"] if not ok else C["ok"])
        return ok

    # ------------------------------------------------------------------ run (worker thread)
    def run(self):
        if self.running or not self._validate():
            return
        v = {k: r.var.get().strip() for k, r in self._rows().items()}
        out = self.out_var.get().strip()
        if os.path.abspath(out) in (os.path.abspath(v["old_hex"]), os.path.abspath(v["new_hex"])):
            return messagebox.showwarning("Output", "The output must be a different file than the inputs.", parent=self)
        if os.path.exists(out) and not messagebox.askyesno("Overwrite?", f"{os.path.basename(out)} exists. Overwrite?",
                                                           parent=self):
            return
        self.running = True
        self.merge_btn.set_enabled(False)
        self.merge_btn.config(text="⏳  Merging…")
        self.progress.pack(fill="x", before=self.tiles_frame, pady=(4, 0))
        self.progress.start(12)
        self.rows, self.summary = [], None
        self._clear_results()

        def work():
            try:
                rows, summary = merge(v["old_a2l"], v["old_hex"], v["new_a2l"], v["new_hex"], out,
                                      log=lambda m: self.q.put(("log", m)))
                self.q.put(("done", (rows, summary)))
            except Exception as e:  # shown to the user
                self.q.put(("error", str(e)))
        threading.Thread(target=work, daemon=True).start()

    def _poll(self):
        try:
            while True:
                kind, data = self.q.get_nowait()
                if kind == "log":
                    self.status.config(text=data.strip(), fg=C["info"])
                elif kind == "done":
                    self._finish(*data)
                elif kind == "error":
                    self._fail(data)
        except queue.Empty:
            pass
        self.after(60, self._poll)

    def _end_run(self):
        self.running = False
        self.progress.stop()
        self.progress.pack_forget()
        self.merge_btn.config(text="▶  MERGE")

    def _fail(self, msg):
        self._end_run()
        self._validate()
        self.status.config(text="Error: " + msg, fg=C["bad"])
        messagebox.showerror("Merge failed", msg, parent=self)

    def _finish(self, rows, summary):
        self._end_run()
        self.rows, self.summary = rows, summary
        for k, lbl in self.tiles.items():
            lbl.config(text=str(summary[k]))
        warns = summary["WARNINGS"]
        txt = f"✔ Done – merged HEX written to {self.out_var.get().strip()}"
        if warns:
            txt += f"   ⚠ {warns} copied with warnings (conversion/layout changed)"
        self.status.config(text=txt, fg=C["warn"] if warns else C["ok"])
        self.merge_btn.set_enabled(True)
        self.set_filter(None)

    # ------------------------------------------------------------------ results
    def _clear_results(self):
        for lbl in self.tiles.values():
            lbl.config(text="–")
        self.tree.delete(*self.tree.get_children())
        self.empty.place(relx=0.5, rely=0.45, anchor="center")
        self.filter_lbl.config(text="")

    def set_filter(self, key):
        self.filter_status = key
        self.filter_lbl.config(text=f"✕ filter: {STATUS[key][0]}" if key else "")
        self.fill_table()

    def fill_table(self):
        self.tree.delete(*self.tree.get_children())
        if not self.rows:
            return
        self.empty.place_forget()
        q = self.search.get().strip().lower()
        i = 0
        for r in self.rows:
            if self.filter_status and r["status"] != self.filter_status:
                continue
            if q and q not in r["name"].lower():
                continue
            tags = [r["status"]] + (["odd"] if i % 2 else [])
            note = r["note"]
            if note.startswith("CONVERSION") or "layout" in note:
                note = "⚠ " + note
            self.tree.insert("", "end", values=(r["name"], STATUS[r["status"]][0], r["type"], r["old_addr"],
                                                r["new_addr"], r["size"], note), tags=tags)
            i += 1

    def save_report(self):
        if not self.rows:
            return messagebox.showinfo("Export", "Run a merge first.", parent=self)
        p = filedialog.asksaveasfilename(parent=self, defaultextension=".csv", filetypes=[("CSV", "*.csv")],
                                         initialfile="merge_report.csv")
        if p:
            write_report(self.rows, p)
            self.status.config(text=f"Report saved: {p}", fg=C["ok"])

    def open_folder(self):
        d = os.path.dirname(os.path.abspath(self.out_var.get().strip() or "."))
        try:
            if hasattr(os, "startfile"):
                os.startfile(d)
            else:
                import subprocess
                subprocess.Popen(["xdg-open", d])
        except Exception:
            pass


if __name__ == "__main__":
    App().mainloop()
