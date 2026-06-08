/**
 * @file sw.js
 * @description Service Worker con tolerancia a fallos de precarga, ignorado de query params y soporte offline avanzado.
 */

const CACHE_NAME = 'lacolmena-ucab-v5';
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

// Evento de Instalación: Guarda los archivos esenciales en la caché tolerando fallos individuales
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
            .then(() => self.skipWaiting())
    );
});

// Evento de Activación: Limpia cachés antiguas
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[Service Worker] Borrando caché antigua:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Interceptor de Peticiones: Sirve desde caché (ignorando query strings) o red
self.addEventListener('fetch', (event) => {
    // Excluir peticiones que no sean GET o que no sean HTTP/HTTPS (por ejemplo, extensiones)
    if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) return;

    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
            if (cachedResponse) {
                // Devolver recurso de la caché, e intentar actualizarlo de fondo si hay red
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                    }
                }).catch(() => {/* Silenciar fallos de red en segundo plano */});
                
                return cachedResponse;
            }

            // Si no está en caché, ir a la red y almacenar dinámicamente si tiene éxito
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0)) {
                    const responseCopy = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseCopy);
                    });
                }
                return networkResponse;
            }).catch(() => {
                console.log('[Service Worker] Recurso no disponible offline:', event.request.url);
            });
        })
    );
});