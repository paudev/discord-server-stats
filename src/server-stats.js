/** Standalone Discord voice-channel counters, called by the Vercel endpoint. */
export const CATEGORY_NAME = '📊 SERVER STATS';
const API = 'https://discord.com/api/v10';
const COUNTERS = [
  { key: 'members', prefix: '👥 Members: ', countKey: 'approximate_member_count' },
  { key: 'online', prefix: '🟢 Online: ', countKey: 'approximate_presence_count' },
];
const CHANNEL_TYPES = { voice: 2, category: 4 };
const CONNECT_PERMISSION = '1048576';
// The bot must be allowed to CONNECT even though @everyone is denied.
// Discord implicitly masks Manage Channels when voice CONNECT is denied.
const BOT_VOICE_PERMISSIONS = String(1048576n | 1024n | 16n);
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
const PERMISSION_RETRY_MS = 5 * 60 * 1000;

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseRetryAfter(headers, body) {
  const h = finitePositive(headers?.get?.('retry-after'));
  const b = finitePositive(body?.retry_after);
  return Math.min(MAX_BACKOFF_MS, Math.ceil((h ?? b ?? 60) * 1000));
}
function resetAfter(headers) {
  const remaining = headers?.get?.('x-ratelimit-remaining');
  const reset = finitePositive(headers?.get?.('x-ratelimit-reset-after'));
  return remaining === '0' && reset ? Math.min(MAX_BACKOFF_MS, Math.ceil(reset * 1000)) : 0;
}
function sanitizeCooldowns(input, now) {
  const clean = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return clean;
  for (const [id, until] of Object.entries(input).slice(0, 100)) {
    if (id !== '_global' && !/^\d{16,22}$/.test(id)) continue;
    if (typeof until === 'number' && Number.isFinite(until) && until > now && until <= now + MAX_BACKOFF_MS) {
      clean[id] = Math.ceil(until);
    }
  }
  return clean;
}
export async function updateServerStats({
  token,
  guildId,
  categoryId,
  cooldowns: incomingCooldowns = {},
  fetcher = globalThis.fetch,
  now = () => Date.now(),
}) {
  if (!token || !/^\d{16,22}$/.test(guildId ?? '')) {
    throw new Error('Missing or invalid DISCORD_STATS_BOT_TOKEN / DISCORD_STATS_GUILD_ID');
  }
  const clock = now();
  const cooldowns = sanitizeCooldowns(incomingCooldowns, clock);
  async function discord(path, method = 'GET', data) {
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    let body;
    try { body = await response.json(); } catch { body = {}; }
    if (response.status === 429) {
      const error = new Error(`Discord rate limited ${method} ${path}`);
      error.rateLimited = true;
      error.retryMs = parseRetryAfter(response.headers, body);
      error.global = body?.global === true || response.headers?.get?.('x-ratelimit-global') === 'true';
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Discord ${method} ${path} failed (HTTP ${response.status}, code ${Number.isInteger(body?.code) ? body.code : 'unknown'})`);
      error.status = response.status;
      error.discordCode = Number.isInteger(body?.code) ? body.code : null;
      throw error;
    }
    return { body, headers: response.headers };
  }
  if (cooldowns._global && cooldowns._global > clock) {
    return { deferred: [{ counter: 'all', retryAfterSeconds: Math.ceil((cooldowns._global - clock) / 1000) }],
      updated: [], unchanged: [], created: [], cooldowns, skippedGlobal: true };
  }
  let guild;
  try {
    guild = (await discord(`/guilds/${guildId}?with_counts=true`)).body;
  } catch (error) {
    if (!error.rateLimited) throw error;
    cooldowns._global = clock + error.retryMs;
    return { updated: [], unchanged: [], created: [], deferred: [
      { counter: 'all', retryAfterSeconds: Math.ceil(error.retryMs / 1000) },
    ], cooldowns, skippedGlobal: true };
  }
  for (const counter of COUNTERS) {
    if (!Number.isInteger(guild[counter.countKey]) || guild[counter.countKey] < 0) {
      throw new Error(`Discord did not return ${counter.countKey}`);
    }
  }
  let channels;
  try {
    channels = (await discord(`/guilds/${guildId}/channels`)).body;
  } catch (error) {
    if (!error.rateLimited) throw error;
    cooldowns._global = clock + error.retryMs;
    return { members: guild.approximate_member_count, online: guild.approximate_presence_count,
      updated: [], unchanged: [], created: [], deferred: [
        { counter: 'all', retryAfterSeconds: Math.ceil(error.retryMs / 1000) },
      ], cooldowns, skippedGlobal: true };
  }
  if (!Array.isArray(channels)) throw new Error('Discord returned invalid channel list');
  let category = categoryId
    ? channels.find(c => c.id === categoryId && c.type === CHANNEL_TYPES.category)
    : channels.find(c => c.type === CHANNEL_TYPES.category && c.name === CATEGORY_NAME);
  if (categoryId && !category) throw new Error('DISCORD_STATS_CATEGORY_ID does not identify a category in this server');
  if (!category) {
    category = (await discord(`/guilds/${guildId}/channels`, 'POST', {
      name: CATEGORY_NAME,
      type: CHANNEL_TYPES.category,
    })).body;
  }
  const result = { members: guild.approximate_member_count, online: guild.approximate_presence_count,
    categoryId: category.id, updated: [], unchanged: [], created: [], deferred: [], blocked: [], cooldowns };
  let botUserId = null;
  for (const counter of COUNTERS) {
    const name = `${counter.prefix}${guild[counter.countKey].toLocaleString('en-US')}`;
    const existing = channels.find(c =>
      c.type === CHANNEL_TYPES.voice && c.parent_id === category.id && c.name.startsWith(counter.prefix)
    );
    if (!existing) {
      if (!botUserId) {
        botUserId = (await discord('/users/@me')).body?.id;
        if (!/^\d{16,22}$/.test(botUserId ?? '')) throw new Error('Cannot identify Server Stats bot for counter permissions');
      }
      const created = (await discord(`/guilds/${guildId}/channels`, 'POST', {
        name,
        type: CHANNEL_TYPES.voice,
        parent_id: category.id,
        permission_overwrites: [
          { id: guildId, type: 0, allow: '0', deny: CONNECT_PERMISSION },
          { id: botUserId, type: 1, allow: BOT_VOICE_PERMISSIONS, deny: '0' },
        ],
      })).body;
      result.created.push({ counter: counter.key, channelId: created.id });
      continue;
    }
    if (existing.name === name) {
      delete cooldowns[existing.id];
      result.unchanged.push(counter.key);
      continue;
    }
    if (cooldowns[existing.id] > clock || cooldowns._global > clock) {
      const until = Math.max(cooldowns[existing.id] || 0, cooldowns._global || 0);
      result.deferred.push({ counter: counter.key, channelId: existing.id, retryAfterSeconds: Math.ceil((until - clock) / 1000) });
      continue;
    }
    try {
      const updated = await discord(`/channels/${existing.id}`, 'PATCH', { name });
      result.updated.push({ counter: counter.key, channelId: existing.id });
      const delay = resetAfter(updated.headers);
      if (delay) cooldowns[existing.id] = clock + delay;
      else delete cooldowns[existing.id];
    } catch (error) {
      if (error.status === 403) {
        // Discord denies a channel rename when this bot lacks effective
        // Manage Channels access on the category or voice channel.
        // Keep checking other counters, but do not hammer the denied channel.
        cooldowns[existing.id] = clock + PERMISSION_RETRY_MS;
        result.blocked.push({
          counter: counter.key,
          channelId: existing.id,
          reason: error.discordCode === 50001
            ? 'Missing Access: allow View Channel, Connect and Manage Channels for the Server Stats bot on this voice channel.'
            : 'Missing Permissions: allow View Channel, Connect and Manage Channels for the Server Stats bot on this voice channel.',
          discordCode: error.discordCode,
          retryAfterSeconds: PERMISSION_RETRY_MS / 1000,
        });
        console.warn('[server-stats] Discord denied counter rename (HTTP 403)', {
          counter: counter.key, channelId: existing.id, discordCode: error.discordCode,
        });
        continue;
      }
      if (!error.rateLimited) throw error;
      const key = error.global ? '_global' : existing.id;
      cooldowns[key] = clock + error.retryMs;
      result.deferred.push({ counter: counter.key, channelId: existing.id, retryAfterSeconds: Math.ceil(error.retryMs / 1000) });
    }
  }
  result.partial = result.blocked.length > 0;
  return result;
}
