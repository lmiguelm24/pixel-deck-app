export const AUDIUS_API = 'https://api.audius.co/v1';
export const AUDIUS_SCOPE = 'audius';
export const isAudiusKey = (key) => /^audius:[a-zA-Z0-9]+$/.test(key || '');
const trackId = (key) => {
  if (!isAudiusKey(key)) throw new Error('Identificador Audius inválido.');
  return key.slice(7);
};
const httpsUrl = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
};

export function normalizeAudiusTrack(raw) {
  if (!raw || !/^[a-zA-Z0-9]+$/.test(raw.id || '')) return null;
  const available = raw.is_available !== false && raw.is_delete !== true;
  const streamable = available && raw.is_streamable === true && !raw.is_stream_gated && !raw.stream_conditions && !raw.allowed_api_keys?.length && raw.access?.stream !== false;
  // access.download=true no equivale a que el artista haya habilitado descargas.
  const downloadable = available && raw.is_downloadable === true && !raw.is_download_gated && !raw.download_conditions && raw.access?.download !== false;
  const extension = String(raw.orig_filename || '').match(/\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i)?.[0].toLowerCase() || '.mp3';
  return {
    key: `audius:${raw.id}`, source: 'audius', audiusId: raw.id,
    title: raw.title || 'Sin título', artist: raw.user?.name || raw.user?.handle || 'Artista de Audius',
    album: raw.album_backlink?.playlist_name || 'Audius', genre: raw.genre || '',
    duration: Number(raw.duration) || 0,
    artworkUrl: httpsUrl(raw.artwork?.['480x480'] || raw.artwork?.['150x150']),
    artistArtworkUrl: httpsUrl(raw.user?.profile_picture?.['480x480']),
    streamable, downloadable, downloadExtension: extension, metaDone: true,
  };
}

export function mergeAudiusCatalog(current, incoming, protectedKeys = [], limit = 500) {
  const map = new Map(current.filter((t) => t?.source === 'audius' && isAudiusKey(t.key)).map((t) => [t.key, t]));
  for (const track of incoming) {
    if (track?.source !== 'audius' || !isAudiusKey(track.key)) continue;
    map.delete(track.key); map.set(track.key, track);
  }
  const keep = new Set(protectedKeys);
  for (const key of map.keys()) {
    if (map.size <= limit) break;
    if (!keep.has(key)) map.delete(key);
  }
  return [...map.values()];
}

export async function fetchAudiusJSON(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, data };
}

export function createAudiusClient({ apiKey = '', request = fetchAudiusJSON } = {}) {
  const cache = new Map();
  function url(path, params = {}) {
    const result = new URL(`${AUDIUS_API}${path}`);
    result.searchParams.set('app_name', 'PixelDeck');
    if (apiKey.trim()) result.searchParams.set('api_key', apiKey.trim());
    for (const [key, value] of Object.entries(params)) if (value !== '' && value != null) result.searchParams.set(key, String(value));
    return result.href;
  }
  async function get(path, params, cached = false) {
    const target = url(path, params);
    const saved = cache.get(target);
    if (cached && saved?.until > Date.now()) return saved.promise;
    const promise = (async () => {
      let result;
      try { result = await request(target); }
      catch { throw new Error('No se pudo conectar con Audius. Comprueba tu conexión.'); }
      if (result.status === 429) throw new Error('Audius ha limitado las consultas. Espera un momento y vuelve a intentarlo.');
      if (result.status === 401 || result.status === 403) throw new Error('Audius no permite acceder a este contenido. Revisa tu API Key o prueba otra canción.');
      if (result.status === 404) throw new Error('Esta canción ya no está disponible en Audius.');
      if (result.status !== 200) throw new Error(`Audius no está disponible (${result.status}). Inténtalo de nuevo.`);
      let body;
      try { body = typeof result.data === 'string' ? JSON.parse(result.data) : result.data; }
      catch { throw new Error('Audius devolvió una respuesta inesperada.'); }
      if (!body || !Object.hasOwn(body, 'data')) throw new Error('Audius devolvió una respuesta inesperada.');
      return body.data;
    })();
    if (cached) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(target, { until: Date.now() + 60000, promise });
      promise.catch(() => cache.delete(target));
    }
    return promise;
  }
  return {
    async list({ query = '', genre = '', offset = 0, limit = 20 } = {}) {
      const searching = !!query.trim();
      const rows = await get(searching ? '/tracks/search' : '/tracks/trending', { query: searching ? query.trim() : undefined, genre, offset, limit, time: searching ? undefined : 'week' }, true);
      if (!Array.isArray(rows)) throw new Error('Audius devolvió una lista inesperada.');
      const tracks = rows.map(normalizeAudiusTrack).filter(Boolean);
      return { tracks, hasMore: rows.length === limit && (searching || offset + limit < 100), nextOffset: offset + rows.length };
    },
    async track(key) {
      const value = normalizeAudiusTrack(await get(`/tracks/${trackId(key)}`));
      if (!value) throw new Error('Audius devolvió una canción inválida.');
      return value;
    },
    async stream(key) {
      const track = await this.track(key);
      if (!track.streamable) throw new Error('Esta canción requiere acceso adicional en Audius o no permite reproducción pública.');
      return { track, url: url(`/tracks/${trackId(key)}/stream`) };
    },
    async download(key) {
      const track = await this.track(key);
      if (!track.downloadable) throw new Error('El artista no permite descargar esta canción desde la API pública.');
      return { track, url: url(`/tracks/${trackId(key)}/download`) };
    }
  };
}
