// Vortex scraper — Vercel serverless function with per-source diagnostic
// Deploys to https://your-project.vercel.app/api/scrape?type=movie&tmdb=550&title=Fight%20Club&year=1999
// Add ?debug=1 to see per-source errors

const { makeProviders, makeStandardFetcher, makeSimpleProxyFetcher, targets } = require('@movie-web/providers');

// Vercel's Node runtime rejects AbortSignal from different realm — strip it
const safeFetch = (url, opts = {}) => {
  const { signal, ...rest } = opts;
  return fetch(url, rest);
};

function build(target) {
  return makeProviders({
    fetcher: makeStandardFetcher(safeFetch),
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

  // Fetch imdbId + authoritative title/year from TMDB (public demo key)
  const TMDB_KEY = '3fd2be6f0c70a2a598f084ddfb75487c';
  let imdbId;
  let realTitle = title;
  let realYear = year;
  try {
    const tmdbPath = type === 'movie' ? `movie/${tmdb}` : `tv/${tmdb}`;
    const tmdbRes = await fetch(`https://api.themoviedb.org/3/${tmdbPath}?api_key=${TMDB_KEY}&append_to_response=external_ids`);
    if (tmdbRes.ok) {
      const td = await tmdbRes.json();
      imdbId = td.external_ids?.imdb_id || td.imdb_id;
      realTitle = td.title || td.name || title;
      realYear = (td.release_date || td.first_air_date || year).slice(0, 4);
    }
  } catch (e) { /* best-effort */ }

  const media = {
    type,
    title: realTitle,
    tmdbId: String(tmdb),
    releaseYear: parseInt(realYear, 10) || new Date().getFullYear(),
    ...(imdbId ? { imdbId } : {}),
  };
  if (type === 'tv' && season && episode) {
    media.season = { number: parseInt(season, 10), tmdbId: `${tmdb}-s${season}` };
    media.episode = { number: parseInt(episode, 10), tmdbId: `${tmdb}-s${season}e${episode}` };
  }

  // Only try NATIVE target (fastest, no browser emulation) — most providers support it
  const targetsToTry = [targets.NATIVE];
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
