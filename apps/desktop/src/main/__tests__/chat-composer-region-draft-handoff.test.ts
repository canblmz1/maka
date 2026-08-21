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
import { afterEach, test } from 'node:test';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import { AstryxLocaleProvider, type ComposerHandle, LocaleProvider } from '@maka/ui';
import { ChatComposerRegion } from '../../renderer/chat-composer-region.js';
import {
  markNewTaskReloadIntent,
  UNRESOLVED_NEW_TASK_DRAFT_KEY,
  writeNewTaskReloadDraft,
} from '../../renderer/new-task-reload-intent.js';

const originalGlobals = {
  document: globalThis.document,
  window: globalThis.window,
  HTMLElement: globalThis.HTMLElement,
  HTMLIFrameElement: globalThis.HTMLIFrameElement,
  Event: globalThis.Event,
  Node: globalThis.Node,
  sessionStorage: globalThis.sessionStorage,
  matchMedia: globalThis.matchMedia,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  IS_REACT_ACT_ENVIRONMENT: (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT,
};

let mountedRoot: Root | undefined;

afterEach(async () => {
  if (mountedRoot) await act(() => mountedRoot?.unmount());
  mountedRoot = undefined;
  Object.assign(globalThis, originalGlobals);
});

test('hands off only the unresolved new-task draft while a Session is open', async () => {
  const { document, window } = parseHTML('<div id="root"></div>');
  const storage = new Map<string, string>();
  Object.assign(document, {
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {},
    }),
  });
  Object.assign(globalThis, {
    document,
    window,
    HTMLElement: window.HTMLElement,
    HTMLIFrameElement: window.HTMLIFrameElement ?? class HTMLIFrameElement {},
    Event: window.Event,
    Node: window.Node,
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const container = document.querySelector('#root');
  assert.ok(container);
  const root = createRoot(container);
  mountedRoot = root;
  const composer = createRef<ComposerHandle>();
  markNewTaskReloadIntent();
  writeNewTaskReloadDraft(UNRESOLVED_NEW_TASK_DRAFT_KEY, 'new task draft');

  const render = async (activeId: string | undefined, newTaskDraftKey: string) => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          {
            locale: 'en',
            children: createElement(AstryxLocaleProvider, {
              children: createElement(ChatComposerRegion, {
              composerRef: composer,
              active: true,
              onboardingComposerHidden: false,
              activeInteraction: undefined,
              activeId,
              newTaskDraftKey,
              stopPendingBySession: {},
              respondToSandboxBoundary: () => {},
              activeSandboxBoundary: undefined,
              activeQuestion: undefined,
              respondToUserQuestion: () => {},
              stop: () => {},
              onSend: () => {},
              onStop: () => {},
            }),
            }),
          },
        ),
      );
    });
  };

  await render('session-1', UNRESOLVED_NEW_TASK_DRAFT_KEY);
  await act(() => composer.current?.setText('session draft'));

  await render('session-1', 'new-task:local:project-1');
  await render(undefined, 'new-task:local:project-1');

  assert.equal(composer.current?.getText(), 'new task draft');
});
