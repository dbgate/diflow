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
  renameRepoFile,
  repoFileExists,
  repoHasModifications,
  runGitCommand,
} from './tools';
import { ChangeItem, Config, RepoId, RepoIdentifier, State } from './types';
import { minimatch } from 'minimatch';
import { rimraf } from 'rimraf';

export interface ProcessOptions {
  skipPush?: boolean;
  clear?: boolean;
  secret?: string;
}

interface CommitToProcess {
  commit: string;
  ts: number;
  authorName: string;
  authorEmail: string;
  message: string;
  authorDate: string;
  repoid: RepoId;
}
export class Processor {
  repoPaths: Record<RepoId, string>;
  commitsToProcess: CommitToProcess[] = [];

  config?: Config = undefined;

  constructor(
    public configRepoUrl: string,
    public basePath: string,
    public branch: string,
    public processOptions: ProcessOptions = {}
  ) {
    this.repoPaths = {
      base: path.join(this.basePath, 'base'),
      diff: path.join(this.basePath, 'diff'),
      merged: path.join(this.basePath, 'merged'),
      config: path.join(this.basePath, 'config'),
    };
  }

  async initialize() {
    if (this.processOptions.clear) {
      try {
        await rimraf(this.basePath);
      } catch (e) {
        // ignore
      }
    }

    if (!(await fs.exists(this.basePath))) {
      await fs.mkdir(this.basePath);
    }

    await cloneRepository(
      this.repoPaths.config,
      this.configRepoUrl.replace('DIFLOW_GIT_SECRET', this.processOptions.secret ?? '')
    );
    await runGitCommand(this.repoPaths.config, `checkout ${this.branch}`);

    const configPath = path.join(this.repoPaths.config, 'config.json');
    if (!(await fs.exists(configPath))) {
      console.error(`Missing configuration file: ${configPath}`);
      process.exit(1);
    }

    try {
      this.config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      if (!this.config) {
        console.error('Invalid configuration file:', configPath);
        process.exit(1);
      }
      if (!this.config.syncCommitPrefix) {
        this.config.syncCommitPrefix = 'SYNC:';
      }
    } catch (err) {
      console.error('Error parsing config.json:', err);
      process.exit(1);
    }

    await cloneRepository(
      this.repoPaths.base,
      this.config!.repos.base.url.replace('DIFLOW_GIT_SECRET', this.processOptions.secret ?? '')
    );
    await cloneRepository(
      this.repoPaths.diff,
      this.config!.repos.diff.url.replace('DIFLOW_GIT_SECRET', this.processOptions.secret ?? '')
    );
    await cloneRepository(
      this.repoPaths.merged,
      this.config!.repos.merged.url.replace('DIFLOW_GIT_SECRET', this.processOptions.secret ?? '')
    );

    await runGitCommand(this.repoPaths.base, `checkout ${this.branch}`);
    await runGitCommand(this.repoPaths.diff, `checkout ${this.branch}`);
    await runGitCommand(this.repoPaths.merged, `checkout ${this.branch}`);

    await this.readCommitsToProcess();
  }

  async readCommitsToProcess() {
    console.log('Getting commits...');
    const baseCommits = await getCommits(this.repoPaths.base, this.branch);
    const diffCommits = await getCommits(this.repoPaths.diff, this.branch);
    const mergedCommits = await getCommits(this.repoPaths.merged, this.branch);

    const state = await this.loadState();

    const baseFilteredCommits = filterCommitsToProcess(
      baseCommits,
      state,
      this.branch,
      'base',
      this.config!.syncCommitPrefix!
    );
    const diffFilteredCommits = filterCommitsToProcess(
      diffCommits,
      state,
      this.branch,
      'diff',
      this.config!.syncCommitPrefix!
    );
    const mergedFilteredCommits = filterCommitsToProcess(
      mergedCommits,
      state,
      this.branch,
      'merged',
      this.config!.syncCommitPrefix!
    );

    this.commitsToProcess = [
      ...baseFilteredCommits.map(x => ({ ...x, repoid: 'base' as RepoId })),
      ...diffFilteredCommits.map(x => ({ ...x, repoid: 'diff' as RepoId })),
      ...mergedFilteredCommits.map(x => ({ ...x, repoid: 'merged' as RepoId })),
    ];
    this.commitsToProcess.sort((a, b) => a.ts - b.ts);
    // console.log('Initializing branch:', this.branch, 'DONE');
    console.log('Commits to process:', this.commitsToProcess.length);
  }

  async loadState(): Promise<State> {
    const statePath = path.join(this.repoPaths.config, 'state.json');
    let state: State = {};
    if (await fs.exists(statePath)) {
      try {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      } catch (err) {
        console.error('Error parsing state.json:', err);
        process.exit(1);
      }
    }
    if (!state['base']?.lastProcessed) {
      state['base'] = { ...state['base'], lastProcessed: await getLastCommitHash(this.repoPaths.base) };
    }
    if (!state['diff']?.lastProcessed) {
      state['diff'] = { ...state['diff'], lastProcessed: await getLastCommitHash(this.repoPaths.diff) };
    }
    if (!state['merged']?.lastProcessed) {
      state['merged'] = { ...state['merged'], lastProcessed: await getLastCommitHash(this.repoPaths.merged) };
    }
    return state;
  }

  async process() {
    await this.initialize();

    for (const commit of this.commitsToProcess) {
      console.log('Processing commit', commit.repoid, ':', commit.message);
      const commitProcessor = new CommitProcessor(this, commit);
      await commitProcessor.process();
    }
  }
}

class CommitProcessor {
  state?: State = undefined;

  constructor(public processor: Processor, public commit: CommitToProcess) {}

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
    await runGitCommand(this.processor.repoPaths.base, `checkout ${this.processor.branch}`);
    await runGitCommand(this.processor.repoPaths.diff, `checkout ${this.processor.branch}`);
    await runGitCommand(this.processor.repoPaths.merged, `checkout ${this.processor.branch}`);
    await runGitCommand(this.processor.repoPaths[this.commit.repoid], `checkout ${this.commit.commit}`);
  }

  async processFiles() {
    const files = await getDiffForCommit(this.processor.repoPaths[this.commit.repoid], this.commit.commit);

    for (const file of files) {
      if ((this.processor.config?.ignorePaths ?? []).find(ignore => minimatch(file.file, ignore, { partial: true }))) {
        continue;
      }
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
      if (!(await repoFileExists(this.processor.repoPaths.diff, file.file))) {
        await removeRepoFile(this.processor.repoPaths.merged, file.file);
      }
    } else if (file.action == 'R') {
      await renameRepoFile(this.processor.repoPaths.base, this.processor.repoPaths.merged, file.file, file.newFile!);
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
    } else if (file.action == 'R') {
      await renameRepoFile(this.processor.repoPaths.diff, this.processor.repoPaths.merged, file.file, file.newFile!);
    }
  }

  async matchIdentifiers(repoPath: string, file: string, identifiers?: RepoIdentifier[]) {
    if (!identifiers) {
      return false;
    }

    let content: string | null = null;
    for (const identifier of identifiers) {
      if (identifier.content) {
        if (content == null) {
          content = await fs.readFile(path.join(repoPath, file), 'utf8');
        }
        if (content.includes(identifier.content)) {
          return true;
        }
      }
      if (identifier.name) {
        if (minimatch(file, identifier.name, { partial: true })) {
          return true;
        }
      }
    }
    return false;
  }

  async processMergedFile(file: ChangeItem) {
    if (file.action === 'A') {
      let target = this.processor.config?.newFilesTargetDefault ?? 'diff';
      if (
        await this.matchIdentifiers(
          this.processor.repoPaths.merged,
          file.file,
          this.processor.config?.repos.base.identifiers
        )
      ) {
        target = 'base';
      }
      if (
        await this.matchIdentifiers(
          this.processor.repoPaths.merged,
          file.file,
          this.processor.config?.repos.diff.identifiers
        )
      ) {
        target = 'diff';
      }

      if (target === 'base') {
        await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.base, file.file);
      } else {
        await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file);
      }
    } else if (file.action === 'M') {
      if (await repoFileExists(this.processor.repoPaths.diff, file.file)) {
        await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file);
      } else {
        await copyRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.base, file.file);
      }
    } else if (file.action === 'D') {
      await removeRepoFile(this.processor.repoPaths.base, file.file);
      await removeRepoFile(this.processor.repoPaths.diff, file.file);
    } else if (file.action == 'R') {
      if (await repoFileExists(this.processor.repoPaths.diff, file.file)) {
        await renameRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.diff, file.file, file.newFile!);
      } else {
        await renameRepoFile(this.processor.repoPaths.merged, this.processor.repoPaths.base, file.file, file.newFile!);
      }
    }
  }

  async commitChangesInRepo(repoid: RepoId) {
    if (await repoHasModifications(this.processor.repoPaths[repoid])) {
      console.log('Commiting changes for repo:', repoid);
      await runGitCommand(this.processor.repoPaths[repoid], `add -A`);
      await runGitCommand(
        this.processor.repoPaths[repoid],
        `commit -m "${this.processor.config?.syncCommitPrefix} ${
          repoid != 'config' && this.processor.config?.repos[repoid]?.commitTag
            ? `${this.processor.config?.repos[repoid]?.commitTag} `
            : ''
        } ${this.commit.message}" --author="${this.commit.authorName} <${this.commit.authorEmail}>" --date="${
          this.commit.authorDate
        }"`
      );

      if (!this.processor.processOptions.skipPush) {
        await runGitCommand(this.processor.repoPaths[repoid], `push`);
      }
      // if (repoid !== 'config') {
      //   const hash = await getLastCommitHash(this.processor.repoPaths[repoid]);
      //   this.state![repoid].lastProcessed = hash;
      // }
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
    this.state![this.commit.repoid].lastProcessed = this.commit.commit;

    await this.saveState();

    await this.commitChangesInRepo('config');
  }

  async saveState() {
    await fs.writeFile(path.join(this.processor.repoPaths.config, 'state.json'), JSON.stringify(this.state, null, 2));

    // await runGitCommand(this.processor.repoPaths.config, 'add .');
    // await runGitCommand(
    //   this.processor.repoPaths.config,
    //   `commit -m "Diflow: update state for ${this.commit.repoid} commit ${this.commit.commit}"`
    // );

    // await execAsync('git add .', { cwd: this.processor.repoPaths.config });
    // await execAsync(`git commit -m "Diflow: update state for ${this.commit.repoid} commit ${this.commit.commit}"`, {
    //   cwd: this.processor.repoPaths.config,
    // });
  }
}
