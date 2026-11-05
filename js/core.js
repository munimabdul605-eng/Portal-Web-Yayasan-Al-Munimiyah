/**
 * YPIA Core — logika bersama (browser + server):
 *  - Simulasi biaya & diskon PPDB sesuai Statuta Pasal 9 (data dari Google Sheet 02)
 *  - Parsing tanggal Indonesia untuk status gelombang PPDB (data dari Google Doc 03)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YPIACore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const formatRp = (n) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

  /**
   * Simulasi biaya masuk.
   * opts: { unit:'SD', gelombang:'GEL-1'|'GEL-2'|'GEL-3', alumni, sibling, tahfidz:0|5|10, yatim }
   * Aturan (Statuta Pasal 9 ayat 5): potongan Statuta mutually exclusive (ambil tertinggi),
   * dapat digabung dengan Diskon Gelombang; opsi Lunas menambah diskon ekstra DPP.
   */
  function simulate(kb, opts) {
    const fee = kb.biaya.units.find((u) => u.code === opts.unit);
    if (!fee) return null;
    const S = (code) => kb.biaya.schemes.find((s) => s.code === code) || { code, nama: code, dpp: 0, spp: 0, syarat: '' };
    const upper = ['SMP', 'SMA'].includes(opts.unit);
    const alumniOk = ['SD', 'SMP', 'SMA'].includes(opts.unit);

    const eligible = [S('REG-0')];
    if (opts.alumni && alumniOk) eligible.push(S('ALM-1'));
    if (opts.sibling) eligible.push(S('SIB-1'));
    if (upper && Number(opts.tahfidz) >= 10) eligible.push(S('THF-10'));
    else if (upper && Number(opts.tahfidz) >= 5) eligible.push(S('THF-5'));
    if (opts.yatim) eligible.push(S('YTM-1'));

    const best = eligible.slice().sort((a, b) => b.dpp - a.dpp || b.spp - a.spp)[0];
    const sppScheme = eligible.slice().sort((a, b) => b.spp - a.spp)[0];
    const gel = S(opts.gelombang || 'GEL-3');
    const lunasS = S('LUNAS');

    const notes = [];
    if (opts.alumni && !alumniOk) notes.push('Potongan Alumni hanya berlaku untuk lanjutan TK→SD, SD→SMP, SMP→SMA.');
    if (Number(opts.tahfidz) >= 5 && !upper) notes.push('Beasiswa Tahfidz khusus jenjang SMP & SMA.');
    if (eligible.length > 2) notes.push(`Sesuai Statuta Pasal 9 ayat (5), potongan Statuta tidak dapat digabung — dipilih yang tertinggi: ${best.nama} (${best.dpp}%).`);
    if (opts.yatim) notes.push('Afirmasi Yatim/Dhuafa terbatas kuota 5% per angkatan & wajib verifikasi (SKTM, Akta Kematian, Survei Rumah).');

    const calc = (extra) => {
      const dppPct = Math.min(100, best.dpp + gel.dpp + extra);
      const dppNet = Math.round(fee.dpp * (1 - dppPct / 100));
      const sppPct = Math.min(100, sppScheme.spp);
      const spp = Math.round(fee.spp * (1 - sppPct / 100));
      return { dppPct, dppNet, hemat: fee.dpp - dppNet, sppPct, spp, paket: fee.paket, daftarUlang: dppNet + fee.paket + spp, tahunPertama: dppNet + fee.paket + spp * 12 };
    };
    const cicilan = calc(0);
    cicilan.termin = [
      { label: 'Tahap 1 · Daftar Ulang', ket: '50% DPP bersih + 100% paket + SPP Juli', nominal: Math.round(cicilan.dppNet * 0.5) + cicilan.paket + cicilan.spp },
      { label: 'Tahap 2 · maks. 10 Oktober', ket: '25% DPP bersih', nominal: Math.round(cicilan.dppNet * 0.25) },
      { label: 'Tahap 3 · maks. 10 Januari', ket: '25% DPP bersih', nominal: cicilan.dppNet - Math.round(cicilan.dppNet * 0.5) - Math.round(cicilan.dppNet * 0.25) },
    ];
    const lunas = calc(lunasS.dpp);

    return { fee, best, gel, sppScheme, lunasScheme: lunasS, cicilan, lunas, notes, formulir: fee.formulir };
  }

  // ---------------- Tanggal ----------------
  const MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  /** "1 Oktober – 12 Desember 2025" -> [Date(2025-10-01), Date(2025-12-12)] */
  function parseIdDates(text) {
    const s = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\d{1,2}[.:]\d{2}/g, ' ');
    const re = new RegExp(`(\\d{1,2})(?:\\s+(${MONTHS.join('|')}))?(?:\\s+(\\d{4}))?`, 'gi');
    const toks = [];
    let m;
    while ((m = re.exec(s))) toks.push({ d: +m[1], mo: m[2] ? MONTHS.indexOf(m[2].toLowerCase()) : null, y: m[3] ? +m[3] : null });
    // isi bulan & tahun yang kosong dari token sesudahnya
    for (let i = toks.length - 1; i >= 0; i--) {
      const nx = toks[i + 1];
      if (toks[i].mo === null && nx) toks[i].mo = nx.mo;
      if (toks[i].y === null && nx) toks[i].y = nx.y;
    }
    const dates = toks.filter((t) => t.mo !== null && t.y !== null && t.d >= 1 && t.d <= 31).map((t) => new Date(t.y, t.mo, t.d));
    return dates;
  }

  /** Status tiap gelombang dari tabel timeline */
  function waveStatuses(timeline, today = new Date()) {
    const rows = timeline.rows || [];
    const find = (re) => rows.find((r) => re.test(r.tahap));
    const rForm = find(/Formulir Online|Pembukaan/i) || rows[0];
    const rDU = find(/Daftar Ulang/i) || rows[rows.length - 1];
    const rAnn = find(/Pengumuman/i);
    return (timeline.waves || []).map((w, i) => {
      const f = parseIdDates(rForm && rForm.cells[i]);
      const du = parseIdDates(rDU && rDU.cells[i]);
      const start = f[0], formEnd = f[f.length - 1], end = du[du.length - 1] || formEnd;
      const ann = rAnn ? parseIdDates(rAnn.cells[i])[0] : null;
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let status = 'unknown';
      if (start && day < start) status = 'upcoming';
      else if (formEnd && day <= formEnd) status = 'open';
      else if (end && day <= end) status = 'process';
      else if (end) status = 'closed';
      return { name: w, start, formEnd, announce: ann, end, status };
    });
  }

  const STATUS_LABEL = { upcoming: 'Akan Dibuka', open: 'Pendaftaran Dibuka', process: 'Proses Seleksi', closed: 'Selesai', unknown: '—' };
  const fmtDate = (d) => (d ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

  return { formatRp, simulate, parseIdDates, waveStatuses, STATUS_LABEL, fmtDate };
});

