import { $, appRoot, initSupabase, loadConfig, appConfig, supabase, today, pad, escapeHtml } from './core.js';

let refreshTimer = null;
let clockTimer = null;
let tvChannel = null;
let soundEnabled = false;
let lastSpokenKey = null;
let lastDisplayedId = null;
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
    <main class="tv-pro-page">
      <section class="tv-pro-shell" aria-label="Pantalla TV del Digiturno Jurídico">
        <header class="tv-pro-header">
          <div class="tv-pro-brand">
            <img class="tv-pro-logo-ucc" src="${escapeHtml(appConfig.logo || 'assets/img/logo_ucc_horizontal.png')}" alt="Universidad Cooperativa de Colombia">
            <span class="tv-pro-divider" aria-hidden="true"></span>
            <img class="tv-pro-logo-consultorio" src="${escapeHtml(appConfig.logo_pantalla || 'assets/img/logo_consultorio_juridico.png')}" alt="Consultorio Jurídico y Centro de Conciliación">
          </div>

          <div class="tv-pro-welcome">
            <strong>Bienvenido.</strong>
            <span>${escapeHtml(appConfig.mensaje_pantalla || 'Tome asiento y esté atento al llamado de su turno.')}</span>
          </div>

          <div class="tv-pro-clock-card">
            <div class="tv-pro-clock-icon" aria-hidden="true">◷</div>
            <div>
              <div id="tvClock" class="tv-pro-clock-time">--:--:--</div>
              <div id="tvDate" class="tv-pro-clock-date">--</div>
            </div>
          </div>
        </header>

        <section class="tv-pro-content">
          <aside class="tv-pro-recent-panel">
            <div class="tv-pro-section-title">
              <span class="tv-pro-title-icon">◔</span>
              <span>Turnos recientes</span>
            </div>
            <div id="recentCalls" class="tv-pro-recent-list">
              <article class="tv-pro-empty-card">Sin llamados recientes</article>
            </div>
          </aside>

          <section class="tv-pro-main-panel">
            <div class="tv-pro-section-title tv-pro-main-title">
              <span class="tv-pro-title-icon">i</span>
              <span>Información institucional</span>
              <button id="enableSound" class="tv-pro-sound-btn" type="button" title="Activar lectura por voz">Activar sonido</button>
            </div>

            <section class="tv-pro-video-card" aria-label="Video institucional">
              <div class="tv-pro-video-stage">
                <video id="tvVideoPlayer" class="hidden" autoplay muted controls playsinline preload="metadata"></video>
                <iframe id="tvVideoFrame" class="hidden" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video institucional"></iframe>
                <div id="tvVideoPlaceholder" class="tv-pro-video-placeholder">
                  <div class="tv-pro-placeholder-text">
                    <strong>Información institucional</strong>
                    <span>Configure el video desde el módulo de administración.</span>
                  </div>
                </div>
              </div>
            </section>

            <section id="currentCall" class="tv-pro-call-banner" aria-live="polite">
              <div class="tv-pro-call-left">
                <div class="tv-pro-call-label">🔊 LLAMANDO:</div>
                <div id="calledService" class="tv-pro-call-service">En espera de llamados</div>
                <div class="tv-pro-call-point">Diríjase a: <strong id="calledPoint">---</strong></div>
              </div>
              <div class="tv-pro-call-right">
                <div id="calledTurn" class="tv-pro-call-code">---</div>
              </div>
            </section>
          </section>
        </section>

        <footer class="tv-pro-ticker" aria-label="Información institucional">
          <div class="tv-pro-info-dot">i</div>
          <div class="tv-pro-ticker-window">
            <div class="tv-pro-ticker-track">
              <span id="tickerText">${escapeHtml(resolveTickerText())}</span>
              <span aria-hidden="true">${escapeHtml(resolveTickerText())}</span>
            </div>
          </div>
          <div class="tv-pro-footer-logo">UCC</div>
        </footer>
      </section>
    </main>
  `;

  $('#enableSound')?.addEventListener('click', () => {
    soundEnabled = true;
    $('#enableSound').textContent = 'Sonido activo';
    $('#enableSound').classList.add('is-active');
    speak('Sonido activado.');
  });

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
    .channel('turnos-tv-profesional')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, loadTvData)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'configuracion' }, async () => {
      await loadConfig();
      updateStaticTexts();
      pendingReloadVideo = true;
    })
    .subscribe();

  window.addEventListener('beforeunload', () => {
    clearInterval(clockTimer);
    clearInterval(refreshTimer);
    if (tvChannel) supabase.removeChannel(tvChannel);
  });
}

function resolveTickerText(){
  return appConfig.franja_inferior || 'Nuestros servicios son gratuitos y confidenciales.  |  Respeto, escucha y diálogo para construir soluciones.  |  Horario de atención del Consultorio Jurídico.';
}

function updateStaticTexts(){
  const welcome = $('.tv-pro-welcome span');
  if (welcome) welcome.textContent = appConfig.mensaje_pantalla || 'Tome asiento y esté atento al llamado de su turno.';
  const ticker = $('#tickerText');
  if (ticker) ticker.textContent = resolveTickerText();
}

function updateClock(){
  const now = new Date();
  const timeOptions = { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true };
  const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const time = now.toLocaleTimeString('es-CO', timeOptions).replace('a. m.', 'a. m.').replace('p. m.', 'p. m.');
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

  if (actualError) console.warn('Error cargando turno actual:', actualError.message);

  const { data: recientes, error: recentError } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('fecha', today())
    .in('estado', ['Llamado', 'En atención', 'Finalizado', 'Ausente'])
    .not('hora_llamado', 'is', null)
    .order('hora_llamado', { ascending: false })
    .limit(6);

  if (recentError) console.warn('Error cargando últimos llamados:', recentError.message);

  renderCurrentCall(actual);
  renderRecentCalls(recientes || []);
}

function renderCurrentCall(turno){
  const banner = $('#currentCall');
  if (!turno) {
    $('#calledTurn').textContent = '---';
    $('#calledService').textContent = 'En espera de llamados';
    $('#calledPoint').textContent = '---';
    banner?.classList.remove('has-call');
    return;
  }

  $('#calledTurn').textContent = turno.codigo_turno || '---';
  $('#calledService').textContent = turno.servicios?.nombre_servicio || 'Servicio';
  $('#calledPoint').textContent = turno.puntos_atencion?.nombre_punto || 'Punto pendiente';
  banner?.classList.add('has-call');

  const key = `${turno.id_turno}-${turno.llamado_version || 0}-${turno.estado}`;
  if (lastDisplayedId && lastDisplayedId !== key) flashCurrentCall();
  lastDisplayedId = key;

  if (lastSpokenKey !== key) {
    lastSpokenKey = key;
    speakTurn(turno);
  }
}

function renderRecentCalls(turnos){
  const list = $('#recentCalls');
  if (!list) return;

  if (!turnos.length) {
    list.innerHTML = '<article class="tv-pro-empty-card">Sin llamados recientes</article>';
    return;
  }

  list.innerHTML = turnos.map((t, i) => {
    const service = t.servicios?.nombre_servicio || 'Servicio';
    const point = t.puntos_atencion?.nombre_punto || 'Punto pendiente';
    const stateClass = stateToClass(t.estado);
    return `
      <article class="tv-pro-recent-card ${stateClass}">
        <div class="tv-pro-recent-number">${pad(i + 1)}</div>
        <div class="tv-pro-recent-info">
          <div class="tv-pro-recent-service">${escapeHtml(service)}</div>
          <div class="tv-pro-recent-main">
            <strong>${escapeHtml(t.codigo_turno || '')}</strong>
            <span>${escapeHtml(point)}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function stateToClass(estado = ''){
  const normalized = String(estado).toLowerCase();
  if (normalized.includes('ausente')) return 'is-absent';
  if (normalized.includes('finalizado')) return 'is-finished';
  if (normalized.includes('atención')) return 'is-attending';
  return 'is-called';
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
    placeholder.innerHTML = `<div class="tv-pro-placeholder-text"><strong>No se pudo cargar el video</strong><span>${escapeHtml(item)}</span></div>`;
  };
}
