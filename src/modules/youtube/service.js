const sql = require('../../db');

const getSettings = async (guildId) => (await sql`select * from youtube_settings where guild_id = ${guildId}`)[0] ?? null;
const allActive = () => sql`select * from youtube_settings where youtube_channel_id is not null and post_channel_id is not null`;

async function saveSettings(guildId, v) {
  const [row] = await sql`
    insert into youtube_settings (guild_id, youtube_channel_id, channel_url, post_channel_id, ping_role_id, insider_channel_id, primed)
    values (${guildId}, ${v.youtubeChannelId}, ${v.channelUrl}, ${v.postChannelId}, ${v.pingRoleId ?? null}, ${v.insiderChannelId ?? null}, false)
    on conflict (guild_id) do update set
      youtube_channel_id = excluded.youtube_channel_id, channel_url = excluded.channel_url,
      post_channel_id = excluded.post_channel_id,
      ping_role_id = coalesce(excluded.ping_role_id, youtube_settings.ping_role_id),
      insider_channel_id = coalesce(excluded.insider_channel_id, youtube_settings.insider_channel_id),
      primed = false, updated_at = now()
    returning *`;
  return row;
}

const setStyle = (guildId, style) => sql`update youtube_settings set style = ${style}, updated_at = now() where guild_id = ${guildId}`;
const setShorts = (guildId, on) => sql`update youtube_settings set post_shorts = ${on}, updated_at = now() where guild_id = ${guildId}`;
const setPrimed = (guildId) => sql`update youtube_settings set primed = true where guild_id = ${guildId}`;
const markChecked = (guildId, error) => sql`update youtube_settings set last_checked_at = now(), last_error = ${error} where guild_id = ${guildId}`;

async function seenIds(guildId, ids) {
  if (!ids.length) return new Set();
  const rows = await sql`select video_id from youtube_seen where guild_id = ${guildId} and video_id in ${sql(ids)}`;
  return new Set(rows.map((r) => r.video_id));
}

const markSeen = (guildId, videoId, posted) => sql`
  insert into youtube_seen (guild_id, video_id, posted) values (${guildId}, ${videoId}, ${posted})
  on conflict (guild_id, video_id) do update set posted = youtube_seen.posted or excluded.posted`;

module.exports = { getSettings, allActive, saveSettings, setStyle, setShorts, setPrimed, markChecked, seenIds, markSeen };
