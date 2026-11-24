"""Builds the flashtrace-cli platform wheel for one release target.

A wheel is a zip archive with a fixed layout, so the standard library builds
it without a build backend: the launcher module from python/flashtrace_cli,
the binary under the .data/scripts directory - which installers place on the
PATH as the flashtrace command itself - and the .dist-info metadata, with the
root README as the project description and the root LICENSE beside it.

The version is the release version, passed in rather than kept in a manifest,
so the release bump has no Python file to edit. The archive's bytes depend
only on its inputs: fixed timestamps and modes, a fixed entry order and LF
line endings in every text file, whatever the checkout's line endings are.

Usage: python3 .github/scripts/python_wheel.py <target> <version> <binary> <output-directory>
Prints the path of the built wheel.
"""

import base64
import hashlib
import re
import sys
import zipfile
from pathlib import Path

DISTRIBUTION_NAME = "flashtrace-cli"
# the distribution name as wheel file and directory names spell it
WHEEL_NAME = "flashtrace_cli"
MODULE_NAME = "flashtrace_cli"
SUMMARY = "Lightning-fast, reference-based requirement tracing that works anywhere."
REQUIRES_PYTHON = ">=3.9"

# The platform tags each release target's binary runs on. The musl binaries
# are linked statically (the release checks it), so they run on glibc and
# musl systems alike and carry both tag families, at the oldest version of
# each. The macOS tags carry rustc's default deployment target, which the
# smoke test compares against the toolchain. Adding a target here goes with
# the build matrices in release.yml and ci.yml.
PLATFORM_TAGS = {
    "x86_64-unknown-linux-musl": "manylinux_2_17_x86_64.manylinux2014_x86_64.musllinux_1_1_x86_64",
    "aarch64-unknown-linux-musl": "manylinux_2_17_aarch64.manylinux2014_aarch64.musllinux_1_1_aarch64",
    "x86_64-apple-darwin": "macosx_10_12_x86_64",
    "aarch64-apple-darwin": "macosx_11_0_arm64",
    "x86_64-pc-windows-msvc": "win_amd64",
    "aarch64-pc-windows-msvc": "win_arm64",
}

# the release only ever produces major.minor.patch, which PEP 440 reads as is
VERSION_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")

# the earliest date a zip archive can record
FIXED_DATE_TIME = (1980, 1, 1, 0, 0, 0)
REGULAR_FILE_MODE = 0o100644
EXECUTABLE_FILE_MODE = 0o100755
# Unix, so installers read the modes above on every build platform
UNIX_SYSTEM = 3


def binary_name_of(target):
    return "flashtrace.exe" if "windows" in target else "flashtrace"


def wheel_filename(target, version):
    return f"{WHEEL_NAME}-{version}-py3-none-{PLATFORM_TAGS[target]}.whl"


def read_text(path):
    """Reads a text file with LF line endings, whatever the checkout wrote."""
    return path.read_bytes().replace(b"\r\n", b"\n")


def metadata(version, readme):
    headers = [
        ("Metadata-Version", "2.4"),
        ("Name", DISTRIBUTION_NAME),
        ("Version", version),
        ("Summary", SUMMARY),
        ("Keywords", "requirements,traceability,tracing,coverage,markdown,cli"),
        ("License-Expression", "Apache-2.0"),
        ("License-File", "LICENSE"),
        ("Project-URL", "Homepage, https://github.com/flashtrace/flashtrace#readme"),
        ("Project-URL", "Source, https://github.com/flashtrace/flashtrace"),
        ("Project-URL", "Issues, https://github.com/flashtrace/flashtrace/issues"),
        ("Requires-Python", REQUIRES_PYTHON),
        ("Description-Content-Type", "text/markdown"),
    ]
    head = "".join(f"{name}: {value}\n" for name, value in headers)
    return head.encode("utf-8") + b"\n" + readme


def wheel_file(target):
    tags = "".join(f"Tag: py3-none-{tag}\n" for tag in PLATFORM_TAGS[target].split("."))
    return f"Wheel-Version: 1.0\nGenerator: flashtrace python_wheel.py\nRoot-Is-Purelib: false\n{tags}".encode("utf-8")


def record_line(path, content):
    digest = base64.urlsafe_b64encode(hashlib.sha256(content).digest()).rstrip(b"=").decode("ascii")
    return f"{path},sha256={digest},{len(content)}\n"


def entries_of(repository_root, target, version, binary):
    """The wheel's files as (path, content, mode), RECORD last as required."""
    data_directory = f"{WHEEL_NAME}-{version}.data"
    dist_info = f"{WHEEL_NAME}-{version}.dist-info"
    module_directory = repository_root / "python" / MODULE_NAME
    entries = [
        (f"{MODULE_NAME}/{source.name}", read_text(source), REGULAR_FILE_MODE)
        for source in sorted(module_directory.glob("*.py"))
    ]
    entries.append((f"{data_directory}/scripts/{binary_name_of(target)}", binary.read_bytes(), EXECUTABLE_FILE_MODE))
    entries.append((f"{dist_info}/METADATA", metadata(version, read_text(repository_root / "README.md")), REGULAR_FILE_MODE))
    entries.append((f"{dist_info}/WHEEL", wheel_file(target), REGULAR_FILE_MODE))
    entries.append((f"{dist_info}/licenses/LICENSE", read_text(repository_root / "LICENSE"), REGULAR_FILE_MODE))
    record = "".join(record_line(path, content) for path, content, _ in entries) + f"{dist_info}/RECORD,,\n"
    entries.append((f"{dist_info}/RECORD", record.encode("utf-8"), REGULAR_FILE_MODE))
    return entries


def build_wheel(repository_root, target, version, binary, output_directory):
    """Builds the wheel of the given target into output_directory and returns its path."""
    if target not in PLATFORM_TAGS:
        raise ValueError(f"no platform tags for target {target}; known targets: {', '.join(sorted(PLATFORM_TAGS))}")
    if not VERSION_RE.match(version):
        raise ValueError(f"version {version} is not major.minor.patch")
    repository_root = Path(repository_root)
    output_directory = Path(output_directory)
    entries = entries_of(repository_root, target, version, Path(binary))
    output_directory.mkdir(parents=True, exist_ok=True)
    wheel = output_directory / wheel_filename(target, version)
    with zipfile.ZipFile(wheel, "w") as archive:
        for path, content, mode in entries:
            info = zipfile.ZipInfo(path, date_time=FIXED_DATE_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = UNIX_SYSTEM
            info.external_attr = mode << 16
            archive.writestr(info, content)
    return wheel


def main(argv):
    if len(argv) != 5:
        print("usage: python3 .github/scripts/python_wheel.py <target> <version> <binary> <output-directory>", file=sys.stderr)
        return 2
    target, version, binary, output_directory = argv[1:]
    repository_root = Path(__file__).resolve().parents[2]
    try:
        print(build_wheel(repository_root, target, version, binary, output_directory))
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
