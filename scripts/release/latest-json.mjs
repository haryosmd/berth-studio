#!/usr/bin/env node
// Writes the update manifest (latest.json) that installed copies of Berth Studio read from
// https://github.com/<owner>/<repo>/releases/latest/download/latest.json.
// Used by .github/workflows/release.yml:
//   node scripts/release/latest-json.mjs <version> <signature file> <download url> <notes file>
// The build is a universal binary, so both Mac architectures point at the same package.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** GitHub's generated release notes, reduced to plain text for the update panel. */
export function plainNotes(markdown) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter(line => !/^\s*\*\*Full Changelog\*\*/.test(line))
    .map(line => line
      .replace(/^#+\s*/, '')
      .replace(/^(\s*)\*\s+/, '$1- ')
      .replace(/ by @[\w-]+(\[bot\])? in https:\/\/\S+$/, '')
      .trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function latestJson({ version, signature, url, notes, date = new Date() }) {
  if (!VERSION.test(version)) throw new Error(`not a release version: ${version}`);
  if (!url.startsWith('https://')) throw new Error(`the download URL must use https: ${url}`);
  const sig = signature.trim();
  if (!sig) throw new Error('the signature is empty');
  const platform = { signature: sig, url };
  return {
    version,
    notes: plainNotes(notes),
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [version, signatureFile, url, notesFile] = process.argv.slice(2);
  if (!notesFile) {
    console.error('usage: latest-json.mjs <version> <signature file> <download url> <notes file>');
    process.exit(2);
  }
  const manifest = latestJson({
    version, url, signature: readFileSync(signatureFile, 'utf8'), notes: readFileSync(notesFile, 'utf8'),
  });
  process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
}
