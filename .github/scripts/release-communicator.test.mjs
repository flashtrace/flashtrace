import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Exercise the actual inline workflow with GitHub replaced by a strict mock.
// No credentials, checkout of PR code, or network calls are needed.
const workflow = readFileSync(new URL('../workflows/release-communicator.yml', import.meta.url), 'utf8')
  .replaceAll('\r\n', '\n');
const runBlocks = workflow.split('        run: |\n');
if (runBlocks.length !== 2) {
  throw new Error(`expected one inline workflow script, found ${runBlocks.length - 1}`);
}
const script = runBlocks[1].replace(/^ {10}/gm, '');
const bash = process.platform === 'win32'
  ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
  : 'bash';

const githubMock = String.raw`
gh() {
  case "$*" in
    api\ repos/example/flashtrace/contents/Cargo.toml?ref=main*)
      if [ "$TEST_MANIFEST_FAILURE" = true ]; then
        echo 'manifest API failed' >&2
        return 1
      fi
      printf '%s' "$TEST_MANIFEST" | base64
      ;;
    api\ repos/example/flashtrace/commits/*/pulls*)
      printf '%s' "$TEST_MERGED_LABELS"
      ;;
    release\ list*) ;;
    pr\ list*)
      case "$*" in *--state\ open*) printf '104\n' ;; esac
      ;;
    pr\ view\ 104*) printf '%s' "$TEST_LABELS" ;;
    api\ repos/example/flashtrace/issues/104/comments*)
      printf '%s' "$TEST_COMMENT_ID"
      ;;
    api\ --silent\ --method\ POST*|api\ --silent\ --method\ PATCH*)
      for argument in "$@"; do last_argument=$argument; done
      printf '%s\n' "$last_argument"
      ;;
    *) echo "Unexpected GitHub call: $*" >&2; return 1 ;;
  esac
}
`;

function communicate(environment = {}) {
  const result = spawnSync(bash, ['--noprofile', '--norc', '-s'], {
    input: githubMock + script,
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      GH_TOKEN: '',
      REPO: 'example/flashtrace',
      EVENT_PR: '104',
      GITHUB_SHA: 'merge-commit',
      TEST_MANIFEST: '[package]\nname = "flashtrace"\nversion = "1.2.3"\n',
      TEST_MANIFEST_FAILURE: 'false',
      TEST_LABELS: '',
      TEST_MERGED_LABELS: '',
      TEST_COMMENT_ID: '',
      ...environment,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

// pull_request_target hands secrets and a write token to the run, so the
// workflow must never fetch or execute the PR's code.
test('never checks out or references PR code under pull_request_target', () => {
  assert.match(workflow, /^  pull_request_target:$/m);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head|github\.head_ref/);
});

test('a Rust-only main still rejects an unlabeled PR and posts its warning', () => {
  const result = communicate();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /body=.*release-communicator/s);
  assert.match(result.stdout, /A release label is required/);
  assert.match(result.stdout, /Missing release label on PR\(s\): #104/);
});

for (const [level, version] of [['major', '2.0.0'], ['minor', '1.3.0'], ['patch', '1.2.4']]) {
  test(`previews a ${level} release from Cargo.toml`, () => {
    const result = communicate({ TEST_LABELS: `release:${level}` });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(`version **1.2.3** will (most likely) be bumped to **${version}**`));
  });
}

test('release:none updates the existing comment without requiring a release', () => {
  const result = communicate({ TEST_LABELS: 'release:none', TEST_COMMENT_ID: '456' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /will \*\*not\*\* trigger a release/);
  assert.match(result.stdout, /version stays at \*\*1\.2\.3\*\*/);
});

test('a push anticipates the merged release when refreshing PR previews', () => {
  const result = communicate({ EVENT_PR: '', TEST_MERGED_LABELS: 'release:minor', TEST_LABELS: 'release:patch' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /version \*\*1\.3\.0\*\* will .* bumped to \*\*1\.3\.1\*\*/);
});

test('a push warns about unlabeled PRs without failing main', () => {
  const result = communicate({ EVENT_PR: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Missing release label on PR\(s\): #104/);
});

test('a missing or unreadable manifest fails before posting a preview', () => {
  const result = communicate({ TEST_MANIFEST_FAILURE: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest API failed/);
  assert.doesNotMatch(result.stdout, /body=/);
});

for (const version of ['', 'invalid', '1.2.3-preview.1']) {
  test(`rejects a missing or unsupported package version: ${JSON.stringify(version)}`, () => {
    const result = communicate({ TEST_MANIFEST: `[package]\nversion = "${version}"\n` });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Expected a major.minor.patch package version/);
    assert.doesNotMatch(result.stdout, /body=/);
  });
}
