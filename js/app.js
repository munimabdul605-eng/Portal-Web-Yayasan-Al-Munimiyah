/**
 * Portal Web Terpadu YPIA (SI-YAYASAN) — Simplified Auralis Frontend Controller
 * Sesuai Matriks Spesifikasi 5 Menu Utama:
 *  1. Beranda (#beranda) — Hero Visi-Misi & Nilai Dasar 'JUBAEDAH', 2 CTA Utama, Ringkasan 5 Unit & Akreditasi A
 *  2. Profil & Tata Kelola (#profil) — Statuta & Struktur Organisasi + Knowledge Base Internal (NotebookLM Fase 2)
 *  3. Unit Pendidikan (#unit) — Playgroup & TK Islam | SDIT, SMPIT, SMAIT + Jam Belajar, Rasio, Tahfidz & Teknologi
 *  4. Informasi PPDB (#ppdb) — Rincian Biaya & Beasiswa | Jadwal 3 Gelombang & SOP | Formulir Registrasi Online & Grafik Kuota Live
 *  5. Konsultasi AI & FAQ (#konsultasi) — Asisten PPDB Interaktif (Gem Fase 3) | FAQ Kategori A–D & Peringatan Resmi Rekening VA
 */
(function () {
  const R = window.YPIACore.formatRp;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let KB = null;
  const state = {
    unitGroup: 'ALL', // 'PAUD' (PG & TK) | 'DIKDASMEN' (SDIT, SMPIT, SMAIT) | 'ALL'
    faqCategory: 'ALL',
    faqQuery: '',
    chatHistory: [],
    liveQuotaStats: [
      { code: 'PG', label: "Playgroup (PG) Al-Mun'imiyah", rombel: '2 Rombel (@15)', filled: 1, total: 30 },
      { code: 'TK', label: "TK Islam (TK A & TK B)", rombel: '4 Rombel (@20)', filled: 2, total: 80 },
      { code: 'SD', label: "SDIT Al-Mun'imiyah", rombel: '4 Rombel (@28)', filled: 4, total: 112 },
      { code: 'SMP', label: "SMPIT Al-Mun'imiyah", rombel: '4 Rombel (@30)', filled: 3, total: 120 },
      { code: 'SMA', label: "SMAIT Al-Mun'imiyah", rombel: '4 Rombel (@30)', filled: 3, total: 120 },
    ],
  };

  function renderMarkdown(md) {
    const lines = String(md || '').split(/\r?\n/);
    let html = '', inTable = false, inList = false;
    const inline = (txt) => esc(txt)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-panel text-primary font-mono text-xs">$1</code>');

    for (const raw of lines) {
      const line = raw.trim();
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

  function openPPDBFormTab(selectedUnit) {
    const tabBtn = document.querySelector('#ppdb-tabs [data-ppdb-tab="formulir"]');
    if (tabBtn) tabBtn.click();
    if (selectedUnit && document.getElementById('reg-unit')) {
      document.getElementById('reg-unit').value = selectedUnit;
    }
    const ppdbEl = document.getElementById('ppdb');
    if (ppdbEl) ppdbEl.scrollIntoView({ behavior: 'smooth' });
  }

  // =====================================================================
  // 1. BERANDA (HOME) — Visi-Misi, Nilai Dasar 'JUBAEDAH', 2 CTA, 5 Unit & Akreditasi A
  // =====================================================================
  function renderBeranda() {
    const y = KB.yayasan;
    document.getElementById('hero-sk').textContent = y.sk;
    document.getElementById('hero-visi').textContent = `"${y.visi}"`;
    document.getElementById('hero-semboyan').textContent = `"${y.semboyan}"`;
    document.getElementById('hero-address').textContent = y.address;
    document.getElementById('hero-ta').textContent = KB.biaya.tahunAjaran || '2026/2027';

    const totalQuota = KB.ppdb.kuota.reduce((acc, k) => acc + (parseInt(k.total, 10) || 0), 0);
    document.getElementById('hero-quota').textContent = `${totalQuota || 462} Siswa`;

    // 8 Nilai Dasar Resmi: JUBAEDAH (Jujur, Ulet, Bersih, Amanah, Empati, Disiplin, Adaptif, Harmonis)
    const jubaedahValues = [
      { name: 'Jujur', meaning: 'Integritas & Shiddiq' },
      { name: 'Ulet', meaning: 'Tangguh & Istiqamah' },
      { name: 'Bersih', meaning: 'Suci Hati & Lingkungan' },
      { name: 'Amanah', meaning: 'Terpercaya & Akuntabel' },
      { name: 'Empati', meaning: 'Peduli Sosial & Ukhuwah' },
      { name: 'Disiplin', meaning: 'Tertib Ibadah & Tata Kelola' },
      { name: 'Adaptif', meaning: 'Inovasi Sains & Teknologi' },
      { name: 'Harmonis', meaning: 'Kolaboratif & Rahmatan' },
    ];
    document.getElementById('hero-jubaedah-grid').innerHTML = jubaedahValues.map((v) => {
      const letter = v.name.charAt(0).toUpperCase();
      return `
        <div class="bg-panel rounded-xl p-3 border border-auralis flex items-start gap-2.5">
          <span class="w-6 h-6 rounded-lg bg-primary text-card font-bold text-xs flex items-center justify-center shrink-0">${esc(letter)}</span>
          <div class="min-w-0">
            <strong class="text-xs font-semibold text-primary block truncate">${esc(v.name)}</strong>
            <span class="text-[11px] text-secondary block truncate">${esc(v.meaning)}</span>
          </div>
        </div>
      `;
    }).join('');

    // Ringkasan 5 Pilar Misi di Hero
    document.getElementById('hero-misi-short').innerHTML = y.misi.map((m, idx) => `
      <li class="flex items-start gap-2">
        <span class="font-semibold text-primary">0${idx + 1}.</span>
        <span class="leading-relaxed">${esc(m.split('.')[0])}.</span>
      </li>
    `).join('');

    // Ringkasan 5 Unit Pendidikan (PG, TK, SDIT, SMPIT, SMAIT) & Terakreditasi A (Unggul)
    const techTagByUnit = {
      PG: '15 Surat Pendek & Motorik',
      TK: '1/2 Juz 30 & STEAM Anak',
      SD: '2 Juz Mutqin & Coding Kids SD',
      SMP: '3–5 Juz Mutqin & Robotika SMP',
      SMA: '5–10 Juz Mutqin & AI/Python SMA',
    };
    const unitDisplayCode = { PG: 'PG', TK: 'TK', SD: 'SDIT', SMP: 'SMPIT', SMA: 'SMAIT' };

    document.getElementById('hero-units-summary').innerHTML = KB.units.map((u) => `
      <div class="surface-card p-4 flex flex-col justify-between gap-3">
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-1">
            <span class="badge-pill !py-0.5 !px-2 !text-[10px]">${esc(unitDisplayCode[u.code] || u.code)}</span>
            <span class="badge-pill !bg-emerald-50 !text-emerald-800 !border-emerald-200 !py-0.5 !px-2 !text-[10px]">Terakreditasi A (Unggul)</span>
          </div>
          <h3 class="text-sm font-semibold text-primary leading-snug">${esc(u.nama.replace(/Al-Mun'imiyah/i, '').trim())}</h3>
          <p class="text-[11px] text-secondary leading-relaxed">${esc(u.statuta.usia)}</p>
        </div>
        <div class="pt-2.5 border-t border-auralis space-y-1.5 text-[11px]">
          <div class="flex justify-between">
            <span class="text-secondary">Kuota</span>
            <strong class="text-primary">${esc(u.kuota.total)}</strong>
          </div>
          <div class="flex justify-between">
            <span class="text-secondary">Target &amp; Tech</span>
            <strong class="text-emerald-700 truncate max-w-[130px]" title="${esc(techTagByUnit[u.code])}">${esc(techTagByUnit[u.code])}</strong>
          </div>
          <button type="button" data-hero-unit="${esc(u.code)}" class="w-full mt-1.5 py-1.5 px-2.5 rounded-lg bg-panel hover:bg-primary hover:text-card text-primary font-medium text-[11px] transition-colors">
            Lihat Detail Unit &rarr;
          </button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('[data-hero-unit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-hero-unit');
        state.unitGroup = (code === 'PG' || code === 'TK') ? 'PAUD' : 'DIKDASMEN';
        renderUnit();
        document.getElementById('unit').scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // =====================================================================
  // 2. PROFIL & TATA KELOLA — Statuta & Struktur Organisasi + NotebookLM (Fase 2)
  // =====================================================================
  function renderProfil() {
    const y = KB.yayasan;
    document.getElementById('profil-doc-no').textContent = y.docNumber;
    document.getElementById('profil-mukadimah').textContent = y.mukadimah;
    document.getElementById('profil-name').textContent = `${y.name} (${y.shortName})`;

    const legalRows = [
      ['Tanggal Berdiri', y.founded],
      ['SK Kemenkumham RI', y.sk],
      ['Akta Notaris', y.legal[1] || ''],
      ['Akreditasi', 'Terakreditasi "A" (Unggul) BAN-PDM pada Seluruh Unit'],
      ['Asas & Nilai Dasar', 'Islam Ahlussunnah wal Jama\'ah · Nilai Dasar "JUBAEDAH"'],
    ];
    document.getElementById('profil-legal-rows').innerHTML = legalRows.map(([k, v]) => `
      <div class="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
        <span class="text-secondary shrink-0">${esc(k)}</span>
        <span class="font-medium text-primary sm:text-right">${esc(v)}</span>
      </div>
    `).join('');

    // Ringkasan Eksekutif Statuta Yayasan (Bab I - Bab VIII)
    const statutaBoxes = [
      { pasal: 'Bab I–II (Pasal 1–5)', title: 'Identitas, Visi 2030 & Nilai JUBAEDAH', desc: 'Penetapan badan hukum YPIA Bandung, Visi Generasi Qur\'ani 2030, 5 Misi Pendidikan, dan 8 Nilai Dasar JUBAEDAH.' },
      { pasal: 'Bab III (Pasal 6)', title: 'Struktur Organ Yayasan', desc: 'Terdiri atas Dewan Pembina (Otoritas Tertinggi), Dewan Pengawas (Audit & Kepatuhan), dan Pengurus Harian.' },
      { pasal: 'Bab IV (Pasal 7–8)', title: '5 Unit Pendidikan & Seleksi Ramah Anak', desc: 'Menaungi PG, TK, SDIT, SMPIT, SMAIT. PG/TK/SD bebas tes calistung; kelas Ikhwan & Akhwat terpisah mulai Kelas 4 SD–SMA.' },
      { pasal: 'Bab V (Pasal 9)', title: 'Beasiswa, Diskon & Kuota Afirmasi', desc: 'Mengatur diskon Early Bird (15%), Alumni (20%), Sibling (10%), Tahfidz (50%/100%), dan Afirmasi Yatim/Dhuafa (100% min 5% kuota).' },
      { pasal: 'Bab VI (Pasal 10–11)', title: 'Standar Pendidik & Zero Bullying (TPPK)', desc: 'Guru wajib bersertifikasi Tahsin Tilawati/Ummi, hadir 06.45 WIB, dan penegakan Sekolah Ramah Anak bebas perundungan.' },
      { pasal: 'Bab VII (Pasal 12)', title: 'Akuntabilitas Virtual Account (VA)', desc: 'Seluruh transaksi wajib melalui VA Bank Syariah resmi a.n. YPIA. Pembayaran tunai/rekening pribadi dilarang keras.' },
    ];
    document.getElementById('profil-statuta-summary').innerHTML = statutaBoxes.map((b) => `
      <div class="bg-panel rounded-2xl p-4 border border-auralis space-y-1">
        <span class="typo-label-caps text-emerald-700">${esc(b.pasal)}</span>
        <h4 class="font-semibold text-primary text-xs">${esc(b.title)}</h4>
        <p class="text-[11px] text-secondary leading-relaxed">${esc(b.desc)}</p>
      </div>
    `).join('');

    // Daftar Pimpinan Yayasan & Kepala Unit Pendidikan
    document.getElementById('profil-struktur-grid').innerHTML = y.struktur.map((s) => {
      const isKepala = /^Kepala|^Koordinator/i.test(s.jabatan);
      return `
        <div class="surface-card p-5 flex flex-col justify-between gap-3">
          <div>
            <span class="badge-pill !text-[10px] mb-2">
              <span class="dot-indicator ${isKepala ? 'bg-emerald-500' : 'bg-blue-500'}"></span>
              <span>${esc(s.jabatan)}</span>
            </span>
            <h4 class="text-sm font-semibold text-primary">${esc(s.nama)}</h4>
          </div>
          <p class="text-xs text-secondary leading-relaxed border-t border-auralis pt-2.5">${esc(s.tugas)}</p>
        </div>
      `;
    }).join('');

    // Sub-Halaman 2.2: Daftar Berkas Grounding NotebookLM
    const files = Object.values(KB.drive.files || {});
    document.getElementById('profil-notebook-files').innerHTML = files.map((f, i) => `
      <div class="bg-card rounded-xl p-3 border border-auralis flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="font-semibold text-primary truncate">0${i + 1}. ${esc(f.name)}</div>
          <div class="text-[11px] text-secondary">Terindeks di NotebookLM · ${esc(f.type.toUpperCase())}</div>
        </div>
        <a href="${esc(f.url)}" target="_blank" rel="noopener" class="badge-pill !py-1 !px-2.5 hover:!border-primary shrink-0">Buka ↗</a>
      </div>
    `).join('');

    document.getElementById('profil-kpi-compact').innerHTML = KB.kurikulum.kpi.slice(0, 4).map((k) => `
      <div class="flex items-center justify-between gap-2">
        <span class="truncate">• <strong>${esc(k.dimensi)}</strong></span>
        <span class="badge-pill !py-0.5 !px-2 !text-[10px] shrink-0">${esc(k.bobot)}</span>
      </div>
    `).join('');
  }

  // =====================================================================
  // 3. UNIT PENDIDIKAN — Playgroup & TK Islam vs SDIT | SMPIT | SMAIT
  // =====================================================================
  function renderUnit() {
    document.getElementById('unit-intro').textContent = KB.kurikulum.intro;

    // Update Active State on Group Tabs
    document.querySelectorAll('#unit-group-tabs [data-unit-group]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-unit-group') === state.unitGroup);
    });

    const filteredUnits = KB.units.filter((u) => {
      if (state.unitGroup === 'PAUD') return u.code === 'PG' || u.code === 'TK';
      if (state.unitGroup === 'DIKDASMEN') return u.code === 'SD' || u.code === 'SMP' || u.code === 'SMA';
      return true;
    });

    const tahfidzTargetByUnit = {
      PG: 'PG: 15 surat pendek (Juz 30) & doa harian pilihan',
      TK: 'TK: 1/2 Juz 30 (An-Nas s.d. Al-Infitar / Ad-Dhuha) & hadits adab',
      SD: 'SDIT: 2 Juz Mutqin (Juz 30 & Juz 29) + tuntas baca Al-Qur\'an tartil',
      SMP: 'SMPIT: 3–5 Juz Mutqin (Bersanad) + terjemah lafdziyah Juz 30',
      SMA: 'SMAIT: 5–10 Juz Mutqin (Bersanad) + kajian tafsir tematik',
    };

    const techHighlight = {
      PG: 'Sensory Integration, Motorik Halus & Kasar, Storytelling Islami',
      TK: 'Eksplorasi STEAM Anak, Pengenalan Angka/Huruf Kontekstual, Manasik Cilik',
      SD: 'Coding Kids SD (Scratch/Blockly), Math & Science Club (OSN), Arabic-English Fun Day',
      SMP: 'Robotika SMP (Arduino & IoT), Bilingual Camp (Arab & Inggris), Leadership & Entrepreneur',
      SMA: 'AI/Python SMA & Data Science, Karya Ilmiah Remaja (KIR), UTBK-SNBT & TOEFL/IELTS Prep',
    };

    const gridEl = document.getElementById('unit-cards-grid');
    gridEl.className = filteredUnits.length === 2
      ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8'
      : 'grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8';

    gridEl.innerHTML = filteredUnits.map((u) => `
      <div class="surface-card p-6 flex flex-col justify-between gap-5">
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="badge-pill">
              <span class="dot-indicator bg-emerald-500"></span>
              <span>Unit ${esc(u.code)} · Terakreditasi A (Unggul)</span>
            </span>
            <span class="badge-pill">${esc(u.kuota.rombel)} (${esc(u.kuota.total)})</span>
          </div>

          <div>
            <h3 class="typo-h3 text-primary">${esc(u.nama)}</h3>
            <p class="text-xs text-secondary mt-1">Kepala Unit: <strong class="text-primary">${esc(u.kepala ? u.kepala.nama : '-')}</strong></p>
          </div>

          <!-- 3 Parameter Wajib: Jam Belajar Efektif, Rasio Kelas, Target Hafalan Tahfidz -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div class="bg-panel rounded-xl p-3 border border-auralis">
              <span class="typo-label-caps text-secondary">Jam Belajar Efektif</span>
              <strong class="text-primary block mt-1">${esc(u.statuta.jam)}</strong>
            </div>
            <div class="bg-panel rounded-xl p-3 border border-auralis">
              <span class="typo-label-caps text-secondary">Rasio &amp; Kuota Kelas</span>
              <strong class="text-primary block mt-1">${esc(u.kuota.rombel)} · Total ${esc(u.kuota.total)}</strong>
            </div>
          </div>

          <div class="bg-panel rounded-2xl p-4 border border-auralis text-xs space-y-1.5">
            <span class="typo-label-caps text-emerald-700">Target Hafalan Tahfidz &amp; Metode</span>
            <p class="font-semibold text-primary">${esc(tahfidzTargetByUnit[u.code] || u.statuta.target)}</p>
            <p class="text-secondary leading-relaxed">${esc(u.kurikulum.tahfidz)}</p>
          </div>

          <div class="bg-panel rounded-2xl p-4 border border-auralis text-xs space-y-1.5">
            <span class="typo-label-caps text-blue-700">Program Unggulan Teknologi &amp; Akademik</span>
            <p class="font-semibold text-primary">${esc(techHighlight[u.code])}</p>
            <p class="text-secondary leading-relaxed">${esc(u.kurikulum.adab)}</p>
          </div>
        </div>

        <div class="pt-3 border-t border-auralis flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span class="text-secondary">SPP Bulanan:</span>
            <strong class="text-primary ml-1">${R(u.biaya.spp)}</strong>
          </div>
          <div class="flex gap-2">
            <button type="button" data-unit-sim="${esc(u.code)}" class="btn-secondary !py-1.5 !px-3 !text-xs">Simulasi Biaya</button>
            <button type="button" data-unit-reg="${esc(u.code)}" class="btn-primary !py-1.5 !px-3 !text-xs">Daftar ${esc(u.code)}</button>
          </div>
        </div>
      </div>
    `).join('');

    gridEl.querySelectorAll('[data-unit-sim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-unit-sim');
        document.getElementById('calc-unit').value = code;
        runCalculator();
        const tabBiaya = document.querySelector('#ppdb-tabs [data-ppdb-tab="biaya"]');
        if (tabBiaya) tabBiaya.click();
        document.getElementById('ppdb').scrollIntoView({ behavior: 'smooth' });
      });
    });

    gridEl.querySelectorAll('[data-unit-reg]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openPPDBFormTab(btn.getAttribute('data-unit-reg'));
      });
    });

    // Tabel Komparatif 5 Unit
    document.getElementById('unit-comparison-tbody').innerHTML = KB.units.map((u) => `
      <tr class="hover:bg-panel/50">
        <td class="py-3 px-3 font-semibold text-primary">${esc(u.nama.replace(/Al-Mun'imiyah/i, '').trim())}</td>
        <td class="py-3 px-3 text-secondary">${esc(u.statuta.usia)}</td>
        <td class="py-3 px-3 font-medium text-primary">${esc(u.statuta.jam)}</td>
        <td class="py-3 px-3">${esc(u.kuota.rombel)} (${esc(u.kuota.total)})</td>
        <td class="py-3 px-3 font-medium text-emerald-800">${esc(tahfidzTargetByUnit[u.code] || u.statuta.target)}</td>
        <td class="py-3 px-3 font-medium text-primary">${esc(techHighlight[u.code])}</td>
      </tr>
    `).join('');

    document.getElementById('unit-halaqah-strip').innerHTML = KB.kurikulum.halaqah.map((h) => `
      <div class="surface-panel p-4 rounded-2xl">
        <h4 class="text-xs font-semibold text-primary mb-1">${esc(h.title)}</h4>
        <p class="text-[11px] text-secondary leading-relaxed">${esc(h.text)}</p>
      </div>
    `).join('');
  }

  // =====================================================================
  // 4. INFORMASI PPDB — Biaya & Beasiswa | Jadwal 3 Gelombang & SOP | Formulir Online & Grafik Kuota Live
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

    document.getElementById('calc-res-unit').textContent = `ESTIMASI BIAYA · ${res.fee.nama.toUpperCase()}`;
    document.getElementById('calc-res-scheme').textContent = `${res.best.nama} (${res.best.dpp}%) + ${res.gel.nama} (${res.gel.dpp}%)`;
    document.getElementById('calc-res-formulir').textContent = R(res.formulir);

    const notesEl = document.getElementById('calc-res-notes');
    if (res.notes.length) {
      notesEl.classList.remove('hidden');
      notesEl.innerHTML = res.notes.map((n) => `<div>• ${esc(n)}</div>`).join('');
    } else {
      notesEl.classList.add('hidden');
    }

    const c = res.cicilan, l = res.lunas;
    document.getElementById('calc-cicilan-pct').textContent = `Diskon ${c.dppPct}% DPP`;
    document.getElementById('calc-cicilan-total').textContent = R(c.daftarUlang);
    document.getElementById('calc-dpp-normal').textContent = R(res.fee.dpp);
    document.getElementById('calc-cicilan-dpp').textContent = R(c.dppNet);
    document.getElementById('calc-paket').textContent = R(c.paket);
    document.getElementById('calc-spp-nett').textContent = `${R(c.spp)}${c.sppPct ? ` (-${c.sppPct}%)` : ''}`;

    document.getElementById('calc-termin-list').innerHTML = c.termin.map((t) => `
      <div class="flex justify-between gap-2">
        <span class="text-secondary">${esc(t.label)}</span>
        <strong class="text-primary">${R(t.nominal)}</strong>
      </div>
    `).join('');

    document.getElementById('calc-lunas-pct').textContent = `Diskon ${l.dppPct}% DPP`;
    document.getElementById('calc-lunas-total').textContent = R(l.daftarUlang);
    document.getElementById('calc-lunas-dpp').textContent = R(l.dppNet);
    document.getElementById('calc-lunas-hemat').textContent = `-${R(l.hemat)}`;
    document.getElementById('calc-lunas-paket-spp').textContent = R(l.paket + l.spp);
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

    chartEl.innerHTML = state.liveQuotaStats.map((q) => {
      const pct = Math.min(100, Math.max(3, Math.round((q.filled / q.total) * 100)));
      const realPct = Math.round((q.filled / q.total) * 100);
      const remaining = Math.max(0, q.total - q.filled);
      return `
        <div class="bg-panel rounded-2xl p-3.5 border border-auralis space-y-2 text-xs">
          <div class="flex items-center justify-between gap-2">
            <div>
              <strong class="text-primary">${esc(q.label)}</strong>
              <span class="text-[11px] text-secondary block">${esc(q.rombel)}</span>
            </div>
            <div class="text-right">
              <span class="font-semibold text-primary">Terisi ${q.filled} / ${q.total} Kursi (${realPct}%)</span>
              <span class="text-[11px] text-emerald-700 font-medium block">Tersedia ${remaining} Kursi</span>
            </div>
          </div>
          <div class="w-full h-2.5 rounded-full bg-card border border-auralis overflow-hidden">
            <div class="h-full bg-emerald-600 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderPPDB() {
    document.getElementById('ppdb-doc-no').textContent = `SK ${KB.biaya.sk} · SOP ${KB.ppdb.docNumber}`;
    document.getElementById('ppdb-intro').textContent = KB.ppdb.intro;

    // Tabel Biaya Masuk
    document.getElementById('fee-master-tbody').innerHTML = KB.biaya.units.map((u) => `
      <tr class="hover:bg-panel/50">
        <td class="py-3 px-3 font-medium text-primary">${esc(u.nama)}</td>
        <td class="py-3 px-3">${R(u.formulir)}</td>
        <td class="py-3 px-3 font-semibold text-primary">${R(u.dpp)}</td>
        <td class="py-3 px-3">${R(u.paket)}</td>
        <td class="py-3 px-3">${R(u.spp)}</td>
        <td class="py-3 px-3 font-semibold text-primary">${R(u.awalMasuk)}</td>
      </tr>
    `).join('');

    // Grid Skema Diskon & Beasiswa Statuta Pasal 9
    document.getElementById('ppdb-discounts-grid').innerHTML = (KB.biaya.discounts || []).map((d) => `
      <div class="surface-card p-4 flex flex-col justify-between gap-2">
        <div>
          <div class="flex items-center justify-between gap-1 mb-1">
            <span class="badge-pill !py-0.5 !px-2 !text-[10px]">${esc(d.code)}</span>
            <strong class="text-emerald-700 font-semibold">${esc(d.dppDiskon)} DPP${d.sppDiskon && d.sppDiskon !== '0%' ? ` + ${esc(d.sppDiskon)} SPP` : ''}</strong>
          </div>
          <h4 class="font-semibold text-primary text-xs">${esc(d.nama)}</h4>
        </div>
        <p class="text-[11px] text-secondary leading-relaxed border-t border-auralis pt-2">${esc(d.syarat)}</p>
      </div>
    `).join('');

    // Timeline 3 Gelombang
    document.getElementById('timeline-thead').innerHTML = `
      <tr>
        <th class="py-2.5 px-3">Tahapan</th>
        ${KB.ppdb.timeline.waves.map((w) => `<th class="py-2.5 px-3">${esc(w.split('(')[0].trim())}</th>`).join('')}
      </tr>
    `;
    document.getElementById('timeline-tbody').innerHTML = KB.ppdb.timeline.rows.map((r) => `
      <tr>
        <td class="py-2.5 px-3 font-medium text-primary">${esc(r.tahap)}</td>
        ${r.cells.map((c) => `<td class="py-2.5 px-3 text-secondary">${esc(c)}</td>`).join('')}
      </tr>
    `).join('');

    // 7 Langkah SOP
    document.getElementById('ppdb-steps-list').innerHTML = KB.ppdb.steps.map((s) => `
      <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
        <strong class="text-primary block">${s.no}. ${esc(s.title)}</strong>
        <p class="text-secondary mt-1 leading-relaxed">${esc(s.text)}</p>
      </div>
    `).join('');

    renderPPDBDocs();

    document.getElementById('ppdb-instrumen-list').innerHTML = KB.ppdb.instrumen.map((ins) => `
      <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <strong class="text-primary">${esc(ins.jenjang)}</strong>
          <span class="text-[11px] text-secondary">${esc(ins.metode)}</span>
        </div>
        <div class="text-secondary">${ins.asesmen.map((a) => `• ${esc(a)}`).join('<br/>')}</div>
      </div>
    `).join('');

    renderLiveQuotaChart();
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

    document.getElementById('ppdb-docs-list').innerHTML = docs.map((d) => `
      <div class="py-2.5 flex items-start justify-between gap-3">
        <div>
          <strong class="text-primary">${d.no}. ${esc(d.nama)}</strong>
          <div class="text-[11px] text-secondary mt-0.5">${esc(d.ketentuan)}</div>
        </div>
        <span class="badge-pill !text-[10px] shrink-0">${esc(d.status)}</span>
      </div>
    `).join('');
  }

  // =====================================================================
  // 5. KONSULTASI AI & FAQ — Asisten PPDB Interaktif (Gem) & FAQ + VA Resmi
  // =====================================================================
  function appendChatBubble(role, markdownText, metaText) {
    const stream = document.getElementById('chat-messages');
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    wrap.className = `flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`;
    wrap.innerHTML = `
      <div class="w-7 h-7 rounded-full ${isUser ? 'bg-panel border border-auralis text-primary' : 'bg-primary text-card'} flex items-center justify-center shrink-0 mt-0.5 text-xs">
        <span class="material-symbols-outlined !text-[15px]">${isUser ? 'person' : 'smart_toy'}</span>
      </div>
      <div class="max-w-[85%] ${isUser ? 'bg-primary text-card rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs' : 'bg-card border border-auralis rounded-2xl rounded-tl-sm px-4 py-3 text-xs text-primary chat-md'}">
        ${isUser ? esc(markdownText) : renderMarkdown(markdownText)}
        ${metaText ? `<div class="mt-1.5 pt-1 border-t border-auralis text-[10px] text-secondary">${esc(metaText)}</div>` : ''}
      </div>
    `;
    stream.appendChild(wrap);
    stream.scrollTop = stream.scrollHeight;
  }

  function resetChat() {
    state.chatHistory = [];
    document.getElementById('chat-messages').innerHTML = '';
    appendChatBubble(
      'assistant',
      `Assalamu'alaikum Warahmatullahi Wabarakatuh, Ayah/Bunda.\n\nSaya **${KB.ai.personaName}** (Gemini Custom Gem Model A Terpilih — Fase 3), Asisten PPDB **${KB.yayasan.name}**. Silakan tanyakan simulasi biaya & diskon Pasal 9, syarat usia, kurikulum tahfidz, maupun verifikasi rekening Virtual Account Bank Syariah.`,
      'Grounded pada 6 Dokumen Drive "data masukan"'
    );
  }

  async function sendChatPrompt(promptText) {
    const msg = String(promptText || '').trim();
    if (!msg) return;

    appendChatBubble('user', msg);
    const submitBtn = document.getElementById('chat-submit');
    document.getElementById('chat-input').value = '';
    submitBtn.disabled = true;

    try {
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
      const reply = data.reply || 'Mohon maaf, terjadi kendala.';
      state.chatHistory.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
      appendChatBubble('assistant', reply);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function renderKonsultasi() {
    resetChat();

    const labels = ['1. Diskon Ganda SDIT', '2. Biaya & Tahfidz SMPIT', '3. Anak Belum Lancar Ngaji', '4. Cek VA Resmi vs Pribadi', '5. Usia SD 5 Thn 9 Bln'];
    const chipWrap = document.getElementById('ai-scenarios-chips');
    chipWrap.innerHTML = KB.ai.scenarios.map((s, i) => `
      <button type="button" data-sc="${i}" class="badge-pill !bg-card !normal-case !tracking-normal !font-medium hover:!border-primary shrink-0 cursor-pointer">
        ${esc(labels[i] || s.title)}
      </button>
    `).join('');

    chipWrap.querySelectorAll('[data-sc]').forEach((b) => {
      b.addEventListener('click', () => {
        const sc = KB.ai.scenarios[Number(b.getAttribute('data-sc'))];
        if (sc) sendChatPrompt(sc.prompt);
      });
    });

    renderFAQ();
  }

  function renderFAQ() {
    const catTitles = {
      A: 'Kat. A · Umum & Legalitas',
      B: 'Kat. B · Kurikulum & Tahfidz',
      C: 'Kat. C · Teknis PPDB',
      D: 'Kat. D · Biaya, Cicilan & VA',
      E: 'Kat. E · Solusi Keberatan',
    };
    const cats = [
      { code: 'ALL', label: 'Semua (A–D)' },
      ...KB.faq.categories.map((c) => ({ code: c.code, label: catTitles[c.code] || `Kat. ${c.code}` })),
    ];
    const tabWrap = document.getElementById('faq-cat-tabs');
    tabWrap.innerHTML = cats.map((c) => `
      <button type="button" data-faq-cat="${esc(c.code)}" class="tab-pill !py-1 !px-2.5 !text-[11px] ${state.faqCategory === c.code ? 'active' : ''}">
        ${esc(c.label)}
      </button>
    `).join('');

    tabWrap.querySelectorAll('[data-faq-cat]').forEach((b) => {
      b.addEventListener('click', () => {
        state.faqCategory = b.getAttribute('data-faq-cat');
        renderFAQ();
      });
    });

    const q = state.faqQuery.toLowerCase().trim();
    const items = [];
    for (const cat of KB.faq.categories) {
      if (state.faqCategory !== 'ALL' && state.faqCategory !== cat.code) continue;
      for (const it of cat.items) {
        if (q && !(`${it.id} ${it.q} ${it.a}`).toLowerCase().includes(q)) continue;
        items.push({ ...it, catCode: cat.code });
      }
    }

    document.getElementById('faq-items-list').innerHTML = items.map((it) => `
      <details class="group bg-card rounded-2xl border border-auralis p-3.5 text-xs">
        <summary class="font-semibold text-primary cursor-pointer list-none flex items-center justify-between gap-2">
          <span><span class="badge-pill !py-0.5 !px-1.5 !text-[10px] mr-1.5">Kat. ${esc(it.catCode)}</span>${esc(it.q)}</span>
          <span class="material-symbols-outlined !text-[16px] text-secondary group-open:rotate-180 transition-transform">expand_more</span>
        </summary>
        <p class="text-secondary leading-relaxed mt-2.5 pt-2.5 border-t border-auralis">${esc(it.a)}</p>
      </details>
    `).join('') || `<div class="text-xs text-secondary py-6 text-center">Tidak ada pertanyaan yang cocok.</div>`;
  }

  // =====================================================================
  // DRIVE MODAL & EVENTS
  // =====================================================================
  function renderDriveModal() {
    const files = Object.values(KB.drive.files || {});
    document.getElementById('drive-folder-link').href = KB.drive.folderUrl;
    document.getElementById('drive-generated-at').textContent = new Date(KB.generatedAt).toLocaleDateString('id-ID');
    document.getElementById('drive-files-list').innerHTML = files.map((f) => `
      <div class="bg-panel rounded-xl p-3 border border-auralis flex items-center justify-between gap-3">
        <div>
          <div class="font-semibold text-primary">${esc(f.name)}</div>
          <div class="text-[11px] text-secondary">${esc(f.type.toUpperCase())} · ${esc(f.source)}</div>
        </div>
        <a href="${esc(f.url)}" target="_blank" rel="noopener" class="text-xs font-medium text-primary hover:underline shrink-0">Buka ↗</a>
      </div>
    `).join('');
  }

  function setupTabGroup(containerId, attrName, panePrefix) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.querySelectorAll(`[${attrName}]`).forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute(attrName);
        wrap.querySelectorAll(`[${attrName}]`).forEach((b) => b.classList.toggle('active', b === btn));
        const targetPane = document.getElementById(`${panePrefix}-${target}`);
        if (targetPane) {
          targetPane.classList.remove('hidden');
          targetPane.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  function setupEvents() {
    setupTabGroup('profil-tabs', 'data-profil-tab', 'profil-pane');
    setupTabGroup('ppdb-tabs', 'data-ppdb-tab', 'ppdb-pane');

    // Tombol CTA "Daftar PPDB Online" di Header, Hero & Kalkulator
    document.querySelectorAll('[data-open-ppdb-form]').forEach((btn) => {
      btn.addEventListener('click', () => openPPDBFormTab());
    });

    // Sub-Halaman Unit Pendidikan (Playgroup & TK Islam vs SDIT | SMPIT | SMAIT)
    document.querySelectorAll('#unit-group-tabs [data-unit-group]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.unitGroup = btn.getAttribute('data-unit-group');
        renderUnit();
      });
    });

    // Kalkulator Simulasi
    ['calc-unit', 'calc-wave', 'calc-alumni', 'calc-sibling', 'calc-tahfidz', 'calc-yatim'].forEach((id) => {
      document.getElementById(id).addEventListener('change', runCalculator);
    });

    document.getElementById('btn-ask-calc-ai').addEventListener('click', () => {
      const u = document.getElementById('calc-unit').value;
      const w = document.getElementById('calc-wave').selectedOptions[0].text.split('—')[0].trim();
      const traits = [];
      if (document.getElementById('calc-alumni').checked) traits.push('lulusan internal Al-Mun\'imiyah (Alumni)');
      if (document.getElementById('calc-sibling').checked) traits.push('memiliki kakak/adik aktif di Al-Mun\'imiyah (Sibling)');
      const thf = Number(document.getElementById('calc-tahfidz').value);
      if (thf >= 5) traits.push(`hafalan Al-Qur'an mutqin ${thf} Juz`);
      if (document.getElementById('calc-yatim').checked) traits.push('jalur afirmasi yatim/dhuafa');
      const traitStr = traits.length ? ` dengan kriteria ${traits.join(' dan ')}` : '';
      sendChatPrompt(`Assalamu'alaikum Ustadzah, saya ingin mendaftarkan anak ke jenjang ${u} pada ${w}${traitStr}. Berapa total diskon dan rincian biaya daftar ulang yang harus saya siapkan?`);
      document.getElementById('konsultasi').scrollIntoView({ behavior: 'smooth' });
    });

    document.getElementById('doc-filter-unit').addEventListener('change', renderPPDBDocs);

    // Submit Formulir Registrasi Online Terpadu -> Generate Nomor Registrasi & VA Resmi + Update Grafik Kuota Live
    document.getElementById('ppdb-online-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const nama = document.getElementById('reg-nama').value.trim();
      const unitCode = document.getElementById('reg-unit').value;
      const gelombang = document.getElementById('reg-gelombang').selectedOptions[0].text;
      const beasiswa = document.getElementById('reg-beasiswa').value;
      const wali = document.getElementById('reg-wali').value.trim();
      const wa = document.getElementById('reg-wa').value.trim();

      const feeRow = KB.biaya.units.find((x) => x.code === unitCode) || KB.biaya.units[2];
      const seq = String(Math.floor(1000 + Math.random() * 9000));
      const regNo = `YPIA-26-${unitCode}-${seq}`;
      const vaBsi = `90012${seq}`;

      // Update Live Quota Chart (+1 pendaftar pada unit terkait)
      const qItem = state.liveQuotaStats.find((q) => q.code === unitCode);
      if (qItem && qItem.filled < qItem.total) {
        qItem.filled += 1;
        renderLiveQuotaChart();
      }

      const ticket = document.getElementById('ppdb-reg-ticket');
      ticket.classList.remove('hidden');
      ticket.innerHTML = `
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-auralis pb-2.5">
          <div>
            <span class="typo-label-caps text-emerald-700">Bukti Registrasi Awal PPDB Online (SOP Langkah 1 &amp; 2)</span>
            <h4 class="text-sm font-semibold text-primary mt-0.5">Nomor Registrasi: <code class="px-2 py-0.5 rounded bg-card border border-auralis">${esc(regNo)}</code></h4>
          </div>
          <span class="badge-pill !bg-emerald-50 !text-emerald-800 !border-emerald-200">Terdaftar di Sistem</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div><span class="text-secondary">Calon Siswa:</span> <strong class="text-primary">${esc(nama)}</strong></div>
          <div><span class="text-secondary">Unit Tujuan:</span> <strong class="text-primary">${esc(feeRow.nama)}</strong></div>
          <div><span class="text-secondary">Gelombang:</span> <strong class="text-primary">${esc(gelombang)}</strong></div>
          <div><span class="text-secondary">Jalur/Diskon:</span> <strong class="text-primary">${esc(beasiswa)}</strong></div>
          <div><span class="text-secondary">Wali Murid:</span> <strong class="text-primary">${esc(wali)} (${esc(wa)})</strong></div>
          <div><span class="text-secondary">Biaya Formulir:</span> <strong class="text-emerald-700">${R(feeRow.formulir)}</strong></div>
        </div>
        <div class="bg-card rounded-xl p-3 border border-auralis text-xs space-y-1">
          <strong class="text-primary block">Instruksi Pembayaran Virtual Account Resmi (Statuta Pasal 12 Ayat 3):</strong>
          <div>Bank Syariah Indonesia (BSI) Nomor VA: <code class="px-2 py-0.5 rounded bg-panel font-bold text-primary">${esc(vaBsi)}</code> a.n. <strong>YPIA - ${esc(nama)}</strong></div>
        </div>
      `;
      ticket.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // Salin System Prompt Gemini Custom Gem A (Fase 3)
    document.getElementById('btn-copy-gem-prompt').addEventListener('click', async () => {
      const promptText = (KB.ai && KB.ai.gemAPrompt) || 'Anda adalah Ustadzah Fatimah, Konsultan Pendidikan Islami & Asisten Resmi PPDB Yayasan Pendidikan Islam Al-Mun\'imiyah (YPIA) Bandung.';
      try {
        await navigator.clipboard.writeText(promptText);
        const lbl = document.getElementById('copy-gem-label');
        lbl.textContent = 'System Prompt Tersalin ✓';
        setTimeout(() => { lbl.textContent = 'Salin System Prompt Gem A'; }, 2200);
      } catch {}
    });

    // Konsultasi AI & FAQ
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatPrompt(document.getElementById('chat-input').value);
    });
    document.getElementById('btn-clear-chat').addEventListener('click', resetChat);

    document.getElementById('faq-search').addEventListener('input', (e) => {
      state.faqQuery = e.target.value;
      renderFAQ();
    });

    // Drive Modal
    const modal = document.getElementById('drive-modal');
    document.getElementById('btn-drive-status').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('btn-close-drive-modal').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    // Mobile Menu
    const mobileMenu = document.getElementById('mobile-menu');
    document.getElementById('btn-mobile-menu').addEventListener('click', () => mobileMenu.classList.toggle('hidden'));

    // Scroll Spy
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

  async function init() {
    setupEvents();
    try {
      const res = await fetch('./api/kb');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      KB = await res.json();
    } catch {
      const res = await fetch('./data/kb.json');
      KB = await res.json();
    }
    renderBeranda();
    renderProfil();
    renderUnit();
    renderPPDB();
    renderKonsultasi();
    renderDriveModal();
  }

  document.addEventListener('DOMContentLoaded', init);
})();