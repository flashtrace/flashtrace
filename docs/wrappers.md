# Distribution: native binaries and ecosystem wrappers

Besides the npm package, every release ships flashtrace as self-contained
native executables (Node [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html);
Node is embedded, nothing needs to be installed on the host). Ecosystem
wrappers - Gradle, Maven, .NET tool, pip package - are thin launchers that
download, verify, cache and run these binaries.

## Binaries

### Naming and platform matrix

Each release `v<version>` carries one binary per supported platform, attached
as GitHub Release assets:

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

### Checksums

Every release also attaches a `SHA256SUMS` asset: one `<sha256>  <asset-name>`
line per binary, in the format of `sha256sum` (verifiable with
`sha256sum --check SHA256SUMS`).

### Building

`pnpm build:sea` builds the binary for the current platform into `dist-sea/`
(requires Node >= 20); `pnpm test:sea` smoke-tests it against fixture
projects. Releases build all platforms via the `SEA binaries` workflow, which
can also be dispatched manually as a dry run producing workflow artifacts
instead of release assets.

## The wrapper launcher contract

Every ecosystem wrapper implements exactly this behavior:

1. **Resolve** the host OS and architecture to an asset name from the platform
   matrix above; fail with a clear message naming the unsupported platform
   otherwise.
2. **Cache lookup**: use the binary at
   `~/.cache/flashtrace/<version>/<asset-name>` (Windows:
   `%LOCALAPPDATA%\flashtrace\<version>\<asset-name>`) if present.
3. **Download** on cache miss from
   `https://github.com/flashtrace/flashtrace/releases/download/v<version>/<asset-name>`.
4. **Verify** the download's SHA-256 against the checksums baked into the
   wrapper at publish time - registry-attested, deliberately not fetched from
   the same origin as the binary. On mismatch, fail and leave nothing in the
   cache. On success, mark the file executable and move it into the cache
   atomically.
5. **Run** the cached binary with all arguments passed through unchanged,
   forwarding stdout, stderr and the exit code.

Wrapper versions always equal the core version they launch. The release
workflow stamps the version and the generated checksums into each wrapper at
publish time; neither is ever hand-edited.

For tests, every wrapper accepts an override (environment variable or build
property) pointing at a local binary and checksums fixture, so wrapper test
suites never touch the network.
