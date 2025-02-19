import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { rm } from 'fs/promises';
import { promisify } from 'util';
import { rimraf } from 'rimraf';
import { afterDiflow, beforeDiflow, createTestCommit, getTestRepoPath, initTestRepos } from './testrepo';
import { Processor } from './processor';
import { execAsync } from './tools';

describe('Git Repository Tests', () => {
  beforeEach(async () => {
    await initTestRepos();
  });

  test('Adding new files', async () => {
    // Add new file in diff repo
    await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'newfile.txt'))).toBe(true);
    expect(await fs.readFile(path.join(getTestRepoPath('merged'), 'newfile.txt'), 'utf8')).toBe('new content');
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'newfile.txt'))).toBe(false);
  });

  test('Removing files', async () => {
    // Remove file in diff repo
    await fs.unlink(path.join(getTestRepoPath('diff'), 'file1.txt'));
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Remove file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'file1.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'file1.txt'))).toBe(true);
    expect(await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8')).toBe('base content');
  });

  test('Changing files', async () => {
    // Modify file in diff repo
    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'modified content');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Modify file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    const baseContent = await fs.readFile(path.join(getTestRepoPath('base'), 'file1.txt'), 'utf8');
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'utf8');
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8');

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
