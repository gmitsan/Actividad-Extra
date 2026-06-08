/**
 * @file sw.js
 * @description Service Worker para soporte Offline Real (Estrategia: Cache-First fallando a Red)
 */

const CACHE_NAME = 'lacolmena-ucab-v1';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/catalogo.html',
    '/detalle.html',
    '/registro.html',
    '/styles.css',
    '/app.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght=400;500;600;700;800&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

// Evento de Instalación: Guarda los archivos esenciales en la caché del navegador
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Precachando archivos base');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

// Evento de Activación: Limpia cachés antiguas si se actualiza la versión
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

// Interceptor de Peticiones: Si no hay red, sirve desde la caché
self.addEventListener('fetch', (event) => {
    // Excluir peticiones que no sean GET (como solicitudes a APIs externas de análisis si las hubiera)
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Devolver recurso de la caché, pero intentar actualizarlo de fondo si hay red
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
                    }
                }).catch(() => {/* Silenciar error si está offline */});
                
                return cachedResponse;
            }

            // Si no está en caché, ir a la red
            return fetch(event.request).catch(() => {
                // Si falla la red y es una petición de imagen/API, podrías retornar contingencias aquí
                console.log('[Service Worker] Recurso no disponible offline:', event.request.url);
            });
        })
    );
});