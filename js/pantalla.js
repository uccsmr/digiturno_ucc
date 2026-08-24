import { $, appRoot, initSupabase, loadConfig, appConfig, supabase, today, pad, escapeHtml } from './core.js';

let tvTimer = null;
let tvChannel = null;
let soundEnabled = false;
let lastSpokenKey = null;
let playlist = [];
let playlistKey = '';
let currentVideoIndex = 0;

(async () => {
  const ok = await initSupabase();
  if (!ok) return;
  await renderScreen();
})();

async function renderScreen(){
  await loadConfig();
  appRoot().innerHTML = `<main class="screen-page"><section class="tv-screen"><div class="tv-shell">
    <header class="tv-header"><div class="tv-header-left"><img src="${appConfig.logo_pantalla || appConfig.logo || 'assets/img/logo_consultorio_juridico.png'}" class="tv-logo" alt="Logo"><div class="tv-title-wrap"><h1>${escapeHtml(appConfig.nombre_entidad || 'Digiturno Jurídico')}</h1><p id="tvMensaje">${escapeHtml(appConfig.mensaje_pantalla || '')}</p></div></div><div class="tv-clock-box"><div class="tv-clock-time" id="clock">--:--:--</div><div class="tv-clock-date" id="currentDate">--</div></div></header>
    <section class="tv-layout"><aside class="tv-sidebar"><div class="tv-panel-heading"><span class="tv-panel-icon">🔊</span><span>Turnos en pantalla</span></div><div class="tv-last-list" id="lastCallsBody"><article class="tv-last-card empty">Sin turnos</article></div></aside>
      <section class="tv-main"><div class="tv-panel-heading"><span class="tv-panel-icon">▶</span><span>Información institucional</span></div><section class="tv-video-card"><div class="tv-video-stage"><video id="tvVideoPlayer" class="hidden" autoplay muted controls playsinline></video><iframe id="tvVideoFrame" class="hidden" allow="autoplay; encrypted-media" allowfullscreen></iframe><div class="tv-video-placeholder" id="tvVideoPlaceholder">Configure videos desde administración.</div></div></section>
      <section class="tv-call-banner" id="calledCard"><div class="tv-call-left"><div class="tv-call-label">📢 LLAMANDO:</div><div class="tv-call-service" id="calledService">En espera de llamados</div><div class="tv-call-point">Diríjase a: <strong id="calledPoint">---</strong></div></div><div class="tv-call-right"><div class="tv-call-code" id="calledTurn">---</div><button id="enableSound" class="btn btn-secondary tv-sound-btn" type="button">Activar sonido</button></div></section></section></section>
    <section class="tv-ticker"><div class="tv-ticker-track"><span id="tickerText">${escapeHtml(appConfig.franja_inferior || '')}</span></div></section></div></section></main>`;

  $('#enableSound').addEventListener('click', () => {
    soundEnabled = true;
    $('#enableSound').textContent = 'Sonido activo';
    speak('Sonido activado.');
  });

  updateTvClock();
  await loadTvData();
  setupPlaylist();
  tvTimer = setInterval(() => { updateTvClock(); loadTvData(); }, Number(appConfig.tiempo_actualizacion || 3000));
  tvChannel = supabase.channel('turnos-tv').on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, loadTvData).subscribe();
  window.addEventListener('beforeunload', () => {
    clearInterval(tvTimer);
    if (tvChannel) supabase.removeChannel(tvChannel);
  });
}

function updateTvClock(){
  const now = new Date();
  $('#clock') && ($('#clock').textContent = now.toLocaleTimeString('es-CO'));
  $('#currentDate') && ($('#currentDate').textContent = now.toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
}

async function loadTvData(){
  const { data: actual } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('fecha', today())
    .eq('estado', 'Llamado')
    .not('hora_llamado', 'is', null)
    .order('hora_llamado', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: listado } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('fecha', today())
    .in('estado', ['En espera', 'Llamado', 'En atención'])
    .order('hora_llamado', { ascending: false, nullsFirst: false })
    .order('hora_generado', { ascending: false })
    .limit(6);

  if (actual) {
    $('#calledTurn').textContent = actual.codigo_turno;
    $('#calledService').textContent = actual.servicios?.nombre_servicio || 'Servicio';
    $('#calledPoint').textContent = actual.puntos_atencion?.nombre_punto || 'Punto pendiente';
    const key = `${actual.id_turno}-${actual.llamado_version}`;
    if (lastSpokenKey && lastSpokenKey !== key) flashCall();
    if (lastSpokenKey !== key) {
      lastSpokenKey = key;
      speakTurn(actual);
    }
  } else {
    $('#calledTurn').textContent = '---';
    $('#calledService').textContent = 'En espera de llamados';
    $('#calledPoint').textContent = '---';
  }

  const list = $('#lastCallsBody');
  list.innerHTML = (listado || []).map((t, i) => `<article class="tv-last-card"><div class="tv-last-number">${pad(i + 1)}</div><div class="tv-last-info"><div class="tv-last-title">${escapeHtml(t.servicios?.nombre_servicio || '')}</div><div class="tv-last-code">${escapeHtml(t.codigo_turno)}</div><div class="tv-last-point">${escapeHtml(t.puntos_atencion?.nombre_punto || (t.estado === 'En espera' ? 'En espera' : '-'))}</div></div></article>`).join('') || '<article class="tv-last-card empty">Sin turnos</article>';
}

function flashCall(){
  $('#calledCard')?.classList.add('flash');
  setTimeout(() => $('#calledCard')?.classList.remove('flash'), 1400);
}

function codeToSpeech(code = ''){
  const [pre = '', num = ''] = String(code).split('-');
  const digits = { '0': 'cero', '1': 'uno', '2': 'dos', '3': 'tres', '4': 'cuatro', '5': 'cinco', '6': 'seis', '7': 'siete', '8': 'ocho', '9': 'nueve' };
  return `${pre.split('').join(' ')}, ${num.split('').map(d => digits[d] || d).join(' ')}`;
}

function speak(text){
  if (!soundEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'es-CO';
  utter.rate = .88;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

function speakTurn(t){
  const point = t.puntos_atencion?.nombre_punto || 'punto pendiente';
  speak(`Turno ${codeToSpeech(t.codigo_turno)}. ${t.servicios?.nombre_servicio || ''}. Dirigirse a ${point}.`);
}

function setupPlaylist(){
  const items = String(appConfig.videos_pantalla || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const key = JSON.stringify(items);
  if (key === playlistKey) return;
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
    if (/youtu\.be\//i.test(url)) return `https://www.youtube.com/embed/${url.split('youtu.be/')[1].split(/[?&]/)[0]}?autoplay=1&mute=1&rel=0`;
    const u = new URL(url);
    const id = u.searchParams.get('v');
    if (/youtube\.com$/i.test(u.hostname) || /www\.youtube\.com$/i.test(u.hostname)) return `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&rel=0`;
  } catch (e) {}
  return '';
}

function playVideo(i){
  const video = $('#tvVideoPlayer'), frame = $('#tvVideoFrame'), ph = $('#tvVideoPlaceholder');
  if (!video) return;
  if (!playlist.length) {
    ph.classList.remove('hidden');
    video.classList.add('hidden');
    frame.classList.add('hidden');
    return;
  }
  currentVideoIndex = i % playlist.length;
  const item = playlist[currentVideoIndex], yt = youtubeEmbed(item);
  ph.classList.add('hidden');
  if (yt) {
    video.classList.add('hidden');
    frame.classList.remove('hidden');
    frame.src = yt;
    setTimeout(() => playVideo(currentVideoIndex + 1), 45000);
    return;
  }
  frame.classList.add('hidden');
  frame.src = '';
  video.classList.remove('hidden');
  video.src = assetUrl(item);
  video.load();
  video.play().catch(() => {});
  video.onended = () => playlist.length > 1 && playVideo(currentVideoIndex + 1);
}
