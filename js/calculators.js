/**
 * Modul Bersama Kalkulator UAS (Preset Atas + Daftar Santri) & Kalkulator Raport
 * Terhubung ke Code.gs, sheet Nilai_UAS dan Nilai_Raport (otomatis tampil di Beranda Laporan Admin).
 */
(function (root) {
  'use strict';

  const CONFIG = root.MDTA_CONFIG;
  const STATE = root.MDTA_STATE;
  const API = root.MDTA_API;
  const UI = root.MDTA_UI;

  const raportInstances = new Map();
  const uasInstances = new Map();
  const scopeSessions = new Map();
  let activeRaportScope = null;
  let aiModalInitialized = false;

  function invalidateAdminReportCache() {
    STATE.rekapKepsek = null;
    STATE.rekapKepsekKey = '';
    STATE.loaded.bootstrap = false;
    if (root.MDTA_CACHE) {
      root.MDTA_CACHE.remove('rekapKepsek');
      root.MDTA_CACHE.remove('dashboard');
    }
  }

  function getScopeSession(scope) {
    return (
      scopeSessions.get(scope) ||
      (root.MDTA_AUTH && typeof root.MDTA_AUTH.getSession === 'function' && root.MDTA_AUTH.getSession()) ||
      {}
    );
  }

  function getAllowedClasses(scope, sessionObj) {
    const sess = sessionObj || getScopeSession(scope);
    if (scope === 'guru') {
      return API.parseKelasAmpu(sess && sess.kelas_ampu);
    }
    return API.getOfficialKelasNames(false);
  }

  function normKelasKey(val) {
    return String(val || '').trim().toLowerCase();
  }

  function getPredicate(score) {
    return API.computeRaportGrade(score);
  }

  function clampNum(v, min, max) {
    const n = UI.parseLocaleNumber(v, min);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function isValidNamaSantri(val) {
    const s = String(val || '').trim();
    return Boolean(s && s !== '-');
  }

  function getSantriRowKey(s) {
    const id = String((s && s.id_santri) || '').trim();
    if (id) return `ID:${id}`;
    return `N:${String((s && (s.nama_lengkap || s.nama_santri)) || '').trim().toLowerCase()}||${normKelasKey(s && s.kelas)}`;
  }

  function resolveClassKategori(kelasName) {
    const kKey = normKelasKey(kelasName);
    const found = (STATE.kelas || []).find((c) => normKelasKey(c.nama_kelas) === kKey);
    if (found && found.kategori_program) return found.kategori_program;
    if (typeof API.normalizeKategoriProgram === 'function') {
      return API.normalizeKategoriProgram('', kelasName);
    }
    return 'Diniyyah';
  }

  function resolveSingleClassForSantri(santriKelasRaw, preferredKelas, allowedList) {
    const classes = API.parseKelasAmpu(santriKelasRaw);
    const pref = String(preferredKelas || '').trim();
    if (pref && (classes.length === 0 || API.isKelasAllowed(pref, classes))) {
      return classes.find((c) => normKelasKey(c) === normKelasKey(pref)) || pref;
    }
    if (Array.isArray(allowedList) && allowedList.length > 0) {
      const scoped = classes.find((c) => API.isKelasAllowed(c, allowedList));
      if (scoped) return scoped;
    }
    return classes[0] || pref || String(santriKelasRaw || '').trim();
  }

  function buildGroupedClassOptionsHtml(classNames, scope, emptyLabel, includeAllOption) {
    const list = Array.isArray(classNames) ? classNames : [];
    if (scope === 'guru' && list.length === 0) {
      return `<option value="">${UI.esc(emptyLabel || 'Belum ada kelas ampu')}</option>`;
    }
    const groups = new Map();
    list.forEach((k) => {
      const kat = resolveClassKategori(k);
      if (!groups.has(kat)) groups.set(kat, []);
      groups.get(kat).push(k);
    });
    const parts = includeAllOption ? ['<option value="">Semua Kelas</option>'] : [];
    if (groups.size > 1) {
      const order = CONFIG.PROGRAM_CATEGORIES || ['Diniyyah', 'Tahfidz', 'Tarikh', 'Wustho'];
      Array.from(groups.keys())
        .sort((a, b) => ((order.indexOf(a) >= 0 ? order.indexOf(a) : 99) - (order.indexOf(b) >= 0 ? order.indexOf(b) : 99)))
        .forEach((kat) => {
          const opts = (groups.get(kat) || []).map((k) => `<option value="${UI.esc(k)}">${UI.esc(k)}</option>`).join('');
          parts.push(`<optgroup label="Program ${UI.esc(kat)}">${opts}</optgroup>`);
        });
    } else {
      list.forEach((k) => parts.push(`<option value="${UI.esc(k)}">${UI.esc(k)}</option>`));
    }
    return parts.join('');
  }

  function getActiveScopedSantri(scope, sessionObj, selectedKelas) {
    const sess = sessionObj || getScopeSession(scope);
    const pool = Array.isArray(STATE.santri) ? STATE.santri : [];
    const allowed = scope === 'guru' ? getAllowedClasses('guru', sess) : [];
    const filterKey = normKelasKey(selectedKelas);

    return pool
      .filter((s) => {
        if (!API.isActiveSantri(s)) return false;
        if (scope === 'guru' && !API.isKelasAllowed(s.kelas, allowed)) return false;
        if (filterKey && !API.isKelasAllowed(s.kelas, [selectedKelas])) return false;
        return true;
      })
      .sort((a, b) => {
        const kCmp = String(a.kelas || '').localeCompare(String(b.kelas || ''), 'id');
        if (kCmp !== 0) return kCmp;
        return String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''), 'id');
      });
  }

  function persistValidRaportRows() {
    if (!root.MDTA_CACHE) return;
    const validOnly = (STATE.raportRows || []).filter((r) => isValidNamaSantri(r && r.nama_santri));
    root.MDTA_CACHE.write('raportRows', validOnly);
  }

  function pruneEmptyRaportRows(includeManualDrafts) {
    STATE.raportRows = (STATE.raportRows || []).filter((r) => {
      if (!r) return false;
      if (isValidNamaSantri(r.nama_santri)) return true;
      return !includeManualDrafts && Boolean(r._isNewManualDraft);
    });
  }

  function buildSantriDatalistOptions(scope, sessionObj) {
    const pool = getActiveScopedSantri(scope, sessionObj, '');
    return pool
      .map((s) => `<option value="${UI.esc(s.nama_lengkap)}">${UI.esc(s.kelas || '')} (${UI.esc(s.id_santri)})</option>`)
      .join('');
  }

  // =========================================================================
  // KALKULATOR UAS BERBASIS PRESET ATAS & DAFTAR SANTRI KELAS AMPU
  // =========================================================================
  function mountUAS(container, opts) {
    if (!container) return;
    const scope = opts.scope || 'admin';
    scopeSessions.set(scope, opts.session || {});

    if (container.dataset.mounted === 'true') {
      const inst = uasInstances.get(scope);
      if (inst && typeof inst.refreshScope === 'function') {
        inst.refreshScope(opts.session || {});
      }
      return;
    }

    const schemeOptions = CONFIG.UAS_SCHEMES.map(
      (s) => `<option value="${UI.esc(s.id)}">${UI.esc(s.label)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="stack-gap">
        <!-- BAGIAN ATAS: PRESET & PROPORSI PENILAIAN UAS -->
        <section class="surface-card stack-gap">
          <div class="card-spotlight-layer" aria-hidden="true"></div>
          <div class="section-toolbar" style="margin-bottom:0;">
            <div>
              <span class="eyebrow-label">Preset &amp; Proporsi Penilaian UAS</span>
              <h2 class="heading-lg">Kalkulator Skor UAS</h2>
            </div>
            <div class="toolbar-actions">
              <button type="button" id="${scope}-uas-reset" class="btn btn-secondary btn-sm">
                <i data-lucide="rotate-ccw" aria-hidden="true"></i>
                <span>Reset Form Penilaian</span>
              </button>
            </div>
          </div>

          <div class="form-grid">
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-kelas">Kelas</label>
              <select id="${scope}-uas-kelas" class="select-control"></select>
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-semester">Semester</label>
              <select id="${scope}-uas-semester" class="select-control">
                <option value="Ganjil">Ganjil</option>
                <option value="Genap">Genap</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-tahun">Tahun Ajaran</label>
              <input id="${scope}-uas-tahun" type="text" class="input-control" value="2026/2027" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-skema">Skema Soal / Proporsi</label>
              <select id="${scope}-uas-skema" class="select-control">${schemeOptions}</select>
            </div>
          </div>

          <div id="${scope}-uas-custom-box" class="sub-surface form-grid" hidden>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-c-pg-max">Maks Soal PG</label>
              <input id="${scope}-uas-c-pg-max" type="number" min="1" step="1" value="25" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-c-es-max">Maks Soal Essay</label>
              <input id="${scope}-uas-c-es-max" type="number" min="1" step="1" value="10" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-c-pg-w">Bobot PG (%)</label>
              <input id="${scope}-uas-c-pg-w" type="number" min="0" max="100" step="1" value="70" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-uas-c-es-w">Bobot Essay (%)</label>
              <input id="${scope}-uas-c-es-w" type="number" min="0" max="100" step="1" value="30" class="input-control mono-num" />
            </div>
          </div>

          <div class="sub-surface" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="text-secondary" style="font-size:0.84rem;">Rumus Skema Aktif</span>
            <strong id="${scope}-uas-formula-txt" class="mono-num" style="font-size:0.82rem;">25 PG (70%) + 10 Essay (30%)</strong>
          </div>

          <div id="${scope}-uas-edit-banner" class="inline-alert inline-alert-info uas-edit-banner" hidden>
            <i data-lucide="pencil" aria-hidden="true" style="width:16px;height:16px;flex-shrink:0;margin-top:2px;"></i>
            <span id="${scope}-uas-edit-text" style="flex:1;">Mode Edit Nilai UAS</span>
            <button type="button" id="${scope}-uas-cancel-edit" class="btn btn-secondary btn-sm">Tutup</button>
          </div>

          <p id="${scope}-uas-validation" class="field-error-text" hidden></p>
        </section>

        <!-- BAGIAN BAWAH: DAFTAR SANTRI KELAS & HITUNG REAL-TIME -->
        <section class="surface-card stack-gap">
          <div class="card-spotlight-layer" aria-hidden="true"></div>
          <div class="section-toolbar" style="margin-bottom:0;">
            <div>
              <h3 class="heading-md">Daftar Santri Kelas</h3>
              <p id="${scope}-uas-limits-hint" class="text-muted" style="margin:2px 0 0;font-size:0.78rem;">Batas skema: Maks 25 PG, Maks 10 Essay (Setengah Benar = 0.5x Essay).</p>
            </div>
            <span id="${scope}-uas-roster-count" class="status-badge status-izin mono-num">0 santri</span>
          </div>

          <div class="table-scroll mobile-cards-wrap">
            <table class="data-table mobile-cards-table mobile-cards-uas">
              <thead>
                <tr>
                  <th style="width:48px;">No</th>
                  <th>Nama Santri</th>
                  <th style="width:120px;">PG Benar</th>
                  <th style="width:120px;">Essay Benar</th>
                  <th style="width:125px;">Setengah Benar</th>
                  <th style="width:110px;">Skor UAS</th>
                  <th style="width:140px;">Predikat</th>
                </tr>
              </thead>
              <tbody id="${scope}-uas-tbody"></tbody>
            </table>
          </div>

          <div id="${scope}-uas-summary" class="summary-bar">
            <div class="summary-metrics">
              <div><span class="text-muted">Santri Dinilai:</span> <strong id="${scope}-uas-sum-count" class="mono-num">0 / 0</strong></div>
              <div><span class="text-muted">Rata-rata UAS:</span> <strong id="${scope}-uas-sum-avg" class="mono-num">-</strong></div>
              <div><span class="text-muted">Tuntas (A/B/C):</span> <strong id="${scope}-uas-sum-tuntas" class="mono-num">-</strong></div>
              <div><span class="text-muted">Perlu Bimbingan (D):</span> <strong id="${scope}-uas-sum-bimbingan" class="mono-num">-</strong></div>
            </div>
            <span class="text-muted" style="font-size:0.8125rem;">Nilai tersimpan otomatis masuk ke Beranda Laporan Admin.</span>
          </div>

          <div class="uas-batch-actions toolbar-actions">
            <button type="button" id="${scope}-uas-save-all" class="btn btn-accent">
              <i data-lucide="database" aria-hidden="true"></i>
              <span>Simpan Semua Nilai UAS</span>
            </button>
            <button type="button" id="${scope}-uas-send-raport-all" class="btn btn-secondary">
              <i data-lucide="arrow-right-circle" aria-hidden="true"></i>
              <span>Salin Semua ke Kalkulator Raport</span>
            </button>
          </div>
        </section>

        <!-- RIWAYAT NILAI UAS TERSIMPAN -->
        <section class="surface-card stack-gap">
          <div class="card-spotlight-layer" aria-hidden="true"></div>
          <div class="section-toolbar" style="margin-bottom:0;">
            <div>
              <h3 class="heading-md">Riwayat Nilai UAS</h3>
              <p class="text-muted" style="margin:2px 0 0;font-size:0.78rem;">Data resmi yang tersimpan di Admin. Gunakan Bersihkan Log / Reset Sesi sebelum memulai sesi penilaian baru.</p>
            </div>
            <div class="toolbar-actions">
              <button type="button" id="${scope}-uas-clear-session" class="btn btn-danger btn-sm">
                <i data-lucide="eraser" aria-hidden="true"></i>
                <span>Bersihkan Log / Reset Sesi</span>
              </button>
              <button type="button" id="${scope}-uas-refresh-hist" class="btn btn-secondary btn-sm" aria-label="Muat ulang riwayat UAS">
                <i data-lucide="refresh-cw" aria-hidden="true"></i>
                <span>Muat Ulang</span>
              </button>
            </div>
          </div>
          <div id="${scope}-uas-history"></div>
        </section>
      </div>
    `;

    container.dataset.mounted = 'true';
    UI.refreshIcons(container);
    UI.bindSpotlights(container);

    const kelasInput = document.getElementById(`${scope}-uas-kelas`);
    const semSelect = document.getElementById(`${scope}-uas-semester`);
    const tahunInput = document.getElementById(`${scope}-uas-tahun`);
    const skemaSelect = document.getElementById(`${scope}-uas-skema`);
    const customBox = document.getElementById(`${scope}-uas-custom-box`);
    const cPgMax = document.getElementById(`${scope}-uas-c-pg-max`);
    const cEsMax = document.getElementById(`${scope}-uas-c-es-max`);
    const cPgW = document.getElementById(`${scope}-uas-c-pg-w`);
    const cEsW = document.getElementById(`${scope}-uas-c-es-w`);
    const formulaTxt = document.getElementById(`${scope}-uas-formula-txt`);
    const limitsHint = document.getElementById(`${scope}-uas-limits-hint`);
    const rosterCountEl = document.getElementById(`${scope}-uas-roster-count`);
    const validationEl = document.getElementById(`${scope}-uas-validation`);
    const editBanner = document.getElementById(`${scope}-uas-edit-banner`);
    const editTextEl = document.getElementById(`${scope}-uas-edit-text`);
    const cancelEditBtn = document.getElementById(`${scope}-uas-cancel-edit`);
    const tbody = document.getElementById(`${scope}-uas-tbody`);
    const resetBtn = document.getElementById(`${scope}-uas-reset`);
    const saveAllBtn = document.getElementById(`${scope}-uas-save-all`);
    const sendRaportAllBtn = document.getElementById(`${scope}-uas-send-raport-all`);
    const clearSessionBtn = document.getElementById(`${scope}-uas-clear-session`);
    const refreshHistBtn = document.getElementById(`${scope}-uas-refresh-hist`);

    const CACHE = root.MDTA_CACHE;
    const uasDraftMap = new Map();
    const hiddenHistoryKeys = new Set();
    let lastSavedUasBatch = [];
    let lastUserKey = String((opts.session && (opts.session.id_user || opts.session.username)) || '');
    let uasHistorySeq = 0;
    let editingUasId = '';

    // Pulihkan draft input & log sesi tersembunyi dari localStorage
    if (CACHE) {
      const savedDraft = CACHE.read(`uasDraft_${scope}`);
      if (savedDraft && savedDraft.data && typeof savedDraft.data === 'object') {
        Object.keys(savedDraft.data).forEach((k) => {
          const entry = savedDraft.data[k];
          if (entry && typeof entry === 'object') {
            uasDraftMap.set(k, Object.assign({ pg_benar: 0, essay_benar: 0, setengah_benar: 0, touched: false, id_uas: '' }, entry));
          }
        });
      }
      const savedHidden = CACHE.read(`uasHiddenHistory_${scope}`);
      if (savedHidden && Array.isArray(savedHidden.data)) {
        savedHidden.data.forEach((hk) => hiddenHistoryKeys.add(String(hk)));
      }
    }

    function persistUasDrafts() {
      if (!root.MDTA_CACHE) return;
      const obj = {};
      uasDraftMap.forEach((val, key) => {
        if (val && (val.touched || Number(val.pg_benar) > 0 || Number(val.essay_benar) > 0 || Number(val.setengah_benar) > 0 || val.id_uas)) {
          obj[key] = val;
        }
      });
      root.MDTA_CACHE.write(`uasDraft_${scope}`, obj);
    }

    function persistHiddenHistoryKeys() {
      if (!root.MDTA_CACHE) return;
      root.MDTA_CACHE.write(`uasHiddenHistory_${scope}`, Array.from(hiddenHistoryKeys));
    }

    function makeHistoryItemKey(item) {
      if (!item) return '';
      const id = String(item.id_uas || '').trim();
      if (id && id !== 'Baru') return `ID:${id}`;
      return `N:${String(item.nama_santri || '').trim().toLowerCase()}||${normKelasKey(item.kelas)}||${String(item.periode || '').trim()}`;
    }

    function setUasEditMode(item) {
      if (item && item.id_uas) {
        editingUasId = String(item.id_uas).trim();
        if (editTextEl) {
          editTextEl.textContent = `Mode Edit Riwayat: ${item.nama_santri || '-'} (${editingUasId}). Ubah skor di baris santri lalu klik "Simpan Semua Nilai UAS".`;
        }
        if (editBanner) editBanner.hidden = false;
      } else {
        editingUasId = '';
        if (editTextEl) editTextEl.textContent = 'Mode Edit Nilai UAS';
        if (editBanner) editBanner.hidden = true;
      }
    }

    function applySchemeFromLabel(skemaLabel) {
      const lbl = String(skemaLabel || '').trim();
      const customMatch = lbl.match(/(\d+)\s*PG\s*\[(\d+(?:[.,]\d+)?)%\]\s*&\s*(\d+)\s*Essay\s*\[(\d+(?:[.,]\d+)?)%\]/i);
      if (customMatch && /^kustom/i.test(lbl)) {
        skemaSelect.value = 'custom';
        cPgMax.value = customMatch[1];
        cPgW.value = customMatch[2];
        cEsMax.value = customMatch[3];
        cEsW.value = customMatch[4];
        return;
      }
      const exactScheme = CONFIG.UAS_SCHEMES.find(
        (s) => s.id !== 'custom' && s.label.toLowerCase() === lbl.toLowerCase()
      );
      if (exactScheme) {
        skemaSelect.value = exactScheme.id;
        return;
      }
      const pairMatch = lbl.match(/(\d+)\s*PG[\s\S]*?(\d+)\s*Essay/i);
      if (pairMatch) {
        const pgN = Number(pairMatch[1]);
        const esN = Number(pairMatch[2]);
        const matchedPair = CONFIG.UAS_SCHEMES.find(
          (s) => s.id !== 'custom' && s.maxPg === pgN && s.maxEssay === esN
        );
        if (matchedPair) {
          skemaSelect.value = matchedPair.id;
          return;
        }
      }
      skemaSelect.value = CONFIG.UAS_SCHEMES[0].id;
    }

    function syncUasClassSelect() {
      if (!kelasInput) return;
      const cur = kelasInput.value;
      const allowed = getAllowedClasses(scope, getScopeSession(scope));
      if (scope === 'guru' && allowed.length === 0) {
        kelasInput.innerHTML = '<option value="">Belum ada kelas ampu</option>';
        kelasInput.value = '';
        kelasInput.disabled = true;
        return;
      }
      kelasInput.disabled = false;
      kelasInput.innerHTML = buildGroupedClassOptionsHtml(allowed, scope, 'Belum ada kelas ampu', scope !== 'guru');
      if (cur && allowed.some((k) => normKelasKey(k) === normKelasKey(cur))) {
        const exact = allowed.find((k) => normKelasKey(k) === normKelasKey(cur));
        if (exact) kelasInput.value = exact;
      } else if (scope === 'guru' && allowed.length > 0) {
        kelasInput.value = allowed[0];
      }
    }

    function getActiveScheme() {
      const id = skemaSelect.value;
      if (id === 'custom') {
        const maxPg = Math.max(1, UI.parseLocaleNumber(cPgMax.value, 25));
        const maxEssay = Math.max(1, UI.parseLocaleNumber(cEsMax.value, 10));
        const bobotPg = Math.max(0, UI.parseLocaleNumber(cPgW.value, 0));
        const bobotEssay = Math.max(0, UI.parseLocaleNumber(cEsW.value, 0));
        return {
          id: 'custom',
          label: `Kustom (${maxPg} PG [${bobotPg}%] & ${maxEssay} Essay [${bobotEssay}%])`,
          maxPg,
          maxEssay,
          bobotPg,
          bobotEssay,
        };
      }
      return CONFIG.UAS_SCHEMES.find((s) => s.id === id) || CONFIG.UAS_SCHEMES[0];
    }

    function getRowDraft(sKey) {
      return (
        uasDraftMap.get(sKey) || {
          pg_benar: 0,
          essay_benar: 0,
          setengah_benar: 0,
          touched: false,
          id_uas: '',
        }
      );
    }

    function computeRowUAS(draft, scheme) {
      const pgVal = Math.max(0, UI.parseLocaleNumber(draft.pg_benar, 0));
      const essayVal = Math.max(0, UI.parseLocaleNumber(draft.essay_benar, 0));
      const halfVal = Math.max(0, UI.parseLocaleNumber(draft.setengah_benar, 0));

      const errors = [];
      if (pgVal > scheme.maxPg) {
        errors.push(`PG Benar (${pgVal}) melebihi maksimal ${scheme.maxPg} soal.`);
      }
      if (essayVal + halfVal > scheme.maxEssay) {
        errors.push(`Essay + Setengah Benar (${essayVal + halfVal}) melebihi ${scheme.maxEssay} soal.`);
      }

      const clampedPg = Math.min(scheme.maxPg, pgVal);
      const clampedEsTotal = Math.min(scheme.maxEssay, essayVal + halfVal * 0.5);
      const scorePg = scheme.maxPg > 0 ? (clampedPg / scheme.maxPg) * scheme.bobotPg : 0;
      const scoreEssay = scheme.maxEssay > 0 ? (clampedEsTotal / scheme.maxEssay) * scheme.bobotEssay : 0;
      const nilaiAkhir = Math.round((scorePg + scoreEssay) * 10) / 10;
      const pred = getPredicate(nilaiAkhir);

      return {
        pgVal,
        essayVal,
        halfVal,
        nilaiAkhir,
        pred,
        rowError: errors[0] || '',
        hasValue: Boolean(draft.touched || pgVal > 0 || essayVal > 0 || halfVal > 0),
      };
    }

    function getCurrentRoster() {
      return getActiveScopedSantri(scope, getScopeSession(scope), kelasInput ? kelasInput.value : '');
    }

    function recalculateAllUASRows() {
      const scheme = getActiveScheme();
      customBox.hidden = scheme.id !== 'custom';
      if (formulaTxt) {
        formulaTxt.textContent = `${scheme.maxPg} PG (${scheme.bobotPg}%) + ${scheme.maxEssay} Essay (${scheme.bobotEssay}%)`;
      }
      if (limitsHint) {
        limitsHint.textContent = `Batas skema aktif: Maks ${scheme.maxPg} PG, Maks ${scheme.maxEssay} Essay (Setengah Benar = 0.5x Essay).`;
      }

      const roster = getCurrentRoster();
      if (rosterCountEl) {
        rosterCountEl.textContent = `${roster.length} santri`;
      }

      const globalErrors = [];
      if (scheme.id === 'custom' && scheme.bobotPg + scheme.bobotEssay !== 100) {
        globalErrors.push(`Total bobot PG + Essay kustom saat ini ${scheme.bobotPg + scheme.bobotEssay}% (harus 100%).`);
      }

      const enteredScores = [];
      let tuntas = 0;
      let bimbingan = 0;
      let firstRowError = '';

      roster.forEach((s) => {
        const sKey = getSantriRowKey(s);
        const draft = getRowDraft(sKey);
        const calc = computeRowUAS(draft, scheme);

        if (calc.rowError && !firstRowError) {
          firstRowError = `${s.nama_lengkap}: ${calc.rowError}`;
        }

        const scoreEl = tbody ? tbody.querySelector(`[data-uas-score="${sKey}"]`) : null;
        const predEl = tbody ? tbody.querySelector(`[data-uas-pred="${sKey}"]`) : null;
        if (scoreEl) scoreEl.textContent = calc.nilaiAkhir.toFixed(1);
        if (predEl) {
          predEl.textContent = `${calc.pred.code} (${calc.pred.label})`;
          predEl.className = `status-badge ${calc.pred.cls} mono-num`;
        }

        if (calc.hasValue) {
          enteredScores.push(calc.nilaiAkhir);
          if (['A', 'B', 'C'].includes(calc.pred.code)) tuntas++;
          else bimbingan++;
        }
      });

      const activeErr = globalErrors[0] || firstRowError;
      if (validationEl) {
        if (activeErr) {
          validationEl.textContent = activeErr;
          validationEl.hidden = false;
        } else {
          validationEl.textContent = '';
          validationEl.hidden = true;
        }
      }

      const sumCountEl = document.getElementById(`${scope}-uas-sum-count`);
      const sumAvgEl = document.getElementById(`${scope}-uas-sum-avg`);
      const sumTuntasEl = document.getElementById(`${scope}-uas-sum-tuntas`);
      const sumBimbEl = document.getElementById(`${scope}-uas-sum-bimbingan`);

      if (sumCountEl) sumCountEl.textContent = `${enteredScores.length} / ${roster.length}`;
      if (enteredScores.length > 0) {
        const avg = Math.round((enteredScores.reduce((a, b) => a + b, 0) / enteredScores.length) * 10) / 10;
        if (sumAvgEl) sumAvgEl.textContent = avg.toFixed(1);
        if (sumTuntasEl) sumTuntasEl.textContent = String(tuntas);
        if (sumBimbEl) sumBimbEl.textContent = String(bimbingan);
      } else {
        if (sumAvgEl) sumAvgEl.textContent = '-';
        if (sumTuntasEl) sumTuntasEl.textContent = '-';
        if (sumBimbEl) sumBimbEl.textContent = '-';
      }

      return {
        scheme,
        hasError: Boolean(activeErr),
        errorMessage: activeErr,
        roster,
      };
    }

    function isUasTbodyFocused() {
      return Boolean(
        typeof document !== 'undefined' &&
        document.activeElement &&
        tbody &&
        typeof tbody.contains === 'function' &&
        tbody.contains(document.activeElement)
      );
    }

    function renderUASRoster() {
      if (!tbody) return;
      const activeSess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, activeSess);
      const roster = getCurrentRoster();
      const scheme = getActiveScheme();

      if (roster.length === 0) {
        const emptyMsg =
          scope === 'guru' && allowed.length === 0
            ? 'Akun guru ini belum dipetakan ke kelas mana pun oleh Administrator.'
            : 'Belum ada santri aktif terdaftar untuk kelas terpilih.';
        tbody.innerHTML = `
          <tr class="table-state-row">
            <td colspan="7">
              ${UI.renderStateBox({
                type: 'empty',
                title: 'Belum ada daftar santri kelas',
                message: emptyMsg,
              })}
            </td>
          </tr>
        `;
        UI.refreshIcons(tbody);
        recalculateAllUASRows();
        return;
      }

      tbody.innerHTML = roster
        .map((s, idx) => {
          const sKey = getSantriRowKey(s);
          const draft = getRowDraft(sKey);
          const calc = computeRowUAS(draft, scheme);
          return `
            <tr data-uas-key="${UI.esc(sKey)}">
              <td class="mono-num uas-no" data-label="No">${idx + 1}</td>
              <td class="uas-nama" data-label="Nama Santri">
                <strong>${UI.esc(s.nama_lengkap)}</strong>
                <div class="text-muted" style="font-size:0.76rem;">${UI.esc(s.kelas || '-')}${s.id_santri ? ` · ${UI.esc(s.id_santri)}` : ''}</div>
              </td>
              <td class="uas-pg" data-label="PG Benar">
                <input type="number" min="0" step="1" class="table-input table-input-num" data-uas-field="pg_benar" data-uas-skey="${UI.esc(sKey)}" value="${UI.esc(calc.pgVal)}" aria-label="PG Benar ${UI.esc(s.nama_lengkap)}" />
              </td>
              <td class="uas-essay" data-label="Essay Benar">
                <input type="number" min="0" step="1" class="table-input table-input-num" data-uas-field="essay_benar" data-uas-skey="${UI.esc(sKey)}" value="${UI.esc(calc.essayVal)}" aria-label="Essay Benar ${UI.esc(s.nama_lengkap)}" />
              </td>
              <td class="uas-half" data-label="Setengah Benar">
                <input type="number" min="0" step="1" class="table-input table-input-num" data-uas-field="setengah_benar" data-uas-skey="${UI.esc(sKey)}" value="${UI.esc(calc.halfVal)}" aria-label="Setengah Benar ${UI.esc(s.nama_lengkap)}" />
              </td>
              <td class="mono-num uas-skor" style="font-weight:700;" data-label="Skor UAS" data-uas-score="${UI.esc(sKey)}">${calc.nilaiAkhir.toFixed(1)}</td>
              <td class="uas-pred" data-label="Predikat"><span class="status-badge ${calc.pred.cls} mono-num" data-uas-pred="${UI.esc(sKey)}">${calc.pred.code} (${calc.pred.label})</span></td>
            </tr>
          `;
        })
        .join('');

      tbody.querySelectorAll('input[data-uas-field]').forEach((inp) => {
        const syncRowInput = () => {
          const sKey = inp.dataset.uasSkey || '';
          const field = inp.dataset.uasField;
          if (!sKey || !field) return;
          const cur = getRowDraft(sKey);
          const next = Object.assign({}, cur, {
            touched: true,
            [field]: Math.max(0, UI.parseLocaleNumber(inp.value, 0)),
          });
          uasDraftMap.set(sKey, next);
          persistUasDrafts();
          recalculateAllUASRows();
        };
        inp.addEventListener('input', syncRowInput);
        inp.addEventListener('change', syncRowInput);
      });

      UI.refreshIcons(tbody);
      recalculateAllUASRows();
    }

    function resetUASWorkspaceInputs(clearAllClasses) {
      setUasEditMode(null);
      if (clearAllClasses) {
        uasDraftMap.clear();
        lastSavedUasBatch = [];
      } else {
        const activeRoster = getCurrentRoster();
        activeRoster.forEach((s) => uasDraftMap.delete(getSantriRowKey(s)));
      }
      persistUasDrafts();
      renderUASRoster();
    }

    function loadUASItemForEdit(item) {
      if (!item) return;
      if (kelasInput && item.kelas) {
        const matchOpt = Array.from(kelasInput.options || []).find(
          (o) => normKelasKey(o.value) === normKelasKey(item.kelas)
        );
        if (matchOpt) kelasInput.value = matchOpt.value;
      }
      const perStr = String(item.periode || '').trim();
      const perMatch = perStr.match(/^(Ganjil|Genap)(?:\s+(.+))?$/i);
      if (perMatch) {
        if (semSelect) semSelect.value = /^genap$/i.test(perMatch[1]) ? 'Genap' : 'Ganjil';
        if (tahunInput && perMatch[2]) tahunInput.value = perMatch[2].trim();
      }
      applySchemeFromLabel(item.skema_soal);

      const roster = getCurrentRoster();
      const targetSantri = roster.find(
        (s) =>
          (item.id_santri && s.id_santri === item.id_santri) ||
          s.nama_lengkap.trim().toLowerCase() === String(item.nama_santri || '').trim().toLowerCase()
      );
      if (!targetSantri) {
        UI.toast(`Santri "${item.nama_santri}" tidak ditemukan di daftar santri aktif kelas ini.`, 'warn');
        return;
      }
      const sKey = getSantriRowKey(targetSantri);
      uasDraftMap.set(sKey, {
        id_uas: item.id_uas || '',
        pg_benar: Number(item.pg_benar ?? 0),
        essay_benar: Number(item.essay_benar ?? 0),
        setengah_benar: Number(item.setengah_benar ?? 0),
        touched: true,
      });
      persistUasDrafts();
      setUasEditMode(item);
      renderUASRoster();

      const pgField = tbody
        ? Array.from(tbody.querySelectorAll('input[data-uas-field="pg_benar"]')).find(
            (el) => el.dataset.uasSkey === sKey
          )
        : null;
      if (pgField) {
        if (typeof pgField.scrollIntoView === 'function') {
          pgField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (typeof pgField.focus === 'function') pgField.focus();
      }
    }

    function renderUASHistory() {
      const box = document.getElementById(`${scope}-uas-history`);
      if (!box) return;
      const activeSess = getScopeSession(scope);
      const historyPoolRaw =
        scope === 'guru'
          ? API.filterByGuruScope(STATE.nilaiUAS || [], activeSess, 'kelas')
          : STATE.nilaiUAS || [];
      const historyPool = historyPoolRaw.filter((item) => !hiddenHistoryKeys.has(makeHistoryItemKey(item)));

      if (historyPool.length === 0) {
        const hasHiddenOnly = historyPoolRaw.length > 0;
        box.innerHTML = UI.renderStateBox({
          type: 'empty',
          title: hasHiddenOnly ? 'Log sesi tampilan dibersihkan' : 'Belum ada riwayat nilai UAS',
          message:
            scope === 'guru' && getAllowedClasses(scope, activeSess).length === 0
              ? 'Akun Anda belum dipetakan ke kelas mana pun.'
              : hasHiddenOnly
              ? 'Siap memulai sesi atau mapel baru. Klik "Muat Ulang" untuk menampilkan riwayat yang tersimpan di Admin.'
              : 'Isi skor santri pada daftar di atas lalu klik "Simpan Semua Nilai UAS".',
        });
        UI.refreshIcons(box);
        return;
      }

      const visibleHistory = historyPool.slice(0, 10);
      box.innerHTML = `<div class="stack-gap" style="gap:8px;">${visibleHistory
        .map((item, idx) => {
          const pred = getPredicate(item.nilai_uas);
          const idAttr = UI.esc(item.id_uas || '');
          const namaEsc = UI.esc(item.nama_santri);
          return `
            <div class="sub-surface uas-history-item">
              <div class="uas-history-main">
                <div class="uas-history-name">${namaEsc}</div>
                <div class="text-muted uas-history-meta">${UI.esc(item.kelas || '-')} · ${UI.esc(item.skema_soal)}</div>
              </div>
              <div class="uas-history-right">
                <span class="status-badge ${pred.cls} mono-num">${UI.esc(item.nilai_uas)} (${pred.code})</span>
                <div class="uas-history-actions">
                  <button type="button" class="btn btn-secondary btn-icon-sm" data-uas-edit="${idAttr}" data-uas-idx="${idx}" aria-label="Edit nilai UAS ${namaEsc}" title="Edit nilai UAS">
                    <i data-lucide="pencil" aria-hidden="true"></i>
                  </button>
                  <button type="button" class="btn btn-danger btn-icon-sm" data-uas-delete="${idAttr}" data-uas-idx="${idx}" aria-label="Hapus nilai UAS ${namaEsc}" title="Hapus nilai UAS">
                    <i data-lucide="trash-2" aria-hidden="true"></i>
                  </button>
                </div>
              </div>
            </div>
          `;
        })
        .join('')}</div>`;

      box.querySelectorAll('button[data-uas-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.uasIdx);
          const targetItem = Number.isFinite(idx) ? visibleHistory[idx] : null;
          if (!targetItem) return;
          loadUASItemForEdit(targetItem);
          UI.toast(`Data UAS "${targetItem.nama_santri}" dimuat ke daftar untuk diedit.`, 'info');
        });
      });

      box.querySelectorAll('button[data-uas-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = Number(btn.dataset.uasIdx);
          const targetItem = Number.isFinite(idx) ? visibleHistory[idx] : null;
          if (!targetItem) return;

          const confirmed = await UI.confirmDialog({
            title: 'Hapus Nilai UAS',
            message: `Apakah Anda yakin ingin menghapus riwayat nilai UAS "${targetItem.nama_santri}" (${targetItem.kelas || '-'})?`,
            confirmLabel: 'Hapus',
            danger: true,
          });
          if (!confirmed) return;

          const prevList = Array.isArray(STATE.nilaiUAS) ? STATE.nilaiUAS.slice() : [];
          STATE.nilaiUAS = prevList.filter((x) => {
            if (x === targetItem) return false;
            if (targetItem.id_uas && x.id_uas && x.id_uas === targetItem.id_uas) return false;
            return true;
          });
          if (editingUasId && targetItem.id_uas && editingUasId === targetItem.id_uas) {
            setUasEditMode(null);
          }
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('nilaiUAS', STATE.nilaiUAS);
          renderUASHistory();

          if (targetItem.id_uas && targetItem.id_uas !== 'Baru') {
            try {
              await API.deleteNilaiUAS(targetItem.id_uas);
              invalidateAdminReportCache();
              UI.toast(`Nilai UAS "${targetItem.nama_santri}" berhasil dihapus.`, 'success');
            } catch (err) {
              STATE.nilaiUAS = prevList;
              if (root.MDTA_CACHE) root.MDTA_CACHE.write('nilaiUAS', STATE.nilaiUAS);
              renderUASHistory();
              UI.toast(err.message, 'error');
            }
          } else {
            invalidateAdminReportCache();
            UI.toast(`Nilai UAS "${targetItem.nama_santri}" dihapus dari riwayat.`, 'info');
          }
        });
      });

      UI.refreshIcons(box);
    }

    async function loadUASHistory(silent, loadOpts) {
      const force = Boolean(loadOpts && loadOpts.force);
      const CACHE_REF = root.MDTA_CACHE;
      if (CACHE_REF) CACHE_REF.hydrateState();

      const activeSess = getScopeSession(scope);
      if (scope === 'guru' && getAllowedClasses(scope, activeSess).length === 0) {
        renderUASHistory();
        return;
      }

      if (STATE.nilaiUAS.length > 0) {
        renderUASHistory();
      }
      if (!force && STATE.loaded.uas && (STATE.nilaiUAS.length > 0 || STATE.santri.length > 0)) {
        return;
      }

      const mySeq = ++uasHistorySeq;
      try {
        if (STATE.santri.length === 0) {
          const sRes = await API.getSantri();
          if (mySeq !== uasHistorySeq) return;
          const normalizedSantri = API.extractArray(sRes, ['santri']).map(API.normalizeSantri);
          const freshSess = getScopeSession(scope);
          STATE.santri = scope === 'guru' ? API.filterByGuruScope(normalizedSantri, freshSess, 'kelas') : normalizedSantri;
          STATE.loaded.santri = true;
          if (CACHE_REF) CACHE_REF.write('santri', STATE.santri);
          syncUasClassSelect();
          if (!isUasTbodyFocused()) renderUASRoster();
        }
        const prevUAS = STATE.nilaiUAS;
        const res = await API.getNilaiUAS();
        if (mySeq !== uasHistorySeq) return;
        const freshSess = getScopeSession(scope);
        const rawUAS = API.extractArray(res, ['nilai_uas']).map(API.normalizeNilaiUAS).reverse();
        const freshUAS = scope === 'guru' ? API.filterByGuruScope(rawUAS, freshSess, 'kelas') : rawUAS;
        const changed = !CACHE_REF || CACHE_REF.hasChanged(prevUAS, freshUAS);
        STATE.nilaiUAS = freshUAS;
        STATE.loaded.uas = true;
        if (CACHE_REF) CACHE_REF.write('nilaiUAS', freshUAS);
        if (changed || prevUAS.length === 0) {
          renderUASHistory();
        }
      } catch (err) {
        if (mySeq !== uasHistorySeq) return;
        if (!silent) UI.toast(err.message, 'error');
        renderUASHistory();
      }
    }

    async function saveAllUASRecords() {
      const activeSess = getScopeSession(scope);
      const allowedClasses = getAllowedClasses(scope, activeSess);
      const evalState = recalculateAllUASRows();

      if (scope === 'guru' && allowedClasses.length === 0) {
        UI.toast('Akun Anda belum dipetakan ke kelas mana pun. Hubungi Admin.', 'error');
        return null;
      }
      if (evalState.hasError) {
        UI.toast(evalState.errorMessage || 'Periksa validasi skema dan batas soal terlebih dahulu.', 'error');
        return null;
      }

      const periode = `${semSelect.value} ${tahunInput.value.trim()}`;
      const activeKelasFilter = kelasInput ? String(kelasInput.value || '').trim() : '';
      const batchPayloads = [];

      evalState.roster.forEach((s) => {
        const sKey = getSantriRowKey(s);
        const draft = getRowDraft(sKey);
        const calc = computeRowUAS(draft, evalState.scheme);
        if (!calc.hasValue) return;

        if (scope === 'guru' && !API.isKelasAllowed(s.kelas, allowedClasses)) {
          return;
        }
        const targetKelas = resolveSingleClassForSantri(
          s.kelas,
          activeKelasFilter,
          scope === 'guru' ? allowedClasses : null
        );
        batchPayloads.push({
          id_uas: draft.id_uas || '',
          id_santri: s.id_santri || '',
          nama_santri: s.nama_lengkap,
          kelas: targetKelas,
          kategori_program: resolveClassKategori(targetKelas),
          periode,
          skema_soal: evalState.scheme.label,
          pg_benar: calc.pgVal,
          essay_benar: calc.essayVal,
          setengah_benar: calc.halfVal,
          nilai_uas: calc.nilaiAkhir,
          id_guru: activeSess.id_user || '',
        });
      });

      if (batchPayloads.length === 0) {
        UI.toast('Isi nilai PG atau Essay minimal satu santri terlebih dahulu.', 'warn');
        return null;
      }

      uasHistorySeq++;
      const res = await API.saveNilaiUAS(batchPayloads);
      const d = res.data || res || {};
      const returnedItems = Array.isArray(d.items) && d.items.length > 0 ? d.items : batchPayloads;
      const todayIso = UI.todayISO();

      if (!Array.isArray(STATE.nilaiUAS)) STATE.nilaiUAS = [];

      const savedSnapshot = [];
      returnedItems.forEach((ret, idx) => {
        const fallbackSrc = batchPayloads[idx] || batchPayloads[0];
        const normalized = API.normalizeNilaiUAS(
          Object.assign({}, fallbackSrc, ret, {
            updated_at: ret.updated_at || todayIso,
          })
        );
        hiddenHistoryKeys.delete(makeHistoryItemKey(normalized));

        const existIdx = STATE.nilaiUAS.findIndex((x) => {
          if (normalized.id_uas && x.id_uas && x.id_uas === normalized.id_uas) return true;
          return (
            x.nama_santri.trim().toLowerCase() === normalized.nama_santri.trim().toLowerCase() &&
            normKelasKey(x.kelas) === normKelasKey(normalized.kelas) &&
            String(x.periode || '').trim() === String(normalized.periode || '').trim()
          );
        });
        if (existIdx >= 0) {
          STATE.nilaiUAS[existIdx] = normalized;
        } else {
          STATE.nilaiUAS.unshift(normalized);
        }
        savedSnapshot.push({
          id_santri: normalized.id_santri,
          nama_lengkap: normalized.nama_santri,
          kelas: normalized.kelas,
          uas: normalized.nilai_uas,
        });
      });

      persistHiddenHistoryKeys();
      if (root.MDTA_CACHE) root.MDTA_CACHE.write('nilaiUAS', STATE.nilaiUAS);
      invalidateAdminReportCache();

      lastSavedUasBatch = savedSnapshot;
      resetUASWorkspaceInputs(false);
      renderUASHistory();

      return { savedCount: d.savedCount || savedSnapshot.length, items: savedSnapshot };
    }

    [kelasInput].forEach((sel) => {
      if (!sel) return;
      sel.addEventListener('change', () => {
        renderUASRoster();
      });
    });

    [skemaSelect, cPgMax, cEsMax, cPgW, cEsW].forEach((el) => {
      if (!el) return;
      el.addEventListener('input', recalculateAllUASRows);
      el.addEventListener('change', recalculateAllUASRows);
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetUASWorkspaceInputs(false);
        UI.toast('Input nilai PG dan Essay pada daftar santri direset ke 0.', 'info');
      });
    }

    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', () => {
        setUasEditMode(null);
      });
    }

    if (clearSessionBtn) {
      clearSessionBtn.addEventListener('click', async () => {
        const confirmed = await UI.confirmDialog({
          title: 'Bersihkan Log / Reset Sesi UAS',
          message:
            'Kosongkan seluruh input form penilaian UAS menjadi 0 serta bersihkan daftar Riwayat di sesi kalkulator ini? Data nilai resmi di Beranda Laporan Admin dan Google Sheets TIDAK akan terhapus.',
          confirmLabel: 'Bersihkan Sesi',
          danger: true,
        });
        if (!confirmed) return;

        const activeSess = getScopeSession(scope);
        const historyPoolRaw =
          scope === 'guru'
            ? API.filterByGuruScope(STATE.nilaiUAS || [], activeSess, 'kelas')
            : STATE.nilaiUAS || [];
        historyPoolRaw.forEach((item) => {
          const hk = makeHistoryItemKey(item);
          if (hk) hiddenHistoryKeys.add(hk);
        });
        persistHiddenHistoryKeys();

        resetUASWorkspaceInputs(true);
        if (root.MDTA_CACHE) root.MDTA_CACHE.remove(`uasDraft_${scope}`);
        renderUASHistory();
        UI.toast('Log sesi Kalkulator UAS dibersihkan dan input direset ke 0 (data Admin tetap aman).', 'info');
      });
    }

    if (refreshHistBtn) {
      refreshHistBtn.addEventListener('click', () => {
        hiddenHistoryKeys.clear();
        persistHiddenHistoryKeys();
        loadUASHistory(false, { force: true });
      });
    }

    if (sendRaportAllBtn) {
      sendRaportAllBtn.addEventListener('click', () => {
        const evalState = recalculateAllUASRows();
        if (evalState.hasError) {
          UI.toast(evalState.errorMessage || 'Perbaiki input nilai UAS yang melebihi batas skema terlebih dahulu.', 'error');
          return;
        }

        const activeKelasFilter = kelasInput ? String(kelasInput.value || '').trim() : '';
        const allowedForCopy = getAllowedClasses(scope, getScopeSession(scope));
        let entries = [];
        evalState.roster.forEach((s) => {
          const sKey = getSantriRowKey(s);
          const draft = getRowDraft(sKey);
          const calc = computeRowUAS(draft, evalState.scheme);
          if (!calc.hasValue) return;
          const targetKelas = resolveSingleClassForSantri(
            s.kelas,
            activeKelasFilter,
            scope === 'guru' ? allowedForCopy : null
          );
          entries.push({
            id_santri: s.id_santri || '',
            nama_lengkap: s.nama_lengkap,
            kelas: targetKelas,
            uas: calc.nilaiAkhir,
          });
        });

        // Jika form barusan ter-reset otomatis setelah Simpan Semua, pakai snapshot tersimpan terakhir
        if (entries.length === 0 && lastSavedUasBatch.length > 0) {
          const selectedK = kelasInput ? normKelasKey(kelasInput.value) : '';
          entries = lastSavedUasBatch.filter(
            (item) => !selectedK || normKelasKey(item.kelas) === selectedK
          );
        }

        if (entries.length === 0) {
          UI.toast('Isi nilai PG atau Essay minimal satu santri sebelum menyalin ke Kalkulator Raport.', 'warn');
          return;
        }

        const copiedCount = injectUASBatchToRaport(scope, entries);
        UI.toast(`${copiedCount} nilai UAS berhasil disalin ke Kalkulator Raport dan Nilai Akhir dihitung ulang.`, 'success');
      });
    }

    if (saveAllBtn) {
      saveAllBtn.addEventListener('click', async () => {
        UI.setButtonLoading(saveAllBtn, true, 'Menyimpan Semua...');
        try {
          const savedResult = await saveAllUASRecords();
          if (savedResult) {
            UI.toast(
              `${savedResult.savedCount} nilai UAS tersimpan ke Beranda Laporan Admin. Form penilaian direset ke 0 untuk sesi baru.`,
              'success'
            );
          }
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveAllBtn, false);
        }
      });
    }

    function refreshScope(newSession, refreshOpts) {
      if (newSession) scopeSessions.set(scope, newSession);
      const activeSess = getScopeSession(scope);
      const nextUserKey = String((activeSess && (activeSess.id_user || activeSess.username)) || '');
      if (nextUserKey !== lastUserKey) {
        lastUserKey = nextUserKey;
        hiddenHistoryKeys.clear();
        persistHiddenHistoryKeys();
        resetUASWorkspaceInputs(true);
      }
      syncUasClassSelect();
      if (!(refreshOpts && refreshOpts.silentBackground && isUasTbodyFocused())) {
        renderUASRoster();
      } else {
        recalculateAllUASRows();
      }
      renderUASHistory();
      if (
        !(refreshOpts && refreshOpts.skipFetch) &&
        (!STATE.loaded.uas || (STATE.santri.length === 0 && getAllowedClasses(scope, activeSess).length > 0))
      ) {
        loadUASHistory(true, { force: false });
      }
    }

    uasInstances.set(scope, { refreshScope });
    syncUasClassSelect();
    renderUASRoster();
    renderUASHistory();
    loadUASHistory(true, { force: false });
  }

  // =========================================================================
  // KALKULATOR RAPORT + ASISTEN IMPOR NILAI AI + RESET LOG SESI
  // =========================================================================
  function injectUASBatchToRaport(scopeName, entries) {
    const scope = scopeName || activeRaportScope || 'admin';
    const list = Array.isArray(entries) ? entries : [entries];
    if (list.length === 0) return 0;

    const activeSess = getScopeSession(scope);
    const allowed = getAllowedClasses(scope, activeSess);
    const santriPool = getActiveScopedSantri(scope, activeSess, '');
    let count = 0;

    list.forEach((entry) => {
      if (!entry || !isValidNamaSantri(entry.nama_lengkap)) return;
      const nama = entry.nama_lengkap.trim();
      const matched = santriPool.find(
        (s) =>
          (entry.id_santri && s.id_santri && s.id_santri === entry.id_santri) ||
          s.nama_lengkap.toLowerCase() === nama.toLowerCase()
      );
      const resolvedKelas =
        String(entry.kelas || '').trim() ||
        (matched ? matched.kelas : '') ||
        (scope === 'guru' ? (allowed[0] || '') : '');

      if (scope === 'guru' && resolvedKelas && !API.isKelasAllowed(resolvedKelas, allowed)) {
        return;
      }

      const idx = STATE.raportRows.findIndex((r) => {
        const sameKelas = !resolvedKelas || !r.kelas || normKelasKey(r.kelas) === normKelasKey(resolvedKelas);
        if (!sameKelas) return false;
        if (entry.id_santri && r.id_santri && r.id_santri === entry.id_santri) return true;
        if (r.nama_santri.trim().toLowerCase() !== nama.toLowerCase()) return false;
        if (scope === 'guru' && r.kelas && !API.isKelasAllowed(r.kelas, allowed)) return false;
        return true;
      });

      if (idx >= 0) {
        STATE.raportRows[idx].n_uas = clampNum(entry.uas, 0, 100);
        STATE.raportRows[idx]._dirty = true;
        STATE.raportRows[idx]._isNewManualDraft = false;
        if (resolvedKelas && !STATE.raportRows[idx].kelas) {
          STATE.raportRows[idx].kelas = resolvedKelas;
        }
      } else {
        STATE.raportRows.push({
          uid: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          id_raport: '',
          id_santri: (matched && matched.id_santri) || entry.id_santri || '',
          nama_santri: matched ? matched.nama_lengkap : nama,
          kelas: resolvedKelas,
          n_harian: 0,
          n_uas: clampNum(entry.uas, 0, 100),
          n_kehadiran: 100,
          _dirty: true,
        });
      }
      count++;
    });

    if (count > 0) {
      persistValidRaportRows();
      raportInstances.forEach((inst) => {
        if (typeof inst.renderRows === 'function') inst.renderRows();
        if (typeof inst.updateSummaryAndScores === 'function') inst.updateSummaryAndScores();
      });
    }
    return count;
  }

  function injectUASScoreToRaport(entry) {
    return injectUASBatchToRaport((entry && entry.scope) || activeRaportScope || 'admin', [entry]);
  }

  function mergeImportedRows(incomingRows) {
    if (!Array.isArray(incomingRows) || incomingRows.length === 0) return 0;
    const scope = activeRaportScope || 'admin';
    const activeSess = getScopeSession(scope);
    const allowedClasses = getAllowedClasses(scope, activeSess);
    let count = 0;

    incomingRows.forEach((raw) => {
      const nama = String(API.pick(raw, ['nama_lengkap', 'nama', 'nama_santri', 'santri'], '')).trim();
      if (!isValidNamaSantri(nama)) return;

      const harianRaw = API.pick(raw, ['n_harian', 'harian', 'nilai_harian'], null);
      const uasRaw = API.pick(raw, ['n_uas', 'uas', 'nilai_uas'], null);
      const absensiRaw = API.pick(raw, ['n_kehadiran', 'kehadiran', 'absensi'], null);
      const rawKelas = String(API.pick(raw, ['kelas', 'rombel'], '')).trim();

      const santriPool = getActiveScopedSantri(scope, activeSess, '');
      const matchedSantri = santriPool.find((s) => s.nama_lengkap.toLowerCase() === nama.toLowerCase());
      const resolvedKelas = rawKelas || (matchedSantri ? matchedSantri.kelas : '') || (scope === 'guru' ? (allowedClasses[0] || '') : '');

      if (scope === 'guru' && resolvedKelas && !API.isKelasAllowed(resolvedKelas, allowedClasses)) {
        return;
      }

      const existing = STATE.raportRows.find((r) => r.nama_santri.trim().toLowerCase() === nama.toLowerCase());
      if (existing) {
        if (scope === 'guru' && existing.kelas && !API.isKelasAllowed(existing.kelas, allowedClasses)) {
          return;
        }
        if (harianRaw !== null && harianRaw !== '') existing.n_harian = clampNum(harianRaw, 0, 100);
        if (uasRaw !== null && uasRaw !== '') existing.n_uas = clampNum(uasRaw, 0, 100);
        if (absensiRaw !== null && absensiRaw !== '') {
          existing.n_kehadiran = clampNum(absensiRaw, 0, 100);
          existing._dirtyKehadiran = true;
        }
        if (resolvedKelas && !existing.kelas) existing.kelas = resolvedKelas;
        existing._dirty = true;
        existing._isNewManualDraft = false;
      } else {
        STATE.raportRows.push({
          uid: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          id_raport: '',
          id_santri: matchedSantri ? matchedSantri.id_santri : '',
          nama_santri: matchedSantri ? matchedSantri.nama_lengkap : nama,
          kelas: resolvedKelas,
          n_harian: harianRaw !== null && harianRaw !== '' ? clampNum(harianRaw, 0, 100) : 0,
          n_uas: uasRaw !== null && uasRaw !== '' ? clampNum(uasRaw, 0, 100) : 0,
          n_kehadiran: absensiRaw !== null && absensiRaw !== '' ? clampNum(absensiRaw, 0, 100) : 100,
          _dirty: true,
          _dirtyKehadiran: absensiRaw !== null && absensiRaw !== '',
        });
      }
      count++;
    });

    persistValidRaportRows();
    raportInstances.forEach((inst) => inst.renderRows());
    return count;
  }

  function parseStructuredTextLocally(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const parsed = [];

    lines.forEach((line) => {
      if (/^(no[\s,;\t|]+)?nama[\s,;\t|]/i.test(line) && /harian|uas|absensi|kehadiran/i.test(line)) return;

      let delimiter = '';
      if (line.includes('\t')) delimiter = '\t';
      else if (line.includes(';')) delimiter = ';';
      else if (line.includes('|')) delimiter = '|';
      else if (line.includes(',')) delimiter = ',';

      if (delimiter) {
        const parts = line
          .split(delimiter)
          .map((p) => p.trim().replace(/^"(.*)"$/, '$1').trim());
        const nama = parts[0] || '';
        if (parts.length >= 2 && isValidNamaSantri(nama)) {
          const isFiveColWithClass =
            parts.length >= 5 &&
            parts[1] !== '' &&
            Number.isNaN(UI.parseLocaleNumber(parts[1], NaN)) &&
            Number.isFinite(UI.parseLocaleNumber(parts[2], NaN));

          if (isFiveColWithClass) {
            parsed.push({
              nama_lengkap: nama,
              kelas: parts[1],
              n_harian: parts[2] !== '' ? UI.parseLocaleNumber(parts[2], 0) : 0,
              n_uas: parts[3] !== undefined && parts[3] !== '' ? UI.parseLocaleNumber(parts[3], 0) : 0,
              n_kehadiran: parts[4] !== undefined && parts[4] !== '' ? UI.parseLocaleNumber(parts[4], 100) : 100,
            });
            return;
          }

          const hasAnyNum = parts
            .slice(1, 4)
            .some((v) => v !== '' && Number.isFinite(UI.parseLocaleNumber(v, NaN)));
          if (hasAnyNum) {
            parsed.push({
              nama_lengkap: nama,
              n_harian: parts[1] !== undefined && parts[1] !== '' ? UI.parseLocaleNumber(parts[1], 0) : 0,
              n_uas: parts[2] !== undefined && parts[2] !== '' ? UI.parseLocaleNumber(parts[2], 0) : 0,
              n_kehadiran: parts[3] !== undefined && parts[3] !== '' ? UI.parseLocaleNumber(parts[3], 100) : 100,
            });
            return;
          }
        }
      }

      const m = line.match(/^([A-Za-z'\.\s-]+?)[\s:\-]+(\d+(?:[.,]\d+)?%?)(?:[\s]+(\d+(?:[.,]\d+)?%?))?(?:[\s]+(\d+(?:[.,]\d+)?%?))?$/);
      if (m && isValidNamaSantri(m[1])) {
        parsed.push({
          nama_lengkap: m[1].trim(),
          n_harian: UI.parseLocaleNumber(m[2], 0),
          n_uas: m[3] ? UI.parseLocaleNumber(m[3], 0) : 0,
          n_kehadiran: m[4] ? UI.parseLocaleNumber(m[4], 100) : 100,
        });
      }
    });

    return parsed;
  }

  function initAIImportModal(session) {
    if (aiModalInitialized) return;
    aiModalInitialized = true;

    const form = document.getElementById('form-import-ai');
    const fileInput = document.getElementById('import-ai-file');
    const fileStatus = document.getElementById('import-ai-file-status');
    const textInput = document.getElementById('import-ai-text');
    const submitBtn = document.getElementById('btn-import-ai-submit');
    const localBtn = document.getElementById('btn-import-ai-local');
    const closeBtn = document.getElementById('btn-close-import-ai-modal');
    const cancelBtn = document.getElementById('btn-cancel-import-ai');
    const errorBox = document.getElementById('import-ai-error');

    let selectedFilePayload = null;

    function setError(msg) {
      if (!errorBox) return;
      if (msg) {
        errorBox.textContent = msg;
        errorBox.hidden = false;
      } else {
        errorBox.textContent = '';
        errorBox.hidden = true;
      }
    }

    if (closeBtn) closeBtn.addEventListener('click', () => UI.closeModal('modal-import-ai'));
    if (cancelBtn) cancelBtn.addEventListener('click', () => UI.closeModal('modal-import-ai'));

    if (fileInput) {
      fileInput.addEventListener('change', () => {
        setError('');
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
          selectedFilePayload = null;
          if (fileStatus) fileStatus.textContent = 'Belum ada berkas dipilih.';
          return;
        }
        if (file.size > 6 * 1024 * 1024) {
          selectedFilePayload = null;
          fileInput.value = '';
          setError('Ukuran berkas maksimal 6 MB agar dapat diproses oleh Apps Script.');
          return;
        }
        if (fileStatus) {
          fileStatus.textContent = `${file.name} (${Math.round(file.size / 1024)} KB) siap dikirim ke Gemini 2.5 Flash.`;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const resultStr = String(reader.result || '');
          const base64Content = resultStr.includes(',') ? resultStr.split(',')[1] : resultStr;
          selectedFilePayload = {
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64Content,
          };
        };
        reader.readAsDataURL(file);
      });
    }

    if (localBtn) {
      localBtn.addEventListener('click', () => {
        setError('');
        const rawText = (textInput ? textInput.value : '').trim();
        if (!rawText) {
          setError('Tempel teks nilai terlebih dahulu untuk penguraian lokal.');
          if (textInput) textInput.focus();
          return;
        }
        const parsed = parseStructuredTextLocally(rawText);
        if (parsed.length === 0) {
          setError('Format teks tidak dikenali. Gunakan pola "Nama Santri, Harian, UAS, Kehadiran" per baris.');
          return;
        }
        const added = mergeImportedRows(parsed);
        if (textInput) textInput.value = '';
        UI.closeModal('modal-import-ai');
        UI.toast(`${added} baris nilai berhasil diurai dari teks ke Kalkulator Raport.`, 'success');
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        setError('');
        const rawText = (textInput ? textInput.value : '').trim();

        if (!rawText && !selectedFilePayload) {
          setError('Unggah berkas PDF/foto nilai atau tempel teks daftar nilai terlebih dahulu.');
          return;
        }

        UI.setButtonLoading(submitBtn, true, 'Mengekstrak via AI...');
        try {
          const activeSess = getScopeSession(activeRaportScope || 'admin');
          const res = await API.importNilaiAI({
            rawText,
            filename: selectedFilePayload ? selectedFilePayload.filename : '',
            mimeType: selectedFilePayload ? selectedFilePayload.mimeType : '',
            base64Content: selectedFilePayload ? selectedFilePayload.base64Content : '',
            diunggah_oleh: (activeSess && (activeSess.nama_lengkap || activeSess.username)) || 'Guru',
          });
          const d = res.data || res;
          const rows = Array.isArray(d.extracted)
            ? d.extracted
            : API.extractArray(res, ['extracted', 'nilai', 'raport']);
          const count = mergeImportedRows(rows);
          if (count === 0) {
            setError('Gemini AI tidak menemukan baris nilai santri yang dapat dimasukkan ke tabel.');
            return;
          }
          if (fileInput) fileInput.value = '';
          if (fileStatus) fileStatus.textContent = 'Belum ada berkas dipilih.';
          selectedFilePayload = null;
          if (textInput) textInput.value = '';
          UI.closeModal('modal-import-ai');
          UI.toast(`${count} baris nilai berhasil diekstrak AI & diisi ke tabel raport.`, 'success');
        } catch (err) {
          setError(err.message);
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(submitBtn, false);
        }
      });
    }
  }

  function mountRaport(container, opts) {
    if (!container) return;
    const scope = opts.scope || 'admin';
    const session = opts.session || {};
    scopeSessions.set(scope, session);
    initAIImportModal(session);

    if (container.dataset.mounted === 'true') {
      activeRaportScope = scope;
      const inst = raportInstances.get(scope);
      if (inst) {
        if (typeof inst.refreshScope === 'function') inst.refreshScope(session);
        else inst.renderRows();
      }
      return;
    }

    const mapelOptions = CONFIG.MAPEL_OPTIONS.map(
      (m) => `<option value="${UI.esc(m)}"></option>`
    ).join('');
    const allowedInitial = getAllowedClasses(scope, session);
    const kelasOptions = allowedInitial
      .map((k) => `<option value="${UI.esc(k)}">${UI.esc(k)}</option>`)
      .join('');

    container.innerHTML = `
      <section class="surface-card stack-gap">
        <div class="card-spotlight-layer" aria-hidden="true"></div>

        <!-- Kop Cetak PDF Khusus -->
        <div class="print-only-block">
          <div class="print-kop">
            <div>
              <h2 class="print-kop-title">${UI.esc(CONFIG.INSTITUTION_NAME)}</h2>
              <p class="print-kop-sub">Laporan Rekapitulasi Nilai Raport Santri Madrasah Diniyah Takmiliyah Awaliyah (MDTA)</p>
              <p id="${scope}-raport-print-meta" class="print-kop-sub"></p>
            </div>
            <div style="text-align:right;font-size:9pt;">
              <div>Dicetak: ${UI.esc(UI.formatDateId())}</div>
            </div>
          </div>
        </div>

        <div class="section-toolbar no-print">
          <div>
            <span class="eyebrow-label">Rekapitulasi Penilaian Akhir</span>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:2px;">
              <h2 class="heading-lg">Kalkulator Raport Terpadu</h2>
            </div>
          </div>
          <div class="toolbar-actions">
            <button type="button" id="${scope}-raport-sync" class="btn btn-secondary btn-sm">
              <i data-lucide="refresh-cw" aria-hidden="true"></i>
              <span>Sinkronkan Santri &amp; Kehadiran</span>
            </button>
            <button type="button" id="${scope}-raport-ai" class="btn btn-secondary btn-sm">
              <i data-lucide="scan-text" aria-hidden="true"></i>
              <span>Asisten Impor Nilai AI</span>
            </button>
          </div>
        </div>

        <!-- Pengaturan Bobot (Default 40 / 40 / 20) -->
        <div class="sub-surface no-print">
          <div class="section-toolbar" style="margin-bottom:8px;">
            <strong style="font-size:0.9rem;">Pengaturan Bobot Penilaian (%)</strong>
            <div class="toolbar-actions">
              <span id="${scope}-raport-weight-badge" class="status-badge status-hadir mono-num">Total: 100%</span>
              <button type="button" id="${scope}-raport-weight-reset" class="btn btn-secondary btn-sm">Reset 40/40/20</button>
            </div>
          </div>
          <div class="weights-bar">
            <div class="field-group">
              <label class="field-label" for="${scope}-w-harian">Bobot Harian (%)</label>
              <input id="${scope}-w-harian" type="number" min="0" max="100" value="40" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-w-uas">Bobot UAS (%)</label>
              <input id="${scope}-w-uas" type="number" min="0" max="100" value="40" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-w-absensi">Bobot Kehadiran (%)</label>
              <input id="${scope}-w-absensi" type="number" min="0" max="100" value="20" class="input-control mono-num" />
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-raport-mapel">Mata Pelajaran (Cetak/WA)</label>
              <input id="${scope}-raport-mapel" list="${scope}-raport-mapel-list" type="text" class="input-control" placeholder="Contoh: Fiqih" />
              <datalist id="${scope}-raport-mapel-list">${mapelOptions}</datalist>
            </div>
          </div>
          <div class="form-grid" style="margin-top:8px;">
            <div class="field-group">
              <label class="field-label" for="${scope}-raport-kelas-filter">Filter Kelas</label>
              <select id="${scope}-raport-kelas-filter" class="select-control">
                ${
                  scope === 'guru'
                    ? (kelasOptions || '<option value="">Belum ada kelas ampu</option>')
                    : `<option value="">Semua Kelas</option>${kelasOptions}`
                }
              </select>
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-raport-semester">Semester</label>
              <select id="${scope}-raport-semester" class="select-control">
                <option value="Ganjil">Ganjil</option>
                <option value="Genap">Genap</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label" for="${scope}-raport-tahun">Tahun Ajaran</label>
              <input id="${scope}-raport-tahun" type="text" value="2026/2027" class="input-control" />
            </div>
          </div>
        </div>

        <!-- Toolbar Aksi Tabel -->
        <div class="section-toolbar no-print" style="margin-bottom:0;">
          <div class="toolbar-actions">
            <button type="button" id="${scope}-raport-add-row" class="btn btn-secondary">
              <i data-lucide="plus" aria-hidden="true"></i>
              <span>Tambah Baris</span>
            </button>
            <button type="button" id="${scope}-raport-copy-wa" class="btn btn-secondary">
              <i data-lucide="copy" aria-hidden="true"></i>
              <span>Salin Format WA</span>
            </button>
            <button type="button" id="${scope}-raport-print" class="btn btn-secondary">
              <i data-lucide="printer" aria-hidden="true"></i>
              <span>Cetak Laporan</span>
            </button>
          </div>
          <div class="toolbar-actions">
            <button type="button" id="${scope}-raport-clear-session" class="btn btn-danger btn-sm">
              <i data-lucide="eraser" aria-hidden="true"></i>
              <span>Bersihkan Log / Reset Sesi</span>
            </button>
            <button type="button" id="${scope}-raport-save-sheets" class="btn btn-accent">
              <i data-lucide="save" aria-hidden="true"></i>
              <span>Simpan ke Database</span>
            </button>
          </div>
        </div>

        <!-- Tabel Interaktif Raport -->
        <datalist id="${scope}-raport-santri-list">${buildSantriDatalistOptions(scope, session)}</datalist>
        <div class="table-scroll mobile-cards-wrap">
          <table class="data-table mobile-cards-table mobile-cards-raport">
            <thead>
              <tr>
                <th style="width:48px;">No</th>
                <th>Nama Santri</th>
                <th style="width:140px;">Kelas</th>
                <th style="width:104px;">Harian</th>
                <th style="width:104px;">UAS</th>
                <th style="width:116px;">Kehadiran (%)</th>
                <th style="width:110px;">Nilai Akhir</th>
                <th style="width:165px;">Predikat</th>
                <th class="no-print" style="width:74px;">Aksi</th>
              </tr>
            </thead>
            <tbody id="${scope}-raport-tbody"></tbody>
          </table>
        </div>

        <!-- Ringkasan Statistik Kelas -->
        <div id="${scope}-raport-summary" class="summary-bar">
          <div class="summary-metrics">
            <div><span class="text-muted">Jumlah Santri:</span> <strong id="${scope}-sum-count" class="mono-num">0</strong></div>
            <div><span class="text-muted">Rata-rata Nilai:</span> <strong id="${scope}-sum-avg" class="mono-num">-</strong></div>
            <div><span class="text-muted">Tuntas (A/B/C):</span> <strong id="${scope}-sum-tuntas" class="mono-num">-</strong></div>
            <div><span class="text-muted">Perlu Bimbingan (D):</span> <strong id="${scope}-sum-bimbingan" class="mono-num">-</strong></div>
          </div>
          <span class="text-muted" style="font-size:0.8125rem;">Nilai tersimpan otomatis tampil di Beranda Laporan Admin.</span>
        </div>

        <!-- Blok Tanda Tangan Cetak -->
        <div class="print-only-block">
          <div class="print-signatures">
            <div class="print-sign-box">
              <div>Mengetahui,</div>
              <div>Kepala Madrasah MDTA</div>
              <div class="print-sign-space"></div>
              <div><strong>( ____________________ )</strong></div>
            </div>
            <div class="print-sign-box">
              <div>Bojongsoang, ${UI.esc(UI.formatDateShort(new Date()))}</div>
              <div>Guru Pengampu / Wali Kelas</div>
              <div class="print-sign-space"></div>
              <div><strong id="${scope}-raport-print-sign-guru">${UI.esc(session.nama_lengkap || session.username || '( ____________________ )')}</strong></div>
            </div>
          </div>
        </div>
      </section>
    `;

    container.dataset.mounted = 'true';
    activeRaportScope = scope;
    UI.refreshIcons(container);
    UI.bindSpotlights(container);

    const wHarian = document.getElementById(`${scope}-w-harian`);
    const wUas = document.getElementById(`${scope}-w-uas`);
    const wAbsensi = document.getElementById(`${scope}-w-absensi`);
    const weightBadge = document.getElementById(`${scope}-raport-weight-badge`);
    const resetWeightBtn = document.getElementById(`${scope}-raport-weight-reset`);
    const kelasFilter = document.getElementById(`${scope}-raport-kelas-filter`);
    const mapelInput = document.getElementById(`${scope}-raport-mapel`);
    const semSelect = document.getElementById(`${scope}-raport-semester`);
    const tahunInput = document.getElementById(`${scope}-raport-tahun`);
    const syncBtn = document.getElementById(`${scope}-raport-sync`);
    const aiBtn = document.getElementById(`${scope}-raport-ai`);
    const addRowBtn = document.getElementById(`${scope}-raport-add-row`);
    const copyWaBtn = document.getElementById(`${scope}-raport-copy-wa`);
    const printBtn = document.getElementById(`${scope}-raport-print`);
    const clearSessionBtn = document.getElementById(`${scope}-raport-clear-session`);
    const saveBtn = document.getElementById(`${scope}-raport-save-sheets`);
    const tbody = document.getElementById(`${scope}-raport-tbody`);

    const CACHE_REF = root.MDTA_CACHE;
    let raportSyncSeq = 0;
    let raportSessionReset = Boolean(CACHE_REF && CACHE_REF.read(`raportSessionReset_${scope}`)?.data);
    let lastRaportUserKey = String((session && (session.id_user || session.username)) || '');

    function setRaportSessionReset(val) {
      raportSessionReset = Boolean(val);
      if (root.MDTA_CACHE) {
        if (raportSessionReset) root.MDTA_CACHE.write(`raportSessionReset_${scope}`, true);
        else root.MDTA_CACHE.remove(`raportSessionReset_${scope}`);
      }
    }

    function syncRaportClassFilterOptions() {
      const sess = getScopeSession(scope);
      const cur = kelasFilter.value;
      if (scope === 'guru') {
        const allowed = getAllowedClasses(scope, sess);
        if (allowed.length === 0) {
          kelasFilter.innerHTML = '<option value="">Belum ada kelas ampu</option>';
          kelasFilter.value = '';
          kelasFilter.disabled = true;
          return;
        }
        kelasFilter.disabled = false;
        kelasFilter.innerHTML = buildGroupedClassOptionsHtml(allowed, 'guru', 'Belum ada kelas ampu', false);
        if (cur && API.isKelasAllowed(cur, allowed)) {
          const matchedOpt = allowed.find((k) => normKelasKey(k) === normKelasKey(cur));
          kelasFilter.value = matchedOpt || allowed[0];
        } else {
          kelasFilter.value = allowed[0];
        }
        return;
      }

      const set = new Set(getAllowedClasses('admin', sess));
      (STATE.santri || []).forEach((s) => {
        if (s.kelas) {
          API.parseKelasAmpu(s.kelas).forEach((k) => set.add(k));
        }
      });
      STATE.raportRows.forEach((r) => {
        if (r.kelas) set.add(r.kelas);
      });
      const allSorted = Array.from(set);
      kelasFilter.disabled = false;
      kelasFilter.innerHTML = buildGroupedClassOptionsHtml(allSorted, 'admin', 'Belum ada kelas', true);
      if (cur && set.has(cur)) kelasFilter.value = cur;
    }

    function getVisibleRaportRows() {
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      let rows = Array.isArray(STATE.raportRows) ? STATE.raportRows : [];
      if (scope === 'guru') {
        if (allowed.length === 0) return [];
        rows = rows.filter((r) => API.isKelasAllowed(r.kelas, allowed));
      }
      const filterK = kelasFilter.value;
      if (!filterK) return rows;
      return rows.filter((r) => normKelasKey(r.kelas) === normKelasKey(filterK));
    }

    function buildRowKelasOptionsHtml(currentKelas) {
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess).slice();
      const curStr = String(currentKelas || '').trim();
      const opts = allowed.slice();
      if (scope !== 'guru' && curStr && !opts.some((k) => normKelasKey(k) === normKelasKey(curStr))) {
        opts.push(curStr);
      }
      if (opts.length === 0) {
        return '<option value="">Belum ada kelas</option>';
      }
      const hasMatch = curStr && opts.some((k) => normKelasKey(k) === normKelasKey(curStr));
      const placeholder = hasMatch ? '' : '<option value="">-- Pilih Kelas --</option>';
      return (
        placeholder +
        opts
          .map((k) => {
            const selected = hasMatch && normKelasKey(k) === normKelasKey(curStr) ? ' selected' : '';
            return `<option value="${UI.esc(k)}"${selected}>${UI.esc(k)}</option>`;
          })
          .join('')
      );
    }

    function isTbodyFocused() {
      return Boolean(
        typeof document !== 'undefined' &&
        document.activeElement &&
        tbody &&
        typeof tbody.contains === 'function' &&
        tbody.contains(document.activeElement)
      );
    }

    function getWeights() {
      const harian = Math.max(0, Number(wHarian.value) || 0);
      const uas = Math.max(0, Number(wUas.value) || 0);
      const absensi = Math.max(0, Number(wAbsensi.value) || 0);
      const total = harian + uas + absensi;
      return { harian, uas, absensi, total };
    }

    function computeRowScore(row, w) {
      const sumW = w.total > 0 ? w.total : 100;
      const raw = (Number(row.n_harian) || 0) * w.harian + (Number(row.n_uas) || 0) * w.uas + (Number(row.n_kehadiran) || 0) * w.absensi;
      return Math.round((raw / sumW) * 100) / 100;
    }

    function updateWeightUI() {
      const w = getWeights();
      weightBadge.textContent = w.total === 100 ? 'Total: 100%' : `Total: ${w.total}% (harus 100%)`;
      weightBadge.className = `status-badge mono-num ${w.total === 100 ? 'status-hadir' : 'status-sakit'}`;
      return w;
    }

    function updateSummaryAndScores() {
      const w = updateWeightUI();
      const visible = getVisibleRaportRows();
      const validVisible = [];
      const scores = [];
      let tuntas = 0;
      let bimbingan = 0;

      visible.forEach((row) => {
        const finalScore = computeRowScore(row, w);
        const pred = getPredicate(finalScore);
        if (isValidNamaSantri(row.nama_santri)) {
          validVisible.push(row);
          scores.push(finalScore);
          if (['A', 'B', 'C'].includes(pred.code)) tuntas++;
          else bimbingan++;
        }

        const scoreCell = tbody.querySelector(`[data-score-for="${row.uid}"]`);
        const predCell = tbody.querySelector(`[data-pred-for="${row.uid}"]`);
        if (scoreCell) scoreCell.textContent = finalScore.toFixed(2);
        if (predCell) {
          predCell.textContent = `${pred.code} (${pred.label})`;
          predCell.className = `status-badge ${pred.cls} mono-num`;
        }
      });

      document.getElementById(`${scope}-sum-count`).textContent = String(validVisible.length);
      if (scores.length > 0) {
        const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
        document.getElementById(`${scope}-sum-avg`).textContent = avg.toFixed(2);
        document.getElementById(`${scope}-sum-tuntas`).textContent = String(tuntas);
        document.getElementById(`${scope}-sum-bimbingan`).textContent = String(bimbingan);
        return { count: validVisible.length, avg, tuntas, bimbingan };
      } else {
        document.getElementById(`${scope}-sum-avg`).textContent = '-';
        document.getElementById(`${scope}-sum-tuntas`).textContent = '-';
        document.getElementById(`${scope}-sum-bimbingan`).textContent = '-';
        return { count: 0, avg: 0, tuntas: 0, bimbingan: 0 };
      }
    }

    function renderRows() {
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      const dl = document.getElementById(`${scope}-raport-santri-list`);
      if (dl) dl.innerHTML = buildSantriDatalistOptions(scope, sess);
      syncRaportClassFilterOptions();

      const w = updateWeightUI();
      const visible = getVisibleRaportRows();

      if (visible.length === 0) {
        const emptyMsg =
          scope === 'guru' && allowed.length === 0
            ? 'Akun guru ini belum dipetakan ke kelas mana pun oleh Administrator.'
            : 'Klik "Sinkronkan Santri & Kehadiran", "Tambah Baris", atau gunakan "Asisten Impor Nilai AI".';
        tbody.innerHTML = `
          <tr class="table-state-row">
            <td colspan="9">
              ${UI.renderStateBox({
                type: 'empty',
                title: 'Belum ada baris nilai santri',
                message: emptyMsg,
              })}
            </td>
          </tr>
        `;
        UI.refreshIcons(tbody);
        updateSummaryAndScores();
        return;
      }

      tbody.innerHTML = visible
        .map((row, idx) => {
          const finalScore = computeRowScore(row, w);
          const pred = getPredicate(finalScore);
          return `
            <tr data-row-uid="${UI.esc(row.uid)}">
              <td class="mono-num rc-no" data-label="No">${idx + 1}</td>
              <td class="rc-nama" data-label="Nama Santri">
                <input type="text" list="${scope}-raport-santri-list" class="table-input table-input-name" data-field="nama_santri" value="${UI.esc(row.nama_santri)}" aria-label="Nama santri baris ${idx + 1}" placeholder="Nama santri" />
              </td>
              <td class="rc-kelas" data-label="Kelas">
                <select class="select-control table-input" data-field="kelas" aria-label="Kelas baris ${idx + 1}">
                  ${buildRowKelasOptionsHtml(row.kelas)}
                </select>
              </td>
              <td class="rc-harian" data-label="N. Harian">
                <input type="number" min="0" max="100" step="0.1" class="table-input table-input-num" data-field="n_harian" value="${UI.esc(row.n_harian)}" aria-label="Nilai harian ${UI.esc(row.nama_santri || `baris ${idx + 1}`)}" />
              </td>
              <td class="rc-uas" data-label="N. UAS">
                <input type="number" min="0" max="100" step="0.1" class="table-input table-input-num" data-field="n_uas" value="${UI.esc(row.n_uas)}" aria-label="Nilai UAS ${UI.esc(row.nama_santri || `baris ${idx + 1}`)}" />
              </td>
              <td class="rc-hadir" data-label="Kehadiran (%)">
                <input type="number" min="0" max="100" step="0.1" class="table-input table-input-num" data-field="n_kehadiran" value="${UI.esc(row.n_kehadiran)}" aria-label="Persentase kehadiran ${UI.esc(row.nama_santri || `baris ${idx + 1}`)}" />
              </td>
              <td class="mono-num rc-akhir" style="font-weight:700;" data-label="Nilai Akhir" data-score-for="${UI.esc(row.uid)}">${finalScore.toFixed(2)}</td>
              <td class="rc-pred" data-label="Predikat"><span class="status-badge ${pred.cls} mono-num" data-pred-for="${UI.esc(row.uid)}">${pred.code} (${pred.label})</span></td>
              <td class="no-print rc-del" data-label="Hapus">
                <button type="button" class="btn btn-danger btn-icon-sm" data-delete-uid="${UI.esc(row.uid)}" aria-label="Hapus baris ${UI.esc(row.nama_santri || `nomor ${idx + 1}`)}">
                  <i data-lucide="trash-2" aria-hidden="true"></i>
                </button>
              </td>
            </tr>
          `;
        })
        .join('');

      function handleRowFieldUpdate(el, commitClamp) {
        const tr = el.closest('tr');
        const uid = tr ? tr.dataset.rowUid : '';
        const targetRow = STATE.raportRows.find((r) => r.uid === uid);
        if (!targetRow) return;
        const field = el.dataset.field;
        targetRow._dirty = true;
        if (field === 'nama_santri') {
          targetRow.nama_santri = el.value;
          targetRow._isNewManualDraft = !isValidNamaSantri(el.value);
          const liveSess = getScopeSession(scope);
          const pool =
            scope === 'guru' ? API.filterByGuruScope(STATE.santri, liveSess, 'kelas') : (STATE.santri || []);
          const match = pool.find(
            (s) => s.nama_lengkap.toLowerCase() === el.value.trim().toLowerCase()
          );
          if (match) {
            targetRow.id_santri = match.id_santri;
            const resolvedMatchKelas = resolveSingleClassForSantri(
              match.kelas,
              kelasFilter.value,
              scope === 'guru' ? getAllowedClasses(scope, liveSess) : null
            );
            if ((!targetRow.kelas || scope === 'guru') && resolvedMatchKelas) {
              targetRow.kelas = resolvedMatchKelas;
              const kEl = tr.querySelector('[data-field="kelas"]');
              if (kEl) {
                const matchOpt = Array.from(kEl.options || []).find(
                  (o) => normKelasKey(o.value) === normKelasKey(resolvedMatchKelas)
                );
                kEl.value = matchOpt ? matchOpt.value : resolvedMatchKelas;
              }
            }
          }
        } else if (field === 'kelas') {
          const allowedList = getAllowedClasses(scope);
          if (scope === 'guru' && el.value && !API.isKelasAllowed(el.value, allowedList)) {
            UI.toast(`Kelas "${el.value}" berada di luar kelas ampu Anda.`, 'error');
            el.value = targetRow.kelas || allowedList[0] || '';
            return;
          }
          targetRow.kelas = el.value;
          persistValidRaportRows();
          if (kelasFilter.value && normKelasKey(el.value) !== normKelasKey(kelasFilter.value)) {
            renderRows();
            return;
          }
        } else {
          if (field === 'n_kehadiran') {
            targetRow._dirtyKehadiran = true;
          }
          targetRow[field] = clampNum(el.value, 0, 100);
          if (commitClamp && String(el.value).trim() !== String(targetRow[field])) {
            el.value = String(targetRow[field]);
          }
        }
        persistValidRaportRows();
        updateSummaryAndScores();
      }

      tbody.querySelectorAll('input[data-field]').forEach((inp) => {
        inp.addEventListener('input', () => handleRowFieldUpdate(inp, false));
        inp.addEventListener('change', () => handleRowFieldUpdate(inp, true));
      });
      tbody.querySelectorAll('select[data-field]').forEach((sel) => {
        sel.addEventListener('change', () => handleRowFieldUpdate(sel, true));
      });

      tbody.querySelectorAll('button[data-delete-uid]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const uid = btn.dataset.deleteUid;
          const removed = STATE.raportRows.find((r) => r.uid === uid);
          const label = removed && removed.nama_santri ? removed.nama_santri : 'tanpa nama';
          STATE.raportRows = STATE.raportRows.filter((r) => r.uid !== uid);
          persistValidRaportRows();
          renderRows();
          UI.toast(`Baris nilai "${label}" dihapus dari workspace.`, 'info');
        });
      });

      UI.refreshIcons(tbody);
      updateSummaryAndScores();
    }

    function mergeSantriAndRaportIntoRows(santriList, savedRaportList, rekapMap, mergeOpts) {
      const forceOverwriteDirty = Boolean(mergeOpts && mergeOpts.forceOverwriteDirty);
      const suppressSavedScores = Boolean((mergeOpts && mergeOpts.suppressSavedScores) || raportSessionReset);
      const allowedClasses = mergeOpts && Array.isArray(mergeOpts.allowedClasses) ? mergeOpts.allowedClasses : null;
      const savedBySantri = new Map();

      if (!suppressSavedScores) {
        (savedRaportList || []).forEach((sr) => {
          if (!sr || !isValidNamaSantri(sr.nama_santri)) return;
          const kKey = normKelasKey(sr.kelas);
          if (sr.id_santri) savedBySantri.set(`${sr.id_santri}::${kKey}`, sr);
          savedBySantri.set(`${sr.nama_santri.trim().toLowerCase()}::${kKey}`, sr);
        });
      }

      (santriList || []).forEach((s) => {
        if (!API.isActiveSantri(s)) return;
        let classList = API.parseKelasAmpu(s.kelas);
        if (allowedClasses && allowedClasses.length > 0) {
          classList = classList.filter((k) => API.isKelasAllowed(k, allowedClasses));
        }
        if (classList.length === 0) classList = [String(s.kelas || '').trim()];

        const namaLower = s.nama_lengkap.trim().toLowerCase();
        classList.forEach((kelasName) => {
          const kKey = normKelasKey(kelasName);
          const pct = rekapMap
            ? rekapMap.get(`${s.id_santri}::${kKey}`) ?? rekapMap.get(`${namaLower}::${kKey}`)
            : undefined;
          const saved = suppressSavedScores
            ? null
            : (savedBySantri.get(`${s.id_santri}::${kKey}`) ?? savedBySantri.get(`${namaLower}::${kKey}`));
          const existing = STATE.raportRows.find((r) => {
            const sameKelas = !kKey || !r.kelas || normKelasKey(r.kelas) === kKey;
            if (!sameKelas) return false;
            return (
              (r.id_santri && r.id_santri === s.id_santri) ||
              r.nama_santri.trim().toLowerCase() === namaLower
            );
          });

          if (existing) {
            existing.id_santri = s.id_santri || existing.id_santri;
            existing.kelas = kelasName || existing.kelas;
            const canOverwrite = !existing._dirty || forceOverwriteDirty;
            if (saved && !suppressSavedScores) {
              existing.id_raport = saved.id_raport || existing.id_raport;
              if (canOverwrite) {
                existing.n_harian = saved.n_harian;
                existing.n_uas = saved.n_uas;
              } else {
                if (!existing.n_harian && saved.n_harian) existing.n_harian = saved.n_harian;
                if (!existing.n_uas && saved.n_uas) existing.n_uas = saved.n_uas;
              }
            }
            if (pct !== undefined && (!existing._dirtyKehadiran || forceOverwriteDirty)) {
              existing.n_kehadiran = pct;
            } else if (saved && !suppressSavedScores && saved.n_kehadiran !== undefined && canOverwrite && !existing._dirtyKehadiran) {
              existing.n_kehadiran = saved.n_kehadiran;
            }
          } else {
            STATE.raportRows.push({
              uid: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              id_raport: saved ? saved.id_raport : '',
              id_santri: s.id_santri,
              nama_santri: s.nama_lengkap,
              kelas: kelasName,
              n_harian: saved ? saved.n_harian : 0,
              n_uas: saved ? saved.n_uas : 0,
              n_kehadiran: pct !== undefined ? pct : (saved ? saved.n_kehadiran : 100),
            });
          }
        });
      });

      if (!suppressSavedScores) {
        (savedRaportList || []).forEach((sr) => {
          if (!sr || !isValidNamaSantri(sr.nama_santri)) return;
          const normNama = sr.nama_santri.trim().toLowerCase();
          const normKls = normKelasKey(sr.kelas);
          const already = STATE.raportRows.find(
            (r) =>
              (sr.id_raport && r.id_raport && r.id_raport === sr.id_raport) ||
              (sr.id_santri && r.id_santri && r.id_santri === sr.id_santri) ||
              (r.nama_santri.trim().toLowerCase() === normNama &&
                (!normKls || !r.kelas || normKelasKey(r.kelas) === normKls))
          );
          if (!already) {
            STATE.raportRows.push({
              uid: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              id_raport: sr.id_raport || '',
              id_santri: sr.id_santri || '',
              nama_santri: sr.nama_santri,
              kelas: sr.kelas || '',
              n_harian: sr.n_harian || 0,
              n_uas: sr.n_uas || 0,
              n_kehadiran: sr.n_kehadiran !== undefined ? sr.n_kehadiran : 100,
            });
          }
        });
      }
    }

    function resetRaportWorkspaceScores(targetRowsSubset) {
      setRaportSessionReset(true);
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      const targetSet = Array.isArray(targetRowsSubset) ? new Set(targetRowsSubset) : null;

      pruneEmptyRaportRows(true);
      (STATE.raportRows || []).forEach((r) => {
        if (!r) return;
        const inScope = scope !== 'guru' || API.isKelasAllowed(r.kelas, allowed);
        if (!inScope) return;
        if (targetSet && !targetSet.has(r)) return;
        r.n_harian = 0;
        r.n_uas = 0;
        r._dirty = false;
      });

      if (root.MDTA_CACHE) {
        root.MDTA_CACHE.remove('raportRows');
      }
      renderRows();
    }

    async function syncSantriAndKehadiran(silent, syncOpts) {
      const force = Boolean(syncOpts && syncOpts.force);
      if (force && !(syncOpts && syncOpts.preserveReset)) {
        setRaportSessionReset(false);
      }
      const CACHE_CUR = root.MDTA_CACHE;
      if (CACHE_CUR && !raportSessionReset) CACHE_CUR.hydrateState();
      pruneEmptyRaportRows(false);

      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      if (scope === 'guru') {
        STATE.raportRows = (STATE.raportRows || []).filter((r) => API.isKelasAllowed(r.kelas, allowed));
        if (allowed.length === 0) {
          persistValidRaportRows();
          renderRows();
          return;
        }
      }

      if (!force && STATE.santri.length > 0 && STATE.loaded.raport) {
        const scopedSantri = getActiveScopedSantri(scope, sess, '');
        const scopedSaved =
          scope === 'guru'
            ? API.filterByGuruScope(STATE.nilaiRaportSaved || [], sess, 'kelas')
            : (STATE.nilaiRaportSaved || []);
        mergeSantriAndRaportIntoRows(scopedSantri, scopedSaved, null, { suppressSavedScores: raportSessionReset });
        pruneEmptyRaportRows(false);
        if (!raportSessionReset) persistValidRaportRows();
        if (!isTbodyFocused()) renderRows();
        else updateSummaryAndScores();
        return;
      }

      const mySeq = ++raportSyncSeq;
      const showLoading = force || !silent || STATE.raportRows.length === 0;
      if (showLoading) {
        UI.setButtonLoading(syncBtn, true, 'Menyinkronkan...');
      }
      try {
        const now = new Date();
        const semVal = (semSelect && semSelect.value) || '';
        const taVal = (tahunInput && tahunInput.value) || '';
        const needSantri = force || !STATE.santri || STATE.santri.length === 0 || !STATE.loaded.santri;
        const needRaport = force || !STATE.nilaiRaportSaved || STATE.nilaiRaportSaved.length === 0 || !STATE.loaded.bootstrap;

        const [santriOutcome, rekapOutcome, raportOutcome] = await Promise.allSettled([
          needSantri ? API.getSantri() : Promise.resolve(null),
          API.getRekapLaporan(now.getMonth() + 1, now.getFullYear(), {
            semester: semVal,
            tahun_ajaran: taVal,
          }).catch(() => null),
          needRaport ? API.getNilaiRaport().catch(() => null) : Promise.resolve(null),
        ]);
        if (mySeq !== raportSyncSeq) return;

        let santriList = STATE.santri || [];
        if (needSantri) {
          if (santriOutcome.status === 'rejected') {
            throw santriOutcome.reason;
          }
          santriList = API.extractArray(santriOutcome.value, ['santri']).map(API.normalizeSantri);
          if (scope === 'guru') santriList = API.filterByGuruScope(santriList, sess, 'kelas');
          STATE.santri = santriList;
          STATE.loaded.santri = true;
          if (CACHE_CUR) CACHE_CUR.write('santri', santriList);
        } else if (scope === 'guru') {
          santriList = API.filterByGuruScope(santriList, sess, 'kelas');
        }
        santriList = santriList.filter((s) => API.isActiveSantri(s));

        const rekapMap = new Map();
        const rekapRes = rekapOutcome.status === 'fulfilled' ? rekapOutcome.value : null;
        if (rekapRes) {
          const rekapList = API.extractArray(rekapRes, ['rekap']).map(API.normalizeRekap);
          rekapList.forEach((rk) => {
            if (rk.total > 0) {
              const kKey = normKelasKey(rk.kelas);
              if (rk.id_santri) rekapMap.set(`${rk.id_santri}::${kKey}`, rk.persentase);
              rekapMap.set(`${rk.nama_lengkap.trim().toLowerCase()}::${kKey}`, rk.persentase);
            }
          });
        }

        let savedRaportList = STATE.nilaiRaportSaved || [];
        if (needRaport) {
          const rptRes = raportOutcome.status === 'fulfilled' ? raportOutcome.value : null;
          if (rptRes) {
            savedRaportList = API.extractArray(rptRes, ['raport'])
              .map(API.normalizeNilaiRaport)
              .filter((r) => isValidNamaSantri(r.nama_santri));
            if (scope === 'guru') savedRaportList = API.filterByGuruScope(savedRaportList, sess, 'kelas');
            STATE.nilaiRaportSaved = savedRaportList;
            if (CACHE_CUR) CACHE_CUR.write('nilaiRaportSaved', savedRaportList);
          } else if (scope === 'guru') {
            savedRaportList = API.filterByGuruScope(savedRaportList, sess, 'kelas');
          }
        } else if (scope === 'guru') {
          savedRaportList = API.filterByGuruScope(savedRaportList, sess, 'kelas');
        }

        if (mySeq !== raportSyncSeq) return;
        if (santriList.length === 0 && savedRaportList.length === 0) {
          if (!silent) UI.toast('Database santri aktif dan raport saat ini kosong.', 'warn');
          if (!isTbodyFocused()) renderRows();
          return;
        }

        const prevRows = STATE.raportRows.slice();
        mergeSantriAndRaportIntoRows(santriList, savedRaportList, rekapMap, {
          forceOverwriteDirty: force,
          suppressSavedScores: raportSessionReset,
          allowedClasses: scope === 'guru' ? allowed : null,
        });
        pruneEmptyRaportRows(false);
        if (scope === 'guru') {
          STATE.raportRows = (STATE.raportRows || []).filter((r) => API.isKelasAllowed(r.kelas, allowed));
        }
        STATE.loaded.raport = true;
        if (!raportSessionReset) persistValidRaportRows();

        if (!silent || force || !isTbodyFocused()) {
          if (force || !CACHE_CUR || CACHE_CUR.hasChanged(prevRows, STATE.raportRows) || prevRows.length === 0) {
            renderRows();
          }
        } else {
          updateSummaryAndScores();
        }
        if (!silent) {
          UI.toast(`${santriList.length} santri aktif, data nilai, dan persentase kehadiran berhasil disinkronkan.`, 'success');
        }
      } catch (err) {
        if (mySeq !== raportSyncSeq) return;
        if (!silent) UI.toast(err.message, 'error');
      } finally {
        if (showLoading) {
          UI.setButtonLoading(syncBtn, false);
        }
      }
    }

    async function saveRaportToSheets() {
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      if (scope === 'guru' && allowed.length === 0) {
        UI.toast('Akun guru ini belum memiliki kelas ampu dari Administrator.', 'error');
        return null;
      }

      const w = getWeights();
      if (w.total !== 100) {
        UI.toast(`Total bobot saat ini ${w.total}%. Ubah hingga tepat 100% sebelum menyimpan.`, 'error');
        return null;
      }
      const filterK = kelasFilter.value;
      const validRows = getVisibleRaportRows().filter((r) => isValidNamaSantri(r.nama_santri));
      if (validRows.length === 0) {
        UI.toast('Minimal satu baris nama santri harus diisi sebelum menyimpan.', 'warn');
        return null;
      }
      const missingClassRow = validRows.find((r) => !String(r.kelas || '').trim());
      if (missingClassRow) {
        UI.toast(`Kelas untuk santri "${missingClassRow.nama_santri}" wajib dipilih.`, 'error');
        return null;
      }
      if (scope === 'guru') {
        const outOfScope = validRows.find((r) => !API.isKelasAllowed(r.kelas, allowed));
        if (outOfScope) {
          UI.toast(`Santri "${outOfScope.nama_santri}" (${outOfScope.kelas}) di luar kelas ampu Anda (${allowed.join(', ')}).`, 'error');
          return null;
        }
      }

      const periode = `${semSelect.value} ${tahunInput.value.trim()}`;
      const itemsArray = validRows.map((r) => {
        const finalScore = computeRowScore(r, w);
        const pred = getPredicate(finalScore);
        return {
          id_raport: r.id_raport || '',
          id_santri: r.id_santri || '',
          nama_santri: r.nama_santri.trim(),
          kelas: r.kelas.trim(),
          periode,
          n_harian: Number(r.n_harian) || 0,
          n_uas: Number(r.n_uas) || 0,
          n_kehadiran: Number(r.n_kehadiran) || 0,
          bobot_harian: w.harian,
          bobot_uas: w.uas,
          bobot_kehadiran: w.absensi,
          n_akhir: finalScore,
          grade: pred.code,
          keterangan: pred.label,
        };
      });

      raportSyncSeq++;
      const res = await API.saveNilaiRaport(itemsArray);
      const d = res.data || res;
      const returnedItems = Array.isArray(d.items) ? d.items : [];
      const todayIso = UI.todayISO();
      const existingSaved = Array.isArray(STATE.nilaiRaportSaved) ? STATE.nilaiRaportSaved.slice() : [];

      itemsArray.forEach((item, idx) => {
        const returned = returnedItems[idx];
        if (returned && returned.id_raport) {
          item.id_raport = returned.id_raport;
        }
        const rowRef = validRows[idx];
        if (rowRef) {
          if (item.id_raport) rowRef.id_raport = item.id_raport;
          rowRef._dirty = false;
          rowRef._dirtyKehadiran = false;
        }
        const normItem = API.normalizeNilaiRaport(Object.assign({}, item, { updated_at: todayIso }));
        const matchIdx = existingSaved.findIndex((s) =>
          (normItem.id_raport && s.id_raport === normItem.id_raport) ||
          (s.nama_santri.toLowerCase() === normItem.nama_santri.toLowerCase() &&
            normKelasKey(s.kelas) === normKelasKey(normItem.kelas) &&
            s.periode === normItem.periode)
        );
        if (matchIdx >= 0) existingSaved[matchIdx] = normItem;
        else existingSaved.push(normItem);
      });
      STATE.nilaiRaportSaved = existingSaved;
      if (root.MDTA_CACHE) {
        root.MDTA_CACHE.write('nilaiRaportSaved', existingSaved);
      }
      invalidateAdminReportCache();

      // Reset workspace input Harian & UAS menjadi 0 setelah tersimpan ke Admin tanpa menghapus data resmi
      resetRaportWorkspaceScores(validRows);

      return {
        count: d.savedCount || itemsArray.length,
        periode,
        filterK: filterK || (scope === 'guru' ? (allowed[0] || '') : 'Semua Kelas'),
      };
    }

    [wHarian, wUas, wAbsensi].forEach((inp) => {
      inp.addEventListener('input', updateSummaryAndScores);
      inp.addEventListener('change', updateSummaryAndScores);
    });

    resetWeightBtn.addEventListener('click', () => {
      wHarian.value = String(CONFIG.DEFAULT_RAPORT_WEIGHTS.harian);
      wUas.value = String(CONFIG.DEFAULT_RAPORT_WEIGHTS.uas);
      wAbsensi.value = String(CONFIG.DEFAULT_RAPORT_WEIGHTS.absensi);
      updateSummaryAndScores();
      UI.toast('Bobot penilaian dikembalikan ke 40% Harian, 40% UAS, 20% Kehadiran.', 'info');
    });

    kelasFilter.addEventListener('change', () => {
      renderRows();
    });

    syncBtn.addEventListener('click', () => syncSantriAndKehadiran(false, { force: true }));

    if (clearSessionBtn) {
      clearSessionBtn.addEventListener('click', async () => {
        const confirmed = await UI.confirmDialog({
          title: 'Bersihkan Log / Reset Sesi Raport',
          message:
            'Reset seluruh input nilai Harian dan UAS pada workspace Kalkulator Raport menjadi 0 serta bersihkan draft tersimpan di browser? Data resmi di Beranda Laporan Admin dan Google Sheets TIDAK akan terhapus.',
          confirmLabel: 'Reset Sesi',
          danger: true,
        });
        if (!confirmed) return;

        resetRaportWorkspaceScores(null);
        UI.toast('Workspace Kalkulator Raport direset ke 0 (data resmi di Admin tetap aman).', 'info');
      });
    }

    addRowBtn.addEventListener('click', () => {
      const sess = getScopeSession(scope);
      const allowed = getAllowedClasses(scope, sess);
      if (scope === 'guru' && allowed.length === 0) {
        UI.toast('Akun guru ini belum dipetakan ke kelas mana pun oleh Administrator.', 'warn');
        return;
      }
      STATE.raportRows.push({
        uid: `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        id_raport: '',
        id_santri: '',
        nama_santri: '',
        kelas: kelasFilter.value || (allowed[0] || ''),
        n_harian: 0,
        n_uas: 0,
        n_kehadiran: 100,
        _dirty: true,
        _isNewManualDraft: true,
      });
      persistValidRaportRows();
      renderRows();
      const inputs = tbody.querySelectorAll('input[data-field="nama_santri"]');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    });

    aiBtn.addEventListener('click', () => {
      activeRaportScope = scope;
      UI.openModal('modal-import-ai');
    });

    copyWaBtn.addEventListener('click', async () => {
      const w = getWeights();
      const filterK = kelasFilter.value;
      const visible = getVisibleRaportRows().filter((r) => isValidNamaSantri(r.nama_santri));
      if (visible.length === 0) {
        UI.toast('Tidak ada baris santri bernilai untuk disalin.', 'warn');
        return;
      }

      const mapel = mapelInput.value.trim() || 'Penilaian MDTA';
      const kelasTitle = filterK || (scope === 'guru' ? (getAllowedClasses(scope)[0] || '-') : 'Semua');
      const lines = [
        `*REKAP NILAI RAPORT MDTA ASY SYIFA AL MUSRI'*`,
        `Mapel: ${mapel} | Kelas: ${kelasTitle} | ${semSelect.value} ${tahunInput.value.trim()}`,
        `Bobot: Harian ${w.harian}% / UAS ${w.uas}% / Kehadiran ${w.absensi}%`,
        '----------------------------------------',
      ];
      visible.forEach((r, idx) => {
        const finalScore = computeRowScore(r, w);
        const pred = getPredicate(finalScore);
        lines.push(`${idx + 1}. ${r.nama_santri} (${r.kelas || '-'}) = *${finalScore.toFixed(2)}* [${pred.code}] (H: ${r.n_harian}, U: ${r.n_uas}, K: ${r.n_kehadiran}%)`);
      });

      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        UI.toast('Format laporan WhatsApp berhasil disalin ke clipboard.', 'success');
      } catch (err) {
        UI.toast('Gagal menyalin otomatis. Izinkan akses clipboard pada browser Anda.', 'error');
      }
    });

    printBtn.addEventListener('click', () => {
      const panel = container.closest('.tab-panel');
      const metaEl = document.getElementById(`${scope}-raport-print-meta`);
      if (metaEl) {
        const kelasPrint = kelasFilter.value || (scope === 'guru' ? (getAllowedClasses(scope)[0] || '-') : 'Semua Kelas');
        metaEl.textContent = `Mapel: ${mapelInput.value.trim() || '-'} · Kelas: ${kelasPrint} · Semester ${semSelect.value} ${tahunInput.value.trim()}`;
      }
      if (panel) panel.classList.add('is-raport-print-target');
      document.body.classList.add('printing-raport');
      window.print();
      setTimeout(() => {
        document.body.classList.remove('printing-raport');
        if (panel) panel.classList.remove('is-raport-print-target');
      }, 300);
    });

    saveBtn.addEventListener('click', async () => {
      UI.setButtonLoading(saveBtn, true, 'Menyimpan...');
      try {
        const res = await saveRaportToSheets();
        if (res) {
          UI.toast(
            `${res.count} baris nilai raport tersimpan ke Beranda Laporan Admin. Form input direset ke 0 untuk sesi baru.`,
            'success'
          );
        }
      } catch (err) {
        UI.toast(err.message, 'error');
      } finally {
        UI.setButtonLoading(saveBtn, false);
      }
    });

    function refreshScope(newSession, refreshOpts) {
      if (newSession) scopeSessions.set(scope, newSession);
      const sess = getScopeSession(scope);
      const nextUserKey = String((sess && (sess.id_user || sess.username)) || '');
      if (nextUserKey !== lastRaportUserKey) {
        lastRaportUserKey = nextUserKey;
        setRaportSessionReset(false);
      }
      const allowed = getAllowedClasses(scope, sess);
      const signEl = document.getElementById(`${scope}-raport-print-sign-guru`);
      if (signEl) {
        signEl.textContent = sess.nama_lengkap || sess.username || '( ____________________ )';
      }
      pruneEmptyRaportRows(false);
      if (scope === 'guru') {
        STATE.raportRows = (STATE.raportRows || []).filter((r) => API.isKelasAllowed(r.kelas, allowed));
        const scopedSantri = getActiveScopedSantri('guru', sess, '');
        const scopedSaved = API.filterByGuruScope(STATE.nilaiRaportSaved || [], sess, 'kelas');
        if (scopedSantri.length > 0 || (!raportSessionReset && scopedSaved.length > 0)) {
          mergeSantriAndRaportIntoRows(scopedSantri, scopedSaved, null, { suppressSavedScores: raportSessionReset });
        }
        pruneEmptyRaportRows(false);
        if (!raportSessionReset) persistValidRaportRows();
      } else if ((STATE.santri || []).length > 0 || (!raportSessionReset && (STATE.nilaiRaportSaved || []).length > 0)) {
        const activeAll = getActiveScopedSantri('admin', sess, '');
        mergeSantriAndRaportIntoRows(activeAll, STATE.nilaiRaportSaved || [], null, { suppressSavedScores: raportSessionReset });
        pruneEmptyRaportRows(false);
        if (!raportSessionReset) persistValidRaportRows();
      } else {
        if (!raportSessionReset) persistValidRaportRows();
      }
      syncRaportClassFilterOptions();
      if (refreshOpts && refreshOpts.silentBackground && isTbodyFocused()) {
        const dl = document.getElementById(`${scope}-raport-santri-list`);
        if (dl) dl.innerHTML = buildSantriDatalistOptions(scope, sess);
        updateSummaryAndScores();
      } else {
        renderRows();
      }
      if (
        !(refreshOpts && refreshOpts.skipFetch) &&
        !STATE.loaded.raport &&
        (scope !== 'guru' || allowed.length > 0)
      ) {
        syncSantriAndKehadiran(true, { force: false });
      }
    }

    raportInstances.set(scope, { renderRows, updateSummaryAndScores, getWeights, refreshScope });

    const CACHE_INIT = root.MDTA_CACHE;
    if (CACHE_INIT) CACHE_INIT.hydrateState();
    pruneEmptyRaportRows(true);
    const liveSess = getScopeSession(scope);
    const allowedOnMount = getAllowedClasses(scope, liveSess);
    if (scope === 'guru') {
      STATE.raportRows = (STATE.raportRows || []).filter((r) => API.isKelasAllowed(r.kelas, allowedOnMount));
      const scopedSantri = getActiveScopedSantri('guru', liveSess, '');
      const scopedSaved = API.filterByGuruScope(STATE.nilaiRaportSaved || [], liveSess, 'kelas');
      if (scopedSantri.length > 0 || (!raportSessionReset && scopedSaved.length > 0)) {
        mergeSantriAndRaportIntoRows(scopedSantri, scopedSaved, null, { suppressSavedScores: raportSessionReset });
      }
      pruneEmptyRaportRows(true);
      if (!raportSessionReset) persistValidRaportRows();
    } else {
      const activeAll = getActiveScopedSantri('admin', liveSess, '');
      if (activeAll.length > 0 || (!raportSessionReset && (STATE.nilaiRaportSaved || []).length > 0)) {
        mergeSantriAndRaportIntoRows(activeAll, STATE.nilaiRaportSaved || [], null, { suppressSavedScores: raportSessionReset });
      }
      pruneEmptyRaportRows(true);
      if (!raportSessionReset) persistValidRaportRows();
    }

    renderRows();

    if (!STATE.loaded.raport && (scope !== 'guru' || allowedOnMount.length > 0)) {
      syncSantriAndKehadiran(true, { force: false });
    }
  }

  function refreshScope(scope, session, opts) {
    const targetScope = scope || 'admin';
    if (session) scopeSessions.set(targetScope, session);
    const uasInst = uasInstances.get(targetScope);
    if (uasInst && typeof uasInst.refreshScope === 'function') {
      uasInst.refreshScope(session, opts);
    }
    const rptInst = raportInstances.get(targetScope);
    if (rptInst && typeof rptInst.refreshScope === 'function') {
      rptInst.refreshScope(session, opts);
    }
  }

  root.MDTA_CALC = {
    mountUAS,
    mountRaport,
    refreshScope,
    getPredicate,
  };
})(window);
