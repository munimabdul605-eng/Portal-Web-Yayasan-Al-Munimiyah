/**
 * Portal Web Terpadu YPIA (SI-YAYASAN) — Frontend Controller
 * Merender seluruh 5 modul utama dari Knowledge Base `/api/kb` (Google Drive "data masukan").
 */
(function () {
  const R = window.YPIACore.formatRp;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let KB = null;
  let state = {
    heroUnit: 'SD',
    selectedUnitFilter: 'ALL',
    strukturFilter: 'all',
    faqCategory: 'ALL',
    faqQuery: '',
    chatHistory: [],
  };

  // ---------- Simple Markdown to HTML for AI Chat ----------
  function renderMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    let html = '';
    let inTable = false;
    let inList = false;

    const inline = (txt) => esc(txt)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-panel text-primary font-mono text-xs">$1</code>');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (inList) { html += '</ul>'; inList = false; }
        const cells = line.slice(1, -1).split('|').map((c) => c.trim());
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
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${inline(line.replace(/^([-*•]|\d+\.)\s+/, ''))}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line) html += `<p>${inline(line)}</p>`;
      }
    }
    if (inTable) html += '</tbody></table>';
    if (inList) html += '</ul>';
    return html;
  }

  // =====================================================================
  // 1. BERANDA (Hero, Console & Marquee)
  // =====================================================================
  function renderHero() {
    const y = KB.yayasan;
    document.getElementById('hero-sk-badge').textContent = y.sk || 'SK Kemenkumham RI';
    document.getElementById('hero-vision').textContent = y.visi;
    document.getElementById('hero-motto').textContent = y.semboyan;

    const totalQuota = KB.ppdb.kuota.reduce((acc, k) => acc + (parseInt(k.total, 10) || 0), 0);
    document.getElementById('metric-total-quota').textContent = totalQuota || 462;

    // Unit tabs inside Hero Console
    const tabWrap = document.getElementById('hero-unit-tabs');
    tabWrap.innerHTML = KB.units.map((u) => {
      const active = u.code === state.heroUnit;
      return `<button type="button" data-hero-unit="${esc(u.code)}" class="px-4 py-1.5 rounded-full text-xs font-medium transition-all ${active ? 'bg-primary text-card shadow-sm' : 'text-secondary hover:text-primary'}">${esc(u.code === 'SD' ? 'SDIT' : u.code === 'SMP' ? 'SMPIT' : u.code === 'SMA' ? 'SMAIT' : u.code)}</button>`;
    }).join('');

    tabWrap.querySelectorAll('[data-hero-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.heroUnit = btn.getAttribute('data-hero-unit');
        renderHero();
      });
    });

    const u = KB.units.find((x) => x.code === state.heroUnit) || KB.units[2];
    document.getElementById('console-unit-code').textContent = `JENJANG ${u.code} · TERAKREDITASI A`;
    document.getElementById('console-unit-name').textContent = u.nama;
    document.getElementById('console-unit-age').textContent = u.statuta.usia || u.kuota.syarat || '';
    document.getElementById('console-unit-target').textContent = u.statuta.target || '';
    document.getElementById('console-unit-quota').textContent = u.kuota.total || '';
    document.getElementById('console-unit-rombel').textContent = `${u.kuota.rombel || ''} (${u.kuota.perKelas || ''})`;
    document.getElementById('console-unit-hours').textContent = (u.statuta.jam || '').replace(/Senin\s*[–-]\s*Jumat\s*/i, '');
    document.getElementById('console-unit-dpp').textContent = R(u.biaya.dpp);
    document.getElementById('console-unit-spp').textContent = R(u.biaya.spp);
    document.getElementById('console-unit-head').textContent = u.kepala ? u.kepala.nama : 'Direktorat Pendidikan';
    document.getElementById('console-proporsi-label').textContent = u.kurikulum.proporsi || 'Tri-Kurikulum Terpadu';

    document.getElementById('console-btn-sim').onclick = () => {
      const sel = document.getElementById('calc-unit');
      if (sel) { sel.value = u.code; runCalculator(); }
    };

    // Marquee 8 Core Values
    const mq = document.getElementById('values-marquee');
    if (mq && !mq.dataset.ready) {
      const icons = ['verified', 'workspace_premium', 'handshake', 'shield', 'volunteer_activism', 'schedule', 'memory', 'diversity_3'];
      const setHtml = y.values.map((v, i) => `
        <div class="flex items-center gap-3 text-secondary">
          <span class="material-symbols-outlined text-primary !text-[20px]">${icons[i % icons.length]}</span>
          <span class="text-sm font-semibold tracking-tight text-primary uppercase">${esc(v.name)}</span>
          <span class="text-xs text-secondary">— ${esc(v.meaning)}</span>
        </div>
      `).join('');
      mq.innerHTML = setHtml + setHtml;
      mq.dataset.ready = '1';
    }
  }

  // =====================================================================
  // 2. PROFIL & TATA KELOLA (Statuta + SDM + KPI)
  // =====================================================================
  function renderProfil() {
    const y = KB.yayasan;
    document.getElementById('statuta-doc-no').textContent = `Nomor Dokumen: ${y.docNumber}`;
    document.getElementById('profil-mukadimah').textContent = y.mukadimah;
    document.getElementById('profil-legal-name').textContent = `${y.name} (${y.shortName})`;
    document.getElementById('profil-address').textContent = y.address;
    document.getElementById('profil-visi').textContent = `"${y.visi}"`;

    const legalList = [
      { label: 'Didirikan', val: y.founded },
      { label: 'SK Kemenkumham RI', val: y.sk },
      { label: 'Akta & Legalitas', val: y.legal[1] || '' },
      { label: 'Akreditasi Unit', val: y.legal[2] || '' },
      { label: 'Asas Yayasan', val: y.asas },
    ];
    document.getElementById('profil-legal-list').innerHTML = legalList.map((item) => `
      <div class="flex flex-col sm:flex-row sm:justify-between gap-1">
        <span class="text-xs font-medium text-secondary shrink-0">${esc(item.label)}</span>
        <span class="text-xs font-medium text-primary sm:text-right">${esc(item.val)}</span>
      </div>
    `).join('');

    document.getElementById('profil-misi-list').innerHTML = y.misi.map((m, idx) => `
      <div class="bg-panel rounded-2xl p-4 border border-auralis flex flex-col gap-2">
        <span class="typo-label-caps text-secondary">Misi 0${idx + 1}</span>
        <p class="text-xs text-primary leading-relaxed">${esc(m)}</p>
      </div>
    `).join('');

    document.getElementById('profil-values-chips').innerHTML = y.values.map((v) => `
      <span class="badge-pill !normal-case !tracking-normal !font-medium">
        <span class="dot-indicator bg-emerald-500"></span>
        <strong class="text-primary">${esc(v.name)}</strong>
        <span class="text-secondary">(${esc(v.meaning)})</span>
      </span>
    `).join('');

    renderStruktur();

    // SDM SOP List
    document.getElementById('sdm-sop-list').innerHTML = KB.kurikulum.sdm.map((row) => `
      <div class="py-4 first:pt-0 last:pb-0 flex flex-col gap-2">
        <div class="text-sm font-semibold text-primary">${esc(row.aspek)}</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div class="bg-panel rounded-xl p-3 border border-auralis space-y-1">
            <div class="typo-label-caps text-secondary mb-1">Ketentuan Baku</div>
            ${row.ketentuan.map((k) => `<div class="text-primary">• ${esc(k)}</div>`).join('')}
          </div>
          <div class="bg-panel rounded-xl p-3 border border-auralis space-y-1">
            <div class="typo-label-caps text-secondary mb-1">Prosedur &amp; Mekanisme</div>
            ${row.prosedur.map((p) => `<div class="text-secondary">• ${esc(p)}</div>`).join('')}
          </div>
        </div>
      </div>
    `).join('');

    // KPI List
    document.getElementById('kpi-list').innerHTML = KB.kurikulum.kpi.map((k) => `
      <div class="bg-panel rounded-2xl p-3.5 border border-auralis">
        <div class="flex items-center justify-between mb-1">
          <span class="text-xs font-semibold text-primary">${esc(k.kode)} · ${esc(k.dimensi)}</span>
          <span class="badge-pill !bg-card !py-0.5 !px-2.5">${esc(k.bobot)}</span>
        </div>
        <p class="text-xs text-secondary leading-relaxed">${esc(k.indikator)}</p>
      </div>
    `).join('');

    // Adab & Zero Tolerance Summary
    document.getElementById('adab-summary').innerHTML = KB.kurikulum.adab.map((a) => `
      <div><strong class="text-primary">${esc(a.kode)} — ${esc(a.title)}:</strong> ${esc(a.text.slice(0, 175))}...</div>
    `).join('');
  }

  function renderStruktur() {
    const items = KB.yayasan.struktur.filter((s) => {
      if (state.strukturFilter === 'organ') return !/^Kepala/i.test(s.jabatan);
      if (state.strukturFilter === 'kepala') return /^Kepala/i.test(s.jabatan);
      return true;
    });

    document.getElementById('struktur-grid').innerHTML = items.map((s) => {
      const isKepala = /^Kepala/i.test(s.jabatan);
      return `
        <div class="surface-card-interactive p-5 flex flex-col justify-between gap-3">
          <div>
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="badge-pill !text-[10px]">
                <span class="dot-indicator ${isKepala ? 'bg-emerald-500' : 'bg-blue-500'}"></span>
                <span>${esc(s.jabatan)}</span>
              </span>
            </div>
            <h4 class="text-base font-semibold text-primary">${esc(s.nama)}</h4>
          </div>
          <p class="text-xs text-secondary leading-relaxed border-t border-auralis pt-3">${esc(s.tugas)}</p>
        </div>
      `;
    }).join('');
  }

  // =====================================================================
  // 3. UNIT PENDIDIKAN & TRI-KURIKULUM
  // =====================================================================
  function renderUnits() {
    document.getElementById('kurikulum-intro').textContent = KB.kurikulum.intro;

    const tabs = [{ code: 'ALL', label: 'Semua Jenjang (5 Unit)' }, ...KB.units.map((u) => ({ code: u.code, label: u.nama }))];
    const tabWrap = document.getElementById('unit-selector-tabs');
    tabWrap.innerHTML = tabs.map((t) => `
      <button type="button" data-unit-tab="${esc(t.code)}" class="btn-chip ${state.selectedUnitFilter === t.code ? 'active' : ''}">
        ${esc(t.label)}
      </button>
    `).join('');

    tabWrap.querySelectorAll('[data-unit-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        state.selectedUnitFilter = b.getAttribute('data-unit-tab');
        renderUnits();
      });
    });

    const filtered = state.selectedUnitFilter === 'ALL'
      ? KB.units
      : KB.units.filter((u) => u.code === state.selectedUnitFilter);

    const grid = document.getElementById('unit-cards-grid');
    grid.innerHTML = filtered.map((u, idx) => {
      const spanClass = filtered.length === 1
        ? 'lg:col-span-12'
        : idx < 2 ? 'lg:col-span-6' : 'lg:col-span-4';
      const glowClass = idx % 3 === 0 ? 'top-glow-emerald' : idx % 3 === 1 ? 'top-glow-blue' : 'top-glow-coral';
      return `
        <article class="${spanClass} surface-card ${glowClass} p-6 md:p-7 flex flex-col justify-between gap-6">
          <div class="space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <span class="typo-label-caps text-secondary">Kode Unit: ${esc(u.code)} · ${esc(u.kuota.rombel || '')}</span>
                <h3 class="typo-h3 text-primary mt-1">${esc(u.nama)}</h3>
              </div>
              <span class="badge-pill">
                <span class="dot-indicator bg-emerald-500"></span>
                <span>Daya Tampung ${esc(u.kuota.total)}</span>
              </span>
            </div>

            <!-- Proporsi Kurikulum Banner -->
            <div class="bg-panel rounded-2xl p-4 border border-auralis">
              <div class="typo-label-caps text-secondary mb-1">Proporsi Muatan Tri-Kurikulum</div>
              <div class="text-xs font-semibold text-primary">${esc(u.kurikulum.proporsi)}</div>
            </div>

            <!-- 3 Pillar Details -->
            <div class="space-y-3 text-xs">
              <div class="p-3.5 rounded-xl bg-panel/70 border border-auralis">
                <div class="font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span class="material-symbols-outlined !text-[16px] text-emerald-600">menu_book</span>
                  Metode &amp; Target Tahsin / Tahfidz Al-Qur'an
                </div>
                <p class="text-secondary leading-relaxed">${esc(u.kurikulum.tahfidz)}</p>
              </div>

              <div class="p-3.5 rounded-xl bg-panel/70 border border-auralis">
                <div class="font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span class="material-symbols-outlined !text-[16px] text-blue-600">favorite</span>
                  Pembiasaan Adab &amp; Ibadah Harian
                </div>
                <p class="text-secondary leading-relaxed">${esc(u.kurikulum.adab)}</p>
              </div>

              <div class="p-3.5 rounded-xl bg-panel/70 border border-auralis">
                <div class="font-semibold text-primary mb-1 flex items-center gap-1.5">
                  <span class="material-symbols-outlined !text-[16px] text-rose-600">science</span>
                  Muatan Unggulan Sains, Bahasa &amp; Teknologi
                </div>
                <p class="text-secondary leading-relaxed">${esc(u.kurikulum.unggulan)}</p>
              </div>
            </div>
          </div>

          <!-- Footer Metadata & Action -->
          <div class="border-t border-auralis pt-4 space-y-3">
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span class="text-secondary block">Jam Belajar Efektif</span>
                <strong class="text-primary">${esc(u.statuta.jam)}</strong>
              </div>
              <div>
                <span class="text-secondary block">Syarat Usia / Lulus</span>
                <strong class="text-primary">${esc(u.statuta.usia)}</strong>
              </div>
              <div>
                <span class="text-secondary block">DPP / SPP Normal</span>
                <strong class="text-primary">${R(u.biaya.dpp)} / ${R(u.biaya.spp)}</strong>
              </div>
              <div>
                <span class="text-secondary block">Kepala Satuan Pendidikan</span>
                <strong class="text-primary">${esc(u.kepala ? u.kepala.nama : '-')}</strong>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button type="button" data-sim-unit="${esc(u.code)}" class="btn-primary !py-2 !px-4 !text-xs w-full sm:w-auto">
                <span class="material-symbols-outlined !text-[15px]">calculate</span>
                Simulasikan Biaya ${esc(u.code)}
              </button>
              <button type="button" data-ask-unit="${esc(u.code)}" class="btn-secondary !py-2 !px-4 !text-xs w-full sm:w-auto">
                Tanya AI Tentang ${esc(u.code)}
              </button>
            </div>
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('[data-sim-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-sim-unit');
        document.getElementById('calc-unit').value = code;
        runCalculator();
        document.getElementById('ppdb-kalkulator').scrollIntoView({ behavior: 'smooth' });
      });
    });

    grid.querySelectorAll('[data-ask-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-ask-unit');
        const u = KB.units.find((x) => x.code === code);
        sendChatPrompt(`Assalamu'alaikum Ustadzah, mohon jelaskan kurikulum khas, target tahfidz, syarat usia, dan rincian biaya untuk jenjang ${u ? u.nama : code}.`);
        document.getElementById('konsultasi').scrollIntoView({ behavior: 'smooth' });
      });
    });

    // Halaqah SOP Cards
    document.getElementById('halaqah-cards').innerHTML = KB.kurikulum.halaqah.map((h, i) => {
      const icons = ['schedule', 'verified', 'healing', 'menu_book'];
      return `
        <div class="surface-card p-5 flex flex-col justify-between gap-3">
          <div>
            <div class="w-9 h-9 rounded-xl bg-panel border border-auralis flex items-center justify-center mb-3 text-primary">
              <span class="material-symbols-outlined !text-[18px]">${icons[i % icons.length]}</span>
            </div>
            <h4 class="text-sm font-semibold text-primary mb-1.5">${esc(h.title)}</h4>
            <p class="text-xs text-secondary leading-relaxed">${esc(h.text)}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  // =====================================================================
  // 4. INFORMASI PPDB & KALKULATOR SIMULASI BIAYA
  // =====================================================================
  function runCalculator() {
    if (!KB) return;
    const opts = {
      unit: document.getElementById('calc-unit').value,
      gelombang: document.getElementById('calc-wave').value,
      alumni: document.getElementById('calc-alumni').checked,
      sibling: document.getElementById('calc-sibling').checked,
      tahfidz: Number(document.getElementById('calc-tahfidz').value) || 0,
      yatim: document.getElementById('calc-yatim').checked,
    };

    const res = window.YPIACore.simulate(KB, opts);
    if (!res) return;

    document.getElementById('calc-res-unit').textContent = `HASIL SIMULASI · ${res.fee.nama.toUpperCase()}`;
    document.getElementById('calc-res-scheme').textContent = `${res.best.nama} (${res.best.dpp}%) + ${res.gel.nama} (${res.gel.dpp}%)`;
    document.getElementById('calc-res-formulir').textContent = R(res.formulir);

    const notesEl = document.getElementById('calc-res-notes');
    if (res.notes.length) {
      notesEl.classList.remove('hidden');
      notesEl.innerHTML = res.notes.map((n) => `<div class="flex items-start gap-2"><span class="material-symbols-outlined !text-[15px] mt-0.5">info</span><span>${esc(n)}</span></div>`).join('');
    } else {
      notesEl.classList.add('hidden');
    }

    const c = res.cicilan;
    const l = res.lunas;

    document.getElementById('calc-cicilan-pct').textContent = `Diskon ${c.dppPct}% DPP`;
    document.getElementById('calc-cicilan-total').textContent = R(c.daftarUlang);
    document.getElementById('calc-dpp-normal').textContent = R(res.fee.dpp);
    document.getElementById('calc-cicilan-hemat').textContent = `-${R(c.hemat)}`;
    document.getElementById('calc-cicilan-dpp').textContent = R(c.dppNet);
    document.getElementById('calc-paket').textContent = R(c.paket);
    document.getElementById('calc-spp-nett').textContent = `${R(c.spp)}${c.sppPct ? ` (-${c.sppPct}%)` : ''}`;

    document.getElementById('calc-termin-list').innerHTML = `
      <div class="typo-label-caps text-secondary mb-1">Jadwal Angsuran 3 Termin (Bebas Bunga 0%)</div>
      ${c.termin.map((t) => `
        <div class="flex items-center justify-between gap-2 py-1 border-b last:border-0 border-auralis">
          <div>
            <div class="font-semibold text-primary">${esc(t.label)}</div>
            <div class="text-[11px] text-secondary">${esc(t.ket)}</div>
          </div>
          <span class="font-semibold text-primary shrink-0">${R(t.nominal)}</span>
        </div>
      `).join('')}
    `;

    document.getElementById('calc-lunas-pct').textContent = `Diskon ${l.dppPct}% DPP`;
    document.getElementById('calc-lunas-total').textContent = R(l.daftarUlang);
    document.getElementById('calc-lunas-dpp').textContent = R(l.dppNet);
    document.getElementById('calc-lunas-hemat').textContent = `-${R(l.hemat)}`;
    document.getElementById('calc-lunas-paket').textContent = R(l.paket);
    document.getElementById('calc-lunas-spp').textContent = `${R(l.spp)}${l.sppPct ? ` (-${l.sppPct}%)` : ''}`;
    document.getElementById('calc-lunas-year').textContent = R(l.tahunPertama);
  }

  function renderPPDB() {
    document.getElementById('ppdb-doc-no').textContent = `SK Keuangan ${KB.biaya.sk} · SOP ${KB.ppdb.docNumber}`;
    document.getElementById('ppdb-intro').textContent = KB.ppdb.intro;
    document.getElementById('fee-sk-label').textContent = KB.biaya.sk;

    // Master Fee Table
    const rows = [...KB.biaya.units];
    if (KB.biaya.average) rows.push(KB.biaya.average);
    document.getElementById('fee-master-tbody').innerHTML = rows.map((u) => {
      const isAvg = u.code === 'RATA2';
      return `
        <tr class="${isAvg ? 'bg-panel font-semibold' : 'hover:bg-panel/50'}">
          <td class="py-3.5 px-4 font-medium text-primary">${esc(u.nama)}</td>
          <td class="py-3.5 px-4">${R(u.formulir)}</td>
          <td class="py-3.5 px-4 font-semibold text-primary">${R(u.dpp)}</td>
          <td class="py-3.5 px-4 text-secondary">${R(u.seragam)}</td>
          <td class="py-3.5 px-4 text-secondary">${R(u.buku)}</td>
          <td class="py-3.5 px-4 text-secondary">${R(u.kegiatan)}</td>
          <td class="py-3.5 px-4 font-medium">${R(u.paket)}</td>
          <td class="py-3.5 px-4 font-medium text-primary">${R(u.spp)}</td>
          <td class="py-3.5 px-4 font-semibold text-primary">${R(u.awalMasuk)}</td>
        </tr>
      `;
    }).join('');

    // Wave statuses & Timeline Table
    const statuses = window.YPIACore.waveStatuses(KB.ppdb.timeline, new Date());
    document.getElementById('wave-status-cards').innerHTML = statuses.map((w) => {
      const dotColor = w.status === 'open' ? 'bg-emerald-500' : w.status === 'upcoming' ? 'bg-blue-500' : w.status === 'process' ? 'bg-amber-500' : 'bg-stone-400';
      return `
        <div class="bg-panel rounded-xl p-3 border border-auralis">
          <div class="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-secondary">
            <span class="dot-indicator ${dotColor}"></span>
            <span>${esc(window.YPIACore.STATUS_LABEL[w.status])}</span>
          </div>
          <div class="text-xs font-semibold text-primary mt-1 line-clamp-1" title="${esc(w.name)}">${esc(w.name.split('(')[0].trim())}</div>
        </div>
      `;
    }).join('');

    document.getElementById('timeline-thead').innerHTML = `
      <tr>
        <th class="py-3 px-3 font-semibold">Tahapan Kegiatan</th>
        ${KB.ppdb.timeline.waves.map((w) => `<th class="py-3 px-3 font-semibold">${esc(w)}</th>`).join('')}
      </tr>
    `;
    document.getElementById('timeline-tbody').innerHTML = KB.ppdb.timeline.rows.map((r) => `
      <tr class="hover:bg-panel/40">
        <td class="py-3 px-3 font-medium text-primary">${esc(r.tahap)}</td>
        ${r.cells.map((c) => `<td class="py-3 px-3 text-secondary">${esc(c)}</td>`).join('')}
      </tr>
    `).join('');

    // 7 Steps
    document.getElementById('ppdb-steps-list').innerHTML = KB.ppdb.steps.map((s) => `
      <div class="bg-panel rounded-2xl p-4 border border-auralis flex items-start gap-3.5">
        <div class="w-7 h-7 rounded-full bg-primary text-card text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
          ${s.no}
        </div>
        <div>
          <h4 class="text-xs font-semibold text-primary">${esc(s.title)}</h4>
          <p class="text-xs text-secondary leading-relaxed mt-1">${esc(s.text)}</p>
        </div>
      </div>
    `).join('');

    renderPPDBDocs();

    // Instrumen Seleksi
    document.getElementById('ppdb-instrumen-list').innerHTML = KB.ppdb.instrumen.map((ins) => `
      <div class="bg-panel rounded-2xl p-4 border border-auralis space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong class="text-xs font-semibold text-primary">${esc(ins.jenjang)}</strong>
          <span class="badge-pill !bg-card !text-[10px]">${esc(ins.metode)}</span>
        </div>
        <ul class="text-xs text-secondary space-y-1 pl-4 list-disc">
          ${ins.asesmen.map((a) => `<li>${esc(a)}</li>`).join('')}
        </ul>
        <div class="text-[11px] text-primary pt-1 border-t border-auralis">
          <strong>Kriteria Lulus:</strong> ${esc(ins.kriteria)}
        </div>
      </div>
    `).join('');

    // Kasus Khusus (Inklusi, Waiting List, Mutasi)
    document.getElementById('ppdb-kasus-list').innerHTML = KB.ppdb.kasusKhusus.map((k) => `
      <div class="bg-panel rounded-xl p-3.5 border border-auralis">
        <strong class="text-primary block mb-1">${esc(k.title)}</strong>
        <p class="leading-relaxed">${esc(k.text)}</p>
      </div>
    `).join('');

    runCalculator();
  }

  function renderPPDBDocs() {
    const u = document.getElementById('doc-filter-unit').value;
    const docs = KB.ppdb.dokumen.filter((d) => {
      if (u === 'ALL') return true;
      if (/semua/i.test(d.jenjang)) return true;
      if (new RegExp(`\\b${u}\\b`, 'i').test(d.jenjang)) return true;
      if ((u === 'PG' || u === 'TK' || u === 'SD') && /PG.*SD/i.test(d.jenjang)) return true;
      return false;
    });

    document.getElementById('ppdb-docs-list').innerHTML = docs.map((d) => {
      const wajib = /Wajib Mutlak/i.test(d.status);
      return `
        <div class="bg-card rounded-2xl p-4 border border-auralis flex flex-col justify-between gap-2">
          <div>
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <span class="text-[11px] font-semibold text-secondary">Berkas #${d.no} · ${esc(d.jenjang)}</span>
              <span class="badge-pill !py-0.5 !px-2 !text-[10px]">
                <span class="dot-indicator ${wajib ? 'bg-rose-500' : 'bg-amber-500'}"></span>
                <span>${esc(d.status)}</span>
              </span>
            </div>
            <h4 class="text-xs font-semibold text-primary">${esc(d.nama)}</h4>
          </div>
          <p class="text-[11px] text-secondary leading-relaxed border-t border-auralis pt-2">${esc(d.ketentuan)}</p>
        </div>
      `;
    }).join('');
  }

  // =====================================================================
  // 5. KONSULTASI AI & MASTER FAQ
  // =====================================================================
  function appendChatBubble(role, markdownText, metaText) {
    const stream = document.getElementById('chat-messages');
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    wrap.className = `flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`;
    wrap.innerHTML = `
      <div class="w-8 h-8 rounded-full ${isUser ? 'bg-panel border border-auralis text-primary' : 'bg-primary text-card'} flex items-center justify-center shrink-0 mt-0.5">
        <span class="material-symbols-outlined !text-[16px]">${isUser ? 'person' : 'smart_toy'}</span>
      </div>
      <div class="max-w-[85%] ${isUser ? 'bg-primary text-card rounded-2xl rounded-tr-sm px-4 py-3 text-xs leading-relaxed' : 'bg-card border border-auralis rounded-2xl rounded-tl-sm px-4 py-3.5 text-xs leading-relaxed text-primary chat-md'}">
        ${isUser ? esc(markdownText) : renderMarkdown(markdownText)}
        ${metaText ? `<div class="mt-2 pt-1.5 border-t border-auralis text-[10px] text-secondary">${esc(metaText)}</div>` : ''}
      </div>
    `;
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
  }

  function resetChat() {
    state.chatHistory = [];
    const stream = document.getElementById('chat-messages');
    stream.innerHTML = '';
    appendChatBubble(
      'assistant',
      `Assalamu'alaikum Warahmatullahi Wabarakatuh, Ayah/Bunda yang dirahmati Allah.\n\nSaya **${KB.ai.personaName}**, Konsultan PPDB Terpadu **${KB.yayasan.name}**. Silakan tanyakan mengenai **rincian & simulasi diskon biaya**, **syarat usia masuk (PG–SMAIT)**, **program tahfidz & kurikulum khas**, maupun **jadwal seleksi PPDB**.`,
      'Sumber Grounding: 5 Dokumen Master Folder Google Drive "data masukan"'
    );
  }

  async function sendChatPrompt(promptText) {
    const msg = String(promptText || '').trim();
    if (!msg) return;

    appendChatBubble('user', msg);
    const submitBtn = document.getElementById('chat-submit');
    const inputEl = document.getElementById('chat-input');
    inputEl.value = '';
    submitBtn.disabled = true;

    // Loading indicator
    const stream = document.getElementById('chat-messages');
    const loader = document.createElement('div');
    loader.className = 'text-xs text-secondary italic pl-11';
    loader.textContent = 'Ustadzah Fatimah sedang memeriksa dokumen resmi YPIA...';
    stream.appendChild(loader);
    stream.scrollTop = stream.scrollHeight;

    try {
      let data;
      try {
        const res = await fetch('./api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history: state.chatHistory }),
        });
        if (!res.ok) throw new Error('Static mode');
        data = await res.json();
      } catch {
        // Fallback otomatis untuk GitHub Pages / hosting statis tanpa backend
        data = window.YPIAAssistant.localAnswer(KB, msg, state.chatHistory);
      }
      loader.remove();
      const reply = data.reply || data.error || 'Mohon maaf, terjadi kendala pemrosesan.';
      state.chatHistory.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
      const badge = data.mode === 'gemini' ? `Gemini (${data.model}) · Grounded Drive` : 'Knowledge Engine YPIA · Grounded Drive';
      appendChatBubble('assistant', reply, badge);
    } catch (err) {
      loader.remove();
      appendChatBubble('assistant', `Mohon maaf Ayah/Bunda, terjadi gangguan koneksi: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function renderKonsultasiAndFAQ() {
    document.getElementById('ai-persona-name').textContent = `${KB.ai.personaName} — Konsultan PPDB YPIA`;
    document.getElementById('ai-engine-badge').textContent = KB.ai.engine === 'gemini'
      ? 'Mode Gemini API Aktif · Grounded pada Folder Drive "data masukan"'
      : 'Knowledge Engine YPIA Aktif · 100% Grounded pada Folder Drive "data masukan"';

    resetChat();

    // 5 Official Test Scenarios (Dokumen 06)
    const scWrap = document.getElementById('ai-scenarios-list');
    scWrap.innerHTML = KB.ai.scenarios.map((s, i) => `
      <button type="button" data-scenario-idx="${i}" class="w-full text-left bg-card hover:border-stone-400 transition-colors rounded-2xl p-3.5 border border-auralis flex flex-col gap-1 group">
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-semibold text-primary group-hover:underline">${esc(s.title)}</span>
          <span class="material-symbols-outlined !text-[16px] text-secondary group-hover:text-primary">north_east</span>
        </div>
        <p class="text-[11px] text-secondary line-clamp-2">"${esc(s.prompt)}"</p>
      </button>
    `).join('');

    scWrap.querySelectorAll('[data-scenario-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const s = KB.ai.scenarios[Number(btn.getAttribute('data-scenario-idx'))];
        if (s) sendChatPrompt(s.prompt);
      });
    });

    // A/B Evaluation Matrix
    document.getElementById('ai-eval-list').innerHTML = KB.ai.evaluation.map((ev) => {
      const isTotal = /TOTAL/i.test(ev.no);
      return `
        <div class="${isTotal ? 'bg-primary text-card' : 'bg-panel text-primary'} rounded-xl p-3 border border-auralis">
          <div class="flex items-center justify-between gap-2 font-semibold">
            <span>${esc(ev.kriteria)}</span>
            <span class="shrink-0">A: ${esc(ev.a)} · B: ${esc(ev.b)}</span>
          </div>
          <p class="text-[11px] ${isTotal ? 'text-stone-300' : 'text-secondary'} mt-1 leading-relaxed">${esc(ev.analisis)}</p>
        </div>
      `;
    }).join('');

    renderFAQExplorer();
  }

  function renderFAQExplorer() {
    const cats = [
      { code: 'ALL', label: 'Semua Kategori (20)' },
      ...KB.faq.categories.map((c) => ({ code: c.code, label: `Kategori ${c.code} (${c.items.length})` })),
      { code: 'OBJ', label: `Panduan Keberatan & Guardrail (${KB.faq.objections.length})` },
    ];

    const tabWrap = document.getElementById('faq-cat-tabs');
    tabWrap.innerHTML = cats.map((c) => `
      <button type="button" data-faq-cat="${esc(c.code)}" class="btn-chip ${state.faqCategory === c.code ? 'active' : ''}">
        ${esc(c.label)}
      </button>
    `).join('');

    tabWrap.querySelectorAll('[data-faq-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        state.faqCategory = b.getAttribute('data-faq-cat');
        renderFAQExplorer();
      });
    });

    const q = state.faqQuery.toLowerCase().trim();
    const cards = [];

    if (state.faqCategory !== 'OBJ') {
      for (const cat of KB.faq.categories) {
        if (state.faqCategory !== 'ALL' && state.faqCategory !== cat.code) continue;
        for (const it of cat.items) {
          if (q && !(`${it.id} ${it.q} ${it.a}`).toLowerCase().includes(q)) continue;
          cards.push(`
            <div class="surface-card p-5 flex flex-col justify-between gap-3">
              <div>
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="badge-pill !text-[10px]">
                    <span class="dot-indicator bg-emerald-500"></span>
                    <span>${esc(it.id)} · Kategori ${esc(cat.code)}</span>
                  </span>
                  <button type="button" data-faq-ask="${esc(it.q)}" class="text-[11px] font-medium text-secondary hover:text-primary flex items-center gap-1">
                    <span>Tanya di Chat</span>
                    <span class="material-symbols-outlined !text-[14px]">chat</span>
                  </button>
                </div>
                <h4 class="text-sm font-semibold text-primary mb-2">"${esc(it.q)}"</h4>
                <p class="text-xs text-secondary leading-relaxed">${esc(it.a)}</p>
              </div>
            </div>
          `);
        }
      }
    }

    if (state.faqCategory === 'ALL' || state.faqCategory === 'OBJ') {
      for (const o of KB.faq.objections) {
        if (q && !(`${o.kode} ${o.situasi} ${o.respons.join(' ')}`).toLowerCase().includes(q)) continue;
        cards.push(`
          <div class="surface-card top-glow-coral p-5 flex flex-col justify-between gap-3">
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <span class="badge-pill !text-[10px]">
                  <span class="dot-indicator bg-rose-500"></span>
                  <span>${esc(o.kode)} · Objection Handling &amp; Guardrail</span>
                </span>
              </div>
              <h4 class="text-sm font-semibold text-primary mb-2">${esc(o.situasi)}</h4>
              <ol class="text-xs text-secondary space-y-1 pl-4 list-decimal">
                ${o.respons.map((r) => `<li>${esc(r)}</li>`).join('')}
              </ol>
            </div>
          </div>
        `);
      }
    }

    const grid = document.getElementById('faq-items-grid');
    grid.innerHTML = cards.length
      ? cards.join('')
      : `<div class="md:col-span-2 text-center py-8 text-xs text-secondary">Tidak ada FAQ yang cocok dengan kata kunci "${esc(state.faqQuery)}".</div>`;

    grid.querySelectorAll('[data-faq-ask]').forEach((btn) => {
      btn.addEventListener('click', () => {
        sendChatPrompt(btn.getAttribute('data-faq-ask'));
        document.getElementById('konsultasi').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // =====================================================================
  // 6. DRIVE STATUS MODAL & EVENT BINDINGS
  // =====================================================================
  function renderDriveModal() {
    const files = Object.values(KB.drive.files || {});
    const isLive = files.some((f) => f.source === 'drive-live');
    document.getElementById('drive-status-label').textContent = isLive ? 'Drive Live Sync' : 'Drive Snapshot (6 File)';
    document.getElementById('drive-folder-link').href = KB.drive.folderUrl;
    document.getElementById('drive-generated-at').textContent = `Dimuat: ${new Date(KB.generatedAt).toLocaleString('id-ID')}`;

    document.getElementById('drive-files-list').innerHTML = files.map((f) => `
      <div class="bg-panel rounded-xl p-3.5 border border-auralis flex items-center justify-between gap-3">
        <div>
          <div class="font-semibold text-primary">${esc(f.name)}</div>
          <div class="text-[11px] text-secondary">ID: <code class="font-mono">${esc(f.id)}</code> · Tipe: ${esc(f.type.toUpperCase())} · Sumber: ${esc(f.source)}</div>
        </div>
        <a href="${esc(f.url)}" target="_blank" rel="noopener" class="btn-chip !bg-card shrink-0">
          <span>Buka di Drive</span>
          <span class="material-symbols-outlined !text-[14px]">open_in_new</span>
        </a>
      </div>
    `).join('');
  }

  function setupEvents() {
    // Calculator inputs
    ['calc-unit', 'calc-wave', 'calc-alumni', 'calc-sibling', 'calc-tahfidz', 'calc-yatim'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', runCalculator);
    });

    // Send calculator summary to AI
    document.getElementById('btn-ask-calc-ai').addEventListener('click', () => {
      const u = document.getElementById('calc-unit').value;
      const w = document.getElementById('calc-wave').selectedOptions[0].text.split('—')[0].trim();
      const traits = [];
      if (document.getElementById('calc-alumni').checked) traits.push('lulusan internal Al-Mun\'imiyah (Alumni)');
      if (document.getElementById('calc-sibling').checked) traits.push('memiliki saudara kandung aktif di Al-Mun\'imiyah (Sibling)');
      const thf = Number(document.getElementById('calc-tahfidz').value);
      if (thf >= 5) traits.push(`hafalan Al-Qur'an mutqin ${thf} Juz`);
      if (document.getElementById('calc-yatim').checked) traits.push('jalur afirmasi yatim/dhuafa');
      const traitStr = traits.length ? ` dengan kriteria ${traits.join(' dan ')}` : '';
      sendChatPrompt(`Assalamu'alaikum Ustadzah, saya ingin mendaftarkan anak ke jenjang ${u} pada ${w}${traitStr}. Berapa total diskon dan rincian biaya daftar ulang yang harus saya siapkan?`);
      document.getElementById('konsultasi').scrollIntoView({ behavior: 'smooth' });
    });

    // Struktur filter
    document.querySelectorAll('[data-role-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-role-filter]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.strukturFilter = btn.getAttribute('data-role-filter');
        renderStruktur();
      });
    });

    // Checklist document filter
    document.getElementById('doc-filter-unit').addEventListener('change', renderPPDBDocs);

    // Chat form
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatPrompt(document.getElementById('chat-input').value);
    });
    document.getElementById('btn-clear-chat').addEventListener('click', resetChat);

    // FAQ Search
    document.getElementById('faq-search').addEventListener('input', (e) => {
      state.faqQuery = e.target.value;
      renderFAQExplorer();
    });

    // Drive Modal
    const modal = document.getElementById('drive-modal');
    document.getElementById('btn-drive-status').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('btn-close-drive-modal').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    // Refresh KB from server
    document.getElementById('btn-refresh-kb').addEventListener('click', async () => {
      await loadKnowledgeBase(true);
    });

    // Mobile Menu
    const mobileMenu = document.getElementById('mobile-menu');
    document.getElementById('btn-mobile-menu').addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });

    // Active section highlight on scroll
    const sections = ['beranda', 'profil', 'unit', 'ppdb', 'konsultasi'];
    window.addEventListener('scroll', () => {
      const y = window.scrollY + 180;
      let current = 'beranda';
      for (const id of sections) {
        const el = document.getElementById(id);
        if (el && el.offsetTop <= y) current = id;
      }
      document.querySelectorAll('[data-nav]').forEach((a) => {
        a.classList.toggle('active', a.getAttribute('data-nav') === current);
      });
    }, { passive: true });
  }

  async function loadKnowledgeBase(refresh = false) {
    try {
      const res = await fetch(refresh ? './api/kb?refresh=1' : './api/kb');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      KB = await res.json();
    } catch {
      const res = await fetch('./data/kb.json');
      KB = await res.json();
    }
    renderHero();
    renderProfil();
    renderUnits();
    renderPPDB();
    renderKonsultasiAndFAQ();
    renderDriveModal();
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupEvents();
    loadKnowledgeBase(false);
  });
})();

