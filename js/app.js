/**
 * Portal Web Terpadu YPIA (SI-YAYASAN) — Simplified Auralis Frontend Controller
 * Struktur 5 Modul Utama:
 *  1. Beranda (#beranda)
 *  2. Profil & Tata Kelola (#profil)
 *  3. Unit Pendidikan (#unit)
 *  4. Informasi PPDB (#ppdb)
 *  5. Konsultasi AI & FAQ (#konsultasi)
 */
(function () {
  const R = window.YPIACore.formatRp;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let KB = null;
  const state = {
    activeUnit: 'SD',
    faqCategory: 'ALL',
    faqQuery: '',
    chatHistory: [],
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

  // =====================================================================
  // 1. BERANDA
  // =====================================================================
  function renderBeranda() {
    const y = KB.yayasan;
    document.getElementById('hero-sk').textContent = y.sk;
    document.getElementById('hero-semboyan').textContent = `"${y.semboyan}."`;
    document.getElementById('hero-address').textContent = y.address;
    document.getElementById('hero-ta').textContent = KB.biaya.tahunAjaran || '2026/2027';

    const totalQuota = KB.ppdb.kuota.reduce((acc, k) => acc + (parseInt(k.total, 10) || 0), 0);
    document.getElementById('hero-quota').textContent = `${totalQuota || 462} Siswa`;

    document.getElementById('hero-values-strip').innerHTML = y.values.map((v) => `
      <span class="badge-pill !normal-case !tracking-normal !font-medium">
        <strong class="text-primary">${esc(v.name)}</strong>
        <span class="text-secondary">· ${esc(v.meaning)}</span>
      </span>
    `).join('');
  }

  // =====================================================================
  // 2. PROFIL & TATA KELOLA
  // =====================================================================
  function renderProfil() {
    const y = KB.yayasan;
    document.getElementById('profil-doc-no').textContent = y.docNumber;
    document.getElementById('profil-mukadimah').textContent = y.mukadimah;
    document.getElementById('profil-name').textContent = `${y.name} (${y.shortName})`;
    document.getElementById('profil-visi').textContent = `"${y.visi}"`;

    const legalRows = [
      ['Tanggal Berdiri', y.founded],
      ['SK Kemenkumham RI', y.sk],
      ['Akta Pendirian', y.legal[1] || ''],
      ['Akreditasi', y.legal[2] || ''],
      ['Asas Yayasan', y.asas],
    ];
    document.getElementById('profil-legal-rows').innerHTML = legalRows.map(([k, v]) => `
      <div class="py-2.5 flex flex-col sm:flex-row sm:justify-between gap-1">
        <span class="text-secondary shrink-0">${esc(k)}</span>
        <span class="font-medium text-primary sm:text-right">${esc(v)}</span>
      </div>
    `).join('');

    document.getElementById('profil-misi').innerHTML = y.misi.map((m, i) => `
      <div class="bg-panel rounded-2xl p-4 border border-auralis">
        <span class="typo-label-caps text-secondary">Misi 0${i + 1}</span>
        <p class="text-xs text-primary leading-relaxed mt-1.5">${esc(m)}</p>
      </div>
    `).join('');

    document.getElementById('profil-struktur-grid').innerHTML = y.struktur.map((s) => {
      const isKepala = /^Kepala/i.test(s.jabatan);
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

    document.getElementById('profil-sdm-list').innerHTML = KB.kurikulum.sdm.map((s) => `
      <div class="py-3 first:pt-0 last:pb-0">
        <div class="font-semibold text-primary mb-1">${esc(s.aspek)}</div>
        <div class="text-secondary space-y-0.5">
          ${s.ketentuan.map((k) => `<div>• ${esc(k)}</div>`).join('')}
        </div>
      </div>
    `).join('');

    document.getElementById('profil-kpi-list').innerHTML = KB.kurikulum.kpi.map((k) => `
      <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
        <div class="flex items-center justify-between font-semibold text-primary mb-1">
          <span>${esc(k.kode)} · ${esc(k.dimensi)}</span>
          <span class="badge-pill !bg-card !py-0.5 !px-2">${esc(k.bobot)}</span>
        </div>
        <p class="text-secondary leading-relaxed">${esc(k.indikator)}</p>
      </div>
    `).join('');
  }

  // =====================================================================
  // 3. UNIT PENDIDIKAN (1 Focused Unit View + Halaqah Strip)
  // =====================================================================
  function renderUnit() {
    document.getElementById('unit-intro').textContent = KB.kurikulum.intro;

    const tabWrap = document.getElementById('unit-tabs');
    tabWrap.innerHTML = KB.units.map((u) => `
      <button type="button" data-unit-code="${esc(u.code)}" class="tab-pill ${state.activeUnit === u.code ? 'active' : ''}">
        ${esc(u.nama.replace(/Al-Mun'imiyah/i, '').trim())}
      </button>
    `).join('');

    tabWrap.querySelectorAll('[data-unit-code]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeUnit = btn.getAttribute('data-unit-code');
        renderUnit();
      });
    });

    const u = KB.units.find((x) => x.code === state.activeUnit) || KB.units[2];
    document.getElementById('unit-detail-card').innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div class="lg:col-span-5 space-y-4">
          <div class="flex flex-wrap items-center gap-2">
            <span class="badge-pill">
              <span class="dot-indicator bg-emerald-500"></span>
              <span>Kode Unit: ${esc(u.code)}</span>
            </span>
            <span class="badge-pill">Daya Tampung: ${esc(u.kuota.total)}</span>
          </div>
          <h3 class="typo-h3 text-primary">${esc(u.nama)}</h3>
          <p class="text-xs text-secondary leading-relaxed">${esc(u.statuta.target)}</p>

          <div class="grid grid-cols-2 gap-3 pt-2">
            <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
              <span class="text-secondary block">Syarat Usia / Lulus</span>
              <strong class="text-primary mt-0.5 block">${esc(u.statuta.usia)}</strong>
            </div>
            <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
              <span class="text-secondary block">Jam Belajar Efektif</span>
              <strong class="text-primary mt-0.5 block">${esc(u.statuta.jam)}</strong>
            </div>
            <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
              <span class="text-secondary block">Uang Pangkal / SPP</span>
              <strong class="text-primary mt-0.5 block">${R(u.biaya.dpp)} / ${R(u.biaya.spp)}</strong>
            </div>
            <div class="bg-panel rounded-xl p-3.5 border border-auralis text-xs">
              <span class="text-secondary block">Kepala Unit</span>
              <strong class="text-primary mt-0.5 block">${esc(u.kepala ? u.kepala.nama : '-')}</strong>
            </div>
          </div>

          <div class="flex flex-wrap gap-2.5 pt-2">
            <button type="button" id="btn-unit-calc" class="btn-primary !py-2 !px-4 !text-xs">Simulasikan Biaya ${esc(u.code)}</button>
            <button type="button" id="btn-unit-ask" class="btn-secondary !py-2 !px-4 !text-xs">Tanya AI Tentang ${esc(u.code)}</button>
          </div>
        </div>

        <div class="lg:col-span-7 grid grid-cols-1 gap-3.5 text-xs">
          <div class="bg-panel rounded-2xl p-4 border border-auralis">
            <span class="typo-label-caps text-secondary">Proporsi Muatan Tri-Kurikulum</span>
            <div class="text-sm font-semibold text-primary mt-1">${esc(u.kurikulum.proporsi)}</div>
          </div>
          <div class="bg-panel rounded-2xl p-4 border border-auralis">
            <span class="typo-label-caps text-emerald-700">Metode &amp; Target Tahsin / Tahfidz Al-Qur'an</span>
            <p class="text-primary leading-relaxed mt-1">${esc(u.kurikulum.tahfidz)}</p>
          </div>
          <div class="bg-panel rounded-2xl p-4 border border-auralis">
            <span class="typo-label-caps text-blue-700">Program Pembiasaan Adab &amp; Ibadah Harian</span>
            <p class="text-primary leading-relaxed mt-1">${esc(u.kurikulum.adab)}</p>
          </div>
          <div class="bg-panel rounded-2xl p-4 border border-auralis">
            <span class="typo-label-caps text-rose-700">Muatan Unggulan Sains, Bahasa &amp; Teknologi</span>
            <p class="text-primary leading-relaxed mt-1">${esc(u.kurikulum.unggulan)}</p>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-unit-calc').onclick = () => {
      document.getElementById('calc-unit').value = u.code;
      runCalculator();
      document.getElementById('ppdb').scrollIntoView({ behavior: 'smooth' });
    };
    document.getElementById('btn-unit-ask').onclick = () => {
      sendChatPrompt(`Assalamu'alaikum Ustadzah, mohon informasi lengkap mengenai kurikulum, target tahfidz, dan biaya untuk jenjang ${u.nama}.`);
      document.getElementById('konsultasi').scrollIntoView({ behavior: 'smooth' });
    };

    document.getElementById('unit-halaqah-strip').innerHTML = KB.kurikulum.halaqah.map((h) => `
      <div class="surface-panel p-4 rounded-2xl">
        <h4 class="text-xs font-semibold text-primary mb-1">${esc(h.title)}</h4>
        <p class="text-[11px] text-secondary leading-relaxed">${esc(h.text)}</p>
      </div>
    `).join('');
  }

  // =====================================================================
  // 4. INFORMASI PPDB & KALKULATOR SIMULASI
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

  function renderPPDB() {
    document.getElementById('ppdb-doc-no').textContent = `SK ${KB.biaya.sk} · SOP ${KB.ppdb.docNumber}`;
    document.getElementById('ppdb-intro').textContent = KB.ppdb.intro;

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
  // 5. KONSULTASI AI & FAQ
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
      `Assalamu'alaikum Warahmatullahi Wabarakatuh, Ayah/Bunda.\n\nSaya **${KB.ai.personaName}**, Asisten PPDB **${KB.yayasan.name}**. Silakan tanyakan rincian biaya & beasiswa, syarat usia, kurikulum tahfidz, maupun jadwal PPDB.`,
      'Sumber: Folder Google Drive "data masukan"'
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

    const labels = ['Simulasi Diskon Ganda', 'Biaya & Beasiswa SMPIT', 'Anak Belum Lancar Ngaji', 'Aturan VA Resmi', 'Usia SD 5 Thn 9 Bln'];
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
    const cats = [
      { code: 'ALL', label: 'Semua' },
      ...KB.faq.categories.map((c) => ({ code: c.code, label: `Kat. ${c.code}` })),
    ];
    const tabWrap = document.getElementById('faq-cat-tabs');
    tabWrap.innerHTML = cats.map((c) => `
      <button type="button" data-faq-cat="${esc(c.code)}" class="tab-pill !py-1 !px-3 !text-xs ${state.faqCategory === c.code ? 'active' : ''}">
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
        items.push(it);
      }
    }

    document.getElementById('faq-items-list').innerHTML = items.map((it) => `
      <details class="group bg-card rounded-2xl border border-auralis p-4 text-xs">
        <summary class="font-semibold text-primary cursor-pointer list-none flex items-center justify-between gap-2">
          <span>${esc(it.q)}</span>
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
        document.querySelectorAll(`[id^="${panePrefix}-"]`).forEach((pane) => {
          pane.classList.toggle('hidden', pane.id !== `${panePrefix}-${target}`);
        });
      });
    });
  }

  function setupEvents() {
    setupTabGroup('profil-tabs', 'data-profil-tab', 'profil-pane');
    setupTabGroup('ppdb-tabs', 'data-ppdb-tab', 'ppdb-pane');

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

    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatPrompt(document.getElementById('chat-input').value);
    });
    document.getElementById('btn-clear-chat').addEventListener('click', resetChat);

    document.getElementById('faq-search').addEventListener('input', (e) => {
      state.faqQuery = e.target.value;
      renderFAQ();
    });

    const modal = document.getElementById('drive-modal');
    document.getElementById('btn-drive-status').addEventListener('click', () => modal.classList.remove('hidden'));
    document.getElementById('btn-close-drive-modal').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    const mobileMenu = document.getElementById('mobile-menu');
    document.getElementById('btn-mobile-menu').addEventListener('click', () => mobileMenu.classList.toggle('hidden'));

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
