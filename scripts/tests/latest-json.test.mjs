// The update manifest written by scripts/release/latest-json.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestJson, plainNotes } from '../release/latest-json.mjs';

const GENERATED = `<!-- Release notes generated using configuration in .github/release.yml at main -->

## What's Changed
* Add a filter bar to the table browser by @haryosmd in https://github.com/haryosmd/berth-studio/pull/7
* Build(deps): Bump actions/setup-node from 7.0.0 to 7.1.0 by @dependabot[bot] in https://github.com/haryosmd/berth-studio/pull/1


**Full Changelog**: https://github.com/haryosmd/berth-studio/compare/v0.1.0...v0.2.0`;

test('generated release notes become plain text', () => {
  assert.equal(plainNotes(GENERATED), [
    "What's Changed",
    '- Add a filter bar to the table browser',
    '- Build(deps): Bump actions/setup-node from 7.0.0 to 7.1.0',
  ].join('\n'));
});

test('both Mac architectures point at the universal package', () => {
  const url = 'https://github.com/haryosmd/berth-studio/releases/download/v0.2.0/Berth-Studio_0.2.0_universal.app.tar.gz';
  const m = latestJson({ version: '0.2.0', signature: 'c2lnbmF0dXJl\n', url, notes: '', date: new Date('2026-10-20T09:00:00.123Z') });
  assert.equal(m.pub_date, '2026-10-20T09:00:00Z');
  assert.deepEqual(m.platforms['darwin-aarch64'], { signature: 'c2lnbmF0dXJl', url });
  assert.deepEqual(m.platforms['darwin-x86_64'], m.platforms['darwin-aarch64']);
});

test('bad input is refused rather than published', () => {
  const ok = { version: '0.2.0', signature: 'x', url: 'https://example.com/a.tar.gz', notes: '' };
  assert.throws(() => latestJson({ ...ok, version: 'v0.2.0' }), /not a release version/);
  assert.throws(() => latestJson({ ...ok, url: 'http://example.com/a.tar.gz' }), /https/);
  assert.throws(() => latestJson({ ...ok, signature: '  ' }), /empty/);
});
