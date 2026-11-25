import Cover from '../components/Cover.jsx';
import Icon from '../components/Icon.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import { labels } from '../lib/format.js';
import { artistOf } from '../lib/discovery.js';

export function GenreGrid({ genres, onOpen, limit }) {
  const groups = limit ? genres.slice(0, limit) : genres;
  return <div className="genre-grid">{groups.map((genre, i) => <button key={genre.id} className={`genre-tile tone-${i % 6}`} onClick={() => onOpen('genre', genre.name)} aria-label={`Explorar ${genre.name}`}>
    <strong>{genre.name}</strong><small>{genre.tracks.length} canciones</small><Cover name={genre.name} track={genre.tracks[0]} />
  </button>)}</div>;
}

function TrackShelf({ title, subtitle, tracks, onPlay, favoriteKeys, onFavorite }) {
  if (!tracks.length) return null;
  return <section className="home-section"><div className="shelf-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    <div className="home-shelf">{tracks.map((track, index) => {
      const lb = labels(track);
      return <div className="music-card track-card" key={track.key}><button className="music-card-link" aria-label={`Reproducir ${lb.main}`} onClick={() => onPlay(tracks, index)}><span className="music-card-art"><Cover name={artistOf(track) || lb.main} track={track} /><span className="card-play"><Icon name="play" size={20} /></span></span><strong>{lb.main}</strong><small>{artistOf(track) || lb.sub || 'De tu colección'}</small></button><FavoriteButton track={track} active={favoriteKeys.has(track.key)} onToggle={onFavorite} className="card-favorite" /></div>;
    })}</div>
  </section>;
}

export default function Home({ tracks, discovery, genres, artists, folders, onOpen, onPlay, onLibrary, onExplore, onRefresh, online, refreshing, favoriteKeys, onFavorite, onFavorites, onAudius }) {
  if (!tracks.length) return <div className="home-scroll"><div className="welcome-empty"><Icon name="music" size={44} /><h2>{online ? 'Tu colección empieza aquí' : 'Tu música, incluso sin señal'}</h2><p>{online ? 'Explora Audius o conecta tu nube desde los ajustes para escuchar tu propia colección.' : 'Aún no hay canciones descargadas. Cuando tengas conexión, descarga tus favoritas desde Tu biblioteca.'}</p><button className="pill on" onClick={online ? onAudius : onLibrary}>{online ? 'Descubrir en Audius' : 'Ver biblioteca'}</button>{online && <button className="text-btn" onClick={onRefresh} disabled={!!refreshing}>Conectar o actualizar mi nube</button>}</div></div>;
  const quick = discovery.recent.length ? discovery.recent.slice(0, 6) : folders.slice(0, 6);
  return <div className="home-scroll">
    <div className="home-chips"><button className="chip on" aria-pressed="true">Para ti</button><button className="chip" onClick={onExplore}>Géneros</button><button className="chip favorites-shortcut" onClick={onFavorites}><Icon name="heart" size={15} />Favoritos</button><button className="chip" onClick={onLibrary}>Tu colección</button></div>
    <button className="audius-home-link" onClick={onAudius}><Icon name="audius" size={30} /><span><strong>Descubrir en Audius</strong><small>Tendencias y nuevas voces · Experimental</small></span><Icon name="next" size={20} /></button>
    <div className="quick-grid" aria-label={discovery.recent.length ? 'Escuchado recientemente' : 'Accesos a tus carpetas'}>{quick.map((item) => {
      const track = item.key ? item : item.tracks[0];
      const title = item.key ? labels(item).main : item.name;
      return <button className="quick-card" key={item.key || item.id} onClick={() => item.key ? onPlay(discovery.recent, discovery.recent.indexOf(item)) : onOpen('folder', item.name)}><Cover name={title} track={track} folder={item.key ? undefined : item.name} /><strong>{title}</strong></button>;
    })}</div>
    <section className="daily-mix"><div className="mix-art"><Icon name="shuffle" size={42} /><span>DAILY<br /><b>DECK</b></span></div><div className="mix-copy"><span className="eyebrow">REDESCUBRE TU COLECCIÓN</span><h2>Tu mix de hoy</h2><p>{discovery.personalized ? 'Tus artistas y géneros favoritos, con algo por redescubrir.' : 'Un nuevo orden para las canciones que ya son tuyas.'}</p><button className="mix-start" onClick={() => onPlay(discovery.recommended, 0)}><Icon name="play" size={18} />Escuchar mix</button></div></section>
    <TrackShelf title="Recomendados para ti" subtitle={discovery.personalized ? 'Según tus escuchas en este teléfono' : 'Una selección de tu propia biblioteca'} tracks={discovery.recommended} onPlay={onPlay} favoriteKeys={favoriteKeys} onFavorite={onFavorite} />
    {discovery.recent.length > 0 && <TrackShelf title="Vuelve a escucharlas" subtitle="Lo último que escuchaste" tracks={discovery.recent} onPlay={onPlay} favoriteKeys={favoriteKeys} onFavorite={onFavorite} />}
    <section className="home-section"><div className="shelf-heading"><div><h2>Explora tus géneros</h2><p>Elige el sonido de tu día</p></div><button className="text-btn" onClick={onExplore}>Ver todos</button></div><GenreGrid genres={genres} onOpen={onOpen} limit={6} /></section>
    {artists.length > 0 && <section className="home-section"><div className="shelf-heading"><div><h2>Tus artistas</h2><p>Las voces de tu colección</p></div></div><div className="home-shelf">{artists.slice(0, 18).map((artist) => <button key={artist.id} className="music-card artist-card" onClick={() => onOpen('artist', artist.name)}><Cover name={artist.name} artist={artist.name} kind="artist" /><strong>{artist.name}</strong><small>{artist.tracks.length} canciones</small></button>)}</div></section>}
    <section className="home-section"><div className="shelf-heading"><div><h2>Explora tus carpetas</h2><p>Tu música, tal como la organizaste</p></div><button className="text-btn" onClick={onLibrary}>Ver biblioteca</button></div><div className="home-shelf">{folders.slice(0, 18).map((folder) => <button key={folder.id} className="music-card" onClick={() => onOpen('folder', folder.name)}><Cover name={folder.name} folder={folder.name} track={folder.tracks[0]} /><strong>{folder.name}</strong><small>{folder.tracks.length} canciones</small></button>)}</div></section>
    <p className="home-footnote"><Icon name={online ? 'cloud' : 'download'} size={14} />{online ? 'Solo tu música. Sin anuncios. Sin algoritmos externos.' : 'Mostrando la música descargada en este teléfono.'}</p>
  </div>;
}
