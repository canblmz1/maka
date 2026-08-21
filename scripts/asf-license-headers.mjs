#!/usr/bin/env node
/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * ASF source-header audit.
 *
 * Every file in the source release is classified exactly once: it either
 * carries the standard ASF header, or it matches one reviewed exclusion rule
 * that states why it does not. A file matching neither is an audit failure, so
 * a new file type or a new unexpected path cannot enter a release candidate
 * without someone recording a decision about it.
 *
 * The audit is the release gate, and `write` applies the same policy, so the
 * header text and the covered set have a single definition. See
 * `.github/ASF_SOURCE_HEADERS.md` for the policy this file implements.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRepoRoot = resolve(import.meta.dirname, '..');
const maxCommandBuffer = 64 * 1024 * 1024;

/**
 * The header from https://www.apache.org/legal/src-headers.html, verbatim.
 * An empty string renders as a comment line with no trailing whitespace.
 */
export const licenseLines = [
  'Licensed to the Apache Software Foundation (ASF) under one',
  'or more contributor license agreements.  See the NOTICE file',
  'distributed with this work for additional information',
  'regarding copyright ownership.  The ASF licenses this file',
  'to you under the Apache License, Version 2.0 (the',
  '"License"); you may not use this file except in compliance',
  'with the License.  You may obtain a copy of the License at',
  '',
  '    http://www.apache.org/licenses/LICENSE-2.0',
  '',
  'Unless required by applicable law or agreed to in writing,',
  'software distributed under the License is distributed on an',
  '"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY',
  'KIND, either express or implied.  See the License for the',
  'specific language governing permissions and limitations',
  'under the License.',
];

/**
 * Comment syntaxes the header is rendered into. `prefixPattern` matches the
 * lines that must stay first in the file — an interpreter shebang or an HTML
 * doctype — so the header goes directly below them instead of breaking them.
 */
const commentStyles = {
  block: { open: '/*', line: ' *', close: ' */', prefixPattern: /^#![^\n]*\n/ },
  slash: { linePrefix: '//' },
  hash: { linePrefix: '#', prefixPattern: /^#![^\n]*\n/ },
  // A doctype must open an HTML file, and YAML front matter must open a
  // Markdown file, so the header follows either one.
  html: {
    open: '<!--',
    line: ' ',
    close: '-->',
    prefixPattern: /^(?:<!doctype html>\n|---\n[\s\S]*?\n---\n)/i,
  },
};

/**
 * File extensions covered by the header policy, and the comment syntax used
 * for each. A covered file must carry the header; nothing else may.
 */
const coveredExtensions = new Map([
  ['.cjs', 'block'],
  ['.css', 'block'],
  ['.html', 'html'],
  ['.js', 'block'],
  ['.jsonc', 'slash'],
  ['.md', 'html'],
  ['.mjs', 'block'],
  ['.mts', 'block'],
  ['.ps1', 'hash'],
  ['.py', 'hash'],
  ['.rs', 'block'],
  ['.sh', 'hash'],
  ['.swift', 'block'],
  ['.toml', 'hash'],
  ['.ts', 'block'],
  ['.tsx', 'block'],
  ['.yaml', 'hash'],
  ['.yml', 'hash'],
]);

/** Covered files whose name carries no extension. */
const coveredNames = new Map([
  ['Dockerfile', 'hash'],
  // A POSIX shell script that the Eval egress sidecar invokes by name.
  ['network-policy', 'hash'],
]);

const startsWith = (prefix) => (path) => path === prefix || path.startsWith(`${prefix}/`);
const hasExtension =
  (...extensions) =>
  (path) =>
    extensions.some((extension) => path.endsWith(extension));
const isOneOf = (...paths) => {
  const set = new Set(paths);
  return (path) => set.has(path);
};
const isNamed = (...names) => {
  const set = new Set(names);
  return (path) => set.has(basename(path));
};

/**
 * The reviewed exclusion list. Order matters only for reporting: a file is
 * attributed to the first rule that matches it.
 *
 * `checkoutOnly` marks rules for paths that `.gitattributes` keeps out of the
 * source archive. They exist in a Git checkout and must still be classified
 * there, but they are legitimately absent from the audited archive.
 */
export const exclusionRules = [
  {
    id: 'not-in-source-release',
    checkoutOnly: true,
    justification:
      'Kept out of the source archive by `export-ignore` in `.gitattributes`: repository-local agent configuration, visual review evidence, and incubation working notes are not release inputs.',
    matches: (path) =>
      startsWith('.claude')(path) ||
      startsWith('.maka-shots')(path) ||
      isOneOf('maka-proposal-zh-review.txt')(path),
  },
  {
    id: 'asf-release-documents',
    justification:
      'These files are the license, notice, and incubation disclosure themselves. ASF policy fixes their contents, so a header inside them would be circular.',
    matches: isOneOf('DISCLAIMER-WIP', 'LICENSE', 'NOTICE'),
  },
  {
    id: 'third-party-license-texts',
    justification:
      'Verbatim upstream license and notice texts redistributed with the product. They have to stay byte-identical to what the upstream project published, and the executor preparation scripts verify their digests.',
    matches: (path) =>
      startsWith('apps/desktop/resources/licenses')(path) ||
      isOneOf(
        'apps/desktop/src/renderer/public/THIRD_PARTY_LICENSES.txt',
        'packages/cli/THIRD_PARTY_NOTICES.txt',
      )(path),
  },
  {
    id: 'third-party-source',
    justification:
      'Work of third parties kept under its own license, plus diffs against third-party sources. Maka may not assert an ASF header over them, and the upstream notice has to survive intact. Their license classification belongs to the NOTICE audit, not to this gate.',
    matches: (path) =>
      isOneOf(
        'experiments/windows-sandbox/launcher/Cargo.lock',
        'packages/ui/src/astryx-chat-reasoning.tsx',
      )(path) ||
      startsWith('apps/desktop/src/renderer/assets/provider-brands')(path) ||
      (startsWith('patches')(path) && path.endsWith('.patch')),
  },
  {
    id: 'generated-files',
    justification:
      'Mechanically derived from a generator in this repository, and byte-compared against a fresh run by a `check:` script. A hand-written header would be reverted by the next regeneration; the generators themselves carry the header.',
    matches: isOneOf(
      'apps/desktop/src/renderer/astryx-theme/maka.css',
      'apps/desktop/src/renderer/astryx-theme/maka.d.ts',
      'apps/desktop/src/renderer/astryx-theme/maka.js',
      'docs/astryx-surface-file-inventory.md',
      'docs/astryx-surface-file-inventory.paths',
      'docs/windows-test-inventory.md',
      'packages/core/src/model-metadata.generated.ts',
      'packages/runtime/src/bundled-skill-catalog.generated.ts',
      'packages/runtime/src/telemetry/model-pricing.generated.ts',
    ),
  },
  {
    id: 'verbatim-runtime-payloads',
    justification:
      'Bundled skill payloads are embedded in the generated catalog verbatim, pinned by content digest, and delivered to the model as instructions. A header here would be republished as agent prompt text and would invalidate the recorded digests.',
    matches: startsWith('packages/runtime/resources/bundled-skills'),
  },
  {
    id: 'verbatim-github-templates',
    justification:
      'GitHub copies this file into every new pull request description. A header here would be republished into unrelated prose instead of licensing a source file.',
    matches: isOneOf('.github/pull_request_template.md'),
  },
  {
    id: 'byte-significant-fixtures',
    justification:
      'Recorded inputs and captured historical state. Tests assert on their exact bytes or parse them with a strict reader, and their value is that they reproduce what a real system produced rather than that they are authored source.',
    matches: (path) =>
      isOneOf(
        'packages/storage/src/__tests__/fixtures/codex-rollout-v0.144.jsonl',
        'packages/storage/test-fixtures/v0.1.6-operational-state/runtime.sqlite',
        'packages/storage/test-fixtures/workflow-schema-v8.sql',
      )(path) ||
      (startsWith('docs/eval')(path) && path.endsWith('.csv')),
  },
  {
    id: 'no-comment-syntax',
    justification:
      'The format has no comment syntax, so a header could only be added by corrupting the file for its parser.',
    matches: hasExtension('.csv', '.json', '.jsonl', '.paths'),
  },
  {
    id: 'binary-files',
    justification:
      'Binary image and database content. There is no text position in these formats where a header could be added without corrupting the file.',
    matches: hasExtension('.png', '.sqlite'),
  },
  {
    id: 'no-creative-content',
    justification:
      'Version-control metadata and platform manifests whose content is a list of names or required platform keys. Apache RAT excludes the same kind of file by default.',
    matches: (path) =>
      isNamed('.gitignore')(path) ||
      isOneOf(
        '.git-blame-ignore-revs',
        '.gitattributes',
        '.mailmap',
        'apps/desktop/build/entitlements.mac.inherit.plist',
        'apps/desktop/build/entitlements.mac.plist',
      )(path),
  },
];

/**
 * Directories that never enter the source archive. `verifySourceCandidate`
 * already rejects an archive that contains them, so skipping them here only
 * affects a working checkout that has been built or installed into.
 */
const buildOutputDirectories = new Set([
  '.git',
  'dist',
  'dist-renderer',
  'node_modules',
  'release',
  'storybook-static',
  'test-results',
]);

export function renderHeader(styleName) {
  const style = commentStyles[styleName];
  if (!style) throw new Error(`Unknown comment style: ${styleName}`);
  if (style.linePrefix) {
    const body = licenseLines
      .map((text) => (text ? `${style.linePrefix} ${text}` : style.linePrefix))
      .join('\n');
    return `${body}\n`;
  }
  const body = licenseLines
    .map((text) => (text ? `${style.line} ${text}` : style.line.trimEnd()))
    .join('\n');
  return `${style.open}\n${body}\n${style.close}\n`;
}

export function commentStyleFor(path) {
  const name = basename(path);
  if (coveredNames.has(name)) return coveredNames.get(name);
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  return coveredExtensions.get(extension);
}

export function classifyPath(path) {
  const rule = exclusionRules.find((candidate) => candidate.matches(path));
  if (rule) return { rule: rule.id, status: 'excluded' };
  const style = commentStyleFor(path);
  if (style) return { status: 'covered', style };
  return { status: 'unclassified' };
}

/**
 * The header must be the first thing in the file apart from a shebang or a
 * doctype. Accepting it anywhere else would let `write` insert a second copy.
 */
export function findHeaderOffset(contents, styleName) {
  const style = commentStyles[styleName];
  const prefix = style.prefixPattern?.exec(contents)?.[0] ?? '';
  return contents.startsWith(renderHeader(styleName), prefix.length) ? prefix.length : -1;
}

export function hasHeader(contents, styleName) {
  return findHeaderOffset(contents, styleName) >= 0;
}

/** The header as prose: comment syntax, indentation, and line wrapping removed. */
function normalizeCommentText(text, styleName) {
  const style = commentStyles[styleName];
  return text
    .split('\n')
    .map((line) => {
      if (style.linePrefix) {
        return line.startsWith(style.linePrefix) ? line.slice(style.linePrefix.length) : line;
      }
      const trimmed = line.trim();
      if (trimmed === style.open || trimmed === style.close.trim()) return '';
      return line.replace(/^\s*\*/, '');
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalizedLicense = normalizeCommentText(licenseLines.join('\n'), 'html');

/** The leading comment of a file, before any code. */
function leadingComment(contents, styleName) {
  const style = commentStyles[styleName];
  const prefix = style.prefixPattern?.exec(contents)?.[0] ?? '';
  const body = contents.slice(prefix.length);
  if (style.linePrefix) {
    const lines = body.split('\n');
    let end = 0;
    while (end < lines.length && lines[end].startsWith(style.linePrefix)) end += 1;
    if (end === 0) return undefined;
    return { prefix, rest: lines.slice(end).join('\n'), text: lines.slice(0, end).join('\n') };
  }
  if (!body.startsWith(`${style.open}\n`)) return undefined;
  const close = body.indexOf(`\n${style.close}\n`);
  if (close < 0) return undefined;
  const length = close + style.close.length + 2;
  return { prefix, rest: body.slice(length), text: body.slice(0, length) };
}

/**
 * Whether a file already carries the ASF header, allowing for the formatting
 * variants other ASF projects use. Byte-exact matching alone would treat a
 * valid existing header as absent and prepend a second one.
 */
export function classifyExistingHeader(contents, styleName) {
  if (hasHeader(contents, styleName)) return { status: 'canonical' };
  const comment = leadingComment(contents, styleName);
  if (!comment) return { status: 'absent' };
  const normalized = normalizeCommentText(comment.text, styleName);
  if (normalized === normalizedLicense) return { comment, status: 'variant' };
  if (normalized.includes(normalizedLicense)) return { comment, status: 'entangled' };
  return { status: 'absent' };
}

export class EntangledHeaderError extends Error {
  constructor() {
    super(
      'the leading comment carries the ASF license text together with other content; separate them by hand',
    );
    this.name = 'EntangledHeaderError';
  }
}

export function applyHeader(contents, styleName) {
  const existing = classifyExistingHeader(contents, styleName);
  if (existing.status === 'canonical') return contents;
  if (existing.status === 'entangled') throw new EntangledHeaderError();
  const style = commentStyles[styleName];
  // A variant header is replaced rather than kept, so the tree holds exactly
  // one rendering of the header and the audit can stay byte-exact.
  const { prefix, rest } =
    existing.status === 'variant'
      ? existing.comment
      : {
          prefix: style.prefixPattern?.exec(contents)?.[0] ?? '',
          rest: contents.slice((style.prefixPattern?.exec(contents)?.[0] ?? '').length),
        };
  const separator = rest.trimStart() === '' ? '' : '\n';
  return `${prefix}${renderHeader(styleName)}${separator}${rest.replace(/^\n+/, '')}`;
}

/**
 * Tracked files plus untracked files Git would not ignore. A new file is
 * therefore audited before it is ever staged, while ignored local scratch
 * files stay out of the gate entirely.
 */
function listCheckoutFiles(root) {
  const names = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: maxCommandBuffer },
  )
    .split('\0')
    .filter(Boolean);
  return [...new Set(names)].sort();
}

function listArchiveFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : 1,
    )) {
      if (entry.isDirectory()) {
        if (buildOutputDirectories.has(entry.name)) continue;
        walk(join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(relative(root, join(directory, entry.name)).split(sep).join('/'));
    }
  };
  walk(root);
  return files;
}

/**
 * A checkout is audited through Git so that ignored local scratch files cannot
 * fail the gate. An extracted archive has no index, so every file on disk is
 * audited.
 */
export function listSourceFiles(root) {
  if (existsSync(join(root, '.git'))) {
    return { files: listCheckoutFiles(root), mode: 'checkout' };
  }
  return { files: listArchiveFiles(root), mode: 'archive' };
}

export function auditSourceFiles({ files, mode }) {
  const missing = [];
  const unclassified = [];
  const excludedByRule = new Map();
  let covered = 0;

  for (const path of files) {
    const classification = classifyPath(path);
    if (classification.status === 'unclassified') {
      unclassified.push(path);
      continue;
    }
    if (classification.status === 'excluded') {
      const paths = excludedByRule.get(classification.rule) ?? [];
      paths.push(path);
      excludedByRule.set(classification.rule, paths);
      continue;
    }
    covered += 1;
  }

  const staleRules =
    mode === 'checkout'
      ? exclusionRules.filter((rule) => !excludedByRule.has(rule.id)).map((rule) => rule.id)
      : [];

  return { covered, entangled: [], excludedByRule, missing, staleRules, unclassified };
}

export function auditTree({ root = defaultRepoRoot } = {}) {
  const listing = listSourceFiles(root);
  const result = auditSourceFiles(listing);
  for (const path of listing.files) {
    const classification = classifyPath(path);
    if (classification.status !== 'covered') continue;
    const contents = readFileSync(join(root, path), 'utf8');
    const existing = classifyExistingHeader(contents, classification.style);
    if (existing.status === 'canonical') continue;
    if (existing.status === 'entangled') result.entangled.push(path);
    else result.missing.push(path);
  }
  return { ...result, mode: listing.mode, root };
}

export function writeHeaders({ root = defaultRepoRoot } = {}) {
  const { files } = listSourceFiles(root);
  const changed = [];
  for (const path of files) {
    const classification = classifyPath(path);
    if (classification.status !== 'covered') continue;
    const absolutePath = join(root, path);
    const contents = readFileSync(absolutePath, 'utf8');
    let updated;
    try {
      updated = applyHeader(contents, classification.style);
    } catch (error) {
      if (error instanceof EntangledHeaderError) throw new Error(`${path}: ${error.message}`);
      throw error;
    }
    if (updated === contents) continue;
    writeFileSync(absolutePath, updated);
    changed.push(path);
  }
  return changed;
}

function reportExclusions(result) {
  console.log('Reviewed exclusions:');
  for (const rule of exclusionRules) {
    const paths = result.excludedByRule.get(rule.id) ?? [];
    console.log(`  ${rule.id}: ${paths.length} file(s)`);
    console.log(`    ${rule.justification}`);
    for (const path of paths) console.log(`      ${path}`);
  }
}

function runCheck({ report, root }) {
  const result = auditTree({ root });
  const excluded = [...result.excludedByRule.values()].reduce(
    (total, paths) => total + paths.length,
    0,
  );
  console.log(
    `Audited ${result.covered} covered and ${excluded} excluded file(s) in ${result.mode} mode at ${result.root}`,
  );
  if (report) reportExclusions(result);

  let failed = false;
  if (result.unclassified.length > 0) {
    failed = true;
    console.error(
      `\n${result.unclassified.length} file(s) match no header rule and no reviewed exclusion. Cover the file type or record an exclusion with its justification in scripts/asf-license-headers.mjs:`,
    );
    for (const path of result.unclassified) console.error(`  ${path}`);
  }
  if (result.entangled.length > 0) {
    failed = true;
    console.error(
      `\n${result.entangled.length} file(s) carry the ASF license text mixed into a larger leading comment. Separate the header from the rest of that comment by hand:`,
    );
    for (const path of result.entangled) console.error(`  ${path}`);
  }
  if (result.missing.length > 0) {
    failed = true;
    console.error(
      `\n${result.missing.length} covered file(s) are missing the ASF license header. Run \`npm run write:asf-headers\`:`,
    );
    for (const path of result.missing) console.error(`  ${path}`);
  }
  if (result.staleRules.length > 0) {
    failed = true;
    console.error(
      `\n${result.staleRules.length} exclusion rule(s) match nothing and should be removed: ${result.staleRules.join(', ')}`,
    );
  }
  if (failed) process.exitCode = 1;
  else console.log('Every source file carries the ASF header or a reviewed exclusion.');
}

function parseCommandLine(arguments_) {
  const [command, ...tokens] = arguments_;
  let report = false;
  let root = defaultRepoRoot;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--report') {
      report = true;
      continue;
    }
    if (token === '--root') {
      const value = tokens[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --root');
      root = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unexpected argument: ${token}`);
  }
  return { command, report, root };
}

function main() {
  const { command, report, root } = parseCommandLine(process.argv.slice(2));
  if (!statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  if (command === 'check') {
    runCheck({ report, root });
    return;
  }
  if (command === 'write') {
    const changed = writeHeaders({ root });
    console.log(`Added the ASF header to ${changed.length} file(s)`);
    for (const path of changed) console.log(`  ${path}`);
    return;
  }
  throw new Error('Usage: asf-license-headers.mjs <check|write> [--root <dir>] [--report]');
}

if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
