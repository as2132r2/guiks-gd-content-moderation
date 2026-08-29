import { describe, expect, it } from 'vitest';

import { app } from '../src/index.js';
import type { UserAccount } from '../src/domain/auth.js';
import { systemRoles, workflowRoles, type SystemRole } from '../src/domain/contracts.js';
import {
  hasPermission,
  mayPerformAs,
  permissions,
  requiredPermissionForTransition,
  rolePermissions,
} from '../src/domain/permissions.js';
import { transitions } from '../src/domain/workflow.js';
import { authenticatedRequest, loginAs } from './helpers/auth.js';

const account = (roles: SystemRole[]): UserAccount => ({
  id: 'user_test_permissions',
  username: 'permission-test',
  displayName: '权限测试',
  roles,
  isDemo: false,
  disabled: false,
  sessionVersion: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe('fixed permission matrix', () => {
  it('keeps every system role on its explicit allow-list', () => {
    expect(rolePermissions).toEqual({
      editor: [
        'manuscript:read',
        'manuscript:create',
        'artifact:create',
        'artifact:revise',
        'review:editor',
        'workflow:admission-reason',
        'workflow:generate',
        'workflow:preflight',
        'workflow:submit-initial-review',
        'workflow:initial-review',
        'audit:read',
      ],
      'department-head': [
        'manuscript:read',
        'review:department-head',
        'workflow:department-review',
        'workflow:countersign',
        'audit:read',
      ],
      'supervising-leader': [
        'manuscript:read',
        'review:supervising-leader',
        'workflow:final-review',
        'workflow:sign',
        'workflow:publish',
        'audit:read',
      ],
      'station-leader': ['manuscript:read', 'audit:read'],
    });

    expect(Object.keys(rolePermissions).sort()).toEqual([...systemRoles].sort());
  });

  it('binds a permission to the requested role even for a multi-role account', () => {
    const zhangmin = account(['editor', 'department-head', 'supervising-leader']);

    expect(hasPermission(zhangmin, 'workflow:generate')).toBe(true);
    expect(mayPerformAs(zhangmin, 'editor', 'workflow:generate')).toBe(true);
    expect(mayPerformAs(zhangmin, 'department-head', 'workflow:generate')).toBe(false);
    expect(mayPerformAs(zhangmin, 'supervising-leader', 'workflow:generate')).toBe(false);
  });

  it('maps every human state-machine edge to a permission owned by exactly its role', () => {
    for (const transition of transitions.filter((item) => item.actor !== 'system')) {
      const permission = requiredPermissionForTransition(transition.from, transition.to);
      expect(permission, `${transition.from} -> ${transition.to}`).toBeDefined();

      const allRoles = account([...workflowRoles]);
      for (const role of workflowRoles) {
        expect(
          mayPerformAs(allRoles, role, permission!),
          `${role} on ${transition.from} -> ${transition.to}`,
        ).toBe(role === transition.actor);
      }
    }
  });

  it('keeps station leader read-only across the whole permission vocabulary', () => {
    const stationLeader = account(['station-leader']);
    expect(hasPermission(stationLeader, 'manuscript:read')).toBe(true);
    expect(hasPermission(stationLeader, 'audit:read')).toBe(true);

    const writePermissions = permissions.filter(
      (permission) => permission !== 'manuscript:read' && permission !== 'audit:read',
    );
    for (const permission of writePermissions) {
      expect(hasPermission(stationLeader, permission), permission).toBe(false);
    }
  });
});

describe('route authorization uses the requested role', () => {
  it('rejects a multi-role user who requests the wrong role for a known action', async () => {
    const request = authenticatedRequest(app, await loginAs(app, 'zhangmin'));
    const created = await request('/api/workbench', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '推进会',
        sourceType: 'notice',
        sourceText: '全市推进会今天召开。',
      }),
    });
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { manuscript: { id: string; status: string } };
    expect(payload.manuscript.status).toBe('admitted');

    const response = await request(`/api/workbench/${payload.manuscript.id}/transition`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'generated', role: 'department-head' }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'wrong_role' });
  });

  it('allows station leader reads and rejects writes on both route surfaces', async () => {
    const station = authenticatedRequest(app, await loginAs(app, 'stationadmin'));
    expect((await station('/api/workbench')).status).toBe(200);
    expect((await station('/api/manuscripts')).status).toBe(200);

    for (const path of ['/api/workbench', '/api/manuscripts']) {
      const response = await station(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: '台领导越权稿',
          sourceType: 'notice',
          sourceText: '模拟素材：市里召开会议。',
        }),
      });
      expect(response.status, path).toBe(403);
      expect(await response.json()).toMatchObject({ error: 'role_not_allowed' });
    }
  });
});
