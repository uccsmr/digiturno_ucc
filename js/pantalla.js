import { $, appRoot, initSupabase, loadConfig, appConfig, supabase, today, pad, escapeHtml } from './core.js';

let clockTimer = null;
let refreshTimer = null;
let tvChannel = null;
let soundEnabled = false;
let lastSpokenKey = null;
let lastDisplayedKey = null;
let playlist = [];
let playlistKey = '';
let currentVideoIndex = 0;
let pendingReloadVideo = false;

(async () => {
  const ok = await initSupabase();
  if (!ok) return;
  await renderScreen();
})().catch(error => {
  console.error('Error iniciando pantalla TV:', error);
  appRoot().innerHTML = `<main class="tv-fatal"><section><h1>Error en Pantalla TV</h1><p>${escapeHtml(error.message || error)}</p></section></main>`;
});

async function renderScreen(){
  await loadConfig();

  appRoot().innerHTML = `
    <main class="tv-page" aria-label="Pantalla TV del Digiturno Jurídico">
      <section class="tv-shell">
        <header class="tv-header">
          <div class="tv-brand-zone">
            <img class="tv-logo-ucc" src="${escapeHtml(appConfig.logo || 'assets/img/logo_ucc_horizontal.png')}" alt="Universidad Cooperativa de Colombia">
            <span class="tv-divider" aria-hidden="true"></span>
            <img class="tv-logo-consultorio" src="${escapeHtml(appConfig.logo_pantalla || 'assets/img/logo_consultorio_juridico.png')}" alt="Consultorio Jurídico y Centro de Conciliación">
          </div>

          <div class="tv-message-zone">
            <strong>Tome asiento y esté atento</strong>
            <span>al llamado de su turno.</span>
          </div>

          <div class="tv-clock-card" aria-label="Hora y fecha actual">
            <div class="tv-clock-icon" aria-hidden="true">◷</div>
            <div class="tv-clock-copy">
              <div id="tvClock" class="tv-clock-time">--:--</div>
              <div id="tvDate" class="tv-clock-date">--</div>
            </div>
          </div>
        </header>

        <section class="tv-content">
          <aside class="tv-queue-panel" aria-label="Turnos activos del día">
            <div class="tv-panel-title">
              <span class="tv-title-icon">◷</span>
              <span>Turnos activos</span>
            </div>
            <div id="waitingList" class="tv-queue-list">
              <article class="tv-empty-card">Sin turnos llamados</article>
            </div>
          </aside>

          <section class="tv-main-zone">
            <section class="tv-video-card" aria-label="Video institucional">
              <div class="tv-video-stage">
                <video id="tvVideoPlayer" class="hidden" autoplay muted controls playsinline preload="metadata"></video>
                <iframe id="tvVideoFrame" class="hidden" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video institucional"></iframe>
                <div id="tvVideoPlaceholder" class="tv-video-placeholder">
                  <div class="tv-placeholder-content">
                    <strong>Video institucional</strong>
                    <span>Configure el video desde el módulo de administración.</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="currentCall" class="tv-call-strip" aria-live="polite">
              <div class="tv-call-icon" aria-hidden="true">🔊</div>
              <div class="tv-call-service-zone">
                <div id="calledLabel" class="tv-call-label">Llamando:</div>
                <div id="calledService" class="tv-call-service">En espera de llamado</div>
              </div>
              <div class="tv-call-point-zone">
                <span>Diríjase a:</span>
                <strong id="calledPoint">---</strong>
              </div>
              <div class="tv-call-code-zone">
                <strong id="calledTurn">---</strong>
              </div>
            </section>
          </section>
        </section>

        <footer class="tv-footer" aria-label="Información del consultorio">
          <div class="tv-footer-info"><span>i</span></div>
          <div class="tv-footer-message">Nuestros servicios son gratuitos y confidenciales.</div>
          <div class="tv-footer-separator"></div>
          <div class="tv-footer-message">Respeto, escucha y diálogo para construir soluciones.</div>
          <div class="tv-footer-separator"></div>
          <div class="tv-footer-message">Horario de atención: lunes a viernes 7:00 a. m. - 7:00 p. m.</div>
          <button id="enableSound" class="tv-footer-sound" type="button" title="Activar lectura por voz">🔊 Sonido</button>
        </footer>
      </section>
    </main>
  `;

  $('#enableSound')?.addEventListener('click', () => {
    soundEnabled = true;
    $('#enableSound').textContent = '🔊 Sonido activo';
    $('#enableSound').classList.add('is-active');
    speak('Sonido activado.');
  });

  // Intento de activación inicial: algunos navegadores lo bloquean hasta que el usuario interactúe.
  tryAutoEnableSound();

  updateClock();
  setupPlaylist();
  await loadTvData();

  clockTimer = setInterval(updateClock, 1000);
  refreshTimer = setInterval(async () => {
    await loadConfig();
    if (pendingReloadVideo) setupPlaylist();
    await loadTvData();
  }, Number(appConfig.tiempo_actualizacion || 3000));

  tvChannel = supabase
    .channel('turnos-tv-v16')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, loadTvData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion' }, async () => {
      await loadConfig();
      pendingReloadVideo = true;
      setupPlaylist();
    })
    .subscribe();

  window.addEventListener('beforeunload', () => {
    clearInterval(clockTimer);
    clearInterval(refreshTimer);
    if (tvChannel) supabase.removeChannel(tvChannel);
  });
}

function tryAutoEnableSound(){
  // La mayoría de navegadores exige interacción del usuario para speechSynthesis.
  // Se deja el botón en el footer para activarlo cuando el navegador lo requiera.
  if ('speechSynthesis' in window) {
    soundEnabled = true;
    const btn = $('#enableSound');
    if (btn) {
      btn.textContent = '🔊 Sonido listo';
      btn.classList.add('is-ready');
    }
  }
}

function updateClock(){
  const now = new Date();
  const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const time = now.toLocaleTimeString('es-CO', timeOptions)
    .replace('a. m.', 'a. m.')
    .replace('p. m.', 'p. m.')
    .replace('a.m.', 'a. m.')
    .replace('p.m.', 'p. m.');
  const date = now.toLocaleDateString('es-CO', dateOptions);
  if ($('#tvClock')) $('#tvClock').textContent = time;
  if ($('#tvDate')) $('#tvDate').textContent = capitalize(date);
}

function capitalize(text = ''){
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function loadTvData(){
  const { data: actual, error: actualError } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('fecha', today())
    .in('estado', ['Llamado', 'En atención'])
    .not('hora_llamado', 'is', null)
    .order('hora_llamado', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (actualError) console.warn('Error cargando turno llamado:', actualError.message);

  const { data: activos, error: activosError } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('fecha', today())
    .in('estado', ['En espera', 'Transferido', 'Llamado', 'En atención'])
    .order('prioridad', { ascending: false })
    .order('hora_generado', { ascending: true })
    .limit(10);

  if (activosError) console.warn('Error cargando turnos activos:', activosError.message);

  renderCurrentCall(actual);
  renderActiveList(activos || []);
}

function renderActiveList(turnos){
  const list = $('#waitingList');
  if (!list) return;

  if (!turnos.length) {
    list.innerHTML = '<article class="tv-empty-card">Sin turnos activos</article>';
    return;
  }

  list.innerHTML = turnos.map((t, i) => {
    const service = t.servicios?.nombre_servicio || 'Servicio';
    const priorityBadge = Number(t.prioridad || 0) > 0 ? '<em class="tv-priority-badge">Prioritario</em>' : '';
    const isWaiting = ['En espera', 'Transferido'].includes(t.estado);
    const pointText = isWaiting ? 'En espera' : (t.puntos_atencion?.nombre_punto || 'Punto pendiente');
    const stateClass = isWaiting ? 'is-waiting' : (t.estado === 'En atención' ? 'is-attending' : 'is-called');
    const stateLabel = isWaiting ? 'Aún no llamado' : (t.estado === 'En atención' ? 'En atención' : 'Llamado');
    return `
      <article class="tv-queue-card ${stateClass} ${Number(t.prioridad || 0) > 0 ? 'is-priority' : ''}">
        <div class="tv-queue-number">${pad(i + 1)}</div>
        <div class="tv-queue-copy">
          <div class="tv-queue-code-row">
            <strong>${escapeHtml(t.codigo_turno || '')}</strong>
            ${priorityBadge}
          </div>
          <div class="tv-queue-service">${escapeHtml(pointText)}</div>
          <div class="tv-queue-meta">${escapeHtml(service)} <span>|</span> ${escapeHtml(stateLabel)}</div>
        </div>
      </article>
    `;
  }).join('');
}

function renderCurrentCall(turno){
  const banner = $('#currentCall');

  if (!turno) {
    $('#calledTurn').textContent = '---';
    if ($('#calledLabel')) $('#calledLabel').textContent = 'Llamando:';
    $('#calledService').textContent = 'En espera de llamado';
    $('#calledPoint').textContent = '---';
    banner?.classList.remove('has-call');
    return;
  }

  $('#calledTurn').textContent = turno.codigo_turno || '---';
  if ($('#calledLabel')) $('#calledLabel').textContent = turno.estado === 'En atención' ? 'En atención:' : 'Llamando:';
  $('#calledService').textContent = turno.servicios?.nombre_servicio || 'Servicio';
  $('#calledPoint').textContent = turno.puntos_atencion?.nombre_punto || 'Punto pendiente';
  banner?.classList.add('has-call');

  const key = `${turno.id_turno}-${turno.llamado_version || 0}-${turno.estado}`;
  if (lastDisplayedKey && lastDisplayedKey !== key) flashCurrentCall();
  lastDisplayedKey = key;

  if (lastSpokenKey !== key) {
    lastSpokenKey = key;
    speakTurn(turno);
  }
}

function formatShortTime(value){
  if (!value) return '--:--';
  return new Date(value).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace('a. m.', 'a. m.')
    .replace('p. m.', 'p. m.');
}

function flashCurrentCall(){
  const banner = $('#currentCall');
  banner?.classList.add('flash');
  setTimeout(() => banner?.classList.remove('flash'), 1600);
}

function codeToSpeech(code = ''){
  const [pre = '', num = ''] = String(code).split('-');
  const digits = { '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro', '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve' };
  const prefix = pre.split('').join(' ');
  const number = num.split('').map(d => digits[d] || d).join(' ');
  return `${prefix}, ${number}`.trim();
}

function speak(text){
  if (!soundEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-CO';
  utter.rate = 0.88;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

function speakTurn(turno){
  const point = turno.puntos_atencion?.nombre_punto || 'punto pendiente';
  const service = turno.servicios?.nombre_servicio || '';
  speak(`Turno ${codeToSpeech(turno.codigo_turno)}. ${service}. Diríjase a ${point}.`);
}

function setupPlaylist(){
  const items = String(appConfig.videos_pantalla || '')
    .split(/\r?\n|,/)
    .map(x => x.trim())
    .filter(Boolean);

  const key = JSON.stringify(items);
  if (key === playlistKey && !pendingReloadVideo) return;

  pendingReloadVideo = false;
  playlistKey = key;
  playlist = items;
  currentVideoIndex = 0;
  playVideo(0);
}

function assetUrl(url){
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
  return url;
}

function youtubeEmbed(url){
  try {
    if (/youtu\.be\//i.test(url)) {
      const id = url.split('youtu.be/')[1].split(/[?&]/)[0];
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0&controls=1`;
    }
    const u = new URL(url);
    const id = u.searchParams.get('v');
    if (id && /(^|\.)youtube\.com$/i.test(u.hostname)) {
      return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0&controls=1`;
    }
  } catch (e) {}
  return '';
}

function playVideo(index){
  const video = $('#tvVideoPlayer');
  const frame = $('#tvVideoFrame');
  const placeholder = $('#tvVideoPlaceholder');
  if (!video || !frame || !placeholder) return;

  if (!playlist.length) {
    placeholder.classList.remove('hidden');
    placeholder.innerHTML = `<div class="tv-placeholder-content"><strong>Video institucional</strong><span>Configure el video desde el módulo de administración.</span></div>`;
    video.classList.add('hidden');
    frame.classList.add('hidden');
    video.removeAttribute('src');
    frame.removeAttribute('src');
    return;
  }

  currentVideoIndex = index % playlist.length;
  const item = playlist[currentVideoIndex];
  const yt = youtubeEmbed(item);
  placeholder.classList.add('hidden');

  if (yt) {
    video.classList.add('hidden');
    video.pause();
    video.removeAttribute('src');
    frame.classList.remove('hidden');
    frame.src = yt;
    setTimeout(() => playlist.length > 1 && playVideo(currentVideoIndex + 1), 60000);
    return;
  }

  frame.classList.add('hidden');
  frame.removeAttribute('src');
  video.classList.remove('hidden');
  video.src = assetUrl(item);
  video.load();
  video.play().catch(() => {});
  video.onended = () => playlist.length > 1 && playVideo(currentVideoIndex + 1);
  video.onerror = () => {
    video.classList.add('hidden');
    placeholder.classList.remove('hidden');
    placeholder.innerHTML = `<div class="tv-placeholder-content"><strong>No se pudo cargar el video</strong><span>${escapeHtml(item)}</span></div>`;
  };
}
