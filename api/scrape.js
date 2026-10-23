// Vortex scraper — Vercel serverless function
// Deploys to https://your-project.vercel.app/api/scrape?type=movie&tmdb=550&title=Fight%20Club&year=1999

const { makeProviders, makeStandardFetcher, targets } = require('@movie-web/providers');

const providers = makeProviders({
  fetcher: makeStandardFetcher(fetch),
  target: targets.ANY,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const {
    type = 'movie',
    tmdb,
    title = '',
    year = String(new Date().getFullYear()),
    season,
    episode,
  } = req.query;

  if (!tmdb) return res.status(400).json({ ok: false, error: 'tmdb required' });

  const media = {
    type,
    title,
    tmdbId: String(tmdb),
    releaseYear: parseInt(year, 10) || new Date().getFullYear(),
  };
  if (type === 'tv' && season && episode) {
    media.season = { number: parseInt(season, 10), tmdbId: `${tmdb}-s${season}` };
    media.episode = { number: parseInt(episode, 10), tmdbId: `${tmdb}-s${season}e${episode}` };
  }

  try {
    const out = await providers.runAll({ media });
    if (!out || !out.stream) return res.status(404).json({ ok: false, error: 'no source found' });
    const s = out.stream;
    if (s.type === 'hls') {
      return res.json({
        ok: true,
        url: s.playlist,
        type: 'hls',
        captions: s.captions || [],
        headers: s.headers || {},
        embedId: out.embedId,
        sourceId: out.sourceId,
      });
    }
    const q = s.qualities || {};
    const url = q['1080']?.url || q['720']?.url || q['480']?.url || q['360']?.url;
    if (url) return res.json({
      ok: true,
      url,
      type: 'mp4',
      captions: s.captions || [],
      headers: s.headers || {},
      embedId: out.embedId,
      sourceId: out.sourceId,
    });
    return res.status(404).json({ ok: false, error: 'no playable stream' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e) });
  }
};
