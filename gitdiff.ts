#!/usr/bin/env node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';


// console.log(getCommits('c:/jenasoft/dbgate', 'master').slice(-3));
// console.log(getCommits('c:/jenasoft/dbgate', 'master').slice(0, 3));
// process.exit(0);

// ------------------------------
// Helper: Run a git command in a given directory
// ------------------------------

// ------------------------------
// Check usage
// ------------------------------
// ------------------------------
// State tracking
// ------------------------------
const stateFilePath = path.join(repoPaths.config, 'state.json');

function loadState(): State {
  try {
    if (fs.existsSync(stateFilePath)) {
      return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading state:', err);
    process.exit(1);
  }
  throw new Error('State file not found');
}

function saveState(state: State) {
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving state:', err);
  }
}

function isCommitProcessed(state: State, repo: string, branch: string, commitHash: string) {
  return state[repo] && state[repo][branch] && state[repo][branch].includes(commitHash);
}

function markCommitProcessed(state: State, repo: string, branch: string, commitHash: string) {
  if (!state[repo]) {
    state[repo] = {};
  }
  if (!state[repo][branch]) {
    state[repo][branch] = [];
  }
  state[repo][branch].push(commitHash);
  saveState(state);
}



function fileExists(repoPath, file) {
  return fs.existsSync(path.join(repoPath, file));
}

function copyFile(srcRepo, destRepo, file) {
  const srcPath = path.join(srcRepo, file);
  const destPath = path.join(destRepo, file);
  if (!fs.existsSync(srcPath)) {
    console.warn(`Source file does not exist: ${srcPath}`);
    return;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  console.log(`Copied ${file} from ${srcRepo} to ${destRepo}`);
}

function removeFile(repoPath, file) {
  const filePath = path.join(repoPath, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Removed ${file} from ${repoPath}`);
  }
}

// ------------------------------
// Processing functions per repository type
// ------------------------------

// For repo1 (base):
// - Add: copy to repo3 if not present in repo2
// - Remove: remove from repo3 if not in repo2
// - Modify: update repo3 if not in repo2
function processRepo1Commit(commitHash, branch, state) {
  console.log(`Processing repo1 commit: ${commitHash} on branch ${branch}`);
  const changes = getDiffForCommit(repoPaths.repo1, commitHash);
  changes.forEach(change => {
    if (change.action === 'A') {
      if (!fileExists(repoPaths.repo2, change.file)) {
        copyFile(repoPaths.repo1, repoPaths.repo3, change.file);
      }
    } else if (change.action === 'D') {
      if (!fileExists(repoPaths.repo2, change.file)) {
        removeFile(repoPaths.repo3, change.file);
      }
    } else if (change.action === 'M') {
      if (!fileExists(repoPaths.repo2, change.file)) {
        copyFile(repoPaths.repo1, repoPaths.repo3, change.file);
      }
    }
  });
  markCommitProcessed(state, 'repo1', branch, commitHash);
}

// For repo2 (diff):
// - Add: add/overwrite in repo3
// - Remove: remove from repo3 if not in repo1
// - Modify: update repo3 (overwrite)
function processRepo2Commit(commitHash, branch, state) {
  console.log(`Processing repo2 commit: ${commitHash} on branch ${branch}`);
  const changes = getDiffForCommit(repoPaths.repo2, commitHash);
  changes.forEach(change => {
    if (change.action === 'A') {
      copyFile(repoPaths.repo2, repoPaths.repo3, change.file);
    } else if (change.action === 'D') {
      if (!fileExists(repoPaths.repo1, change.file)) {
        removeFile(repoPaths.repo3, change.file);
      }
    } else if (change.action === 'M') {
      copyFile(repoPaths.repo2, repoPaths.repo3, change.file);
    }
  });
  markCommitProcessed(state, 'repo2', branch, commitHash);
}

// For repo3 (merged):
// - Add: copy to repo2
// - Remove: remove from repo1 and repo2
// - Modify: if exists in repo2 then update repo2, else update repo1
function processRepo3Commit(commitHash, branch, state) {
  console.log(`Processing repo3 commit: ${commitHash} on branch ${branch}`);
  const changes = getDiffForCommit(repoPaths.repo3, commitHash);
  changes.forEach(change => {
    if (change.action === 'A') {
      copyFile(repoPaths.repo3, repoPaths.repo2, change.file);
    } else if (change.action === 'D') {
      removeFile(repoPaths.repo1, change.file);
      removeFile(repoPaths.repo2, change.file);
    } else if (change.action === 'M') {
      if (fileExists(repoPaths.repo2, change.file)) {
        copyFile(repoPaths.repo3, repoPaths.repo2, change.file);
      } else {
        copyFile(repoPaths.repo3, repoPaths.repo1, change.file);
      }
    }
  });
  markCommitProcessed(state, 'repo3', branch, commitHash);
}

// ------------------------------
// Helper to checkout a branch in a repo (creating it if needed)
// ------------------------------
function checkoutBranch(repoPath, branch) {
  // Fetch the latest from remote.
  runGitCommand(repoPath, 'fetch');
  try {
    // Try checking out the branch directly.
    runGitCommand(repoPath, `checkout ${branch}`);
  } catch (err) {
    // If checkout fails, try creating a new branch tracking the remote.
    console.log(`Branch ${branch} not found locally in ${repoPath}, creating it.`);
    runGitCommand(repoPath, `checkout -b ${branch} origin/${branch}`);
  }
  // Pull latest changes.
  runGitCommand(repoPath, 'pull');
}

// ------------------------------
// Helper to commit & push changes in a repository
// ------------------------------
function commitAndPush(repoPath, commitMessage) {
  const status = runGitCommand(repoPath, 'status --porcelain');
  if (!status.trim()) {
    console.log(`No changes to commit in ${repoPath}`);
    return;
  }
  runGitCommand(repoPath, 'add -A');
  try {
    runGitCommand(repoPath, `commit -m "${commitMessage}"`);
    // runGitCommand(repoPath, 'push');
    console.log(`Committed and pushed changes in ${repoPath}`);
  } catch (err) {
    console.error(`Error committing changes in ${repoPath}:`, err);
  }
}

// ------------------------------
// Main processing loop
// ------------------------------
const state = loadState();

// For each branch in the configuration, checkout that branch in each repository,
// process commits from each repo, and then commit & push changes.
branches.forEach(branch => {
  console.log(`\n=== Processing branch: ${branch} ===\n`);

  const repo1Commits = getCommits(repoPaths.repo1, branch);
  const repo2Commits = getCommits(repoPaths.repo2, branch);
  const repo3Commits = getCommits(repoPaths.repo3, branch);

  // For each repository, checkout the branch.
  for (const repoName in repoPaths) {
    const repoPath = repoPaths[repoName];
    console.log(`Checking out branch ${branch} in ${repoName}`);
    checkoutBranch(repoPath, branch);
  }

  // Process commits for each repository.
  // Note: The processing functions assume that the repo's working copy is on the branch being processed.
  // Process repo1 (base) commits.
  repo1Commits.forEach(commitHash => {
    if (!isCommitProcessed(state, 'repo1', branch, commitHash)) {
      processRepo1Commit(commitHash, branch, state);
    } else {
      console.log(`Skipping already processed repo1 commit: ${commitHash}`);
    }
  });

  // Process repo2 (diff) commits.
  repo2Commits.forEach(commitHash => {
    if (!isCommitProcessed(state, 'repo2', branch, commitHash)) {
      processRepo2Commit(commitHash, branch, state);
    } else {
      console.log(`Skipping already processed repo2 commit: ${commitHash}`);
    }
  });

  // Process repo3 (merged) commits.
  repo3Commits.forEach(commitHash => {
    if (!isCommitProcessed(state, 'repo3', branch, commitHash)) {
      processRepo3Commit(commitHash, branch, state);
    } else {
      console.log(`Skipping already processed repo3 commit: ${commitHash}`);
    }
  });

  // After processing the branch, commit & push changes for each repository.
  for (const repoName in repoPaths) {
    const repoPath = repoPaths[repoName];
    commitAndPush(repoPath, `CI: Auto commit changes in ${repoName} for branch ${branch}`);
  }
});

// Finally, commit and push state repository changes (which include state.json and config.json).
checkoutBranch(stateRepoPath, branches[0]); // Ensure we are on one of the branches (or adjust as needed)
commitAndPush(stateRepoPath, 'CI: Auto commit state.json and config.json updates');

console.log('Processing complete.');
