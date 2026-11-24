"""flashtrace, the requirement tracing CLI, packaged for Python.

Each platform wheel carries the native flashtrace binary as a script, so pip
installs the binary itself as the `flashtrace` command: running it never
starts Python. This module only locates that binary, for
`python -m flashtrace_cli` and for tools that want to run it themselves.
"""

import importlib.metadata
import os

DISTRIBUTION_NAME = "flashtrace-cli"
BINARY_NAME = "flashtrace.exe" if os.name == "nt" else "flashtrace"

__all__ = ["find_binary"]


def find_binary():
    """Return the absolute path of the flashtrace binary this distribution installed.

    The path comes from the installation's own record of its files, so it is
    right for every install scheme - a virtual environment, a user install,
    `pip install --target` - rather than guessed from where scripts usually go.

    Raises FileNotFoundError when the distribution or its binary is missing.
    """
    try:
        files = importlib.metadata.distribution(DISTRIBUTION_NAME).files or []
    except importlib.metadata.PackageNotFoundError:
        files = []
    for file in files:
        if file.name == BINARY_NAME:
            path = os.path.normpath(file.locate())
            if os.path.isfile(path):
                return path
    raise FileNotFoundError(
        f"the {BINARY_NAME} binary of the {DISTRIBUTION_NAME} package is missing; "
        f"reinstall it with: pip install --force-reinstall {DISTRIBUTION_NAME}"
    )
