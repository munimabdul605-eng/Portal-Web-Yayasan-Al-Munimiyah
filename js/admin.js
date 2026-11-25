/**
 * Portal Kepala Madrasah / Administrator (5 Tab) - MDTA ASY SYIFA AL MUSRI'
 * 1. Beranda Laporan:
 *    - Laporan Absensi Harian Otomatis (hasil QR Scan & Input Manual Guru, disusun per kelas)
 *    - Laporan Nilai Otomatis (Nilai UAS & Nilai Raport Guru, disusun per kelas + Modal Detail Nilai)
 * 2. Database Santri (Pencarian real-time, Tambah/Edit/Hapus, Lihat/Unduh/Cetak Kartu QR)
 * 3. Rekap Laporan Bulanan (Filter-first + Pencarian Santri, Ekspor CSV, Cetak PDF, Unggah PDF ke Drive)
 * 4. Kelola Kelas & Pemetaan Guru Pengampu
 * 5. Kelola Akun Guru & Admin
 */
(function (root) {
  'use strict';

  const CONFIG = root.MDTA_CONFIG;
  const STATE = root.MDTA_STATE;
  const API = root.MDTA_API;
  const UI = root.MDTA_UI;

  let initialized = false;
  let adminSession = null;
  let tabController = null;
  let syncPollTimer = null;
  let syncCheckInFlight = false;
  let syncRefreshInFlight = false;
  let syncVisibilityBound = false;
  let syncActive = false;
  let syncUnsupported = false;

  const localState = {
    activeDateWib: UI.todayISO(),
    localSyncTs: null,
    riwayatHarian: [],
    riwayatFilterStatus: 'Semua',
    riwayatQuery: '',
    usersQuery: '',
    usersRoleFilter: 'Semua',
    santriQuery: '',
    santriKelasFilter: '',
    currentQRData: null,
    rekapNilaiList: [],
    selectedNilaiCard: null,
    laporanPerKelas: [],
    absensiBlocksToday: [],
    nilaiCardsToday: [],
    kepsekReportMode: 'absensi',
    kepsekModeLocked: false,
    kepsekProgramFilter: '',
    rekapHasSearched: false,
    rekapSearchQuery: '',
    rekapProgramFilter: '',
    rekapMode: 'santri',
    rekapGuruRows: [],
    editingUserId: null,
    editingUserOriginalUsername: '',
    editingSantriId: null,
    editingKelasId: null,
    editingKelasOriginalName: '',
    kelasHariManuallyEdited: false,
    mappingKelasName: '',
    movingSantriId: '',
    selectedSantriIds: new Set(),
  };

  function statusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('hadir')) return 'status-hadir';
    if (s.includes('sakit')) return 'status-sakit';
    if (s.includes('izin')) return 'status-izin';
    if (s.includes('alpa') || s.includes('alpha')) return 'status-alpa';
    return 'status-izin';
  }

  function gradeBadgeClass(grade) {
    const g = String(grade || '').trim().toUpperCase();
    if (g === 'A') return 'status-hadir';
    if (g === 'B') return 'status-izin';
    if (g === 'C') return 'status-sakit';
    return 'status-alpa';
  }

  function formatJamWIB(waktuStr) {
    if (!waktuStr) return '';
    const m = String(waktuStr).match(/(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}.${m[2]} WIB`;
    return String(waktuStr);
  }

  function generateNextLocalId(list, field, prefix, padLen) {
    const used = new Set();
    const escapedPrefix = String(prefix || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('^' + escapedPrefix + '(\\d+)$', 'i');
    let maxNum = 0;

    (Array.isArray(list) ? list : []).forEach((item) => {
      const val = String((item && item[field]) || '').trim();
      if (!val) return;
      used.add(val);
      const m = val.match(pattern);
      if (m) {
        const num = parseInt(m[1], 10);
        if (Number.isFinite(num) && num > maxNum) maxNum = num;
      }
    });

    let next = maxNum + 1;
    let candidate = prefix + String(next).padStart(padLen, '0');
    while (used.has(candidate)) {
      next++;
      candidate = prefix + String(next).padStart(padLen, '0');
    }
    return candidate;
  }

  // =========================================================================
  // HELPER KELAS RESMI & PEMETAAN GURU
  // =========================================================================
  function getOfficialClasses() {
    if (Array.isArray(STATE.kelas) && STATE.kelas.length > 0) {
      return STATE.kelas
        .map(API.normalizeKelas)
        .filter((k) => k.nama_kelas)
        .sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas));
    }
    const set = new Set();
    (STATE.santri || []).forEach((s) => {
      if (s.kelas) set.add(s.kelas);
    });
    if (set.size === 0) {
      (CONFIG.KELAS_OPTIONS || []).forEach((k) => set.add(k));
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((namaKelas, idx) => ({
        id_kelas: `SYN-${String(idx + 1).padStart(3, '0')}`,
        nama_kelas: namaKelas,
        tingkat: '',
        keterangan: 'Sinkron dari data lokal',
        status: 'aktif',
        isSynthetic: true,
      }));
  }

  function getOfficialClassNames(includeInactive) {
    return getOfficialClasses()
      .filter((k) => includeInactive || k.status !== 'nonaktif')
      .map((k) => k.nama_kelas);
  }

  function getGurusForClass(kelasName) {
    return (STATE.users || []).filter(
      (u) =>
        String(u.role || '').trim().toLowerCase() === 'guru' &&
        String(u.status_aktif || 'aktif').trim().toLowerCase() === 'aktif' &&
        API.isKelasAllowed(kelasName, u.kelas_ampu)
    );
  }

  function findGuruUserRecord(ref) {
    const users = Array.isArray(STATE.users) ? STATE.users : [];
    const isObj = ref && typeof ref === 'object';
    const refId = isObj ? String(ref.id_user || '').trim() : '';
    const refUsername = isObj ? String(ref.username || '').trim() : '';
    const refNamaRaw = isObj
      ? String(ref.nama_lengkap || ref.nama || ref.username || '').trim()
      : String(ref || '').trim();
    const refFoto = isObj ? String(ref.foto_url || '').trim() : '';

    const refUnameLower = refUsername.toLowerCase();
    const refNamaLower = refNamaRaw.toLowerCase();

    const matched = users.find((u) => {
      if (!u) return false;
      const uid = String(u.id_user || '').trim();
      const uUser = String(u.username || '').trim().toLowerCase();
      const uName = String(u.nama_lengkap || '').trim().toLowerCase();
      if (refId && uid && refId === uid) return true;
      if (refUnameLower && uUser && refUnameLower === uUser) return true;
      if (refNamaLower && ((uName && refNamaLower === uName) || (uUser && refNamaLower === uUser))) {
        return true;
      }
      return false;
    });

    return {
      nama: refNamaRaw || (matched ? String(matched.nama_lengkap || matched.username || '').trim() : ''),
      foto_url: refFoto || (matched ? String(matched.foto_url || '').trim() : ''),
    };
  }

  function renderGuruInlineListHtml(entries, opts) {
    const cfg = opts && typeof opts === 'object' ? opts : {};
    const fallbackText = cfg.fallbackText !== undefined ? String(cfg.fallbackText) : 'Belum dipetakan';
    const compact = Boolean(cfg.compact);
    const rawList = Array.isArray(entries) ? entries : entries ? [entries] : [];
    const expanded = [];

    rawList.forEach((entry) => {
      if (typeof entry === 'string') {
        const s = entry.trim();
        if (!s) return;
        const exact = findGuruUserRecord(s);
        if (exact.foto_url || !s.includes(',')) {
          expanded.push(exact);
        } else {
          s.split(',')
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => expanded.push(findGuruUserRecord(part)));
        }
      } else if (entry && typeof entry === 'object') {
        expanded.push(findGuruUserRecord(entry));
      }
    });

    const seen = new Set();
    const normalized = [];
    expanded.forEach((item) => {
      const nama = String((item && item.nama) || '').trim();
      if (!nama || nama === '-' || nama.toLowerCase() === 'belum dipetakan') return;
      const key = nama.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ nama, foto_url: String((item && item.foto_url) || '').trim() });
    });

    if (normalized.length === 0) {
      return `<strong>${UI.esc(fallbackText)}</strong>`;
    }

    const size = compact ? 20 : 24;
    const compactCls = compact ? ' is-compact' : '';
    const personsHtml = normalized
      .map((g) => {
        const inner =
          typeof UI.buildAvatarInnerHtml === 'function'
            ? UI.buildAvatarInnerHtml(g.nama, g.foto_url, { size, fallback: 'G' })
            : UI.esc((g.nama || 'G').charAt(0).toUpperCase());
        return `<span class="guru-inline-person${compactCls}"><span class="user-avatar-circle guru-inline-avatar${compactCls}">${inner}</span><strong>${UI.esc(g.nama)}</strong></span>`;
      })
      .join('');

    return `<span class="guru-inline-list">${personsHtml}</span>`;
  }

  function populateClassSelect(el, names, opts) {
    if (!el) return;
    const cfg = opts || {};
    const cur = el.value;
    const list = Array.isArray(names) ? names : [];
    const htmlParts = [];
    if (cfg.firstLabel !== undefined) {
      htmlParts.push(`<option value="${UI.esc(cfg.firstValue || '')}">${UI.esc(cfg.firstLabel)}</option>`);
    }
    list.forEach((k) => {
      htmlParts.push(`<option value="${UI.esc(k)}">${UI.esc(k)}</option>`);
    });
    el.innerHTML = htmlParts.join('');
    if (cur && (cur === (cfg.firstValue || '') || list.includes(cur))) {
      el.value = cur;
    } else if (cfg.defaultToFirst && list.length > 0 && cfg.firstLabel === undefined) {
      el.value = list[0];
    }
  }

  // =========================================================================
  // TAB 1: BERANDA KEPALA MADRASAH (TERPISAH PER KELAS) & KELOLA AKUN
  // =========================================================================
  function renderDashboardStats(summary, totalCatatan) {
    const hadir = Number(summary.Hadir ?? summary.hadir);
    const sakit = Number(summary.Sakit ?? summary.sakit);
    const izin = Number(summary.Izin ?? summary.izin);
    const alpa = Number(summary.Alpa ?? summary.alpa);

    const hasNumbers = [hadir, sakit, izin, alpa].every((n) => Number.isFinite(n));
    const total = hasNumbers ? hadir + sakit + izin + alpa : (Number(totalCatatan) || 0);

    const map = [
      { id: 'stat-hadir', val: summary.Hadir ?? summary.hadir, pctId: 'stat-hadir-foot' },
      { id: 'stat-sakit', val: summary.Sakit ?? summary.sakit, pctId: 'stat-sakit-foot' },
      { id: 'stat-izin', val: summary.Izin ?? summary.izin, pctId: 'stat-izin-foot' },
      { id: 'stat-alpa', val: summary.Alpa ?? summary.alpa, pctId: 'stat-alpa-foot' },
    ];

    map.forEach((item) => {
      const valEl = document.getElementById(item.id);
      const footEl = document.getElementById(item.pctId);
      const num = Number(item.val);
      if (valEl) valEl.textContent = Number.isFinite(num) ? String(num) : '-';
      if (footEl) {
        if (Number.isFinite(num) && total > 0) {
          const pct = Math.round((num / total) * 1000) / 10;
          footEl.textContent = `${pct}%`;
        } else {
          footEl.textContent = '';
        }
      }
    });
  }

  function renderAbsentStudentListHtml(list, tanggal, compactEmpty) {
    if (!Array.isArray(list) || list.length === 0) {
      if (compactEmpty) {
        return `<div class="sub-surface text-muted" style="font-size:0.8rem;padding:9px 11px;">Semua santri kelas ini yang tercatat pada tanggal terpilih berstatus Hadir.</div>`;
      }
      return UI.renderStateBox({
        type: 'empty',
        title: 'Tidak ada santri absen pada tanggal ini',
        message: 'Seluruh santri yang tercatat pada tanggal terpilih berstatus Hadir, atau belum ada catatan ketidakhadiran.',
      });
    }

    const tglLabel = UI.formatDateShort(tanggal);
    return `<div class="absent-list">${list
      .map((item) => {
        const pesanWA = `Assalamu'alaikum Bapak/Ibu Wali Santri dari ananda ${item.nama_santri} (${item.kelas}). Menginformasikan dari ${CONFIG.INSTITUTION_NAME} bahwa pada tanggal ${tglLabel} ananda tercatat tidak hadir dengan status: ${item.status}${item.catatan ? ` (${item.catatan})` : ''}. Mohon konfirmasinya. Terima kasih.`;
        const waUrl = API.formatWhatsAppUrl(item.no_wa_ortu, pesanWA);

        return `
          <div class="absent-student-item">
            <div class="absent-student-info">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <strong style="font-size:0.92rem;">${UI.esc(item.nama_santri)}</strong>
                <span class="status-badge ${statusBadgeClass(item.status)}">${UI.esc(item.status)}</span>
              </div>
              <div class="text-muted guru-recorder-row">
                ${item.catatan ? `<span>Keterangan: ${UI.esc(item.catatan)} ·</span>` : ''}
                <span>Dicatat oleh</span>
                ${renderGuruInlineListHtml(
                  item.nama_guru_piket && item.nama_guru_piket !== '-'
                    ? [{ id_user: item.id_guru_piket || '', nama_lengkap: item.nama_guru_piket }]
                    : [],
                  { fallbackText: item.nama_guru_piket || '-', compact: true }
                )}
              </div>
            </div>
            <div>
              ${waUrl
            ? `<a href="${UI.esc(waUrl)}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">
                       <i data-lucide="message-circle" aria-hidden="true"></i>
                       <span>Hubungi WA Ortu</span>
                     </a>`
            : `<span class="text-muted" style="font-size:0.78rem;">No. WA belum diisi</span>`
          }
            </div>
          </div>
        `;
      })
      .join('')}</div>`;
  }

  function compareClassOrder(a, b) {
    const officialOrder = getOfficialClassNames(false);
    const nameA = String(a || '');
    const nameB = String(b || '');
    const idxA = officialOrder.findIndex((k) => k.toLowerCase() === nameA.toLowerCase());
    const idxB = officialOrder.findIndex((k) => k.toLowerCase() === nameB.toLowerCase());
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    return nameA.localeCompare(nameB);
  }

  function sanitizeRekapNilaiCard(card) {
    const rawJenis = String((card && card.jenis_nilai) || '').trim();
    const isUAS = /uas/i.test(rawJenis);
    const jenisNilai = isUAS ? 'Nilai UAS' : 'Nilai Raport';
    const rawRows = Array.isArray(card && card.detail_nilai) ? card.detail_nilai : [];

    const detailRows = rawRows.map((r) => {
      if (isUAS || /uas/i.test(String(r.jenis_nilai || ''))) {
        const rawScore = r.n_uas !== undefined && r.n_uas !== null ? r.n_uas : (r.nilai_uas !== undefined ? r.nilai_uas : r.n_akhir);
        const score = Math.round(API.parseLocaleNumber(rawScore, 0) * 100) / 100;
        const pred = API.computeRaportGrade(score);
        const rawGrade = !API.isSheetErrorValue(r.grade) ? String(r.grade).trim().toUpperCase() : '';
        const grade = ['A', 'B', 'C', 'D'].includes(rawGrade) ? rawGrade : pred.grade;
        const keterangan = !API.isSheetErrorValue(r.keterangan) ? String(r.keterangan).trim() : pred.keterangan;
        return {
          id_uas: String(r.id_uas || ''),
          id_santri: String(r.id_santri || ''),
          nama_santri: String(r.nama_santri || '-'),
          kelas: String(r.kelas || (card && card.kelas) || ''),
          periode: String(r.periode || (card && card.periode) || ''),
          jenis_nilai: 'Nilai UAS',
          skema_soal: String(r.skema_soal || '-'),
          pg_benar: API.parseLocaleNumber(r.pg_benar, 0),
          essay_benar: API.parseLocaleNumber(r.essay_benar, 0),
          setengah_benar: API.parseLocaleNumber(r.setengah_benar, 0),
          n_harian: null,
          n_uas: score,
          n_kehadiran: null,
          n_akhir: score,
          grade,
          keterangan,
          updated_at: String(r.updated_at || ''),
        };
      }

      const resolved = API.resolveRaportNilai(r);
      return {
        id_raport: String(r.id_raport || ''),
        id_santri: String(r.id_santri || ''),
        nama_santri: String(r.nama_santri || '-'),
        kelas: String(r.kelas || (card && card.kelas) || ''),
        periode: String(r.periode || (card && card.periode) || ''),
        jenis_nilai: 'Nilai Raport',
        n_harian: resolved.n_harian,
        n_uas: resolved.n_uas,
        n_kehadiran: resolved.n_kehadiran,
        bobot_harian: resolved.bobot_harian,
        bobot_uas: resolved.bobot_uas,
        bobot_kehadiran: resolved.bobot_kehadiran,
        n_akhir: resolved.n_akhir,
        grade: resolved.grade,
        keterangan: resolved.keterangan,
        updated_at: String(r.updated_at || ''),
      };
    });

    const jumlahSantri = detailRows.length;
    const rataRata =
      jumlahSantri > 0
        ? Math.round((detailRows.reduce((s, item) => s + Number(item.n_akhir || 0), 0) / jumlahSantri) * 100) / 100
        : Number((card && card.rata_rata) || 0);
    const jumlahTuntas =
      jumlahSantri > 0
        ? detailRows.filter((item) => ['A', 'B', 'C'].includes(String(item.grade).toUpperCase())).length
        : Number((card && card.jumlah_tuntas) || 0);
    const jumlahPerluBimbingan =
      jumlahSantri > 0
        ? jumlahSantri - jumlahTuntas
        : Number((card && card.jumlah_perlu_bimbingan) || 0);

    return Object.assign({}, card, {
      jenis_nilai: jenisNilai,
      jumlah_santri: jumlahSantri > 0 ? jumlahSantri : Number((card && card.jumlah_santri) || 0),
      rata_rata: rataRata,
      jumlah_tuntas: jumlahTuntas,
      jumlah_perlu_bimbingan: jumlahPerluBimbingan,
      detail_nilai: detailRows,
    });
  }

  function synthesizeDailyNilaiCardsFromState(targetTanggal) {
    const targetIso = API.normalizeISODate(targetTanggal);
    if (!targetIso) return [];
    const cards = [];

    const raportGroups = new Map();
    (STATE.nilaiRaportSaved || []).forEach((r) => {
      const k = String(r.kelas || 'Tanpa Kelas').trim() || 'Tanpa Kelas';
      const per = String(r.periode || 'Ganjil 2026/2027').trim();
      const upd = API.normalizeISODate(r.updated_at);
      if (upd !== targetIso) return;
      const key = `${k.toLowerCase()}||${per}`;
      if (!raportGroups.has(key)) raportGroups.set(key, { kelas: k, periode: per, rows: [] });
      raportGroups.get(key).rows.push(Object.assign({}, r, { updated_at: upd }));
    });
    raportGroups.forEach((g) => {
      const gurus = getGurusForClass(g.kelas);
      cards.push(
        sanitizeRekapNilaiCard({
          jenis_nilai: 'Nilai Raport',
          kelas: g.kelas,
          periode: g.periode,
          nama_guru: gurus.length > 0 ? gurus.map((x) => x.nama_lengkap || x.username).join(', ') : 'Guru Pengampu',
          tanggal_setor: targetIso,
          detail_nilai: g.rows,
        })
      );
    });

    const uasGroups = new Map();
    (STATE.nilaiUAS || []).forEach((u) => {
      const k = String(u.kelas || 'Tanpa Kelas').trim() || 'Tanpa Kelas';
      const per = String(u.periode || 'Ganjil 2026/2027').trim();
      const upd = API.normalizeISODate(u.updated_at);
      if (upd !== targetIso) return;
      const key = `${k.toLowerCase()}||${per}`;
      if (!uasGroups.has(key)) {
        uasGroups.set(key, { kelas: k, periode: per, bySantri: new Map(), idGuru: u.id_guru || '' });
      }
      const grp = uasGroups.get(key);
      const dedupKey = String(u.id_santri || '').trim() || String(u.nama_santri || '').trim().toLowerCase();
      if (!grp.bySantri.has(dedupKey)) {
        grp.bySantri.set(dedupKey, Object.assign({}, u, { updated_at: upd }));
      }
      if (!grp.idGuru && u.id_guru) grp.idGuru = u.id_guru;
    });
    uasGroups.forEach((g) => {
      const rows = Array.from(g.bySantri.values());
      const userObj = g.idGuru
        ? (STATE.users || []).find((u) => String(u.id_user || '').trim() === String(g.idGuru).trim())
        : null;
      const gurus = getGurusForClass(g.kelas);
      const guruName = userObj
        ? userObj.nama_lengkap || userObj.username
        : gurus.length > 0
          ? gurus.map((x) => x.nama_lengkap || x.username).join(', ')
          : 'Guru Pengampu';
      cards.push(
        sanitizeRekapNilaiCard({
          jenis_nilai: 'Nilai UAS',
          kelas: g.kelas,
          periode: g.periode,
          nama_guru: guruName,
          tanggal_setor: targetIso,
          detail_nilai: rows,
        })
      );
    });

    return cards;
  }

  function buildLaporanPerKelas(rk, targetTanggal, targetKelas) {
    if (rk && Array.isArray(rk.laporan_per_kelas) && rk.laporan_per_kelas.length > 0) {
      return rk.laporan_per_kelas
        .filter((blk) => !targetKelas || String(blk.kelas || '').toLowerCase() === targetKelas.toLowerCase())
        .map((blk) => {
          const gurus =
            Array.isArray(blk.guru_pengampu) && blk.guru_pengampu.length > 0
              ? blk.guru_pengampu
              : getGurusForClass(blk.kelas);
          const namaPengampu =
            gurus.length > 0 ? gurus.map((g) => g.nama_lengkap || g.username).join(', ') : 'Belum dipetakan';
          const cleanNilai = (Array.isArray(blk.rekap_nilai) ? blk.rekap_nilai : []).map(sanitizeRekapNilaiCard);
          return Object.assign({}, blk, {
            guru_pengampu: gurus,
            nama_guru_pengampu: namaPengampu,
            rekap_nilai: cleanNilai,
          });
        });
    }

    const statusList = Array.isArray(rk && rk.status_setoran_hari_ini) ? rk.status_setoran_hari_ini : [];
    const abs = (rk && rk.absensi_harian) || {};
    const allRiwayat = (Array.isArray(abs.riwayat) ? abs.riwayat : []).map(API.normalizePresensi);
    const allAbsent = Array.isArray(abs.santri_tidak_hadir) ? abs.santri_tidak_hadir : [];
    const allNilai = (Array.isArray(rk && rk.rekap_nilai) ? rk.rekap_nilai : []).map(sanitizeRekapNilaiCard);

    const nameSet = new Set(getOfficialClassNames(false));
    if (rk && Array.isArray(rk.daftar_kelas)) rk.daftar_kelas.forEach((k) => k && nameSet.add(k));
    statusList.forEach((s) => s && s.kelas && nameSet.add(s.kelas));
    allNilai.forEach((n) => n && n.kelas && n.kelas !== 'Semua Kelas' && nameSet.add(n.kelas));

    const classNames = Array.from(nameSet)
      .filter((k) => !targetKelas || k.toLowerCase() === targetKelas.toLowerCase())
      .sort((a, b) => a.localeCompare(b));

    return classNames.map((k) => {
      const kLower = k.toLowerCase();
      const gurus = getGurusForClass(k);
      const namaPengampu =
        gurus.length > 0 ? gurus.map((g) => g.nama_lengkap || g.username).join(', ') : 'Belum dipetakan';
      const stMatched = statusList.find((s) => String(s.kelas || '').toLowerCase() === kLower);
      const classRiwayat = allRiwayat.filter((r) => String(r.kelas || '').toLowerCase() === kLower);
      const classAbsent = allAbsent.filter((r) => String(r.kelas || '').toLowerCase() === kLower);
      const classAgregat = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: classRiwayat.length };
      classRiwayat.forEach((r) => {
        if (Object.prototype.hasOwnProperty.call(classAgregat, r.status)) classAgregat[r.status]++;
      });
      const classNilai = allNilai.filter((n) => String(n.kelas || '').toLowerCase() === kLower);
      const totalSantriAktif = (STATE.santri || []).filter(
        (s) => API.isKelasAllowed(k, API.parseKelasAmpu(s.kelas)) && String(s.status || 'aktif').toLowerCase() === 'aktif'
      ).length;
      const totalNilaiSantri = classNilai.reduce((s, n) => s + Number(n.jumlah_santri || 0), 0);
      const totalTuntas = classNilai.reduce((s, n) => s + Number(n.jumlah_tuntas || 0), 0);
      const totalBimbingan = classNilai.reduce((s, n) => s + Number(n.jumlah_perlu_bimbingan || 0), 0);
      const weightedSum = classNilai.reduce((s, n) => s + Number(n.rata_rata || 0) * Number(n.jumlah_santri || 0), 0);
      const avgNilai =
        totalNilaiSantri > 0
          ? Math.round((weightedSum / totalNilaiSantri) * 100) / 100
          : classNilai[0]
            ? Number(classNilai[0].rata_rata || 0)
            : 0;

      return {
        kelas: k,
        jumlah_santri: stMatched ? Number(stMatched.jumlah_santri || 0) : totalSantriAktif,
        guru_pengampu: gurus,
        nama_guru_pengampu: namaPengampu,
        status_setoran: stMatched
          ? {
            sudah_setor: Boolean(stMatched.sudah_setor),
            id_setoran: stMatched.id_setoran || '',
            nama_guru: stMatched.nama_guru || '',
            waktu_submit: stMatched.waktu_submit || '',
            ringkasan: stMatched.ringkasan || '',
          }
          : { sudah_setor: false, id_setoran: '', nama_guru: '', waktu_submit: '', ringkasan: '' },
        agregat_absensi: classAgregat,
        santri_tidak_hadir: classAbsent,
        riwayat_absensi: classRiwayat,
        rekap_nilai: classNilai,
        ringkasan_nilai: {
          jumlah_santri: totalNilaiSantri,
          rata_rata: avgNilai,
          jumlah_tuntas: totalTuntas,
          jumlah_perlu_bimbingan: totalBimbingan,
          status_setoran: classNilai.some((n) => n.status_setoran === 'Sudah Disetor')
            ? 'Sudah Disetor'
            : classNilai.length > 0
              ? 'Draft'
              : 'Belum Ada Nilai',
          periode: classNilai[0] ? classNilai[0].periode : '-',
          nama_guru: classNilai[0] ? classNilai[0].nama_guru : namaPengampu,
        },
      };
    });
  }

  function isNilaiCardOnDate(card, targetTanggal) {
    const target = API.normalizeISODate(targetTanggal);
    if (!target || !card) return false;
    if (API.normalizeISODate(card.tanggal_setor) === target) return true;
    if (API.normalizeISODate(card.waktu_submit) === target) return true;
    if (
      Array.isArray(card.detail_nilai) &&
      card.detail_nilai.some((r) => API.normalizeISODate(r.updated_at) === target)
    ) {
      return true;
    }
    return false;
  }

  function renderKepsekSubtabs(activeClasses, activeKelas) {
    const bar = document.getElementById('kepsek-kelas-subtabs');
    if (!bar) return;

    const list = Array.isArray(activeClasses) ? activeClasses : [];
    if (list.length < 2) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    const buttons = [
      `<button type="button" class="kelas-subtab" data-kepsek-subtab="" aria-pressed="${!activeKelas ? 'true' : 'false'}">Semua (${list.length})</button>`,
    ];
    list.forEach((k) => {
      const pressed = activeKelas && activeKelas.toLowerCase() === k.toLowerCase();
      buttons.push(
        `<button type="button" class="kelas-subtab" data-kepsek-subtab="${UI.esc(k)}" aria-pressed="${pressed ? 'true' : 'false'}"><span>${UI.esc(k)}</span></button>`
      );
    });

    bar.hidden = false;
    bar.innerHTML = buttons.join('');
    bar.querySelectorAll('button[data-kepsek-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.kepsekSubtab || '';
        const kelasSel = document.getElementById('kepsek-filter-kelas');
        if (kelasSel) {
          kelasSel.value = chosen;
          loadDashboard(false, { force: false });
        }
      });
    });
  }

  function resolveClassKategori(kelasName) {
    const kKey = String(kelasName || '').trim().toLowerCase();
    const found = (STATE.kelas || []).find((k) => String(k.nama_kelas || '').trim().toLowerCase() === kKey);
    if (found && found.kategori_program) return found.kategori_program;
    if (typeof API.normalizeKategoriProgram === 'function') {
      return API.normalizeKategoriProgram('', kelasName);
    }
    return 'Diniyyah';
  }

  function getProgramDocumentTitle(kat) {
    if (kat === 'Diniyyah') return 'Raport Resmi Diniyyah';
    if (kat === 'Wustho') return 'Raport Internal Wustho';
    if (kat === 'Tahfidz') return 'Evaluasi Program Tahfidz';
    if (kat === 'Tarikh') return 'Evaluasi Program Tarikh';
    return 'Rekap Presensi Bulanan';
  }

  function applyKepsekReportMode(mode) {
    const nextMode = mode === 'nilai' ? 'nilai' : mode === 'guru' ? 'guru' : 'absensi';
    localState.kepsekReportMode = nextMode;

    const absPanel = document.getElementById('kepsek-absensi-panel');
    const nilaiPanel = document.getElementById('kepsek-nilai-panel');
    const guruPanel = document.getElementById('kepsek-guru-panel');
    const absBtn = document.getElementById('btn-kepsek-mode-absensi');
    const nilaiBtn = document.getElementById('btn-kepsek-mode-nilai');
    const guruBtn = document.getElementById('btn-kepsek-mode-guru');

    if (absPanel) absPanel.hidden = nextMode !== 'absensi';
    if (nilaiPanel) nilaiPanel.hidden = nextMode !== 'nilai';
    if (guruPanel) guruPanel.hidden = nextMode !== 'guru';
    if (absBtn) absBtn.setAttribute('aria-pressed', nextMode === 'absensi' ? 'true' : 'false');
    if (nilaiBtn) nilaiBtn.setAttribute('aria-pressed', nextMode === 'nilai' ? 'true' : 'false');
    if (guruBtn) guruBtn.setAttribute('aria-pressed', nextMode === 'guru' ? 'true' : 'false');

    const activeKelas = document.getElementById('kepsek-filter-kelas')?.value || '';
    const classesForMode =
      nextMode === 'nilai'
        ? localState.allActiveNilaiClasses || []
        : localState.allActiveAbsensiClasses || [];
    renderKepsekSubtabs(classesForMode, activeKelas);
    if (nextMode === 'guru') {
      renderKepsekMonitoringGuru();
    }
  }

  function renderKepsekMonitoringGuru() {
    const container = document.getElementById('kepsek-guru-container');
    const countEl = document.getElementById('kepsek-guru-count');
    const activeGurus = (STATE.users || []).filter(
      (u) => String(u.role || '').toLowerCase() === 'guru' && String(u.status_aktif || 'aktif').toLowerCase() === 'aktif'
    );
    const todayLogs = Array.isArray(STATE.absensiGuruToday) ? STATE.absensiGuruToday : [];
    const progFilter = localState.kepsekProgramFilter || '';
    const activeKelas = document.getElementById('kepsek-filter-kelas')?.value || '';
    const activeKelasLower = activeKelas.toLowerCase();

    const filteredAllLogs = todayLogs.filter((l) => {
      const kat = l.kategori_program || resolveClassKategori(l.kelas);
      if (progFilter && kat !== progFilter) return false;
      if (activeKelasLower && String(l.kelas || '').trim().toLowerCase() !== activeKelasLower) return false;
      return true;
    });

    if (countEl) countEl.textContent = String(filteredAllLogs.length);
    if (!container) return;

    if (activeGurus.length === 0 && filteredAllLogs.length === 0) {
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada data guru aktif',
        message: 'Tambahkan akun guru pada tab Akun Guru untuk memantau kehadiran dan materi harian.',
      });
      UI.refreshIcons(container);
      return;
    }

    const cards = [];
    const logByGuruId = new Map();
    const logByGuruName = new Map();
    const consumedLogs = new Set();

    filteredAllLogs.forEach((log) => {
      const gid = String(log.id_guru || '').trim();
      const gname = String(log.nama_guru || '').trim().toLowerCase();
      if (gid) {
        if (!logByGuruId.has(gid)) logByGuruId.set(gid, []);
        logByGuruId.get(gid).push(log);
      }
      if (gname) {
        if (!logByGuruName.has(gname)) logByGuruName.set(gname, []);
        logByGuruName.get(gname).push(log);
      }
    });

    const normalizeAvatarSrc = (url) => {
      const raw = String(url || '').trim();
      if (!raw) return '';
      return typeof API.normalizeDriveImageUrl === 'function' ? API.normalizeDriveImageUrl(raw) : raw;
    };

    activeGurus.forEach((g) => {
      const gid = String(g.id_user || '').trim();
      const uname = String(g.username || '').trim().toLowerCase();
      const displayName = g.nama_lengkap || g.username || 'Guru';
      const dKey = displayName.trim().toLowerCase();
      const matchedLogs = (gid && logByGuruId.get(gid)) || logByGuruName.get(dKey) || logByGuruName.get(uname) || [];
      matchedLogs.forEach((l) => consumedLogs.add(l));

      const avatarHtml =
        typeof UI.buildAvatarInnerHtml === 'function'
          ? UI.buildAvatarInnerHtml(displayName, g.foto_url, { size: 40, fallback: 'G' })
          : (() => {
              const initials = displayName.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || 'G';
              const fotoSrc = normalizeAvatarSrc(g.foto_url);
              return fotoSrc
                ? `<img src="${UI.esc(fotoSrc)}" alt="${UI.esc(displayName)}" class="avatar-img" data-fallback-initials="${UI.esc(initials)}" referrerpolicy="no-referrer" />`
                : UI.esc(initials);
            })();

      if (matchedLogs.length === 0) {
        if (activeKelas && !API.isKelasAllowed(activeKelas, g.kelas_ampu || [])) return;
        if (progFilter) {
          const hasProgramClass = (g.kelas_ampu || []).some((k) => resolveClassKategori(k) === progFilter);
          if (!hasProgramClass) return;
        }
        cards.push(`
          <article class="guru-monitor-card">
            <div class="guru-monitor-head">
              <div class="user-avatar-circle guru-monitor-avatar">${avatarHtml}</div>
              <div style="min-width:0;flex:1;">
                <strong style="display:block;">${UI.esc(displayName)}</strong>
                <div class="text-muted" style="font-size:0.78rem;">${UI.esc((g.kelas_ampu || []).join(', ') || 'Belum ada kelas ampu')}</div>
              </div>
              <span class="status-badge status-sakit">Belum Absen</span>
            </div>
            <div class="text-muted" style="font-size:0.82rem;">Belum mengirim absen mengajar dan laporan materi hari ini.</div>
          </article>
        `);
        return;
      }

      matchedLogs.forEach((log) => {
        const isChecked = String(log.status_cek || '').toLowerCase() === 'sudah dicek';
        const stCls =
          log.status === 'Hadir Mengajar'
            ? 'status-hadir'
            : log.status === 'Izin'
              ? 'status-izin'
              : log.status === 'Sakit'
                ? 'status-sakit'
                : 'status-alpa';
        cards.push(`
          <article class="guru-monitor-card" data-absen-guru-id="${UI.esc(log.id_absen_guru)}">
            <div class="guru-monitor-head">
              <div class="user-avatar-circle guru-monitor-avatar">${avatarHtml}</div>
              <div style="min-width:0;flex:1;">
                <strong style="display:block;">${UI.esc(displayName)}</strong>
                <div class="text-muted" style="font-size:0.78rem;">${UI.esc(log.kelas)} · ${UI.esc(log.kategori_program || resolveClassKategori(log.kelas))} · Jam ${UI.esc(log.waktu_masuk || '-')}</div>
              </div>
              <span class="status-badge ${stCls}">${UI.esc(log.status)}</span>
            </div>
            <div class="guru-monitor-materi">
              <span class="detail-label">Laporan Materi Hari Ini</span>
              <p style="margin:4px 0 0;font-size:0.88rem;line-height:1.5;">${UI.esc(log.materi_diajarkan || '-')}</p>
              ${log.keterangan ? `<p class="text-muted" style="margin:4px 0 0;font-size:0.78rem;">Keterangan: ${UI.esc(log.keterangan)}</p>` : ''}
            </div>
            <div class="guru-monitor-verify">
              <input type="text" class="input-control" data-kepsek-catatan="${UI.esc(log.id_absen_guru)}" value="${UI.esc(log.catatan_kepsek || '')}" placeholder="Catatan Kepala Madrasah (opsional)..." />
              <button type="button" class="btn ${isChecked ? 'btn-secondary' : 'btn-accent'} btn-sm" data-verifikasi-guru="${UI.esc(log.id_absen_guru)}">
                <i data-lucide="check-check" aria-hidden="true"></i>
                <span>${isChecked ? 'Sudah Dicek' : 'Tandai Sudah Dicek'}</span>
              </button>
            </div>
          </article>
        `);
      });
    });

    if (cards.length === 0) {
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Tidak ada data guru pada filter ini',
        message: 'Pilih program atau kelas lain, atau ubah filter tanggal untuk melihat monitoring guru.',
      });
      UI.refreshIcons(container);
      return;
    }

    container.innerHTML = cards.join('');
    if (typeof UI.bindAvatarFallbacks === 'function') {
      UI.bindAvatarFallbacks(container);
    } else {
      container.querySelectorAll('.guru-monitor-avatar img[data-fallback-initials]').forEach((img) => {
        img.addEventListener('error', () => {
          const box = img.parentElement;
          if (box) box.textContent = img.dataset.fallbackInitials || 'G';
        });
      });
    }
    container.querySelectorAll('button[data-verifikasi-guru]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idAbsen = btn.dataset.verifikasiGuru;
        const noteInp = container.querySelector(`input[data-kepsek-catatan="${idAbsen}"]`);
        const catatan = noteInp ? noteInp.value.trim() : '';
        UI.setButtonLoading(btn, true, 'Menyimpan...');
        try {
          const res = await API.verifikasiAbsensiGuru({
            id_absen_guru: idAbsen,
            status_cek: 'Sudah Dicek',
            catatan_kepsek: catatan,
          });
          const updated = (res && res.data) || res || {};
          if (updated.sync_ts !== undefined) recordLocalSyncTs(updated.sync_ts);
          STATE.absensiGuruToday = (STATE.absensiGuruToday || []).map((row) =>
            row.id_absen_guru === idAbsen
              ? Object.assign({}, row, {
                  status_cek: updated.status_cek || 'Sudah Dicek',
                  catatan_kepsek: updated.catatan_kepsek !== undefined ? updated.catatan_kepsek : catatan,
                })
              : row
          );
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('absensiGuruToday', STATE.absensiGuruToday);
          renderKepsekMonitoringGuru();
          UI.toast('Status pengecekan & catatan Kepala Madrasah tersimpan.', 'success');
        } catch (err) {
          UI.toast(`Gagal memperbarui status cek: ${err.message}`, 'error');
        } finally {
          UI.setButtonLoading(btn, false);
        }
      });
    });
    UI.refreshIcons(container);
  }

  function resolveAbsensiPengampuAndMetode(blk) {
    const riwayat = Array.isArray(blk.riwayat_absensi) ? blk.riwayat_absensi : [];
    const mInfo = blk.metode_absensi;
    let qrCount = mInfo ? Number(mInfo.qr || 0) : 0;
    let manualCount = mInfo ? Number(mInfo.manual || 0) : 0;
    if (!mInfo && riwayat.length > 0) {
      riwayat.forEach((r) => {
        if (String(r.metode || '').trim().toLowerCase() === 'qr') qrCount++;
        else manualCount++;
      });
    }
    const metodeParts = [];
    if (qrCount > 0) metodeParts.push(`Scan QR: ${qrCount}`);
    if (manualCount > 0) metodeParts.push(`Manual: ${manualCount}`);

    let pengampu = String(blk.nama_guru_pengampu || '').trim();
    let pengampuList = Array.isArray(blk.guru_pengampu) && blk.guru_pengampu.length > 0 ? blk.guru_pengampu.slice() : [];
    if (!pengampu || pengampu === 'Belum dipetakan') {
      const seenRec = new Set();
      const recorderEntries = [];
      riwayat.forEach((r) => {
        const n = String(r.nama_guru_piket || '').trim();
        if (!n || n === '-' || seenRec.has(n.toLowerCase())) return;
        seenRec.add(n.toLowerCase());
        recorderEntries.push({ id_user: String(r.id_guru_piket || '').trim(), nama_lengkap: n });
      });
      if (recorderEntries.length > 0) {
        pengampu = recorderEntries.map((x) => x.nama_lengkap).join(', ');
        if (pengampuList.length === 0) pengampuList = recorderEntries;
      }
    }
    if (!pengampu || pengampu === 'Belum dipetakan') {
      const stNama = blk.status_setoran && String(blk.status_setoran.nama_guru || '').trim();
      pengampu = stNama || 'Belum dipetakan';
      if (stNama && pengampuList.length === 0) pengampuList = [stNama];
    }

    return {
      pengampu,
      pengampuList,
      metodeText: metodeParts.join(' · '),
    };
  }

  function renderAbsensiLaporan(absensiBlocks, targetTanggal) {
    const container = document.getElementById('kepsek-absensi-container');
    const overviewSec = document.getElementById('kepsek-overview-section');
    const riwayatSec = document.getElementById('kepsek-riwayat-section');
    localState.absensiBlocksToday = Array.isArray(absensiBlocks) ? absensiBlocks : [];

    if (overviewSec) overviewSec.hidden = localState.absensiBlocksToday.length === 0;
    if (localState.absensiBlocksToday.length === 0 && riwayatSec) {
      riwayatSec.hidden = true;
    }

    if (!container) return;

    if (localState.absensiBlocksToday.length === 0) {
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada laporan absensi',
        message: `Belum ada catatan absensi QR atau manual pada ${UI.formatDateShort(targetTanggal)}.`,
      });
      UI.refreshIcons(container);
      return;
    }

    container.innerHTML = localState.absensiBlocksToday
      .map((blk) => {
        const abs = blk.agregat_absensi || { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: 0 };
        const totalCatatan = Number(abs.total || (Number(abs.Hadir || 0) + Number(abs.Sakit || 0) + Number(abs.Izin || 0) + Number(abs.Alpa || 0)));
        const absentRows = Array.isArray(blk.santri_tidak_hadir) ? blk.santri_tidak_hadir : [];
        const meta = resolveAbsensiPengampuAndMetode(blk);

        return `
          <article class="kelas-report-block">
            <div class="kelas-report-header">
              <div class="kelas-header-main">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <h4 class="heading-md">${UI.esc(blk.kelas)}</h4>
                  <span class="status-badge status-hadir mono-num">
                    <i data-lucide="clipboard-check" aria-hidden="true" style="width:14px;height:14px;"></i>
                    <span>${totalCatatan} tercatat</span>
                  </span>
                </div>
                <div class="text-secondary guru-pengampu-row">
                  <span>Pengampu:</span>
                  ${renderGuruInlineListHtml(meta.pengampuList, { fallbackText: meta.pengampu })}
                  ${meta.metodeText ? `<span class="text-muted">· ${UI.esc(meta.metodeText)}</span>` : ''}
                </div>
              </div>
            </div>

            <div class="kelas-mini-stats">
              <div class="nilai-kpi-box">
                <div class="nilai-kpi-val" style="color:var(--status-hadir-fg);">${Number(abs.Hadir || 0)}</div>
                <div class="nilai-kpi-lbl">Hadir</div>
              </div>
              <div class="nilai-kpi-box">
                <div class="nilai-kpi-val" style="color:var(--status-sakit-fg);">${Number(abs.Sakit || 0)}</div>
                <div class="nilai-kpi-lbl">Sakit</div>
              </div>
              <div class="nilai-kpi-box">
                <div class="nilai-kpi-val" style="color:var(--status-izin-fg);">${Number(abs.Izin || 0)}</div>
                <div class="nilai-kpi-lbl">Izin</div>
              </div>
              <div class="nilai-kpi-box">
                <div class="nilai-kpi-val" style="color:var(--status-alpa-fg);">${Number(abs.Alpa || 0)}</div>
                <div class="nilai-kpi-lbl">Alpa</div>
              </div>
            </div>

            ${absentRows.length > 0
            ? `<div class="stack-gap" style="gap:8px;">
                     <div style="font-size:0.84rem;font-weight:700;color:var(--text-primary);">Tidak Hadir (${absentRows.length})</div>
                     ${renderAbsentStudentListHtml(absentRows, targetTanggal, true)}
                   </div>`
            : `<div>
                     <span class="absensi-all-hadir-note">
                       <i data-lucide="check-circle-2" aria-hidden="true" style="width:15px;height:15px;"></i>
                       <span>Semua santri tercatat hadir.</span>
                     </span>
                   </div>`
          }
          </article>
        `;
      })
      .join('');

    if (typeof UI.bindAvatarFallbacks === 'function') UI.bindAvatarFallbacks(container);
    UI.refreshIcons(container);
  }

  function renderNilaiLaporan(nilaiCards, targetTanggal) {
    const container = document.getElementById('kepsek-nilai-container');
    localState.nilaiCardsToday = Array.isArray(nilaiCards) ? nilaiCards : [];
    localState.rekapNilaiList = localState.nilaiCardsToday;

    if (!container) return;

    if (localState.nilaiCardsToday.length === 0) {
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada laporan nilai',
        message: `Belum ada penilaian UAS atau Raport yang disimpan pada ${UI.formatDateShort(targetTanggal)}.`,
      });
      UI.refreshIcons(container);
      return;
    }

    const classGroupMap = new Map();
    localState.nilaiCardsToday.forEach((card, flatIdx) => {
      const k = String(card.kelas || 'Tanpa Kelas').trim() || 'Tanpa Kelas';
      if (!classGroupMap.has(k)) classGroupMap.set(k, []);
      classGroupMap.get(k).push({ card, flatIdx });
    });

    const orderedClasses = Array.from(classGroupMap.keys()).sort(compareClassOrder);

    container.innerHTML = orderedClasses
      .map((kelasName) => {
        const items = classGroupMap.get(kelasName) || [];
        const gurus = getGurusForClass(kelasName);
        const mappedGuru = gurus.length > 0 ? gurus.map((g) => g.nama_lengkap || g.username).join(', ') : '';
        const cardGuruNames = Array.from(
          new Set(
            items
              .map((it) => String(it.card.nama_guru || '').trim())
              .filter((n) => n && n !== 'Guru Pengampu' && n !== 'Belum Disetor Guru')
          )
        ).join(', ');
        const guruLabel = mappedGuru || cardGuruNames || 'Belum dipetakan';

        const cardsHtml = items
          .map(({ card, flatIdx }) => {
            const isUAS = card.jenis_nilai === 'Nilai UAS';
            return `
              <article class="nilai-rekap-card">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                  <div style="min-width:0;flex:1 1 auto;">
                    <span class="status-badge ${isUAS ? 'status-izin' : 'status-hadir'}">${UI.esc(card.jenis_nilai || 'Nilai Raport')}</span>
                    <div class="text-muted" style="font-size:0.8rem;margin-top:6px;">
                      ${UI.esc(card.periode || '-')} · ${Number(card.jumlah_santri || 0)} santri
                    </div>
                  </div>
                </div>

                <div class="nilai-kpi-strip">
                  <div class="nilai-kpi-box">
                    <div class="nilai-kpi-val">${Number(card.rata_rata || 0).toFixed(1)}</div>
                    <div class="nilai-kpi-lbl">Rata-rata</div>
                  </div>
                  <div class="nilai-kpi-box">
                    <div class="nilai-kpi-val" style="color:var(--status-hadir-fg);">${Number(card.jumlah_tuntas || 0)}</div>
                    <div class="nilai-kpi-lbl">Tuntas</div>
                  </div>
                  <div class="nilai-kpi-box">
                    <div class="nilai-kpi-val" style="color:var(--status-alpa-fg);">${Number(card.jumlah_perlu_bimbingan || 0)}</div>
                    <div class="nilai-kpi-lbl">Bimbingan</div>
                  </div>
                </div>

                <div class="toolbar-actions">
                  <button type="button" class="btn btn-secondary btn-sm" data-view-nilai-idx="${flatIdx}">
                    <i data-lucide="eye" aria-hidden="true"></i>
                    <span>Detail Nilai</span>
                  </button>
                </div>
              </article>
            `;
          })
          .join('');

        return `
          <article class="kelas-report-block">
            <div class="kelas-report-header">
              <div class="kelas-header-main">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  <h4 class="heading-md">${UI.esc(kelasName)}</h4>
                  <span class="status-badge status-izin mono-num">${items.length} penilaian</span>
                </div>
                <div class="text-secondary" style="font-size:0.84rem;margin-top:4px;">
                  Pengampu: <strong>${UI.esc(guruLabel)}</strong>
                </div>
              </div>
            </div>
            <div class="nilai-rekap-grid">${cardsHtml}</div>
          </article>
        `;
      })
      .join('');

    container.querySelectorAll('button[data-view-nilai-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = localState.rekapNilaiList[Number(btn.dataset.viewNilaiIdx)];
        if (card) openDetailNilaiModal(card);
      });
    });

    UI.refreshIcons(container);
  }

  function openDetailNilaiModal(rawCard) {
    const card = sanitizeRekapNilaiCard(rawCard || {});
    localState.selectedNilaiCard = card;
    const isUAS = card.jenis_nilai === 'Nilai UAS';
    const title = document.getElementById('detail-nilai-modal-title');
    const sub = document.getElementById('detail-nilai-subtitle');
    const theadRow = document.getElementById('detail-nilai-thead-row');
    const tbody = document.getElementById('detail-nilai-tbody');

    if (title) title.textContent = `Detail ${card.jenis_nilai || 'Nilai'} - ${card.kelas}`;
    if (sub) {
      sub.textContent = `Periode ${card.periode} · Pengampu: ${card.nama_guru} · Rata-rata: ${Number(card.rata_rata || 0).toFixed(2)}`;
    }

    if (theadRow) {
      theadRow.innerHTML = isUAS
        ? '<th style="width:44px;">No</th><th>Nama Santri</th><th>PG Benar</th><th>Essay Benar</th><th>1/2 Benar</th><th>Nilai UAS</th><th>Predikat</th>'
        : '<th style="width:44px;">No</th><th>Nama Santri</th><th>Harian</th><th>UAS</th><th>Kehadiran</th><th>Nilai Akhir</th><th>Predikat</th>';
    }

    const rows = Array.isArray(card.detail_nilai) ? card.detail_nilai : [];
    if (tbody) {
      if (rows.length === 0) {
        tbody.innerHTML = `<tr class="table-state-row"><td colspan="7">${UI.renderStateBox({
          type: 'empty',
          title: 'Belum ada rincian nilai santri',
          message: 'Belum ada data nilai tersimpan untuk kelas ini.',
        })}</td></tr>`;
        UI.refreshIcons(tbody);
      } else if (isUAS) {
        tbody.innerHTML = rows
          .map(
            (r, idx) => `
            <tr>
              <td class="mono-num dn-no" data-label="No">${idx + 1}</td>
              <td class="dn-nama" data-label="Nama Santri">
                <strong>${UI.esc(r.nama_santri)}</strong>
                ${r.skema_soal && r.skema_soal !== '-' ? `<div class="text-muted" style="font-size:0.75rem;margin-top:2px;">${UI.esc(r.skema_soal)}</div>` : ''}
              </td>
              <td class="mono-num dn-harian" data-label="PG Benar">${UI.esc(r.pg_benar ?? 0)}</td>
              <td class="mono-num dn-uas" data-label="Essay Benar">${UI.esc(r.essay_benar ?? 0)}</td>
              <td class="mono-num dn-hadir" data-label="1/2 Benar">${UI.esc(r.setengah_benar ?? 0)}</td>
              <td class="mono-num dn-akhir" data-label="Nilai UAS"><strong>${Number(r.n_akhir || 0).toFixed(1)}</strong></td>
              <td class="dn-pred" data-label="Predikat"><span class="status-badge ${gradeBadgeClass(r.grade)} mono-num">${UI.esc(r.grade)} (${UI.esc(r.keterangan)})</span></td>
            </tr>
          `
          )
          .join('');
      } else {
        tbody.innerHTML = rows
          .map(
            (r, idx) => `
            <tr>
              <td class="mono-num dn-no" data-label="No">${idx + 1}</td>
              <td class="dn-nama" data-label="Nama Santri"><strong>${UI.esc(r.nama_santri)}</strong></td>
              <td class="mono-num dn-harian" data-label="N. Harian">${UI.esc(r.n_harian)}</td>
              <td class="mono-num dn-uas" data-label="N. UAS">${UI.esc(r.n_uas)}</td>
              <td class="mono-num dn-hadir" data-label="Kehadiran">${UI.esc(r.n_kehadiran)}%</td>
              <td class="mono-num dn-akhir" data-label="Nilai Akhir"><strong>${Number(r.n_akhir || 0).toFixed(2)}</strong></td>
              <td class="dn-pred" data-label="Predikat"><span class="status-badge ${gradeBadgeClass(r.grade)} mono-num">${UI.esc(r.grade)} (${UI.esc(r.keterangan)})</span></td>
            </tr>
          `
          )
          .join('');
      }
    }

    UI.openModal('modal-detail-nilai');
  }

  function openRiwayatDetailModal(row) {
    if (!row) return;
    const eyebrowEl = document.getElementById('detail-rekap-eyebrow');
    const titleEl = document.getElementById('detail-rekap-modal-title');
    const subEl = document.getElementById('detail-rekap-subtitle');
    const bodyEl = document.getElementById('detail-rekap-body');
    if (!bodyEl) return;

    if (eyebrowEl) eyebrowEl.textContent = 'Detail Riwayat Presensi';
    if (titleEl) titleEl.textContent = row.nama_santri || '-';
    if (subEl) subEl.textContent = `${row.kelas || '-'} · ${row.tanggal || '-'}`;

    const badgeCls = statusBadgeClass(row.status);
    const nilaiHtml = buildSantriGradeHistoryHtml(row.id_santri, row.nama_santri);

    bodyEl.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field">
          <span class="detail-label">Nama Santri</span>
          <strong class="detail-value">${UI.esc(row.nama_santri || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Kelas</span>
          <strong class="detail-value">${UI.esc(row.kelas || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Tanggal</span>
          <strong class="detail-value mono-num">${UI.esc(row.tanggal || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Waktu Catat</span>
          <strong class="detail-value mono-num">${UI.esc(row.waktu || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Status Kehadiran</span>
          <div class="detail-value"><span class="status-badge ${badgeCls}">${UI.esc(row.status || '-')}</span></div>
        </div>
        <div class="detail-field">
          <span class="detail-label">Metode &amp; Guru Piket</span>
          <div class="detail-value guru-pengampu-row" style="margin-top:0;">
            <strong>${UI.esc(row.metode || '-')}</strong>
            <span>·</span>
            ${renderGuruInlineListHtml(
              row.nama_guru_piket && row.nama_guru_piket !== '-'
                ? [{ id_user: row.id_guru_piket || '', nama_lengkap: row.nama_guru_piket }]
                : [],
              { fallbackText: row.nama_guru_piket || '-' }
            )}
          </div>
        </div>
        ${row.catatan ? `
        <div class="detail-field detail-field-full">
          <span class="detail-label">Keterangan</span>
          <strong class="detail-value">${UI.esc(row.catatan)}</strong>
        </div>` : ''}
      </div>
      ${nilaiHtml}
    `;

    if (typeof UI.bindAvatarFallbacks === 'function') UI.bindAvatarFallbacks(bodyEl);
    UI.openModal('modal-detail-rekap');
    UI.refreshIcons(bodyEl);
  }

  function renderRiwayatTable() {
    const tbody = document.getElementById('admin-riwayat-tbody');
    if (!tbody) return;

    const q = localState.riwayatQuery.trim().toLowerCase();
    const st = localState.riwayatFilterStatus;
    const filtered = localState.riwayatHarian.filter((row) => {
      const matchStatus =
        st === 'Semua' || row.status.toLowerCase().includes(st.toLowerCase());
      const matchQuery =
        !q ||
        row.nama_santri.toLowerCase().includes(q) ||
        row.kelas.toLowerCase().includes(q) ||
        row.nama_guru_piket.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr class="table-state-row">
          <td colspan="3">
            ${UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada catatan presensi yang cocok',
        message:
          localState.riwayatHarian.length === 0
            ? 'Belum ada catatan presensi untuk filter tanggal dan kelas saat ini.'
            : 'Ubah filter status atau kata kunci pencarian untuk melihat data lainnya.',
      })}
          </td>
        </tr>
      `;
      UI.refreshIcons(tbody);
      return;
    }

    tbody.innerHTML = filtered
      .map(
        (r, idx) => `
        <tr class="clickable-row" data-riwayat-idx="${idx}" tabindex="0">
          <td class="mc-primary" data-label="Nama Santri">
            <div class="row-primary-with-hint">
              <strong>${UI.esc(r.nama_santri)}</strong>
              <i data-lucide="chevron-right" class="row-chevron-hint" aria-hidden="true"></i>
            </div>
          </td>
          <td data-label="Kelas">${UI.esc(r.kelas)}</td>
          <td class="mc-status" data-label="Status"><span class="status-badge ${statusBadgeClass(r.status)}">${UI.esc(r.status)}</span></td>
        </tr>
      `
      )
      .join('');

    tbody.querySelectorAll('tr[data-riwayat-idx]').forEach((tr) => {
      const openRow = () => {
        const idx = Number(tr.dataset.riwayatIdx);
        if (filtered[idx]) openRiwayatDetailModal(filtered[idx]);
      };
      tr.addEventListener('click', openRow);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRow();
        }
      });
    });

    UI.refreshIcons(tbody);
  }

  function renderUsersTable() {
    const tbody = document.getElementById('admin-users-tbody');
    const allUsers = Array.isArray(STATE.users) ? STATE.users : [];
    const totalEl = document.getElementById('users-stat-total');
    const guruEl = document.getElementById('users-stat-guru');
    const unmappedEl = document.getElementById('users-stat-unmapped');

    const guruUsers = allUsers.filter((u) => String(u.role || '').toLowerCase() !== 'admin');
    const unmappedGurus = guruUsers.filter((u) => {
      const list = Array.isArray(u.kelas_ampu) ? u.kelas_ampu : API.parseKelasAmpu(u.kelas_ampu);
      return list.length === 0;
    });
    if (totalEl) totalEl.textContent = String(allUsers.length);
    if (guruEl) guruEl.textContent = String(guruUsers.length);
    if (unmappedEl) unmappedEl.textContent = String(unmappedGurus.length);

    if (!tbody) return;

    const q = (localState.usersQuery || '').trim().toLowerCase();
    const roleFilter = (localState.usersRoleFilter || 'Semua').toLowerCase();
    const filteredUsers = allUsers.filter((u) => {
      const r = String(u.role || 'guru').toLowerCase();
      const matchRole = roleFilter === 'semua' || r === roleFilter;
      const ampuText = Array.isArray(u.kelas_ampu)
        ? u.kelas_ampu.join(', ')
        : String(u.kelas_ampu_text || u.kelas_ampu || '');
      const matchQ =
        !q ||
        String(u.nama_lengkap || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q) ||
        ampuText.toLowerCase().includes(q);
      return matchRole && matchQ;
    });

    if (filteredUsers.length === 0) {
      tbody.innerHTML = `
        <tr class="table-state-row">
          <td colspan="5">
            ${UI.renderStateBox({
        type: 'empty',
        title: allUsers.length === 0 ? 'Daftar akun belum tersedia' : 'Akun tidak ditemukan',
        message:
          allUsers.length === 0
            ? 'Klik "Tambah Pengguna" untuk mendaftarkan akun Kepala Madrasah atau Guru.'
            : 'Coba ubah kata kunci pencarian atau filter peran.',
      })}
          </td>
        </tr>
      `;
      UI.refreshIcons(tbody);
      return;
    }

    tbody.innerHTML = filteredUsers
      .map((u) => {
        const isAdm = String(u.role || '').toLowerCase() === 'admin';
        const ampuList = Array.isArray(u.kelas_ampu) ? u.kelas_ampu : API.parseKelasAmpu(u.kelas_ampu);
        const kelasCellHtml = isAdm
          ? '<span class="text-muted" style="font-size:0.8125rem;">Seluruh Kelas (Admin)</span>'
          : ampuList.length > 0
            ? `<div class="guru-pill-list">${ampuList
              .map((k) => `<span class="guru-pill">${UI.esc(k)}</span>`)
              .join('')}</div>`
            : '<span class="status-badge status-sakit">Belum dipetakan</span>';

        return `
        <tr>
          <td class="usr-nama" data-label="Pengguna">
            <div style="font-weight:600;">${UI.esc(u.nama_lengkap || u.username)}</div>
            <div class="text-muted mono-num" style="font-size:0.78rem;">@${UI.esc(u.username)}</div>
          </td>
          <td class="usr-role" data-label="Peran">
            <span class="status-badge ${isAdm ? 'status-hadir' : 'status-izin'}">
              ${isAdm ? 'Kepala Madrasah / Admin' : 'Guru'}
            </span>
          </td>
          <td class="usr-kelas" data-label="Kelas Ampu">${kelasCellHtml}</td>
          <td class="usr-status" data-label="Status">
            <span class="status-badge ${u.status_aktif === 'aktif' ? 'status-hadir' : 'status-sakit'}">
              ${u.status_aktif === 'aktif' ? 'Aktif' : 'Nonaktif'}
            </span>
          </td>
          <td class="usr-actions" data-label="Aksi">
            <div class="table-actions-cell">
              <button type="button" class="btn btn-secondary btn-icon-sm" data-edit-user="${UI.esc(u.id_user || u.username)}" aria-label="Edit pengguna ${UI.esc(u.nama_lengkap || u.username)}">
                <i data-lucide="pencil" aria-hidden="true"></i>
                <span class="mobile-only-btn-label">Edit</span>
              </button>
              <button type="button" class="btn btn-danger btn-icon-sm" data-delete-user="${UI.esc(u.id_user || u.username)}" data-user-label="${UI.esc(u.nama_lengkap || u.username)}" aria-label="Hapus pengguna ${UI.esc(u.nama_lengkap || u.username)}">
                <i data-lucide="trash-2" aria-hidden="true"></i>
                <span class="mobile-only-btn-label">Hapus</span>
              </button>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    tbody.querySelectorAll('button[data-edit-user]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.editUser;
        const found = STATE.users.find((u) => (u.id_user || u.username) === key);
        if (found) openUserModal(found);
      });
    });

    tbody.querySelectorAll('button[data-delete-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.deleteUser;
        const label = btn.dataset.userLabel || key;
        const found = STATE.users.find((u) => (u.id_user || u.username) === key);
        const targetId = found ? (found.id_user || found.username || key) : key;
        const ok = await UI.confirmDialog({
          title: 'Hapus Akun Pengguna',
          message: `Akun "${label}" akan dihapus dari daftar akses portal. Lanjutkan?`,
          confirmLabel: 'Hapus Akun',
          danger: true,
        });
        if (!ok) return;

        // Optimistic UI: langsung hapus dari tampilan & cache sambil menghapus di server
        const prevUsers = [...STATE.users];
        STATE.users = STATE.users.filter((u) => (u.id_user || u.username) !== key);
        if (root.MDTA_CACHE) root.MDTA_CACHE.write('users', STATE.users);
        renderUsersTable();
        renderKelasManagement();
        UI.toast(`Pengguna "${label}" dihapus.`, 'success');

        try {
          await API.deleteUser(targetId);
        } catch (err) {
          STATE.users = prevUsers;
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('users', STATE.users);
          renderUsersTable();
          renderKelasManagement();
          UI.toast(`Gagal menghapus "${label}": ${err.message}`, 'error');
        }
      });
    });

    UI.refreshIcons(tbody);
  }

  function syncKepsekClassFilter(classesFromServer) {
    const sel = document.getElementById('kepsek-filter-kelas');
    if (!sel) return [];
    const prev = sel.value;
    const set = new Set(getOfficialClassNames(false));
    (Array.isArray(classesFromServer) ? classesFromServer : []).forEach((k) => {
      if (k) set.add(k);
    });
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
    sel.innerHTML =
      '<option value="">Semua Kelas</option>' +
      sorted.map((k) => `<option value="${UI.esc(k)}">${UI.esc(k)}</option>`).join('');
    if (prev && sorted.includes(prev)) sel.value = prev;
    return sorted;
  }

  function buildDailyFallbackKepsekData(d, targetTanggal) {
    const targetIso = API.normalizeISODate(targetTanggal);
    const allRiwayat = ((d && d.riwayat_presensi) || []).map(API.normalizePresensi);
    const todayRiwayat = allRiwayat.filter((r) => targetIso && API.normalizeISODate(r.tanggal) === targetIso);
    const agregat = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: todayRiwayat.length };
    todayRiwayat.forEach((r) => {
      if (Object.prototype.hasOwnProperty.call(agregat, r.status)) agregat[r.status]++;
    });
    const todayLogs = (STATE.logSetoran || []).filter(
      (l) => !targetIso || API.normalizeISODate(l.tanggal) === targetIso
    );
    const absensiLogs = todayLogs.filter((l) => String(l.jenis_laporan || '').toLowerCase() === 'absensi harian');
    return {
      daftar_kelas: getOfficialClassNames(false),
      status_setoran_hari_ini: absensiLogs.map((l) => ({
        kelas: l.kelas,
        sudah_setor: true,
        id_setoran: l.id_setoran,
        nama_guru: l.nama_guru,
        waktu_submit: l.waktu_submit,
        ringkasan: l.ringkasan,
      })),
      absensi_harian: {
        agregat,
        setoran: absensiLogs,
        santri_tidak_hadir: todayRiwayat.filter((r) => ['Sakit', 'Izin', 'Alpa'].includes(r.status)),
        riwayat: todayRiwayat,
      },
      rekap_nilai: [],
    };
  }

  function renderKepsekBlockFromData(rk, targetTanggal) {
    const updatedEl = document.getElementById('dashboard-last-updated');
    const riwayatSec = document.getElementById('kepsek-riwayat-section');
    const absCountEl = document.getElementById('kepsek-absensi-count');
    const nilaiCountEl = document.getElementById('kepsek-nilai-count');
    const kelasSel = document.getElementById('kepsek-filter-kelas');
    const activeKelas = kelasSel ? kelasSel.value : '';
    const targetIso = API.normalizeISODate(targetTanggal);

    syncKepsekClassFilter(rk.daftar_kelas);
    if (updatedEl) {
      updatedEl.textContent = UI.formatDateId(targetTanggal);
    }

    const allBlocksUnfiltered = buildLaporanPerKelas(rk, targetTanggal, '');
    const allAbsensiToday = allBlocksUnfiltered
      .filter((b) => Number((b.agregat_absensi && b.agregat_absensi.total) || 0) > 0)
      .sort((a, b) => compareClassOrder(a.kelas, b.kelas));

    const rawNilaiPool = [];
    allBlocksUnfiltered.forEach((b) => {
      (b.rekap_nilai || []).forEach((n) => rawNilaiPool.push(n));
    });
    if (Array.isArray(rk && rk.rekap_nilai)) {
      rk.rekap_nilai.forEach((n) => rawNilaiPool.push(n));
    }
    synthesizeDailyNilaiCardsFromState(targetTanggal).forEach((n) => rawNilaiPool.push(n));

    const seenNilai = new Set();
    const allNilaiToday = [];
    rawNilaiPool.forEach((rawCard) => {
      const card = sanitizeRekapNilaiCard(rawCard);
      const jenisKey = String(card.jenis_nilai || 'Nilai Raport').toLowerCase();
      const key = `${jenisKey}||${String(card.kelas || '').trim().toLowerCase()}||${String(card.periode || '').trim()}`;
      if (seenNilai.has(key) || !isNilaiCardOnDate(card, targetTanggal)) return;
      seenNilai.add(key);
      if (!card.nama_guru || card.nama_guru === 'Belum Disetor Guru' || card.nama_guru === 'Guru Pengampu') {
        const gurus = getGurusForClass(card.kelas);
        if (gurus.length > 0) {
          card.nama_guru = gurus.map((g) => g.nama_lengkap || g.username).join(', ');
        }
      }
      allNilaiToday.push(card);
    });

    allNilaiToday.sort((a, b) => {
      const clsCmp = compareClassOrder(a.kelas, b.kelas);
      if (clsCmp !== 0) return clsCmp;
      return String(a.jenis_nilai || '').localeCompare(String(b.jenis_nilai || ''));
    });

    localState.allActiveAbsensiClasses = Array.from(
      new Set(allAbsensiToday.map((b) => b.kelas).filter(Boolean))
    ).sort(compareClassOrder);
    localState.allActiveNilaiClasses = Array.from(
      new Set(allNilaiToday.map((c) => c.kelas).filter(Boolean))
    ).sort(compareClassOrder);

    const progFilter = localState.kepsekProgramFilter || '';
    const absensiBlocksToday = allAbsensiToday.filter(
      (b) =>
        (!activeKelas || String(b.kelas || '').toLowerCase() === activeKelas.toLowerCase()) &&
        (!progFilter || resolveClassKategori(b.kelas) === progFilter)
    );
    const nilaiCardsToday = allNilaiToday.filter(
      (c) =>
        (!activeKelas || String(c.kelas || '').toLowerCase() === activeKelas.toLowerCase()) &&
        (!progFilter || resolveClassKategori(c.kelas) === progFilter)
    );

    if (absCountEl) absCountEl.textContent = String(absensiBlocksToday.length);
    if (nilaiCountEl) nilaiCountEl.textContent = String(nilaiCardsToday.length);

    const abs = rk.absensi_harian || {};
    const todayAgregat = absensiBlocksToday.reduce(
      (acc, b) => {
        const a = b.agregat_absensi || {};
        acc.Hadir += Number(a.Hadir || 0);
        acc.Sakit += Number(a.Sakit || 0);
        acc.Izin += Number(a.Izin || 0);
        acc.Alpa += Number(a.Alpa || 0);
        return acc;
      },
      { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0 }
    );
    const totalToday = todayAgregat.Hadir + todayAgregat.Sakit + todayAgregat.Izin + todayAgregat.Alpa;
    renderDashboardStats(
      totalToday > 0 ? todayAgregat : (abs.agregat || {}),
      totalToday > 0 ? totalToday : (abs.agregat ? abs.agregat.total : 0)
    );

    localState.laporanPerKelas = absensiBlocksToday;
    localState.riwayatHarian = (abs.riwayat || [])
      .map(API.normalizePresensi)
      .filter((r) => {
        const matchDate = !targetIso || API.normalizeISODate(r.tanggal) === targetIso;
        const matchKelas = !activeKelas || String(r.kelas || '').toLowerCase() === activeKelas.toLowerCase();
        const matchProg = !progFilter || resolveClassKategori(r.kelas) === progFilter;
        return matchDate && matchKelas && matchProg;
      });
    if (riwayatSec) {
      riwayatSec.hidden = absensiBlocksToday.length === 0 || localState.riwayatHarian.length === 0;
    }

    renderAbsensiLaporan(absensiBlocksToday, targetTanggal);
    renderNilaiLaporan(nilaiCardsToday, targetTanggal);
    renderRiwayatTable();

    if (!localState.kepsekModeLocked) {
      if (absensiBlocksToday.length === 0 && nilaiCardsToday.length > 0) {
        localState.kepsekReportMode = 'nilai';
      } else {
        localState.kepsekReportMode = 'absensi';
      }
    }
    applyKepsekReportMode(localState.kepsekReportMode);
    if (localState.kepsekReportMode !== 'guru') {
      renderKepsekMonitoringGuru();
    }
  }

  function applyBootstrapData(bundle, targetTanggal, targetKelas) {
    const CACHE = root.MDTA_CACHE;
    const key = `${targetTanggal}|${targetKelas}`;

    const prevKelas = STATE.kelas;
    const prevUsers = STATE.users;
    const prevSantri = STATE.santri;
    const prevRk = STATE.rekapKepsek;

    if (Array.isArray(bundle.kelas)) {
      STATE.kelas = bundle.kelas.map(API.normalizeKelas);
      STATE.loaded.kelas = true;
      if (CACHE) CACHE.write('kelas', STATE.kelas);
    }

    if (Array.isArray(bundle.santri)) {
      STATE.santri = bundle.santri.map(API.normalizeSantri);
      STATE.loaded.santri = true;
      if (CACHE) CACHE.write('santri', STATE.santri);
    }

    if (bundle.dashboard) {
      STATE.dashboard = bundle.dashboard;
      if (CACHE) CACHE.write('dashboard', STATE.dashboard);
    }

    const rawUsers =
      Array.isArray(bundle.users) && bundle.users.length > 0
        ? bundle.users
        : bundle.dashboard && Array.isArray(bundle.dashboard.daftar_pengguna)
          ? bundle.dashboard.daftar_pengguna
          : [];
    if (rawUsers.length > 0 || Array.isArray(bundle.users)) {
      STATE.users = rawUsers.map(API.normalizeUser);
      if (CACHE) CACHE.write('users', STATE.users);
    }

    if (Array.isArray(bundle.nilai_raport)) {
      STATE.nilaiRaportSaved = bundle.nilai_raport
        .map(API.normalizeNilaiRaport)
        .filter((r) => String(r.nama_santri || '').trim() && String(r.nama_santri).trim() !== '-');
      if (CACHE) CACHE.write('nilaiRaportSaved', STATE.nilaiRaportSaved);
    }

    if (Array.isArray(bundle.nilai_uas)) {
      STATE.nilaiUAS = bundle.nilai_uas.map(API.normalizeNilaiUAS).reverse();
      STATE.loaded.uas = true;
      if (CACHE) CACHE.write('nilaiUAS', STATE.nilaiUAS);
    }

    if (Array.isArray(bundle.dokumen_arsip)) {
      STATE.dokumenArsip = bundle.dokumen_arsip.map(API.normalizeDokumen);
      STATE.loaded.arsip = true;
      if (CACHE) CACHE.write('dokumenArsip', STATE.dokumenArsip);
    }

    if (Array.isArray(bundle.log_setoran)) {
      STATE.logSetoran = bundle.log_setoran.map(API.normalizeLogSetoran);
      if (CACHE) CACHE.write('logSetoran', STATE.logSetoran);
    }

    if (Array.isArray(bundle.absensi_guru_hari_ini)) {
      STATE.absensiGuruToday = bundle.absensi_guru_hari_ini;
      if (CACHE) CACHE.write('absensiGuruToday', STATE.absensiGuruToday);
      renderKepsekMonitoringGuru();
    }

    if (bundle.rekap_kepsek) {
      STATE.rekapKepsek = bundle.rekap_kepsek;
      STATE.rekapKepsekKey = key;
      if (CACHE) CACHE.write('rekapKepsek', { key, payload: bundle.rekap_kepsek });
    }

    STATE.loaded.bootstrap = true;
    STATE.loaded.dashboard = true;
    STATE.lastSyncAt = Date.now();
    if (bundle.sync_ts !== undefined) {
      recordLocalSyncTs(bundle.sync_ts);
    } else if (bundle.rekap_kepsek && bundle.rekap_kepsek.sync_ts !== undefined) {
      recordLocalSyncTs(bundle.rekap_kepsek.sync_ts);
    }

    if (root.MDTA_CALC && typeof root.MDTA_CALC.refreshScope === 'function') {
      root.MDTA_CALC.refreshScope('admin', adminSession, { silentBackground: true, skipFetch: true });
    }

    return {
      kelasChanged: !CACHE || CACHE.hasChanged(prevKelas, STATE.kelas),
      usersChanged: !CACHE || CACHE.hasChanged(prevUsers, STATE.users),
      santriChanged: !CACHE || CACHE.hasChanged(prevSantri, STATE.santri),
      rkChanged: !CACHE || CACHE.hasChanged(prevRk, STATE.rekapKepsek),
    };
  }

  async function loadDashboard(showToastOnDone, opts) {
    const force = Boolean((opts && opts.force) || showToastOnDone);
    const CACHE = root.MDTA_CACHE;
    const refreshBtn = document.getElementById('btn-refresh-dashboard');
    const riwayatTbody = document.getElementById('admin-riwayat-tbody');
    const usersTbody = document.getElementById('admin-users-tbody');
    const updatedEl = document.getElementById('dashboard-last-updated');
    const noticeBox = document.getElementById('kepsek-backend-notice');
    const noticeMsg = document.getElementById('kepsek-backend-notice-msg');

    const kelasSel = document.getElementById('kepsek-filter-kelas');
    const targetTanggal = UI.todayISO();
    localState.activeDateWib = targetTanggal;
    if (updatedEl) updatedEl.textContent = UI.formatDateId(targetTanggal);
    const targetKelas = kelasSel ? kelasSel.value : '';
    const key = `${targetTanggal}|${targetKelas}`;

    if (CACHE) CACHE.hydrateState();

    const hasCachedRk = Boolean(STATE.rekapKepsek && STATE.rekapKepsekKey === key);
    const hasCachedUsers = Array.isArray(STATE.users) && STATE.users.length > 0;
    const hasAnyCache = hasCachedRk || Boolean(STATE.dashboard) || hasCachedUsers;

    syncClassFilterOptions();
    renderKelasManagement();

    const absContainer = document.getElementById('kepsek-absensi-container');

    // 1. Stale-While-Revalidate: Paint instan (0 ms) jika cache tersedia
    if (hasCachedRk) {
      renderKepsekBlockFromData(STATE.rekapKepsek, targetTanggal);
    } else if (STATE.dashboard) {
      renderKepsekBlockFromData(buildDailyFallbackKepsekData(STATE.dashboard, targetTanggal), targetTanggal);
    } else if (absContainer) {
      absContainer.innerHTML = UI.renderStateBox({
        type: 'loading',
        title: 'Memuat Laporan Harian',
        message: 'Mengambil data absensi dan nilai terbaru...',
      });
      UI.refreshIcons(absContainer);
    } else if (riwayatTbody) {
      riwayatTbody.innerHTML = UI.renderSkeletonRows(3, 4);
    }

    if (hasCachedUsers) {
      renderUsersTable();
    } else if (usersTbody) {
      usersTbody.innerHTML = UI.renderSkeletonRows(5, 3);
    }

    if (noticeBox) noticeBox.hidden = true;

    // Jika sesi sudah memuat kombinasi tanggal/kelas ini & bukan manual refresh, hentikan
    if (!force && STATE.loaded.bootstrap && hasCachedRk) {
      if (updatedEl) updatedEl.textContent = UI.formatDateId(targetTanggal);
      return;
    }

    if (force || !hasAnyCache) {
      UI.setButtonLoading(refreshBtn, true, 'Memuat...');
    }

    try {
      const needsFullBootstrap = force || !STATE.loaded.bootstrap;
      if (needsFullBootstrap && CACHE) {
        const bundle = await CACHE.fetchBootstrapSmart({
          role: 'admin',
          tanggal: targetTanggal,
          kelas: targetKelas,
        });
        const diff = applyBootstrapData(bundle, targetTanggal, targetKelas);

        if (Array.isArray(bundle.absensi_guru_hari_ini)) {
      STATE.absensiGuruToday = bundle.absensi_guru_hari_ini;
      if (CACHE) CACHE.write('absensiGuruToday', STATE.absensiGuruToday);
      renderKepsekMonitoringGuru();
    }

    if (bundle.rekap_kepsek) {
          if (!hasCachedRk || diff.rkChanged || diff.kelasChanged || diff.usersChanged) {
            renderKepsekBlockFromData(bundle.rekap_kepsek, targetTanggal);
          }
        } else if (bundle.dashboard) {
          if (noticeBox && noticeMsg) {
            noticeMsg.textContent =
              'Backend Apps Script perlu diperbarui agar rekap harian & setoran guru aktif penuh.';
            noticeBox.hidden = false;
          }
          renderKepsekBlockFromData(buildDailyFallbackKepsekData(bundle.dashboard, targetTanggal), targetTanggal);
        }

        if (!hasCachedUsers || diff.usersChanged) {
          renderUsersTable();
        }
        syncClassFilterOptions();
        renderKelasManagement();
      } else {
        // Pergantian filter tanggal/kelas saja: fetch getRekapKepsek & monitoring guru sesuai tanggal
        const [rekapRes, monRes] = await Promise.allSettled([
          API.getRekapKepsek(targetTanggal, targetKelas),
          API.getMonitoringGuru({ tanggal: targetTanggal }),
        ]);
        if (monRes.status === 'fulfilled' && monRes.value) {
          const md = monRes.value.data || monRes.value || {};
          if (Array.isArray(md.absensi_guru)) {
            STATE.absensiGuruToday = md.absensi_guru;
            if (CACHE) CACHE.write('absensiGuruToday', STATE.absensiGuruToday);
          }
        }
        if (rekapRes.status === 'fulfilled' && rekapRes.value) {
          const rk = rekapRes.value.data || rekapRes.value;
          if (rk && rk.sync_ts !== undefined) recordLocalSyncTs(rk.sync_ts);
          const rkChanged = !CACHE || CACHE.hasChanged(STATE.rekapKepsek, rk) || !hasCachedRk;
          STATE.rekapKepsek = rk;
          STATE.rekapKepsekKey = key;
          if (CACHE) CACHE.write('rekapKepsek', { key, payload: rk });
          if (rkChanged) {
            renderKepsekBlockFromData(rk, targetTanggal);
          } else {
            renderKepsekMonitoringGuru();
          }
        } else {
          renderKepsekMonitoringGuru();
        }
      }

      if (updatedEl) {
        updatedEl.textContent = UI.formatDateId(targetTanggal);
      }
      if (showToastOnDone) {
        UI.toast('Laporan harian berhasil diperbarui.', 'success');
      }
    } catch (err) {
      if (!hasAnyCache) {
        renderDashboardStats({ Hadir: null, Sakit: null, Izin: null, Alpa: null }, 0);
        if (absContainer) {
          absContainer.innerHTML = UI.renderStateBox({
            type: 'error',
            title: 'Gagal memuat laporan',
            message: err.message,
            actionLabel: 'Muat Ulang',
            actionId: 'btn-retry-dashboard',
          });
          UI.refreshIcons(absContainer);
          const retryBtn = document.getElementById('btn-retry-dashboard');
          if (retryBtn) retryBtn.addEventListener('click', () => loadDashboard(false, { force: true }));
        }
      }
      if (force || !hasAnyCache) {
        UI.toast(err.message, 'error');
      }
    } finally {
      UI.setButtonLoading(refreshBtn, false);
    }
  }

  function reconcileAdminBackground(opts) {
    const o = opts || {};
    if (o.syncTs !== undefined && o.syncTs !== null && o.syncTs !== '') {
      recordLocalSyncTs(o.syncTs);
    }
    const CACHE = root.MDTA_CACHE;
    if (o.refreshReports) {
      STATE.rekapKepsek = null;
      STATE.rekapKepsekKey = '';
      if (CACHE) {
        CACHE.remove('rekapKepsek');
        CACHE.remove('dashboard');
      }
      silentRefreshFromSync(o.syncTs || null, { quiet: true }).catch(() => {});
    }
  }

  async function refreshUsersOnly() {
    const CACHE = root.MDTA_CACHE;
    const btn = document.getElementById('btn-refresh-users');
    UI.setButtonLoading(btn, true, 'Memuat...');
    try {
      const res = await API.getUsers();
      const freshUsers = API.extractArray(res, ['users', 'daftar_pengguna']).map(API.normalizeUser);
      STATE.users = freshUsers;
      if (CACHE) CACHE.write('users', freshUsers);
      renderUsersTable();
      renderKelasManagement();
      UI.toast(`${freshUsers.length} akun pengguna diperbarui.`, 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(btn, false);
    }
  }

  async function refreshKelasOnly() {
    const CACHE = root.MDTA_CACHE;
    const btn = document.getElementById('btn-refresh-kelas');
    UI.setButtonLoading(btn, true, 'Memuat...');
    try {
      const [kRes, uRes] = await Promise.allSettled([API.getKelas(), API.getUsers()]);
      if (kRes.status === 'fulfilled' && kRes.value) {
        STATE.kelas = API.extractArray(kRes.value, ['kelas']).map(API.normalizeKelas);
        STATE.loaded.kelas = true;
        if (CACHE) CACHE.write('kelas', STATE.kelas);
      } else if (kRes.status === 'rejected') {
        throw kRes.reason;
      }
      if (uRes.status === 'fulfilled' && uRes.value) {
        STATE.users = API.extractArray(uRes.value, ['users', 'daftar_pengguna']).map(API.normalizeUser);
        if (CACHE) CACHE.write('users', STATE.users);
      }
      syncClassFilterOptions();
      renderKelasManagement();
      renderUsersTable();
      UI.toast('Daftar kelas dan pemetaan guru diperbarui.', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(btn, false);
    }
  }

  // =========================================================================
  // KELOLA KELAS RESMI & PEMETAAN GURU PENGAMPU
  // =========================================================================
  function renderKelasManagement() {
    const grid = document.getElementById('admin-kelas-grid');
    const classes = getOfficialClasses();

    const activeClasses = classes.filter((c) => c.status !== 'nonaktif');
    const mappedCount = activeClasses.filter((c) => getGurusForClass(c.nama_kelas).length > 0).length;
    const unmappedCount = Math.max(0, activeClasses.length - mappedCount);
    const totalEl = document.getElementById('kelas-stat-total');
    const mappedEl = document.getElementById('kelas-stat-mapped');
    const unmappedEl = document.getElementById('kelas-stat-unmapped');
    if (totalEl) totalEl.textContent = String(activeClasses.length);
    if (mappedEl) mappedEl.textContent = String(mappedCount);
    if (unmappedEl) unmappedEl.textContent = String(unmappedCount);

    if (!grid) return;

    if (classes.length === 0) {
      grid.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada daftar kelas resmi',
        message: 'Klik "Tambah Kelas" untuk membuat kelas resmi dan memetakan guru pengampu.',
      });
      UI.refreshIcons(grid);
      return;
    }

    const renderCard = (kls) => {
      const countSantri = (STATE.santri || []).filter(
        (s) => API.isKelasAllowed(kls.nama_kelas, API.parseKelasAmpu(s.kelas))
      ).length;
      const gurus = getGurusForClass(kls.nama_kelas);
      const guruHtml =
        gurus.length > 0
          ? `<div class="guru-pill-list">${gurus
              .map((g) => `<span class="guru-pill">${UI.esc(g.nama_lengkap || g.username)}</span>`)
              .join('')}</div>`
          : `<span class="text-muted" style="font-size:0.8rem;">Belum ada guru pengampu dipetakan</span>`;
      const katProg = kls.kategori_program || resolveClassKategori(kls.nama_kelas);
      const hariLabel =
        typeof API.formatHariMengajarShort === 'function'
          ? API.formatHariMengajarShort(kls.hari_mengajar_list || kls.hari_mengajar || '')
          : 'Sen - Jum';
      const hasFixedClock = Boolean(kls.jam_mulai && kls.jam_selesai);
      const scheduleText = hasFixedClock
        ? `${hariLabel}, ${kls.jam_mulai} - ${kls.jam_selesai} WIB`
        : `${hariLabel}, jam belum diatur`;
      const todayWib = UI.todayISO();
      const hasActiveOverride =
        kls.override_status &&
        kls.override_status !== 'Normal' &&
        kls.override_tanggal &&
        kls.override_tanggal >= todayWib;
      const overrideLabel =
        kls.override_status === 'Libur'
          ? `Libur ${kls.override_tanggal}`
          : `Ubah Jam ${kls.override_tanggal} (${kls.override_jam_mulai || '--:--'}-${kls.override_jam_selesai || '--:--'})`;

      return `
        <article class="kelas-manage-card">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
            <div class="kelas-card-head-main">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <h4 class="heading-md">${UI.esc(kls.nama_kelas)}</h4>
                <span class="status-badge status-izin">${UI.esc(katProg)}</span>
              </div>
              <div class="text-muted" style="font-size:0.78rem;margin-top:2px;">
                ${kls.tingkat ? `${UI.esc(kls.tingkat)} · ` : ''}${countSantri} santri terdaftar
              </div>
            </div>
            <span class="status-badge ${kls.status !== 'nonaktif' ? 'status-hadir' : 'status-sakit'}">
              ${kls.status !== 'nonaktif' ? 'Aktif' : 'Nonaktif'}
            </span>
          </div>

          <div class="kelas-card-schedule">
            <span class="kelas-card-schedule-row">
              <i data-lucide="clock" aria-hidden="true" style="width:13px;height:13px;flex-shrink:0;"></i>
              <span>${UI.esc(scheduleText)}</span>
            </span>
            ${
              hasActiveOverride
                ? `<span class="status-badge ${kls.override_status === 'Libur' ? 'status-alpa' : 'status-sakit'} kelas-card-override-pill">${UI.esc(overrideLabel)}${
                    kls.override_catatan ? ` (${UI.esc(kls.override_catatan)})` : ''
                  }</span>`
                : ''
            }
          </div>

          ${kls.keterangan ? `<div class="text-muted" style="font-size:0.8rem;">${UI.esc(kls.keterangan)}</div>` : ''}

          <div class="stack-gap" style="gap:4px;">
            <div style="font-size:0.76rem;font-weight:600;color:var(--text-muted);">Guru Pengampu:</div>
            ${guruHtml}
          </div>

          <div class="toolbar-actions">
            <button type="button" class="btn btn-secondary btn-sm" data-map-kelas="${UI.esc(kls.nama_kelas)}">
              <i data-lucide="user-check" aria-hidden="true"></i>
              <span>Atur Guru</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" data-manage-santri-kelas="${UI.esc(kls.nama_kelas)}">
              <i data-lucide="users" aria-hidden="true"></i>
              <span>Atur Santri</span>
            </button>
            <button type="button" class="btn btn-secondary btn-sm" data-edit-kelas="${UI.esc(kls.id_kelas)}">
              <i data-lucide="pencil" aria-hidden="true"></i>
              <span>Edit</span>
            </button>
            <button type="button" class="btn btn-danger btn-icon-sm" data-delete-kelas="${UI.esc(kls.id_kelas)}" data-kelas-nama="${UI.esc(kls.nama_kelas)}" aria-label="Hapus kelas ${UI.esc(kls.nama_kelas)}">
              <i data-lucide="trash-2" aria-hidden="true"></i>
              <span class="mobile-only-btn-label">Hapus</span>
            </button>
          </div>
        </article>
      `;
    };

    const programs = CONFIG.PROGRAM_CATEGORIES || ['Diniyyah', 'Tahfidz', 'Tarikh', 'Wustho'];
    grid.innerHTML = programs
      .map((prog) => {
        const items = classes.filter(
          (kls) => (kls.kategori_program || resolveClassKategori(kls.nama_kelas)) === prog
        );
        if (items.length === 0) return '';
        return `
          <section class="program-kelas-group">
            <div class="program-section-head">
              <h3 class="heading-md">Program ${UI.esc(prog)}${prog === 'Diniyyah' ? ' (Resmi)' : ''}</h3>
              <span class="status-badge status-izin mono-num">${items.length} kelas</span>
            </div>
            <div class="program-kelas-cards">${items.map(renderCard).join('')}</div>
          </section>
        `;
      })
      .join('');

    grid.querySelectorAll('button[data-map-kelas]').forEach((btn) => {
      btn.addEventListener('click', () => openKelasGuruModal(btn.dataset.mapKelas));
    });

    grid.querySelectorAll('button[data-manage-santri-kelas]').forEach((btn) => {
      btn.addEventListener('click', () => openKelasSantriModal(btn.dataset.manageSantriKelas));
    });

    grid.querySelectorAll('button[data-edit-kelas]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = classes.find((c) => c.id_kelas === btn.dataset.editKelas);
        if (found) openKelasModal(found);
      });
    });

    grid.querySelectorAll('button[data-delete-kelas]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idKls = btn.dataset.deleteKelas;
        const namaKls = btn.dataset.kelasNama;
        const found = classes.find((c) => c.id_kelas === idKls);
        if (found && found.isSynthetic) {
          UI.toast('Perbarui & deploy Code.gs terlebih dahulu lalu muat ulang halaman agar tab Kelas tersinkron.', 'warn');
          return;
        }
        const ok = await UI.confirmDialog({
          title: 'Hapus Kelas Resmi',
          message: `Kelas "${namaKls}" akan dihapus dari daftar kelas resmi (hanya bisa jika tidak ada santri di dalamnya). Lanjutkan?`,
          confirmLabel: 'Hapus Kelas',
          danger: true,
        });
        if (!ok) return;

        try {
          const res = await API.deleteKelas({ id_kelas: idKls, nama_kelas: namaKls });
          const d = (res && res.data) || res || {};
          STATE.kelas = STATE.kelas.filter((k) => k.id_kelas !== idKls);
          const delLower = String(namaKls || '').trim().toLowerCase();
          STATE.users = (STATE.users || []).map((u) => {
            const list = Array.isArray(u.kelas_ampu) ? u.kelas_ampu : [];
            const next = list.filter((k) => k.toLowerCase() !== delLower);
            if (next.length === list.length) return u;
            return Object.assign({}, u, { kelas_ampu: next, kelas_ampu_text: next.join(', ') });
          });
          if (root.MDTA_CACHE) {
            root.MDTA_CACHE.write('kelas', STATE.kelas);
            root.MDTA_CACHE.write('users', STATE.users);
          }
          syncClassFilterOptions();
          renderKelasManagement();
          renderUsersTable();
          UI.toast(`Kelas "${namaKls}" berhasil dihapus.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        }
      });
    });

    UI.refreshIcons(grid);
  }

  function setKelasHariChips(hariList) {
    const group = document.getElementById('kelas-hari-chips');
    if (!group) return;
    const selectedSet = new Set(Array.isArray(hariList) ? hariList : []);
    group.querySelectorAll('.day-chip[data-kelas-hari]').forEach((btn) => {
      const active = selectedSet.has(btn.dataset.kelasHari);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.classList.toggle('active', active);
    });
  }

  function getSelectedKelasHariChips() {
    const group = document.getElementById('kelas-hari-chips');
    if (!group) return [];
    const order = CONFIG.HARI_OPTIONS || ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    const picked = new Set();
    group.querySelectorAll('.day-chip[data-kelas-hari]').forEach((btn) => {
      if (btn.getAttribute('aria-pressed') === 'true') {
        picked.add(btn.dataset.kelasHari);
      }
    });
    return order.filter((d) => picked.has(d));
  }

  function syncKelasOverrideFieldsUI() {
    const statusEl = document.getElementById('kelas-override-status');
    const fieldsWrap = document.getElementById('kelas-override-fields');
    const timeRow = document.getElementById('kelas-override-time-row');
    const dateInput = document.getElementById('kelas-override-tanggal');
    const statusVal = (statusEl && statusEl.value) || 'Normal';
    if (fieldsWrap) fieldsWrap.hidden = statusVal === 'Normal';
    if (timeRow) timeRow.hidden = statusVal !== 'Ubah Jam';
    if (dateInput && statusVal !== 'Normal' && !dateInput.value) {
      dateInput.value = UI.todayISO();
    }
  }

  function closeKelasModal() {
    localState.editingKelasId = null;
    localState.editingKelasOriginalName = '';
    localState.kelasHariManuallyEdited = false;
    const form = document.getElementById('form-kelas');
    if (form) form.reset();
    const idEl = document.getElementById('kelas-id');
    if (idEl) idEl.value = '';
    syncKelasOverrideFieldsUI();
    UI.closeModal('modal-kelas');
  }

  function openKelasModal(kelasObj) {
    const form = document.getElementById('form-kelas');
    if (form) form.reset();

    const title = document.getElementById('kelas-modal-title');
    const hint = document.getElementById('kelas-edit-hint');
    localState.editingKelasId = kelasObj ? (kelasObj.isSynthetic ? '' : kelasObj.id_kelas) : null;
    localState.editingKelasOriginalName = kelasObj ? kelasObj.nama_kelas : '';
    localState.kelasHariManuallyEdited = Boolean(kelasObj && kelasObj.hari_mengajar);

    document.getElementById('kelas-id').value = localState.editingKelasId || '';
    document.getElementById('kelas-nama').value = kelasObj ? kelasObj.nama_kelas : '';
    const katSel = document.getElementById('kelas-kategori-program');
    const katProg = kelasObj ? (kelasObj.kategori_program || resolveClassKategori(kelasObj.nama_kelas)) : 'Diniyyah';
    if (katSel) {
      katSel.value = katProg;
      if (typeof UI.syncCustomSelect === 'function') UI.syncCustomSelect(katSel);
    }
    document.getElementById('kelas-tingkat').value = kelasObj ? kelasObj.tingkat || '' : '';
    document.getElementById('kelas-keterangan').value = kelasObj ? kelasObj.keterangan || '' : '';
    const statusSel = document.getElementById('kelas-status');
    if (statusSel) {
      statusSel.value = kelasObj ? kelasObj.status || 'aktif' : 'aktif';
      if (typeof UI.syncCustomSelect === 'function') UI.syncCustomSelect(statusSel);
    }

    const hariList =
      typeof API.parseHariMengajar === 'function'
        ? API.parseHariMengajar(kelasObj ? kelasObj.hari_mengajar_list || kelasObj.hari_mengajar : '', katProg)
        : ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
    setKelasHariChips(hariList);

    const legacyRange =
      typeof API.parseLegacyJadwalRange === 'function' && kelasObj && !kelasObj.jam_mulai
        ? API.parseLegacyJadwalRange(kelasObj.jadwal || '')
        : { jam_mulai: '', jam_selesai: '' };
    const jamMulaiEl = document.getElementById('kelas-jam-mulai');
    const jamSelesaiEl = document.getElementById('kelas-jam-selesai');
    if (jamMulaiEl) jamMulaiEl.value = (kelasObj && kelasObj.jam_mulai) || legacyRange.jam_mulai || '';
    if (jamSelesaiEl) jamSelesaiEl.value = (kelasObj && kelasObj.jam_selesai) || legacyRange.jam_selesai || '';

    const ovStatusEl = document.getElementById('kelas-override-status');
    const ovDateEl = document.getElementById('kelas-override-tanggal');
    const ovStartEl = document.getElementById('kelas-override-jam-mulai');
    const ovEndEl = document.getElementById('kelas-override-jam-selesai');
    const ovNoteEl = document.getElementById('kelas-override-catatan');
    const ovStatus = (kelasObj && kelasObj.override_status) || 'Normal';
    if (ovStatusEl) {
      ovStatusEl.value = ovStatus;
      if (typeof UI.syncCustomSelect === 'function') UI.syncCustomSelect(ovStatusEl);
    }
    if (ovDateEl) ovDateEl.value = ovStatus !== 'Normal' && kelasObj ? kelasObj.override_tanggal || '' : '';
    if (ovStartEl) ovStartEl.value = ovStatus === 'Ubah Jam' && kelasObj ? kelasObj.override_jam_mulai || '' : '';
    if (ovEndEl) ovEndEl.value = ovStatus === 'Ubah Jam' && kelasObj ? kelasObj.override_jam_selesai || '' : '';
    if (ovNoteEl) ovNoteEl.value = ovStatus !== 'Normal' && kelasObj ? kelasObj.override_catatan || '' : '';
    syncKelasOverrideFieldsUI();

    if (title) title.textContent = kelasObj && !kelasObj.isSynthetic ? `Edit Kelas (${kelasObj.nama_kelas})` : 'Tambah Kelas Resmi';
    if (hint) hint.hidden = !(kelasObj && !kelasObj.isSynthetic);
    UI.openModal('modal-kelas');
  }

  function closeKelasGuruModal() {
    localState.mappingKelasName = '';
    const targetEl = document.getElementById('kelas-guru-target-nama');
    if (targetEl) targetEl.value = '';
    UI.closeModal('modal-kelas-guru');
  }

  function openKelasGuruModal(kelasName) {
    localState.mappingKelasName = kelasName;
    const targetEl = document.getElementById('kelas-guru-target-nama');
    const titleEl = document.getElementById('kelas-guru-modal-title');
    const subEl = document.getElementById('kelas-guru-subtitle');
    const box = document.getElementById('kelas-guru-checkboxes');
    if (targetEl) targetEl.value = kelasName;
    if (titleEl) titleEl.textContent = `Atur Guru Pengampu (${kelasName})`;
    if (subEl) subEl.textContent = `Centang satu atau lebih akun guru yang mengampu kelas ${kelasName}.`;

    const gurus = (STATE.users || []).filter((u) => String(u.role || '').toLowerCase() === 'guru');
    if (box) {
      if (gurus.length === 0) {
        box.innerHTML = `<div class="text-muted" style="grid-column:1 / -1;font-size:0.84rem;">Belum ada akun berstatus Guru. Tambahkan akun guru di tabel Kelola Akun terlebih dahulu.</div>`;
      } else {
        box.innerHTML = gurus
          .map((g) => {
            const uid = g.id_user || g.username;
            const checked = API.isKelasAllowed(kelasName, g.kelas_ampu);
            const activeBadge = g.status_aktif === 'aktif' ? '' : ' (Nonaktif)';
            return `
              <label class="kelas-checkbox-item">
                <input type="checkbox" name="kelas-guru-id" value="${UI.esc(uid)}" ${checked ? 'checked' : ''} />
                <span><strong>${UI.esc(g.nama_lengkap || g.username)}</strong><br><span class="text-muted" style="font-size:0.74rem;">@${UI.esc(g.username)}${UI.esc(activeBadge)}</span></span>
              </label>
            `;
          })
          .join('');
      }
    }

    UI.openModal('modal-kelas-guru');
  }

  function closeKelasSantriModal() {
    localState.mappingSantriKelasName = '';
    localState.mappingSantriSelectedIds = new Set();
    const targetEl = document.getElementById('kelas-santri-target-nama');
    const searchEl = document.getElementById('kelas-santri-search');
    if (targetEl) targetEl.value = '';
    if (searchEl) searchEl.value = '';
    UI.closeModal('modal-kelas-santri');
  }

  function updateKelasSantriSelectedCount() {
    const countEl = document.getElementById('kelas-santri-selected-count');
    if (!countEl) return;
    const total = localState.mappingSantriSelectedIds ? localState.mappingSantriSelectedIds.size : 0;
    countEl.textContent = `${total} dipilih`;
  }

  function renderKelasSantriChecklist(query) {
    const box = document.getElementById('kelas-santri-checkboxes');
    if (!box) return;
    const q = String(query || '').trim().toLowerCase();
    const activeSantri = (STATE.santri || [])
      .filter((s) => API.isActiveSantri(s) && s.id_santri)
      .slice()
      .sort((a, b) => String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''), 'id'));

    const filtered = activeSantri.filter((s) => {
      if (!q) return true;
      return (
        String(s.nama_lengkap || '').toLowerCase().includes(q) ||
        String(s.kelas || '').toLowerCase().includes(q) ||
        String(s.id_santri || '').toLowerCase().includes(q)
      );
    });

    if (activeSantri.length === 0) {
      box.innerHTML = `<div class="text-muted" style="grid-column:1 / -1;font-size:0.84rem;">Belum ada santri berstatus Aktif. Tambahkan santri di tab Santri terlebih dahulu.</div>`;
      updateKelasSantriSelectedCount();
      return;
    }

    if (filtered.length === 0) {
      box.innerHTML = `<div class="text-muted" style="grid-column:1 / -1;font-size:0.84rem;">Tidak ada santri aktif yang cocok dengan pencarian.</div>`;
      updateKelasSantriSelectedCount();
      return;
    }

    const selectedSet = localState.mappingSantriSelectedIds || new Set();
    box.innerHTML = filtered
      .map((s) => {
        const sid = String(s.id_santri || '').trim();
        const checked = selectedSet.has(sid);
        const kelasMeta = s.kelas ? s.kelas : 'Belum ada kelas';
        return `
          <label class="kelas-checkbox-item">
            <input type="checkbox" name="kelas-santri-id" value="${UI.esc(sid)}" ${checked ? 'checked' : ''} />
            <span><strong>${UI.esc(s.nama_lengkap)}</strong><br><span class="text-muted" style="font-size:0.74rem;">${UI.esc(kelasMeta)}</span></span>
          </label>
        `;
      })
      .join('');

    box.querySelectorAll('input[name="kelas-santri-id"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSet.add(cb.value);
        else selectedSet.delete(cb.value);
        updateKelasSantriSelectedCount();
      });
    });

    updateKelasSantriSelectedCount();
  }

  function openKelasSantriModal(kelasName) {
    localState.mappingSantriKelasName = kelasName;
    const selectedSet = new Set();
    (STATE.santri || []).forEach((s) => {
      if (!API.isActiveSantri(s) || !s.id_santri) return;
      if (API.isKelasAllowed(kelasName, API.parseKelasAmpu(s.kelas))) {
        selectedSet.add(String(s.id_santri).trim());
      }
    });
    localState.mappingSantriSelectedIds = selectedSet;

    const targetEl = document.getElementById('kelas-santri-target-nama');
    const titleEl = document.getElementById('kelas-santri-modal-title');
    const subEl = document.getElementById('kelas-santri-subtitle');
    const searchEl = document.getElementById('kelas-santri-search');
    if (targetEl) targetEl.value = kelasName;
    if (titleEl) titleEl.textContent = `Atur Santri (${kelasName})`;
    if (subEl) subEl.textContent = `Centang santri aktif yang terdaftar di kelas ${kelasName}. Kelas lain yang diikuti santri tetap dipertahankan.`;
    if (searchEl) searchEl.value = '';

    renderKelasSantriChecklist('');
    UI.openModal('modal-kelas-santri');
    if (searchEl && typeof searchEl.focus === 'function') searchEl.focus();
  }

  function bindKelasEvents() {
    const refreshKelasBtn = document.getElementById('btn-refresh-kelas');
    const addKelasBtn = document.getElementById('btn-add-kelas');
    const closeKelasBtn = document.getElementById('btn-close-kelas-modal');
    const cancelKelasBtn = document.getElementById('btn-cancel-kelas-modal');
    const kelasForm = document.getElementById('form-kelas');
    const saveKelasBtn = document.getElementById('btn-save-kelas');

    const closeMapBtn = document.getElementById('btn-close-kelas-guru-modal');
    const cancelMapBtn = document.getElementById('btn-cancel-kelas-guru-modal');
    const mapForm = document.getElementById('form-kelas-guru');
    const saveMapBtn = document.getElementById('btn-save-kelas-guru');

    const closeSantriMapBtn = document.getElementById('btn-close-kelas-santri-modal');
    const cancelSantriMapBtn = document.getElementById('btn-cancel-kelas-santri-modal');
    const santriMapSearch = document.getElementById('kelas-santri-search');
    const santriMapForm = document.getElementById('form-kelas-santri');
    const saveSantriMapBtn = document.getElementById('btn-save-kelas-santri');

    if (refreshKelasBtn) refreshKelasBtn.addEventListener('click', refreshKelasOnly);
    if (addKelasBtn) addKelasBtn.addEventListener('click', () => openKelasModal(null));
    if (closeKelasBtn) closeKelasBtn.addEventListener('click', closeKelasModal);
    if (cancelKelasBtn) cancelKelasBtn.addEventListener('click', closeKelasModal);

    const hariChipsGroup = document.getElementById('kelas-hari-chips');
    if (hariChipsGroup) {
      hariChipsGroup.addEventListener('click', (e) => {
        const chip = e.target && typeof e.target.closest === 'function' ? e.target.closest('.day-chip[data-kelas-hari]') : null;
        if (!chip) return;
        const pressed = chip.getAttribute('aria-pressed') === 'true';
        chip.setAttribute('aria-pressed', pressed ? 'false' : 'true');
        chip.classList.toggle('active', !pressed);
        localState.kelasHariManuallyEdited = true;
      });
    }

    const katSelectEl = document.getElementById('kelas-kategori-program');
    if (katSelectEl) {
      katSelectEl.addEventListener('change', () => {
        if (!localState.editingKelasId && !localState.kelasHariManuallyEdited) {
          const defHari =
            typeof API.defaultHariMengajarForProgram === 'function'
              ? API.defaultHariMengajarForProgram(katSelectEl.value)
              : ['Sen', 'Sel', 'Rab', 'Kam', 'Jum'];
          setKelasHariChips(defHari);
        }
      });
    }

    const ovStatusSel = document.getElementById('kelas-override-status');
    if (ovStatusSel) {
      ovStatusSel.addEventListener('change', syncKelasOverrideFieldsUI);
    }

    if (closeMapBtn) closeMapBtn.addEventListener('click', closeKelasGuruModal);
    if (cancelMapBtn) cancelMapBtn.addEventListener('click', closeKelasGuruModal);

    if (closeSantriMapBtn) closeSantriMapBtn.addEventListener('click', closeKelasSantriModal);
    if (cancelSantriMapBtn) cancelSantriMapBtn.addEventListener('click', closeKelasSantriModal);
    if (santriMapSearch) {
      santriMapSearch.addEventListener('input', (e) => {
        renderKelasSantriChecklist(e.target.value || '');
      });
    }

    if (kelasForm) {
      kelasForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isEdit = Boolean(localState.editingKelasId);
        const namaKelas = document.getElementById('kelas-nama').value.trim();
        const kategoriProgram = document.getElementById('kelas-kategori-program')?.value || 'Diniyyah';
        const tingkat = document.getElementById('kelas-tingkat').value.trim();
        const keterangan = document.getElementById('kelas-keterangan').value.trim();
        const status = document.getElementById('kelas-status').value || 'aktif';

        const selectedHari = getSelectedKelasHariChips();
        const hariMengajar =
          selectedHari.length > 0
            ? selectedHari.join(',')
            : (typeof API.defaultHariMengajarForProgram === 'function'
                ? API.defaultHariMengajarForProgram(kategoriProgram).join(',')
                : 'Sen,Sel,Rab,Kam,Jum');
        const jamMulai = (document.getElementById('kelas-jam-mulai')?.value || '').trim();
        const jamSelesai = (document.getElementById('kelas-jam-selesai')?.value || '').trim();
        if ((jamMulai && !jamSelesai) || (!jamMulai && jamSelesai)) {
          UI.toast('Lengkapi Jam Mulai dan Jam Selesai jadwal tetap.', 'error');
          return;
        }
        if (jamMulai && jamSelesai && jamSelesai <= jamMulai) {
          UI.toast('Jam Selesai jadwal tetap harus lebih akhir dari Jam Mulai.', 'error');
          return;
        }

        const overrideStatus = document.getElementById('kelas-override-status')?.value || 'Normal';
        let overrideTanggal = (document.getElementById('kelas-override-tanggal')?.value || '').trim();
        let overrideJamMulai = (document.getElementById('kelas-override-jam-mulai')?.value || '').trim();
        let overrideJamSelesai = (document.getElementById('kelas-override-jam-selesai')?.value || '').trim();
        let overrideCatatan = (document.getElementById('kelas-override-catatan')?.value || '').trim();

        if (overrideStatus === 'Normal') {
          overrideTanggal = '';
          overrideJamMulai = '';
          overrideJamSelesai = '';
          overrideCatatan = '';
        } else {
          if (!overrideTanggal) {
            UI.toast('Pilih Tanggal Berlaku untuk penyesuaian jadwal sementara.', 'error');
            return;
          }
          if (overrideStatus === 'Ubah Jam') {
            if (!overrideJamMulai || !overrideJamSelesai) {
              UI.toast('Lengkapi Jam Mulai dan Jam Selesai pengganti.', 'error');
              return;
            }
            if (overrideJamSelesai <= overrideJamMulai) {
              UI.toast('Jam Selesai pengganti harus lebih akhir dari Jam Mulai pengganti.', 'error');
              return;
            }
          } else {
            overrideJamMulai = '';
            overrideJamSelesai = '';
          }
        }

        if (!namaKelas) {
          UI.toast('Nama kelas wajib diisi.', 'error');
          return;
        }

        const payload = {
          isEdit,
          id_kelas: localState.editingKelasId || '',
          original_nama_kelas: localState.editingKelasOriginalName || '',
          nama_kelas: namaKelas,
          kategori_program: kategoriProgram,
          tingkat,
          keterangan,
          status,
          hari_mengajar: hariMengajar,
          jam_mulai: jamMulai,
          jam_selesai: jamSelesai,
          override_status: overrideStatus,
          override_tanggal: overrideTanggal,
          override_jam_mulai: overrideJamMulai,
          override_jam_selesai: overrideJamSelesai,
          override_catatan: overrideCatatan,
        };

        UI.setButtonLoading(saveKelasBtn, true, 'Menyimpan...');
        try {
          const oldName = localState.editingKelasOriginalName || '';
          const res = await API.saveKelas(payload);
          const d = (res && res.data) || res || {};
          const savedKelas = API.normalizeKelas(
            Object.assign({}, payload, d, {
              id_kelas: d.id_kelas || payload.id_kelas,
              nama_kelas: d.nama_kelas || namaKelas,
            })
          );
          const idxK = (STATE.kelas || []).findIndex(
            (k) =>
              (savedKelas.id_kelas && k.id_kelas === savedKelas.id_kelas) ||
              (oldName && k.nama_kelas.toLowerCase() === oldName.toLowerCase())
          );
          if (idxK >= 0) STATE.kelas[idxK] = savedKelas;
          else STATE.kelas.push(savedKelas);
          STATE.kelas.sort((a, b) => a.nama_kelas.localeCompare(b.nama_kelas));
          STATE.loaded.kelas = true;

          const renamedFrom = d.renamed_from || (isEdit && oldName && oldName.toLowerCase() !== savedKelas.nama_kelas.toLowerCase() ? oldName : '');
          if (renamedFrom) {
            const oldLower = renamedFrom.toLowerCase();
            STATE.santri = (STATE.santri || []).map((s) => {
              const cur = API.parseKelasAmpu(s.kelas);
              if (!cur.some((c) => c.toLowerCase() === oldLower)) return s;
              const next = cur.map((c) => (c.toLowerCase() === oldLower ? savedKelas.nama_kelas : c));
              return Object.assign({}, s, { kelas: next.join(', ') });
            });
            STATE.users = (STATE.users || []).map((u) => {
              const cur = Array.isArray(u.kelas_ampu) ? u.kelas_ampu : [];
              if (!cur.some((c) => c.toLowerCase() === oldLower)) return u;
              const next = cur.map((c) => (c.toLowerCase() === oldLower ? savedKelas.nama_kelas : c));
              return Object.assign({}, u, { kelas_ampu: next, kelas_ampu_text: next.join(', ') });
            });
            if (root.MDTA_CACHE) {
              root.MDTA_CACHE.write('santri', STATE.santri);
              root.MDTA_CACHE.write('users', STATE.users);
            }
          }
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('kelas', STATE.kelas);

          closeKelasModal();
          syncClassFilterOptions();
          renderKelasManagement();
          renderSantriTable();
          renderUsersTable();
          UI.toast(`Kelas "${savedKelas.nama_kelas}" berhasil disimpan.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveKelasBtn, false);
        }
      });
    }

    if (mapForm) {
      mapForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const namaKelas = localState.mappingKelasName || document.getElementById('kelas-guru-target-nama').value.trim();
        if (!namaKelas) return;
        const selectedIds = Array.from(mapForm.querySelectorAll('input[name="kelas-guru-id"]:checked')).map(
          (cb) => cb.value
        );

        UI.setButtonLoading(saveMapBtn, true, 'Menyimpan...');
        try {
          const res = await API.saveKelasMapping({ nama_kelas: namaKelas, guru_ids: selectedIds });
          const d = (res && res.data) || res || {};
          const selectedSet = new Set(selectedIds);
          STATE.users = (STATE.users || []).map((u) => {
            if (String(u.role || '').toLowerCase() === 'admin') return u;
            const uid = String(u.id_user || u.username);
            const shouldHave = selectedSet.has(uid) || selectedSet.has(String(u.username || ''));
            const curList = Array.isArray(u.kelas_ampu) ? u.kelas_ampu : [];
            const hasNow = API.isKelasAllowed(namaKelas, curList);
            let nextList = curList;
            if (shouldHave && !hasNow) nextList = curList.concat([namaKelas]);
            else if (!shouldHave && hasNow) {
              nextList = curList.filter((k) => k.toLowerCase() !== namaKelas.toLowerCase());
            }
            return Object.assign({}, u, {
              kelas_ampu: nextList,
              kelas_ampu_text: nextList.join(', '),
            });
          });
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('users', STATE.users);
          closeKelasGuruModal();
          renderUsersTable();
          renderKelasManagement();
          if (STATE.rekapKepsek) {
            renderKepsekBlockFromData(STATE.rekapKepsek, UI.todayISO());
          }
          UI.toast(`Pemetaan guru pengampu untuk "${namaKelas}" tersimpan.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveMapBtn, false);
        }
      });
    }

    if (santriMapForm) {
      santriMapForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const namaKelas =
          localState.mappingSantriKelasName ||
          (document.getElementById('kelas-santri-target-nama')?.value || '').trim();
        if (!namaKelas) return;

        const selectedIds = Array.from(localState.mappingSantriSelectedIds || []);
        const selectedSet = new Set(selectedIds);

        UI.setButtonLoading(saveSantriMapBtn, true, 'Menyimpan...');
        try {
          const res = await API.saveKelasSantri({ nama_kelas: namaKelas, santri_ids: selectedIds });
          const d = (res && res.data) || res || {};
          STATE.santri = (STATE.santri || []).map((s) => {
            if (!s.id_santri) return s;
            const sid = String(s.id_santri).trim();
            const shouldHave = selectedSet.has(sid);
            const curList = API.parseKelasAmpu(s.kelas);
            const hasNow = API.isKelasAllowed(namaKelas, curList);
            let nextList = curList;
            if (shouldHave && !hasNow) {
              nextList = curList.concat([namaKelas]);
            } else if (!shouldHave && hasNow) {
              nextList = curList.filter((k) => k.toLowerCase() !== namaKelas.toLowerCase());
            } else {
              return s;
            }
            return Object.assign({}, s, { kelas: nextList.join(', ') });
          });
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('santri', STATE.santri);
          closeKelasSantriModal();
          renderKelasManagement();
          renderSantriTable();
          UI.toast(`Anggota santri kelas "${namaKelas}" berhasil disimpan.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveSantriMapBtn, false);
        }
      });
    }
  }

  function renderUserKelasCheckboxes(selectedList) {
    const box = document.getElementById('user-kelas-checkboxes');
    if (!box) return;
    const classes = getOfficialClassNames(false);
    const extraSelected = API.parseKelasAmpu(selectedList).filter(
      (k) => !classes.some((c) => c.toLowerCase() === k.toLowerCase())
    );
    const combined = classes.concat(extraSelected);

    if (combined.length === 0) {
      box.innerHTML = `<div class="text-muted" style="grid-column:1 / -1;font-size:0.8125rem;">Belum ada kelas aktif. Tambahkan kelas pada panel Kelola Kelas terlebih dahulu.</div>`;
      return;
    }

    box.innerHTML = combined
      .map((k) => {
        const checked = API.isKelasAllowed(k, selectedList || []);
        return `
          <label class="kelas-checkbox-item">
            <input type="checkbox" name="user-kelas-ampu" value="${UI.esc(k)}" ${checked ? 'checked' : ''} />
            <span>${UI.esc(k)}</span>
          </label>
        `;
      })
      .join('');
  }

  function toggleUserKelasVisibility() {
    const roleVal = String(document.getElementById('user-role')?.value || 'guru').toLowerCase();
    const group = document.getElementById('user-kelas-ampu-group');
    const note = document.getElementById('user-kelas-admin-note');
    const isGuru = roleVal !== 'admin';
    if (group) group.hidden = !isGuru;
    if (note) note.hidden = isGuru;
  }

  function closeUserModal() {
    localState.editingUserId = null;
    localState.editingUserOriginalUsername = '';
    const form = document.getElementById('form-user');
    if (form) form.reset();
    const idField = document.getElementById('user-id');
    if (idField) idField.value = '';
    UI.closeModal('modal-user');
  }

  function openUserModal(user) {
    const form = document.getElementById('form-user');
    if (form) form.reset();

    const title = document.getElementById('user-modal-title');
    const idField = document.getElementById('user-id');
    const namaField = document.getElementById('user-nama');
    const usernameField = document.getElementById('user-username');
    const passField = document.getElementById('user-password');
    const passHint = document.getElementById('user-password-hint');
    const roleField = document.getElementById('user-role');
    const statusField = document.getElementById('user-status');

    localState.editingUserId = null;
    localState.editingUserOriginalUsername = '';
    if (idField) idField.value = '';
    if (namaField) namaField.value = '';
    if (usernameField) usernameField.value = '';
    if (passField) {
      passField.value = '';
      passField.required = true;
    }
    if (roleField) roleField.value = 'guru';
    if (statusField) statusField.value = 'aktif';

    let selectedKelas = [];
    if (user) {
      localState.editingUserId = user.id_user || user.username || '';
      localState.editingUserOriginalUsername = user.username || '';
      if (title) title.textContent = 'Edit Pengguna / Guru';
      if (idField) idField.value = localState.editingUserId;
      if (namaField) namaField.value = user.nama_lengkap || '';
      if (usernameField) usernameField.value = user.username || '';
      if (passField) {
        passField.value = '';
        passField.required = false;
      }
      if (passHint) passHint.textContent = 'Kosongkan jika tidak ingin mengubah kata sandi.';
      if (roleField) roleField.value = user.role || 'guru';
      if (statusField) statusField.value = user.status_aktif || 'aktif';
      selectedKelas = Array.isArray(user.kelas_ampu) ? user.kelas_ampu : API.parseKelasAmpu(user.kelas_ampu);
    } else {
      if (title) title.textContent = 'Tambah Pengguna / Guru';
      if (passHint) passHint.textContent = 'Wajib diisi untuk akun baru.';
    }

    renderUserKelasCheckboxes(selectedKelas);
    toggleUserKelasVisibility();
    UI.openModal('modal-user');
  }

  function bindDashboardEvents() {
    const refreshBtn = document.getElementById('btn-refresh-dashboard');
    const filterKelas = document.getElementById('kepsek-filter-kelas');
    const searchInput = document.getElementById('admin-riwayat-search');
    const refreshUsersBtn = document.getElementById('btn-refresh-users');
    const usersSearchInput = document.getElementById('users-search-input');
    const usersRoleFilter = document.getElementById('users-role-filter');
    const addUserBtn = document.getElementById('btn-add-user');
    const closeUserBtn = document.getElementById('btn-close-user-modal');
    const cancelUserBtn = document.getElementById('btn-cancel-user-modal');
    const roleSelect = document.getElementById('user-role');
    const userForm = document.getElementById('form-user');
    const saveUserBtn = document.getElementById('btn-save-user');

    const closeDetailBtn = document.getElementById('btn-close-detail-nilai');
    const tutupDetailBtn = document.getElementById('btn-tutup-detail-nilai');
    const clearDailyBtn = document.getElementById('btn-admin-clear-presensi-harian');

    if (clearDailyBtn) {
      clearDailyBtn.addEventListener('click', async () => {
        const kelasSel = document.getElementById('kepsek-filter-kelas');
        const targetTanggal = UI.todayISO();
        const targetKelas = (kelasSel && kelasSel.value) || '';
        const scopeLabel = targetKelas ? `kelas ${targetKelas}` : 'semua kelas';

        const confirmed = await UI.confirmDialog({
          title: 'Bersihkan Log Presensi Harian',
          message: `Hapus seluruh catatan presensi tanggal ${UI.formatDateShort(targetTanggal)} untuk ${scopeLabel}? Data tanggal sebelumnya untuk Rekap Bulanan dan persentase kehadiran Raport tetap aman.`,
          confirmLabel: 'Bersihkan Log Harian',
          danger: true,
        });
        if (!confirmed) return;

        UI.setButtonLoading(clearDailyBtn, true, 'Membersihkan...');
        try {
          const res = await API.clearPresensiHarian({ tanggal: targetTanggal, kelas: targetKelas });
          const d = res.data || res || {};
          const kelasLower = String(targetKelas || '').trim().toLowerCase();
          if (STATE.rekapKepsek && typeof STATE.rekapKepsek === 'object') {
            const rk = STATE.rekapKepsek;
            if (rk.absensi_harian) {
              const keepRow = (r) => Boolean(kelasLower && String((r && r.kelas) || '').trim().toLowerCase() !== kelasLower);
              const nextRiwayat = Array.isArray(rk.absensi_harian.riwayat)
                ? rk.absensi_harian.riwayat.filter(keepRow)
                : [];
              rk.absensi_harian.riwayat = nextRiwayat;
              rk.absensi_harian.santri_tidak_hadir = Array.isArray(rk.absensi_harian.santri_tidak_hadir)
                ? rk.absensi_harian.santri_tidak_hadir.filter(keepRow)
                : [];
              const nextAg = { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: nextRiwayat.length };
              nextRiwayat.forEach((r) => {
                const st = String((r && r.status) || 'Hadir');
                if (Object.prototype.hasOwnProperty.call(nextAg, st)) nextAg[st]++;
              });
              rk.absensi_harian.agregat = nextAg;
            }
            if (Array.isArray(rk.laporan_per_kelas)) {
              rk.laporan_per_kelas = rk.laporan_per_kelas.map((blk) => {
                if (kelasLower && String((blk && blk.kelas) || '').trim().toLowerCase() !== kelasLower) return blk;
                return Object.assign({}, blk, {
                  agregat_absensi: { Hadir: 0, Sakit: 0, Izin: 0, Alpa: 0, total: 0 },
                  metode_absensi: { qr: 0, manual: 0 },
                  santri_tidak_hadir: [],
                  riwayat_absensi: [],
                  status_setoran: Object.assign({}, blk.status_setoran || {}, { sudah_setor: false }),
                });
              });
            }
            renderKepsekBlockFromData(rk, targetTanggal);
          }
          UI.toast(
            `Log presensi ${UI.formatDateShort(targetTanggal)} (${scopeLabel}) dibersihkan (${d.deletedCount ?? 0} catatan dihapus). Rekap bulanan tetap aman.`,
            'success'
          );
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(`Gagal membersihkan log harian: ${err.message}`, 'error');
        } finally {
          UI.setButtonLoading(clearDailyBtn, false);
        }
      });
    }
    if (filterKelas) filterKelas.addEventListener('change', () => loadDashboard(false, { force: false }));
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadDashboard(true, { force: true }));
    document.querySelectorAll('#kepsek-report-tabs .report-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        localState.kepsekModeLocked = true;
        applyKepsekReportMode(btn.dataset.kepsekMode || 'absensi');
      });
    });
    document.querySelectorAll('#kepsek-program-pills .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        localState.kepsekProgramFilter = chip.dataset.programFilter || '';
        document.querySelectorAll('#kepsek-program-pills .filter-chip').forEach((c) => {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        if (STATE.rekapKepsek) {
          renderKepsekBlockFromData(STATE.rekapKepsek, UI.todayISO());
        }
        renderKepsekMonitoringGuru();
      });
    });
    if (refreshUsersBtn) refreshUsersBtn.addEventListener('click', refreshUsersOnly);
    if (usersSearchInput) {
      usersSearchInput.addEventListener('input', (e) => {
        localState.usersQuery = e.target.value || '';
        renderUsersTable();
      });
    }
    if (usersRoleFilter) {
      usersRoleFilter.addEventListener('change', (e) => {
        localState.usersRoleFilter = e.target.value || 'Semua';
        renderUsersTable();
      });
    }

    if (closeDetailBtn) closeDetailBtn.addEventListener('click', () => UI.closeModal('modal-detail-nilai'));
    if (tutupDetailBtn) tutupDetailBtn.addEventListener('click', () => UI.closeModal('modal-detail-nilai'));

    const closeDetailSantriBtn = document.getElementById('btn-close-detail-santri');
    const closeDetailRekapBtn = document.getElementById('btn-close-detail-rekap');
    const tutupDetailRekapBtn = document.getElementById('btn-detail-rekap-tutup');
    if (closeDetailSantriBtn) closeDetailSantriBtn.addEventListener('click', () => UI.closeModal('modal-detail-santri'));
    if (closeDetailRekapBtn) closeDetailRekapBtn.addEventListener('click', () => UI.closeModal('modal-detail-rekap'));
    if (tutupDetailRekapBtn) tutupDetailRekapBtn.addEventListener('click', () => UI.closeModal('modal-detail-rekap'));

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        localState.riwayatQuery = e.target.value || '';
        renderRiwayatTable();
      });
    }

    document.querySelectorAll('#admin-riwayat-status-filters .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        localState.riwayatFilterStatus = chip.dataset.statusFilter || 'Semua';
        document.querySelectorAll('#admin-riwayat-status-filters .filter-chip').forEach((c) => {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        renderRiwayatTable();
      });
    });

    if (addUserBtn) addUserBtn.addEventListener('click', () => openUserModal(null));
    if (closeUserBtn) closeUserBtn.addEventListener('click', closeUserModal);
    if (cancelUserBtn) cancelUserBtn.addEventListener('click', closeUserModal);
    if (roleSelect) roleSelect.addEventListener('change', toggleUserKelasVisibility);

    if (userForm) {
      userForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isEdit = Boolean(localState.editingUserId);
        const idUser = isEdit ? localState.editingUserId : generateNextLocalId(STATE.users || [], 'id_user', 'USR-', 3);
        const namaLengkap = document.getElementById('user-nama').value.trim();
        const username = document.getElementById('user-username').value.trim();
        const password = document.getElementById('user-password').value;
        const role = document.getElementById('user-role').value;
        const statusAktif = document.getElementById('user-status').value || 'aktif';
        const checkedKelas =
          role === 'admin'
            ? []
            : Array.from(userForm.querySelectorAll('input[name="user-kelas-ampu"]:checked')).map((cb) => cb.value);

        if (!namaLengkap || !username) {
          UI.toast('Nama lengkap dan username wajib diisi.', 'error');
          return;
        }
        if (!isEdit && !password) {
          UI.toast('Kata sandi wajib diisi untuk pengguna baru.', 'error');
          return;
        }

        const dupUser = (STATE.users || []).find((u) => {
          const sameUsername = String(u.username || '').trim().toLowerCase() === username.toLowerCase();
          if (!sameUsername) return false;
          if (!isEdit) return true;
          return (u.id_user || u.username) !== localState.editingUserId;
        });
        if (dupUser) {
          UI.toast(`Username "${username}" sudah digunakan oleh akun lain.`, 'error');
          return;
        }

        const payload = {
          isEdit,
          id_user: idUser,
          username,
          nama_lengkap: namaLengkap,
          role,
          status_aktif: statusAktif,
          kelas_ampu: checkedKelas,
        };
        if (isEdit && localState.editingUserOriginalUsername) {
          payload.original_username = localState.editingUserOriginalUsername;
        }
        if (password) payload.password = password;

        UI.setButtonLoading(saveUserBtn, true, 'Menyimpan...');
        try {
          const res = await API.saveUser(payload);
          const d = (res && res.data) || res || {};
          const savedUser = API.normalizeUser(
            Object.assign({}, payload, d, {
              id_user: d.id_user || payload.id_user,
              username: d.username || payload.username,
              nama_lengkap: d.nama_lengkap || payload.nama_lengkap,
              role: d.role || payload.role,
              status_aktif: d.status_aktif || payload.status_aktif,
              kelas_ampu: d.kelas_ampu !== undefined ? d.kelas_ampu : payload.kelas_ampu,
            })
          );
          const idxU = (STATE.users || []).findIndex(
            (u) =>
              (savedUser.id_user && u.id_user === savedUser.id_user) ||
              (localState.editingUserOriginalUsername &&
                u.username.toLowerCase() === localState.editingUserOriginalUsername.toLowerCase()) ||
              u.username.toLowerCase() === savedUser.username.toLowerCase()
          );
          if (idxU >= 0) STATE.users[idxU] = Object.assign({}, STATE.users[idxU], savedUser);
          else STATE.users.push(savedUser);
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('users', STATE.users);
          closeUserModal();
          renderUsersTable();
          renderKelasManagement();
          UI.toast(`Akun "${namaLengkap}" berhasil disimpan.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveUserBtn, false);
        }
      });
    }
  }

  // =========================================================================
  // TAB 2: DATABASE SANTRI & KARTU QR (qrcode.js)
  // =========================================================================
  function generateQRToken(idHint) {
    if (idHint) return `QR-MDTA-${String(idHint).replace(/[^a-zA-Z0-9]/g, '')}`;
    const stamp = Date.now().toString(36).toUpperCase().slice(-4);
    return `QR-MDTA-S${stamp}`;
  }

  function syncClassFilterOptions() {
    const santriFilter = document.getElementById('santri-kelas-filter');
    const rekapFilter = document.getElementById('rekap-kelas-filter');
    const modalSantriKelas = document.getElementById('santri-kelas');
    const bulkTargetSelect = document.getElementById('santri-bulk-target-kelas');
    const moveTargetSelect = document.getElementById('move-target-kelas');

    const officialNames = getOfficialClassNames(false);

    populateClassSelect(santriFilter, officialNames, { firstLabel: 'Semua Kelas', firstValue: '' });
    populateClassSelect(rekapFilter, officialNames, { firstLabel: 'Semua Kelas', firstValue: '' });
    populateClassSelect(modalSantriKelas, officialNames, { defaultToFirst: true });
    populateClassSelect(bulkTargetSelect, officialNames, { defaultToFirst: true });
    populateClassSelect(moveTargetSelect, officialNames, { defaultToFirst: true });
  }

  function updateBulkSantriBar(visibleSantriList) {
    const bulkBar = document.getElementById('santri-bulk-bar');
    const countEl = document.getElementById('santri-bulk-count');
    const selectAllEl = document.getElementById('santri-select-all');
    const existingIds = new Set((STATE.santri || []).map((s) => s.id_santri).filter(Boolean));
    Array.from(localState.selectedSantriIds).forEach((id) => {
      if (!existingIds.has(id)) localState.selectedSantriIds.delete(id);
    });

    const selectedCount = localState.selectedSantriIds.size;
    if (bulkBar) bulkBar.hidden = selectedCount === 0;
    if (countEl) countEl.textContent = `${selectedCount} santri dipilih`;

    if (selectAllEl) {
      const list = Array.isArray(visibleSantriList) ? visibleSantriList : [];
      const selectable = list.map((s) => s.id_santri).filter(Boolean);
      const selectedInView = selectable.filter((id) => localState.selectedSantriIds.has(id)).length;
      selectAllEl.checked = selectable.length > 0 && selectedInView === selectable.length;
      selectAllEl.indeterminate = selectedInView > 0 && selectedInView < selectable.length;
    }
  }

  async function confirmAndDeleteSantri(s) {
    if (!s) return false;
    const ok = await UI.confirmDialog({
      title: 'Hapus Data Santri',
      message: `Data santri "${s.nama_lengkap}" (${s.id_santri}) akan dihapus permanen. Lanjutkan?`,
      confirmLabel: 'Hapus Santri',
      danger: true,
    });
    if (!ok) return false;

    const prevSantri = [...STATE.santri];
    STATE.santri = STATE.santri.filter((item) => item !== s);
    if (s.id_santri) localState.selectedSantriIds.delete(s.id_santri);
    if (root.MDTA_CACHE) root.MDTA_CACHE.write('santri', STATE.santri);
    renderSantriTable();
    renderKelasManagement();
    UI.toast(`Data santri "${s.nama_lengkap}" dihapus.`, 'success');

    try {
      await API.deleteSantri(s.id_santri);
      return true;
    } catch (err) {
      STATE.santri = prevSantri;
      if (root.MDTA_CACHE) root.MDTA_CACHE.write('santri', STATE.santri);
      renderSantriTable();
      renderKelasManagement();
      UI.toast(`Gagal menghapus "${s.nama_lengkap}": ${err.message}`, 'error');
      return false;
    }
  }

  function openSantriDetailModal(s) {
    if (!s) return;
    const titleEl = document.getElementById('detail-santri-modal-title');
    const subEl = document.getElementById('detail-santri-subtitle');
    const bodyEl = document.getElementById('detail-santri-body');
    const editBtn = document.getElementById('btn-detail-santri-edit');
    const delBtn = document.getElementById('btn-detail-santri-hapus');
    if (!bodyEl) return;

    const ttlText = s.ttl && s.ttl !== '-' ? s.ttl : API.formatTTL(s.tempat_lahir, s.tanggal_lahir);
    const waUrl = API.formatWhatsAppUrl(s.no_wa_ortu, `Assalamu'alaikum Bapak/Ibu wali santri ${s.nama_lengkap}.`);
    const isAktif = String(s.status || '').toLowerCase() === 'aktif';

    if (titleEl) titleEl.textContent = s.nama_lengkap || '-';
    if (subEl) subEl.textContent = `${s.kelas || '-'} · ${s.id_santri || '-'}`;

    bodyEl.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field">
          <span class="detail-label">ID Santri</span>
          <strong class="detail-value mono-num">${UI.esc(s.id_santri || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">NIS</span>
          <strong class="detail-value mono-num">${UI.esc(s.nis || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">NIK</span>
          <strong class="detail-value mono-num">${UI.esc(s.nik || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Status</span>
          <div class="detail-value">
            <span class="status-badge ${isAktif ? 'status-hadir' : 'status-sakit'}">${isAktif ? 'Aktif' : UI.esc(s.status || '-')}</span>
          </div>
        </div>
        <div class="detail-field detail-field-full">
          <span class="detail-label">Nama Lengkap</span>
          <strong class="detail-value">${UI.esc(s.nama_lengkap || '-')}</strong>
        </div>
        <div class="detail-field detail-field-full">
          <span class="detail-label">Nama Ayah Kandung</span>
          <strong class="detail-value">${UI.esc(s.nama_ayah_kandung || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Kelas</span>
          <strong class="detail-value">${UI.esc(s.kelas || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Tempat &amp; Tanggal Lahir</span>
          <strong class="detail-value">${UI.esc(ttlText || '-')}</strong>
        </div>
        <div class="detail-field detail-field-full">
          <span class="detail-label">No. WhatsApp Orang Tua</span>
          <div class="detail-value detail-value-action">
            <strong class="mono-num">${UI.esc(s.no_wa_ortu || '-')}</strong>
            ${waUrl
        ? `<a href="${UI.esc(waUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">
                   <i data-lucide="message-circle" aria-hidden="true"></i>
                   <span>Hubungi WA</span>
                 </a>`
        : ''}
          </div>
        </div>
        <div class="detail-field detail-field-full">
          <span class="detail-label">Token QR</span>
          <div class="detail-value detail-value-action">
            <code class="mono-num detail-code-pill">${UI.esc(s.qr_token || '-')}</code>
            <button id="btn-detail-open-qr" type="button" class="btn btn-secondary btn-sm">
              <i data-lucide="qr-code" aria-hidden="true"></i>
              <span>Buka Kartu QR</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const qrBtn = document.getElementById('btn-detail-open-qr');
    if (qrBtn) {
      qrBtn.onclick = () => {
        UI.closeModal('modal-detail-santri');
        openQRModal(s);
      };
    }
    if (editBtn) {
      editBtn.onclick = () => {
        UI.closeModal('modal-detail-santri');
        openSantriModal(s);
      };
    }
    if (delBtn) {
      delBtn.onclick = async () => {
        UI.closeModal('modal-detail-santri');
        await confirmAndDeleteSantri(s);
      };
    }

    UI.openModal('modal-detail-santri');
    UI.refreshIcons(bodyEl);
  }

  function renderSantriTable() {
    const tbody = document.getElementById('admin-santri-tbody');
    const countEl = document.getElementById('santri-count-label');
    if (!tbody) return;

    const q = localState.santriQuery.trim().toLowerCase();
    const kelasF = localState.santriKelasFilter;
    const filtered = STATE.santri.filter((s) => {
      const matchKelas = !kelasF || API.isKelasAllowed(kelasF, API.parseKelasAmpu(s.kelas));
      const matchQ =
        !q ||
        s.nama_lengkap.toLowerCase().includes(q) ||
        (s.nama_ayah_kandung || '').toLowerCase().includes(q) ||
        s.id_santri.toLowerCase().includes(q) ||
        (s.nis || '').toLowerCase().includes(q) ||
        (s.nik || '').toLowerCase().includes(q) ||
        (s.tempat_lahir || '').toLowerCase().includes(q) ||
        (s.tanggal_lahir || '').toLowerCase().includes(q) ||
        (s.ttl || '').toLowerCase().includes(q) ||
        s.kelas.toLowerCase().includes(q) ||
        s.no_wa_ortu.toLowerCase().includes(q) ||
        s.qr_token.toLowerCase().includes(q);
      return matchKelas && matchQ;
    });

    if (countEl) {
      countEl.textContent = `Menampilkan ${filtered.length} dari ${STATE.santri.length} santri`;
    }

    if (filtered.length === 0) {
      updateBulkSantriBar(filtered);
      tbody.innerHTML = `
        <tr class="table-state-row">
          <td colspan="6">
            ${UI.renderStateBox({
        type: 'empty',
        title: STATE.santri.length === 0 ? 'Belum ada data santri' : 'Santri tidak ditemukan',
        message:
          STATE.santri.length === 0
            ? 'Klik "Tambah Santri" untuk mendaftarkan santri baru.'
            : 'Coba ubah kata kunci pencarian atau filter kelas.',
      })}
          </td>
        </tr>
      `;
      UI.refreshIcons(tbody);
      return;
    }

    tbody.innerHTML = filtered
      .map((s) => {
        const sid = s.id_santri || s.qr_token;
        const isChecked = s.id_santri && localState.selectedSantriIds.has(s.id_santri);
        return `
        <tr class="clickable-row" data-santri-row="${UI.esc(sid)}" tabindex="0">
          <td class="snt-check" data-label="Pilih">
            <input type="checkbox" class="santri-row-checkbox" data-select-santri="${UI.esc(s.id_santri || '')}" aria-label="Pilih ${UI.esc(s.nama_lengkap)}" ${isChecked ? 'checked' : ''} ${!s.id_santri ? 'disabled' : ''} />
          </td>
          <td class="snt-nama" data-label="Nama Lengkap">
            <div class="row-primary-with-hint">
              <strong>${UI.esc(s.nama_lengkap)}</strong>
              <i data-lucide="chevron-right" class="row-chevron-hint" aria-hidden="true"></i>
            </div>
          </td>
          <td class="snt-ayah" data-label="Nama Ayah Kandung">${UI.esc(s.nama_ayah_kandung || '-')}</td>
          <td class="snt-kelas" data-label="Kelas">${UI.esc(s.kelas || '-')}</td>
          <td class="snt-status" data-label="Status">
            <span class="status-badge ${s.status === 'aktif' ? 'status-hadir' : 'status-sakit'}">
              ${s.status === 'aktif' ? 'Aktif' : UI.esc(s.status)}
            </span>
          </td>
          <td class="snt-actions" data-label="Aksi">
            <div class="table-actions-cell">
              <button type="button" class="btn btn-secondary btn-sm" data-detail-santri="${UI.esc(sid)}" aria-label="Detail santri ${UI.esc(s.nama_lengkap)}">
                <i data-lucide="eye" aria-hidden="true"></i>
                <span>Detail</span>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-qr-santri="${UI.esc(sid)}">
                <i data-lucide="qr-code" aria-hidden="true"></i>
                <span>QR</span>
              </button>
              <button type="button" class="btn btn-secondary btn-icon-sm" data-edit-santri="${UI.esc(sid)}" aria-label="Edit santri ${UI.esc(s.nama_lengkap)}">
                <i data-lucide="pencil" aria-hidden="true"></i>
                <span class="mobile-only-btn-label">Edit</span>
              </button>
              <i data-lucide="chevron-right" class="snt-mobile-chevron" aria-hidden="true"></i>
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    updateBulkSantriBar(filtered);

    const findSantri = (key) =>
      STATE.santri.find((s) => (s.id_santri || s.qr_token) === key);

    tbody.querySelectorAll('tr[data-santri-row]').forEach((tr) => {
      const openDetail = () => {
        const s = findSantri(tr.dataset.santriRow);
        if (s) openSantriDetailModal(s);
      };
      tr.addEventListener('click', openDetail);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail();
        }
      });
    });

    tbody.querySelectorAll('input[data-select-santri]').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        const sid = cb.dataset.selectSantri;
        if (!sid) return;
        if (cb.checked) localState.selectedSantriIds.add(sid);
        else localState.selectedSantriIds.delete(sid);
        updateBulkSantriBar(filtered);
      });
    });

    tbody.querySelectorAll('button[data-detail-santri]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = findSantri(btn.dataset.detailSantri);
        if (s) openSantriDetailModal(s);
      });
    });

    tbody.querySelectorAll('button[data-qr-santri]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = findSantri(btn.dataset.qrSantri);
        if (s) openQRModal(s);
      });
    });

    tbody.querySelectorAll('button[data-edit-santri]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const s = findSantri(btn.dataset.editSantri);
        if (s) openSantriModal(s);
      });
    });

    UI.refreshIcons(tbody);
  }

  async function loadSantri(showToast, opts) {
    const force = Boolean((opts && opts.force) || showToast);
    const CACHE = root.MDTA_CACHE;
    const tbody = document.getElementById('admin-santri-tbody');
    const refreshBtn = document.getElementById('btn-refresh-santri');

    if (CACHE) CACHE.hydrateState();
    const hasCache = Array.isArray(STATE.santri) && STATE.santri.length > 0;

    if (hasCache) {
      syncClassFilterOptions();
      renderSantriTable();
    } else if (tbody) {
      tbody.innerHTML = UI.renderSkeletonRows(5, 6);
    }

    if (!force && (STATE.loaded.santri || STATE.loaded.bootstrap) && hasCache) {
      return;
    }

    if (force || !hasCache) {
      UI.setButtonLoading(refreshBtn, true, 'Memuat...');
    }

    try {
      const prevSantri = STATE.santri;
      const res = await API.getSantri();
      const freshSantri = API.extractArray(res, ['santri', 'students']).map(API.normalizeSantri);
      const changed = !CACHE || CACHE.hasChanged(prevSantri, freshSantri);
      STATE.santri = freshSantri;
      STATE.loaded.santri = true;
      if (CACHE) CACHE.write('santri', freshSantri);
      if (changed || !hasCache) {
        syncClassFilterOptions();
        renderSantriTable();
        renderKelasManagement();
      }
      if (showToast) UI.toast(`${STATE.santri.length} data santri dimuat.`, 'success');
    } catch (err) {
      if (!hasCache && tbody) {
        tbody.innerHTML = `<tr class="table-state-row"><td colspan="6">${UI.renderStateBox({
          type: 'error',
          title: 'Gagal memuat database santri',
          message: err.message,
          actionLabel: 'Coba Lagi',
          actionId: 'btn-retry-santri',
        })}</td></tr>`;
        UI.refreshIcons(tbody);
        const retryBtn = document.getElementById('btn-retry-santri');
        if (retryBtn) retryBtn.addEventListener('click', () => loadSantri(false, { force: true }));
      }
      if (force || !hasCache) UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(refreshBtn, false);
    }
  }

  function reconcileAdminBackground(opts) {
    const o = opts || {};
    if (o.syncTs !== undefined && o.syncTs !== null && o.syncTs !== '') {
      recordLocalSyncTs(o.syncTs);
    }
    const CACHE = root.MDTA_CACHE;
    if (o.refreshReports) {
      STATE.rekapKepsek = null;
      STATE.rekapKepsekKey = '';
      if (CACHE) {
        CACHE.remove('rekapKepsek');
        CACHE.remove('dashboard');
      }
      silentRefreshFromSync(o.syncTs || null, { quiet: true }).catch(() => {});
    }
  }

  async function refreshUsersOnly() {
    const CACHE = root.MDTA_CACHE;
    const btn = document.getElementById('btn-refresh-users');
    UI.setButtonLoading(btn, true, 'Memuat...');
    try {
      const res = await API.getUsers();
      const freshUsers = API.extractArray(res, ['users', 'daftar_pengguna']).map(API.normalizeUser);
      STATE.users = freshUsers;
      if (CACHE) CACHE.write('users', freshUsers);
      renderUsersTable();
      renderKelasManagement();
      UI.toast(`${freshUsers.length} akun pengguna diperbarui.`, 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(btn, false);
    }
  }

  async function refreshKelasOnly() {
    const CACHE = root.MDTA_CACHE;
    const btn = document.getElementById('btn-refresh-kelas');
    UI.setButtonLoading(btn, true, 'Memuat...');
    try {
      const [kRes, uRes] = await Promise.allSettled([API.getKelas(), API.getUsers()]);
      if (kRes.status === 'fulfilled' && kRes.value) {
        STATE.kelas = API.extractArray(kRes.value, ['kelas']).map(API.normalizeKelas);
        STATE.loaded.kelas = true;
        if (CACHE) CACHE.write('kelas', STATE.kelas);
      } else if (kRes.status === 'rejected') {
        throw kRes.reason;
      }
      if (uRes.status === 'fulfilled' && uRes.value) {
        STATE.users = API.extractArray(uRes.value, ['users', 'daftar_pengguna']).map(API.normalizeUser);
        if (CACHE) CACHE.write('users', STATE.users);
      }
      syncClassFilterOptions();
      renderKelasManagement();
      renderUsersTable();
      UI.toast('Daftar kelas dan pemetaan guru diperbarui.', 'success');
    } catch (err) {
      UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(btn, false);
    }
  }

  function closeSantriModal() {
    localState.editingSantriId = null;
    const form = document.getElementById('form-santri');
    if (form) form.reset();
    const idEl = document.getElementById('santri-id');
    if (idEl) idEl.value = '';
    UI.closeModal('modal-santri');
  }

  function openSantriModal(santri) {
    const form = document.getElementById('form-santri');
    if (form) form.reset();

    syncClassFilterOptions();
    const title = document.getElementById('santri-modal-title');
    const kelasSel = document.getElementById('santri-kelas');
    localState.editingSantriId = santri ? (santri.id_santri || '') : null;

    document.getElementById('santri-id').value = santri ? (santri.id_santri || '') : '';
    document.getElementById('santri-nama').value = santri ? (santri.nama_lengkap || '') : '';
    const ayahEl = document.getElementById('santri-nama-ayah');
    const nisEl = document.getElementById('santri-nis');
    const nikEl = document.getElementById('santri-nik');
    const tmpEl = document.getElementById('santri-tempat-lahir');
    const tglEl = document.getElementById('santri-tanggal-lahir');
    if (ayahEl) ayahEl.value = santri ? (santri.nama_ayah_kandung || '') : '';
    if (nisEl) nisEl.value = santri ? (santri.nis || '') : '';
    if (nikEl) nikEl.value = santri ? (santri.nik || '') : '';
    if (tmpEl) tmpEl.value = santri ? (santri.tempat_lahir || '') : '';
    if (tglEl) tglEl.value = santri ? API.normalizeISODate(santri.tanggal_lahir || '') : '';
    document.getElementById('santri-hp').value = santri ? (santri.no_wa_ortu || '') : '';
    document.getElementById('santri-qr-token').value =
      santri && santri.qr_token ? santri.qr_token : '';
    document.getElementById('santri-status').value = santri ? (santri.status || 'aktif') : 'aktif';

    if (kelasSel) {
      const desiredClass = santri ? (santri.kelas || '') : (localState.santriKelasFilter || '');
      if (desiredClass) {
        const hasOpt = Array.from(kelasSel.options).some((opt) => opt.value === desiredClass);
        if (!hasOpt) {
          const extraOpt = document.createElement('option');
          extraOpt.value = desiredClass;
          extraOpt.textContent = `${desiredClass} (Data Lama)`;
          kelasSel.appendChild(extraOpt);
        }
        kelasSel.value = desiredClass;
      } else if (kelasSel.options.length > 0) {
        kelasSel.selectedIndex = 0;
      }
    }

    if (title) title.textContent = santri ? `Edit Santri (${santri.id_santri})` : 'Tambah Santri Baru';
    UI.openModal('modal-santri');
  }

  function closeMoveKelasModal() {
    localState.movingSantriId = '';
    const form = document.getElementById('form-move-kelas');
    if (form) form.reset();
    UI.closeModal('modal-move-kelas');
  }

  function openMoveKelasModal(santri) {
    syncClassFilterOptions();
    localState.movingSantriId = santri.id_santri || '';
    const idEl = document.getElementById('move-santri-id');
    const labelEl = document.getElementById('move-santri-label');
    const targetSel = document.getElementById('move-target-kelas');
    if (idEl) idEl.value = localState.movingSantriId;
    if (labelEl) labelEl.textContent = `${santri.nama_lengkap} (${santri.kelas || 'Tanpa Kelas'})`;
    if (targetSel && targetSel.options.length > 0) {
      const other = Array.from(targetSel.options).find((o) => o.value !== santri.kelas);
      if (other) targetSel.value = other.value;
    }
    UI.openModal('modal-move-kelas');
  }

  async function executeMoveSantriKelas(ids, targetKelas) {
    if (!Array.isArray(ids) || ids.length === 0) {
      UI.toast('Pilih minimal satu santri untuk dipindahkan.', 'warn');
      return false;
    }
    if (!targetKelas) {
      UI.toast('Pilih kelas tujuan pemindahan terlebih dahulu.', 'error');
      return false;
    }

    try {
      await API.bulkMoveSantriKelas({ ids, target_kelas: targetKelas });
    } catch (err) {
      if (!/tidak dikenali/i.test(String(err.message || ''))) {
        throw err;
      }
      // Fallback bila Code.gs belum diperbarui
      for (let i = 0; i < ids.length; i++) {
        const s = (STATE.santri || []).find((item) => item.id_santri === ids[i]);
        if (!s) continue;
        await API.saveSantri({
          isEdit: true,
          id_santri: s.id_santri,
          nama_lengkap: s.nama_lengkap,
          nama_ayah_kandung: s.nama_ayah_kandung || '',
          nis: s.nis || '',
          nik: s.nik || '',
          tempat_lahir: s.tempat_lahir || '',
          tanggal_lahir: s.tanggal_lahir || '',
          kelas: targetKelas,
          no_wa_ortu: s.no_wa_ortu,
          qr_token: s.qr_token,
          status: s.status,
        });
      }
    }

    const idSet = new Set(ids);
    STATE.santri = (STATE.santri || []).map((s) =>
      idSet.has(s.id_santri) ? Object.assign({}, s, { kelas: targetKelas }) : s
    );
    if (root.MDTA_CACHE) root.MDTA_CACHE.write('santri', STATE.santri);
    localState.selectedSantriIds.clear();
    STATE.loaded.bootstrap = false;
    syncClassFilterOptions();
    renderSantriTable();
    renderKelasManagement();
    return true;
  }

  let qrTemplatePromise = null;

  function loadQRTemplateImage() {
    if (qrTemplatePromise) return qrTemplatePromise;
    qrTemplatePromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = 'assets/kartu-santri-template.jpg?v=20261122-2';
    });
    return qrTemplatePromise;
  }

  function isLightBoxPixel(data, idx) {
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    return r > 215 && g > 215 && b > 215 && Math.abs(r - g) < 22 && Math.abs(g - b) < 22;
  }

  function detectContentBox(ctx, w, h) {
    const fallback = {
      minX: w * 0.0586,
      maxX: w,
      minY: h * 0.2422,
      maxY: h * 0.9473,
    };

    try {
      const seedX = Math.floor(w * 0.53);
      const seedY = Math.floor(h * 0.58);
      const rowData = ctx.getImageData(0, seedY, w, 1).data;
      if (!isLightBoxPixel(rowData, seedX * 4)) {
        return fallback;
      }

      let minX = seedX;
      while (minX > 0 && isLightBoxPixel(rowData, (minX - 1) * 4)) {
        minX -= 1;
      }
      let maxX = seedX;
      while (maxX < w - 1 && isLightBoxPixel(rowData, (maxX + 1) * 4)) {
        maxX += 1;
      }

      const midX = Math.floor((minX + maxX) / 2);
      const colData = ctx.getImageData(midX, 0, 1, h).data;
      let minY = seedY;
      while (minY > 0 && isLightBoxPixel(colData, (minY - 1) * 4)) {
        minY -= 1;
      }
      let maxY = seedY;
      while (maxY < h - 1 && isLightBoxPixel(colData, (maxY + 1) * 4)) {
        maxY += 1;
      }

      if ((maxX - minX) > w * 0.5 && (maxY - minY) > h * 0.5) {
        return { minX, maxX: maxX + 1, minY, maxY: maxY + 1 };
      }
    } catch (_) {
      // Fallback if canvas pixel read is unavailable
    }

    return fallback;
  }

  function makeQRTransparentCanvas(qrSource, size) {
    const pxSize = Math.max(1, Math.round(size));
    const srcW = Math.max(1, Math.round(qrSource.width || qrSource.naturalWidth || pxSize));
    const srcH = Math.max(1, Math.round(qrSource.height || qrSource.naturalHeight || pxSize));

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const sCtx = srcCanvas.getContext('2d');
    if (!sCtx) return qrSource;

    sCtx.imageSmoothingEnabled = false;
    sCtx.drawImage(qrSource, 0, 0, srcW, srcH);

    let qrMinX = srcW;
    let qrMaxX = -1;
    let qrMinY = srcH;
    let qrMaxY = -1;

    try {
      const frame = sCtx.getImageData(0, 0, srcW, srcH);
      const pixels = frame.data;
      for (let y = 0; y < srcH; y += 1) {
        const rowOffset = y * srcW * 4;
        for (let x = 0; x < srcW; x += 1) {
          const i = rowOffset + (x * 4);
          if (pixels[i] > 200 && pixels[i + 1] > 200 && pixels[i + 2] > 200) {
            pixels[i + 3] = 0;
          } else if (pixels[i + 3] > 0) {
            if (x < qrMinX) qrMinX = x;
            if (x > qrMaxX) qrMaxX = x;
            if (y < qrMinY) qrMinY = y;
            if (y > qrMaxY) qrMaxY = y;
          }
        }
      }
      sCtx.putImageData(frame, 0, 0);
    } catch (_) {
      // Ignore if tainted
    }

    const cropX = qrMaxX >= qrMinX ? qrMinX : 0;
    const cropY = qrMaxY >= qrMinY ? qrMinY : 0;
    const cropW = qrMaxX >= qrMinX ? (qrMaxX - qrMinX + 1) : srcW;
    const cropH = qrMaxY >= qrMinY ? (qrMaxY - qrMinY + 1) : srcH;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = pxSize;
    outCanvas.height = pxSize;
    const oCtx = outCanvas.getContext('2d');
    if (!oCtx) return srcCanvas;

    oCtx.imageSmoothingEnabled = false;
    oCtx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, pxSize, pxSize);
    return outCanvas;
  }

  function renderQRCardCanvas(data) {
    const previewCanvas = document.getElementById('qr-card-preview-canvas');
    const qrBox = document.getElementById('qr-render-target');
    const loadingEl = document.getElementById('qr-card-loading');
    if (!previewCanvas || !qrBox || !data) return;

    if (loadingEl) loadingEl.hidden = false;

    loadQRTemplateImage().then((tplImg) => {
      if (!localState.currentQRData || localState.currentQRData.token !== data.token) return;
      if (loadingEl) loadingEl.hidden = true;

      if (tplImg && tplImg.naturalWidth > 0 && tplImg.naturalHeight > 0) {
        const minWidth = 1000;
        const scale = tplImg.naturalWidth < minWidth ? (minWidth / tplImg.naturalWidth) : 1;
        previewCanvas.width = Math.round(tplImg.naturalWidth * scale);
        previewCanvas.height = Math.round(tplImg.naturalHeight * scale);
      } else {
        previewCanvas.width = 1000;
        previewCanvas.height = 1250;
      }

      const ctx = previewCanvas.getContext('2d');
      if (!ctx) return;

      if (tplImg && tplImg.naturalWidth > 0) {
        ctx.drawImage(tplImg, 0, 0, previewCanvas.width, previewCanvas.height);
      } else {
        ctx.fillStyle = '#2d6a4f';
        ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
        ctx.fillStyle = '#f2f3f2';
        ctx.fillRect(
          previewCanvas.width * 0.0586,
          previewCanvas.height * 0.2422,
          previewCanvas.width - (previewCanvas.width * 0.0586),
          previewCanvas.height * 0.7051
        );
      }

      const bounds = detectContentBox(ctx, previewCanvas.width, previewCanvas.height);
      const boxW = bounds.maxX - bounds.minX;
      const boxH = bounds.maxY - bounds.minY;
      const centerX = bounds.minX + (boxW / 2);
      const centerY = bounds.minY + (boxH / 2);

      const qrSize = Math.round(boxW * 0.44);
      const gapQRtoName = Math.round(boxH * 0.055);
      const gapNameToClass = Math.round(boxH * 0.020);
      const gapClassToToken = Math.round(boxH * 0.018);
      const maxTextWidth = boxW * 0.86;

      const namaText = String(data.nama || '-').trim();
      let nameFontSize = Math.round(boxW * 0.060);
      ctx.font = `800 ${nameFontSize}px Montserrat, sans-serif`;
      while (nameFontSize > 16 && ctx.measureText(namaText).width > maxTextWidth) {
        nameFontSize -= 2;
        ctx.font = `800 ${nameFontSize}px Montserrat, sans-serif`;
      }

      const metaText = `${data.kelas || '-'}  ·  ID: ${data.id_santri || '-'}`;
      let classFontSize = Math.round(boxW * 0.036);
      ctx.font = `600 ${classFontSize}px Montserrat, sans-serif`;
      while (classFontSize > 12 && ctx.measureText(metaText).width > maxTextWidth) {
        classFontSize -= 1;
        ctx.font = `600 ${classFontSize}px Montserrat, sans-serif`;
      }

      const tokenText = String(data.token || '-');
      let tokenFontSize = Math.round(boxW * 0.025);
      ctx.font = `500 ${tokenFontSize}px Montserrat, sans-serif`;
      while (tokenFontSize > 11 && ctx.measureText(tokenText).width > maxTextWidth) {
        tokenFontSize -= 1;
        ctx.font = `500 ${tokenFontSize}px Montserrat, sans-serif`;
      }

      const totalHeight = qrSize + gapQRtoName + nameFontSize + gapNameToClass + classFontSize + gapClassToToken + tokenFontSize;
      const startY = Math.round(centerY - (totalHeight / 2));
      const qrX = Math.round(centerX - (qrSize / 2));
      const qrY = startY;

      const drawTextOverlay = () => {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const nameY = startY + qrSize + gapQRtoName;
        ctx.font = `800 ${nameFontSize}px Montserrat, sans-serif`;
        ctx.fillStyle = '#0F172A';
        ctx.fillText(namaText, centerX, nameY);

        const classY = nameY + nameFontSize + gapNameToClass;
        ctx.font = `600 ${classFontSize}px Montserrat, sans-serif`;
        ctx.fillStyle = '#166534';
        ctx.fillText(metaText, centerX, classY);

        const tokenY = classY + classFontSize + gapClassToToken;
        ctx.font = `500 ${tokenFontSize}px Montserrat, sans-serif`;
        ctx.fillStyle = '#64748B';
        ctx.fillText(tokenText, centerX, tokenY);
      };

      const qrCanvas = qrBox.querySelector('canvas');
      const qrImg = qrBox.querySelector('img');
      if (qrCanvas) {
        const transparentQr = makeQRTransparentCanvas(qrCanvas, qrSize);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(transparentQr, qrX, qrY, qrSize, qrSize);
        ctx.imageSmoothingEnabled = true;
        drawTextOverlay();
      } else if (qrImg) {
        const paintImg = () => {
          const transparentQr = makeQRTransparentCanvas(qrImg, qrSize);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(transparentQr, qrX, qrY, qrSize, qrSize);
          ctx.imageSmoothingEnabled = true;
          drawTextOverlay();
        };
        if (qrImg.complete) {
          paintImg();
        } else {
          qrImg.onload = paintImg;
        }
      } else {
        drawTextOverlay();
      }
    });
  }

  function openQRModal(santri) {
    const token = santri.qr_token || santri.id_santri || santri.nama_lengkap;
    localState.currentQRData = {
      id_santri: santri.id_santri || '-',
      nama: santri.nama_lengkap,
      kelas: santri.kelas || '-',
      token,
    };

    const qrBox = document.getElementById('qr-render-target');
    qrBox.innerHTML = '';

    if (typeof root.QRCode === 'function') {
      new root.QRCode(qrBox, {
        text: token,
        width: 520,
        height: 520,
        colorDark: '#09090b',
        colorLight: 'rgba(0,0,0,0)',
        correctLevel: root.QRCode.CorrectLevel.H,
      });
    } else {
      UI.toast('Library qrcode.js belum termuat.', 'warn');
    }

    UI.openModal('modal-qr');
    renderQRCardCanvas(localState.currentQRData);
  }

  function downloadQRCardPNG() {
    const data = localState.currentQRData;
    const previewCanvas = document.getElementById('qr-card-preview-canvas');
    if (!data || !previewCanvas || previewCanvas.width === 0) {
      UI.toast('Kartu QR belum siap untuk diunduh.', 'warn');
      return;
    }

    const link = document.createElement('a');
    const safeName = data.nama.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.download = `Kartu-QR-${safeName || 'santri'}.png`;
    link.href = previewCanvas.toDataURL('image/png');
    link.click();
    UI.toast(`Kartu QR "${data.nama}" berhasil diunduh.`, 'success');
  }

  function bindSantriEvents() {
    const searchInput = document.getElementById('santri-search-input');
    const kelasSelect = document.getElementById('santri-kelas-filter');
    const selectAllEl = document.getElementById('santri-select-all');
    const bulkClearBtn = document.getElementById('btn-bulk-clear-select');
    const bulkMoveBtn = document.getElementById('btn-bulk-move-kelas');
    const bulkTargetSel = document.getElementById('santri-bulk-target-kelas');
    const refreshBtn = document.getElementById('btn-refresh-santri');
    const addBtn = document.getElementById('btn-add-santri');
    const closeSantriBtn = document.getElementById('btn-close-santri-modal');
    const cancelSantriBtn = document.getElementById('btn-cancel-santri-modal');
    const genTokenBtn = document.getElementById('btn-regen-qr-token');
    const santriForm = document.getElementById('form-santri');
    const saveSantriBtn = document.getElementById('btn-save-santri');

    const closeMoveBtn = document.getElementById('btn-close-move-kelas-modal');
    const cancelMoveBtn = document.getElementById('btn-cancel-move-kelas-modal');
    const moveForm = document.getElementById('form-move-kelas');
    const saveMoveBtn = document.getElementById('btn-save-move-kelas');

    const closeQrBtn = document.getElementById('btn-close-qr-modal');
    const downloadQrBtn = document.getElementById('btn-download-qr-png');
    const printQrBtn = document.getElementById('btn-print-qr-card');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        localState.santriQuery = e.target.value || '';
        renderSantriTable();
      });
    }
    if (kelasSelect) {
      kelasSelect.addEventListener('change', (e) => {
        localState.santriKelasFilter = e.target.value || '';
        renderSantriTable();
      });
    }
    if (selectAllEl) {
      selectAllEl.addEventListener('change', () => {
        const q = localState.santriQuery.trim().toLowerCase();
        const kelasF = localState.santriKelasFilter;
        const visible = STATE.santri.filter((s) => {
          const matchKelas = !kelasF || API.isKelasAllowed(kelasF, API.parseKelasAmpu(s.kelas));
          const matchQ =
            !q ||
            s.nama_lengkap.toLowerCase().includes(q) ||
            (s.nama_ayah_kandung || '').toLowerCase().includes(q) ||
            s.id_santri.toLowerCase().includes(q) ||
            (s.nis || '').toLowerCase().includes(q) ||
            (s.nik || '').toLowerCase().includes(q) ||
            (s.tempat_lahir || '').toLowerCase().includes(q) ||
            (s.tanggal_lahir || '').toLowerCase().includes(q) ||
            (s.ttl || '').toLowerCase().includes(q) ||
            s.kelas.toLowerCase().includes(q) ||
            s.no_wa_ortu.toLowerCase().includes(q) ||
            s.qr_token.toLowerCase().includes(q);
          return matchKelas && matchQ;
        });
        visible.forEach((s) => {
          if (!s.id_santri) return;
          if (selectAllEl.checked) localState.selectedSantriIds.add(s.id_santri);
          else localState.selectedSantriIds.delete(s.id_santri);
        });
        renderSantriTable();
      });
    }
    if (bulkClearBtn) {
      bulkClearBtn.addEventListener('click', () => {
        localState.selectedSantriIds.clear();
        renderSantriTable();
      });
    }
    if (bulkMoveBtn) {
      bulkMoveBtn.addEventListener('click', async () => {
        const ids = Array.from(localState.selectedSantriIds);
        const targetKelas = bulkTargetSel ? bulkTargetSel.value : '';
        if (ids.length === 0 || !targetKelas) {
          UI.toast('Pilih santri dan kelas tujuan pemindahan terlebih dahulu.', 'warn');
          return;
        }
        UI.setButtonLoading(bulkMoveBtn, true, 'Memindahkan...');
        try {
          const ok = await executeMoveSantriKelas(ids, targetKelas);
          if (ok) UI.toast(`${ids.length} santri berhasil dipindahkan ke ${targetKelas}.`, 'success');
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(bulkMoveBtn, false);
        }
      });
    }

    if (closeMoveBtn) closeMoveBtn.addEventListener('click', closeMoveKelasModal);
    if (cancelMoveBtn) cancelMoveBtn.addEventListener('click', closeMoveKelasModal);
    if (moveForm) {
      moveForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sid = localState.movingSantriId || document.getElementById('move-santri-id')?.value;
        const targetKelas = document.getElementById('move-target-kelas')?.value || '';
        if (!sid || !targetKelas) {
          UI.toast('Pilih kelas tujuan terlebih dahulu.', 'error');
          return;
        }
        UI.setButtonLoading(saveMoveBtn, true, 'Memindahkan...');
        try {
          const ok = await executeMoveSantriKelas([sid], targetKelas);
          if (ok) {
            closeMoveKelasModal();
            UI.toast(`Santri berhasil dipindahkan ke ${targetKelas}.`, 'success');
          }
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveMoveBtn, false);
        }
      });
    }

    if (refreshBtn) refreshBtn.addEventListener('click', () => loadSantri(true, { force: true }));
    if (addBtn) addBtn.addEventListener('click', () => openSantriModal(null));
    if (closeSantriBtn) closeSantriBtn.addEventListener('click', closeSantriModal);
    if (cancelSantriBtn) cancelSantriBtn.addEventListener('click', closeSantriModal);
    if (genTokenBtn) {
      genTokenBtn.addEventListener('click', () => {
        const idHint = localState.editingSantriId || document.getElementById('santri-id').value.trim();
        document.getElementById('santri-qr-token').value = generateQRToken(idHint);
      });
    }

    if (santriForm) {
      santriForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const isEdit = Boolean(localState.editingSantriId);
        const idSantri = isEdit ? localState.editingSantriId : generateNextLocalId(STATE.santri || [], 'id_santri', 'S-', 3);
        const namaLengkap = document.getElementById('santri-nama').value.trim();
        const namaAyahKandung = (document.getElementById('santri-nama-ayah')?.value || '').trim();
        const nis = (document.getElementById('santri-nis')?.value || '').trim();
        const nik = (document.getElementById('santri-nik')?.value || '').replace(/\s+/g, '').trim();
        const tempatLahir = (document.getElementById('santri-tempat-lahir')?.value || '').trim();
        const tanggalLahir = (document.getElementById('santri-tanggal-lahir')?.value || '').trim();
        const kelas = document.getElementById('santri-kelas').value.trim();
        const noWaOrtu = document.getElementById('santri-hp').value.trim();
        const qrToken = document.getElementById('santri-qr-token').value.trim();
        const status = document.getElementById('santri-status').value || 'aktif';

        if (!namaLengkap) {
          UI.toast('Nama lengkap santri wajib diisi.', 'error');
          return;
        }
        if (nik && !/^\d+$/.test(nik)) {
          UI.toast('NIK harus berupa angka tanpa huruf atau simbol.', 'error');
          return;
        }
        if (!kelas) {
          UI.toast('Pilih kelas resmi santri terlebih dahulu.', 'error');
          return;
        }

        const payload = {
          isEdit,
          id_santri: idSantri,
          nama_lengkap: namaLengkap,
          nama_ayah_kandung: namaAyahKandung,
          nis,
          nik,
          tempat_lahir: tempatLahir,
          tanggal_lahir: tanggalLahir,
          kelas,
          no_wa_ortu: noWaOrtu,
          qr_token: qrToken,
          status,
        };

        UI.setButtonLoading(saveSantriBtn, true, 'Menyimpan...');
        try {
          const res = await API.saveSantri(payload);
          const d = (res && res.data) || res || {};
          const savedSantri = API.normalizeSantri(
            Object.assign({}, payload, d, {
              id_santri: d.id_santri || payload.id_santri,
              qr_token: d.qr_token || payload.qr_token,
            })
          );
          const idxS = (STATE.santri || []).findIndex(
            (s) => savedSantri.id_santri && s.id_santri === savedSantri.id_santri
          );
          if (idxS >= 0) STATE.santri[idxS] = savedSantri;
          else STATE.santri.unshift(savedSantri);
          STATE.loaded.santri = true;
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('santri', STATE.santri);
          closeSantriModal();
          syncClassFilterOptions();
          renderSantriTable();
          renderKelasManagement();
          UI.toast(`Data santri "${namaLengkap}" berhasil disimpan.`, 'success');
          reconcileAdminBackground({ refreshReports: true, syncTs: d.sync_ts });
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(saveSantriBtn, false);
        }
      });
    }

    if (closeQrBtn) closeQrBtn.addEventListener('click', () => UI.closeModal('modal-qr'));
    if (downloadQrBtn) downloadQrBtn.addEventListener('click', downloadQRCardPNG);
    if (printQrBtn) {
      printQrBtn.addEventListener('click', () => {
        document.body.classList.add('printing-qr-card');
        window.print();
        setTimeout(() => document.body.classList.remove('printing-qr-card'), 300);
      });
    }
  }

  // =========================================================================
  // TAB 3: REKAP LAPORAN BULANAN (FILTER-FIRST + PENCARIAN + CETAK PER HALAMAN)
  // =========================================================================
  function getFilteredRekapRows(onlyKelas) {
    const kelasF = onlyKelas !== undefined ? onlyKelas : document.getElementById('rekap-kelas-filter')?.value || '';
    const progF = localState.rekapProgramFilter || '';
    const q = (localState.rekapSearchQuery || '').trim().toLowerCase();
    return (Array.isArray(STATE.rekap) ? STATE.rekap : []).filter((r) => {
      const matchKelas = !kelasF ? true : String(r.kelas || '').trim().toLowerCase() === kelasF.trim().toLowerCase();
      if (!matchKelas) return false;
      const rProg = r.kategori_program || resolveClassKategori(r.kelas);
      if (progF && rProg !== progF) return false;
      if (!q) return true;
      return (
        String(r.nama_lengkap || '').toLowerCase().includes(q) ||
        String(r.id_santri || '').toLowerCase().includes(q) ||
        String(r.kelas || '').toLowerCase().includes(q)
      );
    });
  }

  function groupRekapByClass(rows) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const k = String(r.kelas || 'Tanpa Kelas').trim() || 'Tanpa Kelas';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    });

    const officialOrder = getOfficialClassNames(false);
    const orderedKeys = Array.from(groups.keys()).sort((a, b) => {
      const idxA = officialOrder.indexOf(a);
      const idxB = officialOrder.indexOf(b);
      if (idxA >= 0 && idxB >= 0) return idxA - idxB;
      if (idxA >= 0) return -1;
      if (idxB >= 0) return 1;
      return a.localeCompare(b);
    });

    return orderedKeys.map((k) => {
      const classRows = groups.get(k) || [];
      const gurus = getGurusForClass(k);
      const guruNames =
        gurus.length > 0 ? gurus.map((g) => g.nama_lengkap || g.username).join(', ') : 'Belum dipetakan';
      const totalHadir = classRows.reduce((s, r) => s + Number(r.hadir || 0), 0);
      const totalSakit = classRows.reduce((s, r) => s + Number(r.sakit || 0), 0);
      const totalIzin = classRows.reduce((s, r) => s + Number(r.izin || 0), 0);
      const totalAlpa = classRows.reduce((s, r) => s + Number(r.alpa || 0), 0);
      const totalAll = totalHadir + totalSakit + totalIzin + totalAlpa;
      const avgPct = totalAll > 0 ? Math.round((totalHadir / totalAll) * 100) : 0;

      return {
        kelas: k,
        guru_pengampu: gurus,
        guru_pengampu_names: guruNames,
        rows: classRows,
        totalHadir,
        totalSakit,
        totalIzin,
        totalAlpa,
        avgPct,
      };
    });
  }

  function renderRekapSubtabs() {
    const bar = document.getElementById('rekap-kelas-subtabs');
    const kelasSelect = document.getElementById('rekap-kelas-filter');
    if (!bar) return;

    const activeKelas = kelasSelect ? kelasSelect.value : '';
    const searchedRows = getFilteredRekapRows('');
    const allGroups = groupRekapByClass(searchedRows);
    const nameSet = new Set(getOfficialClassNames(false));
    allGroups.forEach((g) => nameSet.add(g.kelas));
    const names = Array.from(nameSet).sort(compareClassOrder);

    const buttons = [
      `<button type="button" class="kelas-subtab" data-rekap-subtab="" aria-pressed="${!activeKelas ? 'true' : 'false'}">Semua Kelas (${searchedRows.length} santri)</button>`,
    ];
    names.forEach((k) => {
      const grp = allGroups.find((g) => g.kelas.toLowerCase() === k.toLowerCase());
      const cnt = grp ? grp.rows.length : 0;
      const pressed = activeKelas && activeKelas.toLowerCase() === k.toLowerCase();
      buttons.push(
        `<button type="button" class="kelas-subtab" data-rekap-subtab="${UI.esc(k)}" aria-pressed="${pressed ? 'true' : 'false'}">${UI.esc(k)} (${cnt})</button>`
      );
    });

    bar.innerHTML = buttons.join('');
    bar.querySelectorAll('button[data-rekap-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (kelasSelect) {
          kelasSelect.value = btn.dataset.rekapSubtab || '';
          renderRekapTable();
        }
      });
    });
  }

  function buildSantriGradeHistoryHtml(idSantri, namaSantri) {
    const idKey = String(idSantri || '').trim().toLowerCase();
    const nameKey = String(namaSantri || '').trim().toLowerCase();
    const matchRow = (item) => {
      const rId = String(item.id_santri || '').trim().toLowerCase();
      const rName = String(item.nama_santri || '').trim().toLowerCase();
      return (idKey && rId && rId === idKey) || (nameKey && rName && rName === nameKey);
    };

    const uasList = (Array.isArray(STATE.nilaiUAS) ? STATE.nilaiUAS : []).filter(matchRow);
    const raportList = (Array.isArray(STATE.nilaiRaportSaved) ? STATE.nilaiRaportSaved : []).filter(matchRow);
    if (uasList.length === 0 && raportList.length === 0) {
      return `
        <div class="detail-section">
          <h4 class="detail-section-title">Riwayat Nilai Santri</h4>
          <p class="text-muted" style="font-size:0.84rem;margin:0;">Belum ada riwayat nilai UAS atau Raport yang tercatat untuk santri ini.</p>
        </div>
      `;
    }

    const uasItems = uasList.slice(0, 5).map((u) => {
      const skor = Number(u.skor_uas ?? u.nilai_uas ?? u.nilai ?? 0);
      return `
        <div class="detail-history-item">
          <div>
            <strong>Nilai UAS${u.semester ? ` · ${UI.esc(u.semester)}` : ''}</strong>
            <div class="text-muted" style="font-size:0.78rem;">${UI.esc(u.tahun_ajaran || u.periode || '-')}</div>
          </div>
          <span class="status-badge status-izin mono-num">${Number.isFinite(skor) ? skor.toFixed(1) : '-'}</span>
        </div>
      `;
    }).join('');

    const raportItems = raportList.slice(0, 5).map((rp) => {
      const akhir = Number(rp.n_akhir ?? rp.nilai_akhir ?? 0);
      const predLabel = rp.grade
        ? `${rp.grade} (${rp.keterangan || API.computeRaportGrade(akhir).keterangan})`
        : (rp.predikat || '-');
      return `
        <div class="detail-history-item">
          <div>
            <strong>Nilai Raport${rp.semester ? ` · ${UI.esc(rp.semester)}` : ''}</strong>
            <div class="text-muted" style="font-size:0.78rem;">${UI.esc(rp.tahun_ajaran || rp.periode || '-')} · ${UI.esc(predLabel)}</div>
          </div>
          <span class="status-badge status-hadir mono-num">${Number.isFinite(akhir) ? akhir.toFixed(2) : '-'}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="detail-section">
        <h4 class="detail-section-title">Riwayat Nilai Santri</h4>
        <div class="detail-history-list">${raportItems}${uasItems}</div>
      </div>
    `;
  }

  function openRekapDetailModal(row, bulanNama, tahun) {
    if (!row) return;
    const eyebrowEl = document.getElementById('detail-rekap-eyebrow');
    const titleEl = document.getElementById('detail-rekap-modal-title');
    const subEl = document.getElementById('detail-rekap-subtitle');
    const bodyEl = document.getElementById('detail-rekap-body');
    if (!bodyEl) return;

    if (eyebrowEl) eyebrowEl.textContent = `Rekap Bulanan · ${bulanNama} ${tahun}`;
    if (titleEl) titleEl.textContent = row.nama_lengkap || '-';
    if (subEl) subEl.textContent = `${row.kelas || '-'} · ID: ${row.id_santri || '-'}`;

    const pct = Number(row.persentase || 0);
    const pctClass = pct >= 80 ? 'status-hadir' : pct >= 60 ? 'status-sakit' : 'status-alpa';
    const nilaiHtml = buildSantriGradeHistoryHtml(row.id_santri, row.nama_lengkap);

    bodyEl.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field">
          <span class="detail-label">Nama Santri</span>
          <strong class="detail-value">${UI.esc(row.nama_lengkap || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Kelas</span>
          <strong class="detail-value">${UI.esc(row.kelas || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">ID Santri</span>
          <strong class="detail-value mono-num">${UI.esc(row.id_santri || '-')}</strong>
        </div>
        <div class="detail-field">
          <span class="detail-label">Persentase Kehadiran</span>
          <div class="detail-value"><span class="status-badge mono-num ${pctClass}">${pct}%</span></div>
        </div>
      </div>
      <div class="detail-kpi-grid">
        <div class="nilai-kpi-box">
          <div class="nilai-kpi-val" style="color:var(--status-hadir-fg);">${Number(row.hadir || 0)}</div>
          <div class="nilai-kpi-lbl">Hadir</div>
        </div>
        <div class="nilai-kpi-box">
          <div class="nilai-kpi-val" style="color:var(--status-sakit-fg);">${Number(row.sakit || 0)}</div>
          <div class="nilai-kpi-lbl">Sakit</div>
        </div>
        <div class="nilai-kpi-box">
          <div class="nilai-kpi-val" style="color:var(--status-izin-fg);">${Number(row.izin || 0)}</div>
          <div class="nilai-kpi-lbl">Izin</div>
        </div>
        <div class="nilai-kpi-box">
          <div class="nilai-kpi-val" style="color:var(--status-alpa-fg);">${Number(row.alpa || 0)}</div>
          <div class="nilai-kpi-lbl">Alpa</div>
        </div>
      </div>
      ${nilaiHtml}
    `;

    UI.openModal('modal-detail-rekap');
    UI.refreshIcons(bodyEl);
  }

  function renderRekapTable() {
    const container = document.getElementById('admin-rekap-grouped-container');
    const periodEl = document.getElementById('rekap-period-label');
    const subtabsBar = document.getElementById('rekap-kelas-subtabs');
    const actionsWrap = document.getElementById('rekap-toolbar-actions');
    const resetBtn = document.getElementById('btn-reset-rekap');
    if (!container) return;

    if (!localState.rekapHasSearched) {
      if (subtabsBar) {
        subtabsBar.hidden = true;
        subtabsBar.innerHTML = '';
      }
      if (actionsWrap) actionsWrap.hidden = true;
      if (resetBtn) resetBtn.hidden = true;
      if (periodEl) {
        periodEl.textContent = 'Gunakan pencarian atau filter di bawah untuk menampilkan rekap presensi bulanan.';
      }
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: 'Belum ada pencarian atau filter diterapkan',
        message: 'Pilih bulan, tahun, kelas, atau ketik nama santri, lalu klik "Tampilkan Rekap".',
      });
      UI.refreshIcons(container);
      return;
    }

    if (resetBtn) resetBtn.hidden = false;

    const bulan = Number(document.getElementById('rekap-bulan').value) || 1;
    const tahun = Number(document.getElementById('rekap-tahun').value) || new Date().getFullYear();
    const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);
    const rows = getFilteredRekapRows();
    const grouped = groupRekapByClass(rows);

    if (actionsWrap) actionsWrap.hidden = rows.length === 0;
    if (subtabsBar) {
      subtabsBar.hidden = STATE.rekap.length === 0;
      if (!subtabsBar.hidden) renderRekapSubtabs();
      else subtabsBar.innerHTML = '';
    }

    if (periodEl) {
      const docTitle = getProgramDocumentTitle(localState.rekapProgramFilter);
      periodEl.textContent = `${docTitle} · Periode: ${bulanNama} ${tahun} (${rows.length} santri dalam ${grouped.length} kelas)`;
    }

    if (rows.length === 0) {
      const hasQueryOrKelas = Boolean((localState.rekapSearchQuery || '').trim() || document.getElementById('rekap-kelas-filter')?.value);
      container.innerHTML = UI.renderStateBox({
        type: 'empty',
        title: hasQueryOrKelas ? 'Data santri tidak ditemukan pada filter ini' : 'Belum ada data rekap pada periode ini',
        message: hasQueryOrKelas
          ? `Tidak ada data presensi yang cocok untuk filter saat ini pada bulan ${bulanNama} ${tahun}. Ubah kata kunci atau kelas.`
          : `Tidak ditemukan data presensi untuk bulan ${bulanNama} ${tahun}. Pilih periode lain atau muat ulang.`,
      });
      UI.refreshIcons(container);
      return;
    }

    container.innerHTML = grouped
      .map(
        (grp) => `
        <article class="rekap-kelas-card">
          <div class="rekap-kelas-header">
            <div class="kelas-header-main">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <h3 class="heading-md">${UI.esc(grp.kelas)}</h3>
                <span class="status-badge status-izin mono-num">${grp.rows.length} santri</span>
                <span class="status-badge mono-num ${grp.avgPct >= 80 ? 'status-hadir' : grp.avgPct >= 60 ? 'status-sakit' : 'status-alpa'}">
                  Kehadiran: ${grp.avgPct}%
                </span>
              </div>
              <div class="text-secondary guru-pengampu-row">
                <span>Guru Pengampu:</span>
                ${renderGuruInlineListHtml(grp.guru_pengampu, { fallbackText: grp.guru_pengampu_names })}
                <span class="text-muted">· H: ${grp.totalHadir} · S: ${grp.totalSakit} · I: ${grp.totalIzin} · A: ${grp.totalAlpa}</span>
              </div>
            </div>
            <div class="toolbar-actions kelas-header-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-export-rekap-kelas="${UI.esc(grp.kelas)}">
                <i data-lucide="file-spreadsheet" aria-hidden="true"></i>
                <span>CSV Kelas</span>
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-print-rekap-kelas="${UI.esc(grp.kelas)}">
                <i data-lucide="printer" aria-hidden="true"></i>
                <span>Cetak PDF Kelas</span>
              </button>
            </div>
          </div>

          <div class="table-scroll mobile-cards-wrap">
            <table class="data-table mobile-cards-table mobile-cards-rekap">
              <thead>
                <tr>
                  <th style="width:48px;">No</th>
                  <th>Nama Santri</th>
                  <th>Kelas</th>
                  <th>Kehadiran</th>
                </tr>
              </thead>
              <tbody>
                ${grp.rows
            .map(
              (r, idx) => `
                  <tr class="clickable-row" data-rekap-kelas="${UI.esc(grp.kelas)}" data-rekap-idx="${idx}" tabindex="0">
                    <td class="mono-num rkp-no" data-label="No">${idx + 1}</td>
                    <td class="rkp-nama" data-label="Nama Santri">
                      <div class="row-primary-with-hint">
                        <strong>${UI.esc(r.nama_lengkap)}</strong>
                        <i data-lucide="chevron-right" class="row-chevron-hint" aria-hidden="true"></i>
                      </div>
                    </td>
                    <td class="rkp-kelas" data-label="Kelas">${UI.esc(r.kelas)}</td>
                    <td class="rkp-pct" data-label="Kehadiran">
                      <span class="status-badge mono-num ${r.persentase >= 80 ? 'status-hadir' : r.persentase >= 60 ? 'status-sakit' : 'status-alpa'}">
                        ${r.persentase}%
                      </span>
                    </td>
                  </tr>
                `
            )
            .join('')}
              </tbody>
            </table>
          </div>
        </article>
      `
      )
      .join('');

    container.querySelectorAll('tr[data-rekap-kelas]').forEach((tr) => {
      const openRow = () => {
        const kelasKey = tr.dataset.rekapKelas || '';
        const idx = Number(tr.dataset.rekapIdx);
        const grp = grouped.find((g) => g.kelas === kelasKey);
        if (grp && grp.rows[idx]) {
          openRekapDetailModal(grp.rows[idx], bulanNama, tahun);
        }
      };
      tr.addEventListener('click', openRow);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRow();
        }
      });
    });

    container.querySelectorAll('button[data-export-rekap-kelas]').forEach((btn) => {
      btn.addEventListener('click', () => exportRekapCSV(btn.dataset.exportRekapKelas));
    });

    container.querySelectorAll('button[data-print-rekap-kelas]').forEach((btn) => {
      btn.addEventListener('click', () => printRekapPDF(btn.dataset.printRekapKelas));
    });

    if (typeof UI.bindAvatarFallbacks === 'function') UI.bindAvatarFallbacks(container);
    UI.refreshIcons(container);
  }

  async function loadRekapLaporan(showToast, opts) {
    const force = Boolean((opts && opts.force) || showToast);
    const CACHE = root.MDTA_CACHE;
    const container = document.getElementById('admin-rekap-grouped-container');
    const fetchBtn = document.getElementById('btn-fetch-rekap');
    const bulan = document.getElementById('rekap-bulan').value;
    const tahun = document.getElementById('rekap-tahun').value;

    localState.rekapHasSearched = true;

    if (CACHE && STATE.rekap.length === 0) {
      const c = CACHE.read('rekap');
      if (c && c.data && Array.isArray(c.data.rows)) {
        STATE.rekap = c.data.rows;
        STATE.lastRekapPeriod = c.data.period || null;
      }
    }

    const samePeriod =
      STATE.lastRekapPeriod &&
      String(STATE.lastRekapPeriod.bulan) === String(bulan) &&
      String(STATE.lastRekapPeriod.tahun) === String(tahun);
    const hasCache = Array.isArray(STATE.rekap) && STATE.rekap.length > 0 && samePeriod;

    if (hasCache) {
      renderRekapTable();
      if (!force && STATE.loaded.rekap) return;
    } else if (container) {
      container.innerHTML = UI.renderStateBox({
        type: 'loading',
        title: 'Memuat Rekap Laporan Bulanan',
        message: 'Mengambil rekap presensi santri dan mengelompokkan per kelas...',
      });
      UI.refreshIcons(container);
    }

    if (force || !hasCache) {
      UI.setButtonLoading(fetchBtn, true, 'Memuat...');
    }

    try {
      const prevRekap = STATE.rekap;
      const res = await API.getRekapLaporan(bulan, tahun);
      const freshRekap = API.extractArray(res, ['rekap', 'laporan', 'summary']).map(API.normalizeRekap);
      const changed = !CACHE || CACHE.hasChanged(prevRekap, freshRekap) || !samePeriod;
      STATE.rekap = freshRekap;
      STATE.lastRekapPeriod = { bulan, tahun };
      STATE.loaded.rekap = true;
      if (CACHE) CACHE.write('rekap', { period: STATE.lastRekapPeriod, rows: freshRekap });
      if (changed || !hasCache) renderRekapTable();
      if (showToast) UI.toast(`Rekap laporan ${CONFIG.MONTH_NAMES[Number(bulan) - 1]} ${tahun} dimuat.`, 'success');
    } catch (err) {
      if (!hasCache) {
        STATE.rekap = [];
        if (container) {
          container.innerHTML = UI.renderStateBox({
            type: 'error',
            title: 'Gagal memuat rekap laporan',
            message: err.message,
            actionLabel: 'Coba Lagi',
            actionId: 'btn-retry-rekap',
          });
          UI.refreshIcons(container);
          const retryBtn = document.getElementById('btn-retry-rekap');
          if (retryBtn) retryBtn.addEventListener('click', () => loadRekapLaporan(false, { force: true }));
        }
      }
      if (force || !hasCache) UI.toast(err.message, 'error');
    } finally {
      UI.setButtonLoading(fetchBtn, false);
    }
  }

  function exportRekapCSV(onlyKelas) {
    const rows = getFilteredRekapRows(onlyKelas);
    if (rows.length === 0) {
      UI.toast('Belum ada data rekap untuk diekspor ke CSV.', 'warn');
      return;
    }

    const grouped = groupRekapByClass(rows);
    const bulan = Number(document.getElementById('rekap-bulan').value) || 1;
    const tahun = document.getElementById('rekap-tahun').value;
    const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);

    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const headers = [
      'No',
      'Kelas',
      'Guru Pengampu',
      'ID Santri',
      'Nama Lengkap',
      'Hadir',
      'Sakit',
      'Izin',
      'Alpa',
      'Total Pertemuan',
      'Persentase Kehadiran (%)',
    ];
    const lines = [headers.map(escapeCsv).join(',')];

    let no = 1;
    grouped.forEach((grp) => {
      grp.rows.forEach((r) => {
        lines.push(
          [
            no++,
            grp.kelas,
            grp.guru_pengampu_names,
            r.id_santri || '-',
            r.nama_lengkap,
            r.hadir,
            r.sakit,
            r.izin,
            r.alpa,
            r.total,
            `${r.persentase}%`,
          ]
            .map(escapeCsv)
            .join(',')
        );
      });
    });

    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = onlyKelas ? `-${onlyKelas.replace(/[^a-zA-Z0-9]+/g, '-')}` : '';
    a.download = `Rekap-Presensi-MDTA${suffix}-${bulanNama}-${tahun}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast(`File CSV Rekap ${onlyKelas ? `${onlyKelas} ` : ''}${bulanNama} ${tahun} berhasil diunduh.`, 'success');
  }

  function printRekapPDF(onlyKelas) {
    const printContainer = document.getElementById('rekap-print-pages');
    if (!printContainer) return;

    const bulan = Number(document.getElementById('rekap-bulan').value) || 1;
    const tahun = document.getElementById('rekap-tahun').value;
    const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);
    const rows = getFilteredRekapRows(onlyKelas);
    const grouped = groupRekapByClass(rows);

    if (grouped.length === 0) {
      UI.toast('Belum ada data rekap untuk dicetak.', 'warn');
      return;
    }

    const docTitle = getProgramDocumentTitle(localState.rekapProgramFilter);
    printContainer.innerHTML = grouped
      .map(
        (grp) => `
        <div class="print-class-page">
          <div class="print-kop">
            <div>
              <h2 class="print-kop-title">${UI.esc(CONFIG.INSTITUTION_NAME)}</h2>
              <p class="print-kop-sub">${UI.esc(docTitle)} (${UI.esc(CONFIG.INSTITUTION_LOCATION)})</p>
              <p class="print-kop-sub">Kelas: <strong>${UI.esc(grp.kelas)}</strong> | Guru Pengampu: <strong>${UI.esc(grp.guru_pengampu_names)}</strong> | Periode: ${UI.esc(bulanNama)} ${UI.esc(tahun)}</p>
            </div>
          </div>

          <table class="data-table">
            <thead>
              <tr>
                <th style="width:42px;">No</th>
                <th>ID Santri</th>
                <th>Nama Santri</th>
                <th>Hadir</th>
                <th>Sakit</th>
                <th>Izin</th>
                <th>Alpa</th>
                <th>Kehadiran</th>
              </tr>
            </thead>
            <tbody>
              ${grp.rows
            .map(
              (r, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${UI.esc(r.id_santri || '-')}</td>
                  <td><strong>${UI.esc(r.nama_lengkap)}</strong></td>
                  <td>${r.hadir}</td>
                  <td>${r.sakit}</td>
                  <td>${r.izin}</td>
                  <td>${r.alpa}</td>
                  <td>${r.persentase}%</td>
                </tr>
              `
            )
            .join('')}
            </tbody>
          </table>

          <div class="print-signatures">
            <div class="print-sign-box">
              <div>Mengetahui,</div>
              <div>Kepala Madrasah MDTA</div>
              <div class="print-sign-space"></div>
              <div><strong>( ____________________ )</strong></div>
            </div>
            <div class="print-sign-box">
              <div>${UI.esc(CONFIG.INSTITUTION_LOCATION)}</div>
              <div>Guru Pengampu (${UI.esc(grp.kelas)})</div>
              <div class="print-sign-space"></div>
              <div><strong>${UI.esc(grp.guru_pengampu_names !== 'Belum dipetakan' ? grp.guru_pengampu_names : '( ____________________ )')}</strong></div>
            </div>
          </div>
        </div>
      `
      )
      .join('');

    document.body.classList.add('printing-rekap');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-rekap'), 300);
  }

  function generateRekapPDFBase64(bulanNama, tahun) {
    if (!root.jspdf || typeof root.jspdf.jsPDF !== 'function') {
      throw new Error('Library jsPDF belum termuat. Gunakan opsi unggah berkas PDF dari perangkat Anda.');
    }
    const grouped = groupRekapByClass(getFilteredRekapRows());
    const doc = new root.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const docTitle = getProgramDocumentTitle(localState.rekapProgramFilter);
    const drawClassHeader = (grp) => {
      doc.setFontSize(14);
      doc.text(CONFIG.INSTITUTION_NAME, 14, 18);
      doc.setFontSize(11);
      doc.text(`${docTitle}: ${bulanNama} ${tahun} - ${grp.kelas}`, 14, 25);
      doc.setFontSize(9);
      doc.text(`Guru Pengampu: ${grp.guru_pengampu_names} | Dicetak: ${UI.formatDateShort(new Date())}`, 14, 31);

      const y = 40;
      doc.text('No', 14, y);
      doc.text('ID', 24, y);
      doc.text('Nama Santri', 44, y);
      doc.text('H', 132, y);
      doc.text('S', 145, y);
      doc.text('I', 158, y);
      doc.text('A', 171, y);
      doc.text('%', 184, y);
      doc.line(14, y + 2, 196, y + 2);
      return y + 8;
    };

    grouped.forEach((grp, grpIdx) => {
      if (grpIdx > 0) doc.addPage();
      let y = drawClassHeader(grp);

      grp.rows.forEach((r, idx) => {
        if (y > 275) {
          doc.addPage();
          y = drawClassHeader(grp);
        }
        doc.text(String(idx + 1), 14, y);
        doc.text(String(r.id_santri || '-').slice(0, 8), 24, y);
        doc.text(String(r.nama_lengkap).slice(0, 36), 44, y);
        doc.text(String(r.hadir), 132, y);
        doc.text(String(r.sakit), 145, y);
        doc.text(String(r.izin), 158, y);
        doc.text(String(r.alpa), 171, y);
        doc.text(`${r.persentase}%`, 184, y);
        y += 7;
      });
    });

    const dataUri = doc.output('datauristring');
    return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
  }

  function bindRekapEvents() {
    const bulanSelect = document.getElementById('rekap-bulan');
    const tahunInput = document.getElementById('rekap-tahun');
    const kelasSelect = document.getElementById('rekap-kelas-filter');
    const searchInput = document.getElementById('rekap-search-input');
    const resetBtn = document.getElementById('btn-reset-rekap');
    const fetchBtn = document.getElementById('btn-fetch-rekap');
    const csvBtn = document.getElementById('btn-export-rekap-csv');
    const printBtn = document.getElementById('btn-print-rekap-pdf');
    const openUploadBtn = document.getElementById('btn-open-upload-pdf');

    const closeUploadBtn = document.getElementById('btn-close-upload-pdf-modal');
    const cancelUploadBtn = document.getElementById('btn-cancel-upload-pdf');
    const uploadForm = document.getElementById('form-upload-pdf');
    const fileInput = document.getElementById('upload-pdf-file');
    const submitUploadBtn = document.getElementById('btn-submit-upload-pdf');

    const now = new Date();
    if (bulanSelect) bulanSelect.value = String(now.getMonth() + 1);
    if (tahunInput) tahunInput.value = String(now.getFullYear());

    let searchDebounce = null;
    function isCurrentRekapLoaded() {
      const b = bulanSelect ? bulanSelect.value : '';
      const t = tahunInput ? tahunInput.value : '';
      return Boolean(
        STATE.loaded.rekap &&
        STATE.lastRekapPeriod &&
        String(STATE.lastRekapPeriod.bulan) === String(b) &&
        String(STATE.lastRekapPeriod.tahun) === String(t)
      );
    }

    function getFilteredRekapGuruRows() {
      const progF = localState.rekapProgramFilter || '';
      const kelasF = (kelasSelect ? kelasSelect.value : '') || '';
      const q = (localState.rekapSearchQuery || '').trim().toLowerCase();
      return (localState.rekapGuruRows || []).filter((r) => {
        const rProg = r.kategori_program || resolveClassKategori(r.kelas);
        if (progF && rProg !== progF) return false;
        if (kelasF && String(r.kelas || '').trim().toLowerCase() !== kelasF.trim().toLowerCase()) return false;
        if (!q) return true;
        return (
          String(r.nama_guru || '').toLowerCase().includes(q) ||
          String(r.kelas || '').toLowerCase().includes(q) ||
          String(r.materi_diajarkan || '').toLowerCase().includes(q) ||
          String(r.status || '').toLowerCase().includes(q)
        );
      });
    }

    function guruStatusBadgeClass(st) {
      const s = String(st || '').toLowerCase();
      if (s.includes('hadir')) return 'status-hadir';
      if (s.includes('izin') || s.includes('tugas')) return 'status-izin';
      if (s.includes('sakit')) return 'status-sakit';
      return 'status-alpa';
    }

    function renderRekapGuruTable() {
      const guruCont = document.getElementById('admin-rekap-guru-container');
      const periodEl = document.getElementById('rekap-period-label');
      const subtabsBar = document.getElementById('rekap-kelas-subtabs');
      const actionsWrap = document.getElementById('rekap-toolbar-actions');
      if (subtabsBar) subtabsBar.hidden = true;
      if (!guruCont) return;

      const bulan = Number(bulanSelect ? bulanSelect.value : 1) || 1;
      const tahun = (tahunInput ? tahunInput.value : new Date().getFullYear());
      const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);
      const rows = getFilteredRekapGuruRows();

      if (actionsWrap) actionsWrap.hidden = rows.length === 0;
      if (periodEl) {
        periodEl.textContent = `Rekap Kehadiran & Materi Guru · Periode: ${bulanNama} ${tahun} (${rows.length} catatan)`;
      }

      if (rows.length === 0) {
        guruCont.innerHTML = UI.renderStateBox({
          type: 'empty',
          title: 'Belum ada rekap kehadiran guru',
          message: 'Tidak ditemukan catatan absen & materi guru untuk periode dan filter yang dipilih.',
        });
        UI.refreshIcons(guruCont);
        return;
      }
      guruCont.innerHTML = `
        <div class="table-scroll mobile-cards-wrap">
          <table class="data-table mobile-cards-table mobile-cards-generic">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Nama Guru</th>
                <th>Kelas &amp; Program</th>
                <th>Status</th>
                <th>Materi Diajarkan</th>
                <th>Cek Kepsek</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr>
                  <td class="mono-num" data-label="Tanggal">${UI.esc(r.tanggal)} <span class="text-muted">${UI.esc(r.waktu_masuk || '')}</span></td>
                  <td class="mc-primary" data-label="Nama Guru"><strong>${UI.esc(r.nama_guru)}</strong></td>
                  <td data-label="Kelas &amp; Program">${UI.esc(r.kelas)} <span class="status-badge status-izin">${UI.esc(r.kategori_program || resolveClassKategori(r.kelas))}</span></td>
                  <td class="mc-status" data-label="Status"><span class="status-badge ${guruStatusBadgeClass(r.status)}">${UI.esc(r.status)}</span></td>
                  <td data-label="Materi">${UI.esc(r.materi_diajarkan || '-')}</td>
                  <td data-label="Cek Kepsek">${UI.esc(r.status_cek || 'Belum Dicek')}${r.catatan_kepsek ? ` · ${UI.esc(r.catatan_kepsek)}` : ''}</td>
                </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    async function loadRekapGuru(showToastMsg) {
      const guruCont = document.getElementById('admin-rekap-guru-container');
      const bulan = bulanSelect ? bulanSelect.value : String(new Date().getMonth() + 1);
      const tahun = tahunInput ? tahunInput.value : String(new Date().getFullYear());
      if (!guruCont) return;
      guruCont.innerHTML = UI.renderStateBox({ type: 'loading', title: 'Memuat rekap kehadiran guru...' });
      UI.refreshIcons(guruCont);
      try {
        const res = await API.getMonitoringGuru({ bulan, tahun });
        const d = (res && res.data) || res || {};
        localState.rekapGuruRows = Array.isArray(d.absensi_guru) ? d.absensi_guru : [];
        renderRekapGuruTable();
        if (showToastMsg) {
          const bNama = CONFIG.MONTH_NAMES[Number(bulan) - 1] || String(bulan);
          UI.toast(`Rekap kehadiran guru ${bNama} ${tahun} dimuat.`, 'success');
        }
      } catch (err) {
        guruCont.innerHTML = UI.renderStateBox({ type: 'error', title: 'Gagal memuat rekap guru', message: err.message });
        UI.refreshIcons(guruCont);
        if (showToastMsg) UI.toast(err.message, 'error');
      }
    }

    function exportRekapGuruCSV() {
      const rows = getFilteredRekapGuruRows();
      if (rows.length === 0) {
        UI.toast('Belum ada data rekap guru untuk diekspor ke CSV.', 'warn');
        return;
      }
      const bulan = Number(bulanSelect ? bulanSelect.value : 1) || 1;
      const tahun = tahunInput ? tahunInput.value : new Date().getFullYear();
      const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);
      const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const headers = ['No', 'Tanggal', 'Jam Masuk', 'Nama Guru', 'Kelas', 'Program', 'Status', 'Materi Diajarkan', 'Keterangan', 'Cek Kepsek', 'Catatan Kepsek'];
      const lines = [headers.map(escapeCsv).join(',')];
      rows.forEach((r, idx) => {
        lines.push([
          idx + 1,
          r.tanggal || '-',
          r.waktu_masuk || '-',
          r.nama_guru || '-',
          r.kelas || '-',
          r.kategori_program || resolveClassKategori(r.kelas),
          r.status || '-',
          r.materi_diajarkan || '-',
          r.keterangan || '-',
          r.status_cek || 'Belum Dicek',
          r.catatan_kepsek || '-',
        ].map(escapeCsv).join(','));
      });
      const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rekap-Kehadiran-Guru-MDTA-${bulanNama}-${tahun}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      UI.toast(`File CSV Rekap Guru ${bulanNama} ${tahun} berhasil diunduh.`, 'success');
    }

    function printRekapGuruPDF() {
      const printContainer = document.getElementById('rekap-print-pages');
      if (!printContainer) return;
      const rows = getFilteredRekapGuruRows();
      if (rows.length === 0) {
        UI.toast('Belum ada data rekap guru untuk dicetak.', 'warn');
        return;
      }
      const bulan = Number(bulanSelect ? bulanSelect.value : 1) || 1;
      const tahun = tahunInput ? tahunInput.value : new Date().getFullYear();
      const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);

      printContainer.innerHTML = `
        <div class="print-class-page">
          <div class="print-kop">
            <div>
              <h2 class="print-kop-title">${UI.esc(CONFIG.INSTITUTION_NAME)}</h2>
              <p class="print-kop-sub">Rekap Kehadiran &amp; Materi Mengajar Guru (${UI.esc(CONFIG.INSTITUTION_LOCATION)})</p>
              <p class="print-kop-sub">Periode: <strong>${UI.esc(bulanNama)} ${UI.esc(tahun)}</strong> | Total Catatan: ${rows.length}</p>
            </div>
          </div>
          <table class="data-table">
            <thead>
              <tr>
                <th style="width:36px;">No</th>
                <th>Tanggal</th>
                <th>Nama Guru</th>
                <th>Kelas</th>
                <th>Status</th>
                <th>Materi Diajarkan</th>
                <th>Status Cek</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>${UI.esc(r.tanggal)} ${UI.esc(r.waktu_masuk || '')}</td>
                  <td><strong>${UI.esc(r.nama_guru)}</strong></td>
                  <td>${UI.esc(r.kelas)} (${UI.esc(r.kategori_program || resolveClassKategori(r.kelas))})</td>
                  <td>${UI.esc(r.status)}</td>
                  <td>${UI.esc(r.materi_diajarkan || '-')}</td>
                  <td>${UI.esc(r.status_cek || 'Belum Dicek')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="print-signatures">
            <div class="print-sign-box">
              <div>${UI.esc(CONFIG.INSTITUTION_LOCATION)}</div>
              <div>Kepala Madrasah MDTA</div>
              <div class="print-sign-space"></div>
              <div><strong>( ____________________ )</strong></div>
            </div>
          </div>
        </div>
      `;
      document.body.classList.add('printing-rekap');
      window.print();
      setTimeout(() => document.body.classList.remove('printing-rekap'), 300);
    }

    function generateRekapGuruPDFBase64(bulanNama, tahun) {
      if (!root.jspdf || typeof root.jspdf.jsPDF !== 'function') {
        throw new Error('Library jsPDF belum termuat. Gunakan opsi unggah berkas PDF dari perangkat Anda.');
      }
      const rows = getFilteredRekapGuruRows();
      const doc = new root.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const drawHeader = () => {
        doc.setFontSize(14);
        doc.text(CONFIG.INSTITUTION_NAME, 14, 18);
        doc.setFontSize(11);
        doc.text(`Rekap Kehadiran & Materi Guru: ${bulanNama} ${tahun}`, 14, 25);
        doc.setFontSize(9);
        doc.text(`Dicetak: ${UI.formatDateShort(new Date())}`, 14, 31);
        const y = 40;
        doc.text('No', 14, y);
        doc.text('Tanggal', 23, y);
        doc.text('Nama Guru', 48, y);
        doc.text('Kelas', 86, y);
        doc.text('Status', 112, y);
        doc.text('Materi', 140, y);
        doc.line(14, y + 2, 196, y + 2);
        return y + 8;
      };
      let y = drawHeader();
      rows.forEach((r, idx) => {
        if (y > 275) {
          doc.addPage();
          y = drawHeader();
        }
        doc.text(String(idx + 1), 14, y);
        doc.text(String(r.tanggal || '-').slice(0, 10), 23, y);
        doc.text(String(r.nama_guru || '-').slice(0, 18), 48, y);
        doc.text(String(r.kelas || '-').slice(0, 13), 86, y);
        doc.text(String(r.status || '-').slice(0, 14), 112, y);
        doc.text(String(r.materi_diajarkan || '-').slice(0, 28), 140, y);
        y += 7;
      });
      const dataUri = doc.output('datauristring');
      return dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    }

    if (kelasSelect) {
      kelasSelect.addEventListener('change', () => {
        if (localState.rekapMode === 'guru') {
          renderRekapGuruTable();
          return;
        }
        if (kelasSelect.value) {
          localState.rekapHasSearched = true;
          if (!isCurrentRekapLoaded()) {
            loadRekapLaporan(false);
            return;
          }
        }
        if (localState.rekapHasSearched) {
          renderRekapTable();
        }
      });
    }

    document.querySelectorAll('#rekap-mode-tabs .report-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.rekapMode === 'guru' ? 'guru' : 'santri';
        localState.rekapMode = nextMode;
        document.querySelectorAll('#rekap-mode-tabs .report-mode-btn').forEach((b) => {
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
        });
        const santriCont = document.getElementById('admin-rekap-grouped-container');
        const guruCont = document.getElementById('admin-rekap-guru-container');
        const subtabsBar = document.getElementById('rekap-kelas-subtabs');
        const actionsWrap = document.getElementById('rekap-toolbar-actions');
        if (santriCont) santriCont.hidden = nextMode !== 'santri';
        if (guruCont) guruCont.hidden = nextMode !== 'guru';
        if (nextMode === 'guru') {
          if (subtabsBar) subtabsBar.hidden = true;
          if (actionsWrap) actionsWrap.hidden = true;
          loadRekapGuru(false);
        } else {
          renderRekapTable();
        }
      });
    });

    document.querySelectorAll('#rekap-program-pills .filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        localState.rekapProgramFilter = chip.dataset.rekapProgram || '';
        document.querySelectorAll('#rekap-program-pills .filter-chip').forEach((c) => {
          c.setAttribute('aria-pressed', c === chip ? 'true' : 'false');
        });
        if (localState.rekapMode === 'guru') renderRekapGuruTable();
        else if (localState.rekapHasSearched) renderRekapTable();
      });
    });

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value || '';
        localState.rekapSearchQuery = val;
        if (searchDebounce) clearTimeout(searchDebounce);
        if (localState.rekapMode === 'guru') {
          renderRekapGuruTable();
          return;
        }
        if (val.trim()) {
          localState.rekapHasSearched = true;
          if (!isCurrentRekapLoaded()) {
            searchDebounce = setTimeout(() => loadRekapLaporan(false), 260);
            return;
          }
        }
        if (localState.rekapHasSearched) {
          renderRekapTable();
        }
      });
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (searchDebounce) clearTimeout(searchDebounce);
          if (localState.rekapMode === 'guru') loadRekapGuru(false);
          else loadRekapLaporan(false);
        }
      });
    }

    [bulanSelect, tahunInput].forEach((el) => {
      if (el) {
        el.addEventListener('change', () => {
          if (localState.rekapMode === 'guru') {
            loadRekapGuru(false);
          } else if (localState.rekapHasSearched) {
            loadRekapLaporan(false);
          }
        });
      }
    });

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (searchDebounce) clearTimeout(searchDebounce);
        localState.rekapHasSearched = false;
        localState.rekapSearchQuery = '';
        if (searchInput) searchInput.value = '';
        if (kelasSelect) kelasSelect.value = '';
        const dNow = new Date();
        if (bulanSelect) bulanSelect.value = String(dNow.getMonth() + 1);
        if (tahunInput) tahunInput.value = String(dNow.getFullYear());
        if (localState.rekapMode === 'guru') loadRekapGuru(false);
        else renderRekapTable();
      });
    }

    if (fetchBtn) {
      fetchBtn.addEventListener('click', () => {
        if (localState.rekapMode === 'guru') loadRekapGuru(true);
        else loadRekapLaporan(true);
      });
    }
    if (csvBtn) {
      csvBtn.addEventListener('click', () => {
        if (localState.rekapMode === 'guru') exportRekapGuruCSV();
        else exportRekapCSV();
      });
    }
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        if (localState.rekapMode === 'guru') printRekapGuruPDF();
        else printRekapPDF();
      });
    }

    if (openUploadBtn) {
      openUploadBtn.addEventListener('click', () => {
        const bulan = Number(bulanSelect.value) || 1;
        const tahun = tahunInput.value;
        const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);
        const nameInp = document.getElementById('upload-pdf-filename');
        if (nameInp) {
          nameInp.value = localState.rekapMode === 'guru'
            ? `Rekap-Kehadiran-Guru-MDTA-${bulanNama}-${tahun}.pdf`
            : `Rekap-Presensi-MDTA-${bulanNama}-${tahun}.pdf`;
        }
        if (fileInput) fileInput.value = '';
        UI.openModal('modal-upload-pdf');
      });
    }

    if (closeUploadBtn) closeUploadBtn.addEventListener('click', () => UI.closeModal('modal-upload-pdf'));
    if (cancelUploadBtn) cancelUploadBtn.addEventListener('click', () => UI.closeModal('modal-upload-pdf'));

    if (uploadForm) {
      uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const filename = document.getElementById('upload-pdf-filename').value.trim() || 'Rekap-Presensi-MDTA.pdf';
        const mode = document.querySelector('input[name="uploadPdfMode"]:checked')?.value || 'snapshot';
        const bulan = Number(bulanSelect.value) || 1;
        const tahun = tahunInput.value;
        const bulanNama = CONFIG.MONTH_NAMES[bulan - 1] || String(bulan);

        let base64Content = '';
        try {
          if (mode === 'file') {
            const f = fileInput && fileInput.files && fileInput.files[0];
            if (!f) {
              UI.toast('Pilih berkas PDF hasil cetak terlebih dahulu.', 'error');
              return;
            }
            base64Content = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const s = String(reader.result || '');
                resolve(s.includes(',') ? s.split(',')[1] : s);
              };
              reader.onerror = () => reject(new Error('Gagal membaca berkas PDF.'));
              reader.readAsDataURL(f);
            });
          } else if (localState.rekapMode === 'guru') {
            if (getFilteredRekapGuruRows().length === 0) {
              UI.toast('Belum ada data rekap guru untuk dibuat menjadi PDF.', 'warn');
              return;
            }
            base64Content = generateRekapGuruPDFBase64(bulanNama, tahun);
          } else {
            if (getFilteredRekapRows().length === 0) {
              UI.toast('Belum ada data rekap untuk dibuat menjadi PDF. Muat rekap terlebih dahulu.', 'warn');
              return;
            }
            base64Content = generateRekapPDFBase64(bulanNama, tahun);
          }
        } catch (prepErr) {
          UI.toast(prepErr.message, 'error');
          return;
        }

        UI.setButtonLoading(submitUploadBtn, true, 'Mengunggah ke Drive...');
        try {
          const docJudul = localState.rekapMode === 'guru'
            ? `Rekap Kehadiran Guru ${bulanNama} ${tahun}`
            : `${getProgramDocumentTitle(localState.rekapProgramFilter)} ${bulanNama} ${tahun}`;
          const res = await API.uploadDokumenDrive({
            filename,
            mimeType: 'application/pdf',
            base64Content,
            kategori: 'Laporan PDF',
            judul: docJudul,
            diunggah_oleh: (adminSession && (adminSession.nama_lengkap || adminSession.username)) || 'Administrator',
          });
          UI.closeModal('modal-upload-pdf');
          const d = res.data || res || {};
          const docRec = API.normalizeDokumen({
            id_dokumen: d.id_dokumen || '',
            judul: docJudul,
            kategori: 'Laporan PDF',
            drive_id: d.drive_id || '',
            drive_url: d.drive_url || '',
            diunggah_oleh: (adminSession && (adminSession.nama_lengkap || adminSession.username)) || 'Administrator',
            tanggal_upload: UI.todayISO(),
          });
          if (!Array.isArray(STATE.dokumenArsip)) STATE.dokumenArsip = [];
          STATE.dokumenArsip = [docRec].concat(
            STATE.dokumenArsip.filter((item) => !docRec.id_dokumen || item.id_dokumen !== docRec.id_dokumen)
          );
          STATE.loaded.arsip = true;
          if (root.MDTA_CACHE) root.MDTA_CACHE.write('dokumenArsip', STATE.dokumenArsip);
          if (d.sync_ts !== undefined) recordLocalSyncTs(d.sync_ts);
          UI.toast(
            d.drive_url
              ? `PDF "${filename}" berhasil diunggah ke Drive & disimpan di arsip.`
              : `PDF "${filename}" selesai diunggah ke Google Drive.`,
            'success'
          );
        } catch (err) {
          UI.toast(err.message, 'error');
        } finally {
          UI.setButtonLoading(submitUploadBtn, false);
        }
      });
    }
  }

  // =========================================================================
  // INISIALISASI PORTAL KEPALA MADRASAH / ADMIN (5 TAB + 2 KALKULATOR)
  // =========================================================================
  function closeAdminCalculators() {
    const uasPanel = document.getElementById('admin-panel-uas');
    const raportPanel = document.getElementById('admin-panel-raport');
    if (uasPanel) uasPanel.hidden = true;
    if (raportPanel) raportPanel.hidden = true;
    document.querySelectorAll('#admin-calc-switcher .admin-calc-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  function openAdminCalculator(calcType) {
    const target = calcType === 'raport' ? 'raport' : 'uas';
    if (tabController && typeof tabController.clearSelection === 'function') {
      tabController.clearSelection();
    }
    const uasPanel = document.getElementById('admin-panel-uas');
    const raportPanel = document.getElementById('admin-panel-raport');
    if (uasPanel) uasPanel.hidden = target !== 'uas';
    if (raportPanel) raportPanel.hidden = target !== 'raport';

    document.querySelectorAll('#admin-calc-switcher .admin-calc-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.adminCalc === target ? 'true' : 'false');
    });

    if (target === 'uas') {
      root.MDTA_CALC.mountUAS(document.getElementById('admin-uas-mount'), {
        scope: 'admin',
        session: adminSession,
      });
    } else {
      root.MDTA_CALC.mountRaport(document.getElementById('admin-raport-mount'), {
        scope: 'admin',
        session: adminSession,
      });
    }

    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // =========================================================================
  // AUTO-SYNC REAL-TIME (SMART POLLING 5 DETIK VIA getSyncVersion)
  // =========================================================================
  function recordLocalSyncTs(tsVal) {
    if (tsVal === null || tsVal === undefined || tsVal === '') return;
    const nextStr = String(tsVal);
    localState.localSyncTs = nextStr;
    STATE.localSyncTs = nextStr;
  }

  function updateLiveSyncBadge(statusKey) {
    const badge = document.getElementById('admin-live-sync-badge');
    const label = document.getElementById('admin-live-sync-label');
    if (!badge || !label) return;

    badge.classList.remove('is-active', 'is-syncing', 'is-paused');
    if (statusKey === 'syncing') {
      badge.classList.add('is-syncing');
      label.textContent = 'Menyinkronkan...';
    } else if (statusKey === 'paused') {
      badge.classList.add('is-paused');
      label.textContent = 'Live Sync Dijeda';
    } else if (statusKey === 'unsupported') {
      badge.classList.add('is-paused');
      label.textContent = 'Live Sync Menunggu Deploy';
    } else {
      badge.classList.add('is-active');
      label.textContent = 'Live Sync Aktif';
    }
  }

  function clearSyncTimer() {
    if (syncPollTimer !== null) {
      clearInterval(syncPollTimer);
      syncPollTimer = null;
    }
  }

  function scheduleLiveSyncInterval() {
    clearSyncTimer();
    const intervalMs = Math.max(2000, Number(CONFIG.SYNC_POLL_INTERVAL_MS) || 5000);
    syncPollTimer = setInterval(pollSyncVersion, intervalMs);
  }

  async function silentRefreshFromSync(nextServerTs, opts) {
    if (syncRefreshInFlight) return;
    syncRefreshInFlight = true;
    updateLiveSyncBadge('syncing');

    const CACHE = root.MDTA_CACHE;
    const kelasSel = document.getElementById('kepsek-filter-kelas');
    const targetTanggal = UI.todayISO();
    localState.activeDateWib = targetTanggal;
    const targetKelas = (kelasSel && kelasSel.value) || '';
    const key = `${targetTanggal}|${targetKelas}`;

    try {
      const [rkRes, dashRes, monRes] = await Promise.allSettled([
        API.getRekapKepsek(targetTanggal, targetKelas),
        API.getDashboard(),
        API.getMonitoringGuru({ tanggal: targetTanggal }),
      ]);

      let anySucceeded = false;
      let latestTsFromServer = nextServerTs;
      let rkUpdated = false;
      let monUpdated = false;

      if (monRes.status === 'fulfilled' && monRes.value) {
        anySucceeded = true;
        const monData = monRes.value.data || monRes.value || {};
        if (Array.isArray(monData.absensi_guru)) {
          const monChanged = !CACHE || CACHE.hasChanged(STATE.absensiGuruToday, monData.absensi_guru);
          STATE.absensiGuruToday = monData.absensi_guru;
          if (CACHE) CACHE.write('absensiGuruToday', STATE.absensiGuruToday);
          if (monChanged) {
            monUpdated = true;
            renderKepsekMonitoringGuru();
          }
        }
      }

      if (dashRes.status === 'fulfilled' && dashRes.value) {
        anySucceeded = true;
        const dash = dashRes.value.data || dashRes.value;
        STATE.dashboard = dash;
        if (CACHE) CACHE.write('dashboard', dash);

        if (Array.isArray(dash.daftar_pengguna)) {
          const freshUsers = dash.daftar_pengguna.map(API.normalizeUser);
          const usersChanged = !CACHE || CACHE.hasChanged(STATE.users, freshUsers);
          if (usersChanged) {
            STATE.users = freshUsers;
            if (CACHE) CACHE.write('users', freshUsers);
            renderUsersTable();
            renderKelasManagement();
          }
        }
      }

      if (rkRes.status === 'fulfilled' && rkRes.value) {
        anySucceeded = true;
        const rk = rkRes.value.data || rkRes.value;
        if (rk && rk.sync_ts !== undefined) {
          latestTsFromServer = String(rk.sync_ts);
        }
        const changed = !CACHE || CACHE.hasChanged(STATE.rekapKepsek, rk) || STATE.rekapKepsekKey !== key;
        STATE.rekapKepsek = rk;
        STATE.rekapKepsekKey = key;
        if (CACHE) CACHE.write('rekapKepsek', { key, payload: rk });
        if (changed) {
          renderKepsekBlockFromData(rk, targetTanggal);
          rkUpdated = true;
        }
      } else if (dashRes.status === 'fulfilled' && dashRes.value) {
        const dash = dashRes.value.data || dashRes.value;
        renderKepsekBlockFromData(buildDailyFallbackKepsekData(dash, targetTanggal), targetTanggal);
        rkUpdated = true;
      }

      if (anySucceeded) {
        recordLocalSyncTs(latestTsFromServer);
        STATE.lastSyncAt = Date.now();
        if ((rkUpdated || monUpdated) && !(opts && opts.quiet)) {
          UI.toast('Pembaruan otomatis: data presensi/nilai baru masuk.', 'info');
        }
      }
    } finally {
      syncRefreshInFlight = false;
      const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
      updateLiveSyncBadge(syncActive && isVisible ? 'active' : 'paused');
    }
  }

  function checkAdminDayRollover(opts) {
    const todayWib = UI.todayISO();
    if (todayWib === localState.activeDateWib) return false;
    localState.activeDateWib = todayWib;

    STATE.rekapKepsek = null;
    STATE.rekapKepsekKey = '';
    if (root.MDTA_CACHE) {
      root.MDTA_CACHE.remove('rekapKepsek');
      root.MDTA_CACHE.remove('dashboard');
    }

    if (!(opts && opts.skipLoad)) {
      loadDashboard(false, { force: true });
    }
    return true;
  }

  async function pollSyncVersion() {
    if (checkAdminDayRollover()) return;
    if (!syncActive || syncUnsupported || syncCheckInFlight || syncRefreshInFlight) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const adminView = document.getElementById('view-admin');
    if (!adminView || adminView.hidden) return;

    syncCheckInFlight = true;
    try {
      const res = await API.getSyncVersion();
      const d = (res && res.data) || res || {};
      const serverTs = String(d.ts !== undefined ? d.ts : (d.last_sync_ts !== undefined ? d.last_sync_ts : '0'));

      if (localState.localSyncTs === null) {
        recordLocalSyncTs(serverTs);
      } else if (serverTs !== localState.localSyncTs) {
        await silentRefreshFromSync(serverTs);
      }
    } catch (err) {
      if (/tidak dikenali/i.test(String((err && err.message) || ''))) {
        syncUnsupported = true;
        clearSyncTimer();
        updateLiveSyncBadge('unsupported');
      }
    } finally {
      syncCheckInFlight = false;
    }
  }

  function handleVisibilityChange() {
    if (!syncActive || syncUnsupported) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      clearSyncTimer();
      updateLiveSyncBadge('paused');
    } else {
      const rolledOver = checkAdminDayRollover();
      updateLiveSyncBadge('active');
      scheduleLiveSyncInterval();
      if (!rolledOver) pollSyncVersion();
    }
  }

  function startLiveSync() {
    syncActive = true;
    syncUnsupported = false;
    if (!syncVisibilityBound && typeof document !== 'undefined') {
      syncVisibilityBound = true;
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      updateLiveSyncBadge('active');
      scheduleLiveSyncInterval();
    } else {
      clearSyncTimer();
      updateLiveSyncBadge('paused');
    }
  }

  function stopLiveSync() {
    syncActive = false;
    clearSyncTimer();
    localState.localSyncTs = null;
    STATE.localSyncTs = null;
    updateLiveSyncBadge('paused');
  }

  function init(session) {
    adminSession = session || {};
    localState.rekapHasSearched = false;
    localState.rekapSearchQuery = '';
    localState.localSyncTs = STATE.localSyncTs || null;
    checkAdminDayRollover({ skipLoad: true });
    localState.activeDateWib = UI.todayISO();
    const updatedEl = document.getElementById('dashboard-last-updated');
    if (updatedEl) updatedEl.textContent = UI.formatDateId(localState.activeDateWib);
    const rekapSearchInp = document.getElementById('rekap-search-input');
    if (rekapSearchInp) rekapSearchInp.value = '';
    const rekapKelasSel = document.getElementById('rekap-kelas-filter');
    if (rekapKelasSel) rekapKelasSel.value = '';

    const tablist = document.getElementById('admin-tablist');

    if (!initialized) {
      initialized = true;
      bindDashboardEvents();
      bindKelasEvents();
      bindSantriEvents();
      bindRekapEvents();

      document.querySelectorAll('#view-admin [data-admin-calc]').forEach((btn) => {
        btn.addEventListener('click', () => openAdminCalculator(btn.dataset.adminCalc));
      });
      document.querySelectorAll('#view-admin [data-back-to-dashboard]').forEach((btn) => {
        btn.addEventListener('click', () => {
          closeAdminCalculators();
          if (tabController) tabController.selectByName('dashboard', true);
        });
      });

      tabController = UI.initSlidingTabs(tablist, (tabName) => {
        closeAdminCalculators();
        if (tabName === 'dashboard') {
          if (!checkAdminDayRollover() && (!STATE.loaded.bootstrap || !STATE.rekapKepsek)) {
            loadDashboard(false, { force: false });
          }
        } else if (tabName === 'santri') {
          if (STATE.santri.length > 0) {
            syncClassFilterOptions();
            renderSantriTable();
          }
          if (!STATE.loaded.santri && !STATE.loaded.bootstrap) {
            loadSantri(false);
          }
        } else if (tabName === 'rekap') {
          syncClassFilterOptions();
          renderRekapTable();
        } else if (tabName === 'kelas') {
          renderKelasManagement();
          if (!STATE.loaded.bootstrap && (STATE.kelas || []).length === 0) {
            loadDashboard(false, { force: false });
          }
        } else if (tabName === 'akun') {
          renderUsersTable();
          if (!STATE.loaded.bootstrap && (STATE.users || []).length === 0) {
            loadDashboard(false, { force: false });
          }
        }
      });
    } else if (tabController) {
      closeAdminCalculators();
      tabController.selectByName('dashboard', false);
    }

    loadDashboard(false, { force: false });
    startLiveSync();
  }

  root.MDTA_ADMIN = {
    init,
    cleanup: stopLiveSync,
    loadDashboard,
    loadSantri,
    loadRekapLaporan,
  };
})(window);
