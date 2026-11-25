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
    initCustomSelects(backdrop);
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

    const rippleSelector = '.btn, .report-mode-btn, .drawer-nav-item, .kelas-subtab, .filter-chip, .manual-status-btn, .user-session-chip, .day-chip, .cselect-trigger, .cselect-option';
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
  // CUSTOM SELECT COMPONENT (DESKTOP POPOVER & MOBILE BOTTOM SHEET)
  // =========================================================================
  let customSelectGlobalBound = false;
  let customSelectObserver = null;
  let cselectPortalEl = null;
  let cselectBackdropEl = null;
  let cselectPanelEl = null;
  let cselectTitleEl = null;
  let cselectCloseBtn = null;
  let cselectOptionsEl = null;
  let cselectActiveSelect = null;
  let cselectCloseTimer = null;
  let cselectOpenKeyHandler = null;
  let cselectOuterScrollHandler = null;
  let cselectResizeHandler = null;

  function resolveSelectLabel(selectEl) {
    if (!selectEl) return 'Pilih Opsi';
    const doc = selectEl.ownerDocument || document;
    if (selectEl.id && doc && typeof doc.querySelector === 'function') {
      try {
        const linkedLabel = doc.querySelector(`label[for="${selectEl.id}"]`);
        if (linkedLabel && linkedLabel.textContent) {
          const clean = String(linkedLabel.textContent).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
          if (clean) return clean;
        }
      } catch (err) {
        // Abaikan selector fallback
      }
    }
    const parentLabel = typeof selectEl.closest === 'function' ? selectEl.closest('label') : null;
    if (parentLabel && parentLabel.textContent) {
      const clean = String(parentLabel.textContent).replace(/\*/g, '').replace(/\s+/g, ' ').trim();
      if (clean) return clean;
    }
    const aria = selectEl.getAttribute ? selectEl.getAttribute('aria-label') : '';
    if (aria && aria.trim()) return aria.trim();
    const titleAttr = selectEl.getAttribute ? selectEl.getAttribute('title') : '';
    if (titleAttr && titleAttr.trim()) return titleAttr.trim();
    return 'Pilih Opsi';
  }

  function getSelectedOptionFor(selectEl) {
    if (!selectEl) return null;
    const opts = Array.from(selectEl.options || []);
    if (opts.length === 0) return null;
    const val = String(selectEl.value ?? '');
    if (typeof selectEl.selectedIndex === 'number' && selectEl.selectedIndex >= 0 && opts[selectEl.selectedIndex]) {
      if (String(opts[selectEl.selectedIndex].value ?? '') === val || val === '') {
        return opts[selectEl.selectedIndex];
      }
    }
    return opts.find((o) => String(o.value ?? '') === val) || opts[0];
  }

  function setNativeSelectValue(selectEl, nextVal) {
    if (!selectEl) return;
    const valStr = nextVal === undefined || nextVal === null ? '' : String(nextVal);
    if (selectEl._cselectOrigValueDesc && typeof selectEl._cselectOrigValueDesc.set === 'function') {
      selectEl._cselectOrigValueDesc.set.call(selectEl, valStr);
    } else {
      selectEl.value = valStr;
    }
  }

  function patchSelectDescriptors(selectEl) {
    if (!selectEl || selectEl._cselectPatched) return;
    if (typeof root.HTMLSelectElement !== 'function' || typeof root.HTMLElement !== 'function') return;
    try {
      const selectProto = root.HTMLSelectElement.prototype;
      const htmlProto = root.HTMLElement.prototype;
      const valueDesc = Object.getOwnPropertyDescriptor(selectProto, 'value');
      const indexDesc = Object.getOwnPropertyDescriptor(selectProto, 'selectedIndex');
      const disabledDesc = Object.getOwnPropertyDescriptor(selectProto, 'disabled');
      const hiddenDesc = Object.getOwnPropertyDescriptor(htmlProto, 'hidden');

      selectEl._cselectOrigValueDesc = valueDesc || null;

      if (valueDesc && valueDesc.get && valueDesc.set) {
        Object.defineProperty(selectEl, 'value', {
          configurable: true,
          enumerable: valueDesc.enumerable,
          get() {
            return valueDesc.get.call(this);
          },
          set(v) {
            valueDesc.set.call(this, v);
            syncCustomSelect(this);
          },
        });
      }
      if (indexDesc && indexDesc.get && indexDesc.set) {
        Object.defineProperty(selectEl, 'selectedIndex', {
          configurable: true,
          enumerable: indexDesc.enumerable,
          get() {
            return indexDesc.get.call(this);
          },
          set(v) {
            indexDesc.set.call(this, v);
            syncCustomSelect(this);
          },
        });
      }
      if (disabledDesc && disabledDesc.get && disabledDesc.set) {
        Object.defineProperty(selectEl, 'disabled', {
          configurable: true,
          enumerable: disabledDesc.enumerable,
          get() {
            return disabledDesc.get.call(this);
          },
          set(v) {
            disabledDesc.set.call(this, v);
            syncCustomSelect(this);
          },
        });
      }
      if (hiddenDesc && hiddenDesc.get && hiddenDesc.set) {
        Object.defineProperty(selectEl, 'hidden', {
          configurable: true,
          enumerable: hiddenDesc.enumerable,
          get() {
            return hiddenDesc.get.call(this);
          },
          set(v) {
            hiddenDesc.set.call(this, v);
            syncCustomSelect(this);
          },
        });
      }
      selectEl._cselectPatched = true;
    } catch (err) {
      // Abaikan jika environment mock tidak mendukung defineProperty pada elemen DOM
    }
  }

  function ensureCustomSelectPortal() {
    if (cselectPortalEl) return cselectPortalEl;
    if (typeof document === 'undefined' || !document.body || typeof document.createElement !== 'function') {
      return null;
    }
    const portal = document.createElement('div');
    portal.id = 'cselect-portal';
    portal.className = 'cselect-portal';
    portal.hidden = true;

    const backdrop = document.createElement('div');
    backdrop.className = 'cselect-backdrop';

    const panel = document.createElement('div');
    panel.className = 'cselect-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    const handle = document.createElement('div');
    handle.className = 'cselect-sheet-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.appendChild(document.createElement('span'));

    const sheetHead = document.createElement('div');
    sheetHead.className = 'cselect-sheet-head';

    const sheetTitle = document.createElement('div');
    sheetTitle.className = 'cselect-sheet-title';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cselect-sheet-close';
    closeBtn.setAttribute('aria-label', 'Tutup pilihan');
    closeBtn.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';

    sheetHead.appendChild(sheetTitle);
    sheetHead.appendChild(closeBtn);

    const optionsList = document.createElement('div');
    optionsList.className = 'cselect-options';
    optionsList.setAttribute('role', 'listbox');

    panel.appendChild(handle);
    panel.appendChild(sheetHead);
    panel.appendChild(optionsList);
    portal.appendChild(backdrop);
    portal.appendChild(panel);
    document.body.appendChild(portal);

    backdrop.addEventListener('click', () => closeCustomSelect({ restoreFocus: true }));
    closeBtn.addEventListener('click', () => closeCustomSelect({ restoreFocus: true }));
    refreshIcons(portal);

    cselectPortalEl = portal;
    cselectBackdropEl = backdrop;
    cselectPanelEl = panel;
    cselectTitleEl = sheetTitle;
    cselectCloseBtn = closeBtn;
    cselectOptionsEl = optionsList;
    return portal;
  }

  function createCustomOptionButton(optEl, selectedOpt, inheritedDisabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cselect-option';
    btn.setAttribute('role', 'option');
    const optVal = String(optEl.value ?? '');
    const isDisabled = Boolean(optEl.disabled || inheritedDisabled);
    const isSelected = Boolean(optEl === selectedOpt || optEl.selected);

    btn.dataset.value = optVal;
    btn.disabled = isDisabled;
    if (isDisabled) btn.classList.add('is-disabled');
    btn.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    if (isSelected) btn.classList.add('is-selected');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'cselect-option-label';
    labelSpan.textContent = String(optEl.textContent || optVal || '').trim() || '-';
    btn.appendChild(labelSpan);

    if (isSelected) {
      const checkSpan = document.createElement('span');
      checkSpan.className = 'cselect-option-check';
      checkSpan.setAttribute('aria-hidden', 'true');
      checkSpan.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
      btn.appendChild(checkSpan);
    }

    btn.addEventListener('click', () => {
      if (isDisabled || !cselectActiveSelect) return;
      const targetSelect = cselectActiveSelect;
      const prevVal = String(targetSelect.value ?? '');
      setNativeSelectValue(targetSelect, optVal);
      syncCustomSelect(targetSelect);
      closeCustomSelect({ restoreFocus: true });
      if (prevVal !== optVal || targetSelect.selectedIndex >= 0) {
        let evt;
        if (typeof Event === 'function') {
          evt = new Event('change', { bubbles: true });
        } else {
          evt = { type: 'change', bubbles: true, target: targetSelect };
        }
        targetSelect.dispatchEvent(evt);
      }
    });
    return btn;
  }

  function renderCustomSelectOptions(selectEl) {
    if (!cselectOptionsEl || !selectEl) return;
    cselectOptionsEl.innerHTML = '';
    const selectedOpt = getSelectedOptionFor(selectEl);
    const childNodes = Array.from(selectEl.children || []);
    let renderedCount = 0;

    if (childNodes.length > 0) {
      childNodes.forEach((child) => {
        const tag = String(child.tagName || '').toLowerCase();
        if (tag === 'optgroup') {
          const groupDiv = document.createElement('div');
          groupDiv.className = 'cselect-optgroup';
          groupDiv.setAttribute('role', 'group');
          const groupLabel = String(child.getAttribute ? child.getAttribute('label') || child.label || '' : child.label || '').trim();
          if (groupLabel) {
            groupDiv.setAttribute('aria-label', groupLabel);
            const labelEl = document.createElement('div');
            labelEl.className = 'cselect-optgroup-label';
            labelEl.textContent = groupLabel;
            groupDiv.appendChild(labelEl);
          }
          const groupDisabled = Boolean(child.disabled);
          Array.from(child.children || []).forEach((subChild) => {
            if (String(subChild.tagName || '').toLowerCase() === 'option') {
              groupDiv.appendChild(createCustomOptionButton(subChild, selectedOpt, groupDisabled));
              renderedCount += 1;
            }
          });
          cselectOptionsEl.appendChild(groupDiv);
        } else if (tag === 'option') {
          cselectOptionsEl.appendChild(createCustomOptionButton(child, selectedOpt, false));
          renderedCount += 1;
        }
      });
    } else {
      Array.from(selectEl.options || []).forEach((optEl) => {
        cselectOptionsEl.appendChild(createCustomOptionButton(optEl, selectedOpt, false));
        renderedCount += 1;
      });
    }

    if (renderedCount === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'cselect-empty';
      emptyEl.textContent = 'Tidak ada pilihan tersedia';
      cselectOptionsEl.appendChild(emptyEl);
    }

    refreshIcons(cselectPortalEl);
  }

  function positionCustomSelectPortal(selectEl) {
    if (!cselectPortalEl || !cselectPanelEl || !cselectOptionsEl || !selectEl || !selectEl._cselectMeta) return;
    const { trigger, labelText } = selectEl._cselectMeta;
    const vw = typeof root.innerWidth === 'number' ? root.innerWidth : 1024;
    const vh = typeof root.innerHeight === 'number' ? root.innerHeight : 768;
    const isMobile = vw <= 768;

    cselectPortalEl.classList.toggle('is-mobile', isMobile);
    cselectPortalEl.classList.toggle('is-desktop', !isMobile);

    const resolvedLabel = resolveSelectLabel(selectEl) || labelText || 'Pilih Opsi';
    if (cselectTitleEl) cselectTitleEl.textContent = resolvedLabel;
    cselectPanelEl.setAttribute('aria-label', resolvedLabel);

    if (isMobile) {
      cselectPanelEl.style.left = '';
      cselectPanelEl.style.top = '';
      cselectPanelEl.style.bottom = '';
      cselectPanelEl.style.width = '';
      cselectOptionsEl.style.maxHeight = '';
      cselectPanelEl.classList.remove('is-above', 'is-below');
      if (document.body) document.body.classList.add('cselect-mobile-open');
      return;
    }

    if (document.body) document.body.classList.remove('cselect-mobile-open');
    const rect =
      trigger && typeof trigger.getBoundingClientRect === 'function'
        ? trigger.getBoundingClientRect()
        : { left: 16, top: 100, bottom: 140, width: 240 };

    const menuWidth = Math.min(Math.max(Math.round(rect.width || 240), 200), Math.min(420, Math.max(220, vw - 24)));
    const left = Math.min(Math.max(12, Math.round(rect.left || 16)), Math.max(12, vw - menuWidth - 12));
    const spaceBelow = Math.max(0, vh - (rect.bottom || 140) - 12);
    const spaceAbove = Math.max(0, (rect.top || 100) - 12);
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;

    cselectPanelEl.style.width = `${menuWidth}px`;
    cselectPanelEl.style.left = `${left}px`;
    cselectPanelEl.classList.toggle('is-above', openAbove);
    cselectPanelEl.classList.toggle('is-below', !openAbove);

    if (openAbove) {
      cselectPanelEl.style.top = 'auto';
      cselectPanelEl.style.bottom = `${Math.max(12, Math.round(vh - rect.top + 6))}px`;
      cselectOptionsEl.style.maxHeight = `${Math.min(280, Math.max(130, Math.floor(spaceAbove - 14)))}px`;
    } else {
      cselectPanelEl.style.bottom = 'auto';
      cselectPanelEl.style.top = `${Math.round(rect.bottom + 6)}px`;
      cselectOptionsEl.style.maxHeight = `${Math.min(280, Math.max(130, Math.floor(spaceBelow - 14)))}px`;
    }
  }

  function detachCustomSelectGlobalOpenListeners() {
    if (typeof document !== 'undefined' && cselectOpenKeyHandler) {
      document.removeEventListener('keydown', cselectOpenKeyHandler, true);
      cselectOpenKeyHandler = null;
    }
    if (typeof document !== 'undefined' && cselectOuterScrollHandler) {
      document.removeEventListener('scroll', cselectOuterScrollHandler, true);
      cselectOuterScrollHandler = null;
    }
    if (typeof root !== 'undefined' && typeof root.removeEventListener === 'function' && cselectResizeHandler) {
      root.removeEventListener('resize', cselectResizeHandler);
      cselectResizeHandler = null;
    }
  }

  function closeCustomSelect(opts) {
    if (!cselectPortalEl) return;
    const prevSelect = cselectActiveSelect;
    cselectActiveSelect = null;

    if (cselectCloseTimer) {
      clearTimeout(cselectCloseTimer);
      cselectCloseTimer = null;
    }
    detachCustomSelectGlobalOpenListeners();

    if (prevSelect && prevSelect._cselectMeta) {
      prevSelect._cselectMeta.wrap.classList.remove('is-open');
      prevSelect._cselectMeta.trigger.setAttribute('aria-expanded', 'false');
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.remove('cselect-mobile-open');
    }

    const shouldRestoreFocus = !opts || opts.restoreFocus !== false;
    if (shouldRestoreFocus && prevSelect && prevSelect._cselectMeta && prevSelect._cselectMeta.trigger) {
      const trg = prevSelect._cselectMeta.trigger;
      if (typeof trg.focus === 'function' && !trg.disabled) {
        trg.focus();
      }
    }

    if (cselectPortalEl.hidden) return;
    if (canUseMotion()) {
      cselectPortalEl.classList.add('is-closing');
      cselectCloseTimer = setTimeout(() => {
        cselectCloseTimer = null;
        if (!cselectPortalEl) return;
        cselectPortalEl.classList.remove('is-closing');
        cselectPortalEl.hidden = true;
      }, 180);
    } else {
      cselectPortalEl.classList.remove('is-closing');
      cselectPortalEl.hidden = true;
    }
  }

  function openCustomSelect(selectEl) {
    if (!selectEl || !selectEl._cselectMeta || selectEl.disabled) return;
    const portal = ensureCustomSelectPortal();
    if (!portal) return;

    if (cselectActiveSelect === selectEl && !portal.hidden && !portal.classList.contains('is-closing')) {
      closeCustomSelect({ restoreFocus: true });
      return;
    }

    if (cselectCloseTimer) {
      clearTimeout(cselectCloseTimer);
      cselectCloseTimer = null;
    }
    portal.classList.remove('is-closing');

    if (cselectActiveSelect && cselectActiveSelect !== selectEl && cselectActiveSelect._cselectMeta) {
      cselectActiveSelect._cselectMeta.wrap.classList.remove('is-open');
      cselectActiveSelect._cselectMeta.trigger.setAttribute('aria-expanded', 'false');
    }

    cselectActiveSelect = selectEl;
    selectEl._cselectMeta.wrap.classList.add('is-open');
    selectEl._cselectMeta.trigger.setAttribute('aria-expanded', 'true');

    renderCustomSelectOptions(selectEl);
    positionCustomSelectPortal(selectEl);
    portal.hidden = false;

    detachCustomSelectGlobalOpenListeners();
    cselectOpenKeyHandler = (e) => {
      if (!cselectActiveSelect) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        closeCustomSelect({ restoreFocus: true });
        return;
      }
      if (e.key === 'Tab') {
        closeCustomSelect({ restoreFocus: false });
        return;
      }
      if (!cselectOptionsEl) return;
      const enabledOpts = Array.from(cselectOptionsEl.querySelectorAll('.cselect-option')).filter((o) => !o.disabled);
      if (enabledOpts.length === 0) return;
      const activeIdx = enabledOpts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = activeIdx >= 0 ? (activeIdx + 1) % enabledOpts.length : 0;
        enabledOpts[nextIdx].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = activeIdx > 0 ? activeIdx - 1 : enabledOpts.length - 1;
        enabledOpts[prevIdx].focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        enabledOpts[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        enabledOpts[enabledOpts.length - 1].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (document.activeElement && enabledOpts.includes(document.activeElement)) {
          e.preventDefault();
          document.activeElement.click();
        }
      }
    };
    document.addEventListener('keydown', cselectOpenKeyHandler, true);

    cselectOuterScrollHandler = (e) => {
      if (!cselectPortalEl || cselectPortalEl.hidden) return;
      if (e && e.target && (e.target === cselectPortalEl || cselectPortalEl.contains(e.target))) {
        return;
      }
      if (cselectPortalEl.classList.contains('is-desktop')) {
        closeCustomSelect({ restoreFocus: false });
      }
    };
    document.addEventListener('scroll', cselectOuterScrollHandler, true);

    if (typeof root.addEventListener === 'function') {
      cselectResizeHandler = () => {
        if (cselectActiveSelect && cselectPortalEl && !cselectPortalEl.hidden) {
          positionCustomSelectPortal(cselectActiveSelect);
        }
      };
      root.addEventListener('resize', cselectResizeHandler);
    }

    const focusInitialOption = () => {
      if (!cselectOptionsEl) return;
      const selectedBtn = cselectOptionsEl.querySelector('.cselect-option.is-selected:not(:disabled)');
      const targetBtn = selectedBtn || cselectOptionsEl.querySelector('.cselect-option:not(:disabled)');
      if (targetBtn) {
        if (typeof targetBtn.scrollIntoView === 'function') {
          try {
            targetBtn.scrollIntoView({ block: 'nearest' });
          } catch (err) {
            // Abaikan pada environment mock
          }
        }
        if (typeof targetBtn.focus === 'function') {
          targetBtn.focus();
        }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusInitialOption);
    } else {
      focusInitialOption();
    }
  }

  function syncCustomSelect(selectEl) {
    if (!selectEl || !selectEl._cselectMeta) return;
    const { wrap, trigger, valueEl } = selectEl._cselectMeta;
    const isHidden = Boolean(selectEl.hidden || (selectEl.hasAttribute && selectEl.hasAttribute('hidden')));
    const isDisabled = Boolean(selectEl.disabled || (selectEl.hasAttribute && selectEl.hasAttribute('disabled')));

    wrap.hidden = isHidden;
    trigger.disabled = isDisabled;
    wrap.classList.toggle('is-disabled', isDisabled);
    wrap.classList.toggle('is-table-select', Boolean(selectEl.classList && selectEl.classList.contains('table-input')));

    if (isHidden && cselectActiveSelect === selectEl) {
      closeCustomSelect({ restoreFocus: false });
    }

    const selectedOpt = getSelectedOptionFor(selectEl);
    const labelText = resolveSelectLabel(selectEl);
    selectEl._cselectMeta.labelText = labelText;
    trigger.setAttribute('aria-label', labelText);

    let displayText = 'Pilih...';
    let isPlaceholder = true;
    if (selectedOpt) {
      displayText = String(selectedOpt.textContent || selectedOpt.value || '').trim() || 'Pilih...';
      const optVal = String(selectedOpt.value ?? '');
      isPlaceholder = optVal === '' && (/^[- ]*pilih/i.test(displayText) || /^--/.test(displayText));
    } else if (Array.from(selectEl.options || []).length === 0) {
      displayText = 'Belum ada opsi';
    }

    valueEl.textContent = displayText;
    valueEl.classList.toggle('is-placeholder', isPlaceholder);

    if (cselectActiveSelect === selectEl && cselectPortalEl && !cselectPortalEl.hidden) {
      renderCustomSelectOptions(selectEl);
      positionCustomSelectPortal(selectEl);
    }
  }

  function enhanceCustomSelect(selectEl) {
    if (!selectEl || String(selectEl.tagName || '').toLowerCase() !== 'select') return null;
    if (selectEl._cselectMeta) {
      syncCustomSelect(selectEl);
      return selectEl._cselectMeta;
    }
    if (selectEl.dataset && selectEl.dataset.nativeSelect === 'true') return null;
    if (!selectEl.parentNode || typeof selectEl.parentNode.insertBefore !== 'function') return null;

    const wrap = document.createElement('div');
    wrap.className = 'cselect-wrap';
    if (selectEl.classList && selectEl.classList.contains('table-input')) {
      wrap.classList.add('is-table-select');
    }
    if (selectEl.style) {
      if (selectEl.style.maxWidth) {
        wrap.style.maxWidth = selectEl.style.maxWidth;
        selectEl.style.maxWidth = '';
      }
      if (selectEl.style.minWidth) {
        wrap.style.minWidth = selectEl.style.minWidth;
        selectEl.style.minWidth = '';
      }
      if (selectEl.style.flex) {
        wrap.style.flex = selectEl.style.flex;
        selectEl.style.flex = '';
      }
      if (selectEl.style.width) {
        wrap.style.width = selectEl.style.width;
      }
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cselect-trigger';
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const valueEl = document.createElement('span');
    valueEl.className = 'cselect-value';

    const chevronEl = document.createElement('span');
    chevronEl.className = 'cselect-chevron';
    chevronEl.setAttribute('aria-hidden', 'true');
    chevronEl.innerHTML = '<i data-lucide="chevron-down" aria-hidden="true"></i>';

    trigger.appendChild(valueEl);
    trigger.appendChild(chevronEl);

    const parent = selectEl.parentNode;
    parent.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    wrap.appendChild(trigger);

    if (selectEl.classList) selectEl.classList.add('cselect-native');
    selectEl.tabIndex = -1;
    selectEl.setAttribute('aria-hidden', 'true');

    selectEl._cselectMeta = {
      wrap,
      trigger,
      valueEl,
      labelText: resolveSelectLabel(selectEl),
    };

    patchSelectDescriptors(selectEl);
    syncCustomSelect(selectEl);
    refreshIcons(wrap);

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      openCustomSelect(selectEl);
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCustomSelect(selectEl);
      }
    });
    selectEl.addEventListener('invalid', () => {
      if (typeof trigger.focus === 'function' && !trigger.disabled) {
        trigger.focus();
      }
    });

    return selectEl._cselectMeta;
  }

  function bindGlobalCustomSelectListeners() {
    if (customSelectGlobalBound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return;
    }
    customSelectGlobalBound = true;

    document.addEventListener('change', (e) => {
      const target = e && e.target;
      if (target && String(target.tagName || '').toLowerCase() === 'select' && target._cselectMeta) {
        syncCustomSelect(target);
      }
    });

    document.addEventListener('reset', (e) => {
      const formEl = e && e.target;
      if (!formEl || typeof formEl.querySelectorAll !== 'function') return;
      setTimeout(() => {
        formEl.querySelectorAll('select').forEach((sel) => syncCustomSelect(sel));
      }, 0);
    });

    document.addEventListener('click', (e) => {
      const lbl = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('label[for]') : null;
      if (!lbl) return;
      const forId = lbl.getAttribute('for');
      if (!forId) return;
      const targetEl = document.getElementById(forId);
      if (targetEl && String(targetEl.tagName || '').toLowerCase() === 'select' && targetEl._cselectMeta) {
        e.preventDefault();
        const trg = targetEl._cselectMeta.trigger;
        if (trg && !trg.disabled && typeof trg.focus === 'function') {
          trg.focus();
        }
      }
    });

    if (typeof root.MutationObserver === 'function' && document.body && !customSelectObserver) {
      customSelectObserver = new root.MutationObserver((mutations) => {
        const selectsToSync = new Set();
        mutations.forEach((m) => {
          if (m.type === 'childList') {
            Array.from(m.addedNodes || []).forEach((node) => {
              if (!node || node.nodeType !== 1) return;
              const tag = String(node.tagName || '').toLowerCase();
              if (tag === 'select') {
                enhanceCustomSelect(node);
              } else if (tag === 'option' || tag === 'optgroup') {
                const owner = typeof node.closest === 'function' ? node.closest('select') : null;
                if (owner) selectsToSync.add(owner);
              } else if (typeof node.querySelectorAll === 'function') {
                node.querySelectorAll('select').forEach((sel) => enhanceCustomSelect(sel));
              }
            });
            const parentSelect =
              m.target && String(m.target.tagName || '').toLowerCase() === 'select'
                ? m.target
                : m.target && typeof m.target.closest === 'function'
                  ? m.target.closest('select')
                  : null;
            if (parentSelect && parentSelect._cselectMeta) {
              selectsToSync.add(parentSelect);
            }
          } else if (m.type === 'attributes' && m.target) {
            const tag = String(m.target.tagName || '').toLowerCase();
            if (tag === 'select' && m.target._cselectMeta) {
              selectsToSync.add(m.target);
            } else if ((tag === 'option' || tag === 'optgroup') && typeof m.target.closest === 'function') {
              const owner = m.target.closest('select');
              if (owner && owner._cselectMeta) selectsToSync.add(owner);
            }
          }
        });
        selectsToSync.forEach((sel) => syncCustomSelect(sel));
      });
      customSelectObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['disabled', 'hidden', 'label', 'selected'],
      });
    }
  }

  function initCustomSelects(scope) {
    if (typeof document === 'undefined') return;
    bindGlobalCustomSelectListeners();
    const container = scope || document;
    if (!container || typeof container.querySelectorAll !== 'function') return;
    const selects = Array.from(container.querySelectorAll('select'));
    selects.forEach((sel) => enhanceCustomSelect(sel));
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

  const DAY_SHORT_ORDER = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
  const DAY_FULL_NAMES = {
    Sen: 'Senin',
    Sel: 'Selasa',
    Rab: 'Rabu',
    Kam: 'Kamis',
    Jum: 'Jumat',
    Sab: 'Sabtu',
    Min: 'Minggu',
  };

  function defaultHariMengajarForProgram(kategoriProgram) {
    const kat = normalizeKategoriProgram(kategoriProgram, '');
    return kat === 'Wustho'
      ? ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
      : ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
  }

  function mapSingleHariToken(tok) {
    const clean = String(tok || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    if (!clean) return '';
    if (clean.startsWith('sen')) return 'Sen';
    if (clean.startsWith('sel')) return 'Sel';
    if (clean.startsWith('rab')) return 'Rab';
    if (clean.startsWith('kam')) return 'Kam';
    if (clean.startsWith('jum')) return 'Jum';
    if (clean.startsWith('sab')) return 'Sab';
    if (clean.startsWith('min') || clean.startsWith('ahad')) return 'Min';
    return '';
  }

  function parseHariMengajar(raw, kategoriProgram) {
    const picked = new Set();
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,;|]+/);
    list.forEach((item) => {
      const part = String(item || '').trim();
      if (!part) return;
      const rangeParts = part.split(/\s*(?:-|s\/d|sd|hingga)\s*/i);
      if (rangeParts.length === 2) {
        const i1 = DAY_SHORT_ORDER.indexOf(mapSingleHariToken(rangeParts[0]));
        const i2 = DAY_SHORT_ORDER.indexOf(mapSingleHariToken(rangeParts[1]));
        if (i1 >= 0 && i2 >= i1) {
          for (let idx = i1; idx <= i2; idx += 1) picked.add(DAY_SHORT_ORDER[idx]);
          return;
        }
      }
      part.split(/\s+/).forEach((word) => {
        const mapped = mapSingleHariToken(word);
        if (mapped) picked.add(mapped);
      });
    });
    const ordered = DAY_SHORT_ORDER.filter((d) => picked.has(d));
    return ordered.length > 0 ? ordered : defaultHariMengajarForProgram(kategoriProgram);
  }

  function formatHariMengajarShort(hariInput) {
    const list = Array.isArray(hariInput)
      ? DAY_SHORT_ORDER.filter((d) => hariInput.includes(d))
      : parseHariMengajar(hariInput, '');
    if (list.length === 0) return '-';
    if (list.length === 7) return 'Setiap Hari (Sen - Min)';
    if (
      list.length === 5 &&
      list[0] === 'Sen' &&
      list[4] === 'Jum'
    ) {
      return 'Sen - Jum';
    }
    const indices = list.map((d) => DAY_SHORT_ORDER.indexOf(d));
    const contiguous = indices.every((val, idx) => idx === 0 || val === indices[idx - 1] + 1);
    if (contiguous && list.length >= 3) {
      return `${list[0]} - ${list[list.length - 1]}`;
    }
    return list.join(', ');
  }

  function normalizeTimeHHMM(val) {
    if (val === undefined || val === null || val === '') return '';
    if (val instanceof Date && !Number.isNaN(val.getTime())) {
      try {
        const fmt = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(val);
        if (/^\d{2}:\d{2}$/.test(fmt)) return fmt;
      } catch (err) {
        const wib = new Date(val.getTime() + 7 * 3600 * 1000);
        return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
      }
    }
    const s = String(val).trim();
    if (!s) return '';
    const m = s.match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
    if (m) {
      const hh = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      }
      return '';
    }
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const wib = new Date(parsed.getTime() + 7 * 3600 * 1000);
      return `${String(wib.getUTCHours()).padStart(2, '0')}:${String(wib.getUTCMinutes()).padStart(2, '0')}`;
    }
    return '';
  }

  function parseLegacyJadwalRange(rawJadwal) {
    const s = String(rawJadwal || '').trim();
    if (!s) return { jam_mulai: '', jam_selesai: '' };
    const matches = s.match(/\d{1,2}[:.]\d{2}/g) || [];
    return {
      jam_mulai: matches[0] ? normalizeTimeHHMM(matches[0]) : '',
      jam_selesai: matches[1] ? normalizeTimeHHMM(matches[1]) : '',
    };
  }

  function normalizeOverrideStatus(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'libur') return 'Libur';
    if (s === 'ubah jam' || s === 'ubah_jam' || s === 'ganti jam') return 'Ubah Jam';
    return 'Normal';
  }

  function timeToSeconds(hhmm) {
    const m = String(hhmm || '').match(/^(\d{2}):(\d{2})$/);
    if (!m) return -1;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60;
  }

  function addDaysToIso(isoDate, deltaDays) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return isoDate;
    const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(deltaDays || 0));
    const dt = new Date(utcMs);
    const y = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const da = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }

  function weekdayIndexFromIso(isoDate) {
    const m = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    const utcDay = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return (utcDay + 6) % 7; // 0 = Sen, ..., 6 = Min
  }

  function getWibDateParts(dateInput) {
    const now = dateInput instanceof Date ? dateInput : (dateInput ? new Date(dateInput) : new Date());
    const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
    let isoDate = '';
    let hour = 0;
    let minute = 0;
    let second = 0;
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(safeNow);
      const map = {};
      parts.forEach((p) => {
        map[p.type] = p.value;
      });
      if (map.year && map.month && map.day) {
        isoDate = `${map.year}-${map.month}-${map.day}`;
        hour = parseInt(map.hour || '0', 10) % 24;
        minute = parseInt(map.minute || '0', 10);
        second = parseInt(map.second || '0', 10);
      }
    } catch (err) {
      isoDate = '';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      const wib = new Date(safeNow.getTime() + 7 * 3600 * 1000);
      const y = wib.getUTCFullYear();
      const mo = String(wib.getUTCMonth() + 1).padStart(2, '0');
      const da = String(wib.getUTCDate()).padStart(2, '0');
      isoDate = `${y}-${mo}-${da}`;
      hour = wib.getUTCHours();
      minute = wib.getUTCMinutes();
      second = wib.getUTCSeconds();
    }
    const weekdayIdx = weekdayIndexFromIso(isoDate);
    const weekdayShort = DAY_SHORT_ORDER[weekdayIdx] || 'Sen';
    return {
      isoDate,
      weekdayIdx,
      weekdayShort,
      weekdayFull: DAY_FULL_NAMES[weekdayShort] || weekdayShort,
      hour,
      minute,
      second,
      totalSeconds: hour * 3600 + minute * 60 + second,
    };
  }

  function getEffectiveScheduleForDate(kelasNorm, isoDate, weekdayShort) {
    if (!kelasNorm || kelasNorm.status === 'nonaktif') {
      return { type: 'off', kelas: kelasNorm, isoDate, weekdayShort };
    }
    const ovDate = String(kelasNorm.override_tanggal || '').trim();
    const ovStatus = normalizeOverrideStatus(kelasNorm.override_status);
    const hasOverride = Boolean(ovDate && ovDate === isoDate && (ovStatus === 'Libur' || ovStatus === 'Ubah Jam'));

    if (hasOverride && ovStatus === 'Libur') {
      return {
        type: 'holiday',
        kelas: kelasNorm,
        isoDate,
        weekdayShort,
        weekdayFull: DAY_FULL_NAMES[weekdayShort] || weekdayShort,
        isOverride: true,
        overrideStatus: 'Libur',
        overrideCatatan: String(kelasNorm.override_catatan || '').trim(),
      };
    }

    if (hasOverride && ovStatus === 'Ubah Jam') {
      const sSec = timeToSeconds(kelasNorm.override_jam_mulai);
      const eSec = timeToSeconds(kelasNorm.override_jam_selesai);
      if (sSec >= 0 && eSec > sSec) {
        return {
          type: 'scheduled',
          kelas: kelasNorm,
          isoDate,
          weekdayShort,
          weekdayFull: DAY_FULL_NAMES[weekdayShort] || weekdayShort,
          jamMulai: kelasNorm.override_jam_mulai,
          jamSelesai: kelasNorm.override_jam_selesai,
          startSec: sSec,
          endSec: eSec,
          isOverride: true,
          overrideStatus: 'Ubah Jam',
          overrideCatatan: String(kelasNorm.override_catatan || '').trim(),
        };
      }
    }

    const fixedStart = timeToSeconds(kelasNorm.jam_mulai);
    const fixedEnd = timeToSeconds(kelasNorm.jam_selesai);
    const days = Array.isArray(kelasNorm.hari_mengajar_list)
      ? kelasNorm.hari_mengajar_list
      : parseHariMengajar(kelasNorm.hari_mengajar, kelasNorm.kategori_program);

    if (days.includes(weekdayShort) && fixedStart >= 0 && fixedEnd > fixedStart) {
      return {
        type: 'scheduled',
        kelas: kelasNorm,
        isoDate,
        weekdayShort,
        weekdayFull: DAY_FULL_NAMES[weekdayShort] || weekdayShort,
        jamMulai: kelasNorm.jam_mulai,
        jamSelesai: kelasNorm.jam_selesai,
        startSec: fixedStart,
        endSec: fixedEnd,
        isOverride: false,
        overrideStatus: 'Normal',
        overrideCatatan: '',
      };
    }

    return { type: 'off', kelas: kelasNorm, isoDate, weekdayShort };
  }

  function resolveClassScheduleState(classesList, nowInput) {
    const nowWib = getWibDateParts(nowInput);
    const activeClasses = (Array.isArray(classesList) ? classesList : [])
      .map(normalizeKelas)
      .filter((k) => k.nama_kelas && k.status !== 'nonaktif');

    if (activeClasses.length === 0) {
      return { state: 'empty', nowWib, todayHolidays: [], todayQueue: [] };
    }

    const todayHolidays = [];
    const ongoingList = [];
    const upcomingTodayList = [];

    activeClasses.forEach((k) => {
      const eff = getEffectiveScheduleForDate(k, nowWib.isoDate, nowWib.weekdayShort);
      if (eff.type === 'holiday') {
        todayHolidays.push(eff);
      } else if (eff.type === 'scheduled') {
        if (nowWib.totalSeconds >= eff.startSec && nowWib.totalSeconds < eff.endSec) {
          ongoingList.push(eff);
        } else if (nowWib.totalSeconds < eff.startSec) {
          upcomingTodayList.push(eff);
        }
      }
    });

    ongoingList.sort((a, b) => (a.endSec - b.endSec) || (a.startSec - b.startSec));
    upcomingTodayList.sort((a, b) => (a.startSec - b.startSec) || a.kelas.nama_kelas.localeCompare(b.kelas.nama_kelas));

    const futureCandidates = [];
    for (let offset = 1; offset <= 7; offset += 1) {
      const targetIso = addDaysToIso(nowWib.isoDate, offset);
      const targetDayShort = DAY_SHORT_ORDER[weekdayIndexFromIso(targetIso)] || 'Sen';
      activeClasses.forEach((k) => {
        const eff = getEffectiveScheduleForDate(k, targetIso, targetDayShort);
        if (eff.type === 'scheduled') {
          const remainingSec = (offset * 86400 - nowWib.totalSeconds) + eff.startSec;
          futureCandidates.push(Object.assign({}, eff, { daysAhead: offset, remainingSec }));
        }
      });
    }
    futureCandidates.sort((a, b) => (a.remainingSec - b.remainingSec) || a.kelas.nama_kelas.localeCompare(b.kelas.nama_kelas));

    if (ongoingList.length > 0) {
      const primary = ongoingList[0];
      const remainingSec = Math.max(0, primary.endSec - nowWib.totalSeconds);
      return {
        state: 'ongoing',
        primary,
        remainingSec,
        isWarningSoon: false,
        todayQueue: upcomingTodayList,
        todayHolidays,
        nowWib,
      };
    }

    if (upcomingTodayList.length > 0) {
      const primary = upcomingTodayList[0];
      const remainingSec = Math.max(0, primary.startSec - nowWib.totalSeconds);
      return {
        state: 'upcoming_today',
        primary,
        remainingSec,
        isWarningSoon: remainingSec > 0 && remainingSec <= 900,
        todayQueue: upcomingTodayList.slice(1),
        todayHolidays,
        nowWib,
      };
    }

    if (todayHolidays.length > 0) {
      const primary = todayHolidays[0];
      const nextUp = futureCandidates[0] || null;
      return {
        state: 'holiday',
        primary,
        remainingSec: nextUp ? nextUp.remainingSec : 0,
        nextUp,
        isWarningSoon: false,
        todayQueue: [],
        todayHolidays,
        nowWib,
      };
    }

    if (futureCandidates.length > 0) {
      const primary = futureCandidates[0];
      return {
        state: 'next_day',
        primary,
        remainingSec: primary.remainingSec,
        isWarningSoon: false,
        todayQueue: [],
        todayHolidays: [],
        nowWib,
      };
    }

    return {
      state: 'unconfigured',
      activeClasses,
      remainingSec: 0,
      isWarningSoon: false,
      todayQueue: [],
      todayHolidays: [],
      nowWib,
    };
  }

  function normalizeKelas(raw) {
    const src = raw || {};
    const nama = String(pick(src, ['nama_kelas', 'kelas', 'nama'], '')).trim();
    const katProg = normalizeKategoriProgram(pick(src, ['kategori_program', 'program'], ''), nama);
    const legacy = parseLegacyJadwalRange(pick(src, ['jadwal', 'jadwal_kelas'], ''));
    const jamMulai = normalizeTimeHHMM(pick(src, ['jam_mulai'], '')) || legacy.jam_mulai;
    const jamSelesai = normalizeTimeHHMM(pick(src, ['jam_selesai'], '')) || legacy.jam_selesai;
    const hariList = parseHariMengajar(pick(src, ['hari_mengajar'], ''), katProg);
    const overrideStatus = normalizeOverrideStatus(pick(src, ['override_status'], 'Normal'));
    const ovRawDate = pick(src, ['override_tanggal'], '');
    const ovDateIso = ovRawDate ? normalizeISODate(ovRawDate) : '';
    const overrideTanggal = /^\d{4}-\d{2}-\d{2}$/.test(ovDateIso) ? ovDateIso : '';
    const overrideJamMulai = overrideStatus === 'Ubah Jam' ? normalizeTimeHHMM(pick(src, ['override_jam_mulai'], '')) : '';
    const overrideJamSelesai = overrideStatus === 'Ubah Jam' ? normalizeTimeHHMM(pick(src, ['override_jam_selesai'], '')) : '';
    return {
      id_kelas: String(pick(src, ['id_kelas', 'id'], '')),
      nama_kelas: nama,
      kategori_program: katProg,
      tingkat: String(pick(src, ['tingkat', 'level'], '')).trim(),
      keterangan: String(pick(src, ['keterangan', 'catatan'], '')).trim(),
      status: String(pick(src, ['status'], 'aktif')).trim().toLowerCase(),
      created_at: formatSheetDate(pick(src, ['created_at'], '')),
      jadwal: String(pick(src, ['jadwal', 'jadwal_kelas'], '')).trim() || (jamMulai && jamSelesai ? `${jamMulai}-${jamSelesai}` : ''),
      hari_mengajar: hariList.join(','),
      hari_mengajar_list: hariList,
      jam_mulai: jamMulai,
      jam_selesai: jamSelesai,
      override_tanggal: overrideTanggal,
      override_status: overrideStatus,
      override_jam_mulai: overrideJamMulai,
      override_jam_selesai: overrideJamSelesai,
      override_catatan: String(pick(src, ['override_catatan'], '')).trim(),
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
    initCustomSelects,
    syncCustomSelect,
    closeCustomSelect,
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
    defaultHariMengajarForProgram,
    parseHariMengajar,
    formatHariMengajarShort,
    normalizeTimeHHMM,
    parseLegacyJadwalRange,
    getWibDateParts,
    resolveClassScheduleState,
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
