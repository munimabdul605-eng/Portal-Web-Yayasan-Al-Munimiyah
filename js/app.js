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
    PG: 'Hafal 15 Surat Pendek Juz 30 & Doa Harian',
    TK: 'Hafal Surat Pilihan Juz 30 (An-Naba s.d. An-Nas) & Pra-Tahsin Iqra',
    SD: 'Minimal 2 Juz Mutqin (Juz 30 & 29) Bersanad',
    SMP: 'Minimal 3 Juz Baru (Akumulasi 5 Juz Mutqin Bersanad)',
    SMA: 'Minimal 3 Juz Baru (Akumulasi 5–10 Juz Mutqin Bersanad)',
  };

  const UNGGULAN_PROGRAMS = {
    PG: 'Stimulasi Sensorik-Motorik & Kemandirian Toilet Training',
    TK: 'Eksplorasi Sains Anak, Literasi-Numerasi & Calistung Ramah Anak',
    SD: 'Shalat Berjamaah, Coding Kids & Bahasa Arab-Inggris Komunikatif',
    SMP: 'Bilingual Active Days, Robotika-IoT Dasar & Riset Remaja (KIR)',
    SMA: 'AI & Python Dasar, Entrepreneurship & Klinik Intensif PTN/IELTS',
  };

  const state = {
    heroUnitCode: 'SD',
    faqCategory: 'ALL',
    faqQuery: '',
    chatHistory: [],
    liveQuotaStats: [
      { code: 'PG', label: "Playgroup (PG) Al-Mun'imiyah", rombel: '2 Rombel (@15 Siswa)', filled: 2, total: 30 },
      { code: 'TK', label: 'TK Islam (TK A & TK B)', rombel: '4 Rombel (@20 Siswa)', filled: 3, total: 80 },
      { code: 'SD', label: "SDIT Al-Mun'imiyah", rombel: '4 Rombel (@28 Siswa)', filled: 6, total: 112 },
      { code: 'SMP', label: "SMPIT Al-Mun'imiyah", rombel: '4 Rombel (@30 Siswa)', filled: 4, total: 120 },
      { code: 'SMA', label: "SMAIT Al-Mun'imiyah", rombel: '4 Rombel (@30 Siswa)', filled: 5, total: 120 },
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

  const REVEAL_SELECTOR = '.reveal-on-scroll, .reveal-text, .reveal-row';
  const SECTION_IDS = ['beranda', 'profil', 'unit', 'ppdb', 'konsultasi'];
  const SECTION_META = {
    beranda: { kicker: 'Menu 01 · Beranda Utama', title: "Yayasan Pendidikan Islam Al-Mun'imiyah" },
    profil: { kicker: 'Menu 02 · Profil & Tata Kelola', title: 'Legalitas Badan Hukum & Struktur Kepemimpinan' },
    unit: { kicker: 'Menu 03 · Unit Pendidikan', title: 'Lima Jenjang Terakreditasi A (Unggul)' },
    ppdb: { kicker: 'Menu 04 · Informasi PPDB TA 2026/2027', title: 'Biaya Pendidikan, Beasiswa & Pendaftaran Online' },
    konsultasi: { kicker: 'Menu 05 · Konsultasi & Layanan', title: 'Asisten Informasi, FAQ & Rekening VA Resmi' },
  };
  let currentActiveNav = 'beranda';

  function syncSlidingPill(container, activeEl, indicatorSelector, activeClassOnContainer) {
    if (!container || !activeEl) return;
    const ind = container.querySelector(indicatorSelector);
    if (!ind) return;
    if (container.offsetParent === null) {
      ind.style.opacity = '0';
      return;
    }

    const next = {
      x: activeEl.offsetLeft,
      y: activeEl.offsetTop,
      w: activeEl.offsetWidth,
      h: activeEl.offsetHeight,
    };

    const prev = container._pillCache;
    if (prev && !prefersReducedMotion() && container._pillRecreated) {
      ind.style.transition = 'none';
      ind.style.transform = `translate3d(${prev.x}px, ${prev.y}px, 0)`;
      ind.style.width = `${prev.w}px`;
      ind.style.height = `${prev.h}px`;
      ind.style.opacity = '1';
      void ind.offsetWidth;
      ind.style.transition = '';
    }
    container._pillRecreated = false;
    container._pillCache = next;

    ind.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
    ind.style.width = `${next.w}px`;
    ind.style.height = `${next.h}px`;
    ind.style.opacity = '1';
    if (activeClassOnContainer) container.classList.add(activeClassOnContainer);
  }

  function setActiveNav(navId) {
    currentActiveNav = navId;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-nav') === navId);
    });
    const desktopNav = document.getElementById('desktop-nav');
    const activeDesktopLink = desktopNav ? desktopNav.querySelector(`[data-nav="${navId}"]`) : null;
    if (desktopNav && activeDesktopLink) {
      syncSlidingPill(desktopNav, activeDesktopLink, '#nav-active-indicator', 'has-nav-pill');
    }
  }

  function flushVisibleReveals() {
    const vh = window.innerHeight || 800;
    const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 48;
    const feeBody = document.getElementById('fee-master-tbody');
    const feeVisible = feeBody && (feeBody.getBoundingClientRect().top <= vh * 0.94 || atBottom);

    document.querySelectorAll('.reveal-ready:not(.is-visible)').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.89 || atBottom || (feeVisible && el.classList.contains('reveal-row'))) {
        el.classList.add('is-visible');
        if (revealObserver) revealObserver.unobserve(el);
      }
    });
  }

  function observeReveals(root = document) {
    const targets = root.querySelectorAll(REVEAL_SELECTOR);
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
              if (entry.target.classList.contains('reveal-row')) {
                document.querySelectorAll('#fee-master-tbody tr.reveal-row.reveal-ready').forEach((r) => {
                  r.classList.add('is-visible');
                  revealObserver.unobserve(r);
                });
              } else {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
              }
            }
          });
        },
        { threshold: 0.1, rootMargin: '0px 0px -10% 0px' }
      );
    }

    const vh = window.innerHeight || 800;
    const atBottom = window.scrollY + vh >= document.documentElement.scrollHeight - 48;
    const feeBody = document.getElementById('fee-master-tbody');
    const feeVisible = feeBody && (feeBody.getBoundingClientRect().top <= vh * 0.94 || atBottom);

    targets.forEach((el) => {
      if (el.classList.contains('is-visible')) return;
      const rect = el.getBoundingClientRect();
      if (rect.top <= vh * 0.89 || atBottom || (feeVisible && el.classList.contains('reveal-row'))) {
        el.classList.add('is-visible');
      } else {
        el.classList.add('reveal-ready');
        revealObserver.observe(el);
      }
    });
  }

  function countUpElement(el, target, suffix, duration = 740) {
    if (!el || prefersReducedMotion()) {
      if (el) el.textContent = `${target} ${suffix}`;
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(target * eased);
      el.textContent = `${val} ${suffix}`;
      if (t < 1) window.requestAnimationFrame(tick);
      else el.textContent = `${target} ${suffix}`;
    };
    window.requestAnimationFrame(tick);
  }

  function animateQuotaBars(force = false) {
    const fills = document.querySelectorAll('#ppdb-quota-chart .quota-bar-fill');
    if (!fills.length) return;

    const totalAll = state.liveQuotaStats.reduce((s, q) => s + q.total, 0);
    const filledAll = state.liveQuotaStats.reduce((s, q) => s + q.filled, 0);
    const remAll = Math.max(0, totalAll - filledAll);
    const elTotal = document.getElementById('quota-summary-total');
    const elFilled = document.getElementById('quota-summary-filled');
    const elRem = document.getElementById('quota-summary-remaining');

    if (prefersReducedMotion() || force) {
      fills.forEach((bar) => {
        const s = bar.getAttribute('data-target-scale') || '1';
        bar.style.transform = `scaleX(${s})`;
      });
      if (elTotal) elTotal.textContent = `${totalAll} Kursi`;
      if (elFilled) elFilled.textContent = `${filledAll} Siswa`;
      if (elRem) elRem.textContent = `${remAll} Kursi`;
      quotaAnimated = true;
      return;
    }

    const chartEl = document.getElementById('ppdb-quota-chart');
    if (!chartEl) return;
    const rect = chartEl.getBoundingClientRect();
    if (rect.top <= (window.innerHeight || 800) * 0.92 && !quotaAnimated) {
      quotaAnimated = true;
      countUpElement(elTotal, totalAll, 'Kursi');
      countUpElement(elFilled, filledAll, 'Siswa');
      countUpElement(elRem, remAll, 'Kursi');
      fills.forEach((bar, idx) => {
        const s = bar.getAttribute('data-target-scale') || '0.1';
        setTimeout(() => {
          bar.style.transform = `scaleX(${s})`;
        }, idx * 80);
      });
    }
  }

  function updateOverlapChoreography() {
    const heroShell = document.querySelector('.hero-banner-shell') || document.querySelector('.hero-depth-stage');
    const stacks = document.querySelectorAll('.stack-section > .stack-inner');
    if (prefersReducedMotion()) {
      if (heroShell) heroShell.style.setProperty('--hero-scroll', '0');
      stacks.forEach((inner) => {
        inner.classList.remove('is-receding');
        inner.style.setProperty('--exit-p', '0');
      });
      return;
    }

    if (heroShell) {
      const heroProgress = Math.min(1, Math.max(0, window.scrollY / 440));
      heroShell.style.setProperty('--hero-scroll', heroProgress.toFixed(3));
    }

    const vh = window.innerHeight || 800;
    stacks.forEach((inner) => {
      const parentRect = inner.parentElement.getBoundingClientRect();
      const exitP = Math.min(1, Math.max(0, (vh * 0.88 - parentRect.bottom) / (vh * 0.72)));
      inner.style.setProperty('--exit-p', exitP.toFixed(3));
      inner.classList.toggle('is-receding', exitP > 0.005);
    });
  }

  let smoothScrollRaf = 0;
  let navTransitionToken = 0;
  let navTimers = [];

  function clearNavTimers() {
    navTimers.forEach((id) => clearTimeout(id));
    navTimers = [];
  }

  function cancelSmoothScroll() {
    if (smoothScrollRaf) {
      window.cancelAnimationFrame(smoothScrollRaf);
      smoothScrollRaf = 0;
    }
  }

  function triggerSectionArrival(targetEl) {
    if (!targetEl || prefersReducedMotion()) return;
    targetEl.classList.remove('section-arrived');
    void targetEl.offsetWidth;
    targetEl.classList.add('section-arrived');
    navTimers.push(setTimeout(() => targetEl.classList.remove('section-arrived'), 580));
  }

  function replaySectionEntrance(targetEl, direction) {
    if (!targetEl || prefersReducedMotion()) return;
    const isHero = targetEl.id === 'beranda';
    const enterClass = direction === 'backward' ? 'section-entering-backward' : 'section-entering-forward';

    document.querySelectorAll('.section-entering-forward, .section-entering-backward, .hero-entry-wrap').forEach((s) => {
      s.classList.remove('section-entering-forward', 'section-entering-backward', 'hero-entry-wrap');
    });

    if (isHero) {
      const heroStage = targetEl.querySelector('.hero-depth-stage');
      if (heroStage) {
        heroStage.classList.add('hero-entry-wrap', enterClass);
        heroStage.querySelectorAll('.hero-anim-meta, .hero-anim-headline, .hero-anim-copy, .hero-anim-cta').forEach((node) => {
          node.style.animation = 'none';
          void node.offsetWidth;
          node.style.animation = '';
        });
      }
    } else {
      targetEl.classList.add(enterClass);
    }

    const items = targetEl.querySelectorAll(REVEAL_SELECTOR);
    items.forEach((item) => {
      if (revealObserver) revealObserver.unobserve(item);
      item.classList.remove('is-visible');
      item.classList.add('reveal-ready');
    });
    if (targetEl.id === 'ppdb') {
      quotaAnimated = false;
      document.querySelectorAll('#ppdb-quota-chart .quota-bar-fill').forEach((b) => {
        b.style.transform = 'scaleX(0)';
      });
    }
    void targetEl.offsetWidth;
    window.requestAnimationFrame(() => {
      observeReveals(targetEl);
      flushVisibleReveals();
      animateQuotaBars();
    });

    navTimers.push(
      setTimeout(() => {
        targetEl.classList.remove('section-entering-forward', 'section-entering-backward', 'hero-entry-wrap');
      }, 680)
    );
  }

  function smoothScrollToTarget(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const targetTop = targetId === 'beranda' ? 0 : Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - 74));

    if (prefersReducedMotion()) {
      window.scrollTo({ top: targetTop, behavior: 'auto' });
      return;
    }

    cancelSmoothScroll();
    const startY = window.scrollY;
    const distance = targetTop - startY;
    if (Math.abs(distance) < 4) {
      triggerSectionArrival(el);
      return;
    }

    const duration = Math.min(720, Math.max(380, Math.abs(distance) * 0.28));
    const startTime = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      window.scrollTo({ top: startY + distance * eased, behavior: 'auto' });
      if (progress < 1) {
        smoothScrollRaf = window.requestAnimationFrame(step);
      } else {
        smoothScrollRaf = 0;
        flushVisibleReveals();
        animateQuotaBars();
        triggerSectionArrival(el);
      }
    };
    smoothScrollRaf = window.requestAnimationFrame(step);
  }

  function navigateToSection(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const sheet = document.getElementById('page-transition-sheet');
    const curIdx = SECTION_IDS.indexOf(currentActiveNav);
    const nextIdx = SECTION_IDS.indexOf(targetId);

    if (prefersReducedMotion() || !sheet || nextIdx === -1 || curIdx === nextIdx) {
      smoothScrollToTarget(targetId);
      if (nextIdx !== -1) setActiveNav(targetId);
      return;
    }

    cancelSmoothScroll();
    clearNavTimers();
    const token = ++navTransitionToken;
    const isBackward = nextIdx < curIdx;
    const meta = SECTION_META[targetId] || { kicker: 'Membuka Bagian', title: targetId };

    setActiveNav(targetId);

    const kickerEl = document.getElementById('pts-kicker');
    const titleEl = document.getElementById('pts-title');
    if (kickerEl) kickerEl.textContent = meta.kicker;
    if (titleEl) titleEl.textContent = meta.title;

    sheet.className = 'page-transition-sheet';
    sheet.style.transition = 'none';
    sheet.style.transform = isBackward ? 'translate3d(0, -106%, 0)' : 'translate3d(0, 106%, 0)';
    sheet.style.visibility = 'visible';
    void sheet.offsetWidth;
    sheet.style.transition = '';
    sheet.style.transform = '';
    sheet.classList.add('is-covering');

    navTimers.push(
      setTimeout(() => {
        if (token !== navTransitionToken) return;
        const targetTop = targetId === 'beranda' ? 0 : Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - 74));
        window.scrollTo({ top: targetTop, behavior: 'instant' });

        const docEl = document.documentElement;
        const maxScroll = Math.max(1, docEl.scrollHeight - window.innerHeight);
        const ratio = Math.min(1, Math.max(0, window.scrollY / maxScroll));
        const bar = document.getElementById('scroll-progress-bar');
        if (bar) bar.style.transform = `scaleX(${ratio.toFixed(4)})`;

        updateOverlapChoreography();

        navTimers.push(
          setTimeout(() => {
            if (token !== navTransitionToken) return;
            replaySectionEntrance(el, isBackward ? 'backward' : 'forward');
            sheet.classList.remove('is-covering');
            sheet.classList.add(isBackward ? 'is-exiting-down' : 'is-exiting-up');

            navTimers.push(
              setTimeout(() => {
                if (token !== navTransitionToken) return;
                sheet.className = 'page-transition-sheet';
                sheet.style.visibility = '';
              }, 460)
            );
          }, 70)
        );
      }, 360)
    );
  }

  function initScrollEngine() {
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
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= y) current = id;
      }
      if (window.scrollY > 120 && window.scrollY + window.innerHeight >= docEl.scrollHeight - 24) {
        current = SECTION_IDS[SECTION_IDS.length - 1];
      }
      if (current !== currentActiveNav) {
        setActiveNav(current);
      }

      updateOverlapChoreography();
      flushVisibleReveals();
      animateQuotaBars();
    };

    const resyncAllSlidingPills = () => {
      setActiveNav(currentActiveNav);
      const heroTabs = document.getElementById('hero-unit-tabs');
      const heroActive = heroTabs ? heroTabs.querySelector('[data-hero-unit].is-active') : null;
      if (heroTabs && heroActive) syncSlidingPill(heroTabs, heroActive, '.tab-sliding-indicator');
      const faqTabs = document.getElementById('faq-cat-tabs');
      const faqActive = faqTabs ? faqTabs.querySelector('[data-faq-cat][aria-pressed="true"]') : null;
      if (faqTabs && faqActive) syncSlidingPill(faqTabs, faqActive, '.tab-sliding-indicator');
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
    window.addEventListener('wheel', cancelSmoothScroll, { passive: true });
    window.addEventListener('touchstart', cancelSmoothScroll, { passive: true });
    window.addEventListener(
      'resize',
      () => {
        updateOverlapChoreography();
        flushVisibleReveals();
        resyncAllSlidingPills();
      },
      { passive: true }
    );

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(resyncAllSlidingPills);
    }

    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href^="#"]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.length < 2) return;
      const targetId = href.slice(1);
      if (targetId === 'main-content') return;
      const targetEl = document.getElementById(targetId);
      if (!targetEl) return;
      e.preventDefault();
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', href);
      }
      navigateToSection(targetId);
    });

    setActiveNav('beranda');
    onFrame();
  }

  const DOC_KEYS = ['statuta', 'biaya', 'ppdb', 'kurikulum', 'faq'];

  function getMasterDocsWithUrls() {
    const files = (KB && KB.drive && KB.drive.files) || {};
    return MASTER_DOCS.map((d, idx) => {
      const key = DOC_KEYS[idx];
      const match = (key && files[key]) || {};
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
          html += '<div class="chat-table-wrap"><table><thead><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
        } else {
          html += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
        }
        continue;
      } else if (inTable) {
        html += '</tbody></table></div>';
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
    if (inTable) html += '</tbody></table></div>';
    if (inList) html += '</ul>';
    return html;
  }

  // =====================================================================
  // A. BERANDA & EKSPLORASI INTERAKTIF LIMA JENJANG
  // =====================================================================
  function renderHeroUnitShowcase(animateDir = null) {
    const tabsEl = document.getElementById('hero-unit-tabs');
    const panelEl = document.getElementById('hero-unit-panel');
    if (!tabsEl || !panelEl || !KB || !KB.units || !KB.units.length) return;

    const units = KB.units;
    const shortLabels = { PG: 'Playgroup', TK: 'TK Islam', SD: 'SDIT', SMP: 'SMPIT', SMA: 'SMAIT' };
    const activeUnit = units.find((u) => u.code === state.heroUnitCode) || units[0];
    const currentIdx = units.findIndex((u) => u.code === activeUnit.code);
    state.heroUnitCode = activeUnit.code;

    tabsEl._pillRecreated = true;
    tabsEl.classList.add('has-sliding-pill');
    tabsEl.innerHTML =
      '<span class="tab-sliding-indicator" aria-hidden="true"></span>' +
      units
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

    const activeTabBtn = tabsEl.querySelector('[data-hero-unit].is-active');
    if (activeTabBtn) syncSlidingPill(tabsEl, activeTabBtn, '.tab-sliding-indicator');

    const bindTabs = Array.from(tabsEl.querySelectorAll('[data-hero-unit]'));
    bindTabs.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const nextCode = btn.getAttribute('data-hero-unit');
        if (nextCode && nextCode !== state.heroUnitCode) {
          const dir = idx >= currentIdx ? 'next' : 'prev';
          state.heroUnitCode = nextCode;
          renderHeroUnitShowcase(dir);
        }
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 'next' : 'prev';
        const nextIdx = dir === 'next' ? (idx + 1) % bindTabs.length : (idx - 1 + bindTabs.length) % bindTabs.length;
        const target = bindTabs[nextIdx];
        state.heroUnitCode = target.getAttribute('data-hero-unit');
        renderHeroUnitShowcase(dir);
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
        <span class="badge-accent max-w-full">${esc(activeUnit.kuota.rombel)}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
        <div class="p-3.5 rounded-2xl border border-hairline bg-[var(--bg-surface)] space-y-1">
          <span class="text-ink-muted font-medium block">Jam Belajar Efektif</span>
          <strong class="text-ink-primary font-semibold block">${esc(activeUnit.statuta.jam)}</strong>
        </div>
        <div class="p-3.5 rounded-2xl border border-[var(--accent-brand-border)] bg-[var(--accent-brand-soft)] space-y-1">
          <span class="text-accent-brand font-semibold block">Target Hafalan</span>
          <strong class="text-ink-primary font-semibold block">${esc(TAHFIDZ_TARGETS[activeUnit.code] || activeUnit.statuta.target)}</strong>
        </div>
        <div class="p-3.5 rounded-2xl border border-hairline bg-[var(--bg-surface)] space-y-1">
          <span class="text-ink-muted font-medium block">Muatan Unggulan</span>
          <strong class="text-ink-primary font-semibold block">${esc(UNGGULAN_PROGRAMS[activeUnit.code])}</strong>
        </div>
      </div>

      <div class="pt-2 border-t border-hairline flex flex-wrap items-center justify-between gap-3 text-xs">
        <div>
          <span class="text-ink-muted">SPP Bulanan: </span>
          <strong class="font-mono font-semibold text-ink-primary">${R(activeUnit.biaya.spp)}</strong>
        </div>
        <a href="#ppdb" class="font-semibold text-accent-brand hover:underline">
          Lihat Rincian Biaya &amp; Jadwal PPDB &rarr;
        </a>
      </div>
    `;

    if (animateDir && !prefersReducedMotion()) {
      panelEl.classList.remove('showcase-slide-next', 'showcase-slide-prev');
      void panelEl.offsetWidth;
      panelEl.classList.add(animateDir === 'prev' ? 'showcase-slide-prev' : 'showcase-slide-next');
    }
  }

  function renderBeranda() {
    if (!KB || !KB.yayasan) return;
    const y = KB.yayasan;
    const skEl = document.getElementById('hero-sk');
    const visiEl = document.getElementById('hero-visi');
    if (skEl && y.sk) skEl.textContent = y.sk;
    if (visiEl && y.visi) visiEl.textContent = y.visi;
    renderHeroUnitShowcase(null);
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
        const badgeClass = isKepala
          ? 'badge-accent'
          : 'badge-pill !border-[var(--accent-brand-border)] !text-[var(--accent-brand-ink)]';
        return `
        <article class="nextra-card flex flex-col justify-between gap-4 reveal-on-scroll" style="--stagger-delay: ${delay}ms;">
          <div class="space-y-2.5">
            <span class="${badgeClass} w-fit">
              ${esc(s.jabatan)}
            </span>
            <h3 class="text-base font-semibold text-ink-primary">${esc(s.nama)}</h3>
          </div>
          <p class="text-xs text-ink-secondary leading-relaxed border-t border-[var(--accent-brand-border)] pt-3">${esc(s.tugas)}</p>
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
            <span class="badge-accent max-w-full">${esc(u.kuota.rombel)}</span>
          </div>

          <dl class="space-y-2.5 border-t border-hairline pt-4 text-xs">
            <div class="sub-surface p-3.5 space-y-1">
              <dt class="font-semibold text-ink-muted">1. Jam Belajar Efektif</dt>
              <dd class="text-sm font-semibold text-ink-primary">${esc(u.statuta.jam)}</dd>
            </div>

            <div class="notice-accent rounded-2xl p-3.5 space-y-1">
              <dt class="font-semibold">2. Target Hafalan Al-Qur'an</dt>
              <dd class="text-sm font-semibold text-ink-primary">${esc(TAHFIDZ_TARGETS[u.code] || u.statuta.target)}</dd>
            </div>

            <div class="sub-surface p-3.5 space-y-1">
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
          <a href="#ppdb" class="btn-with-icon btn-with-icon-sm group no-underline" title="Lihat Biaya &amp; Jadwal ${esc(u.nama)}">
            <span class="relative z-10 transition-all duration-500 whitespace-nowrap">
              Lihat Biaya &amp; Jadwal
            </span>
            <div class="btn-icon-circle" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </div>
          </a>
        </div>
      </article>
    `;
      })
      .join('');

    bindCardSpotlights(gridEl);
    observeReveals(gridEl);
  }

  // =====================================================================
  // D. INFORMASI PPDB (Tabel Biaya, Timeline 3 Gelombang, Checklist Berkas, Kuota)
  // =====================================================================
  function renderLiveQuotaChart() {
    const chartEl = document.getElementById('ppdb-quota-chart');
    if (!chartEl) return;

    const totalAll = state.liveQuotaStats.reduce((s, q) => s + q.total, 0);
    const filledAll = state.liveQuotaStats.reduce((s, q) => s + q.filled, 0);
    const remAll = Math.max(0, totalAll - filledAll);

    const elTotal = document.getElementById('quota-summary-total');
    const elFilled = document.getElementById('quota-summary-filled');
    const elRem = document.getElementById('quota-summary-remaining');
    const elBadge = document.getElementById('quota-badge-summary');
    if (elTotal) elTotal.textContent = `${totalAll} Kursi`;
    if (elFilled) elFilled.textContent = `${filledAll} Siswa`;
    if (elRem) elRem.textContent = `${remAll} Kursi`;
    if (elBadge) elBadge.innerHTML = `Total ${totalAll} Kursi &middot; ${filledAll} Terisi`;

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
              <span class="text-xs text-accent-brand font-medium">Tersedia ${remaining} Kursi</span>
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

  // =====================================================================
  // D.1 AUTO-SYNC LIVE KUOTA DARI GOOGLE SHEETS PUBLIK
  // =====================================================================
  async function syncLiveQuotaFromSheets() {
    const SHEETS_CSV_URL =
      'https://docs.google.com/spreadsheets/d/1GzdjUBtnrKXPgZvCebYhQ6iAU0jkhgFNKDWeN6wzMa4/gviz/tq?tqx=out:csv&sheet=3_Dashboard_Kuota';
    try {
      const res = await fetch(SHEETS_CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const csvText = await res.text();

      // Parser CSV sederhana berkoma dengan quotes ganda
      const parseCsvLine = (line) => {
        const values = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              current += '"';
              i++;
            } else {
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim().replace(/^"|"$/g, ''));
        return values;
      };

      const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      let updatedCount = 0;

      lines.forEach((line) => {
        const cols = parseCsvLine(line);
        if (!cols || cols.length < 4) return;
        const code = (cols[0] || '').toUpperCase().trim();
        const stat = state.liveQuotaStats.find((q) => q.code === code);
        if (stat) {
          const totalVal = parseInt((cols[2] || '').replace(/[^\d]/g, ''), 10);
          const filledVal = parseInt((cols[3] || '').replace(/[^\d]/g, ''), 10);
          if (!isNaN(filledVal)) {
            stat.filled = filledVal;
            updatedCount++;
          }
          if (!isNaN(totalVal) && totalVal > 0) {
            stat.total = totalVal;
          }
        }
      });

      if (updatedCount > 0) {
        renderLiveQuotaChart();
        animateQuotaBars(true);

        const totalAll = state.liveQuotaStats.reduce((s, q) => s + q.total, 0);
        const filledAll = state.liveQuotaStats.reduce((s, q) => s + q.filled, 0);
        const elBadge = document.getElementById('quota-badge-summary');
        if (elBadge) {
          elBadge.innerHTML = `Total ${totalAll} Kursi &middot; ${filledAll} Terisi`;
        }
      }
    } catch (err) {
      console.warn('[PPDB Quota Auto-Sync] Menggunakan data lokal:', err && err.message ? err.message : err);
    }
  }

  window.syncLiveQuotaFromSheets = syncLiveQuotaFromSheets;

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
            (u, idx) => `
          <tr class="reveal-row" style="--stagger-delay: ${idx * 55}ms;">
            <td class="font-semibold text-ink-primary">${esc(u.nama)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.formulir)}</td>
            <td class="text-right font-mono font-semibold text-ink-primary">${R(u.dpp)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.paket)}</td>
            <td class="text-right font-mono text-ink-secondary">${R(u.spp)}</td>
            <td class="text-right font-mono font-bold text-accent-brand">${R(u.awalMasuk)}</td>
          </tr>
        `
          )
          .join('');
        observeReveals(tbody);
      }
    }

    renderLiveQuotaChart();
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
        isUser ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)]' : 'chat-avatar-bot'
      } flex items-center justify-center shrink-0 mt-0.5 text-xs">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
          isUser
            ? '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>'
            : '<path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>'
        }</svg>
      </div>
      <div class="max-w-[82%] min-w-0 ${bubbleClass}">
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
    const submitTextEl = submitBtn ? submitBtn.querySelector('.chat-btn-text') : null;
    if (inputEl) inputEl.value = '';
    if (submitBtn) {
      submitBtn.disabled = true;
      if (submitTextEl) submitTextEl.textContent = 'Mengirim...';
      else submitBtn.textContent = 'Mengirim...';
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
        if (submitTextEl) submitTextEl.textContent = 'Kirim Pesan';
        else submitBtn.textContent = 'Kirim Pesan';
      }
    }
  }

  function renderFAQ(cascade = false) {
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
      tabWrap._pillRecreated = true;
      tabWrap.classList.add('has-sliding-pill');
      tabWrap.innerHTML =
        '<span class="tab-sliding-indicator" aria-hidden="true"></span>' +
        cats
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

      const activeFaqBtn = tabWrap.querySelector('[data-faq-cat][aria-pressed="true"]');
      if (activeFaqBtn) syncSlidingPill(tabWrap, activeFaqBtn, '.tab-sliding-indicator');

      tabWrap.querySelectorAll('[data-faq-cat]').forEach((b) => {
        b.addEventListener('click', () => {
          state.faqCategory = b.getAttribute('data-faq-cat');
          renderFAQ(true);
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
        <div class="sub-surface p-5 text-center space-y-3 text-xs faq-cascade">
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
          renderFAQ(true);
        });
      }
      return;
    }

    const useCascade = cascade && !prefersReducedMotion();
    listEl.innerHTML = items
      .map(
        (it, idx) => `
      <details class="faq-detail text-xs ${useCascade ? 'faq-cascade' : ''}" style="--faq-delay: ${Math.min(idx, 6) * 32}ms;">
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
    renderFAQ(false);
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
        (d, idx) => `
      <div class="modal-doc-item sub-surface sub-surface-interactive p-4 flex items-center justify-between gap-4" style="--doc-delay: ${idx * 48}ms;">
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

    // PPDB Online Form Radio Cards Selection State
    const ppdbForm = document.getElementById('ppdb-online-form');
    if (ppdbForm) {
      ppdbForm.addEventListener('change', (e) => {
        if (e.target && e.target.type === 'radio') {
          const radioName = e.target.name;
          const groupRadios = ppdbForm.querySelectorAll(`input[type="radio"][name="${radioName}"]`);
          groupRadios.forEach((r) => {
            const card = r.closest('.form-radio-card');
            if (card) {
              if (r.checked) {
                card.classList.add('is-selected');
              } else {
                card.classList.remove('is-selected');
              }
            }
          });
        }
      });

      // PPDB Form Submission Handler
      ppdbForm.addEventListener('submit', () => {
        const submitBtn = document.getElementById('btn-submit-ppdb');
        const submitText = document.getElementById('btn-submit-ppdb-text');
        if (submitBtn) submitBtn.disabled = true;
        if (submitText) submitText.textContent = 'Mengirim Data Pendaftaran...';

        const studentName = document.getElementById('ppdb-student-name')?.value || '-';
        const unitRadio = ppdbForm.querySelector('input[name="entry.886746899"]:checked')?.value || '-';
        const waveRadio = ppdbForm.querySelector('input[name="entry.1502592928"]:checked')?.value || '-';
        const discountCat = document.getElementById('ppdb-discount-cat')?.value || '-';
        const tahfidzCat = document.getElementById('ppdb-tahfidz-cat')?.value || '-';
        const parentName = document.getElementById('ppdb-parent-name')?.value || '-';
        const parentPhone = document.getElementById('ppdb-parent-phone')?.value || '-';

        setTimeout(() => {
          if (submitBtn) submitBtn.disabled = false;
          if (submitText) submitText.textContent = 'Kirim Formulir Pendaftaran Sekarang';

          const successBanner = document.getElementById('ppdb-success-banner');
          const summaryEl = document.getElementById('ppdb-success-summary');
          const waBtn = document.getElementById('ppdb-wa-confirm-btn');

          if (summaryEl) {
            summaryEl.innerHTML = `
              <div>&bull; Calon Siswa: <strong>${esc(studentName)}</strong></div>
              <div>&bull; Jenjang: <strong>${esc(unitRadio)}</strong> &middot; Gelombang: <strong>${esc(waveRadio)}</strong></div>
              <div>&bull; Diskon: <strong>${esc(discountCat)}</strong> &middot; Tahfidz: <strong>${esc(tahfidzCat)}</strong></div>
              <div>&bull; Orang Tua/Wali: <strong>${esc(parentName)}</strong> (${esc(parentPhone)})</div>
            `;
          }

          if (waBtn) {
            const waMsg = `Assalamu'alaikum Admin PPDB YPIA. Saya telah mengisi formulir online untuk calon siswa: ${studentName} (Jenjang ${unitRadio}, ${waveRadio}). Mohon konfirmasi nomor registrasi & VA resmi. Terima kasih.`;
            waBtn.href = `https://wa.me/6281122334455?text=${encodeURIComponent(waMsg)}`;
          }

          if (successBanner) {
            successBanner.classList.remove('hidden');
            successBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }

          ppdbForm.reset();
          const sdCard = ppdbForm.querySelector('input[value="SD"]')?.closest('.form-radio-card');
          const g1Card = ppdbForm.querySelector('input[value="Gelombang 1"]')?.closest('.form-radio-card');
          const lunasCard = ppdbForm.querySelector('input[value="LUNAS"]')?.closest('.form-radio-card');
          ppdbForm.querySelectorAll('.form-radio-card').forEach((c) => c.classList.remove('is-selected'));
          if (sdCard) sdCard.classList.add('is-selected');
          if (g1Card) g1Card.classList.add('is-selected');
          if (lunasCard) lunasCard.classList.add('is-selected');
        }, 600);
      });
    }

    const resetBannerBtn = document.getElementById('btn-reset-ppdb-banner');
    if (resetBannerBtn) {
      resetBannerBtn.addEventListener('click', () => {
        const successBanner = document.getElementById('ppdb-success-banner');
        if (successBanner) successBanner.classList.add('hidden');
      });
    }

    // Toggle Google Forms Fallback Frame
    const toggleFrameBtn = document.getElementById('btn-toggle-google-frame');
    const fallbackWrapper = document.getElementById('google-forms-fallback-wrapper');
    const googleIframe = document.getElementById('google-forms-iframe-el');
    if (toggleFrameBtn && fallbackWrapper) {
      toggleFrameBtn.addEventListener('click', () => {
        const isHidden = fallbackWrapper.classList.toggle('hidden');
        if (!isHidden && googleIframe && (!googleIframe.src || googleIframe.src === 'about:blank')) {
          googleIframe.src = googleIframe.dataset.src || '';
        }
        toggleFrameBtn.textContent = isHidden
          ? 'Lihat Tampilan Google Forms Asli ↗'
          : 'Sembunyikan Google Forms Asli ↖';
      });
    }

    // Auto-hide Floating FAB saat berada di area Konsultasi agar tidak menutupi tombol Kirim Pesan
    const chatSection = document.getElementById('konsultasi');
    const floatingFab = document.getElementById('floating-chatbot-widget');
    if (chatSection && floatingFab && 'IntersectionObserver' in window) {
      const chatFabObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              floatingFab.classList.add('fab-hidden-on-chat');
            } else {
              floatingFab.classList.remove('fab-hidden-on-chat');
            }
          });
        },
        { threshold: 0.1 }
      );
      chatFabObserver.observe(chatSection);
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
      window.requestAnimationFrame(() => {
        updateOverlapChoreography();
        flushVisibleReveals();
        animateQuotaBars();
      });

      // Live Auto-Sync Kuota PPDB dari Google Sheets
      await syncLiveQuotaFromSheets();
    } catch (err) {
      renderErrorState(err && err.message ? err.message : 'Koneksi ke berkas data gagal.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
// ===============================================================
// FITUR LIVE REALTIME AUTO-SYNC KUOTA PPDB DARI GOOGLE SPREADSHEET
// ===============================================================
async function syncLiveQuotaFromSheets() {
  const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1GzdjUBtnrKXPgZvCebYhQ6iAU0jkhgFNKDWeN6wzMa4/gviz/tq?tqx=out:csv&sheet=Form%20Responses%201";

  try {
    const response = await fetch(SHEET_CSV_URL);
    if (!response.ok) throw new Error("Gagal mengambil data Spreadsheet");
    const csvText = await response.text();

    // Memecah baris CSV
    const rows = csvText.trim().split("\n");
    if (rows.length <= 1) return; // Belum ada data respon

    // Hitung pendaftar per jenjang dari Form Responses 1
    const counts = { PG: 0, TK: 0, SD: 0, SMP: 0, SMA: 0 };
    
    // Looping dari baris ke-2 (lewati header)
    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i].split(",");
      if (cols.length >= 3) {
        // Kolom C (indeks 2) adalah Jenjang Pendidikan
        const jenjang = cols[2].replace(/"/g, "").trim().toUpperCase();
        if (counts.hasOwnProperty(jenjang)) {
          counts[jenjang]++;
        }
      }
    }

    // Update nilai filled pada state lokal secara dinamis
    let totalFilled = 0;
    state.liveQuotaStats.forEach(item => {
      if (counts.hasOwnProperty(item.code)) {
        item.filled = counts[item.code];
        totalFilled += item.filled;
      }
    });

    // Render ulang grafik batang kuota di layar
    if (typeof animateQuotaBars === "function") {
      animateQuotaBars(true);
    }

    // Update teks badge kuota di header PPDB jika ada
    const badge = document.querySelector(".badge-accent");
    if (badge && badge.textContent.includes("Kursi")) {
      badge.textContent = `Total 462 Kursi · ${totalFilled} Terisi`;
    }

    console.log(`[PPDB Live Sync] Sukses! Terbaca ${totalFilled} pendaftar realtime dari Google Form.`);
  } catch (error) {
    console.warn("[PPDB Live Sync] Menggunakan fallback data lokal:", error);
  }
}
document.addEventListener("DOMContentLoaded", syncLiveQuotaFromSheets);
// ===============================================================
// OTOMASI REALTIME: LIVE SYNC KUOTA PPDB LANGSUNG DARI GOOGLE FORM
// ===============================================================
async function syncLiveQuotaFromSheets() {
  // Mengambil data respon mentah langsung dari Google Spreadsheet
  const GVIZ_URL = "https://docs.google.com/spreadsheets/d/1GzdjUBtnrKXPgZvCebYhQ6iAU0jkhgFNKDWeN6wzMa4/gviz/tq?tqx=out:json&sheet=Form%20Responses%201";

  try {
    const res = await fetch(GVIZ_URL);
    const text = await res.text();
    
    // Parsing format JSON Google Visualization
    const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const data = JSON.parse(jsonStr);
    const rows = data.table.rows;

    if (!rows || rows.length === 0) return;

    // Reset hitungan jenjang
    const counts = { PG: 0, TK: 0, SD: 0, SMP: 0, SMA: 0 };
    let totalPendaftar = 0;

    // Iterasi setiap pendaftar yang masuk dari Google Form
    rows.forEach(r => {
      // Kolom C (indeks 2) adalah Jenjang Pendidikan Tujuan
      if (r.c && r.c[2] && r.c[2].v) {
        const jenjangStr = r.c[2].v.toString().trim().toUpperCase();
        for (const code of ["PG", "TK", "SD", "SMP", "SMA"]) {
          if (jenjangStr.includes(code)) {
            counts[code]++;
            totalPendaftar++;
            break;
          }
        }
      }
    });

    // 1. Update nilai kuota terisi di objek state lokal
    if (typeof state !== "undefined" && state.liveQuotaStats) {
      state.liveQuotaStats.forEach(item => {
        if (counts[item.code] !== undefined) {
          item.filled = counts[item.code];
        }
      });
    }

    // 2. Render ulang grafik batang kuota
    if (typeof animateQuotaBars === "function") {
      animateQuotaBars(true);
    }

    // 3. Update total terisi di kotak ringkasan atas
    const elFilled = document.getElementById("quota-summary-filled");
    if (elFilled) elFilled.textContent = `${totalPendaftar} Siswa`;

    const elRem = document.getElementById("quota-summary-remaining");
    if (elRem) elRem.textContent = `${Math.max(0, 462 - totalPendaftar)} Kursi`;

    // 4. Update teks badge pill
    const badge = document.querySelector(".badge-accent");
    if (badge && badge.textContent.includes("Kursi")) {
      badge.textContent = `Total 462 Kursi · ${totalPendaftar} Terisi`;
    }

    console.log(`✅ [Realtime Sync] Berhasil! Terdeteksi ${totalPendaftar} pendaftar live dari Google Form.`);
  } catch (err) {
    console.warn("⚠️ [Realtime Sync Gagal, gunakan data default]:", err);
  }
}

// Jalankan otomatis begitu web terbuka
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncLiveQuotaFromSheets);
} else {
  syncLiveQuotaFromSheets();
}
// ===============================================================
// FITUR REALTIME AUTO-SYNC VIA GOOGLE APPS SCRIPT WEB APP
// ===============================================================
async function syncLiveQuotaFromSheets() {
  const API_URL = "https://script.google.com/macros/s/AKfycbzUu7d7mYQu-L4gzWtWESdoQBTmCWcAvrAPYFOwg_78S7N71koRsscJVNHG4hqPTTAo0w/exec";

  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    
    if (!data || !data.counts) return;

    // 1. Update kuota terisi tiap jenjang di state lokal
    if (typeof state !== "undefined" && state.liveQuotaStats) {
      state.liveQuotaStats.forEach(item => {
        if (data.counts[item.code] !== undefined) {
          item.filled = data.counts[item.code];
        }
      });
    }

    // 2. Render ulang grafik batang kuota di layar
    if (typeof animateQuotaBars === "function") {
      animateQuotaBars(true);
    }

    // 3. Update kartu ringkasan kuota atas
    const elFilled = document.getElementById("quota-summary-filled");
    if (elFilled) elFilled.textContent = `${data.total} Siswa`;

    const elRem = document.getElementById("quota-summary-remaining");
    if (elRem) elRem.textContent = `${Math.max(0, 462 - data.total)} Kursi`;

    // 4. Update teks badge pill di header PPDB
    const badge = document.querySelector(".badge-accent");
    if (badge && badge.textContent.includes("Kursi")) {
      badge.textContent = `Total 462 Kursi · ${data.total} Terisi`;
    }

    console.log(`✅ [Realtime Sync] Berhasil! Terbaca ${data.total} pendaftar live dari Google Form.`);
  } catch (err) {
    console.warn("⚠️ [Realtime Sync Gagal, gunakan data default]:", err);
  }
}

// Jalankan otomatis begitu web selesai dimuat
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", syncLiveQuotaFromSheets);
} else {
  syncLiveQuotaFromSheets();
}
