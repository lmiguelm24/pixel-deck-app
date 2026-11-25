// Motor de audio de Pixel Deck: dos bandejas (A/B) como una mesa de DJ.
//
//  bandeja A ─ filtro ─ ganancia ─┐
//                                 ├─ PRE ─ EQ 10 bandas ─ MASTER ─ limitador ─┬─ altavoz
//  bandeja B ─ filtro ─ ganancia ─┘                                           ├─ espectro
//                                                                             └─ VU izq/der
//
// Las transiciones se programan en el hilo de audio (setValueCurveAtTime), así que suenan
// suaves aunque la pantalla esté apagada. El cambio de bandeja se dispara con los eventos
// del propio audio (timeupdate/ended), que siguen llegando en segundo plano.

export const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_LABELS = ['31', '62', '125', '250', '500', '1K', '2K', '4K', '8K', '16K'];
export const EQ_PRESETS = {
  'Plano': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Fiesta': [6, 5, 3, 0, -1, 0, 1, 3, 4, 5],
  'Reggaetón': [7, 6, 4, 1, -1, 0, 1, 2, 3, 3],
  'Rock': [5, 4, 2, -1, -2, -1, 2, 4, 5, 5],
  'Pop': [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2],
  'Bajos +': [8, 7, 5, 3, 1, 0, 0, 0, 0, 0],
  'Voces': [-2, -2, -1, 1, 4, 5, 4, 2, 0, -1],
  'Romántica': [2, 2, 1, 0, 1, 2, 2, 1, 1, 0],
  'Audífonos': [3, 2, 0, -1, 0, 1, 2, 3, 2, 1]
};

const PARTY_MIN_XFADE = 8;
const curve = (n, fn) => { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1)); return c; };
const FADE_IN = curve(128, (x) => Math.sin((x * Math.PI) / 2));
const FADE_OUT = curve(128, (x) => Math.cos((x * Math.PI) / 2));

export function createEngine(h) {
  // h: { getNext(): Promise<item|null>, onTrackStart(item), onState(), onError(item) }
  let ctx = null;
  let busIn, pre, master, limiter, analyser, anL, anR;
  let eqNodes = [];
  const decks = [newDeck(), newDeck()];
  let active = 0;
  let xf = null;              // mezcla en curso: { from, to, end }
  let next = null;            // { item, deck } precargada, o { none: true }
  let requesting = null;
  let nextRevision = 0;
  let settings = { crossfade: 4, party: false };
  let eq = { on: true, bands: new Array(10).fill(0), preamp: 0, master: 0 };
  let lastEmit = 0;
  // detección de golpes para el modo fiesta
  let bassAvg = 0, lastBeat = 0, beatLevel = 0;

  function newDeck() {
    const el = new Audio();
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    return { el, item: null, src: null, filter: null, gain: null };
  }

  function ensureCtx() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    busIn = ctx.createGain();
    pre = ctx.createGain();
    eqNodes = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    master = ctx.createGain();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const split = ctx.createChannelSplitter(2);
    anL = ctx.createAnalyser(); anL.fftSize = 1024;
    anR = ctx.createAnalyser(); anR.fftSize = 1024;

    let node = busIn.connect(pre);
    eqNodes.forEach((b) => { node = node.connect(b); });
    node.connect(master).connect(limiter);
    limiter.connect(analyser).connect(ctx.destination);
    limiter.connect(split);
    split.connect(anL, 0);
    split.connect(anR, 1);

    decks.forEach((d) => {
      d.src = ctx.createMediaElementSource(d.el);
      d.filter = ctx.createBiquadFilter();
      d.filter.type = 'highpass';
      d.filter.frequency.value = 10;
      d.gain = ctx.createGain();
      d.gain.gain.value = 0;
      d.src.connect(d.filter).connect(d.gain).connect(busIn);
    });
    applyEq();
    document.addEventListener('visibilitychange', () => { if (ctx.state !== 'running') ctx.resume().catch(() => {}); });
  }

  // ---------- eventos de las bandejas ----------
  decks.forEach((d, i) => {
    d.el.addEventListener('timeupdate', () => onTime(i));
    d.el.addEventListener('ended', () => onEnded(i));
    // play/pausa se avisan al instante (sin el límite de 200 ms de la barra de tiempo)
    d.el.addEventListener('play', () => emit(true));
    d.el.addEventListener('pause', () => emit(true));
    d.el.addEventListener('loadedmetadata', () => emit(true));
    d.el.addEventListener('error', () => onDeckError(i));
  });

  function emit(force) {
    const now = performance.now();
    if (force !== true && now - lastEmit < 200) return;
    lastEmit = now;
    h.onState && h.onState();
  }

  function effXfade(dur) {
    let x = settings.party ? Math.max(PARTY_MIN_XFADE, settings.crossfade) : settings.crossfade;
    if (isFinite(dur)) x = Math.min(x, dur * 0.35);
    return x;
  }

  function onTime(i) {
    emit();
    if (xf && i === xf.to && performance.now() >= xf.end) finishXfade();
    if (i !== active || xf) return;
    const d = decks[active];
    const dur = d.el.duration, t = d.el.currentTime;
    if (!isFinite(dur) || d.el.paused) return;
    const X = effXfade(dur);
    const remain = dur - t;
    if (!next && !requesting && remain < X + 20) requestNext();
    if (X > 0.3 && next && next.item && remain <= X) mixTo(next.item, X, settings.party);
  }

  function onEnded(i) {
    if (xf && i === xf.from) { finishXfade(); return; }
    if (i !== active) return;
    // sin transición (o canción muy corta): pasar a la siguiente al terminar
    if (next && next.item) { mixTo(next.item, 0.05, false); return; }
    const revision = nextRevision;
    requestNext().then(() => {
      if (revision !== nextRevision) return;
      if (next && next.item) mixTo(next.item, 0.05, false);
      else emit(true);
    });
  }

  function onDeckError(i) {
    const d = decks[i];
    if (!d.el.getAttribute('src')) return;
    if (next && next.deck === i) { next = null; return; }   // falló la precarga: se reintenta al final
    if (i === active) h.onError && h.onError(d.item);
  }

  async function requestNext() {
    if (requesting) return requesting;
    const revision = nextRevision;
    const operation = (async () => {
      try {
        const item = await h.getNext();
        // Una consulta remota puede terminar después de cambiar de canción/cola.
        if (revision !== nextRevision) return;
        if (item) {
          const o = 1 - active;
          load(o, item);
          next = { item, deck: o };
        } else {
          next = { none: true };
        }
        h.onNextReady && h.onNextReady(item);
      } catch {
        if (revision === nextRevision) next = null;
      }
    })();
    requesting = operation;
    try { await operation; }
    finally { if (requesting === operation) requesting = null; }
  }

  function load(i, item) {
    const d = decks[i];
    d.item = item;
    if (ctx) {
      const now = ctx.currentTime;
      d.gain.gain.cancelScheduledValues(now);
      d.gain.gain.setValueAtTime(0, now);
      d.filter.frequency.cancelScheduledValues(now);
      d.filter.frequency.setValueAtTime(10, now);
    }
    if (d.el.getAttribute('src') !== item.url) {
      d.el.src = item.url;
      d.el.load();
    } else {
      d.el.currentTime = 0;
    }
  }

  // Mezcla de la bandeja activa hacia la otra, en X segundos
  function mixTo(item, X, dj) {
    ensureCtx();
    if (xf) finishXfade();
    const o = 1 - active;
    const from = decks[active];
    const to = decks[o];
    if (to.item !== item) load(o, item);
    const now = ctx.currentTime + 0.02;
    const fromLevel = from.gain.gain.value;
    const wasPlaying = !from.el.paused && from.item;

    to.gain.gain.cancelScheduledValues(now);
    from.gain.gain.cancelScheduledValues(now);
    if (wasPlaying && X > 0.1) {
      to.gain.gain.setValueCurveAtTime(FADE_IN, now, X);
      from.gain.gain.setValueCurveAtTime(FADE_OUT.map((v) => v * fromLevel), now, X);
      if (dj) {
        // estilo DJ: a la que sale se le van quitando los graves; la que entra recupera los suyos
        from.filter.frequency.setValueAtTime(10, now);
        from.filter.frequency.exponentialRampToValueAtTime(1200, now + X);
        to.filter.frequency.setValueAtTime(500, now);
        to.filter.frequency.exponentialRampToValueAtTime(10, now + X * 0.85);
      }
    } else {
      to.gain.gain.setValueAtTime(1, now);
      from.gain.gain.setValueAtTime(0, now);
    }
    to.el.play().catch(() => {});
    xf = wasPlaying && X > 0.1 ? { from: active, to: o, end: performance.now() + X * 1000 } : null;
    if (!xf) stopDeck(active);
    active = o;
    nextRevision++;
    requesting = null;
    next = null;
    h.onTrackStart && h.onTrackStart(item);
    emit(true);
  }

  function stopDeck(i) {
    const d = decks[i];
    d.el.pause();
    if (ctx) {
      const now = ctx.currentTime;
      d.gain.gain.cancelScheduledValues(now);
      d.gain.gain.setValueAtTime(0, now);
      d.filter.frequency.cancelScheduledValues(now);
      d.filter.frequency.setValueAtTime(10, now);
    }
  }

  function finishXfade() {
    if (!xf) return;
    const { from, to } = xf;
    xf = null;
    stopDeck(from);
    decks[from].item = null;
    const d = decks[to];
    const now = ctx.currentTime;
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(1, now);
    d.filter.frequency.cancelScheduledValues(now);
    d.filter.frequency.setValueAtTime(10, now);
  }

  // ---------- ecualizador ----------
  function applyEq() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = eq.on;
    pre.gain.setTargetAtTime(Math.pow(10, (on ? eq.preamp : 0) / 20), t, 0.03);
    eqNodes.forEach((b, i) => b.gain.setTargetAtTime(on ? eq.bands[i] : 0, t, 0.03));
    master.gain.setTargetAtTime(Math.pow(10, eq.master / 20), t, 0.03);
  }

  // ---------- medidores ----------
  const spec = new Uint8Array(256);
  const tdL = new Float32Array(1024), tdR = new Float32Array(1024);
  const rmsDb = (buf) => { let s = 0, p = 0; for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; p = Math.max(p, Math.abs(buf[i])); } return [20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9), p]; };

  function levels() {
    if (!ctx || decks[active].el.paused) return null;
    analyser.getByteFrequencyData(spec);
    anL.getFloatTimeDomainData(tdL);
    anR.getFloatTimeDomainData(tdR);
    const [l, pl] = rmsDb(tdL);
    const [r, pr] = rmsDb(tdR);
    // golpe: energía de graves comparada con su promedio reciente
    let bass = 0;
    for (let i = 1; i < 7; i++) bass += spec[i];
    bass /= 6;
    bassAvg = bassAvg * 0.94 + bass * 0.06;
    const now = performance.now();
    if (bass > bassAvg * 1.18 && bass > 120 && now - lastBeat > 280) { lastBeat = now; beatLevel = 1; }
    beatLevel *= 0.9;
    return {
      spectrum: spec,
      vuL: Math.max(0, Math.min(1, (l + 42) / 42)),
      vuR: Math.max(0, Math.min(1, (r + 42) / 42)),
      clip: pl > 0.98 || pr > 0.98,
      limiting: limiter.reduction < -1,
      beat: beatLevel
    };
  }

  // ---------- API ----------
  return {
    // reproducir ya (con una transición corta si algo está sonando)
    playNow(item, fade = 0.6) {
      ensureCtx();
      ctx.resume().catch(() => {});
      mixTo(item, decks[active].el.paused ? 0 : fade, false);
    },
    toggle() {
      ensureCtx();
      ctx.resume().catch(() => {});
      const d = decks[active];
      if (!d.item) return false;
      if (d.el.paused) {
        if (xf) finishXfade();
        d.gain.gain.cancelScheduledValues(ctx.currentTime);
        d.gain.gain.setValueAtTime(1, ctx.currentTime);
        d.el.play().catch(() => {});
      } else {
        if (xf) finishXfade();
        d.el.pause();
      }
      return true;
    },
    play() { const d = decks[active]; if (d.item && d.el.paused) this.toggle(); },
    pause() { const d = decks[active]; if (d.item && !d.el.paused) this.toggle(); },
    seek(t) {
      if (xf) finishXfade();
      const d = decks[active];
      if (isFinite(d.el.duration)) d.el.currentTime = Math.max(0, Math.min(t, d.el.duration - 0.5));
    },
    skip(dt) { this.seek(decks[active].el.currentTime + dt); },
    // olvidar la siguiente precargada (cambió la cola, el aleatorio, etc.)
    resetNext() {
      nextRevision++;
      requesting = null;
      if (next && next.deck != null && !xf) { const d = decks[next.deck]; d.el.removeAttribute('src'); d.el.load(); d.item = null; }
      next = null;
      h.onNextReady && h.onNextReady(null);
    },
    setSettings(s) { settings = { ...settings, ...s }; },
    setEq(e) { eq = { ...eq, ...e }; applyEq(); },
    levels,
    state() {
      const d = decks[active];
      return {
        item: d.item,
        time: d.el.currentTime || 0,
        duration: d.el.duration,
        playing: !!d.item && !d.el.paused,
        mixing: !!xf
      };
    }
  };
}
