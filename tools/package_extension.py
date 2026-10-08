"""Build the standalone extension only, with version and SHA-256 checks."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "extension"


def main():
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["name"] == "岗位筛选助手"
    assert manifest["version"] == json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    required = {"manifest.json", "background.js", "storage.js", "styles.css", "jobs.html", "jobs.js", "jobs-core.js", "jobs-major-data.js", "jobs-majors.js", "jobs-collector.js", "jobs-page.js", "jobs-tasks.js", "jobs-ai.js", "jobs-channel.js", "jobs-widget.js", "jobs-access.js", "jobs-access-background.js", "jobs-sample.js", "jobs.css", "help.html", "help-assets/岗位筛选台.png", "help-assets/岗位详情.png", "icons/16.png", "icons/32.png", "icons/48.png", "icons/128.png"}
    # Exact public reference only; recruiting domains and arbitrary hosts remain forbidden.
    references = {"https://www.moe.gov.cn/srcsite/A08/moe_1034/s3882/202604/W020260427440749576927.pdf"}
    files = sorted(p for p in EXTENSION.rglob("*") if p.is_file())
    names = {p.relative_to(EXTENSION).as_posix() for p in files}
    assert names == required, ("unexpected or missing resources", names ^ required)
    for file in files:
        if file.suffix in {".js", ".html", ".json", ".css"}:
            content = file.read_text(encoding="utf-8")
            for reference in references:
                content = content.replace(reference, "OFFICIAL_CATALOGUE_REFERENCE")
            assert not re.search(r'https?://(?!\*|example\.(?:test|invalid)|invalid/|127\.0\.0\.1|localhost)[A-Za-z0-9.-]+', content), ("hardcoded external domain", file)
    output = ROOT / f"岗位筛选助手_独立插件_v{manifest['version']}.zip"
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in files:
            archive.write(file, file.relative_to(EXTENSION).as_posix())
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == required
        assert json.loads(archive.read("manifest.json"))["version"] == manifest["version"]
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    (ROOT / "SHA256SUMS.txt").write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    print(json.dumps({"package": output.name, "version": manifest["version"], "files": len(files), "bytes": output.stat().st_size, "sha256": digest}, ensure_ascii=False))


if __name__ == "__main__":
    main()
