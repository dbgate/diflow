import path from 'path';
import * as fs from 'fs-extra';
import {
  cloneRepository,
  copyRepoFile,
  execAsync,
  filterCommitsToProcess,
  getCommits,
  getDiffForCommit,
  getLastCommitHash,
  removeRepoFile,
  repoFileExists,
  repoHasModifications,
  runGitCommand,
  sleep,
} from './tools';
import { ChangeItem, Config, RepoId, State } from './types';

export class Processor {
  repoPaths: Record<RepoId, string>;

  config?: Config = undefined;

  constructor(public configRepoUrl: string, public basePath: string) {
    this.repoPaths = {
      base: path.join(this.basePath, 'base'),
      diff: path.join(this.basePath, 'diff'),
      merged: path.join(this.basePath, 'merged'),
      config: path.join(this.basePath, 'config'),
    };
  }

  async initialize() {
    if (!(await fs.exists(this.basePath))) {
      await fs.mkdir(this.basePath);
    }

    await cloneRepository(this.repoPaths.config, this.configRepoUrl);

    const configPath = path.join(this.repoPaths.config, 'config.json');
    if (!(await fs.exists(configPath))) {
      console.error(`Missing configuration file: ${configPath}`);
      process.exit(1);
    }

    try {
      this.config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (err) {
      console.error('Error parsing config.json:', err);
      process.exit(1);
    }

    await cloneRepository(this.repoPaths.base, this.config!.repos.base);
    await cloneRepository(this.repoPaths.diff, this.config!.repos.diff);
    await cloneRepository(this.repoPaths.merged, this.config!.repos.merged);
  }

  async loadState(): Promise<State> {
    const statePath = path.join(this.repoPaths.config, 'state.json');
    if (!(await fs.exists(statePath))) {
      console.error(`Missing state file: ${statePath}`);
      process.exit(1);
    }

    try {
      const res: State = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      for (const branch of this.config!.branches) {
        if (!res['base']?.[branch]?.lastProcessed) {
          throw new Error(`Missing state for branch ${branch} in base repo`);
        }
        if (!res['diff']?.[branch]?.lastProcessed) {
          throw new Error(`Missing state for branch ${branch} in diff repo`);
        }
        if (!res['merged']?.[branch]?.lastProcessed) {
          throw new Error(`Missing state for branch ${branch} in merged repo`);
        }
        if (!res['base']?.[branch]?.committedByDiflow) {
          res['base'][branch].committedByDiflow = [];
        }
        if (!res['diff']?.[branch]?.committedByDiflow) {
          res['diff'][branch].committedByDiflow = [];
        }
        if (!res['merged']?.[branch]?.committedByDiflow) {
          res['merged'][branch].committedByDiflow = [];
        }
      }
      return res;
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
  constructor(public commit: string, public ts: number, public repoid: RepoId) {}
}

class BranchProcessor {
  commitsToProcess: CommitToProcess[] = [];

  constructor(public processor: Processor, public branch: string) {}

  async initialize() {
    console.log('Initializing branch:', this.branch);
    await runGitCommand(this.processor.repoPaths.base, `checkout ${this.branch}`);
    await runGitCommand(this.processor.repoPaths.diff, `checkout ${this.branch}`);
    await runGitCommand(this.processor.repoPaths.merged, `checkout ${this.branch}`);

    console.log('Getting commits...');
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
    console.log('Initializing branch:', this.branch, 'DONE');
  }

  async process() {
    await this.initialize();

    for (const commit of this.commitsToProcess) {
      console.log('Processing commit', commit.repoid, ':', commit.commit);
      const commitProcessor = new CommitProcessor(this.processor, this, commit);
      await commitProcessor.process();
    }
  }
}

class CommitProcessor {
  state?: State = undefined;

  constructor(public processor: Processor, public branchProcessor: BranchProcessor, public commit: CommitToProcess) {}

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
    await runGitCommand(this.processor.repoPaths.base, `checkout ${this.branchProcessor.branch}`);
    await runGitCommand(this.processor.repoPaths.diff, `checkout ${this.branchProcessor.branch}`);
    await runGitCommand(this.processor.repoPaths.merged, `checkout ${this.branchProcessor.branch}`);
    await runGitCommand(this.processor.repoPaths[this.commit.repoid], `checkout ${this.commit.commit}`);
  }

  async processFiles() {
    const files = await getDiffForCommit(this.processor.repoPaths[this.commit.repoid], this.commit.commit);

    console.log('Processing files from commit:', files.length);

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
      if (await repoFileExists(this.processor.repoPaths.base, file.file)) {
        await copyRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file);
      } else {
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

  async commitChangesInRepo(repoid: RepoId) {
    if (await repoHasModifications(this.processor.repoPaths[repoid])) {
      console.log('Commiting changes for repo:', repoid);
      await runGitCommand(this.processor.repoPaths[repoid], `add -A`);
      await runGitCommand(
        this.processor.repoPaths[repoid],
        `commit -m "CI: Auto commit changes in ${repoid} for branch ${this.branchProcessor.branch}"`
      );
      await runGitCommand(this.processor.repoPaths[repoid], `push`);
      if (repoid !== 'config') {
        const hash = await getLastCommitHash(this.processor.repoPaths[repoid]);
        this.state![repoid][this.branchProcessor.branch].committedByDiflow.push(hash);
      }
      console.log('Commiting changes for repo:', repoid, 'DONE.');
    }
  }

  async commitChanges() {
    if (this.commit.repoid !== 'base') {
      await this.commitChangesInRepo('base');
    }
    if (this.commit.repoid !== 'diff') {
      await this.commitChangesInRepo('diff');
    }
    if (this.commit.repoid !== 'merged') {
      await this.commitChangesInRepo('merged');
    }
    this.state![this.commit.repoid][this.branchProcessor.branch].lastProcessed = this.commit.commit;
    await this.saveState();
    await this.commitChangesInRepo('config');
  }

  async saveState() {
    this.state![this.commit.repoid][this.branchProcessor.branch].lastProcessed = this.commit.commit;
    if (!this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow) {
      this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow = [];
    }
    const lastCommit = await getLastCommitHash(this.processor.repoPaths.merged);
    this.state![this.commit.repoid][this.branchProcessor.branch].committedByDiflow.push(lastCommit);

    await fs.writeFile(path.join(this.processor.repoPaths.config, 'state.json'), JSON.stringify(this.state, null, 2));

    await runGitCommand(this.processor.repoPaths.config, 'add .');
    await runGitCommand(
      this.processor.repoPaths.config,
      `commit -m "Diflow: update state for ${this.commit.repoid} commit ${this.commit.commit}"`
    );

    // await execAsync('git add .', { cwd: this.processor.repoPaths.config });
    // await execAsync(`git commit -m "Diflow: update state for ${this.commit.repoid} commit ${this.commit.commit}"`, {
    //   cwd: this.processor.repoPaths.config,
    // });
  }
}
