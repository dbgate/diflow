const fs = require('fs-extra');
const path = require('path');

const SKIPPED_NAMES = ['node_modules', '.git'];

// tested against a single directory entry name, so that it works the same for relative and absolute paths
function skipName(name: string) {
  return SKIPPED_NAMES.includes(name);
}

async function copyDir(src: string, dest: string) {
  // Check if the source directory exists
  if (!(await fs.pathExists(src))) {
    console.error(`Source directory "${src}" does not exist.`);
    return;
  }

  // Create the destination directory if it does not exist
  await fs.ensureDir(dest);

  // Read the contents of the source directory
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (skipName(entry.name)) continue;

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copy(srcPath, destPath);
    }
  }
}

export async function filesystemMerge(base: string, diff: string, merged: string) {
  await fs.ensureDir(merged);
  console.log('Copying:', base, '=>', merged);
  await copyDir(base, merged);
  console.log('Copying:', diff, '=>', merged);
  await copyDir(diff, merged);
  console.log('Directories merged successfully');
}
