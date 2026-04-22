import { describe, expect, it } from 'vitest';
import { driveActionDefs } from '../drive-actions.js';
import { docsActionDefs } from '../docs-actions.js';
import { sheetsActionDefs } from '../sheets-actions.js';
import {
  LIST_SEARCH_ACTIONS,
  READ_GET_ACTIONS,
  WRITE_MODIFY_ACTIONS,
  CREATE_ACTIONS,
  classifyAction,
  buildLabelFilterClause,
  resolveGuard,
} from '../labels-guard.js';
import type { ActionContext } from '@valet/sdk/integrations';

describe('labels-guard action classification completeness', () => {
  const allRegisteredIds = [
    ...driveActionDefs.map((a) => a.id),
    ...docsActionDefs.map((a) => a.id),
    ...sheetsActionDefs.map((a) => a.id),
  ];

  const allClassifiedIds = [
    ...LIST_SEARCH_ACTIONS,
    ...READ_GET_ACTIONS,
    ...WRITE_MODIFY_ACTIONS,
    ...CREATE_ACTIONS,
  ];

  it('every registered action ID is classified in exactly one category', () => {
    for (const id of allRegisteredIds) {
      const found = allClassifiedIds.filter((cid) => cid === id);
      expect(found, `Action "${id}" must be classified in exactly one category`).toHaveLength(1);
    }
  });

  it('every classified action ID is registered in some action module', () => {
    for (const id of allClassifiedIds) {
      expect(allRegisteredIds, `Classified action "${id}" not found in any action defs`).toContain(id);
    }
  });

  it('no duplicates across categories', () => {
    const seen = new Set<string>();
    for (const id of allClassifiedIds) {
      expect(seen.has(id), `Duplicate action ID "${id}" across categories`).toBe(false);
      seen.add(id);
    }
  });

  it('classifyAction returns the correct category for every action', () => {
    for (const id of LIST_SEARCH_ACTIONS) expect(classifyAction(id)).toBe('list_search');
    for (const id of READ_GET_ACTIONS) expect(classifyAction(id)).toBe('read_get');
    for (const id of WRITE_MODIFY_ACTIONS) expect(classifyAction(id)).toBe('write_modify');
    for (const id of CREATE_ACTIONS) expect(classifyAction(id)).toBe('create');
  });

  it('classifyAction returns "unknown" for unrecognized actions', () => {
    expect(classifyAction('nonexistent.action')).toBe('unknown');
  });
});

describe('buildLabelFilterClause', () => {
  it('returns empty string for empty label array', () => {
    expect(buildLabelFilterClause([])).toBe('');
  });

  it('returns unparenthesized clause for single label', () => {
    expect(buildLabelFilterClause(['abc123'])).toBe("'labels/abc123' in labels");
  });

  it('returns parenthesized OR clause for multiple labels', () => {
    const result = buildLabelFilterClause(['abc', 'def']);
    expect(result).toBe("('labels/abc' in labels OR 'labels/def' in labels)");
  });

  it('handles three labels', () => {
    const result = buildLabelFilterClause(['a', 'b', 'c']);
    expect(result).toBe("('labels/a' in labels OR 'labels/b' in labels OR 'labels/c' in labels)");
  });
});

describe('resolveGuard', () => {
  function makeCtx(guardConfig?: Record<string, unknown>): ActionContext {
    return {
      credentials: { access_token: 'test' },
      userId: 'user-1',
      guardConfig,
    };
  }

  it('returns null when guardConfig is missing', () => {
    expect(resolveGuard(makeCtx())).toBeNull();
  });

  it('returns null when guard is not enabled', () => {
    expect(resolveGuard(makeCtx({ driveLabelsGuardEnabled: false }))).toBeNull();
  });

  it('parses a valid config', () => {
    const result = resolveGuard(makeCtx({
      driveLabelsGuardEnabled: true,
      driveRequiredLabelIds: ['label-1', 'label-2'],
      driveLabelsFailMode: 'allow',
    }));
    expect(result).toEqual({
      driveLabelsGuardEnabled: true,
      driveRequiredLabelIds: ['label-1', 'label-2'],
      driveLabelsFailMode: 'allow',
    });
  });

  it('defaults failMode to deny', () => {
    const result = resolveGuard(makeCtx({
      driveLabelsGuardEnabled: true,
      driveRequiredLabelIds: ['x'],
    }));
    expect(result?.driveLabelsFailMode).toBe('deny');
  });

  it('filters out non-string and empty label IDs', () => {
    const result = resolveGuard(makeCtx({
      driveLabelsGuardEnabled: true,
      driveRequiredLabelIds: ['good', '', 42, null, 'also-good'],
    }));
    expect(result?.driveRequiredLabelIds).toEqual(['good', 'also-good']);
  });
});
