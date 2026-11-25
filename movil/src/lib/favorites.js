// Una lista por nube, guardada en Preferences. Serializa cambios rápidos para
// que un toque anterior no sobrescriba el último y confirma solo al guardar.
export function createFavorites({ read, write }) {
  const lists = new Map();
  const pending = new Map();
  const prefKey = (scope) => `favorites:${scope}`;
  const serialize = (scope, action) => {
    const operation = (pending.get(scope) || Promise.resolve()).then(action);
    pending.set(scope, operation.catch(() => {}));
    return operation;
  };
  async function ensure(scope) {
    if (!lists.has(scope)) {
      const saved = await read(prefKey(scope), []);
      lists.set(scope, [...new Set(Array.isArray(saved) ? saved.filter((key) => typeof key === 'string' && key.length > 0) : [])]);
    }
    return lists.get(scope);
  }
  return {
    load(scope) { return serialize(scope, async () => [...await ensure(scope)]); },
    toggle(scope, key) {
      return serialize(scope, async () => {
        const current = await ensure(scope);
        const added = !current.includes(key);
        const keys = added ? [key, ...current] : current.filter((item) => item !== key);
        await write(prefKey(scope), keys);
        lists.set(scope, keys);
        return { keys: [...keys], added };
      });
    }
  };
}
