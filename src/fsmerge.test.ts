import * as fs from 'fs-extra';
import * as path from 'path';
import { rimraf } from 'rimraf';
import { filesystemMerge } from './fsmerge';

const workDir = path.join(__dirname, 'fsmergetest');
const baseDir = path.join(workDir, 'base');
const diffDir = path.join(workDir, 'diff');
const mergedDir = path.join(workDir, 'merged');

async function writeFile(dir: string, relativePath: string, content: string) {
  const file = path.join(dir, relativePath);
  await fs.ensureDir(path.dirname(file));
  await fs.writeFile(file, content);
}

function readMerged(relativePath: string) {
  return fs.readFileSync(path.join(mergedDir, relativePath), 'utf8');
}

describe('Filesystem merge tests', () => {
  beforeEach(async () => {
    await rimraf(workDir);
    await fs.ensureDir(baseDir);
    await fs.ensureDir(diffDir);
  });

  afterAll(async () => {
    await rimraf(workDir);
  });

  test('Copies base and diff files', async () => {
    await writeFile(baseDir, 'file1.txt', 'base file1');
    await writeFile(baseDir, 'sub/file2.txt', 'base file2');
    await writeFile(diffDir, 'sub/file3.txt', 'diff file3');

    await filesystemMerge(baseDir, diffDir, mergedDir);

    expect(readMerged('file1.txt')).toEqual('base file1');
    expect(readMerged('sub/file2.txt')).toEqual('base file2');
    expect(readMerged('sub/file3.txt')).toEqual('diff file3');
  });

  test('Diff overrides base', async () => {
    await writeFile(baseDir, 'sub/file1.txt', 'base file1');
    await writeFile(diffDir, 'sub/file1.txt', 'diff file1');

    await filesystemMerge(baseDir, diffDir, mergedDir);

    expect(readMerged('sub/file1.txt')).toEqual('diff file1');
  });

  test('Overwrites content from previous run', async () => {
    await writeFile(baseDir, 'file1.txt', 'base file1');
    await filesystemMerge(baseDir, diffDir, mergedDir);

    await writeFile(baseDir, 'file1.txt', 'base file1 changed');
    await filesystemMerge(baseDir, diffDir, mergedDir);

    expect(readMerged('file1.txt')).toEqual('base file1 changed');
  });

  test('Skips node_modules and .git', async () => {
    await writeFile(baseDir, '.git/config', 'git config');
    await writeFile(baseDir, 'node_modules/pkg/index.js', 'module');
    await writeFile(baseDir, 'packages/api/node_modules/pkg/index.js', 'module');
    await writeFile(diffDir, '.git/config', 'git config');

    await filesystemMerge(baseDir, diffDir, mergedDir);

    expect(fs.existsSync(path.join(mergedDir, '.git'))).toBeFalsy();
    expect(fs.existsSync(path.join(mergedDir, 'node_modules'))).toBeFalsy();
    expect(fs.existsSync(path.join(mergedDir, 'packages/api/node_modules'))).toBeFalsy();
  });

  test('Skips .git when called with relative paths', async () => {
    await writeFile(baseDir, '.git/config', 'git config');
    await writeFile(baseDir, 'file1.txt', 'base file1');

    const cwd = process.cwd();
    try {
      process.chdir(workDir);
      await filesystemMerge('./base', './diff', './merged');
    } finally {
      process.chdir(cwd);
    }

    expect(readMerged('file1.txt')).toEqual('base file1');
    expect(fs.existsSync(path.join(mergedDir, '.git'))).toBeFalsy();
  });
});
