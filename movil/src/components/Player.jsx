import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Cover from './Cover.jsx';
import Display from './Display.jsx';
import FavoriteButton from './FavoriteButton.jsx';
import { fmtTime, labels, topFolder } from '../lib/format.js';

export default function Player({ current, state, engine, open, onOpen, onClose, onPlay, onPrev, onNext, shuffle, onShuffle, repeat, onRepeat, mix, onSound, source, online, favorite, onFavorite }) {
  const [seeking, setSeeking] = useState(null);
  const closeRef = useRef(null);
  const expandRef = useRef(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) expandRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => { setSeeking(null); }, [current?.key]);
  const lb = current ? labels(current) : { main: 'Tu próxima canción te espera', sub: 'Elige algo de tu biblioteca' };
  const duration = Number.isFinite(state.duration) ? state.duration : 0;
  const time = seeking ?? state.time;
  const pct = duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
  const commitSeek = (value) => {
    if (duration > 0) engine.seek(Number(value));
    setSeeking(null);
  };
  return <>
    <div className="mini-player" style={{ '--p': `${pct}%` }} inert={open ? true : undefined}>
      <button ref={expandRef} className="mini-track" onClick={onOpen} aria-label={`Abrir reproductor: ${lb.main}`}>
        <Cover name={current ? topFolder(current.key) : 'Pixel Deck'} track={current} priority />
        <span className="track-copy"><strong>{lb.main}</strong><small>{lb.sub || 'Pixel Deck'}</small></span>
      </button>
      <FavoriteButton track={current} active={favorite} onToggle={onFavorite} />
      <button className="icon-btn" onClick={onPlay} aria-label={state.playing ? 'Pausar' : 'Reproducir'}><Icon name={state.playing ? 'pause' : 'play'} /></button>
      <button className="icon-btn mini-next" onClick={onNext} aria-label="Siguiente canción"><Icon name="next" /></button>
    </div>
    {open && <section className="now-playing" role="dialog" aria-modal="true" aria-label="Reproductor" onKeyDown={(e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="player-heading">
        <button ref={closeRef} className="icon-btn" onClick={onClose} aria-label="Minimizar reproductor"><Icon name="down" /></button>
        <span><small>{current?.source === 'audius' ? 'DESCUBIERTO EN AUDIUS' : 'REPRODUCIENDO DESDE TU BIBLIOTECA'}</small><strong>{current?.source === 'audius' ? 'Audius' : current ? topFolder(current.key) || 'Todas las canciones' : 'Pixel Deck'}</strong></span>
        <button className="icon-btn" onClick={onSound} aria-label="Ajustes de sonido"><Icon name="sound" /></button>
      </header>
      <Cover name={current ? topFolder(current.key) : 'Pixel Deck'} track={current} className="player-cover" priority />
      <div className="player-meta"><div><h2>{lb.main}</h2><p>{lb.sub || 'Tu música, a tu manera'}</p></div><FavoriteButton track={current} active={favorite} onToggle={onFavorite} /></div>
      <div className="player-seek">
        <input aria-label="Posición de reproducción" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time || 0, duration || 1)} disabled={!duration}
          style={{ '--p': `${pct}%` }} onChange={(e) => setSeeking(Number(e.target.value))}
          onPointerUp={(e) => commitSeek(e.currentTarget.value)} onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commitSeek(e.currentTarget.value); }}
          onBlur={(e) => { if (seeking != null) commitSeek(e.currentTarget.value); }} />
        <div><span>{fmtTime(time)}</span><span>{fmtTime(duration)}</span></div>
      </div>
      <div className="player-controls">
        <button className={'icon-btn' + (shuffle || mix.party ? ' selected' : '')} disabled={mix.party} aria-label="Reproducción aleatoria" aria-pressed={shuffle || mix.party} onClick={onShuffle}><Icon name="shuffle" /></button>
        <button className="icon-btn" onClick={onPrev} aria-label="Canción anterior"><Icon name="prev" size={30} /></button>
        <button className="play-circle" onClick={onPlay} aria-label={state.playing ? 'Pausar' : 'Reproducir'}><Icon name={state.playing ? 'pause' : 'play'} size={32} /></button>
        <button className="icon-btn" onClick={onNext} aria-label="Siguiente canción"><Icon name="next" size={30} /></button>
        <button className={'icon-btn repeat-btn' + (repeat !== 'off' ? ' selected' : '')} onClick={onRepeat} aria-label={`Repetir: ${{ off: 'desactivado', all: 'todas', one: 'una' }[repeat]}`}><Icon name="repeat" />{repeat === 'one' && <span>1</span>}</button>
      </div>
      <div className="player-source"><Icon name={source === 'local' ? 'download' : source === 'audius' ? 'audius' : 'cloud'} size={16} /><span>{source === 'local' ? 'Desde tu teléfono' : source === 'audius' ? 'Audius · streaming' : !online ? 'Sin conexión' : 'Tu nube privada'}{mix.party ? ' · Modo fiesta' : ''}</span><button className="text-btn" onClick={onSound}>Sonido</button></div>
      <details className="visualizer"><summary>Visualizador en directo</summary><Display engine={engine} title={lb.main} trackKey={current?.key} time={time} duration={duration} playing={state.playing} mixing={state.mixing} source={source} offline={!online} party={mix.party} /></details>
    </section>}
  </>;
}
