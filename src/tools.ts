import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ChangeItem, Commit, FileAction, RepoId, State } from './types';

export function runGitCommand(repoPath: string, cmd: string): string {
  try {
    return execSync(`git -C "${repoPath}" ${cmd}`, { encoding: 'utf8' });
  } catch (err: any) {
    console.error(`Error running git command in ${repoPath}: ${cmd}\n`, err.message);
    return '';
  }
}

export function getCommits(repoPath: string, branch: string): Commit[] {
  const log = runGitCommand(repoPath, `log ${branch} --pretty=format:"%H|%ct"`);
  const res = log
    .split('\n')
    .filter(Boolean)
    .map(x => {
      const [commit, ts] = x.split('|');
      return {
        commit,
        ts: parseInt(ts),
      };
    });
  res.sort((a, b) => a.ts - b.ts);
  return res;
}

export function cloneRepository(repoPath: string, url: string) {
  if (!fs.existsSync(repoPath)) {
    console.log(`Cloning from ${url} into ${repoPath}`);
    execSync(`git clone ${url} ${repoPath}`, { encoding: 'utf8' });
  }
}

export function filterCommitsToProcess(commits: Commit[], state: State, branch: string, repoid: RepoId): Commit[] {
  const lastCommitIndex = commits.findIndex(x => x.commit === state.branches[branch].lastProcessed);
  if (lastCommitIndex < 0) {
    console.log(`Could not find last processed commit for ${branch} in ${repoid}`);
    process.exit(1);
  }
  return commits.slice(lastCommitIndex + 1).filter(x => !state.branches[branch].committedByDiflow?.includes(x.commit));
}

// export function getBranchInfo(repoid: RepoId, repoPath: string, branch: string): BranchInfo {
//   const commits = getCommits(repoid, repoPath, branch);
//   return {
//     repoid,
//     branch,
//     commits,
//     state: BranchState.Unknown,
//   };
// }

export function getDiffForCommit(repoPath: string, commitHash: string): ChangeItem[] {
  const diffOutput = runGitCommand(repoPath, `show ${commitHash} --name-status`);
  const changes: ChangeItem[] = [];
  diffOutput.split('\n').forEach(line => {
    if (!line.trim()) return;
    // Expected format: "A<TAB>path/to/file", "D<TAB>path/to/file", etc.
    const [action, ...fileParts] = line.split('\t');
    const file = fileParts.join('\t').trim();
    if (file) {
      changes.push({ action: action.trim() as FileAction, file });
    }
  });
  return changes;
}

export function copyRepoFile(srcRepo: string, destRepo: string, file: string) {
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

export function removeRepoFile(repoPath: string, file: string) {
  const filePath = path.join(repoPath, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Removed ${file} from ${repoPath}`);
  }
}

export function repoFileExists(repoPath: string, file: string) {
  return fs.existsSync(path.join(repoPath, file));
}

export function repoHasModifications(repoPath: string) {
  return runGitCommand(repoPath, 'status --porcelain').trim() !== '';
}

export function getLastCommitHash(repoPath: string) {
  return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
}
