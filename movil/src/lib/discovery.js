import { norm, topFolder, hashKey } from './format.js';

const GENRES = [
  ['Rock', 'rock|classic rock|rock alternativo|alternative rock'], ['Pop', 'pop|pop latino'],
  ['Reggaetón', 'reggaeton|regueton|urbano|urban'], ['Hip-hop', 'hip hop|hiphop|rap'],
  ['Electrónica', 'electronica|electronic|electronico|dance|house|techno|edm'],
  ['Salsa', 'salsa'], ['Bachata', 'bachata'], ['Merengue', 'merengue'],
  ['Cumbia', 'cumbia|cumbias'], ['Vallenato', 'vallenato|vallenatos'],
  ['Romántica', 'romantica|romanticas|romantico|romanticos|balada|baladas'],
  ['Jazz', 'jazz'], ['Blues', 'blues'], ['Metal', 'metal|heavy metal'],
  ['Clásica', 'clasica|classical'], ['R&B', 'r b|rnb|soul'], ['Reggae', 'reggae'],
  ['Country', 'country'], ['Folk', 'folk|folklore|folklorica'], ['Disco', 'disco'],
  ['Punk', 'punk'], ['Funk', 'funk'], ['Latina', 'latino|latina|latin'],
];
// Géneros ID3v1 frecuentes, también usados en TCON como "(17)".
const ID3_GENRES = { 0: 'Blues', 1: 'Classic Rock', 2: 'Country', 3: 'Dance', 4: 'Disco', 5: 'Funk', 6: 'Grunge', 7: 'Hip-Hop', 8: 'Jazz', 9: 'Metal', 10: 'New Age', 11: 'Oldies', 12: 'Other', 13: 'Pop', 14: 'R&B', 15: 'Rap', 16: 'Reggae', 17: 'Rock', 18: 'Techno', 20: 'Alternative', 21: 'Ska', 22: 'Death Metal', 24: 'Soundtrack', 32: 'Classical', 40: 'AlternRock', 43: 'Punk', 48: 'Ethnic', 52: 'Electronic', 80: 'Folk' };

export function genreOf(track) {
  let tag = String(track.genre || '').trim();
  const numeric = /^\(?(\d+)\)?$/.exec(tag);
  if (numeric) tag = ID3_GENRES[numeric[1]] || '';
  if (tag && !['other', 'unknown', 'desconocido'].includes(norm(tag))) {
    const match = GENRES.find(([, aliases]) => aliases.split('|').includes(norm(tag)));
    return match ? match[0] : tag;
  }
  const folders = track.key.split('/').slice(0, -1);
  for (const folder of folders) {
    const value = ` ${norm(folder)} `;
    const match = GENRES.find(([, aliases]) => aliases.split('|').some((alias) => value.includes(` ${alias} `)));
    if (match) return match[0];
  }
  return 'Sin género';
}

export function artistOf(track) {
  if (track.artist?.trim()) return track.artist.trim();
  const folders = track.key.split('/').slice(0, -1);
  // Género/Artista/[…]/canción: inferencia explícita cuando faltan etiquetas.
  if (folders.length >= 2 && genreOf({ key: `${folders[0]}/song.mp3` }) !== 'Sin género') return folders[1];
  return '';
}

export function groupTracks(tracks, getName) {
  const groups = new Map();
  for (const track of tracks) {
    const name = getName(track);
    if (!name) continue;
    const id = norm(name);
    if (!groups.has(id)) groups.set(id, { id, name, tracks: [] });
    groups.get(id).tracks.push(track);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
}

export function recordListen(history, key, at = Date.now()) {
  const next = { ...history, [key]: { count: (Number(history[key]?.count) || 0) + 1, lastPlayed: at } };
  return Object.fromEntries(Object.entries(next).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed).slice(0, 500));
}

export function discover(tracks, history, day = new Date().toISOString().slice(0, 10)) {
  const artists = new Map(), genres = new Map();
  for (const track of tracks) {
    const count = Math.min(20, Number(history[track.key]?.count) || 0);
    if (!count) continue;
    const artist = norm(artistOf(track)), genre = norm(genreOf(track));
    if (artist) artists.set(artist, (artists.get(artist) || 0) + count);
    if (genre !== 'sin genero') genres.set(genre, (genres.get(genre) || 0) + count);
  }
  const recent = tracks.filter((t) => history[t.key]?.lastPlayed).sort((a, b) => history[b.key].lastPlayed - history[a.key].lastPlayed).slice(0, 12);
  const ranked = tracks.map((track) => {
    const affinity = (artists.get(norm(artistOf(track))) || 0) * 3 + (genres.get(norm(genreOf(track))) || 0);
    const daily = parseInt(hashKey(`${day}|${track.key}`).slice(0, 8), 16) / 0xffffffff;
    return { track, score: affinity + daily * 8 - Math.min(10, history[track.key]?.count || 0) * 2 };
  }).sort((a, b) => b.score - a.score);
  // Evita una fila entera del mismo artista/carpeta; completa si la colección es pequeña.
  const recommended = [], seen = new Map();
  for (const { track } of ranked) {
    const id = norm(artistOf(track) || topFolder(track.key));
    if ((seen.get(id) || 0) >= 2) continue;
    recommended.push(track); seen.set(id, (seen.get(id) || 0) + 1);
    if (recommended.length === 12) break;
  }
  for (const { track } of ranked) {
    if (recommended.length >= Math.min(12, tracks.length)) break;
    if (!recommended.includes(track)) recommended.push(track);
  }
  return { recent, recommended, personalized: artists.size > 0 || genres.size > 0 };
}
