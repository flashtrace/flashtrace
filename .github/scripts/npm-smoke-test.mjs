// Installs the npm packages the way a user gets them and runs the installed
// CLI: the platform package of this machine receives the given binary, both
// it and the launcher are packed, the tarballs install offline into an empty
// project, and the installed command runs a fixed set of invocations whose
// output is compared against the e2e snapshots. Nothing touches the registry
// and nothing in the checkout changes; the work happens in a temp directory.
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

function readCargoVersion() {
  const manifest = readFileSync(join(repositoryRoot, 'Cargo.toml'), 'utf8');
  const version = manifest.match(/^version = "(.*)"$/m)?.[1];
  if (!version) throw new Error('Cargo.toml carries no package version');
  return version;
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

function pack(packageDir, destination) {
  const [packed] = JSON.parse(npm(['pack', '--json', '--pack-destination', destination], packageDir));
  return { tarball: join(destination, packed.filename), files: packed.files };
}

function installOffline(projectDir, tarballs, extraArgs = []) {
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, 'package.json'), '{ "name": "smoke-test-project", "private": true }\n');
  npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...extraArgs, ...tarballs], projectDir);
}

// The same normalization tests/e2e.rs applies: Windows prints backslash
// paths, and the JSON report's version field bumps every release.
function normalize(output) {
  return output.replaceAll('\\', '/').replace(/^( {2}"flashtrace": ")[^"]*"/m, '$1<version>"');
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

// S1: stage copies of both packages, the binary in the platform package's
// bin/, and pack them
function stageAndPack(workDir, binary, version) {
  const launcherDir = join(workDir, 'stage', 'launcher');
  const platformDir = join(workDir, 'stage', 'platform');
  const tarballDir = join(workDir, 'tarballs');
  cpSync(join(repositoryRoot, 'npm', 'flashtrace'), launcherDir, { recursive: true });
  cpSync(join(repositoryRoot, 'npm', '@flashtrace', platform), platformDir, { recursive: true });
  copyFileSync(binary, join(platformDir, 'bin', binaryName));
  if (!isWindows) chmodSync(join(platformDir, 'bin', binaryName), 0o755);
  setManifestVersions(launcherDir, version, true);
  setManifestVersions(platformDir, version, false);
  mkdirSync(tarballDir);
  const launcher = pack(launcherDir, tarballDir);
  const platformPacked = pack(platformDir, tarballDir);

  const packedBinary = platformPacked.files.find((file) => file.path === `bin/${binaryName}`);
  check(`S1 the platform tarball contains bin/${binaryName}`, packedBinary !== undefined);
  if (!isWindows) {
    const mode = packedBinary?.mode ?? 0;
    check('S1 the packed binary is executable', (mode & 0o111) === 0o111, `mode ${mode.toString(8)}`);
  }
  return { launcherTarball: launcher.tarball, platformTarball: platformPacked.tarball };
}

// S2-S3: install both tarballs into an empty project without the registry,
// and the launcher resolves the installed platform package to the binary.
// The five other platform packages stay unresolved optional entries, so
// `npm ls` would fail here by design and is not the check.
function installAndResolve(projectDir, tarballs, version) {
  installOffline(projectDir, [tarballs.launcherTarball, tarballs.platformTarball]);
  check('S2 both tarballs install offline into an empty project', true);

  const installedLauncher = join(projectDir, 'node_modules', 'flashtrace', 'bin', 'flashtrace.js');
  const installedManifest = JSON.parse(
    readFileSync(join(projectDir, 'node_modules', '@flashtrace', platform, 'package.json'), 'utf8'),
  );
  check(`S3 ${platformPackage} is installed at ${version}`, installedManifest.version === version, `found ${installedManifest.version}`);
  let resolvedBinary = null;
  try {
    resolvedBinary = createRequire(installedLauncher).resolve(`${platformPackage}/bin/${binaryName}`);
  } catch {
    // reported by the check below
  }
  check('S3 the launcher resolves the installed binary', resolvedBinary !== null);
  if (!isWindows && resolvedBinary) {
    check('S3 the installed binary is executable', (statSync(resolvedBinary).mode & 0o111) === 0o111);
  }
  return installedLauncher;
}

// R1-R7 run the command npm installed, from a fresh copy of an example where
// the run needs a project
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
    `R1 --version prints ${version}`,
    versionRun.status === 0 && versionRun.stdout === `${version}\n` && versionRun.stderr === '',
    describe(versionRun),
  );

  const helpRun = runInstalled(['--help']);
  check('R2 --help prints the usage', helpRun.status === 0 && helpRun.stdout.length > 0, describe(helpRun));

  const snapshotRuns = [
    ['R3 a clean project', 'basic', [], 0, 'basic.default'],
    ['R4 the JSON report', 'basic', ['--json'], 0, 'basic.json'],
    ['R5 a project with defects', 'diagnostics', [], 1, 'diagnostics.default'],
    ['R6 an option with a value', 'polyglot-web', ['--tags', 'web,data'], 0, 'polyglot-web.tags'],
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
    'R7 an unknown option exits 2 with the error on stderr',
    usageRun.status === 2 && usageRun.stdout === '' && usageRun.stderr.startsWith('error: unknown option'),
    describe(usageRun),
  );
}

// R8 runs the launcher directly: Node quotes the arguments of both spawns,
// and only the launcher's own spawn is this repository's code - npm's
// Windows .cmd shim is not
function checkArgumentPassing(projectDir, installedLauncher) {
  const argumentRun = spawnSync(process.execPath, [installedLauncher, '--format', UNUSUAL_ARGUMENT], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  check(
    'R8 the launcher passes arguments through unchanged',
    argumentRun.status === 2 && argumentRun.stderr.includes(`"${UNUSUAL_ARGUMENT}"`),
    describe(argumentRun),
  );
}

// R9: without the optional dependency the launcher explains instead of
// crashing
function checkMissingPlatformPackage(workDir, launcherTarball) {
  const bareProjectDir = join(workDir, 'project-without-binary');
  installOffline(bareProjectDir, [launcherTarball], ['--omit=optional']);
  const missingRun = runCommand(installedCommand(bareProjectDir), ['--version'], bareProjectDir);
  check(
    'R9 a missing platform package exits 1 with an explanation',
    missingRun.status === 1 && missingRun.stderr.includes(`no prebuilt binary for ${platform}`),
    describe(missingRun),
  );
}

function main() {
  const binary = readBinaryArgument();
  const version = readCargoVersion();
  const workDir = mkdtempSync(join(tmpdir(), 'flashtrace-npm-smoke-'));
  console.log(`Smoke-testing ${platformPackage} ${version} with ${binary}`);

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
