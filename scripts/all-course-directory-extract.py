"""Read all worksheets from the supplied Q3 attachments; retain metadata only."""
import collections
import hashlib
import io
import json
import pathlib
import re
import sys
import zipfile

import openpyxl

SOURCE = 'https://guanghe.feishu.cn/wiki/IWxCwfiU5iZ50bkiqbmchaQSnIc'
STAGES = {'primary': ('小学', 'EID5dOE00o1z52xfag7c9jx5nnu'),
          'junior': ('初中', 'ByjcdGh6DoJgaDxwmitcpUV2n7e'),
          'senior': ('高中', 'NHw1dMmZLoGYVkxKooKcZuklnZb')}
SUBJECTS = ['道德与法治', '数学', '语文', '英语', '物理', '化学', '生物', '地理', '历史', '政治']
HEADERS = [
    ['教材版本', '册别', '章', '大节', '小节', '知识点/视频标题'],
    ['课程包', '册别', '章/专题', '大节', '小节', '知识点/视频标题'],
    ['课程包', '教材版本', '册别', '章/专题', '大节', '小节', '知识点/视频标题'],
]


def scope(stage, subject, filename, row):
    book = row['册别']
    if stage == '小学':
        grade = book if re.fullmatch('[一二三四五六]年级[上下]册', book) else ''
        if subject == '数学' and '思维培优' in filename:
            grade = row['章/专题']
        if grade:
            return grade[:3], '来源明确年级；册别保留原文'
        # Low/middle/high elementary bands have an explicit scope in the directory.
        band = row.get('大节', '')
        if subject == '语文' and band in ['低段', '中段', '高段']:
            return {'低段': '一年级、二年级', '中段': '三年级、四年级', '高段': '五年级、六年级'}[band], f'原目录{band}，按小学学段常规分段'
        return '小学', '来源只明确小学学段，使用前核对学习基础'
    if stage == '初中':
        match = re.match('([七八九])年级', book)
        if match:
            return {'七': '初一', '八': '初二', '九': '初三'}[match[1]], '来源明确年级；册别保留原文'
        if '新中考' in filename and subject == '数学':
            return '初三', '中考总复习目录，沿用现有初三匹配范围'
        return '初中', '来源只明确初中学段，未标具体年级，使用前核对学习进度'
    if '高一高二重难点培优' in filename:
        return '高一、高二', '来源文件夹明确高一高二；不按必修册号猜具体年级'
    if subject == '数学' and ('复习培优' in filename or '真题精讲' in filename):
        return '高三', '沿用用户已确认范围：高中数学一轮、二轮及真题仅高三'
    if subject in ['物理', '化学', '生物', '英语'] and ('复习培优' in filename or '真题精讲' in filename):
        return '高一、高二、高三', '沿用用户已确认范围：高中物化生英培优高一至高三；使用前核对复习阶段'
    return '高中', '来源按高中册别或专题组织，未标具体年级，使用前核对教材与学习进度'


def extract(archive_dir):
    records, reused, inventory = [], [], []
    for key, (stage, anchor) in STAGES.items():
        with zipfile.ZipFile(pathlib.Path(archive_dir) / f'onion-all-{key}-2026q3.zip') as archive:
            for entry in archive.infolist():
                filename = entry.filename if entry.flag_bits & 2048 else entry.filename.encode('cp437').decode('utf-8')
                if filename.startswith('__MACOSX') or not filename.endswith('.xlsx'):
                    continue
                subjects = [s for s in SUBJECTS if s in filename]
                if len(subjects) != 1:
                    raise ValueError(f'Ambiguous subject: {filename}')
                subject = subjects[0]
                workbook = openpyxl.load_workbook(io.BytesIO(archive.read(entry)), read_only=True, data_only=True)
                for sheet in workbook:
                    values = list(sheet.values)
                    headers = list(values[0])
                    if headers not in HEADERS or sheet.title != '已发布目录':
                        raise ValueError(f'Unexpected worksheet: {filename}:{sheet.title}')
                    inventory.append({'学段': stage, '学科': subject, 'file': filename, 'sheet': sheet.title, 'rows': len(values)-1})
                    for number, cells in enumerate(values[1:], 2):
                        if len(cells) != len(headers) or any(v is not None and not isinstance(v, str) for v in cells):
                            raise ValueError(f'Unexpected row: {filename}:{number}')
                        row = {k: (v or '').strip() for k, v in zip(headers, cells)}
                        title = row['知识点/视频标题']
                        if not title:
                            raise ValueError(f'Empty title: {filename}:{number}')
                        locator = json.dumps([filename, sheet.title, number], ensure_ascii=False)
                        identity = hashlib.sha256(locator.encode()).hexdigest()[:24]
                        if stage == '小学' and subject == '数学':
                            reused.append({'目录ID': 'primary_q3_' + identity, '课程名称': title, 'table': 'tbly3Xg5AEdFRIm4'})
                            continue
                        grade, basis = scope(stage, subject, filename, row)
                        package = row.get('课程包', '')
                        edition = row.get('教材版本', '')
                        if '/教材同步/' in filename:
                            course_type = '教材同步'
                        elif '重难点' in filename:
                            course_type = '重难点培优'
                        elif '新中考' in filename:
                            course_type = '新中考培优'
                        elif '真题精讲' in filename:
                            course_type = '真题精讲培优'
                        elif '一轮' in filename or '二轮' in filename:
                            course_type = ('一轮' if '一轮' in filename else '二轮') + '复习培优'
                        else:
                            course_type = package
                        region = ''
                        if stage == '初中' and subject == '数学' and '新中考' in filename:
                            region = re.search(r'（([^）]+)）$', package)[1]
                        subsection = row.get('小节', '')
                        # Only the row's own label is searchable, never broad chapter names.
                        alias = subsection if subsection != title and 2 <= len(subsection) <= 80 else ''
                        if re.search('课前必看|听课建议|导学|开场白|介绍视频', title):
                            alias = ''
                        records.append({
                            '目录ID': 'all_q3_' + identity, '课程名称': title, '知识点名称': title,
                            '检索别名': alias, '学科': subject, '适用学段': stage, '适用年级': grade,
                            '教材版本': edition, '册别': row['册别'], '课程类型': course_type,
                            '课程包': package, '地区': region,
                            '专题': ' / '.join(filter(None, [row.get('章', row.get('章/专题', '')), row.get('大节', ''), subsection])),
                            '年级依据': basis, '原目录链接': SOURCE + '#' + anchor,
                            '来源工作簿': filename, '来源工作表': sheet.title, '来源行': str(number),
                            '审核状态': '已核对',
                            '核对说明': '2026Q3已发布目录结构化逐行读取；保留原始标题、册别和版本；非实时课程权益确认。',
                        })
                workbook.close()
    assert len(inventory) == 60 and sum(r['rows'] for r in inventory) == 21828
    assert len(records) == 19890 and len(reused) == 1938
    assert len({r['目录ID'] for r in records}) == len(records)
    return {'source': SOURCE, 'inventory': inventory, 'records': records, 'reused': reused,
            'counts': {'totalSource': 21828, 'reusedPrimaryMath': len(reused), 'newSourceRows': len(records),
                'stages': dict(collections.Counter(r['适用学段'] for r in records)),
                'subjects': dict(collections.Counter(r['学科'] for r in records)),
                'stageSubjects': dict(collections.Counter(r['适用学段'] + r['学科'] for r in records))}}


if __name__ == '__main__':
    result = extract(sys.argv[1])
    pathlib.Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result['counts'], ensure_ascii=False))
