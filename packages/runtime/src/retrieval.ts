import { DomainError, MemoryBook, type Memory } from '@life-agent/core';
import type { Models } from './providers.js';
import { randomUUID } from 'node:crypto';
// Unknown adapters get object-scoped identities: safe across changes/restarts, never reuse
// persisted vectors on a guessed constructor-name match. Adapters can supply stable keys.
const anonymousModelKeys=new WeakMap<object,string>();
function modelKey(models:Pick<Models,'embed'|'embeddingModelKey'>){if(models.embeddingModelKey?.trim())return models.embeddingModelKey;let key=anonymousModelKeys.get(models);if(!key){key=`anonymous:${models.constructor.name}:${randomUUID()}`;anonymousModelKeys.set(models,key);}return key;}

/** Derived private data. These properties belong only inside the encrypted aggregate. */
export type EmbeddedMemory = Memory & { embedding?: number[]; embeddingContent?: string };
export type SemanticOptions = { domain?: string; now?: number; queryVector?: number[] };
export type SemanticBook = MemoryBook & {
  retrieve(query: string, options?: SemanticOptions): ReturnType<MemoryBook['retrieve']>;
};

export function validVector(vector: unknown): vector is number[] {
  return Array.isArray(vector) && vector.length === 1024 && vector.every(value => typeof value === 'number' && Number.isFinite(value));
}

/**
 * Provider failures propagate; no keyword-only or demo fallback is disguised as semantic retrieval.
 * Cache writes are staged so one failed embedding cannot leave partially modified memory state.
 * Pending, historical, archived, deleted and foreign-user contents never reach the provider.
 */
export async function retrieveForChat(book: SemanticBook, query: string, models: Pick<Models, 'embed'|'embeddingModelKey'>, options: Omit<SemanticOptions, 'queryVector'> = {}) {
  const initial = book.retrieve(query, options);
  if (!initial.safeToAdvise) return initial;
  const eligible = (book.memories as EmbeddedMemory[])
    .filter(memory => memory.userId === book.userId && !book.deleted.has(memory.id) && (memory.state === 'active' || memory.state === 'faded'))
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt) || a.id.localeCompare(b.id));
  // Explicitly reject oversized collections rather than silently claiming complete retrieval.
  if (eligible.length > 256) throw new DomainError('RETRIEVAL_CAPACITY', '检索候选超过 256 条，请先整理记忆；本轮暂停建议', 503);
  const embeddingModelKey=modelKey(models);
  const queryVector = await models.embed(query);
  if (!validVector(queryVector)) throw new DomainError('EMBED_FORMAT', '查询向量必须为 1024 维有限数值', 503);
  const staged: {memory: EmbeddedMemory; vector: number[]}[] = [];
  for (const memory of eligible) {
    if (validVector(memory.embedding) && memory.embeddingContent === memory.content && memory.embeddingModelKey === embeddingModelKey) continue;
    const vector = await models.embed(memory.content);
    if (!validVector(vector)) throw new DomainError('EMBED_FORMAT', '记忆向量必须为 1024 维有限数值', 503);
    staged.push({memory, vector});
  }
  for (const {memory, vector} of staged) {
    memory.embedding = vector;
    memory.embeddingContent = memory.content;
    memory.embeddingModelKey = embeddingModelKey;
  }
  return book.retrieve(query, {...options, queryVector});
}

/** Owner UI/export gets no vectors or plaintext cache key copies. */
export function publicMemory(memory: Memory): Memory {
  const {embedding: _embedding, embeddingContent: _content, embeddingModelKey: _modelKey, ...visible} = memory as EmbeddedMemory;
  return visible;
}
