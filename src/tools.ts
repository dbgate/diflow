import { exec } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { promisify } from 'util';
import { ChangeItem, Commit, FileAction, RepoId, State } from './types';

export const execAsync = promisify(exec);

export async function runGitCommand(repoPath: string, cmd: string): Promise<string> {
  try {
    // console.log('Running GIT COMMAND:', repoPath, cmd);
    const { stdout } = await execAsync(`git -C "${repoPath}" ${cmd}`);
    // console.log('RESULT:', stdout);
    return stdout;
  } catch (err: any) {
    console.error(`Error running git command in ${repoPath}: ${cmd}\n`, err.message);
    return '';
  }
}

export async function getCommits(repoPath: string, branch: string): Promise<Commit[]> {
  const log = await runGitCommand(repoPath, `log ${branch} --reverse --pretty=format:"%H|%ct|%aN|%aE|%f|%ad"`);
  const res = log
    .split('\n')
    .filter(Boolean)
    .map(x => {
      const [commit, ts, authorName, authorEmail, message, authorDate] = x.split('|');
      return {
        commit,
        ts: parseInt(ts),
        authorName,
        authorEmail,
        message,
        authorDate,
      };
    });
  res.sort((a, b) => a.ts - b.ts);
  return res;
}

export async function cloneRepository(repoPath: string, url: string) {
  if (!(await fs.exists(repoPath))) {
    console.log(`Cloning from ${url} into ${repoPath}`);
    await execAsync(`git clone ${url} ${repoPath}`);
  }
}

export function filterCommitsToProcess(commits: Commit[], state: State, branch: string, repoid: RepoId): Commit[] {
  const lastCommitIndex = commits.findIndex(x => x.commit === state[repoid][branch].lastProcessed);
  if (lastCommitIndex < 0) {
    console.log(`Could not find last processed commit for ${branch} in ${repoid}`);
    process.exit(1);
  }
  // return commits.slice(lastCommitIndex + 1).filter(x => !state[repoid][branch].committedByDiflow?.includes(x.commit));
  return commits.slice(lastCommitIndex + 1);
}

export async function getDiffForCommit(repoPath: string, commitHash: string): Promise<ChangeItem[]> {
  const diff = await runGitCommand(repoPath, `show --name-status ${commitHash}`);
  return diff
    .split('\n')
    .filter(x => x.match(/^[AMD]\t/))
    .map(x => {
      const [action, file] = x.split('\t');
      return {
        action: action as FileAction,
        file,
      };
    });
}

export async function copyRepoFile(srcRepo: string, destRepo: string, file: string) {
  const srcPath = path.join(srcRepo, file);
  const destPath = path.join(destRepo, file);
  await fs.ensureDir(path.dirname(destPath));
  await fs.copyFile(srcPath, destPath);
  console.log(`Copied ${file} from ${srcRepo} to ${destRepo}`);
}

export async function removeRepoFile(repoPath: string, file: string) {
  const filePath = path.join(repoPath, file);
  if (await fs.exists(filePath)) {
    await fs.unlink(filePath);
    console.log(`Removed ${file} from ${repoPath}`);
  }
}

export async function repoFileExists(repoPath: string, file: string): Promise<boolean> {
  return await fs.exists(path.join(repoPath, file));
}

export async function repoHasModifications(repoPath: string): Promise<boolean> {
  const status = await runGitCommand(repoPath, 'status --porcelain');
  return status.length > 0;
}

export async function getLastCommitHash(repoPath: string): Promise<string> {
  return (await runGitCommand(repoPath, 'rev-parse HEAD')).trim();
}

export function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export async function getHeadCommitInRepo(repoPath: string) {
  const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: repoPath });
  return commitHash.trim();
}
