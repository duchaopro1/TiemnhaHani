# Team Ticket Tracker

Local desktop app (no server, no internet): shows open Jira tickets per team member and exports
a ready-to-paste list (name, ticket ID, summary, link) for a chat group.

## Run
- `python ticket_tracker_app.py` (Python 3.8+, no extra packages) or double-click the `.exe` built with `build_exe.bat`.
- Optional: `python ticket_tracker_app.py my_export.csv`.
- The last loaded file is re-opened on start; **Reload** re-reads it after you export a fresh CSV from Jira.

## Get the data
In TMS (Jira) open the issue list / filter -> **Export** -> **CSV (Current fields)** or **CSV (All fields)**.

## Files
- `ticket_tracker_app.py` - GUI
- `tracker_core.py` - CSV import, filtering, export formats (no GUI, can be reused/tested)
- `ticket_tracker.html` - same tool as a single offline web page (open in a browser, no Python needed)

Settings (task link base URL, display names for usernames, which statuses count as open, column mapping)
are saved in `~/.ticket_tracker.json`.
