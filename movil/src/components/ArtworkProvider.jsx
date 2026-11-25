import { createContext, useContext, useMemo } from 'react';
import { buildArtworkIndex } from '../lib/artwork.js';

const ArtworkContext = createContext(null);
export const useArtwork = () => useContext(ArtworkContext);

export default function ArtworkProvider({ images, r2, children }) {
  const value = useMemo(() => {
    const index = buildArtworkIndex(images);
    const urls = new Map();
    return {
      find: index.find,
      url(key) {
        if (!r2 || !key) return Promise.resolve(null);
        const saved = urls.get(key);
        if (saved && saved.expires > Date.now()) return saved.promise;
        const promise = Promise.resolve().then(() => r2.objectUrl(key)).catch((error) => { urls.delete(key); throw error; });
        urls.set(key, { promise, expires: Date.now() + 5 * 3600 * 1000 });
        return promise;
      }
    };
  }, [images, r2]);
  return <ArtworkContext.Provider value={value}>{children}</ArtworkContext.Provider>;
}
