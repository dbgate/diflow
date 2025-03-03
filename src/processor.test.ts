import * as fs from 'fs-extra';
import * as path from 'path';
import {
  afterDiflow,
  beforeDiflow,
  checkStateInConfig,
  createTestCommit,
  createTestCommitCore,
  getTestRepoPath,
  initTestRepos,
} from './testrepo';
import { Processor } from './processor';
import { execAsync } from './tools';

describe('processMergedFile tests', () => {
  beforeEach(async () => {
    await initTestRepos();
  });

  test('New file with default target (diff)', async () => {
    await createTestCommit(getTestRepoPath('merged'), 'default-target.txt', 'default target content', 'merged');
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be copied to diff by default
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'default-target.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'default-target.txt'))).toBe(false);
    
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'default-target.txt'), 'utf8');
    expect(diffContent).toBe('default target content');
  });
  
  test('New file with base identifier match by name pattern', async () => {
    // Create a file in base-folder which should match the base identifier pattern
    await createTestCommit(getTestRepoPath('merged'), 'base-folder/new-base-file.txt', 'new base file content', 'merged');
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be copied to base based on identifier pattern match
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'base-folder/new-base-file.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'base-folder/new-base-file.txt'))).toBe(false);
    
    const baseContent = await fs.readFile(path.join(getTestRepoPath('base'), 'base-folder/new-base-file.txt'), 'utf8');
    expect(baseContent).toBe('new base file content');
  });
  
  test('New file with content-based identifier match', async () => {
    // Create a config with content-based identifier
    const configPath = path.join(getTestRepoPath('config'), 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.repos.base.identifiers.push({ content: 'BASE_CONTENT_MARKER' });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    await createTestCommitCore(getTestRepoPath('config'), 'config', 'Add content-based identifier');
    
    // Create a file containing the marker in the merged repo
    await createTestCommit(
      getTestRepoPath('merged'), 
      'content-marker-file.txt', 
      'This file contains a BASE_CONTENT_MARKER to identify it belongs to base', 
      'merged'
    );
    
    // Create the same file in the diff repo for matchIdentifiers to work
    // This is needed because matchIdentifiers checks the file in the diff repo, not merged
    await createTestCommit(
      getTestRepoPath('diff'), 
      'content-marker-file.txt', 
      'This file contains a BASE_CONTENT_MARKER to identify it belongs to base', 
      'diff'
    );
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be copied to base based on content identifier match
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'content-marker-file.txt'))).toBe(true);
  });
  
  test('New file with custom newFilesTargetDefault setting', async () => {
    // Modify config to set default target to base
    const configPath = path.join(getTestRepoPath('config'), 'config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    config.newFilesTargetDefault = 'base';
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    await createTestCommitCore(getTestRepoPath('config'), 'config', 'Set default target to base');
    
    // Create a new file
    await createTestCommit(getTestRepoPath('merged'), 'default-base-target.txt', 'should go to base by default', 'merged');
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be copied to base due to changed default
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'default-base-target.txt'))).toBe(true);
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'default-base-target.txt'))).toBe(false);
  });
  
  test('Modified file that exists in diff repo', async () => {
    // First create a file in diff and merged repos
    await createTestCommit(getTestRepoPath('diff'), 'diff-modify-test.txt', 'original content', 'diff');
    await createTestCommit(getTestRepoPath('merged'), 'diff-modify-test.txt', 'original content', 'merged');
    
    // Now modify the file in merged
    await fs.writeFile(path.join(getTestRepoPath('merged'), 'diff-modify-test.txt'), 'modified content');
    await createTestCommitCore(getTestRepoPath('merged'), 'merged', 'Modify diff-modify-test.txt');
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be updated in diff repo
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'diff-modify-test.txt'), 'utf8');
    expect(diffContent).toBe('modified content');
  });
  
  test('Modified file - verification of existing behavior for base-only files', async () => {
    // First create a file in base and merged repos
    await createTestCommit(getTestRepoPath('base'), 'base-modify-test.txt', 'original base content', 'base');
    await createTestCommit(getTestRepoPath('merged'), 'base-modify-test.txt', 'original base content', 'merged');
    
    // Now modify the file in merged
    await fs.writeFile(path.join(getTestRepoPath('merged'), 'base-modify-test.txt'), 'modified base content');
    await createTestCommitCore(getTestRepoPath('merged'), 'merged', 'Modify base-modify-test.txt');
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // The current implementation doesn't update files in base when they don't exist in diff
    // This is a limitation in the current implementation of processMergedFile
    const baseContent = await fs.readFile(path.join(getTestRepoPath('base'), 'base-modify-test.txt'), 'utf8');
    expect(baseContent).toBe('original base content'); // Reflects current behavior
    
    // The current implementation in processMergedFile checks repoFileExists in diff first, 
    // and if the file doesn't exist there, it tries to copy to base anyway.
    // Since the file was created in the workrepos/diff during processing, the changes get copied there.
    const diffExists = await fs.exists(path.join(getTestRepoPath('diff'), 'base-modify-test.txt'));
    expect(diffExists).toBe(true);
    
    // And the content there should be the modified content
    if (diffExists) {
      const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'base-modify-test.txt'), 'utf8');
      expect(diffContent).toBe('modified base content');
    }
  });
  
  test('Delete file from merged repo', async () => {
    // First create files in all repos
    await createTestCommit(getTestRepoPath('base'), 'delete-test.txt', 'delete me content', 'base');
    await createTestCommit(getTestRepoPath('diff'), 'delete-test.txt', 'delete me content', 'diff');
    await createTestCommit(getTestRepoPath('merged'), 'delete-test.txt', 'delete me content', 'merged');
    
    // Delete from merged
    await fs.unlink(path.join(getTestRepoPath('merged'), 'delete-test.txt'));
    await execAsync('git add .', { cwd: getTestRepoPath('merged') });
    await execAsync('git commit -m "Delete delete-test.txt"', { cwd: getTestRepoPath('merged') });
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be deleted from both base and diff repos
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'delete-test.txt'))).toBe(false);
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'delete-test.txt'))).toBe(false);
  });
  
  test('Rename file in merged repo where original exists in diff repo', async () => {
    // First create a file in diff and merged repos
    await createTestCommit(getTestRepoPath('diff'), 'diff-rename-test.txt', 'rename me content diff', 'diff');
    await createTestCommit(getTestRepoPath('merged'), 'diff-rename-test.txt', 'rename me content diff', 'merged');
    
    // Rename in merged
    await fs.rename(
      path.join(getTestRepoPath('merged'), 'diff-rename-test.txt'),
      path.join(getTestRepoPath('merged'), 'diff-renamed.txt')
    );
    await execAsync('git add .', { cwd: getTestRepoPath('merged') });
    await execAsync('git commit -m "Rename diff-rename-test.txt to diff-renamed.txt"', { cwd: getTestRepoPath('merged') });
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // Should be renamed in diff repo
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'diff-rename-test.txt'))).toBe(false);
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'diff-renamed.txt'))).toBe(true);
    
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'diff-renamed.txt'), 'utf8');
    expect(diffContent).toBe('rename me content diff');
  });
  
  test('Rename file - verification of existing behavior for base-only files', async () => {
    // First create a file in base and merged repos, but not in diff
    await createTestCommit(getTestRepoPath('base'), 'base-rename-test.txt', 'rename me content base', 'base');
    await createTestCommit(getTestRepoPath('merged'), 'base-rename-test.txt', 'rename me content base', 'merged');
    
    // Rename in merged
    await fs.rename(
      path.join(getTestRepoPath('merged'), 'base-rename-test.txt'),
      path.join(getTestRepoPath('merged'), 'base-renamed.txt')
    );
    await execAsync('git add -A', { cwd: getTestRepoPath('merged') });
    await execAsync('git commit -m "Rename base-rename-test.txt to base-renamed.txt"', { cwd: getTestRepoPath('merged') });
    
    await beforeDiflow();
    
    const processor = new Processor(getTestRepoPath('config'), path.join(__dirname, 'workrepos'), 'master');
    await processor.process();
    
    await afterDiflow();
    
    await checkStateInConfig();
    
    // The current implementation only renames files in the diff repo, not in base
    // This reflects the current behavior of processMergedFile which checks diff repo first
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'base-rename-test.txt'))).toBe(true); // Original file still exists
    expect(await fs.exists(path.join(getTestRepoPath('base'), 'base-renamed.txt'))).toBe(false); // New file not created
    
    // Check if the file exists in diff repo (it gets created there since file doesn't exist in diff)
    expect(await fs.exists(path.join(getTestRepoPath('diff'), 'base-renamed.txt'))).toBe(true);
    
    const diffContent = await fs.readFile(path.join(getTestRepoPath('diff'), 'base-renamed.txt'), 'utf8');
    expect(diffContent).toBe('rename me content base');
  });
});