"""Rebuild the offline undergraduate catalogue from the official 2026 PDF.

Run with the bundled Python (pypdf installed). The PDF itself is not packaged.
Only factual codes, names and category relationships are retained.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import urllib.request
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/W020260427440749576927.pdf"

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    if args.download:
        request = urllib.request.Request(SOURCE, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            args.pdf.write_bytes(response.read())
    pages = PdfReader(args.pdf).pages
    lines = [line.strip() for page in pages for line in page.extract_text(extraction_mode="layout").splitlines()]
    categories, majors, disciplines, current = {}, [], {}, ""
    for line in lines:
        discipline = re.match(r"^(\d{2})\s+学科门类[:：]\s*(.+)$", line)
        if discipline:
            disciplines[discipline[1]] = discipline[2].strip()
        category = re.match(r"^(\d{4})\s+([^\s]+类)$", line)
        if category:
            current = category[1]
            categories[current] = category[2]
            continue
        major = re.match(r"^(\d{6,7}[TK]*)\s+(.+)$", line)
        if major:
            category_code = "" if major[1].startswith("1400") else current
            assert not category_code or major[1].startswith(category_code), line
            name = re.split(r"[（(]注", major[2])[0].strip().replace(" ", "")
            assert name and not re.search(r"\d|注|学位|[（）]", name), line
            majors.append([major[1], name, category_code])
    assert len(categories) == 92 and len(majors) == 883, (len(categories), len(majors))
    assert len(disciplines) == 13 and disciplines['07'] == '理学' and disciplines['08'] == '工学', disciplines
    assert len({m[0] for m in majors}) == 883
    assert len({m[1] for m in majors}) == 883
    digest = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    data = {"version": "moe-undergraduate-2026", "title": "普通高等学校本科专业目录（2026年）", "source": SOURCE,
            "reference": "教育部，教高函〔2026〕2号，2026年4月7日", "verifiedAt": "2026-10-08", "pdfSha256": digest,
            "scope": "本科；不覆盖专科、研究生、历史更名和企业自定分类", "disciplines": disciplines, "categories": categories, "majors": majors}
    output = ROOT / "extension" / "jobs-major-data.js"
    output.write_text("// Generated factual catalogue; rebuild with tools/build_major_catalog.py.\n(function (root) {\n  const data = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n  root.JobScreenMajorData = data;\n  if (typeof module !== 'undefined') module.exports = data;\n})(globalThis);\n", encoding="utf-8")
    print(json.dumps({"pages": len(pages), "sha256": digest, "disciplines": len(disciplines), "categories": len(categories), "majors": len(majors)}))

if __name__ == "__main__":
    main()
