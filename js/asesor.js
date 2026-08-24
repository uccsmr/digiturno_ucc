import { advisorPage } from './layout.js';
import { $, $$, supabase, currentProfile, loadProfile, today, fmtTime, escapeHtml } from './core.js';

let advisorTimer = null;
advisorPage('asesor', renderAdvisor);

async function renderAdvisor(c){
  c.innerHTML = `<div class="topbar"><div><h1>Panel Asesor</h1><p>Gestión del llamado, atención y cierre de turnos.</p></div></div><div id="advisorContent"></div>`;
  await loadAdvisor();
  advisorTimer = setInterval(loadAdvisor, 3000);
  window.addEventListener('beforeunload', () => clearInterval(advisorTimer));
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
    box.innerHTML = `<div class="alert alert-danger">Este asesor no tiene punto de atención asignado. Así se evita que el sistema muestre “Punto pendiente”.</div>`;
    return;
  }

  const serviceIds = await advisorServiceIds();
  if (!serviceIds.length) {
    box.innerHTML = `<div class="alert alert-danger">Este asesor no tiene servicios asignados.</div>`;
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
    .limit(20);

  const { data: history } = await supabase
    .from('turnos')
    .select('*, servicios(nombre_servicio,prefijo)')
    .eq('fecha', today())
    .eq('id_usuario_asesor', currentProfile.id_usuario)
    .in('estado', ['Atendido', 'Ausente'])
    .order('hora_fin_atencion', { ascending: false })
    .limit(8);

  box.innerHTML = `<section class="grid two-columns">
    <article class="panel"><div class="panel-header"><h2>Turno actual</h2><span class="badge">${escapeHtml(currentProfile.puntos_atencion?.nombre_punto || 'Sin punto')}</span></div>${renderCurrentTurn(active)}</article>
    <article class="panel"><h2>Acciones</h2><div class="action-row">
      <button class="btn btn-primary" id="btnCallNext" ${active ? 'disabled' : ''}>Llamar siguiente</button>
      <button class="btn btn-warning" id="btnRepeat" ${!active ? 'disabled' : ''}>Repetir llamado</button>
      <button class="btn btn-secondary" id="btnStart" ${!active || active.estado !== 'Llamado' ? 'disabled' : ''}>Usuario presente</button>
      <button class="btn btn-primary" id="btnFinish" ${!active ? 'disabled' : ''}>Finalizar</button>
      <button class="btn btn-danger" id="btnAbsent" ${!active ? 'disabled' : ''}>Ausente</button>
    </div><p class="muted">Mientras tenga un turno llamado o en atención, finalícelo o márquelo ausente antes de llamar el siguiente.</p></article>
  </section>
  <section class="panel"><div class="panel-header"><h2>Turnos pendientes</h2><span class="badge">${pending?.length || 0}</span></div><div class="table-responsive"><table><thead><tr><th>Turno</th><th>Servicio</th><th>Hora</th><th>Acción</th></tr></thead><tbody>${(pending || []).map(t => `<tr><td><b>${escapeHtml(t.codigo_turno)}</b></td><td>${escapeHtml(t.servicios?.nombre_servicio || '')}</td><td>${fmtTime(t.hora_generado)}</td><td><button class="btn btn-small btn-primary" data-call="${t.id_turno}" ${active ? 'disabled' : ''}>Llamar</button></td></tr>`).join('') || '<tr><td colspan="4">No hay turnos pendientes.</td></tr>'}</tbody></table></div></section>
  <section class="panel"><h2>Historial del día</h2><div class="table-responsive"><table><thead><tr><th>Turno</th><th>Servicio</th><th>Estado</th><th>Fin</th></tr></thead><tbody>${(history || []).map(t => `<tr><td><b>${escapeHtml(t.codigo_turno)}</b></td><td>${escapeHtml(t.servicios?.nombre_servicio || '')}</td><td><span class="badge">${escapeHtml(t.estado)}</span></td><td>${fmtTime(t.hora_fin_atencion)}</td></tr>`).join('') || '<tr><td colspan="4">Sin historial.</td></tr>'}</tbody></table></div></section>`;

  $('#btnCallNext')?.addEventListener('click', () => callNext(pending?.[0]?.id_turno));
  $('#btnRepeat')?.addEventListener('click', () => repeatCall(active?.id_turno, active?.llamado_version || 0));
  $('#btnStart')?.addEventListener('click', () => startAttention(active?.id_turno));
  $('#btnFinish')?.addEventListener('click', () => closeTurn(active?.id_turno, 'Atendido'));
  $('#btnAbsent')?.addEventListener('click', () => closeTurn(active?.id_turno, 'Ausente'));
  $$('[data-call]').forEach(b => b.addEventListener('click', () => callNext(Number(b.dataset.call))));
}

function renderCurrentTurn(t){
  if (!t) return `<div class="alert alert-info">No hay turno activo.</div>`;
  return `<div style="font-size:52px;font-weight:950;color:#0A84FF">${escapeHtml(t.codigo_turno)}</div><p><b>${escapeHtml(t.servicios?.nombre_servicio || '')}</b></p><p>Estado: <span class="badge">${escapeHtml(t.estado)}</span></p><p>Punto: <b>${escapeHtml(t.puntos_atencion?.nombre_punto || currentProfile.puntos_atencion?.nombre_punto || '')}</b></p>`;
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
  const { error } = await supabase
    .from('turnos')
    .update({ estado: 'En atención', hora_inicio_atencion: new Date().toISOString() })
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
