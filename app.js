const AppState = {
    theme: localStorage.getItem('theme') || 'light',
    user: JSON.parse(sessionStorage.getItem('activeUser')) || null,
    products: JSON.parse(localStorage.getItem('products')) || [],
    cart: JSON.parse(localStorage.getItem('colmena_cart')) || [],
    ventas: JSON.parse(localStorage.getItem('colmena_ventas')) || [],
    reviews: JSON.parse(localStorage.getItem('colmena_reviews')) || {},
    offlineQueue: JSON.parse(localStorage.getItem('colmena_offline_queue')) || []
};

document.addEventListener('DOMContentLoaded', async () => {
    applyThemeEngine(AppState.theme);
    syncNetworkBadge();
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('Service Worker registrado con éxito:', reg.scope))
            .catch(err => console.error('Error al registrar Service Worker:', err));
    }
    
    try {
        await guaranteeCacheData();
    } catch (e) {
        console.warn("No se pudo sincronizar la API externa, usando datos locales offline.", e);
    }
    
    initRouting();
    attachGlobalEvents();
    updateGlobalCartCounter();
    renderNavProfileWidget();
});

function initRouting() {
    const path = window.location.pathname;
    
    // Si es Administrador y está intentando acceder a una página de la tienda, redirigir
    const isStorePage = path.endsWith('index.html') || path.endsWith('catalogo.html') || path.endsWith('detalle.html') || path === '/' || path.endsWith('/');
    if (isStorePage && AppState.user && AppState.user.role === 'Administrador') {
        window.location.href = 'admin.html';
        return;
    }
    
    if (path.endsWith('admin.html')) {
        if (!AppState.user || AppState.user.role !== 'Administrador') {
            alert("Acceso denegado: Se requieren privilegios administrativos.");
            window.location.href = 'index.html';
            return;
        }
    }

    // Cambiar la dirección del logo de "La Colmena" a admin.html para administradores
    if (AppState.user && AppState.user.role === 'Administrador') {
        document.querySelectorAll('.logo, a.logo').forEach(el => {
            el.href = 'admin.html';
        });
    }

    if (path.endsWith('index.html') || path === '/' || path.endsWith('/')) {
        renderApiFeaturedProducts();
        initNewsletterModule();
        
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
    if (AppState.products.length > 0) return;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch('https://fakestoreapi.com/products', { signal: controller.signal });
        clearTimeout(timeoutId);
        
        const apiData = await res.json();
        AppState.products = apiData.map(item => ({
            id: Number(item.id),
            title: item.title,
            price: item.price,
            category: item.category,
            description: item.description,
            image: item.image,
            stock: Math.floor(Math.random() * 12) + 4,
            rating: item.rating || { rate: 4.2, count: 8 }
        }));
        localStorage.setItem('products', JSON.stringify(AppState.products));
    } catch (error) {
        console.error("Cargando desde almacenamiento offline local por falla de red.", error);
        if (AppState.products.length === 0) {
            AppState.products = [
                { id: 1, title: "Producto de Contingencia Local", price: 25.0, category: "electronica", description: "Cargado en modo offline seguro.", image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400", stock: 5, rating: { rate: 5.0, count: 1 } }
            ];
            localStorage.setItem('products', JSON.stringify(AppState.products));
        }
    }
}

function updateGlobalCartCounter() {
    const counters = document.querySelectorAll('#cart-global-count');
    const totalItems = AppState.cart.reduce((acc, item) => acc + item.cantidad, 0);
    counters.forEach(counter => {
        if (counter) counter.textContent = totalItems;
    });
}

function applyThemeEngine(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) icon.className = theme === 'light' ? 'fa-regular fa-moon' : 'fa-solid fa-sun';
}

function syncNetworkBadge() {
    const badge = document.getElementById('network-status');
    const text = document.getElementById('network-text');
    const icon = document.getElementById('network-icon');
    
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
    document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
        AppState.theme = AppState.theme === 'light' ? 'dark' : 'light';
        applyThemeEngine(AppState.theme);
    });

    document.querySelectorAll('[onclick="toggleCartSidebar(true)"]').forEach(btn => {
        btn.removeAttribute('onclick'); 
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleCartSidebar(true);
        });
    });

    const closeBtn = document.querySelector('.cart-close-btn');
    if (closeBtn) {
        closeBtn.removeAttribute('onclick');
        closeBtn.addEventListener('click', () => toggleCartSidebar(false));
    }

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
    if (AppState.cart.length === 0) {
        container.innerHTML = `<div class="cart-empty-state" style="padding:40px 20px; text-align:center; color:var(--text-muted);"><i class="fa-solid fa-box-open" style="font-size:2rem; margin-bottom:10px;"></i><p>Tu colmena está vacía.</p></div>`;
        totalDisplay.textContent = "$0.00";
        return;
    }
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
    if (AppState.cart.length === 0) {
        alert("El carrito está vacío.");
        return;
    }
    if (!AppState.user) {
        alert("Inicia sesión para poder consolidar tu pedido.");
        localStorage.setItem('checkout_lock_redirect', 'true');
        window.location.href = 'registro.html';
        return;
    }
    if (AppState.user.role === 'Administrador') {
        alert("Los administradores no pueden realizar simulaciones de compra de productos.");
        return;
    }

    // INTERFAZ DE LA PASARELA DE PAGO DINÁMICA
    toggleCartSidebar(false);
    const totalCompra = AppState.cart.reduce((acc, i) => acc + (i.price * i.cantidad), 0);
    
    let modal = document.getElementById('checkout-modal-root');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'checkout-modal-root';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="checkout-modal-overlay">
            <div class="checkout-modal-card" style="background:var(--bg-surface); max-width:480px; width:100%; padding:25px; border-radius:16px; border:1px solid var(--border-subtle); position:relative;">
                <h3 style="margin-bottom:15px; font-size:1.3rem;"><i class="fa-solid fa-credit-card"></i> Pasarela de Pago Seguro</h3>
                <p style="font-size:0.9rem; color:var(--text-secondary); margin-bottom:15px;">Estás procesando una orden para la dirección: <br><strong>${AppState.user.address || 'Campus UCAB Montalbán'}</strong></p>
                
                <div style="background:var(--bg-main); padding:12px; border-radius:8px; margin-bottom:20px; font-weight:700; display:flex; justify-content:between;">
                    <span>Total Neto a Pagar:</span>
                    <span style="color:var(--ucab-green-light);">$${totalCompra.toFixed(2)}</span>
                </div>

                <form id="real-checkout-form-submit">
                    <div class="input-group-colmena" style="margin-bottom:12px;">
                        <label>Nombre del Tarjetahabiente</label>
                        <input type="text" required value="${AppState.user.name}" style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-surface); color:var(--text-primary);">
                    </div>
                    <div class="input-group-colmena" style="margin-bottom:12px;">
                        <label>Número de Tarjeta (Simulado)</label>
                        <input type="text" maxlength="16" placeholder="4111 2222 3333 4444" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-surface); color:var(--text-primary);">
                    </div>
                    <div style="display:flex; gap:12px; margin-bottom:20px;">
                        <div class="input-group-colmena" style="flex:1;">
                            <label>Vencimiento</label>
                            <input type="text" placeholder="12/29" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-surface); color:var(--text-primary);">
                        </div>
                        <div class="input-group-colmena" style="flex:1;">
                            <label>CVC / CVV</label>
                            <input type="password" maxlength="3" placeholder="***" required style="width:100%; padding:10px; border-radius:8px; border:1px solid var(--border-subtle); background:var(--bg-surface); color:var(--text-primary);">
                        </div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button type="button" onclick="document.getElementById('checkout-modal-root').innerHTML=''" class="btn-logout-colmena" style="flex:1; background:transparent; border:1px solid var(--text-muted); color:var(--text-secondary); padding:12px; border-radius:8px; cursor:pointer; font-weight:600;">Cancelar</button>
                        <button type="submit" class="btn-primary-colmena" style="flex:1; justify-content:center; padding:12px;">Confirmar Pago</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.getElementById('real-checkout-form-submit').addEventListener('submit', (e) => {
        e.preventDefault();
        document.getElementById('checkout-modal-root').innerHTML = '';
        procesarOrdenCompraCarrito();
    });
}

function agregarAlCarritoReal(productId) {
    if (AppState.user && AppState.user.role === 'Administrador') {
        alert("Los administradores no pueden agregar productos al carrito ni realizar compras.");
        return;
    }
    const targetProduct = AppState.products.find(p => Number(p.id) === Number(productId));
    if (!targetProduct || targetProduct.stock <= 0) {
        alert("Lo sentimos, producto sin stock disponible.");
        return;
    }
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
    AppState.cart = AppState.cart.filter(i => Number(i.id) !== Number(id));
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    renderCartSidebarItems();
}

function renderApiFeaturedProducts() {
    const grid = document.getElementById('featured-products-grid');
    if (!grid) return;
    // Ordenar los productos por calificación (rating.rate) de forma descendente y tomar los primeros 4
    const destacados = [...AppState.products]
        .sort((a, b) => (b.rating?.rate || 0) - (a.rating?.rate || 0))
        .slice(0, 4);
    if (destacados.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-secondary);">Descargando productos de la API...</p>`;
        return;
    }
    grid.innerHTML = destacados.map(p => `
        <article class="product-card">
            <div class="product-image-wrapper">
                <img src="${p.image}" alt="${p.title}" loading="lazy">
            </div>
            <div class="product-info-payload">
                <span class="product-tag-category">${p.category}</span>
                <h3>${p.title}</h3>
                <div class="rating-row-stars">
                    <span class="star-rating-numeric">★ ${p.rating.rate.toFixed(1)}</span>
                    <span class="stock-badge ${p.stock > 0 ? 'in-stock' : 'no-stock'}">${p.stock > 0 ? `Stock: ${p.stock}` : 'Agotado'}</span>
                </div>
                <div class="product-footer-action">
                    <div class="product-price-value">$${p.price.toFixed(2)}</div>
                    <a href="detalle.html?id=${p.id}" class="view-more-link-btn"><i class="fa-solid fa-circle-info"></i> Detalles</a>
                </div>
            </div>
        </article>
    `).join('');
}

function initNewsletterModule() {
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
    
    const categories = [...new Set(AppState.products.map(p => p.category))];
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="all">Todas las Categorías</option>' + categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    
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
                <div class="product-image-wrapper">
                    <img src="${p.image}" alt="${p.title}">
                </div>
                <div class="product-info-payload">
                    <span class="product-tag-category">${p.category}</span>
                    <h3>${p.title}</h3>
                    <div class="rating-row-stars">
                        <span class="star-rating-numeric">★ ${p.rating.rate.toFixed(1)}</span>
                        <span class="stock-badge ${p.stock > 0 ? 'in-stock' : 'no-stock'}">${p.stock > 0 ? `Stock: ${p.stock}` : 'Sin Stock'}</span>
                    </div>
                    <div class="product-footer-action">
                        <div class="product-price-value">$${p.price.toFixed(2)}</div>
                        <a href="detalle.html?id=${p.id}" class="view-more-link-btn"><i class="fa fa-eye"></i> Ver</a>
                    </div>
                </div>
            </article>
        `).join('');
    };
    
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
    
    const prodReviews = AppState.reviews[productId] || [];
    const reviewsHtml = prodReviews.map(r => `
        <div class="review-card" style="background:var(--bg-main); padding:16px; border-radius:12px; border:1px solid var(--border-subtle); margin-bottom:12px; box-shadow:var(--shadow-sm); display:flex; gap:12px; align-items:start; transition: var(--transition);">
            <div style="width:36px; height:36px; border-radius:50%; background:var(--bg-surface); color:var(--ucab-green-light); font-weight:700; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-subtle); flex-shrink:0;">
                ${r.userName.charAt(0).toUpperCase()}
            </div>
            <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; flex-wrap:wrap; gap:4px;">
                    <strong style="font-size:0.9rem; color:var(--text-primary);">${r.userName}</strong>
                    <span style="color:var(--ucab-gold); font-size:0.8rem; letter-spacing:1px;">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span>
                </div>
                <p style="font-size:0.88rem; color:var(--text-secondary); line-height:1.4; margin:0;">${r.comment}</p>
            </div>
        </div>
    `).join('') || '<p style="color:var(--text-muted); font-size:0.9rem; font-style:italic;">No hay valoraciones en esta colmena todavía.</p>';
    
    container.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:40px; align-items:start; padding:20px 0;">
            <div style="background:var(--bg-surface); padding:24px; border-radius:var(--radius-lg); border:1px solid var(--border-subtle); text-align:center; box-shadow:var(--shadow-md); display:flex; justify-content:center; align-items:center; min-height:400px;">
                <div style="background:#FFFFFF; padding:20px; border-radius:var(--radius-md); width:100%; height:100%; display:flex; align-items:center; justify-content:center; min-height:350px;">
                    <img src="${prod.image}" style="max-height:310px; max-width:100%; object-fit:contain;" alt="${prod.title}">
                </div>
            </div>
            <div>
                <span class="product-tag-category" style="font-size:0.8rem;">${prod.category.toUpperCase()}</span>
                <h2 style="font-size:1.8rem; font-weight:800; line-height:1.2; margin:8px 0 15px 0;">${prod.title}</h2>
                <div style="font-size:1.75rem; font-weight:800; color:var(--text-primary); margin-bottom:15px;">$${prod.price.toFixed(2)}</div>
                <p style="color:var(--text-secondary); line-height:1.6; margin-bottom:25px;">${prod.description}</p>
                <div style="margin-bottom:25px;">
                    <span class="stock-badge ${prod.stock > 0 ? 'in-stock' : 'no-stock'}" style="padding:6px 12px; font-size:0.85rem;">${prod.stock > 0 ? `Unidades Disponibles: ${prod.stock}` : 'Temporalmente Agotado'}</span>
                </div>
                <button onclick="agregarAlCarritoReal(${prod.id})" class="btn-primary-colmena" style="padding:14px 28px; width:100%; max-width:280px; justify-content:center; font-size:1rem;" ${(prod.stock <= 0 || (AppState.user && AppState.user.role === 'Administrador')) ? 'disabled' : ''}>
                    <i class="fa fa-shopping-basket"></i> ${AppState.user && AppState.user.role === 'Administrador' ? 'Vista Administrador (Sin compras)' : 'Agregar al Carrito'}
                </button>
                
                <div style="margin-top:40px; border-top:1px solid var(--border-subtle); padding-top:25px;">
                    <h3 style="font-size:1.2rem; margin-bottom:15px; font-weight:700;"><i class="fa-regular fa-comments"></i> Valoraciones de la Comunidad</h3>
                    <div style="margin-bottom:20px;">${reviewsHtml}</div>
                    <form id="review-form" style="background:var(--bg-surface); padding:20px; border-radius:16px; border:1px solid var(--border-subtle); box-shadow:var(--shadow-sm); margin-top:20px;">
                        <h4 style="font-size:1.05rem; margin-bottom:15px; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:8px;"><i class="fa-solid fa-pen-nib" style="color:var(--ucab-green-light)"></i> Añadir tu Opinión</h4>
                        <div class="input-group-colmena" style="margin-bottom:15px;">
                            <label style="font-size:0.75rem; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:6px;">Calificación</label>
                            <select id="review-stars" class="select-colmena" style="padding:10px; border-radius:8px; background:var(--bg-main); color:var(--text-primary); border:1px solid var(--border-subtle); outline:none; font-weight:600;">
                                <option value="5">★★★★★ (5 - Excelente)</option>
                                <option value="4">★★★★☆ (4 - Bueno)</option>
                                <option value="3">★★★☆☆ (3 - Regular)</option>
                                <option value="2">★★☆☆☆ (2 - Malo)</option>
                                <option value="1">★☆☆☆☆ (1 - Muy Malo)</option>
                            </select>
                        </div>
                        <div class="input-group-colmena" style="margin-bottom:20px;">
                            <label style="font-size:0.75rem; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; margin-bottom:6px;">Comentario</label>
                            <textarea id="review-comment" rows="3" required placeholder="Comparte tu experiencia con este producto..." style="padding:12px; border-radius:8px; background:var(--bg-main); color:var(--text-primary); border:1px solid var(--border-subtle); outline:none; resize:none; font-family:var(--font-family); font-size:0.9rem;"></textarea>
                        </div>
                        <button type="submit" class="btn-primary-colmena w-100" style="padding:12px; justify-content:center; font-size:0.9rem; font-weight:700;">Publicar Comentario</button>
                    </form>
                </div>
            </div>
        </div>
    `;
    
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
    
    AppState.cart.forEach(item => {
        const prod = AppState.products.find(p => Number(p.id) === Number(item.id));
        if (prod) prod.stock = Math.max(0, prod.stock - item.cantidad);
    });
    localStorage.setItem('products', JSON.stringify(AppState.products));
    
    if (navigator.onLine) {
        AppState.ventas.push(nuevaVenta);
        localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
        alert(`¡Orden #${nuevaVenta.id} procesada con éxito! Revisa tu panel.`);
    } else {
        AppState.offlineQueue.push({ type: 'COMPRA', data: nuevaVenta });
        localStorage.setItem('colmena_offline_queue', JSON.stringify(AppState.offlineQueue));
        alert("Pedido guardado localmente en cola offline. Se procesará automáticamente al recuperar conexión.");
    }
    
    AppState.cart = [];
    localStorage.setItem('colmena_cart', JSON.stringify(AppState.cart));
    updateGlobalCartCounter();
    window.location.href = 'index.html';
}

function procesarColaOffline() {
    AppState.offlineQueue.forEach(task => {
        if (task.type === 'COMPRA') AppState.ventas.push(task.data);
    });
    localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
    AppState.offlineQueue = [];
    localStorage.setItem('colmena_offline_queue', JSON.stringify(AppState.offlineQueue));
    alert("¡Sincronización automática completada! Pedidos retenidos offline procesados.");
}

function initAuthModule() {
    const usuariosPorDefecto = [
        { name: "Admin Principal", email: "admin@ucab.edu.ve", password: "123", role: "Administrador", avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120", address: "Módulo 4 de Ingeniería UCAB" },
        { name: "Estudiante Regular", email: "estudiante@ucab.edu.ve", password: "123", role: "Usuario regular", avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120", address: "Residencias de la Castellana" }
    ];
    if (!localStorage.getItem('colmena_users_db')) {
        localStorage.setItem('colmena_users_db', JSON.stringify(usuariosPorDefecto));
    }
    
    if (AppState.user) {
        // Ocultamos los formularios de acceso
        document.getElementById('auth-forms-wrapper')?.classList.add('hidden');
        document.getElementById('profile-panel-wrapper')?.classList.remove('hidden');
        
        // --- NUEVO: Ocultar las pestañas superiores de "Iniciar Sesión / Crear Cuenta" si ya está logueado ---
        const tabsWrapper = document.querySelector('.auth-tabs');
        if (tabsWrapper) tabsWrapper.style.display = 'none';
        
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

        // Si es Administrador, ocultar pedidos e input de dirección, y centrar el formulario de perfil
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
            // --- NUEVO: Renderizar el historial de compras del usuario ---
            renderHistorialComprasUsuario();
        }
    }
    
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
            
            // Actualizar también el nombre del usuario en su historial de ventas (para evitar que se pierdan las compras asociadas)
            AppState.ventas.forEach(v => {
                if (v.userEmail === AppState.user.email || v.userName === oldName) {
                    v.userName = newName;
                    v.userEmail = AppState.user.email; // Asegurar que tenga el email asociado
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
            document.getElementById('reset-password').value = '';
            document.getElementById('reset-password-confirm').value = '';
            
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
    const container = document.getElementById('user-orders-history-container');
    if (!container) return;

    const misCompras = AppState.ventas.filter(v => v.userEmail === AppState.user.email || v.userName === AppState.user.name);

    if (misCompras.length === 0) {
        container.innerHTML = `
            <div style="text-align:center; padding:30px; color:var(--text-muted);">
                <i class="fa-solid fa-bag-shopping" style="font-size:2rem; margin-bottom:10px; display:block;"></i>
                <p style="font-size:0.9rem;">Aún no has realizado compras en La Colmena.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = misCompras.map(compra => {
        let statusClass = 'pending';
        let statusIcon = '⏳';
        if (compra.status === 'Enviado') { statusClass = 'shipping'; statusIcon = '🚚'; }
        if (compra.status === 'Entregado') { statusClass = 'delivered'; statusIcon = '✅'; }

        return `
            <div class="user-order-card" style="background:var(--bg-main); border:1px solid var(--border-subtle); padding:16px; border-radius:12px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
                    <span style="font-weight:700; font-size:0.9rem; color:var(--text-primary);">Orden #${compra.id}</span>
                    <span style="font-size:0.8rem; color:var(--text-secondary);">${compra.date}</span>
                </div>
                <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:10px; line-height:1.4;">
                    <div style="max-height:60px; overflow-y:auto; padding-right:4px;">
                        ${compra.items.map(i => `• ${i.title} <strong>(x${i.cantidad})</strong>`).join('<br>')}
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed var(--border-subtle); padding-top:10px; margin-top:5px;">
                    <div><span style="font-size:0.8rem; color:var(--text-muted);">Total:</span> <strong style="color:var(--ucab-green-light); font-size:0.95rem;">$${compra.total.toFixed(2)}</strong></div>
                    <span class="user-order-status-badge ${statusClass}" style="font-size:0.8rem; font-weight:700; padding:4px 10px; border-radius:6px; background:var(--bg-surface); border:1px solid var(--border-subtle);">
                        ${statusIcon} ${compra.status}
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

function switchAuthTab(target) {
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
    if (!el) return;
    el.textContent = text;
    el.className = `newsletter-feedback ${type}`;
    el.classList.remove('hidden');
}

function ejecutarCierreSesion() {
    sessionStorage.removeItem('activeUser');
    AppState.user = null;
    window.location.href = 'index.html';
}

function initAdminPage() {
    renderMetricasAdmin();
    renderInventarioTablaAdmin();
    renderListaOrdenesAdmin();
    
    // Escuchar cambios para actualizar la vista previa interactiva en vivo
    const previewInputs = ['prod-title', 'prod-price', 'prod-category', 'prod-image', 'prod-stock'];
    previewInputs.forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateProductPreview);
    });
    updateProductPreview();
    
    // Configurar botón para cancelar edición y resetear formulario
    document.getElementById('btn-crud-cancel')?.addEventListener('click', resetFormCrud);
    
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
    const totalVentas = AppState.ventas.length;
    const totalIngresos = AppState.ventas.reduce((acc, v) => acc + v.total, 0);
    const totalProds = AppState.products.length;
    
    const mVentas = document.getElementById('metric-total-ventas');
    const mIngresos = document.getElementById('metric-total-ingresos');
    const mProductos = document.getElementById('metric-total-productos');
    
    if (mVentas) mVentas.textContent = totalVentas;
    if (mIngresos) mIngresos.textContent = `$${totalIngresos.toFixed(2)}`;
    if (mProductos) mProductos.textContent = totalProds;

    // --- NUEVO: Usuarios Registrados vs Activos (Módulo 6) ---
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

    // --- NUEVO: Top 3 Productos Más Vendidos (Módulo 6) ---
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
                    <div style="font-size: 0.85rem; margin-bottom: 5px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                           <span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 75%;" title="${p.title}">#${index + 1} ${p.title}</span>
                           <strong style="color: var(--ucab-green-light);">${p.qty} uds</strong>
                        </div>
                        <div style="background: var(--bg-main); height: 6px; border-radius: 3px; overflow: hidden;">
                           <div style="background: var(--ucab-green); height: 100%; width: ${pct}%; transition: width 0.5s ease;"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }
}

function renderInventarioTablaAdmin() {
    const tbody = document.getElementById('crud-table-body');
    if (!tbody) return;
    
    tbody.innerHTML = AppState.products.map(p => `
        <tr>
            <td><img src="${p.image}" style="width:40px; height:40px; object-fit:contain; background:#FFF; padding:2px; border-radius:4px;"></td>
            <td style="font-weight:600; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
            <td><span class="product-category-tag">${p.category}</span></td>
            <td style="font-weight:700;">$${p.price.toFixed(2)}</td>
            <td><span class="stock-badge ${p.stock > 0 ? 'in-stock' : 'no-stock'}">${p.stock} uds</span></td>
            <td>
                <div style="display:flex; gap:8px;">
                    <button onclick="cargarProductoParaEditar(${p.id})" style="background:var(--ucab-green); color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem;"><i class="fa fa-edit"></i></button>
                    <button onclick="eliminarProductoAdmin(${p.id})" style="background:#EF4444; color:#fff; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-size:0.8rem;"><i class="fa fa-trash"></i></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function cargarProductoParaEditar(id) {
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
    
    // Mostrar el botón de cancelar edición
    const btnCancel = document.getElementById('btn-crud-cancel');
    if (btnCancel) btnCancel.classList.remove('hidden');
    
    // Forzar actualización de la vista previa interactiva
    updateProductPreview();
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function eliminarProductoAdmin(id) {
    if (!confirm("¿Seguro que deseas eliminar este artículo del catálogo global?")) return;
    AppState.products = AppState.products.filter(p => Number(p.id) !== Number(id));
    localStorage.setItem('products', JSON.stringify(AppState.products));
    window.location.reload();
}

function renderListaOrdenesAdmin() {
    const container = document.getElementById('admin-orders-container');
    if (!container) return;
    
    if (AppState.ventas.length === 0) {
        container.innerHTML = `<p style="text-align:center; padding:20px; color:var(--text-muted);">No se registran transacciones en el marketplace todavía.</p>`;
        return;
    }
    
    container.innerHTML = AppState.ventas.map(v => `
        <div style="background:var(--bg-main); padding:18px; border-radius:12px; border:1px solid var(--border-subtle); margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div><strong>Orden #${v.id} - Cliente: ${v.userName}</strong> <span style="font-size:0.8rem; color:var(--text-secondary); margin-left:8px;">(${v.date})</span></div>
                <select onchange="cambiarEstadoEnvio(${v.id}, this.value)" style="padding:6px 12px; border-radius:6px; background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border-subtle); font-weight:600;">
                    <option value="Pendiente" ${v.status === 'Pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
                    <option value="Enviado" ${v.status === 'Enviado' ? 'selected' : ''}>🚚 Enviado</option>
                    <option value="Entregado" ${v.status === 'Entregado' ? 'selected' : ''}>✅ Entregado</option>
                </select>
            </div>
            <div style="font-size:0.9rem; color:var(--text-secondary); margin-top:10px; line-height:1.5;">
                <i class="fa-solid fa-location-dot"></i> Despacho: ${v.address}<br>
                <i class="fa-solid fa-basket-shopping"></i> Artículos: ${v.items.map(i => `${i.title} (x${i.cantidad})`).join(', ')}<br>
                <strong style="color:var(--text-primary); font-size:0.95rem;">Monto Cobrado Total: $${v.total.toFixed(2)}</strong>
            </div>
        </div>
    `).join('');
}

function cambiarEstadoEnvio(ordenId, nuevoEstado) {
    const idx = AppState.ventas.findIndex(v => Number(v.id) === Number(ordenId));
    if (idx > -1) {
        AppState.ventas[idx].status = nuevoEstado;
        localStorage.setItem('colmena_ventas', JSON.stringify(AppState.ventas));
        alert(`Estado de la orden #${ordenId} modificado a: ${nuevoEstado}`);
    }
}

function updateProductPreview() {
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
        <article class="product-card" style="margin: 0; width: 100%; box-shadow: var(--shadow-md);">
            <div class="product-image-wrapper">
                <img src="${imgVal}" alt="${titleVal}">
            </div>
            <div class="product-info-payload">
                <span class="product-tag-category">${catVal}</span>
                <h3>${titleVal}</h3>
                <div class="rating-row-stars">
                    <span class="star-rating-numeric">★ 5.0</span>
                    <span class="stock-badge ${stockVal > 0 ? 'in-stock' : 'no-stock'}">${stockVal > 0 ? `Stock: ${stockVal}` : 'Agotado'}</span>
                </div>
                <div class="product-footer-action">
                    <div class="product-price-value">$${priceVal.toFixed(2)}</div>
                    <span class="view-more-link-btn" style="cursor: default;"><i class="fa-solid fa-circle-info"></i> Detalles</span>
                </div>
            </div>
        </article>
    `;
}

function resetFormCrud() {
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