export type RepoId = 'base' | 'diff' | 'merged' | 'config';
export type FileAction = 'A' | 'D' | 'M';

export interface Config {
  branches: string[];
  repos: {
    base: string;
    diff: string;
    merged: string;
    config: string;
  };
}

export interface State {
  [repo: string]: {
    [branch: string]: {
      lastProcessed: string;
      committedByDiflow: string[];
    };
  };
}

export interface Commit {
  commit: string;
  ts: number;
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
