"""Core logic of the Team Ticket Tracker (no GUI): Jira CSV import, filtering, export text."""
import csv
import json
import os
import re
import sys
from datetime import date, datetime
from urllib.parse import quote

DEFAULT_BASE_URL = "https://tms.vinfast.vn/browse/"
SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".ticket_tracker.json")

FIELDS = [  # (field, label, accepted header names - lower case)
    ("key", "Ticket ID *", ["issue key", "key", "ticket id", "id ticket", "mã ticket", "khóa vấn đề"]),
    ("summary", "Summary *", ["summary", "title", "subject", "tóm tắt", "tiêu đề"]),
    ("assignee", "Assignee *", ["assignee", "assigned to", "owner", "người được giao", "người thực hiện"]),
    ("status", "Status *", ["status", "trạng thái"]),
    ("priority", "Priority", ["priority", "mức độ ưu tiên", "độ ưu tiên"]),
    ("due", "Due date", ["due date", "due", "duedate", "ngày hết hạn", "hạn chót"]),
    ("type", "Issue type", ["issue type", "type", "loại vấn đề"]),
    ("category", "Status category", ["status category", "statuscategory"]),
    ("project", "Project", ["project key", "project", "project name", "dự án"]),
    ("created", "Created", ["created", "ngày tạo"]),
]
REQUIRED = ["key", "summary", "assignee", "status"]
DONE_RE = re.compile(r"^(done|closed|resolved|complete[d]?|cancel+ed|rejected|fixed|verified|released|duplicate|"
                     r"obsolete|won'?t (do|fix)|hoàn thành|đã đóng|đóng|hủy|đã hủy)$", re.I)
MON = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
FORMATS = [("grouped", "List grouped by person"),
           ("oneline", "One line per ticket (Name | ID | Summary | Link)"),
           ("markdown", "Markdown table"),
           ("csv", "CSV (Excel)")]
STALE_DAYS = 30


# ----------------------------------------------------------------------------- settings
def load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_settings(d):
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    except OSError:
        pass


# ----------------------------------------------------------------------------- parsing
def read_rows(path):
    """Read a CSV/TSV (Jira export) into a list of rows. Handles BOM, ; , or TAB, quoted newlines."""
    try:
        csv.field_size_limit(sys.maxsize)
    except OverflowError:
        csv.field_size_limit(2 ** 31 - 1)
    raw = open(path, "rb").read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    first = text.split("\n", 1)[0]
    delim = max([",", ";", "\t"], key=lambda c: first.count(c))
    import io
    rows = [r for r in csv.reader(io.StringIO(text, newline=""), delimiter=delim) if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise ValueError("The file has no data rows.")
    return rows


def detect_columns(header):
    low = [h.strip().lower() for h in header]
    m = {}
    for f, _label, names in FIELDS:
        for n in names:
            if n in low:
                m[f] = low.index(n)
                break
    return m


def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    m = re.match(r"^(\d{1,2})/([A-Za-z]{3})[a-z]*/(\d{2,4})", s)
    if m and m.group(2).lower() in MON:
        y = int(m.group(3))
        return date(y + 2000 if y < 100 else y, MON[m.group(2).lower()] + 1, int(m.group(1)))
    for pat, order in ((r"^(\d{4})-(\d{2})-(\d{2})", "ymd"), (r"^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", "dmy")):
        m = re.match(pat, s)
        if m:
            a, b, c = (int(x) for x in m.groups())
            try:
                return date(a, b, c) if order == "ymd" else date(c, b, a)
            except ValueError:
                return None
    return None


def prio_rank(p):
    p = (p or "").lower()
    if re.search(r"blocker|highest|critical|urgent|\bp0\b|\bp1\b|khẩn", p):
        return 1
    if re.search(r"lowest|trivial|\bp5\b", p):
        return 5
    if re.search(r"high|major|\bp2\b|cao", p):
        return 2
    if re.search(r"low|minor|\bp4\b|thấp", p):
        return 4
    if re.search(r"medium|normal|\bp3\b|trung", p):
        return 3
    return 3 if p else 3.5


class Ticket:
    __slots__ = ("key", "summary", "assignee", "status", "priority", "type", "due", "cat", "project",
                 "created", "age", "rank")


def initials(name):
    w = name.split()
    return (w[0][0] + w[-1][0] if len(w) > 1 else name[:2]).upper()


# ----------------------------------------------------------------------------- tracker
class Tracker:
    def __init__(self, settings):
        self.settings = settings
        self.rows, self.header, self.file = [], [], ""
        self.map, self.tickets, self.done = {}, [], set()
        self.sel_members, self.sel_status, self.sel_project = set(), set(), set()
        self.query, self.show_done = "", False
        self.multi_prio = False
        self.has_project = True

    # ---- settings shortcuts
    @property
    def base_url(self):
        return self.settings.get("base_url") or DEFAULT_BASE_URL

    @property
    def names(self):
        return self.settings.get("names", {})

    def link(self, t):
        return self.base_url.rstrip("/") + "/" + quote(t.key)

    # ---- loading
    def load(self, path):
        rows = read_rows(path)
        self.rows, self.header, self.file = rows, rows[0], path
        self.map = detect_columns(rows[0])
        self.clear_selection()
        self.build()
        return [f for f in REQUIRED if f not in self.map]  # missing required columns

    def clear_selection(self):
        self.sel_members.clear(); self.sel_status.clear(); self.sel_project.clear()

    def build(self):
        m, names, today = self.map, self.names, date.today()
        ov = self.settings.get("status_override", {})

        def g(r, f):
            i = m.get(f)
            return r[i].strip() if i is not None and i < len(r) else ""
        out = []
        for r in self.rows[1:]:
            t = Ticket()
            t.key = g(r, "key")
            if not t.key:
                continue
            t.summary = re.sub(r"\s*[\r\n]+\s*", " ", g(r, "summary"))
            user = g(r, "assignee")
            t.assignee = names.get(user.lower(), user) if user else "Unassigned"
            t.status = g(r, "status") or "(no status)"
            t.priority, t.type, t.cat = g(r, "priority"), g(r, "type"), g(r, "category")
            t.due, t.created = parse_date(g(r, "due")), parse_date(g(r, "created"))
            t.project = g(r, "project") or "–"
            t.age = max(0, (today - t.created).days) if t.created else None
            t.rank = prio_rank(t.priority)
            out.append(t)
        self.tickets = out
        self.multi_prio = len({t.priority for t in out}) > 1
        self.has_project = any(t.project != "–" for t in out)
        self.done = set()
        for t in out:
            o = ov.get(t.status)
            default = bool(re.fullmatch(r"done", t.cat, re.I)) if t.cat else bool(DONE_RE.match(t.status))
            if o == "done" or (o != "open" and default):
                self.done.add(t.status)

    # ---- predicates / views
    def is_open(self, t):
        return t.status not in self.done

    def is_over(self, t):
        return bool(t.due and self.is_open(t) and t.due < date.today())

    def base(self):
        q = self.query.lower()
        return [t for t in self.tickets if (self.show_done or self.is_open(t)) and
                (not q or q in (t.key + " " + t.summary + " " + t.assignee).lower())]

    def by_member(self, t): return not self.sel_members or t.assignee in self.sel_members
    def by_status(self, t): return not self.sel_status or t.status in self.sel_status
    def by_project(self, t): return not self.sel_project or t.project in self.sel_project

    def view(self, base=None):
        return [t for t in (base if base is not None else self.base())
                if self.by_member(t) and self.by_status(t) and self.by_project(t)]

    def statuses(self):
        return sorted({t.status for t in self.tickets})

    # ---- export
    def export_text(self, view, fmt, extra=False):
        if not view:
            return ""
        ex = (lambda t: f" [{t.status} · {t.project}" + (f" · {t.priority}" if self.multi_prio and t.priority else "") + "]") \
            if extra else (lambda t: "")
        nat = lambda k: [int(x) if x.isdigit() else x.lower() for x in re.split(r"(\d+)", k)]
        s = sorted(view, key=lambda t: (t.assignee.lower(), t.rank, nat(t.key)))
        groups = {}
        for t in s:
            groups.setdefault(t.assignee, []).append(t)
        if fmt == "grouped":
            out = [f"Open tickets – {date.today().strftime('%d/%m/%Y')} ({len(s)})", ""]
            for n, ts in groups.items():
                out.append(f"{n} – {len(ts)} ticket{'' if len(ts) == 1 else 's'}")
                for i, t in enumerate(ts, 1):
                    out += [f"{i}. {t.key} – {t.summary}{ex(t)}", f"   {self.link(t)}"]
                out.append("")
            return "\n".join(out).rstrip()
        if fmt == "oneline":
            return "\n".join(f"{t.assignee} | {t.key} | {t.summary}{ex(t)} | {self.link(t)}" for t in s)
        if fmt == "markdown":
            c = lambda x: x.replace("|", "\\|")
            return "| Name | ID | Summary | Link |\n|---|---|---|---|\n" + "\n".join(
                f"| {c(t.assignee)} | {t.key} | {c(t.summary + ex(t))} | {self.link(t)} |" for t in s)
        import io
        buf = io.StringIO()
        w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
        w.writerow(["Name", "Ticket ID", "Summary", "Project", "Status", "Priority", "Age (days)", "Link"])
        for t in s:
            w.writerow([t.assignee, t.key, t.summary, t.project, t.status, t.priority,
                        "" if t.age is None else t.age, self.link(t)])
        return buf.getvalue().rstrip("\r\n")
