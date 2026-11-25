import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArtworkIndex, isImageKey } from '../src/lib/artwork.js';

test('portadas: canción exacta antes del álbum, y carpetas sin cruzar a otro artista', () => {
  const index = buildArtworkIndex(['Rock/Banda/Album/cover.jpg', 'Rock/Banda/Album/One.PNG', 'Rock/Otra/cover.webp', 'Rock/folder.png']);
  assert.equal(index.find({ track: { key: 'Rock/Banda/Album/One.mp3' } }), 'Rock/Banda/Album/One.PNG');
  assert.equal(index.find({ track: { key: 'Rock/Banda/Album/Two.mp3' } }), 'Rock/Banda/Album/cover.jpg');
  assert.equal(index.find({ folder: 'Rock' }), 'Rock/folder.png');
  assert.equal(index.find({ track: { key: 'Jazz/song.mp3' } }), null);
});

test('fotos y logos de artista: nombre, carpeta de artista, acentos y directorios de imágenes', () => {
  const index = buildArtworkIndex(['images/Beyoncé.jpg', 'Pop/Adele/artist.png', 'logos/Banda Logo.svg']);
  assert.equal(index.find({ artist: 'BEYONCE', kind: 'artist' }), 'images/Beyoncé.jpg');
  assert.equal(index.find({ artist: 'Adele', kind: 'artist' }), 'Pop/Adele/artist.png');
  assert.equal(index.find({ artist: 'Banda', kind: 'artist' }), 'logos/Banda Logo.svg');
  assert.equal(index.find({ artist: 'Sin foto', kind: 'artist' }), null);
});

test('una única imagen junto a la canción sirve como portada; imágenes ocultas no se indexan', () => {
  const index = buildArtworkIndex([{ key: 'Album/mi-foto.jpeg' }, { key: 'Hidden/.cover.png' }, { key: '.cache/Artist.jpg' }]);
  assert.equal(index.find({ track: { key: 'Album/song.mp3' } }), 'Album/mi-foto.jpeg');
  assert.equal(index.find({ folder: 'Hidden' }), null);
  assert.equal(index.find({ artist: 'Artist', kind: 'artist' }), null);
  assert.equal(isImageKey('foto.WEBP'), true);
  assert.equal(isImageKey('song.mp3'), false);
});
