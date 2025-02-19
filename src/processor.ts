import path from 'path';
import * as fs from 'fs-extra';
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

  config?: Config = undefined;

  constructor() {
    if (process.argv.length < 3) {
      console.error('Usage: gitdiff <state-repo-url>');
      process.exit(1);
    }
  }

  async initialize() {
    if (!await fs.exists(this.basePath)) {
      await fs.mkdir(this.basePath);
    }

    await cloneRepository(this.repoPaths.config, process.argv[2]);

    const configPath = path.join(this.repoPaths.config, 'config.json');
    if (!await fs.exists(configPath)) {
      console.error(`Missing configuration file: ${configPath}`);
      process.exit(1);
    }

    try {
      this.config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (err) {
      console.error('Error parsing config.json:', err);
      process.exit(1);
    }

    for (const [repoid, repoPath] of Object.entries(this.config!.repos)) {
      await cloneRepository(this.repoPaths[repoid as RepoId], repoPath);
    }
  }

  async loadState(): Promise<State> {
    const statePath = path.join(this.repoPaths.config, 'state.json');
    if (!await fs.exists(statePath)) {
      console.error(`Missing state file: ${statePath}`);
      process.exit(1);
    }

    try {
      return JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch (err) {
      console.error('Error parsing state.json:', err);
      process.exit(1);
    }
  }

  async process() {
    await this.initialize();

    for (const branch of this.config!.branches) {
      const branchProcessor = new BranchProcessor(this, branch);
      await branchProcessor.process();
    }
  }
}

class CommitToProcess {
  constructor(
    public commit: string,
    public ts: number,
    public repoid: RepoId
  ) {}
}

class BranchProcessor {
  commitsToProcess: CommitToProcess[] = [];

  constructor(public processor: Processor, public branch: string) {}

  async initialize() {
    await runGitCommand(this.processor.repoPaths.base, `checkout ${this.branch}`);
    await runGitCommand(this.processor.repoPaths.diff, `checkout ${this.branch}`);
    await runGitCommand(this.processor.repoPaths.merged, `checkout ${this.branch}`);

    const baseCommits = await getCommits(this.processor.repoPaths.base, this.branch);
    const diffCommits = await getCommits(this.processor.repoPaths.diff, this.branch);
    const mergedCommits = await getCommits(this.processor.repoPaths.merged, this.branch);

    const state = await this.processor.loadState();

    const baseFilteredCommits = filterCommitsToProcess(baseCommits, state, this.branch, 'base');
    const diffFilteredCommits = filterCommitsToProcess(diffCommits, state, this.branch, 'diff');
    const mergedFilteredCommits = filterCommitsToProcess(mergedCommits, state, this.branch, 'merged');

    this.commitsToProcess = [
      ...baseFilteredCommits.map(x => ({ ...x, repoid: 'base' as RepoId })),
      ...diffFilteredCommits.map(x => ({ ...x, repoid: 'diff' as RepoId })),
      ...mergedFilteredCommits.map(x => ({ ...x, repoid: 'merged' as RepoId })),
    ];
    this.commitsToProcess.sort((a, b) => a.ts - b.ts);
  }

  async process() {
    await this.initialize();
    
    for (const commit of this.commitsToProcess) {
      const commitProcessor = new CommitProcessor(this.processor, this, commit);
      await commitProcessor.process();
    }
  }
}

class CommitProcessor {
  state?: State = undefined;

  constructor(
    public processor: Processor,
    public branchProcessor: BranchProcessor,
    public commit: CommitToProcess
  ) {}

  async initialize() {
    this.state = await this.processor.loadState();
  }

  async process() {
    await this.initialize();
    await this.checkout();
    await this.processFiles();
    await this.commitChanges();
    await this.saveState();
  }

  async checkout() {
    await runGitCommand(this.processor.repoPaths[this.commit.repoid], `checkout ${this.commit.commit}`);
  }

  async processFiles() {
    const files = await getDiffForCommit(this.processor.repoPaths[this.commit.repoid], this.commit.commit);
    
    for (const file of files) {
      if (this.commit.repoid === 'base') {
        await this.processBaseFile(file);
      } else if (this.commit.repoid === 'diff') {
        await this.processDiffFile(file);
      } else if (this.commit.repoid === 'merged') {
        await this.processMergedFile(file);
      }
    }
  }

  async processBaseFile(file: ChangeItem) {
    if (file.action === 'M' || file.action === 'A') {
      await copyRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file);
    } else if (file.action === 'D') {
      await removeRepoFile(this.processor.repoPaths.merged, file.file);
    }
  }

  async processDiffFile(file: ChangeItem) {
    if (file.action === 'M' || file.action === 'A') {
      await copyRepoFile(this.processor.repoPaths.diff, this.processor.repoPaths.merged, file.file);
    } else if (file.action === 'D') {
      const existsInBase = await repoFileExists(this.processor.repoPaths.base, file.file);
      if (!existsInBase) {
        await removeRepoFile(this.processor.repoPaths.merged, file.file);
      }
    }
  }

  async processMergedFile(file: ChangeItem) {
    if (file.action === 'M' || file.action === 'A') {
      await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.base, file.file);
      await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file);
    } else if (file.action === 'D') {
      await removeRepoFile(this.processor.repoPaths.base, file.file);
      await removeRepoFile(this.processor.repoPaths.diff, file.file);
    }
  }

  async commitChanges() {
    if (await repoHasModifications(this.processor.repoPaths.merged)) {
      await runGitCommand(this.processor.repoPaths.merged, 'add .');
      await runGitCommand(
        this.processor.repoPaths.merged,
        `commit -m "Diflow: process ${this.commit.repoid} commit ${this.commit.commit}"`
      );
    }
  }

  async saveState() {
    this.state![this.commit.repoid][this.branchProcessor.branch].lastProcessed = this.commit.commit;
    if (!this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow) {
      this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow = [];
    }
    const lastCommit = await getLastCommitHash(this.processor.repoPaths.merged);
    this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow.push(lastCommit);

    await fs.writeFile(
      path.join(this.processor.repoPaths.config, 'state.json'),
      JSON.stringify(this.state, null, 2)
    );
    await runGitCommand(this.processor.repoPaths.config, 'add .');
    await runGitCommand(
      this.processor.repoPaths.config,
      `commit -m "Diflow: update state for ${this.commit.repoid} commit ${this.commit.commit}"`
    );
  }
}
