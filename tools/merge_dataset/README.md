# Dataset Merge Tool

Merges a calibration dataset (old A2L + HEX) into a new software build (new A2L + HEX),
reproducing what INCA does when a dataset is loaded into a new software version.

## How INCA's merge works (verified byte-for-byte on the sample data)

Characteristics are matched **by name**, not by address. When the software is rebuilt, the
linker moves calibration variables, so the same name sits at a different address
(158 of 2210 in the sample).

1. Start from the **new software HEX** (code + default calibration).
2. Overlay the dataset's calibration segment (A2L `MEMORY_SEGMENT ... DATA`).
3. Reset the old location of every characteristic that moved back to the new software bytes.
4. For every characteristic in both A2Ls: copy its raw bytes from the old address (dataset)
   to the new address. Size comes from the record layout, `NUMBER`/`MATRIX_DIM` and axis max points.
5. Only in new A2L -> keeps the new software default. Only in old A2L -> dropped.

Everything outside the calibration segment (code) stays exactly as in the new software HEX.

## Use

GUI: `python merge_gui.py` (or the .exe built with `build_exe.bat`).
CLI: `python merge_dataset.py --old-a2l ... --old-hex ... --new-a2l ... --new-hex ... --out merged.hex --report r.csv`

The report lists every characteristic as COPIED / COPIED_MOVED / NEW_DEFAULT / REMOVED / SKIPPED
and flags changed record layouts or conversion methods (raw bytes are copied, so a changed
conversion changes the physical value).

## Limits

- Raw copy only: if a characteristic's conversion method changed, it is flagged, not converted.
- Characteristics whose type/size changed are skipped (keep the new default) and reported.
- Output is Intel HEX, 32 bytes per line, without a start-address record.
