/* ==========================================================================
   N3 Tango 2000 | Lightweight Vanilla JS Book Engine
   Zero dependencies, works on static web hosting AND local file://
   ========================================================================== */
(() => {
  "use strict";

  const BOOK = window.N3_TANGO_BOOK;
  if (!BOOK) {
    document.getElementById("view-container").innerHTML =
      '<div class="empty-state">Data buku belum ditemukan. Pastikan file <code>data/book-data.js</code> tersedia.</div>';
    return;
  }

  const STORAGE_KEY = "n3_tango_2000_id_v1";
  const POS_LABELS = {
    "名": "Nomina",
    "動": "Verba",
    "イ形": "Adj-i",
    "ナ形": "Adj-na",
    "副": "Adverbia",
    "連体": "Atributif",
    "接": "Konjungsi",
    "感": "Seruan",
    "連語": "Frasa",
    "代": "Pronomina",
    "形": "Adjektiva",
    "接尾": "Akhiran",
    "接頭": "Awalan"
  };

  const KANA_ROWS = [
    { key: "あ", chars: "あいうえおぁぃぅぇぉアイウエオァィゥェォ" },
    { key: "か", chars: "かきくけこがぎぐげごカキクケコガギグゲゴ" },
    { key: "さ", chars: "さしすせそざじずぜぞサシスセソザジズゼゾ" },
    { key: "た", chars: "たちつてとだぢづでどっタチツテトダヂヅデドッ" },
    { key: "な", chars: "なにぬねのナニヌネノ" },
    { key: "は", chars: "はひふへほばびぶべぼぱぴぷぺぽハヒフヘホバビブベボパピプペポ" },
    { key: "ま", chars: "まみむめもマミムメモ" },
    { key: "や", chars: "やゆよゃゅょヤユヨャュョ" },
    { key: "ら", chars: "らりるれろラリルレロ" },
    { key: "わ", chars: "わをんワヲン" }
  ];

  // Build flat lookups
  const ALL_ENTRIES = [];
  const ENTRY_BY_ID = new Map();
  const FLAT_SECTIONS = [];
  const BONUS_BY_ID = new Map();

  BOOK.chapters.forEach((ch) => {
    ch.sections.forEach((sec) => {
      const secKey = `ch${ch.chapter}-s${sec.section}`;
      FLAT_SECTIONS.push({ key: secKey, chapter: ch, section: sec });
      sec.entries.forEach((e) => {
        const enriched = {
          ...e,
          chapter: ch.chapter,
          chapter_title_id: ch.title_id,
          section: sec.section,
          section_title_id: sec.title_id,
          secKey,
          plainSearch: buildSearchText(e)
        };
        ALL_ENTRIES.push(enriched);
        ENTRY_BY_ID.set(e.id, enriched);
      });
    });
  });

  (BOOK.bonus || []).forEach((b) => BONUS_BY_ID.set(b.col_id, b));

  // State persisted in localStorage
  const defaultState = {
    known: {},
    bookmarks: {},
    furigana: true,
    maskOn: false,
    maskMode: "meaning",
    viewMode: "card",
    theme: "light",
    scale: "md",
    lastRoute: "home"
  };

  let state = loadState();
  let filterStatus = "all"; // all | unknown | known | bookmarked
  let filterPos = "all";
  let expandAllRows = false;
  let activeKana = "あ";
  let currentEntriesForFC = [];
  let fcList = [];
  let fcIdx = 0;
  let fcRevealed = false;
  let searchTimer = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState };
      const parsed = JSON.parse(raw);
      return {
        ...defaultState,
        ...parsed,
        known: parsed.known || {},
        bookmarks: parsed.bookmarks || {}
      };
    } catch {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }

  // Utilities
  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function stripMarkup(jp) {
    return String(jp ?? "")
      .replace(/\{\{|\}\}/g, "")
      .replace(/\[([^|\[\]]+)\|[^|\[\]]+\]/g, "$1");
  }

  function renderJpMarkup(jp) {
    const safe = esc(jp);
    const withRuby = safe.replace(/\[([^|\[\]]+)\|([^|\[\]]+)\]/g, "<ruby>$1<rt>$2</rt></ruby>");
    return withRuby.replace(/\{\{(.*?)\}\}/g, '<mark class="hl maskable" tabindex="0" title="Klik untuk mengintip">$1</mark>');
  }

  function buildSearchText(e) {
    const rel = (e.related || []).map((r) => `${r.word} ${r.reading} ${r.meaning_id}`).join(" ");
    const ex = (e.examples || []).map((x) => `${stripMarkup(x.jp)} ${x.id}`).join(" ");
    return `${e.id} #${e.id} ${e.word} ${e.reading} ${e.meaning_id} ${rel} ${ex}`.toLowerCase();
  }

  function firstCleanKana(reading) {
    const cleaned = String(reading || "")
      .replace(/^\[[^\]]+\]/, "")
      .replace(/^\([^)]+\)/, "")
      .replace(/^[〜・\s]+/, "");
    return cleaned.charAt(0) || "";
  }

  function kanaRowOf(reading) {
    const ch = firstCleanKana(reading);
    for (const row of KANA_ROWS) {
      if (row.chars.includes(ch)) return row.key;
    }
    return "あ";
  }

  function speakJp(text) {
    if (!("speechSynthesis" in window)) {
      showToast("Browser ini belum mendukung fitur pelafalan suara.");
      return;
    }
    window.speechSynthesis.cancel();
    const clean = stripMarkup(text)
      .replace(/〈[^〉]+〉/g, "")
      .replace(/\[([^\]]+)\]/g, "$1")
      .replace(/[①②③]/g, " ")
      .replace(/[AB]「/g, "");
    const utt = new SpeechSynthesisUtterance(clean);
    utt.lang = "ja-JP";
    utt.rate = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const jaVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
    if (jaVoice) utt.voice = jaVoice;
    window.speechSynthesis.speak(utt);
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2400);
  }

  // Apply UI preferences
  function applyPrefs() {
    document.documentElement.setAttribute("data-theme", state.theme);
    document.documentElement.setAttribute("data-scale", state.scale);
    document.body.classList.toggle("hide-furigana", !state.furigana);
    document.body.classList.remove("mask-meaning", "mask-target", "mask-both");
    if (state.maskOn) {
      document.body.classList.add(`mask-${state.maskMode}`);
    }
    document.getElementById("btn-furigana").setAttribute("aria-pressed", String(state.furigana));
    document.getElementById("btn-mask").setAttribute("aria-pressed", String(state.maskOn));

    document.querySelectorAll("[data-set-theme]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.setTheme === state.theme))
    );
    document.querySelectorAll("[data-set-scale]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.setScale === state.scale))
    );
    document.querySelectorAll("[data-set-maskmode]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.setMaskmode === state.maskMode))
    );
    document.querySelectorAll("[data-set-view]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.setView === state.viewMode))
    );
  }

  function updateProgressUI() {
    const total = ALL_ENTRIES.length;
    const knownCount = Object.keys(state.known).length;
    const bmCount = Object.keys(state.bookmarks).length;
    const pct = total ? Math.round((knownCount / total) * 100) : 0;

    document.getElementById("sidebar-progress-text").textContent =
      `${knownCount.toLocaleString("id-ID")} / ${total.toLocaleString("id-ID")}`;
    document.getElementById("sidebar-progress-fill").style.width = `${pct}%`;
    document.getElementById("sidebar-progress-bar").setAttribute("aria-valuenow", String(knownCount));
    document.getElementById("bookmark-count").textContent = String(bmCount);
  }

  // Build Topbar Chapter Select Menu & Sidebar TOC
  function buildNavigation() {
    const selectEl = document.getElementById("chapter-select");
    if (selectEl) {
      const chOptions = BOOK.chapters
        .map((ch) => {
          const allE = ch.sections.flatMap((s) => s.entries);
          const startId = allE[0]?.id ?? "";
          const endId = allE[allE.length - 1]?.id ?? "";
          return `<option value="ch${ch.chapter}">Chapter ${ch.chapter}: ${esc(ch.title_id)} (#${startId}-${endId})</option>`;
        })
        .join("");

      const bonusOptions = (BOOK.bonus || [])
        .map((b) => {
          const prefix = b.kind === "comm" ? `Komunikasi ${b.number}` : `Tambahan ${b.number}`;
          return `<option value="bonus-${b.col_id}">${prefix}: ${esc(b.title_id)}</option>`;
        })
        .join("");

      selectEl.innerHTML = `
        <option value="home">Ringkasan Buku (Semua Chapter)</option>
        <option value="all">List Semua Kosakata (#1-1393)</option>
        <optgroup label="Pilih Chapter (1-12)">
          ${chOptions}
        </optgroup>
        <optgroup label="Kolom Tambahan">
          ${bonusOptions}
        </optgroup>
        <optgroup label="Navigasi Lainnya">
          <option value="index">Indeks 50 Bunyi (あ-わ)</option>
          <option value="bookmarks">Kata Ditandai</option>
        </optgroup>
      `;

      selectEl.addEventListener("change", () => {
        if (selectEl.value) {
          location.hash = `#${selectEl.value}`;
        }
      });
    }

    const chWrap = document.getElementById("toc-chapters");
    chWrap.innerHTML = BOOK.chapters
      .map((ch) => {
        const allE = ch.sections.flatMap((s) => s.entries);
        const chFirst = allE[0]?.id ?? "";
        const chLast = allE[allE.length - 1]?.id ?? "";
        const allLink = `<a href="#ch${ch.chapter}" class="toc-sec-link" data-route="ch${ch.chapter}">
          <span>Semua di Chapter ${ch.chapter}</span>
          <span class="toc-sec-range">${chFirst}-${chLast}</span>
        </a>`;
        const secLinks = ch.sections
          .map((sec) => {
            const firstId = sec.entries[0]?.id ?? "";
            const lastId = sec.entries[sec.entries.length - 1]?.id ?? "";
            return `<a href="#ch${ch.chapter}-s${sec.section}" class="toc-sec-link" data-route="ch${ch.chapter}-s${sec.section}">
              <span>Section ${sec.section}: ${esc(sec.title_id)}</span>
              <span class="toc-sec-range">${firstId}-${lastId}</span>
            </a>`;
          })
          .join("");
        const chBonus = (BOOK.bonus || []).find((b) => b.after_chapter === ch.chapter);
        const bonusLink = chBonus
          ? `<a href="#bonus-${chBonus.col_id}" class="toc-sec-link" data-route="bonus-${chBonus.col_id}">
              <span>${chBonus.kind === "comm" ? "コミュニケーション" : "これも覚えよう"} ${chBonus.number}: ${esc(chBonus.title_id)}</span>
              <span class="toc-sec-range">Akhir Ch.${ch.chapter}</span>
            </a>`
          : "";
        return `<div class="toc-chapter" data-ch="${ch.chapter}" data-open="${ch.chapter === 1 ? "true" : "false"}">
          <button type="button" class="toc-chapter-btn" aria-expanded="${ch.chapter === 1 ? "true" : "false"}">
            <span class="toc-ch-num">${ch.chapter}</span>
            <span class="toc-ch-title">Chapter ${ch.chapter}: ${esc(ch.title_id)}</span>
            <svg class="toc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="toc-sections">${allLink}${secLinks}${bonusLink}</div>
        </div>`;
      })
      .join("");

    chWrap.querySelectorAll(".toc-chapter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const parent = btn.closest(".toc-chapter");
        const isOpen = parent.getAttribute("data-open") === "true";
        parent.setAttribute("data-open", String(!isOpen));
        btn.setAttribute("aria-expanded", String(!isOpen));
      });
    });

    const bonusWrap = document.getElementById("toc-bonus");
    bonusWrap.innerHTML = (BOOK.bonus || [])
      .map((b) => {
        const prefix = b.kind === "comm" ? `Komunikasi ${b.number}` : `Tambahan ${b.number}`;
        return `<a href="#bonus-${b.col_id}" class="nav-link" data-route="bonus-${b.col_id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          <span>${prefix}: ${esc(b.title_id)}</span>
        </a>`;
      })
      .join("");
  }

  function highlightNav(routeKey) {
    document.querySelectorAll(".nav-link, .toc-sec-link").forEach((a) => {
      const match = a.dataset.route === routeKey;
      a.classList.toggle("active", match);
      if (match) {
        const parentCh = a.closest(".toc-chapter");
        if (parentCh) {
          parentCh.setAttribute("data-open", "true");
          parentCh.querySelector(".toc-chapter-btn")?.setAttribute("aria-expanded", "true");
        }
      }
    });

    const selectEl = document.getElementById("chapter-select");
    if (selectEl) {
      const chMatch = routeKey.match(/^ch(\d+)/);
      if (chMatch) {
        selectEl.value = `ch${chMatch[1]}`;
      } else if (selectEl.querySelector(`option[value="${routeKey}"]`)) {
        selectEl.value = routeKey;
      } else {
        selectEl.value = "home";
      }
    }
  }

  function renderChapterMenuBar(activeChapterNum = null) {
    const pills = BOOK.chapters
      .map(
        (c) =>
          `<a href="#ch${c.chapter}" class="ch-pill-link ${activeChapterNum === c.chapter ? "active" : ""}" title="Chapter ${c.chapter}: ${esc(c.title_id)}">
            <span class="ch-pill-num">Chapter ${c.chapter}</span>
            <span class="ch-pill-sub">${esc(c.title_id)}</span>
          </a>`
      )
      .join("");
    return `<nav class="chapter-menu-bar" aria-label="Menu pilih Chapter">
      <span class="chapter-menu-label">Pilih Chapter (1-12)</span>
      <div class="chapter-menu-grid">${pills}</div>
    </nav>`;
  }

  function renderSectionTabsBar(ch, activeSecNum = null) {
    const totalWords = ch.sections.reduce((acc, s) => acc + s.entries.length, 0);
    const allTab = `<a href="#ch${ch.chapter}" class="sec-tab ${activeSecNum === null ? "active" : ""}">Semua Section (${totalWords})</a>`;
    const secTabs = ch.sections
      .map(
        (s) =>
          `<a href="#ch${ch.chapter}-s${s.section}" class="sec-tab ${activeSecNum === s.section ? "active" : ""}">Section ${s.section}: ${esc(s.title_id)} (${s.entries.length})</a>`
      )
      .join("");
    const chBonus = (BOOK.bonus || []).find((b) => b.after_chapter === ch.chapter);
    const bonusTab = chBonus
      ? `<a href="#bonus-${chBonus.col_id}" class="sec-tab sec-tab-bonus ${activeSecNum === "bonus" ? "active" : ""}">${
          chBonus.kind === "comm" ? `コミュニケーション ${chBonus.number}` : `これも覚えよう！ ${chBonus.number}`
        }: ${esc(chBonus.title_id)}</a>`
      : "";
    return `<nav class="section-tabs" aria-label="Pilih Section di Chapter ${ch.chapter}">${allTab}${secTabs}${bonusTab}</nav>`;
  }

  function renderBonusSectionHtml(col, embedded = false) {
    if (!col) return "";
    const badgeJp =
      col.kind === "comm"
        ? `コミュニケーションに使えることば ${col.number}`
        : `これも覚えよう！ ${col.number}`;
    const badgeId =
      col.kind === "comm"
        ? `Ungkapan Komunikasi ${col.number} (Akhir Chapter ${col.after_chapter})`
        : `Hafalkan Juga Ini ${col.number} (Akhir Chapter ${col.after_chapter})`;

    const groupsHtml = (col.groups || [])
      .map((g) => {
        const itemsHtml = (g.items || [])
          .map((it) => {
            const hasEx = it.examples && it.examples.length > 0;
            const plainJp = stripMarkup(it.jp);
            return `<div class="bonus-item ${hasEx ? "has-examples" : ""}">
              <div class="bonus-item-jp">${renderJpMarkup(it.jp)}${it.reading ? ` <span class="rel-read">(${esc(it.reading)})</span>` : ""}</div>
              ${
                it.meaning_id
                  ? `<div class="bonus-item-id maskable mask-target-meaning" tabindex="0">${esc(it.meaning_id)}</div>`
                  : ""
              }
              <button type="button" class="icon-btn-sm btn-speak-raw" data-jp="${esc(plainJp)}" aria-label="Dengarkan ${esc(plainJp)}" title="Dengarkan pelafalan">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
              ${
                hasEx
                  ? `<div style="grid-column: 1 / -1; margin-top:4px; padding-top:8px; border-top:1px dashed var(--border)">
                      ${it.examples
                        .map(
                          (ex) => `<div class="example-item">
                            <div class="example-jp">${renderJpMarkup(ex.jp)}</div>
                            <div class="example-id maskable mask-target-meaning" tabindex="0">${esc(ex.id)}</div>
                          </div>`
                        )
                        .join("")}
                    </div>`
                  : ""
              }
              ${
                it.note_id
                  ? `<div class="note-box" style="grid-column: 1 / -1; margin-top:4px">
                      <svg class="note-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                      <span>${esc(it.note_id)}</span>
                    </div>`
                  : ""
              }
            </div>`;
          })
          .join("");

        let tableHtml = "";
        if (g.table && g.table.headers && g.table.rows) {
          tableHtml = `<div class="table-wrap"><table class="book-table">
            <thead><tr>${g.table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
            <tbody>${g.table.rows
              .map((row) => `<tr>${row.map((cell) => `<td>${renderJpMarkup(cell)}</td>`).join("")}</tr>`)
              .join("")}</tbody>
          </table></div>`;
        }

        return `<section class="bonus-group">
          ${g.heading_jp ? `<h3 class="bonus-group-title">${renderJpMarkup(g.heading_jp)}</h3>` : ""}
          ${g.heading_id ? `<p class="bonus-group-sub">${esc(g.heading_id)}</p>` : ""}
          ${g.pattern_jp ? `<div class="bonus-pattern">${renderJpMarkup(g.pattern_jp)}</div>` : ""}
          ${
            g.note_id
              ? `<div class="note-box" style="margin-bottom:12px">
                  <svg class="note-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>${esc(g.note_id)}</span>
                </div>`
              : ""
          }
          ${itemsHtml ? `<div class="bonus-items">${itemsHtml}</div>` : ""}
          ${tableHtml}
        </section>`;
      })
      .join("");

    return `<section class="eoc-wrapper" id="eoc-${col.col_id}">
      <div class="eoc-header">
        <div>
          <span class="eoc-badge">${esc(badgeJp)} &middot; ${esc(badgeId)}</span>
          <h2 class="eoc-title-jp">${esc(col.title_jp)} (${esc(col.title_reading || "")})</h2>
          <p class="eoc-title-id">${esc(col.title_id)}</p>
        </div>
        ${
          embedded
            ? `<a href="#bonus-${col.col_id}" class="btn btn-secondary">Buka Halaman Khusus</a>`
            : `<a href="#ch${col.after_chapter}" class="btn btn-secondary">Lihat Semua Kosakata Chapter ${col.after_chapter}</a>`
        }
      </div>
      ${groupsHtml}
    </section>`;
  }

  // Render a single Vocabulary Card
  function renderWordCard(e, showSectionBadge = false) {
    const isKnown = !!state.known[e.id];
    const isBm = !!state.bookmarks[e.id];
    const posTags = (e.pos || [])
      .map((p) => {
        const label = POS_LABELS[p] ? `${p} · ${POS_LABELS[p]}` : p;
        return `<span class="pos-tag" title="${esc(label)}">${esc(p)}</span>`;
      })
      .join("");

    const examplesHtml = (e.examples || [])
      .map(
        (ex, idx) => `<div class="example-item">
          <div class="example-jp-row">
            <div class="example-jp">${renderJpMarkup(ex.jp)}</div>
            <button type="button" class="icon-btn-sm btn-speak-ex" data-id="${e.id}" data-ex="${idx}" aria-label="Putar contoh kalimat ${e.id}" title="Dengarkan kalimat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
          </div>
          <div class="example-id maskable mask-target-meaning" tabindex="0">${esc(ex.id)}</div>
        </div>`
      )
      .join("");

    const hasRelated = e.related && e.related.length > 0;
    const hasNote = e.note_id && e.note_id.trim().length > 0;
    let footerHtml = "";
    if (hasRelated || hasNote) {
      const relHtml = hasRelated
        ? `<div class="related-list">${e.related
            .map((r) => {
              const title = r.type === "=" ? "Sinonim" : r.type === "⇔" ? "Lawan kata" : "Kata terkait";
              return `<span class="related-chip">
                <span class="rel-badge" title="${title}">${esc(r.type || "+")}</span>
                <span class="rel-word">${esc(r.word)}</span>
                ${r.reading ? `<span class="rel-read">${esc(r.reading)}</span>` : ""}
                ${r.meaning_id ? `<span class="rel-mean">${esc(r.meaning_id)}</span>` : ""}
              </span>`;
            })
            .join("")}</div>`
        : "";

      const noteHtml = hasNote
        ? `<div class="note-box">
            <svg class="note-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            <span>${esc(e.note_id)}</span>
          </div>`
        : "";

      footerHtml = `<div class="word-footer">${relHtml}${noteHtml}</div>`;
    }

    const secTag = showSectionBadge
      ? `<a href="#${e.secKey}" class="word-sec-tag">Chapter ${e.chapter} · Section ${e.section}: ${esc(e.section_title_id)}</a>`
      : "";

    return `<article class="word-card ${isKnown ? "is-known" : ""} ${isBm ? "is-bookmarked" : ""}" id="word-${e.id}" data-word-id="${e.id}">
      <div class="word-top">
        <div class="word-top-left">
          <span class="word-num">#${String(e.id).padStart(4, "0")}</span>
          <div class="pos-group">${posTags}</div>
          ${secTag}
        </div>
        <div class="word-actions">
          <button type="button" class="icon-btn-sm btn-speak-word" data-id="${e.id}" aria-label="Dengarkan kata ${esc(e.word)}" title="Dengarkan pelafalan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
          <button type="button" class="icon-btn-sm btn-bookmark ${isBm ? "is-active" : ""}" data-id="${e.id}" aria-pressed="${isBm}" aria-label="Tandai kata ${esc(e.word)}" title="Tandai untuk diulang">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isBm ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          </button>
          <button type="button" class="icon-btn-sm btn-known ${isKnown ? "is-known" : ""}" data-id="${e.id}" aria-pressed="${isKnown}" aria-label="Tandai sudah hafal ${esc(e.word)}" title="Sudah hafal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
      </div>
      <div class="word-body">
        <div class="word-left">
          <div class="word-jp">${esc(e.word)}</div>
          <div class="word-reading">${esc(e.reading || "")}</div>
          <div class="word-meaning maskable mask-target-meaning" tabindex="0">${esc(e.meaning_id)}</div>
        </div>
        <div class="word-right">${examplesHtml}</div>
      </div>
      ${footerHtml}
    </article>`;
  }

  // Render a single Vertical List Row
  function renderWordRow(e, showSectionBadge = false) {
    const isKnown = !!state.known[e.id];
    const isBm = !!state.bookmarks[e.id];
    const posTags = (e.pos || [])
      .map((p) => {
        const label = POS_LABELS[p] ? `${p} · ${POS_LABELS[p]}` : p;
        return `<span class="pos-tag" title="${esc(label)}">${esc(p)}</span>`;
      })
      .join("");

    const examplesHtml = (e.examples || [])
      .map(
        (ex, idx) => `<div class="example-item">
          <div class="example-jp-row">
            <div class="example-jp">${renderJpMarkup(ex.jp)}</div>
            <button type="button" class="icon-btn-sm btn-speak-ex" data-id="${e.id}" data-ex="${idx}" aria-label="Putar contoh kalimat ${e.id}" title="Dengarkan kalimat">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
            </button>
          </div>
          <div class="example-id maskable mask-target-meaning" tabindex="0">${esc(ex.id)}</div>
        </div>`
      )
      .join("");

    const hasRelated = e.related && e.related.length > 0;
    const hasNote = e.note_id && e.note_id.trim().length > 0;
    const relHtml = hasRelated
      ? `<div class="related-list">${e.related
          .map((r) => {
            const title = r.type === "=" ? "Sinonim" : r.type === "⇔" ? "Lawan kata" : "Kata terkait";
            return `<span class="related-chip">
              <span class="rel-badge" title="${title}">${esc(r.type || "+")}</span>
              <span class="rel-word">${esc(r.word)}</span>
              ${r.reading ? `<span class="rel-read">${esc(r.reading)}</span>` : ""}
              ${r.meaning_id ? `<span class="rel-mean">${esc(r.meaning_id)}</span>` : ""}
            </span>`;
          })
          .join("")}</div>`
      : "";

    const noteHtml = hasNote
      ? `<div class="note-box">
          <svg class="note-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>${esc(e.note_id)}</span>
        </div>`
      : "";

    const secBadge = showSectionBadge
      ? `<a href="#${e.secKey}" class="word-sec-tag" style="margin-left:4px">Ch ${e.chapter}.${e.section}</a>`
      : "";

    return `<div class="word-row-item ${isKnown ? "is-known" : ""} ${isBm ? "is-bookmarked" : ""}" id="word-${e.id}" data-word-id="${e.id}">
      <div class="word-row-main" role="button" tabindex="0" aria-expanded="false" title="Klik baris untuk melihat contoh kalimat">
        <div class="row-col-num">#${String(e.id).padStart(4, "0")}</div>
        <div class="row-col-word">
          <span class="row-jp">${esc(e.word)}</span>
          <span class="row-reading">${esc(e.reading || "")}</span>
        </div>
        <div class="row-col-pos">${posTags}</div>
        <div class="row-col-meaning">
          <span class="maskable mask-target-meaning" tabindex="0">${esc(e.meaning_id)}</span>
          ${secBadge}
        </div>
        <div class="row-col-actions">
          <button type="button" class="icon-btn-sm btn-speak-word" data-id="${e.id}" aria-label="Dengarkan kata ${esc(e.word)}" title="Dengarkan pelafalan">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
          </button>
          <button type="button" class="icon-btn-sm btn-bookmark ${isBm ? "is-active" : ""}" data-id="${e.id}" aria-pressed="${isBm}" aria-label="Tandai kata ${esc(e.word)}" title="Tandai untuk diulang">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="${isBm ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
          </button>
          <button type="button" class="icon-btn-sm btn-known ${isKnown ? "is-known" : ""}" data-id="${e.id}" aria-pressed="${isKnown}" aria-label="Tandai sudah hafal ${esc(e.word)}" title="Sudah hafal">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button type="button" class="icon-btn-sm btn-expand-row" aria-label="Tampilkan contoh kalimat" title="Contoh kalimat & catatan">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
      </div>
      <div class="word-row-detail">
        ${examplesHtml}
        ${relHtml}
        ${noteHtml}
      </div>
    </div>`;
  }

  function renderWordsCollection(entries, showSectionBadge = false) {
    if (!entries.length) {
      return '<div class="empty-state">Tidak ada kata yang cocok dengan filter aktif.</div>';
    }
    if (state.viewMode === "list") {
      return `<div class="word-list-table ${expandAllRows ? "expand-all" : ""}" id="word-list">
        <div class="word-list-header">
          <span>No.</span>
          <span>Kosakata & Baca</span>
          <span>Kelas</span>
          <span>Arti Bahasa Indonesia</span>
          <span style="text-align:right">Aksi & Contoh</span>
        </div>
        ${entries.map((e) => renderWordRow(e, showSectionBadge)).join("")}
      </div>`;
    }
    return `<div class="word-list" id="word-list">
      ${entries.map((e) => renderWordCard(e, showSectionBadge)).join("")}
    </div>`;
  }

  function renderViewToggleBar(totalFiltered, totalAll) {
    const expandBtn =
      state.viewMode === "list"
        ? `<button type="button" class="view-choice-card" id="btn-toggle-expand-all" aria-pressed="${expandAllRows}">${expandAllRows ? "Tutup Contoh" : "Buka Contoh"}</button>`
        : "";
    return `
      <div class="view-mode-banner" role="region" aria-label="Pilih mode tampilan kosakata">
        <div class="view-mode-banner-left">
          <span class="view-mode-title">Tampilan:</span>
          <div class="view-mode-choices" role="group" aria-label="Dua mode tampilan kosakata">
            <button type="button" class="view-choice-card" data-set-view="card" aria-pressed="${state.viewMode === "card"}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>
              <span>Mode Kartu</span>
            </button>
            <button type="button" class="view-choice-card" data-set-view="list" aria-pressed="${state.viewMode === "list"}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              <span>Mode List</span>
            </button>
          </div>
        </div>
        <div class="view-mode-choices">
          ${expandBtn}
          <span class="filter-meta" style="align-self:center">${totalFiltered} dari ${totalAll} kata</span>
        </div>
      </div>
    `;
  }

  // Views
  function renderHome() {
    const total = ALL_ENTRIES.length;
    const knownCount = Object.keys(state.known).length;
    const relatedTotal = ALL_ENTRIES.reduce((acc, e) => acc + (e.related ? e.related.length : 0), 0);
    const bonusItemsTotal = (BOOK.bonus || []).reduce(
      (acc, b) => acc + (b.groups || []).reduce((a, g) => a + (g.items ? g.items.length : 0) + (g.table ? g.table.rows.length : 0), 0),
      0
    );
    const continueRoute = state.lastRoute && state.lastRoute !== "home" ? state.lastRoute : "ch1";

    const chapterCards = BOOK.chapters
      .map((ch) => {
        const chEntries = ch.sections.flatMap((s) => s.entries);
        const chKnown = chEntries.filter((e) => state.known[e.id]).length;
        const pct = chEntries.length ? Math.round((chKnown / chEntries.length) * 100) : 0;
        const startId = chEntries[0]?.id ?? "";
        const endId = chEntries[chEntries.length - 1]?.id ?? "";
        const secNames = ch.sections.map((s) => `S${s.section}: ${s.title_id}`).join(" · ");
        return `<a href="#ch${ch.chapter}" class="chapter-card">
          <div class="chapter-card-top">
            <span class="chapter-pill">Chapter ${ch.chapter}</span>
            <span class="chapter-range">#${startId}-${endId}</span>
          </div>
          <div class="chapter-jp">${esc(ch.title_jp)}</div>
          <div class="chapter-id">${esc(ch.title_id)}</div>
          <div class="chapter-sec-list">${esc(secNames)}</div>
          <div class="progress-track" style="margin-top:auto">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </a>`;
      })
      .join("");

    const bonusCards = (BOOK.bonus || [])
      .map((b) => {
        const badge = b.kind === "comm" ? `Komunikasi ${b.number}` : `Tambahan ${b.number}`;
        return `<a href="#bonus-${b.col_id}" class="chapter-card">
          <div class="chapter-card-top">
            <span class="chapter-pill">${badge}</span>
            <span class="chapter-range">Setelah Chapter ${b.after_chapter}</span>
          </div>
          <div class="chapter-jp">${esc(b.title_jp)}</div>
          <div class="chapter-id">${esc(b.title_id)}</div>
        </a>`;
      })
      .join("");

    currentEntriesForFC = ALL_ENTRIES.slice(0, 50);

    document.getElementById("view-container").innerHTML = `
      <section class="hero">
        <div class="hero-kicker">はじめての日本語能力試験 N3単語2000</div>
        <h1>2000 Kosakata Penting JLPT N3</h1>
        <p class="hero-desc">
          Edisi terjemahan bahasa Indonesia dari seri kosakata N3 terbitan ARC Academy / ASK Publishing.
          Seluruh 12 Chapter, 60 Section, contoh kalimat, catatan pemakaian, dan 8 kolom tambahan disusun ulang dalam format web ringan agar nyaman dibaca, dicari, dan dipakai berlatih hafalan.
        </p>
        <div class="stats-grid">
          <div class="stat-box"><div class="stat-val">${total.toLocaleString("id-ID")}</div><div class="stat-lbl">Kosakata Utama</div></div>
          <div class="stat-box"><div class="stat-val">+${(relatedTotal + bonusItemsTotal).toLocaleString("id-ID")}</div><div class="stat-lbl">Kata Terkait & Kolom</div></div>
          <div class="stat-box"><div class="stat-val">12 Chapter</div><div class="stat-lbl">60 Section Tematik</div></div>
          <div class="stat-box"><div class="stat-val">${knownCount.toLocaleString("id-ID")}</div><div class="stat-lbl">Sudah Dihafal</div></div>
        </div>
        <div class="hero-actions">
          <a href="#${continueRoute}" class="btn btn-primary">${continueRoute === "ch1" ? "Mulai dari Chapter 1" : "Lanjutkan Belajar"}</a>
          <a href="#all" class="btn btn-secondary">List Semua Kosakata</a>
          <a href="#index" class="btn btn-secondary">Buka Indeks 50 Bunyi</a>
          <button type="button" class="btn btn-secondary" id="hero-fc-btn">Latihan Kartu Kilat</button>
        </div>
      </section>

      ${renderChapterMenuBar(null)}

      <h2 class="section-heading">Pilih Chapter (1-12)</h2>
      <div class="chapter-grid">${chapterCards}</div>

      <h2 class="section-heading">Kolom Komunikasi & Materi Tambahan</h2>
      <div class="chapter-grid">${bonusCards}</div>
    `;

    document.getElementById("hero-fc-btn")?.addEventListener("click", () => {
      const unlearned = ALL_ENTRIES.filter((e) => !state.known[e.id]);
      openFlashcards(unlearned.length ? unlearned.slice(0, 40) : ALL_ENTRIES.slice(0, 40), "Latihan 40 Kata Belum Hafal");
    });
  }

  function renderChapter(chNum, focusWordId = null) {
    const ch = BOOK.chapters.find((c) => c.chapter === chNum);
    if (!ch) return renderHome();

    const entries = ch.sections.flatMap((s) => s.entries.map((e) => ENTRY_BY_ID.get(e.id)));
    currentEntriesForFC = entries;

    const filtered = entries.filter((e) => {
      if (filterStatus === "known" && !state.known[e.id]) return false;
      if (filterStatus === "unknown" && state.known[e.id]) return false;
      if (filterStatus === "bookmarked" && !state.bookmarks[e.id]) return false;
      if (filterPos !== "all" && !(e.pos || []).includes(filterPos)) return false;
      return true;
    });

    const availablePos = [...new Set(entries.flatMap((e) => e.pos || []))];
    const prevCh = BOOK.chapters.find((c) => c.chapter === chNum - 1);
    const nextCh = BOOK.chapters.find((c) => c.chapter === chNum + 1);
    const chapterBonus = (BOOK.bonus || []).find((b) => b.after_chapter === ch.chapter);

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <nav class="breadcrumb" aria-label="Navigasi lokasi">
            <a href="#home">Beranda</a>
            <span aria-hidden="true">/</span>
            <span>Chapter ${ch.chapter}</span>
          </nav>
          <h1 class="page-title-jp">Chapter ${ch.chapter}: ${esc(ch.title_jp)}</h1>
          <p class="page-title-id">${esc(ch.title_id)} &middot; Semua Section (1-5) &middot; #${entries[0]?.id}-${entries[entries.length - 1]?.id}</p>
        </div>
        <button type="button" class="btn btn-secondary" id="ch-fc-btn">Uji Chapter ${ch.chapter} (${entries.length})</button>
      </div>

      ${renderSectionTabsBar(ch, null)}
      ${renderViewToggleBar(filtered.length, entries.length)}

      <div class="filter-bar" role="region" aria-label="Filter kosakata">
        <button type="button" class="chip" data-fstatus="all" aria-pressed="${filterStatus === "all"}">Semua</button>
        <button type="button" class="chip" data-fstatus="unknown" aria-pressed="${filterStatus === "unknown"}">Belum Hafal</button>
        <button type="button" class="chip" data-fstatus="known" aria-pressed="${filterStatus === "known"}">Sudah Hafal</button>
        <button type="button" class="chip" data-fstatus="bookmarked" aria-pressed="${filterStatus === "bookmarked"}">Ditandai</button>
        ${availablePos
          .map(
            (p) =>
              `<button type="button" class="chip" data-fpos="${esc(p)}" aria-pressed="${filterPos === p}">${esc(p)}</button>`
          )
          .join("")}
      </div>

      ${renderWordsCollection(filtered, true)}

      ${chapterBonus ? renderBonusSectionHtml(chapterBonus, true) : ""}

      <nav class="section-pager" aria-label="Navigasi Chapter">
        ${
          prevCh
            ? `<a href="#ch${prevCh.chapter}" class="btn btn-secondary">Sebelumnya: Chapter ${prevCh.chapter} (${esc(prevCh.title_id)})</a>`
            : "<span></span>"
        }
        ${
          nextCh
            ? `<a href="#ch${nextCh.chapter}" class="btn btn-primary">Berikutnya: Chapter ${nextCh.chapter} (${esc(nextCh.title_id)})</a>`
            : `<a href="#index" class="btn btn-primary">Buka Indeks 50 Bunyi</a>`
        }
      </nav>
      ${renderChapterMenuBar(ch.chapter)}
    `;

    document.getElementById("ch-fc-btn")?.addEventListener("click", () => {
      openFlashcards(entries, `Chapter ${ch.chapter} · ${ch.title_id}`);
    });

    document.querySelectorAll("[data-fstatus]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterStatus = btn.dataset.fstatus;
        renderChapter(chNum);
      })
    );

    document.querySelectorAll("[data-fpos]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterPos = filterPos === btn.dataset.fpos ? "all" : btn.dataset.fpos;
        renderChapter(chNum);
      })
    );

    bindWordCardEvents();

    if (focusWordId) {
      requestAnimationFrame(() => {
        const target = document.getElementById(`word-${focusWordId}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.style.boxShadow = "0 0 0 3px var(--accent)";
          setTimeout(() => {
            target.style.boxShadow = "";
          }, 1800);
        }
      });
    }
  }

  function renderSection(secKey, focusWordId = null) {
    const idx = FLAT_SECTIONS.findIndex((s) => s.key === secKey);
    if (idx === -1) return renderHome();

    const { chapter: ch, section: sec } = FLAT_SECTIONS[idx];
    const entries = sec.entries.map((e) => ENTRY_BY_ID.get(e.id));
    currentEntriesForFC = entries;

    const filtered = entries.filter((e) => {
      if (filterStatus === "known" && !state.known[e.id]) return false;
      if (filterStatus === "unknown" && state.known[e.id]) return false;
      if (filterStatus === "bookmarked" && !state.bookmarks[e.id]) return false;
      if (filterPos !== "all" && !(e.pos || []).includes(filterPos)) return false;
      return true;
    });

    const availablePos = [...new Set(entries.flatMap((e) => e.pos || []))];
    const prev = FLAT_SECTIONS[idx - 1];
    const next = FLAT_SECTIONS[idx + 1];

    const chapterBonus = (BOOK.bonus || []).find((b) => b.after_chapter === ch.chapter && sec.section === ch.sections.length);

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <nav class="breadcrumb" aria-label="Navigasi lokasi">
            <a href="#home">Beranda</a>
            <span aria-hidden="true">/</span>
            <a href="#ch${ch.chapter}">Chapter ${ch.chapter}: ${esc(ch.title_id)}</a>
            <span aria-hidden="true">/</span>
            <span>Section ${sec.section}</span>
          </nav>
          <h1 class="page-title-jp">${esc(sec.title_jp)}</h1>
          <p class="page-title-id">${esc(sec.title_id)} &middot; #${entries[0]?.id}-${entries[entries.length - 1]?.id}</p>
        </div>
        <button type="button" class="btn btn-secondary" id="sec-fc-btn">Uji Section Ini (${entries.length})</button>
      </div>

      ${renderSectionTabsBar(ch, sec.section)}
      ${renderViewToggleBar(filtered.length, entries.length)}

      <div class="filter-bar" role="region" aria-label="Filter kosakata">
        <button type="button" class="chip" data-fstatus="all" aria-pressed="${filterStatus === "all"}">Semua</button>
        <button type="button" class="chip" data-fstatus="unknown" aria-pressed="${filterStatus === "unknown"}">Belum Hafal</button>
        <button type="button" class="chip" data-fstatus="known" aria-pressed="${filterStatus === "known"}">Sudah Hafal</button>
        <button type="button" class="chip" data-fstatus="bookmarked" aria-pressed="${filterStatus === "bookmarked"}">Ditandai</button>
        ${availablePos
          .map(
            (p) =>
              `<button type="button" class="chip" data-fpos="${esc(p)}" aria-pressed="${filterPos === p}">${esc(p)}</button>`
          )
          .join("")}
      </div>

      ${renderWordsCollection(filtered, false)}

      ${chapterBonus ? renderBonusSectionHtml(chapterBonus, true) : ""}

      <nav class="section-pager" aria-label="Navigasi Section">
        ${
          prev
            ? `<a href="#${prev.key}" class="btn btn-secondary">Sebelumnya: Chapter ${prev.chapter.chapter}.${prev.section.section} ${esc(prev.section.title_id)}</a>`
            : "<span></span>"
        }
        ${
          chapterBonus
            ? `<a href="#bonus-${chapterBonus.col_id}" class="btn btn-primary">Kolom Bonus: ${esc(chapterBonus.title_id)}</a>`
            : next
            ? `<a href="#${next.key}" class="btn btn-primary">Berikutnya: Chapter ${next.chapter.chapter}.${next.section.section} ${esc(next.section.title_id)}</a>`
            : `<a href="#index" class="btn btn-primary">Buka Indeks 50 Bunyi</a>`
        }
      </nav>
      ${renderChapterMenuBar(ch.chapter)}
    `;

    document.getElementById("sec-fc-btn")?.addEventListener("click", () => {
      openFlashcards(entries, `Chapter ${ch.chapter}.${sec.section} · ${sec.title_id}`);
    });

    document.querySelectorAll("[data-fstatus]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterStatus = btn.dataset.fstatus;
        renderSection(secKey);
      })
    );

    document.querySelectorAll("[data-fpos]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterPos = filterPos === btn.dataset.fpos ? "all" : btn.dataset.fpos;
        renderSection(secKey);
      })
    );

    bindWordCardEvents();

    if (focusWordId) {
      requestAnimationFrame(() => {
        const target = document.getElementById(`word-${focusWordId}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.style.boxShadow = "0 0 0 3px var(--accent)";
          setTimeout(() => {
            target.style.boxShadow = "";
          }, 1800);
        }
      });
    }
  }

  function renderBonus(colId) {
    const col = BONUS_BY_ID.get(colId);
    if (!col) return renderHome();
    const ch = BOOK.chapters.find((c) => c.chapter === col.after_chapter);
    const nextCh = BOOK.chapters.find((c) => c.chapter === col.after_chapter + 1);

    document.getElementById("view-container").innerHTML = `
      ${ch ? renderSectionTabsBar(ch, "bonus") : ""}
      ${renderBonusSectionHtml(col, false)}
      <nav class="section-pager" aria-label="Navigasi halaman">
        <a href="#ch${col.after_chapter}-s5" class="btn btn-secondary">Kembali ke Chapter ${col.after_chapter} Section 5</a>
        ${
          nextCh
            ? `<a href="#ch${nextCh.chapter}" class="btn btn-primary">Lanjut ke Chapter ${nextCh.chapter}: ${esc(nextCh.title_id)}</a>`
            : `<a href="#index" class="btn btn-primary">Buka Indeks 50 Bunyi</a>`
        }
      </nav>
      ${renderChapterMenuBar(col.after_chapter)}
    `;
    bindWordCardEvents();
  }

  function renderIndex() {
    const byRow = new Map();
    KANA_ROWS.forEach((r) => byRow.set(r.key, []));
    ALL_ENTRIES.forEach((e) => {
      const row = kanaRowOf(e.reading || e.word);
      byRow.get(row).push(e);
    });
    byRow.forEach((arr) => arr.sort((a, b) => (a.reading || a.word).localeCompare(b.reading || b.word, "ja")));

    const items = byRow.get(activeKana) || [];
    currentEntriesForFC = items;

    const kanaBtns = KANA_ROWS.map(
      (r) =>
        `<button type="button" class="chip" data-kana="${r.key}" aria-pressed="${activeKana === r.key}">${r.key} (${byRow.get(r.key).length})</button>`
    ).join("");

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <nav class="breadcrumb"><a href="#home">Beranda</a><span aria-hidden="true">/</span><span>Indeks 50 Bunyi</span></nav>
          <h1 class="page-title-jp">50音順 単語索引</h1>
          <p class="page-title-id">Indeks seluruh ${ALL_ENTRIES.length.toLocaleString("id-ID")} kosakata menurut urutan bunyi Jepang.</p>
        </div>
      </div>
      <div class="kana-bar" role="group" aria-label="Pilih baris bunyi Jepang">${kanaBtns}</div>
      <div class="index-grid">
        ${items
          .map(
            (e) => `<a href="#${e.secKey}?w=${e.id}" class="index-row">
              <div>
                <div><span class="index-word">${esc(e.word)}</span><span class="index-read">${esc(e.reading || "")}</span></div>
                <div class="index-mean">${esc(e.meaning_id)}</div>
              </div>
              <span class="word-num">#${e.id}</span>
            </a>`
          )
          .join("")}
      </div>
      ${renderChapterMenuBar(null)}
    `;

    document.querySelectorAll("[data-kana]").forEach((btn) =>
      btn.addEventListener("click", () => {
        activeKana = btn.dataset.kana;
        renderIndex();
      })
    );
  }

  function renderAllWords() {
    const entries = ALL_ENTRIES;
    currentEntriesForFC = entries.slice(0, 60);

    const filtered = entries.filter((e) => {
      if (filterStatus === "known" && !state.known[e.id]) return false;
      if (filterStatus === "unknown" && state.known[e.id]) return false;
      if (filterStatus === "bookmarked" && !state.bookmarks[e.id]) return false;
      if (filterPos !== "all" && !(e.pos || []).includes(filterPos)) return false;
      return true;
    });

    const availablePos = ["名", "動", "イ形", "ナ形", "副", "連体", "接"];

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <nav class="breadcrumb"><a href="#home">Beranda</a><span aria-hidden="true">/</span><span>List Semua Kosakata</span></nav>
          <h1 class="page-title-jp">Daftar Lengkap 1.393 Kosakata</h1>
          <p class="page-title-id">Seluruh kosakata Chapter 1-12 memanjang ke bawah (#1-1393).</p>
        </div>
      </div>

      ${renderViewToggleBar(filtered.length, entries.length)}

      <div class="filter-bar" role="region" aria-label="Filter kosakata">
        <button type="button" class="chip" data-fstatus="all" aria-pressed="${filterStatus === "all"}">Semua</button>
        <button type="button" class="chip" data-fstatus="unknown" aria-pressed="${filterStatus === "unknown"}">Belum Hafal</button>
        <button type="button" class="chip" data-fstatus="known" aria-pressed="${filterStatus === "known"}">Sudah Hafal</button>
        <button type="button" class="chip" data-fstatus="bookmarked" aria-pressed="${filterStatus === "bookmarked"}">Ditandai</button>
        ${availablePos
          .map(
            (p) =>
              `<button type="button" class="chip" data-fpos="${esc(p)}" aria-pressed="${filterPos === p}">${esc(p)}</button>`
          )
          .join("")}
      </div>

      ${renderWordsCollection(filtered, true)}
      <h2 class="section-heading">Bagian Akhir Chapter (コミュニケーション & これも覚えよう！)</h2>
      ${(BOOK.bonus || []).map((col) => renderBonusSectionHtml(col, true)).join("")}
      ${renderChapterMenuBar(null)}
    `;

    document.querySelectorAll("[data-fstatus]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterStatus = btn.dataset.fstatus;
        renderAllWords();
      })
    );

    document.querySelectorAll("[data-fpos]").forEach((btn) =>
      btn.addEventListener("click", () => {
        filterPos = filterPos === btn.dataset.fpos ? "all" : btn.dataset.fpos;
        renderAllWords();
      })
    );

    bindWordCardEvents();
  }

  function renderBookmarks() {
    const saved = ALL_ENTRIES.filter((e) => state.bookmarks[e.id]);
    currentEntriesForFC = saved;

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <nav class="breadcrumb"><a href="#home">Beranda</a><span aria-hidden="true">/</span><span>Kata Ditandai</span></nav>
          <h1 class="page-title-jp">Kata Ditandai</h1>
          <p class="page-title-id">${saved.length} kosakata tersimpan untuk diulang.</p>
        </div>
        ${saved.length ? '<button type="button" class="btn btn-primary" id="bm-fc-btn">Uji Kata Ditandai</button>' : ""}
      </div>
      ${
        saved.length
          ? `${renderViewToggleBar(saved.length, saved.length)}${renderWordsCollection(saved, true)}`
          : '<div class="empty-state">Belum ada kata yang ditandai. Klik ikon penanda di pojok kanan kosakata untuk menyimpannya di sini.</div>'
      }
      ${renderChapterMenuBar(null)}
    `;

    document.getElementById("bm-fc-btn")?.addEventListener("click", () => {
      openFlashcards(saved, "Latihan Kata Ditandai");
    });
    bindWordCardEvents();
  }

  function renderSearch(query) {
    const q = query.trim().toLowerCase();
    if (!q) return route();

    const numMatch = q.match(/^#?(\d+)$/);
    let results;
    if (numMatch) {
      const exact = ENTRY_BY_ID.get(Number(numMatch[1]));
      results = exact ? [exact] : ALL_ENTRIES.filter((e) => String(e.id).includes(numMatch[1]));
    } else {
      results = ALL_ENTRIES.filter((e) => e.plainSearch.includes(q));
    }

    const capped = results.slice(0, 120);
    currentEntriesForFC = capped;

    // Also search end-of-chapter bonus columns
    const matchedBonus = (BOOK.bonus || []).filter((col) => {
      const colText = JSON.stringify(col).toLowerCase();
      return colText.includes(q);
    });

    document.getElementById("view-container").innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title-jp">Hasil Pencarian</h1>
          <p class="page-title-id">Ditemukan ${results.length.toLocaleString("id-ID")} kosakata utama${
            matchedBonus.length ? ` dan ${matchedBonus.length} bagian akhir Chapter` : ""
          } untuk "${esc(query.trim())}".</p>
        </div>
        <button type="button" class="btn btn-secondary" id="btn-exit-search">Kembali</button>
      </div>
      ${
        capped.length
          ? `${renderViewToggleBar(capped.length, results.length)}${renderWordsCollection(capped, true)}`
          : !matchedBonus.length
          ? '<div class="empty-state">Tidak ada kosakata yang cocok. Coba kata kunci lain, hiragana, atau nomor entri (mis. 120).</div>'
          : ""
      }
      ${matchedBonus.map((col) => renderBonusSectionHtml(col, true)).join("")}
    `;

    document.getElementById("btn-exit-search")?.addEventListener("click", clearSearch);
    bindWordCardEvents();
  }

  // Interactive card events
  function bindWordCardEvents() {
    document.querySelectorAll(".btn-speak-word").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const e = ENTRY_BY_ID.get(Number(btn.dataset.id));
        if (e) speakJp(e.reading || e.word);
      })
    );

    document.querySelectorAll(".btn-speak-raw").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (btn.dataset.jp) speakJp(btn.dataset.jp);
      })
    );

    document.querySelectorAll(".btn-speak-ex").forEach((btn) =>
      btn.addEventListener("click", () => {
        const e = ENTRY_BY_ID.get(Number(btn.dataset.id));
        const ex = e?.examples?.[Number(btn.dataset.ex)];
        if (ex) speakJp(ex.jp);
      })
    );

    document.querySelectorAll(".btn-known").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = Number(btn.dataset.id);
        if (state.known[id]) delete state.known[id];
        else state.known[id] = 1;
        saveState();
        updateProgressUI();
        const card = btn.closest(".word-card, .word-row-item");
        const on = !!state.known[id];
        card?.classList.toggle("is-known", on);
        btn.classList.toggle("is-known", on);
        btn.setAttribute("aria-pressed", String(on));
      })
    );

    document.querySelectorAll(".btn-bookmark").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const id = Number(btn.dataset.id);
        if (state.bookmarks[id]) delete state.bookmarks[id];
        else state.bookmarks[id] = 1;
        saveState();
        updateProgressUI();
        const card = btn.closest(".word-card, .word-row-item");
        const on = !!state.bookmarks[id];
        card?.classList.toggle("is-bookmarked", on);
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", String(on));
        const svg = btn.querySelector("svg");
        if (svg) svg.setAttribute("fill", on ? "currentColor" : "none");
      })
    );

    document.querySelectorAll(".word-row-main").forEach((rowMain) => {
      const toggleRow = (ev) => {
        if (ev.target.closest(".btn-speak-word, .btn-bookmark, .btn-known, a")) return;
        if (state.maskOn && ev.target.closest(".maskable")) return;
        const item = rowMain.closest(".word-row-item");
        const open = item.classList.toggle("is-expanded");
        rowMain.setAttribute("aria-expanded", String(open));
      };
      rowMain.addEventListener("click", toggleRow);
      rowMain.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          toggleRow(ev);
        }
      });
    });

    document.getElementById("btn-toggle-expand-all")?.addEventListener("click", (ev) => {
      expandAllRows = !expandAllRows;
      const tbl = document.querySelector(".word-list-table");
      tbl?.classList.toggle("expand-all", expandAllRows);
      ev.currentTarget.setAttribute("aria-pressed", String(expandAllRows));
      ev.currentTarget.textContent = expandAllRows ? "Tutup Contoh" : "Buka Contoh";
    });

    document.querySelectorAll("#view-container [data-set-view]").forEach((btn) =>
      btn.addEventListener("click", () => setViewMode(btn.dataset.setView))
    );

    document.querySelectorAll(".maskable").forEach((el) => {
      const toggle = () => {
        if (!state.maskOn) return;
        el.classList.toggle("mask-revealed");
      };
      el.addEventListener("click", toggle);
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          if (!state.maskOn) return;
          ev.preventDefault();
          toggle();
        }
      });
    });
  }

  // Flashcards
  const fcModal = document.getElementById("flashcard-modal");

  function openFlashcards(entries, title) {
    if (!entries || !entries.length) {
      showToast("Tidak ada kosakata untuk latihan kartu kilat.");
      return;
    }
    fcList = [...entries];
    fcIdx = 0;
    fcRevealed = false;
    document.getElementById("fc-title").textContent = title || "Latihan Kartu Kilat";
    renderFlashcard();
    fcModal.showModal();
  }

  function renderFlashcard() {
    const e = fcList[fcIdx];
    if (!e) return;
    document.getElementById("fc-subtitle").textContent = `${fcIdx + 1} / ${fcList.length}`;
    document.getElementById("fc-num").textContent = `#${String(e.id).padStart(4, "0")}`;
    document.getElementById("fc-pos").innerHTML = (e.pos || [])
      .map((p) => `<span class="pos-tag">${esc(p)}</span>`)
      .join("");
    document.getElementById("fc-front").innerHTML = `
      <div class="fc-front-word">${esc(e.word)}</div>
      <div class="fc-front-read">${state.furigana ? esc(e.reading || "") : ""}</div>
    `;
    const ex = e.examples?.[0];
    document.getElementById("fc-back").innerHTML = `
      <div class="fc-back-mean">${esc(e.meaning_id)}</div>
      ${ex ? `<div class="example-jp">${renderJpMarkup(ex.jp)}</div><div class="example-id">${esc(ex.id)}</div>` : ""}
      ${e.note_id ? `<div class="note-box" style="margin-top:8px"><span>${esc(e.note_id)}</span></div>` : ""}
    `;
    document.getElementById("fc-back").hidden = !fcRevealed;
    document.getElementById("fc-hint").hidden = fcRevealed;
  }

  function fcStep(delta) {
    fcIdx = (fcIdx + delta + fcList.length) % fcList.length;
    fcRevealed = false;
    renderFlashcard();
  }

  // Router
  function route() {
    const rawHash = (location.hash || "#home").slice(1);
    const [path, qs] = rawHash.split("?");
    const params = new URLSearchParams(qs || "");
    const focusW = params.get("w");

    filterStatus = "all";
    filterPos = "all";
    closeSidebar();

    if (path === "home" || path === "") {
      highlightNav("home");
      renderHome();
    } else if (path === "all") {
      highlightNav("all");
      state.lastRoute = "all";
      saveState();
      renderAllWords();
    } else if (path === "index") {
      highlightNav("index");
      renderIndex();
    } else if (path === "bookmarks") {
      highlightNav("bookmarks");
      renderBookmarks();
    } else if (path.startsWith("bonus-")) {
      const colId = path.slice(6);
      highlightNav(path);
      state.lastRoute = path;
      saveState();
      renderBonus(colId);
    } else if (/^ch(\d+)$/.test(path)) {
      const chNum = Number(path.slice(2));
      highlightNav(path);
      state.lastRoute = path;
      saveState();
      renderChapter(chNum, focusW ? Number(focusW) : null);
    } else if (/^ch\d+-s\d+$/.test(path)) {
      highlightNav(path);
      state.lastRoute = path;
      saveState();
      renderSection(path, focusW ? Number(focusW) : null);
    } else {
      highlightNav("home");
      renderHome();
    }

    if (!focusW) window.scrollTo({ top: 0, behavior: "instant" });
  }

  // Mobile Sidebar
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const menuBtn = document.getElementById("btn-menu");

  function openSidebar() {
    sidebar.classList.add("open");
    backdrop.hidden = false;
    menuBtn.setAttribute("aria-expanded", "true");
  }

  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.hidden = true;
    menuBtn.setAttribute("aria-expanded", "false");
  }

  // Search handling
  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("btn-clear-search");

  function clearSearch() {
    searchInput.value = "";
    clearSearchBtn.hidden = true;
    route();
  }

  searchInput.addEventListener("input", () => {
    const val = searchInput.value;
    clearSearchBtn.hidden = !val;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (val.trim()) renderSearch(val);
      else route();
    }, 120);
  });

  clearSearchBtn.addEventListener("click", clearSearch);

  // Topbar Buttons
  menuBtn.addEventListener("click", () => {
    if (sidebar.classList.contains("open")) closeSidebar();
    else openSidebar();
  });
  document.getElementById("btn-close-sidebar").addEventListener("click", closeSidebar);
  backdrop.addEventListener("click", closeSidebar);

  document.getElementById("btn-furigana").addEventListener("click", () => {
    state.furigana = !state.furigana;
    saveState();
    applyPrefs();
    showToast(state.furigana ? "Furigana ditampilkan" : "Furigana disembunyikan");
  });

  document.getElementById("btn-mask").addEventListener("click", () => {
    state.maskOn = !state.maskOn;
    saveState();
    applyPrefs();
    document.querySelectorAll(".mask-revealed").forEach((el) => el.classList.remove("mask-revealed"));
    showToast(state.maskOn ? "Mode uji hafalan aktif (klik bagian tertutup untuk intip)" : "Mode uji hafalan mati");
  });

  document.getElementById("btn-flashcard").addEventListener("click", () => {
    const list = currentEntriesForFC.length ? currentEntriesForFC : ALL_ENTRIES.slice(0, 30);
    openFlashcards(list, "Latihan Kartu Kilat");
  });

  // Settings modal
  const settingsModal = document.getElementById("settings-modal");
  document.getElementById("btn-settings").addEventListener("click", () => settingsModal.showModal());
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsModal.close());
  settingsModal.addEventListener("click", (ev) => {
    if (ev.target === settingsModal) settingsModal.close();
  });

  function setViewMode(mode) {
    state.viewMode = mode === "card" ? "card" : "list";
    saveState();
    applyPrefs();
    const curHash = (location.hash || "#home").slice(1).split("?")[0];
    if (searchInput.value.trim()) {
      renderSearch(searchInput.value);
    } else if (curHash === "home" || curHash === "") {
      const target = state.lastRoute && state.lastRoute !== "home" ? state.lastRoute : "ch1";
      location.hash = `#${target}`;
    } else {
      route();
    }
    showToast(state.viewMode === "list" ? "Mode List" : "Mode Kartu");
  }

  document.querySelectorAll("[data-set-view]").forEach((btn) =>
    btn.addEventListener("click", () => setViewMode(btn.dataset.setView))
  );

  document.querySelectorAll("[data-set-theme]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.theme = btn.dataset.setTheme;
      saveState();
      applyPrefs();
      const names = { light: "Mode Light", sepia: "Mode Paper", dark: "Mode Dark" };
      showToast(names[state.theme] || "Mode diperbarui");
    })
  );

  document.querySelectorAll("[data-set-scale]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.scale = btn.dataset.setScale;
      saveState();
      applyPrefs();
    })
  );

  document.querySelectorAll("[data-set-maskmode]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.maskMode = btn.dataset.setMaskmode;
      saveState();
      applyPrefs();
    })
  );

  document.getElementById("btn-print").addEventListener("click", () => {
    settingsModal.close();
    window.print();
  });

  document.getElementById("btn-export-progress").addEventListener("click", () => {
    const payload = JSON.stringify({ known: state.known, bookmarks: state.bookmarks, exportedAt: new Date().toISOString() }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "progres-n3-tango-2000.json";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("File progres berhasil diunduh.");
  });

  document.getElementById("import-progress-file").addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        state.known = data.known || {};
        state.bookmarks = data.bookmarks || {};
        saveState();
        updateProgressUI();
        route();
        showToast("Progres berhasil dipulihkan.");
      } catch {
        showToast("Format file JSON tidak valid.");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  document.getElementById("btn-reset-progress").addEventListener("click", () => {
    if (!confirm("Hapus semua progres hafalan dan kata ditandai di browser ini?")) return;
    state.known = {};
    state.bookmarks = {};
    saveState();
    updateProgressUI();
    route();
    settingsModal.close();
    showToast("Progres belajar sudah direset.");
  });

  // Flashcard modal controls
  document.getElementById("btn-close-fc").addEventListener("click", () => fcModal.close());
  fcModal.addEventListener("click", (ev) => {
    if (ev.target === fcModal) fcModal.close();
  });
  document.getElementById("fc-card").addEventListener("click", (ev) => {
    if (ev.target.closest("#fc-speak")) return;
    fcRevealed = !fcRevealed;
    renderFlashcard();
  });
  document.getElementById("fc-speak").addEventListener("click", () => {
    const e = fcList[fcIdx];
    if (e) speakJp(e.reading || e.word);
  });
  document.getElementById("fc-prev").addEventListener("click", () => fcStep(-1));
  document.getElementById("fc-next").addEventListener("click", () => fcStep(1));
  document.getElementById("fc-mark-known").addEventListener("click", () => {
    const e = fcList[fcIdx];
    if (e) {
      state.known[e.id] = 1;
      saveState();
      updateProgressUI();
    }
    fcStep(1);
  });
  document.getElementById("fc-mark-unknown").addEventListener("click", () => {
    const e = fcList[fcIdx];
    if (e) {
      delete state.known[e.id];
      state.bookmarks[e.id] = 1;
      saveState();
      updateProgressUI();
    }
    fcStep(1);
  });

  // Content Protection (Disable right-click, copy, cut, drag, text selection, inspect shortcuts)
  document.addEventListener("contextmenu", (ev) => ev.preventDefault());
  document.addEventListener("copy", (ev) => ev.preventDefault());
  document.addEventListener("cut", (ev) => ev.preventDefault());
  document.addEventListener("dragstart", (ev) => ev.preventDefault());
  document.addEventListener("selectstart", (ev) => {
    const tag = ev.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    ev.preventDefault();
  });

  // Keyboard Shortcuts & Protection
  document.addEventListener("keydown", (ev) => {
    const tag = ev.target?.tagName;
    const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    const keyLower = (ev.key || "").toLowerCase();

    if (
      ev.key === "F12" ||
      ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && ["i", "j", "c"].includes(keyLower)) ||
      ((ev.ctrlKey || ev.metaKey) && ["u", "s", "c", "x"].includes(keyLower)) ||
      ((ev.ctrlKey || ev.metaKey) && keyLower === "a" && !inInput)
    ) {
      ev.preventDefault();
      return;
    }

    if (fcModal.open) {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        fcRevealed = !fcRevealed;
        renderFlashcard();
      } else if (ev.key === "ArrowRight") fcStep(1);
      else if (ev.key === "ArrowLeft") fcStep(-1);
      return;
    }

    if (ev.key === "/" && !inInput) {
      ev.preventDefault();
      searchInput.focus();
      return;
    }
    if (ev.key === "Escape") {
      if (searchInput.value) clearSearch();
      closeSidebar();
      return;
    }
    if (inInput || ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const k = ev.key.toLowerCase();
    if (k === "f") document.getElementById("btn-furigana").click();
    else if (k === "m") document.getElementById("btn-mask").click();
    else if (k === "l") setViewMode(state.viewMode === "list" ? "card" : "list");
    else if (k === "[" || k === "]") {
      const cur = (location.hash || "").slice(1).split("?")[0];
      const chOnly = cur.match(/^ch(\d+)$/);
      if (chOnly) {
        const nextCh = k === "]" ? Number(chOnly[1]) + 1 : Number(chOnly[1]) - 1;
        if (nextCh >= 1 && nextCh <= 12) location.hash = `ch${nextCh}`;
        return;
      }
      const idx = FLAT_SECTIONS.findIndex((s) => s.key === cur);
      if (idx !== -1) {
        const nextIdx = k === "]" ? idx + 1 : idx - 1;
        if (FLAT_SECTIONS[nextIdx]) location.hash = FLAT_SECTIONS[nextIdx].key;
      }
    }
  });

  // Init
  buildNavigation();
  applyPrefs();
  updateProgressUI();
  window.addEventListener("hashchange", route);
  route();
})();
