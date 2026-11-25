import Icon from './Icon.jsx';
import { labels } from '../lib/format.js';

export default function FavoriteButton({ track, active = false, onToggle, className = '' }) {
  const title = track ? labels(track).main : 'la canción';
  return <button className={`icon-btn favorite-btn${active ? ' is-favorite' : ''} ${className}`}
    disabled={!track?.key} aria-pressed={active}
    aria-label={`${active ? 'Quitar de' : 'Añadir a'} favoritos: ${title}`}
    onClick={(e) => { e.stopPropagation(); onToggle(track.key); }}>
    <Icon name="heart" size={22} filled={active} />
  </button>;
}
