import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { CapacitorHttp } from '@capacitor/core';
import Icon from './components/Icon.jsx';
import Cover from './components/Cover.jsx';
import Player from './components/Player.jsx';
import FavoriteButton from './components/FavoriteButton.jsx';
import Logo from './components/Logo.jsx';
import ArtworkProvider from './components/ArtworkProvider.jsx';
import Home, { GenreGrid } from './screens/Home.jsx';
import Audius from './screens/Audius.jsx';
import VirtualList from './components/VirtualList.jsx';
import SoundSheet from './components/SoundSheet.jsx';
import Setup from './screens/Setup.jsx';
import { makeR2 } from './lib/r2.js';
import { parseId3 } from './lib/id3.js';
import { getPref, setPref, readJSON, writeJSON } from './lib/storage.js';
import { createDownloads } from './lib/downloads.js';
import { createEngine } from './lib/engine.js';
import { setNowPlaying, setPlaying as setMediaPlaying, setPosition, bindActions } from './lib/media.js';
import { tap, thump, tick } from './lib/haptics.js';
import { fmtSize, norm, labels, topFolder, parentFolder } from './lib/format.js';
import { isImageKey } from './lib/artwork.js';
import { genreOf, artistOf, groupTracks, discover, recordListen } from './lib/discovery.js';
import { createFavorites } from './lib/favorites.js';
import { AUDIUS_SCOPE, createAudiusClient, isAudiusKey, mergeAudiusCatalog } from './lib/audius.js';

const ROW_H = 72;
const LIB_FILE = 'library.json';
const ART_FILE = 'artwork-index.json';
const AUDIUS_FILE = 'audius-catalog.json';
const cloudScope = (cfg) => `${cfg?.endpoint?.trim() || ''}|${cfg?.bucket?.trim() || ''}`;
const DEFAULT_EQ = { on: true, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, master: 0 };
const DEFAULT_MIX = { crossfade: 4, party: false };

// ¿El bucket permite que el ecualizador procese el audio de la nube? (CORS)
async function checkCors(r2, key) {
  try {
    const url = await r2.objectUrl(key);
    const r = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

export default function App() {
  // ---------- estado general ----------
  const [screen, setScreen] = useState('loading');   // loading | setup | main
  const [cfg, setCfg] = useState(null);
  const [setupBusy, setSetupBusy] = useState('');
  const [setupError, setSetupError] = useState('');
  const [library, setLibrary] = useState([]);
  const [images, setImages] = useState([]);
  const [listening, setListening] = useState({});
  const listeningRef = useRef({});
  const scopeRef = useRef('');
  const favoriteStore = useMemo(() => createFavorites({ read: getPref, write: setPref }), []);
  const [favorites, setFavorites] = useState([]);
  const [audiusFavorites, setAudiusFavorites] = useState([]);
  const audiusFavoritesRef = useRef(audiusFavorites);
  audiusFavoritesRef.current = audiusFavorites;
  const [audiusApiKey, setAudiusApiKey] = useState('');
  const [audiusCatalog, setAudiusCatalog] = useState([]);
  const [audiusQueue, setAudiusQueue] = useState([]);
  const audiusCatalogRef = useRef([]);
  const catalogWrites = useRef(Promise.resolve());
  const favoriteKeys = useMemo(() => new Set([...favorites, ...audiusFavorites]), [favorites, audiusFavorites]);
  const [libVersion, setLibVersion] = useState(0);
  const [tab, setTab] = useState('cloud');
  const [view, setView] = useState('home');
  const [playerOpen, setPlayerOpen] = useState(false);
  const searchRef = useRef(null);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');
  const [collection, setCollection] = useState(null);
  const [sort, setSort] = useState('original');
  const navigationRef = useRef(null);
  navigationRef.current = { screen, view, folder, collection, search };
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [, setDlTick] = useState(0);
  const [refreshing, setRefreshing] = useState('');
  const [corsOk, setCorsOk] = useState(true);
  const [playbackBusy, setPlaybackBusy] = useState('');
  const playbackRequest = useRef(0);

  // ---------- reproductor ----------
  const [queue, setQueue] = useState([]);
  const [qi, setQi] = useState(-1);
  const [source, setSource] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [eq, setEqState] = useState(DEFAULT_EQ);
  const [mix, setMixState] = useState(DEFAULT_MIX);
  const [soundOpen, setSoundOpen] = useState(false);
  const [, setUi] = useState(0);

  const r2Ref = useRef(null);
  const libMap = useRef(new Map());
  const audius = useMemo(() => createAudiusClient({ apiKey: audiusApiKey, request: (url) => CapacitorHttp.get({ url, responseType: 'json', shouldEncodeUrlParams: false, connectTimeout: 15000, readTimeout: 20000 }) }), [audiusApiKey]);
  const audiusRef = useRef(audius);
  audiusRef.current = audius;
  const dl = useMemo(() => createDownloads(() => r2Ref.current, async (item) => {
    if (isAudiusKey(item.key)) {
      const resolved = await audiusRef.current.download(item.key);
      return { url: resolved.url, extension: resolved.track.downloadExtension };
    }
    if (!r2Ref.current) throw new Error('Configura tu nube para descargar esta canción.');
    return { url: await r2Ref.current.objectUrl(item.key) };
  }), []);
  const st = useRef({});
  st.current = { queue, qi, shuffle: shuffle || mix.party, repeat, online, party: mix.party };
  const bag = useRef([]);            // orden aleatorio sin repetir
  const history = useRef([]);
  const pending = useRef(null);      // índice de la siguiente ya elegida
  const failStreak = useRef(0);
  const wasPlaying = useRef(false);
  const lastPos = useRef(0);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => setToast(''), 2800);
  }, []);

  const rememberAudius = useCallback((tracks) => {
    const protectedKeys = [...audiusFavoritesRef.current, ...dl.keys(), ...st.current.queue];
    const catalog = mergeAudiusCatalog(audiusCatalogRef.current, tracks, protectedKeys);
    audiusCatalogRef.current = catalog;
    setAudiusCatalog(catalog);
    const catalogKeys = new Set(catalog.map((track) => track.key));
    for (const key of libMap.current.keys()) if (isAudiusKey(key) && !catalogKeys.has(key)) libMap.current.delete(key);
    tracks.forEach((track) => libMap.current.set(track.key, track));
    const write = catalogWrites.current.catch(() => {}).then(() => writeJSON(AUDIUS_FILE, catalog));
    catalogWrites.current = write;
    return write;
  }, [dl]);

  const toggleFavorite = useCallback(async (key) => {
    if (!key) return;
    tap();
    const remote = isAudiusKey(key);
    const scope = remote ? AUDIUS_SCOPE : scopeRef.current;
    try {
      if (remote) await rememberAudius([]);
      const result = await favoriteStore.toggle(scope, key);
      if (!remote && scope !== scopeRef.current) return;
      if (remote) setAudiusFavorites(result.keys);
      else setFavorites(result.keys);
      showToast(result.added ? 'Añadida a Favoritos' : 'Quitada de Favoritos');
    } catch {
      showToast('No se pudieron guardar tus favoritos. Inténtalo de nuevo.');
    }
  }, [favoriteStore, showToast, rememberAudius]);

  // ---------- cola ----------
  const buildItem = useCallback(async (index) => {
    const { queue: q, online: on } = st.current;
    const key = q[index];
    if (!key) return null;
    let t = libMap.current.get(key) || { key };
    let url = null, src = '';
    if (dl.has(key)) { url = await dl.playableUrl(key); src = 'local'; }
    else if (on && isAudiusKey(key)) {
      const resolved = await audiusRef.current.stream(key);
      await rememberAudius([resolved.track]);
      t = resolved.track;
      url = resolved.url; src = 'audius';
    }
    else if (on && r2Ref.current) { url = await r2Ref.current.objectUrl(key); src = 'cloud'; }
    if (!url) return null;
    return { key, index, url, src, title: t.title, artist: t.artist, album: t.album };
  }, [dl, rememberAudius]);

  const refillBag = (len, exclude) => {
    const a = [];
    for (let i = 0; i < len; i++) if (i !== exclude) a.push(i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    bag.current = a;
  };

  // índice siguiente (auto = al terminar la canción)
  const pickNext = (from, auto) => {
    const { queue: q, shuffle: sh, repeat: rp, party } = st.current;
    if (!q.length) return null;
    if (auto && rp === 'one') return from;
    if (sh) {
      if (!bag.current.length) {
        if (auto && rp === 'off' && !party && history.current.length >= q.length - 1) return null;
        refillBag(q.length, from);
      }
      return bag.current.shift() ?? null;
    }
    if (from + 1 < q.length) return from + 1;
    return auto && rp === 'off' ? null : 0;
  };

  // Busca la siguiente que se pueda reproducir (sin señal salta las no descargadas)
  const nextPlayable = useCallback(async (from, auto) => {
    const len = st.current.queue.length;
    let idx = from;
    for (let tries = 0; tries < Math.min(len, 200); tries++) {
      idx = pickNext(idx, auto);
      if (idx == null) return null;
      let item;
      try { item = await buildItem(idx); }
      catch { if (auto && st.current.repeat === 'one') return null; continue; }
      if (item) return item;
      if (auto && st.current.repeat === 'one') return null;
    }
    return null;
  }, [buildItem]);

  // ---------- motor de audio ----------
  const engine = useMemo(() => createEngine({
    getNext: async () => {
      return nextPlayableRef.current(st.current.qi, true);
    },
    onNextReady: (item) => { pending.current = item ? item.index : null; },
    onTrackStart: (item) => {
      if (st.current.qi >= 0 && st.current.qi !== item.index) history.current.push(st.current.qi);
      pending.current = null;
      setQi(item.index);
      setSource(item.src);
      const t = libMap.current.get(item.key) || item;
      const nextHistory = recordListen(listeningRef.current, item.key);
      listeningRef.current = nextHistory;
      setListening(nextHistory);
      setPref('listening', { scope: scopeRef.current, history: nextHistory }).catch(() => {});
      const lb = labels({ ...t, key: item.key });
      setNowPlaying({ title: lb.main, artist: t.artist || parentFolder(item.key), album: t.album || topFolder(item.key) });
    },
    onState: () => {
      const s = engineRef.current.state();
      if (s.playing !== wasPlaying.current) {
        wasPlaying.current = s.playing;
        setMediaPlaying(s.playing ? 'playing' : 'paused');
        if (s.playing) failStreak.current = 0;
      }
      if (Math.abs(s.time - lastPos.current) > 5 || !s.playing) { lastPos.current = s.time; setPosition(s.duration, s.time); }
      setUi((n) => (n + 1) % 1e9);
    },
    onError: (item) => {
      failStreak.current++;
      if (failStreak.current > 8) { failStreak.current = 0; showToast('No se pudo reproducir. Revisa la conexión.'); return; }
      showToast('No se pudo reproducir, paso a la siguiente');
      goNextRef.current(true, item ? item.index : st.current.qi);
    }
  }), [showToast]);
  const engineRef = useRef(engine);
  const nextPlayableRef = useRef(nextPlayable);
  nextPlayableRef.current = nextPlayable;

  const playFrom = useCallback(async (list, index) => {
    tap();
    const request = ++playbackRequest.current;
    const q = list.map((t) => t.key);
    st.current.queue = q;                 // disponible de inmediato para buildItem
    setQueue(q);
    bag.current = [];
    history.current = [];
    pending.current = null;
    engine.resetNext();
    setPlaybackBusy(isAudiusKey(q[index]) && !dl.has(q[index]) ? 'Preparando canción de Audius…' : '');
    try {
      let item = await buildItem(index);
      if (!item) item = await nextPlayable(index, false);
      if (request !== playbackRequest.current) return;
      if (!item) { showToast('Sin señal: esa canción no está descargada'); return; }
      engine.playNow(item, st.current.party ? 1.5 : 0.6);
    } catch (error) {
      if (request === playbackRequest.current) showToast(error.message || 'No se pudo reproducir esta canción.');
    } finally { if (request === playbackRequest.current) setPlaybackBusy(''); }
  }, [buildItem, engine, nextPlayable, showToast, dl]);

  const goNext = useCallback(async (auto = false, fromIndex) => {
    const request = ++playbackRequest.current;
    const from = fromIndex ?? st.current.qi;
    let item = null;
    if (!auto && pending.current != null) {
      try { item = await buildItem(pending.current); } catch { /* busca otra canción disponible */ }
    }
    if (!item) item = await nextPlayable(from, auto);
    if (request !== playbackRequest.current) return;
    setPlaybackBusy('');
    engine.resetNext();
    pending.current = null;
    if (!item) { if (!auto) showToast('No hay más canciones en la lista'); return; }
    engine.playNow(item, st.current.party ? 1.5 : 0.6);
  }, [buildItem, engine, nextPlayable, showToast]);
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  const goPrev = useCallback(async () => {
    const s = engine.state();
    if (s.time > 3) { engine.seek(0); return; }
    const { queue: q, qi: i, shuffle: sh } = st.current;
    if (!q.length) return;
    const idx = sh && history.current.length ? history.current.pop() : i <= 0 ? q.length - 1 : i - 1;
    const request = ++playbackRequest.current;
    try {
      const item = await buildItem(idx);
      if (request !== playbackRequest.current) return;
      setPlaybackBusy('');
      if (!item) { showToast('Sin señal: esa canción no está descargada'); return; }
      engine.resetNext();
      engine.playNow(item, 0.4);
    } catch (error) { if (request === playbackRequest.current) { setPlaybackBusy(''); showToast(error.message); } }
  }, [buildItem, engine, showToast]);

  const visibleRef = useRef([]);
  const togglePlay = useCallback(() => {
    thump();
    if (!engine.toggle() && visibleRef.current.length) playFrom(visibleRef.current, 0);
    setUi((n) => (n + 1) % 1e9);
  }, [engine, playFrom]);

  // Controles de la notificación / pantalla de bloqueo
  useEffect(() => {
    bindActions({
      play: () => engine.play(),
      pause: () => engine.pause(),
      next: () => goNextRef.current(false),
      prev: () => goPrev(),
      seek: (s) => engine.seek(s),
      skip: (d) => engine.skip(d)
    });
  }, [engine, goPrev]);

  // ---------- ajustes de sonido ----------
  const setEq = (e) => { setEqState(e); engine.setEq(e); setPref('eq', e); };
  const setMix = (m) => {
    setMixState(m);
    engine.setSettings(m);
    engine.resetNext();
    bag.current = [];
    setPref('mix', m);
    if (m.party !== mix.party) showToast(m.party ? '🎉 Modo fiesta activado' : 'Modo fiesta desactivado');
  };
  useEffect(() => { setPref('settings', { shuffle, repeat }); engine.resetNext(); bag.current = []; }, [shuffle, repeat, engine]);

  // ---------- guardado de la biblioteca ----------
  const saveLibTimer = useRef(null);
  const saveLibrary = useCallback(() => {
    clearTimeout(saveLibTimer.current);
    saveLibTimer.current = setTimeout(() => writeJSON(LIB_FILE, [...libMap.current.values()].filter((track) => !isAudiusKey(track.key)).map(({ _q, ...t }) => t)).catch(() => {}), 1500);
  }, []);
  const applyLibrary = useCallback((items) => {
    const cloudItems = items.filter((track) => !isAudiusKey(track.key));
    libMap.current = new Map([...audiusCatalogRef.current, ...cloudItems].map((t) => [t.key, t]));
    setLibrary(cloudItems);
  }, []);

  // ---------- inicio ----------
  useEffect(() => {
    (async () => {
      const [savedCfg, settings, lib, savedEq, savedMix, art, savedListening, savedAudius, savedApiKey, remoteFavorites] = await Promise.all([
        getPref('cloud', null), getPref('settings', {}), readJSON(LIB_FILE, []), getPref('eq', DEFAULT_EQ), getPref('mix', DEFAULT_MIX), readJSON(ART_FILE, null), getPref('listening', null), readJSON(AUDIUS_FILE, []), getPref('audius-api-key', ''), favoriteStore.load(AUDIUS_SCOPE)
      ]);
      await dl.load();
      const catalog = mergeAudiusCatalog([], Array.isArray(savedAudius) ? savedAudius : [], [...remoteFavorites, ...dl.keys()]);
      audiusCatalogRef.current = catalog;
      setAudiusCatalog(catalog); setAudiusApiKey(typeof savedApiKey === 'string' ? savedApiKey : ''); setAudiusFavorites(remoteFavorites);
      scopeRef.current = cloudScope(savedCfg);
      setFavorites(await favoriteStore.load(scopeRef.current));
      if (art?.scope === scopeRef.current && Array.isArray(art.images)) setImages(art.images);
      if (savedListening?.scope === scopeRef.current && savedListening.history) {
        listeningRef.current = savedListening.history;
        setListening(savedListening.history);
      }
      setShuffle(!!settings.shuffle);
      setRepeat(settings.repeat || 'off');
      const e = { ...DEFAULT_EQ, ...savedEq }, m = { ...DEFAULT_MIX, ...savedMix };
      setEqState(e); engine.setEq(e);
      setMixState(m); engine.setSettings(m);
      applyLibrary(Array.isArray(lib) ? lib : []);
      const net = await Network.getStatus().catch(() => ({ connected: true }));
      setOnline(net.connected);
      if (savedCfg) {
        setCfg(savedCfg);
        r2Ref.current = makeR2(savedCfg);
        setScreen('main');
        if (net.connected) {
          refreshLibrary(true);
          const first = lib && lib[0];
          if (first) checkCors(r2Ref.current, first.key).then(setCorsOk);
        }
      } else {
        setScreen('main'); setView('audius');
      }
    })();
    let previousFailures = 0;
    const sub = dl.subscribe(() => {
      setDlTick((n) => n + 1);
      const failures = dl.status().failed || 0;
      if (failures > previousFailures) showToast('No se pudo completar una descarga. Revisa la conexión y los permisos de la canción.');
      previousFailures = failures;
    });
    const netSub = Network.addListener('networkStatusChange', (s) => setOnline(s.connected));
    const backSub = CapApp.addListener('backButton', () => {
      if (document.querySelector('.sheet-wrap.open')) { setSoundOpen(false); return; }
      if (document.querySelector('.now-playing')) { setPlayerOpen(false); return; }
      const navigation = navigationRef.current;
      if (navigation.screen === 'setup' && r2Ref.current) { setScreen('main'); return; }
      if (navigation.collection || navigation.folder || navigation.search) {
        setCollection(null); setFolder(''); setSearch(''); return;
      }
      if (navigation.view !== 'home') { setView('home'); setTab('cloud'); return; }
      CapApp.minimizeApp().catch(() => {});
    });
    return () => { sub(); netSub.then((x) => x.remove()); backSub.then((x) => x.remove()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- biblioteca en la nube ----------
  async function refreshLibrary(quiet = false) {
    const r2 = r2Ref.current;
    if (!r2) { setSetupError(''); setScreen('setup'); return; }
    if (!quiet) setRefreshing('Leyendo tu biblioteca…');
    try {
      const catalog = await r2.listAll((n) => !quiet && setRefreshing(`Leyendo tu biblioteca… ${n} archivos`), { includeImages: true });
      if (r2 !== r2Ref.current) return;
      const items = catalog.filter((it) => !isImageKey(it.key));
      const artwork = catalog.filter((it) => isImageKey(it.key));
      setImages(artwork);
      writeJSON(ART_FILE, { scope: scopeRef.current, images: artwork }).catch(() => {});
      const merged = items.map((it) => {
        const old = libMap.current.get(it.key);
        return old ? { ...old, size: it.size, modified: it.modified } : { ...it };
      });
      applyLibrary(merged);
      saveLibrary();
      if (!quiet) showToast(`${merged.length} canciones · ${artwork.length} imágenes en la nube`);
    } catch (e) {
      if (!quiet) showToast(e.message);
    }
    setRefreshing('');
  }

  async function saveCloud(newCfg) {
    setSetupError('');
    setSetupBusy('Conectando…');
    try {
      const r2 = makeR2(newCfg);
      const catalog = await r2.listAll((n) => setSetupBusy(`Conectado. Leyendo archivos… ${n}`), { includeImages: true });
      const items = catalog.filter((it) => !isImageKey(it.key));
      const artwork = catalog.filter((it) => isImageKey(it.key));
      if (items.length) {
        setSetupBusy('Revisando permisos de reproducción…');
        const ok = await checkCors(r2, items[0].key);
        setCorsOk(ok);
        if (!ok) {
          setSetupError('Falta un ajuste en Cloudflare: activa CORS en el bucket (te dejé los pasos en el chat). Sin eso la música de la nube no puede pasar por el ecualizador.');
          setSetupBusy('');
          return;
        }
      }
      r2Ref.current = r2;
      const changed = scopeRef.current !== cloudScope(newCfg);
      scopeRef.current = cloudScope(newCfg);
      if (changed) { listeningRef.current = {}; setListening({}); }
      setFavorites(await favoriteStore.load(scopeRef.current));
      if (changed) { setTab('cloud'); setFolder(''); setCollection(null); setSearch(''); }
      await setPref('cloud', newCfg);
      setCfg(newCfg);
      setImages(artwork);
      writeJSON(ART_FILE, { scope: scopeRef.current, images: artwork }).catch(() => {});
      const merged = items.map((it) => ({ ...(!changed && libMap.current.get(it.key) || {}), ...it }));
      applyLibrary(merged);
      saveLibrary();
      setScreen('main');
      showToast(`¡Listo! ${merged.length} canciones · ${artwork.length} imágenes`);
    } catch (e) {
      setSetupError(e.message || 'No se pudo conectar.');
    }
    setSetupBusy('');
  }

  // ---------- etiquetas de lo que está a la vista ----------
  const metaQueue = useRef([]);
  const metaBusy = useRef(0);
  const pumpMeta = useCallback(() => {
    while (metaBusy.current < 3 && metaQueue.current.length) {
      const t = metaQueue.current.shift();
      metaBusy.current++;
      (async () => {
        try {
          const tags = parseId3(await r2Ref.current.range(t.key, 0, 32767));
          if (tags) Object.assign(t, tags);
        } catch { /* sin etiquetas */ }
        t.metaDone = true;
        t._q = false;
        metaBusy.current--;
        setLibVersion((v) => v + 1);
        saveLibrary();
        pumpMeta();
      })();
    }
  }, [saveLibrary]);

  const onVisible = useCallback((rows) => {
    if (!st.current.online || !r2Ref.current) return;
    rows.forEach((t) => {
      if (t.metaDone || t._q) return;
      if (!/\.mp3$/i.test(t.key)) { t.metaDone = true; return; }
      t._q = true;
      metaQueue.current.unshift(t);
    });
    metaQueue.current.splice(60).forEach((t) => { t._q = false; });
    pumpMeta();
  }, [pumpMeta]);

  // Lee una muestra acotada para que Inicio tenga artistas y géneros aun sin abrir la lista.
  useEffect(() => {
    if (screen !== 'main' || !online || !library.length) return;
    const step = Math.max(1, Math.floor(library.length / 24));
    const sample = library.filter((_, i) => i % step === 0).slice(0, 24);
    onVisible(sample);
  }, [screen, online, library, onVisible]);

  // ---------- listas filtradas ----------
  const folders = useMemo(() => {
    const m = new Map();
    library.forEach((t) => { const f = topFolder(t.key); m.set(f, (m.get(f) || 0) + 1); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }));
  }, [library]);

  const dlKeysCount = dl.keys().length;
  const allTracks = useMemo(() => [...library, ...audiusCatalog], [library, audiusCatalog]);
  const favoriteTracks = useMemo(() => {
    const byKey = new Map(allTracks.map((track) => [track.key, track]));
    return [...audiusFavorites, ...favorites].map((key) => byKey.get(key)).filter(Boolean);
  }, [allTracks, favorites, audiusFavorites]);
  const homeTracks = useMemo(() => online ? library : library.filter((t) => dl.has(t.key)), [library, online, dl, dlKeysCount]);
  const discovery = useMemo(() => discover(homeTracks, listening), [homeTracks, listening, libVersion]);
  const genreGroups = useMemo(() => groupTracks(homeTracks, genreOf), [homeTracks, libVersion]);
  const artistGroups = useMemo(() => groupTracks(homeTracks, artistOf), [homeTracks, libVersion]);
  const folderGroups = useMemo(() => groupTracks(homeTracks, (t) => topFolder(t.key)), [homeTracks]);
  const visible = useMemo(() => {
    const words = norm(search).split(' ').filter(Boolean);
    let base = tab === 'favorites' ? favoriteTracks : tab === 'downloads' ? allTracks.filter((t) => dl.has(t.key)) : library;
    if (tab === 'cloud' && folder) base = base.filter((t) => topFolder(t.key) === folder);
    if (collection?.kind === 'genre') base = base.filter((t) => norm(genreOf(t)) === norm(collection.value));
    if (collection?.kind === 'artist') base = base.filter((t) => norm(artistOf(t)) === norm(collection.value));
    if (words.length) base = base.filter((t) => {
      const hay = norm([t.title, artistOf(t), t.album, genreOf(t), t.year, t.key].filter(Boolean).join(' '));
      return words.every((w) => hay.includes(w));
    });
    if (sort === 'title') return [...base].sort((a, b) => labels(a).main.localeCompare(labels(b).main, 'es', { numeric: true }));
    if (sort === 'artist') return [...base].sort((a, b) => artistOf(a).localeCompare(artistOf(b), 'es'));
    if (sort === 'recent') return [...base].sort((a, b) => (listening[b.key]?.lastPlayed || 0) - (listening[a.key]?.lastPlayed || 0));
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, libVersion, search, folder, collection, tab, dlKeysCount, sort, listening, favoriteTracks, allTracks]);
  visibleRef.current = view === 'audius' ? audiusQueue : view === 'home' ? discovery.recommended : visible;

  // ---------- descargas ----------
  const dlStatus = dl.status();
  function askDownload(items) {
    const todo = items.filter((t) => !dl.has(t.key) && (!isAudiusKey(t.key) || t.downloadable));
    if (!online) { showToast('Necesitas conexión para descargar música.'); return; }
    if (!todo.length && items.some((t) => isAudiusKey(t.key) && !t.downloadable && !dl.has(t.key))) { showToast('El artista no permite descargar estas canciones.'); return; }
    if (!todo.length) { showToast('Ya están todas descargadas'); return; }
    const bytes = todo.reduce((s, t) => s + (t.size || 0), 0);
    setConfirm({
      text: `¿Descargar ${todo.length} ${todo.length === 1 ? 'canción' : 'canciones'} (${todo.some((t) => isAudiusKey(t.key)) ? 'tamaño por determinar' : fmtSize(bytes)}) a este teléfono?\nTe recomiendo hacerlo con WiFi.`,
      ok: 'DESCARGAR',
      action: () => { dl.enqueue(todo.map((t) => ({ key: t.key, size: t.size }))); showToast('Descarga iniciada'); }
    });
  }
  function askRemove(items) {
    const keys = items.filter((t) => dl.has(t.key)).map((t) => t.key);
    if (!keys.length) return;
    setConfirm({
      text: keys.length === 1 ? '¿Quitar esta canción del teléfono? Seguirá en la nube.' : `¿Quitar ${keys.length} canciones del teléfono? Seguirán en la nube.`,
      ok: 'QUITAR',
      action: () => dl.remove(keys)
    });
  }

  // ---------- pantalla ----------
  if (screen === 'loading') return <div className="splash"><Logo large pulse /></div>;
  if (screen === 'setup') {
    return <Setup initial={cfg} busy={setupBusy} error={setupError} onSave={saveCloud} onCancel={() => setScreen('main')} />;
  }

  const es = engine.state();
  const currentKey = es.item ? es.item.key : queue[qi];
  const current = currentKey ? libMap.current.get(currentKey) || { key: currentKey } : null;
  const filtered = !!(search || folder || collection);
  const browseGenres = view === 'search' && !search && !folder && !collection;

  const renderRow = (t, i) => {
    const lb = labels(t);
    const isCur = t.key === currentKey;
    const has = dl.has(t.key);
    const pend = !has && dl.isPending(t.key);
    const cur = dlStatus.current && dlStatus.current.key === t.key ? dlStatus.current.pct : null;
    const dim = !online && !has;
    const canDownload = !isAudiusKey(t.key) || t.downloadable;
    return (
      <div className={'row' + (isCur ? ' playing' : '') + (dim ? ' dim' : '')}>
        <button className="row-play" onClick={() => playFrom(visible, i)} aria-label={`Reproducir ${lb.main}`}>
        <Cover name={artistOf(t) || topFolder(t.key)} track={t} />
        <span className="row-text">
          <span className="t">{lb.main}</span>
          <span className="s">{isAudiusKey(t.key) ? `Audius · ${lb.sub}` : lb.sub}</span>
        </span>
        {isCur && <span className={'eqbars' + (es.playing ? ' on' : '')} aria-label={es.playing ? 'Reproduciendo' : 'En pausa'}><i /><i /><i /></span>}
        </button>
        <FavoriteButton track={t} active={favoriteKeys.has(t.key)} onToggle={toggleFavorite} />
        <button className={'dlbtn' + (has ? ' ok' : '') + (cur != null ? ' busy' : '')} style={cur != null ? { '--pct': cur + '%' } : null}
          aria-label={has ? `Quitar descarga de ${lb.main}` : canDownload ? `Descargar ${lb.main}` : `Descarga no permitida: ${lb.main}`} disabled={pend || (!has && !canDownload)}
          onClick={(e) => {
            e.stopPropagation();
            tick();
            if (has) askRemove([t]);
            else if (!pend) { if (!online) showToast('Necesitas internet para descargar'); else if (isAudiusKey(t.key)) askDownload([t]); else dl.enqueue([{ key: t.key, size: t.size }]); }
          }}>
          <span>{cur != null ? `${cur}%` : pend ? '…' : <Icon name={has ? 'check' : 'download'} size={20} />}</span>
        </button>
      </div>
    );
  };

  const emptyMsg = search || folder || collection
    ? <div className="empty"><Icon name="search" size={32} /><h3>No encontramos canciones</h3><p>Prueba otra búsqueda o quita los filtros.</p><button className="pill" onClick={() => { setSearch(''); setFolder(''); setCollection(null); }}>Quitar filtros</button></div>
    : tab === 'favorites'
    ? <div className="empty"><Icon name="heart" size={36} /><h3>Tus canciones favoritas, juntas</h3><p>Toca el corazón de una canción para guardarla aquí.</p><button className="pill on" onClick={() => setTab('cloud')}>Explorar canciones</button></div>
    : tab === 'downloads'
    ? <div className="empty"><Icon name="download" size={36} /><h3>Tu música va contigo</h3><p>Descarga canciones desde la pestaña Todas y escúchalas sin conexión.</p><button className="pill on" onClick={() => setTab('cloud')}>Explorar canciones</button></div>
    : <div className="empty">No hay canciones.<br /><button className="pill on" onClick={() => refreshLibrary()}>↻ ACTUALIZAR</button></div>;

  const press = (fn) => () => { tap(); fn(); };
  const navigate = (next) => {
    tap(); setView(next); setSearch(''); setFolder(''); setCollection(null);
    if (next !== 'library') setTab('cloud');
  };
  const openCollection = (kind, value) => {
    tap(); setSearch(''); setTab('cloud'); setView('library');
    setFolder(kind === 'folder' ? value : '');
    setCollection(kind === 'folder' ? null : { kind, value });
  };
  const openFavorites = () => {
    navigate('library'); setTab('favorites');
  };

  return (
    <ArtworkProvider images={images} r2={r2Ref.current}>
    <div className={'app' + (mix.party ? ' party' : '')}>
      <div className="browse" inert={playerOpen ? true : undefined}>
      <header className="titlebar">
        <Logo />
        <div className="header-actions">{!online && <span className="offline-badge">Sin conexión</span>}<button className="icon-btn" aria-label="Configurar conexión a la nube" onClick={press(() => { setSetupError(''); setScreen('setup'); })}><Icon name="settings" /></button></div>
      </header>
      <div className="page-heading"><div><span className="eyebrow">{view === 'audius' ? 'CATÁLOGO PÚBLICO · PRUEBAS' : view === 'home' ? 'HECHO PARA TI' : view === 'search' ? 'ENCUENTRA TU RITMO' : collection?.kind === 'artist' ? 'ARTISTA DE TU COLECCIÓN' : collection?.kind === 'genre' ? 'EXPLORANDO GÉNERO' : 'TU COLECCIÓN PERSONAL'}</span><h1>{view === 'audius' ? 'Descubrir en Audius' : view === 'home' ? 'Dale play a tu día' : view === 'search' ? 'Buscar y explorar' : collection?.value || folder || 'Tu biblioteca'}</h1></div><button className="icon-btn" aria-label="Abrir ajustes de sonido" onClick={() => setSoundOpen(true)}><Icon name="sound" /></button></div>
      {(playbackBusy || dlStatus.active || refreshing) && <div className="banner" role="status"><span>{playbackBusy || refreshing || `Descargando ${Math.min(dlStatus.done + 1, dlStatus.total)} de ${dlStatus.total}` + (dlStatus.current ? ` · ${dlStatus.current.pct}%` : '')}</span>{dlStatus.active && <button className="pill" onClick={press(() => dl.cancel())}>DETENER</button>}</div>}
      {view === 'audius' ? <Audius client={audius} online={online} onCatalog={rememberAudius} onQueue={setAudiusQueue} onPlay={playFrom} favoriteKeys={favoriteKeys} onFavorite={toggleFavorite} onDownload={askDownload} onRemove={askRemove} downloads={dl} currentKey={currentKey} apiKey={audiusApiKey} onApiKey={async (key) => { if (/^Bearer\s/i.test(key)) throw new Error('Introduce la API Key pública, no el Bearer Token.'); await setPref('audius-api-key', key); setAudiusApiKey(key); showToast('API Key de Audius guardada'); }} /> : view === 'home' ? <Home tracks={homeTracks} discovery={discovery} genres={genreGroups} artists={artistGroups} folders={folderGroups} onOpen={openCollection} onPlay={playFrom} onLibrary={() => navigate('library')} onExplore={() => navigate('search')} onRefresh={() => refreshLibrary()} online={online} refreshing={refreshing} favoriteKeys={favoriteKeys} onFavorite={toggleFavorite} onFavorites={openFavorites} onAudius={() => navigate('audius')} /> : <section className="playlist">
        {view === 'library' ? <div className="tabs" aria-label="Origen de las canciones">
          <button className={'tab' + (tab === 'cloud' ? ' on' : '')} aria-pressed={tab === 'cloud'} onClick={press(() => setTab('cloud'))}>Todas</button>
          <button className={'tab' + (tab === 'downloads' ? ' on' : '')} aria-pressed={tab === 'downloads'} onClick={press(() => { setTab('downloads'); setFolder(''); setCollection(null); })}><Icon name="download" size={16} />Descargadas{dlKeysCount ? ` · ${dlKeysCount}` : ''}</button>
          <button className={'tab' + (tab === 'favorites' ? ' on' : '')} aria-pressed={tab === 'favorites'} onClick={press(() => { setTab('favorites'); setFolder(''); setCollection(null); })}><Icon name="heart" size={16} filled={tab === 'favorites'} />Favoritos{favoriteTracks.length ? ` · ${favoriteTracks.length}` : ''}</button>
        </div> : null}

        {view !== 'home' && <div className="pl-head"><Icon name="search" size={21} />
          <input ref={searchRef} aria-label="Buscar artista, canción o carpeta" type="search" placeholder="¿Qué quieres escuchar?" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button className="icon-btn clear" aria-label="Borrar búsqueda" onClick={press(() => { setSearch(''); searchRef.current?.focus(); })}><Icon name="close" size={18} /></button>}
        </div>}

        {tab === 'cloud' && !browseGenres && (
          <div className="chips">
            <button className={'chip' + (!folder && !collection ? ' on' : '')} aria-pressed={!folder && !collection} onClick={press(() => { setFolder(''); setCollection(null); })}>Todas · {library.length}</button>
            {collection && <button className="chip on" onClick={() => setCollection(null)} aria-label={`Quitar filtro ${collection.value}`}>{collection.value} ×</button>}
            {folders.map(([f, n]) => (
              <button key={f} className={'chip' + (folder === f ? ' on' : '')} aria-pressed={folder === f}
                onClick={(e) => { tap(); const el = e.currentTarget; setCollection(null); setFolder(folder === f ? '' : f); el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); }}>{f} · {n}</button>
            ))}
          </div>
        )}

        {!corsOk && online && (
          <div className="banner warn">Falta activar CORS en el bucket: la música de la nube podría no sonar. Revisa los pasos en el chat.</div>
        )}

        {browseGenres ? <div className="explore-scroll"><h2>Explorar todo</h2><p className="explore-hint">Géneros de tus etiquetas y carpetas. Elige uno para ver sus canciones.</p>{genreGroups.length ? <GenreGrid genres={genreGroups} onOpen={openCollection} /> : <div className="empty">{online ? 'Actualiza tu biblioteca para explorar tus géneros.' : 'Descarga música para explorarla sin conexión.'}</div>}</div> : <>
        <div className="pl-bar">
          <span className="count">{collection?.value || folder || (view === 'search' ? 'Resultados' : tab === 'favorites' ? 'Favoritos' : tab === 'downloads' ? 'Sin conexión' : 'Todas las canciones')} · {visible.length}</span>
          <label className="sort-label"><span className="sr-only">Ordenar canciones</span><select aria-label="Ordenar canciones" value={sort} onChange={(e) => setSort(e.target.value)}><option value="original">Orden original</option><option value="title">Título</option><option value="artist">Artista</option><option value="recent">Escuchadas</option></select></label>
          <button className="icon-btn list-play" aria-label="Reproducir esta lista" disabled={!visible.length} onClick={() => playFrom(visible, 0)}><Icon name="play" size={20} /></button>
          {tab === 'cloud' && filtered && visible.length > 0 && <button className="pill" onClick={press(() => askDownload(visible))} aria-label="Descargar las canciones de esta selección"><Icon name="download" size={16} /></button>}
          {tab === 'favorites' && visible.some((t) => !isAudiusKey(t.key) || t.downloadable) && <button className="pill" onClick={press(() => askDownload(visible))} disabled={!online} aria-label="Descargar favoritos"><Icon name="download" size={16} /></button>}
          {tab === 'cloud' && !filtered && <button className="icon-btn" aria-label="Actualizar biblioteca" onClick={press(() => refreshLibrary())} disabled={!online || !!refreshing}><Icon name="refresh" size={20} /></button>}
          {tab === 'downloads' && dlKeysCount > 0 && <>
            <span className="count">{fmtSize(dl.usedBytes())}</span>
            <button className="pill" onClick={press(() => askRemove(visible))}>QUITAR {filtered ? 'ESTAS' : 'TODAS'}</button>
          </>}
        </div>

        <VirtualList items={visible} rowHeight={ROW_H} renderRow={renderRow} onVisible={tab !== 'downloads' ? onVisible : null}
          scrollKey={view + '|' + tab + '|' + folder + '|' + search + '|' + collection?.value + '|' + sort} empty={emptyMsg} />
        </>}
      </section>}
      </div>
      <Player current={current} state={es} engine={engine} open={playerOpen} onOpen={() => setPlayerOpen(true)} onClose={() => setPlayerOpen(false)} onPlay={togglePlay} onPrev={press(goPrev)} onNext={press(() => goNext(false))} shuffle={shuffle} onShuffle={press(() => setShuffle((v) => !v))} repeat={repeat} onRepeat={press(() => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r])))} mix={mix} onSound={() => setSoundOpen(true)} source={source} online={online} favorite={favoriteKeys.has(currentKey)} onFavorite={toggleFavorite} />
      <nav className="bottom-nav" aria-label="Navegación principal" inert={playerOpen ? true : undefined}>
        {[['home', 'Inicio'], ['search', 'Buscar'], ['audius', 'Audius'], ['library', 'Tu biblioteca']].map(([id, title]) => <button key={id} className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={id} /><span>{title}</span></button>)}
      </nav>
      <SoundSheet open={soundOpen} onClose={() => setSoundOpen(false)} eq={eq} setEq={setEq} mix={mix} setMix={setMix} />

      {confirm && (
        <div className="modal" onClick={() => setConfirm(null)}>
          <div className="card pop" onClick={(e) => e.stopPropagation()}>
            <p className="confirm-text">{confirm.text}</p>
            <div className="card-actions">
              <button className="pill" onClick={press(() => setConfirm(null))}>CANCELAR</button>
              <button className="pill on" onClick={press(() => { confirm.action(); setConfirm(null); })}>{confirm.ok}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" key={toast}>{toast}</div>}
    </div>
    </ArtworkProvider>
  );
}
