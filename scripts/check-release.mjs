import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const forbiddenContent = [
  ['local account path', /(?:\/(?:Users|home)\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+)/],
  ['email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['credential-shaped text', /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error('Unsupported release manifest');
  for (const key of ['repositoryFiles', 'websiteFiles']) {
    const files = manifest[key];
    if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw new Error(`Invalid ${key} list`);
    for (const file of files) {
      if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file) || file.split('/').some(part => part === '.' || part === '..')) throw new Error(`Unsafe path in ${key}`);
      if (file.split('/').some(part => part.startsWith('.') && !['.gitignore', '.nojekyll'].includes(part))) throw new Error(`Hidden file excluded from ${key}`);
      if (/(?:^|\/)(?:node_modules|output|logs?|profiles?|docs)(?:\/|$)|\.(?:log|png|jpe?g|webp|zip|env)$/i.test(file)) throw new Error(`Private artifact excluded from ${key}`);
    }
  }
  if (!manifest.repositoryFiles.includes('publish-manifest.json')) throw new Error('Manifest must include itself');
  if (!manifest.repositoryFiles.includes('LICENSE')) throw new Error('Release must include LICENSE');
  if (!manifest.websiteFiles.every(file => manifest.repositoryFiles.includes(file))) throw new Error('Website files must be a subset of repository files');
  return manifest;
}

export async function inspectRelease(root, { staged = false } = {}) {
  const directory = await realpath(root);
  const manifestPath = resolve(directory, 'publish-manifest.json');
  if (!(await lstat(manifestPath)).isFile() || (await lstat(manifestPath)).isSymbolicLink()) throw new Error('Manifest must be a regular file');
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const hashes = {};
  for (const file of manifest.repositoryFiles) {
    let path = directory;
    for (const part of file.split('/')) {
      path = resolve(path, part);
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Symlink excluded: ${file}`);
    }
    const info = await lstat(path);
    if (!info.isFile() || info.size > 1_000_000) throw new Error(`Invalid release file: ${file}`);
    const resolved = await realpath(path);
    const within = relative(directory, resolved);
    if (within === '..' || within.startsWith(`..${sep}`)) throw new Error(`Path escapes release: ${file}`);
    const bytes = await readFile(path);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (const [category, pattern] of forbiddenContent) {
      if (pattern.test(content)) throw new Error(`Release scan failed: ${file} (${category})`);
    }
    hashes[file] = createHash('sha256').update(bytes).digest('hex');
  }
  if (staged) {
    const index = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const entry of index) {
      const match = entry.match(/^([0-7]{6}) [a-f0-9]+ ([0-3])\t(.+)$/);
      if (!match || match[1] !== '100644' || match[2] !== '0') throw new Error('Git index must contain only regular, non-executable files without conflicts');
    }
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: directory, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
    if (JSON.stringify(tracked) !== JSON.stringify([...manifest.repositoryFiles].sort())) throw new Error('Git index does not exactly match release manifest');
    for (const file of tracked) {
      const bytes = execFileSync('git', ['show', `:${file}`], { cwd: directory });
      if (createHash('sha256').update(bytes).digest('hex') !== hashes[file]) throw new Error(`Unstaged content differs: ${file}`);
    }
  }
  return { manifest, hashes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { manifest, hashes } = await inspectRelease(fileURLToPath(new URL('../', import.meta.url)), { staged: process.argv.includes('--staged') });
    process.stdout.write(JSON.stringify({ repositoryFiles: manifest.repositoryFiles.length, websiteFiles: manifest.websiteFiles.length, sha256: hashes }, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
