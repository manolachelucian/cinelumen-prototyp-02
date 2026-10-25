/* CineLumen – interaktivní prototyp (vanilla JS, bez instalace).
   Hashový router + stav v localStorage. Platby, přihlášení a obsazenost jsou simulované. */
(function () {
  "use strict";

  const D = window.FEST_DATA;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
  const czk = (n) => n.toLocaleString("cs-CZ") + " Kč";

  /* ---------- Číselníky ---------- */
  const DAYS = [
    { date: "2026-10-15", short: "Čt 15. 10.", long: "Čtvrtek 15. října" },
    { date: "2026-10-16", short: "Pá 16. 10.", long: "Pátek 16. října" },
    { date: "2026-10-17", short: "So 17. 10.", long: "Sobota 17. října" },
  ];
  const dayOf = (date) => DAYS.find((d) => d.date === date);
  const TYPES = { proj: "Projekce", work: "Masterclass & workshop", deb: "Debata & podcast", ind: "Industry" };
  // Simulovaný „teď“ pro demo scénáře: pátek 16. 10. 15:30
  const NOW = { date: "2026-10-16", min: 15 * 60 + 30 };
  // Orientační pěší časy mezi sály v minutách (předpoklad prototypu)
  const WALK = {
    "loc-alfa|loc-beta": 18, "loc-alfa|loc-open-air": 15, "loc-alfa|loc-studio": 7,
    "loc-beta|loc-open-air": 4, "loc-beta|loc-studio": 12, "loc-open-air|loc-studio": 10,
  };
  const walk = (a, b) => (a === b ? 0 : WALK[[a, b].sort().join("|")]);
  const SHORT_VENUE = { "loc-alfa": "Sál Alfa", "loc-beta": "Sál Beta", "loc-open-air": "Open-Air Jezuitská kolej", "loc-studio": "Studio & Industry Hub" };

  const venues = Object.fromEntries(D.sceny.map((v) => [v.id, v]));
  const guests = Object.fromEntries(D.ucinkujici.map((g) => [g.id, g]));

  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const typeOf = (p) => {
    const s = norm(p.sekce + " " + p.nazev);
    if (/industry|pitching|press|tiskova/.test(s)) return "ind";
    if (/podcast|debata|kulaty stul|panel|diskuze/.test(s)) return "deb";
    if (/workshop|masterclass|dilna|prednaska|barveni/.test(s)) return "work";
    return "proj";
  };
  const filmTitle = (n) => { const i = n.lastIndexOf(": "); return i >= 0 ? n.slice(i + 2) : n; };

  const events = D.program.map((p) => {
    const di = DAYS.findIndex((d) => d.date === p.datum);
    const s = toMin(p.cas_od);
    let e = toMin(p.cas_do);
    if (e < s) e += 1440;
    const type = typeOf(p);
    const g = p.ucinkujici_ids.map((id) => guests[id]).filter(Boolean);
    const qa = type === "proj" && g.some((x) => /^Re[žz]is|Here[cč]/.test(x.role));
    // Simulovaná obsazenost; pro ukázkové scénáře je pevně daná
    const fixed = { "prog-022": 88, "prog-052": 62, "prog-053": 74, "prog-012": 100, "prog-031": 100, "prog-043": 100 };
    const pct = fixed[p.id] ?? Math.min(100, 30 + (hash(p.id) % 72));
    const sold = Math.round((p.kapacita_rezervace * pct) / 100);
    return {
      ...p, type, qa, guests: g, film: filmTitle(p.nazev), filmKey: norm(filmTitle(p.nazev)),
      start: di * 1440 + s, end: di * 1440 + e, dur: e - s, baseSold: sold,
      price: p.misto_id === "loc-open-air" ? 220 : type === "proj" ? 180 : 120,
    };
  });
  const byId = Object.fromEntries(events.map((e) => [e.id, e]));

  /* ---------- Stav ---------- */
  const KEY = "cinelumen-proto-v1";
  let S = { diary: [], pass: null, orders: [] };
  try { const raw = localStorage.getItem(KEY); if (raw) S = { ...S, ...JSON.parse(raw) }; } catch (e) { /* bez úložiště */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignorovat */ } updateBadges(); };
  const inDiary = (id) => S.diary.find((d) => d.id === id);

  const freeSeats = (ev) => {
    const mine = S.diary.filter((d) => d.id === ev.id && d.kind !== "saved").reduce((a, d) => a + (d.qty || 1), 0);
    return Math.max(0, ev.kapacita_rezervace - ev.baseSold - mine);
  };
  const capState = (ev) => {
    const f = freeSeats(ev);
    if (f === 0) return { cls: "s-out", label: "Vyprodáno", f };
    if (f / ev.kapacita_rezervace < 0.15) return { cls: "s-low", label: `Dochází · ${f} míst`, f };
    return { cls: "s-ok", label: `Volno · ${f} míst`, f };
  };

  const fmtTime = (ev) => `${ev.cas_od}–${ev.cas_do}`;
  const fmtWhen = (ev) => `${dayOf(ev.datum).short} · ${fmtTime(ev)}`;

  /* ---------- Kolize v diáři ---------- */
  function conflictsFor(ev, list = S.diary.map((d) => byId[d.id])) {
    const out = [];
    for (const o of list) {
      if (!o || o.id === ev.id) continue;
      if (ev.start < o.end && o.start < ev.end) { out.push({ kind: "overlap", other: o }); continue; }
      const [a, b] = ev.start >= o.end ? [o, ev] : [ev, o];
      const gap = b.start - a.end;
      const w = walk(a.misto_id, b.misto_id);
      if (gap >= 0 && gap < w) out.push({ kind: "walk", other: o, from: a, to: b, gap, walk: w });
    }
    return out;
  }
  const conflictText = (c) => c.kind === "overlap"
    ? `Překrývá se s „${esc(c.other.film)}“ (${fmtWhen(c.other)}, ${esc(SHORT_VENUE[c.other.misto_id])}).`
    : `Přesun ${esc(SHORT_VENUE[c.from.misto_id])} → ${esc(SHORT_VENUE[c.to.misto_id])}: máte jen ${c.gap} min, běžná pěší vzdálenost je ${c.walk} min.`;
  const alternativesFor = (ev) => events.filter((o) => o.id !== ev.id && o.filmKey === ev.filmKey && !inDiary(o.id) && conflictsFor(o).length === 0);

  /* ---------- Drobné UI prvky ---------- */
  const ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const ICON_CAL_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M8 14l3 3 5-6"/></svg>';
  const favBtn = (ev) => {
    const on = !!inDiary(ev.id);
    return `<button class="fav" type="button" data-action="fav" data-id="${ev.id}" aria-pressed="${on}" aria-label="${on ? "Odebrat z" : "Přidat do"} Mého diáře: ${esc(ev.film)}" title="${on ? "V diáři" : "Přidat do diáře"}">${on ? ICON_CAL_OK : ICON_CAL}</button>`;
  };
  const capTag = (ev) => { const c = capState(ev); return `<span class="cap ${c.cls}">${c.label}</span>`; };
  const evCard = (ev, opts = {}) => `
    <article class="ev t-${ev.type}">
      <div class="time">${ev.cas_od}<small>${opts.showDay ? dayOf(ev.datum).short.slice(0, 2) + " · " : ""}${ev.dur} min</small></div>
      <div class="info">
        <h3><a href="#/udalost/${ev.id}">${esc(ev.nazev)}</a></h3>
        <div class="tags">
          <span class="tag type">${TYPES[ev.type]}</span>
          ${ev.qa ? '<span class="tag qa">Q&amp;A s tvůrci</span>' : ""}
          <span class="tag">${esc(SHORT_VENUE[ev.misto_id])}</span>
          ${opts.showDay ? `<span class="tag">${dayOf(ev.datum).short}</span>` : ""}
        </div>
        ${capTag(ev)}
      </div>
      ${favBtn(ev)}
    </article>`;
  const avatar = (g) => `<span class="avatar" style="--av:hsl(${hash(g.id) % 360} 38% 38%)" aria-hidden="true">${esc(g.jmeno.split(" ").map((x) => x[0]).slice(0, 2).join(""))}</span>`;
  const personCard = (g) => `<a class="person" href="#/host/${g.id}">${avatar(g)}<div><strong>${esc(g.jmeno)}</strong><small>${esc(g.role)} · ${esc(g.zeme)}</small></div></a>`;

  function qrSvg(code, size = 96) {
    const n = 21, cells = [];
    let h = hash(code);
    const finder = (x, y) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
    const finderOn = (x, y) => { for (const [fx, fy] of [[0, 0], [n - 7, 0], [0, n - 7]]) { const dx = x - fx, dy = y - fy; if (dx >= 0 && dx < 7 && dy >= 0 && dy < 7) return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4); } return false; };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const on = finder(x, y) ? finderOn(x, y) : (h & 7) < 4;
      if (on) cells.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`);
    }
    return `<svg class="qr" style="width:${size}px;height:${size}px" viewBox="0 0 ${n} ${n}" role="img" aria-label="Ilustrační QR kód ${esc(code)}">${cells.join("")}</svg>`;
  }
  const code = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`;

  function toast(msg) {
    $$(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.innerHTML = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3800);
  }

  let closeModalFn = null;
  function modal(html, mount) {
    closeModal();
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    $("#layer").appendChild(back);
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === "Escape") closeModal(); };
    back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) closeModal(); });
    document.addEventListener("keydown", onKey);
    closeModalFn = () => { back.remove(); document.removeEventListener("keydown", onKey); closeModalFn = null; if (prev && prev.focus) prev.focus(); };
    const m = $(".modal", back);
    if (mount) mount(m);
    const f = m.querySelector("input, button, a[href]"); if (f) f.focus();
    return m;
  }
  function closeModal() { if (closeModalFn) closeModalFn(); }

  function updateBadges() {
    $$("[data-diary-count]").forEach((b) => { b.textContent = S.diary.length; b.dataset.n = S.diary.length; });
    $$("[data-login-label]").forEach((b) => { b.textContent = S.pass ? `CinePass ${S.pass.number}` : "Přihlásit CinePass"; });
  }

  /* ---------- Akce: diář, rezervace, přihlášení ---------- */
  function addToDiary(id, kind = "saved", extra = {}, force = false) {
    const ev = byId[id];
    const existing = inDiary(id);
    const others = S.diary.filter((d) => d.id !== id).map((d) => byId[d.id]);
    const cs = conflictsFor(ev, others);
    if (cs.length && !force && !(existing && kind === "saved")) {
      const alts = alternativesFor(ev);
      modal(`
        <h2>Kolize v diáři</h2>
        <p>Chcete přidat <strong>${esc(ev.film)}</strong> (${fmtWhen(ev)}, ${esc(SHORT_VENUE[ev.misto_id])}).</p>
        ${cs.map((c) => `<div class="alert ${c.kind === "overlap" ? "bad" : "warn"}"><strong>${c.kind === "overlap" ? "Časový překryv" : "Pozor na přesun"}</strong>${conflictText(c)}</div>`).join("")}
        ${cs.some((c) => c.kind === "walk") ? routeMap(cs.find((c) => c.kind === "walk")) : ""}
        ${alts.length ? `<div class="panel"><strong>Jiný termín bez kolize</strong>${alts.map((a) => `<button class="btn" type="button" data-alt="${a.id}">Uložit ${fmtWhen(a)} · ${esc(SHORT_VENUE[a.misto_id])}</button>`).join("")}</div>` : `<p class="muted">Tento titul nemá jiný termín.</p>`}
        <div class="btn-row"><button class="btn primary" type="button" data-force>Přidat i tak</button><button class="btn ghost" type="button" data-close>Zrušit</button></div>
      `, (m) => {
        $("[data-force]", m).onclick = () => { closeModal(); addToDiary(id, kind, extra, true); };
        $$("[data-alt]", m).forEach((b) => (b.onclick = () => { closeModal(); addToDiary(b.dataset.alt, kind, extra, true); }));
      });
      return false;
    }
    if (existing) Object.assign(existing, { kind, ...extra });
    else S.diary.push({ id, kind, ...extra, added: Date.now() });
    save(); rerenderSoft();
    if (kind === "saved") toast(`Uloženo do Mého diáře: <strong>${esc(ev.film)}</strong>`);
    return true;
  }
  function removeFromDiary(id) {
    const d = inDiary(id);
    if (!d) return;
    if (d.kind === "ticket") { toast("Zakoupené vstupenky nelze v prototypu odebrat."); return; }
    S.diary = S.diary.filter((x) => x.id !== id);
    save(); rerenderSoft();
    toast(d.kind === "cinepass" ? "Rezervace zrušena, místo uvolněno." : "Odebráno z diáře.");
  }

  function loginModal(then) {
    modal(`
      <h2>Přihlášení CinePass</h2>
      <p class="muted">Rezervace na CinePass je zdarma. Zadejte číslo akreditace z e-mailu.</p>
      <form class="form" id="login-form" novalidate>
        <div class="field"><label for="pass-no">Číslo CinePassu</label><input class="input mono" id="pass-no" placeholder="CL-2026-0000" autocomplete="off"><span class="err" id="pass-err"></span></div>
        <div class="field"><label for="pass-mail">E-mail</label><input class="input" id="pass-mail" type="email" placeholder="jmeno@example.cz" autocomplete="email"></div>
        <button class="linkbtn" type="button" id="demo-fill">Vyplnit ukázkové údaje</button>
        <div class="btn-row"><button class="btn primary" type="submit">Přihlásit</button><button class="btn ghost" type="button" data-close>Zrušit</button></div>
      </form>`, (m) => {
      $("#demo-fill", m).onclick = () => { $("#pass-no", m).value = "CL-2026-0417"; $("#pass-mail", m).value = "divak@example.cz"; };
      $("#login-form", m).onsubmit = (e) => {
        e.preventDefault();
        const no = $("#pass-no", m).value.trim().toUpperCase();
        const mail = $("#pass-mail", m).value.trim();
        if (!/^CL-\d{4}-\d{4}$/.test(no)) { $("#pass-err", m).textContent = "Číslo má tvar CL-2026-1234. Najdete ho v potvrzovacím e-mailu."; return; }
        S.pass = { number: no, email: mail || "divak@example.cz", type: "Celofestivalový CinePass" };
        save(); closeModal(); toast(`Přihlášeno · CinePass ${no} je platný`); rerenderSoft();
        if (then) then();
      };
    });
  }

  function reserveCinePass(id) {
    const ev = byId[id];
    if (!S.pass) { loginModal(() => reserveCinePass(id)); return; }
    if (inDiary(id) && inDiary(id).kind !== "saved") { toast("Na tuto projekci už máte místo."); return; }
    if (freeSeats(ev) === 0) { toast("Projekce je vyprodaná. Zkuste jiný termín."); return; }
    const c = code("CP");
    const ok = addToDiary(id, "cinepass", { code: c, qty: 1 });
    if (!ok) return; // čeká se na rozhodnutí v dialogu kolize
    showReservation(id);
  }
  function showReservation(id) {
    const ev = byId[id], d = inDiary(id);
    const latest = ev.start % 1440 - 10;
    const hh = String(Math.floor(((latest + 1440) % 1440) / 60)).padStart(2, "0"), mm = String(((latest % 60) + 60) % 60).padStart(2, "0");
    modal(`
      <span class="eyebrow">Rezervace potvrzena · 0 Kč</span>
      <h2>${esc(ev.film)}</h2>
      <div class="ticket"><div><strong>${fmtWhen(ev)}</strong><p>${esc(venues[ev.misto_id].nazev)}</p><p class="mono muted">${esc(d.code)} · CinePass ${esc(S.pass.number)}</p></div>${qrSvg(d.code)}</div>
      <div class="alert warn"><strong>Potvrďte příchodem do ${hh}:${mm}</strong>Rezervaci je nutné potvrdit u vstupu nejpozději 10 minut před začátkem, jinak místo uvolníme dalším divákům.</div>
      <div class="btn-row"><button class="btn" type="button" data-action="wallet">Přidat do Apple / Google Wallet</button><a class="btn primary" href="#/diar" data-close>Otevřít Můj diář</a></div>`);
  }

  /* ---------- Router ---------- */
  function parseHash() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [path, qs] = h.split("?");
    const params = new URLSearchParams(qs || "");
    const parts = path.split("/").filter(Boolean);
    return { parts, params, path };
  }
  function setParams(params) {
    const { path } = parseHash();
    const qs = params.toString();
    history.replaceState(null, "", "#" + path + (qs ? "?" + qs : ""));
  }
  function crumbs(items) {
    const all = [["Domů", "#/"], ...items];
    $("#crumbs").innerHTML = items.length
      ? `<ol>${all.map(([t, href], i) => i === all.length - 1 ? `<li><span aria-current="page">${esc(t)}</span></li>` : `<li><a href="${href}">${esc(t)}</a></li>`).join("")}</ol>`
      : "";
  }
  function setNav(key) {
    $$("[data-nav]").forEach((a) => (a.dataset.nav === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  }

  let current = null;
  function render(focus = true) {
    const { parts, params } = parseHash();
    const [a, b] = parts;
    const main = $("#main");
    $("#more-sheet").hidden = true;
    const routes = {
      undefined: () => pageHome(main),
      program: () => pageProgram(main, params),
      filmy: () => pageFilms(main, params),
      udalost: () => pageEvent(main, b),
      hoste: () => pageGuests(main, params),
      host: () => pageGuest(main, b),
      kina: () => pageVenues(main),
      kino: () => pageVenue(main, b),
      vstupenky: () => pageTickets(main),
      nakup: () => pageCheckout(main, b, params),
      potvrzeni: () => pageConfirm(main, b),
      diar: () => pageDiary(main),
      info: () => pageInfo(main),
      hledat: () => pageSearch(main, params),
    };
    (routes[a] || (() => pageNotFound(main)))();
    current = a;
    updateBadges();
    if (focus) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  }
  // Překreslí aktuální stránku bez skoku nahoru (po přidání do diáře apod.)
  function rerenderSoft() { const y = window.scrollY; render(false); window.scrollTo(0, y); }

  /* ---------- Stránky ---------- */
  function pageHome(main) {
    crumbs([]); setNav("home");
    const f = D.festival;
    const today = events.filter((e) => e.datum === NOW.date && e.start % 1440 >= NOW.min && e.type === "proj").sort((x, y) => x.start - y.start).slice(0, 4);
    main.innerHTML = `
      <section class="hero">
        <span class="eyebrow">${f.rocnik}. ročník · ${esc(f.misto)}</span>
        <h1>Noc patří <span>filmu</span></h1>
        <div style="display:grid;gap:10px">
          <p>${esc(f.popis)}</p>
          <p class="meta">15.–17. října 2026 · 4 sály · ${events.length} programových bloků · ${D.ucinkujici.length} hostů</p>
        </div>
        <div class="btn-row"><a class="btn primary" href="#/vstupenky">Koupit CinePass / lístek</a><a class="btn" href="#/program">Prohlédnout program</a></div>
      </section>

      <a class="banner-open" href="#/program?misto=loc-open-air&den=2026-10-17">
        <span class="eyebrow">Sobota 17. 10. · bez registrace</span>
        <strong>Speciální projekce pod hvězdami</strong>
        <span>Letní kino v zahradách Jezuitské koleje. Restaurovaná klasika i noční repríza, vstupenky od 220 Kč →</span>
      </a>

      <nav class="quick" aria-label="Rozcestník">
        <a href="#/program"><strong>Program</strong><span>Harmonogram po dnech a sálech</span></a>
        <a href="#/filmy"><strong>Filmy</strong><span>Katalog s filtry a řazením</span></a>
        <a href="#/hoste"><strong>Hosté</strong><span>Režiséři, herci, porota</span></a>
        <a href="#/kina"><strong>Kina &amp; mapa</strong><span>Sály a pěší vzdálenosti</span></a>
      </nav>

      <section style="display:grid;gap:12px">
        <div class="section-head"><h2>Dnes promítáme</h2><span class="demo-clock" title="V prototypu je čas pevně nastaven">Simulovaný čas: Pá 16. 10. 15:30</span></div>
        <div class="list">${today.map((e) => evCard(e)).join("")}</div>
        <a class="linkbtn" href="#/program?den=${NOW.date}">Celý páteční program</a>
      </section>

      <section style="display:grid;gap:12px">
        <h2>Zahájení a finále</h2>
        <div class="list">${["prog-001", "prog-043", "prog-044"].map((id) => evCard(byId[id], { showDay: true })).join("")}</div>
      </section>`;
  }

  /* --- Program: filtr podle dne, sálu, typu, Q&A, volných míst + fulltext; seznam / časová osa --- */
  function pageProgram(main, params) {
    crumbs([["Program", "#/program"]]); setNav("program");
    const st = {
      den: params.get("den") || "", misto: params.get("misto") || "", typ: (params.get("typ") || "").split(",").filter(Boolean),
      qa: params.get("qa") === "1", volno: params.get("volno") === "1", q: params.get("q") || "", view: params.get("view") || "list",
    };
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">Harmonogram projekcí</span><h1>Program</h1></div>
      <div class="program-layout">
        <section class="filters" aria-label="Filtry programu">
          <div class="seg" role="group" aria-label="Den">${[["", "Vše"], ...DAYS.map((d) => [d.date, d.short])].map(([v, t]) => `<button type="button" data-den="${v}" aria-pressed="${st.den === v}">${t}</button>`).join("")}</div>
          <details class="more-f" id="more-f" ${matchMedia("(min-width: 900px)").matches || st.misto || st.typ.length || st.qa || st.volno || st.q ? "open" : ""}>
          <summary>Další filtry: hledání, sál, typ, Q&amp;A <span id="f-active" class="muted"></span></summary>
          <div class="filter-row">
            <div class="field"><label class="sr" for="f-q">Hledat v programu</label><input class="input" id="f-q" type="search" placeholder="Název, sekce, host…" value="${esc(st.q)}"></div>
            <div class="field"><label class="sr" for="f-misto">Sál</label><select class="select" id="f-misto"><option value="">Všechny sály</option>${D.sceny.map((v) => `<option value="${v.id}" ${st.misto === v.id ? "selected" : ""}>${esc(SHORT_VENUE[v.id])}</option>`).join("")}</select></div>
          </div>
          <div class="seg" role="group" aria-label="Typ programu" style="flex-wrap:wrap">${Object.entries(TYPES).map(([k, t]) => `<button type="button" class="t-${k}" data-typ="${k}" aria-pressed="${st.typ.includes(k)}">${t}</button>`).join("")}</div>
          <label class="toggle"><input type="checkbox" id="f-qa" ${st.qa ? "checked" : ""}> Pouze s debatou tvůrců (Q&amp;A)</label>
          <label class="toggle"><input type="checkbox" id="f-volno" ${st.volno ? "checked" : ""}> Skrýt vyprodané</label>
          </details>
        </section>
        <section style="display:grid;gap:12px;min-width:0" aria-live="polite">
          <div class="result-bar"><span id="count"></span>
            <span class="seg" role="group" aria-label="Zobrazení"><button type="button" data-view="list" aria-pressed="${st.view === "list"}">Seznam</button><button type="button" data-view="grid" aria-pressed="${st.view === "grid"}">Časová osa</button></span>
          </div>
          <div id="results"></div>
        </section>
      </div>`;

    const sync = () => {
      const p = new URLSearchParams();
      if (st.den) p.set("den", st.den); if (st.misto) p.set("misto", st.misto); if (st.typ.length) p.set("typ", st.typ.join(","));
      if (st.qa) p.set("qa", "1"); if (st.volno) p.set("volno", "1"); if (st.q) p.set("q", st.q); if (st.view !== "list") p.set("view", st.view);
      setParams(p); draw();
    };
    const draw = () => {
      const q = norm(st.q);
      const list = events.filter((e) =>
        (!st.den || e.datum === st.den) && (!st.misto || e.misto_id === st.misto) && (!st.typ.length || st.typ.includes(e.type)) &&
        (!st.qa || e.qa) && (!st.volno || freeSeats(e) > 0) &&
        (!q || norm(`${e.nazev} ${e.sekce} ${e.popis} ${e.guests.map((g) => g.jmeno).join(" ")}`).includes(q))
      ).sort((x, y) => x.start - y.start || x.misto_id.localeCompare(y.misto_id));
      const active = st.den || st.misto || st.typ.length || st.qa || st.volno || st.q;
      const nf = [st.misto, st.qa, st.volno, st.q].filter(Boolean).length + st.typ.length;
      $("#f-active", main).textContent = nf ? `(${nf} aktivní)` : "";
      $("#count", main).innerHTML = `${list.length} z ${events.length} bloků ${active ? '· <button class="linkbtn" type="button" id="reset">Zrušit filtry</button>' : ""}`;
      const r = $("#reset", main); if (r) r.onclick = () => { location.hash = "#/program"; };
      const res = $("#results", main);
      if (!list.length) { res.innerHTML = `<div class="empty"><p>Žádný program neodpovídá filtrům.</p><a class="btn" href="#/program">Zrušit filtry</a></div>`; return; }
      if (st.view === "grid") { res.innerHTML = timeline(list, st.den || DAYS[0].date, !st.den); return; }
      res.innerHTML = DAYS.filter((d) => list.some((e) => e.datum === d.date)).map((d) =>
        `<div class="daygroup"><h3>${d.long}</h3>${list.filter((e) => e.datum === d.date).map((e) => evCard(e)).join("")}</div>`).join("");
    };
    $$("[data-den]", main).forEach((b) => (b.onclick = () => { st.den = b.dataset.den; $$("[data-den]", main).forEach((x) => x.setAttribute("aria-pressed", x === b)); sync(); }));
    $$("[data-typ]", main).forEach((b) => (b.onclick = () => { const k = b.dataset.typ; st.typ = st.typ.includes(k) ? st.typ.filter((x) => x !== k) : [...st.typ, k]; b.setAttribute("aria-pressed", st.typ.includes(k)); sync(); }));
    $$("[data-view]", main).forEach((b) => (b.onclick = () => { st.view = b.dataset.view; $$("[data-view]", main).forEach((x) => x.setAttribute("aria-pressed", x === b)); sync(); }));
    $("#f-q", main).oninput = (e) => { st.q = e.target.value; sync(); };
    $("#f-misto", main).onchange = (e) => { st.misto = e.target.value; sync(); };
    $("#f-qa", main).onchange = (e) => { st.qa = e.target.checked; sync(); };
    $("#f-volno", main).onchange = (e) => { st.volno = e.target.checked; sync(); };
    draw();
  }

  function timeline(list, date, note) {
    const from = 10 * 60, to = 26 * 60, span = to - from;
    const dayList = list.filter((e) => e.datum === date);
    const hours = []; for (let h = 10; h < 26; h++) hours.push(`<span>${String(h % 24).padStart(2, "0")}:00</span>`);
    return `${note ? `<p class="muted">Časová osa zobrazuje jeden den – ${dayOf(date).long}. Pro jiný den zvolte filtr nahoře.</p>` : ""}
      <div class="tl-wrap"><div class="tl">
        <div class="tl-hours" style="grid-template-columns:repeat(${hours.length},1fr)">${hours.join("")}</div>
        ${D.sceny.map((v) => `<div class="tl-row"><div class="tl-venue">${esc(SHORT_VENUE[v.id])}</div><div class="tl-track">${dayList.filter((e) => e.misto_id === v.id).map((e) => {
          const s = (e.start % 1440) - from, left = (s / span) * 100, w = (e.dur / span) * 100;
          return `<a class="tl-ev t-${e.type} ${inDiary(e.id) ? "in-diary" : ""}" href="#/udalost/${e.id}" style="left:${left}%;width:calc(${w}% - 3px)" title="${esc(e.nazev)}"><b>${e.cas_od}</b>${esc(e.film)}</a>`;
        }).join("")}</div></div>`).join("")}
      </div></div>`;
  }

  /* --- Katalog filmů: řazení + filtrování --- */
  function pageFilms(main, params) {
    crumbs([["Filmy", "#/filmy"]]); setNav("filmy");
    const films = {};
    events.filter((e) => e.type === "proj").forEach((e) => { (films[e.filmKey] ||= { title: e.film, list: [] }).list.push(e); });
    const all = Object.values(films).map((f) => ({ ...f, first: f.list.sort((a, b) => a.start - b.start)[0], free: Math.max(...f.list.map(freeSeats)), qa: f.list.some((e) => e.qa), open: f.list.some((e) => e.misto_id === "loc-open-air") }));
    const st = { q: params.get("q") || "", sort: params.get("razeni") || "cas", qa: params.get("qa") === "1", open: params.get("open") === "1" };
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">Katalog</span><h1>Filmy</h1><p class="muted">${all.length} titulů. Kliknutím na termín otevřete detail s rezervací.</p></div>
      <section class="filters" aria-label="Filtry katalogu">
        <div class="filter-row">
          <div class="field"><label class="sr" for="c-q">Hledat film</label><input class="input" id="c-q" type="search" placeholder="Hledat film nebo tvůrce…" value="${esc(st.q)}"></div>
          <div class="field"><label class="sr" for="c-sort">Řadit</label><select class="select" id="c-sort">
            <option value="cas">Řadit: nejbližší termín</option><option value="az">Řadit: abecedně A–Z</option><option value="volno">Řadit: nejvíc volných míst</option><option value="delka">Řadit: nejkratší stopáž</option></select></div>
        </div>
        <div class="seg" style="flex-wrap:wrap">
          <button type="button" class="chip" data-f="qa" aria-pressed="${st.qa}">S Q&amp;A tvůrců</button>
          <button type="button" class="chip" data-f="open" aria-pressed="${st.open}">Pod širým nebem</button>
        </div>
      </section>
      <p class="result-bar" id="c-count" aria-live="polite"></p>
      <div class="grid-cards" id="c-res"></div>`;
    $("#c-sort", main).value = st.sort;
    const draw = () => {
      const q = norm(st.q);
      let list = all.filter((f) => (!st.qa || f.qa) && (!st.open || f.open) && (!q || norm(f.title + " " + f.first.sekce + " " + f.first.guests.map((g) => g.jmeno).join(" ")).includes(q)));
      const sorters = { cas: (a, b) => a.first.start - b.first.start, az: (a, b) => a.title.localeCompare(b.title, "cs"), volno: (a, b) => b.free - a.free, delka: (a, b) => a.first.dur - b.first.dur };
      list.sort(sorters[st.sort]);
      $("#c-count", main).textContent = `Zobrazeno ${list.length} z ${all.length} filmů`;
      $("#c-res", main).innerHTML = list.length ? list.map((f) => `
        <article class="vcard t-${f.first.type}">
          <div class="poster" style="--poster:${poster(f.first)};aspect-ratio:16/7"><span>${esc(f.first.sekce)}</span></div>
          <h3>${esc(f.title)}</h3>
          <p class="muted" style="font-size:.9rem">${esc(f.first.popis)}</p>
          <div class="tags">${f.qa ? '<span class="tag qa">Q&amp;A</span>' : ""}<span class="tag">${f.first.dur} min</span></div>
          <div class="btn-row">${f.list.map((e) => `<a class="btn small" href="#/udalost/${e.id}">${dayOf(e.datum).short.slice(0, 2)} ${e.cas_od} · ${esc(SHORT_VENUE[e.misto_id].replace("Open-Air Jezuitská kolej", "Open-Air"))}</a>`).join("")}</div>
        </article>`).join("") : `<div class="empty">Žádný film neodpovídá. <button class="btn" type="button" id="c-reset">Zrušit filtry</button></div>`;
      const r = $("#c-reset", main); if (r) r.onclick = () => (location.hash = "#/filmy");
      const p = new URLSearchParams(); if (st.q) p.set("q", st.q); if (st.sort !== "cas") p.set("razeni", st.sort); if (st.qa) p.set("qa", "1"); if (st.open) p.set("open", "1"); setParams(p);
    };
    $("#c-q", main).oninput = (e) => { st.q = e.target.value; draw(); };
    $("#c-sort", main).onchange = (e) => { st.sort = e.target.value; draw(); };
    $$("[data-f]", main).forEach((b) => (b.onclick = () => { st[b.dataset.f] = !st[b.dataset.f]; b.setAttribute("aria-pressed", st[b.dataset.f]); draw(); }));
    draw();
  }
  const poster = (e) => { const h = hash(e.filmKey) % 360; return `linear-gradient(135deg, hsl(${h} 45% 22%), hsl(${(h + 50) % 360} 55% 12%) 60%), hsl(${h} 40% 15%)`; };

  /* --- Detail programu / filmu --- */
  function pageEvent(main, id) {
    const ev = byId[id]; if (!ev) return pageNotFound(main);
    const isFilm = ev.type === "proj";
    crumbs(isFilm ? [["Filmy", "#/filmy"], [ev.film, ""]] : [["Program", "#/program"], [ev.film, ""]]);
    setNav(isFilm ? "filmy" : "program");
    const v = venues[ev.misto_id], c = capState(ev), d = inDiary(id);
    const others = events.filter((o) => o.filmKey === ev.filmKey && o.id !== ev.id);
    const cs = conflictsFor(ev);
    const pct = Math.round(((ev.kapacita_rezervace - c.f) / ev.kapacita_rezervace) * 100);
    main.innerHTML = `
      <div class="detail">
        <div style="display:grid;gap:20px;min-width:0">
          <div class="poster" style="--poster:${poster(ev)}"><span>Trailer · ${ev.dur} min</span></div>
          <div class="page-head"><span class="eyebrow" style="color:var(--t-${ev.type})">${esc(ev.sekce)}</span><h1>${esc(ev.film)}</h1>
            ${ev.film !== ev.nazev ? `<p class="muted">${esc(ev.nazev)}</p>` : ""}</div>
          <p style="max-width:65ch">${esc(ev.popis)}</p>
          <dl class="facts">
            <dt>Kdy</dt><dd class="mono">${dayOf(ev.datum).long} · ${fmtTime(ev)}</dd>
            <dt>Kde</dt><dd><a href="#/kino/${v.id}">${esc(v.nazev)}</a></dd>
            <dt>Typ</dt><dd>${TYPES[ev.type]}${ev.qa ? " · po projekci Q&amp;A s tvůrci" : ""}</dd>
            <dt>Jazyk</dt><dd>Původní znění, české a anglické titulky</dd>
            <dt>Technika</dt><dd>${esc(v.vybaveni)}</dd>
          </dl>
          ${ev.guests.length ? `<section style="display:grid;gap:10px"><h2>Hosté${ev.qa ? " na Q&amp;A" : ""}</h2><div class="people">${ev.guests.map(personCard).join("")}</div></section>` : ""}
          ${others.length ? `<section style="display:grid;gap:10px"><h2>Další termíny</h2><div class="list">${others.map((o) => evCard(o, { showDay: true })).join("")}</div></section>` : ""}
        </div>
        <aside class="panel sticky" aria-label="Vstupenky a rezervace">
          <div style="display:grid;gap:6px"><strong class="mono">${dayOf(ev.datum).short} · ${fmtTime(ev)}</strong><span>${esc(SHORT_VENUE[ev.misto_id])}</span></div>
          <div style="display:grid;gap:6px"><span class="cap ${c.cls}">${c.label}</span><div class="meter" style="--c:var(--${c.cls === "s-ok" ? "ok" : c.cls === "s-low" ? "warn" : "bad"})"><i style="width:${pct}%"></i></div><small class="muted">Obsazenost ${pct} % z ${ev.kapacita_rezervace} míst</small></div>
          ${cs.length && !d ? cs.map((x) => `<div class="alert ${x.kind === "overlap" ? "bad" : "warn"}">${conflictText(x)}</div>`).join("") : ""}
          ${d && d.kind !== "saved" ? `<div class="alert ok"><strong>${d.kind === "cinepass" ? "Máte rezervaci na CinePass" : `Máte ${d.qty} ks vstupenek`}</strong><a href="#/diar">Zobrazit v Mém diáři</a></div>` : `
            <button class="btn primary" type="button" data-action="reserve" data-id="${ev.id}" ${c.f === 0 ? "disabled" : ""}>Rezervovat na CinePass · 0 Kč</button>
            <a class="btn" href="#/nakup/${ev.id}" ${c.f === 0 ? 'aria-disabled="true" style="pointer-events:none;opacity:.5"' : ""}>Koupit jednotlivé lístky · ${czk(ev.price)}</a>`}
          <button class="btn ghost" type="button" data-action="fav" data-id="${ev.id}" aria-pressed="${!!d}">${d ? "✓ V Mém diáři · odebrat" : "Uložit do Mého diáře"}</button>
          ${S.pass ? `<small class="muted">Přihlášen CinePass ${esc(S.pass.number)}</small>` : `<small class="muted">Rezervace na CinePass vyžaduje přihlášení. Jednotlivé lístky koupíte bez registrace.</small>`}
        </aside>
      </div>`;
  }

  /* --- Hosté: vyhledávání + filtr role/země + řazení --- */
  const ROLE_GROUPS = { rez: ["Režie", /re[žz]is/i], her: ["Herectví", /here[cč]/i], obr: ["Kamera a obraz", /kamer|kolor|vfx|výtvar|kostým/i], zvuk: ["Zvuk a hudba", /zvuk|sklad/i], dalsi: ["Scénář, produkce, kritika", /scén|produc|kriti|histori|publicist|esej|kurátor|stři/i] };
  function pageGuests(main, params) {
    crumbs([["Hosté festivalu", "#/hoste"]]); setNav("hoste");
    const st = { q: params.get("q") || "", role: params.get("role") || "", zeme: params.get("zeme") || "", sort: params.get("razeni") || "az" };
    const countries = [...new Set(D.ucinkujici.map((g) => g.zeme))].sort((a, b) => a.localeCompare(b, "cs"));
    const evCount = (g) => events.filter((e) => e.ucinkujici_ids.includes(g.id)).length;
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">Filmy &amp; hosté</span><h1>Hosté festivalu</h1></div>
      <section class="filters" aria-label="Vyhledávání hostů">
        <div class="field"><label for="g-q">Hledat podle jména, role nebo země</label><input class="input" id="g-q" type="search" placeholder="např. Lindqvist, kameraman, Japonsko" value="${esc(st.q)}"></div>
        <div class="filter-row">
          <select class="select" id="g-role" aria-label="Profese"><option value="">Všechny profese</option>${Object.entries(ROLE_GROUPS).map(([k, [t]]) => `<option value="${k}">${t}</option>`).join("")}</select>
          <select class="select" id="g-zeme" aria-label="Země"><option value="">Všechny země</option>${countries.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
          <select class="select" id="g-sort" aria-label="Řazení"><option value="az">Řadit: A–Z (příjmení)</option><option value="za">Řadit: Z–A</option><option value="akce">Řadit: nejvíc vystoupení</option></select>
        </div>
      </section>
      <p class="result-bar" id="g-count" aria-live="polite"></p>
      <div class="grid-cards" id="g-res"></div>`;
    $("#g-role", main).value = st.role; $("#g-zeme", main).value = st.zeme; $("#g-sort", main).value = st.sort;
    const last = (g) => g.jmeno.split(" ").slice(-1)[0];
    const draw = () => {
      const q = norm(st.q);
      const list = D.ucinkujici.filter((g) => (!q || norm(`${g.jmeno} ${g.role} ${g.zeme}`).includes(q)) && (!st.role || ROLE_GROUPS[st.role][1].test(g.role)) && (!st.zeme || g.zeme === st.zeme))
        .sort(st.sort === "akce" ? (a, b) => evCount(b) - evCount(a) || last(a).localeCompare(last(b), "cs") : st.sort === "za" ? (a, b) => last(b).localeCompare(last(a), "cs") : (a, b) => last(a).localeCompare(last(b), "cs"));
      $("#g-count", main).textContent = `Nalezeno ${list.length} z ${D.ucinkujici.length} hostů`;
      $("#g-res", main).innerHTML = list.length ? list.map((g) => `<a class="person" href="#/host/${g.id}">${avatar(g)}<div><strong>${hl(g.jmeno, st.q)}</strong><small>${esc(g.role)} · ${esc(g.zeme)} · ${evCount(g)}× v programu</small></div></a>`).join("")
        : `<div class="empty">Nikoho jsme nenašli. Zkuste jen část jména bez diakritiky.</div>`;
      const p = new URLSearchParams(); if (st.q) p.set("q", st.q); if (st.role) p.set("role", st.role); if (st.zeme) p.set("zeme", st.zeme); if (st.sort !== "az") p.set("razeni", st.sort); setParams(p);
    };
    $("#g-q", main).oninput = (e) => { st.q = e.target.value; draw(); };
    $("#g-role", main).onchange = (e) => { st.role = e.target.value; draw(); };
    $("#g-zeme", main).onchange = (e) => { st.zeme = e.target.value; draw(); };
    $("#g-sort", main).onchange = (e) => { st.sort = e.target.value; draw(); };
    draw();
  }
  const hl = (text, q) => {
    if (!q) return esc(text);
    const i = norm(text).indexOf(norm(q));
    if (i < 0) return esc(text);
    return esc(text.slice(0, i)) + `<mark>${esc(text.slice(i, i + q.length))}</mark>` + esc(text.slice(i + q.length));
  };

  function pageGuest(main, id) {
    const g = guests[id]; if (!g) return pageNotFound(main);
    crumbs([["Hosté festivalu", "#/hoste"], [g.jmeno, ""]]); setNav("hoste");
    const list = events.filter((e) => e.ucinkujici_ids.includes(id)).sort((a, b) => a.start - b.start);
    main.innerHTML = `
      <div style="display:flex;gap:16px;align-items:center">${avatar(g).replace('class="avatar"', 'class="avatar" style="flex-basis:72px;height:72px;font-size:1.3rem;--av:hsl(' + (hash(g.id) % 360) + ' 38% 38%)"')}
        <div class="page-head"><span class="eyebrow">${esc(g.role)} · ${esc(g.zeme)}</span><h1>${esc(g.jmeno)}</h1></div></div>
      <p style="max-width:65ch">${esc(g.biografie)}</p>
      <section style="display:grid;gap:10px"><h2>Kde ho/ji potkáte</h2><div class="list">${list.map((e) => evCard(e, { showDay: true })).join("") || '<p class="muted">Host zatím nemá program.</p>'}</div></section>`;
  }

  /* --- Kina a mapa --- */
  const POS = { "loc-alfa": [300, 120], "loc-studio": [400, 70], "loc-beta": [150, 230], "loc-open-air": [95, 175] };
  function mapSvg(active, route) {
    return `<svg class="map" viewBox="0 0 520 300" role="img" aria-label="Schematická mapa festivalových sálů v Kutné Hoře">
      <path class="street" d="M20 260 C120 230 180 200 300 120 S460 40 510 30"/><path class="street" d="M60 120 C120 160 160 200 170 290"/><path class="street" d="M240 20 L320 290"/>
      ${route ? `<path class="route" d="M${POS[route[0]].join(" ")} L${POS[route[1]].join(" ")}"/>` : ""}
      ${D.sceny.map((v) => `<a href="#/kino/${v.id}" class="pin ${active && active !== v.id && !(route && route.includes(v.id)) ? "other" : ""}"><circle cx="${POS[v.id][0]}" cy="${POS[v.id][1]}" r="11"/><text x="${POS[v.id][0] + 16}" y="${POS[v.id][1] + 5}">${esc(SHORT_VENUE[v.id].replace(" Jezuitská kolej", ""))}</text></a>`).join("")}
      <text class="lbl-muted" x="330" y="285">Schéma, neodpovídá měřítku</text>
    </svg>`;
  }
  const routeMap = (c) => `<div style="display:grid;gap:6px">${mapSvg(null, [c.from.misto_id, c.to.misto_id])}<small class="muted">Doporučená pěší trasa: ${c.walk} min</small></div>`;

  function pageVenues(main) {
    crumbs([["Kina & mapa", "#/kina"]]); setNav("kina");
    const ids = D.sceny.map((v) => v.id);
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">Festivalová kina a lokace</span><h1>Kina &amp; mapa</h1></div>
      ${mapSvg()}
      <div class="grid-cards">${D.sceny.map((v) => `<a class="vcard" href="#/kino/${v.id}"><span class="eyebrow">${esc(v.typ)}</span><h3>${esc(v.nazev)}</h3><p class="muted">${esc(v.adresa)}</p><p><span class="mono">${v.kapacita}</span> míst · ${/bezbari/i.test(v.vybaveni) ? "bezbariérový přístup" : "bezbariérovost na vyžádání"}</p></a>`).join("")}</div>
      <section style="display:grid;gap:10px"><h2>Pěší vzdálenosti mezi sály</h2>
        <div class="tbl-wrap"><table><thead><tr><th>Z / do</th>${ids.map((i) => `<th>${esc(SHORT_VENUE[i])}</th>`).join("")}</tr></thead>
        <tbody>${ids.map((a) => `<tr><th>${esc(SHORT_VENUE[a])}</th>${ids.map((b) => `<td class="num">${a === b ? "–" : walk(a, b) + " min"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <small class="muted">Časy používá Můj diář pro varování před nestihnutelným přesunem.</small></section>`;
  }
  function pageVenue(main, id) {
    const v = venues[id]; if (!v) return pageNotFound(main);
    crumbs([["Kina & mapa", "#/kina"], [SHORT_VENUE[id], ""]]); setNav("kina");
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">${esc(v.typ)}</span><h1>${esc(v.nazev)}</h1></div>
      <div class="detail"><div style="display:grid;gap:16px;min-width:0">
        <dl class="facts"><dt>Adresa</dt><dd>${esc(v.adresa)}</dd><dt>Kapacita</dt><dd class="mono">${v.kapacita} míst</dd><dt>Vybavení</dt><dd>${esc(v.vybaveni)}</dd>
          <dt>Přístupnost</dt><dd>${/bezbari/i.test(v.vybaveni) ? "Bezbariérový vstup, místa pro vozíčkáře v 1. řadě" : "Bezbariérový přístup po domluvě s produkcí (info@cinelumen.cz)"}</dd></dl>
        ${mapSvg(id)}
      </div>
      <aside class="panel"><strong>Pěšky do ostatních sálů</strong>${D.sceny.filter((o) => o.id !== id).map((o) => `<div style="display:flex;justify-content:space-between;gap:10px"><a href="#/kino/${o.id}">${esc(SHORT_VENUE[o.id])}</a><span class="mono">${walk(id, o.id)} min</span></div>`).join("")}
        <a class="btn primary" href="#/program?misto=${id}">Program tohoto sálu</a></aside></div>`;
  }

  /* --- Vstupenky --- */
  function pageTickets(main) {
    crumbs([["Vstupenky & akreditace", "#/vstupenky"]]); setNav("vstupenky");
    main.innerHTML = `
      <div class="page-head"><span class="eyebrow">Vstupenky &amp; akreditace</span><h1>Vyberte si vstup</h1></div>
      <div class="passes">
        <article class="pass hl"><span class="eyebrow">Nejvýhodnější</span><h3>CinePass celofestivalový</h3><p class="price">1 490 Kč</p><ul><li>Rezervace na všechny projekce zdarma</li><li>Rezervace den předem od 9:00</li><li>Sleva 10 % v partnerských kavárnách</li></ul><button class="btn primary" type="button" data-action="buy-pass" data-pass="Celofestivalový CinePass">Koupit CinePass</button></article>
        <article class="pass"><h3>Víkendový pas</h3><p class="price">990 Kč</p><ul><li>Pátek a sobota</li><li>Rezervace stejně jako CinePass</li></ul><button class="btn" type="button" data-action="buy-pass" data-pass="Víkendový pas">Koupit pas</button></article>
        <article class="pass"><h3>Jednotlivá vstupenka</h3><p class="price">od 120 Kč</p><ul><li>Bez registrace, platba kartou / Apple Pay</li><li>Projekce 180 Kč, Open-Air 220 Kč, dílny 120 Kč</li></ul><a class="btn" href="#/filmy">Vybrat film</a></article>
      </div>
      <section class="panel"><h2>Už máte CinePass?</h2><p>${S.pass ? `Přihlášen: <strong class="mono">${esc(S.pass.number)}</strong> (${esc(S.pass.type)}).` : "Přihlaste se číslem akreditace a rezervujte místa jedním klepnutím."}</p>
        ${S.pass ? '<button class="btn" type="button" data-action="logout">Odhlásit</button>' : '<button class="btn primary" type="button" data-action="login">Přihlásit CinePass</button>'}</section>
      <section style="display:grid;gap:4px"><h2>Rezervační pravidla</h2>
        <details><summary>Kdy se otevírají rezervace?</summary><p>Rezervace na další festivalový den se otevírají vždy v 9:00 předchozího dne. Na zahajovací den od 1. 10.</p></details>
        <details><summary>Co když nepřijdu?</summary><p>Rezervaci potvrďte u vstupu nejpozději 10 minut před začátkem. Poté místo uvolníme dalším divákům. Po třech nevyužitých rezervacích se rezervace na 24 hodin zablokují.</p></details>
        <details><summary>Kolik rezervací můžu mít?</summary><p>Na jeden CinePass najednou maximálně 4 aktivní rezervace na den, které se nesmí časově překrývat.</p></details>
      </section>`;
  }

  /* --- Nákup jednotlivých vstupenek (bez registrace) --- */
  const checkout = {};
  function pageCheckout(main, id, params) {
    const ev = byId[id]; if (!ev) return pageNotFound(main);
    crumbs([["Filmy", "#/filmy"], [ev.film, `#/udalost/${id}`], ["Nákup vstupenek", ""]]); setNav("filmy");
    if (checkout.id !== id) Object.assign(checkout, { id, qty: 2, email: "", pay: "card" });
    const step = Number(params.get("krok") || 1);
    const max = Math.min(6, freeSeats(ev));
    const steps = ["Počet", "Kontakt a platba", "Souhrn"];
    const total = checkout.qty * ev.price;
    const head = `<div class="page-head"><span class="eyebrow">Jednotlivé vstupenky · bez registrace</span><h1>${esc(ev.film)}</h1><p class="mono">${fmtWhen(ev)} · ${esc(SHORT_VENUE[ev.misto_id])}</p></div>
      <ol class="steps">${steps.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "cur" : ""}" ${i + 1 === step ? 'aria-current="step"' : ""}>${i + 1}. ${s}</li>`).join("")}</ol>`;
    if (step === 1) {
      main.innerHTML = `${head}<section class="panel" style="max-width:520px">
        <div class="field"><span id="qty-l" style="font-weight:600">Počet vstupenek</span><div class="stepper" role="group" aria-labelledby="qty-l"><button type="button" id="minus" aria-label="Ubrat">−</button><output id="qty" aria-live="polite">${checkout.qty}</output><button type="button" id="plus" aria-label="Přidat">+</button></div><small class="muted">Max. ${max} ks na objednávku · ${czk(ev.price)} / ks</small></div>
        <p>Celkem: <strong class="mono" id="total">${czk(total)}</strong></p>
        <a class="btn primary" href="#/nakup/${id}?krok=2">Pokračovat</a></section>`;
      const upd = (d) => { checkout.qty = Math.max(1, Math.min(max, checkout.qty + d)); $("#qty", main).textContent = checkout.qty; $("#total", main).textContent = czk(checkout.qty * ev.price); };
      $("#minus", main).onclick = () => upd(-1); $("#plus", main).onclick = () => upd(1);
    } else if (step === 2) {
      main.innerHTML = `${head}<form class="panel form" id="pay-form" style="max-width:520px" novalidate>
        <div class="field"><label for="mail">E-mail pro zaslání vstupenek</label><input class="input" id="mail" type="email" autocomplete="email" placeholder="jmeno@example.cz" value="${esc(checkout.email)}"><span class="err" id="mail-err"></span></div>
        <fieldset style="border:0;padding:0;margin:0;display:grid;gap:8px"><legend style="font-weight:600;margin-bottom:6px">Způsob platby</legend>
          <label class="radio-card"><input type="radio" name="pay" value="apple" ${checkout.pay === "apple" ? "checked" : ""}> Apple Pay / Google Pay</label>
          <label class="radio-card"><input type="radio" name="pay" value="card" ${checkout.pay === "card" ? "checked" : ""}> Platební karta</label></fieldset>
        <p>${checkout.qty} × ${czk(ev.price)} = <strong class="mono">${czk(checkout.qty * ev.price)}</strong></p>
        <div class="btn-row"><button class="btn primary" type="submit">Pokračovat k souhrnu</button><a class="btn ghost" href="#/nakup/${id}?krok=1">Zpět</a></div></form>`;
      $("#pay-form", main).onsubmit = (e) => {
        e.preventDefault();
        const m = $("#mail", main).value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) { $("#mail-err", main).textContent = "Zadejte e-mail ve tvaru jmeno@domena.cz, pošleme na něj vstupenky."; $("#mail", main).focus(); return; }
        checkout.email = m; checkout.pay = $("input[name=pay]:checked", main).value;
        location.hash = `#/nakup/${id}?krok=3`;
      };
    } else {
      if (!checkout.email) { location.hash = `#/nakup/${id}?krok=2`; return; }
      main.innerHTML = `${head}<section class="panel" style="max-width:520px">
        <dl class="facts"><dt>Projekce</dt><dd>${esc(ev.film)}</dd><dt>Kdy</dt><dd class="mono">${fmtWhen(ev)}</dd><dt>Kde</dt><dd>${esc(venues[ev.misto_id].nazev)}</dd><dt>Vstupenky</dt><dd>${checkout.qty} ks</dd><dt>E-mail</dt><dd>${esc(checkout.email)}</dd><dt>Platba</dt><dd>${checkout.pay === "apple" ? "Apple / Google Pay" : "Platební karta"}</dd><dt>Celkem</dt><dd class="mono"><strong>${czk(checkout.qty * ev.price)}</strong></dd></dl>
        <button class="btn primary" type="button" id="confirm">Zaplatit ${czk(checkout.qty * ev.price)}</button>
        <small class="muted">Simulace platby – nic se neúčtuje.</small></section>`;
      $("#confirm", main).onclick = (e) => {
        e.target.disabled = true; e.target.textContent = "Autorizuji platbu…";
        setTimeout(() => {
          const order = { id: code("OBJ"), eventId: id, qty: checkout.qty, email: checkout.email, codes: Array.from({ length: checkout.qty }, () => code("VS")) };
          S.orders.push(order);
          const d = inDiary(id);
          if (d) Object.assign(d, { kind: "ticket", qty: order.qty, order: order.id }); else S.diary.push({ id, kind: "ticket", qty: order.qty, order: order.id, added: Date.now() });
          save(); delete checkout.id;
          location.hash = `#/potvrzeni/${order.id}`;
        }, 900);
      };
    }
  }
  function pageConfirm(main, oid) {
    const o = S.orders.find((x) => x.id === oid); if (!o) return pageNotFound(main);
    const ev = byId[o.eventId];
    crumbs([["Vstupenky", "#/vstupenky"], ["Potvrzení objednávky", ""]]); setNav("vstupenky");
    main.innerHTML = `
      <div class="alert ok"><strong>Zaplaceno. Vstupenky jsou na cestě.</strong>Do 30 sekund dorazí na ${esc(o.email)} jako PDF. Najdete je i v Mém diáři.</div>
      <div class="page-head"><span class="eyebrow">Objednávka ${esc(o.id)}</span><h1>${esc(ev.film)}</h1><p class="mono">${fmtWhen(ev)}</p></div>
      <div class="list">${o.codes.map((c, i) => `<div class="ticket"><div><span class="eyebrow">Vstupenka ${i + 1} / ${o.qty}</span><h3>${esc(ev.film)}</h3><p>${esc(venues[ev.misto_id].nazev)}</p><p class="mono muted">${c}</p><button class="linkbtn" type="button" data-action="pdf">Stáhnout PDF</button></div>${qrSvg(c)}</div>`).join("")}</div>
      <section class="panel"><h2>Jak se tam dostanete</h2>${mapSvg(ev.misto_id)}<p>${esc(venues[ev.misto_id].adresa)}. Vstup do zahrad otevíráme 45 minut před začátkem, vezměte si teplé oblečení.</p>
        <div class="btn-row"><a class="btn" href="#/kino/${ev.misto_id}">Detail místa</a><a class="btn primary" href="#/diar">Můj diář</a></div></section>`;
  }

  /* --- Můj diář: osobní program s kolizemi --- */
  function pageDiary(main) {
    crumbs([["Můj diář", "#/diar"]]); setNav("diar");
    const items = S.diary.map((d) => ({ d, ev: byId[d.id] })).filter((x) => x.ev).sort((a, b) => a.ev.start - b.ev.start);
    const pass = S.pass ? `<div class="panel" style="grid-template-columns:1fr auto;align-items:center"><div><span class="eyebrow">${esc(S.pass.type)}</span><p class="mono"><strong>${esc(S.pass.number)}</strong></p><small class="muted">${esc(S.pass.email)}</small></div>${qrSvg(S.pass.number, 72)}</div>`
      : `<div class="panel"><p>Máte CinePass? Přihlaste se a rezervujte místa přímo z programu.</p><button class="btn" type="button" data-action="login">Přihlásit CinePass</button></div>`;
    if (!items.length) {
      main.innerHTML = `<div class="page-head"><span class="eyebrow">Osobní plánovač</span><h1>Můj diář</h1></div>${pass}
        <div class="empty"><p>Zatím nemáte nic uloženo. V programu klepněte na ikonu kalendáře u projekce.</p>
        <div class="btn-row"><a class="btn primary" href="#/program">Otevřít program</a><button class="btn" type="button" data-action="demo-diary">Načíst ukázkový diář</button></div></div>`;
      return;
    }
    let html = "";
    for (const day of DAYS) {
      const list = items.filter((x) => x.ev.datum === day.date);
      if (!list.length) continue;
      html += `<div class="daygroup"><h3>${day.long}</h3>`;
      list.forEach((x, i) => {
        const prev = list[i - 1];
        if (prev) {
          const cs = conflictsFor(x.ev, [prev.ev]);
          const gap = x.ev.start - prev.ev.end;
          if (cs.length) {
            const alts = alternativesFor(x.ev);
            html += `<div class="alert ${cs[0].kind === "overlap" ? "bad" : "warn"}" role="alert"><strong>${cs[0].kind === "overlap" ? "Kolize" : "Pozor na přesun"}</strong>${conflictText(cs[0])}
              <div class="btn-row">${cs[0].kind === "walk" ? `<button class="btn small" type="button" data-action="route" data-a="${prev.ev.id}" data-b="${x.ev.id}">Ukázat trasu</button>` : ""}
              ${alts.map((a) => `<button class="btn small" type="button" data-action="swap" data-from="${x.ev.id}" data-to="${a.id}">Přesunout „${esc(x.ev.film)}“ na ${fmtWhen(a)}</button>`).join("")}</div></div>`;
          } else if (gap >= 0) {
            const w = walk(prev.ev.misto_id, x.ev.misto_id);
            html += `<p class="gap-note">${w ? `Přesun ${w} min pěšky · ` : ""}rezerva ${gap - w} min</p>`;
          }
        }
        const st = x.d.kind === "cinepass" ? `<span class="status res">Rezervace CinePass</span>` : x.d.kind === "ticket" ? `<span class="status res">Zakoupeno ${x.d.qty} ks</span>` : `<span class="status">Uloženo · bez místa</span>`;
        html += `<article class="ev t-${x.ev.type}"><div class="time">${x.ev.cas_od}<small>do ${x.ev.cas_do}</small></div>
          <div class="info"><h3><a href="#/udalost/${x.ev.id}">${esc(x.ev.film)}</a></h3><div class="tags"><span class="tag">${esc(SHORT_VENUE[x.ev.misto_id])}</span>${st}</div>
          <div class="btn-row">${x.d.kind === "cinepass" ? `<button class="btn small" type="button" data-action="show-res" data-id="${x.ev.id}">QR kód</button>` : ""}
            ${x.d.kind === "ticket" ? `<a class="btn small" href="#/potvrzeni/${x.d.order}">Vstupenky</a>` : ""}
            ${x.d.kind === "saved" ? `<button class="btn small primary" type="button" data-action="reserve" data-id="${x.ev.id}">Rezervovat na CinePass</button>` : ""}
            ${x.d.kind !== "ticket" ? `<button class="btn small ghost" type="button" data-action="remove" data-id="${x.ev.id}">${x.d.kind === "cinepass" ? "Zrušit rezervaci" : "Odebrat"}</button>` : ""}</div></div></article>`;
      });
      html += `</div>`;
    }
    const nConf = items.filter((x, i) => conflictsFor(x.ev, items.slice(0, i).map((y) => y.ev)).length).length;
    main.innerHTML = `<div class="page-head"><span class="eyebrow">Osobní plánovač</span><h1>Můj diář</h1>
      <p class="muted">${items.length} položek · ${items.filter((x) => x.d.kind !== "saved").length} s jistým místem${nConf ? ` · <strong style="color:var(--warn)">${nConf} ${nConf === 1 ? "kolize" : "kolize"}</strong>` : " · bez kolizí"}</p></div>
      ${pass}<div class="list">${html}</div>`;
  }

  function pageInfo(main) {
    crumbs([["Praktické informace", "#/info"]]); setNav("info");
    const faq = [
      ["Jak se dostanu do Kutné Hory?", "Vlakem z Prahy hl. n. za 55 minut do stanice Kutná Hora město, odtud 10 minut pěšky do festivalového centra v Městském divadle."],
      ["Kde zaparkuji?", "Záchytné parkoviště Na Valech (300 míst) a u GASK. Z obou je to do 8 minut pěšky. V centru je placená zóna."],
      ["Jsou sály bezbariérové?", "Velký sál Alfa je plně bezbariérový. Open-Air má zpevněnou cestu, do sálu Beta a Studia pomůže produkce – napište na info@cinelumen.cz."],
      ["Mají filmy titulky?", "Všechny soutěžní filmy mají české i anglické titulky. Open-Air projekce Silent Cinema nabízí sluchátka s audiopopisem."],
      ["Mohu vstupenku vrátit?", "Jednotlivé vstupenky lze vrátit do 24 hodin před projekcí. Rezervaci na CinePass zrušíte v Mém diáři kdykoli."],
      ["Co si vzít na noční Open-Air?", "Teplé oblečení a deku. Občerstvení i deky k zapůjčení jsou na místě."],
    ];
    main.innerHTML = `<div class="page-head"><span class="eyebrow">Info &amp; FAQ</span><h1>Praktické informace</h1></div>
      <div class="field" style="max-width:520px"><label for="faq-q">Hledat v odpovědích</label><input class="input" id="faq-q" type="search" placeholder="např. parkování, titulky"></div>
      <section id="faq">${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</section>
      <section class="panel"><h2>Festivalové centrum</h2><p>Městské divadlo, Havlíčkovo náměstí 552. Akreditace a info stánek denně 9:00–23:00.</p></section>`;
    $("#faq-q", main).oninput = (e) => {
      const q = norm(e.target.value);
      $$("#faq details", main).forEach((d) => { const m = !q || norm(d.textContent).includes(q); d.hidden = !m; d.open = !!q && m; });
    };
  }

  function pageSearch(main, params) {
    const q = params.get("q") || "";
    crumbs([["Vyhledávání", ""]]); setNav("");
    const n = norm(q);
    const ev = n ? events.filter((e) => norm(`${e.nazev} ${e.sekce} ${e.popis}`).includes(n)) : [];
    const gs = n ? D.ucinkujici.filter((g) => norm(`${g.jmeno} ${g.role} ${g.zeme}`).includes(n)) : [];
    const vs = n ? D.sceny.filter((v) => norm(`${v.nazev} ${v.adresa} ${v.typ}`).includes(n)) : [];
    main.innerHTML = `<div class="page-head"><span class="eyebrow">Vyhledávání</span><h1>„${esc(q)}“</h1><p class="muted">${ev.length + gs.length + vs.length} výsledků</p></div>
      ${ev.length ? `<section style="display:grid;gap:10px"><h2>Program (${ev.length})</h2><div class="list">${ev.map((e) => evCard(e, { showDay: true })).join("")}</div></section>` : ""}
      ${gs.length ? `<section style="display:grid;gap:10px"><h2>Hosté (${gs.length})</h2><div class="grid-cards">${gs.map(personCard).join("")}</div></section>` : ""}
      ${vs.length ? `<section style="display:grid;gap:10px"><h2>Sály (${vs.length})</h2><div class="grid-cards">${vs.map((v) => `<a class="vcard" href="#/kino/${v.id}"><h3>${esc(v.nazev)}</h3><p class="muted">${esc(v.adresa)}</p></a>`).join("")}</div></section>` : ""}
      ${!(ev.length + gs.length + vs.length) ? `<div class="empty"><p>Nic jsme nenašli. Zkontrolujte překlep nebo zkuste obecnější slovo (např. „noir“, „dokument“).</p><a class="btn" href="#/program">Projít celý program</a></div>` : ""}`;
  }
  function pageNotFound(main) { crumbs([["Stránka nenalezena", ""]]); main.innerHTML = `<div class="empty"><h2>Stránka nenalezena</h2><a class="btn primary" href="#/">Na úvod</a></div>`; }

  /* ---------- Globální události ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const a = t.dataset.action, id = t.dataset.id;
    if (a === "fav") { inDiary(id) ? removeFromDiary(id) : addToDiary(id); }
    else if (a === "reserve") reserveCinePass(id);
    else if (a === "remove") removeFromDiary(id);
    else if (a === "show-res") showReservation(id);
    else if (a === "login") { e.preventDefault(); $("#more-sheet").hidden = true; loginModal(); }
    else if (a === "logout") { S.pass = null; S.diary = S.diary.map((d) => (d.kind === "cinepass" ? { ...d, kind: "saved" } : d)); save(); render(false); toast("Odhlášeno. Rezervace zůstaly uložené jako položky diáře."); }
    else if (a === "buy-pass") { S.pass = { number: "CL-2026-" + String(1000 + (hash(Date.now()) % 9000)), email: "divak@example.cz", type: t.dataset.pass }; save(); render(false); toast(`Simulace nákupu: ${esc(t.dataset.pass)} je aktivní a jste přihlášeni.`); }
    else if (a === "swap") { S.diary = S.diary.filter((d) => d.id !== t.dataset.from); save(); addToDiary(t.dataset.to, "saved", {}, true); }
    else if (a === "route") { const pa = byId[t.dataset.a], pb = byId[t.dataset.b]; modal(`<h2>Trasa ${esc(SHORT_VENUE[pa.misto_id])} → ${esc(SHORT_VENUE[pb.misto_id])}</h2>${routeMap({ from: pa, to: pb, walk: walk(pa.misto_id, pb.misto_id) })}<button class="btn" type="button" data-close>Zavřít</button>`); }
    else if (a === "demo-diary") { S.diary = [{ id: "prog-024", kind: "saved" }, { id: "prog-025", kind: "saved" }, { id: "prog-020", kind: "saved" }]; save(); render(false); toast("Načten ukázkový páteční diář. Zkuste přidat i „Monzunové echo“."); }
    else if (a === "wallet") toast("Simulace: vstupenka přidána do Wallet.");
    else if (a === "pdf") toast("Simulace: PDF vstupenky se stahuje.");
    else if (a === "lang") toast("Anglická verze bude doplněna, prototyp je jen v češtině.");
    else if (a === "theme") {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : !matchMedia("(prefers-color-scheme: light)").matches;
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem(KEY + "-theme", document.documentElement.dataset.theme); } catch (err) { /* ignorovat */ }
    }
    else if (a === "toggle-search") { const sb = $("#searchbar"); sb.classList.toggle("open"); t.setAttribute("aria-expanded", sb.classList.contains("open")); if (sb.classList.contains("open")) $("#q-mob").focus(); }
    else if (a === "more") { const m = $("#more-sheet"); m.hidden = !m.hidden; t.setAttribute("aria-expanded", !m.hidden); }
  });
  $$("[data-search]").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = f.q.value.trim(); if (!q) return;
    $("#searchbar").classList.remove("open");
    location.hash = "#/hledat?q=" + encodeURIComponent(q);
  }));
  try { const th = localStorage.getItem(KEY + "-theme"); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignorovat */ }

  window.addEventListener("hashchange", () => { closeModal(); render(); });
  render();
})();
