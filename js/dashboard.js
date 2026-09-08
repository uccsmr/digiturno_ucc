import { adminOnly } from './layout.js';
import { supabase, today, escapeHtml } from './core.js';

adminOnly('dashboard', renderDashboard);

async function renderDashboard(c){
  const { data: turns } = await supabase
    .from('turnos')
    .select('estado,id_turno')
    .eq('fecha', today());

  const total = turns?.length || 0;
  const espera = turns?.filter(t => t.estado === 'En espera').length || 0;
  const llamados = turns?.filter(t => t.estado === 'Llamado').length || 0;
  const atendidos = turns?.filter(t => t.estado === 'Atendido').length || 0;

  c.innerHTML = `<div class="topbar"><div><h1>Inicio</h1><p>Panel principal del Digiturno Jurídico.</p></div></div>
  <section class="grid stats-grid">
    <article class="stat-card"><span>Turnos hoy</span><strong>${total}</strong></article>
    <article class="stat-card"><span>En espera</span><strong>${espera}</strong></article>
    <article class="stat-card"><span>Llamados</span><strong>${llamados}</strong></article>
    <article class="stat-card"><span>Atendidos</span><strong>${atendidos}</strong></article>
  </section>
  <section class="grid two-columns">
    <article class="panel"><h2>Descripción institucional</h2><p>Sistema web del Consultorio Jurídico y Centro de Conciliación para gestionar turnos, asesores, pantalla TV y reportes en tiempo real.</p></article>
    <article class="panel"><h2>Accesos rápidos</h2><div class="action-row"><a class="btn btn-primary" href="kiosco.html">Kiosco</a><a class="btn btn-secondary" href="pantalla.html">Pantalla TV</a><a class="btn btn-outline" href="asesor.html">Panel Asesor</a></div></article>
  </section>`;
}
