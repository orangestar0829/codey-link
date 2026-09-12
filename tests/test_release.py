"""验证包内容来自标签，并且兼容性不随工作区漂移。"""

import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("build_release", ROOT / "scripts/build_release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.document = (ROOT / "COMPATIBILITY.md").read_text(encoding="utf-8")
        # 测试固定版本的隔离仓库，不依赖真实仓库的标签。
        self.git("init", "-q")
        self.git("config", "core.autocrlf", "false")
        for name in release.FILES:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self.document.encode() if name == "COMPATIBILITY.md" else b"tagged source\n")
        (self.repo / "private.txt").write_text("excluded tracked data", encoding="utf-8")
        self.git("add", ".")
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        self.git("tag", "0.0.1")

    def git(self, *args):
        return release.git(self.repo, *args)

    def test_tagged_package_and_checksum(self):
        (self.repo / "README.md").write_text("uncommitted data", encoding="utf-8")
        (self.repo / "COMPATIBILITY.md").write_text("incorrect current versions", encoding="utf-8")
        output = Path(self.temp.name) / "out"
        archive = release.build(self.repo, "0.0.1", output)
        first_bytes = archive.read_bytes()
        with zipfile.ZipFile(archive) as bundle:
            prefix = "codey-link-0.0.1-windows/"
            self.assertEqual(set(bundle.namelist()), {prefix + p for p in (*release.FILES, "release.json")})
            self.assertEqual(bundle.read(prefix + "README.md"), b"tagged source\n")
            self.assertEqual(bundle.read(prefix + "启动-Paseo-Codey.cmd"), b"tagged source\r\n")
            metadata = json.loads(bundle.read(prefix + "release.json"))
            self.assertEqual(metadata["commit"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertEqual((output / "SHA256SUMS.txt").read_text().split()[0], hashlib.sha256(first_bytes).hexdigest())
        notes = (output / "release-notes.md").read_text(encoding="utf-8")
        self.assertIn("### 验证历史", notes)
        self.assertNotIn("`dc8def2`", notes)
        self.assertNotIn("26.903.71938", notes)
        release.build(self.repo, "0.0.1", output)
        self.assertEqual(archive.read_bytes(), first_bytes)

    def test_version_and_record_guards(self):
        for invalid in ("main", "../0.0.1", "--help", "0.0.1;echo", "01.0.1"):
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                release.version_for(invalid)
        self.assertEqual(release.version_for("v0.0.2-rc.1"), "0.0.2-rc.1")
        with self.assertRaisesRegex(ValueError, "baseline"):
            release.compatibility_section(self.document, "99.0.0")
        with self.assertRaisesRegex(ValueError, "Codey"):
            release.compatibility_section(self.document.replace("| Codey |", "| Removed |"), "0.0.1")
        with self.assertRaises(subprocess.CalledProcessError):
            release.build(self.repo, "0.0.9", Path(self.temp.name) / "missing")

    def test_legacy_package_and_missing_image_module(self):
        self.git("rm", "--", ".env.example", "tools/image_preview.mjs", "tools/image_thumbnails.mjs", "tools/create_image_thumbnail.ps1", *release.PLUGIN_FILES)
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "legacy fixture")
        self.git("tag", "0.0.2")
        archive = release.build(self.repo, "0.0.2", Path(self.temp.name) / "legacy")
        with zipfile.ZipFile(archive) as bundle:
            self.assertFalse(any(name.endswith("image_preview.mjs") for name in bundle.namelist()))
            self.assertFalse(any("paseo-plugin/" in name for name in bundle.namelist()))
        (self.repo / "tools/launch_paseo_codey.mjs").write_text("import './image_preview.mjs';\n", encoding="utf-8")
        self.git("add", "tools/launch_paseo_codey.mjs")
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "incomplete runtime")
        self.git("tag", "0.0.3")
        with self.assertRaisesRegex(ValueError, "Image preview runtime"):
            release.build(self.repo, "0.0.3", Path(self.temp.name) / "incomplete")

    def test_incomplete_plugin_is_not_published(self):
        self.git("rm", "--", "paseo-plugin/server/assets.ts")
        self.git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid",
                 "-c", "commit.gpgsign=false", "commit", "-qm", "incomplete plugin")
        self.git("tag", "0.0.2")
        with self.assertRaisesRegex(ValueError, "Mobile attachment plugin files"):
            release.build(self.repo, "0.0.2", Path(self.temp.name) / "incomplete-plugin")

    def test_cli_prerelease_versions(self):
        source = "`0.153.4`"
        prerelease = "`0.154.0-alpha.6.2`"
        document = self.document.replace(source, prerelease)
        self.assertIn(prerelease, release.compatibility_section(document, "0.0.1"))
        for invalid in ("`0.154.0-`", "`0.154.0-alpha..2`", "`0.154.0-alpha.6.2;echo`", "未核对"):
            with self.subTest(version=invalid), self.assertRaisesRegex(ValueError, "Codex CLI"):
                release.compatibility_section(self.document.replace(source, invalid), "0.0.1")
        with self.assertRaisesRegex(ValueError, "Paseo daemon"):
            release.compatibility_section(document.replace("`0.7.2`", "`0.8.0-alpha.1`"), "0.0.1")

    def test_history_selection_and_dates(self):
        # 固定区间用例，不要求工作区兼容文档与代码在同一次提交更新。
        document = """## 运行条件与验证边界

Windows；测试只覆盖明确列出的版本组合。

## 历史记录

| 日期 | 项目基线 | Codey | Paseo daemon | Codex CLI | ChatGPT 桌面应用 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-10 | `0.0.1` | `0.10.8` | `0.7.2` | `0.153.4` | `26.903.61454` | 已通过 |
| 2026-09-11 | `0.0.2` | `[0.10.8,1.0.0]` | `0.7.2` | `0.153.4` | `26.903.71938` | 已通过 |
"""
        section = release.compatibility_section(document, "0.0.2")
        self.assertIn("`[0.10.8,1.0.0]`", section)
        self.assertNotIn("26.903.61454", section)
        with self.assertRaisesRegex(ValueError, "date"):
            release.compatibility_section(document.replace("| 2026-09-11 |", "| 2026-09-10 至 2026-09-11 |"), "0.0.2")
        with self.assertRaisesRegex(ValueError, "Codey"):
            release.compatibility_section(document.replace("`[0.10.8,1.0.0]`", "未核对"), "0.0.2")
        for invalid in ("`[1.0.0,0.10.8]`", "`[0.10.8,]`"):
            with self.subTest(interval=invalid), self.assertRaisesRegex(ValueError, "Codey"):
                release.compatibility_section(document.replace("`[0.10.8,1.0.0]`", invalid), "0.0.2")


if __name__ == "__main__":
    unittest.main()
