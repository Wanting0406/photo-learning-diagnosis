"""Produce local review sheets, thumbnails and overlapping OCR tiles from selected originals."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

work = Path(sys.argv[1])
rows = json.loads((work / 'candidates.json').read_text())
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc', 15)
out = work / 'prepared'
out.mkdir(exist_ok=True)
sheets = []
for index, row in enumerate(rows):
    file = work / 'originals' / (row['id'] + '.image')
    if not file.exists() or row.get('status') == '排除':
        continue
    img = ImageOps.exif_transpose(Image.open(file)).convert('RGB')
    folder = out / row['id']
    folder.mkdir(exist_ok=True)
    thumbnail = img.copy()
    thumbnail.thumbnail((360, 1800))
    thumbnail.save(folder / 'thumbnail.jpg', quality=85)
    overview = img.copy()
    overview.thumbnail((1200, 1600))
    overview.save(folder / 'overview.jpg', quality=90)
    tile_paths = []
    for top in range(0, img.height, 1240):
        for left in range(0, img.width, 940):
            tile = img.crop((left, top, min(left + 1100, img.width), min(top + 1400, img.height)))
            if tile.width < 160 or tile.height < 160:
                continue
            target = folder / f'tile-{left}-{top}.jpg'
            tile.save(target, quality=94)
            tile_paths.append(str(target))
    (folder / 'tiles.json').write_text(json.dumps(tile_paths))
    cell = Image.new('RGB', (340, 310), 'white')
    header = img.crop((0, 0, img.width, min(img.height, int(img.width * .64))))
    header.thumbnail((330, 220))
    cell.paste(header, (5, 60))
    draw = ImageDraw.Draw(cell)
    draw.text((5, 5), f"{index}: {row['section']} {row['width']}x{row['height']}", font=font, fill='black')
    draw.text((5, 28), row['originalName'][:20], font=font, fill='black')
    sheets.append(cell)
for start in range(0, len(sheets), 12):
    sheet = Image.new('RGB', (1020, 1240), '#dddddd')
    for i, cell in enumerate(sheets[start:start + 12]):
        sheet.paste(cell, ((i % 3) * 340, (i // 3) * 310))
    sheet.save(work / f'review-{start // 12 + 1}.jpg', quality=94)
print(f'Prepared {len(sheets)} originals')
