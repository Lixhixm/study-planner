import "./style.css";

type Task = { id: string; subject: string; text: string; status: number; next?: string; type?: string; score?: number; max?: number; rkey?: string; detail?: string };
type State = {
  exam: string;
  subjects: { id: string; name: string; color: string }[];
  tasks: Record<string, Task[]>; // date -> tasks
  paint: Record<string, string>; // "date|h|c" -> subject id
  dismissed: string[]; // 지운 자동 복습 "date|rkey"
  lastBackup?: string;
  plans: { id: string; subject: string; name: string; start: string; end: string }[];
};

const ic = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const TYPES: Record<string, { name: string; icon: string }> = {
  lecture: { name: "강의", icon: ic('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 3l3 3 3-3"/>') },
  concept: { name: "개념", icon: ic('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 21V5"/>') },
  problem: { name: "문제풀이", icon: ic('<path d="M4 20h4L19 9l-4-4L4 16z"/>') },
  exam: { name: "모의고사", icon: ic('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/>') },
  review: { name: "복습", icon: ic('<path d="M4 12a8 8 0 0114-5l2 2M20 12a8 8 0 01-14 5l-2-2M20 4v5h-5M4 20v-5h5"/>') },
  etc: { name: "기타", icon: ic('<circle cx="12" cy="12" r="2"/>') },
};
const PICK = ["lecture", "concept", "problem", "exam", "etc"]; // review는 자동 생성 전용
const MARKS = ["", "O", "△", "X", "->"];
const KEY = "planner-v1";
const defaults: State = {
  exam: "2026-11-19",
  subjects: [
    { id: "kor", name: "국어", color: "#f08a4b" },
    { id: "math", name: "수학", color: "#2fa8e0" },
    { id: "eng", name: "영어", color: "#5cb85c" },
    { id: "his", name: "한국사", color: "#e07ad1" },
    { id: "sci", name: "통합과학", color: "#6fd0c4" },
    { id: "soc", name: "통합사회", color: "#7fb3e8" },
  ],
  tasks: {},
  paint: {},
  dismissed: [],
  plans: [],
};

let S: State = defaults;
try { S = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { /* 저장소 접근 실패 시 기본값 */ }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(s + "T00:00:00");
const shift = (s: string, n: number) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

let date = iso(new Date());
let tool = "kor"; // 과목 id 또는 "erase"
let paintMode = false;
let adding = false;
let editing = false;
let view: "planner" | "plan" = "planner";
let planForm: string | null = null; // "new" 또는 수정 중인 계획 id
let tlLeft: number | null = null;

const subj = (id: string) => S.subjects.find((s) => s.id === id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const fmt = (cells: number) => `${Math.floor(cells / 6)}H${String((cells % 6) * 10).padStart(2, "0")}M`;
const countCells = (id?: string) =>
  Object.entries(S.paint).filter(([k, v]) => k.startsWith(date + "|") && (!id || v === id)).length;

const DEL = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
const MARK_UI = [
  "",
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/></svg>`,
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 L21 19 H3 Z"/></svg>`,
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5 L19 19 M19 5 L5 19"/></svg>`,
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12 H19 M13 6 L19 12 L13 18"/></svg>`,
];

// 복습 자동 생성: 완료(O)한 공부 항목을 과목별로 묶어 내일(1일)/일요일(주간)/말일(월간)에 복습 태스크를 만든다.
// 표시 중인 날짜가 오늘 이후일 때만 만들고, 사용자가 이미 체크한 복습은 건드리지 않는다.
const REVIEWABLE = ["lecture", "concept", "problem", "exam"];
const REVIEW_ACTION: Record<string, string> = { lecture: "핵심 내용 다시보기", concept: "핵심 개념 다시보기", problem: "오답 정리하기", exam: "오답 정리하기" };
function doneBySubject(from: string, to: string) {
  const out = new Map<string, Task[]>();
  for (let dt = from; dt <= to; dt = shift(dt, 1))
    for (const t of S.tasks[dt] ?? [])
      if (t.status === 1 && REVIEWABLE.includes(t.type ?? "")) out.set(t.subject, [...(out.get(t.subject) ?? []), t]);
  return out;
}
function syncReviews() {
  if (date < iso(new Date())) return;
  const want = new Map<string, { subject: string; text: string; detail: string }>();
  const add = (pre: string, text: string, from: string, to: string) => {
    for (const [sid, ts] of doneBySubject(from, to)) {
      want.set(`${pre}:${sid}`, { subject: sid, text, detail: ts.map((t) => t.text).join("\n") });
    }
  };
  const d = parse(date);
  for (const ts of doneBySubject(shift(date, -1), shift(date, -1)).values())
    for (const t of ts) want.set(`d:${t.id}`, { subject: t.subject, text: t.text, detail: REVIEW_ACTION[t.type!] }); // 1일 복습은 원래 태스크 이름 그대로
  if (d.getDay() === 0) add("w", "주간 복습", shift(date, -6), date);
  if (parse(shift(date, 1)).getDate() === 1) add("m", "월간 복습", iso(new Date(d.getFullYear(), d.getMonth(), 1)), date);
  const list = (S.tasks[date] ??= []);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].rkey && !want.has(list[i].rkey!) && list[i].status === 0) list.splice(i, 1);
  for (const [k, w] of want) {
    if (S.dismissed.includes(`${date}|${k}`)) continue;
    const ex = list.find((t) => t.rkey === k);
    if (ex) { ex.detail = w.detail; ex.text = w.text; }
    else list.push({ id: uid(), subject: w.subject, text: w.text, status: 0, type: "review", rkey: k, detail: w.detail });
  }
  save();
}

const tabs = () => `<nav class="tabs"><button data-view="planner" class="${view === "planner" ? "on" : ""}">플래너</button><button data-view="plan" class="${view === "plan" ? "on" : ""}">커리큘럼</button></nav>`;
const dayIdx = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5);
const DAYW = 26;

// 커리큘럼: 끝없이 이어지는 가로 타임라인. 과목별 줄에 계획 막대를 놓는다.
function renderPlan() {
  const today = iso(new Date());
  const lo = S.plans.reduce((m, p) => (p.start < m ? p.start : m), shift(today, -120));
  const hi = S.plans.reduce((m, p) => (p.end > m ? p.end : m), shift(today, 400));
  const first = shift(lo, -7), last = shift(S.exam > hi ? S.exam : hi, 14);
  const n = dayIdx(first, last) + 1;
  const x = (dt: string) => dayIdx(first, dt) * DAYW;

  let days = "", lines = "", months = "";
  for (let i = 0; i < n; i++) {
    const d = parse(shift(first, i));
    days += `<i class="${d.getDay() === 0 || d.getDay() === 6 ? "we" : ""}${d.getDate() === 1 ? " m1" : ""}">${d.getDate()}</i>`;
    if (d.getDate() === 1) {
      lines += `<div class="vl" style="left:${i * DAYW}px"></div>`;
      months += `<b style="left:${i * DAYW + 6}px">${d.getMonth() === 0 ? d.getFullYear() + "년 " : ""}${d.getMonth() + 1}월</b>`;
    }
  }

  let rows = "";
  for (const sj of S.subjects) {
    const mine = S.plans.filter((p) => p.subject === sj.id).sort((a, b) => a.start.localeCompare(b.start));
    const laneEnd: string[] = [];
    const bars = mine.map((p) => {
      let l = laneEnd.findIndex((e) => e < p.start);
      if (l < 0) l = laneEnd.length;
      laneEnd[l] = p.end;
      return `<button class="bar-p" data-plan="${p.id}" style="left:${x(p.start)}px;width:${(dayIdx(p.start, p.end) + 1) * DAYW}px;top:${8 + l * 36}px;background:${sj.color}"><span>${esc(p.name)}</span></button>`;
    }).join("");
    rows += `<div class="tlrow" style="height:${Math.max(1, laneEnd.length) * 36 + 16}px"><span class="tlname" style="color:${sj.color}">${sj.name}</span>${bars}</div>`;
  }

  const pf = planForm && planForm !== "new" ? S.plans.find((p) => p.id === planForm) : undefined;
  const form = planForm
    ? `<form id="planform"><select name="s">${S.subjects.map((s) => `<option value="${s.id}"${pf?.subject === s.id ? " selected" : ""}>${s.name}</option>`).join("")}</select><input name="n" placeholder="계획 이름 (예: 기출 3회독)" value="${esc(pf?.name ?? "")}" autocomplete="off" /><input type="date" name="a" value="${pf?.start ?? today}" /><input type="date" name="z" value="${pf?.end ?? shift(today, 14)}" /><button>저장</button>${pf ? `<button type="button" class="dg" data-plandel="${pf.id}">삭제</button>` : ""}</form>`
    : "";

  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top"><div><div class="label">CURRICULUM</div><div class="date"><span class="wd" style="font-size:clamp(28px,5vw,40px);color:var(--fg)">커리큘럼</span></div></div>
      <div class="acts"><button class="pill" id="goto-today">오늘로</button><button class="add" id="addplan">${planForm ? "×" : "+"}</button></div></div>
    <div style="margin-top:18px">${form}</div>
    <div class="tl" id="tl"><div class="tlin" style="width:${n * DAYW}px">
      <div class="tlhead"><div class="tlm">${months}</div><div class="tld">${days}</div></div>
      ${rows}${lines}
      <div class="vl today" style="left:${x(today) + DAYW / 2}px"></div>
      <div class="vl exam" style="left:${x(S.exam) + DAYW / 2}px"><span>수능</span></div>
    </div></div>
    <p class="hint">좌우로 밀어서 이동 · 막대를 탭하면 수정/삭제</p>`;
  const tl = document.getElementById("tl")!;
  tl.scrollLeft = tlLeft ?? Math.max(0, x(today) - tl.clientWidth * 0.3);
  tlLeft = tl.scrollLeft;
}

function render() {
  if (view === "plan") return renderPlan();
  syncReviews();
  const d = parse(date);
  const dd = Math.round((parse(S.exam).getTime() - parse(iso(new Date())).getTime()) / 864e5);
  const tasks = S.tasks[date] ?? [];

  const group = (rev: boolean) => {
  let rows = "";
  for (const s of S.subjects) {
    const mine = tasks.filter((t) => t.subject === s.id && (t.type === "review") === rev);
    if (!mine.length) continue;
    rows += `<section class="grp" style="--c:${s.color}"><header><span class="sn">${s.name}</span><span class="st">${rev ? "" : fmt(countCells(s.id))}</span></header>` +
      mine.map((t) => `<div class="task s${t.status}"><span class="ty" title="${TYPES[t.type ?? "etc"].name}">${TYPES[t.type ?? "etc"].icon}</span><span class="text">${esc(t.text)}${t.detail ? `<small class="detail">${esc(t.detail)}</small>` : ""}</span>${editing ? `<button class="del" data-del="${t.id}" aria-label="삭제">${DEL}</button>` : ""}${t.type === "exam" ? `<button class="score" data-score="${t.id}">${t.score == null ? "점수" : `${t.score}<small>/${t.max ?? 100}</small>`}</button>` : ""}<button class="mark m${t.status}" data-task="${t.id}">${MARK_UI[t.status]}</button></div>`).join("") +
      `</section>`;
  }
  return rows;
  };
  const rv = group(true);
  let rows = group(false) + (rv ? `<div class="label rvh">REVIEW</div>${rv}` : "");
  if (!tasks.length && !adding) rows = `<p class="empty">오늘 할 일이 없어요.<br>오른쪽 위 + 로 추가해보세요.</p>`;

  const form = adding
    ? `<form id="addform"><select name="s">${S.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}</select><select name="y">${PICK.map((k) => `<option value="${k}">${TYPES[k].name}</option>`).join("")}</select><input name="t" placeholder="할 일" autocomplete="off" /><button>추가</button></form>`
    : "";

  const tools =
    S.subjects.map((s) => `<button class="tool${tool === s.id ? " on" : ""}" data-tool="${s.id}" style="--c:${s.color}"><i></i>${s.name}</button>`).join("") +
    `<button class="tool${tool === "erase" ? " on" : ""}" data-tool="erase">지우개</button>` +
    `<button class="tool mode${paintMode ? " on" : ""}" id="pm">드래그 칠하기 ${paintMode ? "ON" : "OFF"}</button>`;

  const total = countCells();
  const bar = S.subjects.map((s) => ({ s, n: countCells(s.id) })).filter((x) => x.n)
    .map((x) => `<i style="flex:${x.n};background:${x.s.color}"></i>`).join("");

  let grid = "";
  for (let h = 0; h < 24; h++) {
    grid += `<div class="hour${h % 3 === 0 ? " major" : ""}">${h}</div>`;
    for (let c = 0; c < 6; c++) {
      const v = S.paint[`${date}|${h}|${c}`];
      grid += `<div class="cell${h % 3 === 2 ? " e3" : ""}" data-h="${h}" data-c="${c}"${v ? ` style="background:${subj(v).color}"` : ""}></div>`;
    }
  }

  const keep = scrollY;
  const chips = S.plans.filter((p) => p.start <= date && date <= p.end)
    .map((p) => `<span class="chip" style="--c:${subj(p.subject).color}">${subj(p.subject).name} · ${esc(p.name)}</span>`).join("");
  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top">
      <div class="dateblock">
        <div class="label">${d.getFullYear()}년 ${d.getMonth() + 1}월</div>
        <div class="date"><button class="nav" data-day="-1">‹</button><span class="big">${d.getDate()}</span><span class="wd">${"일월화수목금토"[d.getDay()]}요일</span><button class="nav" data-day="1">›</button></div>
      </div>
      <div class="ddaybox" id="dday"><div class="label">D-DAY</div><div class="dday">${dd >= 0 ? "D-" + dd : "D+" + -dd}</div></div>
    </div>
    ${chips ? `<div class="chips">${chips}</div>` : ""}
    <div class="main">
      <div class="left">
        <div class="head"><div class="label">TASKS</div><div class="acts"><button class="pill${editing ? " on" : ""}" id="edit">편집</button><button class="add" id="add">${adding ? "×" : "+"}</button></div></div>
        ${form}${rows}
      </div>
      <div class="right">
        <div class="total"><div><div class="label">TOTAL TIME</div><b>${fmt(total)}</b></div><div class="bar">${bar}</div></div>
        <div class="label">TIMETABLE</div>
        <div class="tools">${tools}</div>
        <div class="ttwrap" id="ttwrap"><div class="tt${paintMode ? " paint" : ""}" id="tt">${grid}</div></div>
      </div>
    </div>
    <footer class="foot"><button class="pill" id="export">백업 내보내기</button><button class="pill" id="import">백업 불러오기</button><span>마지막 백업: ${S.lastBackup ?? "없음"}</span></footer>
    <input type="file" id="file" accept=".json,application/json" hidden />`;
  scrollTo(0, keep);
  if (adding) (document.querySelector("#addform input") as HTMLInputElement).focus();
}

function paintCell(el: Element | null) {
  if (!el || !(el instanceof HTMLElement) || !el.classList.contains("cell")) return;
  const k = `${date}|${el.dataset.h}|${el.dataset.c}`;
  if (tool === "erase") delete S.paint[k]; else S.paint[k] = tool;
  el.style.background = tool === "erase" ? "" : subj(tool).color;
}

function cycle(id: string) {
  const list = S.tasks[date] ?? [];
  const t = list.find((x) => x.id === id)!;
  const nextList = (S.tasks[shift(date, 1)] ??= []);
  if (t.status === 4 && t.next) { // -> 에서 벗어나면 내일 복사본 제거
    const i = nextList.findIndex((x) => x.id === t.next);
    if (i >= 0) nextList.splice(i, 1);
    t.next = undefined;
  }
  t.status = (t.status + 1) % MARKS.length;
  if (t.status === 4) {
    t.next = uid();
    nextList.push({ id: t.next, subject: t.subject, text: t.text, status: 0, type: t.type, detail: t.detail });
  }
}

const app = document.getElementById("app")!;
let dragging = false;
let pan: { x: number; left: number } | null = null;
let panMoved = false;
app.addEventListener("scroll", (e) => { if ((e.target as HTMLElement).id === "tl") tlLeft = (e.target as HTMLElement).scrollLeft; }, true);
app.addEventListener("pointerdown", (e) => {
  const tl = (e.target as HTMLElement).closest("#tl");
  if (tl && e.pointerType === "mouse") { pan = { x: e.clientX, left: tl.scrollLeft }; panMoved = false; }
});
addEventListener("pointermove", (e) => {
  if (!pan) return;
  if (Math.abs(e.clientX - pan.x) > 5) panMoved = true;
  document.getElementById("tl")!.scrollLeft = pan.left - (e.clientX - pan.x);
});
addEventListener("pointerup", () => { pan = null; setTimeout(() => (panMoved = false), 0); });

app.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const b = el.closest("button") as HTMLElement | null;
  if (b?.dataset.view) { view = b.dataset.view as typeof view; }
  else if (b?.id === "addplan") planForm = planForm ? null : "new";
  else if (b?.id === "goto-today") tlLeft = null;
  else if (b?.dataset.plan) { if (panMoved) return; planForm = b.dataset.plan; }
  else if (b?.dataset.plandel) { S.plans = S.plans.filter((p) => p.id !== b.dataset.plandel); planForm = null; }
  else if (b?.id === "export") {
    S.lastBackup = iso(new Date());
    save();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: "application/json" }));
    a.download = `planner-backup-${S.lastBackup}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } else if (b?.id === "import") { (document.getElementById("file") as HTMLInputElement).click(); return; }
  else if (b?.dataset.del) {
    const list = S.tasks[date] ?? [];
    const i = list.findIndex((x) => x.id === b.dataset.del);
    const [t] = list.splice(i, 1);
    if (t.rkey) S.dismissed.push(`${date}|${t.rkey}`);
    if (t.next) { const n = S.tasks[shift(date, 1)] ?? []; const j = n.findIndex((x) => x.id === t.next); if (j >= 0) n.splice(j, 1); }
  } else if (b?.id === "edit") editing = !editing;
  else if (b?.dataset.score) {
    const t = (S.tasks[date] ?? []).find((x) => x.id === b.dataset.score)!;
    const v = prompt("점수 / 만점 (예: 72/100, 비우면 삭제)", t.score == null ? "/100" : `${t.score}/${t.max ?? 100}`);
    if (v === null) return;
    const m = v.match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/);
    if (m) { t.score = +m[1]; t.max = m[2] ? +m[2] : t.max ?? 100; } else if (!v.trim() || v.trim() === "/100") t.score = undefined;
  } else if (b?.dataset.task) cycle(b.dataset.task);
  else if (b?.dataset.day) date = shift(date, +b.dataset.day);
  else if (b?.dataset.tool) { tool = b.dataset.tool; }
  else if (b?.id === "pm") paintMode = !paintMode;
  else if (b?.id === "add") adding = !adding;
  else if (el.closest("#dday")) {
    const v = prompt("수능 날짜 (YYYY-MM-DD)", S.exam);
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) S.exam = v;
  } else if (el.classList.contains("cell") && !paintMode) { paintCell(el); }
  else return;
  save(); render();
});

app.addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (typeof d.tasks !== "object" || typeof d.paint !== "object" || !Array.isArray(d.subjects)) throw 0;
    if (!confirm("지금 앱의 모든 기록이 백업 파일 내용으로 바뀝니다. 계속할까요?")) return;
    S = { ...defaults, ...d };
    save(); render();
  } catch { alert("백업 파일을 읽을 수 없어요."); }
});

app.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target as HTMLFormElement;
  if (f.id === "planform") {
    const v = (k: string) => (f.elements.namedItem(k) as HTMLInputElement | HTMLSelectElement).value;
    let [a, z] = [v("a"), v("z")];
    if (!v("n").trim() || !a || !z) return;
    if (a > z) [a, z] = [z, a];
    const cur = S.plans.find((p) => p.id === planForm);
    const next = { id: cur?.id ?? uid(), subject: v("s"), name: v("n").trim(), start: a, end: z };
    if (cur) Object.assign(cur, next); else S.plans.push(next);
    planForm = null;
    save(); render();
    return;
  }
  const text = (f.elements.namedItem("t") as HTMLInputElement).value.trim();
  if (text) (S.tasks[date] ??= []).push({ id: uid(), subject: (f.elements.namedItem("s") as HTMLSelectElement).value, text, status: 0, type: (f.elements.namedItem("y") as HTMLSelectElement).value });
  save(); render();
});

app.addEventListener("pointerdown", (e) => {
  if (!paintMode || !(e.target as HTMLElement).classList.contains("cell")) return;
  dragging = true;
  paintCell(e.target as Element);
});
app.addEventListener("pointermove", (e) => { if (dragging) paintCell(document.elementFromPoint(e.clientX, e.clientY)); });
const stop = () => { if (dragging) { dragging = false; save(); render(); } };
addEventListener("pointerup", stop);
addEventListener("pointercancel", stop);

render();

navigator.storage?.persist?.().catch(() => {}); // 브라우저가 저장소를 임의로 지우지 않도록 요청
if (import.meta.env.PROD) navigator.serviceWorker?.register("./sw.js").catch(() => {});
