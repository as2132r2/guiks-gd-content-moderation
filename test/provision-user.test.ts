import { describe, expect, it } from 'vitest';

import { parseProvisionArguments } from '../src/provision-user.js';

describe('production user provisioning CLI contract', () => {
  it('accepts only explicit identity fields and strict roles', () => {
    expect(
      parseProvisionArguments([
        '--username',
        'prod-editor',
        '--display-name',
        '生产编辑',
        '--roles',
        'editor,department-head',
      ]),
    ).toEqual({
      username: 'prod-editor',
      displayName: '生产编辑',
      roles: ['editor', 'department-head'],
    });
    expect(() =>
      parseProvisionArguments([
        '--username',
        'prod-editor',
        '--display-name',
        '生产编辑',
        '--roles',
        'editor,unknown',
      ]),
    ).toThrow('roles');
  });

  it('does not accept a password as a process-list-visible command-line option', () => {
    expect(() =>
      parseProvisionArguments([
        '--username',
        'prod-editor',
        '--display-name',
        '生产编辑',
        '--roles',
        'editor',
        '--password',
        'must-not-be-accepted',
      ]),
    ).toThrow('usage');
  });
});
