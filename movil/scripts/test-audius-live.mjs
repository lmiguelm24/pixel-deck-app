// Prueba opcional contra Internet: metadatos y un rango de audio, sin descargar
// una canción completa. No sustituye la prueba de audio en Android/WebView.
import assert from 'node:assert/strict';
import { createAudiusClient } from '../src/lib/audius.js';

const client = createAudiusClient({ apiKey: process.env.AUDIUS_API_KEY || '' });
const trending = await client.list({ limit: 2 });
assert.ok(trending.tracks.length, 'Audius devolvió tendencias');
const genre = await client.list({ genre: 'Jazz', limit: 2 });
const candidate = trending.tracks.find((track) => track.streamable);
assert.ok(candidate, 'Hay una canción pública reproducible');
const search = await client.list({ query: candidate.title, limit: 2 });
const { track, url } = await client.stream(candidate.key);
const target = new URL(url);
target.searchParams.set('skip_play_count', 'true');
const response = await fetch(target, {
  headers: { Range: 'bytes=0-1023', Origin: 'https://localhost' },
  signal: AbortSignal.timeout(30000)
});
const summary = { status: response.status, mime: response.headers.get('content-type'), cors: response.headers.get('access-control-allow-origin'), range: response.headers.get('content-range') };
await response.body?.cancel();
assert.ok([200, 206].includes(summary.status), 'El stream devuelve audio');
assert.match(summary.mime || '', /^audio\//);
assert.ok(['*', 'https://localhost'].includes(summary.cors), 'El servidor permite el origen del WebView');
console.log(JSON.stringify({ trending: trending.tracks.length, jazz: genre.tracks.length, search: search.tracks.length, track: track.key, audio: summary }, null, 2));
console.log('PASS: endpoints públicos y cabeceras de streaming/CORS. Falta comprobar reproducción, ecualizador y segundo plano en el teléfono.');
