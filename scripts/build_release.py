"""从指定 Git 标签生成 Windows 源码运行包和兼容性说明，仅使用标准库。"""

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path


FILES = (
    "README.md", "COMPATIBILITY.md",
    "启动-Paseo-Codey.cmd", "停止-Paseo-Codey.cmd",
    *(f"tools/{name}.mjs" for name in (
        "cdp", "desktop_bridge", "desktop_settings", "launch_paseo_codey",
        "paseo_compat", "paseo_desktop_shim", "paseo_native_client",
        "paseo_settings_sync", "settings_sync_policy",
    )),
)


def git(repo, *args):
    return subprocess.check_output(["git", "-C", str(repo), *args])


def version_for(tag):
    number = r"(?:0|[1-9][0-9]*)"
    if not re.fullmatch(rf"v?{number}\.{number}\.{number}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?", tag):
        raise ValueError("Tag must be a version such as 0.0.1 or v0.0.2-rc.1")
    return tag.removeprefix("v")


def compatibility_section(document, version):
    match = re.search(r"^## 当前验证记录\s*\n(.*?)(?=^## |\Z)", document, re.M | re.S)
    if not match:
        raise ValueError("Missing current compatibility record")
    section = match.group(1).strip()
    baseline = re.search(r"项目基线：\*\*`([^`]+)`\*\*", section)
    if not baseline or baseline.group(1) != version:
        raise ValueError("Tag version does not match COMPATIBILITY.md project baseline")
    for field in ("Codey", "Paseo 桌面程序 / daemon", "Paseo 手机 App",
                  "Codex CLI 后端", "ChatGPT 桌面应用版本", "启动器使用的 Node.js"):
        if not re.search(rf"^\| {re.escape(field)} \|[^\n]*`[^`]+`", section, re.M):
            raise ValueError(f"Missing compatibility version: {field}")
    if "### 功能矩阵" not in section:
        raise ValueError("Missing compatibility scope")
    return section


def build(repo, tag, output):
    version = version_for(tag)
    ref = f"refs/tags/{tag}"
    commit = git(repo, "rev-parse", "--verify", f"{ref}^{{commit}}").decode().strip()
    # 固定 commit 后读取，避免工作区改动或标签变化混入包中。
    contents = {name: git(repo, "show", f"{commit}:{name}") for name in FILES}
    section = compatibility_section(contents["COMPATIBILITY.md"].decode("utf-8-sig"), version)
    metadata = {"project": "CodeyLink", "version": version, "tag": tag,
                "commit": commit, "platform": "windows", "package_type": "source-runtime"}
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    stem = f"codey-link-{version}-windows"
    archive = output / f"{stem}.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, data in contents.items():
            if name.endswith(".cmd"):
                data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
            entry = zipfile.ZipInfo(f"{stem}/{name}", date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            bundle.writestr(entry, data)
        entry = zipfile.ZipInfo(f"{stem}/release.json", date_time=(2020, 1, 1, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        entry.external_attr = 0o100644 << 16
        bundle.writestr(entry, json.dumps(metadata, indent=2, ensure_ascii=False) + "\n")
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / "SHA256SUMS.txt").write_text(f"{checksum}  {archive.name}\n", encoding="utf-8")
    notes = (
        f"# CodeyLink {tag}\n\n源码提交：`{commit}`\n\n"
        "下载 `codey-link-*-windows.zip`，完整解压后双击 `启动-Paseo-Codey.cmd`。"
        "这是 Windows 源码运行包，需要 Node.js 22+、已安装的 Paseo，以及由 Codey 启动且开放 CDP 的 ChatGPT Desktop。"
        "详细设置见包内 README.md；包内不含上述第三方程序。\n\n"
        "以下记录来自该标签的 COMPATIBILITY.md，仅承诺列出的验证范围；其他版本组合保持未验证。\n\n"
        f"{section}\n"
    )
    (output / "release-notes.md").write_text(notes, encoding="utf-8")
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("dist"))
    args = parser.parse_args()
    print(build(args.repo, args.tag, args.output))
