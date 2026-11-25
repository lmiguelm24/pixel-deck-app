// Descargas para escuchar sin señal. Una canción a la vez, con progreso.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';
import { readJSON, writeJSON } from './storage.js';
import { hashKey } from './format.js';

const INDEX = 'downloads.json';

export function createDownloads(getR2, resolveDownload) {
  let index = {};          // key -> { path, size, at }
  let queue = [];          // [{ key, size }]
  let current = null;      // { key, size, pct }
  let done = 0, total = 0, failed = 0;
  let cancelled = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  const relPath = (key, extension) => {
    const ext = /^\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(extension || '') ? extension.toLowerCase() : (key.match(/\.[^./]+$/) || ['.mp3'])[0].toLowerCase();
    return `music/${hashKey(key)}${ext}`;
  };

  async function load() {
    index = await readJSON(INDEX, {});
    emit();
  }
  const save = () => writeJSON(INDEX, index).catch(() => {});

  async function playableUrl(key) {
    const d = index[key];
    if (!d) return null;
    const { uri } = await Filesystem.getUri({ path: d.path, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  }

  function enqueue(items) {
    const pending = new Set(queue.map((q) => q.key));
    if (current) pending.add(current.key);
    const add = items.filter((it) => !index[it.key] && !pending.has(it.key));
    if (!add.length) return 0;
    if (!current && !queue.length) { done = 0; total = 0; failed = 0; }
    queue.push(...add);
    total += add.length;
    cancelled = false;
    emit();
    if (!current) run();
    return add.length;
  }

  async function run() {
    let progressHandle = null;
    try {
      await Filesystem.mkdir({ path: 'music', directory: Directory.Data, recursive: true });
    } catch { /* ya existe */ }
    while (queue.length && !cancelled) {
      const item = queue.shift();
      current = { ...item, pct: 0 };
      emit();
      try {
        let resource;
        if (resolveDownload) resource = await resolveDownload(item);
        else {
          const r2 = getR2();
          if (!r2) throw new Error('sin nube');
          resource = { url: await r2.objectUrl(item.key) };
        }
        const { url, extension } = resource;
        const path = relPath(item.key, extension);
        const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
        if (progressHandle) await progressHandle.remove();
        progressHandle = await FileTransfer.addListener('progress', (p) => {
          if (current && p.lengthComputable && p.contentLength) {
            current.pct = Math.round((p.bytes / p.contentLength) * 100);
            emit();
          }
        });
        await FileTransfer.downloadFile({ url, path: uri, progress: true, shouldEncodeUrlParams: false, connectTimeout: 20000, readTimeout: 60000 });
        const stat = await Filesystem.stat({ path, directory: Directory.Data }).catch(() => null);
        index[item.key] = { path, size: stat?.size || item.size || 0, at: Date.now() };
        save();
        done++;
      } catch {
        failed++;
      }
      current = null;
      emit();
    }
    if (progressHandle) await progressHandle.remove();
    queue = [];
    current = null;
    emit();
  }

  function cancel() {
    cancelled = true;
    total -= queue.length;
    queue = [];
    emit();
  }

  async function remove(keys) {
    for (const key of keys) {
      const d = index[key];
      if (!d) continue;
      try { await Filesystem.deleteFile({ path: d.path, directory: Directory.Data }); } catch { /* ya no estaba */ }
      delete index[key];
    }
    save();
    emit();
  }

  return {
    load, enqueue, cancel, remove, playableUrl,
    has: (key) => !!index[key],
    keys: () => Object.keys(index),
    usedBytes: () => Object.values(index).reduce((s, d) => s + (d.size || 0), 0),
    status: () => ({ current, pending: queue.length, done, total, failed, active: !!current || queue.length > 0 }),
    isPending: (key) => (current && current.key === key) || queue.some((q) => q.key === key),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); }
  };
}
