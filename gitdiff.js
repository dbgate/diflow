#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Check for proper usage:
// Usage: gitdiff branch1,branch2,branch3 repo1 repo2 repo3
if (process.argv.length < 6) {
  console.error("Usage: gitdiff branch1,branch2,branch3 repo1 repo2 repo3");
  process.exit(1);
}

// Parse arguments
const branches = process.argv[2].split(",");
const [repo1Path, repo2Path, repo3Path] = process.argv.slice(3);

// --- Utility functions ---

// Runs a Git command in the specified repository and returns stdout.
function runGitCommand(repoPath, cmd) {
  try {
    return execSync(`git -C "${repoPath}" ${cmd}`, { encoding: "utf8" });
  } catch (err) {
    console.error(
      `Error running git command in ${repoPath}: ${cmd}`,
      err.message
    );
    return "";
  }
}

// Get commits on a given branch (you may later need to filter for not-processed commits)
function getCommits(repoPath, branch) {
  const log = runGitCommand(repoPath, `log ${branch} --pretty=format:"%H"`);
  return log.split("\n").filter(Boolean);
}

// Get the changes for a specific commit in a repo.
// This uses "git show" with the --name-status option.
function getDiffForCommit(repoPath, commitHash) {
  const diffOutput = runGitCommand(
    repoPath,
    `show ${commitHash} --name-status`
  );
  const changes = [];
  diffOutput.split("\n").forEach((line) => {
    if (!line.trim()) return;
    // Expected line format: "A\tpath/to/file" (or D, M, etc.)
    const [action, ...fileParts] = line.split("\t");
    const file = fileParts.join("\t").trim();
    if (file) {
      changes.push({ action: action.trim(), file });
    }
  });
  return changes;
}

// Check if a file exists in a repository (relative to the repo root)
function fileExists(repoPath, file) {
  return fs.existsSync(path.join(repoPath, file));
}

// Copy a file from one repo to another. Creates directories as needed.
function copyFile(srcRepo, destRepo, file) {
  const srcPath = path.join(srcRepo, file);
  const destPath = path.join(destRepo, file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`Source file does not exist: ${srcPath}`);
    return;
  }
  // Ensure destination directory exists.
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied ${file} from ${srcRepo} to ${destRepo}`);
}

// Remove a file from a repo.
function removeFile(repoPath, file) {
  const filePath = path.join(repoPath, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Removed ${file} from ${repoPath}`);
  }
}

// --- Processing functions per repository type ---

// Process a commit from repo1 (base):
//   - Add file: add to repo3 only if it doesn't exist in repo2
//   - Remove file: remove from repo3 only if it doesn't exist in repo2
//   - Modify file: modify repo3 only if it doesn't exist in repo2
function processRepo1Commit(commitHash) {
  console.log(`Processing repo1 commit: ${commitHash}`);
  const changes = getDiffForCommit(repo1Path, commitHash);
  changes.forEach((change) => {
    if (change.action === "A") {
      if (!fileExists(repo2Path, change.file)) {
        copyFile(repo1Path, repo3Path, change.file);
      }
    } else if (change.action === "D") {
      if (!fileExists(repo2Path, change.file)) {
        removeFile(repo3Path, change.file);
      }
    } else if (change.action === "M") {
      if (!fileExists(repo2Path, change.file)) {
        copyFile(repo1Path, repo3Path, change.file);
      }
    }
  });
}

// Process a commit from repo2 (diff):
//   - Add file: add or overwrite in repo3
//   - Remove file: remove from repo3 only if file doesn't exist in repo1
//   - Modify file: overwrite in repo3
function processRepo2Commit(commitHash) {
  console.log(`Processing repo2 commit: ${commitHash}`);
  const changes = getDiffForCommit(repo2Path, commitHash);
  changes.forEach((change) => {
    if (change.action === "A") {
      copyFile(repo2Path, repo3Path, change.file);
    } else if (change.action === "D") {
      if (!fileExists(repo1Path, change.file)) {
        removeFile(repo3Path, change.file);
      }
    } else if (change.action === "M") {
      copyFile(repo2Path, repo3Path, change.file);
    }
  });
}

// Process a commit from repo3 (merged):
//   - Add file: add to repo2
//   - Remove file: remove from repo1 and repo2
//   - Modify file: if file exists in repo2 then update repo2, otherwise update repo1
function processRepo3Commit(commitHash) {
  console.log(`Processing repo3 commit: ${commitHash}`);
  const changes = getDiffForCommit(repo3Path, commitHash);
  changes.forEach((change) => {
    if (change.action === "A") {
      copyFile(repo3Path, repo2Path, change.file);
    } else if (change.action === "D") {
      removeFile(repo1Path, change.file);
      removeFile(repo2Path, change.file);
    } else if (change.action === "M") {
      if (fileExists(repo2Path, change.file)) {
        copyFile(repo3Path, repo2Path, change.file);
      } else {
        copyFile(repo3Path, repo1Path, change.file);
      }
    }
  });
}

// --- Main processing loop ---

// For each branch provided, loop through the commits in each repository.
// Note: In a real implementation you would keep track of already processed commits.
branches.forEach((branch) => {
  console.log(`\nProcessing branch: ${branch}\n-----------------------------`);

  // Process repo1 (base) commits
  const repo1Commits = getCommits(repo1Path, branch);
  repo1Commits.forEach((commitHash) => {
    // Here you would check whether this commit has been processed before.
    processRepo1Commit(commitHash);
  });

  // Process repo2 (diff) commits
  const repo2Commits = getCommits(repo2Path, branch);
  repo2Commits.forEach((commitHash) => {
    processRepo2Commit(commitHash);
  });

  // Process repo3 (merged) commits
  const repo3Commits = getCommits(repo3Path, branch);
  repo3Commits.forEach((commitHash) => {
    processRepo3Commit(commitHash);
  });
});
