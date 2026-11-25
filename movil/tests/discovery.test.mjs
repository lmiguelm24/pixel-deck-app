import test from 'node:test';
import assert from 'node:assert/strict';
import { artistOf, genreOf, groupTracks, discover, recordListen } from '../src/lib/discovery.js';
import { parseId3 } from '../src/lib/id3.js';

test('géneros: etiquetas antes que carpetas, alias, ID3 numérico y desconocidos', () => {
  assert.equal(genreOf({ key: 'Rock/album/song.mp3', genre: 'Jazz' }), 'Jazz');
  assert.equal(genreOf({ key: 'REGGAETON/Artista/song.mp3' }), 'Reggaetón');
  assert.equal(genreOf({ key: 'Música/2020 Rock/album/song.mp3' }), 'Rock');
  assert.equal(genreOf({ key: 'song.mp3', genre: '(17)' }), 'Rock');
  assert.equal(genreOf({ key: 'Colección/song.mp3' }), 'Sin género');
  assert.equal(genreOf({ key: 'song.mp3', genre: 'Bossa Nova' }), 'Bossa Nova');
});

test('artistas: etiquetas y rutas Género/Artista, sin inventar el artista desde un álbum', () => {
  assert.equal(artistOf({ key: 'Rock/Banda/Album/song.mp3' }), 'Banda');
  assert.equal(artistOf({ key: 'Rock/Banda/song.mp3', artist: 'Otra banda' }), 'Otra banda');
  assert.equal(artistOf({ key: 'Colección/Album/song.mp3' }), '');
  assert.equal(groupTracks([{ key: 'a', artist: 'Beyoncé' }, { key: 'b', artist: 'BEYONCE' }], artistOf).length, 1);
});

test('recomendaciones: favorecen afinidad, incluyen variedad y no repiten ni inventan canciones', () => {
  const tracks = Array.from({ length: 24 }, (_, i) => ({ key: `song-${i}.mp3`, artist: i < 8 ? 'Favorito' : `Artista ${i}`, genre: i < 8 ? 'Rock' : 'Jazz' }));
  const result = discover(tracks, { 'song-0.mp3': { count: 15, lastPlayed: 2000 } }, '2026-11-24');
  assert.equal(result.personalized, true);
  assert.equal(result.recent[0].key, 'song-0.mp3');
  assert.equal(result.recommended[0].artist, 'Favorito');
  assert.equal(result.recommended.length, 12);
  assert.equal(new Set(result.recommended.map((t) => t.key)).size, 12);
  assert.ok(result.recommended.some((t) => t.artist !== 'Favorito'));
  assert.deepEqual(discover([], {}), { recent: [], recommended: [], personalized: false });
  const initial = discover(tracks, {}, '2026-11-24');
  assert.equal(initial.personalized, false);
  assert.deepEqual(initial, discover(tracks, {}, '2026-11-24'));
});

test('historial: cuenta escuchas, conserva recientes y limita almacenamiento sin mutar el anterior', () => {
  const previous = { song: { count: 1, lastPlayed: 1 } };
  const next = recordListen(previous, 'song', 10);
  assert.deepEqual(next.song, { count: 2, lastPlayed: 10 });
  assert.equal(previous.song.count, 1);
  const full = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`song${i}`, { count: 1, lastPlayed: i }]));
  const bounded = recordListen(full, 'new', 1000);
  assert.equal(Object.keys(bounded).length, 500);
  assert.ok(bounded.new);
  assert.equal(bounded.song0, undefined);
});

test('un MP3 con solo TCON conserva el género numérico para clasificarlo', () => {
  const text = Buffer.from([0, ...Buffer.from('(17)')]);
  const header = Buffer.alloc(10); header.write('TCON'); header.writeUInt32BE(text.length, 4);
  const tag = Buffer.concat([header, text]);
  const id3 = Buffer.from([73, 68, 51, 3, 0, 0, 0, 0, 0, tag.length]);
  assert.equal(parseId3(Buffer.concat([id3, tag])).genre, '(17)');
});
