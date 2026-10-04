"""Extract the cylindrical panel of NASA PIA18435 Figure 1 (Cassini, 2014).

Run: python frontend/scripts/extract_enceladus_reference.py <PIA18435_fig1.jpg>
Then: python frontend/scripts/prepare_reference_assets.py enceladus
Requires the documented 2560x1552 source rendition; see docs/ASSETS.md.
"""
import hashlib
import io
from pathlib import Path
import sys
from PIL import Image

source = Path(sys.argv[1]).read_bytes()
if hashlib.sha256(source).hexdigest() != "46f3464e43c63e9caa6489f1ba7e63ff3a3ab06feb29d923ee24427951669d7c":
    raise ValueError("Unexpected NASA Enceladus source; crop requires the documented rendition")
with Image.open(io.BytesIO(source)) as figure:
    if figure.size != (2560, 1552) or figure.mode != "RGB":
        raise ValueError("Unexpected annotated figure dimensions or color mode")
    # Full simple-cylindrical panel: 360..0 degrees west, +90..-90 latitude.
    # Excludes figure title, axes and caption; no surface gaps are synthesized.
    surface = figure.crop((40, 40, 2520, 1280))
    surface = surface.resize((2048, 1024), Image.Resampling.LANCZOS)
    target = Path(__file__).resolve().parents[1] / "public/textures/planets/enceladus.jpg"
    surface.save(target, quality=86, optimize=True)
    print(f"Enceladus Cassini reference map: {target.stat().st_size} bytes")
