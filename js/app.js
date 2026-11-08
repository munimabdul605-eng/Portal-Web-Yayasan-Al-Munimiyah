/**
 * Portal Web Resmi Yayasan Pendidikan Islam Al-Mun'imiyah (YPIA)
 * Mengelola tema Terang/Gelap, animasi gulir & sorot sentuhan, pratinjau 5 jenjang,
 * kalkulator biaya, FAQ, layanan pesan, serta aksesibilitas keyboard (R-32).
 */
(function () {
  const R = window.YPIACore.formatRp;
  const esc = (s) =>
    String(s ?? '')
      .replace(/\s*—\s*/g, ': ')
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let KB = null;
  let lastFocusedEl = null;
  let revealObserver = null;
  let quotaAnimated = false;
  const spotlightBound = new WeakSet();
  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const TAHFIDZ_TARGETS = {
    PG: '15 surat pendek Juz 30 & doa harian pilihan',
    TK: '1/2 Juz 30 (An-Nas s.d. Al-Infitar / Ad-Dhuha)',
    SD: '2 Juz Mutqin (Juz 30 & Juz 29) bersanad',
    SMP: '3-5 Juz Mutqin bersanad & terjemah Juz 30',
    SMA: '5-10 Juz Mutqin bersanad & tafsir tematik',
  };

  const UNGGULAN_PROGRAMS = {
    PG: 'Stimulasi Sensorik-Motorik & Pembiasaan Adab Harian',
    TK: 'Eksplorasi Sains Anak, Literasi-Numerasi & Manasik',
    SD: 'Coding Dasar SDIT, Sains-Matematika & Bahasa Arab-Inggris',
    SMP: 'Robotika Terapan SMPIT, Program Dwibahasa & Kepemimpinan',
    SMA: 'AI & Python SMAIT, Riset Ilmiah & Persiapan Perguruan Tinggi',
  };

  const state = {
    heroUnitCode: 'SD',
    faqCategory: 'ALL',
    faqQuery: '',
    chatHistory: [],
    liveQuotaStats: [
      { code: 'PG', label: "Playgroup (PG) Al-Mun'imiyah", rombel: '2 Rombel (@15 Siswa)', filled: 1, total: 30 },
      { code: 'TK', label: 'TK Islam (TK A & TK B)', rombel: '4 Rombel (@20 Siswa)', filled: 2, total: 80 },
      { code: 'SD', label: "SDIT Al-Mun'imiyah", rombel: '4 Rombel (@28 Siswa)', filled: 4, total: 112 },
      { code: 'SMP', label: "SMPIT Al-Mun'imiyah", rombel: '4 Rombel (@30 Siswa)', filled: 3, total: 120 },
      { code: 'SMA', label: "SMAIT Al-Mun'imiyah", rombel: '4 Rombel (@30 Siswa)', filled: 3, total: 120 },
    ],
  };

  // Murni 5 Berkas Data Master Acuan Utama
  const MASTER_DOCS = [
    {
      title: 'Dokumen 01: Statuta Yayasan',
      subtitle: "Akta Pendirian & Ketetapan Dasar Tata Kelola Yayasan Pendidikan Islam Al-Mun'imiyah",
    },
    {
      title: 'Dokumen 02: Tabel Biaya & Kebijakan Keringanan',
      subtitle: 'Rincian Biaya Pendidikan TA 2026/2027 & Ketentuan Beasiswa Statuta Pasal 9 Ayat (5)',
    },
    {
      title: 'Dokumen 03: Petunjuk Teknis & SOP Seleksi PPDB',
      subtitle: 'Jadwal 3 Gelombang, Alur Pendaftaran & Persyaratan Administrasi Calon Peserta Didik',
    },
    {
      title: 'Dokumen 04: Standar Pendidik & Kurikulum Khas',
      subtitle: 'Standar Mutu Tenaga Pendidik, Halaqah Tahfidz Bersanad & Muatan Sains-Teknologi',
    },
    {
      title: 'Dokumen 05: Panduan Tanya Jawab & Layanan Informasi',
      subtitle: 'Pedoman Resmi Layanan Informasi Publik, Pertanyaan Umum (FAQ) & Rekening VA Resmi',
    },
  ];

  // =====================================================================
  // PENGALIH TEMA TERANG / GELAP (R-21 & R-34)
  // =====================================================================
  const MOON_ICON_PATHS = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>';
  const SUN_ICON_PATHS = '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>';

  function syncThemeButtonUI() {
    const isDark = document.documentElement.classList.contains('dark');
    const btn = document.getElementById('btn-theme-toggle');
    const icon = document.getElementById('theme-toggle-icon');
    const label = document.getElementById('theme-toggle-label');
    if (icon) icon.innerHTML = isDark ? SUN_ICON_PATHS : MOON_ICON_PATHS;
    if (label) label.textContent = isDark ? 'Terang' : 'Gelap';
    if (btn) {
      btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
      btn.setAttribute('aria-label', isDark ? 'Ubah tema ke mode terang' : 'Ubah tema ke mode gelap');
    }
  }

  function initThemeToggle() {
    syncThemeButtonUI();
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const nextDark = !document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', nextDark);
      document.documentElement.classList.toggle('light', !nextDark);
      try {
        localStorage.setItem('ypia-theme', nextDark ? 'dark' : 'light');
      } catch (e) {}
      syncThemeButtonUI();
    });
  }

  // =====================================================================
  // MOTION ENGINE: SOROT SENTUHAN / KURSOR, GULIR & PROGRESS (MOTION 2)
  // =====================================================================
  function bindCardSpotlights(root = document) {
    const cards = root.querySelectorAll('.nextra-card');
    cards.forEach((card) => {
      if (spotlightBound.has(card)) return;
      spotlightBound.add(card);
      let touchTimer = null;

      const updateCoords = (clientX, clientY) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${Math.round(clientX - rect.left)}px`);
        card.style.setProperty('--my', `${Math.round(clientY - rect.top)}px`);
      };

      card.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerType === 'touch') return;
          updateCoords(e.clientX, e.clientY);
        },
        { passive: true }
      );

      card.addEventListener(
        'pointerdown',
        (e) => {
          updateCoords(e.clientX, e.clientY);
          card.classList.add('is-touch-active');
          if (touchTimer) clearTimeout(touchTimer);
          touchTimer = setTimeout(() => card.classList.remove('is-touch-active'), 420);
        },
        { passive: true }
      );
    });
  }

  function flushVisibleReveals() {
    const vh = window.innerHeight || 800;
    document.querySelectorAll('.reveal-on-scroll.reveal-ready:not(.is-visible)').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.96) {
        el.classList.add('is-visible');
        if (revealObserver) revealObserver.unobserve(el);
      }
    });
  }

  function observeReveals(root = document) {
    const targets = root.querySelectorAll('.reveal-on-scroll');
    if (!targets.length) return;

    if (prefersReducedMotion() || typeof window.IntersectionObserver !== 'function') {
      targets.forEach((el) => {
        el.classList.remove('reveal-ready');
        el.classList.add('is-visible');
      });
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              revealObserver.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.06, rootMargin: '0px 0px -36px 0px' }
      );
    }

    const vh = window.innerHeight || 800;
    targets.forEach((el) => {
      if (el.classList.contains('is-visible')) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.94) {
        el.classList.add('is-visible');
      } else {
        el.classList.add('reveal-ready');
        revealObserver.observe(el);
      }
    });
  }

  function animateQuotaBars(force = false) {
    const fills = document.querySelectorAll('#ppdb-quota-chart .quota-bar-fill');
    if (!fills.length) return;
    if (prefersReducedMotion() || force) {
      fills.forEach((bar) => {
        const s = bar.getAttribute('data-target-scale') || '1';
        bar.style.transform = `scaleX(${s})`;
      });
      quotaAnimated = true;
      return;
    }
    const chartEl = document.getElementById('ppdb-quota-chart');
    if (!chartEl) return;
    const rect = chartEl.getBoundingClientRect();
    if (rect.top <= (window.innerHeight || 800) * 0.95 && !quotaAnimated) {
      quotaAnimated = true;
      fills.forEach((bar, idx) => {
        const s = bar.getAttribute('data-target-scale') || '0.1';
        setTimeout(() => {
          bar.style.transform = `scaleX(${s})`;
        }, idx * 70);
      });
    }
  }

  function initScrollEngine() {
    const sections = ['beranda', 'profil', 'unit', 'ppdb', 'konsultasi'];
    const bar = document.getElementById('scroll-progress-bar');
    let ticking = false;

    const onFrame = () => {
      ticking = false;
      const docEl = document.documentElement;
      const maxScroll = Math.max(1, docEl.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
      if (bar) bar.style.transform = `scaleX(${ratio.toFixed(4)})`;

      const y = window.scrollY + 180;
      let current = 'beranda';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= y) current = id;
      }
      document.querySelectorAll('[data-nav]').forEach((a) => {
        a.classList.toggle('active', a.getAttribute('data-nav') === current);
      });

      flushVisibleReveals();
      animateQuotaBars();
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(onFrame);
        }
      },
      { passive: true }
    );
    window.addEventListener('resize', () => flushVisibleReveals(), { passive: true });
    onFrame();
  }

  function triggerValueFeedback(ids) {
    if (prefersReducedMotion()) return;
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('calc-updated');
      void el.offsetWidth;
      el.classList.add('calc-updated');
    });
  }

  function getMasterDocsWithUrls() {
    const rawFiles = Object.values((KB && KB.drive && KB.drive.files) || {});
    return MASTER_DOCS.map((d, idx) => {
      const match = rawFiles[idx] || {};
      return {
        ...d,
        url: match.url || 'https://drive.google.com/drive/folders/157nEr-14sON96VUaWsNkkpetWrMI_bQs',
      };
    });
  }

  function renderMarkdown(md) {
    const lines = String(md || '').replace(/\s*—\s*/g, ': ').split(/\r?\n/);
    let html = '';
    let inTable = false;
    let inList = false;
    const inline = (txt) =>
      esc(txt)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        const cells = line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim());
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        if (!inTable) {
          inTable = true;
          html += '<table><thead><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        } else {
          html += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        continue;
      } else if (inTable) {
        html += '</tbody></table>';
        inTable = false;
      }

      if (/^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${inline(line.replace(/^([-*•]|\d+\.)\s+/, ''))}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (line) html += `<p>${inline(line)}</p>`;
      }
    }
    if (inTable) html += '</tbody></table>';
    if (inList) html += '</ul>';
    return html;
  }

  // =====================================================================
  // A. BERANDA & EKSPLORASI INTERAKTIF LIMA JENJANG
  // =====================================================================
  function renderHeroUnitShowcase(animatePanel = false) {
    const tabsEl = document.getElementById('hero-unit-tabs');
    const panelEl = document.getElementById('hero-unit-panel');
    if (!tabsEl || !panelEl || !KB || !KB.units || !KB.units.length) return;

    const units = KB.units;
    const shortLabels = { PG: 'Playgroup', TK: 'TK Islam', SD: 'SDIT', SMP: 'SMPIT', SMA: 'SMAIT' };
    const activeUnit = units.find((u) => u.code === state.heroUnitCode) || units[0];
    state.heroUnitCode = activeUnit.code;

    tabsEl.innerHTML = units
      .map(
        (u) => `
      <button
        type="button"
        role="tab"
        data-hero-unit="${esc(u.code)}"
        aria-selected="${u.code === state.heroUnitCode ? 'true' : 'false'}"
        class="tab-btn ${u.code === state.heroUnitCode ? 'is-active' : ''}">
        ${esc(shortLabels[u.code] || u.code)}
      </button>
    `
      )
      .join('');

    const bindTabs = Array.from(tabsEl.querySelectorAll('[data-hero-unit]'));
    bindTabs.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const nextCode = btn.getAttribute('data-hero-unit');
        if (nextCode && nextCode !== state.heroUnitCode) {
          state.heroUnitCode = nextCode;
          renderHeroUnitShowcase(true);
        }
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const nextIdx = e.key === 'ArrowRight' ? (idx + 1) % bindTabs.length : (idx - 1 + bindTabs.length) % bindTabs.length;
        const target = bindTabs[nextIdx];
        state.heroUnitCode = target.getAttribute('data-hero-unit');
        renderHeroUnitShowcase(true);
        const refocused = tabsEl.querySelector(`[data-hero-unit="${state.heroUnitCode}"]`);
        if (refocused) refocused.focus();
      });
    });

    panelEl.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base sm:text-lg font-semibold text-ink-primary">${esc(activeUnit.nama)}</h3>
          <p class="text-xs text-ink-muted mt-0.5">Usia Masuk: ${esc(activeUnit.statuta.usia)}</p>
        </div>
        <span class="badge-pill max-w-full">${esc(activeUnit.kuota.rombel)}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
        <div class="p-3 rounded-lg border border-hairline bg-[var(--bg-surface)] space-y-1">
          <span class="text-ink-muted font-medium block">Jam Belajar Efektif</span>
          <strong class="text-ink-primary font-semibold block">${esc(activeUnit.statuta.jam)}</strong>
        </div>
        <div class="p-3 rounded-lg border border-hairline bg-[var(--bg-surface)] space-y-1">
          <span class="text-accent-emerald font-semibold block">Target Hafalan</span>
          <strong class="text-ink-primary font-semibold block">${esc(TAHFIDZ_TARGETS[activeUnit.code] || activeUnit.statuta.target)}</strong>
        </div>
        <div class="p-3 rounded-lg border border-hairline bg-[var(--bg-surface)] space-y-1">
          <span class="text-ink-muted font-medium block">Muatan Unggulan</span>
          <strong class="text-ink-primary font-semibold block">${esc(UNGGULAN_PROGRAMS[activeUnit.code])}</strong>
        </div>
      </div>

      <div class="pt-2 border-t border-hairline flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <span class="text-ink-muted">SPP Bulanan: </span>
          <strong class="font-mono font-semibold text-ink-primary">${R(activeUnit.biaya.spp)}</strong>
        </div>
        <a href="#ppdb" id="hero-calc-jump" class="font-semibold text-accent-emerald hover:underline">
          Hitung Estimasi Biaya ${esc(shortLabels[activeUnit.code] || activeUnit.code)} &rarr;
        </a>
      </div>
    `;

    if (animatePanel && !prefersReducedMotion()) {
      panelEl.classList.remove('showcase-swap');
      void panelEl.offsetWidth;
      panelEl.classList.add('showcase-swap');
    }

    const jumpBtn = document.getElementById('hero-calc-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const sel = document.getElementById('calc-unit');
        if (sel) {
          sel.value = activeUnit.code;
          runCalculator(true);
        }
      });
    }
  }

  function renderBeranda() {
    if (!KB || !KB.yayasan) return;
    const y = KB.yayasan;
    const skEl = document.getElementById('hero-sk');
    const visiEl = document.getElementById('hero-visi');
    if (skEl && y.sk) skEl.textContent = y.sk;
    if (visiEl && y.visi) visiEl.textContent = y.visi;
    renderHeroUnitShowcase(false);
  }

  // =====================================================================
  // B. PROFIL & TATA KELOLA
  // =====================================================================
  function renderProfil() {
    if (!KB || !KB.yayasan) return;
    const y = KB.yayasan;

    const addrEl = document.getElementById('profil-address');
    if (addrEl && y.address) addrEl.textContent = y.address;

    const gridEl = document.getElementById('profil-struktur-grid');
    if (!gridEl) return;

    const list = y.struktur || [];
    if (!list.length) {
      gridEl.innerHTML = `<div class="nextra-card text-sm text-ink-secondary md:col-span-2 lg:col-span-3">Data struktur kepemimpinan yayasan belum tersedia pada basis data.</div>`;
      return;
    }

    gridEl.innerHTML = list
      .map((s, idx) => {
        const isKepala = /^Kepala|^Koordinator/i.test(s.jabatan);
        const delay = (idx % 3) * 60;
        return `
        <article class="nextra-card flex flex-col justify-between gap-4 reveal-on-scroll" style="--stagger-delay: ${delay}ms;">
          <div class="space-y-1.5">
            <span class="text-xs font-semibold ${isKepala ? 'text-accent-emerald' : 'text-ink-muted'} block">
              ${esc(s.jabatan)}
            </span>
            <h3 class="text-base font-semibold text-ink-primary">${esc(s.nama)}</h3>
          </div>
          <p class="text-xs text-ink-secondary leading-relaxed border-t border-hairline pt-3">${esc(s.tugas)}</p>
        </article>
      `;
      })
      .join('');

    bindCardSpotlights(gridEl);
    observeReveals(gridEl);
  }

  // =====================================================================
  // C. UNIT PENDIDIKAN (5 Kartu Seragam dengan 3 Informasi Utama)
  // =====================================================================
  function renderUnit() {
    if (!KB || !KB.units) return;
    const gridEl = document.getElementById('unit-cards-grid');
    if (!gridEl) return;

    const units = KB.units || [];
    if (!units.length) {
      gridEl.innerHTML = `<div class="nextra-card text-sm text-ink-secondary md:col-span-2 lg:col-span-3">Data satuan pendidikan belum tersedia pada basis data.</div>`;
      return;
    }

    gridEl.innerHTML = units
      .map((u, idx) => {
        const delay = (idx % 3) * 60;
        return `
      <article class="nextra-card flex flex-col justify-between gap-6 reveal-on-scroll" style="--stagger-delay: ${delay}ms;">
        <div class="space-y-4">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="typo-h3">${esc(u.nama)}</h3>
              <p class="text-xs text-ink-muted mt-1">Usia Masuk: ${esc(u.statuta.usia)}</p>
            </div>
            <span class="badge-pill max-w-full">${esc(u.kuota.rombel)}</span>
          </div>

          <dl class="divide-y divide-[var(--border-subtle)] border-t border-hairline text-xs">
            <div class="py-3 space-y-1">
              <dt class="font-semibold text-ink-muted">1. Jam Belajar Efektif</dt>
              <dd class="text-sm font-semibold text-ink-primary">${esc(u.statuta.jam)}</dd>
            </div>

            <div class="py-3 space-y-1">
              <dt class="font-semibold text-accent-emerald">2. Target Hafalan Al-Qur'an</dt>
              <dd class="text-sm font-semibold text-ink-primary">${esc(TAHFIDZ_TARGETS[u.code] || u.statuta.target)}</dd>
            </div>

            <div class="py-3 space-y-1">
              <dt class="font-semibold text-ink-muted">3. Muatan Unggulan</dt>
              <dd class="text-sm font-semibold text-ink-primary">${esc(UNGGULAN_PROGRAMS[u.code])}</dd>
            </div>
          </dl>
        </div>

        <div class="pt-4 border-t border-hairline flex items-center justify-between gap-3 text-xs">
          <div>
            <span class="text-ink-muted block">SPP Bulanan</span>
            <strong class="text-sm font-mono font-semibold text-ink-primary">${R(u.biaya.spp)}</strong>
          </div>
          <a href="#ppdb" data-select-unit="${esc(u.code)}" class="btn-secondary !py-2 !px-4 !text-xs">
            <span>Hitung Biaya PPDB</span>
          </a>
        </div>
      </article>
    `;
      })
      .join('');

    gridEl.querySelectorAll('[data-select-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-select-unit');
        const sel = document.getElementById('calc-unit');
        if (sel && code) {
          sel.value = code;
          runCalculator(true);
        }
      });
    });

    bindCardSpotlights(gridEl);
    observeReveals(gridEl);
  }

  // =====================================================================
  // D. INFORMASI PPDB (Tabel Biaya Rata Kanan, Kalkulator, Kuota)
  // =====================================================================
  function runCalculator(animateNumbers = false) {
    if (!KB) return;
    const unitEl = document.getElementById('calc-unit');
    const waveEl = document.getElementById('calc-wave');
    const tahfidzEl = document.getElementById('calc-tahfidz');
    const alumniEl = document.getElementById('calc-alumni');
    const siblingEl = document.getElementById('calc-sibling');
    const yatimEl = document.getElementById('calc-yatim');
    if (!unitEl || !waveEl) return;

    const opts = {
      unit: unitEl.value,
      gelombang: waveEl.value,
      alumni: Boolean(alumniEl && alumniEl.checked),
      sibling: Boolean(siblingEl && siblingEl.checked),
      tahfidz: Number(tahfidzEl && tahfidzEl.value) || 0,
      yatim: Boolean(yatimEl && yatimEl.checked),
    };

    const res = window.YPIACore.simulate(KB, opts);
    if (!res) return;

    const c = res.cicilan;
    const l = res.lunas;

    const setTxt = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setTxt('calc-res-formulir', R(res.formulir));
    setTxt('calc-cicilan-pct', `Diskon ${c.dppPct}% DPP`);
    setTxt('calc-cicilan-total', R(c.daftarUlang));
    setTxt('calc-cicilan-dpp', R(c.dppNet));
    setTxt('calc-spp-nett', `${R(c.spp)}${c.sppPct ? ` (-${c.sppPct}%)` : ''}`);

    setTxt('calc-lunas-pct', `Diskon ${l.dppPct}% DPP`);
    setTxt('calc-lunas-total', R(l.daftarUlang));
    setTxt('calc-lunas-dpp', R(l.dppNet));
    setTxt('calc-lunas-hemat', R(l.hemat));

    if (animateNumbers) {
      triggerValueFeedback(['calc-cicilan-total', 'calc-lunas-total']);
    }
  }

  function renderLiveQuotaChart() {
    const chartEl = document.getElementById('ppdb-quota-chart');
    if (!chartEl) return;

    const totalAll = state.liveQuotaStats.reduce((s, q) => s + q.total, 0);
    const filledAll = state.liveQuotaStats.reduce((s, q) => s + q.filled, 0);
    const remAll = Math.max(0, totalAll - filledAll);

    const elTotal = document.getElementById('quota-summary-total');
    const elFilled = document.getElementById('quota-summary-filled');
    const elRem = document.getElementById('quota-summary-remaining');
    if (elTotal) elTotal.textContent = `${totalAll} Kursi`;
    if (elFilled) elFilled.textContent = `${filledAll} Siswa`;
    if (elRem) elRem.textContent = `${remAll} Kursi`;

    const reduce = prefersReducedMotion();

    chartEl.innerHTML = state.liveQuotaStats
      .map((q) => {
        const scale = Math.min(1, Math.max(0.05, q.filled / q.total)).toFixed(3);
        const remaining = Math.max(0, q.total - q.filled);
        return `
        <div class="sub-surface p-4 space-y-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <div>
              <strong class="text-ink-primary block">${esc(q.label)}</strong>
              <span class="text-xs text-ink-muted">${esc(q.rombel)}</span>
            </div>
            <div class="text-right">
              <span class="font-mono font-semibold text-ink-primary block">${q.filled} / ${q.total} Kursi</span>
              <span class="text-xs text-accent-emerald font-medium">Tersedia ${remaining} Kursi</span>
            </div>
          </div>
          <div class="quota-bar-track" role="progressbar" aria-label="Keterisian kuota ${esc(q.label)}" aria-valuenow="${q.filled}" aria-valuemin="0" aria-valuemax="${q.total}">
            <div class="quota-bar-fill" data-target-scale="${scale}" style="transform: scaleX(${reduce ? scale : 0});"></div>
          </div>
        </div>
      `;
      })
      .join('');

    quotaAnimated = reduce;
    animateQuotaBars();
  }

  function renderPPDB() {
    if (!KB || !KB.biaya) return;
    const tbody = document.getElementById('fee-master-tbody');
    if (tbody) {
      const units = KB.biaya.units || [];
      if (!units.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-ink-secondary py-6">Tabel biaya pendidikan belum tersedia.</td></tr>`;
      } else {
        tbody.innerHTML = units
          .map(
            (u) => `
          <tr>
            <td class="font-semibold text-ink-primary">${esc(u.nama)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.formulir)}</td>
            <td class="text-right font-mono font-semibold text-ink-primary">${R(u.dpp)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.paket)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.spp)}</td>
            <td class="text-right font-mono font-bold text-accent-emerald">${R(u.awalMasuk)}</td>
          </tr>
        `
          )
          .join('');
      }
    }

    renderLiveQuotaChart();
    runCalculator(false);
  }

  // =====================================================================
  // E. KONSULTASI & LAYANAN INFORMASI (Chatbot Minimalis & FAQ Akordeon)
  // =====================================================================
  function appendChatBubble(role, markdownText, options = {}) {
    const stream = document.getElementById('chat-messages');
    if (!stream) return null;
    const isUser = role === 'user';
    const isError = Boolean(options.isError);
    const wrap = document.createElement('div');
    wrap.className = `chat-msg-enter flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`;
    const bubbleClass = isUser
      ? 'chat-bubble-user px-4 py-3 text-xs leading-relaxed'
      : isError
      ? 'chat-bubble-err px-4 py-3 text-xs leading-relaxed'
      : 'chat-bubble-bot px-4 py-3 text-xs chat-md leading-relaxed';

    wrap.innerHTML = `
      <div class="w-8 h-8 rounded-full ${
        isUser ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)]' : 'bg-emerald-700 text-white'
      } flex items-center justify-center shrink-0 mt-0.5 text-xs">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
          isUser
            ? '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
            : '<path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>'
        }</svg>
      </div>
      <div class="max-w-[82%] ${bubbleClass}">
        ${isUser ? esc(markdownText) : renderMarkdown(markdownText)}
      </div>
    `;
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
    return wrap;
  }

  function resetChat() {
    state.chatHistory = [];
    const stream = document.getElementById('chat-messages');
    if (!stream) return;
    stream.innerHTML = '';
    appendChatBubble(
      'assistant',
      `Assalamu'alaikum Warahmatullahi Wabarakatuh, Bapak/Ibu.\n\nSelamat datang di Layanan Konsultasi Resmi **Yayasan Pendidikan Islam Al-Mun'imiyah**. Saya **Ustadzah Fatimah**, siap membantu menjawab pertanyaan seputar pendaftaran siswa baru, rincian biaya pendidikan, ketentuan beasiswa Statuta Pasal 9, kurikulum tahfidz, maupun nomor rekening Virtual Account resmi.`
    );
  }

  async function sendChatPrompt(promptText) {
    const msg = String(promptText || '').trim();
    if (!msg) return;

    appendChatBubble('user', msg);
    const inputEl = document.getElementById('chat-input');
    const submitBtn = document.getElementById('chat-submit');
    if (inputEl) inputEl.value = '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Mengirim...';
    }

    const loadingBubble = appendChatBubble('assistant', 'Sedang memeriksa rujukan resmi yayasan...');

    try {
      if (!KB) throw new Error('Basis pengetahuan belum siap.');
      let data;
      try {
        const res = await fetch('./api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history: state.chatHistory }),
        });
        if (!res.ok) throw new Error('Static');
        data = await res.json();
      } catch {
        data = window.YPIAAssistant.localAnswer(KB, msg, state.chatHistory);
      }
      if (loadingBubble) loadingBubble.remove();
      const reply = data.reply || 'Mohon maaf, terjadi kendala teknis pada layanan konsultasi.';
      state.chatHistory.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
      appendChatBubble('assistant', reply);
    } catch {
      if (loadingBubble) loadingBubble.remove();
      appendChatBubble(
        'assistant',
        'Maaf, layanan konsultasi gagal memproses pesan karena data basis pengetahuan belum termuat. Silakan muat ulang halaman ini.',
        { isError: true }
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Kirim Pesan';
      }
    }
  }

  function renderFAQ() {
    const listEl = document.getElementById('faq-items-list');
    if (!KB || !KB.faq) {
      if (listEl) listEl.innerHTML = `<div class="text-xs text-ink-secondary py-6 text-center">Daftar pertanyaan umum belum tersedia.</div>`;
      return;
    }

    const allowedCodes = ['A', 'B', 'C', 'D'];
    const catTitles = {
      A: 'Umum & Legalitas',
      B: 'Kurikulum & Tahfidz',
      C: 'Teknis PPDB',
      D: 'Biaya & VA Resmi',
    };
    const filteredCategories = KB.faq.categories.filter((c) => allowedCodes.includes(c.code));
    const cats = [
      { code: 'ALL', label: 'Semua Topik' },
      ...filteredCategories.map((c) => ({ code: c.code, label: catTitles[c.code] || `Kategori ${c.code}` })),
    ];

    const tabWrap = document.getElementById('faq-cat-tabs');
    if (tabWrap) {
      tabWrap.innerHTML = cats
        .map(
          (c) => `
        <button type="button" data-faq-cat="${esc(c.code)}" aria-pressed="${state.faqCategory === c.code}" class="tab-btn ${
            state.faqCategory === c.code ? 'is-active' : ''
          }">
          ${esc(c.label)}
        </button>
      `
        )
        .join('');

      tabWrap.querySelectorAll('[data-faq-cat]').forEach((b) => {
        b.addEventListener('click', () => {
          state.faqCategory = b.getAttribute('data-faq-cat');
          renderFAQ();
        });
      });
    }

    const q = state.faqQuery.toLowerCase().trim();
    const items = [];
    for (const cat of filteredCategories) {
      if (state.faqCategory !== 'ALL' && state.faqCategory !== cat.code) continue;
      for (const it of cat.items) {
        if (q && !`${it.q} ${it.a}`.toLowerCase().includes(q)) continue;
        items.push({ ...it, catLabel: catTitles[cat.code] || `Kategori ${cat.code}` });
      }
    }

    if (!listEl) return;
    if (!items.length) {
      listEl.innerHTML = `
        <div class="sub-surface p-5 text-center space-y-3 text-xs">
          <p class="text-ink-secondary">Tidak ada pertanyaan yang sesuai dengan kata kunci pencarian Anda.</p>
          <button type="button" id="btn-reset-faq" class="btn-secondary !py-1.5 !px-3.5 !text-xs">Tampilkan Semua Pertanyaan</button>
        </div>
      `;
      const resetFaqBtn = document.getElementById('btn-reset-faq');
      if (resetFaqBtn) {
        resetFaqBtn.addEventListener('click', () => {
          state.faqQuery = '';
          state.faqCategory = 'ALL';
          const faqSearchEl = document.getElementById('faq-search');
          if (faqSearchEl) faqSearchEl.value = '';
          renderFAQ();
        });
      }
      return;
    }

    listEl.innerHTML = items
      .map(
        (it) => `
      <details class="faq-detail text-xs">
        <summary class="font-semibold text-ink-primary cursor-pointer list-none flex items-center justify-between gap-3">
          <span class="leading-relaxed">${esc(it.q)}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="faq-chevron text-ink-muted shrink-0" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </summary>
        <p class="faq-answer text-ink-secondary leading-relaxed mt-3 pt-3">${esc(it.a)}</p>
      </details>
    `
      )
      .join('');
  }

  function renderKonsultasi() {
    resetChat();
    renderFAQ();
  }

  // =====================================================================
  // MODAL ARSIP RESMI YAYASAN (MURNI 5 BERKAS MASTER)
  // =====================================================================
  function renderDriveModal() {
    const masterDocs = getMasterDocsWithUrls();
    const folderLink = document.getElementById('drive-folder-link');
    if (folderLink) {
      folderLink.href = 'https://drive.google.com/drive/folders/157nEr-14sON96VUaWsNkkpetWrMI_bQs';
    }
    const listEl = document.getElementById('drive-files-list');
    if (!listEl) return;
    listEl.innerHTML = masterDocs
      .map(
        (d) => `
      <div class="sub-surface sub-surface-interactive p-4 flex items-center justify-between gap-4">
        <div>
          <div class="font-semibold text-ink-primary text-sm">${esc(d.title)}</div>
          <div class="text-xs text-ink-secondary mt-0.5">${esc(d.subtitle)}</div>
        </div>
        <a href="${esc(d.url)}" target="_blank" rel="noopener" class="btn-secondary !py-1.5 !px-3.5 !text-xs shrink-0" aria-label="Buka ${esc(d.title)} di tab baru">
          <span>Buka</span>
        </a>
      </div>
    `
      )
      .join('');
  }

  // =====================================================================
  // ERROR STATE HANDLER (R-27)
  // =====================================================================
  function renderErrorState(message) {
    const errorHtml = `
      <div class="error-card space-y-3 md:col-span-2 lg:col-span-3" role="alert">
        <p class="text-sm font-semibold">Gagal Memuat Data Resmi Lembaga</p>
        <p class="text-xs">${esc(message)}</p>
        <button type="button" data-retry-init class="btn-secondary !text-xs">Muat Ulang Data</button>
      </div>
    `;
    const profilGrid = document.getElementById('profil-struktur-grid');
    const unitGrid = document.getElementById('unit-cards-grid');
    const faqList = document.getElementById('faq-items-list');
    const feeBody = document.getElementById('fee-master-tbody');

    if (profilGrid) profilGrid.innerHTML = errorHtml;
    if (unitGrid) unitGrid.innerHTML = errorHtml;
    if (faqList) faqList.innerHTML = errorHtml;
    if (feeBody) feeBody.innerHTML = `<tr><td colspan="6" class="text-center text-ink-secondary py-6">Gagal memuat rincian biaya. Silakan muat ulang halaman.</td></tr>`;

    document.querySelectorAll('[data-retry-init]').forEach((btn) => {
      btn.addEventListener('click', init);
    });
  }

  // =====================================================================
  // DIALOG FOCUS TRAP & KEYBOARD EVENTS (R-32)
  // =====================================================================
  function openDriveModal() {
    const modal = document.getElementById('drive-modal');
    if (!modal) return;
    const openBtn = document.getElementById('btn-drive-status');
    lastFocusedEl = document.activeElement && document.activeElement !== document.body ? document.activeElement : openBtn;
    modal.classList.remove('hidden');
    const closeBtn = document.getElementById('btn-close-drive-modal');
    if (closeBtn) closeBtn.focus();
  }

  function closeDriveModal() {
    const modal = document.getElementById('drive-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
  }

  function setupEvents() {
    initThemeToggle();
    bindCardSpotlights();
    observeReveals();
    initScrollEngine();

    ['calc-unit', 'calc-wave', 'calc-tahfidz', 'calc-alumni', 'calc-sibling', 'calc-yatim'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => runCalculator(true));
    });

    const chatForm = document.getElementById('chat-form');
    if (chatForm) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const inputEl = document.getElementById('chat-input');
        if (inputEl) sendChatPrompt(inputEl.value);
      });
    }

    const clearBtn = document.getElementById('btn-clear-chat');
    if (clearBtn) clearBtn.addEventListener('click', resetChat);

    const faqSearch = document.getElementById('faq-search');
    if (faqSearch) {
      faqSearch.addEventListener('input', (e) => {
        state.faqQuery = e.target.value;
        renderFAQ();
      });
    }

    const modal = document.getElementById('drive-modal');
    const openModalBtn = document.getElementById('btn-drive-status');
    const closeModalBtn = document.getElementById('btn-close-drive-modal');
    if (openModalBtn) openModalBtn.addEventListener('click', openDriveModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeDriveModal);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDriveModal();
      });
      document.addEventListener('keydown', (e) => {
        if (modal.classList.contains('hidden')) return;
        if (e.key === 'Escape') {
          closeDriveModal();
          return;
        }
        if (e.key === 'Tab') {
          const focusables = modal.querySelectorAll('a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])');
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      });
    }

    const mobileMenu = document.getElementById('mobile-menu');
    const mobileBtn = document.getElementById('btn-mobile-menu');
    if (mobileBtn && mobileMenu) {
      const setMenuOpen = (open) => {
        mobileMenu.classList.toggle('hidden', !open);
        mobileBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      };
      mobileBtn.addEventListener('click', () => {
        const isClosed = mobileMenu.classList.contains('hidden');
        setMenuOpen(isClosed);
      });
      mobileMenu.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', () => setMenuOpen(false));
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !mobileMenu.classList.contains('hidden')) {
          setMenuOpen(false);
          mobileBtn.focus();
        }
      });
    }
  }

  let eventsBound = false;
  async function init() {
    if (!eventsBound) {
      setupEvents();
      eventsBound = true;
    }
    try {
      try {
        const res = await fetch('./api/kb');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        KB = await res.json();
      } catch {
        const res = await fetch('./data/kb.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        KB = await res.json();
      }
      renderBeranda();
      renderProfil();
      renderUnit();
      renderPPDB();
      renderKonsultasi();
      renderDriveModal();
      bindCardSpotlights();
      observeReveals();
    } catch (err) {
      renderErrorState(err && err.message ? err.message : 'Koneksi ke berkas data gagal.');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
