import { useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Cover from '../components/Cover.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import { fmtTime } from '../lib/format.js';

const GENRES = [['', 'Todo'], ['Electronic', 'Electrónica'], ['Hip-Hop/Rap', 'Hip-hop'], ['Pop', 'Pop'], ['Rock', 'Rock'], ['Jazz', 'Jazz'], ['Latin', 'Latina'], ['House', 'House'], ['Lo-Fi', 'Lo-Fi'], ['Classical', 'Clásica'], ['Reggae', 'Reggae']];

export default function Audius({ client, online, onCatalog, onQueue, onPlay, favoriteKeys, onFavorite, onDownload, onRemove, downloads, apiKey, onApiKey, currentKey }) {
  const [query, setQuery] = useState('');
  const [genre, setGenre] = useState('');
  const [tracks, setTracks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState({ hasMore: false, nextOffset: 0 });
  const [retry, setRetry] = useState(0);
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const requestVersion = useRef(0);
  const register = useRef(onCatalog);
  register.current = onCatalog;
  useEffect(() => { onQueue(tracks.filter((track) => track.streamable)); }, [tracks, onQueue]);

  useEffect(() => {
    const version = ++requestVersion.current;
    setTracks([]); setError(''); setPage({ hasMore: false, nextOffset: 0 });
    if (!online) { setBusy(false); return; }
    setBusy(true);
    const timeout = setTimeout(async () => {
      try {
        const result = await client.list({ query, genre });
        if (requestVersion.current !== version) return;
        await register.current(result.tracks);
        if (requestVersion.current !== version) return;
        setTracks(result.tracks); setPage(result);
      } catch (e) { if (requestVersion.current === version) setError(e.message); }
      finally { if (requestVersion.current === version) setBusy(false); }
    }, query ? 450 : 0);
    return () => { clearTimeout(timeout); requestVersion.current++; };
  }, [client, query, genre, online, retry]);

  async function loadMore() {
    if (busy || !page.hasMore) return;
    const version = requestVersion.current;
    setBusy(true); setError('');
    try {
      const result = await client.list({ query, genre, offset: page.nextOffset });
      if (version !== requestVersion.current) return;
      await register.current(result.tracks);
      if (version !== requestVersion.current) return;
      setTracks((previous) => [...new Map([...previous, ...result.tracks].map((track) => [track.key, track])).values()]);
      setPage(result);
    } catch (e) { if (version === requestVersion.current) setError(e.message); }
    finally { if (version === requestVersion.current) setBusy(false); }
  }
  const playable = tracks.filter((track) => track.streamable);
  return <section className="audius-screen">
    <div className="pl-head"><Icon name="search" size={21} /><input type="search" aria-label="Buscar en Audius" placeholder="Canciones o artistas en Audius" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button className="icon-btn clear" aria-label="Borrar búsqueda de Audius" onClick={() => setQuery('')}><Icon name="close" size={18} /></button>}</div>
    <div className="chips" aria-label="Géneros de Audius">{GENRES.map(([id, title]) => <button className={'chip' + (genre === id ? ' on' : '')} aria-pressed={genre === id} key={id} onClick={() => setGenre(id)}>{title}</button>)}</div>
    <div className="audius-scroll">
      <div className="audius-intro"><span className="experimental-tag">EXPERIMENTAL</span><h2>{query.trim() ? 'Resultados en Audius' : genre ? `Tendencias · ${GENRES.find(([id]) => id === genre)?.[1]}` : 'Descubre otra escena'}</h2><p>Música de artistas de Audius. Tus corazones se guardan en Pixel Deck.</p></div>
      {!online && <div className="empty"><Icon name="cloud" size={36} /><h3>Audius necesita conexión</h3><p>Las canciones que ya descargaste siguen disponibles en Tu biblioteca.</p></div>}
      {error && <div className="audius-error" role="alert"><p>{error}</p><button className="pill" onClick={() => tracks.length ? loadMore() : setRetry((value) => value + 1)}>Reintentar</button></div>}
      {online && !busy && !error && !tracks.length && <div className="empty"><h3>No hay canciones para esta búsqueda</h3><p>Prueba otro artista o género.</p></div>}
      <div className="audius-results">{tracks.map((track) => {
        const saved = downloads.has(track.key), pending = downloads.isPending(track.key);
        return <article className={'audius-row' + (currentKey === track.key ? ' playing' : '')} key={track.key}>
          <button className="row-play" disabled={!track.streamable || !online} aria-label={`Reproducir ${track.title} en Audius`} onClick={() => onPlay(playable, playable.findIndex((item) => item.key === track.key))}><Cover name={track.artist} track={track} /><span className="row-text"><strong className="t">{track.title}</strong><small className="s">{track.artist} · {fmtTime(track.duration)}</small><small className="audius-track-note">{track.streamable ? track.genre || 'Audius' : 'Requiere acceso en Audius'}</small></span></button>
          <FavoriteButton track={track} active={favoriteKeys.has(track.key)} onToggle={onFavorite} />
          <button className="icon-btn" disabled={pending || (!saved && (!online || !track.downloadable))} aria-label={saved ? `Quitar descarga de ${track.title}` : track.downloadable ? `Descargar ${track.title} de Audius` : `Descarga no permitida: ${track.title}`} onClick={() => saved ? onRemove([track]) : onDownload([track])}>{pending ? '…' : <Icon name={saved ? 'check' : 'download'} size={19} />}</button>
        </article>;
      })}</div>
      {busy && <p className="audius-loading" role="status">{tracks.length ? 'Cargando más canciones…' : 'Consultando Audius…'}</p>}
      {online && page.hasMore && !busy && !error && <button className="pill audius-more" onClick={loadMore}>Cargar más</button>}
      <details className="audius-key"><summary>API Key de Audius (opcional)</summary><p>La lectura pública funciona sin clave. Puedes añadir tu API Key pública para identificar la app. No introduzcas un Bearer Token.</p><form onSubmit={async (e) => { e.preventDefault(); try { await onApiKey(keyDraft.trim()); } catch (failure) { setError(failure.message); } }}><input aria-label="API Key pública de Audius" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck="false" placeholder="Tu API Key pública" /><button className="pill" type="submit">Guardar</button></form></details>
    </div>
  </section>;
}
