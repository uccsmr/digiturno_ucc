import {
  $, appRoot, initSupabase, loadProfile, appConfig, currentProfile, currentSession,
  escapeHtml, signOut, renderNoProfile, renderForbidden, showFatalError
} from './core.js';

const menuItems = [
  { key: 'dashboard', label: 'Inicio', href: 'dashboard.html', roles: ['Administrador'] },
  { key: 'asesor', label: 'Panel Asesor', href: 'asesor.html', roles: ['Administrador', 'Asesor'] },
  { key: 'servicios', label: 'Servicios', href: 'servicios.html', roles: ['Administrador'] },
  { key: 'puntos', label: 'Puntos de atención', href: 'puntos-atencion.html', roles: ['Administrador'] },
  { key: 'usuarios', label: 'Usuarios', href: 'usuarios.html', roles: ['Administrador'] },
  { key: 'reportes', label: 'Reportes', href: 'reportes.html', roles: ['Administrador'] },
  { key: 'configuracion', label: 'Configuración', href: 'configuracion.html', roles: ['Administrador'] }
];

export async function renderProtectedPage({ active, allowedRoles = ['Administrador'], render }){
  try {
    const ok = await initSupabase();
    if (!ok) return;

    if (!currentSession) {
      window.location.href = 'login.html';
      return;
    }

    const profile = await loadProfile();
    if (!profile) return renderNoProfile();

    if (allowedRoles.length && !allowedRoles.includes(profile.rol)) {
      return renderForbidden('Su rol no tiene acceso a esta página.');
    }

    appRoot().innerHTML = `<div class="app-layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-logo"><img src="${appConfig?.logo || 'assets/img/logo_ucc_horizontal.png'}" alt="UCC"></div>
          <div><strong>Digiturno Jurídico</strong><small>${escapeHtml(profile.rol)}</small></div>
        </div>
        <nav>
          ${menuItems
            .filter(item => item.roles.includes(profile.rol))
            .map(item => `<a href="${item.href}" data-nav="${item.key}" class="${item.key === active ? 'active' : ''}">${item.label}</a>`)
            .join('')}
          <a href="kiosco.html" target="_blank" rel="noopener">Abrir Kiosco</a>
          <a href="pantalla.html" target="_blank" rel="noopener">Abrir Pantalla TV</a>
        </nav>
        <div class="sidebar-footer">
          <span>${escapeHtml(profile.nombre || profile.email || '')}</span>
          <button class="btn btn-danger btn-small" id="logoutBtn">Cerrar sesión</button>
        </div>
      </aside>
      <main class="content" id="content"></main>
    </div>`;

    $('#logoutBtn')?.addEventListener('click', signOut);
    await render($('#content'));
  } catch (error) {
    showFatalError(error, 'No fue posible cargar la página');
  }
}

export function adminOnly(active, render){
  return renderProtectedPage({ active, allowedRoles: ['Administrador'], render });
}

export function advisorPage(active, render){
  return renderProtectedPage({ active, allowedRoles: ['Administrador', 'Asesor'], render });
}
