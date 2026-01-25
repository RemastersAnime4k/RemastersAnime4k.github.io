(function () {
    if ('addEventListener' in document) {
        document.addEventListener('DOMContentLoaded', function () {
            if (typeof FastClick !== 'undefined') {
                FastClick.attach(document.body);
            }
        }, false);
    }

    const loadCSS = (href) => {
        if (!document.querySelector(`link[href="${href}"]`)) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        }
    };

    const contentManager = {
        currentLang: 'jp',
        lastScroll: 0,
        videoPlayer: null,
        mangaPlayer: null,

        async init() {
            if (window.animeConfig) {
                this.renderApp();
            }

            this.setupUiListeners();
            this.addScrollListener();
            this.updateContentVisibility();

            // Lazy Load Video Player
            if (document.getElementById('video-player-modal')) {
                console.log('Video Modal detected. Loading VideoPlayer...');
                loadCSS('../styles/components/video.css'); // Adjusted path for shell
                try {
                    const module = await import('./modules/VideoPlayer.js');
                    this.videoPlayer = new module.default();
                    console.log('VideoPlayer module loaded.');
                } catch (e) {
                    console.error('Failed to load VideoPlayer module:', e);
                }
            }

            // Lazy Load Manga Player
            if (document.getElementById('manga-reader-modal')) {
                console.log('Manga Modal detected. Loading MangaPlayer...');
                loadCSS('../styles/components/manga.css'); // Adjusted path for shell
                try {
                    const module = await import('./modules/MangaPlayer.js');
                    this.mangaPlayer = new module.default();
                    console.log('MangaPlayer module loaded.');
                } catch (e) {
                    console.error('Failed to load MangaPlayer module:', e);
                }
            }

            this.setupGlobalInteractions();
        },

        renderApp() {
            const config = window.animeConfig;
            const app = document.getElementById('app-container');
            if (!config || !app) return;

            document.title = config.title + " - RemastersAnime4k";

            // 1. Navbar
            const nav = document.createElement('nav');
            nav.className = 'detail-nav';
            nav.innerHTML = `
                <h1 class="site-title-detail">Remastersanime4k</h1>
                <div style="flex-grow: 1;"></div>
                <a href="../index.html" class="back-button" aria-label="Volver a la página principal">← Volver</a>
            `;
            app.appendChild(nav);

            // 2. Main Content
            const main = document.createElement('main');
            main.className = 'anime-container';
            main.ariaLabelledBy = 'anime-title';

            // Cover
            const coverDiv = document.createElement('div');
            coverDiv.className = 'anime-cover';
            coverDiv.innerHTML = `<img src="${config.cover}" alt="Portada del anime">`;
            main.appendChild(coverDiv);

            // Info
            const infoSection = document.createElement('section');
            infoSection.className = 'anime-info';
            infoSection.ariaLabelledBy = 'info-title';
            
            // Stats calculations
            const episodeCount = config.episodes ? config.episodes.length : 0;
            const seasonCount = episodeCount > 0 ? 1 : 0; 
            const status = "Finalizado"; 

            infoSection.innerHTML = `
                <h2 id="anime-title" class="sr-only">${config.title}</h2>
                <p class="anime-description">${config.description}</p>
                <div class="detail-boxes" role="region" aria-label="Detalles del anime">
                    <div class="detail-item"><span class="detail-label">ESTADO</span><p class="detail-value">${status}</p></div>
                    <div class="detail-item"><span class="detail-label">TEMPORADAS</span><p class="detail-value">${seasonCount}</p></div>
                    <div class="detail-item"><span class="detail-label">EPISODIOS</span><p class="detail-value">${episodeCount}</p></div>
                    <div class="detail-item"><span class="detail-label">AÑO</span><p class="detail-value">---</p></div>
                </div>
            `;
            main.appendChild(infoSection);

            // Language Selector
            const langContainer = document.createElement('div');
            langContainer.className = 'language-selector-container';
            langContainer.innerHTML = `
                <div class="format-selector">
                    <button class="format-button active" data-lang="jp" aria-pressed="true">Japonés</button>
                    <button class="format-button" data-lang="latino" aria-pressed="false">Español Latino</button>
                </div>
            `;
            main.appendChild(langContainer);

            app.appendChild(main);

            // 3. Episodes Section
            if (config.episodes && config.episodes.length > 0) {
                const epSection = document.createElement('section');
                epSection.className = 'full-width-section';
                epSection.innerHTML = `
                    <div class="episodes-main-container">
                        <h3 class="section-title"><span class="section-icon">🎬</span>Anime</h3>
                        <div class="category-container">
                             <h3 class="section-title">Temporada 1</h3>
                             <div class="episodes-grid" role="list"></div>
                        </div>
                    </div>
                `;
                const grid = epSection.querySelector('.episodes-grid');
                config.episodes.forEach(ep => {
                    const card = document.createElement('div');
                    card.className = 'episode-card';
                    card.setAttribute('role', 'listitem');
                    card.setAttribute('data-srcjp', ep.videoUrl || '');
                    card.setAttribute('data-subtitles', ep.subtitles || '');
                    
                    const thumb = ep.thumbnail || 'https://via.placeholder.com/300x169?text=No+Thumbnail';
                    card.style.backgroundImage = `url('${thumb}')`;
                    
                    card.innerHTML = `
                        <div class="episode-content">
                            <span class="episode-number-display">Episodio ${ep.number}</span>
                            <h4 class="episode-title">${ep.title}</h4>
                        </div>
                        <button class="episode-play">▶</button>
                    `;
                    grid.appendChild(card);
                });
                app.appendChild(epSection);
            }

            // 4. Modals 
            const videoModal = document.createElement('div');
            videoModal.id = 'video-player-modal';
            videoModal.className = 'video-modal';
            videoModal.style.display = 'none'; 
            videoModal.innerHTML = `
                <div class="video-container" id="video-container">
                    <video id="video-player" class="video-player" playsinline crossorigin="anonymous"></video>
                    <div class="controls-container">
                        <div class="progress-container" id="progress-container">
                            <div class="buffer-bar"></div>
                            <div class="progress-bar"></div>
                        </div>
                        <div class="buttons-container">
                            <div class="left-controls">
                                <button class="play-pause" aria-label="Reproducir"><i class="fas fa-play"></i></button>
                                <div class="time-display"><span class="current-time">0:00</span> / <span class="duration">0:00</span></div>
                                <div class="volume-container">
                                     <input type="range" class="volume-control" min="0" max="1" step="0.1" value="1" aria-label="Volumen">
                                </div>
                            </div>
                            <div class="right-controls">
                                <button class="cc-button" aria-pressed="true" aria-label="Subtítulos"><i class="fas fa-closed-captioning"></i></button>
                                <button class="fullscreen" aria-label="Pantalla completa"><i class="fas fa-expand"></i></button>
                                <div class="center-play"><i class="fas fa-play"></i></div>
                                <div class="loading" style="display:none;">Cargando...</div>
                            </div>
                        </div>
                        <button class="close-modal close-modal-btn" style="position:absolute; top:20px; right:20px; z-index:1001; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:50%; width:40px; height:40px; cursor:pointer; font-size: 20px;">✕</button>
                    </div>
                </div>
            `;
            app.appendChild(videoModal);
        },

        setupUiListeners() {
            document.querySelectorAll('.format-button').forEach(btn => {
                btn.addEventListener('click', (e) => this.handleLanguageChange(e.currentTarget));
            });
        },

        setupGlobalInteractions() {
            document.addEventListener('click', (e) => {
                const playButton = e.target.closest('.episode-play');
                const readButton = e.target.closest('.read-button');
                const bookContainer = e.target.closest('.book-container');

                if (playButton && playButton.closest('.episode-card')) {
                    const card = playButton.closest('.episode-card');
                    if (card && !card.classList.contains('content-unavailable')) {
                        const videoUrlData = card.dataset[`src${this.currentLang}`];
                        const subtitleUrl = card.dataset.subtitles;
                        if (videoUrlData && videoUrlData.trim() !== '' && videoUrlData !== 'null') {
                            if (this.videoPlayer) {
                                this.videoPlayer.open(videoUrlData, subtitleUrl);
                            } else {
                                console.warn('VideoPlayer not loaded yet.');
                            }
                        }
                    }
                } else if (readButton) {
                    const book = readButton.closest('.book-container');
                    if (book && !book.classList.contains('content-unavailable')) {
                        const mangaData = book.dataset[`src${this.currentLang}`];
                        if (mangaData && mangaData.trim() !== '' && mangaData !== 'null') {
                            if (window.matchMedia("(max-width: 768px)").matches && !book.classList.contains('active-mobile')) {
                                document.querySelectorAll('.book-container.active-mobile').forEach(activeBook => activeBook.classList.remove('active-mobile'));
                                book.classList.add('active-mobile');
                            }
                            if (this.mangaPlayer) {
                                this.mangaPlayer.open(mangaData);
                            } else {
                                console.warn('MangaPlayer not loaded yet.');
                            }
                        }
                    }
                } else if (bookContainer) {
                    if (window.matchMedia("(max-width: 768px)").matches) {
                        if (bookContainer.classList.contains('active-mobile')) {
                            bookContainer.classList.remove('active-mobile');
                        } else {
                            document.querySelectorAll('.book-container.active-mobile').forEach(activeBook => {
                                activeBook.classList.remove('active-mobile');
                            });
                            bookContainer.classList.add('active-mobile');
                        }
                    }
                } else if (!e.target.closest('.manga-modal') && !e.target.closest('.video-modal') && !e.target.closest('.support-hub-container')) {
                    if (window.matchMedia("(max-width: 768px)").matches) {
                        document.querySelectorAll('.book-container.active-mobile').forEach(activeBook => {
                            activeBook.classList.remove('active-mobile');
                        });
                    }
                }
            });

            document.addEventListener('keydown', (e) => {
                if (this.videoPlayer && this.videoPlayer.playerModal && this.videoPlayer.playerModal.style.display === 'block') {
                    this.videoPlayer.handleKeyboard(e);
                } else if (this.mangaPlayer && this.mangaPlayer.mangaModal && this.mangaPlayer.mangaModal.classList.contains('flex')) {
                    this.mangaPlayer.handleKeyboard(e);
                }
            });
        },

        addScrollListener() {
            let lastKnownScrollPosition = 0;
            let ticking = false;
            // Note: navbar is now created dynamically, so we need to query it lazily or re-query
            const getNavbar = () => document.querySelector('.detail-nav');
            
            window.addEventListener('scroll', () => {
                const navbar = getNavbar();
                if (!navbar) return;

                lastKnownScrollPosition = window.pageYOffset;
                if (!ticking) {
                    window.requestAnimationFrame(() => {
                        const currentScroll = lastKnownScrollPosition;
                        if (currentScroll > 100 && currentScroll > this.lastScroll) navbar.classList.add('nav-hidden');
                        else navbar.classList.remove('nav-hidden');
                        this.lastScroll = currentScroll <= 0 ? 0 : currentScroll;
                        ticking = false;
                    });
                    ticking = true;
                }
            }, { passive: true });
        },

        handleLanguageChange(button) {
            if (button.classList.contains('active')) return;
            document.querySelectorAll('.format-button').forEach(b => {
                b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
            });
            button.classList.add('active'); button.setAttribute('aria-pressed', 'true');
            this.currentLang = button.dataset.lang;
            this.updateContentVisibility();
        },

        processBatch(items, action, batchSize = 10, index = 0) {
            const batch = items.slice(index, index + batchSize);
            batch.forEach(item => action(item));

            if (index + batchSize < items.length) {
                requestAnimationFrame(() => this.processBatch(items, action, batchSize, index + batchSize));
            }
        },

        updateContentVisibility() {
            const episodeCards = Array.from(document.querySelectorAll('.episode-card[data-lid]'));
            if (episodeCards.length > 0) {
                this.processBatch(episodeCards, card => {
                    const srcKey = `src${this.currentLang}`;
                    const available = card.dataset[srcKey] && card.dataset[srcKey] !== 'null' && card.dataset[srcKey].trim() !== '';
                    card.classList.toggle('content-unavailable', !available);
                    const playButton = card.querySelector('.episode-play');
                    if (playButton) playButton.disabled = !available;
                });
            }

            // Also handle config-based cards? The renderApp creates cards with data-srcjp.
            // My renderApp logic used 'data-srcjp' explicitly. 
            // The handleLanguageChange uses 'src'+lang.
            // If I render with 'data-srcjp', and switch to 'latino', it looks for 'srclatino'.
            // If the shell config only has videoUrl (which is usually JP/default), then latino might fade out.
            // For now, I'll rely on what I extracted. `videoUrl` went to `data-srcjp`.
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        contentManager.init();
    });

})();

// --- Additional Modules (Comments & Ads) ---
document.getElementById('toggleCommentsBtn')?.addEventListener('click', function () {
    const commentsSection = document.getElementById('commentsSection');
    // Mostrar la sección si está oculta
    if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        this.textContent = '❌ Ocultar comentarios';

        // Crear dinámicamente el script de Giscus (solo si no se ha cargado antes)
        if (!document.querySelector('.giscus-frame')) {
            const script = document.createElement('script');
            script.src = 'https://giscus.app/client.js';
            script.setAttribute('data-repo', 'RemastersAnime4k/RemastersAnime4k.github.io');
            script.setAttribute('data-repo-id', 'R_kgDOPc708Q');
            script.setAttribute('data-category', 'Announcements');
            script.setAttribute('data-category-id', 'DIC_kwDOPc708c4CuJNY');
            script.setAttribute('data-mapping', 'pathname');
            script.setAttribute('data-strict', '1');
            script.setAttribute('data-reactions-enabled', '0');
            script.setAttribute('data-emit-metadata', '0');
            script.setAttribute('data-input-position', 'top');
            script.setAttribute('data-theme', 'light');
            script.setAttribute('data-lang', 'es');
            script.setAttribute('crossorigin', 'anonymous');
            script.async = true;
            script.className = 'giscus-frame'; // Para evitar recargarlo
            commentsSection.appendChild(script);
        }
    } else {
        // Ocultar comentarios sin recargarlos
        commentsSection.style.display = 'none';
        this.textContent = '💬 Ver comentarios';
    }
});

document.addEventListener('DOMContentLoaded', function () {
    // Support Hub Logic
    const tabsContainer = document.querySelector('.support-tabs');
    if (tabsContainer) {
        const tabs = tabsContainer.querySelectorAll('.support-tab');
        const panels = document.querySelectorAll('.support-panel');

        tabsContainer.addEventListener('click', (e) => {
            const clickedTab = e.target.closest('.support-tab');
            if (!clickedTab) return;

            tabs.forEach(tab => {
                tab.classList.remove('active');
                tab.setAttribute('aria-selected', 'false');
            });
            panels.forEach(panel => {
                panel.style.display = 'none';
            });

            clickedTab.classList.add('active');
            clickedTab.setAttribute('aria-selected', 'true');

            const targetPanelId = clickedTab.getAttribute('aria-controls');
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.style.display = 'block';
            }
        });
    }

    const commentLinkBtn = document.getElementById('comment-link-btn');
    const commentsSection = document.getElementById('commentsSection');
    if (commentLinkBtn && commentsSection) {
        commentLinkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const toggleBtn = document.getElementById('toggleCommentsBtn');
            if (commentsSection.style.display === 'none') {
                toggleBtn.click();
            }
            setTimeout(() => {
                commentsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Ad System Logic
    const adPanel = document.getElementById('panel-ads');
    if (!adPanel) return;

    // Observa cambios en el panel de anuncios para saber cuándo se hace visible.
    const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                if (adPanel.style.display === 'block' && !adPanel.dataset.adLoaded) {
                    initializeAdSystem();
                    adPanel.dataset.adLoaded = 'true'; // Previene recargas
                }
            }
        }
    });

    observer.observe(adPanel, { attributes: true });

    // Ejecuta el sistema si el panel ya es visible al cargar la página.
    if (adPanel.style.display === 'block' && !adPanel.dataset.adLoaded) {
        initializeAdSystem();
        adPanel.dataset.adLoaded = 'true';
    }
});

// Función principal que inicia el proceso de carga de anuncios.
function initializeAdSystem() {
    const adSlotContainer = document.getElementById('ad-slot-container');
    if (!adSlotContainer) {
        return;
    }

    // Plan A: Intentar cargar el anuncio dinámico.
    loadDynamicAd(adSlotContainer);

    // Plan B: Iniciar un temporizador para verificar si el Plan A funcionó.
    setTimeout(() => {
        const adIframe = adSlotContainer.querySelector('iframe');

        // La condición de fallo: no hay iframe o es un iframe de rastreo muy pequeño.
        if (!adIframe || adIframe.offsetHeight < 50) {
            loadFallbackAd(adSlotContainer);
        }
    }, 3000); // Un temporizador de 3 segundos da tiempo suficiente para que el ad cargue.
}

// Función para el Plan A: Cargar el anuncio de Adsterra.
function loadDynamicAd(container) {
    // 1. Limpiar el contenedor y mostrar un estado de carga.
    container.innerHTML = `
        <div class="asd-container loading-ad">
        </div>
    `;

    // 2. Definir las opciones de Adsterra.
    window.atOptions = {
        'key': 'd5c23d95be4a77b53674f427915af0de',
        'format': 'iframe',
        'height': 250,
        'width': 300,
        'params': {}
    };

    // 3. Crear e inyectar el script de Adsterra dinámicamente.
    const adScript = document.createElement('script');
    adScript.type = 'text/javascript';
    adScript.async = true;
    adScript.src = '//www.highperformanceformat.com/d5c23d95be4a77b53674f427915af0de/invoke.js';

    // Si el script en sí no puede cargarse (error de red, etc.), activa el Plan B.
    adScript.onerror = () => {
        console.warn("Adsterra script failed to load (network error).");
        loadFallbackAd(container);
    };

    // Añade el script al DOM.
    const loadingContainer = container.querySelector('.asd-container');
    if (loadingContainer) {
        loadingContainer.appendChild(adScript);
    } else {
        container.appendChild(adScript);
    }
}

// Función para el Plan B: Cargar el anuncio de respaldo estático.
function loadFallbackAd(container) {
    // Prevenir que se ejecute dos veces.
    if (container.querySelector('.fallback-ad')) return;

    console.log("Ad-blocker detected or ad failed to load. Displaying fallback.");

    // Define el HTML interno del banner de respaldo.
    const fallbackHTML = `
        <a href="https://remastersanime4k.github.io/Espacio-Publicitario.html" target="_blank" rel="noopener noreferrer">
            <img src="https://i.pinimg.com/736x/11/15/2d/11152dc45f236704097ab8582b865acb.jpg" class="asd-image" alt="Publicidad Alternativa" loading="lazy">
            <div class="asd-content">
                <h3 class="asd-title">¡Tu apoyo hace la diferencia! ❤️</h3>
                <p class="asd-description">Tu visita a los patrocinadores hace posible que sigamos compartiendo tu anime favorito en 4K</p>
                <div class="asd-cta">Visitar</div>
            </div>
        </a>
    `;

    // Reemplaza el contenido del contenedor con el banner de respaldo.
    container.innerHTML = `
        <div class="asd-container fallback-ad">
            <div class="asd-badge">PUBLICIDAD</div>
            ${fallbackHTML}
        </div>
    `;
}
