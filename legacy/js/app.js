/* ═══════════════════════════════════════════════
   منطق اصلی اپلیکیشن — مالی من (فاز ۲)
   Supabase + خانواده + اعضا + پیامک بانکی
   ═══════════════════════════════════════════════ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  /* ─────────── دسته‌بندی‌ها ─────────── */

  const CATEGORIES = {
    expense: [
      { id: "food", name: "خورد و خوراک", icon: "i-food" },
      { id: "shopping", name: "خرید", icon: "i-cart" },
      { id: "transport", name: "حمل و نقل", icon: "i-car" },
      { id: "home", name: "خانه", icon: "i-home-i" },
      { id: "health", name: "سلامت", icon: "i-health" },
      { id: "fun", name: "تفریح", icon: "i-fun" },
      { id: "edu", name: "آموزش", icon: "i-edu" },
      { id: "clothing", name: "پوشاک", icon: "i-cloth" },
      { id: "bills", name: "قبض", icon: "i-bill" },
      { id: "other-e", name: "متفرقه", icon: "i-more" },
    ],
    income: [
      { id: "salary", name: "حقوق", icon: "i-salary" },
      { id: "business", name: "کسب‌وکار", icon: "i-briefcase" },
      { id: "gift", name: "هدیه", icon: "i-gift" },
      { id: "other-i", name: "متفرقه", icon: "i-more" },
    ],
  };

  function catById(id) {
    for (const type of ["expense", "income"]) {
      const c = CATEGORIES[type].find((c) => c.id === id);
      if (c) return { ...c, type };
    }
    return { id: "other-e", name: "متفرقه", icon: "i-more", type: "expense" };
  }

  /* ─────────── وضعیت ─────────── */

  const state = {
    page: "auth",
    filter: "all",
    search: "",
    reportJy: 0,
    reportJm: 0,
    editingId: null,
    modalType: "expense",
    modalCat: null,
    memberFilter: "all",

    /* داده‌های دیتابیس */
    family: null /* { id, name, code, budget, currency, dark } */,
    members: [] /* [{ id, name, role }] */,
    memberId: null /* عضو فعال این دستگاه */,
    txs: [] /* ردیف‌های transactions */,

    /* پیامک‌های ثبت‌نشده */
    pendingSms: [],
    pendingIdx: 0,
  };

  /* ─────────── ابزار ─────────── */

  function fmt(n) {
    return Jalali.toFa(Math.round(Math.abs(n)).toLocaleString("en-US"));
  }

  function fmtSigned(n, type) {
    const s = fmt(n);
    return type === "income" ? "+" + s : "−" + s;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2400);
  }

  function esc(s) {
    const map = {
      "&": "&" + "amp;",
      "<": "&" + "lt;",
      ">": "&" + "gt;",
      '"': "&" + "quot;",
      "'": "&" + "#39;",
    };
    return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
  }

  /* تاریخ: ISO میلادی ↔ آرایه جلالی */
  function txDate(t) {
    const [gy, gm, gd] = String(t.date).split("-").map(Number);
    return Jalali.toJalali(gy, gm, gd);
  }

  function toISO(jy, jm, jd) {
    const [gy, gm, gd] = Jalali.toGregorian(jy, jm, jd);
    return (
      gy + "-" + String(gm).padStart(2, "0") + "-" + String(gd).padStart(2, "0")
    );
  }

  function isoFromG(gy, gm, gd) {
    return (
      gy + "-" + String(gm).padStart(2, "0") + "-" + String(gd).padStart(2, "0")
    );
  }

  function memberName(id) {
    const m = state.members.find((x) => x.id === id);
    return m ? m.name : "—";
  }

  function sortedTxs(list) {
    return [...list].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
  }

  /* ─────────── ناوبری ─────────── */

  const MAIN_PAGES = ["dashboard", "transactions", "reports", "settings"];

  function navigate(page) {
    state.page = page;
    $$(".page").forEach((p) =>
      p.classList.toggle("active", p.id === "page-" + page),
    );
    $$(".tab-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.nav === page),
    );

    const isMain = MAIN_PAGES.includes(page);
    $(".tabbar").classList.toggle("hidden", !isMain);
    $("#fab-add").classList.toggle("hidden", !isMain);

    window.scrollTo({ top: 0 });
    if (page === "reports") renderReports();
  }

  /* ─────────── محاسبات ─────────── */

  function visibleTxs() {
    return state.memberFilter === "all"
      ? state.txs
      : state.txs.filter((t) => t.member_id === state.memberFilter);
  }

  function monthTx(jy, jm, list) {
    const src = list || visibleTxs();
    return src.filter((t) => {
      const d = txDate(t);
      return d[0] === jy && d[1] === jm;
    });
  }

  function sumBy(list, type) {
    return list
      .filter((t) => t.type === type)
      .reduce((s, t) => s + +t.amount, 0);
  }

  function totalBalance() {
    return state.txs.reduce(
      (s, t) => s + (t.type === "income" ? +t.amount : -+t.amount),
      0,
    );
  }

  function catBreakdown(list) {
    const map = {};
    for (const t of list) {
      if (t.type !== "expense") continue;
      map[t.category] = (map[t.category] || 0) + +t.amount;
    }
    return Object.entries(map)
      .map(([id, value]) => ({ ...catById(id), value }))
      .sort((a, b) => b.value - a.value);
  }

  /* ─────────── رندر: داشبورد ─────────── */

  function renderDashboard() {
    if (!state.family) return;
    const [jy, jm, jd] = Jalali.today();

    $("#header-date").textContent = Jalali.formatWeekday(jy, jm, jd);

    /* موجودی کل خانواده (همیشه کل — مستقل از فیلتر) */
    const bal = totalBalance();
    $("#total-balance").textContent = (bal < 0 ? "−" : "") + fmt(bal);
    $("#balance-sub").textContent = state.family.currency;

    /* درآمد/هزینه ماه (با فیلتر عضو) */
    const mtx = monthTx(jy, jm);
    $("#mini-income").textContent = fmt(sumBy(mtx, "income"));
    $("#mini-expense").textContent = fmt(sumBy(mtx, "expense"));

    /* نمودار حلقه‌ای */
    $("#chart-month-badge").textContent = Jalali.formatMonth(jy, jm);
    const cats = catBreakdown(mtx);
    const palette = Charts.themeColors().palette;
    const donutData = cats.slice(0, 8).map((c, i) => ({
      label: c.name,
      value: c.value,
      color: palette[i % palette.length],
    }));
    Charts.donut($("#donut-chart"), donutData);

    const totalExp = sumBy(mtx, "expense");
    $("#donut-total").textContent = fmt(totalExp);

    /* لجند */
    $("#donut-legend").innerHTML = donutData.length
      ? donutData
          .map(
            (d, i) => `
      <div class="legend-item">
        <span class="mini-dot" style="background:${d.color}"></span>
        <span>${esc(d.label)}</span>
        <b>${fmt(d.value)}</b>
        <span class="pct">${Jalali.toFa(totalExp ? Math.round((d.value / totalExp) * 100) : 0)}٪</span>
      </div>
    `,
          )
          .join("")
      : `<div class="legend-item"><span>هنوز هزینه‌ای ثبت نشده</span></div>`;

    /* تراکنش‌های اخیر */
    const recent = sortedTxs(visibleTxs()).slice(0, 5);
    $("#recent-list").innerHTML = recent.length
      ? recent.map(txRow).join("")
      : emptyRow("هنوز تراکنشی ثبت نشده", "برای شروع، دکمه سبز پایین را بزنید");

    bindTxRows($("#recent-list"));
  }

  function emptyRow(title, sub) {
    return `
      <div class="empty-state" style="padding:24px 8px">
        <p>${esc(title)}</p>
        ${sub ? `<p style="font-size:11.5px;margin-top:4px">${esc(sub)}</p>` : ""}
      </div>`;
  }

  function txRow(t) {
    const cat = catById(t.category);
    const d = txDate(t);
    return `
      <div class="tx-item" data-id="${t.id}">
        <div class="tx-icon ${t.type}">
          <svg><use href="#${cat.icon}"/></svg>
        </div>
        <div class="tx-info">
          <h4>${esc(t.note || cat.name)}</h4>
          <p>${esc(cat.name)} · ${esc(memberName(t.member_id))} · ${Jalali.formatISO(...d)}</p>
        </div>
        <div class="tx-amount ${t.type}">
          <b>${fmtSigned(+t.amount, t.type)}</b>
          <span>${state.family.currency}</span>
        </div>
      </div>`;
  }

  function bindTxRows(container) {
    container.querySelectorAll(".tx-item").forEach((el) => {
      el.addEventListener("click", () => openModal(el.dataset.id));
    });
  }

  /* ─────────── فیلتر عضو (chips) ─────────── */

  function renderMemberChips() {
    const chips = [{ id: "all", name: "همه" }, ...state.members];
    $("#member-chips").innerHTML = chips
      .map(
        (c) => `
      <button class="chip ${state.memberFilter === c.id ? "active" : ""}" data-chip="${c.id}">
        ${esc(c.name)}
      </button>`,
      )
      .join("");

    $$("#member-chips .chip").forEach((b) => {
      b.addEventListener("click", () => {
        state.memberFilter = b.dataset.chip;
        renderMemberChips();
        renderDashboard();
        renderTransactions();
      });
    });
  }

  /* ─────────── رندر: تراکنش‌ها ─────────── */

  function renderTransactions() {
    if (!state.family) return;
    const q = state.search.trim();
    let list = sortedTxs(visibleTxs());

    if (state.filter !== "all")
      list = list.filter((t) => t.type === state.filter);
    if (q) {
      list = list.filter((t) => {
        const cat = catById(t.category).name;
        const hay =
          (t.note || "") +
          " " +
          cat +
          " " +
          memberName(t.member_id) +
          " " +
          fmt(t.amount) +
          " " +
          Jalali.formatISO(...txDate(t));
        return hay.includes(q);
      });
    }

    const listEl = $("#tx-list");
    const emptyEl = $("#tx-empty");

    if (!list.length) {
      listEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");

    /* گروه‌بندی بر اساس تاریخ */
    const groups = new Map();
    for (const t of list) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date).push(t);
    }

    listEl.innerHTML = [...groups.entries()]
      .map(([key, items]) => {
        const d = txDate({ date: key });
        const dayExp = sumBy(items, "expense");
        const dayInc = sumBy(items, "income");
        const sums = [];
        if (dayInc)
          sums.push(`<span style="color:var(--income)">+${fmt(dayInc)}</span>`);
        if (dayExp)
          sums.push(
            `<span style="color:var(--expense)">−${fmt(dayExp)}</span>`,
          );
        return `
        <div class="tx-group-title">
          ${Jalali.formatWeekday(...d)}
          <span class="day-sum">· ${sums.join(" · ")}</span>
        </div>
        <div class="tx-list">${items.map(txRow).join("")}</div>`;
      })
      .join("");

    bindTxRows(listEl);
  }

  /* ─────────── رندر: گزارش‌ها ─────────── */

  function renderReports() {
    if (!state.family) return;
    if (!state.reportJy) {
      const [jy, jm] = Jalali.today();
      state.reportJy = jy;
      state.reportJm = jm;
    }
    const { reportJy: jy, reportJm: jm } = state;

    $("#month-label").textContent = Jalali.formatMonth(jy, jm);
    const mtx = monthTx(jy, jm);

    /* ستونی روزانه */
    const dayMap = {};
    for (const t of mtx) {
      if (t.type !== "expense") continue;
      const d = txDate(t);
      dayMap[d[2]] = (dayMap[d[2]] || 0) + +t.amount;
    }
    const days = Object.entries(dayMap)
      .map(([d, v]) => ({ label: Jalali.toFa(+d), value: v }))
      .sort((a, b) => Jalali.toEn(a.label) - Jalali.toEn(b.label));
    Charts.bars(
      $("#bar-chart"),
      days.length ? days : [{ label: "—", value: 0 }],
    );

    /* خطی ۶ ماه */
    const labels = [],
      inc = [],
      exp = [];
    let [py, pm] = [jy, jm];
    for (let i = 0; i < 6; i++) {
      const m = monthTx(py, pm);
      labels.unshift(Jalali.MONTHS[pm - 1].slice(0, 3));
      inc.unshift(sumBy(m, "income"));
      exp.unshift(sumBy(m, "expense"));
      [py, pm] = Jalali.prevMonth(py, pm);
    }
    const C = Charts.themeColors();
    Charts.line($("#line-chart"), labels, [
      { values: inc, color: C.income, kind: "income" },
      { values: exp, color: C.expense, kind: "expense" },
    ]);

    /* دسته‌بندی */
    const cats = catBreakdown(mtx);
    const totalExp = sumBy(mtx, "expense");
    $("#cat-report").innerHTML = cats.length
      ? cats
          .map((c, i) => {
            const color = C.palette[i % C.palette.length];
            const pct = totalExp ? Math.round((c.value / totalExp) * 100) : 0;
            return `
        <div class="cat-row">
          <div class="cat-row-top">
            <span class="mini-dot" style="background:${color}"></span>
            <span>${esc(c.name)}</span>
            <b>${fmt(c.value)}</b>
            <span class="pct">${Jalali.toFa(pct)}٪</span>
          </div>
          <div class="cat-bar">
            <div class="cat-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>`;
          })
          .join("")
      : `<p style="font-size:13px;color:var(--text-3);text-align:center;padding:16px 0">هزینه‌ای در این ماه ثبت نشده</p>`;
  }

  /* ─────────── رندر: تنظیمات ─────────── */

  function renderSettings() {
    if (!state.family) return;
    $("#family-code-badge").textContent = "کد: " + (state.family.code || "—");

    $("#settings-members").innerHTML = state.members
      .map(
        (m) => `
      <div class="settings-member">
        <span class="member-avatar">${esc(m.name.charAt(0))}</span>
        <div>
          <h5>${esc(m.name)}</h5>
          <p>${m.role === "owner" ? "مدیر خانواده" : "عضو"}</p>
        </div>
      </div>`,
      )
      .join("");

    $("#budget-input").value = state.family.budget
      ? fmt(state.family.budget)
      : "";
    $("#dark-toggle").checked = state.family.dark;
    $("#currency-select").value = state.family.currency;
    updateBudgetBar();
  }

  function updateBudgetBar() {
    const [jy, jm] = Jalali.today();
    const exp = sumBy(monthTx(jy, jm), "expense");
    const fill = $("#budget-fill");
    const pctEl = $("#budget-percent");
    const budget = +state.family.budget;

    if (!budget) {
      fill.style.width = "0%";
      fill.className = "bp-fill";
      pctEl.textContent = "بدون بودجه";
      return;
    }
    const pct = Math.min(Math.round((exp / budget) * 100), 999);
    fill.style.width = Math.min(pct, 100) + "%";
    fill.className =
      "bp-fill" + (pct > 100 ? " over" : pct > 80 ? " warn" : "");
    pctEl.textContent = Jalali.toFa(pct) + "٪";
  }

  /* ─────────── مودال تراکنش ─────────── */

  function buildCatGrid() {
    const grid = $("#cat-grid");
    const render = () => {
      const cats = CATEGORIES[state.modalType];
      grid.innerHTML = cats
        .map(
          (c) => `
        <button class="cat-cell ${state.modalCat === c.id ? "active" : ""}" data-cat="${c.id}">
          <svg><use href="#${c.icon}"/></svg>
          <span>${esc(c.name)}</span>
        </button>`,
        )
        .join("");
      grid.querySelectorAll(".cat-cell").forEach((b) => {
        b.addEventListener("click", () => {
          state.modalCat = b.dataset.cat;
          render();
        });
      });
    };
    render();
  }

  function openModal(editId = null) {
    state.editingId = editId;
    const overlay = $("#modal-tx");

    /* گزینه‌های عضو */
    const selMember = editId
      ? state.txs.find((x) => x.id === editId)?.member_id
      : state.memberId;
    $("#input-member").innerHTML = state.members
      .map(
        (m) =>
          `<option value="${m.id}" ${m.id === selMember ? "selected" : ""}>${esc(m.name)}</option>`,
      )
      .join("");

    if (editId) {
      const t = state.txs.find((x) => x.id === editId);
      if (!t) return;
      $("#modal-title").textContent = "ویرایش تراکنش";
      state.modalType = t.type;
      state.modalCat = t.category;
      $("#input-amount").value = fmt(+t.amount);
      $("#input-date").value = Jalali.formatISO(...txDate(t));
      $("#input-note").value = t.note || "";
      $("#btn-delete-tx").classList.remove("hidden");
    } else {
      $("#modal-title").textContent = "تراکنش جدید";
      state.modalType = "expense";
      state.modalCat = "food";
      $("#input-amount").value = "";
      $("#input-date").value = Jalali.formatISO(...Jalali.today());
      $("#input-note").value = "";
      $("#btn-delete-tx").classList.add("hidden");
    }

    /* سگمنت نوع */
    $$("#tx-type .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === state.modalType),
    );

    buildCatGrid();
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    $("#modal-tx").classList.add("hidden");
    document.body.style.overflow = "";
    state.editingId = null;
  }

  async function saveModal() {
    /* مبلغ */
    const amountRaw = Jalali.toEn($("#input-amount").value).replace(
      /[^\d]/g,
      "",
    );
    const amount = +amountRaw;
    if (!amount || amount <= 0) {
      toast("لطفاً مبلغ معتبر وارد کنید");
      $("#input-amount").focus();
      return;
    }

    /* تاریخ */
    const parsed = Jalali.parse($("#input-date").value) || Jalali.today();
    const memberId = $("#input-member").value || state.memberId;

    const tx = {
      type: state.modalType,
      amount,
      category: state.modalCat,
      date: toISO(...parsed),
      note: $("#input-note").value.trim(),
    };

    try {
      if (state.editingId) {
        await DB.updateTx(state.editingId, { ...tx, member_id: memberId });
        toast("تراکنش ویرایش شد");
      } else {
        await DB.addTx(state.family.id, memberId, tx);
        toast("تراکنش ثبت شد");
      }
      closeModal();
      await refreshData();
      renderAll();
    } catch (e) {
      toast(e.message || "خطا در ذخیره");
    }
  }

  async function deleteTxById(id) {
    if (!confirm("این تراکنش حذف شود؟")) return;
    try {
      await DB.deleteTx(id);
      closeModal();
      await refreshData();
      renderAll();
      toast("تراکنش حذف شد");
    } catch (e) {
      toast(e.message || "خطا در حذف");
    }
  }

  /* ─────────── مودال ورود پیامک ─────────── */

  function openSmsModal() {
    $("#sms-input").value = "";
    $("#sms-preview").innerHTML = "";
    $("#modal-sms").classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function closeSmsModal() {
    $("#modal-sms").classList.add("hidden");
    document.body.style.overflow = "";
  }

  function renderSmsPreview() {
    const raw = $("#sms-input").value.trim();
    const box = $("#sms-preview");
    if (!raw) {
      box.innerHTML = "";
      return;
    }

    const blocks = raw
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    box.innerHTML = blocks
      .map((b) => {
        const p = SmsParser.parse(b);
        if (!p || !p.type || !p.amount) {
          return `<div class="sms-preview-item"><span>نامشخص</span><b>تشخیص داده نشد</b></div>`;
        }
        const typeFa = p.type === "income" ? "واریز" : "برداشت";
        const dateFa = p.date
          ? Jalali.formatISO(...p.date.jalali)
          : "بدون تاریخ";
        return `
          <div class="sms-preview-item">
            <span>${esc(p.bank || "بانک ناشناس")}</span>
            <b class="${p.type}">${typeFa} · ${fmt(p.amount)}</b>
            <span>${esc(dateFa)}</span>
          </div>`;
      })
      .join("");
  }

  async function saveSmsImport() {
    const raw = $("#sms-input").value.trim();
    if (!raw) {
      toast("متنی وارد نشده است");
      return;
    }

    const blocks = raw
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    let added = 0;
    try {
      const items = [];
      for (const b of blocks) {
        const p = SmsParser.parse(b);
        if (!p) continue;
        items.push({
          rawText: b,
          bank: p.bank,
          type: p.type,
          amount: p.amount,
          balance: p.balance,
          date: p.date ? isoFromG(p.date.gy, p.date.gm, p.date.gd) : null,
        });
      }
      if (items.length) added = (await DB.addSmsBatch(items)) || 0;
    } catch (e) {
      toast(e.message || "خطا در ذخیره پیامک‌ها");
      return;
    }

    closeSmsModal();
    toast(Jalali.toFa(added) + " پیامک اضافه شد");

    if (added > 0) await checkPendingSms();
  }

  /* ─────────── مودال پیامک‌های ثبت‌نشده ─────────── */

  async function checkPendingSms() {
    try {
      const pending = await DB.getSms(state.family.id, "pending");
      if (!pending.length) return;
      state.pendingSms = pending;
      state.pendingIdx = 0;
      renderPendingSms();
      $("#modal-pending").classList.remove("hidden");
      document.body.style.overflow = "hidden";
    } catch {
      /* بی‌صدا رد شو */
    }
  }

  function closePendingModal() {
    $("#modal-pending").classList.add("hidden");
    document.body.style.overflow = "";
  }

  function guessPendingDefaults(sms) {
    const p = SmsParser.parse(sms.raw_text || "");
    const type = sms.type || p?.type || "expense";
    let cat = p?.category;
    if (!cat || !CATEGORIES[type].find((c) => c.id === cat)) {
      cat = CATEGORIES[type][0].id;
    }
    return { type, cat };
  }

  function renderPendingSms() {
    const list = state.pendingSms;
    const idx = state.pendingIdx;

    if (idx >= list.length) {
      closePendingModal();
      toast("همه پیامک‌ها رسیدگی شدند");
      return;
    }

    const sms = list[idx];
    $("#pending-count").textContent =
      Jalali.toFa(idx + 1) + " از " + Jalali.toFa(list.length);

    const { type, cat } = guessPendingDefaults(sms);
    const dateJ = sms.date ? txDate({ date: sms.date }) : Jalali.today();

    $("#pending-body").innerHTML = `
      <div class="pending-progress">
        <div class="pending-progress-fill" style="width:${((idx + 1) / list.length) * 100}%"></div>
      </div>
      <div class="pending-card">
        <div class="pending-raw">${esc(sms.raw_text)}</div>
        <div class="pending-fields">
          <div class="form-row">
            <label for="psms-type">نوع تراکنش</label>
            <select id="psms-type" class="select-input">
              <option value="expense" ${type === "expense" ? "selected" : ""}>هزینه</option>
              <option value="income" ${type === "income" ? "selected" : ""}>درآمد</option>
            </select>
          </div>
          <div class="form-row">
            <label for="psms-amount">مبلغ (${esc(state.family.currency)})</label>
            <input type="text" id="psms-amount" class="num-input" inputmode="numeric"
              value="${sms.amount ? fmt(+sms.amount) : ""}" placeholder="۰" />
          </div>
          <div class="form-row">
            <label for="psms-cat">دسته‌بندی</label>
            <select id="psms-cat" class="select-input">
              ${CATEGORIES[type]
                .map(
                  (c) =>
                    `<option value="${c.id}" ${c.id === cat ? "selected" : ""}>${esc(c.name)}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="form-row">
            <label for="psms-member">عضو</label>
            <select id="psms-member" class="select-input">
              ${state.members
                .map(
                  (m) =>
                    `<option value="${m.id}" ${m.id === (sms.member_id || state.memberId) ? "selected" : ""}>${esc(m.name)}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="form-row">
            <label for="psms-date">تاریخ</label>
            <input type="text" id="psms-date" class="text-input" inputmode="numeric"
              value="${Jalali.formatISO(...dateJ)}" />
          </div>
        </div>
      </div>`;

    /* فرمت زنده مبلغ */
    $("#psms-amount").addEventListener("input", (e) => {
      const r = Jalali.toEn(e.target.value).replace(/[^\d]/g, "");
      e.target.value = r ? fmt(+r) : "";
    });

    /* فرمت زنده تاریخ */
    $("#psms-date").addEventListener("input", (e) => {
      let v = Jalali.toEn(e.target.value).replace(/[^\d]/g, "");
      if (v.length > 8) v = v.slice(0, 8);
      let out = v;
      if (v.length > 4) out = v.slice(0, 4) + "/" + v.slice(4);
      if (v.length > 6)
        out = v.slice(0, 4) + "/" + v.slice(4, 6) + "/" + v.slice(6);
      e.target.value = Jalali.toFa(out);
    });

    /* تغییر نوع → به‌روزرسانی دسته‌ها */
    $("#psms-type").addEventListener("change", (e) => {
      const t = e.target.value;
      $("#psms-cat").innerHTML = CATEGORIES[t]
        .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
        .join("");
    });
  }

  async function recordPendingSms() {
    const sms = state.pendingSms[state.pendingIdx];
    if (!sms) return;

    const amountRaw = Jalali.toEn($("#psms-amount").value).replace(
      /[^\d]/g,
      "",
    );
    const amount = +amountRaw;
    if (!amount || amount <= 0) {
      toast("لطفاً مبلغ معتبر وارد کنید");
      return;
    }

    const type = $("#psms-type").value;
    const cat = $("#psms-cat").value;
    const memberId = $("#psms-member").value || state.memberId;
    const parsed = Jalali.parse($("#psms-date").value) || Jalali.today();

    const note =
      (sms.bank ? sms.bank + " — " : "پیامک — ") +
      String(sms.raw_text || "").slice(0, 50);

    try {
      await DB.addTx(state.family.id, memberId, {
        type,
        amount,
        category: cat,
        date: toISO(...parsed),
        note,
      });
      await DB.updateSms(sms.id, { status: "recorded" });
      state.pendingIdx++;
      await refreshData();
      renderAll();
      renderPendingSms();
    } catch (e) {
      toast(e.message || "خطا در ثبت پیامک");
    }
  }

  async function ignorePendingSms() {
    const sms = state.pendingSms[state.pendingIdx];
    if (!sms) return;
    try {
      await DB.updateSms(sms.id, { status: "ignored" });
      state.pendingIdx++;
      renderPendingSms();
    } catch (e) {
      toast(e.message || "خطا");
    }
  }

  /* ─────────── احراز هویت ─────────── */

  function showAuth() {
    navigate("auth");
  }

  /* ─────────── ورود / ثبت‌نام (موبایل + رمز + OTP) ─────────── */

  /* وضعیت جریان OTP:
     { mode: 'login' | 'register' | 'invite',
       phone, password, familyName, memberName, inviteToken } */
  let otpFlow = null;

  function showOtpStep(phone) {
    $("#auth-step-1").classList.add("hidden");
    $("#auth-step-2").classList.remove("hidden");
    $("#otp-phone").textContent = Jalali.toFa(phone);
    $("#otp-input").value = "";
    $("#otp-dev-hint").classList.add("hidden");
    setTimeout(() => $("#otp-input").focus(), 100);
  }

  function showAuthStep1() {
    $("#auth-step-2").classList.add("hidden");
    $("#auth-step-1").classList.remove("hidden");
  }

  async function sendOtp(flow) {
    try {
      const r = await DB.requestOtp(flow.phone);
      otpFlow = flow;
      showOtpStep(flow.phone);

      /* حالت توسعه: کد واقعی برمی‌گردد */
      if (r.devCode) {
        const hint = $("#otp-dev-hint");
        hint.textContent = "حالت توسعه — کد تأیید: " + Jalali.toFa(r.devCode);
        hint.classList.remove("hidden");
      } else {
        toast("کد تأیید پیامک شد");
      }
    } catch (e) {
      if (/TOO_SOON/.test(e.message)) {
        toast("لطفاً یک دقیقه صبر کنید و دوباره تلاش کنید");
      } else {
        toast(e.message || "خطا در ارسال کد");
      }
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    const phone = DB.normalizePhone(Jalali.toEn($("#login-phone").value));
    const password = $("#login-password").value;

    if (!phone) {
      toast("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    if (!password) {
      toast("رمز عبور را وارد کنید");
      return;
    }

    try {
      /* مرحله ۱: بررسی شماره + رمز */
      const ok = await DB.checkPassword(phone, password);
      if (!ok) {
        toast("شماره موبایل یا رمز عبور اشتباه است");
        return;
      }
      /* مرحله ۲: ارسال OTP */
      await sendOtp({ mode: "login", phone, password });
    } catch (err) {
      toast(err.message || "خطا در ارتباط با سرور");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const familyName = $("#reg-family").value.trim();
    const memberName = $("#reg-name").value.trim();
    const phone = DB.normalizePhone(Jalali.toEn($("#reg-phone").value));
    const password = $("#reg-password").value;

    if (!familyName || !memberName) {
      toast("نام خانواده و نام شما را وارد کنید");
      return;
    }
    if (!phone) {
      toast("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    if (password.length < 4) {
      toast("رمز عبور حداقل ۴ کاراکتر باشد");
      return;
    }

    await sendOtp({
      mode: "register",
      phone,
      password,
      familyName,
      memberName,
    });
  }

  async function handleOtp(e) {
    e.preventDefault();
    if (!otpFlow) return showAuthStep1();

    const code = Jalali.toEn($("#otp-input").value).replace(/\D/g, "");
    if (code.length !== 6) {
      toast("کد ۶ رقمی را وارد کنید");
      return;
    }

    try {
      if (otpFlow.mode === "login") {
        /* ورود: تأیید OTP → عضو + خانواده */
        const r = await DB.loginWithOtp(otpFlow.phone, code);
        await startSession(r.member, r.family, r.session_token);
      } else if (otpFlow.mode === "register") {
        /* ثبت‌نام: تأیید OTP (سمت سرور) + ساخت خانواده و عضو مدیر */
        const r = await DB.register(
          otpFlow.familyName,
          otpFlow.memberName,
          otpFlow.phone,
          otpFlow.password,
          code,
        );
        toast("خانواده ساخته شد — خوش آمدید");
        await startSession(r.member, r.family, r.session_token);
      } else if (otpFlow.mode === "invite") {
        /* پذیرش دعوت: تأیید OTP (سمت سرور) + عضویت در خانواده */
        const r = await DB.acceptInvite(
          otpFlow.inviteToken,
          otpFlow.memberName,
          otpFlow.phone,
          otpFlow.password,
          code,
        );
        toast("به خانواده خوش آمدید");
        await startSession(r.member, r.family, r.session_token);
      }
      otpFlow = null;
    } catch (err) {
      toast(err.message || "خطا در تأیید کد");
    }
  }

  async function startSession(member, family, token) {
    state.family = family;
    state.memberId = member.id;
    DB.setSession({
      memberId: member.id,
      memberName: member.name,
      familyId: family.id,
      familyName: family.name,
      phone: member.phone,
      role: member.role,
      token,
    });
    await enterApp();
  }

  /* ─────────── دعوت با لینک / QR ─────────── */

  async function handleInvitePage(token) {
    try {
      const inv = await DB.getInvite(token);
      $("#invite-family-name").textContent =
        "شما به خانواده «" + inv.family_name + "» دعوت شده‌اید";
      state.inviteToken = token;
      navigate("invite");
    } catch {
      toast("لینک دعوت نامعتبر یا منقضی شده است");
      navigate("auth");
    }
  }

  async function handleInviteSubmit(e) {
    e.preventDefault();
    const memberName = $("#inv-name").value.trim();
    const phone = DB.normalizePhone(Jalali.toEn($("#inv-phone").value));
    const password = $("#inv-password").value;

    if (!memberName) {
      toast("نام خود را وارد کنید");
      return;
    }
    if (!phone) {
      toast("شماره موبایل معتبر نیست (مثل ۰۹۱۲۳۴۵۶۷۸۹)");
      return;
    }
    if (password.length < 4) {
      toast("رمز عبور حداقل ۴ کاراکتر باشد");
      return;
    }

    await sendOtp({
      mode: "invite",
      phone,
      password,
      memberName,
      inviteToken: state.inviteToken,
    });
  }

  /* ساخت لینک دعوت + نمایش QR */
  async function openInviteModal() {
    try {
      const token = await DB.createInvite();
      const link =
        location.origin +
        location.pathname +
        "?invite=" +
        encodeURIComponent(token);

      $("#invite-link-input").value = link;
      $("#invite-family-badge").textContent = state.family.name;
      drawQr(link);
      $("#modal-invite").classList.remove("hidden");
      document.body.style.overflow = "hidden";
    } catch (e) {
      toast(e.message || "خطا در ساخت لینک دعوت");
    }
  }

  function closeInviteModal() {
    $("#modal-invite").classList.add("hidden");
    document.body.style.overflow = "";
  }

  /* رسم QR روی canvas با کتابخانه qrcode-generator */
  function drawQr(text) {
    const canvas = $("#invite-qr-canvas");
    const size = 220;
    const dpr = window.devicePixelRatio || 1;

    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();

    const count = qr.getModuleCount();
    const cell = Math.floor((size * dpr) / (count + 4)); /* +quiet zone */
    const offset = Math.floor((size * dpr - cell * count) / 2);

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + "px";
    canvas.style.height = size + "px";

    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b0d12";
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
        }
      }
    }
  }

  async function copyInviteLink() {
    const link = $("#invite-link-input").value;
    try {
      await navigator.clipboard.writeText(link);
      toast("لینک کپی شد");
    } catch {
      /* fallback */
      const el = $("#invite-link-input");
      el.select();
      document.execCommand("copy");
      toast("لینک کپی شد");
    }
  }

  async function shareInviteLink() {
    const link = $("#invite-link-input").value;
    const family = state.family?.name || "خانواده";
    if (navigator.share) {
      try {
        await navigator.share({
          title: "دعوت به مالی من",
          text: "به خانواده «" + family + "» در اپ مالی من بپیوندید:",
          url: link,
        });
      } catch {
        /* لغو توسط کاربر */
      }
    } else {
      copyInviteLink();
    }
  }

  /* ─────────── ورود به اپ ─────────── */

  async function refreshData() {
    const [members, txs, settings] = await Promise.all([
      DB.getMembers(state.family.id),
      DB.getTransactions(state.family.id),
      DB.getFamilySettings(state.family.id),
    ]);
    state.members = members;
    state.txs = txs;
    state.family = { ...state.family, ...settings };
    applyTheme();
  }

  async function enterApp() {
    try {
      await refreshData();
    } catch (e) {
      toast(e.message || "خطا در دریافت داده‌ها");
    }
    state.memberFilter = "all";
    navigate("dashboard");
    renderAll();
    await checkPendingSms();
  }

  /* ─────────── خروج ─────────── */

  async function logout() {
    await DB.logout();
    location.reload();
  }

  /* ─────────── خروجی JSON ─────────── */

  function exportJson() {
    const data = {
      app: "personal-finance-pwa",
      version: 2,
      family: state.family?.name,
      exportedAt: new Date().toISOString(),
      members: state.members,
      transactions: state.txs,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      "mali-man-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("فایل پشتیبان دانلود شد");
  }

  /* ─────────── تنظیمات: ذخیره با تأخیر ─────────── */

  let settingsT;
  function saveSettingsSoon() {
    clearTimeout(settingsT);
    settingsT = setTimeout(async () => {
      try {
        await DB.saveFamilySettings(state.family.id, {
          budget: +state.family.budget || 0,
          currency: state.family.currency,
          dark: !!state.family.dark,
        });
      } catch {
        /* بی‌صدا */
      }
    }, 700);
  }

  /* ─────────── تم ─────────── */

  function applyTheme() {
    const dark = state.family ? state.family.dark : true;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#0b0d12" : "#f4f5f8";
  }

  /* ─────────── رندر کلی ─────────── */

  function renderAll() {
    renderMemberChips();
    renderDashboard();
    renderTransactions();
    renderReports();
    renderSettings();
  }

  /* ─────────── رویدادها ─────────── */

  function bindEvents() {
    /* ── احراز هویت ── */
    $$("#auth-mode .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        $$("#auth-mode .seg-btn").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        $("#form-login").classList.toggle("hidden", b.dataset.mode !== "login");
        $("#form-register").classList.toggle(
          "hidden",
          b.dataset.mode !== "register",
        );
      });
    });

    $("#form-login").addEventListener("submit", handleLogin);
    $("#form-register").addEventListener("submit", handleRegister);
    $("#form-otp").addEventListener("submit", handleOtp);
    $("#btn-otp-back").addEventListener("click", showAuthStep1);
    $("#btn-otp-resend").addEventListener("click", () => {
      if (otpFlow) sendOtp(otpFlow);
    });

    /* ── صفحه دعوت ── */
    $("#form-invite").addEventListener("submit", handleInviteSubmit);

    /* ── ناوبری ── */
    $$(".tab-btn, [data-nav]").forEach((b) => {
      b.addEventListener("click", () => navigate(b.dataset.nav));
    });

    /* ── هدر داشبورد ── */
    $("#btn-sms-import").addEventListener("click", openSmsModal);

    /* ── فیلتر تراکنش‌ها ── */
    $$("#tx-filter .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.filter = b.dataset.filter;
        $$("#tx-filter .seg-btn").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        renderTransactions();
      });
    });

    /* ── جستجو ── */
    let searchT;
    $("#tx-search").addEventListener("input", (e) => {
      clearTimeout(searchT);
      searchT = setTimeout(() => {
        state.search = e.target.value;
        renderTransactions();
      }, 200);
    });

    /* ── ماه گزارش ── */
    $("#month-prev").addEventListener("click", () => {
      [state.reportJy, state.reportJm] = Jalali.prevMonth(
        state.reportJy,
        state.reportJm,
      );
      renderReports();
    });
    $("#month-next").addEventListener("click", () => {
      [state.reportJy, state.reportJm] = Jalali.nextMonth(
        state.reportJy,
        state.reportJm,
      );
      renderReports();
    });

    /* ── FAB ── */
    $("#fab-add").addEventListener("click", () => openModal());

    /* ── مودال تراکنش ── */
    $("#btn-cancel-tx").addEventListener("click", closeModal);
    $("#modal-tx").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });
    $("#btn-save-tx").addEventListener("click", saveModal);
    $("#btn-delete-tx").addEventListener("click", () =>
      deleteTxById(state.editingId),
    );

    /* نوع تراکنش در مودال */
    $$("#tx-type .seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.modalType = b.dataset.type;
        state.modalCat = CATEGORIES[b.dataset.type][0].id;
        $$("#tx-type .seg-btn").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        buildCatGrid();
      });
    });

    /* فرمت زنده مبلغ */
    $("#input-amount").addEventListener("input", (e) => {
      const raw = Jalali.toEn(e.target.value).replace(/[^\d]/g, "");
      e.target.value = raw ? fmt(+raw) : "";
    });

    /* فرمت زنده تاریخ */
    $("#input-date").addEventListener("input", (e) => {
      let v = Jalali.toEn(e.target.value).replace(/[^\d]/g, "");
      if (v.length > 8) v = v.slice(0, 8);
      let out = v;
      if (v.length > 4) out = v.slice(0, 4) + "/" + v.slice(4);
      if (v.length > 6)
        out = v.slice(0, 4) + "/" + v.slice(4, 6) + "/" + v.slice(6);
      e.target.value = Jalali.toFa(out);
    });

    /* ── مودال ورود پیامک ── */
    $("#btn-cancel-sms").addEventListener("click", closeSmsModal);
    $("#modal-sms").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSmsModal();
    });
    $("#btn-save-sms").addEventListener("click", saveSmsImport);
    $("#sms-input").addEventListener("input", renderSmsPreview);

    /* ── مودال پیامک‌های ثبت‌نشده ── */
    $("#btn-record-sms").addEventListener("click", recordPendingSms);
    $("#btn-ignore-sms").addEventListener("click", ignorePendingSms);
    $("#btn-skip-sms").addEventListener("click", closePendingModal);
    $("#modal-pending").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closePendingModal();
    });

    /* ── تنظیمات ── */
    $("#budget-input").addEventListener("input", (e) => {
      const raw = Jalali.toEn(e.target.value).replace(/[^\d]/g, "");
      e.target.value = raw ? fmt(+raw) : "";
      state.family.budget = +raw;
      updateBudgetBar();
      saveSettingsSoon();
    });

    $("#dark-toggle").addEventListener("change", (e) => {
      state.family.dark = e.target.checked;
      applyTheme();
      renderAll();
      saveSettingsSoon();
    });

    $("#currency-select").addEventListener("change", (e) => {
      state.family.currency = e.target.value;
      renderAll();
      saveSettingsSoon();
    });

    /* ── دعوت عضو ── */
    $("#btn-invite-link").addEventListener("click", openInviteModal);
    $("#btn-invite-qr").addEventListener("click", openInviteModal);
    $("#btn-close-invite").addEventListener("click", closeInviteModal);
    $("#modal-invite").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeInviteModal();
    });
    $("#btn-copy-invite").addEventListener("click", copyInviteLink);
    $("#btn-share-invite").addEventListener("click", shareInviteLink);

    /* ── خروجی / خروج ── */
    $("#btn-export").addEventListener("click", exportJson);
    $("#btn-export-data").addEventListener("click", exportJson);
    $("#btn-logout-2").addEventListener("click", logout);

    /* ── لغو با Escape ── */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeModal();
        closeSmsModal();
        closePendingModal();
        closeInviteModal();
      }
    });
  }

  /* ─────────── شروع ─────────── */

  async function init() {
    applyTheme();
    bindEvents();

    /* هشدار تنظیم‌نشده بودن Supabase */
    if (
      /YOUR_PROJECT_REF|YOUR_ANON_KEY/.test(
        SUPABASE_CONFIG.url + SUPABASE_CONFIG.anonKey,
      )
    ) {
      toast("ابتدا js/config.js را با اطلاعات Supabase پر کنید");
    }

    /* ثبت Service Worker */
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }

    /* لینک دعوت؟ → صفحه پذیرش دعوت */
    const inviteToken = new URLSearchParams(location.search).get("invite");
    if (inviteToken) {
      await handleInvitePage(inviteToken);
      return;
    }

    /* بررسی نشست (توکن) */
    const session = DB.getSession();
    if (!session || !session.token) {
      if (session) DB.clearSession();
      showAuth();
      return;
    }

    try {
      const r = await DB.validateSession(session.token);
      state.family = r.family;
      state.memberId = r.member.id;
      state.members = r.members;
      await enterApp();
    } catch (e) {
      DB.clearSession();
      if (/منقضی/.test(e.message || "")) {
        toast(e.message);
      } else {
        toast(e.message || "خطا در ارتباط با سرور");
      }
      showAuth();
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
