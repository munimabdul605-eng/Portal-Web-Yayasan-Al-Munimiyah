/**
 * Autentikasi, Manajemen Sesi (sessionStorage), Tema Terang/Gelap,
 * Indikator Progress Gulir Header, Cek Status Backend, dan Modal Arsip Dokumen Drive
 */
(function (root) {
  'use strict';

  const CONFIG = root.MDTA_CONFIG;
  const API = root.MDTA_API;
  const UI = root.MDTA_UI;

  let currentSession = null;
  const arsipState = {
    items: [],
    query: '',
    category: 'Semua',
  };

  // =========================================================================
  // TEMA TERANG / GELAP
  // =========================================================================
  function syncThemeUI() {
    const isDark = document.documentElement.classList.contains('dark');
    const btn = document.getElementById('btn-theme-toggle');
    const label = document.getElementById('theme-toggle-label');
    const iconHolder = document.getElementById('theme-toggle-icon-wrap');

    if (iconHolder) {
      iconHolder.innerHTML = `<i data-lucide="${isDark ? 'sun' : 'moon'}" aria-hidden="true"></i>`;
      UI.refreshIcons(iconHolder);
    }
    if (label) {
      label.textContent = isDark ? 'Terang' : 'Gelap';
    }
    if (btn) {
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('aria-label', isDark ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
    }
  }

  let themeIconTimer = null;
  function initTheme() {
    syncThemeUI();
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const nextDark = !document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', nextDark);
      document.documentElement.classList.toggle('light', !nextDark);
      try {
        localStorage.setItem(CONFIG.THEME_KEY, nextDark ? 'dark' : 'light');
      } catch (err) {
        // Abaikan pembatasan penyimpanan lokal
      }
      syncThemeUI();
      if (UI && typeof UI.canUseMotion === 'function' && UI.canUseMotion()) {
        const iconHolder = document.getElementById('theme-toggle-icon-wrap');
        if (iconHolder) {
          if (themeIconTimer) clearTimeout(themeIconTimer);
          iconHolder.classList.remove('is-theme-pop');
          void iconHolder.offsetWidth;
          iconHolder.classList.add('is-theme-pop');
          themeIconTimer = setTimeout(() => {
            themeIconTimer = null;
            iconHolder.classList.remove('is-theme-pop');
          }, 420);
        }
      }
    });
  }

  // =========================================================================
  // INDIKATOR PROGRESS BAR GULIR DI ATAS HEADER
  // =========================================================================
  function initScrollProgress() {
    const bar = document.getElementById('scroll-progress-bar');
    if (!bar) return;

    let ticking = false;
    function updateBar() {
      ticking = false;
      const doc = document.documentElement;
      const maxScroll = Math.max(0, doc.scrollHeight - doc.clientHeight);
      const ratio = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
      bar.style.transform = `scaleX(${ratio})`;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(updateBar);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateBar();
  }

  // =========================================================================
  // CEK KONEKSI BACKEND GOOGLE APPS SCRIPT (?action=ping)
  // =========================================================================
  async function checkBackendHealth() {
    const banner = document.getElementById('api-status-banner');
    const textEl = document.getElementById('api-status-text');
    const iconEl = document.getElementById('api-status-icon');
    const retryBtn = document.getElementById('btn-recheck-api');
    if (!banner || !textEl) return;

    banner.hidden = false;
    banner.className = 'inline-alert inline-alert-info';
    if (iconEl) iconEl.innerHTML = '<i data-lucide="loader-2" class="spin-icon" aria-hidden="true" style="width:17px;height:17px;"></i>';
    textEl.textContent = 'Memeriksa koneksi Web App Google Apps Script...';
    UI.refreshIcons(banner);
    if (retryBtn) retryBtn.hidden = true;

    try {
      const res = await API.ping();
      banner.className = 'inline-alert inline-alert-success';
      if (iconEl) iconEl.innerHTML = '<i data-lucide="check-circle-2" aria-hidden="true" style="width:17px;height:17px;"></i>';
      textEl.textContent = res.message || 'API Sistem MDTA aktif dan siap digunakan.';
      if (retryBtn) retryBtn.hidden = true;
      UI.refreshIcons(banner);
    } catch (err) {
      banner.className = 'inline-alert inline-alert-warn';
      if (iconEl) iconEl.innerHTML = '<i data-lucide="alert-triangle" aria-hidden="true" style="width:17px;height:17px;"></i>';
      textEl.textContent = err.message;
      if (retryBtn) retryBtn.hidden = false;
      UI.refreshIcons(banner);
    }
  }

  // =========================================================================
  // ARSIP DOKUMEN GOOGLE DRIVE (GET getDokumenArsip)
  // =========================================================================
  function renderArsipList() {
    const container = document.getElementById('arsip-drive-list');
    if (!container) return;

    const q = arsipState.query.trim().toLowerCase();
    const cat = arsipState.category;

    const filtered = arsipState.items.filter((item) => {
      const matchCat =
        cat === 'Semua' || item.kategori.toLowerCase() === cat.toLowerCase();
      const matchQuery =
        !q ||
        item.judul.toLowerCase().includes(q) ||
        item.kategori.toLowerCase().includes(q) ||
        item.diunggah_oleh.toLowerCase().includes(q);
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: q || cat !== 'Semua' ? 'Dokumen tidak ditemukan' : 'Arsip dokumen masih kosong',
        message:
          q || cat !== 'Semua'
            ? 'Tidak ada dokumen atau folder arsip yang cocok dengan filter saat ini.'
            : 'Belum ada entri pada sheet Dokumen_Arsip.',
      });
      UI.refreshIcons(container);
      return;
    }

    container.innerHTML = filtered
      .map((item) => {
        const iconName = item.isFolder
          ? 'folder'
          : item.kategori.toLowerCase().includes('pdf')
            ? 'file-text'
            : item.kategori.toLowerCase().includes('ai')
              ? 'scan-text'
              : 'file';

        const metaParts = [item.kategori];
        if (item.diunggah_oleh && item.diunggah_oleh !== '-') metaParts.push(`Oleh ${item.diunggah_oleh}`);
        if (item.tanggal_upload && item.tanggal_upload !== '-') metaParts.push(item.tanggal_upload);

        return `
          <div class="drive-item">
            <div class="drive-item-meta">
              <div class="stat-icon-pill status-izin" style="flex-shrink:0;">
                <i data-lucide="${iconName}" aria-hidden="true" style="width:17px;height:17px;"></i>
              </div>
              <div style="min-width:0;">
                <div class="drive-item-title">${UI.esc(item.judul)}</div>
                <div class="text-muted" style="font-size:0.78rem;">${UI.esc(metaParts.join(' · '))}</div>
              </div>
            </div>
            ${item.drive_url
            ? `<a href="${UI.esc(item.drive_url)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
                     <i data-lucide="external-link" aria-hidden="true"></i>
                     <span>${item.isFolder ? 'Buka Folder' : 'Buka Berkas'}</span>
                   </a>`
            : `<span class="text-muted" style="font-size:0.78rem;">Tautan kosong</span>`
          }
          </div>
        `;
      })
      .join('');

    UI.refreshIcons(container);
  }

  function isAdminSession(session) {
    return Boolean(session && String(session.role || '').trim().toLowerCase() === 'admin');
  }

  async function loadDokumenArsip(opts) {
    if (!isAdminSession(currentSession || getSession())) {
      UI.closeModal('modal-arsip-drive');
      UI.toast('Arsip Dokumen Drive hanya tersedia pada halaman Administrator.', 'warn');
      return;
    }
    const force = Boolean(opts && opts.force);
    const STATE = root.MDTA_STATE;
    const CACHE = root.MDTA_CACHE;
    const container = document.getElementById('arsip-drive-list');
    const folderLink = document.getElementById('arsip-drive-root-link');
    if (folderLink) {
      folderLink.href = CONFIG.DRIVE_ROOT_URL;
      folderLink.hidden = false;
    }
    if (!container) return;

    if (STATE && STATE.dokumenArsip.length === 0 && CACHE) {
      const cached = CACHE.read('dokumenArsip');
      if (cached && Array.isArray(cached.data)) STATE.dokumenArsip = cached.data;
    }

    const cachedItems = STATE && Array.isArray(STATE.dokumenArsip) ? STATE.dokumenArsip : [];
    if (cachedItems.length > 0) {
      arsipState.items = cachedItems.slice();
      renderArsipList();
    } else {
      container.innerHTML = UI.renderStateBox({
        type: 'loading',
        title: 'Memuat Arsip Dokumen Drive',
        message: 'Mengambil indeks dokumen dan folder dari Google Sheets Dokumen_Arsip...',
      });
      UI.refreshIcons(container);
    }

    if (!force && STATE && STATE.loaded && STATE.loaded.arsip && cachedItems.length > 0) {
      // Tetap sinkron diam-diam saat modal dibuka; tanpa spinner pemblokir
      API.getDokumenArsip()
        .then((res) => {
          const freshItems = API.extractArray(res, ['dokumen', 'arsip', 'files', 'folders']).map(API.normalizeDokumen);
          const changed = !CACHE || CACHE.hasChanged(arsipState.items, freshItems);
          if (STATE) {
            STATE.dokumenArsip = freshItems;
            if (STATE.loaded) STATE.loaded.arsip = true;
          }
          if (CACHE) CACHE.write('dokumenArsip', freshItems);
          if (changed) {
            arsipState.items = freshItems;
            renderArsipList();
          }
        })
        .catch(() => { });
      return;
    }

    try {
      const res = await API.getDokumenArsip();
      const rawItems = API.extractArray(res, ['dokumen', 'arsip', 'files', 'folders']);
      const freshItems = rawItems.map(API.normalizeDokumen);
      const changed = !CACHE || CACHE.hasChanged(arsipState.items, freshItems);
      if (STATE) {
        STATE.dokumenArsip = freshItems;
        if (STATE.loaded) STATE.loaded.arsip = true;
      }
      if (CACHE) CACHE.write('dokumenArsip', freshItems);
      if (changed || arsipState.items.length === 0) {
        arsipState.items = freshItems;
        renderArsipList();
      }
    } catch (err) {
      if (arsipState.items.length === 0) {
        container.innerHTML = UI.renderStateBox({
          type: 'error',
          title: 'Gagal Memuat Arsip Drive',
          message: err.message,
          actionLabel: 'Coba Lagi',
          actionId: 'btn-retry-arsip',
        });
        UI.refreshIcons(container);
        const retryBtn = document.getElementById('btn-retry-arsip');
        if (retryBtn) {
          retryBtn.addEventListener('click', () => loadDokumenArsip({ force: true }));
        }
      } else if (force) {
        UI.toast(err.message, 'error');
      }
    }
  }

  function initArsipModal() {
    const openBtn = document.getElementById('btn-arsip-drive');
    const closeBtn = document.getElementById('btn-close-arsip-modal');
    const refreshBtn = document.getElementById('btn-refresh-arsip');
    const searchInput = document.getElementById('arsip-search-input');
    const filterGroup = document.getElementById('arsip-category-filters');

    if (openBtn) {
      openBtn.addEventListener('click', () => {
        if (!isAdminSession(currentSession || getSession())) {
          UI.closeModal('modal-arsip-drive');
          UI.toast('Arsip Dokumen Drive hanya tersedia pada halaman Administrator.', 'warn');
          return;
        }
        arsipState.query = '';
        arsipState.category = 'Semua';
        if (searchInput) searchInput.value = '';
        if (filterGroup) {
          filterGroup.querySelectorAll('.filter-chip').forEach((c) => {
            c.setAttribute('aria-pressed', c.dataset.arsipCat === 'Semua' ? 'true' : 'false');
          });
        }
        UI.openModal('modal-arsip-drive');
        loadDokumenArsip({ force: false });
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => UI.closeModal('modal-arsip-drive'));
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadDokumenArsip({ force: true }));
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        arsipState.query = e.target.value || '';
        renderArsipList();
      });
    }

    if (filterGroup) {
      filterGroup.querySelectorAll('.filter-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          arsipState.category = chip.dataset.arsipCat || 'Semua';
          filterGroup.querySelectorAll('.filter-chip').forEach((c) => {
            c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
          });
          renderArsipList();
        });
      });
    }
  }

  // =========================================================================
  // SESI PERSISTEN (localStorage 7 HARI + SLIDING EXPIRATION) & ROUTING PORTAL
  // =========================================================================
  function getSessionTTLMs() {
    return Number(CONFIG.SESSION_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
  }

  function readStoredSession() {
    try {
      if (!root.localStorage) return { session: null, expired: false };
      const raw = root.localStorage.getItem(CONFIG.SESSION_KEY);
      if (!raw) return { session: null, expired: false };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        clearSession();
        return { session: null, expired: false };
      }
      if (parsed.expiresAt && Date.now() >= Number(parsed.expiresAt)) {
        clearSession();
        return { session: null, expired: true };
      }
      const userObj = parsed.user && typeof parsed.user === 'object' ? parsed.user : parsed;
      if (!userObj || !userObj.role) {
        clearSession();
        return { session: null, expired: false };
      }
      if (parsed.token && !userObj.token) userObj.token = parsed.token;
      return { session: userObj, expired: false };
    } catch (err) {
      return { session: null, expired: false };
    }
  }

  function getSession() {
    return readStoredSession().session;
  }

  function saveSession(sessionObj) {
    currentSession = sessionObj;
    const envelope = {
      token: (sessionObj && sessionObj.token) || '',
      user: sessionObj,
      expiresAt: Date.now() + getSessionTTLMs(),
    };
    if (root.localStorage) {
      root.localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(envelope));
    }
  }

  function updateSession(partial) {
    const base = currentSession || getSession();
    if (!base || !partial || typeof partial !== 'object') return base;
    const updated = Object.assign({}, base, partial);
    if (updated.kelas_ampu !== undefined) {
      updated.kelas_ampu = API.parseKelasAmpu(updated.kelas_ampu);
    }
    saveSession(updated);
    updateHeaderAuthUI(updated);
    return updated;
  }

  function renderAvatarSlot(el, nama, fotoUrl) {
    if (!el) return;
    const avatarSize = el.id === 'drawer-user-avatar' ? 44 : 28;
    if (UI && typeof UI.renderAvatarElement === 'function') {
      UI.renderAvatarElement(el, nama, fotoUrl, { size: avatarSize, fallback: 'U' });
      return;
    }
    const cleanName = String(nama || 'U').trim() || 'U';
    const initials = cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'U';
    const rawUrl = String(fotoUrl || '').trim();
    const cleanUrl = rawUrl && typeof API.normalizeDriveImageUrl === 'function'
      ? API.normalizeDriveImageUrl(rawUrl)
      : rawUrl;
    if (cleanUrl) {
      el.innerHTML = `<img src="${UI.esc(cleanUrl)}" alt="Foto profil ${UI.esc(cleanName)}" width="${avatarSize}" height="${avatarSize}" class="avatar-img" referrerpolicy="no-referrer" />`;
      const img = el.querySelector('img');
      if (img) {
        img.addEventListener('error', () => {
          el.textContent = initials;
        });
      }
    } else {
      el.textContent = initials;
    }
  }

  let drawerCloseTimer = null;
  function openNavDrawer() {
    const drawer = document.getElementById('app-nav-drawer');
    const backdrop = document.getElementById('app-drawer-backdrop');
    const btn = document.getElementById('btn-nav-drawer');
    if (!drawer) return;
    if (drawerCloseTimer) {
      clearTimeout(drawerCloseTimer);
      drawerCloseTimer = null;
    }
    drawer.classList.remove('is-closing');
    if (backdrop) backdrop.classList.remove('is-closing');
    drawer.hidden = false;
    if (backdrop) backdrop.hidden = false;
    if (btn) btn.setAttribute('aria-expanded', 'true');
    document.body.classList.add('drawer-open');
  }

  function closeNavDrawer() {
    const drawer = document.getElementById('app-nav-drawer');
    const backdrop = document.getElementById('app-drawer-backdrop');
    const btn = document.getElementById('btn-nav-drawer');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('drawer-open');
    if (UI && typeof UI.canUseMotion === 'function' && UI.canUseMotion() && drawer && !drawer.hidden) {
      if (drawerCloseTimer) return;
      drawer.classList.add('is-closing');
      if (backdrop) backdrop.classList.add('is-closing');
      drawerCloseTimer = setTimeout(() => {
        drawerCloseTimer = null;
        drawer.classList.remove('is-closing');
        if (backdrop) backdrop.classList.remove('is-closing');
        drawer.hidden = true;
        if (backdrop) backdrop.hidden = true;
      }, 200);
      return;
    }
    if (drawer) {
      drawer.classList.remove('is-closing');
      drawer.hidden = true;
    }
    if (backdrop) {
      backdrop.classList.remove('is-closing');
      backdrop.hidden = true;
    }
  }

  function initNavDrawer() {
    const openBtn = document.getElementById('btn-nav-drawer');
    const closeBtn = document.getElementById('btn-close-nav-drawer');
    const backdrop = document.getElementById('app-drawer-backdrop');
    const drawer = document.getElementById('app-nav-drawer');
    const chip = document.getElementById('header-user-chip');
    const uasDrawerBtn = document.getElementById('btn-drawer-admin-uas');
    const raportDrawerBtn = document.getElementById('btn-drawer-admin-raport');

    const toggleDrawer = () => {
      if (drawer && !drawer.hidden) closeNavDrawer();
      else openNavDrawer();
    };

    if (openBtn) openBtn.addEventListener('click', toggleDrawer);
    if (chip) {
      chip.addEventListener('click', () => {
        if (currentSession || getSession()) toggleDrawer();
      });
    }
    if (closeBtn) closeBtn.addEventListener('click', closeNavDrawer);
    if (backdrop) backdrop.addEventListener('click', closeNavDrawer);

    if (uasDrawerBtn) {
      uasDrawerBtn.addEventListener('click', () => {
        closeNavDrawer();
        const target = document.getElementById('btn-open-admin-uas');
        if (target) target.click();
      });
    }
    if (raportDrawerBtn) {
      raportDrawerBtn.addEventListener('click', () => {
        closeNavDrawer();
        const target = document.getElementById('btn-open-admin-raport');
        if (target) target.click();
      });
    }

    if (drawer) {
      drawer.addEventListener('click', (e) => {
        const navItem = e.target && e.target.closest ? e.target.closest('.drawer-nav-item') : null;
        if (navItem && navItem.id !== 'btn-drawer-admin-uas' && navItem.id !== 'btn-drawer-admin-raport') {
          closeNavDrawer();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && !drawer.hidden) {
        closeNavDrawer();
      }
    });
  }

  function clearSession() {
    currentSession = null;
    if (root.localStorage) {
      root.localStorage.removeItem(CONFIG.SESSION_KEY);
    }
    if (root.sessionStorage) {
      root.sessionStorage.removeItem(CONFIG.SESSION_KEY);
      root.sessionStorage.removeItem('mdta_user_session');
    }
    if (root.MDTA_CACHE && typeof root.MDTA_CACHE.clearAll === 'function') {
      root.MDTA_CACHE.clearAll();
    }
  }

  function updateHeaderAuthUI(session) {
    const chip = document.getElementById('header-user-chip');
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const headerAvatar = document.getElementById('header-user-avatar');
    const drawerBtn = document.getElementById('btn-nav-drawer');
    const drawerAdmin = document.getElementById('drawer-menu-admin');
    const drawerGuru = document.getElementById('drawer-menu-guru');
    const drawerAvatar = document.getElementById('drawer-user-avatar');
    const drawerName = document.getElementById('drawer-user-name');
    const drawerRole = document.getElementById('drawer-user-role');
    const drawerKelas = document.getElementById('drawer-user-kelas');
    const logoutBtn = document.getElementById('btn-logout');
    const arsipBtn = document.getElementById('btn-arsip-drive');
    const adminAllowed = isAdminSession(session);

    if (arsipBtn) arsipBtn.hidden = !adminAllowed;
    if (!adminAllowed) {
      UI.closeModal('modal-arsip-drive');
    }

    if (session) {
      const displayName = session.nama_lengkap || session.nama || session.username || 'Pengguna';
      const roleLabel = session.role === 'admin' ? 'Kepala Madrasah / Admin' : 'Guru Pengampu';
      const isAdmin = String(session.role || '').toLowerCase() === 'admin';
      const kelasList = API.parseKelasAmpu(session.kelas_ampu);

      if (drawerBtn) drawerBtn.hidden = false;
      if (chip) chip.hidden = false;
      if (nameEl) nameEl.textContent = displayName;
      if (roleEl) roleEl.textContent = isAdmin ? 'Admin' : 'Guru';
      renderAvatarSlot(headerAvatar, displayName, session.foto_url);
      renderAvatarSlot(drawerAvatar, displayName, session.foto_url);
      if (drawerName) drawerName.textContent = displayName;
      if (drawerRole) drawerRole.textContent = roleLabel;
      if (drawerKelas) {
        if (!isAdmin && kelasList.length > 0) {
          drawerKelas.textContent = kelasList.join(', ');
          drawerKelas.hidden = false;
        } else {
          drawerKelas.textContent = '';
          drawerKelas.hidden = true;
        }
      }
      if (drawerAdmin) drawerAdmin.hidden = !isAdmin;
      if (drawerGuru) drawerGuru.hidden = isAdmin;
      if (logoutBtn) logoutBtn.hidden = false;
    } else {
      closeNavDrawer();
      if (drawerBtn) drawerBtn.hidden = true;
      if (chip) chip.hidden = true;
      if (drawerAdmin) drawerAdmin.hidden = true;
      if (drawerGuru) drawerGuru.hidden = true;
      if (logoutBtn) logoutBtn.hidden = true;
    }
  }

  function routeToPortal(session) {
    const loginView = document.getElementById('view-login');
    const adminView = document.getElementById('view-admin');
    const guruView = document.getElementById('view-guru');

    if (!session) {
      if (root.MDTA_ADMIN && typeof root.MDTA_ADMIN.cleanup === 'function') {
        root.MDTA_ADMIN.cleanup();
      }
      if (root.MDTA_GURU && typeof root.MDTA_GURU.cleanup === 'function') {
        root.MDTA_GURU.cleanup();
      }
      if (loginView) loginView.hidden = false;
      if (adminView) adminView.hidden = true;
      if (guruView) guruView.hidden = true;
      updateHeaderAuthUI(null);
      return;
    }

    const role = String(session.role || '').toLowerCase();
    updateHeaderAuthUI(session);

    if (role === 'admin') {
      if (root.MDTA_GURU && typeof root.MDTA_GURU.cleanup === 'function') {
        root.MDTA_GURU.cleanup();
      }
      if (loginView) loginView.hidden = true;
      if (guruView) guruView.hidden = true;
      if (adminView) adminView.hidden = false;
      if (root.MDTA_ADMIN && typeof root.MDTA_ADMIN.init === 'function') {
        root.MDTA_ADMIN.init(session);
      }
    } else if (role === 'guru') {
      if (root.MDTA_ADMIN && typeof root.MDTA_ADMIN.cleanup === 'function') {
        root.MDTA_ADMIN.cleanup();
      }
      if (loginView) loginView.hidden = true;
      if (adminView) adminView.hidden = true;
      if (guruView) guruView.hidden = false;
      if (root.MDTA_GURU && typeof root.MDTA_GURU.init === 'function') {
        root.MDTA_GURU.init(session);
      }
    } else {
      clearSession();
      routeToPortal(null);
      UI.toast(`Peran akun "${session.role}" tidak dikenali oleh sistem.`, 'error');
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function extractSessionFromLoginResponse(res, fallbackUsername) {
    const dataBlock = (res && res.data) || res || {};
    const userObj = dataBlock.user || dataBlock.profile || dataBlock;
    const rawRole = String(API.pick(userObj, ['role', 'peran', 'level'], dataBlock.role || '')).trim().toLowerCase();
    const role = rawRole === 'admin' || rawRole === 'administrator' ? 'admin' : rawRole === 'guru' ? 'guru' : rawRole;
    if (!role) {
      throw new Error('Respons login tidak menyertakan role pengguna (admin atau guru).');
    }
    const namaLengkap = String(API.pick(userObj, ['nama_lengkap', 'nama', 'name'], fallbackUsername));
    const kelasAmpu = API.parseKelasAmpu(API.pick(userObj, ['kelas_ampu'], []));
    return {
      token: String(API.pick(dataBlock, ['token'], '')),
      id_user: String(API.pick(userObj, ['id_user', 'id'], '')),
      username: String(API.pick(userObj, ['username', 'user'], fallbackUsername)),
      nama_lengkap: namaLengkap,
      nama: namaLengkap,
      role,
      kelas_ampu: role === 'admin' ? [] : kelasAmpu,
      no_wa: String(API.pick(userObj, ['no_wa'], '')).trim(),
      alamat: String(API.pick(userObj, ['alamat'], '')).trim(),
      pendidikan_terakhir: String(API.pick(userObj, ['pendidikan_terakhir'], '')).trim(),
      bidang_ajar: String(API.pick(userObj, ['bidang_ajar'], '')).trim(),
      bio: String(API.pick(userObj, ['bio'], '')).trim(),
      foto_url: String(API.pick(userObj, ['foto_url'], '')).trim(),
      loginAt: new Date().toISOString(),
    };
  }

  function showLoginError(msg) {
    const errorBox = document.getElementById('login-error-box');
    const errorMsg = document.getElementById('login-error-msg');
    if (!errorBox || !errorMsg) return;
    if (msg) {
      errorMsg.textContent = msg;
      errorBox.hidden = false;
    } else {
      errorMsg.textContent = '';
      errorBox.hidden = true;
    }
  }

  function initLoginAndLogout() {
    const form = document.getElementById('form-login');
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const toggleBtn = document.getElementById('btn-toggle-password');
    const submitBtn = document.getElementById('btn-login-submit');
    const logoutBtn = document.getElementById('btn-logout');
    const recheckBtn = document.getElementById('btn-recheck-api');

    if (recheckBtn) {
      recheckBtn.addEventListener('click', checkBackendHealth);
    }

    if (toggleBtn && passwordInput) {
      toggleBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        toggleBtn.setAttribute('aria-pressed', isPassword ? 'true' : 'false');
        toggleBtn.setAttribute('aria-label', isPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
        toggleBtn.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`;
        UI.refreshIcons(toggleBtn);
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoginError('');

        const username = (usernameInput ? usernameInput.value : '').trim();
        const password = passwordInput ? passwordInput.value : '';

        if (!username || !password) {
          showLoginError('Masukkan username dan kata sandi terlebih dahulu.');
          if (!username && usernameInput) usernameInput.focus();
          else if (passwordInput) passwordInput.focus();
          return;
        }

        UI.setButtonLoading(submitBtn, true, 'Memverifikasi...');
        try {
          const res = await API.login(username, password);
          const session = extractSessionFromLoginResponse(res, username);
          saveSession(session);
          UI.toast(`Selamat datang, ${session.nama_lengkap}.`, 'success');
          routeToPortal(session);
        } catch (err) {
          showLoginError(err.message);
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(submitBtn, false);
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        performLogout('Anda telah keluar dari sistem.', 'info');
      });
    }
  }

  function performLogout(toastMsg, toastType) {
    if (root.MDTA_ADMIN && typeof root.MDTA_ADMIN.cleanup === 'function') {
      root.MDTA_ADMIN.cleanup();
    }
    if (root.MDTA_GURU && typeof root.MDTA_GURU.cleanup === 'function') {
      root.MDTA_GURU.cleanup();
    }
    clearSession();
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const toggleBtn = document.getElementById('btn-toggle-password');
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.type = 'password';
    }
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', 'false');
      toggleBtn.setAttribute('aria-label', 'Tampilkan kata sandi');
      toggleBtn.innerHTML = '<i data-lucide="eye" aria-hidden="true"></i>';
      UI.refreshIcons(toggleBtn);
    }
    showLoginError(toastType === 'warn' || toastType === 'error' ? toastMsg : '');
    routeToPortal(null);
    if (toastMsg) {
      UI.toast(toastMsg, toastType || 'info');
    }
    if (usernameInput) usernameInput.focus();
  }

  function forceLogout(reasonMsg) {
    performLogout(reasonMsg || 'Sesi Anda telah berakhir, silakan masuk kembali.', 'warn');
  }

  // =========================================================================
  // INISIALISASI APLIKASI
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    UI.refreshIcons(document);
    UI.bindSpotlights(document);
    if (typeof UI.initMotionInteractions === 'function') UI.initMotionInteractions();
    if (typeof UI.initCustomSelects === 'function') UI.initCustomSelects(document);
    initTheme();
    initScrollProgress();
    initNavDrawer();
    initArsipModal();
    initLoginAndLogout();
    checkBackendHealth();

    const footerYear = document.getElementById('footer-year');
    if (footerYear) {
      footerYear.textContent = String(new Date().getFullYear());
    }

    const { session: existingSession, expired } = readStoredSession();
    if (existingSession) {
      currentSession = existingSession;
      saveSession(existingSession); // Sliding expiration: perpanjang +7 hari saat aktif
      routeToPortal(existingSession);
    } else {
      routeToPortal(null);
      if (expired) {
        const expMsg = 'Sesi Anda telah berakhir, silakan masuk kembali.';
        showLoginError(expMsg);
        UI.toast(expMsg, 'warn');
      }
    }
  });

  root.MDTA_AUTH = {
    getSession: () => currentSession || getSession(),
    updateSession,
    forceLogout,
    openNavDrawer,
    closeNavDrawer,
    updateHeaderAuthUI,
    routeToPortal,
    checkBackendHealth,
  };
})(window);
