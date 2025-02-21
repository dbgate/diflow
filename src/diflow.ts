import path from 'path';
import { Processor } from './processor';
import { Command } from 'commander';

const program = new Command();

program
  .name('diflow')
  .description('Git diflow - maintain sync between GIT 3 repos (base+diff=merged)')
  .version('1.0.0');

program
  .command('sync')
  .description('Ryn sync between GIT 3 repos (base+diff=merged)')
  .requiredOption('-r, --repo', 'URL to control repo repo (configuration+state)')
  .requiredOption('-b, --branch', 'Branch name to be processed')
  .option('--skip-push', 'skip pushing changes to remote')
  .option('--clear', 'clear work repos before running')
  .action(options => {
    const processor = new Processor(options.config, options.branch, path.join(__dirname, 'workrepos'), {
      skipPush: options.skipPush,
      clear: options.clear,
    });
    processor.process();
    console.log('Processing complete.');
  });

// if (process.argv.length < 3) {
//   console.error('Usage: gitdiff <state-repo-url>');
//   process.exit(1);
// }

// const skipPush = process.argv.includes('--skip-push');
// const clear = process.argv.includes('--clear');

// const processor = new Processor(process.argv[2], path.join(__dirname, 'workrepos'), { skipPush, clear });
// processor.process();

console.log('Processing complete.');
