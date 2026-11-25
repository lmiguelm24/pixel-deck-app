import Icon from './Icon.jsx';
import { useEffect, useRef, useState } from 'react';
import { useArtwork } from './ArtworkProvider.jsx';

// Portadas generadas a partir del nombre: no simulan carátulas ni necesitan red.
export default function Cover({ name = 'Pixel Deck', className = '', track, folder, artist, kind, priority = false }) {
  const artwork = useArtwork();
  const direct = track?.source === 'audius';
  const imageKey = direct ? (kind === 'artist' ? track.artistArtworkUrl : track.artworkUrl) : artwork?.find({ track, folder, artist, kind });
  const [image, setImage] = useState(null);
  const shell = useRef(null);
  useEffect(() => {
    let alive = true;
    setImage(null);
    if (!imageKey) return;
    const load = () => (direct ? Promise.resolve(imageKey) : artwork.url(imageKey)).then((url) => { if (alive && url) setImage({ key: imageKey, url }); }).catch(() => {});
    let observer;
    if (priority || typeof IntersectionObserver === 'undefined') load();
    else {
      observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: '150px' });
      observer.observe(shell.current);
    }
    return () => { alive = false; observer?.disconnect(); };
  }, [imageKey, artwork, priority, direct]);
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  return <span ref={shell} className={`cover ${className}`} style={{ '--cover-hue': hue }} aria-hidden="true"><span className="cover-ring" /><Icon name="music" size={28} />{image && image.key === imageKey && <img className={/(?:^|[/ _-])logo(?:[ ._-]|$)/i.test(imageKey) ? 'art-logo' : ''} src={image.url} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" onError={() => setImage(null)} />}</span>;
}
