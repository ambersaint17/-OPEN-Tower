const { PermissionFlagsBits } = require('discord.js');
const ui = require('../../ui');
const L = require('../../lib/levels');
const engine = require('../levels/engine');
const { levelFor } = require('../moderation/permissions');
const catalog = require('./catalog');
const staffAuth = require('../staff/actions').staffAuth;
const views = require('./views');

// Who is asking: the same staff rank the commands themselves use, plus their level and booster status.
async function viewerFor(interaction) {
  const { guild, member } = interaction;
  const roleNames = [...member.roles.cache.values()].map((r) => r.name);
  const level = levelFor(roleNames, { isOwner: guild.ownerId === member.id, isAdmin: member.permissions.has(PermissionFlagsBits.Administrator) });
  const entry = await engine.peek(guild.id, member.id).catch(() => null);
  return { level, roleNames, memberLevel: entry?.level ?? 0, booster: Boolean(member.premiumSince), staffManager: Boolean(staffAuth(member)) };
}

async function render(interaction, selected) {
  const viewer = await viewerFor(interaction);
  const sections = catalog.visibleSections(viewer);
  return views.helpCard(sections, viewer, sections.some((s) => s.key === selected) ? selected : views.OVERVIEW);
}

// The section menu. Rank is read again every time, so a role change shows up straight away.
async function handle(interaction) {
  return interaction.update(ui.edit(await render(interaction, interaction.values[0])));
}

module.exports = { handle, render, viewerFor };
