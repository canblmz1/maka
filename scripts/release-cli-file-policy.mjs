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

const DEVELOPMENT_DIRECTORIES = new Set([
  '.nyc_output',
  '__fixtures__',
  '__tests__',
  'coverage',
  'fixture',
  'fixtures',
  'test',
  'tests',
]);

export function isThirdPartyDevelopmentArtifact(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => DEVELOPMENT_DIRECTORIES.has(segment))) return true;

  const file = segments.at(-1) ?? '';
  return (
    /\.(?:spec|test)\.(?:cjs|js|mjs)$/.test(file) ||
    /\.d\.ts(?:\.map)?$/.test(file) ||
    /\.(?:cjs|js|mjs)\.map$/.test(file) ||
    /\.(?:cts|mts|ts|tsx)$/.test(file) ||
    file.endsWith('.tsbuildinfo')
  );
}

// Modules that only a test or E2E entry point may import. They are a
// Maka-owned convention, so they are not part of DEVELOPMENT_DIRECTORIES: a
// third-party package is free to ship a directory by that name.
const MAKA_TEST_ONLY_DIRECTORY = 'test-only';

export function isMakaDevelopmentArtifact(relativePath) {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => segment === 'src')) return true;
  if (segments.some((segment) => segment === MAKA_TEST_ONLY_DIRECTORY)) return true;
  if (segments.some((segment) => DEVELOPMENT_DIRECTORIES.has(segment))) return true;

  const file = segments.at(-1) ?? '';
  return (
    file === 'dev-cli.js' ||
    /\.(?:spec|test)\.js$/.test(file) ||
    /\.d\.ts(?:\.map)?$/.test(file) ||
    /\.js\.map$/.test(file)
  );
}
