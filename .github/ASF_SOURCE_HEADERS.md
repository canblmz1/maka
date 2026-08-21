<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# ASF source header policy

Apache Maka (Incubating) applies the [ASF source header policy](https://www.apache.org/legal/src-headers.html) to its source release and enforces it with an automated audit.

`scripts/asf-license-headers.mjs` is the policy. This document explains it; the script decides it. Where the two disagree, the script is authoritative and this document is the bug.

## The audit

```sh
npm run check:asf-headers          # audit; fails on anything unresolved
npm run check:asf-headers -- --report
npm run write:asf-headers          # apply the header to every covered file
```

Every file is classified exactly once:

- **covered** — the file type carries the ASF header. Missing it fails the audit.
- **excluded** — the file matches one reviewed exclusion rule that records why the header does not belong there.
- **unclassified** — neither. This fails the audit.

Unclassified is the point of the design. A new file extension, or a new file in a place nobody considered, cannot reach a release candidate until someone decides which of the two it is and writes that decision down. Exclusions are a list of reasons, not a list of paths that happened to be noisy.

The audit also fails when an exclusion rule matches nothing in a Git checkout, so the reviewed list cannot quietly accumulate rules for files that no longer exist.

## Where the audit runs

- **Every pull request**, over the checkout. This keeps new files from landing without a header.
- **`Prepare ASF source candidate`**, over the extracted `apache-maka-<version>-incubating-src.tar.gz`, before anything is installed or built into that tree. The release gate therefore reads the exact bytes a voter downloads, not a convenient approximation of them.

In a checkout the audit reads tracked files plus untracked files Git would not ignore, so a new file is audited before it is ever staged while ignored local scratch files stay out of the gate. An extracted archive has no index, so every file on disk is audited.

## Covered file types

| Comment syntax | Extensions |
| --- | --- |
| `/* … */` | `.cjs`, `.css`, `.js`, `.mjs`, `.mts`, `.rs`, `.swift`, `.ts`, `.tsx` |
| `//` | `.jsonc` |
| `#` | `.ps1`, `.py`, `.sh`, `.toml`, `.yaml`, `.yml`, `Dockerfile`, `network-policy` |
| `<!-- … -->` | `.html`, `.md` |

An interpreter shebang, an HTML doctype, and Markdown YAML front matter must open their file, so the header follows directly below them.

The audit requires one exact rendering, so the tree holds one form of the header rather than a drift of near-identical ones. A file that already carries the ASF text in a different formatting variant — a different indentation of the license URL, say — is recognized as a header and **rewritten** into the canonical form, never given a second one. When the leading comment mixes the ASF text with other content, `write` refuses and the audit reports it: separating a license header from a copyright line someone else holds is a decision, not a rewrite.

## Reviewed exclusions

Each rule below is a category with a justification, not an ad-hoc path list. `npm run check:asf-headers -- --report` prints the resolved file list for every rule.

| Rule | Why the header does not belong |
| --- | --- |
| `not-in-source-release` | `export-ignore` in `.gitattributes` keeps these out of the archive: repository-local agent configuration, visual review evidence, and incubation working notes. |
| `asf-release-documents` | `LICENSE`, `NOTICE`, and `DISCLAIMER-WIP` are the license and notice themselves. |
| `third-party-license-texts` | Verbatim upstream license and notice texts. They must stay byte-identical to what upstream published, and the executor preparation scripts verify their digests. |
| `third-party-source` | Third-party work kept under its own license, and diffs against third-party sources. Maka may not assert an ASF header over them. Their license classification belongs to the `NOTICE` audit (#3270), not to this gate. |
| `generated-files` | Mechanically derived and byte-compared against a fresh generator run, so a hand-written header would be reverted by the next regeneration. The generators carry the header. |
| `verbatim-runtime-payloads` | Bundled skill payloads are embedded in the generated catalog verbatim, pinned by content digest, and delivered to the model as instructions. |
| `verbatim-github-templates` | GitHub copies the pull request template into every new pull request description. |
| `byte-significant-fixtures` | Recorded inputs and captured historical state, asserted on byte-for-byte or parsed by a strict reader. |
| `no-comment-syntax` | JSON and CSV have no comment syntax; a header could only be added by corrupting the file for its parser. |
| `binary-files` | Binary content cannot carry a text header. |
| `no-creative-content` | Version-control metadata and platform manifests whose content is a list of names or required platform keys. Apache RAT excludes the same kind of file by default. |

## Changing the policy

Adding a file type means adding it to `coveredExtensions` or `coveredNames` and running `npm run write:asf-headers`.

Adding an exclusion means adding a rule with an `id` and a `justification` that a mentor can evaluate without reading the code around it. "The audit failed on it" is not a justification. If a file is source that Maka wrote, it gets the header.
