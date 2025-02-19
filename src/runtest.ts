import path from 'path';

import { createTestCommit, getTestRepoPath, initTestRepos } from './testrepo';
import { Processor } from './processor';

async function main() {
  switch (process.argv[2]) {
    case 'init':
      initTestRepos();
      break;
    case 'add':
      await createTestCommit(getTestRepoPath('diff'), 'newfile.txt', 'new content', 'diff');
      const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'repos'));
      await processor.process();
      break;
  }
}

main();
