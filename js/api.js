/**
 * Klien API Google Apps Script (Code.gs) & Utilitas UI Bersama
 * Semua request POST wajib memakai header 'Content-Type': 'text/plain;charset=utf-8'
 * agar bebas CORS preflight di GitHub Pages.
 */
(function (root) {
  'use strict';

  const CONFIG = root.MDTA_CONFIG;

  // =========================================================================
  // UTILITAS UI & AKSESIBILITAS (R-27, R-32, R-39)
  // =========================================================================
  function esc(value) {
    return String(value ?? '')
      .replace(/\s*\u2014\s*/g, ': ')
      .replace(/\u2014/g, ', ')
      .replace(/[&<>"']/g, function (c) {
        return {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[c];
      });
  }

  function parseLocaleNumber(val, fallback) {
    if (typeof val === 'number') return Number.isFinite(val) ? val : (fallback ?? 0);
    if (val === null || val === undefined || val === '') return fallback ?? 0;
    const cleaned = String(val).trim().replace('%', '').replace(',', '.');
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : (fallback ?? 0);
  }

  function refreshIcons(scope) {
    if (root.lucide && typeof root.lucide.createIcons === 'function') {
      try {
        root.lucide.createIcons({
          root: scope || document,
          attrs: { 'aria-hidden': 'true' },
        });
      } catch (err) {
        // Abaikan jika ikon belum terpasang
      }
    }
  }

  function parseDateInputWIB(dateInput) {
    if (!dateInput) return new Date();
    const s = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T12:00:00+07:00`);
    }
    return new Date(dateInput);
  }

  function formatDateId(dateInput) {
    const d = parseDateInputWIB(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput || '-');
    return d.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  }

  function formatDateShort(dateInput) {
    if (!dateInput) return '-';
    const d = parseDateInputWIB(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Jakarta',
    });
  }

  function todayISO() {
    const now = new Date();
    try {
      const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
      if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
    } catch (err) {
      // Fallback UTC+7 jika Intl timeZone tidak didukung
    }
    const wib = new Date(now.getTime() + 7 * 3600 * 1000);
    const y = wib.getUTCFullYear();
    const m = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const d = String(wib.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function nowTimeHMS() {
    const now = new Date();
    try {
      const formatted = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
      if (/^\d{2}:\d{2}:\d{2}$/.test(formatted)) return formatted;
    } catch (err) {
      // Fallback UTC+7 jika Intl timeZone tidak didukung
    }
    const wib = new Date(now.getTime() + 7 * 3600 * 1000);
    const hh = String(wib.getUTCHours()).padStart(2, '0');
    const mm = String(wib.getUTCMinutes()).padStart(2, '0');
    const ss = String(wib.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function formatSheetDate(val) {
    if (!val) return '-';
    const s = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta',
      });
    }
    return s;
  }

  function normalizeISODate(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (!s || s === '-') return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const dmy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) {
      const formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      return /^\d{4}-\d{2}-\d{2}$/.test(formatted) ? formatted : '';
    }
    return '';
  }

  function formatTTL(tempatLahir, tanggalLahir) {
    const tmp = String(tempatLahir || '').trim();
    const iso = normalizeISODate(tanggalLahir);
    let tglText = '';
    if (iso) {
      const parts = iso.split('-');
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!Number.isNaN(dt.getTime())) {
        tglText = dt.toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      }
    } else if (tanggalLahir && String(tanggalLahir).trim() !== '-') {
      tglText = String(tanggalLahir).trim();
    }
    if (tmp && tglText) return `${tmp}, ${tglText}`;
    return tmp || tglText || '-';
  }

  function formatSheetTime(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      });
    }
    return s;
  }

  function canUseMotion() {
    if (typeof root.matchMedia !== 'function' || typeof root.getComputedStyle !== 'function') {
      return false;
    }
    try {
      return !root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return true;
    }
  }

  // Toast Notification
  function toast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const kind = type || 'info';
    const iconMap = {
      success: 'check-circle-2',
      error: 'alert-circle',
      warn: 'alert-triangle',
      info: 'info',
    };

    const el = document.createElement('div');
    el.className = `toast-item toast-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `
      <i data-lucide="${iconMap[kind] || 'info'}" aria-hidden="true" style="width:18px;height:18px;flex-shrink:0;margin-top:2px;"></i>
      <div style="flex:1;min-width:0;">${esc(message)}</div>
      <button type="button" class="btn-icon-sm btn-secondary" aria-label="Tutup notifikasi" style="min-height:30px;min-width:30px;padding:0;border-radius:6px;">
        <i data-lucide="x" aria-hidden="true" style="width:14px;height:14px;"></i>
      </button>
      <span class="toast-progress" aria-hidden="true"></span>
    `;

    const closeBtn = el.querySelector('button');
    let timer = null;
    let exitTimer = null;
    let removed = false;
    const removeToast = () => {
      if (removed) return;
      removed = true;
      if (timer) clearTimeout(timer);
      if (canUseMotion()) {
        el.classList.add('is-leaving');
        exitTimer = setTimeout(() => {
          exitTimer = null;
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 200);
      } else if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    };

    closeBtn.addEventListener('click', removeToast);
    container.appendChild(el);
    refreshIcons(el);
    timer = setTimeout(removeToast, 4800);
  }

  function setButtonLoading(btn, isLoading, loadingLabel) {
    if (!btn) return;
    if (isLoading) {
      if (!btn.dataset.origHtml) btn.dataset.origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.innerHTML = `<i data-lucide="loader-2" class="spin-icon" aria-hidden="true"></i><span>${esc(
        loadingLabel || 'Memproses...'
      )}</span>`;
      refreshIcons(btn);
    } else {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.dataset.origHtml) {
        btn.innerHTML = btn.dataset.origHtml;
        delete btn.dataset.origHtml;
        refreshIcons(btn);
      }
    }
  }

  function renderSkeletonRows(colCount, rowCount) {
    const rows = rowCount || 4;
    const cols = colCount || 5;
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr class="table-skeleton-row">';
      for (let c = 0; c < cols; c++) {
        const w = c === 0 ? '42%' : c === cols - 1 ? '64%' : '78%';
        html += `<td><div class="skeleton-line" style="width:${w};"></div></td>`;
      }
      html += '</tr>';
    }
    return html;
  }

  function renderStateBox(opts) {
    const kind = opts.type || 'empty';
    const isErr = kind === 'error';
    const iconName = isErr ? 'alert-octagon' : kind === 'loading' ? 'loader-2' : 'inbox';
    const iconClass = kind === 'loading' ? 'spin-icon' : '';
    const actionBtn =
      opts.actionLabel && opts.actionId
        ? `<button type="button" id="${esc(opts.actionId)}" class="btn btn-secondary btn-sm" style="margin-top:6px;">
             <i data-lucide="${isErr ? 'rotate-cw' : 'plus'}" aria-hidden="true"></i>
             <span>${esc(opts.actionLabel)}</span>
           </button>`
        : '';

    return `
      <div class="state-box ${isErr ? 'state-box-error' : ''}" role="${isErr ? 'alert' : 'status'}">
        <i data-lucide="${iconName}" class="${iconClass}" aria-hidden="true" style="width:24px;height:24px;"></i>
        <strong style="font-size:0.95rem;">${esc(opts.title || 'Belum ada data')}</strong>
        <p style="margin:0;max-width:480px;font-size:0.85rem;" class="${isErr ? '' : 'text-muted'}">${esc(
      opts.message || ''
    )}</p>
        ${actionBtn}
      </div>
    `;
  }

  // =========================================================================
  // MODAL FOCUS TRAP & DIALOG KONFIRMASI
  // =========================================================================
  const modalStack = [];
  const modalCloseTimers = new Map();

  function getFocusable(container) {
    return Array.from(
      container.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.offsetParent !== null);
  }

  function openModal(modalId, opts) {
    const backdrop = document.getElementById(modalId);
    if (!backdrop) return;

    if (modalCloseTimers.has(modalId)) {
      clearTimeout(modalCloseTimers.get(modalId));
      modalCloseTimers.delete(modalId);
    }
    backdrop.classList.remove('is-closing');

    const existingIdx = modalStack.findIndex((m) => m.id === modalId);
    if (existingIdx >= 0 && !backdrop.hidden) {
      if (opts && typeof opts.onClose === 'function') {
        modalStack[existingIdx].onClose = opts.onClose;
      }
      return;
    }

    const prevFocus = document.activeElement;
    backdrop.hidden = false;
    document.body.classList.add('modal-open');

    const panel = backdrop.querySelector('.modal-panel') || backdrop;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(modalId);
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function onBackdropClick(e) {
      if (e.target === backdrop) {
        closeModal(modalId);
      }
    }

    const entry = {
      id: modalId,
      prevFocus,
      onKeyDown,
      onBackdropClick,
      onClose: opts && typeof opts.onClose === 'function' ? opts.onClose : null,
    };
    modalStack.push(entry);
    backdrop.addEventListener('keydown', onKeyDown);
    backdrop.addEventListener('click', onBackdropClick);

    refreshIcons(backdrop);
    requestAnimationFrame(() => {
      const focusable = getFocusable(panel);
      if (focusable.length > 0) focusable[0].focus();
    });
  }

  function closeModal(modalId) {
    const backdrop = document.getElementById(modalId);
    if (!backdrop || backdrop.hidden || modalCloseTimers.has(modalId)) return;

    const idx = modalStack.findIndex((m) => m.id === modalId);
    let closedEntry = null;
    if (idx >= 0) {
      closedEntry = modalStack.splice(idx, 1)[0];
      backdrop.removeEventListener('keydown', closedEntry.onKeyDown);
      backdrop.removeEventListener('click', closedEntry.onBackdropClick);
      if (closedEntry.prevFocus && typeof closedEntry.prevFocus.focus === 'function') {
        closedEntry.prevFocus.focus();
      }
    }
    if (modalStack.length === 0) {
      document.body.classList.remove('modal-open');
    }
    if (closedEntry && typeof closedEntry.onClose === 'function') {
      closedEntry.onClose();
    }

    if (canUseMotion()) {
      backdrop.classList.add('is-closing');
      const timerId = setTimeout(() => {
        modalCloseTimers.delete(modalId);
        backdrop.classList.remove('is-closing');
        backdrop.hidden = true;
      }, 185);
      modalCloseTimers.set(modalId, timerId);
    } else {
      backdrop.classList.remove('is-closing');
      backdrop.hidden = true;
    }
  }

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      const modalId = 'modal-confirm';
      const titleEl = document.getElementById('confirm-modal-title');
      const msgEl = document.getElementById('confirm-modal-message');
      const okBtn = document.getElementById('btn-confirm-ok');
      const cancelBtn = document.getElementById('btn-confirm-cancel');
      const closeBtn = document.getElementById('btn-close-confirm-modal');

      if (!titleEl || !msgEl || !okBtn || !cancelBtn) {
        resolve(false);
        return;
      }

      titleEl.textContent = opts.title || 'Konfirmasi Tindakan';
      msgEl.textContent = opts.message || 'Apakah Anda yakin ingin melanjutkan tindakan ini?';
      okBtn.textContent = opts.confirmLabel || 'Lanjutkan';
      okBtn.className = opts.danger ? 'btn btn-danger' : 'btn btn-primary';

      let settled = false;
      const finish = (val) => {
        if (settled) return;
        settled = true;
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        if (closeBtn) closeBtn.removeEventListener('click', onCancel);
        closeModal(modalId);
        resolve(val);
      };

      const onOk = () => finish(true);
      const onCancel = () => finish(false);

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      if (closeBtn) closeBtn.addEventListener('click', onCancel);

      openModal(modalId);
    });
  }

  // =========================================================================
  // TABS DENGAN SLIDING PILL & DUKUNGAN KEYBOARD ARROW (R-32)
  // =========================================================================
  function initSlidingTabs(tablistEl, onSelect) {
    if (!tablistEl) return null;
    const tabs = Array.from(tablistEl.querySelectorAll('[role="tab"]'));
    const pill = tablistEl.querySelector('.tab-sliding-indicator');
    let prevTabIndex = -1;

    function positionPill(activeTab) {
      if (!pill || !activeTab) return;
      const x = activeTab.offsetLeft;
      const w = activeTab.offsetWidth;
      if (!w || w <= 0) {
        tablistEl.classList.remove('has-pill');
        pill.style.opacity = '0';
        return;
      }
      tablistEl.classList.add('has-pill');
      pill.style.width = `${w}px`;
      pill.style.transform = `translate3d(${x}px, 0, 0)`;
      pill.style.opacity = '1';
    }

    function activate(tabEl, emit) {
      if (!tabEl) return;
      const nextIdx = tabs.indexOf(tabEl);
      const dir = prevTabIndex < 0 ? 'initial' : nextIdx >= prevTabIndex ? 'forward' : 'backward';
      tabs.forEach((t) => {
        const isTarget = t === tabEl;
        t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        t.setAttribute('tabindex', isTarget ? '0' : '-1');
        t.classList.toggle('active', isTarget);
        const panelId = t.getAttribute('aria-controls');
        if (panelId) {
          const panel = document.getElementById(panelId);
          if (panel) {
            if (isTarget && panel.dataset) {
              panel.dataset.enterDir = dir;
            }
            panel.hidden = !isTarget;
          }
        }
      });
      prevTabIndex = nextIdx;
      requestAnimationFrame(() => positionPill(tabEl));
      if (emit && typeof onSelect === 'function') {
        onSelect(tabEl.dataset.tab || '', tabEl);
      }
    }

    tabs.forEach((tab, idx) => {
      tab.addEventListener('click', () => activate(tab, true));
      tab.addEventListener('keydown', (e) => {
        let nextIdx = idx;
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') nextIdx = 0;
        else if (e.key === 'End') nextIdx = tabs.length - 1;
        else return;
        e.preventDefault();
        tabs[nextIdx].focus();
        activate(tabs[nextIdx], true);
      });
    });

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
        positionPill(current);
      });
      ro.observe(tablistEl);
    }

    const initial = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
    if (initial) activate(initial, false);

    return {
      selectByName: (name, emit) => {
        const found = tabs.find((t) => t.dataset.tab === name);
        if (found) activate(found, Boolean(emit));
      },
      clearSelection: () => {
        tabs.forEach((t) => {
          t.setAttribute('aria-selected', 'false');
          t.setAttribute('tabindex', '-1');
          t.classList.remove('active');
          const panelId = t.getAttribute('aria-controls');
          if (panelId) {
            const panel = document.getElementById(panelId);
            if (panel) panel.hidden = true;
          }
        });
        tablistEl.classList.remove('has-pill');
        if (pill) pill.style.opacity = '0';
      },
      reposition: () => {
        const current = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0];
        positionPill(current);
      },
    };
  }

  const spotlightBound = new WeakSet();
  function bindSpotlights(scope) {
    const cards = (scope || document).querySelectorAll('.surface-card');
    cards.forEach((card) => {
      if (spotlightBound.has(card)) return;
      spotlightBound.add(card);
      card.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerType === 'touch') return;
          const r = card.getBoundingClientRect();
          card.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
          card.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
        },
        { passive: true }
      );
    });
  }

  let motionInteractionsBound = false;
  function initMotionInteractions() {
    if (motionInteractionsBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    motionInteractionsBound = true;

    const rippleSelector = '.btn, .report-mode-btn, .drawer-nav-item, .kelas-subtab, .filter-chip, .manual-status-btn, .user-session-chip';
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (!canUseMotion() || (typeof e.button === 'number' && e.button > 0)) return;
        const target = e.target && typeof e.target.closest === 'function' ? e.target.closest(rippleSelector) : null;
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true' || target.getAttribute('aria-busy') === 'true') {
          return;
        }
        if (typeof target.getBoundingClientRect !== 'function') return;
        const rect = target.getBoundingClientRect();
        if (!rect.width || !rect.height) return;

        const prevRipples = target.querySelectorAll('.ui-ripple');
        if (prevRipples.length >= 2) {
          prevRipples[0].remove();
        }

        const size = Math.ceil(Math.max(rect.width, rect.height) * 2.15);
        const hasCoords = typeof e.clientX === 'number' && typeof e.clientY === 'number' && (e.clientX !== 0 || e.clientY !== 0);
        const x = hasCoords ? e.clientX - rect.left : rect.width / 2;
        const y = hasCoords ? e.clientY - rect.top : rect.height / 2;
        const isDarkSurface =
          target.classList.contains('btn-primary') ||
          target.classList.contains('btn-accent') ||
          target.getAttribute('aria-pressed') === 'true' ||
          target.classList.contains('active');

        const wave = document.createElement('span');
        wave.className = `ui-ripple ${isDarkSurface ? 'ui-ripple-light' : 'ui-ripple-dark'}`;
        wave.setAttribute('aria-hidden', 'true');
        wave.style.width = `${size}px`;
        wave.style.height = `${size}px`;
        wave.style.left = `${Math.round(x)}px`;
        wave.style.top = `${Math.round(y)}px`;
        target.appendChild(wave);

        let cleared = false;
        const cleanup = () => {
          if (cleared) return;
          cleared = true;
          if (wave.parentNode) wave.parentNode.removeChild(wave);
        };
        wave.addEventListener('animationend', cleanup, { once: true });
        setTimeout(cleanup, 580);
      },
      { passive: true }
    );

    const refreshBtnSelector = '#btn-refresh-dashboard, #btn-refresh-users, #btn-refresh-arsip, #btn-recheck-api';
    document.addEventListener('click', (e) => {
      if (!canUseMotion()) return;
      const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest(refreshBtnSelector) : null;
      if (!btn || btn.disabled) return;
      const svg = btn.querySelector('svg');
      if (!svg) return;
      svg.classList.remove('is-spin-pulse');
      void svg.offsetWidth;
      svg.classList.add('is-spin-pulse');
      setTimeout(() => {
        svg.classList.remove('is-spin-pulse');
      }, 540);
    });
  }

  // =========================================================================
  // KLIEN FETCH GOOGLE APPS SCRIPT (SESUAI Code.gs)
  // =========================================================================
  async function parseGasResponse(response, action) {
    const text = await response.text();
    const trimmed = text.trim();

    if (!trimmed) {
      throw new Error(`Respons kosong dari server untuk aksi "${action}".`);
    }

    if (
      trimmed.startsWith('<!doctype') ||
      trimmed.startsWith('<!DOCTYPE') ||
      trimmed.startsWith('<html') ||
      (response.url && response.url.includes('accounts.google.com'))
    ) {
      const err = new Error(
        'Web App Google Apps Script masih mengarah ke login Google (302 ServiceLogin). Buka Google Sheets "Database Sistem MDTA" > Extensions > Apps Script > Deploy > Manage deployments dan set "Who has access" ke "Anyone".'
      );
      err.code = 'GAS_AUTH_REDIRECT';
      throw err;
    }

    let json;
    try {
      json = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`Format respons server tidak valid untuk "${action}".`);
    }

    if (
      json &&
      (json.status === 'error' ||
        json.ok === false ||
        json.success === false ||
        (typeof json.error === 'string' && json.error.length > 0))
    ) {
      throw new Error(json.message || json.error || `Permintaan "${action}" ditolak oleh server.`);
    }

    return json;
  }

  const GURU_SCOPED_GET_ACTIONS = new Set([
    'getBootstrapData',
    'getSantri',
    'getPresensi',
    'getNilaiUAS',
    'getNilaiRaport',
    'getRekapLaporan',
    'getLogSetoran',
    'getKelas',
  ]);
  const GURU_SCOPED_POST_ACTIONS = new Set([
    'savePresensi',
    'clearPresensiHarian',
    'saveNilaiUAS',
    'deleteNilaiUAS',
    'saveNilaiRaport',
    'submitLaporanGuru',
  ]);

  function getActiveSessionContext() {
    try {
      const raw =
        (root.localStorage && root.localStorage.getItem(CONFIG.SESSION_KEY)) ||
        (root.sessionStorage && root.sessionStorage.getItem(CONFIG.SESSION_KEY));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.expiresAt && Date.now() >= Number(parsed.expiresAt)) return null;
      const userObj = parsed.user && typeof parsed.user === 'object' ? parsed.user : parsed;
      return userObj && userObj.role ? userObj : null;
    } catch (err) {
      return null;
    }
  }

  const inflightGetRequests = new Map();

  async function requestGet(action, params) {
    const url = new URL(CONFIG.GAS_WEB_APP_URL);
    url.searchParams.set('action', action);
    if (params && typeof params === 'object') {
      Object.keys(params).forEach((k) => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          url.searchParams.set(k, String(params[k]));
        }
      });
    }

    if (GURU_SCOPED_GET_ACTIONS.has(action)) {
      const sess = getActiveSessionContext();
      if (sess && String(sess.role || '').trim().toLowerCase() === 'guru') {
        if (!url.searchParams.has('role')) url.searchParams.set('role', 'guru');
        if (!url.searchParams.has('id_user') && sess.id_user) url.searchParams.set('id_user', String(sess.id_user));
        if (!url.searchParams.has('username') && sess.username) url.searchParams.set('username', String(sess.username));
      }
    }

    const reqKey = url.toString();
    if (inflightGetRequests.has(reqKey)) {
      return inflightGetRequests.get(reqKey);
    }

    const reqPromise = (async () => {
      let response;
      try {
        response = await fetch(reqKey, {
          method: 'GET',
          redirect: 'follow',
        });
      } catch (err) {
        throw new Error(`Gagal terhubung ke server (${action}): periksa koneksi internet atau akses deployment Apps Script.`);
      }

      return parseGasResponse(response, action);
    })().finally(() => {
      inflightGetRequests.delete(reqKey);
    });

    inflightGetRequests.set(reqKey, reqPromise);
    return reqPromise;
  }

  async function requestPost(action, payload) {
    const bodyObj = Object.assign({ action }, payload || {});
    if (GURU_SCOPED_POST_ACTIONS.has(action)) {
      const sess = getActiveSessionContext();
      if (sess && String(sess.role || '').trim().toLowerCase() === 'guru') {
        if (!bodyObj.role) bodyObj.role = 'guru';
        if (!bodyObj.id_user && sess.id_user) bodyObj.id_user = String(sess.id_user);
        if (!bodyObj.username && sess.username) bodyObj.username = String(sess.username);
        if (bodyObj.data && typeof bodyObj.data === 'object' && !Array.isArray(bodyObj.data)) {
          bodyObj.data = Object.assign({}, bodyObj.data, {
            role: bodyObj.data.role || 'guru',
            id_user: bodyObj.data.id_user || String(sess.id_user || ''),
            username: bodyObj.data.username || String(sess.username || ''),
          });
        }
      }
    }

    let response;
    try {
      response = await fetch(CONFIG.GAS_WEB_APP_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(bodyObj),
      });
    } catch (err) {
      throw new Error(`Gagal mengirim data ke server (${action}): periksa koneksi internet atau akses Web App.`);
    }

    return parseGasResponse(response, action);
  }

  function pick(obj, keys, fallback) {
    if (!obj || typeof obj !== 'object') return fallback;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
        return obj[k];
      }
    }
    return fallback;
  }

  function extractArray(res, candidateKeys) {
    if (Array.isArray(res)) return res;
    if (!res || typeof res !== 'object') return [];
    const keys = (candidateKeys || []).concat(['data', 'items', 'rows', 'list', 'records', 'result']);
    for (let i = 0; i < keys.length; i++) {
      const v = res[keys[i]];
      if (Array.isArray(v)) return v;
    }
    if (res.data && typeof res.data === 'object') {
      for (let i = 0; i < keys.length; i++) {
        const v = res.data[keys[i]];
        if (Array.isArray(v)) return v;
      }
    }
    return [];
  }

  // Normalizer selaras kolom Database Sistem MDTA
  function normalizeSantri(raw) {
    const id = String(pick(raw, ['id_santri', 'id'], '')).trim();
    const nama = String(pick(raw, ['nama_lengkap', 'nama', 'name'], ''));
    const namaAyahKandung = String(pick(raw, ['nama_ayah_kandung', 'nama_ayah', 'ayah_kandung', 'ayah'], '')).trim();
    const nis = String(pick(raw, ['nis', 'nis_santri', 'no_induk'], '')).trim();
    const nik = String(pick(raw, ['nik', 'nik_santri', 'no_nik'], '')).trim();
    const tempatLahir = String(pick(raw, ['tempat_lahir', 'tmp_lahir'], '')).trim();
    const tanggalLahir = normalizeISODate(pick(raw, ['tanggal_lahir', 'tgl_lahir'], ''));
    const rawTtl = String(pick(raw, ['tempat_tanggal_lahir', 'ttl'], '')).trim();
    const ttl = (tempatLahir || tanggalLahir) ? formatTTL(tempatLahir, tanggalLahir) : (rawTtl || '-');
    const wa = String(pick(raw, ['no_wa_ortu', 'no_hp', 'hp', 'whatsapp'], ''));
    const token = String(pick(raw, ['qr_token', 'token', 'kode_qr'], id));
    return {
      id_santri: id,
      id: id,
      nis,
      nik,
      tempat_lahir: tempatLahir,
      tanggal_lahir: tanggalLahir,
      ttl,
      nama_lengkap: nama,
      nama: nama,
      nama_ayah_kandung: namaAyahKandung,
      kelas: String(pick(raw, ['kelas', 'rombel', 'class'], '')),
      no_wa_ortu: wa,
      no_hp: wa,
      qr_token: token,
      status: String(pick(raw, ['status', 'status_santri'], 'aktif')).toLowerCase(),
      created_at: String(pick(raw, ['created_at'], '')),
      raw: raw,
    };
  }

  function parseKelasAmpu(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/[;,]/);
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      const clean = String(item || '').trim();
      if (!clean) return;
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(clean);
      }
    });
    return out;
  }

  function formatKelasAmpu(raw) {
    return parseKelasAmpu(raw).join(', ');
  }

  function isKelasAllowed(kelasVal, allowedList) {
    const targets = parseKelasAmpu(kelasVal).map((k) => k.toLowerCase());
    if (targets.length === 0 || !Array.isArray(allowedList) || allowedList.length === 0) return false;
    return allowedList.some((k) => targets.includes(String(k || '').trim().toLowerCase()));
  }

  function isActiveSantri(santriObj) {
    if (!santriObj || typeof santriObj !== 'object') return false;
    const nama = String(santriObj.nama_lengkap || santriObj.nama || '').trim();
    if (!nama || nama === '-') return false;
    const st = String(santriObj.status || 'aktif').trim().toLowerCase();
    return !st || st === 'aktif';
  }

  function filterByGuruScope(list, session, classField) {
    const arr = Array.isArray(list) ? list : [];
    const sess = session || getActiveSessionContext();
    if (!sess || String(sess.role || '').trim().toLowerCase() !== 'guru') {
      return arr;
    }
    const allowed = parseKelasAmpu(sess.kelas_ampu);
    if (allowed.length === 0) return [];
    const field = classField || 'kelas';
    return arr.filter((item) => isKelasAllowed(item && item[field], allowed));
  }

  function normalizeKategoriProgram(raw, fallbackKelasName) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'tahfidz' || s === 'tahfiz') return 'Tahfidz';
    if (s === 'tarikh') return 'Tarikh';
    if (s === 'wustho' || s === 'wusto') return 'Wustho';
    if (s === 'diniyyah' || s === 'diniyah') return 'Diniyyah';
    const k = String(fallbackKelasName || '').trim().toLowerCase();
    if (/tahfi[dz]/i.test(k)) return 'Tahfidz';
    if (/tarikh/i.test(k)) return 'Tarikh';
    if (/wusth?o/i.test(k)) return 'Wustho';
    return 'Diniyyah';
  }

  function normalizeKelas(raw) {
    const src = raw || {};
    const nama = String(pick(src, ['nama_kelas', 'kelas', 'nama'], '')).trim();
    return {
      id_kelas: String(pick(src, ['id_kelas', 'id'], '')),
      nama_kelas: nama,
      kategori_program: normalizeKategoriProgram(pick(src, ['kategori_program', 'program'], ''), nama),
      tingkat: String(pick(src, ['tingkat', 'level'], '')).trim(),
      keterangan: String(pick(src, ['keterangan', 'catatan'], '')).trim(),
      status: String(pick(src, ['status'], 'aktif')).trim().toLowerCase(),
      created_at: formatSheetDate(pick(src, ['created_at'], '')),
    };
  }

  function getOfficialKelasNames(includeInactive) {
    const st = root.MDTA_STATE || {};
    if (Array.isArray(st.kelas) && st.kelas.length > 0) {
      return st.kelas
        .map(normalizeKelas)
        .filter((k) => k.nama_kelas && (includeInactive || k.status !== 'nonaktif'))
        .map((k) => k.nama_kelas)
        .sort((a, b) => a.localeCompare(b));
    }
    const fallbackSet = new Set();
    (st.santri || []).forEach((s) => {
      const k = String((s && s.kelas) || '').trim();
      if (k) fallbackSet.add(k);
    });
    if (fallbackSet.size === 0) {
      (CONFIG.KELAS_OPTIONS || []).forEach((k) => fallbackSet.add(k));
    }
    return Array.from(fallbackSet).sort((a, b) => a.localeCompare(b));
  }

  function normalizeUser(raw) {
    const id = String(pick(raw, ['id_user', 'id', 'username'], ''));
    const nama = String(pick(raw, ['nama_lengkap', 'nama', 'name'], ''));
    const kelasAmpu = parseKelasAmpu(pick(raw, ['kelas_ampu'], ''));
    return {
      id_user: id,
      id: id,
      username: String(pick(raw, ['username', 'user'], '')),
      nama_lengkap: nama,
      nama: nama,
      role: String(pick(raw, ['role', 'peran', 'level'], 'guru')).toLowerCase(),
      status_aktif: String(pick(raw, ['status_aktif', 'status'], 'aktif')).toLowerCase(),
      kelas_ampu: kelasAmpu,
      kelas_ampu_text: kelasAmpu.join(', '),
      no_wa: String(pick(raw, ['no_wa'], '')),
      alamat: String(pick(raw, ['alamat'], '')),
      pendidikan_terakhir: String(pick(raw, ['pendidikan_terakhir'], '')),
      bidang_ajar: String(pick(raw, ['bidang_ajar'], '')),
      bio: String(pick(raw, ['bio'], '')),
      foto_url: String(pick(raw, ['foto_url'], '')),
      created_at: String(pick(raw, ['created_at'], '')),
      raw: raw,
    };
  }

  function normalizePresensi(raw) {
    return {
      id_presensi: String(pick(raw, ['id_presensi', 'id'], '')),
      tanggal: formatSheetDate(pick(raw, ['tanggal', 'tgl', 'date'], '')),
      waktu: formatSheetTime(pick(raw, ['waktu', 'jam', 'time'], '')),
      id_santri: String(pick(raw, ['id_santri'], '')),
      nama_santri: String(pick(raw, ['nama_santri', 'nama', 'santri'], '-')),
      kelas: String(pick(raw, ['kelas', 'rombel'], '-')),
      status: String(pick(raw, ['status', 'kehadiran'], 'Hadir')),
      id_guru_piket: String(pick(raw, ['id_guru_piket'], '')),
      nama_guru_piket: String(pick(raw, ['nama_guru_piket', 'guru_piket', 'guru'], '-')),
      metode: String(pick(raw, ['metode', 'sumber'], 'Manual')),
      catatan: String(pick(raw, ['catatan', 'keterangan'], '')),
    };
  }

  function normalizeRekap(raw) {
    const hadir = parseLocaleNumber(pick(raw, ['hadir', 'total_hadir'], 0), 0);
    const sakit = parseLocaleNumber(pick(raw, ['sakit', 'total_sakit'], 0), 0);
    const izin = parseLocaleNumber(pick(raw, ['izin', 'total_izin'], 0), 0);
    const alpa = parseLocaleNumber(pick(raw, ['alpa', 'alpha', 'total_alpa'], 0), 0);
    const total = parseLocaleNumber(pick(raw, ['total'], hadir + sakit + izin + alpa), 0);
    const rawPct = pick(raw, ['persentase', 'persen_kehadiran', 'persen'], null);
    const pct =
      rawPct !== null && rawPct !== ''
        ? Math.round(parseLocaleNumber(rawPct, 0) * 10) / 10
        : total > 0
          ? Math.round((hadir / total) * 1000) / 10
          : 0;

    const kelas = String(pick(raw, ['kelas', 'rombel'], '-'));
    return {
      id_santri: String(pick(raw, ['id_santri', 'id'], '')),
      nama_lengkap: String(pick(raw, ['nama_lengkap', 'nama', 'santri'], '-')),
      kelas,
      kategori_program: normalizeKategoriProgram(pick(raw, ['kategori_program', 'program'], ''), kelas),
      hadir,
      sakit,
      izin,
      alpa,
      total,
      persentase: Number.isFinite(pct) ? pct : 0,
    };
  }

  function normalizeNilaiUAS(raw) {
    return {
      id_uas: String(pick(raw, ['id_uas', 'id'], '')),
      id_santri: String(pick(raw, ['id_santri'], '')),
      nama_santri: String(pick(raw, ['nama_santri', 'nama'], '-')),
      kelas: String(pick(raw, ['kelas'], '-')),
      periode: String(pick(raw, ['periode'], 'Ganjil 2026/2027')),
      skema_soal: String(pick(raw, ['skema_soal', 'skema'], '-')),
      pg_benar: parseLocaleNumber(pick(raw, ['pg_benar'], 0), 0),
      essay_benar: parseLocaleNumber(pick(raw, ['essay_benar'], 0), 0),
      setengah_benar: parseLocaleNumber(pick(raw, ['setengah_benar'], 0), 0),
      nilai_uas: parseLocaleNumber(pick(raw, ['nilai_uas'], 0), 0),
      id_guru: String(pick(raw, ['id_guru'], '')),
      updated_at: formatSheetDate(pick(raw, ['updated_at'], '')),
    };
  }

  function isSheetErrorValue(val) {
    if (val === null || val === undefined) return true;
    const s = String(val).trim();
    if (!s) return true;
    return /^#(ERROR!|NAME\?|VALUE!|REF!|DIV\/0!|N\/A|NUM!|NULL!)/i.test(s);
  }

  function computeRaportGrade(score) {
    const val = parseLocaleNumber(score, 0);
    if (val >= 90) {
      return { grade: 'A', code: 'A', keterangan: 'Sangat Baik', label: 'Sangat Baik', cls: 'status-hadir', isTuntas: true };
    }
    if (val >= 80) {
      return { grade: 'B', code: 'B', keterangan: 'Baik', label: 'Baik', cls: 'status-izin', isTuntas: true };
    }
    if (val >= 70) {
      return { grade: 'C', code: 'C', keterangan: 'Cukup', label: 'Cukup', cls: 'status-sakit', isTuntas: true };
    }
    return { grade: 'D', code: 'D', keterangan: 'Kurang', label: 'Kurang', cls: 'status-alpa', isTuntas: false };
  }

  function resolveRaportNilai(raw) {
    const src = raw || {};
    const nHarian = parseLocaleNumber(pick(src, ['n_harian', 'harian'], 0), 0);
    const nUas = parseLocaleNumber(pick(src, ['n_uas', 'uas'], 0), 0);
    const rawHadir = pick(src, ['n_kehadiran', 'kehadiran', 'absensi'], null);
    const nKehadiran = rawHadir !== null && rawHadir !== '' ? parseLocaleNumber(rawHadir, 100) : 100;
    const bH = parseLocaleNumber(pick(src, ['bobot_harian'], 40), 40);
    const bU = parseLocaleNumber(pick(src, ['bobot_uas'], 40), 40);
    const bK = parseLocaleNumber(pick(src, ['bobot_kehadiran'], 20), 20);
    const bSum = bH + bU + bK || 100;

    const computedAkhir = Math.round(((nHarian * bH + nUas * bU + nKehadiran * bK) / bSum) * 100) / 100;
    const rawAkhirVal = pick(src, ['n_akhir'], null);
    const parsedAkhir = !isSheetErrorValue(rawAkhirVal) ? parseLocaleNumber(rawAkhirVal, NaN) : NaN;
    const nAkhir = Number.isFinite(parsedAkhir) ? Math.round(parsedAkhir * 100) / 100 : computedAkhir;

    const pred = computeRaportGrade(nAkhir);
    const rawGrade = pick(src, ['grade'], null);
    const cleanGrade = !isSheetErrorValue(rawGrade) ? String(rawGrade).trim().toUpperCase() : '';
    const grade = ['A', 'B', 'C', 'D'].includes(cleanGrade) ? cleanGrade : pred.grade;

    const rawKet = pick(src, ['keterangan'], null);
    const keterangan = !isSheetErrorValue(rawKet) ? String(rawKet).trim() : computeRaportGrade(nAkhir).keterangan;

    return {
      n_harian: nHarian,
      n_uas: nUas,
      n_kehadiran: nKehadiran,
      bobot_harian: bH,
      bobot_uas: bU,
      bobot_kehadiran: bK,
      n_akhir: nAkhir,
      grade,
      keterangan,
      isTuntas: ['A', 'B', 'C'].includes(grade),
      cls: computeRaportGrade(nAkhir).cls,
    };
  }

  function normalizeNilaiRaport(raw) {
    const resolved = resolveRaportNilai(raw);
    return {
      id_raport: String(pick(raw, ['id_raport', 'id'], '')),
      id_santri: String(pick(raw, ['id_santri'], '')),
      nama_santri: String(pick(raw, ['nama_santri', 'nama'], '-')),
      kelas: String(pick(raw, ['kelas'], '')),
      periode: String(pick(raw, ['periode'], 'Ganjil 2026/2027')),
      n_harian: resolved.n_harian,
      n_uas: resolved.n_uas,
      n_kehadiran: resolved.n_kehadiran,
      bobot_harian: resolved.bobot_harian,
      bobot_uas: resolved.bobot_uas,
      bobot_kehadiran: resolved.bobot_kehadiran,
      n_akhir: resolved.n_akhir,
      grade: resolved.grade,
      keterangan: resolved.keterangan,
      updated_at: formatSheetDate(pick(raw, ['updated_at'], '')),
    };
  }

  function normalizeDokumen(raw) {
    const driveUrl = String(pick(raw, ['drive_url', 'url', 'webViewLink', 'link'], ''));
    const judul = String(pick(raw, ['judul', 'name', 'nama', 'title'], 'Tanpa Judul'));
    const isFolder = driveUrl.includes('/folders/') || /folder/i.test(judul);
    return {
      id_dokumen: String(pick(raw, ['id_dokumen', 'id'], '')),
      judul,
      kategori: String(pick(raw, ['kategori', 'category'], 'Arsip Resmi')),
      drive_id: String(pick(raw, ['drive_id', 'fileId'], '')),
      drive_url: driveUrl,
      diunggah_oleh: String(pick(raw, ['diunggah_oleh', 'uploader'], '-')),
      tanggal_upload: formatSheetDate(pick(raw, ['tanggal_upload', 'updated_at', 'date'], '')),
      isFolder,
    };
  }

  function normalizeLogSetoran(raw) {
    return {
      id_setoran: String(pick(raw, ['id_setoran', 'id'], '')),
      tanggal: String(pick(raw, ['tanggal'], '')),
      jenis_laporan: String(pick(raw, ['jenis_laporan'], '')),
      kelas: String(pick(raw, ['kelas'], 'Semua Kelas')),
      periode: String(pick(raw, ['periode'], '')),
      id_guru: String(pick(raw, ['id_guru'], '')),
      nama_guru: String(pick(raw, ['nama_guru'], '-')),
      ringkasan: String(pick(raw, ['ringkasan'], '')),
      waktu_submit: String(pick(raw, ['waktu_submit'], '')),
    };
  }

  function formatWhatsAppUrl(phone, text) {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    if (!rawDigits) return '';
    let normalized = rawDigits;
    if (normalized.startsWith('0')) {
      normalized = '62' + normalized.slice(1);
    } else if (normalized.startsWith('8')) {
      normalized = '62' + normalized;
    }
    if (normalized.length < 9) return '';
    const msg = text ? `?text=${encodeURIComponent(text)}` : '';
    return `https://wa.me/${normalized}${msg}`;
  }

  function extractDriveFileId(url) {
    const raw = String(url || '').trim();
    if (!raw || /^data:/i.test(raw)) return '';
    const qMatch = raw.match(/drive\.google\.com\/(?:uc|open|thumbnail)(?:\/)?\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i);
    if (qMatch && qMatch[1]) return qMatch[1];
    const fileMatch = raw.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i);
    if (fileMatch && fileMatch[1]) return fileMatch[1];
    const lh3Match = raw.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/i);
    if (lh3Match && lh3Match[1]) return lh3Match[1];
    return '';
  }

  function normalizeDriveImageUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^data:/i.test(raw) || /lh3\.googleusercontent\.com\/d\//i.test(raw)) {
      return raw;
    }
    const fileId = extractDriveFileId(raw);
    if (fileId) {
      return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
    }
    return raw;
  }

  function getDriveImageFallbackUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || /^data:/i.test(raw)) return '';
    const fileId = extractDriveFileId(raw);
    if (!fileId) return '';
    if (/drive\.google\.com\/thumbnail/i.test(raw)) {
      return `https://lh3.googleusercontent.com/d/${fileId}=w400`;
    }
    return '';
  }

  function getInitials(name, fallback) {
    const fb = String(fallback || 'G').trim() || 'G';
    const clean = String(name || '').trim();
    if (!clean) return fb;
    const initials = clean
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
    return initials || fb;
  }

  function buildAvatarInnerHtml(name, fotoUrl, opts) {
    const cfg = opts && typeof opts === 'object' ? opts : {};
    const size = Number(cfg.size) > 0 ? Number(cfg.size) : 40;
    const fallbackInitial = String(cfg.fallback || 'G').trim() || 'G';
    const cleanName = String(name || '').trim() || fallbackInitial;
    const initials = getInitials(cleanName, fallbackInitial);
    const primarySrc = normalizeDriveImageUrl(fotoUrl);
    const driveAlt = getDriveImageFallbackUrl(primarySrc);
    const rawFallbackUrl = String(cfg.fallbackUrl || '').trim();
    const customFallback = rawFallbackUrl && rawFallbackUrl !== primarySrc ? rawFallbackUrl : '';
    const altSrc = driveAlt || customFallback;
    const altSrc2 = driveAlt && customFallback && customFallback !== driveAlt ? customFallback : '';

    if (primarySrc) {
      return `<img src="${esc(primarySrc)}" alt="Foto profil ${esc(cleanName)}" width="${size}" height="${size}" class="avatar-img" referrerpolicy="no-referrer" data-fallback-initials="${esc(initials)}"${altSrc ? ` data-fallback-src="${esc(altSrc)}"` : ''}${altSrc2 ? ` data-fallback-src2="${esc(altSrc2)}"` : ''} />`;
    }
    return esc(initials);
  }

  function bindAvatarFallbacks(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return;
    container.querySelectorAll('img[data-fallback-initials]').forEach((img) => {
      if (img.dataset.avatarBound === '1') return;
      img.dataset.avatarBound = '1';
      img.addEventListener('error', () => {
        if (img.dataset.fallbackSrc) {
          const next = img.dataset.fallbackSrc;
          delete img.dataset.fallbackSrc;
          img.src = next;
          return;
        }
        if (img.dataset.fallbackSrc2) {
          const next2 = img.dataset.fallbackSrc2;
          delete img.dataset.fallbackSrc2;
          img.src = next2;
          return;
        }
        const box = img.parentElement;
        if (box) box.textContent = img.dataset.fallbackInitials || 'G';
      });
    });
  }

  function renderAvatarElement(el, name, fotoUrl, opts) {
    if (!el) return;
    el.innerHTML = buildAvatarInnerHtml(name, fotoUrl, opts);
    bindAvatarFallbacks(el);
  }

  root.MDTA_UI = {
    esc,
    parseLocaleNumber,
    refreshIcons,
    formatDateId,
    formatDateShort,
    todayISO,
    nowTimeHMS,
    toast,
    setButtonLoading,
    renderSkeletonRows,
    renderStateBox,
    openModal,
    closeModal,
    confirmDialog,
    initSlidingTabs,
    bindSpotlights,
    canUseMotion,
    initMotionInteractions,
    getInitials,
    buildAvatarInnerHtml,
    bindAvatarFallbacks,
    renderAvatarElement,
  };

  // =========================================================================
  // STALE-WHILE-REVALIDATE (SWR) & CACHE LOCALSTORAGE + BOOTSTRAP 1-REQUEST
  // =========================================================================
  const CACHE_KEYS = [
    'kelas',
    'santri',
    'users',
    'dashboard',
    'rekapKepsek',
    'rekap',
    'nilaiUAS',
    'nilaiRaportSaved',
    'raportRows',
    'dokumenArsip',
    'logSetoran',
    'presensiToday',
    'absensiGuruToday',
  ];
  const bootstrapInflight = new Map();

  function cacheKeyFull(key) {
    return (CONFIG.CACHE_PREFIX || 'mdta_swr_v1_') + key;
  }

  function readCache(key) {
    try {
      if (!root.localStorage) return null;
      const raw = root.localStorage.getItem(cacheKeyFull(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      if (!root.localStorage) return;
      root.localStorage.setItem(cacheKeyFull(key), JSON.stringify({ data, ts: Date.now() }));
    } catch (err) {
      // Abaikan jika quota localStorage penuh atau private mode
    }
  }

  function removeCache(key) {
    try {
      if (!root.localStorage) return;
      root.localStorage.removeItem(cacheKeyFull(key));
    } catch (err) {
      // Abaikan
    }
  }

  function clearAllCache() {
    const prefix = CONFIG.CACHE_PREFIX || 'mdta_swr_v1_';
    try {
      if (root.localStorage) {
        const toRemove = [];
        for (let i = 0; i < root.localStorage.length; i++) {
          const k = root.localStorage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach((k) => root.localStorage.removeItem(k));
      }
    } catch (err) {
      // Abaikan
    }
    const st = root.MDTA_STATE;
    if (st) {
      st.kelas = [];
      st.santri = [];
      st.users = [];
      st.dashboard = null;
      st.rekapKepsek = null;
      st.rekapKepsekKey = '';
      st.rekap = [];
      st.lastRekapPeriod = null;
      st.nilaiUAS = [];
      st.nilaiRaportSaved = [];
      st.raportRows = [];
      st.dokumenArsip = [];
      st.logSetoran = [];
      st.presensiToday = [];
      st.absensiGuruToday = [];
      st.lastSyncAt = 0;
      st.localSyncTs = null;
      if (st.loaded) {
        Object.keys(st.loaded).forEach((k) => {
          st.loaded[k] = false;
        });
      }
    }
  }

  function hasChanged(prevVal, nextVal) {
    try {
      return JSON.stringify(prevVal) !== JSON.stringify(nextVal);
    } catch (err) {
      return true;
    }
  }

  function hydrateState() {
    const st = root.MDTA_STATE;
    if (!st) return;

    if ((!st.kelas || st.kelas.length === 0)) {
      const c = readCache('kelas');
      if (c && Array.isArray(c.data)) st.kelas = c.data;
    }
    if ((!st.santri || st.santri.length === 0)) {
      const c = readCache('santri');
      if (c && Array.isArray(c.data)) st.santri = c.data;
    }
    if ((!st.users || st.users.length === 0)) {
      const c = readCache('users');
      if (c && Array.isArray(c.data)) st.users = c.data;
    }
    if (!st.dashboard) {
      const c = readCache('dashboard');
      if (c && c.data) st.dashboard = c.data;
    }
    if (!st.rekapKepsek) {
      const c = readCache('rekapKepsek');
      if (c && c.data) {
        st.rekapKepsek = c.data.payload || c.data;
        st.rekapKepsekKey = c.data.key || '';
      }
    }
    const isValidNama = (r) => {
      const n = String((r && r.nama_santri) || '').trim();
      return Boolean(n && n !== '-');
    };
    if ((!st.nilaiRaportSaved || st.nilaiRaportSaved.length === 0)) {
      const c = readCache('nilaiRaportSaved');
      if (c && Array.isArray(c.data)) st.nilaiRaportSaved = c.data.filter(isValidNama);
    }
    if ((!st.dokumenArsip || st.dokumenArsip.length === 0)) {
      const c = readCache('dokumenArsip');
      if (c && Array.isArray(c.data)) st.dokumenArsip = c.data;
    }
    if ((!st.logSetoran || st.logSetoran.length === 0)) {
      const c = readCache('logSetoran');
      if (c && Array.isArray(c.data)) st.logSetoran = c.data;
    }
    if ((!st.nilaiUAS || st.nilaiUAS.length === 0)) {
      const c = readCache('nilaiUAS');
      if (c && Array.isArray(c.data)) st.nilaiUAS = c.data;
    }
    if ((!st.presensiToday || st.presensiToday.length === 0)) {
      const c = readCache('presensiToday');
      if (c && Array.isArray(c.data)) {
        const todayWib = todayISO();
        const cacheDate = c.ts ? normalizeISODate(new Date(c.ts)) : '';
        st.presensiToday = c.data.filter((r) => {
          const itemDate = normalizeISODate(r && r.tanggal);
          if (itemDate) return itemDate === todayWib;
          return cacheDate === todayWib;
        });
      }
    }
    if ((!st.absensiGuruToday || st.absensiGuruToday.length === 0)) {
      const c = readCache('absensiGuruToday');
      if (c && Array.isArray(c.data)) {
        const todayWib = todayISO();
        const cacheDate = c.ts ? normalizeISODate(new Date(c.ts)) : '';
        st.absensiGuruToday = c.data.filter((r) => {
          const itemDate = normalizeISODate(r && r.tanggal);
          if (itemDate) return itemDate === todayWib;
          return cacheDate === todayWib;
        });
      }
    }
    if ((!st.raportRows || st.raportRows.length === 0)) {
      const c = readCache('raportRows');
      if (c && Array.isArray(c.data)) st.raportRows = c.data.filter(isValidNama);
    }
  }

  async function fetchBootstrapSmart(params) {
    const p = params || {};
    const sess = getActiveSessionContext();
    const role = String(p.role || (sess && sess.role) || 'admin').trim().toLowerCase();
    const tanggal = p.tanggal || todayISO();
    const kelas = p.kelas || '';
    const inflightKey = `${role}|${tanggal}|${kelas}|${(sess && (sess.id_user || sess.username)) || ''}`;

    if (bootstrapInflight.has(inflightKey)) {
      return bootstrapInflight.get(inflightKey);
    }

    const promise = (async () => {
      try {
        const reqParams = { role, tanggal, kelas };
        const uid = p.id_user || (sess && sess.id_user) || '';
        const uname = p.username || (sess && sess.username) || '';
        if (uid) reqParams.id_user = uid;
        if (uname) reqParams.username = uname;
        const res = await root.MDTA_API.getBootstrapData(reqParams);
        const bundle = res.data || res;
        if (bundle && bundle.account_active === false) {
          if (root.MDTA_AUTH && typeof root.MDTA_AUTH.forceLogout === 'function') {
            root.MDTA_AUTH.forceLogout('Akun Anda sudah dinonaktifkan oleh Administrator.');
          }
          throw new Error('Akun Anda sudah dinonaktifkan.');
        }
        return bundle;
      } catch (err) {
        const msg = String((err && err.message) || '');
        if (!/tidak dikenali/i.test(msg)) {
          throw err;
        }
        // Fallback kompatibel bila Apps Script masih versi lama
        const synthesizeKelas = (santriArr) => {
          const seen = new Set();
          (santriArr || []).forEach((s) => {
            const k = String((s && s.kelas) || '').trim();
            if (k) seen.add(k);
          });
          return Array.from(seen).sort().map((namaKelas, i) => ({
            id_kelas: `KLS-${String(i + 1).padStart(3, '0')}`,
            nama_kelas: namaKelas,
            tingkat: '',
            keterangan: 'Sinkron dari santri',
            status: 'aktif',
          }));
        };

        if (role === 'guru') {
          const [sRes, pRes, rptRes, uasRes, logRes, kRes] = await Promise.allSettled([
            root.MDTA_API.getSantri(),
            root.MDTA_API.getPresensi(),
            root.MDTA_API.getNilaiRaport(),
            root.MDTA_API.getNilaiUAS(),
            root.MDTA_API.getLogSetoran({}),
            root.MDTA_API.getKelas(),
          ]);
          const santriRaw = sRes.status === 'fulfilled' ? extractArray(sRes.value, ['santri']) : [];
          const kelasRaw = kRes.status === 'fulfilled' ? extractArray(kRes.value, ['kelas']) : synthesizeKelas(santriRaw);
          const allPresensi =
            pRes.status === 'fulfilled' ? extractArray(pRes.value, ['presensi']).map(normalizePresensi) : [];
          return {
            dashboard: null,
            rekap_kepsek: null,
            kelas: kelasRaw,
            kelas_ampu: sess ? parseKelasAmpu(sess.kelas_ampu) : [],
            santri: santriRaw,
            users: [],
            nilai_raport: rptRes.status === 'fulfilled' ? extractArray(rptRes.value, ['raport']) : [],
            nilai_uas: uasRes.status === 'fulfilled' ? extractArray(uasRes.value, ['nilai_uas']) : [],
            dokumen_arsip: [],
            log_setoran: logRes.status === 'fulfilled' ? extractArray(logRes.value, ['log_setoran']) : [],
            presensi_hari_ini: allPresensi.filter((r) => !tanggal || r.tanggal === tanggal).reverse(),
            fetched_at: new Date().toISOString(),
          };
        }

        const [rkRes, dRes, sRes, rptRes, uasRes, docRes, logRes, kRes] = await Promise.allSettled([
          root.MDTA_API.getRekapKepsek(tanggal, kelas),
          root.MDTA_API.getDashboard(),
          root.MDTA_API.getSantri(),
          root.MDTA_API.getNilaiRaport(),
          root.MDTA_API.getNilaiUAS(),
          root.MDTA_API.getDokumenArsip(),
          root.MDTA_API.getLogSetoran({}),
          root.MDTA_API.getKelas(),
        ]);
        const dashData = dRes.status === 'fulfilled' ? dRes.value.data || dRes.value : null;
        const santriRaw = sRes.status === 'fulfilled' ? extractArray(sRes.value, ['santri']) : [];
        const kelasRaw = kRes.status === 'fulfilled' ? extractArray(kRes.value, ['kelas']) : synthesizeKelas(santriRaw);
        return {
          dashboard: dashData,
          rekap_kepsek: rkRes.status === 'fulfilled' ? rkRes.value.data || rkRes.value : null,
          kelas: kelasRaw,
          kelas_ampu: [],
          santri: santriRaw,
          users: dashData && Array.isArray(dashData.daftar_pengguna) ? dashData.daftar_pengguna : [],
          nilai_raport: rptRes.status === 'fulfilled' ? extractArray(rptRes.value, ['raport']) : [],
          nilai_uas: uasRes.status === 'fulfilled' ? extractArray(uasRes.value, ['nilai_uas']) : [],
          dokumen_arsip: docRes.status === 'fulfilled' ? extractArray(docRes.value, ['dokumen']) : [],
          log_setoran: logRes.status === 'fulfilled' ? extractArray(logRes.value, ['log_setoran']) : [],
          presensi_hari_ini: [],
          fetched_at: new Date().toISOString(),
        };
      }
    })().finally(() => {
      bootstrapInflight.delete(inflightKey);
    });

    bootstrapInflight.set(inflightKey, promise);
    return promise;
  }

  root.MDTA_CACHE = {
    KEYS: CACHE_KEYS,
    read: readCache,
    write: writeCache,
    remove: removeCache,
    clearAll: clearAllCache,
    hasChanged,
    hydrateState,
    fetchBootstrapSmart,
  };

  root.MDTA_API = {
    cache: root.MDTA_CACHE,
    requestGet,
    requestPost,
    pick,
    extractArray,
    parseLocaleNumber,
    isSheetErrorValue,
    computeRaportGrade,
    resolveRaportNilai,
    parseKelasAmpu,
    formatKelasAmpu,
    isKelasAllowed,
    isActiveSantri,
    filterByGuruScope,
    normalizeKelas,
    getOfficialKelasNames,
    normalizeSantri,
    normalizeUser,
    normalizePresensi,
    normalizeRekap,
    normalizeNilaiUAS,
    normalizeNilaiRaport,
    normalizeDokumen,
    normalizeLogSetoran,
    normalizeKategoriProgram,
    normalizeISODate,
    formatTTL,
    formatWhatsAppUrl,
    extractDriveFileId,
    normalizeDriveImageUrl,
    getDriveImageFallbackUrl,

    ping: () => requestGet('ping'),
    login: (username, password) => requestPost('login', { username, password }),

    getDashboard: () => requestGet('getDashboard'),
    getUsers: () => requestGet('getUsers'),
    saveUser: (userData) => requestPost('saveUser', { data: userData }),
    deleteUser: (idUser) => requestPost('deleteUser', { id_user: idUser }),

    getKelas: () => requestGet('getKelas'),
    saveKelas: (kelasData) => requestPost('saveKelas', { data: kelasData }),
    deleteKelas: (payload) =>
      requestPost(
        'deleteKelas',
        typeof payload === 'object' && payload !== null ? payload : { id_kelas: payload }
      ),
    saveKelasMapping: (mappingData) => requestPost('saveKelasMapping', { data: mappingData }),
    saveKelasSantri: (mappingData) => requestPost('saveKelasSantri', { data: mappingData }),
    bulkMoveSantriKelas: (moveData) => requestPost('bulkMoveSantriKelas', { data: moveData }),

    getSantri: () => requestGet('getSantri'),
    saveSantri: (santriData) => requestPost('saveSantri', { data: santriData }),
    deleteSantri: (idSantri) => requestPost('deleteSantri', { id_santri: idSantri }),

    getPresensi: () => requestGet('getPresensi'),
    savePresensi: (presensiData) => requestPost('savePresensi', { data: presensiData }),
    clearPresensiHarian: (params) => requestPost('clearPresensiHarian', params || {}),

    getRekapLaporan: (bulan, tahun, extra) => requestGet('getRekapLaporan', Object.assign({ bulan, tahun }, extra || {})),
    getMonitoringGuru: (params) => requestGet('getMonitoringGuru', params || {}),
    updateProfilGuru: (profilData) => requestPost('updateProfilGuru', { data: profilData }),
    saveAbsensiGuru: (absenData) => requestPost('saveAbsensiGuru', { data: absenData }),
    verifikasiAbsensiGuru: (verifData) => requestPost('verifikasiAbsensiGuru', { data: verifData }),

    getNilaiUAS: () => requestGet('getNilaiUAS'),
    saveNilaiUAS: (uasData) => requestPost('saveNilaiUAS', { data: uasData }),
    deleteNilaiUAS: (idUas) => requestPost('deleteNilaiUAS', { id_uas: idUas }),

    getNilaiRaport: () => requestGet('getNilaiRaport'),
    saveNilaiRaport: (itemsArray) => requestPost('saveNilaiRaport', { data: itemsArray }),

    getDokumenArsip: () => requestGet('getDokumenArsip'),
    uploadDokumenDrive: (docData) => requestPost('uploadDokumenDrive', { data: docData }),
    importNilaiAI: (aiData) => requestPost('importNilaiAI', { data: aiData }),

    submitLaporanGuru: (reportData) => requestPost('submitLaporanGuru', { data: reportData }),
    getLogSetoran: (params) => requestGet('getLogSetoran', params),
    getRekapKepsek: (tanggal, kelas) => requestGet('getRekapKepsek', { tanggal, kelas }),
    getBootstrapData: (params) => requestGet('getBootstrapData', params),
    getSyncVersion: () => requestGet('getSyncVersion', { _t: Date.now() }),
  };
})(window);
