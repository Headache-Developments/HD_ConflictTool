# HD_ConflictTool

Find the overlap. Keep your maps.

A local browser tool for reviewing conflicts across GTA V YMAP files. Its bundled local converter uses CodeWalker.Core to read binary `.ymap` files into CodeWalker XML and to rebuild each edited map as a binary `.ymap`.

## Use it

1. On Windows x64, double-click `start.cmd`. Your default browser opens when the converter is ready. If it does not, open http://127.0.0.1:5158 manually. Leave the console open while you work. It shows startup and request diagnostics. Press Ctrl+C to stop.
2. Choose **Browse files** for individual files or **Choose folder** to scan a full folder tree; dropping a folder onto the drop zone also scans its nested folders.
3. Choose **Scan maps for conflicts**. The overview lists every source YMAP, overlapping entity counts, changed field counts, and the other maps with shared entities.
4. Choose **Continue to field review** after reviewing that list. For each overlapping entity, choose which source supplies each changed field. Unique entities are retained automatically.
5. Choose **Download YMAP ZIP** to download all binary maps as separate files inside the ZIP's `ymaps/` folder. Choose **Export XML** for individual XML downloads.

The converter runs only on your computer; files are not sent to a remote server. The Windows x64 .NET runtime is included. This is a standalone tool and is launched separately from FiveM. Entity overlaps use a non-zero GUID when available, otherwise archetype name plus position rounded to three decimals. A moved entity without a GUID may be treated as a separate placement. Field choices are applied in place to the matching placements. Entity order, map-specific LOD fields, and other XML sections are retained. Unchanged binary inputs are returned byte for byte. Review edited maps in CodeWalker and calculate extents and flags before streaming them, particularly after changing a model, transform, or LOD distance. Export retains overlapping copies for separately deployed map versions.

CodeWalker.Core is distributed under the notices in `converter/THIRD-PARTY-NOTICES.txt`.
