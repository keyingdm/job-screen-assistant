"""Build the bundled offline tutorial from the repository's Markdown source."""
from html import escape
from pathlib import Path
import re
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]


def inline(text):
    value = escape(text)
    value = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', lambda m: f'<a href="{m[2].replace("docs/images/", "help-assets/")}"><img src="{m[2].replace("docs/images/", "help-assets/")}" alt="{m[1]}" loading="lazy"></a>', value)
    value = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank" rel="noopener">\1</a>', value)
    value = re.sub(r'`([^`]+)`', r'<code>\1</code>', value)
    return re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', value)


def main():
    version = json.loads((ROOT / 'extension/manifest.json').read_text(encoding='utf-8'))['version']
    output, toc, paragraphs = [], [], []
    listing = None
    table = False
    code = False

    def paragraph():
        if paragraphs:
            output.append('<p>' + inline(' '.join(paragraphs)) + '</p>')
            paragraphs.clear()

    def close():
        nonlocal listing, table
        paragraph()
        if listing:
            output.append(f'</{listing}>')
            listing = None
        if table:
            output.append('</tbody></table></div>')
            table = False

    for line in (ROOT / '使用说明.md').read_text(encoding='utf-8').splitlines():
        if line.startswith('```'):
            close()
            output.append('</code></pre>' if code else '<pre><code>')
            code = not code
            continue
        if code:
            output.append(escape(line) + '\n')
            continue
        heading = re.match(r'^(#{1,3}) (.+)$', line)
        if heading:
            close()
            level, title = len(heading[1]), heading[2]
            anchor = re.sub(r'[^\w -]', '', title.lower()).replace(' ', '-')
            output.append(f'<h{level} id="{anchor}">{inline(title)}</h{level}>')
            if level == 2:
                toc.append(f'<li><a href="#{anchor}">{escape(title)}</a></li>')
            continue
        if line.startswith('|'):
            paragraph()
            if re.fullmatch(r'[| :\-]+', line):
                continue
            cells = [inline(cell.strip()) for cell in line.strip('|').split('|')]
            if not table:
                close()
                output.append('<div class="table"><table><thead><tr>' + ''.join(f'<th>{cell}</th>' for cell in cells) + '</tr></thead><tbody>')
                table = True
            else:
                output.append('<tr>' + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>')
            continue
        item = re.match(r'^(?:\d+\. |(-) )(.+)$', line)
        if item:
            paragraph()
            kind = 'ul' if item[1] else 'ol'
            if listing != kind:
                close()
                output.append(f'<{kind}>')
                listing = kind
            output.append('<li>' + inline(item[2]) + '</li>')
        elif not line.strip():
            close()
        else:
            if table or listing:
                close()
            paragraphs.append(line)
    close()
    assets = ROOT / 'extension/help-assets'
    assets.mkdir(exist_ok=True)
    for source in (ROOT / 'docs/images').glob('*.png'):
        shutil.copy2(source, assets / source.name)
    style = 'html{scroll-behavior:smooth}body{margin:0;background:#f7f7fb;color:#333049;font:16px/1.85 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1000px;margin:0 auto;padding:36px 40px 80px;background:white}nav{background:#f3efff;border:1px solid #e0d8f0;border-radius:12px;padding:18px 24px}nav ul{columns:2;margin:0;padding-left:24px}h1{font-size:30px}h2{font-size:23px;margin-top:42px;border-bottom:2px solid #e5dcf3;padding-bottom:8px;scroll-margin-top:20px}h3{font-size:18px;margin-top:28px}a{color:#6554d9}li{margin:8px 0}img{max-width:100%;border:1px solid #e5dff0;border-radius:9px;margin:14px 0}code{background:#f2eef9;padding:2px 5px;border-radius:4px;overflow-wrap:anywhere}pre{background:#f7f3fc;padding:16px;overflow:auto;line-height:1.6}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border:1px solid #e8e1f0;text-align:left;vertical-align:top}th{background:#f5f1fc}.hint{font-size:13px;color:#7f718c}@media(max-width:650px){main{padding:18px 16px 50px}nav ul{columns:1}h1{font-size:25px}}'
    html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>岗位筛选助手使用教程</title><style>' + style + '</style></head><body><main><p class="hint">插件内置离线教程 · 点击图片可放大 · v' + version + '</p><nav aria-label="教程目录"><strong>按使用步骤阅读</strong><ul>' + ''.join(toc) + '</ul></nav>' + '\n'.join(output) + '</main></body></html>'
    (ROOT / 'extension/help.html').write_text(html, encoding='utf-8')
    print(f'Built offline help: {len(toc)} chapters, {len(list(assets.glob("*.png")))} images')


if __name__ == '__main__':
    main()
