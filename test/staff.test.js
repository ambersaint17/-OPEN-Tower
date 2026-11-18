const test = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/lib/staff');

const auth = (roles, flags) => s.authority(roles, flags);
const MOD = ['Moderator', 'Moderation Team', 'Staff'];

test('a person\'s team and rank come from their roles, highest first', () => {
  assert.deepEqual(s.profileOf(['Trial Moderator']), { team: 'moderation', index: 0, rank: { key: 'trial', role: 'Trial Moderator', label: 'Trial Moderator' } });
  assert.equal(s.profileOf(['Community Agent', 'Head of Community']).index, 2);
  assert.equal(s.profileOf(['Trial Agent']).team, 'community');
  assert.equal(s.profileOf(['Member', 'Gaming']), null);
  assert.equal(s.profileOf(['trial   AGENT']).team, 'community', 'capitals and spacing do not matter');
});

test('who may manage staff: the owner and administrators everything, a head only their own team', () => {
  assert.deepEqual(auth([], { isOwner: true }), { kind: 'owner' });
  assert.deepEqual(auth(['Co-Owner']), { kind: 'admin' });
  assert.deepEqual(auth([], { isAdmin: true }), { kind: 'admin' });
  assert.deepEqual(auth(['Head Moderator']), { kind: 'head', team: 'moderation', index: 2 });
  assert.deepEqual(auth(['Head of Community']), { kind: 'head', team: 'community', index: 2 });
  assert.equal(auth(['Moderator']), null);
  assert.equal(auth(['Trial Agent']), null);
  assert.equal(auth([]), null);
});

test('a head can hand out ranks below their own, in their own team only', () => {
  const head = auth(['Head Moderator']);
  assert.equal(s.canGrant(head, 'moderation', 0), true);
  assert.equal(s.canGrant(head, 'moderation', 1), true);
  assert.equal(s.canGrant(head, 'moderation', 2), false, 'not another head');
  assert.equal(s.canGrant(head, 'community', 0), false, 'not the other team');
  const admin = auth(['Administrator']);
  assert.equal(s.canGrant(admin, 'community', 2), true, 'administrators can make heads');
  assert.equal(s.canGrant(null, 'moderation', 0), false);
});

test('inducting is checked: authority, rank, an existing team member and a real team', () => {
  const head = auth(['Head Moderator']);
  assert.equal(s.decideInduct({ auth: head, teamKey: 'moderation', rankKey: 'trial', targetProfile: null }).ok, true);
  assert.equal(s.decideInduct({ auth: head, teamKey: 'moderation', rankKey: 'moderator', targetProfile: null }).index, 1);
  assert.match(s.decideInduct({ auth: head, teamKey: 'moderation', rankKey: 'head', targetProfile: null }).error, /administrator or the owner/);
  assert.match(s.decideInduct({ auth: head, teamKey: 'community', rankKey: 'trial', targetProfile: null }).error, /different team/);
  assert.match(s.decideInduct({ auth: head, teamKey: 'moderation', rankKey: 'trial', targetProfile: s.profileOf(['Moderator']) }).error, /already on a staff team/);
  assert.match(s.decideInduct({ auth: head, teamKey: 'moderation', rankKey: 'nope', targetProfile: null }).error, /no rank called/);
  assert.match(s.decideInduct({ auth: head, teamKey: 'nothing', rankKey: 'trial', targetProfile: null }).error, /does not exist/);
  assert.match(s.decideInduct({ auth: null, teamKey: 'moderation', rankKey: 'trial', targetProfile: null }).error, /Only team heads/);
  assert.equal(s.decideInduct({ auth: auth(['Administrator']), teamKey: 'community', rankKey: 'head', targetProfile: null }).ok, true);
});

test('promote, demote and remove follow the ladder and the rules', () => {
  const head = auth(['Head Moderator']); const admin = auth(['Administrator']);
  const as = (roles) => s.profileOf(roles);
  assert.equal(s.decideChange({ action: 'promote', auth: head, targetProfile: as(['Trial Moderator']) }).toRank.label, 'Moderator');
  assert.match(s.decideChange({ action: 'promote', auth: head, targetProfile: as(['Moderator']) }).error, /Only an administrator or the owner can make someone Head Moderator/);
  assert.equal(s.decideChange({ action: 'promote', auth: admin, targetProfile: as(['Moderator']) }).toRank.label, 'Head Moderator');
  assert.match(s.decideChange({ action: 'promote', auth: admin, targetProfile: as(['Head Moderator']) }).error, /top rank/);
  assert.equal(s.decideChange({ action: 'demote', auth: head, targetProfile: as(['Moderator']) }).toRank.label, 'Trial Moderator');
  assert.match(s.decideChange({ action: 'demote', auth: head, targetProfile: as(['Trial Moderator']) }).error, /lowest rank.*\/remove/);
  assert.match(s.decideChange({ action: 'demote', auth: head, targetProfile: as(['Head Moderator']) }).error, /ranked below you/);
  assert.equal(s.decideChange({ action: 'demote', auth: admin, targetProfile: as(['Head Moderator']) }).toRank.label, 'Moderator');
  assert.match(s.decideChange({ action: 'remove', auth: head, targetProfile: as(['Community Agent']) }).error, /different team/);
  assert.equal(s.decideChange({ action: 'remove', auth: head, targetProfile: as(['Trial Moderator']) }).ok, true);
  assert.match(s.decideChange({ action: 'remove', auth: head, targetProfile: null }).error, /not on a staff team/);
  assert.match(s.decideChange({ action: 'remove', auth: null, targetProfile: as(['Moderator']) }).error, /Only team heads/);
});

test('each action changes exactly the right roles', () => {
  const t = s.teamOf('moderation');
  assert.deepEqual(s.rolePlan({ action: 'induct', team: t, toIndex: 1 }), { add: ['Moderation Team', 'Moderator', 'Staff'], remove: [], header: 'add' });
  assert.deepEqual(s.rolePlan({ action: 'promote', team: t, fromIndex: 0, toIndex: 1 }), { add: ['Moderator', 'Moderation Team', 'Staff'], remove: ['Trial Moderator'], header: 'add' });
  assert.deepEqual(s.rolePlan({ action: 'demote', team: t, fromIndex: 2, toIndex: 1 }).remove, ['Head Moderator']);
  assert.deepEqual(s.rolePlan({ action: 'remove', team: t, fromIndex: 1 }), { add: [], remove: ['Moderator', 'Moderation Team', 'Staff'], header: 'remove' });
  assert.deepEqual(s.rolePlan({ action: 'remove', team: t, fromIndex: 1, keepStaff: true }), { add: [], remove: ['Moderator', 'Moderation Team'], header: 'keep' });
  assert.equal(s.holdsLeadership(['Co-Owner', 'Gaming']), true);
  assert.equal(s.holdsLeadership(['Moderator']), false);
});
