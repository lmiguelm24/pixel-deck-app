# Inicio, descubrimiento e imágenes en Android

## Organización

- **Inicio**: accesos a las últimas escuchas (o carpetas al empezar), Tu mix de hoy, recomendaciones, géneros, artistas y carpetas.
- **Buscar**: exploración visual por géneros antes de escribir y resultados al buscar por canción, artista, álbum, género o ruta.
- **Tu biblioteca**: colección completa, filtro de descargas y orden por título, artista o últimas escuchas.
- **Favoritos**: toca el corazón de una canción en Inicio, en las listas o en el reproductor. El corazón verde indica que está guardada. La lista está en **Tu biblioteca → Favoritos** y tiene un acceso desde Inicio; permite buscar, ordenar, reproducir y descargar la selección. Los favoritos se guardan en este teléfono por endpoint/bucket y se conservan al cerrar la app. Guardar una canción como favorita no la descarga automáticamente.

Las recomendaciones se calculan en el teléfono con canciones de tu propia biblioteca. Al empezar hay una selección variada; después se priorizan artistas y géneros que escuchas, evitando llenar toda la fila con un único artista. El historial guarda hasta 500 canciones y se asocia al endpoint/bucket. Sin conexión, Inicio utiliza las canciones descargadas.

Los géneros salen de las etiquetas ID3 y, cuando faltan, de nombres reconocibles en las carpetas, como `Rock`, `REGGAETON`, `Salsa` o `Jazz`. Las canciones sin información aparecen en **Sin género**. Los artistas salen de las etiquetas o de una ruta como `Género/Artista/Álbum/canción.mp3`.

## Fotos, portadas y logos

La sincronización ahora detecta imágenes JPG, JPEG, PNG, WebP, AVIF, GIF y SVG del mismo bucket privado. Se usan URLs firmadas temporales y las imágenes se solicitan cuando sus tarjetas entran en pantalla. El índice guardado contiene rutas, no URLs firmadas.

Ejemplos de organización que la app reconoce:

```text
Rock/
  folder.jpg                         ← portada de la carpeta Rock
  Nombre Artista/
    artist.jpg                       ← foto del artista
    logo.png                         ← logo del artista
    Nombre Álbum/
      cover.jpg                      ← portada de todas las canciones del álbum
      Una canción.mp3
      Una canción.jpg                ← portada específica de esa canción
images/
  Nombre Artista.jpg                 ← foto por nombre del artista
logos/
  Nombre Artista Logo.png            ← logo por nombre del artista
```

También se reconocen nombres como `folder`, `front`, `album`, `albumart`, `portada`, `caratula`, `artista`, `photo`, `foto` y `portrait`. Una única imagen junto a una canción puede servir como portada aunque tenga otro nombre. Los nombres de artistas se comparan sin distinguir mayúsculas o acentos. Un logo nombrado como tal se muestra completo sobre fondo oscuro; las fotos se recortan para llenar la tarjeta.

Después de subir imágenes al bucket, usa **Actualizar biblioteca** en Tu biblioteca. Si una imagen falta, no carga o no está disponible sin conexión, aparece la portada de color generada. Las imágenes deben estar dentro del bucket al que tiene acceso la clave de lectura configurada en la app.

El logo propio de Pixel Deck está en `movil/public/pixeldeck.svg`. `scripts/patch-android.mjs` también aplica los vectores de `movil/resources/` al icono de instalación de Android.

## Referencias de UX

Se tomaron como referencia estos patrones descritos por Spotify, adaptados a una colección privada:

- [Inicio: accesos recientes y descubrimiento visual](https://newsroom.spotify.com/2023-03-08/new-home-page-scroll-clips-previews/) (publicación de 2023).
- [Spotify Mixes: mezclas por artistas y géneros y filas horizontales](https://support.spotify.com/us/article/spotify-mixes/).
- [Buscar: canciones, artistas, álbumes y géneros](https://support.spotify.com/us/article/search/).

## Verificación

```bash
cd movil
npm test
npm run android:apk
```

Las pruebas de Node cubren asociación de imágenes, clasificación de géneros, recomendaciones e historial. Para la comprobación final en el teléfono: sincroniza un bucket con imágenes, abre Inicio, entra a un género y a un artista, reproduce una tarjeta, revisa el minirreproductor y la portada ampliada, y repite sin conexión con canciones descargadas.
