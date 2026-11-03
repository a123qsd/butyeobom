import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { inspectRelease, validateManifest } from '../scripts/check-release.mjs';
import { buildSite } from '../scripts/build-site.mjs';

const baseManifest = () => ({
  schemaVersion: 1,
  repositoryFiles: ['LICENSE', 'index.html', 'src/app.js', 'publish-manifest.json'],
  websiteFiles: ['LICENSE', 'index.html', 'src/app.js'],
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'butyeobom-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = baseManifest();
  for (const file of manifest.repositoryFiles) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), `Fictional public fixture: ${file}\n`);
  }
  await writeFile(join(root, 'publish-manifest.json'), JSON.stringify(manifest));
  return { root, manifest };
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'unused-global-config') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function stagedFixture(t) {
  const value = await fixture(t);
  git(value.root, 'init', '--quiet');
  git(value.root, 'add', '--', ...value.manifest.repositoryFiles);
  return value;
}

test('manifest rejects unsafe paths, private artifacts, duplicates, and unlisted website files', () => {
  assert.deepEqual(validateManifest(baseManifest()), baseManifest());
  for (const path of ['../private.txt', './index.html', ['', 'absolute.txt'].join('/'), 'src/../../private.txt', 'src\\private.txt', '.env', '.git/config', 'docs/private.md', 'output/capture.png', 'profile/session.txt', 'records.log']) {
    const manifest = baseManifest();
    manifest.repositoryFiles.push(path);
    assert.throws(() => validateManifest(manifest), undefined, `accepted ${path}`);
  }
  const duplicate = baseManifest();
  duplicate.repositoryFiles.push('LICENSE');
  assert.throws(() => validateManifest(duplicate));
  const missing = baseManifest();
  missing.websiteFiles.push('unlisted.txt');
  assert.throws(() => validateManifest(missing));
  for (const required of ['LICENSE', 'publish-manifest.json']) {
    const manifest = baseManifest();
    manifest.repositoryFiles = manifest.repositoryFiles.filter(file => file !== required);
    manifest.websiteFiles = manifest.websiteFiles.filter(file => file !== required);
    assert.throws(() => validateManifest(manifest));
  }
});

test('release inspection hashes exactly the approved files without scanning unrelated workspace files', async t => {
  const { root, manifest } = await fixture(t);
  await writeFile(join(root, 'private-work-note.txt'), 'Not approved for publication.');
  const result = await inspectRelease(root);
  assert.deepEqual(result.manifest, manifest);
  assert.deepEqual(Object.keys(result.hashes).sort(), [...manifest.repositoryFiles].sort());
  for (const file of manifest.repositoryFiles) {
    assert.equal(result.hashes[file], createHash('sha256').update(await readFile(join(root, file))).digest('hex'));
  }
});

test('release inspection rejects symlink files, directory ancestors, and the manifest itself', async t => {
  for (const kind of ['file', 'directory', 'manifest']) {
    const { root } = await fixture(t);
    if (kind === 'directory') {
      await mkdir(join(root, 'alternate'));
      await writeFile(join(root, 'alternate/app.js'), 'Fictional fixture.');
      await rm(join(root, 'src'), { recursive: true });
      await symlink('alternate', join(root, 'src'));
    } else {
      const name = kind === 'manifest' ? 'publish-manifest.json' : 'LICENSE';
      await writeFile(join(root, 'alternate.txt'), await readFile(join(root, name)));
      await rm(join(root, name));
      await symlink('alternate.txt', join(root, name));
    }
    await assert.rejects(inspectRelease(root), /Symlink|regular file/);
  }
});

test('release content scan refuses synthetic contacts, local paths, credentials, and keys without echoing them', async t => {
  const examples = [
    ['email address', ['fictional', '@', 'example.test'].join('')],
    ['local account path', ['', 'Users', 'fictional-account', 'note.txt'].join('/')],
    ['local account path', ['C:', 'Users', 'fictional-account', 'note.txt'].join('\\')],
    ['credential-shaped text', ['gh', 'p_', 'a'.repeat(30)].join('')],
    ['credential-shaped text', ['github', '_pat_', 'b'.repeat(30)].join('')],
    ['credential-shaped text', ['sk', '-', 'c'.repeat(30)].join('')],
    ['credential-shaped text', ['AK', 'IA', 'A'.repeat(16)].join('')],
    ['private key', ['-----BEGIN ', 'PRIVATE', ' KEY-----'].join('')],
  ];
  for (const [category, content] of examples) {
    const { root } = await fixture(t);
    await writeFile(join(root, 'src/app.js'), content);
    await assert.rejects(inspectRelease(root), error => {
      assert.ok(error.message.includes(category));
      assert.ok(error.message.includes('src/app.js'));
      assert.ok(!error.message.includes(content));
      return true;
    });
  }
});

test('release inspection rejects missing, oversized, and non-UTF-8 files', async t => {
  for (const kind of ['missing', 'oversized', 'binary']) {
    const { root } = await fixture(t);
    const path = join(root, 'src/app.js');
    if (kind === 'missing') await rm(path);
    if (kind === 'oversized') await writeFile(path, 'x'.repeat(1_000_001));
    if (kind === 'binary') await writeFile(path, Buffer.from([0xff, 0xfe]));
    await assert.rejects(inspectRelease(root));
  }
});

test('staged inspection requires exact files and exact reviewed bytes', async t => {
  const { root } = await stagedFixture(t);
  await inspectRelease(root, { staged: true });
  await writeFile(join(root, 'unexpected.txt'), 'Fictional extra file.');
  git(root, 'add', '--', 'unexpected.txt');
  await assert.rejects(inspectRelease(root, { staged: true }), /index/);
  git(root, 'rm', '--cached', '--', 'unexpected.txt');
  await writeFile(join(root, 'src/app.js'), 'Changed after staging.');
  await assert.rejects(inspectRelease(root, { staged: true }), /Unstaged content/);
});

test('staged inspection rejects symlink modes even when regular working-file bytes match', async t => {
  const { root } = await stagedFixture(t);
  const object = git(root, 'hash-object', 'src/app.js').trim();
  git(root, 'update-index', '--cacheinfo', `120000,${object},src/app.js`);
  await assert.rejects(inspectRelease(root, { staged: true }), /mode|regular|Symlink|symlink/i);
});

test('site build copies only approved website files and refuses existing destinations', async t => {
  const { root, manifest } = await fixture(t);
  await writeFile(join(root, 'private-work-note.txt'), 'Not approved for publication.');
  const target = join(root, '_site');
  assert.deepEqual(await buildSite(root, target), manifest.websiteFiles);
  async function list(directory, prefix = '') {
    const paths = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) paths.push(...await list(join(directory, entry.name), `${name}/`));
      else paths.push(name);
    }
    return paths.sort();
  }
  assert.deepEqual(await list(target), [...manifest.websiteFiles].sort());
  for (const file of manifest.websiteFiles) assert.deepEqual(await readFile(join(target, file)), await readFile(join(root, file)));
  await assert.rejects(buildSite(root, target), /already exists/);
  await assert.rejects(buildSite(root, root), /contain the source/);
  await assert.rejects(buildSite(root, dirname(root)), /contain the source/);
});

test('site build refuses bytes changed after release inspection', async t => {
  const { root } = await fixture(t);
  const target = join(root, '_site');
  const originalCopy = fsPromises.copyFile;
  let replaced = false;
  fsPromises.copyFile = async (source, destination, ...options) => {
    if (source === join(root, 'index.html')) {
      replaced = true;
      await writeFile(source, 'Fictional content changed after the inspection.');
    }
    return originalCopy(source, destination, ...options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(buildSite(root, target), /changed|hash|mismatch|reviewed/i);
    assert.equal(replaced, true, 'the test must exercise a change between inspection and copy');
  } finally {
    fsPromises.copyFile = originalCopy;
    syncBuiltinESMExports();
  }
});
