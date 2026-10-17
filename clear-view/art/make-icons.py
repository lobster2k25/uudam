# Renders clear-view/art/icon.svg (and icon-small.svg for 16/32 px) to the PNG sizes the manifest uses.
# Run after changing the SVG:  pip install cairosvg  then  python3 clear-view/art/make-icons.py
# Writes clear-view/icons/icon-16 … icon-128.png and art/listing-icon.png (for the store page).
from pathlib import Path
import cairosvg

art = Path(__file__).parent
icons = art.parent / 'icons'
icons.mkdir(exist_ok=True)

for size in (16, 32, 48, 96, 128):
    # Small sizes use icon-small.svg (bigger triangle, two thick bars) so the toolbar icon stays readable.
    src = art / ('icon-small.svg' if size <= 32 else 'icon.svg')
    cairosvg.svg2png(url=str(src), write_to=str(icons / f'icon-{size}.png'), output_width=size, output_height=size)

cairosvg.svg2png(url=str(art / 'icon.svg'), write_to=str(art / 'listing-icon.png'), output_width=512, output_height=512)
print('clear-view/icons: icon-16/32/48/96/128.png, art/listing-icon.png')
