const test = require('node:test');
const assert = require('node:assert/strict');
const perks = require('../src/modules/levels/perks');

// A stand-in for a server's roles that moves them the way discord.js does: the role is lifted out of the sorted list
// and put back at the requested index.
function makeGuild(names, { booster = 'Server Booster' } = {}) {
  const roles = names.map((name, i) => ({ id: `id-${name}`, name, position: i, managed: name === booster }));
  const guild = { roles: { cache: new Map(roles.map((r) => [r.id, r])) } };
  guild.roles.cache.values = () => roles[Symbol.iterator]();
  guild.roles.premiumSubscriberRole = roles.find((r) => r.managed) ?? null;
  const calls = [];
  for (const role of roles) {
    role.setPosition = async (index) => {
      calls.push(index);
      const sorted = [...roles].sort((a, b) => a.position - b.position);
      sorted.splice(sorted.indexOf(role), 1); sorted.splice(index, 0, role);
      sorted.forEach((r, i) => { r.position = i; });
      return role;
    };
  }
  const order = () => [...roles].sort((a, b) => a.position - b.position).map((r) => r.name);
  const add = (name) => { const r = { id: `id-${name}`, name, position: 0, managed: false, setPosition: roles[0].setPosition.bind(null) }; return r; };
  return { guild, roles, calls, order, byName: (n) => roles.find((r) => r.name === n) };
}

const LAYOUT = ['@everyone', 'Member', 'Colour | Sky', 'Booster Colour', 'Elite', '▬▬▬ LEVELS ▬▬▬', 'Server Booster', 'Staff', 'Moderator', 'Tower'];

test('a booster colour role below the Server Booster role is moved directly above it', async () => {
  const { guild, order, byName } = makeGuild(LAYOUT);
  const placed = await perks.placeAboveBooster(guild, byName('Booster Colour'));
  assert.equal(placed, true);
  const names = order();
  assert.equal(names.indexOf('Booster Colour'), names.indexOf('Server Booster') + 1, 'right above, not somewhere higher');
  assert.deepEqual(names.filter((n) => n !== 'Booster Colour'), LAYOUT.filter((n) => n !== 'Booster Colour'), 'nothing else changed order');
});

test('a role that is already above the Server Booster role is left alone', async () => {
  const { guild, calls, byName } = makeGuild(['@everyone', 'Server Booster', 'Booster Colour', 'Tower']);
  assert.equal(await perks.placeAboveBooster(guild, byName('Booster Colour')), true);
  assert.equal(calls.length, 0);
});

test('a role at the very bottom still lands above the Server Booster role', async () => {
  const { guild, order, byName } = makeGuild(['@everyone', 'Booster Colour', 'Member', 'Server Booster', 'Staff', 'Tower']);
  await perks.placeAboveBooster(guild, byName('Booster Colour'));
  const names = order();
  assert.ok(names.indexOf('Booster Colour') > names.indexOf('Server Booster'));
  assert.equal(names.indexOf('Booster Colour'), names.indexOf('Server Booster') + 1);
});

test('with no Server Booster role it falls back to the spot under the LEVELS divider', async () => {
  const { guild, calls, order, byName } = makeGuild(['@everyone', 'Booster Colour', 'Member', '▬▬▬ LEVELS ▬▬▬', 'Staff'], { booster: 'nothing' });
  assert.equal(perks.boosterRole(guild), null);
  assert.equal(await perks.placeAboveBooster(guild, byName('Booster Colour')), false);
  assert.equal(calls.length, 1);
  assert.ok(order().indexOf('Booster Colour') < order().indexOf('▬▬▬ LEVELS ▬▬▬'));
});

test('the Server Booster role is found by its managed flag or its name', () => {
  assert.equal(perks.boosterRole(makeGuild(LAYOUT).guild).name, 'Server Booster');
  const g = makeGuild(['@everyone', 'Server Booster', 'Tower']).guild; g.roles.premiumSubscriberRole = null;
  assert.equal(perks.boosterRole(g).name, 'Server Booster');
});
