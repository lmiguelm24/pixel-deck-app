// Lector mínimo de etiquetas ID3v2 (MP3): título, artista, álbum, año, género.
// Funciona con un trozo del inicio del archivo; lee lo que alcance.
const TEXT = {
  TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'year', TDRC: 'year', TCON: 'genre',
  TT2: 'title', TP1: 'artist', TAL: 'album', TYE: 'year', TCO: 'genre'
};

function decodeText(bytes) {
  if (!bytes.length) return '';
  const enc = bytes[0];
  let body = bytes.subarray(1);
  let s = '';
  try {
    if (enc === 0) s = new TextDecoder('latin1').decode(body);
    else if (enc === 1) s = new TextDecoder('utf-16').decode(body);
    else if (enc === 2) s = new TextDecoder('utf-16be').decode(body);
    else s = new TextDecoder('utf-8').decode(body);
  } catch {
    s = '';
  }
  return s.replace(/\u0000+$/g, '').split('\u0000')[0].trim();
}

const synchsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);

export function parseId3(buf) {
  if (!buf || buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) return null;
  const ver = buf[3];
  const flags = buf[5];
  const tagEnd = Math.min(buf.length, synchsafe(buf, 6) + 10);
  let pos = 10;
  if (flags & 0x40 && ver >= 3) pos += ver === 4 ? synchsafe(buf, 10) : ((buf[10] << 24) | (buf[11] << 16) | (buf[12] << 8) | buf[13]) + 4;
  const out = {};
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  while (pos + hdrLen <= tagEnd) {
    const id = String.fromCharCode(...buf.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let size;
    if (ver === 2) size = (buf[pos + 3] << 16) | (buf[pos + 4] << 8) | buf[pos + 5];
    else if (ver === 4) size = synchsafe(buf, pos + 4);
    else size = ((buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7]) >>> 0;
    const start = pos + hdrLen;
    if (size <= 0 || start + size > buf.length) break;
    const field = TEXT[id];
    if (field && !out[field]) out[field] = decodeText(buf.subarray(start, start + size));
    pos = start + size;
  }
  if (out.genre) out.genre = out.genre.trim() || null;
  if (out.year) out.year = (out.year.match(/\d{4}/) || [null])[0];
  return Object.values(out).some(Boolean) ? out : null;
}
