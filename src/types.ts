export type RepoId = 'base' | 'diff' | 'merged' | 'config';
export type FileAction = 'A' | 'D' | 'M';

export interface RepoConfig {
  url: string;
  commitTag?: string; // eg. [skip ci] for skipping github pipeline  
}

export interface RepoIdentifier {
  content?: string;
  name?: string;
  // applyOnExisting?: boolean;
}

export interface SourceRepoConfig extends RepoConfig {
  identifiers?: RepoIdentifier[];
}

export interface Config {
  repos: {
    base: SourceRepoConfig;
    diff: SourceRepoConfig;
    merged: RepoConfig;
  };
  ignorePaths: string[];
  syncCommitPrefix?: string;
  newFilesTargetDefault?: 'base' | 'diff'; // default: diff
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
