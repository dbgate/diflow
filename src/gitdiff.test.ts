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
  return repoPath;
}

function createCommit(repoPath: string, fileName: string, content: string) {
  fs.writeFileSync(path.join(repoPath, fileName), content);
  execSync('git add .', { cwd: repoPath });
  execSync('git commit -m "Initial commit"', { cwd: repoPath });

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
    const baseHash = createCommit(repos.BASE, 'file1.txt', 'original content');
    const diffHash = createCommit(repos.DIFF, 'file1.txt', 'original content');
    const mergedHash = createCommit(repos.MERGED, 'file1.txt', 'original content');

    // Create config.json in config repo
    const configContent = JSON.stringify(
      {
        branches: ['master'],
        repos: {
          base: path.join(__dirname, repos.BASE),
          diff: path.join(__dirname, repos.DIFF),
          merged: path.join(__dirname, repos.MERGED),
        },
      },
      null,
      2
    );
    createCommit(repos.CONFIG, 'config.json', configContent);

    // Create state.json in config repo
    const stateContent = JSON.stringify(
      {
        base: {
          master: baseHash,
        },
        diff: {
          master: diffHash,
        },
        merged: {
          master: mergedHash,
        },
      },
      null,
      2
    );
    createCommit(repos.CONFIG, 'state.json', stateContent);
  });

  // afterEach(() => {
  //     // Cleanup repositories
  //     Object.values(REPOS).forEach(name => {
  //         fs.removeSync(path.join(__dirname, name));
  //     });
  // });

  test.only('Adding new files', async () => {
    // Add new file in diff repo
    createCommit(repos.DIFF, 'newfile.txt', 'new content');

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

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

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

    // Verify changes
    expect(fs.existsSync(path.join(repos.MERGED, 'file1.txt'))).toBe(false);
    expect(fs.existsSync(path.join(repos.BASE, 'file1.txt'))).toBe(true);
  });

  test('Changing files', async () => {
    // Modify file in diff repo
    fs.writeFileSync(path.join(repos.DIFF, 'file1.txt'), 'modified content');
    execSync('git add .', { cwd: repos.DIFF });
    execSync('git commit -m "Modify file1.txt"', { cwd: repos.DIFF });

    // Run gitdiff tool
    execSync('node gitdiff.js ' + repos.CONFIG, { cwd: __dirname });

    // Verify changes
    const baseContent = fs.readFileSync(path.join(repos.BASE, 'file1.txt'), 'utf8');
    const diffContent = fs.readFileSync(path.join(repos.DIFF, 'file1.txt'), 'utf8');
    const mergedContent = fs.readFileSync(path.join(repos.MERGED, 'file1.txt'), 'utf8');

    expect(baseContent).toBe('original content');
    expect(diffContent).toBe('modified content');
    expect(mergedContent).toBe('modified content');
  });
});
