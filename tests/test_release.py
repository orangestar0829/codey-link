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
        import re
        self.document = re.sub(r"项目基线：\*\*`[^`]+`\*\*", "项目基线：**`0.0.1`**", self.document)
        self.git("init", "-q")
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
        self.assertIn("### 功能矩阵", (output / "release-notes.md").read_text(encoding="utf-8"))
        release.build(self.repo, "0.0.1", output)
        self.assertEqual(archive.read_bytes(), first_bytes)

    def test_version_and_record_guards(self):
        for invalid in ("main", "../0.0.1", "--help", "0.0.1;echo", "01.0.1"):
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                release.version_for(invalid)
        self.assertEqual(release.version_for("v0.0.2-rc.1"), "0.0.2-rc.1")
        with self.assertRaisesRegex(ValueError, "baseline"):
            release.compatibility_section(self.document, "0.0.2")
        with self.assertRaisesRegex(ValueError, "Codey"):
            release.compatibility_section(self.document.replace("| Codey |", "| Removed |"), "0.0.1")
        with self.assertRaises(subprocess.CalledProcessError):
            release.build(self.repo, "0.0.9", Path(self.temp.name) / "missing")


if __name__ == "__main__":
    unittest.main()
