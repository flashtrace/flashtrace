"""Unit tests for python_wheel.py.

Run: python3 -m unittest discover -s .github/scripts -p '*_test.py'
"""

import base64
import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

import python_wheel

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class PythonWheelTest(unittest.TestCase):
    def setUp(self):
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        self.work_directory = Path(temporary_directory.name)
        self.binary = self.work_directory / "flashtrace"
        self.binary.write_bytes(b"\x7fELF not really a binary")

    def build(self, target="x86_64-unknown-linux-musl", version="1.2.3", repository_root=REPOSITORY_ROOT, output="wheels"):
        return python_wheel.build_wheel(repository_root, target, version, self.binary, self.work_directory / output)

    def test_the_wheel_is_named_after_the_version_and_the_platform_tags(self):
        # when
        wheel = self.build(target="aarch64-apple-darwin", version="0.15.1")

        # then
        self.assertEqual(wheel.name, "flashtrace_cli-0.15.1-py3-none-macosx_11_0_arm64.whl")

    def test_a_static_linux_wheel_is_tagged_for_glibc_and_musl(self):
        # when
        wheel = self.build(target="x86_64-unknown-linux-musl")

        # then
        with zipfile.ZipFile(wheel) as archive:
            tags = [line for line in archive.read("flashtrace_cli-1.2.3.dist-info/WHEEL").decode().splitlines() if line.startswith("Tag: ")]
        self.assertEqual(
            tags,
            [
                "Tag: py3-none-manylinux_2_17_x86_64",
                "Tag: py3-none-manylinux2014_x86_64",
                "Tag: py3-none-musllinux_1_1_x86_64",
            ],
        )

    def test_the_binary_is_an_executable_script(self):
        # when
        wheel = self.build()

        # then
        with zipfile.ZipFile(wheel) as archive:
            info = archive.getinfo("flashtrace_cli-1.2.3.data/scripts/flashtrace")
            content = archive.read(info)
        self.assertEqual(content, self.binary.read_bytes())
        self.assertEqual(info.external_attr >> 16, 0o100755)

    def test_a_windows_wheel_carries_the_exe_binary(self):
        # when
        wheel = self.build(target="aarch64-pc-windows-msvc")

        # then
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
        self.assertIn("flashtrace_cli-1.2.3.data/scripts/flashtrace.exe", names)
        self.assertTrue(wheel.name.endswith("-py3-none-win_arm64.whl"))

    def test_the_wheel_holds_the_launcher_module_and_the_license(self):
        # when
        wheel = self.build()

        # then
        with zipfile.ZipFile(wheel) as archive:
            names = archive.namelist()
            license_text = archive.read("flashtrace_cli-1.2.3.dist-info/licenses/LICENSE")
        self.assertIn("flashtrace_cli/__init__.py", names)
        self.assertIn("flashtrace_cli/__main__.py", names)
        self.assertEqual(license_text, (REPOSITORY_ROOT / "LICENSE").read_bytes().replace(b"\r\n", b"\n"))

    def test_the_record_lists_every_other_file_with_its_hash_and_size(self):
        # when
        wheel = self.build()

        # then
        with zipfile.ZipFile(wheel) as archive:
            record_path = "flashtrace_cli-1.2.3.dist-info/RECORD"
            record = archive.read(record_path).decode().splitlines()
            expected = []
            for name in archive.namelist():
                if name == record_path:
                    expected.append(f"{name},,")
                    continue
                content = archive.read(name)
                digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode()
                expected.append(f"{name},sha256={digest},{len(content)}")
            last_name = archive.namelist()[-1]
        self.assertEqual(record, expected)
        self.assertEqual(last_name, record_path)

    def test_the_metadata_names_the_distribution_version_license_and_description(self):
        # when
        wheel = self.build(version="2.0.0")

        # then
        with zipfile.ZipFile(wheel) as archive:
            metadata = archive.read("flashtrace_cli-2.0.0.dist-info/METADATA").decode()
        head, description = metadata.split("\n\n", 1)
        self.assertIn("Name: flashtrace-cli\n", head + "\n")
        self.assertIn("Version: 2.0.0\n", head + "\n")
        self.assertIn("License-Expression: Apache-2.0\n", head + "\n")
        self.assertIn("Description-Content-Type: text/markdown\n", head + "\n")
        self.assertEqual(description, (REPOSITORY_ROOT / "README.md").read_bytes().replace(b"\r\n", b"\n").decode())

    def test_text_files_carry_lf_line_endings_from_a_crlf_checkout(self):
        # given
        checkout = self.work_directory / "checkout"
        (checkout / "python" / "flashtrace_cli").mkdir(parents=True)
        (checkout / "python" / "flashtrace_cli" / "__init__.py").write_bytes(b"one\r\ntwo\r\n")
        (checkout / "README.md").write_bytes(b"# readme\r\n")
        (checkout / "LICENSE").write_bytes(b"license\r\n")

        # when
        wheel = self.build(repository_root=checkout)

        # then
        with zipfile.ZipFile(wheel) as archive:
            self.assertEqual(archive.read("flashtrace_cli/__init__.py"), b"one\ntwo\n")
            self.assertEqual(archive.read("flashtrace_cli-1.2.3.dist-info/licenses/LICENSE"), b"license\n")
            self.assertTrue(archive.read("flashtrace_cli-1.2.3.dist-info/METADATA").endswith(b"\n\n# readme\n"))

    def test_building_twice_yields_identical_bytes(self):
        # given
        first = self.build(output="first").read_bytes()

        # when
        second = self.build(output="second").read_bytes()

        # then
        self.assertEqual(first, second)

    def test_an_unknown_target_is_refused(self):
        # when
        with self.assertRaises(ValueError) as raised:
            self.build(target="riscv64gc-unknown-linux-musl")

        # then
        self.assertIn("no platform tags for target riscv64gc-unknown-linux-musl", str(raised.exception))

    def test_a_version_that_is_not_major_minor_patch_is_refused(self):
        # when
        with self.assertRaises(ValueError) as raised:
            self.build(version="1.0.0-rc.1")

        # then
        self.assertIn("version 1.0.0-rc.1 is not major.minor.patch", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
