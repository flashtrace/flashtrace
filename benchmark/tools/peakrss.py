#!/usr/bin/env python3
"""Run a command and print its peak RSS in KiB (Linux ru_maxrss unit).

    peakrss.py <cmd> [args...]

Output goes to stdout as a single integer; the child's stdout/stderr are
discarded. The child's exit code is ignored (flashtrace exits 1 on defects).
"""
import resource
import subprocess
import sys

subprocess.run(sys.argv[1:], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss)
