import path from 'path';
import fs from 'fs';
import {
  cloneRepository,
  copyRepoFile,
  filterCommitsToProcess,
  getCommits,
  getDiffForCommit,
  getLastCommitHash,
  removeRepoFile,
  repoFileExists,
  repoHasModifications,
  runGitCommand,
} from './tools';
import { ChangeItem, Config, RepoId, State } from './types';

export class Processor {
  basePath = path.join(__dirname, 'repos');

  repoPaths: Record<RepoId, string> = {
    base: path.join(this.basePath, 'base'),
    diff: path.join(this.basePath, 'diff'),
    merged: path.join(this.basePath, 'merged'),
    config: path.join(this.basePath, 'config'),
  };

  stateFilePath = path.join(this.repoPaths.config, 'state.json');

  config: Config;

  constructor() {
    if (process.argv.length < 3) {
      console.error('Usage: gitdiff <state-repo-url>');
      process.exit(1);
    }

    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath);
    }

    cloneRepository(this.repoPaths.config, process.argv[2]);

    const configPath = path.join(this.repoPaths.config, 'config.json');
    if (!fs.existsSync(configPath)) {
      console.error(`Missing configuration file: ${configPath}`);
      process.exit(1);
    }

    try {
      this.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error('Error parsing config.json:', err);
      process.exit(1);
    }

    cloneRepository(this.repoPaths.base, this.config.repos.base);
    cloneRepository(this.repoPaths.diff, this.config.repos.diff);
    cloneRepository(this.repoPaths.merged, this.config.repos.merged);
  }

  processBranch(branch: string) {
    const proc = new BranchProcessor(this, branch);
    proc.process();
  }

  loadState(): State {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        return JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
      }
    } catch (err) {
      console.error('Error loading state:', err);
      process.exit(1);
    }
    throw new Error('State file not found');
  }

  process() {
    for (const branch of this.config.branches) {
      this.processBranch(branch);
    }
  }
}

interface CommitToProcess {
  commit: string;
  ts: number;
  repoid: RepoId;
}

class BranchProcessor {
  commitsToProcess: CommitToProcess[] = [];

  constructor(public processor: Processor, public branch: string) {
    runGitCommand(this.processor.repoPaths.base, `checkout ${branch}`);
    runGitCommand(this.processor.repoPaths.diff, `checkout ${branch}`);
    runGitCommand(this.processor.repoPaths.merged, `checkout ${branch}`);

    const baseCommits = getCommits(this.processor.repoPaths.base, branch);
    const diffCommits = getCommits(this.processor.repoPaths.diff, branch);
    const mergedCommits = getCommits(this.processor.repoPaths.merged, branch);

    const state = this.processor.loadState();

    const baseFilteredCommits = filterCommitsToProcess(baseCommits, state, branch, 'base');
    const diffFilteredCommits = filterCommitsToProcess(diffCommits, state, branch, 'diff');
    const mergedFilteredCommits = filterCommitsToProcess(mergedCommits, state, branch, 'merged');

    this.commitsToProcess = [
      ...baseFilteredCommits.map(x => ({ ...x, repoid: 'base' as RepoId })),
      ...diffFilteredCommits.map(x => ({ ...x, repoid: 'diff' as RepoId })),
      ...mergedFilteredCommits.map(x => ({ ...x, repoid: 'merged' as RepoId })),
    ];
    this.commitsToProcess.sort((a, b) => a.ts - b.ts);
    // in ideal case, commitsToProcess.length == 1, but there might be multiple commits to process
  }

  process() {
    for (const commit of this.commitsToProcess) {
      this.processCommit(commit);
    }
  }

  processCommit(commit: CommitToProcess) {
    const proc = new CommitProcessor(this.processor, this, commit);
    proc.process();
  }
}

class CommitProcessor {
  state: State;

  constructor(public processor: Processor, public branchProcessor: BranchProcessor, public commit: CommitToProcess) {
    this.state = this.processor.loadState();
  }

  checkout() {
    runGitCommand(this.processor.repoPaths.base, `checkout ${this.branchProcessor.branch}`);
    runGitCommand(this.processor.repoPaths.diff, `checkout ${this.branchProcessor.branch}`);
    runGitCommand(this.processor.repoPaths.merged, `checkout ${this.branchProcessor.branch}`);
    runGitCommand(this.processor.repoPaths[this.commit.repoid], `checkout ${this.commit.commit}`);
  }

  process() {
    this.checkout();
    this.processFiles();
    this.commitChanges();
  }

  commitChangesInRepo(repoid: RepoId) {
    if (repoHasModifications(this.processor.repoPaths[repoid])) {
      runGitCommand(this.processor.repoPaths[repoid], `add -A`);
      runGitCommand(
        this.processor.repoPaths[repoid],
        `commit -m "CI: Auto commit changes in ${repoid} for branch ${this.branchProcessor.branch}"`
      );
      runGitCommand(this.processor.repoPaths[repoid], `push`);
      const hash = getLastCommitHash(this.processor.repoPaths[repoid]);
      this.state[repoid][this.branchProcessor.branch].committedByDiflow.push(hash);
    }
  }

  commitChanges() {
    if (this.commit.repoid !== 'base') {
      this.commitChangesInRepo('base');
    }
    if (this.commit.repoid !== 'diff') {
      this.commitChangesInRepo('diff');
    }
    if (this.commit.repoid !== 'merged') {
      this.commitChangesInRepo('merged');
    }

    // this.state[repoid][this.branchProcessor.branch].committedByDiflow.push(hash);
  }

  processFiles() {
    const files = getDiffForCommit(this.processor.repoPaths[this.commit.repoid], this.commit.commit);
    for (const file of files) {
      switch (this.commit.repoid) {
        case 'base':
          this.processBaseFile(file);
          break;
        case 'diff':
          this.processDiffFile(file);
          break;
        case 'merged':
          this.processMergedFile(file);
          break;
      }
    }
  }

  processBaseFile(file: ChangeItem) {
    if (file.action === 'A') {
      if (!repoFileExists(this.processor.repoPaths.diff, file.file)) {
        copyRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file);
      }
    } else if (file.action === 'D') {
      if (!repoFileExists(this.processor.repoPaths.diff, file.file)) {
        removeRepoFile(this.processor.repoPaths.merged, file.file);
      }
    } else if (file.action === 'M') {
      if (!repoFileExists(this.processor.repoPaths.diff, file.file)) {
        copyRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file);
      }
    }
  }

  processDiffFile(file: ChangeItem) {
    if (file.action === 'A') {
      copyRepoFile(this.processor.repoPaths.diff, this.processor.repoPaths.merged, file.file);
    } else if (file.action === 'D') {
      if (repoFileExists(this.processor.repoPaths.base, file.file)) {
        copyRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file);
      } else {
        removeRepoFile(this.processor.repoPaths.merged, file.file);
      }
    } else if (file.action === 'M') {
      copyRepoFile(this.processor.repoPaths.diff, this.processor.repoPaths.merged, file.file);
    }
  }

  processMergedFile(file: ChangeItem) {
    if (file.action === 'A') {
      copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file);
    } else if (file.action === 'D') {
      removeRepoFile(this.processor.repoPaths.diff, file.file);
      removeRepoFile(this.processor.repoPaths.base, file.file);
    } else if (file.action === 'M') {
      if (repoFileExists(this.processor.repoPaths.diff, file.file)) {
        copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file);
      } else {
        copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.base, file.file);
      }
    }
  }
}
