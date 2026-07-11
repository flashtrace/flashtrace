# Native binaries

Besides the npm package, every release ships flashtrace as self-contained
native executables built as Node [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html).
Node is embedded in the binary, so it runs anywhere - nothing needs to be
installed on the host.

## Naming and platform matrix

Each release `v<version>` carries one binary per supported platform, attached
as GitHub Release assets and downloadable from
`https://github.com/flashtrace/flashtrace/releases/download/v<version>/<asset-name>`:

```
flashtrace-v<version>-<platform>[.exe]
```

`<platform>` is the Node platform-architecture pair:

| Platform | Asset |
|---|---|
| Linux x64 | `flashtrace-v<version>-linux-x64` |
| Linux arm64 | `flashtrace-v<version>-linux-arm64` |
| macOS x64 (Intel) | `flashtrace-v<version>-darwin-x64` |
| macOS arm64 (Apple Silicon) | `flashtrace-v<version>-darwin-arm64` |
| Windows x64 | `flashtrace-v<version>-win32-x64.exe` |

A binary behaves exactly like `node dist/flashtrace.mjs` of the same version:
same [command line](command-line.md), same report, same `0`/`1`/`2` exit
codes. `--version` prints the version baked in at build time. macOS binaries
are ad-hoc signed; Windows binaries carry no valid Authenticode signature.

## Checksums

Every release also attaches a `SHA256SUMS` asset: one `<sha256>  <asset-name>`
line per binary, in the format of `sha256sum` (verifiable with
`sha256sum --check SHA256SUMS`).

## Building

`pnpm build:sea` builds the binary for the current platform into `dist-sea/`
(requires Node >= 20); `pnpm test:sea` smoke-tests it against fixture
projects. Releases build all platforms via the `SEA binaries` workflow, which
can also be dispatched manually as a dry run producing workflow artifacts
instead of release assets.
