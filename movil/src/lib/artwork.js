import { norm, baseName } from './format.js';
import { artistOf } from './discovery.js';

export const isImageKey = (key) => /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(key);
const directory = (key) => key.slice(0, key.lastIndexOf('/') + 1);
const COVER_NAMES = ['cover', 'folder', 'front', 'album', 'albumart', 'portada', 'caratula'];
const ARTIST_NAMES = ['artist', 'artista', 'photo', 'foto', 'portrait', 'logo'];

export function buildArtworkIndex(images) {
  const dirs = new Map(), names = new Map(), folderNames = new Map();
  for (const item of images) {
    const key = typeof item === 'string' ? item : item.key;
    if (!isImageKey(key) || key.split('/').some((p) => p.startsWith('.'))) continue;
    const dir = directory(key), name = norm(baseName(key));
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir).push({ key, name });
    // Busca también "Artista/foto.jpg" y "images/Nombre Artista.png".
    if (!names.has(name)) names.set(name, []);
    names.get(name).push(key);
    const parent = norm(dir.split('/').filter(Boolean).at(-1) || '');
    if (parent && [...COVER_NAMES, ...ARTIST_NAMES].includes(name)) {
      if (!folderNames.has(parent)) folderNames.set(parent, []);
      folderNames.get(parent).push({ key, name });
    }
  }
  for (const entries of dirs.values()) entries.sort((a, b) => a.key.localeCompare(b.key));
  const pick = (entries, preferred) => {
    if (!entries?.length) return null;
    for (const name of preferred) {
      const hit = entries.find((e) => e.name === name);
      if (hit) return hit.key;
    }
    return null;
  };
  const artistImage = (name) => {
    const id = norm(name);
    if (!id) return null;
    return names.get(id)?.[0] || names.get(`${id} logo`)?.[0] || names.get(`${id} artist`)?.[0] || pick(folderNames.get(id), [...ARTIST_NAMES, ...COVER_NAMES]);
  };
  return {
    find({ track, folder, artist, kind = 'track' } = {}) {
      const artistName = artist || (track ? artistOf(track) : '');
      if (kind === 'artist') return artistImage(artistName);
      if (track) {
        let dir = directory(track.key);
        const entries = dirs.get(dir);
        const exact = entries?.find((e) => e.name === norm(baseName(track.key)));
        if (exact) return exact.key;
        const cover = pick(entries, COVER_NAMES);
        if (cover) return cover;
        if (entries?.length === 1) return entries[0].key;
        const portrait = artistImage(artistName);
        if (portrait) return portrait;
        // La imagen genérica de un álbum/artista puede estar en una carpeta superior.
        while (dir) {
          const match = pick(dirs.get(dir), [...COVER_NAMES, ...ARTIST_NAMES]);
          if (match) return match;
          dir = directory(dir.slice(0, -1));
        }
      }
      if (folder) {
        const dir = folder.replace(/\/$/, '') + '/';
        const entries = dirs.get(dir);
        const exact = entries?.find((e) => e.name === norm(folder.split('/').at(-1)));
        return pick(entries, COVER_NAMES) || exact?.key || artistImage(folder.split('/').at(-1)) || pick(entries, ARTIST_NAMES);
      }
      return artistImage(artistName);
    }
  };
}
