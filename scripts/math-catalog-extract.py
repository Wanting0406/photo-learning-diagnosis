"""Extract only the published presentation tabs from authorized Feishu XLSX exports."""
import hashlib
import json
import re
import sys
from pathlib import Path

import openpyxl

SOURCES = [
    ("节点大全-一轮.xlsx", "包装版【一轮】", "Qq7HwcDyqiORASkilYmcJ3Sjneh", "WCRc31",
     [(0, 1, 2, "新中考一轮"), (3, 4, 5, "新中考一轮")], 113),
    ("二轮节点大全.xlsx", "包装版【二轮】", "FKDPwnXqdiv1rYkFDVHcsx6Mn2e", "6KslD5",
     [(0, None, 1, "新中考二轮·简单综合"), (3, None, 4, "新中考二轮·压轴综合"),
      (6, None, 7, "新中考二轮·创新题型")], 101),
]


def normalized(value):
    return re.sub(r'[\s，。；：、（）()“”"\u200b]', '', re.sub(r'^第\d+讲\s*', '', str(value or '')))


def node_evidence(book, first_round):
    tabs = book.worksheets[:6] if first_round else [book.worksheets[i] for i in [0, 2, 4]]
    nodes = {}
    for sheet in tabs:
        sheet.reset_dimensions()
        rows = list(sheet.values)
        header_index = next((i for i, row in enumerate(rows) if '节点名称' in row), None)
        if header_index is None:
            continue
        header = rows[header_index]
        for row_index, row in enumerate(rows[header_index + 1:], header_index + 2):
            def field(name):
                col = header.index(name) if name in header else -1
                return str(row[col] or '').strip() if 0 <= col < len(row) else ''
            name = field('节点名称')
            if not name:
                continue
            nodes.setdefault(normalized(name), []).append({
                'name': name, 'knowledge': field('知识点'), 'status': field('是否上线'),
                'location': f'{sheet.title} 第{row_index}行',
            })
    return nodes


def extract(downloads):
    result = []
    for filename, tab, wiki, sheet, blocks, expected in SOURCES:
        file = downloads / filename
        source_sha = hashlib.sha256(file.read_bytes()).hexdigest()
        book = openpyxl.load_workbook(file, read_only=True, data_only=True)
        source = book[tab]
        # Feishu exports declare A1-only dimensions despite containing the complete worksheet.
        source.reset_dimensions()
        rows = list(source.values)
        nodes = node_evidence(book, wiki == SOURCES[0][2])
        current = []
        for module_col, section_col, title_col, course_type in blocks:
            module = section = ""
            for row_number, row in enumerate(rows[1:], 2):
                value = lambda col: str(row[col] or "").strip() if col is not None and col < len(row) else ""
                if value(module_col):
                    module = value(module_col)
                    section = ""
                section = value(section_col) or section
                title = value(title_col)
                if not re.match(r"^第\d+讲\s*\S", title):
                    continue
                cell = f"{openpyxl.utils.get_column_letter(title_col + 1)}{row_number}"
                stable = f"{wiki}:{sheet}:{cell}"
                evidence = nodes.get(normalized(title), [])
                unavailable = any(n['status'] in ['否', '未上线', '已下线'] for n in evidence)
                keywords = [re.sub(r"^第\d+讲\s*", "", title)]
                for node in evidence:
                    keywords.extend(re.sub(r'^知识点[:：]\s*', '', node['knowledge']).split('\n'))
                current.append({
                    "id": "math_" + hashlib.sha256(stable.encode()).hexdigest()[:24],
                    "title": title, "subject": "数学", "grade": "初三", "edition": "通用版",
                    "courseType": course_type, "module": module, "section": section,
                    "keywords": list(dict.fromkeys(k for k in keywords if k)),
                    "sourceUrl": f"https://guanghe.feishu.cn/wiki/{wiki}?sheet={sheet}&range={cell}",
                    "sourceSheet": tab, "sourceCell": cell,
                    "sourceSha256": source_sha,
                    "reviewStatus": "待核实" if unavailable else "已核对",
                    "availability": ("节点标记未上线，与展示目录冲突，暂不推荐。" if unavailable else
                                     "源目录列示，账号可用性需核实。") +
                                    "知识点与状态依据：" + '；'.join(n['location'] for n in evidence),
                })
        assert len(current) == expected, f"{filename}: expected {expected}, got {len(current)}"
        assert len({r["title"] for r in current}) == expected, "Duplicate presentation titles"
        result.extend(current)
        book.close()
    return result


if __name__ == "__main__":
    target = Path(sys.argv[2])
    target.parent.mkdir(parents=True, exist_ok=True)
    courses = extract(Path(sys.argv[1]))
    target.write_text(json.dumps(courses, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"courses": len(courses), "ready": sum(c['reviewStatus'] == '已核对' for c in courses),
                      "output": str(target)}, ensure_ascii=False))
