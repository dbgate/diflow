import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';
import { rimrafSync } from 'rimraf';

function getRepoPath(repo: string) {
  const repoPath = path.join(__dirname, 'testrepos', repo);
  return repoPath.replaceAll('\\', '/');
}

function initRepo(name: string) {
  const repoPath = getRepoPath(name);
  fs.ensureDirSync(repoPath);
  execSync('git init', { cwd: repoPath });
  // Configure git user for the test
  execSync('git config user.email "test@example.com"', { cwd: repoPath });
  execSync('git config user.name "Test User"', { cwd: repoPath });
}

function createCommit(repoPath: string, fileName: string, content: string, repoid: string) {
  fs.writeFileSync(path.join(repoPath, fileName), content);
  execSync('git add .', { cwd: repoPath });
  execSync(`git commit -m "Commit into ${repoid}"`, { cwd: repoPath });

  const commitHash = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
  return commitHash;
}

describe('Git Repository Tests', () => {
  beforeEach(() => {
    // Cleanup repositories
    try {
      rimrafSync(path.join(__dirname, 'repos'));
    } catch (e) {}
    try {
      rimrafSync(path.join(__dirname, 'testrepos'));
    } catch (e) {}

    initRepo('config');
    initRepo('base');
    initRepo('diff');
    initRepo('merged');

    // Setup initial files
    const baseHash = createCommit(getRepoPath('base'), 'file1.txt', 'base content', 'base');
    const diffHash = createCommit(getRepoPath('diff'), 'file1.txt', 'different content', 'diff');
    const mergedHash = createCommit(getRepoPath('merged'), 'file1.txt', 'different content', 'merged');

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
    createCommit(getRepoPath('config'), 'config.json', configContent, 'config');

    // Create state.json in config repo
    const stateContent = JSON.stringify(
      {
        base: {
          master: { lastProcessed: baseHash },
        },
        diff: {
          master: { lastProcessed: diffHash },
        },
        merged: {
          master: { lastProcessed: mergedHash },
        },
      },
      null,
      2
    );
    createCommit(getRepoPath('config'), 'state.json', stateContent, 'config');
  });

  // afterEach(() => {
  //     // Cleanup repositories
  //     Object.values(REPOS).forEach(name => {
  //         fs.removeSync(path.join(__dirname, name));
  //     });
  // });

  function beforeDiflow() {
    execSync('git checkout -b tmp', { cwd: getRepoPath('merged') });
    execSync('git checkout -b tmp', { cwd: getRepoPath('base') });
    execSync('git checkout -b tmp', { cwd: getRepoPath('diff') });
  }

  function afterDiflow() {
    execSync('git checkout master', { cwd: getRepoPath('merged') });
    execSync('git checkout master', { cwd: getRepoPath('base') });
    execSync('git checkout master', { cwd: getRepoPath('diff') });
    // execSync('git pull', { cwd: repos.MERGED });
    // execSync('git pull', { cwd: repos.BASE });
    // execSync('git pull', { cwd: repos.DIFF });
  }

  test('Adding new files', async () => {
    // Add new file in diff repo
    createCommit(getRepoPath('diff'), 'newfile.txt', 'new content', 'diff');

    beforeDiflow();

    // Run diflow tool
    execSync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    afterDiflow();

    // Verify changes
    expect(fs.existsSync(path.join(getRepoPath('merged'), 'newfile.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(getRepoPath('merged'), 'newfile.txt'), 'utf8')).toBe('new content');
    expect(fs.existsSync(path.join(getRepoPath('base'), 'newfile.txt'))).toBe(false);
  });

  test('Removing files', async () => {
    // Remove file in diff repo
    fs.unlinkSync(path.join(getRepoPath('diff'), 'file1.txt'));
    execSync('git add .', { cwd: getRepoPath('diff') });
    execSync('git commit -m "Remove file1.txt"', { cwd: getRepoPath('diff') });

    beforeDiflow();

    // Run diflow tool
    execSync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    afterDiflow();

    // Verify changes
    expect(fs.existsSync(path.join(getRepoPath('merged'), 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(getRepoPath('base'), 'file1.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(getRepoPath('merged'), 'file1.txt'), 'utf8')).toBe('modified content');
  });

  test.only('Changing files', async () => {
    // Modify file in diff repo
    fs.writeFileSync(path.join(getRepoPath('diff'), 'file1.txt'), 'modified content');
    execSync('git add .', { cwd: getRepoPath('diff') });
    execSync('git commit -m "Modify file1.txt"', { cwd: getRepoPath('diff') });

    beforeDiflow();

    // Run diflow tool
    execSync('node diflow.js ' + getRepoPath('config'), { cwd: __dirname });

    afterDiflow();

    // Verify changes
    const baseContent = fs.readFileSync(path.join(getRepoPath('base'), 'file1.txt'), 'utf8');
    const diffContent = fs.readFileSync(path.join(getRepoPath('diff'), 'file1.txt'), 'utf8');
    const mergedContent = fs.readFileSync(path.join(getRepoPath('merged'), 'file1.txt'), 'utf8');

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
