#!/usr/bin/env node
/**
 * Fails the build if two files in database/migrations/ share the same numeric
 * prefix. node-pg-migrate orders migrations by full filename (lexicographic),
 * so a colliding prefix makes run order depend on an accident of alphabetical
 * sort on the descriptive suffix rather than the intended sequence (see issue
 * #950 / BE-003). See database/MIGRATIONS.md for the naming convention.
 */
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');
const PREFIX_RE = /^(\d+)_/;

function main() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js') || f.endsWith('.sql'));
  const byPrefix = new Map(); // prefix -> [files]

  for (const file of files) {
    const match = file.match(PREFIX_RE);
    if (!match) {
      console.error(`Migration file missing a numeric prefix: ${file}`);
      process.exit(1);
    }
    const prefix = match[1];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }

  let failed = false;
  for (const [prefix, matchingFiles] of byPrefix) {
    if (matchingFiles.length > 1) {
      failed = true;
      console.error(
        `Duplicate migration prefix "${prefix}" shared by ${matchingFiles.length} files: ` +
          `${matchingFiles.join(', ')}. See database/MIGRATIONS.md — every migration must have a ` +
          `unique, strictly-increasing prefix.`
      );
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log(`check-migration-prefixes: OK (${files.length} migrations, all prefixes unique)`);
}

main();
