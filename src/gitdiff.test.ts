import * as fs from 'fs-extra';
import * as path from 'path';
import { execSync } from 'child_process';

const REPOS = {
  BASE: 'test-base-repo',
  DIFF: 'test-diff-repo',
  MERGED: 'test-merged-repo',
  CONFIG: 'test-config-repo',
};

function initRepo(name: string) {
  const repoPath = path.join(__dirname, name);
  fs.ensureDirSync(repoPath);
  execSync('git init', { cwd: repoPath });
  // Configure git user for the test
  execSync('git config user.email "test@example.com"', { cwd: repoPath });
  execSync('git config user.name "Test User"', { cwd: repoPath });
  return repoPath.replaceAll('\\', '/');
}

function createCommit(repoPath: string, fileName: string, content: string, repoid: string) {
  fs.writeFileSync(path.join(repoPath, fileName), content);
  execSync('git add .', { cwd: repoPath });
  execSync(`git commit -m "Commit into ${repoid}"`, { cwd: repoPath });

  const commitHash = execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
  return commitHash;
}

describe('Git Repository Tests', () => {
  const repos: { [key: string]: string } = {};

  beforeEach(() => {
    // Cleanup repositories
    Object.values(REPOS).forEach(name => {
      try {
        fs.removeSync(path.join(__dirname, name));
      } catch (e) {}
    });
    try {
      fs.removeSync(path.join(__dirname, 'repos'));
    } catch (e) {}

    // Create all repositories
    Object.entries(REPOS).forEach(([key, name]) => {
      repos[key] = initRepo(name);
    });

    // Setup initial files
    const baseHash = createCommit(repos.BASE, 'file1.txt', 'base content', 'base');
    const diffHash = createCommit(repos.DIFF, 'file1.txt', 'different content', 'diff');
    const mergedHash = createCommit(repos.MERGED, 'file1.txt', 'different content', 'merged');

    // Create config.json in config repo
    const configContent = JSON.stringify(
      {
        branches: ['master'],
        repos: {
          base: repos.BASE,
          diff: repos.DIFF,
          merged: repos.MERGED,
        },
      },
      null,
      2
    );
    createCommit(repos.CONFIG, 'config.json', configContent, 'config');

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
    createCommit(repos.CONFIG, 'state.json', stateContent, 'config');
  });

  // afterEach(() => {
  //     // Cleanup repositories
  //     Object.values(REPOS).forEach(name => {
  //         fs.removeSync(path.join(__dirname, name));
  //     });
  // });

  function beforeDiflow() {
    execSync('git checkout -b tmp', { cwd: repos.MERGED });
    execSync('git checkout -b tmp', { cwd: repos.BASE });
    execSync('git checkout -b tmp', { cwd: repos.DIFF });
  }

  function afterDiflow() {
    execSync('git checkout master', { cwd: repos.MERGED });
    execSync('git checkout master', { cwd: repos.BASE });
    execSync('git checkout master', { cwd: repos.DIFF });
    // execSync('git pull', { cwd: repos.MERGED });
    // execSync('git pull', { cwd: repos.BASE });
    // execSync('git pull', { cwd: repos.DIFF });
  }

  test('Adding new files', async () => {
    // Add new file in diff repo
    createCommit(repos.DIFF, 'newfile.txt', 'new content', 'diff');

    beforeDiflow();

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

    afterDiflow();

    // Verify changes
    expect(fs.existsSync(path.join(repos.MERGED, 'newfile.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(repos.MERGED, 'newfile.txt'), 'utf8')).toBe('new content');
    expect(fs.existsSync(path.join(repos.BASE, 'newfile.txt'))).toBe(false);
  });

  test('Removing files', async () => {
    // Remove file in diff repo
    fs.unlinkSync(path.join(repos.DIFF, 'file1.txt'));
    execSync('git add .', { cwd: repos.DIFF });
    execSync('git commit -m "Remove file1.txt"', { cwd: repos.DIFF });

    beforeDiflow();

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

    afterDiflow();

    // Verify changes
    expect(fs.existsSync(path.join(repos.MERGED, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(repos.BASE, 'file1.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(repos.MERGED, 'file1.txt'), 'utf8')).toBe('base content');
  });

  test('Changing files', async () => {
    // Modify file in diff repo
    fs.writeFileSync(path.join(repos.DIFF, 'file1.txt'), 'modified content');
    execSync('git add .', { cwd: repos.DIFF });
    execSync('git commit -m "Modify file1.txt"', { cwd: repos.DIFF });

    beforeDiflow();

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

    afterDiflow();

    // Verify changes
    const baseContent = fs.readFileSync(path.join(repos.BASE, 'file1.txt'), 'utf8');
    const diffContent = fs.readFileSync(path.join(repos.DIFF, 'file1.txt'), 'utf8');
    const mergedContent = fs.readFileSync(path.join(repos.MERGED, 'file1.txt'), 'utf8');

    expect(baseContent).toBe('base content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
