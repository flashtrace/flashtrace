// Windows binaries built with MSVC load vcruntime140.dll by default, which
// ships with the Visual C++ Redistributable rather than with Windows, so a
// fresh Windows install cannot run them. This links the VC runtime into the
// binary but keeps the Universal CRT - part of Windows since 10 - dynamic,
// so Windows Update keeps servicing it. .cargo/config.toml sets the matching
// +crt-static, which the crate recommends alongside:
// https://github.com/ChrisDenton/static_vcruntime
// A no-op on every other target.
fn main() {
    static_vcruntime::metabuild();
}
