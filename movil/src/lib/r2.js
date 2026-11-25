// Conexión con Cloudflare R2 (API compatible con S3).
// Las URLs se firman con el firmador oficial de AWS (verificado: genera la misma firma que el SDK).
// Las solicitudes van por CapacitorHttp (nativo), así que no hace falta configurar CORS en el bucket.
import { S3RequestPresigner } from '@aws-sdk/s3-request-presigner';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import { CapacitorHttp } from '@capacitor/core';
import { isImageKey } from './artwork.js';

export const AUDIO_EXT = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus'];

const rfc3986 = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
export const encodeKey = (key) => key.split('/').map(rfc3986).join('/');

function friendly(code, status) {
  if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch' || status === 401) return 'Las claves no son correctas.';
  if (code === 'NoSuchBucket') return 'Ese bucket no existe (revisa el nombre).';
  if (code === 'AccessDenied' || status === 403) return 'La clave no tiene permiso para ese bucket.';
  if (!status) return 'Sin conexión a internet o el endpoint está mal escrito.';
  return `Error de la nube (${code || status}).`;
}

function xmlCode(text) {
  const m = /<Code>([^<]+)<\/Code>/.exec(text || '');
  return m ? m[1] : null;
}

function toBytes(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') {
    const bin = atob(data);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(0);
}

export function makeR2(cfg) {
  const endpoint = new URL(cfg.endpoint.trim());
  const host = endpoint.host;
  const proto = endpoint.protocol; // https: en R2
  const bucket = cfg.bucket.trim();
  const presigner = new S3RequestPresigner({
    credentials: { accessKeyId: cfg.accessKeyId.trim(), secretAccessKey: cfg.secretAccessKey.trim() },
    region: 'auto',
    sha256: Sha256
  });

  async function presign(path, query, expiresIn = 6 * 3600) {
    const req = new HttpRequest({ protocol: proto, hostname: endpoint.hostname, port: endpoint.port ? Number(endpoint.port) : undefined, method: 'GET', path, query, headers: { host } });
    const s = await presigner.presign(req, { expiresIn });
    const qs = Object.entries(s.query).map(([k, v]) => rfc3986(k) + '=' + rfc3986(String(v))).join('&');
    return `${proto}//${host}${s.path}?${qs}`;
  }

  // URL temporal (6 h) para reproducir o descargar una canción
  const objectUrl = (key) => presign(`/${bucket}/${encodeKey(key)}`, { 'x-id': 'GetObject', 'x-amz-checksum-mode': 'ENABLED' });

  async function listAll(onPage, { includeImages = false } = {}) {
    const items = [];
    let token = null;
    do {
      const q = { 'list-type': '2', 'max-keys': '1000' };
      if (token) q['continuation-token'] = token;
      const url = await presign(`/${bucket}/`, q, 600);
      let res;
      try {
        res = await CapacitorHttp.get({ url, responseType: 'text', shouldEncodeUrlParams: false, connectTimeout: 20000, readTimeout: 30000 });
      } catch {
        throw new Error(friendly(null, 0));
      }
      const text = typeof res.data === 'string' ? res.data : String(res.data || '');
      if (res.status !== 200) throw new Error(friendly(xmlCode(text), res.status));
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      for (const c of doc.getElementsByTagName('Contents')) {
        const key = c.getElementsByTagName('Key')[0]?.textContent || '';
        const size = Number(c.getElementsByTagName('Size')[0]?.textContent || 0);
        const base = key.split('/').pop();
        const ext = (base.match(/\.[^.]+$/) || [''])[0].toLowerCase();
        if (!key.split('/').some((part) => part.startsWith('.')) && (AUDIO_EXT.includes(ext) || (includeImages && isImageKey(key)))) {
          items.push({ key, size, modified: c.getElementsByTagName('LastModified')[0]?.textContent || '' });
        }
      }
      const truncated = doc.getElementsByTagName('IsTruncated')[0]?.textContent === 'true';
      token = truncated ? doc.getElementsByTagName('NextContinuationToken')[0]?.textContent : null;
      if (onPage) onPage(items.length);
    } while (token);
    return items;
  }

  // Primeros bytes de una canción (para leer artista/título sin descargarla)
  async function range(key, start, end) {
    const url = await objectUrl(key);
    const res = await CapacitorHttp.get({
      url, headers: { Range: `bytes=${start}-${end}` }, responseType: 'arraybuffer', shouldEncodeUrlParams: false,
      connectTimeout: 15000, readTimeout: 20000
    });
    if (res.status !== 200 && res.status !== 206) throw new Error('range ' + res.status);
    return toBytes(res.data);
  }

  return { objectUrl, listAll, range, bucket };
}
