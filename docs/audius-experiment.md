# Pruebas de Audius en Pixel Deck

Rama: `experiment/audius-discovery`, basada en `main` del fork `lmiguelm24/pixel-deck-app`.

## Qué se puede probar

- Pestaña **Audius**, accesible también desde Inicio.
- Tendencias semanales, filtros por género y búsqueda de canciones/artistas.
- Búsqueda con espera de 450 ms, paginación, reintentos y protección ante respuestas que llegan fuera de orden.
- Reproductor y cola existentes con las fuentes `cloud`, `audius` y `local`.
- Portadas de Audius, nombre del artista e identificación del origen de la música.
- Corazones locales, guardados en el teléfono con un espacio propio de Audius. Se muestran en **Tu biblioteca → Favoritos**, junto a los de la nube configurada.
- Descargas mediante el endpoint oficial cuando el artista las habilita y no requieren acceso adicional. Se comprueban los permisos actuales antes de descargar. El archivo conserva la extensión del original y aparece en **Descargadas**.
- Audius funciona sin configurar R2: una instalación sin nube abre directamente la pestaña Audius. Los ajustes permiten conectar R2 después.

Los favoritos se guardan en Pixel Deck. La rama utiliza exclusivamente operaciones de lectura de la API; no inicia sesión ni modifica una cuenta de Audius.

## Claves y datos

La API pública admite la lectura de muchos endpoints sin credenciales. En la pantalla Audius hay un apartado para guardar una **API Key pública opcional**, usada como `api_key`. El campo no es para el Bearer Token de servidor.

Se usa `https://api.audius.co/v1` y `app_name=PixelDeck`. No se incorporan SDK ni dependencias nuevas. La API se consulta con `CapacitorHttp`; el audio se reproduce con el motor Web Audio existente.

El catálogo local guarda metadatos y portadas, nunca URLs firmadas de audio. Se limita a 500 pistas exploradas, conservando además las que estén en Favoritos, Descargadas o en la cola. El catálogo de R2 sigue guardándose por separado. Las URLs de reproducción y los permisos se obtienen otra vez al preparar la canción.

`is_downloadable=true` es obligatorio para ofrecer descargas; `access.download=true` por sí solo no significa que estén permitidas. Las pistas con condiciones de acceso no se ofrecen como descargas públicas. Las pistas retiradas o con acceso restringido tampoco se ofrecen para streaming público.

## Compilar y probar

```bash
cd movil
npm ci
npm test
npm run test:audius:live   # necesita Internet
npm run android:apk
```

En Termux se aplican las variables `ANDROID_HOME` y `AAPT2_PATH` descritas en el README. Para la prueba pública no hace falta API Key. Si quieres usar una en el script de red, define `AUDIUS_API_KEY` con tu clave pública.

La prueba de red consulta tendencias, género y búsqueda, y solicita solo un rango de audio de una canción pública para verificar estado HTTP, tipo de contenido y cabeceras CORS. No descarga una canción completa.

## Comprobación en el teléfono

1. Instala el APK experimental como actualización de Pixel Deck: utiliza el mismo identificador de aplicación y conserva sus ajustes.
2. Entra en **Audius** y reproduce una tendencia. Comprueba audio, pausa, avance y siguiente canción.
3. Abre el reproductor ampliado, comprueba la portada y entra en **Sonido** para probar ecualizador y mezclas.
4. Busca un artista, cambia de género y comprueba **Cargar más** cuando haya otra página.
5. Añade una canción al corazón, cierra y abre la app y comprueba **Tu biblioteca → Favoritos**.
6. Con una canción que tenga descarga habilitada, confirma la descarga y comprueba su reproducción desde **Descargadas** sin conexión.
7. Reproduce una canción de R2 y otra de Audius para comprobar el cambio de origen.
8. Apaga la pantalla y comprueba la reproducción y los controles de notificación.

Las pruebas de lógica y las pruebas de interacción con HTTP/almacenamiento/audio simulados no sustituyen estas comprobaciones de Android. Las cabeceras CORS se han verificado con una canción pública; la disponibilidad de cada pista y nodo puede variar.

## Referencias

- [OpenAPI de Audius](https://api.audius.co/v1/swagger.yaml).
- [API y descripción general](https://docs.audius.co/developers/introduction/overview).
- [Documentación de pistas y permisos](https://docs.audius.co/sdk/tracks).
- [API Key pública y autenticación](https://docs.audius.co/sdk).
