"""Read the supplied attachment; persist directory metadata only."""
import collections
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile

import openpyxl

SOURCE = "https://guanghe.feishu.cn/wiki/IWxCwfiU5iZ50bkiqbmchaQSnIc"
ANCHOR = "EID5dOE00o1z52xfag7c9jx5nnu"


def extract(archive_path):
    records, inventory, identities = [], [], set()
    with zipfile.ZipFile(archive_path) as archive:
        for entry in archive.infolist():
            name = entry.filename if entry.flag_bits & 2048 else entry.filename.encode("cp437").decode("utf-8")
            if not name.endswith(".xlsx") or name.startswith("__MACOSX"):
                continue
            workbook = openpyxl.load_workbook(io.BytesIO(archive.read(entry)), read_only=True, data_only=True)
            for sheet in workbook:
                rows = list(sheet.values)
                inventory.append({"file": name, "sheet": sheet.title, "rows": len(rows) - 1})
                if "小学数学" not in name:
                    continue
                sync = "/教材同步/" in name
                expected = ["教材版本", "册别", "章", "大节", "小节", "知识点/视频标题"] if sync else [
                    "课程包", "册别", "章/专题", "大节", "小节", "知识点/视频标题"]
                if list(rows[0]) != expected or sheet.title != "已发布目录":
                    raise ValueError("Unexpected directory schema")
                for number, values in enumerate(rows[1:], 2):
                    if len(values) != 6 or any(value is not None and not isinstance(value, str) for value in values):
                        raise ValueError("Unexpected directory row")
                    package, book, chapter, section, subsection, title = [str(value or "").strip() for value in values]
                    grade = book if sync else chapter
                    edition = package if sync else "人教版"
                    course_type = "教材同步" if sync else "思维培优"
                    if not re.fullmatch("[一二三四五六]年级[上下]册", grade) or not title:
                        raise ValueError(f"Missing explicit grade or title: {name}:{number}")
                    identity = json.dumps([name, sheet.title, number], ensure_ascii=False)
                    record_id = "primary_q3_" + hashlib.sha256(identity.encode()).hexdigest()[:24]
                    if record_id in identities:
                        raise ValueError("Duplicate source locator")
                    identities.add(record_id)
                    records.append({
                        "目录ID": record_id, "知识点名称": title, "课程名称": title, "学科": "数学",
                        "适用年级": grade, "教材版本": edition, "课程类型": course_type,
                        "专题": " / ".join(filter(None, [chapter if sync else "", section, subsection])),
                        "原目录链接": SOURCE + "#" + ANCHOR, "审核状态": "已核对",
                        "核对说明": f"2026Q3已发布目录快照；{name}；{sheet.title}!A{number}:F{number}；"
                        "已逐行核对源目录，非实时课程可用性确认；适用年级和版本保持原文。",
                    })
            workbook.close()
    if not records:
        raise ValueError("No primary math records")
    return {"source": SOURCE, "inventory": inventory, "records": records,
            "counts": {"total": len(records), "types": dict(collections.Counter(r["课程类型"] for r in records)),
                       "grades": dict(collections.Counter(r["适用年级"] for r in records))}}


if __name__ == "__main__":
    archive, destination = sys.argv[1:]
    result = extract(archive)
    output = pathlib.Path(destination)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["counts"], ensure_ascii=False))
