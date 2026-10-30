import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import semver from 'semver';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

test('npm peers accept the verified official prereleases without accepting future prerelease lines', () => {
  const range = pkg.peerDependencies['@deepseek-ai/dsh'];
  assert.equal(pkg.engines.dsh, range);
  // npm excludes prereleases by default; the host's includePrerelease check alone
  // cannot prove that installing this plugin beside the official host succeeds.
  for (const version of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.5']) {
    assert.ok(semver.satisfies(version, range), `npm must accept ${version}`);
    assert.ok(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }));
  }
  for (const version of ['0.1.5-rc.2', '0.2.0-rc.1', '0.2.2-alpha.2', '0.3.0-rc.1', '0.3.0']) {
    assert.equal(semver.satisfies(version, range), false, `npm must exclude ${version}`);
  }
  assert.deepEqual(lock.packages[''].peerDependencies, pkg.peerDependencies);
  assert.deepEqual(lock.packages[''].engines, pkg.engines);
});
