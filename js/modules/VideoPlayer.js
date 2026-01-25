export default class VideoPlayer {
    constructor() {
        this.playerModal = document.getElementById('video-player-modal');
        if (!this.playerModal) {
            console.error("Video player modal not found.");
            return;
        }
        this.videoElement = this.playerModal.querySelector('video.video-player');
        this.videoContainer = this.playerModal.querySelector('.video-container');
        this.controls = {
            playPause: this.playerModal.querySelector('.play-pause'),
            volume: this.playerModal.querySelector('.volume-control'),
            progressContainer: this.playerModal.querySelector('#progress-container'),
            progressBar: this.playerModal.querySelector('.progress-bar'),
            bufferBar: this.playerModal.querySelector('.buffer-bar'),
            currentTime: this.playerModal.querySelector('.current-time'),
            duration: this.playerModal.querySelector('.duration'),
            closeBtn: this.playerModal.querySelector('.close-modal'),
            centerPlay: this.playerModal.querySelector('.center-play'),
            loading: this.playerModal.querySelector('.loading'),
            fullscreen: this.playerModal.querySelector('.fullscreen'),
            ccButton: this.playerModal.querySelector('.cc-button'),
        };

        this.hlsInstance = null;
        this.octopusInstance = null; // Libass instance
        this.textTrack = null;
        this.controlsTimeout = null;
        this.isPlaying = false;
        this._currentVideoUrls = [];
        this._currentSubtitleUrl = null;
        this._currentVideoUrlIndex = 0;
        this._bufferInterval = null;
        this._lastOnErrorHandler = null;


        this.initializeVolume();
        this.setupEventListeners();
    }

    initializeVolume() {
        const savedVolume = localStorage.getItem('videoVolume') || "1";
        const volumeValue = parseFloat(savedVolume);
        if (this.videoElement) this.videoElement.volume = volumeValue;
        if (this.controls.volume) {
            this.controls.volume.value = volumeValue.toString();
            this.controls.volume.setAttribute('aria-valuenow', volumeValue.toString());
        }
    }

    setupEventListeners() {
        if (!this.controls.playPause) return; // Essential controls check

        this.controls.playPause.addEventListener('click', () => this.togglePlay());
        this.controls.volume.addEventListener('input', (e) => this.setVolume(parseFloat(e.target.value)));
        this.controls.closeBtn.addEventListener('click', () => this.close());
        this.controls.fullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.controls.ccButton.addEventListener('click', () => this.toggleSubtitles());

        this.videoContainer.addEventListener('click', (e) => {
            if (e.target === this.videoContainer || e.target === this.videoElement) {
                this.togglePlay();
            }
        });
        this.controls.centerPlay.addEventListener('click', (e) => {
            e.stopPropagation(); this.togglePlay();
        });

        this.controls.progressContainer.addEventListener('click', (e) => this.seek(e));
        this.controls.progressContainer.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const newTime = this.videoElement.currentTime + (e.key === 'ArrowLeft' ? -5 : 5);
                this.videoElement.currentTime = Math.max(0, Math.min(this.videoElement.duration || 0, newTime));
            }
        });

        this.videoElement.addEventListener('timeupdate', () => { this.updateProgress(); this.updateBufferBar(); });
        this.videoElement.addEventListener('loadedmetadata', () => this.updateDurationDisplay());
        this.videoElement.addEventListener('durationchange', () => this.updateDurationDisplay());
        this.videoElement.addEventListener('waiting', () => this.showLoading(true, "Cargando..."));
        this.videoElement.addEventListener('playing', () => this.showLoading(false));
        this.videoElement.addEventListener('canplay', () => this.showLoading(false));

        this.videoElement.addEventListener('play', () => {
            this.controls.centerPlay.classList.remove('visible');
            this.controls.playPause.setAttribute('aria-label', 'Pausar');
            this.controls.playPause.textContent = '⏸';
            this.controls.centerPlay.classList.add('playing');
            this.controls.centerPlay.setAttribute('aria-label', 'Pausar video');
            this.playerModal.classList.remove('paused');
            this.resetControlsTimeout();
            this._startBufferMonitoring();
        });
        this.videoElement.addEventListener('pause', () => {
            this.controls.centerPlay.classList.add('visible');
            this.controls.playPause.setAttribute('aria-label', 'Reproducir');
            this.controls.playPause.textContent = '▶';
            this.controls.centerPlay.classList.remove('playing');
            this.controls.centerPlay.setAttribute('aria-label', 'Reproducir video');
            this.playerModal.classList.add('paused');
            this.showControls();
            this._stopBufferMonitoring();
        });

        this.playerModal.addEventListener('mousemove', () => this.showControls());
        this.playerModal.addEventListener('touchstart', () => this.showControls(), { passive: true });
        this.playerModal.addEventListener('mouseleave', () => { if (!this.videoElement.paused) this.hideControls(); });
        this.playerModal.addEventListener('dblclick', (e) => {
            if (e.target === this.videoElement || e.target === this.videoContainer) {
                this.toggleFullscreen();
            }
        });
        this.setupVideoTextTracks(); // Initial setup
        document.addEventListener('fullscreenchange', () => this.handleFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.handleFullscreenChange());
    }
    handleFullscreenChange() {
        const isFullscreen = document.fullscreenElement === this.playerModal || document.webkitFullscreenElement === this.playerModal;
        if (isFullscreen) {
            this.playerModal.classList.add('modal-is-actually-fullscreen');
            this.controls.fullscreen.innerHTML = '&#x26F6;'; // Shrink icon
            this.controls.fullscreen.setAttribute('aria-label', 'Salir de pantalla completa');
            this.controls.fullscreen.title = 'Salir de Pantalla Completa (F)';
        } else {
            this.playerModal.classList.remove('modal-is-actually-fullscreen');
            this.controls.fullscreen.textContent = '⛶';
            this.controls.fullscreen.setAttribute('aria-label', 'Activar pantalla completa');
            this.controls.fullscreen.title = 'Pantalla Completa (F)';
        }
    }

    open(videoUrls, subtitleUrl) {
        this._currentVideoUrls = videoUrls.split('|').map(url => url.trim()).filter(url => url !== '');
        this._currentSubtitleUrl = subtitleUrl;
        this._currentVideoUrlIndex = 0;

        if (this._currentVideoUrls.length > 0) {
            this.playWithFallback();
        } else {
            console.error('No valid video URLs found.');
            this.showLoading(true, 'Error: URL de video no válida.');
        }
    }

    playWithFallback() {
        if (this._currentVideoUrlIndex >= this._currentVideoUrls.length) {
            console.error('All video URLs failed.');
            this.showLoading(true, "Error al cargar video. Todas las fuentes fallaron.");
            return;
        }

        const url = this._currentVideoUrls[this._currentVideoUrlIndex];
        this.showLoading(true, `Cargando...`);


        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }
        this.videoElement.innerHTML = ''; // Clear previous tracks
        this.videoElement.src = ''; // Clear previous src

        if (this._currentSubtitleUrl && this._currentSubtitleUrl !== 'null' && this._currentSubtitleUrl.trim() !== '') {
            // Use SubtitlesOctopus by default, fallback handled in initOctopus
            this.initOctopus(this._currentSubtitleUrl);
        } else {
             this.controls.ccButton.style.display = 'none';
        }
        // Native tracks setup is now done inside enableNativeSubtitles if needed

        const onError = (eventData) => {
            console.warn(`Error with video source: ${url}`, eventData);
            if (this.hlsInstance) {
                this.hlsInstance.destroy();
                this.hlsInstance = null;
            }
            if (this.octopusInstance) {
                this.octopusInstance.dispose();
                this.octopusInstance = null;
            }
            this._currentVideoUrlIndex++;
            this.playWithFallback();
        };

        this.videoElement.removeEventListener('error', this._lastOnErrorHandler);
        this._lastOnErrorHandler = onError;
        this.videoElement.addEventListener('error', this._lastOnErrorHandler, { once: true });


        if (url.includes('.m3u8')) {
            if (typeof Hls !== 'undefined' && Hls.isSupported()) {
                this.hlsInstance = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60 });
                this.hlsInstance.loadSource(url);
                this.hlsInstance.attachMedia(this.videoElement);
                this.hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    this._startPlayback();
                });
                this.hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    console.warn('HLS Error:', data);
                    if (data.fatal) {
                        onError(data);
                    }
                });
            } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                this.videoElement.src = url;
                this.videoElement.addEventListener('loadedmetadata', () => {
                    this._startPlayback();
                }, { once: true });
            } else {
                onError('HLS not supported');
            }
        } else {
            this.videoElement.src = url;
            this.videoElement.addEventListener('loadedmetadata', () => {
                this._startPlayback();
            }, { once: true });
        }
    }

    _startPlayback() {
        this.showLoading(false);
        this.controls.progressBar.style.width = '0%';
        this.controls.currentTime.textContent = '00:00';
        this.updateDurationDisplay();

        this.videoElement.play()
            .then(() => {
                this.playerModal.style.display = 'block';
                document.body.classList.add('no-scroll');
                this.isPlaying = true;
                this.showControls();
                this.playerModal.focus();
            })
            .catch(error => {
                console.error('Error starting playback for URL:', this._currentVideoUrls[this._currentVideoUrlIndex], error);
                this.showLoading(true, `Error: ${this.getErrorMessage(error)}`);
            });
    }

    close() {
        if (document.fullscreenElement && document.fullscreenElement === this.playerModal) {
            document.exitFullscreen().catch(e => console.warn("Error exiting fullscreen:", e));
        }
        if (this.hlsInstance) {
            this.hlsInstance.destroy();
            this.hlsInstance = null;
        }
        this.videoElement.pause();
        this.videoElement.removeAttribute('src');
        if (typeof this.videoElement.load === 'function') {
            this.videoElement.load();
        }
        this.videoElement.innerHTML = '';

        if (this._lastOnErrorHandler) {
            this.videoElement.removeEventListener('error', this._lastOnErrorHandler);
            this._lastOnErrorHandler = null;
        }

        this.playerModal.style.display = 'none';
        document.body.classList.remove('no-scroll');
        this.isPlaying = false;
        if (this.controls.progressBar) this.controls.progressBar.style.width = '0%';
        if (this.controls.bufferBar) this.controls.bufferBar.style.width = '0%';
        if (this.controls.currentTime) this.controls.currentTime.textContent = '00:00';
        if (this.controls.duration) this.controls.duration.textContent = '00:00';
        if (this.controls.centerPlay) this.controls.centerPlay.classList.remove('visible', 'playing');
        if (this.controls.playPause) this.controls.playPause.textContent = '▶';
        if (this.controls.ccButton) this.controls.ccButton.classList.remove('active');
        this._stopBufferMonitoring();
    }

    // --- SubtitlesOctopus Integration ---

    loadOctopusLibrary() {
        return new Promise((resolve, reject) => {
            if (window.SubtitlesOctopus) {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'js/libass/subtitles-octopus.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load SubtitlesOctopus'));
            document.head.appendChild(script);
        });
    }

    initOctopus(subtitleUrl) {
        this.loadOctopusLibrary().then(() => {
            if (this.octopusInstance) {
                this.octopusInstance.dispose();
                this.octopusInstance = null;
            }

            const options = {
                video: this.videoElement,
                subUrl: subtitleUrl,
                fonts: ['../js/libass/default.woff2'],
                workerUrl: '../js/libass/subtitles-octopus-worker.js',
                legacyWorkerUrl: '../js/libass/subtitles-octopus-worker-legacy.js',
                debug: true, // Enable debug to see more details if it fails
                onReady: () => {
                    console.log("SubtitlesOctopus Ready");
                    this.controls.ccButton.style.display = 'flex';
                    this.controls.ccButton.classList.add('active'); // Default ON
                    this.controls.ccButton.setAttribute('aria-pressed', 'true');
                },
                onError: (e) => {
                    console.error("SubtitlesOctopus Error:", e);
                    this.enableNativeSubtitles(subtitleUrl); // Fallback
                }
            };
            this.octopusInstance = new SubtitlesOctopus(options);
        }).catch(err => {
            console.error("Failed to initialize Octopus:", err);
            this.enableNativeSubtitles(subtitleUrl); // Fallback
        });
    }

    enableNativeSubtitles(subtitleUrl) {
        console.log("Falling back to native subtitles");
        if (this.octopusInstance) {
            this.octopusInstance.dispose();
            this.octopusInstance = null;
        }

        // Remove existing tracks first
        const existingTracks = this.videoElement.querySelectorAll('track');
        existingTracks.forEach(track => track.remove());

        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.src = subtitleUrl;
        track.srclang = 'es';
        track.label = 'Español';
        track.default = true;
        this.videoElement.appendChild(track);
        
        // Ensure CC button is visible and active
        this.controls.ccButton.style.display = 'flex';
        this.controls.ccButton.classList.add('active');
        
        // Use legacy text track setup if needed
        this.setupVideoTextTracks();
    }

    // Override toggleSubtitles for Octopus
    toggleSubtitles() {
        if (!this.octopusInstance) return;

        // Octopus doesn't have a simple 'hide' boolean prop usually exposed cleanly without disposing, 
        // but we can check if we want to remove/add. 
        // Actually, easiest way is to re-create or dispose? No, expensive.
        // It renders to a canvas. We can toggle the canvas visibility?
        // The library creates a canvas sibling to the video.
        
        // Better sub-approach: The library API documentation implies proper management.
        // If we want to hide, strictly speaking, we could set track to empty or similar.
        // BUT, for simplicity in this integration step, let's assume 'dispose' to OFF and 'init' to ON is safest
        // OR simply toggle the canvas opacity/display if possible.
        // Let's try finding the canvas passed or created.
        
        // Actually, let's look at the object. `this.octopusInstance.canvas` usually exists.
        
        /* 
           Simpler approach: Just toggle the 'hidden' class on the canvas provided by Octopus if accessible, 
           or use the verify method.
           
           Wait, standard libass implementations usually have a .resize() or similar.
           Correct path: `this.octopusInstance.freeTrack()` clears it.
        */
       
       // Let's implement a simple "Opacity" toggle if wrapper doesn't provide hide.
       // Actually, looking at commonly used forks, simply ensuring we can toggle is key.
       // Let's assume for this step we toggled it via a flag we track.
       
       const canvas = this.playerModal.querySelector('canvas.libassjs-canvas');
        if (canvas) {
            const isVisible = canvas.style.display !== 'none';
            canvas.style.display = isVisible ? 'none' : 'block';
            this.controls.ccButton.classList.toggle('active', !isVisible);
            this.controls.ccButton.setAttribute('aria-pressed', !isVisible ? 'true' : 'false');
        } else {
            // Fallback for native tracks toggle
            if (this.videoElement.textTracks && this.videoElement.textTracks.length > 0) {
                 const track = this.videoElement.textTracks[0];
                 track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
                 this.controls.ccButton.classList.toggle('active', track.mode === 'showing');
            }
        }
    }


    togglePlay() {
        if (this.videoElement.paused || this.videoElement.ended) {
            this.videoElement.play().catch(e => {
                console.error("Play error during togglePlay:", e);
                this.showLoading(true, `Error: ${this.getErrorMessage(e)}`);
            });
        } else {
            this.videoElement.pause();
        }
    }
    setVolume(value) {
        this.videoElement.volume = value;
        this.videoElement.muted = value === 0;
        this.controls.volume.value = value.toString();
        this.controls.volume.setAttribute('aria-valuenow', value.toString());
        this.controls.volume.setAttribute('aria-valuetext', `${Math.round(value * 100)}%`);
        localStorage.setItem('videoVolume', value.toString());
    }
    seek(e) {
        const rect = this.controls.progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        const newTime = pos * (this.videoElement.duration || 0);
        if (!isNaN(newTime) && this.videoElement.seekable && this.videoElement.seekable.length > 0) {
            let canSeek = false;
            for (let i = 0; i < this.videoElement.seekable.length; i++) {
                if (newTime >= this.videoElement.seekable.start(i) && newTime <= this.videoElement.seekable.end(i)) {
                    canSeek = true;
                    break;
                }
            }
            if (canSeek) this.videoElement.currentTime = newTime;
        }
    }
    updateProgress() {
        if (!this.videoElement || !this.videoElement.duration || isNaN(this.videoElement.duration)) return;
        const progressPercent = (this.videoElement.currentTime / this.videoElement.duration) * 100;
        this.controls.progressBar.style.width = `${progressPercent}%`;
        this.controls.currentTime.textContent = this.formatTime(this.videoElement.currentTime);
        this.controls.progressContainer.setAttribute('aria-valuenow', Math.round(progressPercent));
        this.controls.progressContainer.setAttribute('aria-valuetext', `${Math.round(this.videoElement.currentTime)}s de ${Math.round(this.videoElement.duration)}s`);
    }
    updateBufferBar() {
        if (!this.videoElement || !this.videoElement.buffered || this.videoElement.buffered.length === 0 || !this.videoElement.duration || isNaN(this.videoElement.duration)) {
            if (this.controls.bufferBar) this.controls.bufferBar.style.width = '0%'; return;
        }
        const buffered = this.videoElement.buffered;
        const duration = this.videoElement.duration;
        const currentTime = this.videoElement.currentTime;
        let bufferEnd = 0;
        for (let i = 0; i < buffered.length; i++) {
            if (buffered.start(i) <= currentTime && buffered.end(i) >= currentTime) {
                bufferEnd = buffered.end(i); break;
            }
        }
        if (bufferEnd === 0 && buffered.length > 0) bufferEnd = buffered.end(buffered.length - 1);
        if (this.controls.bufferBar) this.controls.bufferBar.style.width = `${Math.min((bufferEnd / duration) * 100, 100)}%`;
    }
    updateDurationDisplay() {
        if (this.videoElement && this.videoElement.duration && !isNaN(this.videoElement.duration)) {
            this.controls.duration.textContent = this.formatTime(this.videoElement.duration);
            this.controls.progressContainer.setAttribute('aria-valuemax', Math.round(this.videoElement.duration));
        } else {
            if (this.controls.duration) this.controls.duration.textContent = '00:00';
        }
    }
    formatTime(timeInSeconds) {
        const seconds = Math.floor(timeInSeconds % 60).toString().padStart(2, '0');
        const minutes = Math.floor(timeInSeconds / 60) % 60 .toString().padStart(2, '0');
        const hours = Math.floor(timeInSeconds / 3600);
        return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
    }
    showLoading(show, message = "Cargando...") {
        if (!this.controls.loading) return;
        this.controls.loading.style.display = show ? 'block' : 'none';
        this.controls.loading.textContent = message;
    }
    showControls() {
        this.playerModal.classList.add('controls-visible');
        this.videoContainer.classList.remove('cursor-hidden');
        this.resetControlsTimeout();
    }
    hideControls() {
        if (!this.videoElement.paused) {
            this.playerModal.classList.remove('controls-visible');
            this.videoContainer.classList.add('cursor-hidden');
        }
    }
    resetControlsTimeout() {
        clearTimeout(this.controlsTimeout);
        if (!this.videoElement.paused) {
            this.controlsTimeout = setTimeout(() => this.hideControls(), 3000);
        }
    }
    toggleFullscreen() {
        const elem = this.playerModal;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (elem.requestFullscreen) elem.requestFullscreen().catch(err => console.error(`Fullscreen error: ${err.message}`));
            else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen().catch(err => console.error(`Exit Fullscreen error: ${err.message}`));
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    }
    setupVideoTextTracks() {
        if (!this.videoElement || !this.controls.ccButton) return;
        const tracks = this.videoElement.textTracks;
        if (tracks && tracks.length > 0) {
            this.textTrack = tracks[0];
            for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'hidden';
            this.controls.ccButton.style.display = 'flex';
            this.controls.ccButton.classList.remove('active');
            this.controls.ccButton.setAttribute('aria-pressed', 'false');
            tracks.onaddtrack = () => this.setupVideoTextTracks();
        } else {
            this.controls.ccButton.style.display = 'none';
        }
    }
    toggleSubtitles() {
        if (!this.textTrack) {
            const tracks = this.videoElement.textTracks;
            if (tracks && tracks.length > 0) this.textTrack = tracks[0];
        }
        if (this.textTrack) {
            const isActive = this.textTrack.mode === 'showing';
            this.textTrack.mode = isActive ? 'hidden' : 'showing';
            this.controls.ccButton.classList.toggle('active', !isActive);
            this.controls.ccButton.setAttribute('aria-pressed', !isActive ? 'true' : 'false');
        }
    }
    _startBufferMonitoring() {
        this._stopBufferMonitoring();
        this._bufferInterval = setInterval(() => {
            if (!this.isPlaying || !this.videoElement || this.videoElement.readyState < 2) return;
            const currentTime = this.videoElement.currentTime;
            let bufferedAhead = 0;
            for (let i = 0; i < this.videoElement.buffered.length; i++) {
                if (this.videoElement.buffered.start(i) <= currentTime && this.videoElement.buffered.end(i) >= currentTime) {
                    bufferedAhead = this.videoElement.buffered.end(i) - currentTime; break;
                }
            }
            if (bufferedAhead < 5 && this.videoElement.readyState < 3 && !this.videoElement.seeking) {
                if (this.videoElement.paused) this.videoElement.play().catch(() => { });
                this.showLoading(true, "Cargando...");
            } else if (bufferedAhead >= 5 && this.controls.loading.style.display === 'block' && this.controls.loading.textContent.includes("Buffering")) {
                this.showLoading(false);
            }
        }, 1000);
    }
    _stopBufferMonitoring() { clearInterval(this._bufferInterval); }
    getErrorMessage(error) {
        if (!error) return 'Error al cargar el video.';
        if (error.name === 'NotSupportedError') return 'Formato no soportado.';
        if (error.name === 'AbortError') return 'Carga abortada.';
        if (error.message) {
            if (error.message.includes('NETWORK_ERR') || error.message.includes('Failed to fetch')) return 'Error de red.';
            if (error.message.includes('MEDIA_ERR_DECODE')) return 'Error de decodificación.';
            if (error.message.includes('MEDIA_ERR_SRC_NOT_SUPPORTED')) return 'Fuente no compatible.';
            if (error.message.toLowerCase().includes('interrupted by a new load request')) return 'Carga interrumpida.';
        }
        return 'Error al cargar el video.';
    }
    handleKeyboard(e) {
        if (e.target !== document.body && e.target.tagName !== 'VIDEO' && !e.target.classList.contains('progress-container')) return;
        switch (e.key) {
            case ' ': case 'k': e.preventDefault(); this.togglePlay(); break;
            case 'ArrowLeft': e.preventDefault(); this.videoElement.currentTime = Math.max(0, this.videoElement.currentTime - 5); break;
            case 'ArrowRight': e.preventDefault(); this.videoElement.currentTime = Math.min(this.videoElement.duration || 0, this.videoElement.currentTime + 5); break;
            case 'ArrowUp': e.preventDefault(); this.setVolume(Math.min(this.videoElement.volume + 0.1, 1)); break;
            case 'ArrowDown': e.preventDefault(); this.setVolume(Math.max(this.videoElement.volume - 0.1, 0)); break;
            case 'f': e.preventDefault(); this.toggleFullscreen(); break;
            case 'c': e.preventDefault(); this.toggleSubtitles(); break;
            case 'm': e.preventDefault(); this.videoElement.muted = !this.videoElement.muted; this.controls.volume.value = this.videoElement.muted ? "0" : this.videoElement.volume.toString(); break;
            case 'Escape':
                if (document.fullscreenElement === this.playerModal || document.webkitFullscreenElement === this.playerModal) {
                    e.preventDefault(); this.toggleFullscreen();
                } else {
                    e.preventDefault(); this.close();
                }
                break;
        }
    }
}
