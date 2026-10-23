// Vortex scraper — Vercel serverless function with per-source diagnostic
// Deploys to https://your-project.vercel.app/api/scrape?type=movie&tmdb=550&title=Fight%20Club&year=1999
// Add ?debug=1 to see per-source errors

const { makeProviders, makeStandardFetcher, makeSimpleProxyFetcher, targets } = require('@movie-web/providers');

function build(target) {
  return makeProviders({
    fetcher: makeStandardFetcher(fetch),
    target,
  });
}

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
    debug,
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

  // Try multiple target modes — some providers only work on specific targets
  const targetsToTry = [targets.NATIVE, targets.ANY, targets.BROWSER];
  const debugInfo = [];

  for (const target of targetsToTry) {
    try {
      const providers = build(target);
      const listed = providers.listSources().length;
      debugInfo.push({ target, sources: listed });

      // runSafe gives us per-provider feedback
      const safe = await providers.runAll({
        media,
        events: {
          init: (e) => debugInfo.push({ target, event: 'init', sources: e.sourceIds }),
          start: (id) => debugInfo.push({ target, event: 'start', id }),
          update: (e) => debugInfo.push({ target, event: 'update', id: e.id, status: e.status, reason: e.reason, error: e.error ? String(e.error) : undefined }),
        },
      });

      if (safe && safe.stream) {
        const s = safe.stream;
        if (s.type === 'hls' && s.playlist) {
          return res.json({ ok: true, url: s.playlist, type: 'hls', captions: s.captions || [], headers: s.headers || {}, embedId: safe.embedId, sourceId: safe.sourceId, target });
        }
        const q = s.qualities || {};
        const url = q['1080']?.url || q['720']?.url || q['480']?.url || q['360']?.url;
        if (url) {
          return res.json({ ok: true, url, type: 'mp4', captions: s.captions || [], headers: s.headers || {}, embedId: safe.embedId, sourceId: safe.sourceId, target });
        }
      }
    } catch (e) {
      debugInfo.push({ target, error: String(e.message || e) });
    }
  }

  if (debug) return res.status(404).json({ ok: false, error: 'no source found', debug: debugInfo });
  return res.status(404).json({ ok: false, error: 'no source found' });
};
