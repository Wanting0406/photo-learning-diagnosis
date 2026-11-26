"""Build numbered evidence sheets; approvals are a separate explicit review file."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

work = Path(sys.argv[1])
folder = work / 'label-review'
folder.mkdir(exist_ok=True)
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc', 17)
rows = {r['id']: r for r in json.loads((work / 'candidates.json').read_text())}
cells, manifest = [], []
for file in sorted((work / 'extractions').glob('*.json')):
    extraction = json.loads(file.read_text())
    for offset, label in enumerate(extraction['labels']):
        image = Image.open(extraction['tiles'][label['tile']]).convert('RGB')
        x1, y1, x2, y2 = label['box']
        if x2 <= x1 or y2 <= y1:
            continue
        box = (max(0, x1 * image.width / 1000 - 12), max(0, y1 * image.height / 1000 - 10),
               min(image.width, x2 * image.width / 1000 + 12), min(image.height, y2 * image.height / 1000 + 10))
        crop = image.crop(box)
        crop.thumbnail((390, 140))
        cell = Image.new('RGB', (420, 210), '#f2f5f8')
        cell.paste(crop, (10, 65))
        draw = ImageDraw.Draw(cell)
        number = len(manifest)
        draw.text((8, 5), f"{number} / 图{rows[extraction['materialId']]['inventoryIndex']} / 题{label.get('question', '')}", font=font, fill='black')
        draw.text((8, 29), label['point'][:22], font=font, fill='black')
        cells.append(cell)
        manifest.append({'reviewIndex': number, 'key': f'{file.stem}:{offset}', 'materialId': extraction['materialId'],
                         **label, 'evidenceTile': extraction['tiles'][label['tile']]})
for start in range(0, len(cells), 24):
    sheet = Image.new('RGB', (1680, 1260), 'white')
    for i, cell in enumerate(cells[start:start + 24]):
        sheet.paste(cell, ((i % 4) * 420, (i // 4) * 210))
    sheet.save(folder / f'{start // 24 + 1:03}.jpg', quality=95)
(folder / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
print(f'{len(manifest)} labels, {(len(cells) + 23) // 24} review sheets')
