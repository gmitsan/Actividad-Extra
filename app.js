const AppState = {
    // Estado global de la app. Busca primero en los storages para mantener la sesión y el carrito del usuario.
    theme: localStorage.getItem('theme') || 'light',
    user: JSON.parse(sessionStorage.getItem('activeUser')) || null,
    products: JSON.parse(localStorage.getItem('products')) || [],
    cart: JSON.parse(localStorage.getItem('colmena_cart')) || [],
    ventas: JSON.parse(localStorage.getItem('colmena_ventas')) || [],
    reviews: JSON.parse(localStorage.getItem('colmena_reviews')) || {},
    offlineQueue: JSON.parse(localStorage.getItem('colmena_offline_queue')) || []
};

// El motor de arranque de la página una vez que el HTML está listo
document.addEventListener('DOMContentLoaded', async () => {
    applyThemeEngine(AppState.theme);
    syncNetworkBadge();
    
    // Registro del Service Worker para soporte PWA / Offline
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
            .catch(err => console.error('Error al registrar Service Worker:', err));
    }
    
    // Intenta traer los productos nuevos; si falla, se activa el plan de contingencia offline
    try {
        await guaranteeCacheData();
    } catch (e) {
        console.warn("No se pudo sincronizar la API externa, usando datos locales offline.", e);
    }
    
    // Encendemos los módulos visuales e interactivos
    initRouting();
    attachGlobalEvents();
    updateGlobalCartCounter();
    renderNavProfileWidget();
});

function initRouting() {
    const path = window.location.pathname;
    
    // Si un administrador se mete a la tienda por error, lo mandamos directo a su panel
    const isStorePage = path.endsWith('index.html') || path.endsWith('catalogo.html') || path.endsWith('detalle.html') || path === '/' || path.endsWith('/');
    if (isStorePage && AppState.user && AppState.user.role === 'Administrador') {
        window.location.href = 'admin.html';
        return;
    }
    
    // Guardia de seguridad: Si intentas entrar al panel admin sin serlo, te saca
    if (path.endsWith('admin.html')) {
        if (!AppState.user || AppState.user.role !== 'Administrador') {
            alert("Acceso denegado: Se requieren privilegios administrativos.");
            window.location.href = 'index.html';
            return;
        }
    }

    // Comportamiento dinámico: El logo llevará al panel si eres admin
    if (AppState.user && AppState.user.role === 'Administrador') {
        document.querySelectorAll('.logo, a.logo').forEach(el => {
            el.href = 'admin.html';
        });
    }

    // Enrutador básico para saber qué inicializar según la URL actual
    if (path.endsWith('index.html') || path === '/' || path.endsWith('/')) {
        renderApiFeaturedProducts();
        initNewsletterModule();
        
        // Auto-abre el checkout si viene redirigido desde el login tras intentar comprar
        if (window.location.search.includes('triggerCheckout=true')) {
            setTimeout(() => {
                window.history.replaceState({}, document.title, window.location.pathname);
                abrirPasarelaPagoModal();
            }, 800);
        }
    } else if (path.endsWith('catalogo.html')) {
        initCatalogoPage();
    } else if (path.endsWith('detalle.html')) {
        initDetallePage();
    } else if (path.endsWith('registro.html')) {
        initAuthModule();
    } else if (path.endsWith('admin.html')) {
        initAdminPage();
    }
}

async function guaranteeCacheData() {
    // Si ya tenemos productos guardados localmente, nos ahorramos la petición a la API
    if (AppState.products.length > 0) return;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos de tolerancia o se cae

        const res = await fetch('https://fakestoreapi.com/products', { signal: controller.signal });
        clearTimeout(timeoutId);
        
        // Formateamos la respuesta de la API adaptándola a las necesidades de nuestro inventario
        const apiData = await res.json();
        AppState.products = apiData.map(item => ({
            id: Number(item.id),
            title: item.title,
            price: item.price,
            category: item.category,
            description: item.description,
            image: item.image,
            stock: Math.floor(Math.random() * 12) + 4, // Stock aleatorio inicial para simulación
            rating: item.rating || { rate: 4.2, count: 8 }
        }));
        localStorage.setItem('products', JSON.stringify(AppState.products));
    } catch (error) {
        console.error("Cargando desde almacenamiento offline local por falla de red.", error);
        // Producto de emergencia para que la tienda no se vea rota si no hay internet ni caché previa
        if (AppState.products.length === 0) {
            AppState.products = [
                { id: 1, title: "Producto de Contingencia Local", price: 25.0, category: "electronica", description: "Cargado en modo offline seguro.", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400", stock: 5, rating: { rate: 5.0, count: 1 } }
            ];
            localStorage.setItem('products', JSON.stringify(AppState.products));
        }
    }
}

function updateGlobalCartCounter() {
    // Actualiza el número flotante del carrito en el menú de navegación
    const counters = document.querySelectorAll('#cart-global-count');
    const totalItems = AppState.cart.reduce((acc, item) => acc + item.cantidad, 0);
    counters.forEach(counter => {
        if (counter) counter.textContent = totalItems;
    });
}

function applyThemeEngine(theme) {
    // Inyecta el atributo del tema al HTML y cambia el icono de sol/luna
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) icon.className = theme === 'light' ? 'fa-regular fa-moon' : 'fa-solid fa-sun';
}

function syncNetworkBadge() {
    const badge = document.getElementById('network-status');
    const text = document.getElementById('network-text');
    const icon = document.getElementById('network-icon');
    
    // Monitorea el estado de la conexión e intenta procesar deudas si vuelve el internet
    const updateStatus = () => {
        const isOnline = navigator.onLine;
        if (badge) badge.className = `network-badge-colmena ${isOnline ? 'online' : 'offline'}`;
        if (text) text.textContent = isOnline ? "Conectado" : "Modo Sin Conexión";
        if (icon) icon.className = isOnline ? "fa fa-circle" : "fa fa-wifi";
        if (isOnline && AppState.offlineQueue.length > 0) {
            procesarColaOffline();
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

function attachGlobalEvents() {
    // Listener para cambiar el tema claro/oscuro
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
        AppState.theme = AppState.theme === 'light' ? 'dark' : 'light';
        applyThemeEngine(AppState.theme);
    });

    // Limpia eventos inline viejos y asigna la apertura limpia de la barra lateral del carrito
    document.querySelectorAll('[onclick="toggleCartSidebar(true)"]').forEach(btn => {
        btn.removeAttribute('onclick'); 
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleCartSidebar(true);
        });
    });

    // Cierre del carrito clickeando la equis
    const closeBtn = document.querySelector('.cart-close-btn');
    if (closeBtn) {
        closeBtn.removeAttribute('onclick');
        closeBtn.addEventListener('click', () => toggleCartSidebar(false));
    }

    // Cierre del carrito haciendo click fuera de la barra (en el fondo oscuro)
    const overlay = document.getElementById('cart-overlay');
    if (overlay) {
        overlay.removeAttribute('onclick');
        overlay.addEventListener('click', () => toggleCartSidebar(false));
    }

    renderNavProfileWidget();
}

function renderNavProfileWidget() {
    const widget = document.getElementById('nav-profile-widget');
    if (!widget) return;
    
    if (AppState.user) {
        // Muestra el avatar y desplegable si hay una sesión iniciada
        widget.innerHTML = `
            <div class="nav-user-logged-wrapper" style="display:flex; align-items:center; gap:10px; cursor:pointer; position:relative;" onclick="const menu = document.getElementById('nav-profile-dropdown'); if(menu) menu.classList.toggle('hidden')">
                <img src="${AppState.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=80'}" class="nav-avatar-img" style="width:34px; height:34px; border-radius:50%; object-fit:cover;" alt="Avatar">
                <div class="nav-user-text-info" style="display:flex; flex-direction:column; line-height:1.2;">
                    <span class="nav-username" style="font-size:0.85rem; font-weight:700;">${AppState.user.name.split(' ')[0]}</span>
                    <span class="nav-userrole" style="font-size:0.75rem; color:var(--text-secondary); font-weight:500;">${AppState.user.role}</span>
                </div>
                <i class="fa-solid fa-chevron-down nav-dropdown-arrow" style="font-size:0.7rem;"></i>
                <div id="nav-profile-dropdown" class="nav-profile-dropdown-menu hidden" style="position:absolute; top:40px; right:0; background:var(--bg-surface); border:1px solid var(--border-subtle); padding:10px; border-radius:8px; display:flex; flex-direction:column; gap:8px; z-index:1000; min-width:140px; box-shadow:var(--shadow-md);">
                    <a href="registro.html" style="text-decoration:none; color:var(--text-primary); font-size:0.85rem;"><i class="fa-solid fa-user"></i> Mi Perfil</a>
                    <hr style="border:0; border-top:1px solid var(--border-subtle); margin:4px 0;">
                    <button onclick="ejecutarCierreSesion()" style="background:transparent; border:none; text-align:left; color:#EF4444; cursor:pointer; font-size:0.85rem; padding:0;"><i class="fa-solid fa-arrow-right-from-bracket"></i> Salir</button>
                </div>
            </div>
        `;
    } else {
        // Muestra el botón de "Ingresar" si es un usuario anónimo
        if (window.location.pathname.endsWith('registro.html')) {
            widget.innerHTML = '';
        } else {
            widget.innerHTML = `
                <a href="registro.html" class="btn-primary-colmena" id="nav-login-btn" style="text-decoration:none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.85rem; border-radius: 8px;">
                    <i class="fa fa-user-circle"></i> <span>Ingresar</span>
                </a>
            `;
        }
    }

    // Cambia dinámicamente los botones de llamadas a la acción en las portadas/heros
    const heroAuthBtn = document.getElementById('hero-auth-btn');
    if (heroAuthBtn) {
        if (AppState.user) {
            heroAuthBtn.innerHTML = `Ver mi Perfil <i class="fa-solid fa-user" style="margin-left: 6px; font-size: 0.85rem;"></i>`;
            heroAuthBtn.href = "registro.html";
        } else {
            heroAuthBtn.textContent = "Crear Cuenta";
            heroAuthBtn.href = "registro.html";
        }
    }
}

function toggleCartSidebar(open) {
    // Desplaza la barra lateral del carrito hacia adentro o afuera de la pantalla
    const sidebar = document.getElementById('cart-sidebar');
    const overlay = document.getElementById('cart-overlay');
    if (sidebar) sidebar.classList.toggle('open', open);
    if (overlay) overlay.classList.toggle('open', open);
    if (open) renderCartSidebarItems();
}

function renderCartSidebarItems() {
    const container = document.getElementById('cart-items-container');
    const totalDisplay = document.getElementById('cart-total-display');
    if (!container || !totalDisplay) return;
    
    updateGlobalCartCounter();
    
    // Estado vacío amigable por si no hay nada seleccionado
    if (AppState.cart.length === 0) {
        container.innerHTML = `<div class="cart-empty-state" style="padding:40px 20px; text-align:center; color:var(--text-muted);"><i class="fa-solid fa-box-open" style="font-size:2rem; margin-bottom:10px;"></i><p>Tu colmena está vacía.</p></div>`;
        totalDisplay.textContent = "$0.00";
        return;
    }
    
    // Maqueta la lista de compras desglosada con botones de control para sumar/restar cantidades
    let totalPrecio = 0;
    container.innerHTML = AppState.cart.map(item => {
        const subtotal = item.price * item.cantidad;
        totalPrecio += subtotal;
        return `
            <div class="cart-item-row" style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--border-subtle); align-items:center;">
                <img src="${item.image}" style="width:50px; height:50px; object-fit:contain; background:#fff; padding:4px; border-radius:6px;" alt="${item.title}">
                <div class="cart-item-info" style="flex:1;">
                    <h4 style="font-size:0.85rem; font-weight:600; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${item.title}</h4>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
                        <span class="cart-item-price" style="font-size:0.8rem; font-weight:700; color:var(--text-secondary);">$${item.price.toFixed(2)}</span>
                        <span style="font-size:0.8rem; font-weight:800; color:var(--ucab-green-light);">Sub: $${subtotal.toFixed(2)}</span>
                    </div>
                    <div class="cart-item-qty-selector" style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                        <button onclick="alterarCantidadCarrito(${item.id}, -1)" style="width:24px; height:24px; border-radius:4px; border:1px solid var(--border-subtle); background:var(--bg-main); font-weight:bold; cursor:pointer;">-</button>
                        <span style="font-size:0.85rem; font-weight:600;">${item.cantidad}</span>
                        <button onclick="alterarCantidadCarrito(${item.id}, 1)" style="width:24px; height:24px; border-radius:4px; border:1px solid var(--border-subtle); background:var(--bg-main); font-weight:bold; cursor:pointer;">+</button>
                    </div>
                </div>
                <button class="cart-item-remove-btn" onclick="eliminarDelCarritoTotal(${item.id})" style="background:transparent; border:none; color:#EF4444; cursor:pointer; font-size:1rem; padding:6px;"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        `;
    }).join('');
    totalDisplay.textContent = `$${totalPrecio.toFixed(2)}`;
}

function abrirPasarelaPagoModal() {
    // Filtros previos antes de dejar pasar al usuario al formulario de pago simulado
    if (AppState.cart.length === 0) {
        alert("El carrito está vacío.");
        return;
    }
    if (!AppState.user) {
        alert("Inicia sesión para poder consolidar tu pedido.");
        localStorage.setItem('checkout_lock_redirect', 'true'); // Bandera para volver aquí tras loguearse
        window.location.href = 'registro.html';
        return;
    }
    if (AppState.user.role === 'Administrador') {
        alert("Los administradores no pueden realizar simulaciones de compra de productos.");
        return;
    }

    toggleCartSidebar(false);
    const totalCompra = AppState.cart.reduce((acc, i) => acc + (i.price * i.cantidad), 0);
    
    let modal = document.getElementById('checkout-modal-root');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'checkout-modal-root';
        document.body.appendChild(modal);
    }
    
    // Construye dinámicamente la ventana modal de la tarjeta de crédito
    modal.innerHTML = `
        <div class="checkout-modal-overlay">
            <div class="checkout-modal-card" style="background:var(--bg-surface); max-width:480px; width:100%; padding:25px; border-radius:16px; border:1px solid var(--border-subtle); position:relative;">
                ... formulario de pasarela ...
            </div>
        </div>
    `;
    
    // Intercepta el envío del pago para cerrar la modal y registrar la transacción
    document.getElementById('real-checkout-form-submit').addEventListener('submit', (e) => {
        e.preventDefault();
        document.getElementById('checkout-modal-root').innerHTML = '';
        procesarOrdenCompraCarrito();
    });
}

function agregarAlCarritoReal(productId) {
    // Bloqueo para evitar que administradores alteren el flujo de ventas simulado
    if (AppState.user && AppState.user.role === 'Administrador') {
        alert("Los administradores no pueden agregar productos al carrito ni realizar compras.");
        return;
    }
    
    const targetProduct = AppState.products.find(p => Number(p.id) === Number(productId));
    if (!targetProduct || targetProduct.stock <= 0) {
        alert("Lo sentimos, producto sin stock disponible.");
        return;
    }
    
    // Suma +1 si el producto ya existía, o inserta un nodo nuevo al array si es el primero
    const existingItem = AppState.cart.find(item => Number(item.id) === Number(productId));
    if (existingItem) {
        existingItem.cantidad += 1;
    } else {
        AppState.cart.push({
            id: targetProduct.id,
            title: targetProduct.title,
            price: targetProduct.price,
            image: targetProduct.image,
            cantidad: 1
        });
    }
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    updateGlobalCartCounter();
    renderCartSidebarItems();
    alert("¡Producto añadido al carrito!");
}

function alterarCantidadCarrito(id, delta) {
    const idx = AppState.cart.findIndex(i => Number(i.id) === Number(id));
    if (idx === -1) return;
    
    AppState.cart[idx].cantidad += delta;
    
    // Si la cantidad llega a cero, borramos el renglón. Si supera el inventario real, frena allí.
    if (AppState.cart[idx].cantidad <= 0) {
        AppState.cart.splice(idx, 1);
    } else {
        const prod = AppState.products.find(p => Number(p.id) === Number(id));
        if (prod && AppState.cart[idx].cantidad > prod.stock) {
            alert("Has alcanzado el límite disponible en stock físico.");
            AppState.cart[idx].cantidad = prod.stock;
        }
    }
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    renderCartSidebarItems();
}

function eliminarDelCarritoTotal(id) {
    // Remueve por completo un producto del carrito sin importar cuántas unidades tenía
    AppState.cart = AppState.cart.filter(i => Number(i.id) !== Number(id));
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    renderCartSidebarItems();
}

function renderApiFeaturedProducts() {
    const grid = document.getElementById('featured-products-grid');
    if (!grid) return;
    
    // Filtra las mejores 4 ofertas basándose en las estrellitas de calificación
    const destacados = [...AppState.products]
        .sort((a, b) => (b.rating?.rate || 0) - (a.rating?.rate || 0))
        .slice(0, 4);
        
    if (destacados.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-secondary);">Descargando productos de la API...</p>`;
        return;
    }
    
    // Renderiza las tarjetas de producto destacadas en la Home
    grid.innerHTML = destacados.map(p => `
        <article class="product-card">
            ... tarjeta de producto ...
        </article>
    `).join('');
}

function initNewsletterModule() {
    // Manejo básico de suscripción al boletín de noticias en el pie de página
    const form = document.getElementById('newsletter-form');
    const msg = document.getElementById('newsletter-message');
    if (!form || !msg) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        msg.textContent = "¡Te has suscrito con éxito!";
        msg.className = "newsletter-feedback success";
        msg.classList.remove('hidden');
        form.reset();
    });
}

function initCatalogoPage() {
    const grid = document.getElementById('main-catalog-grid');
    const searchInput = document.getElementById('catalog-search');
    const categorySelect = document.getElementById('filter-category');
    const priceSelect = document.getElementById('filter-price');
    if (!grid) return;
    
    // Genera automáticamente las opciones de categorías del selector leyendo los productos reales
    const categories = [...new Set(AppState.products.map(p => p.category))];
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="all">Todas las Categorías</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    
    // Motor interno de filtrado acumulativo (búsqueda + selector de categoría + rangos de precio)
    const filtrarYRenderizar = () => {
        let filtrados = [...AppState.products];
        const searchVal = searchInput?.value.toLowerCase().trim() || "";
        const catVal = categorySelect?.value || "all";
        const priceVal = priceSelect?.value || "all";
        
        if (searchVal) {
            filtrados = filtrados.filter(p => p.title.toLowerCase().includes(searchVal) || p.description.toLowerCase().includes(searchVal));
        }
        if (catVal !== "all") {
            filtrados = filtrados.filter(p => p.category === catVal);
        }
        if (priceVal !== "all") {
            if (priceVal === "low") filtrados = filtrados.filter(p => p.price <= 50);
            else if (priceVal === "mid") filtrados = filtrados.filter(p => p.price > 50 && p.price <= 150);
            else if (priceVal === "high") filtrados = filtrados.filter(p => p.price > 150);
        }
        
        if (filtrados.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-secondary);"><i class="fa-solid fa-magnifying-glass" style="font-size:2rem; margin-bottom:10px;"></i><p>No se encontraron productos con los filtros seleccionados.</p></div>`;
            return;
        }
        
        grid.innerHTML = filtrados.map(p => `
            <article class="product-card">
               ... maqueta catálogo ...
            </article>
        `).join('');
    };
    
    // Reactividad en vivo al escribir o seleccionar opciones
    searchInput?.addEventListener('input', filtrarYRenderizar);
    categorySelect?.addEventListener('change', filtrarYRenderizar);
    priceSelect?.addEventListener('change', filtrarYRenderizar);
    filtrarYRenderizar();
}

function initDetallePage() {
    const params = new URLSearchParams(window.location.search);
    const productId = parseInt(params.get('id'));
    const container = document.getElementById('detail-page-container');
    if (!container || !productId) return;
    
    const prod = AppState.products.find(p => Number(p.id) === Number(productId));
    if (!prod) {
        container.innerHTML = `<p style="text-align:center; padding:40px;">Artículo no localizado en el catálogo.</p>`;
        return;
    }
    
    // Carga los comentarios guardados de este producto específico
    const prodReviews = AppState.reviews[productId] || [];
    const reviewsHtml = prodReviews.map(r => `
        ... bloques de comentarios ...
    `).join('') || '<p style="color:var(--text-muted); font-size:0.9rem; font-style:italic;">No hay valoraciones en esta colmena todavía.</p>';
    
    // Construye la vista interna detallada del artículo junto al formulario para opinar
    container.innerHTML = `
        ... estructura html de la ficha del producto ...
    `;
    
    // Guarda opiniones nuevas vinculando el nombre del usuario activo
    document.getElementById('review-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!AppState.user) {
            alert("Debes iniciar sesión para publicar reseñas.");
            return;
        }
        const stars = parseInt(document.getElementById('review-stars').value);
        const comment = document.getElementById('review-comment').value.trim();
        if (!AppState.reviews[productId]) AppState.reviews[productId] = [];
        AppState.reviews[productId].push({ userName: AppState.user.name, stars, comment });
        localStorage.setItem('colmena_reviews', JSON.stringify(AppState.reviews));
        alert("¡Reseña añadida con éxito!");
        initDetallePage();
    });
}

function procesarOrdenCompraCarrito() {
    if (AppState.cart.length === 0) return;
    
    const totalCompra = AppState.cart.reduce((acc, i) => acc + (i.price * i.cantidad), 0);
    const nuevaVenta = {
        id: AppState.ventas.length + 1001,
        userName: AppState.user.name,
        userEmail: AppState.user.email,
        address: AppState.user.address || "Dirección del Campus UCAB",
        date: new Date().toLocaleDateString('es-VE', { hour: '2-digit', minute: '2-digit' }),
        items: [...AppState.cart],
        total: totalCompra,
        status: 'Pendiente'
    };
    
    // Descuenta las unidades adquiridas directamente del inventario maestro
    AppState.cart.forEach(item => {
        const prod = AppState.products.find(p => Number(p.id) === Number(item.id));
        if (prod) prod.stock = Math.max(0, prod.stock - item.cantidad);
    });
    localStorage.setItem('products', JSON.stringify(AppState.products));
    
    // Si no hay red, la guarda en una lista de espera diferida para enviarla después
    if (navigator.onLine) {
        AppState.ventas.push(nuevaVenta);
        localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
        alert(`¡Orden #${nuevaVenta.id} procesada con éxito! Revisa tu panel.`);
    } else {
        AppState.offlineQueue.push({ type: 'COMPRA', data: nuevaVenta });
        localStorage.setItem('colmena_offline_queue', JSON.stringify(AppState.offlineQueue));
        alert("Pedido guardado localmente en cola offline. Se procesará automáticamente al recuperar conexión.");
    }
    
    // Limpieza final de vaciado del carrito tras cerrar la orden
    AppState.cart = [];
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    updateGlobalCartCounter();
    window.location.href = 'index.html';
}

function procesarColaOffline() {
    // Recorre y vacía las compras acumuladas mientras el dispositivo no tenía internet
    AppState.offlineQueue.forEach(task => {
        if (task.type === 'COMPRA') AppState.ventas.push(task.data);
    });
    localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
    AppState.offlineQueue = [];
    localStorage.setItem('colmena_offline_queue', JSON.stringify(AppState.offlineQueue));
    alert("¡Sincronización automática completada! Pedidos retenidos offline procesados.");
}

function initAuthModule() {
    // Si es la primera vez que se abre el proyecto, inyectamos dos cuentas de prueba preestablecidas
    const usuariosPorDefecto = [
        { name: "Admin Principal", email: "admin@ucab.edu.ve", password: "123", role: "Administrador", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120", address: "Módulo 4 de Ingeniería UCAB" },
        { name: "Estudiante Regular", email: "estudiante@ucab.edu.ve", password: "123", role: "Usuario regular", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120", address: "Residencias de la Castellana" }
    ];
    if (!localStorage.getItem('colmena_users_db')) {
        localStorage.setItem('colmena_users_db', JSON.stringify(usuariosPorDefecto));
    }
    
    // Configura la pantalla de perfil si hay sesión activa, u oculta campos según el rol (Admin vs Regular)
    if (AppState.user) {
        document.getElementById('auth-forms-wrapper')?.classList.add('hidden');
        document.getElementById('profile-panel-wrapper')?.classList.remove('hidden');
        
        const tabsWrapper = document.querySelector('.auth-tabs');
        if (tabsWrapper) tabsWrapper.style.display = 'none';
        
        // Carga de datos del usuario en los inputs editables
        const avatarDisp = document.getElementById('profile-avatar-display');
        const nameDisp = document.getElementById('profile-name-display');
        const emailDisp = document.getElementById('profile-email-display');
        const roleDisp = document.getElementById('profile-role-badge');
        
        if (avatarDisp) avatarDisp.src = AppState.user.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150';
        if (nameDisp) nameDisp.textContent = AppState.user.name;
        if (emailDisp) emailDisp.textContent = AppState.user.email;
        if (roleDisp) roleDisp.textContent = AppState.user.role;
        
        const editName = document.getElementById('edit-name');
        const editAvatar = document.getElementById('edit-avatar');
        const editAddress = document.getElementById('edit-address');
        
        if (editName) editName.value = AppState.user.name;
        if (editAvatar) editAvatar.value = AppState.user.avatar || '';
        if (editAddress) editAddress.value = AppState.user.address || '';

        if (AppState.user.role === 'Administrador') {
            const historyCol = document.getElementById('profile-history-col');
            if (historyCol) historyCol.style.display = 'none';
            
            const addressGroup = document.getElementById('edit-address-group');
            if (addressGroup) {
                addressGroup.style.display = 'none';
                const addressInput = document.getElementById('edit-address');
                if (addressInput) addressInput.removeAttribute('required');
            }
            
            const gridContainer = document.getElementById('profile-grid-container');
            if (gridContainer) {
                gridContainer.style.gridTemplateColumns = '1fr';
                gridContainer.style.maxWidth = '550px';
                gridContainer.style.margin = '0 auto';
            }
        } else {
            renderHistorialComprasUsuario();
        }
    }
    
    // Gestión del formulario de Registro de cuentas nuevas
    document.getElementById('register-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const confirmPassword = document.getElementById('reg-password-confirm').value;
        const role = 'Usuario regular';
        const fb = document.getElementById('auth-global-feedback');
        
        if (password !== confirmPassword) {
            mostrarMensajeFeedback(fb, "Las contraseñas no coinciden.", "error");
            return;
        }
        
        let db = JSON.parse(localStorage.getItem('colmena_users_db'));
        if (db.some(u => u.email === email)) {
            mostrarMensajeFeedback(fb, "Este correo ya se encuentra registrado.", "error");
            return;
        }
        
        const nuevoU = { name, email, password, role, avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', address: '' };
        db.push(nuevoU);
        localStorage.setItem('colmena_users_db', JSON.stringify(db));
        mostrarMensajeFeedback(fb, "¡Registro completado! Ya puedes iniciar sesión.", "success");
        setTimeout(() => switchAuthTab('login'), 1500);
    });
    
    // Gestión del formulario de Inicio de Sesión
    document.getElementById('login-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const fb = document.getElementById('auth-global-feedback');
        
        let db = JSON.parse(localStorage.getItem('colmena_users_db'));
        const encontrado = db.find(u => u.email === email && u.password === password);
        if (!encontrado) {
            mostrarMensajeFeedback(fb, "Credenciales inválidas.", "error");
            return;
        }
        
        sessionStorage.setItem('activeUser', JSON.stringify(encontrado));
        AppState.user = encontrado;
        
        // Redirección inteligente según rol o intenciones previas de compra
        if (encontrado.role === 'Administrador') {
            window.location.href = 'admin.html';
        } else {
            if (localStorage.getItem('checkout_lock_redirect') === 'true') {
                localStorage.removeItem('checkout_lock_redirect');
                window.location.href = 'index.html?triggerCheckout=true';
            } else {
                window.location.href = 'index.html';
            }
        }
    });

    // Envío del formulario de guardado del perfil personal editado
    document.getElementById('profile-edit-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        let db = JSON.parse(localStorage.getItem('colmena_users_db'));
        const userIndex = db.findIndex(u => u.email === AppState.user.email);
        if (userIndex > -1) {
            const oldName = AppState.user.name;
            const newName = document.getElementById('edit-name').value.trim();
            
            db[userIndex].name = newName;
            db[userIndex].avatar = document.getElementById('edit-avatar').value.trim();
            db[userIndex].address = document.getElementById('edit-address').value.trim();
            
            // Corrige los registros históricos de compras viejas para no perder el rastro del cliente
            AppState.ventas.forEach(v => {
                if (v.userEmail === AppState.user.email || v.userName === oldName) {
                    v.userName = newName;
                    v.userEmail = AppState.user.email;
                }
            });
            localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
            localStorage.setItem('colmena_users_db', JSON.stringify(db));
            sessionStorage.setItem('activeUser', JSON.stringify(db[userIndex]));
            AppState.user = db[userIndex];
            alert("Información de perfil actualizada con éxito.");
            window.location.reload();
        }
    });

    // Formulario de recuperación de contraseña: busca si existe la cuenta
    document.getElementById('forgot-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('forgot-email').value.trim();
        const fb = document.getElementById('auth-global-feedback');
        let db = JSON.parse(localStorage.getItem('colmena_users_db')) || [];
        const encontrado = db.find(u => u.email === email);
        if (!encontrado) {
            mostrarMensajeFeedback(fb, "Este correo electrónico no está registrado en la Colmena.", "error");
            return;
        }
        
        const resetEmailHidden = document.getElementById('reset-email-hidden');
        const resetEmailDisplay = document.getElementById('reset-email-display');
        if (resetEmailHidden) resetEmailHidden.value = email;
        if (resetEmailDisplay) resetEmailDisplay.textContent = email;
        
        mostrarMensajeFeedback(fb, "Cuenta localizada. Establece tu nueva contraseña.", "success");
        document.getElementById('forgot-email').value = '';
        
        setTimeout(() => {
            fb.classList.add('hidden');
            switchAuthTab('reset');
        }, 1200);
    });

    // Reescritura física de la credencial tras validar la recuperación
    document.getElementById('reset-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('reset-email-hidden').value;
        const newPassword = document.getElementById('reset-password').value;
        const confirmPassword = document.getElementById('reset-password-confirm').value;
        const fb = document.getElementById('auth-global-feedback');
        
        if (newPassword !== confirmPassword) {
            mostrarMensajeFeedback(fb, "Las contraseñas no coinciden.", "error");
            return;
        }
        
        let db = JSON.parse(localStorage.getItem('colmena_users_db')) || [];
        const idx = db.findIndex(u => u.email === email);
        if (idx > -1) {
            db[idx].password = newPassword;
            localStorage.setItem('colmena_users_db', JSON.stringify(db));
            
            if (AppState.user && AppState.user.email === email) {
                AppState.user.password = newPassword;
                sessionStorage.setItem('activeUser', JSON.stringify(AppState.user));
            }
            
            mostrarMensajeFeedback(fb, "Contraseña reestablecida con éxito. Redirigiendo...", "success");
            setTimeout(() => {
                fb.classList.add('hidden');
                switchAuthTab('login');
            }, 1500);
        } else {
            mostrarMensajeFeedback(fb, "No se pudo actualizar la contraseña.", "error");
        }
    });
}

function renderHistorialComprasUsuario() {
    // Renderiza la lista compacta de pedidos anteriores en el panel del cliente regular
    const container = document.getElementById('user-orders-history-container');
    if (!container) return;

    const misCompras = AppState.ventas.filter(v => v.userEmail === AppState.user.email || v.userName === AppState.user.name);

    if (misCompras.length === 0) {
        container.innerHTML = `... estado vacío del historial ...`;
        return;
    }

    container.innerHTML = misCompras.map(compra => {
        let statusClass = 'pending';
        let statusIcon = '⏳';
        if (compra.status === 'Enviado') { statusClass = 'shipping'; statusIcon = '🚚'; }
        if (compra.status === 'Entregado') { statusClass = 'delivered'; statusIcon = '✅'; }

        return `
            <div class="user-order-card" style="background:var(--bg-main); border:1px solid var(--border-subtle); padding:16px; border-radius:12px; margin-bottom:12px;">
               ... item de compra ...
            </div>
        `;
    }).join('');
}

function switchAuthTab(target) {
    // Gestor estético de visibilidad entre pestañas (Login, Registro, Recuperar, Resetear)
    const login = document.getElementById('login-form');
    const register = document.getElementById('register-form');
    const forgot = document.getElementById('forgot-form');
    const reset = document.getElementById('reset-form');
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    
    login?.classList.add('hidden');
    register?.classList.add('hidden');
    forgot?.classList.add('hidden');
    reset?.classList.add('hidden');
    tabLogin?.classList.remove('active');
    tabReg?.classList.remove('active');
    
    if (target === 'login') {
        login?.classList.remove('hidden');
        tabLogin?.classList.add('active');
    } else if (target === 'register') {
        register?.classList.remove('hidden');
        tabReg?.classList.add('active');
    } else if (target === 'forgot') {
        forgot?.classList.remove('hidden');
    } else if (target === 'reset') {
        reset?.classList.remove('hidden');
    }
}

function mostrarMensajeFeedback(el, text, type) {
    // Alertas rápidas de color verde o rojo para la interfaz del usuario
    if (!el) return;
    el.textContent = text;
    el.className = `newsletter-feedback ${type}`;
    el.classList.remove('hidden');
}

function ejecutarCierreSesion() {
    // Limpia la cookie de sesión de usuario y te devuelve a la raíz comercial de la tienda
    sessionStorage.removeItem('activeUser');
    AppState.user = null;
    window.location.href = 'index.html';
}

function initAdminPage() {
    // Renderiza el panel administrativo e inicializa sus controladores
    renderMetricasAdmin();
    renderInventarioTablaAdmin();
    renderListaOrdenesAdmin();
    
    // Vincula la vista previa dinámica de creación de productos en tiempo real
    const previewInputs = ['prod-title', 'prod-price', 'prod-category', 'prod-image', 'prod-stock'];
    previewInputs.forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateProductPreview);
    });
    updateProductPreview();
    
    document.getElementById('btn-crud-cancel')?.addEventListener('click', resetFormCrud);
    
    // Procesa la creación de un nuevo producto o sobreescribe uno editado
    document.getElementById('crud-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('prod-id').value;
        const title = document.getElementById('prod-title').value.trim();
        const price = parseFloat(document.getElementById('prod-price').value);
        const category = document.getElementById('prod-category').value.trim();
        const description = document.getElementById('prod-description').value.trim();
        let image = document.getElementById('prod-image').value.trim();
        const stock = parseInt(document.getElementById('prod-stock').value);
        
        if (!image) image = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
        
        if (id) {
            const idx = AppState.products.findIndex(p => Number(p.id) === Number(id));
            if (idx > -1) {
                AppState.products[idx] = { ...AppState.products[idx], title, price, category, description, image, stock };
            }
        } else {
            const maxId = AppState.products.reduce((max, p) => p.id > max ? p.id : max, 0);
            const nuevoP = {
                id: Number(maxId) + 1,
                title, price, category, description, image, stock,
                rating: { rate: 5.0, count: 1 }
            };
            AppState.products.push(nuevoP);
        }
        
        localStorage.setItem('products', JSON.stringify(AppState.products));
        alert("Catálogo actualizado con éxito.");
        window.location.reload();
    });
}

function renderMetricasAdmin() {
    // Calcula los resúmenes financieros y contadores generales para las KPI superiores
    const totalVentas = AppState.ventas.length;
    const totalIngresos = AppState.ventas.reduce((acc, v) => acc + v.total, 0);
    const totalProds = AppState.products.length;
    
    const mVentas = document.getElementById('metric-total-ventas');
    const mIngresos = document.getElementById('metric-total-ingresos');
    const mProductos = document.getElementById('metric-total-productos');
    
    if (mVentas) mVentas.textContent = totalVentas;
    if (mIngresos) mIngresos.textContent = `$${totalIngresos.toFixed(2)}`;
    if (mProductos) mProductos.textContent = totalProds;

    // Calcula el porcentaje acumulado de usuarios activos contra la base total de registrados
    const dbUsers = JSON.parse(localStorage.getItem('colmena_users_db')) || [];
    const registeredCount = dbUsers.length;
    
    const activeUsersSet = new Set();
    if (AppState.user) activeUsersSet.add(AppState.user.name);
    AppState.ventas.forEach(v => activeUsersSet.add(v.userName));
    
    let activeCount = activeUsersSet.size;
    if (activeCount === 0 && registeredCount > 0) activeCount = 1;
    if (activeCount > registeredCount) activeCount = registeredCount;

    const mUserReg = document.getElementById('metric-user-registered');
    const mUserAct = document.getElementById('metric-user-active');
    const mUserBar = document.getElementById('metric-user-ratio-bar');
    
    if (mUserReg) mUserReg.textContent = registeredCount;
    if (mUserAct) mUserAct.textContent = activeCount;
    if (mUserBar && registeredCount > 0) {
        const pct = Math.min(100, Math.round((activeCount / registeredCount) * 100));
        mUserBar.style.width = `${pct}%`;
    }

    // Encuentra los 3 productos con mayor número de volumen vendido y dibuja su barra comparativa
    const productSalesMap = {};
    AppState.ventas.forEach(v => {
        if (v.items && Array.isArray(v.items)) {
            v.items.forEach(item => {
                const id = item.id;
                const title = item.title;
                const qty = item.cantidad || 0;
                if (!productSalesMap[id]) {
                    productSalesMap[id] = { id, title, qty: 0 };
                }
                productSalesMap[id].qty += qty;
            });
        }
    });

    const sortedSales = Object.values(productSalesMap).sort((a, b) => b.qty - a.qty);
    const top3 = sortedSales.slice(0, 3);
    const topContainer = document.getElementById('metric-top-products-container');
    
    if (topContainer) {
        if (top3.length === 0) {
            topContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--text-secondary);">No se registran ventas en el sistema aún.</p>`;
        } else {
            const maxQty = top3[0].qty || 1;
            topContainer.innerHTML = top3.map((p, index) => {
                const pct = Math.round((p.qty / maxQty) * 100);
                return `
                    ... render barra top ventas ...
                `;
            }).join('');
        }
    }
}

function renderInventarioTablaAdmin() {
    // Maqueta las filas de la tabla de inventario del Panel de Control del Admin
    const tbody = document.getElementById('crud-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = AppState.products.map(p => `
        <tr>
            ... celdas con fotos, precios y botones de acción rápida ...
        </tr>
    `).join('');
}

function cargarProductoParaEditar(id) {
    // Toma un elemento existente del inventario y precarga sus datos en los campos del editor superior
    const p = AppState.products.find(prod => Number(prod.id) === Number(id));
    if (!p) return;
    
    const pId = document.getElementById('prod-id');
    const pTitle = document.getElementById('prod-title');
    const pPrice = document.getElementById('prod-price');
    const pCategory = document.getElementById('prod-category');
    const pDescription = document.getElementById('prod-description');
    const pImage = document.getElementById('prod-image');
    const pStock = document.getElementById('prod-stock');
    const btnSubmit = document.getElementById('btn-crud-submit');
    const cTitle = document.getElementById('crud-title');
    
    if (pId) pId.value = p.id;
    if (pTitle) pTitle.value = p.title;
    if (pPrice) pPrice.value = p.price;
    if (pCategory) pCategory.value = p.category;
    if (pDescription) pDescription.value = p.description;
    if (pImage) pImage.value = p.image.startsWith('http') ? p.image : '';
    if (pStock) pStock.value = p.stock;
    
    if (btnSubmit) btnSubmit.textContent = "Actualizar Cambios del Producto";
    if (cTitle) cTitle.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Editando: ${p.title}`;
    
    const btnCancel = document.getElementById('btn-crud-cancel');
    if (btnCancel) btnCancel.classList.remove('hidden');
    
    updateProductPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' }); // Sube la pantalla con suavidad para ver el editor
}

function eliminarProductoAdmin(id) {
    // Alerta de confirmación previa antes de borrar permanentemente un artículo de la base local
    if (!confirm("¿Seguro que deseas eliminar este artículo del catálogo global?")) return;
    AppState.products = AppState.products.filter(p => Number(p.id) !== Number(id));
    localStorage.setItem('products', JSON.stringify(AppState.products));
    window.location.reload();
}

function renderListaOrdenesAdmin() {
    // Imprime todos los pedidos de la plataforma para permitir a los administradores gestionar despachos
    const container = document.getElementById('admin-orders-container');
    if (!container) return;
    
    if (AppState.ventas.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:var(--text-muted);">No se registran transacciones en el marketplace todavía.</p>`;
        return;
    }
    
    container.innerHTML = AppState.ventas.map(v => `
        <div style="background:var(--bg-main); padding:18px; border-radius:12px; border:1px solid var(--border-subtle); margin-bottom:15px;">
           ... fila de pedidos globales ...
        </div>
    `).join('');
}

function cambiarEstadoEnvio(ordenId, nuevoEstado) {
    // Actualiza si un pedido está Pendiente, Enviado o Entregado desde los menús desplegables del Admin
    const idx = AppState.ventas.findIndex(v => Number(v.id) === Number(ordenId));
    if (idx > -1) {
        AppState.ventas[idx].status = nuevoEstado;
        localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
        alert(`Estado de la orden #${ordenId} modificado a: ${nuevoEstado}`);
    }
}

function updateProductPreview() {
    // Genera la tarjeta visual simulada a un costado del formulario del Administrador mientras escribe
    const titleVal = document.getElementById('prod-title')?.value.trim() || "Título del Producto";
    const priceVal = parseFloat(document.getElementById('prod-price')?.value) || 0;
    const catVal = document.getElementById('prod-category')?.value.trim() || "Categoría";
    let imgVal = document.getElementById('prod-image')?.value.trim();
    const stockVal = parseInt(document.getElementById('prod-stock')?.value) || 0;

    if (!imgVal) {
        imgVal = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
    }

    const previewWrapper = document.getElementById('crud-preview-card-wrapper');
    if (!previewWrapper) return;

    previewWrapper.innerHTML = `
        ... maqueta interna de tarjeta espejo ...
    `;
}

function resetFormCrud() {
    // Limpia los inputs del editor y devuelve el formulario a su estado original de "Crear Producto"
    const form = document.getElementById('crud-form');
    if (form) form.reset();
    
    const pId = document.getElementById('prod-id');
    if (pId) pId.value = '';
    
    const btnSubmit = document.getElementById('btn-crud-submit');
    if (btnSubmit) btnSubmit.textContent = "Crear Producto";
    
    const btnCancel = document.getElementById('btn-crud-cancel');
    if (btnCancel) btnCancel.classList.add('hidden');
    
    const cTitle = document.getElementById('crud-title');
    if (cTitle) cTitle.innerHTML = `<i class="fa-solid fa-boxes-packing" style="color: var(--ucab-green-light);"></i> Gestión de Producto`;
    
    updateProductPreview();
}