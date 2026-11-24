"""Installs the Python wheel the way a user gets it and runs the installed CLI.

The wheel of the given target is built around the given binary, installed
offline into a fresh virtual environment - which also proves that pip accepts
its platform tags on this machine - and the installed command runs a fixed
set of invocations whose output is compared against the e2e snapshots, as is
`python -m flashtrace_cli`. Nothing touches a registry and nothing in the
checkout changes; the work happens in a temp directory, and the wheel lands
in the given wheel directory, so the release publishes the very wheel tested.

The version comes from Cargo.toml, as the wheel's version comes from the
release version, so the binary's own version must match the wheel it ships in.

Usage: python .github/scripts/python_smoke_test.py <target> <binary> [<wheel-directory>]
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import python_wheel

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
IS_WINDOWS = os.name == "nt"
SCRIPTS_DIRECTORY = "Scripts" if IS_WINDOWS else "bin"

# a value carrying quotes, a space, a non-ASCII character and a trailing
# backslash: the spellings argument passing on Windows gets wrong first
UNUSUAL_ARGUMENT = 'a "b" ü\\'

failures = []


def check(name, passed, detail=""):
    print(f"{'ok  ' if passed else 'FAIL'} {name}")
    if not passed:
        failures.append(f"{name}\n{detail}" if detail else name)


def describe(result):
    return f"exit {result.returncode}\n--- stdout\n{result.stdout}\n--- stderr\n{result.stderr}"


def run(command, cwd):
    """Runs a command and returns its result with stdout and stderr decoded exactly."""
    result = subprocess.run(command, cwd=cwd, capture_output=True)
    result.stdout = result.stdout.decode("utf-8", errors="replace")
    result.stderr = result.stderr.decode("utf-8", errors="replace")
    return result


# The lines "[package]", 'name = "flashtrace"', 'version = "..."', in that
# order and adjacent, as the release workflow reads and bumps them - never
# just the first version line, which may be a dependency's. Windows runners
# check the file out with CRLF line endings.
def read_cargo_version():
    manifest = (REPOSITORY_ROOT / "Cargo.toml").read_text(encoding="utf-8")
    blocks = re.findall(r'^\[package\]\r?\nname = "flashtrace"\r?\nversion = "([^"]*)"\r?$', manifest, re.MULTILINE)
    if len(blocks) != 1:
        raise SystemExit('Cargo.toml carries no single [package] / name = "flashtrace" / version block')
    return blocks[0]


# The binary is a build output inside this checkout - target/ in CI, the
# extracted archive in the release build - so a path leading elsewhere is
# refused rather than packaged.
def read_arguments():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("usage: python .github/scripts/python_smoke_test.py <target> <binary> [<wheel-directory>]")
    target = sys.argv[1]
    binary = (REPOSITORY_ROOT / sys.argv[2]).resolve()
    if REPOSITORY_ROOT not in binary.parents:
        raise SystemExit(f"the binary must lie inside the checkout {REPOSITORY_ROOT}: {binary}")
    wheel_directory = Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else None
    return target, binary, wheel_directory


# The macOS tag promises the oldest macOS the binary starts on; rustc decides
# what that is, so the tag follows the toolchain that built the binary.
def check_macos_deployment_target(target, wheel):
    if "apple-darwin" not in target:
        return
    toolchain = run(["rustc", "--print", "deployment-target", "--target", target], REPOSITORY_ROOT)
    deployment_target = toolchain.stdout.strip().removeprefix("MACOSX_DEPLOYMENT_TARGET=").replace(".", "_")
    check(
        f"the wheel's macOS tag names rustc's deployment target {deployment_target}",
        toolchain.returncode == 0 and f"-macosx_{deployment_target}_" in wheel.name,
        f"wheel {wheel.name}\n{describe(toolchain)}",
    )


def check_wheel_contents(target, wheel, binary, version):
    script = f"flashtrace_cli-{version}.data/scripts/{python_wheel.binary_name_of(target)}"
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        packed_binary = archive.read(script) if script in names else None
        mode = archive.getinfo(script).external_attr >> 16 if script in names else 0
    check(f"the wheel carries the binary as {script}", packed_binary == binary.read_bytes())
    check("the packed binary is executable", mode & 0o111 == 0o111, f"mode {mode:o}")
    check("the wheel carries the LICENSE", f"flashtrace_cli-{version}.dist-info/licenses/LICENSE" in names)


def install(work_directory, wheel):
    environment = work_directory / "environment"
    subprocess.run([sys.executable, "-m", "venv", str(environment)], check=True)
    python = environment / SCRIPTS_DIRECTORY / ("python.exe" if IS_WINDOWS else "python")
    installation = run(
        [str(python), "-m", "pip", "install", "--no-index", "--no-deps", "--disable-pip-version-check", "--no-cache-dir", str(wheel)],
        work_directory,
    )
    check("pip installs the wheel offline on this machine", installation.returncode == 0, describe(installation))
    if installation.returncode != 0:
        raise SystemExit(report(work_directory))
    return environment, python


# The same normalization tests/e2e.rs applies: Windows prints backslash
# paths, and the JSON report's version field bumps every release.
def normalize(output):
    return re.sub(r'^(  "flashtrace": ")[^"]*"', r'\1<version>"', output.replace("\\", "/"), count=1, flags=re.MULTILINE)


def read_snapshot(name):
    return (REPOSITORY_ROOT / "tests" / "e2e-expect" / f"{name}.txt").read_bytes().decode("utf-8")


# Runs the given command - the installed binary or python -m flashtrace_cli -
# from a fresh copy of an example where the run needs a project. A few
# snapshots suffice: the e2e suite pins the output, these runs prove that the
# command reaches the binary and passes its output and exit code through.
def check_command(label, command, work_directory, version):
    def run_command(arguments, example=None):
        cwd = work_directory
        if example:
            cwd = work_directory / "examples" / f"{label}-{example}-{'-'.join(arguments)}"
            shutil.copytree(REPOSITORY_ROOT / "examples" / example, cwd)
        return run([*command, *arguments], cwd)

    version_run = run_command(["--version"])
    check(
        f"{label} --version prints {version}",
        version_run.returncode == 0 and version_run.stdout == f"{version}\n" and version_run.stderr == "",
        describe(version_run),
    )

    snapshot_runs = [
        ("a clean project", "basic", [], 0, "basic.default"),
        ("the JSON report", "basic", ["--json"], 0, "basic.json"),
        ("a project with defects", "diagnostics", [], 1, "diagnostics.default"),
        ("an option with a value", "polyglot-web", ["--tags", "web,data"], 0, "polyglot-web.tags"),
    ]
    for name, example, arguments, status, snapshot in snapshot_runs:
        result = run_command(arguments, example)
        check(
            f"{label}: {name} exits {status} and matches {snapshot}",
            result.returncode == status and result.stderr == "" and normalize(result.stdout) == read_snapshot(snapshot),
            describe(result),
        )

    argument_run = run_command(["--format", UNUSUAL_ARGUMENT])
    check(
        f"{label} passes arguments through unchanged",
        argument_run.returncode == 2 and f'"{UNUSUAL_ARGUMENT}"' in argument_run.stderr,
        describe(argument_run),
    )


def check_installed_command(target, environment, binary, work_directory, version):
    command = environment / SCRIPTS_DIRECTORY / python_wheel.binary_name_of(target)
    check(
        f"the installed command {SCRIPTS_DIRECTORY}/{command.name} is the binary itself",
        command.is_file() and command.read_bytes() == binary.read_bytes(),
    )
    if not IS_WINDOWS:
        check("the installed command is executable", command.is_file() and os.stat(command).st_mode & 0o111 == 0o111)
    check_command("flashtrace", [str(command)], work_directory, version)

    help_run = run([str(command), "--help"], work_directory)
    check("flashtrace --help prints the usage", help_run.returncode == 0 and len(help_run.stdout) > 0, describe(help_run))

    usage_run = run([str(command), "--frobnicate"], work_directory)
    check(
        "an unknown option exits 2 with the error on stderr",
        usage_run.returncode == 2 and usage_run.stdout == "" and usage_run.stderr.startswith("error: unknown option"),
        describe(usage_run),
    )
    return command


def check_module(python, command, work_directory, version):
    located = run([str(python), "-c", "import flashtrace_cli; print(flashtrace_cli.find_binary())"], work_directory)
    check(
        "find_binary locates the installed command",
        # the same file, not the same spelling: temp paths may run through a symlink
        located.returncode == 0 and os.path.isfile(located.stdout.strip()) and os.path.samefile(located.stdout.strip(), command),
        describe(located),
    )
    check_command("python -m flashtrace_cli", [str(python), "-m", "flashtrace_cli"], work_directory, version)


# Without its binary the module explains instead of crashing
def check_missing_binary(python, command, work_directory):
    command.unlink()
    missing_run = run([str(python), "-m", "flashtrace_cli", "--version"], work_directory)
    check(
        "a missing binary exits 2 with an explanation",
        missing_run.returncode == 2 and "is missing; reinstall it with: pip install --force-reinstall flashtrace-cli" in missing_run.stderr,
        describe(missing_run),
    )


def report(work_directory):
    if failures:
        print(f"\n{len(failures)} check(s) failed; the environment remains in {work_directory}\n", file=sys.stderr)
        for failure in failures:
            print(f"{failure}\n", file=sys.stderr)
        return 1
    shutil.rmtree(work_directory, ignore_errors=True)
    print("\nAll checks passed.")
    return 0


def main():
    target, binary, wheel_directory = read_arguments()
    version = read_cargo_version()
    work_directory = Path(tempfile.mkdtemp(prefix="flashtrace-python-smoke-"))
    wheel = python_wheel.build_wheel(REPOSITORY_ROOT, target, version, binary, wheel_directory or work_directory / "wheels")
    print(f"Smoke-testing {wheel.name} with {binary}")

    check_macos_deployment_target(target, wheel)
    check_wheel_contents(target, wheel, binary, version)
    environment, python = install(work_directory, wheel)
    command = check_installed_command(target, environment, binary, work_directory, version)
    check_module(python, command, work_directory, version)
    check_missing_binary(python, command, work_directory)
    return report(work_directory)


if __name__ == "__main__":
    sys.exit(main())
