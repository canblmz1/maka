/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  applyHeader,
  classifyExistingHeader,
  auditSourceFiles,
  classifyPath,
  commentStyleFor,
  exclusionRules,
  EntangledHeaderError,
  hasHeader,
  licenseLines,
  renderHeader,
} from './asf-license-headers.mjs';

const blockHeader = renderHeader('block');

describe('ASF header rendering', () => {
  test('renders the ASF text in each comment syntax', () => {
    assert.match(blockHeader, /^\/\*\n \* Licensed to the Apache Software Foundation \(ASF\)/);
    assert.match(
      blockHeader,
      / \*\n \*     http:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0\n \*\n/,
    );
    assert.match(blockHeader, /\n \* under the License\.\n \*\/\n$/);
    assert.match(renderHeader('hash'), /^# Licensed to the Apache Software Foundation \(ASF\)/);
    assert.match(
      renderHeader('hash'),
      /\n#\n#     http:\/\/www\.apache\.org\/licenses\/LICENSE-2\.0\n/,
    );
    assert.match(renderHeader('slash'), /^\/\/ Licensed to the Apache Software Foundation/);
    assert.match(renderHeader('html'), /^<!--\n {2}Licensed to the Apache Software Foundation/);
    assert.match(renderHeader('html'), /\n {2}under the License\.\n-->\n$/);
  });

  test('leaves no trailing whitespace on the blank comment lines', () => {
    for (const style of ['block', 'hash', 'slash', 'html']) {
      for (const line of renderHeader(style).split('\n')) {
        assert.equal(line, line.trimEnd(), `${style}: ${JSON.stringify(line)}`);
      }
    }
  });

  test('reproduces every line of the ASF header', () => {
    for (const line of licenseLines) {
      if (line) assert.ok(blockHeader.includes(line), line);
    }
  });
});

describe('ASF header application', () => {
  test('prepends the header and separates it from the body', () => {
    assert.equal(
      applyHeader("import 'node:fs';\n", 'block'),
      `${blockHeader}\nimport 'node:fs';\n`,
    );
  });

  test('is idempotent', () => {
    const once = applyHeader('const a = 1;\n', 'block');
    assert.equal(applyHeader(once, 'block'), once);
    assert.ok(hasHeader(once, 'block'));
  });

  test('keeps a shebang first', () => {
    const updated = applyHeader('#!/usr/bin/env node\nmain();\n', 'block');
    assert.equal(updated, `#!/usr/bin/env node\n${blockHeader}\nmain();\n`);
    assert.ok(hasHeader(updated, 'block'));
  });

  test('keeps an HTML doctype first', () => {
    const updated = applyHeader('<!doctype html>\n<html></html>\n', 'html');
    assert.equal(updated, `<!doctype html>\n${renderHeader('html')}\n<html></html>\n`);
    assert.ok(hasHeader(updated, 'html'));
  });

  test('keeps Markdown front matter first', () => {
    const source = '---\nname: skill\n---\n\n# Title\n';
    const updated = applyHeader(source, 'html');
    assert.ok(updated.startsWith('---\nname: skill\n---\n'));
    assert.equal(updated, `---\nname: skill\n---\n${renderHeader('html')}\n# Title\n`);
    assert.ok(hasHeader(updated, 'html'));
  });

  test('does not accept a header that is not at the top of the file', () => {
    assert.equal(hasHeader(`const a = 1;\n${blockHeader}`, 'block'), false);
  });

  test('handles an empty file without leaving a stray blank line', () => {
    assert.equal(applyHeader('', 'block'), blockHeader);
  });
});

/**
 * `.asf.yaml` already carried an ASF header before this policy existed. Matching
 * only the byte-exact rendering treated it as absent and prepended a second
 * license block, which the byte-exact audit then happily accepted.
 */
describe('ASF header formatting variants', () => {
  const variant = renderHeader('hash').replace(
    '#     http://www.apache.org/licenses/LICENSE-2.0',
    '#   http://www.apache.org/licenses/LICENSE-2.0',
  );

  test('recognizes a header that differs only in indentation', () => {
    assert.notEqual(variant, renderHeader('hash'));
    assert.equal(classifyExistingHeader(`${variant}\nkey: value\n`, 'hash').status, 'variant');
  });

  test('replaces the variant instead of adding a second header', () => {
    const updated = applyHeader(`${variant}\nkey: value\n`, 'hash');
    assert.equal(updated, `${renderHeader('hash')}\nkey: value\n`);
    assert.equal(updated.match(/Licensed to the Apache Software Foundation/g).length, 1);
    assert.equal(applyHeader(updated, 'hash'), updated);
  });

  test('leaves an unrelated comment that follows the header alone', () => {
    const source = `${variant}\n# Reference: https://example.invalid\n\nkey: value\n`;
    assert.equal(
      applyHeader(source, 'hash'),
      `${renderHeader('hash')}\n# Reference: https://example.invalid\n\nkey: value\n`,
    );
  });

  test('recognizes a block-comment variant', () => {
    const blockVariant = renderHeader('block').replace(/^ \* /gm, ' *  ');
    assert.equal(
      classifyExistingHeader(`${blockVariant}\nconst a = 1;\n`, 'block').status,
      'variant',
    );
    assert.equal(
      applyHeader(`${blockVariant}\nconst a = 1;\n`, 'block'),
      `${blockHeader}\nconst a = 1;\n`,
    );
  });

  test('refuses to rewrite a comment that mixes the license text with other content', () => {
    const mixed = `${variant}# Copyright 2020 Someone Else\n`;
    assert.equal(classifyExistingHeader(`${mixed}key: value\n`, 'hash').status, 'entangled');
    assert.throws(() => applyHeader(`${mixed}key: value\n`, 'hash'), EntangledHeaderError);
  });

  test('does not mistake an unrelated leading comment for a header', () => {
    assert.equal(classifyExistingHeader('# just a note\nkey: value\n', 'hash').status, 'absent');
    assert.equal(
      applyHeader('# just a note\nkey: value\n', 'hash'),
      `${renderHeader('hash')}\n# just a note\nkey: value\n`,
    );
  });
});

describe('ASF header classification', () => {
  test('covers product, script, and documentation source', () => {
    for (const path of [
      'packages/core/src/settings.ts',
      'apps/desktop/src/renderer/app-shell.tsx',
      'scripts/asf-source-release.mjs',
      'experiments/windows-sandbox/launcher/src/main.rs',
      'packages/eval/harbor/egress-proxy/Dockerfile',
      'packages/eval/harbor/egress-proxy/network-policy',
      '.github/workflows/ci.yml',
      'README.md',
    ]) {
      assert.equal(classifyPath(path).status, 'covered', path);
    }
  });

  test('excludes the reviewed categories', () => {
    const excluded = {
      LICENSE: 'asf-release-documents',
      'package.json': 'no-comment-syntax',
      'apps/desktop/assets/icon.png': 'binary-files',
      'patches/node-pty+1.2.0-beta.15.patch': 'third-party-source',
      'packages/ui/src/astryx-chat-reasoning.tsx': 'third-party-source',
      'packages/core/src/model-metadata.generated.ts': 'generated-files',
      'packages/runtime/resources/bundled-skills/computer-use/SKILL.md':
        'verbatim-runtime-payloads',
      '.github/pull_request_template.md': 'verbatim-github-templates',
      'packages/storage/test-fixtures/workflow-schema-v8.sql': 'byte-significant-fixtures',
      '.gitattributes': 'no-creative-content',
      'apps/desktop/.gitignore': 'no-creative-content',
      '.claude/launch.json': 'not-in-source-release',
    };
    for (const [path, rule] of Object.entries(excluded)) {
      assert.deepEqual(classifyPath(path), { rule, status: 'excluded' }, path);
    }
  });

  test('keeps Maka-authored files out of the third-party and fixture rules', () => {
    assert.equal(classifyPath('patches/README.md').status, 'covered');
    assert.equal(
      classifyPath('docs/eval/terminal-bench-2.1-maka-vs-kimi-code-v11.md').status,
      'covered',
    );
  });

  test('leaves an unknown file type unclassified so the audit fails closed', () => {
    assert.equal(classifyPath('vendor/thing.kt').status, 'unclassified');
    assert.equal(commentStyleFor('vendor/thing.kt'), undefined);
  });

  test('gives every exclusion rule a unique id and a justification', () => {
    const ids = new Set();
    for (const rule of exclusionRules) {
      assert.equal(ids.has(rule.id), false, rule.id);
      ids.add(rule.id);
      assert.ok(rule.justification.length > 60, rule.id);
      assert.equal(typeof rule.matches, 'function', rule.id);
    }
  });
});

describe('ASF header audit', () => {
  test('reports unclassified files separately from missing headers', () => {
    const result = auditSourceFiles({
      files: ['LICENSE', 'packages/core/src/settings.ts', 'vendor/thing.kt'],
      mode: 'archive',
    });
    assert.deepEqual(result.unclassified, ['vendor/thing.kt']);
    assert.equal(result.covered, 1);
    assert.deepEqual(result.excludedByRule.get('asf-release-documents'), ['LICENSE']);
  });

  test('reports an exclusion rule that matches nothing in a checkout', () => {
    const result = auditSourceFiles({ files: ['LICENSE'], mode: 'checkout' });
    assert.equal(result.staleRules.includes('asf-release-documents'), false);
    assert.ok(result.staleRules.includes('binary-files'));
  });

  test('starts with no entangled files', () => {
    const result = auditSourceFiles({ files: ['LICENSE'], mode: 'archive' });
    assert.deepEqual(result.entangled, []);
  });

  test('does not call an archive-absent rule stale', () => {
    const result = auditSourceFiles({ files: ['LICENSE'], mode: 'archive' });
    assert.deepEqual(result.staleRules, []);
  });
});
