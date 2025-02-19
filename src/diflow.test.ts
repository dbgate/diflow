import * as fs from 'fs-extra';
import * as path from 'path';
import {
  afterDiflow,
  beforeDiflow,
  checkStateInConfig,
  createTestCommit,
  getTestRepoPath,
  initTestRepos,
} from './testrepo';
import { Processor } from './processor';
import { execAsync, sleep } from './tools';

describe('Git Repository Tests', () => {
  beforeEach(async () => {
    await initTestRepos();
  });

  test('Adding new files', async () => {
    await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    const mergedExists = await fs.exists(path.join(getTestRepoPath('merged'), 'newfile.txt'));
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'newfile.txt'), 'utf8');
    const baseExists = await fs.exists(path.join(getTestRepoPath('base'), 'newfile.txt'));

    await checkStateInConfig();

    // Verify changes
    expect(mergedExists).toBe(true);
    expect(mergedContent).toBe('new content');
    expect(baseExists).toBe(false);
  });

  test('Removing files', async () => {
    await fs.unlink(path.join(getTestRepoPath('diff'), 'file1.txt'));
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Remove file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    const mergedExists = await fs.exists(path.join(getTestRepoPath('merged'), 'file1.txt'));
    const baseExists = await fs.exists(path.join(getTestRepoPath('base'), 'file1.txt'));
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8');

    await checkStateInConfig();

    // Verify changes
    expect(mergedExists).toBe(true);
    expect(baseExists).toBe(true);
    expect(mergedContent).toBe('base content');
  });

  test('Changing files', async () => {
    // await sleep(2000);

    // Modify file in diff repo
    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'modified content');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Modify file1.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    const baseContent = await fs.readFile(path.join(getTestRepoPath('base'), 'file1.txt'), 'utf8');
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'file1.txt'), 'utf8');
    const mergedContent = await fs.readFile(path.join(getTestRepoPath('merged'), 'file1.txt'), 'utf8');

    await checkStateInConfig();

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });

  test('2 commits in 1 repo', async () => {
    // await sleep(2000);

    // Modify file in diff repo
    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file2.txt'), 'content2');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Add file2.txt"', { cwd: getTestRepoPath('diff') });

    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file3.txt'), 'content3');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Add file3.txt"', { cwd: getTestRepoPath('diff') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    const content2 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file2.txt'), 'utf8');
    const content3 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file3.txt'), 'utf8');

    await checkStateInConfig();

    expect(content2).toBe('content2');
    expect(content3).toBe('content3');
  });

  test('2 commits in 2 repos', async () => {
    // await sleep(2000);

    // Modify file in diff repo
    await fs.writeFile(path.join(getTestRepoPath('diff'), 'file2.txt'), 'content2');
    await execAsync('git add .', { cwd: getTestRepoPath('diff') });
    await execAsync('git commit -m "Add file2.txt"', { cwd: getTestRepoPath('diff') });

    await fs.writeFile(path.join(getTestRepoPath('base'), 'file3.txt'), 'content3');
    await execAsync('git add .', { cwd: getTestRepoPath('base') });
    await execAsync('git commit -m "Add file3.txt"', { cwd: getTestRepoPath('base') });

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    // Verify changes
    const content2 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file2.txt'), 'utf8');
    const content3 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file3.txt'), 'utf8');

    await checkStateInConfig();

    expect(content2).toBe('content2');
    expect(content3).toBe('content3');
  });

  test.only('Ignore path', async () => {
    const folder = path.join(getTestRepoPath('diff'), '.github', 'workflows');
    await fs.mkdir(folder, { recursive: true });
    await createTestCommit(
      getTestRepoPath('diff'),
      path.join('.github', 'workflows', 'ignorepath.txt'),
      'ignored content',
      'diff'
    );

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'));
    await processor.process();

    await afterDiflow();

    const mergedExists = await fs.exists(
      path.join(getTestRepoPath('merged'), '.github', 'workflows', 'ignorepath.txt')
    );

    await checkStateInConfig();

    // Verify changes
    expect(mergedExists).toBe(false);
  });
});
