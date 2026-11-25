import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIUS_API, createAudiusClient, isAudiusKey, mergeAudiusCatalog, normalizeAudiusTrack } from '../src/lib/audius.js';

const raw = (overrides = {}) => ({ id: 'Ab123', title: 'Song', duration: 180, genre: 'Jazz', user: { name: 'Artist' }, is_streamable: true, is_available: true, is_stream_gated: false, is_downloadable: false, access: { stream: true, download: true }, artwork: { '480x480': 'https://images.example/cover.jpg' }, ...overrides });

test('Audius: adapta metadatos a una fuente identificable sin guardar URLs de audio firmadas', () => {
  const track = normalizeAudiusTrack(raw({ stream: { url: 'https://example/audio?signature=temporary' }, orig_filename: 'Original.WAV' }));
  assert.equal(track.key, 'audius:Ab123');
  assert.equal(track.source, 'audius');
  assert.equal(track.artist, 'Artist');
  assert.equal(track.artworkUrl, 'https://images.example/cover.jpg');
  assert.equal(track.downloadExtension, '.wav');
  assert.equal(track.streamable, true);
  assert.equal(track.downloadable, false, 'access.download no sustituye el permiso del artista');
  assert.equal(JSON.stringify(track).includes('signature'), false);
  assert.equal(isAudiusKey('audius:Ab123'), true);
  assert.equal(isAudiusKey('Rock/Ab123.mp3'), false);
  assert.equal(normalizeAudiusTrack(raw({ id: '../bad' })), null);
});

test('Audius: no ofrece reproducción pública ni descarga de contenido restringido o retirado', () => {
  assert.equal(normalizeAudiusTrack(raw({ is_stream_gated: true })).streamable, false);
  assert.equal(normalizeAudiusTrack(raw({ stream_conditions: { follow_user_id: 1 } })).streamable, false);
  assert.equal(normalizeAudiusTrack(raw({ allowed_api_keys: ['restricted-app'] })).streamable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_available: false })).streamable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_delete: true, is_downloadable: true })).downloadable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_downloadable: true, is_download_gated: true })).downloadable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_downloadable: true, download_conditions: { usdc_purchase: {} } })).downloadable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_downloadable: true, access: { download: false } })).downloadable, false);
  assert.equal(normalizeAudiusTrack(raw({ is_downloadable: true })).downloadable, true);
});

test('Audius: tendencias y búsqueda envían filtros, paginación y clave pública; deduplican consultas', async () => {
  const calls = [];
  const client = createAudiusClient({ apiKey: 'public-test-key', request: async (url) => {
    calls.push(new URL(url)); return { status: 200, data: { data: [raw()] } };
  } });
  const [a, b] = await Promise.all([client.list({ genre: 'Jazz', limit: 1 }), client.list({ genre: 'Jazz', limit: 1 })]);
  assert.equal(calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(a.hasMore, true);
  assert.equal(a.nextOffset, 1);
  assert.equal(calls[0].origin + '/v1', AUDIUS_API);
  assert.equal(calls[0].pathname, '/v1/tracks/trending');
  assert.equal(calls[0].searchParams.get('api_key'), 'public-test-key');
  assert.equal(calls[0].searchParams.get('time'), 'week');
  await client.list({ query: 'Beyoncé & jazz', genre: 'R&B/Soul', offset: 20 });
  assert.equal(calls[1].pathname, '/v1/tracks/search');
  assert.equal(calls[1].searchParams.get('query'), 'Beyoncé & jazz');
  assert.equal(calls[1].searchParams.get('genre'), 'R&B/Soul');
  assert.equal(calls[1].searchParams.get('offset'), '20');
  assert.equal(calls[1].searchParams.has('time'), false);
});

test('Audius: sin clave puede consultar la lectura pública y limita tendencias a 100 pistas', async () => {
  let url;
  const client = createAudiusClient({ request: async (target) => { url = new URL(target); return { status: 200, data: JSON.stringify({ data: [raw()] }) }; } });
  const page = await client.list({ offset: 99, limit: 1 });
  assert.equal(url.searchParams.has('api_key'), false);
  assert.equal(page.hasMore, false);
});

test('Audius: obtiene permisos actuales al reproducir y descargar, sin fiarse del catálogo guardado', async () => {
  let allowed = true, requests = 0;
  const client = createAudiusClient({ request: async () => { requests++; return { status: 200, data: { data: raw({ is_downloadable: allowed, is_stream_gated: !allowed }) } }; } });
  assert.match((await client.stream('audius:Ab123')).url, /\/tracks\/Ab123\/stream\?/);
  assert.match((await client.download('audius:Ab123')).url, /\/tracks\/Ab123\/download\?/);
  allowed = false;
  await assert.rejects(client.stream('audius:Ab123'), /requiere acceso/);
  await assert.rejects(client.download('audius:Ab123'), /no permite descargar/);
  assert.equal(requests, 4, 'no reutiliza permisos obsoletos');
  await assert.rejects(client.stream('Rock/song.mp3'), /inválido/);
});

test('Audius: errores legibles y posibilidad de reintento tras límite de consultas', async () => {
  let status = 429;
  const client = createAudiusClient({ request: async () => ({ status, data: status === 200 ? { data: [] } : 'rate limited' }) });
  await assert.rejects(client.list(), /limitado/);
  status = 200;
  assert.deepEqual((await client.list()).tracks, []);
  for (const [code, message] of [[401, /API Key/], [403, /API Key/], [404, /ya no está disponible/], [500, /no está disponible/]]) {
    const failing = createAudiusClient({ request: async () => ({ status: code }) });
    await assert.rejects(failing.track('audius:Ab123'), message);
  }
  await assert.rejects(createAudiusClient({ request: async () => { throw new Error('network'); } }).list(), /conectar/);
  await assert.rejects(createAudiusClient({ request: async () => ({ status: 200, data: '<html>' }) }).list(), /respuesta inesperada/);
});

test('Audius: catálogo acotado conserva favoritos y descargas sin mezclar claves R2', () => {
  const tracks = ['A', 'B', 'C', 'D'].map((id) => normalizeAudiusTrack(raw({ id })));
  const merged = mergeAudiusCatalog(tracks.slice(0, 3), [tracks[3], { key: 'Rock/song.mp3' }], ['audius:A'], 2);
  assert.deepEqual(merged.map((t) => t.key), ['audius:A', 'audius:D']);
  const updated = mergeAudiusCatalog(merged, [normalizeAudiusTrack(raw({ id: 'A', title: 'Updated' }))], ['audius:A'], 2);
  assert.equal(updated.find((t) => t.key === 'audius:A').title, 'Updated');
});
