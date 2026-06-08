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
    
    try {
        await guaranteeCacheData();
    } catch (e) {
        console.warn("No se pudo sincronizar la API externa, usando datos locales offline.", e);
    }
    
    initRouting();
    attachGlobalEvents();
    updateGlobalCartCounter();
});

function initRouting() {
    const path = window.location.pathname;
    
    if (path.endsWith('admin.html')) {
        if (!AppState.user || AppState.user.role !== 'Administrador') {
            alert("Acceso denegado: Se requieren privilegios administrativos.");
            window.location.href = 'index.html';
            return;
        }
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
                    ${AppState.user.role === 'Administrador' ? '<a href="admin.html" style="text-decoration:none; color:var(--text-primary); font-size:0.85rem;"><i class="fa-solid fa-lock"></i> Panel Admin</a>' : ''}
                    <hr style="border:0; border-top:1px solid var(--border-subtle); margin:4px 0;">
                    <button onclick="ejecutarCierreSesion()" style="background:transparent; border:none; text-align:left; color:#EF4444; cursor:pointer; font-size:0.85rem; padding:0;"><i class="fa-solid fa-arrow-right-from-bracket"></i> Salir</button>
                </div>
            </div>
        `;
    } else {
        widget.innerHTML = `
            <a href="registro.html" class="btn-primary-colmena" id="nav-login-btn" style="text-decoration:none;">
                <i class="fa fa-user-circle"></i> <span>Ingresar</span>
            </a>
        `;
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
        totalPrecio += item.price * item.cantidad;
        return `
            <div class="cart-item-row" style="display:flex; gap:12px; padding:12px 0; border-bottom:1px solid var(--border-subtle); align-items:center;">
                <img src="${item.image}" style="width:50px; height:50px; object-fit:contain; background:#fff; padding:4px; border-radius:6px;" alt="${item.title}">
                <div class="cart-item-info" style="flex:1;">
                    <h4 style="font-size:0.85rem; font-weight:600; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${item.title}</h4>
                    <span class="cart-item-price" style="font-size:0.9rem; font-weight:700; color:var(--ucab-green-light); display:block; margin:2px 0;">$${item.price.toFixed(2)}</span>
                    <div class="cart-item-qty-selector" style="display:flex; align-items:center; gap:8px;">
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
    const destacados = AppState.products.slice(0, 4);
    if (destacados.length === 0) {
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; color:var(--text-secondary);">Descargando productos de la API...</p>`;
        return;
    }
    grid.innerHTML = destacados.map(p => `
        <article class="product-card">
            <div class="product-image-container">
                <img src="${p.image}" alt="${p.title}" loading="lazy">
            </div>
            <div class="product-card-body">
                <span class="product-category-tag">${p.category}</span>
                <h3 class="product-title-heading">${p.title}</h3>
                <div class="product-rating-row">
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
                <div class="product-image-container">
                    <img src="${p.image}" alt="${p.title}">
                </div>
                <div class="product-card-body">
                    <span class="product-category-tag">${p.category}</span>
                    <h3 class="product-title-heading">${p.title}</h3>
                    <div class="product-rating-row">
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
        <div style="background:var(--bg-main); padding:12px; border-radius:8px; margin-bottom:10px; border:1px solid var(--border-subtle)">
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight:700;"><span>${r.userName}</span><span style="color:var(--ucab-gold);">${'★'.repeat(r.stars)}</span></div>
            <p style="font-size:0.9rem; color:var(--text-secondary); margin-top:4px;">${r.comment}</p>
        </div>
    `).join('') || '<p style="color:var(--text-muted); font-size:0.9rem;">No hay valoraciones en esta colmena todavía.</p>';
    
    container.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:40px; align-items:start; padding:20px 0;">
            <div style="background:#FFF; padding:20px; border-radius:12px; border:1px solid var(--border-subtle); text-align:center;">
                <img src="${prod.image}" style="max-height:380px; max-width:100%; object-fit:contain;" alt="${prod.title}">
            </div>
            <div>
                <span class="product-category-tag" style="font-size:0.8rem;">${prod.category.toUpperCase()}</span>
                <h2 style="font-size:1.8rem; font-weight:800; line-height:1.2; margin:8px 0 15px 0;">${prod.title}</h2>
                <div style="font-size:1.75rem; font-weight:800; color:var(--text-primary); margin-bottom:15px;">$${prod.price.toFixed(2)}</div>
                <p style="color:var(--text-secondary); line-height:1.6; margin-bottom:25px;">${prod.description}</p>
                <div style="margin-bottom:25px;">
                    <span class="stock-badge ${prod.stock > 0 ? 'in-stock' : 'no-stock'}" style="padding:6px 12px; font-size:0.85rem;">${prod.stock > 0 ? `Unidades Disponibles: ${prod.stock}` : 'Temporalmente Agotado'}</span>
                </div>
                <button onclick="agregarAlCarritoReal(${prod.id})" class="btn-primary-colmena" style="padding:14px 28px; width:100%; max-width:280px; justify-content:center; font-size:1rem;" ${prod.stock <= 0 ? 'disabled' : ''}>
                    <i class="fa fa-shopping-basket"></i> Agregar al Carrito
                </button>
                
                <div style="margin-top:40px; border-top:1px solid var(--border-subtle); padding-top:25px;">
                    <h3 style="font-size:1.2rem; margin-bottom:15px;"><i class="fa-regular fa-comments"></i> Valoraciones de la Comunidad</h3>
                    <div style="margin-bottom:20px;">${reviewsHtml}</div>
                    <form id="review-form" style="background:var(--bg-surface); padding:16px; border-radius:12px; border:1px solid var(--border-subtle)">
                        <h4 style="font-size:0.95rem; margin-bottom:10px;">Añadir tu Opinión</h4>
                        <div class="input-group-colmena">
                            <label>Calificación</label>
                            <select id="review-stars" class="select-colmena" style="padding:8px; border-radius:6px; background:var(--bg-main); color:var(--text-primary); border:1px solid var(--border-subtle)">
                                <option value="5">★★★★★ (5)</option><option value="4">★★★★ (4)</option><option value="3">★★★ (3)</option><option value="2">★★ (2)</option><option value="1">★ (1)</option>
                            </select>
                        </div>
                        <div class="input-group-colmena">
                            <label>Comentario</label>
                            <textarea id="review-comment" rows="3" required placeholder="Escribe aquí tu reseña sobre el producto..."></textarea>
                        </div>
                        <button type="submit" class="btn-primary-colmena" style="margin-top:10px; padding:10px 16px;">Publicar Comentario</button>
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
        document.getElementById('auth-forms-wrapper')?.classList.add('hidden');
        document.getElementById('profile-panel-wrapper')?.classList.remove('hidden');
        
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
    }
    
    document.getElementById('register-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        const role = document.getElementById('reg-role').value;
        const fb = document.getElementById('auth-global-feedback');
        
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
        
        // REDIRECCIÓN INTELIGENTE SEGÚN EL ROL (Requisito Solicitado)
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
            db[userIndex].name = document.getElementById('edit-name').value.trim();
            db[userIndex].avatar = document.getElementById('edit-avatar').value.trim();
            db[userIndex].address = document.getElementById('edit-address').value.trim();
            
            localStorage.setItem('colmena_users_db', JSON.stringify(db));
            sessionStorage.setItem('activeUser', JSON.stringify(db[userIndex]));
            AppState.user = db[userIndex];
            alert("Información de perfil actualizada con éxito.");
            window.location.reload();
        }
    });
}

function switchAuthTab(target) {
    const login = document.getElementById('login-form');
    const register = document.getElementById('register-form');
    const forgot = document.getElementById('forgot-form');
    const tabLogin = document.getElementById('tab-login');
    const tabReg = document.getElementById('tab-register');
    
    login?.classList.add('hidden');
    register?.classList.add('hidden');
    forgot?.classList.add('hidden');
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
        alert("Catálogo actualizado.");
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