import { advisorPage } from './layout.js';
import { $, $$, supabase, currentProfile, loadProfile, today, fmtTime, escapeHtml } from './core.js';

let advisorTimer = null;
let historyPage = 1;
const historyPageSize = 5;

advisorPage('asesor', renderAdvisor);

async function renderAdvisor(c){
  c.innerHTML = `
    <section class="advisor-shell">
      <header class="advisor-hero">
        <div class="advisor-title-block">
          <div class="advisor-icon" aria-hidden="true">👥</div>
          <div>
            <h1>Panel Asesor</h1>
            <p>Gestión del llamado, atención y cierre de turnos del Consultorio Jurídico.</p>
          </div>
        </div>
        <div class="advisor-meta" aria-label="Información del día">
          <span id="advisorDate">${escapeHtml(formatDateLong(new Date()))}</span>
          <span id="advisorClock">${escapeHtml(formatClock(new Date()))}</span>
        </div>
      </header>
      <div id="advisorContent"></div>
    </section>`;

  updateClock();
  await loadAdvisor();
  advisorTimer = setInterval(loadAdvisor, 3000);
  window.addEventListener('beforeunload', () => clearInterval(advisorTimer));
}

function updateClock(){
  const tick = () => {
    const d = new Date();
    const clock = $('#advisorClock');
    const date = $('#advisorDate');
    if (clock) clock.textContent = formatClock(d);
    if (date) date.textContent = formatDateLong(d);
  };
  tick();
  setInterval(tick, 30000);
}

function formatClock(d){
  return d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLong(d){
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function advisorServiceIds(){
  if (currentProfile?.rol === 'Administrador') {
    const { data } = await supabase.from('servicios').select('id_servicio').eq('estado', 'Activo');
    return (data || []).map(x => x.id_servicio);
  }
  const { data } = await supabase
    .from('usuario_servicio')
    .select('id_servicio')
    .eq('id_usuario', currentProfile.id_usuario);
  return (data || []).map(x => x.id_servicio);
}

async function loadAdvisor(){
  await loadProfile(true);
  const box = $('#advisorContent');
  if (!box) return;

  if (!currentProfile?.id_punto_atencion) {
    box.innerHTML = `<div class="advisor-alert danger">Este asesor no tiene punto de atención asignado. Así se evita que el sistema muestre “Punto pendiente”.</div>`;
    return;
  }

  const serviceIds = await advisorServiceIds();
  if (!serviceIds.length) {
    box.innerHTML = `<div class="advisor-alert danger">Este asesor no tiene servicios asignados.</div>`;
    return;
  }

  const { data: active } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo), puntos_atencion(nombre_punto)')
    .eq('id_usuario_asesor', currentProfile.id_usuario)
    .in('estado', ['Llamado', 'En atención'])
    .order('hora_llamado', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: pending } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo)')
    .eq('fecha', today())
    .in('estado', ['En espera', 'Transferido'])
    .in('id_servicio', serviceIds)
    .order('prioridad', { ascending: false })
    .order('hora_generado', { ascending: true })
    .limit(50);

  const { data: history } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo)')
    .eq('fecha', today())
    .eq('id_usuario_asesor', currentProfile.id_usuario)
    .in('estado', ['Atendido', 'Ausente'])
    .order('hora_fin_atencion', { ascending: false })
    .limit(100);

  const safeHistory = history || [];
  const totalPages = Math.max(1, Math.ceil(safeHistory.length / historyPageSize));
  if (historyPage > totalPages) historyPage = totalPages;
  const historySlice = safeHistory.slice((historyPage - 1) * historyPageSize, historyPage * historyPageSize);

  box.innerHTML = `
    <section class="advisor-grid-top">
      <article class="advisor-card current-card">
        <div class="advisor-card-title">
          <span class="title-mark green"></span>
          <span>Turno actual</span>
          <span class="module-pill">${escapeHtml(currentProfile.puntos_atencion?.nombre_punto || 'Sin punto')}</span>
        </div>
        ${renderCurrentTurn(active)}
      </article>

      <article class="advisor-card actions-card">
        <div class="advisor-card-title">
          <span class="title-mark blue"></span>
          <span>Acciones</span>
          <small>Seleccione la acción correspondiente</small>
        </div>
        <div class="advisor-actions">
          <button class="advisor-action primary" id="btnCallNext" ${active ? 'disabled' : ''}>
            <span class="action-icon">▶</span><span>Llamar<br>siguiente</span>
          </button>
          <button class="advisor-action warning" id="btnRepeat" ${!active ? 'disabled' : ''}>
            <span class="action-icon">↻</span><span>Repetir<br>llamado</span>
          </button>
          <button class="advisor-action success" id="btnStart" ${!active || active.estado !== 'Llamado' ? 'disabled' : ''}>
            <span class="action-icon">👤</span><span>Usuario<br>presente</span>
          </button>
          <button class="advisor-action finish" id="btnFinish" ${!active ? 'disabled' : ''}>
            <span class="action-icon">✓</span><span>Finalizar</span>
          </button>
          <button class="advisor-action danger" id="btnAbsent" ${!active ? 'disabled' : ''}>
            <span class="action-icon">×</span><span>Ausente</span>
          </button>
        </div>
      </article>
    </section>

    <section class="advisor-card table-card">
      <div class="advisor-card-title table-title">
        <div><span class="title-mark blue"></span><span>Turnos pendientes</span></div>
        <span class="count-pill">${pending?.length || 0} turnos en espera</span>
      </div>
      <div class="advisor-table-wrap">
        <table class="advisor-table">
          <thead><tr><th>#</th><th>Turno</th><th>Servicio</th><th>Hora</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>${renderPendingRows(pending || [], active)}</tbody>
        </table>
      </div>
    </section>

    <section class="advisor-card table-card">
      <div class="advisor-card-title table-title">
        <div><span class="title-mark green"></span><span>Historial del día</span></div>
        <span class="count-pill">${safeHistory.length} turnos atendidos</span>
      </div>
      <div class="advisor-table-wrap history-wrap">
        <table class="advisor-table">
          <thead><tr><th>#</th><th>Turno</th><th>Servicio</th><th>Hora llamado</th><th>Hora fin</th><th>Estado</th></tr></thead>
          <tbody>${renderHistoryRows(historySlice)}</tbody>
        </table>
      </div>
      ${renderPaginator(safeHistory.length, totalPages)}
    </section>`;

  $('#btnCallNext')?.addEventListener('click', () => callNext(pending?.[0]?.id_turno));
  $('#btnRepeat')?.addEventListener('click', () => repeatCall(active?.id_turno, active?.llamado_version || 0));
  $('#btnStart')?.addEventListener('click', () => startAttention(active?.id_turno));
  $('#btnFinish')?.addEventListener('click', () => closeTurn(active?.id_turno, 'Atendido'));
  $('#btnAbsent')?.addEventListener('click', () => closeTurn(active?.id_turno, 'Ausente'));
  $$('[data-call]').forEach(b => b.addEventListener('click', () => callNext(Number(b.dataset.call))));
  $$('[data-history-page]').forEach(b => b.addEventListener('click', () => {
    historyPage = Number(b.dataset.historyPage);
    loadAdvisor();
  }));
}

function renderCurrentTurn(t){
  if (!t) {
    return `
      <div class="current-empty">
        <div class="empty-ticket">—</div>
        <div>
          <strong>No hay turno activo.</strong>
          <p>Cuando llame un turno, aparecerá aquí con su servicio y módulo.</p>
        </div>
      </div>`;
  }

  return `
    <div class="current-turn-box">
      <div class="current-item ticket-icon">🎟️</div>
      <div class="current-info-block">
        <small>Turno</small>
        <strong>${escapeHtml(t.codigo_turno)}</strong>
      </div>
      <div class="current-info-block">
        <small>Servicio</small>
        <strong>${escapeHtml(t.servicios?.nombre_servicio || '')}</strong>
      </div>
      <div class="current-info-block">
        <small>Módulo</small>
        <strong>${escapeHtml(t.puntos_atencion?.nombre_punto || currentProfile.puntos_atencion?.nombre_punto || '')}</strong>
      </div>
      <div class="current-state ${t.estado === 'En atención' ? 'attending' : 'called'}">${escapeHtml(t.estado)}</div>
    </div>
    <div class="advisor-note">Turno activo. Use las acciones para repetir, iniciar atención, finalizar o marcar ausente.</div>`;
}

function renderPendingRows(rows, active){
  if (!rows.length) return `<tr><td colspan="6" class="empty-row">No hay turnos pendientes.</td></tr>`;
  return rows.map((t, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong class="turn-code">${escapeHtml(t.codigo_turno)}</strong>${Number(t.prioridad || 0) > 0 ? '<span class="priority-dot">Prioritario</span>' : ''}</td>
      <td>${escapeHtml(t.servicios?.nombre_servicio || '')}</td>
      <td>${fmtTime(t.hora_generado)}</td>
      <td><span class="status-pill wait">${escapeHtml(t.estado || 'En espera')}</span></td>
      <td><button class="mini-call" data-call="${t.id_turno}" ${active ? 'disabled' : ''}>▶ Llamar</button></td>
    </tr>`).join('');
}

function renderHistoryRows(rows){
  if (!rows.length) return `<tr><td colspan="6" class="empty-row">Sin historial para mostrar.</td></tr>`;
  const start = (historyPage - 1) * historyPageSize;
  return rows.map((t, index) => `
    <tr>
      <td>${start + index + 1}</td>
      <td><strong class="turn-code">${escapeHtml(t.codigo_turno)}</strong></td>
      <td>${escapeHtml(t.servicios?.nombre_servicio || '')}</td>
      <td>${fmtTime(t.hora_llamado)}</td>
      <td>${fmtTime(t.hora_fin_atencion)}</td>
      <td><span class="status-pill ${t.estado === 'Ausente' ? 'absent' : 'done'}">${escapeHtml(t.estado)}</span></td>
    </tr>`).join('');
}

function renderPaginator(total, totalPages){
  if (total <= historyPageSize) {
    return `<div class="history-footer"><span>Mostrando ${total ? `1 - ${total}` : '0'} de ${total} turnos</span></div>`;
  }

  const start = (historyPage - 1) * historyPageSize + 1;
  const end = Math.min(total, historyPage * historyPageSize);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .map(p => `<button class="pager-btn ${p === historyPage ? 'active' : ''}" data-history-page="${p}">${p}</button>`)
    .join('');

  return `
    <div class="history-footer">
      <span>Mostrando ${start} - ${end} de ${total} turnos</span>
      <div class="advisor-pager">
        <button class="pager-btn" data-history-page="${Math.max(1, historyPage - 1)}" ${historyPage === 1 ? 'disabled' : ''}>‹</button>
        ${pages}
        <button class="pager-btn" data-history-page="${Math.min(totalPages, historyPage + 1)}" ${historyPage === totalPages ? 'disabled' : ''}>›</button>
      </div>
    </div>`;
}

async function callNext(idTurno){
  if (!idTurno) return alert('No hay turnos pendientes.');
  const { data: active } = await supabase
    .from('turnos')
    .select('id_turno')
    .eq('id_usuario_asesor', currentProfile.id_usuario)
    .in('estado', ['Llamado', 'En atención'])
    .limit(1);
  if (active?.length) return alert('Tiene un turno activo. Finalícelo o márquelo ausente antes de llamar otro.');

  const now = new Date();
  const { data: turno } = await supabase.from('turnos').select('hora_generado,llamado_version').eq('id_turno', idTurno).single();
  const wait = turno?.hora_generado ? Math.max(0, Math.round((now - new Date(turno.hora_generado)) / 1000)) : 0;
  const { error } = await supabase.from('turnos').update({
    estado: 'Llamado',
    id_usuario_asesor: currentProfile.id_usuario,
    id_punto_atencion: currentProfile.id_punto_atencion,
    hora_llamado: now.toISOString(),
    tiempo_espera: wait,
    llamado_version: (turno?.llamado_version || 0) + 1
  }).eq('id_turno', idTurno);
  if (error) return alert(error.message);
  await loadAdvisor();
}

async function repeatCall(idTurno, version){
  if (!idTurno) return;
  const { error } = await supabase
    .from('turnos')
    .update({ hora_llamado: new Date().toISOString(), llamado_version: version + 1 })
    .eq('id_turno', idTurno);
  if (error) alert(error.message); else await loadAdvisor();
}

async function startAttention(idTurno){
  if (!idTurno) return;
  const { data: turno } = await supabase
    .from('turnos')
    .select('llamado_version')
    .eq('id_turno', idTurno)
    .single();

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('turnos')
    .update({
      estado: 'En atención',
      hora_inicio_atencion: now,
      hora_llamado: now,
      llamado_version: (turno?.llamado_version || 0) + 1
    })
    .eq('id_turno', idTurno);
  if (error) alert(error.message); else await loadAdvisor();
}

async function closeTurn(idTurno, estado){
  if (!idTurno) return;
  const now = new Date();
  const { data: turno } = await supabase.from('turnos').select('hora_inicio_atencion').eq('id_turno', idTurno).single();
  const attention = turno?.hora_inicio_atencion ? Math.max(0, Math.round((now - new Date(turno.hora_inicio_atencion)) / 1000)) : 0;
  const { error } = await supabase
    .from('turnos')
    .update({ estado, hora_fin_atencion: now.toISOString(), tiempo_atencion: attention })
    .eq('id_turno', idTurno);
  if (error) alert(error.message); else await loadAdvisor();
}
