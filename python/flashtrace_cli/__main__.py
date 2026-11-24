"""Run the flashtrace binary: python -m flashtrace_cli [options] [directory-or-file ...]

The installed `flashtrace` command is the binary itself; this entry point is
for environments whose scripts directory is not on the PATH. No downloads and
no fallbacks: if the binary is not there, the fix is a reinstall, and this
only says so.
"""

import os
import signal
import subprocess
import sys

from flashtrace_cli import find_binary


def main():
    try:
        binary = find_binary()
    except FileNotFoundError as error:
        print(f"flashtrace: {error}", file=sys.stderr)
        return 2
    arguments = [binary, *sys.argv[1:]]
    try:
        if os.name != "nt":
            # The binary takes over this process: its exit code, its signals
            # and its standard streams are the caller's without a relay.
            os.execv(binary, arguments)
        # Windows has no exec, so the binary runs as a child. Ctrl+C reaches
        # both processes; ignoring it here leaves the decision to the binary,
        # whose exit code is then passed on unchanged.
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        return subprocess.run(arguments).returncode
    except OSError as error:
        print(f"flashtrace: failed to run {binary}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
