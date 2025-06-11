import * as fs from 'fs-extra';
import * as path from 'path';
import {
  afterDiflow,
  beforeDiflow,
  checkStateInConfig,
  createTestCommit,
  createTestCommitCore,
  getTestRepoPath,
  initTestRepos,
} from './testrepo';
import { Processor } from './processor';
import { cloneRepository, execAsync, runGitCommand, sleep } from './tools';
import { rimraf } from 'rimraf';

describe('Git Repository Tests', () => {
  beforeEach(async () => {
    await initTestRepos();
  });

  test('Adding new files', async () => {
    await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
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

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
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

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
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

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
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

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();

    await afterDiflow();

    // Verify changes
    const content2 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file2.txt'), 'utf8');
    const content3 = await fs.readFile(path.join(getTestRepoPath('merged'), 'file3.txt'), 'utf8');

    await checkStateInConfig();

    expect(content2).toBe('content2');
    expect(content3).toBe('content3');
  });

  test('Ignore path', async () => {
    const folder = path.join(getTestRepoPath('diff'), '.github', 'workflows');
    await fs.mkdir(folder, { recursive: true });
    await createTestCommit(
      getTestRepoPath('diff'),
      path.join('.github', 'workflows', 'ignorepath.txt'),
      'ignored content',
      'diff'
    );

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();

    await afterDiflow();

    const mergedExists = await fs.exists(
      path.join(getTestRepoPath('merged'), '.github', 'workflows', 'ignorepath.txt')
    );

    await checkStateInConfig();

    // Verify changes
    expect(mergedExists).toBe(false);
  });

  test('Ignore sync commits', async () => {
    await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff', 'SYNC: ingore this commit');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();

    await afterDiflow();

    const mergedExists = await fs.exists(path.join(getTestRepoPath('merged'), 'newfile.txt'));

    await checkStateInConfig();

    // Verify changes
    expect(mergedExists).toBe(false);
  });

  test('Adding file to merged', async () => {
    await createTestCommit(getTestRepoPath('merged'), 'normal-folder/diff.txt', 'diff content', 'merged');
    await createTestCommit(getTestRepoPath('merged'), 'base-folder/base.txt', 'base content', 'merged');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();

    await afterDiflow();

    await checkStateInConfig();

    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'normal-folder/diff.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'normal-folder/diff.txt'))).toBe(false);

    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'base-folder/base.txt'))).toBe(false);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'base-folder/base.txt'))).toBe(true);
  });

  test('Rename files', async () => {
    // await execAsync(`git mv only-base.txt only-base-renamed.txt`, { cwd: getTestRepoPath('merged') });

    await fs.rename(
      path.join(getTestRepoPath('merged'), 'only-base.txt'),
      path.join(getTestRepoPath('merged'), 'only-base-renamed.txt')
    );
    await fs.writeFile(
      path.join(getTestRepoPath('merged'), 'only-base-renamed.txt'),
      'only-base content\nline 1\nline 2\nline 3'
    );
    await createTestCommitCore(getTestRepoPath('merged'), 'merged', 'Rename only-base.txt to only-base-renamed.txt');

    await beforeDiflow();

    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();

    await afterDiflow();

    await checkStateInConfig();

    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'only-base-renamed.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'only-base-renamed.txt'))).toBe(true);

    const newContent = await fs.readFile(path.join(getTestRepoPath('base'), 'only-base-renamed.txt'), 'utf8');

    expect(newContent.replaceAll('\r\n', '\n')).toBe('only-base content\nline 1\nline 2\nline 3');

    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'only-base.txt'))).toBe(false);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'only-base.txt'))).toBe(false);
  });

  test('Git merge', async () => {
    await execAsync('git checkout -b feature', { cwd: getTestRepoPath('base') });
    await createTestCommit(getTestRepoPath('base'), 'feature1.txt', 'feature1', 'base', 'feature1');

    await sleep(1100);
    await execAsync('git checkout master', { cwd: getTestRepoPath('base') });
    await createTestCommit(getTestRepoPath('base'), 'master1.txt', 'master1', 'base', 'master1');

    await sleep(1100);
    await execAsync('git checkout feature', { cwd: getTestRepoPath('base') });
    await createTestCommit(getTestRepoPath('base'), 'feature2.txt', 'feature2', 'base', 'feature2');

    await beforeDiflow();

    const processor1 = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor1.process();

    await afterDiflow();

    await checkStateInConfig();

    await sleep(1100);
    await execAsync('git checkout master', { cwd: getTestRepoPath('base') });
    await execAsync('git merge feature', { cwd: getTestRepoPath('base') });

    await beforeDiflow('tmp2');

    await rimraf(path.join(__dirname, 'workrepos'));
    const processor2 = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor2.process();

    await afterDiflow();

    await checkStateInConfig();

    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'feature1.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'feature2.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('merged'), 'master1.txt'))).toBe(true);
  });

  test('Git pull --merge', async () => {
    await createTestCommit(getTestRepoPath('base'), 'master1.txt', 'master1', 'base', 'master1');
    await beforeDiflow();

    const processor1 = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor1.process();

    // await fs.ensureDir(path.join(getTestRepoPath('base_inst1')));
    // await fs.ensureDir(path.join(getTestRepoPath('base_inst2')));
    await execAsync(`git clone ${getTestRepoPath('base')} ${getTestRepoPath('base_inst1')}`);
    await execAsync(`git clone ${getTestRepoPath('base')} ${getTestRepoPath('base_inst2')}`);

    await createTestCommit(getTestRepoPath('base_inst1'), 'feature1.txt', 'feature1', 'base', 'feature1');
    await createTestCommit(getTestRepoPath('base_inst2'), 'feature2.txt', 'feature2', 'base', 'feature2');

    await execAsync('git push', { cwd: getTestRepoPath('base_inst1') });
    await execAsync('git config pull.rebase false', { cwd: getTestRepoPath('base_inst2') });
    await execAsync('git pull', { cwd: getTestRepoPath('base_inst2') });
    await execAsync('git push', { cwd: getTestRepoPath('base_inst2') });
    // await runGitCommand(getTestRepoPath('base_inst1'), 'push');
    // await runGitCommand(getTestRepoPath('base_inst2'), 'push');

    const processor2 = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor2.process();
  });
});
