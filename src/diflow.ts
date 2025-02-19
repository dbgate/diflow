import path from 'path';
import { Processor } from './processor';

if (process.argv.length < 3) {
  console.error('Usage: gitdiff <state-repo-url>');
  process.exit(1);
}

const processor = new Processor(process.argv[2], path.join(__dirname, 'repos'));
processor.process();

console.log('Processing complete.');
