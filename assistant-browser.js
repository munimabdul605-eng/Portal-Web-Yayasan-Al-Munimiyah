/**
 * YPIA Assistant (Universal Browser + Node.js)
 * Mesin konsultasi "Ustadzah Fatimah" berbasis Knowledge Base resmi YPIA.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'));
  } else {
    root.YPIAAssistant = factory(root.YPIACore);
  }
})(typeof self !== 'undefined' ? self : this, function (Core) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ');
  const R = Core.formatRp;
  const sanitize = (s) => String(s || '').replace(/\s*—\s*/g, ': ');

  const UNIT_RE = [
    ['PG', /\b(pg|playgroup|play group|kelompok bermain)\b/],
    ['TK', /\b(tk|tka|tkb|tk a|tk b|taman kanak)/],
    ['SD', /\b(sd|sdit|sekolah dasar)\b/],
    ['SMP', /\b(smp|smpit)\b/],
    ['SMA', /\b(sma|smait)\b/],
  ];

  function unitMentions(t) {
    const out = [];
    for (const [code, re] of UNIT_RE) {
      const g = new RegExp(re.source, 'g');
      let m;
      while ((m = g.exec(t))) out.push({ code, idx: m.index });
    }
    return out.sort((a, b) => a.idx - b.idx);
  }

  function targetUnit(t) {
    const ms = unitMentions(t);
    const ok = ms.filter((m) => !/(lulusan|alumni|dari|kakak\w*|adik\w*|sedang aktif\w*|aktif sekolah)\s+(di\s+)?(\w+\s+){0,2}$/.test(t.slice(Math.max(0, m.idx - 40), m.idx)));
    return (ok[0] || ms[0] || {}).code || null;
  }

  function costOptions(t) {
    let gelombang = null;
    const g = t.match(/gelombang\s*(1|2|3|satu|dua|tiga|iii|ii|i)\b/);
    if (g) gelombang = { 1: 'GEL-1', satu: 'GEL-1', i: 'GEL-1', 2: 'GEL-2', dua: 'GEL-2', ii: 'GEL-2', 3: 'GEL-3', tiga: 'GEL-3', iii: 'GEL-3' }[g[1]];
    if (/early ?bird/.test(t)) gelombang = 'GEL-1';
    const tah = t.match(/(\d{1,2})\s*juz/);
    return {
      gelombang,
      alumni: /alumni|lulusan\s+(pg|tk|sd|sdit|smp|smpit)\b/.test(t),
      sibling: /(kakak|adik|saudara)\w*/.test(t) && /(aktif|sekolah|juga|sedang)/.test(t),
      tahfidz: tah && /(hafal|hafalan|tahfidz|mutqin)/.test(t) ? +tah[1] : 0,
      yatim: /yatim|dhuafa/.test(t),
      lunas: /lunas/.test(t),
    };
  }

  function costTable(kb, unit, o) {
    const opts = { unit, gelombang: o.gelombang || 'GEL-3', alumni: o.alumni, sibling: o.sibling, tahfidz: o.tahfidz, yatim: o.yatim };
    const r = Core.simulate(kb, opts);
    if (!r) return '';
    const c = r.cicilan, l = r.lunas;
    const lines = [
      `**Simulasi biaya ${r.fee.nama}** (${r.gel.nama})${o.gelombang ? '' : ' *(gelombang belum disebutkan, dihitung tarif normal)*'}`,
      '',
      `Potongan Statuta terpilih: **${r.best.nama} (${r.best.dpp}%)**, digabung Diskon Gelombang **${r.gel.dpp}%** sehingga total potongan DPP **${c.dppPct}%**${r.lunasScheme.dpp ? ` (atau **${l.dppPct}%** jika lunas di awal)` : ''}.`,
      '',
      '| Komponen | Skema Cicilan 3x | Skema Lunas |',
      '|---|---|---|',
      `| DPP normal | ${R(r.fee.dpp)} | ${R(r.fee.dpp)} |`,
      `| DPP bersih | **${R(c.dppNet)}** | **${R(l.dppNet)}** |`,
      `| Paket Seragam, Buku & Kegiatan | ${R(c.paket)} | ${R(l.paket)} |`,
      `| SPP Juli${c.sppPct ? ` (diskon ${c.sppPct}%)` : ''} | ${R(c.spp)} | ${R(l.spp)} |`,
      `| **Total Daftar Ulang** | **${R(c.daftarUlang)}** | **${R(l.daftarUlang)}** |`,
      `| Dibayar saat daftar ulang | ${R(c.termin[0].nominal)} (Tahap 1) | ${R(l.daftarUlang)} |`,
      '',
      `Cicilan 0%: Tahap 2 (maks. 10 Oktober) ${R(c.termin[1].nominal)} · Tahap 3 (maks. 10 Januari) ${R(c.termin[2].nominal)}. Biaya formulir terpisah: ${R(r.formulir)}.`,
    ];
    if (r.notes.length) lines.push('', ...r.notes.map((n) => `- ${n}`));
    return lines.join('\n');
  }

  function faqById(kb, id) {
    for (const c of kb.faq.categories) for (const it of c.items) if (it.id === id) return it;
    return null;
  }
  const objByCode = (kb, code) => kb.faq.objections.find((o) => o.kode === code);
  const wa = (kb) => kb.contact.whatsapp;

  const handlers = [
    {
      name: 'integritas',
      test: (t) => /titip|rekening pribadi|ke rekening (panitia|guru|staf|ustad)|diamankan|jalur khusus|sumbangan (lebih|ke panitia)|uang pelicin|tanpa (perlu )?(ikut )?(observasi|tes|seleksi)|pasti lulus|nyogok|sogok|suap/.test(t),
      run: (kb) => {
        const va = faqById(kb, 'FAQ-D05');
        return `Mohon maaf Ayah/Bunda, dengan penuh hormat kami **tidak dapat** menerima permintaan tersebut. Demi menjaga keberkahan ilmu ananda, seluruh penerimaan murni berdasarkan hasil observasi atau tes dan ketersediaan kuota sesuai **Statuta Pasal 8**, serta **Statuta Pasal 12 ayat (3)** menegaskan: ${kb.yayasan.digital[2] || ''}\n\n${va ? va.a : ''}\n\nAyah/Bunda dapat mengikuti alur resmi 7 langkah PPDB. Untuk jenjang PG, TK, dan SDIT **tidak ada tes calistung** sama sekali.`;
      },
    },
    {
      name: 'va',
      test: (t) => /virtual\s*account|\bva\b|nomor rekening|\brekening resmi\b|\bbsi\b|muamalat|bjb\s*syariah|(cara|metode)\s*(pembayaran|transfer|bayar)/.test(t) && !/rekening pribadi/.test(t),
      run: (kb, t, ctx) => {
        if (ctx.done.has('integritas')) return '';
        const va = faqById(kb, 'FAQ-D05');
        if (va) return va.a;
        return `Sesuai Statuta Pasal 12 Ayat (3), seluruh pembayaran hanya sah melalui Nomor Virtual Account (VA) resmi atas nama **YPI AL-MUN'IMIYAH** di Bank Syariah Indonesia (**BSI** kode prefix **90012** untuk PPDB / **90088** untuk SPP), **Bank Muamalat** (**77101**), atau **Bank BJB Syariah** (**88205**). Yayasan melarang keras pembayaran tunai maupun transfer ke rekening pribadi.`;
      },
    },
    {
      name: 'usia',
      test: (t) => /\b\d{1,2}\s*(tahun|thn|th)\b(?!\s*(ajaran|pertama|terakhir|lalu|ini|depan))/.test(t),
      run: (kb, t) => {
        const re = /(\d{1,2})\s*(?:tahun|thn|th)\b(?:\s*(\d{1,2})\s*(?:bulan|bln))?/g;
        const out = [];
        let m;
        while ((m = re.exec(t))) {
          const y = +m[1], mo = +(m[2] || 0);
          const after = t.slice(m.index, m.index + 90);
          const before = t.slice(Math.max(0, m.index - 60), m.index);
          const unit = (unitMentions(after)[0] || unitMentions(before).slice(-1)[0] || {}).code;
          if (!unit) continue;
          const q = kb.ppdb.kuota.find((k) => k.code === unit) || {};
          const months = y * 12 + mo;
          let verdict = '';
          if (unit === 'SD') {
            if (months >= 72) verdict = '**Memenuhi** syarat usia prioritas SDIT (>= 6 tahun 0 bulan per 1 Juli).';
            else if (months >= 68) verdict = `**Dapat mendaftar** dengan syarat kondisional. ${(faqById(kb, 'FAQ-B01') || {}).a || ''}`;
            else verdict = '**Belum memenuhi** batas usia SDIT. Ananda dapat dipertimbangkan untuk jenjang TK terlebih dahulu.';
          } else if (unit === 'PG') verdict = months >= 36 ? '**Memenuhi** syarat usia Playgroup (minimal 3 tahun 0 bulan).' : '**Belum memenuhi** usia minimal Playgroup (3 tahun 0 bulan).';
          else if (unit === 'TK') verdict = months >= 60 ? '**Memenuhi** syarat TK B (minimal 5 tahun).' : months >= 48 ? '**Memenuhi** syarat TK A (minimal 4 tahun).' : '**Belum memenuhi** usia minimal TK A (4 tahun). Ananda dapat mendaftar Playgroup.';
          else if (unit === 'SMP') verdict = y <= 15 ? '**Memenuhi** batas usia SMPIT (maksimal 15 tahun), dengan syarat lulus SD/MI sederajat.' : '**Melebihi** batas usia maksimal SMPIT (15 tahun).';
          else if (unit === 'SMA') verdict = y <= 18 ? '**Memenuhi** batas usia SMAIT (maksimal 18 tahun), dengan syarat lulus SMP/MTs sederajat.' : '**Melebihi** batas usia maksimal SMAIT (18 tahun).';
          out.push(`**${q.nama || unit} (usia ${y} tahun${mo ? ` ${mo} bulan` : ''}):** ${verdict}\n*Ketentuan resmi: ${q.syarat || '-'}*`);
        }
        return out.join('\n\n');
      },
    },
    {
      name: 'asrama',
      test: (t) => /asrama|boarding|mondok|menginap|nginap/.test(t),
      run: (kb) => `Perlu kami luruskan dengan lembut, Ayah/Bunda: **tidak tersedia sistem asrama** di ${kb.yayasan.shortName}. ${(faqById(kb, 'FAQ-A02') || {}).a || ''}`,
    },
    {
      name: 'calistung',
      test: (t) => /calistung|baca tulis|belum (lancar|bisa) (membaca|baca)(?! al)/.test(t) && !/al.?quran|iqra|mengaji|ngaji/.test(t),
      run: (kb) => (faqById(kb, 'FAQ-B02') || {}).a,
    },
    {
      name: 'tahsin',
      test: (t) => /iqra|belum (lancar|bisa) (mengaji|ngaji|baca al|membaca al)|terbata|tahsin|baca al.?quran(nya)? masih/.test(t),
      run: (kb) => {
        const h = kb.kurikulum.halaqah.find((x) => /Matrikulasi/i.test(x.title));
        return `${(faqById(kb, 'FAQ-B03') || {}).a || ''}${h ? `\n\n*${h.title}:* ${h.text}` : ''}`;
      },
    },
    {
      name: 'fullday',
      test: (t) => /stres|stress|capek|cape|lelah|kelelahan|pulang sore|full ?day|kecapekan/.test(t),
      run: (kb) => `Kami sangat memahami kekhawatiran Ayah/Bunda. Kurikulum dan jadwal *Full Day School* di ${kb.yayasan.shortName} dirancang sesuai psikologi perkembangan anak. Kegiatan diselingi istirahat cukup, makan siang bersama (Katering Sehat Halal-Thayyiban), shalat berjamaah, proyek eksperimen, dan olahraga. Menghafal Al-Qur'an dilakukan pada pagi hari (07.00 s.d. 08.15 WIB) tanpa beban PR menghafal berlebihan di rumah. Kami juga mengundang Ayah/Bunda mengikuti *Trial Class / Open House Gratis* pada hari Sabtu.`,
    },
    {
      name: 'mahal',
      test: (t) => /mahal|kemahalan|terlalu tinggi|cukup tinggi|berat (biaya|bayar)|keringanan|tidak mampu|kurang mampu/.test(t),
      run: (kb) => {
        const sch = kb.biaya.schemes.filter((s) => s.dpp > 0 || s.spp > 0)
          .map((s) => `- **${s.nama}:** DPP ${s.dpp}%${s.spp ? `, SPP ${s.spp}%` : ''}. ${s.syarat}`).join('\n');
        return `Kami memahami pertimbangan Ayah/Bunda. Investasi pendidikan di ${kb.yayasan.name} sudah mencakup **Halaqah Tahfidz rasio 1:10 setiap pagi (75 menit)**, **Klinik Intensif Tahsin Sore gratis**, lisensi pembelajaran digital (Coding Dasar SD / Robotika SMP / AI & Python SMA), serta fasilitas lengkap tanpa pungutan ujian tersembunyi.\n\nBerikut pilihan keringanan dan beasiswa resmi yang tersedia:\n${sch}\n\n${(faqById(kb, 'FAQ-D03') || {}).a || ''}`;
      },
    },
    {
      name: 'biaya',
      test: (t) => /biaya|diskon|potongan|rincian|uang pangkal|\bdpp\b|\bspp\b|simulasi|daftar ulang|siapkan|tarif|harga/.test(t) || (/berapa/.test(t) && !/nomor|rekening|\bva\b|virtual\s*account|\bbsi\b|muamalat|bjb|kuota|kursi|rombel|usia|umur|tahun|bulan|jam|lama|hafal|tahfidz|juz|surat|\bwa\b|whatsapp|telepon|kontak/.test(t)),
      run: (kb, t, ctx) => {
        if (ctx.done.has('mahal') && !/rincian|simulasi|total|berapa/.test(t)) return '';
        const unit = targetUnit(t);
        if (unit) return costTable(kb, unit, costOptions(t));
        if (/refund|kembali|batal|mengundurkan/.test(t)) return '';
        const rows = kb.biaya.units.map((u) => `| ${u.nama} | ${R(u.formulir)} | ${R(u.dpp)} | ${R(u.paket)} | ${R(u.spp)} |`).join('\n');
        return `Berikut ringkasan tarif normal sesuai SK Keuangan ${kb.biaya.sk} (TA ${kb.biaya.tahunAjaran}):\n\n| Jenjang | Formulir | Uang Pangkal (DPP) | Paket Seragam-Buku-Kegiatan | SPP/bulan |\n|---|---|---|---|---|\n${rows}\n\nSebutkan jenjang, gelombang, dan kriteria ananda (alumni, saudara kandung, atau hafalan Al-Qur'an) agar kami bantu hitungkan simulasi potongannya.`;
      },
    },
    {
      name: 'jadwal',
      test: (t) => /kapan|jadwal|timeline|gelombang|dibuka|ditutup|tanggal|pengumuman|mpls|masih (buka|bisa daftar)/.test(t) && !/biaya|diskon|berapa|rincian/.test(t),
      run: (kb) => {
        const st = Core.waveStatuses(kb.ppdb.timeline, new Date());
        const rows = st.map((w) => `| ${w.name} | ${Core.fmtDate(w.start)} s.d. ${Core.fmtDate(w.formEnd)} | ${Core.fmtDate(w.announce)} | **${Core.STATUS_LABEL[w.status]}** |`).join('\n');
        const allClosed = st.length && st.every((w) => w.status === 'closed');
        const mpls = kb.ppdb.timeline.rows.find((r) => /MPLS/i.test(r.tahap));
        return `Jadwal PPDB TA ${kb.biaya.tahunAjaran}:\n\n| Gelombang | Pendaftaran | Pengumuman | Status |\n|---|---|---|---|\n${rows}\n\n${mpls ? `Hari pertama KBM/MPLS: **${mpls.cells[0]}**.` : ''}${allClosed ? `\n\nSeluruh gelombang PPDB TA ${kb.biaya.tahunAjaran} telah selesai. Informasi PPDB tahun ajaran berikutnya akan diumumkan melalui portal ini, atau Ayah/Bunda dapat menanyakan kursi mutasi/daftar tunggu ke WhatsApp ${wa(kb)}.` : ''}`;
      },
    },
    {
      name: 'dokumen',
      test: (t) => /dokumen|berkas|persyaratan|syarat (daftar|pendaftaran|administrasi)|apa saja yang (perlu|harus) disiapkan|checklist/.test(t),
      run: (kb, t) => {
        const unit = targetUnit(t);
        const list = kb.ppdb.dokumen.filter((d) => !unit || /semua/i.test(d.jenjang) || new RegExp(`\\b${unit}\\b`).test(d.jenjang) || (unit === 'SD' && /PG-SD|PG, TK, dan SD/.test(d.jenjang)));
        return `Daftar berkas ${unit ? `untuk jenjang **${unit}**` : 'PPDB'}:\n\n${list.map((d) => `${d.no}. **${d.nama}:** ${d.status}. ${d.ketentuan}`).join('\n')}`;
      },
    },
    {
      name: 'kurikulum',
      test: (t) => /kurikulum|target hafalan|tahfidz|hafalan|coding|robotik|program unggulan|ekskul|pelajaran|jam belajar|jam sekolah|metode/.test(t) && !/(\d{1,2})\s*juz/.test(t),
      run: (kb, t) => {
        const unit = targetUnit(t);
        const us = unit ? kb.units.filter((u) => u.code === unit) : kb.units;
        if (!unit) return `${kb.kurikulum.intro}\n\n${us.map((u) => `- **${u.nama}:** ${u.kurikulum.tahfidz}`).join('\n')}`;
        const u = us[0];
        return `**${u.nama}**\n\n- **Proporsi kurikulum:** ${u.kurikulum.proporsi}\n- **Tahsin dan Tahfidz:** ${u.kurikulum.tahfidz}\n- **Pembiasaan adab dan ibadah:** ${u.kurikulum.adab}\n- **Unggulan sains, bahasa, dan teknologi:** ${u.kurikulum.unggulan}\n- **Jam belajar:** ${u.statuta.jam}`;
      },
    },
    {
      name: 'kontak',
      test: (t) => /kontak|alamat|lokasi|hubungi|whatsapp|\bwa\b|telepon|nomor (hp|telp)|email/.test(t),
      run: (kb) => `- **Alamat:** ${kb.contact.address}\n- **Sekretariat PPDB:** ${kb.contact.sekretariat}\n- **WhatsApp Center:** ${kb.contact.whatsapp}\n- **Email Kurikulum:** ${kb.contact.email}`,
    },
  ];

  const STOP = new Set('yang dan di ke dari untuk dengan apa apakah ini itu ada saya anak kami kita bisa akan atau juga pada dalam sudah belum tidak bagaimana berapa kalau jika agar karena oleh sebagai seperti adalah bunda ayah ananda mohon tolong info informasi mau ingin nya kah lah sekolah yayasan munimiyah al'.split(' '));
  const tokenize = (s) => norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).map((w) => w.replace(/(nya|kah|lah)$/, '')).filter((w) => w.length > 2 && !STOP.has(w));

  function buildCorpus(kb) {
    const docs = [];
    for (const c of kb.faq.categories) for (const it of c.items) docs.push({ id: it.id, text: `${it.q} ${it.q} ${it.a}`, answer: it.a, title: it.q });
    for (const k of kb.ppdb.kasusKhusus) docs.push({ id: k.title, text: `${k.title} ${k.text}`, answer: `**${k.title}:** ${k.text}` });
    for (const h of kb.kurikulum.halaqah) docs.push({ id: h.title, text: `${h.title} ${h.text}`, answer: `**${h.title}:** ${h.text}` });
    for (const p of kb.yayasan.pasal) docs.push({ id: `Pasal ${p.no}`, text: `${p.title} ${p.ayat.join(' ')}`, answer: `**Statuta Pasal ${p.no} (${p.title}):**\n${p.ayat.map((a, i) => `(${i + 1}) ${a}`).join('\n')}` });
    docs.push({ id: 'visi', text: `visi misi ${kb.yayasan.visi} ${kb.yayasan.misi.join(' ')}`, answer: `**Visi:** ${kb.yayasan.visi}\n\n**Misi:**\n${kb.yayasan.misi.map((m, i) => `${i + 1}. ${m}`).join('\n')}` });
    docs.push({ id: 'struktur', text: `struktur pengurus ketua kepala sekolah pimpinan pembina pengawas ${kb.yayasan.struktur.map((s) => s.jabatan + ' ' + s.nama).join(' ')}`, answer: `**Struktur Pimpinan ${kb.yayasan.shortName}:**\n${kb.yayasan.struktur.map((s) => `- **${s.jabatan}:** ${s.nama}`).join('\n')}` });
    docs.push({ id: 'alur', text: `alur cara langkah mendaftar pendaftaran prosedur ${kb.ppdb.steps.map((s) => s.title).join(' ')}`, answer: `**Alur Pendaftaran Online (7 Langkah):**\n${kb.ppdb.steps.map((s) => `${s.no}. **${s.title}:** ${s.text}`).join('\n')}` });
    for (const ins of kb.ppdb.instrumen) docs.push({ id: `seleksi ${ins.jenjang}`, text: `tes seleksi observasi ujian masuk ${ins.jenjang} ${ins.metode} ${ins.asesmen.join(' ')} ${ins.kriteria}`, answer: `**Seleksi ${ins.jenjang}** (${ins.metode})\n${ins.asesmen.map((a) => `- ${a}`).join('\n')}\n\n*Kriteria kelulusan:* ${ins.kriteria}` });
    const N = docs.length, df = {};
    docs.forEach((d) => { d.tokens = new Set(tokenize(d.text)); d.tokens.forEach((w) => { df[w] = (df[w] || 0) + 1; }); });
    return { docs, idf: (w) => Math.log(1 + N / ((df[w] || 0) + 0.5)) };
  }

  let corpusCache = { kb: null, corpus: null };
  function search(kb, query) {
    if (corpusCache.kb !== kb) corpusCache = { kb, corpus: buildCorpus(kb) };
    const { docs, idf } = corpusCache.corpus;
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    const total = q.reduce((s, w) => s + idf(w), 0);
    return docs.map((d) => ({ d, score: q.reduce((s, w) => s + (d.tokens.has(w) ? idf(w) : 0), 0) / total }))
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  }

  function localAnswer(kb, message, history = []) {
    const t = norm(message);
    const parts = [];
    const ctx = { done: new Set() };
    const isFirst = !history.some((h) => h.role === 'assistant' && !/^\s*$/.test(h.content));

    for (const h of handlers) {
      if (!h.test(t)) continue;
      const out = h.run(kb, t, ctx);
      if (out) { parts.push(out); ctx.done.add(h.name); }
    }

    if (!parts.length) {
      const hits = search(kb, message);
      if (hits[0] && hits[0].score >= 0.34) {
        parts.push(hits[0].d.answer);
        if (hits[1] && hits[1].score >= 0.6 && hits[1].score > hits[0].score * 0.85) parts.push(hits[1].d.answer);
      }
    }

    const greetOnly = /^(assalamu.?alaikum|asalamualaikum|halo|hai|hi|hello|selamat (pagi|siang|sore|malam)|permisi)\b/.test(t) && t.length < 60;
    let body;
    if (!parts.length && greetOnly) {
      body = `Saya **${kb.ai.personaName}**, Konsultan PPDB ${kb.yayasan.name}. Ada yang bisa saya bantu terkait jenjang **PG, TK, SDIT, SMPIT, atau SMAIT**? Ayah/Bunda dapat menanyakan syarat usia, kurikulum dan tahfidz, jadwal PPDB, maupun simulasi biaya dan beasiswa.`;
    } else if (!parts.length) {
      const o = objByCode(kb, 'OBJ-04');
      body = `Mohon maaf Ayah/Bunda, pertanyaan tersebut di luar cakupan informasi resmi yang dapat saya sampaikan${o ? '' : ''}. Saya hanya dapat membantu seputar layanan pendidikan ${kb.yayasan.name}: profil dan tata kelola, unit pendidikan, kurikulum dan tahfidz, PPDB, serta biaya dan beasiswa. Untuk keputusan khusus Pimpinan Yayasan, silakan menghubungi **WhatsApp Resmi Panitia ${wa(kb)}**.`;
    } else body = parts.join('\n\n');

    const greet = isFirst ? "Assalamu'alaikum Warahmatullahi Wabarakatuh, Ayah/Bunda yang dirahmati Allah.\n\n" : '';
    const closing = parts.length ? `\n\nUntuk konfirmasi lebih lanjut terkait pendaftaran atau verifikasi berkas, silakan menghubungi WhatsApp Center **${wa(kb)}**.` : '';
    return { reply: sanitize(greet + body + closing), mode: 'local', topics: [...ctx.done] };
  }

  return { localAnswer };
});
