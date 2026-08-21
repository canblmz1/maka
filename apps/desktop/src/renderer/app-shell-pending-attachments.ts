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

export type PendingByKey<T> = Record<string, T[]>;

export function selectPending<T>(map: PendingByKey<T>, key: string): T[] {
  return map[key] ?? [];
}

export function appendPending<T>(
  map: PendingByKey<T>,
  key: string,
  items: readonly T[],
): PendingByKey<T> {
  return { ...map, [key]: [...(map[key] ?? []), ...items] };
}

export function removePending<T>(map: PendingByKey<T>, key: string, index: number): PendingByKey<T> {
  const current = map[key] ?? [];
  return { ...map, [key]: current.filter((_, i) => i !== index) };
}

export function removePendingItems<T>(
  map: PendingByKey<T>,
  key: string,
  items: readonly T[],
  identityOf: (item: T) => unknown = (item) => item,
): PendingByKey<T> {
  const submitted = new Set(items.map(identityOf));
  const remaining = (map[key] ?? []).filter((item) => !submitted.has(identityOf(item)));
  if (remaining.length === 0) return clearPending(map, key);
  return { ...map, [key]: remaining };
}

export function clearPending<T>(map: PendingByKey<T>, key: string): PendingByKey<T> {
  const next = { ...map };
  delete next[key];
  return next;
}
