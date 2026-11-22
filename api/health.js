export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, app: 'Discord Server Stats', configured: Boolean(process.env.DISCORD_STATS_BOT_TOKEN && process.env.DISCORD_STATS_GUILD_ID) });
}
