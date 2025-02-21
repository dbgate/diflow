export type RepoId = 'base' | 'diff' | 'merged' | 'config';
export type FileAction = 'A' | 'D' | 'M';

export interface Config {
  repos: {
    base: string;
    diff: string;
    merged: string;
    config: string;
  };
  ignorePaths: string[];
  syncCommitPrefix?: string;
}

export interface State {
  [repo: string]: {
    lastProcessed: string;
  };
}

export interface Commit {
  commit: string;
  ts: number;
  authorName: string;
  authorEmail: string;
  message: string;
  authorDate: string;
}

export interface ChangeItem {
  action: FileAction;
  file: string;
}

// export interface BranchInfo {
//   repoid: string;
//   branch: string;
//   commits: Commit[];
//   state: BranchState;
// }
