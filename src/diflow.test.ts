import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { rm } from 'fs/promises';
import { promisify } from 'util';
import { rimraf } from 'rimraf';

const execAsync = promisify(exec);

function getRepoPath(repo: string) {
  const repoPath = path.join(__dirname, 'testrepos', repo);
  return repoPath.replaceAll('\\', '/');
}

async function initRepo(name: string) {
  const repoPath = getRepoPath(name);
  await fs.ensureDir(repoPath);
  await execAsync('git init', { cwd: repoPath });
  // Configure git user for the test
  await execAsync('git config user.email "test@example.com"', { cwd: repoPath });
  await execAsync('git config user.name "Test User"', { cwd: repoPath });
}

async function createCommit(repoPath: string, fileName: string, content: string, repoid: string) {
  await fs.writeFile(path.join(repoPath, fileName), content);
  await execAsync('git add .', { cwd: repoPath });
  await execAsync(`git commit -m "Commit into ${repoid}"`, { cwd: repoPath });

  const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return commitHash.trim();
}

describe('Git Repository Tests', () => {
  beforeEach(async () => {
    // Cleanup repositories
    try {
      await rimraf(path.join(__dirname, 'repos'));
      // await rm(path.join(__dirname, 'repos'), { recursive: true, force: true });
    } catch (e) {}
    try {
      await rimraf(path.join(__dirname, 'testrepos'));
      // await rm(path.join(__dirname, 'testrepos'), { recursive: true, force: true });
    } catch (e) {}

    await initRepo('config');
    await initRepo('base');
    await initRepo('diff');
    await initRepo('merged');

    // Setup initial files
    const baseHash = await createCommit(getRepoPath('base'), 'file1.txt', 'base content', 'base');
    const diffHash = await createCommit(getRepoPath('diff'), 'file1.txt', 'different content', 'diff');
    const mergedHash = await createCommit(getRepoPath('merged'), 'file1.txt', 'different content', 'merged');

    // Create config.json in config repo
    const configContent = JSON.stringify(
      {
        branches: ['master'],
        repos: {
          base: getRepoPath('base'),
          diff: getRepoPath('diff'),
          merged: getRepoPath('merged'),
        },
      },
      null,
      2
    );
    await createCommit(getRepoPath('config'), 'config.json', configContent, 'config');

    // Create state.json in config repo
    const stateContent = JSON.stringify(
      {
        base: {
          master: {
            lastProcessed: baseHash,
          },
        },
        diff: {
          master: {
            lastProcessed: diffHash,
          },
        },
        merged: {
          master: {
            lastProcessed: mergedHash,
          },
        },
      },
      null,
      2
    );
    await createCommit(getRepoPath('config'), 'state.json', stateContent, 'config');
  });

  // afterEach(async () => {
  //   // Cleanup repositories
  //   try {
  //     await rimraf(path.join(__dirname, 'repos'));
  //     // await rm(path.join(__dirname, 'repos'), { recursive: true, force: true });
  //   } catch (e) {}
  //   try {
  //     await rimraf(path.join(__dirname, 'testrepos'));
  //     // await rm(path.join(__dirname, 'testrepos'), { recursive: true, force: true });
  //   } catch (e) {}
  // });

  async function beforeDiflow() {
    await execAsync('git checkout -b tmp', { cwd: getRepoPath('merged') });
    await execAsync('git checkout -b tmp', { cwd: getRepoPath('base') });
    await execAsync('git checkout -b tmp', { cwd: getRepoPath('diff') });
  }

  async function afterDiflow() {
    await execAsync('git checkout master', { cwd: getRepoPath('merged') });
    await execAsync('git checkout master', { cwd: getRepoPath('base') });
    await execAsync('git checkout master', { cwd: getRepoPath('diff') });
  }

  test('Adding new files', async () => {
    // Add new file in diff repo
    await createCommit(getRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    await beforeDiflow();

    // Run diflow tool
    await execAsync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    await afterDiflow();

    // Verify changes
    expect(await fs.exists(path.join(getRepoPath('merged'), 'newfile.txt'))).toBe(true);
    expect(await fs.readFile(path.join(getRepoPath('merged'), 'newfile.txt'), 'utf8')).toBe('new content');
    expect(await fs.exists(path.join(getRepoPath('base'), 'newfile.txt'))).toBe(false);
  });

  test('Removing files', async () => {
    // Remove file in diff repo
    await fs.unlink(path.join(getRepoPath('diff'), 'file1.txt'));
    await execAsync('git add .', { cwd: getRepoPath('diff') });
    await execAsync('git commit -m "Remove file1.txt"', { cwd: getRepoPath('diff') });

    await beforeDiflow();

    // Run diflow tool
    await execAsync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    await afterDiflow();

    // Verify changes
    expect(await fs.exists(path.join(getRepoPath('merged'), 'file1.txt'))).toBe(true);
    expect(await fs.exists(path.join(getRepoPath('base'), 'file1.txt'))).toBe(true);
    expect(await fs.readFile(path.join(getRepoPath('merged'), 'file1.txt'), 'utf8')).toBe('base content');
  });

  test('Changing files', async () => {
    // Modify file in diff repo
    await fs.writeFile(path.join(getRepoPath('diff'), 'file1.txt'), 'modified content');
    await execAsync('git add .', { cwd: getRepoPath('diff') });
    await execAsync('git commit -m "Modify file1.txt"', { cwd: getRepoPath('diff') });

    await beforeDiflow();

    // Run diflow tool
    await execAsync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    await afterDiflow();

    // Verify changes
    const baseContent = await fs.readFile(path.join(getRepoPath('base'), 'file1.txt'), 'utf8');
    const diffContent = await fs.readFile(path.join(getRepoPath('diff'), 'file1.txt'), 'utf8');
    const mergedContent = await fs.readFile(path.join(getRepoPath('merged'), 'file1.txt'), 'utf8');

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
