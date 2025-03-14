const fs = require('fs-extra');
const path = require('path');

function skipPath(src: string) {
  if (src.includes('/node_modules/')) return true;
  if (src.includes('\\node_modules\\')) return true;

  if (src.includes('/.git/')) return true;
  if (src.includes('\\.git\\')) return true;

  return false;
}

async function copyDir(src: string, dest: string) {
  // Check if the source directory exists
  if (!await fs.exists(src)) {
    console.error(`Source directory "${src}" does not exist.`);
    return;
  }

  // Create the destination directory if it does not exist
  if (!await fs.exists(dest)) {
    await fs.mkdir(dest, { recursive: true });
  }

  // Read the contents of the source directory
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (skipPath(srcPath)) continue;
    if (skipPath(destPath)) continue;

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copy(destPath, srcPath);
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
