"""Prioritize visually reviewing clear label candidates for every selected content group."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

work = Path(sys.argv[1])
manifest = json.loads((work / 'label-review' / 'manifest.json').read_text())
approved = json.loads((work / 'approved-labels.json').read_text())
candidates = json.loads((work / 'candidates.json').read_text())
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc', 17)
cells = []
for row in candidates:
    if not row.get('representative'):
        continue
    verified = [a for a in approved if a['materialId'] == row['id']]
    if len(verified) >= 3:
        continue
    possible = [m for m in manifest if m['materialId'] == row['id'] and m['confidence'] == '高'
                and not any(a['key'] == m['key'] for a in approved)]
    possible.sort(key=lambda m: m['box'][2] >= 990 or m['box'][3] >= 990)
    for label in possible[:5]:
        img = Image.open(label['evidenceTile']).convert('RGB')
        x1, y1, x2, y2 = label['box']
        box = (max(0, x1 * img.width / 1000 - 15), max(0, y1 * img.height / 1000 - 20),
               min(img.width, x2 * img.width / 1000 + 120), min(img.height, y2 * img.height / 1000 + 120))
        crop = img.crop(box)
        crop.thumbnail((420, 230))
        cell = Image.new('RGB', (450, 310), '#f3f6f8')
        cell.paste(crop, (10, 75))
        draw = ImageDraw.Draw(cell)
        draw.text((8, 5), f"{label['reviewIndex']} / 图{row['inventoryIndex']} / 题{label.get('question', '')}", font=font, fill='black')
        draw.text((8, 29), label['point'][:24], font=font, fill='black')
        draw.text((8, 49), label['point'][24:48], font=font, fill='black')
        cells.append(cell)
for start in range(0, len(cells), 20):
    sheet = Image.new('RGB', (1800, 1550), 'white')
    for i, cell in enumerate(cells[start:start + 20]):
        sheet.paste(cell, ((i % 4) * 450, (i // 4) * 310))
    sheet.save(work / 'label-review' / f'coverage-{start // 20 + 1}.jpg', quality=95)
print(f'{len(cells)} labels prioritized on {(len(cells) + 19) // 20} evidence sheets')
