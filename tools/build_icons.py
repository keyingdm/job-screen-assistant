"""Generate the extension's original vector-style lavender app mark."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "extension/icons"
root.mkdir(exist_ok=True)
for size in (16, 32, 48, 128):
    im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((5, 5, 251, 251), radius=72, fill="#eee9ff")
    for rect in ((49,49,112,112),(144,49,207,112),(49,144,112,207),(144,144,207,207)):
        d.rounded_rectangle(rect, radius=22, outline="#8064d9", width=10)
    d.line((99,102,157,102,157,158,99,158,99,102),fill="#8064d9",width=10)
    im.resize((size, size), Image.Resampling.LANCZOS).save(root / (str(size) + ".png"))
