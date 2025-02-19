import * as fs from 'fs-extra';
import * as path from 'path';
import { afterDiflow, beforeDiflow, createTestCommit, getTestRepoPath, initTestRepos } from './testrepo';
import { Processor } from './processor';
import { execAsync, sleep } from './tools';

describe('Git Repository Tests', () => {
  beforeEach(async () => {
    await initTestRepos();
  });

  test('Adding new files', async () => {
    console.log('BEGIN TEST: Adding new files');

    // await sleep(2000);

    // Add new file in diff repo
    await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    console.log('BEGIN PROCESSOR: Adding new files');
    await processor.process();
    console.log('END PROCESSOR: Adding new files');

    await afterDiflow();

    const mergedExists = await fs.exists(path.join(getTestRepoPath('merged'), 'newfile.txt'));
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'newfile.txt'), 'utf8');
    const baseExists = await fs.exists(path.join(getTestRepoPath('base'), 'newfile.txt'));

    console.log('END TEST: Adding new files');

    // Verify changes
    expect(mergedExists).toBe(true);
    expect(mergedContent).toBe('new content');
    expect(baseExists).toBe(false);
  });

  test('Removing files', async () => {
    console.log('BEGIN TEST: Remove files');

    // await sleep(2000);
    // Remove file in diff repo
    await fs.unlink(path.join(getTestRepoPath('diff'), 'file1.txt'));
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Remove file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    console.log('BEGIN PROCESSOR: Removing files');
    await processor.process();
    console.log('END PROCESSOR: Removing files');

    await afterDiflow();

    const mergedExists = await fs.exists(path.join(getTestRepoPath('merged'), 'file1.txt'));
    const baseExists = await fs.exists(path.join(getTestRepoPath('base'), 'file1.txt'));
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8');

    console.log('END TEST: Remove files');

    // Verify changes
    expect(mergedExists).toBe(true);
    expect(baseExists).toBe(true);
    expect(mergedContent).toBe('base content');
  });

  test('Changing files', async () => {
    console.log('BEGIN TEST: Changing files');

    // await sleep(2000);

    // Modify file in diff repo
    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'modified content');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Modify file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
    console.log('BEGIN PROCESSOR: Changing files');
    await processor.process();
    console.log('END PROCESSOR: Changing files');

    await afterDiflow();

    // Verify changes
    const baseContent = await fs.readFile(path.join(getTestRepoPath('base'), 'file1.txt'), 'utf8');
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'utf8');
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8');

    console.log('END TEST: Changing files');

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
