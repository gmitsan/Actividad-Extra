// El nombre de la base de datos de caché. 
const CACHE_NAME = 'lacolmena-ucab-v5';

// La lista de archivos que la web necesita sí o sí para poder abrirse sin internet.
const ASSETS_TO_CACHE = [
    'index.html',
    'catalogo.html',
    'detalle.html',
    'registro.html',
    'admin.html',
    'styles.css',
    'app.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght=400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Instala el Service Worker y guarda los archivos base en la caché (si uno falla, no rompe a los demás)
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Precachando archivos base uno a uno');
                return Promise.allSettled(
                    ASSETS_TO_CACHE.map((url) => {
                        return cache.add(url).catch((err) => {
                            console.warn(`[Service Worker] No se pudo precachear: ${url}`, err);
                        });
                    })
                );
            })
            .then(() => self.skipWaiting()) // Se activa de golpe sin esperar a que el usuario reinicie la pestaña
    );
});

// Se ejecuta al activarse: limpia las cachés viejas para que no ocupen espacio en el disco del usuario
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Eliminando caché antigua:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Toma las riendas de la página inmediatamente
    );
});

// Intercepta todo lo que la página pide a internet para decidir si lo sirve desde la caché o va a buscarlo en vivo
self.addEventListener('fetch', (event) => {
    // Solo nos interesan las peticiones normales de lectura (GET)
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        // 'ignoreSearch: true' hace que ignore los parámetros de la URL (así detalle.html?id=3 funciona offline usando detalle.html)
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                // Si ya lo tenemos guardado, lo muestra al instante e intenta actualizarlo de fondo si detecta internet
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                    }
                }).catch(() => {/* Silenciar fallos de red en segundo plano */});
                
                return cachedResponse;
            }

            // Si no estaba guardado, va a internet y aprovecha de guardarlo dinámicamente en la caché para la próxima
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                    const responseCopy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseCopy);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // El plan de contingencia por si el usuario no tiene internet ni el recurso guardado
                console.log('[Service Worker] Recurso no disponible offline:', event.request.url);
            });
        })
    );
});