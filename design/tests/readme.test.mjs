// Keeps the translated READMEs in step: every language links to every other one,
// every relative link points at a real file, and all versions share one structure.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LANGS = {
  'README.md': 'English',
  'README.id.md': 'Bahasa Indonesia',
  'README.zh-CN.md': '简体中文',
  'README.ja.md': '日本語',
  'README.ar.md': 'العربية',
  'README.ru.md': 'Русский'
};
const read = f => readFileSync(join(ROOT, f), 'utf8');
const shape = text => ({
  h2: (text.match(/^## /gm) || []).length,
  h3: (text.match(/^### /gm) || []).length,
  codeBlocks: (text.match(/^```/gm) || []).length / 2,
  tableRows: (text.match(/^\| /gm) || []).length,
  steps: (text.match(/^\d\. /gm) || []).length,
  bullets: (text.match(/^\s*- /gm) || []).length
});

describe('READMEs', () => {
  test('every language file exists', () => {
    for (const f of Object.keys(LANGS)) assert.ok(existsSync(join(ROOT, f)), f);
  });

  for (const [file, name] of Object.entries(LANGS)) {
    test(`${file} links to every other language and marks itself`, () => {
      const text = read(file);
      for (const [other, otherName] of Object.entries(LANGS)) {
        if (other === file) {
          assert.match(text, new RegExp(`<b>${otherName}</b>`), 'current language is shown in bold');
          assert.doesNotMatch(text, new RegExp(`href="${other.replace('.', '\\.')}"`), 'no link to itself');
        } else {
          assert.ok(text.includes(`<a href="${other}">${otherName}</a>`), `${file} -> ${other}`);
        }
      }
      assert.ok(name);
    });

    test(`${file} only links to files that exist`, () => {
      const text = read(file);
      const links = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
      const broken = links.filter(l => !/^(https?:|mailto:|#)/.test(l)).map(l => l.split('#')[0]).filter(l => !existsSync(join(ROOT, l)));
      assert.deepEqual(broken, []);
    });
  }

  test('all translations have the same structure as the English README', () => {
    const base = shape(read('README.md'));
    for (const f of Object.keys(LANGS)) assert.deepEqual(shape(read(f)), base, f);
  });

  test('all translations show the same commands', () => {
    for (const f of Object.keys(LANGS)) {
      const text = read(f);
      assert.ok(text.includes('open design/prototype.html'), f);
      assert.ok(text.includes('npm test'), f);
      assert.ok(text.includes('git commit -s'), f);
    }
  });

  test('the Arabic README reads right to left', () => {
    const text = read('README.ar.md');
    assert.ok(text.trimStart().startsWith('<div dir="rtl">'));
    assert.ok(text.trimEnd().endsWith('</div>'));
  });
});
