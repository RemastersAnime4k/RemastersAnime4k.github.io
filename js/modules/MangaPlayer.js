export default class MangaPlayer {
    constructor() {
        this.mangaModal = document.getElementById('manga-reader-modal');
        if (!this.mangaModal) { console.error("Manga modal not found."); return; }

        this.mangaPagesOuterContainer = this.mangaModal.querySelector('.manga-pages-outer-container');
        this.mangaPagesContainer = this.mangaModal.querySelector('#manga-pages-container');
        this.mangaCloseBtn = this.mangaModal.querySelector('.close-manga');
        this.mangaNextBtn = this.mangaModal.querySelector('.next-page');
        this.mangaPrevBtn = this.mangaModal.querySelector('.prev-page');
        this.mangaModeBtns = this.mangaModal.querySelectorAll('.mode-btn');
        this.mangaCounter = this.mangaModal.querySelector('.page-counter');

        this._mangaPageSources = [];
        this._mangaIndex = 0;
        this._currentSpreadIndex = 0;
        this._mangaTotalPages = 0;
        this._mangaTotalSpreads = 0;

        this._mangaZoomLevel = 1;
        this._mangaPanX = 0; this._mangaPanY = 0;
        this._mangaInitialPanX = 0; this._mangaInitialPanY = 0;
        this._mangaIsPanning = false; this._mangaIsPinching = false;
        this._mangaTouchStartX = 0; this._mangaTouchStartY = 0;
        this._mangaLastTouchX = 0; this._mangaLastTouchY = 0;
        this._mangaInitialPinchDistance = 0;
        this._mangaInitialZoom = 1;
        this._mangaLastTapTime = 0;
        this._mangaControlsVisible = true;
        this._mangaControlsTimeoutId = null;
        this._mangaMinZoom = 1; this._mangaMaxZoom = 5;
        this._currentMode = 'vertical';
        this._intersectionObserver = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        this.mangaCloseBtn.addEventListener('click', () => this.close());

        this.mangaNextBtn.addEventListener('click', () => {
            if (this._currentMode === 'horizontal') this.navigatePage(-1);
            else this.navigatePage(1);
        });
        this.mangaPrevBtn.addEventListener('click', () => {
            if (this._currentMode === 'horizontal') this.navigatePage(1);
            else this.navigatePage(-1);
        });

        this.mangaModeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.setMode(e.currentTarget.dataset.mode));
        });

        this.mangaPagesOuterContainer.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.mangaPagesOuterContainer.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.mangaPagesOuterContainer.addEventListener('touchend', this.handleTouchEnd.bind(this));
        this.mangaPagesOuterContainer.addEventListener('wheel', e => this.handleWheelScroll(e), { passive: false });
    }

    open(pageSourcesJson) {
        try {
            this._mangaPageSources = JSON.parse(pageSourcesJson);
        } catch (e) {
            console.error("Error parsing manga page sources:", e, pageSourcesJson);
            alert("Error al cargar datos del manga.");
            return;
        }

        this._mangaTotalPages = this._mangaPageSources.length;
        this._mangaTotalSpreads = Math.ceil(this._mangaTotalPages / 2);
        this._mangaIndex = 0;
        this._currentSpreadIndex = 0;

        this.resetZoomAndPan();

        this.mangaModal.classList.remove('hidden');
        this.mangaModal.classList.add('flex');
        document.body.classList.add('no-scroll');

        const initialMode = this._currentMode || 'vertical';
        this.setMode(initialMode, true);

        this.updateNavigation();
        this.updateCounter();
        this._scrollToCurrentPage(false);

        this.showControls(true);
    }

    _buildVerticalLayout() {
        this.mangaPagesContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        this._mangaPageSources.forEach((pageUrls, index) => {
            this._createPageItemAndLoadImage(index, fragment, true);
        });
        this.mangaPagesContainer.appendChild(fragment);
    }

    _buildHorizontalLayout() {
        this.mangaPagesContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        for (let s = 0; s < this._mangaTotalSpreads; s++) {
            const spreadDiv = document.createElement('div');
            spreadDiv.className = 'page-spread';
            spreadDiv.id = `manga-spread-${s}`;
            spreadDiv.setAttribute('role', 'group');
            spreadDiv.setAttribute('aria-label', `Doble página ${s + 1}`);

            const rightVisualSlot = document.createElement('div');
            rightVisualSlot.className = 'page-slot';
            const leftVisualSlot = document.createElement('div');
            leftVisualSlot.className = 'page-slot';

            const pageIndexForVisuallyRight = s * 2;
            const pageIndexForVisuallyLeft = s * 2 + 1;

            if (pageIndexForVisuallyRight < this._mangaTotalPages) {
                this._createPageItemAndLoadImage(pageIndexForVisuallyRight, rightVisualSlot, false);
            } else { rightVisualSlot.innerHTML = ''; }

            if (pageIndexForVisuallyLeft < this._mangaTotalPages) {
                this._createPageItemAndLoadImage(pageIndexForVisuallyLeft, leftVisualSlot, false);
            } else { leftVisualSlot.innerHTML = ''; }

            spreadDiv.appendChild(leftVisualSlot);
            spreadDiv.appendChild(rightVisualSlot);
            fragment.appendChild(spreadDiv);
        }
        this.mangaPagesContainer.appendChild(fragment);
    }

    _createPageItemAndLoadImage(pageIndexToLoad, parentElement, isDirectChildInContainer) {
        const pageItem = document.createElement('div');
        pageItem.className = 'page-item';
        pageItem.dataset.pageIndex = pageIndexToLoad.toString();

        if (isDirectChildInContainer) {
            pageItem.id = `manga-page-${pageIndexToLoad}`;
        }
        pageItem.setAttribute('role', 'img');
        pageItem.setAttribute('aria-label', `Página de manga ${pageIndexToLoad + 1}`);
        this._updateLoadingIndicator(pageItem, true);

        const img = document.createElement('img');
        img.alt = `Página ${pageIndexToLoad + 1}`;
        const pageUrls = this._mangaPageSources[pageIndexToLoad] || [];
        img.dataset.sourceUrls = JSON.stringify(pageUrls);
        img.dataset.currentSourceIndex = "0";

        img.onload = () => this._updateLoadingIndicator(pageItem, false);
        img.onerror = (e) => this.handleImageError(e.target, pageItem);

        if (pageUrls.length > 0) img.src = pageUrls[0];
        else this.handleImageError(img, pageItem);

        pageItem.appendChild(img);
        parentElement.appendChild(pageItem);
        return pageItem;
    }

    _setupIntersectionObserverForVerticalScroll() {
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
        }

        const options = {
            root: this.mangaPagesContainer,
            rootMargin: '0px',
            threshold: 0.5
        };

        this._intersectionObserver = new IntersectionObserver((entries, observer) => {
            let mostVisibleEntry = null;
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!mostVisibleEntry || entry.intersectionRatio > mostVisibleEntry.intersectionRatio) {
                        mostVisibleEntry = entry;
                    }
                }
            });

            if (mostVisibleEntry) {
                const pageIndexStr = mostVisibleEntry.target.dataset.pageIndex;
                if (pageIndexStr) {
                    const pageIndex = parseInt(pageIndexStr, 10);
                    if (!isNaN(pageIndex) && this._mangaIndex !== pageIndex) {
                        this._mangaIndex = pageIndex;
                        this.updateCounter();
                        this.updateNavigation();
                    }
                }
            }
        }, options);

        this.mangaPagesContainer.querySelectorAll('.page-item').forEach(item => {
            this._intersectionObserver.observe(item);
        });
    }


    close() {
        this.mangaModal.classList.add('hidden');
        this.mangaModal.classList.remove('flex');
        document.body.classList.remove('no-scroll');
        this.resetZoomAndPan();
        clearTimeout(this._mangaControlsTimeoutId);
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }
    }

    handleImageError(imgElement, pageItemElement) {
        let currentSourceIndex = parseInt(imgElement.dataset.currentSourceIndex, 10);
        const sourceUrls = JSON.parse(imgElement.dataset.sourceUrls);
        currentSourceIndex++;
        if (currentSourceIndex < sourceUrls.length) {
            imgElement.src = sourceUrls[currentSourceIndex];
            imgElement.dataset.currentSourceIndex = currentSourceIndex.toString();
        } else {
            const pageIndexForError = pageItemElement.dataset.pageIndex || 'desconocida';
            console.warn(`All sources failed for page ${pageIndexForError}`);
            imgElement.alt = `Error al cargar página ${parseInt(pageIndexForError, 10) + 1}`;
            this._updateLoadingIndicator(pageItemElement, false, true);
        }
    }
    _updateLoadingIndicator(element, isLoading, isError = false) {
        if (!element) return;
        element.classList.remove('loading', 'loaded', 'error');
        let spinner = element.querySelector('.loading-spinner');
        let text = element.querySelector('.loading-text');

        if (isLoading) {
            element.classList.add('loading');
            if (!spinner) { spinner = document.createElement('div'); spinner.className = 'loading-spinner'; element.appendChild(spinner); }
            if (!text) { text = document.createElement('span'); text.className = 'loading-text'; element.appendChild(text); }
            text.textContent = 'Cargando...';
            spinner.style.display = 'block'; text.style.display = 'block';
        } else {
            if (spinner) spinner.style.display = 'none';
            if (text) text.style.display = 'none';
            if (isError) {
                element.classList.add('error');
                if (text) { text.textContent = 'Error al cargar'; text.style.display = 'block'; }
                else {
                    text = document.createElement('span'); text.className = 'loading-text';
                    text.textContent = 'Error al cargar'; element.appendChild(text); text.style.display = 'block';
                }
            } else {
                element.classList.add('loaded');
            }
        }
    }
    setMode(mode, calledFromOpen = false) {
        this._currentMode = mode;
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }

        this.mangaPagesContainer.classList.toggle('horizontal', mode === 'horizontal');
        this.mangaPagesContainer.classList.toggle('vertical', mode === 'vertical');
        this.mangaModeBtns.forEach(btn => {
            const isActive = btn.dataset.mode === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-pressed', isActive.toString());
        });

        if (mode === 'horizontal') {
            this._buildHorizontalLayout();
            this.mangaPrevBtn.innerHTML = 'Siguiente &#8250;';
            this.mangaPrevBtn.setAttribute('aria-label', 'Siguiente doble página');
            this.mangaNextBtn.innerHTML = '&#8249; Anterior';
            this.mangaNextBtn.setAttribute('aria-label', 'Anterior doble página');
        } else {
            this._buildVerticalLayout();
            this._setupIntersectionObserverForVerticalScroll();
            this.mangaPrevBtn.innerHTML = '&#8249; Anterior';
            this.mangaPrevBtn.setAttribute('aria-label', 'Página anterior');
            this.mangaNextBtn.innerHTML = 'Siguiente &#8250;';
            this.mangaNextBtn.setAttribute('aria-label', 'Página siguiente');
        }

        this.resetZoomAndPan();
        if (!calledFromOpen) {
            this._scrollToCurrentPage(false);
            this.updateNavigation();
            this.updateCounter();
        }
        this.showControls();
    }

    navigatePage(direction) {
        let changed = false;
        if (this._currentMode === 'vertical') {
            const newIndex = this._mangaIndex + direction;
            if (newIndex >= 0 && newIndex < this._mangaTotalPages) {
                this._mangaIndex = newIndex;
                changed = true;
            }
        } else {
            const newSpreadIndex = this._currentSpreadIndex + direction;
            if (newSpreadIndex >= 0 && newSpreadIndex < this._mangaTotalSpreads) {
                this._currentSpreadIndex = newSpreadIndex;
                this._mangaIndex = this._currentSpreadIndex * 2;
                changed = true;
            }
        }

        if (changed) {
            this.resetZoomAndPan();
            this._scrollToCurrentPage(true);
            this.updateNavigation();
            this.updateCounter();
            this.showControls();
        }
    }

    _scrollToCurrentPage(smooth = true) {
        if (this._currentMode === 'vertical') {
            const pageElement = this.mangaPagesContainer.querySelector(`#manga-page-${this._mangaIndex}`);
            if (pageElement) {
                pageElement.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' });
            }
        } else {
            const spreadElement = this.mangaPagesContainer.querySelector(`#manga-spread-${this._currentSpreadIndex}`);
            if (spreadElement) {
                this.mangaPagesContainer.scrollTo({ left: spreadElement.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
            }
        }
    }

    updateNavigation() {
        if (this._currentMode === 'vertical') {
            this.mangaPrevBtn.disabled = this._mangaIndex === 0;
            this.mangaNextBtn.disabled = this._mangaIndex >= this._mangaTotalPages - 1;
        } else {
            this.mangaPrevBtn.disabled = this._currentSpreadIndex >= this._mangaTotalSpreads - 1;
            this.mangaNextBtn.disabled = this._currentSpreadIndex === 0;
        }
    }

    updateCounter() {
        if (this._currentMode === 'vertical') {
            this.mangaCounter.textContent = `Página ${this._mangaIndex + 1} / ${this._mangaTotalPages}`;
            this.mangaCounter.setAttribute('aria-label', `Página ${this._mangaIndex + 1} de ${this._mangaTotalPages}`);
        } else {
            const firstPageInSpread = this._currentSpreadIndex * 2;
            const secondPageInSpread = firstPageInSpread + 1;
            let text = "";

            if (this._mangaTotalPages === 0) {
                text = `0 / 0`;
            } else if (secondPageInSpread < this._mangaTotalPages) {
                text = `Páginas ${secondPageInSpread + 1}-${firstPageInSpread + 1} de ${this._mangaTotalPages}`;
            } else if (firstPageInSpread < this._mangaTotalPages) {
                text = `Página ${firstPageInSpread + 1} de ${this._mangaTotalPages}`;
            } else {
                text = `Doble Página ${this._currentSpreadIndex + 1} / ${this._mangaTotalSpreads}`;
            }
            this.mangaCounter.textContent = text;
        }
    }

    _getCurrentMangaElementForZoom() {
        if (this._currentMode === 'vertical') {
            const pageElement = this.mangaPagesContainer.querySelector(`#manga-page-${this._mangaIndex}`);
            return pageElement ? pageElement.querySelector('img') : null;
        } else {
            return this.mangaPagesContainer.querySelector(`#manga-spread-${this._currentSpreadIndex}`);
        }
    }

    handleTouchStart(e) {
        const targetElement = this._getCurrentMangaElementForZoom();
        if (!targetElement) return;

        if (e.touches.length === 1 && this._mangaZoomLevel > 1) {
            e.preventDefault(); this._mangaIsPanning = true;
            this.mangaPagesOuterContainer.classList.add('grabbing');
            this._mangaTouchStartX = e.touches[0].clientX; this._mangaTouchStartY = e.touches[0].clientY;
            this._mangaInitialPanX = this._mangaPanX; this._mangaInitialPanY = this._mangaPanY;
        } else if (e.touches.length === 1) {
            this._mangaTouchStartX = e.touches[0].clientX; this._mangaTouchStartY = e.touches[0].clientY;
            this._mangaLastTouchX = this._mangaTouchStartX; this._mangaLastTouchY = this._mangaTouchStartY;
            this._mangaIsPanning = false;
        } else if (e.touches.length === 2) {
            e.preventDefault(); this._mangaIsPinching = true; this._mangaIsPanning = false;
            this._mangaInitialPinchDistance = this.getDistanceBetweenTouches(e.touches);
            this._mangaInitialZoom = this._mangaZoomLevel;
        }
        this.showControls();
    }

    handleTouchMove(e) {
        const targetElement = this._getCurrentMangaElementForZoom();
        if (!targetElement) return;

        if (this._mangaIsPanning && e.touches.length === 1 && this._mangaZoomLevel > 1) {
            e.preventDefault();
            const deltaX = e.touches[0].clientX - this._mangaTouchStartX;
            const deltaY = e.touches[0].clientY - this._mangaTouchStartY;
            const newPanX = this._mangaInitialPanX + deltaX; const newPanY = this._mangaInitialPanY + deltaY;
            this.applyZoomAndPan(targetElement, this._mangaZoomLevel, newPanX, newPanY, true);
        } else if (this._mangaIsPinching && e.touches.length === 2) {
            e.preventDefault();
            const currentDistance = this.getDistanceBetweenTouches(e.touches);
            let newZoom = this._mangaInitialZoom * (currentDistance / this._mangaInitialPinchDistance);
            newZoom = Math.max(this._mangaMinZoom, Math.min(this._mangaMaxZoom, newZoom));

            const rect = this.mangaPagesOuterContainer.getBoundingClientRect();
            const touchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
            const touchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
            const imageOriginX = (touchCenterX - this._mangaPanX) / this._mangaZoomLevel;
            const imageOriginY = (touchCenterY - this._mangaPanY) / this._mangaZoomLevel;
            const newPanX = touchCenterX - (imageOriginX * newZoom);
            const newPanY = touchCenterY - (imageOriginY * newZoom);

            this._mangaZoomLevel = newZoom;
            this.applyZoomAndPan(targetElement, this._mangaZoomLevel, newPanX, newPanY, true);

        } else if (e.touches.length === 1 && !this._mangaIsPanning && !this._mangaIsPinching) {
            this._mangaLastTouchX = e.touches[0].clientX; this._mangaLastTouchY = e.touches[0].clientY;
        }
    }

    handleTouchEnd(e) {
        const currentTime = new Date().getTime();
        const tapThreshold = 300;
        const swipeThreshold = 50;

        if (this._mangaIsPanning) {
            this._mangaIsPanning = false; this.mangaPagesOuterContainer.classList.remove('grabbing');
        } else if (this._mangaIsPinching) {
            this._mangaIsPinching = false;
            if (this._mangaZoomLevel <= this._mangaMinZoom + 0.05) {
                this.resetZoomAndPan(true);
            }
        } else if (e.changedTouches.length === 1 && this._mangaZoomLevel <= this._mangaMinZoom + 0.05) {
            const deltaX = this._mangaLastTouchX - this._mangaTouchStartX;
            const deltaY = this._mangaLastTouchY - this._mangaTouchStartY;

            if (Math.abs(deltaX) > swipeThreshold || Math.abs(deltaY) > swipeThreshold) {
                if (this._currentMode === 'horizontal' && Math.abs(deltaX) > Math.abs(deltaY)) {
                    this.navigatePage(deltaX < 0 ? 1 : -1);
                }
            } else {
                if (currentTime - this._mangaLastTapTime < tapThreshold) {
                    const targetElement = this._getCurrentMangaElementForZoom();
                    if (targetElement) {
                        if (this._mangaZoomLevel > this._mangaMinZoom) {
                            this.resetZoomAndPan(true);
                        } else {
                            const rect = this.mangaPagesOuterContainer.getBoundingClientRect();
                            const tapX = e.changedTouches[0].clientX - rect.left;
                            const tapY = e.changedTouches[0].clientY - rect.top;
                            const originX = (tapX - this._mangaPanX) / this._mangaZoomLevel;
                            const originY = (tapY - this._mangaPanY) / this._mangaZoomLevel;
                            const targetZoom = 2;
                            const newPanX = tapX - (originX * targetZoom);
                            const newPanY = tapY - (originY * targetZoom);
                            this.applyZoomAndPan(targetElement, targetZoom, newPanX, newPanY, true);
                        }
                    }
                    this._mangaLastTapTime = 0;
                } else {
                    this.toggleControls();
                }
                this._mangaLastTapTime = currentTime;
            }
        } else if (e.changedTouches.length === 1 && this._mangaZoomLevel > this._mangaMinZoom + 0.05) {
            this.toggleControls();
            this._mangaLastTapTime = currentTime;
        }
        this._mangaLastTouchX = 0; this._mangaLastTouchY = 0;
    }

    getDistanceBetweenTouches(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    applyZoomAndPan(element, scale, panX, panY, restrictPan = false) {
        if (!element) return;
        this._mangaZoomLevel = scale;

        if (restrictPan) {
            const outerRect = this.mangaPagesOuterContainer.getBoundingClientRect();
            let elementWidth = element.offsetWidth;
            let elementHeight = element.offsetHeight;

            if (this._currentMode === 'vertical' && element.tagName === 'IMG') {
                elementWidth = element.naturalWidth || element.offsetWidth;
                elementHeight = element.naturalHeight || element.offsetHeight;
            }

            const scaledWidth = elementWidth * scale;
            const scaledHeight = elementHeight * scale;

            let finalPanX = panX; let finalPanY = panY;
            if (scaledWidth > outerRect.width) {
                const maxPanX = (scaledWidth - outerRect.width) / 2;
                finalPanX = Math.max(-maxPanX, Math.min(maxPanX, panX));
            } else {
                finalPanX = 0;
            }
            if (scaledHeight > outerRect.height) {
                const maxPanY = (scaledHeight - outerRect.height) / 2;
                finalPanY = Math.max(-maxPanX, Math.min(maxPanY, panY));
            } else {
                finalPanY = 0;
            }
            this._mangaPanX = finalPanX; this._mangaPanY = finalPanY;
        } else {
            this._mangaPanX = panX; this._mangaPanY = panY;
        }
        element.style.transform = `scale(${this._mangaZoomLevel}) translate(${this._mangaPanX}px, ${this._mangaPanY}px)`;
    }

    resetZoomAndPan(applyTransform = true) {
        this._mangaZoomLevel = 1; this._mangaPanX = 0; this._mangaPanY = 0;
        this._mangaIsPanning = false; this._mangaIsPinching = false;
        this.mangaPagesOuterContainer.classList.remove('grabbing');
        if (applyTransform) {
            const targetElement = this._getCurrentMangaElementForZoom();
            if (targetElement) targetElement.style.transform = `scale(1) translate(0px, 0px)`;
        }
    }

    toggleControls() {
        this._mangaControlsVisible = !this._mangaControlsVisible;
        if (this._mangaControlsVisible) this.showControls(true);
        else this.hideControls();
    }

    showControls(autoHide = true) {
        this.mangaModal.classList.remove('controls-hidden');
        this._mangaControlsVisible = true;
        clearTimeout(this._mangaControlsTimeoutId);
        if (autoHide && this._mangaZoomLevel <= this._mangaMinZoom + 0.05) {
            this._mangaControlsTimeoutId = setTimeout(() => this.hideControls(), 4000);
        }
    }

    hideControls() {
        this.mangaModal.classList.add('controls-hidden');
        this._mangaControlsVisible = false; clearTimeout(this._mangaControlsTimeoutId);
    }

    handleWheelScroll(e) {
        if (!this.mangaModal.classList.contains('flex') || this._mangaIsPinching) return;
        const targetElement = this._getCurrentMangaElementForZoom();
        if (!targetElement) return;

        if (this._mangaZoomLevel > 1.01) {  // Using 1.01 as a small tolerance for float comparison
            e.preventDefault();
            const newPanX = this._mangaPanX - e.deltaX;
            const newPanY = this._mangaPanY - e.deltaY;
            this.applyZoomAndPan(targetElement, this._mangaZoomLevel, newPanX, newPanY, true);
            this.showControls();
            return;
        }

        if (this._currentMode === 'horizontal') {
            e.preventDefault();
            this.navigatePage(Math.sign(e.deltaX || e.deltaY));
        }
        // In vertical mode, if not zoomed, default browser scroll of mangaPagesContainer is allowed.
        this.showControls();
    }

    handleKeyboard(e) {
        if (this._mangaIsPanning || this._mangaIsPinching) return;

        const activeElement = document.activeElement;
        if (activeElement && this.mangaModal.contains(activeElement)) {
            if (activeElement.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) {
                return;
            }
        }

        let eventHandled = false;

        if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
            eventHandled = true;
        }

        if (!eventHandled && this._mangaZoomLevel <= 1.01) { // Check if not zoomed
            let navigatedByPageKeys = false;
            let scrolledContainer = false;

            switch (e.key) {
                case 'ArrowDown':
                    if (this._currentMode === 'vertical') {
                        e.preventDefault();
                        this.mangaPagesContainer.scrollTop += 40;
                        scrolledContainer = true;
                    }
                    break;
                case 'ArrowUp':
                    if (this._currentMode === 'vertical') {
                        e.preventDefault();
                        this.mangaPagesContainer.scrollTop -= 40;
                        scrolledContainer = true;
                    }
                    break;
                case 'ArrowRight':
                    if (this._currentMode === 'horizontal') {
                        e.preventDefault(); this.navigatePage(-1); navigatedByPageKeys = true;
                    }
                    break;
                case 'ArrowLeft':
                    if (this._currentMode === 'horizontal') {
                        e.preventDefault(); this.navigatePage(1); navigatedByPageKeys = true;
                    }
                    break;
                case 'PageDown':
                    e.preventDefault();
                    if (this._currentMode === 'vertical') {
                        this.mangaPagesContainer.scrollTop += this.mangaPagesContainer.clientHeight * 0.9;
                        scrolledContainer = true;
                    } else {
                        this.navigatePage(1); navigatedByPageKeys = true;
                    }
                    break;
                case 'PageUp':
                    e.preventDefault();
                    if (this._currentMode === 'vertical') {
                        this.mangaPagesContainer.scrollTop -= this.mangaPagesContainer.clientHeight * 0.9;
                        scrolledContainer = true;
                    } else {
                        this.navigatePage(-1); navigatedByPageKeys = true;
                    }
                    break;
            }
            if (navigatedByPageKeys || scrolledContainer) {
                eventHandled = true;
            }
        }

        if (eventHandled) {
            this.showControls();
        }
    }
}
