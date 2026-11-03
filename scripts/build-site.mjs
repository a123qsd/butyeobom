import { mkdir, copyFile, lstat, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRelease } from './check-release.mjs';

export async function buildSite(root, destination) {
  const source = resolve(root);
  const target = resolve(destination);
  if (target === source || relative(target, source).split(sep)[0] !== '..') throw new Error('Destination cannot contain the source');
  const existing = await lstat(target).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) throw new Error('Destination already exists; choose a fresh output directory');
  const { manifest, hashes } = await inspectRelease(source);
  await mkdir(target, { recursive: true });
  try {
    for (const file of manifest.websiteFiles) {
      const to = resolve(target, file);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(resolve(source, file), to);
      const actual = createHash('sha256').update(await readFile(to)).digest('hex');
      if (actual !== hashes[file]) throw new Error(`Build content changed after review: ${file}`);
    }
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
  return [...manifest.websiteFiles];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files = await buildSite(root, resolve(root, '_site'));
    process.stdout.write(`Built ${files.length} approved static files in _site.\n`);
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
