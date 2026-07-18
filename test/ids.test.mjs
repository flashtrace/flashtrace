import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalId,
  canonicalRev,
  compareRev,
  isWildcardRev,
  parseCoverEntry,
  parseNeedEntry,
  revMatches,
} from '../src/ids.mjs';

test('canonicalRev pads omitted layers with zeros', () => {
  assert.equal(canonicalRev('2'), '2.0.0');
  assert.equal(canonicalRev('2.4'), '2.4.0');
  assert.equal(canonicalRev('2.4.1'), '2.4.1');
});

test('canonicalRev drops leading zeros per layer', () => {
  assert.equal(canonicalRev('02.04.010'), '2.4.10');
});

test('canonicalId canonicalizes only the revision', () => {
  assert.equal(canonicalId('req:auth/login#2.4'), 'req:auth/login#2.4.0');
});

test('revMatches treats SemVer-equal revisions as equal', () => {
  assert.equal(revMatches('3.7', '3.7.0'), true);
  assert.equal(revMatches('3.7.0', '3.7'), true);
  assert.equal(revMatches('1', '1.0.0'), true);
  assert.equal(revMatches('3.7', '3.7.1'), false);
});

test('a trailing wildcard extends over the deeper layers', () => {
  assert.equal(revMatches('2.x', '2'), true);
  assert.equal(revMatches('2.x', '2.4'), true);
  assert.equal(revMatches('2.x', '2.4.1'), true);
  assert.equal(revMatches('2.x', '3.0'), false);
  assert.equal(revMatches('2.3.x', '2.3.7'), true);
  assert.equal(revMatches('2.3.x', '2.3'), true);
  assert.equal(revMatches('2.3.x', '2.4.0'), false);
});

test('x and its alias * match every revision', () => {
  for (const pattern of ['x', '*']) {
    assert.equal(revMatches(pattern, '2'), true);
    assert.equal(revMatches(pattern, '4.1'), true);
    assert.equal(revMatches(pattern, '3.0.9'), true);
  }
  assert.equal(revMatches('5.*', '5.9.2'), true);
  assert.equal(revMatches('5.*', '6'), false);
});

test('isWildcardRev recognizes x and * layers', () => {
  assert.equal(isWildcardRev('2.x'), true);
  assert.equal(isWildcardRev('2.*'), true);
  assert.equal(isWildcardRev('*'), true);
  assert.equal(isWildcardRev('2.4.0'), false);
});

test('compareRev orders SemVer-equal revisions as equal', () => {
  assert.equal(compareRev('2.4', '2.4.0'), 0);
  assert.ok(compareRev('2.9', '2.10') < 0);
  assert.ok(compareRev('2.4.1', '2.4') > 0);
});

test('parseNeedEntry accepts the wildcard shapes, parseCoverEntry none', () => {
  for (const rev of ['x', '*', '2.x', '2.*', '2.3.x', '2.3.*']) {
    assert.equal(parseNeedEntry(`impl:a#${rev}`, 'req:owner#1'), `impl:a#${rev}`, rev);
    assert.equal(parseCoverEntry(`impl:a#${rev}`, 'req:owner#1'), null, rev);
  }
});

test('the dropped multi-wildcard shapes are no revisions', () => {
  for (const rev of ['2.x.y', 'x.y', 'x.y.z', '2.x.x', 'x.2']) {
    assert.equal(parseNeedEntry(`impl:a#${rev}`, 'req:owner#1'), null, rev);
  }
});
