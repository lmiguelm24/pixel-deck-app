import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine } from '../src/lib/engine.js';

function fakeAudio() {
  const instances = [];
  class FakeAudio extends EventTarget {
    paused = false;
    duration = 100;
    currentTime = 90;
    src = '';
    constructor() { super(); instances.push(this); }
    load() {}
    getAttribute(name) { return name === 'src' ? this.src : null; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  return { FakeAudio, instances };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('la precarga remota de una cola antigua no reemplaza la siguiente de la cola nueva', async () => {
  const previous = globalThis.Audio;
  const { FakeAudio, instances } = fakeAudio();
  globalThis.Audio = FakeAudio;
  try {
    const requests = [], ready = [];
    const engine = createEngine({ getNext: () => new Promise((resolve) => requests.push(resolve)), onNextReady: (item) => ready.push(item?.key || null) });
    engine.setSettings({ crossfade: 0 });
    instances[0].dispatchEvent(new Event('timeupdate'));
    assert.equal(requests.length, 1);
    engine.resetNext();
    instances[0].dispatchEvent(new Event('timeupdate'));
    assert.equal(requests.length, 2);
    requests[1]({ key: 'new', url: 'https://example.com/new.mp3' });
    await flush();
    assert.equal(instances[1].src, 'https://example.com/new.mp3');
    requests[0]({ key: 'old', url: 'https://example.com/old.mp3' });
    await flush();
    assert.equal(instances[1].src, 'https://example.com/new.mp3');
    assert.deepEqual(ready, [null, 'new']);
  } finally { globalThis.Audio = previous; }
});

test('el final de canción comparte la consulta de precarga que ya está en curso', async () => {
  const previous = globalThis.Audio;
  const { FakeAudio, instances } = fakeAudio();
  globalThis.Audio = FakeAudio;
  try {
    let requests = 0, finish;
    const engine = createEngine({ getNext: () => { requests++; return new Promise((resolve) => { finish = resolve; }); } });
    engine.setSettings({ crossfade: 0 });
    instances[0].dispatchEvent(new Event('timeupdate'));
    instances[0].dispatchEvent(new Event('ended'));
    assert.equal(requests, 1);
    finish(null);
    await flush();
    assert.equal(instances[1].src, '');
  } finally { globalThis.Audio = previous; }
});
