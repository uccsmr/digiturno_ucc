import { $, $$, appRoot, initSupabase, loadConfig, appConfig, supabase, escapeHtml } from './core.js';

(async () => {
  const ok = await initSupabase();
  if (!ok) return;
  await renderKiosk();
})();

async function renderKiosk(){
  await loadConfig();
  const { data: services, error } = await supabase
    .from('servicios')
    .select('*')
    .eq('estado', 'Activo')
    .order('prioridad')
    .order('nombre_servicio');

  if (error) {
    appRoot().innerHTML = `<main class="login-page"><section class="login-card"><h1>Error</h1><div class="alert alert-danger">${escapeHtml(error.message)}</div></section></main>`;
    return;
  }

  appRoot().innerHTML = `<main class="kiosk-page"><section class="kiosk">
    <header class="kiosk-header">
      <div>
        <img src="${appConfig.logo_pantalla || appConfig.logo || 'assets/img/logo_consultorio_juridico.png'}" alt="Consultorio Jurídico">
        <h1>Solicite su turno</h1>
        <p>Seleccione el servicio que necesita.</p>
      </div>
      <a class="btn btn-outline" href="login.html">Administración</a>
    </header>
    <section class="service-grid">
      ${(services || []).map(s => `<button class="service-button" style="--service-color:${s.color || '#0A84FF'}" data-service="${s.id_servicio}">
        <span class="service-prefix">${escapeHtml(s.prefijo)}</span>
        <strong>${escapeHtml(s.nombre_servicio)}</strong>
        <small>${escapeHtml(s.descripcion || '')}</small>
      </button>`).join('') || '<article class="panel"><h2>Sin servicios activos</h2><p>Configure los servicios desde administración.</p></article>'}
    </section>
  </section></main>`;

  $$('.service-button').forEach(btn => btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const { data, error } = await supabase.rpc('generar_turno', { p_id_servicio: Number(btn.dataset.service) });
      if (error) throw error;
      showTicket(data.codigo_turno, services.find(s => s.id_servicio == btn.dataset.service)?.nombre_servicio || 'Servicio');
    } catch (err) {
      alert(err.message);
    }
    btn.disabled = false;
  }));
}

function showTicket(codigo, servicio){
  const modal = document.createElement('div');
  modal.className = 'ticket-modal';
  modal.innerHTML = `<section class="ticket-card"><h3>Turno generado</h3><h2>${escapeHtml(codigo)}</h2><p>${escapeHtml(servicio)}</p><p class="muted">Tome asiento y esté atento al llamado en pantalla.</p><button class="btn btn-primary" id="closeTicket">Aceptar</button></section>`;
  document.body.appendChild(modal);
  $('#closeTicket', modal).addEventListener('click', () => modal.remove());
  setTimeout(() => modal.remove(), 9000);
}
