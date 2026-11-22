import { timingSafeEqual } from 'node:crypto';

const API = 'https://discord.com/api/v10';
const COUNTERS = [
  { key: 'members', prefix: '👥 Members: ', countKey: 'approximate_member_count' },
  { key: 'online', prefix: '🟢 Online: ', countKey: 'approximate_presence_count' },
];
function secretMatches(value, expected) {
  const a = Buffer.from(String(value ?? ''));
  const b = Buffer.from('Bearer ' + expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readDiscord(url, botToken) {
  const response = await fetch(API + url, {
    headers: { Authorization: 'Bot ' + botToken },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Discord read failed: HTTP ' + response.status);
    error.discordCode = data?.code;
    throw error;
  }
  return data;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const secret = process.env.DISCORD_STATS_TRIGGER_SECRET || process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: 'Server Stats secret not configured' });
  if (!secretMatches(req.headers.authorization, secret)) return res.status(401).json({ error: 'Unauthorized' });
  const token = process.env.DISCORD_STATS_BOT_TOKEN, guildId = process.env.DISCORD_STATS_GUILD_ID;
  if (!token || !guildId) return res.status(503).json({ error: 'Discord Server Stats not configured' });
  try {
    const [guild, channels] = await Promise.all([
      readDiscord('/guilds/' + guildId + '?with_counts=true', token),
      readDiscord('/guilds/' + guildId + '/channels', token),
    ]);
    if (!Array.isArray(channels)) throw new Error('Discord channel list invalid');
    const categoryId = process.env.DISCORD_STATS_CATEGORY_ID;
    const category = categoryId
      ? channels.find(channel => channel.type === 4 && channel.id === categoryId)
      : channels.find(channel => channel.type === 4 && channel.name === '📊 SERVER STATS');
    const counters = Object.fromEntries(COUNTERS.map(counter => {
      const channel = category && channels.find(c => c.type === 2 &&
        c.parent_id === category.id && c.name.startsWith(counter.prefix));
      const count = guild[counter.countKey];
      const expectedName = counter.prefix + (Number.isInteger(count) ? count.toLocaleString('en-US') : 'N/A');
      return [counter.key, {
        sourceValue: Number.isInteger(count) ? count : null,
        channelId: channel?.id ?? null,
        displayedName: channel?.name ?? null,
        expectedName,
        upToDate: channel ? channel.name === expectedName : false,
        ...(channel ? {} : { warning: 'Counter channel is missing or invisible to the bot' }),
      }];
    }));
    return res.status(200).json({
      ok: true,
      checkedAt: new Date().toISOString(),
      source: 'Discord approximate guild counts',
      counts: {
        members: counters.members.sourceValue,
        online: counters.online.sourceValue,
      },
      category: category ? { id: category.id, name: category.name } : null,
      counters,
      healthy: Boolean(category) && COUNTERS.every(x => counters[x.key].upToDate),
      note: 'Read-only live values. No channel names were changed.',
    });
  } catch (error) {
    console.error('[stats:read]', error.message, error.discordCode || '');
    return res.status(502).json({ error: 'Could not read Discord counters; check Vercel logs.' });
  }
}
