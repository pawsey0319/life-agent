import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError } from './index.js';

export const authorizationFieldIds = ['schedule', 'habit_completion', 'records', 'health', 'raw_messages', 'secrets'] as const;
export const fieldRegistrySchema = z.object({
  version: z.number().int().positive(),
  fields: z.array(z.object({ id: z.enum(authorizationFieldIds), sensitivity: z.enum(['normal', 'sensitive', 'raw', 'forbidden']) }).strict()).min(1),
}).strict().superRefine((registry, ctx) => {
  const seen = new Set<string>();
  for (const field of registry.fields) {
    if (seen.has(field.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate field', path: ['fields'] });
    seen.add(field.id);
    if ((field.id === 'raw_messages' && field.sensitivity !== 'raw') || (field.id === 'secrets' && field.sensitivity !== 'forbidden') || (field.id === 'health' && field.sensitivity !== 'sensitive')) ctx.addIssue({ code: 'custom', message: 'Protected field sensitivity cannot be downgraded', path: ['fields'] });
  }
});
export type FieldRegistry = z.infer<typeof fieldRegistrySchema>;
export const defaultFieldRegistry: FieldRegistry = { version: 1, fields: [{ id: 'schedule', sensitivity: 'normal' }, { id: 'habit_completion', sensitivity: 'normal' }, { id: 'records', sensitivity: 'normal' }, { id: 'health', sensitivity: 'sensitive' }, { id: 'raw_messages', sensitivity: 'raw' }, { id: 'secrets', sensitivity: 'forbidden' }] };
export type VersionedBlockIdentity = { id: string; status: 'active' | 'paused'; external?: boolean; purposes: string[]; manifestVersion?: number; manifestFields?: string[] };
export type AuthorizationInput = { sourceBlockId: string; granteeBlockId: string; field: string; purpose: string; timeRange?: { from: string; to: string }; sessionId?: string };
export type AuthorizationBinding = { fieldRegistryVersion: number; sourceManifestVersion: number; granteeManifestVersion: number; policyFingerprint: string };
export type VersionedGrantRequest = AuthorizationInput & AuthorizationBinding & { id: string; status: 'pending' | 'allowed' | 'denied' | 'consumed' | 'reconsent'; expiresAt: string };
export type VersionedGrant = AuthorizationInput & AuthorizationBinding & { id: string; createdAt: string; status?: 'active' | 'reconsent' };
export type AuthorizationAudit = { id: string; action: string; at: string; requestId?: string; field?: string };
const now = () => new Date().toISOString();
// Construct every property explicitly: JSON property ordering supplied by callers is irrelevant.
const exactScope = (x: AuthorizationInput) => JSON.stringify([x.sourceBlockId, x.granteeBlockId, x.field, x.purpose, x.sessionId ?? null, x.timeRange ? [x.timeRange.from, x.timeRange.to] : null]);
const copyScope = (x: AuthorizationInput): AuthorizationInput => ({ sourceBlockId: x.sourceBlockId, granteeBlockId: x.granteeBlockId, field: x.field, purpose: x.purpose, ...(x.sessionId !== undefined ? { sessionId: x.sessionId } : {}), ...(x.timeRange ? { timeRange: { from: x.timeRange.from, to: x.timeRange.to } } : {}) });
const identityPolicy = (block: VersionedBlockIdentity) => [block.id, block.external === true, [...new Set(block.purposes)].sort(), block.manifestFields ? [...new Set(block.manifestFields)].sort() : null];

/** Identity and registry callbacks MUST be supplied by the authenticated host, never request JSON. */
export class VersionedGateway {
  requests: VersionedGrantRequest[] = [];
  grants: VersionedGrant[] = [];
  audit: AuthorizationAudit[] = [];
  constructor(readonly blocks: () => VersionedBlockIdentity[], readonly registry: () => FieldRegistry = () => defaultFieldRegistry) {}
  log(action: string, field?: string, requestId?: string) { this.audit.push({ id: randomUUID(), action, at: now(), ...(field ? { field } : {}), ...(requestId ? { requestId } : {}) }); }
  private fail(message: string, field?: string, requestId?: string, code = 'FORBIDDEN'): never { this.log('deny', field, requestId); throw new DomainError(code, message, 403); }
  private snapshot(x: AuthorizationInput) {
    const registry = fieldRegistrySchema.parse(this.registry()); const identities = this.blocks();
    if (new Set(identities.map(b => b.id)).size !== identities.length) return this.fail('宿主空间身份不唯一', x.field);
    const f = registry.fields.find(f => f.id === x.field); const source = identities.find(b => b.id === x.sourceBlockId); const target = identities.find(b => b.id === x.granteeBlockId);
    if (!f || !source || !target || !target.purposes.includes(x.purpose)) return this.fail('无效空间、字段或用途', x.field);
    if (source.id === target.id || (source.id !== 'pa' && target.id !== 'pa')) return this.fail('跨空间授权必须由 PA 参与', x.field);
    if (source.id !== 'pa' && (!source.manifestFields || !source.manifestFields.includes(x.field))) return this.fail('来源清单未开放此字段', x.field);
    if (source.id === 'pa' && source.manifestFields && !source.manifestFields.includes(x.field)) return this.fail('来源清单未开放此字段', x.field);
    if (target.manifestFields && !target.manifestFields.includes(x.field)) return this.fail('接收方清单未开放此字段', x.field);
    if (f.sensitivity === 'forbidden') return this.fail('该字段禁止授权', x.field);
    if (x.timeRange && (!Number.isFinite(Date.parse(x.timeRange.from)) || !Number.isFinite(Date.parse(x.timeRange.to)) || Date.parse(x.timeRange.from) > Date.parse(x.timeRange.to))) return this.fail('时间范围无效', x.field);
    if (f.sensitivity === 'raw' && (target.id !== 'pa' || !x.sessionId || !x.timeRange)) return this.fail('原文仅 PA 可申请绑定本轮会话及时间段的单次读取', x.field);
    const sourceManifestVersion = source.manifestVersion ?? 1; const granteeManifestVersion = target.manifestVersion ?? 1;
    if (![sourceManifestVersion, granteeManifestVersion].every(v => Number.isSafeInteger(v) && v > 0)) return this.fail('宿主清单版本无效', x.field);
    const binding: AuthorizationBinding = { fieldRegistryVersion: registry.version, sourceManifestVersion, granteeManifestVersion, policyFingerprint: JSON.stringify([registry.fields.map(f => [f.id, f.sensitivity]).sort((a, b) => a[0]!.localeCompare(b[0]!)), identityPolicy(source), identityPolicy(target)]) };
    return { f, source, target, binding };
  }
  check(x: AuthorizationInput) { const result = this.snapshot(x); if (result.source.status !== 'active' || result.target.status !== 'active') return this.fail('积木已暂停', x.field); return result; }
  private fresh(entity: VersionedGrant | VersionedGrantRequest) {
    let current: AuthorizationBinding;
    try { current = this.snapshot(entity).binding; } catch { this.markReconsent(entity); return false; }
    const valid = entity.fieldRegistryVersion === current.fieldRegistryVersion && entity.sourceManifestVersion === current.sourceManifestVersion && entity.granteeManifestVersion === current.granteeManifestVersion && entity.policyFingerprint === current.policyFingerprint;
    if (!valid) this.markReconsent(entity); return valid;
  }
  private markReconsent(entity: VersionedGrant | VersionedGrantRequest) { if (entity.status !== 'reconsent') { entity.status = 'reconsent'; this.log('reconsent', entity.field, entity.id); } }
  /** Call after any manifest/registry update; reads additionally validate lazily, so missing this call cannot grant stale access. */
  invalidateChanged() { for (const r of this.requests) if (r.status === 'pending' || r.status === 'allowed') this.fresh(r); for (const g of this.grants) if (g.status !== 'reconsent') this.fresh(g); }
  request(x: AuthorizationInput) {
    const { f, target, binding } = this.check(x); this.invalidateChanged();
    if (f.sensitivity === 'normal' || (f.sensitivity === 'sensitive' && !target.external)) {
      const grant = this.grants.find(g => g.status !== 'reconsent' && exactScope(g) === exactScope(x) && this.fresh(g));
      if (grant) { this.log('allow_long', x.field, grant.id); return { decision: 'ALLOW', grant }; }
    }
    const request: VersionedGrantRequest = { ...copyScope(x), ...binding, id: randomUUID(), status: 'pending', expiresAt: new Date(Date.now() + 120000).toISOString() };
    this.requests.push(request); this.log('ask', x.field, request.id); return { decision: 'ASK', request };
  }
  decide(requestId: string, allow: boolean) {
    const r = this.requests.find(r => r.id === requestId); if (!r) return this.fail('授权申请不存在', undefined, requestId);
    if (!this.fresh(r)) return this.fail('范围或清单已变化，需重新申请同意', r.field, r.id, 'RECONSENT_REQUIRED');
    if (r.status !== 'pending') return this.fail('授权已处理', r.field, r.id);
    if (typeof allow !== 'boolean') return this.fail('授权决定必须是明确布尔值', r.field, r.id);
    this.check(r); r.status = Date.parse(r.expiresAt) > Date.now() && allow ? 'allowed' : 'denied'; this.log(r.status, r.field, r.id); return r;
  }
  create(x: AuthorizationInput, confirmedSensitive = false) {
    const { f, target, binding } = this.check(x);
    if (f.sensitivity === 'raw' || (f.sensitivity === 'sensitive' && (target.external || !confirmedSensitive))) return this.fail('此字段不可长期授权或需授权中心明确确认', x.field);
    const grant: VersionedGrant = { ...copyScope(x), ...binding, id: randomUUID(), createdAt: now(), status: 'active' };
    this.grants.push(grant); this.log('grant', x.field, grant.id); return grant;
  }
  consume(requestId: string, binding: AuthorizationInput) {
    const r = this.requests.find(r => r.id === requestId); if (!r) return this.fail('授权不存在', undefined, requestId);
    if (!this.fresh(r)) return this.fail('范围或清单已变化，需重新申请同意', r.field, r.id, 'RECONSENT_REQUIRED');
    if (r.status !== 'allowed' || !Number.isFinite(Date.parse(r.expiresAt)) || Date.parse(r.expiresAt) <= Date.now()) return this.fail('授权已过期或已消费', r.field, r.id);
    this.check(r); if (exactScope(r) !== exactScope(binding)) return this.fail('授权范围不匹配', r.field, r.id);
    r.status = 'consumed'; this.log('read', r.field, r.id); return true;
  }
  readLong(grantId: string, binding?: AuthorizationInput) {
    const grant = this.grants.find(g => g.id === grantId); if (!grant) return this.fail('授权不存在或已撤销', undefined, grantId);
    if (grant.status === 'reconsent' || !this.fresh(grant)) return this.fail('范围或清单已变化，需重新申请同意', grant.field, grant.id, 'RECONSENT_REQUIRED');
    const { f, target } = this.check(grant);
    if (f.sensitivity === 'raw' || (f.sensitivity === 'sensitive' && target.external)) return this.fail('此字段不能长期读取', grant.field, grant.id);
    if (binding && exactScope(grant) !== exactScope(binding)) return this.fail('授权范围不匹配', grant.field, grant.id);
    this.log('read', grant.field, grant.id); return grant;
  }
  revoke(grantId: string) { this.grants = this.grants.filter(g => g.id !== grantId); this.log('revoke', undefined, grantId); }
}
