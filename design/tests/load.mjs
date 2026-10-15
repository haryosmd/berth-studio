// Loads the pure-logic blocks out of design/prototype.html so they can be unit-tested
// without a browser. The prototype stays a single file; these tests read it in place.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE = join(here, '..', 'prototype.html');
export const html = () => readFileSync(PROTOTYPE, 'utf8');

export function scriptBlock(id) {
  const m = new RegExp(`<script id="${id}">\\n([\\s\\S]*?)</script>`).exec(html());
  if (!m) throw new Error(`<script id="${id}"> not found in prototype.html`);
  return m[1];
}
export function mainScript() {
  const m = /<script>\n(\(\(\) => \{[\s\S]*?)<\/script>/.exec(html());
  if (!m) throw new Error('main <script> not found in prototype.html');
  return m[1];
}
// Same-realm evaluation so assert.deepStrictEqual can compare arrays and objects.
export const loadCore = () => new Function(`${scriptBlock('berth-core')}\nreturn BerthCore;`)();
export const loadSample = () => new Function(`${scriptBlock('berth-sample')}\nreturn BerthSample;`)();
