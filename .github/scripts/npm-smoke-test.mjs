// Installs the npm packages the way a user gets them and runs the installed
// CLI: the platform package of this machine receives the given binary, both
// it and the launcher are packed, the tarballs install offline into an empty
// project, and the installed command runs a fixed set of invocations whose
// output is compared against the e2e snapshots. Beforehand, the launcher's
// pins are checked against every platform package. Nothing touches the
// registry and nothing in the checkout changes; the work happens in a temp
// directory.
//
// The version comes from Cargo.toml and is written into the staged manifests,
// as the release bump writes it into the real ones, so the binary's own
// version must match the packages it ships in.
//
// Usage: node .github/scripts/npm-smoke-test.mjs <binary>

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const isWindows = process.platform === 'win32';
const platform = `${process.platform}-${process.arch}`;
const binaryName = isWindows ? 'flashtrace.exe' : 'flashtrace';
const platformPackage = `@flashtrace/${platform}`;

// a value carrying quotes, a space, a non-ASCII character and a trailing
// backslash: the spellings argument passing on Windows gets wrong first
const UNUSUAL_ARGUMENT = 'a "b" ü\\';

// The lines "[package]", 'name = "flashtrace"', 'version = "..."', in that
// order and adjacent, as the release workflow reads and bumps them - never
// just the first version line, which may be a dependency's. Windows runners
// check the file out with CRLF line endings.
function readCargoVersion() {
  const manifest = readFileSync(join(repositoryRoot, 'Cargo.toml'), 'utf8');
  const blocks = [...manifest.matchAll(/^\[package\]\r?\nname = "flashtrace"\r?\nversion = "([^"]*)"\r?$/gm)];
  if (blocks.length !== 1) {
    throw new Error('Cargo.toml carries no single [package] / name = "flashtrace" / version block');
  }
  return blocks[0][1];
}

function setManifestVersions(packageDir, version, pinOptionalDependencies) {
  const manifestPath = join(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  if (pinOptionalDependencies) {
    for (const name of Object.keys(manifest.optionalDependencies)) {
      manifest.optionalDependencies[name] = version;
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// npm and the installed bin shim are .cmd files on Windows, which Node only
// spawns through a shell; there every argument is quoted for cmd. The
// arguments passed this way are paths and plain flags without quotes. A bare
// command name stays unquoted: cmd resolves a quoted one's own directory
// (%~dp0, which npm.cmd locates npm by) to the working directory instead.
function runCommand(command, args, cwd) {
  const quotedCommand = command.includes('\\') ? `"${command}"` : command;
  const commandLine = [quotedCommand, ...args.map((argument) => `"${argument}"`)].join(' ');
  const res = isWindows
    ? spawnSync(commandLine, { cwd, shell: true, encoding: 'utf8' })
    : spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function npm(args, cwd) {
  const res = runCommand(isWindows ? 'npm.cmd' : 'npm', args, cwd);
  if (res.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed with ${res.status}:\n${res.stdout}${res.stderr}`);
  }
  return res.stdout;
}

// --ignore-scripts, as the release job packs: the launcher's prepack copies
// the root README and LICENSE by a path that exists only inside the checkout,
// so stageAndPack copies them instead
function pack(packageDir, destination) {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', destination], packageDir));
  return { tarball: join(destination, packed.filename), files: packed.files };
}

function installOffline(projectDir, tarballs, extraArgs = []) {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{ "name": "smoke-test-project", "private": true }\n');
  npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...extraArgs, ...tarballs], projectDir);
}

// The same normalization tests/e2e.rs applies: the JSON report's version field
// bumps every release, so pin it to a placeholder. Paths stay as printed:
// every platform must spell them with `/`.
function normalize(output) {
  return output.replace(/^( {2}"flashtrace": ")[^"]*"/m, '$1<version>"');
}

function readSnapshot(name) {
  return readFileSync(join(repositoryRoot, 'tests', 'e2e-expect', `${name}.txt`), 'utf8');
}

const failures = [];

function check(name, passed, detail = '') {
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}`);
  if (!passed) failures.push(detail ? `${name}\n${detail}` : name);
}

function describe(res) {
  return `exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`;
}

function installedCommand(projectDir) {
  return join(projectDir, 'node_modules', '.bin', isWindows ? 'flashtrace.cmd' : 'flashtrace');
}

// The binary is a build output inside this checkout - target/ in CI, the
// extracted archive in the release build - so a path leading elsewhere is
// refused rather than copied from.
function readBinaryArgument() {
  const argument = process.argv[2];
  if (!argument) throw new Error('usage: node .github/scripts/npm-smoke-test.mjs <binary>');
  const binary = resolve(repositoryRoot, argument);
  if (!binary.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`the binary must lie inside the checkout ${repositoryRoot}: ${binary}`);
  }
  return binary;
}

// The launcher finds its binary by the package name @flashtrace/<os>-<cpu>,
// and npm installs only the platform packages the launcher pins whose os and
// cpu match the machine. The install below gets this machine's package from
// its own tarball whatever the pins say, and a mismatched pin is optional, so
// npm skips it silently: the names are checked here, for every platform
// package in the repository, not only this machine's.
function checkPlatformPackageNames() {
  const launcherManifest = JSON.parse(readFileSync(join(repositoryRoot, 'npm', 'flashtrace', 'package.json'), 'utf8'));
  const platformDirs = readdirSync(join(repositoryRoot, 'npm', '@flashtrace')).sort((left, right) => left.localeCompare(right));
  const expectedPins = platformDirs.map((dir) => `@flashtrace/${dir}`);
  const pins = Object.keys(launcherManifest.optionalDependencies ?? {}).sort((left, right) => left.localeCompare(right));
  check(
    'the launcher pins exactly the platform packages in npm/@flashtrace',
    JSON.stringify(pins) === JSON.stringify(expectedPins),
    `pinned:   ${pins.join(', ')}\nexpected: ${expectedPins.join(', ')}`,
  );
  for (const dir of platformDirs) {
    const manifest = JSON.parse(readFileSync(join(repositoryRoot, 'npm', '@flashtrace', dir, 'package.json'), 'utf8'));
    const [os, cpu] = dir.split('-');
    check(
      `npm/@flashtrace/${dir} is named @flashtrace/${dir} and installs on ${os} ${cpu} only`,
      manifest.name === `@flashtrace/${dir}` &&
        JSON.stringify(manifest.os) === JSON.stringify([os]) &&
        JSON.stringify(manifest.cpu) === JSON.stringify([cpu]),
      `name ${manifest.name}, os ${JSON.stringify(manifest.os)}, cpu ${JSON.stringify(manifest.cpu)}`,
    );
  }
}

// Stages copies of both packages, the root README in the launcher, the root
// LICENSE in both and the binary in the platform package's bin/, packs them
// and checks that the tarballs hold what a user needs. The repository holds
// no bin/ for the platform packages; it exists only once a binary is in it.
function stageAndPack(workDir, binary, version) {
  const launcherDir = join(workDir, 'stage', 'launcher');
  const platformDir = join(workDir, 'stage', 'platform');
  const tarballDir = join(workDir, 'tarballs');
  cpSync(join(repositoryRoot, 'npm', 'flashtrace'), launcherDir, { recursive: true });
  copyFileSync(join(repositoryRoot, 'README.md'), join(launcherDir, 'README.md'));
  copyFileSync(join(repositoryRoot, 'LICENSE'), join(launcherDir, 'LICENSE'));
  cpSync(join(repositoryRoot, 'npm', '@flashtrace', platform), platformDir, { recursive: true });
  copyFileSync(join(repositoryRoot, 'LICENSE'), join(platformDir, 'LICENSE'));
  mkdirSync(join(platformDir, 'bin'), { recursive: true });
  copyFileSync(binary, join(platformDir, 'bin', binaryName));
  if (!isWindows) chmodSync(join(platformDir, 'bin', binaryName), 0o755);
  setManifestVersions(launcherDir, version, true);
  setManifestVersions(platformDir, version, false);
  mkdirSync(tarballDir);
  const launcher = pack(launcherDir, tarballDir);
  const platformPacked = pack(platformDir, tarballDir);

  check('the launcher tarball contains README.md', launcher.files.some((file) => file.path === 'README.md'));
  check('the launcher tarball contains LICENSE', launcher.files.some((file) => file.path === 'LICENSE'));
  check('the platform tarball contains LICENSE', platformPacked.files.some((file) => file.path === 'LICENSE'));
  const packedBinary = platformPacked.files.find((file) => file.path === `bin/${binaryName}`);
  check(`the platform tarball contains bin/${binaryName}`, packedBinary !== undefined);
  if (!isWindows) {
    const mode = packedBinary?.mode ?? 0;
    check('the packed binary is executable', (mode & 0o111) === 0o111, `mode ${mode.toString(8)}`);
  }
  return { launcherTarball: launcher.tarball, platformTarball: platformPacked.tarball };
}

// Installs both tarballs into an empty project without the registry and
// checks that the installed launcher resolves the platform package's binary.
// The five other platform packages stay unresolved optional entries, so
// `npm ls` would fail here by design and is not the check.
function installAndResolve(projectDir, tarballs, version) {
  installOffline(projectDir, [tarballs.launcherTarball, tarballs.platformTarball]);
  check('both tarballs install offline into an empty project', true);

  const installedLauncher = join(projectDir, 'node_modules', 'flashtrace', 'bin', 'flashtrace.js');
  const installedManifest = JSON.parse(
    readFileSync(join(projectDir, 'node_modules', '@flashtrace', platform, 'package.json'), 'utf8'),
  );
  check(`${platformPackage} is installed at ${version}`, installedManifest.version === version, `found ${installedManifest.version}`);
  let resolvedBinary = null;
  try {
    resolvedBinary = createRequire(installedLauncher).resolve(`${platformPackage}/bin/${binaryName}`);
  } catch {
    // reported by the check below
  }
  check('the launcher resolves the installed binary', resolvedBinary !== null);
  if (!isWindows && resolvedBinary) {
    check('the installed binary is executable', (statSync(resolvedBinary).mode & 0o111) === 0o111);
  }
  return installedLauncher;
}

// Runs the command npm installed, from a fresh copy of an example where the
// run needs a project. A few snapshots suffice: the e2e suite pins the output,
// these runs prove that the installed command reaches the binary and passes
// its output and exit code through.
function checkInstalledCommand(workDir, projectDir, version) {
  function runInstalled(args, example) {
    let cwd = projectDir;
    if (example) {
      cwd = join(workDir, 'examples', `${example}-${args.join('-')}`);
      cpSync(join(repositoryRoot, 'examples', example), cwd, { recursive: true });
    }
    return runCommand(installedCommand(projectDir), args, cwd);
  }

  const versionRun = runInstalled(['--version']);
  check(
    `--version prints ${version}`,
    versionRun.status === 0 && versionRun.stdout === `${version}\n` && versionRun.stderr === '',
    describe(versionRun),
  );

  const helpRun = runInstalled(['--help']);
  check('--help prints the usage', helpRun.status === 0 && helpRun.stdout.length > 0, describe(helpRun));

  const snapshotRuns = [
    ['a clean project', 'basic', [], 0, 'basic.default'],
    ['the JSON report', 'basic', ['--json'], 0, 'basic.json'],
    ['a project with defects', 'diagnostics', [], 1, 'diagnostics.default'],
    ['an option with a value', 'polyglot-web', ['--tags', 'web,data'], 0, 'polyglot-web.tags'],
  ];
  for (const [name, example, args, status, snapshot] of snapshotRuns) {
    const res = runInstalled(args, example);
    check(
      `${name} exits ${status} and matches ${snapshot}`,
      res.status === status && res.stderr === '' && normalize(res.stdout) === readSnapshot(snapshot),
      describe(res),
    );
    if (args.includes('--json')) {
      check(`${name} reports version ${version}`, res.stdout.includes(`\n  "flashtrace": "${version}"`), describe(res));
    }
  }

  const usageRun = runInstalled(['--frobnicate']);
  check(
    'an unknown option exits 2 with the error on stderr',
    usageRun.status === 2 && usageRun.stdout === '' && usageRun.stderr.startsWith('error: unknown option'),
    describe(usageRun),
  );
}

// Runs the launcher directly rather than the installed command: Node quotes
// the arguments of both spawns, and only the launcher's own spawn is this
// repository's code - npm's Windows .cmd shim is not
function checkArgumentPassing(projectDir, installedLauncher) {
  const argumentRun = spawnSync(process.execPath, [installedLauncher, '--format', UNUSUAL_ARGUMENT], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  check(
    'the launcher passes arguments through unchanged',
    argumentRun.status === 2 && argumentRun.stderr.includes(`"${UNUSUAL_ARGUMENT}"`),
    describe(argumentRun),
  );
}

// Without the optional dependency the launcher explains instead of crashing
function checkMissingPlatformPackage(workDir, launcherTarball) {
  const bareProjectDir = join(workDir, 'project-without-binary');
  installOffline(bareProjectDir, [launcherTarball], ['--omit=optional']);
  const missingRun = runCommand(installedCommand(bareProjectDir), ['--version'], bareProjectDir);
  check(
    'a missing platform package exits 2 with an explanation',
    missingRun.status === 2 && missingRun.stderr.includes(`no prebuilt binary for ${platform}`),
    describe(missingRun),
  );
}

function main() {
  const binary = readBinaryArgument();
  const version = readCargoVersion();
  const workDir = mkdtempSync(join(tmpdir(), 'flashtrace-npm-smoke-'));
  console.log(`Smoke-testing ${platformPackage} ${version} with ${binary}`);

  checkPlatformPackageNames();
  const tarballs = stageAndPack(workDir, binary, version);
  const projectDir = join(workDir, 'project');
  const installedLauncher = installAndResolve(projectDir, tarballs, version);
  checkInstalledCommand(workDir, projectDir, version);
  checkArgumentPassing(projectDir, installedLauncher);
  checkMissingPlatformPackage(workDir, tarballs.launcherTarball);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed; the staged packages remain in ${workDir}\n`);
    for (const failure of failures) console.error(`${failure}\n`);
    process.exit(1);
  }
  rmSync(workDir, { recursive: true, force: true });
  console.log('\nAll checks passed.');
}

main();
