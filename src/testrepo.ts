import * as fs from 'fs-extra';
import * as path from 'path';
import { rimraf } from 'rimraf';
import { execAsync, sleep } from './tools';

export function getTestRepoPath(repo: string) {
  const repoPath = path.join(__dirname, 'testrepos', repo);
  return repoPath.replaceAll('\\', '/');
}

export async function initTestRepo(name: string) {
  const repoPath = getTestRepoPath(name);
  console.log('Creating test repo:', repoPath);
  await fs.ensureDir(repoPath);
  await execAsync('git init', { cwd: repoPath });
  // Configure git user for the test
  await execAsync('git config user.email "test@example.com"', { cwd: repoPath });
  await execAsync('git config user.name "Test User"', { cwd: repoPath });
}

export async function createTestCommit(repoPath: string, fileName: string, content: string, repoid: string) {
  console.log('Creating commit:', repoPath, 'file:', fileName, 'content:', content);
  await fs.writeFile(path.join(repoPath, fileName), content);
  await execAsync('git add .', { cwd: repoPath });
  await execAsync(`git commit -m "Commit into ${repoid}"`, { cwd: repoPath });

  const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return commitHash.trim();
}

export async function initTestRepos() {
  // Cleanup repositories
  try {
    await rimraf(path.join(__dirname, 'repos'));
    // await rm(path.join(__dirname, 'repos'), { recursive: true, force: true });
  } catch (e) {}
  try {
    await rimraf(path.join(__dirname, 'testrepos'));
    // await rm(path.join(__dirname, 'testrepos'), { recursive: true, force: true });
  } catch (e) {}

  await initTestRepo('config');
  await initTestRepo('base');
  await initTestRepo('diff');
  await initTestRepo('merged');

  // Setup initial files
  const baseHash = await createTestCommit(getTestRepoPath('base'), 'file1.txt', 'base content', 'base');
  const diffHash = await createTestCommit(getTestRepoPath('diff'), 'file1.txt', 'different content', 'diff');
  const mergedHash = await createTestCommit(getTestRepoPath('merged'), 'file1.txt', 'different content', 'merged');

  // Create config.json in config repo
  const configContent = JSON.stringify(
    {
      branches: ['master'],
      repos: {
        base: getTestRepoPath('base'),
        diff: getTestRepoPath('diff'),
        merged: getTestRepoPath('merged'),
      },
    },
    null,
    2
  );
  await createTestCommit(getTestRepoPath('config'), 'config.json', configContent, 'config');

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
  await createTestCommit(getTestRepoPath('config'), 'state.json', stateContent, 'config');
}

export async function beforeDiflow() {
  console.log('Checking out new tmp branch')
  await execAsync('git checkout -b tmp', { cwd: getTestRepoPath('merged') });
  await execAsync('git checkout -b tmp', { cwd: getTestRepoPath('base') });
  await execAsync('git checkout -b tmp', { cwd: getTestRepoPath('diff') });
  console.log('Checked out new tmp branch')
}

export async function afterDiflow() {
  console.log('Checking out master branch')
  await execAsync('git checkout master', { cwd: getTestRepoPath('merged') });
  await execAsync('git checkout master', { cwd: getTestRepoPath('base') });
  await execAsync('git checkout master', { cwd: getTestRepoPath('diff') });
  // await sleep(1000);
  console.log('Checked out master branch')
}
