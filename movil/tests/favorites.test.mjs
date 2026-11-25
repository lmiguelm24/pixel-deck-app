import test from 'node:test';
import assert from 'node:assert/strict';
import { createFavorites } from '../src/lib/favorites.js';

function preferences() {
  const saved = new Map();
  return {
    saved,
    read: async (key, fallback) => saved.has(key) ? structuredClone(saved.get(key)) : fallback,
    write: async (key, value) => { saved.set(key, structuredClone(value)); }
  };
}

test('favoritos: añadir, sin duplicados, quitar y recuperar al reiniciar', async () => {
  const prefs = preferences();
  let favorites = createFavorites(prefs);
  assert.deepEqual(await favorites.load('cloud'), []);
  assert.deepEqual(await favorites.toggle('cloud', 'Rock/one.mp3'), { keys: ['Rock/one.mp3'], added: true });
  await favorites.toggle('cloud', 'Pop/hello.mp3');
  favorites = createFavorites(prefs);
  assert.deepEqual(await favorites.load('cloud'), ['Pop/hello.mp3', 'Rock/one.mp3']);
  assert.deepEqual(await favorites.toggle('cloud', 'Rock/one.mp3'), { keys: ['Pop/hello.mp3'], added: false });
  assert.deepEqual(await createFavorites(prefs).load('cloud'), ['Pop/hello.mp3']);
});

test('los favoritos de distintas nubes no se mezclan, incluso con la misma ruta', async () => {
  const prefs = preferences();
  const favorites = createFavorites(prefs);
  await favorites.toggle('https://one|music', 'song.mp3');
  assert.deepEqual(await favorites.load('https://two|music'), []);
  await favorites.toggle('https://two|music', 'other.mp3');
  assert.deepEqual(await favorites.load('https://one|music'), ['song.mp3']);
  assert.deepEqual(await createFavorites(prefs).load('https://two|music'), ['other.mp3']);
});

test('dos toques rápidos se guardan en orden y no pierden cambios', async () => {
  const prefs = preferences();
  const favorites = createFavorites({ ...prefs, write: async (key, value) => {
    await new Promise((resolve) => setTimeout(resolve, value.length ? 15 : 0));
    await prefs.write(key, value);
  } });
  const results = await Promise.all([favorites.toggle('cloud', 'song'), favorites.toggle('cloud', 'song'), favorites.toggle('cloud', 'other')]);
  assert.deepEqual(results.map((result) => result.added), [true, false, true]);
  assert.deepEqual(await createFavorites(prefs).load('cloud'), ['other']);
});

test('un fallo de guardado conserva la selección anterior y permite reintentar', async () => {
  const prefs = preferences();
  let fail = false;
  const favorites = createFavorites({ ...prefs, write: async (...args) => {
    if (fail) throw new Error('No space');
    await prefs.write(...args);
  } });
  await favorites.toggle('cloud', 'song');
  fail = true;
  await assert.rejects(favorites.toggle('cloud', 'song'), /No space/);
  assert.deepEqual(await favorites.load('cloud'), ['song']);
  fail = false;
  assert.deepEqual(await favorites.toggle('cloud', 'song'), { keys: [], added: false });
});

test('normaliza preferencias inválidas y no expone la lista interna para mutarla', async () => {
  const prefs = preferences();
  await prefs.write('favorites:cloud', ['song', null, '', 4, 'song']);
  const favorites = createFavorites(prefs);
  const snapshot = await favorites.load('cloud');
  assert.deepEqual(snapshot, ['song']);
  snapshot.push('accidental');
  assert.deepEqual(await favorites.load('cloud'), ['song']);
});
