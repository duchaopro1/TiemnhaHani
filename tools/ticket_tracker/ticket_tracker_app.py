#!/usr/bin/env python3
"""Team Ticket Tracker - desktop app (runs locally, no server, no internet).

Load a Jira CSV export, see open tickets per team member, export a list for your chat group.
"""
import os
import sys
import tkinter as tk
import webbrowser
from datetime import date
from tkinter import filedialog, messagebox, ttk

import tracker_core as tc

C = dict(bg="#0f172a", card="#1e293b", card2="#273449", border="#334155", input="#0b1220",
         text="#e2e8f0", muted="#94a3b8", accent="#6366f1", accent_hi="#818cf8", accent_dk="#4f46e5",
         ok="#22c55e", warn="#f59e0b", bad="#ef4444", info="#38bdf8", purple="#a78bfa")
FONT = "Segoe UI" if sys.platform.startswith("win") else "Helvetica"
F = lambda size, bold=False: (FONT, size, "bold" if bold else "normal")
PALETTE = ["#38bdf8", "#a78bfa", "#f59e0b", "#22c55e", "#f472b6", "#fb923c", "#2dd4bf", "#facc15", "#818cf8", "#f87171"]
CARD_W = 250


class HoverButton(tk.Label):
    def __init__(self, master, text, command, bg=None, hover=None, fg="white", font=None, padx=12, pady=5):
        bg, hover = bg or C["card2"], hover or C["border"]
        super().__init__(master, text=text, bg=bg, fg=fg if bg != C["card2"] else C["text"],
                         font=font or F(9, True), padx=padx, pady=pady, cursor="hand2")
        self._bg, self._hover, self._cmd = bg, hover, command
        self.bind("<Enter>", lambda e: self.config(bg=self._hover))
        self.bind("<Leave>", lambda e: self.config(bg=self._bg))
        self.bind("<Button-1>", lambda e: self._cmd())


def entry(master, var=None, width=20):
    return tk.Entry(master, textvariable=var, width=width, bg=C["input"], fg=C["text"], insertbackground=C["text"],
                    relief="flat", font=F(9), highlightthickness=1, highlightbackground=C["border"],
                    highlightcolor=C["accent"])


def card(master, **kw):
    return tk.Frame(master, bg=C["card"], highlightthickness=1, highlightbackground=C["border"], **kw)


def hue_color(name):
    h = 0
    for ch in name:
        h = (h * 31 + ord(ch)) % 360
    import colorsys
    r, g, b = colorsys.hls_to_rgb(h / 360, 0.42, 0.55)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))


class App(tk.Tk):
    def __init__(self, path=None):
        super().__init__()
        self.title("Team Ticket Tracker")
        self.geometry("1320x860")
        self.minsize(1100, 700)
        self.configure(bg=C["bg"])
        self.settings = tc.load_settings()
        self.T = tc.Tracker(self.settings)
        self.sort = ("age", True)
        self.sort_touched = False
        self.status_colors = {}
        self._cols = 0
        self._style()
        self._build()
        self.bind("<Configure>", self._on_resize)
        path = path or self.settings.get("last_file")
        if path and os.path.isfile(path):
            self.after(100, lambda: self.load(path, quiet=True))

    # ------------------------------------------------------------------ style
    def _style(self):
        s = ttk.Style(self)
        s.theme_use("clam")
        s.configure("Treeview", background=C["card"], fieldbackground=C["card"], foreground=C["text"], rowheight=26,
                    borderwidth=0, font=F(9), bordercolor=C["card"], lightcolor=C["card"], darkcolor=C["card"])
        s.layout("Treeview", [("Treeview.treearea", {"sticky": "nswe"})])
        s.configure("Treeview.Heading", background=C["card2"], foreground=C["muted"], relief="flat", font=F(9, True),
                    padding=(8, 6))
        s.map("Treeview.Heading", background=[("active", C["border"])])
        s.map("Treeview", background=[("selected", C["accent_dk"])], foreground=[("selected", "white")])
        for o in ("Vertical", "Horizontal"):
            s.configure(f"{o}.TScrollbar", background=C["card2"], troughcolor=C["card"], bordercolor=C["card"],
                        arrowcolor=C["muted"], relief="flat")
        s.configure("TCombobox", fieldbackground=C["input"], background=C["card2"], foreground=C["text"],
                    arrowcolor=C["text"], bordercolor=C["border"])
        s.map("TCombobox", fieldbackground=[("readonly", C["input"]), ("focus", C["input"])],
              foreground=[("readonly", C["text"])], background=[("readonly", C["card2"])],
              selectbackground=[("readonly", C["input"])], selectforeground=[("readonly", C["text"])])
        self.option_add("*TCombobox*Listbox.background", C["input"])
        self.option_add("*TCombobox*Listbox.foreground", C["text"])

    # ------------------------------------------------------------------ layout
    def _build(self):
        hdr = tk.Frame(self, bg=C["accent_dk"])
        hdr.pack(fill="x")
        inner = tk.Frame(hdr, bg=C["accent_dk"])
        inner.pack(fill="x", padx=22, pady=12)
        tk.Label(inner, text="▦", bg=C["accent_dk"], fg="white", font=F(24, True)).pack(side="left", padx=(0, 12))
        t = tk.Frame(inner, bg=C["accent_dk"])
        t.pack(side="left")
        tk.Label(t, text="Team Ticket Tracker", bg=C["accent_dk"], fg="white", font=F(16, True)).pack(anchor="w")
        tk.Label(t, text="Open tickets per team member · export a ready-to-paste list for your chat group",
                 bg=C["accent_dk"], fg="#c7d2fe", font=F(9)).pack(anchor="w")
        bar = tk.Frame(inner, bg=C["accent_dk"])
        bar.pack(side="right")
        self.fileinfo = tk.Label(bar, text="", bg=C["accent_dk"], fg="#c7d2fe", font=F(9))
        self.fileinfo.pack(side="left", padx=12)
        for text, cmd in (("⚙ Settings", self.open_settings), ("↻ Reload", self.reload),
                          ("\U0001F4C2 Load CSV…", self.choose)):
            b = HoverButton(bar, text, cmd, bg="#6d73f0", hover="#8b90f5", fg="white")
            b.pack(side="right", padx=3)

        body = tk.Frame(self, bg=C["bg"])
        body.pack(fill="both", expand=True, padx=20, pady=14)
        body.columnconfigure(0, weight=3)
        body.columnconfigure(1, weight=0, minsize=400)
        body.rowconfigure(1, weight=1)

        # KPI row
        self.kpi_frame = tk.Frame(body, bg=C["bg"])
        self.kpi_frame.grid(row=0, column=0, columnspan=2, sticky="ew")
        self.kpis = []
        for i in range(5):
            self.kpi_frame.columnconfigure(i, weight=1, uniform="k")
            f = card(self.kpi_frame)
            f.grid(row=0, column=i, sticky="ew", padx=(0 if i == 0 else 8, 0))
            strip = tk.Frame(f, bg=C["accent_hi"], height=3)
            strip.pack(fill="x")
            n = tk.Label(f, text="–", bg=C["card"], fg=C["text"], font=F(22, True))
            n.pack(pady=(6, 0))
            l = tk.Label(f, text="", bg=C["card"], fg=C["muted"], font=F(9))
            l.pack(pady=(0, 6))
            self.kpis.append((strip, n, l))

        # left column
        left = tk.Frame(body, bg=C["bg"])
        left.grid(row=1, column=0, sticky="nsew", pady=(12, 0), padx=(0, 12))
        left.rowconfigure(2, weight=1)
        left.columnconfigure(0, weight=1)
        tb = tk.Frame(left, bg=C["bg"])
        tb.grid(row=0, column=0, sticky="ew")
        tk.Label(tb, text="Team members", bg=C["bg"], fg=C["text"], font=F(11, True)).pack(side="left")
        self.mq = tk.StringVar()
        self.mq.trace_add("write", lambda *a: self.render_members())
        entry(tb, self.mq, 14).pack(side="left", padx=8, ipady=3)
        HoverButton(tb, "Clear selection", self.clear_sel).pack(side="left")
        self.show_done = tk.BooleanVar()
        tk.Checkbutton(tb, text="include closed tickets", variable=self.show_done, command=self.on_show_done,
                       bg=C["bg"], fg=C["muted"], selectcolor=C["input"], activebackground=C["bg"],
                       activeforeground=C["text"], font=F(9)).pack(side="right")
        self.q = tk.StringVar()
        self.q.trace_add("write", lambda *a: self.on_query())
        entry(tb, self.q, 20).pack(side="right", padx=8, ipady=3)
        tk.Label(tb, text="Search", bg=C["bg"], fg=C["muted"], font=F(9)).pack(side="right")

        # member cards (scrollable)
        mwrap = tk.Frame(left, bg=C["bg"], height=250)
        mwrap.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        mwrap.grid_propagate(False)
        mwrap.rowconfigure(0, weight=1)
        mwrap.columnconfigure(0, weight=1)
        self.mcanvas = tk.Canvas(mwrap, bg=C["bg"], highlightthickness=0)
        msb = ttk.Scrollbar(mwrap, orient="vertical", command=self.mcanvas.yview)
        self.mcanvas.configure(yscrollcommand=msb.set)
        self.mcanvas.grid(row=0, column=0, sticky="nsew")
        msb.grid(row=0, column=1, sticky="ns")
        self.mframe = tk.Frame(self.mcanvas, bg=C["bg"])
        self.mcanvas.create_window((0, 0), window=self.mframe, anchor="nw")
        self.mframe.bind("<Configure>", lambda e: self.mcanvas.configure(scrollregion=self.mcanvas.bbox("all")))
        self.mcanvas.bind("<Enter>", lambda e: self._wheel(True))
        self.mcanvas.bind("<Leave>", lambda e: self._wheel(False))

        # tickets table
        tcard = card(left)
        tcard.grid(row=2, column=0, sticky="nsew", pady=(12, 0))
        th = tk.Frame(tcard, bg=C["card"])
        th.pack(fill="x", padx=12, pady=8)
        tk.Label(th, text="Tickets", bg=C["card"], fg=C["text"], font=F(11, True)).pack(side="left")
        self.tinfo = tk.Label(th, text="", bg=C["card"], fg=C["muted"], font=F(9))
        self.tinfo.pack(side="left", padx=10)
        tk.Label(th, text="double-click a row to open it in the browser", bg=C["card"], fg=C["muted"],
                 font=F(8)).pack(side="right")
        tw = tk.Frame(tcard, bg=C["card"])
        tw.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(tw, show="headings", selectmode="extended")
        tsb = ttk.Scrollbar(tw, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=tsb.set)
        self.tree.pack(side="left", fill="both", expand=True)
        tsb.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", self.open_selected)
        self.tree.bind("<Button-3>", self.row_menu)
        self.tree.bind("<Control-c>", lambda e: self.copy_links())
        self.tree.tag_configure("odd", background=C["card2"])
        self.menu = tk.Menu(self, tearoff=0)
        self.menu.add_command(label="Open in browser", command=lambda: self.open_selected())
        self.menu.add_command(label="Copy link(s)", command=self.copy_links)

        # right column
        right = tk.Frame(body, bg=C["bg"])
        right.grid(row=1, column=1, sticky="nsew", pady=(12, 0))
        right.rowconfigure(1, weight=1)
        right.columnconfigure(0, weight=1)
        fc = card(right)
        fc.grid(row=0, column=0, sticky="ew")
        self.bars_status = self._bars_block(fc, "Open tickets by status")
        self.project_block = tk.Frame(fc, bg=C["card"])
        self.project_block.pack(fill="x")
        self.bars_project = self._bars_block(self.project_block, "Open tickets by project")
        ec = card(right)
        ec.grid(row=1, column=0, sticky="nsew", pady=(12, 0))
        tk.Label(ec, text="Export for chat", bg=C["card"], fg=C["text"], font=F(11, True)).pack(anchor="w", padx=12, pady=(10, 0))
        tk.Label(ec, text="uses the current filters", bg=C["card"], fg=C["muted"], font=F(8)).pack(anchor="w", padx=12)
        row = tk.Frame(ec, bg=C["card"])
        row.pack(fill="x", padx=12, pady=8)
        self.fmt = tk.StringVar(value=tc.FORMATS[0][1])
        cb = ttk.Combobox(row, textvariable=self.fmt, values=[x[1] for x in tc.FORMATS], state="readonly", width=30)
        cb.pack(side="left")
        cb.bind("<<ComboboxSelected>>", lambda e: self.render_export())
        self.extra = tk.BooleanVar()
        tk.Checkbutton(row, text="add status & project", variable=self.extra, command=self.render_export, bg=C["card"],
                       fg=C["muted"], selectcolor=C["input"], activebackground=C["card"], activeforeground=C["text"],
                       font=F(9)).pack(side="left", padx=8)
        tw2 = tk.Frame(ec, bg=C["card"])
        tw2.pack(fill="both", expand=True, padx=12)
        self.preview = tk.Text(tw2, wrap="none", bg=C["input"], fg=C["text"], insertbackground=C["text"], relief="flat",
                               font=("Consolas" if sys.platform.startswith("win") else "Courier", 9), height=10, width=40,
                               highlightthickness=1, highlightbackground=C["border"])
        psy = ttk.Scrollbar(tw2, orient="vertical", command=self.preview.yview)
        psx = ttk.Scrollbar(ec, orient="horizontal", command=self.preview.xview)
        self.preview.configure(yscrollcommand=psy.set, xscrollcommand=psx.set)
        self.preview.pack(side="left", fill="both", expand=True)
        psy.pack(side="right", fill="y")
        psx.pack(fill="x", padx=12)
        brow = tk.Frame(ec, bg=C["card"])
        brow.pack(fill="x", padx=12, pady=10)
        HoverButton(brow, "\U0001F4CB  Copy to clipboard", self.copy_export, C["accent"], C["accent_hi"], font=F(10, True),
                    padx=16, pady=7).pack(side="left")
        HoverButton(brow, "⬇ Save file…", self.save_export).pack(side="left", padx=8)
        self.einfo = tk.Label(brow, text="", bg=C["card"], fg=C["muted"], font=F(9))
        self.einfo.pack(side="left")

        # empty-state overlay
        self.empty = tk.Frame(self, bg=C["bg"])
        tk.Label(self.empty, text="\U0001F4CA", bg=C["bg"], font=F(46)).pack(pady=(110, 0))
        tk.Label(self.empty, text="Load your Jira export to get started", bg=C["bg"], fg=C["text"], font=F(18, True)).pack()
        tk.Label(self.empty, text="In TMS (Jira): open your issue list / filter → Export → CSV (current or all fields)",
                 bg=C["bg"], fg=C["muted"], font=F(10)).pack(pady=(8, 18))
        HoverButton(self.empty, "\U0001F4C2  Load CSV file…", self.choose, C["accent"], C["accent_hi"], font=F(12, True),
                    padx=26, pady=10).pack()
        self.empty.place(x=0, y=70, relwidth=1, relheight=1)

    def _bars_block(self, parent, title):
        tk.Label(parent, text=title, bg=C["card"], fg=C["text"], font=F(11, True)).pack(anchor="w", padx=12, pady=(10, 0))
        tk.Label(parent, text="click to filter", bg=C["card"], fg=C["muted"], font=F(8)).pack(anchor="w", padx=12)
        f = tk.Frame(parent, bg=C["card"])
        f.pack(fill="x", padx=8, pady=(4, 8))
        return f

    # ------------------------------------------------------------------ loading
    def choose(self):
        p = filedialog.askopenfilename(parent=self, title="Select the Jira CSV export",
                                       filetypes=[("CSV files", "*.csv *.tsv *.txt"), ("All files", "*.*")])
        if p:
            self.load(p)

    def reload(self):
        if self.T.file and os.path.isfile(self.T.file):
            self.load(self.T.file)
        else:
            self.choose()

    def load(self, path, quiet=False):
        try:
            missing = self.T.load(path)
        except Exception as e:
            if not quiet:
                messagebox.showerror("Cannot read file", str(e), parent=self)
            return
        self.settings["last_file"] = path
        tc.save_settings(self.settings)
        self.status_colors = {s: PALETTE[i % len(PALETTE)] for i, s in enumerate(self.T.statuses())}
        self.q.set("")
        self.show_done.set(False)
        self.T.show_done = False
        self.sort_touched = False
        self.sort = ("prio", False) if self.T.multi_prio else ("age", True)
        self.empty.place_forget()
        self.fileinfo.config(text=f"{os.path.basename(path)} · {len(self.T.tickets)} rows")
        self.refresh()
        if missing:
            labels = {f: l for f, l, _ in tc.FIELDS}
            messagebox.showwarning("Columns not recognised", "Could not find: " + ", ".join(labels[m] for m in missing) +
                                   "\n\nPlease map them in Settings.", parent=self)
            self.open_settings()

    # ------------------------------------------------------------------ filters
    def on_query(self):
        self.T.query = self.q.get().strip()
        self.refresh()

    def on_show_done(self):
        self.T.show_done = self.show_done.get()
        self.refresh()

    def clear_sel(self):
        self.T.clear_selection()
        self.refresh()

    def toggle(self, s, v):
        s.discard(v) if v in s else s.add(v)
        self.refresh()

    # ------------------------------------------------------------------ rendering
    def refresh(self):
        self.base = self.T.base()
        self.view = self.T.view(self.base)
        self.render_kpis()
        self.render_members()
        self.render_bars()
        self.render_table()
        self.render_export()

    def render_kpis(self):
        T, b, v = self.T, self.base, self.view
        filt = T.sel_members or T.sel_status or T.sel_project
        data = [("Tickets" + (" (filtered)" if filt else ""), len(v), C["accent_hi"]),
                ("Team members", len({t.assignee for t in b}), C["info"])]
        if T.multi_prio:
            data.append(("Urgent (High+)", sum(1 for t in v if t.rank <= 2), C["bad"]))
        else:
            data.append((f"Stale (> {tc.STALE_DAYS} days)", sum(1 for t in v if t.age is not None and t.age > tc.STALE_DAYS), C["bad"]))
        data += [("Overdue (past due date)", sum(1 for t in v if T.is_over(t)), C["warn"]),
                 ("Unassigned", sum(1 for t in b if t.assignee == "Unassigned"), C["muted"])]
        for (strip, n, l), (label, val, col) in zip(self.kpis, data):
            strip.config(bg=col)
            n.config(text=str(val), fg=col)
            l.config(text=label)

    def _wheel(self, on):
        if on:
            self.bind_all("<MouseWheel>", lambda e: self.mcanvas.yview_scroll(-1 * (e.delta // 120 or (1 if e.delta > 0 else -1)), "units"))
            self.bind_all("<Button-4>", lambda e: self.mcanvas.yview_scroll(-1, "units"))
            self.bind_all("<Button-5>", lambda e: self.mcanvas.yview_scroll(1, "units"))
        else:
            for ev in ("<MouseWheel>", "<Button-4>", "<Button-5>"):
                self.unbind_all(ev)

    def _on_resize(self, e):
        if e.widget is self:
            w = self.mcanvas.winfo_width()
            cols = max(1, w // (CARD_W + 10))
            if cols != self._cols and self.T.tickets:
                self.render_members()

    def render_members(self):
        for w in self.mframe.winfo_children():
            w.destroy()
        if not self.T.tickets:
            return
        T = self.T
        groups = {}
        for t in self.base:
            if T.by_status(t) and T.by_project(t):
                groups.setdefault(t.assignee, []).append(t)
        mq = self.mq.get().strip().lower()
        items = sorted(((n, ts) for n, ts in groups.items() if not mq or mq in n.lower()),
                       key=lambda x: (-len(x[1]), x[0].lower()))
        self._cols = cols = max(1, self.mcanvas.winfo_width() // (CARD_W + 10))
        if not items:
            tk.Label(self.mframe, text="No members match.", bg=C["bg"], fg=C["muted"], font=F(10)).grid(padx=20, pady=20)
            return
        for i, (name, ts) in enumerate(items):
            self._member_card(name, ts).grid(row=i // cols, column=i % cols, padx=(0, 10), pady=(0, 10), sticky="nw")

    def _member_card(self, name, ts):
        T = self.T
        sel = name in T.sel_members
        bg = C["card2"] if sel else C["card"]
        f = tk.Frame(self.mframe, bg=bg, highlightthickness=2 if sel else 1,
                     highlightbackground=C["accent_hi"] if sel else C["border"], cursor="hand2", width=CARD_W)
        top = tk.Frame(f, bg=bg)
        top.pack(fill="x", padx=10, pady=(10, 4))
        av = tk.Canvas(top, width=38, height=38, bg=bg, highlightthickness=0)
        av.create_oval(1, 1, 37, 37, fill=hue_color(name), outline="")
        av.create_text(19, 19, text=tc.initials(name), fill="white", font=F(10, True))
        av.pack(side="left")
        txt = tk.Frame(top, bg=bg)
        txt.pack(side="left", padx=10)
        tk.Label(txt, text=name if len(name) <= 22 else name[:21] + "…", bg=bg, fg=C["text"], font=F(10, True),
                 anchor="w").pack(anchor="w")
        cnt = tk.Frame(txt, bg=bg)
        cnt.pack(anchor="w")
        tk.Label(cnt, text=str(len(ts)), bg=bg, fg=C["text"], font=F(14, True)).pack(side="left")
        tk.Label(cnt, text=" ticket" + ("" if len(ts) == 1 else "s"), bg=bg, fg=C["muted"], font=F(9)).pack(side="left")
        bar = tk.Canvas(f, width=CARD_W - 20, height=8, bg=C["input"], highlightthickness=0)
        bar.pack(padx=10, pady=(2, 4))
        by = {}
        for t in ts:
            by[t.status] = by.get(t.status, 0) + 1
        x = 0.0
        for s, c in by.items():
            w = (CARD_W - 20) * c / len(ts)
            bar.create_rectangle(x, 0, x + w, 8, fill=self.status_colors.get(s, C["info"]), outline="")
            x += w
        badges = tk.Frame(f, bg=bg)
        badges.pack(fill="x", padx=10, pady=(0, 10))
        urg = sum(1 for t in ts if t.rank <= 2) if T.multi_prio else 0
        ov = sum(1 for t in ts if T.is_over(t))
        stale = sum(1 for t in ts if t.age is not None and t.age > tc.STALE_DAYS)
        pills = [p for p in ((f"▲ {urg} urgent", "#fca5a5", "#3b1219") if urg else None,
                             (f"⏰ {ov} overdue", "#fcd34d", "#2d1f0a") if ov else None,
                             (f"⌛ {stale} > {tc.STALE_DAYS}d", "#c4b5fd", "#1e1536") if stale else None) if p]
        for txt_, fg, bgc in pills:
            tk.Label(badges, text=txt_, fg=fg, bg=bgc, font=F(8), padx=6).pack(side="left", padx=(0, 4))
        if not (urg or ov or stale):
            tk.Label(badges, text=" ", bg=bg, font=F(8)).pack()
        self._bind_all(f, lambda e, n=name: self.toggle(T.sel_members, n))
        return f

    def _bind_all(self, w, cb):
        w.bind("<Button-1>", cb)
        for c in w.winfo_children():
            self._bind_all(c, cb)

    def render_bars(self):
        T = self.T
        if T.has_project:
            self.project_block.pack(fill="x")
        else:
            self.project_block.pack_forget()
        specs = [(self.bars_status, "status", T.sel_status, lambda t: T.by_member(t) and T.by_project(t)),
                 (self.bars_project, "project", T.sel_project, lambda t: T.by_member(t) and T.by_status(t))]
        for frame, field, sel, filt in specs:
            for w in frame.winfo_children():
                w.destroy()
            cnt = {}
            for t in self.base:
                if filt(t):
                    v = getattr(t, field)
                    cnt[v] = cnt.get(v, 0) + 1
            ents = sorted(cnt.items(), key=lambda x: -x[1])
            if not ents:
                tk.Label(frame, text="No tickets.", bg=C["card"], fg=C["muted"]).pack(pady=6)
                continue
            mx = max(c for _, c in ents)
            for v, c in ents[:12]:
                on = v in sel
                bg = C["card2"] if on else C["card"]
                r = tk.Frame(frame, bg=bg, cursor="hand2")
                r.pack(fill="x", pady=1)
                tk.Label(r, text=v if len(v) <= 16 else v[:15] + "…", bg=bg, fg=C["text"], font=F(9), width=16,
                         anchor="w").pack(side="left", padx=(6, 0))
                cv = tk.Canvas(r, width=190, height=12, bg=C["input"], highlightthickness=0)
                cv.create_rectangle(0, 0, 190 * c / mx, 12, outline="",
                                    fill=self.status_colors.get(v, C["accent_hi"]) if field == "status" else C["accent_hi"])
                cv.pack(side="left", padx=8, pady=3)
                tk.Label(r, text=str(c), bg=bg, fg=C["muted"], font=F(9), width=4, anchor="e").pack(side="left")
                self._bind_all(r, lambda e, s=sel, x=v: self.toggle(s, x))
            if len(ents) > 12:
                tk.Label(frame, text=f"+ {len(ents) - 12} more (use search / member filter)", bg=C["card"], fg=C["muted"],
                         font=F(8)).pack(anchor="w", padx=8)

    def columns(self):
        cols = [("key", "ID", 135), ("summary", "Summary", 300), ("assignee", "Assignee", 100)]
        if self.T.has_project:
            cols.append(("project", "Project", 105))
        cols.append(("status", "Status", 80))
        if self.T.multi_prio:
            cols.append(("prio", "Priority", 70))
        return cols + [("age", "Age (d)", 60), ("due", "Due", 90)]

    def render_table(self):
        cols = self.columns()
        self.tree["columns"] = [c[0] for c in cols]
        for k, label, w in cols:
            arrow = (" ▲" if self.sort[1] else " ▼") if self.sort[0] == k else ""
            self.tree.heading(k, text=label + arrow, command=lambda k=k: self.sort_by(k))
            self.tree.column(k, width=w, minwidth=60 if k != "summary" else 200, anchor="e" if k == "age" else "w",
                             stretch=(k == "summary"))
        for s, col in self.status_colors.items():
            self.tree.tag_configure("st:" + s, foreground=col)
        self.tree.delete(*self.tree.get_children())
        key, asc = self.sort
        nat = lambda s: [int(x) if x.isdigit() else x.lower() for x in __import__("re").split(r"(\d+)", s)]
        val = {"key": lambda t: nat(t.key), "summary": lambda t: t.summary.lower(), "assignee": lambda t: t.assignee.lower(),
               "project": lambda t: t.project, "status": lambda t: t.status, "prio": lambda t: t.rank,
               "age": lambda t: -1 if t.age is None else t.age,
               "due": lambda t: t.due or date.max}[key]
        rows = sorted(self.view, key=val, reverse=not asc)
        self.row_tickets = {}
        for i, t in enumerate(rows[:1500]):
            vals = {"key": t.key, "summary": t.summary, "assignee": t.assignee, "project": t.project, "status": t.status,
                    "prio": t.priority or "–", "age": "–" if t.age is None else t.age,
                    "due": t.due.strftime("%d/%m/%Y") + (" ⏰" if self.T.is_over(t) else "") if t.due else "–"}
            iid = self.tree.insert("", "end", values=[vals[c[0]] for c in cols],
                                   tags=("odd" if i % 2 else "", "st:" + t.status))
            self.row_tickets[iid] = t
        self.tinfo.config(text=f"{len(rows)} ticket{'' if len(rows) == 1 else 's'}" +
                          (" (showing first 1500 – export has all)" if len(rows) > 1500 else ""))

    def sort_by(self, k):
        self.sort = (k, not self.sort[1]) if self.sort[0] == k else (k, True)
        self.render_table()

    def fmt_key(self):
        return next(k for k, l in tc.FORMATS if l == self.fmt.get())

    def export_text(self):
        return self.T.export_text(self.view, self.fmt_key(), self.extra.get())

    def render_export(self):
        txt = self.export_text()
        self.preview.config(state="normal")
        self.preview.delete("1.0", "end")
        self.preview.insert("1.0", txt or "(no tickets match the current filters)")
        self.preview.config(state="disabled")
        n = len({t.assignee for t in self.view})
        self.einfo.config(text=f"{len(self.view)} tickets · {n} {'person' if n == 1 else 'people'}")

    # ------------------------------------------------------------------ actions
    def toast(self, msg):
        t = tk.Label(self, text=msg, bg=C["ok"], fg="#052e16", font=F(10, True), padx=18, pady=7)
        t.place(relx=0.5, rely=0.94, anchor="center")
        self.after(1600, t.destroy)

    def copy_export(self):
        txt = self.export_text()
        if not txt:
            return self.toast("Nothing to copy")
        self.clipboard_clear()
        self.clipboard_append(txt)
        self.update()
        self.toast("Copied to clipboard!")

    def save_export(self):
        k = self.fmt_key()
        ext = {"csv": ".csv", "markdown": ".md"}.get(k, ".txt")
        p = filedialog.asksaveasfilename(parent=self, defaultextension=ext, initialfile=f"tickets_{date.today():%Y%m%d}{ext}",
                                         filetypes=[("Export", "*" + ext), ("All files", "*.*")])
        if p:
            with open(p, "w", encoding="utf-8-sig" if k == "csv" else "utf-8", newline="") as f:
                f.write(self.export_text())
            self.toast("Saved")

    def selected_tickets(self):
        return [self.row_tickets[i] for i in self.tree.selection() if i in self.row_tickets]

    def open_selected(self, e=None):
        for t in self.selected_tickets()[:5]:
            webbrowser.open(self.T.link(t))

    def copy_links(self):
        ts = self.selected_tickets()
        if ts:
            self.clipboard_clear()
            self.clipboard_append("\n".join(self.T.link(t) for t in ts))
            self.toast(f"Copied {len(ts)} link(s)")

    def row_menu(self, e):
        iid = self.tree.identify_row(e.y)
        if iid:
            if iid not in self.tree.selection():
                self.tree.selection_set(iid)
            self.menu.tk_popup(e.x_root, e.y_root)

    # ------------------------------------------------------------------ settings dialog
    def open_settings(self):
        if not self.T.tickets and not self.T.header:
            return self.choose()
        T = self.T
        d = tk.Toplevel(self)
        d.title("Settings")
        d.configure(bg=C["card"])
        d.geometry("640x700")
        d.transient(self)
        d.grab_set()
        pad = dict(padx=16, pady=(12, 2), anchor="w")
        tk.Label(d, text="Task link = base URL + ticket ID", bg=C["card"], fg=C["muted"], font=F(9)).pack(**pad)
        base = tk.StringVar(value=T.base_url)
        entry(d, base, 70).pack(fill="x", padx=16, ipady=4)

        tk.Label(d, text="Columns (auto-detected from the CSV header - change if wrong)", bg=C["card"], fg=C["muted"],
                 font=F(9)).pack(**pad)
        grid = tk.Frame(d, bg=C["card"])
        grid.pack(fill="x", padx=16)
        grid.columnconfigure(1, weight=1)
        hdr = T.header
        opts = ["(none)"] + [f"#{i + 1}  {h}" for i, h in enumerate(hdr)]
        combos = {}
        for r, (f, label, _) in enumerate(tc.FIELDS):
            tk.Label(grid, text=label, bg=C["card"], fg=C["text"], font=F(9), width=16, anchor="w").grid(row=r, column=0, pady=2)
            cb = ttk.Combobox(grid, values=opts, state="readonly")
            cb.current(T.map[f] + 1 if f in T.map else 0)
            cb.grid(row=r, column=1, sticky="ew", pady=2)
            combos[f] = cb

        tk.Label(d, text="Display names - Jira exports usernames. One per line:  username = Full name", bg=C["card"],
                 fg=C["muted"], font=F(9)).pack(**pad)
        names = tk.Text(d, height=5, bg=C["input"], fg=C["text"], insertbackground=C["text"], relief="flat", font=F(9),
                        highlightthickness=1, highlightbackground=C["border"])
        names.pack(fill="x", padx=16)
        names.insert("1.0", "\n".join(f"{k} = {v}" for k, v in T.names.items()))

        tk.Label(d, text="Statuses that count as OPEN (untick the ones that mean finished)", bg=C["card"], fg=C["muted"],
                 font=F(9)).pack(**pad)
        sf = tk.Frame(d, bg=C["card"])
        sf.pack(fill="x", padx=16)
        svars = {}
        for i, s in enumerate(T.statuses()):
            v = tk.BooleanVar(value=s not in T.done)
            svars[s] = v
            tk.Checkbutton(sf, text=s, variable=v, bg=C["card"], fg=C["text"], selectcolor=C["input"],
                           activebackground=C["card"], activeforeground=C["text"], font=F(9)).grid(
                row=i // 3, column=i % 3, sticky="w", padx=4)

        def apply():
            self.settings["base_url"] = base.get().strip() or tc.DEFAULT_BASE_URL
            nm = {}
            for line in names.get("1.0", "end").splitlines():
                if "=" in line:
                    a, b = line.split("=", 1)
                    if a.strip() and b.strip():
                        nm[a.strip().lower()] = b.strip()
            self.settings["names"] = nm
            self.settings["status_override"] = {s: ("open" if v.get() else "done") for s, v in svars.items()}
            T.map = {f: cb.current() - 1 for f, cb in combos.items() if cb.current() > 0}
            tc.save_settings(self.settings)
            T.clear_selection()
            T.build()
            self.status_colors = {s: PALETTE[i % len(PALETTE)] for i, s in enumerate(T.statuses())}
            self.fileinfo.config(text=f"{os.path.basename(T.file)} · {len(T.tickets)} rows")
            d.destroy()
            self.refresh()
        bf = tk.Frame(d, bg=C["card"])
        bf.pack(side="bottom", fill="x", padx=16, pady=14)
        HoverButton(bf, "Apply", apply, C["accent"], C["accent_hi"], font=F(10, True), padx=22, pady=7).pack(side="right")
        HoverButton(bf, "Cancel", d.destroy).pack(side="right", padx=8)


if __name__ == "__main__":
    App(sys.argv[1] if len(sys.argv) > 1 else None).mainloop()
