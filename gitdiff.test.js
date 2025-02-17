const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");

const REPOS = {
  BASE: "test-base-repo",
  DIFF: "test-diff-repo",
  MERGED: "test-merged-repo",
  CONFIG: "test-config-repo",
};

function initRepo(name) {
  const repoPath = path.join(__dirname, name);
  fs.ensureDirSync(repoPath);
  execSync("git init", { cwd: repoPath });
  return repoPath;
}

function createCommit(repoPath, fileName, content) {
  fs.writeFileSync(path.join(repoPath, fileName), content);
  execSync("git add .", { cwd: repoPath });
  execSync('git commit -m "Initial commit"', { cwd: repoPath });
}

describe("Git Repository Tests", () => {
  const repos = {};

  beforeEach(() => {
    // Create all repositories
    Object.entries(REPOS).forEach(([key, name]) => {
      repos[key] = initRepo(name);
    });

    // Setup initial files
    createCommit(repos.BASE, "file1.txt", "original content");
    createCommit(repos.DIFF, "file1.txt", "original content");
    createCommit(repos.MERGED, "file1.txt", "original content");

    // Create config.json in config repo
    const configContent = JSON.stringify(
      {
        baseRepo: repos.BASE,
        diffRepo: repos.DIFF,
        mergedRepo: repos.MERGED,
      },
      null,
      2
    );
    createCommit(repos.CONFIG, "config.json", configContent);
  });

  afterEach(() => {
    // Cleanup repositories
    Object.values(REPOS).forEach((name) => {
      fs.removeSync(path.join(__dirname, name));
    });
  });

  test("Adding new files", () => {
    // Add new file in diff repo
    createCommit(repos.DIFF, "newfile.txt", "new content");
    expect(fs.existsSync(path.join(repos.DIFF, "newfile.txt"))).toBe(true);
    expect(fs.existsSync(path.join(repos.BASE, "newfile.txt"))).toBe(false);
  });

  test("Removing files", () => {
    // Remove file in diff repo
    fs.unlinkSync(path.join(repos.DIFF, "file1.txt"));
    execSync("git add .", { cwd: repos.DIFF });
    execSync('git commit -m "Remove file1.txt"', { cwd: repos.DIFF });

    expect(fs.existsSync(path.join(repos.DIFF, "file1.txt"))).toBe(false);
    expect(fs.existsSync(path.join(repos.BASE, "file1.txt"))).toBe(true);
  });

  test("Changing files", () => {
    // Modify file in diff repo
    fs.writeFileSync(path.join(repos.DIFF, "file1.txt"), "modified content");
    execSync("git add .", { cwd: repos.DIFF });
    execSync('git commit -m "Modify file1.txt"', { cwd: repos.DIFF });

    const baseContent = fs.readFileSync(
      path.join(repos.BASE, "file1.txt"),
      "utf8"
    );
    const diffContent = fs.readFileSync(
      path.join(repos.DIFF, "file1.txt"),
      "utf8"
    );

    expect(baseContent).toBe("original content");
    expect(diffContent).toBe("modified content");
  });
});
