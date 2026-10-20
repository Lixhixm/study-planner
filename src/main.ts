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
  repeats: { id: string; subject: string; type: string; text: string; days: number[] }[];
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
  repeats: [],
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
let painting = false; // 시간표 칠하기 도구 상자 표시 여부
let focusAdd = false; // 팝업을 막 열었거나 연속 추가할 때만 입력칸에 포커스 (다른 조작 때 키보드가 뜨지 않게)
let dialog: { kind: "score"; id: string } | { kind: "exam" } | null = null;
let view: "planner" | "cal" | "plan" | "set" = "planner";
let calMonth = iso(new Date()).slice(0, 8) + "01"; // 보고 있는 달의 1일
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
  const want = new Map<string, { subject: string; text: string; detail: string; type?: string }>();
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
  for (const r of S.repeats) if (r.days.includes(d.getDay())) want.set(`r:${r.id}`, { subject: r.subject, text: r.text, detail: "", type: r.type });
  const list = (S.tasks[date] ??= []);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].rkey && !want.has(list[i].rkey!) && list[i].status === 0) list.splice(i, 1);
  for (const [k, w] of want) {
    if (S.dismissed.includes(`${date}|${k}`)) continue;
    const ex = list.find((t) => t.rkey === k);
    if (ex) { ex.detail = w.detail; ex.text = w.text; }
    else list.push({ id: uid(), subject: w.subject, text: w.text, status: 0, type: w.type ?? "review", rkey: k, detail: w.detail });
  }
  save();
}

function focusInput() {
  if (!focusAdd) return;
  focusAdd = false;
  (document.querySelector(".pop input:not([type=date]), .dlg input") as HTMLElement | null)?.focus();
}

// 점수 입력, 수능 날짜: 가운데 작은 상자
function dialogHtml() {
  const dg = dialog;
  if (!dg) return "";
  if (dg.kind === "exam")
    return `<div class="backdrop"><form class="dlg" id="dlgform"><h3>수능 날짜</h3><input type="date" name="d" value="${S.exam}" required /><div class="r"><button type="button" data-dclose="1">취소</button><button>저장</button></div></form></div>`;
  const t = (S.tasks[date] ?? []).find((x) => x.id === dg.id);
  if (!t) return "";
  return `<div class="backdrop"><form class="dlg" id="dlgform"><h3>${esc(t.text)}</h3><div class="r"><input name="sc" type="number" step="any" inputmode="decimal" placeholder="점수" value="${t.score ?? ""}" /><span>/</span><input name="mx" type="number" step="any" inputmode="decimal" placeholder="만점" value="${t.max ?? 100}" /></div><div class="r"><button type="button" data-dclear="1">지우기</button><button type="button" data-dclose="1">취소</button><button>저장</button></div></form></div>`;
}

const tabs = () => `<nav class="tabs"><button data-view="planner" class="${view === "planner" ? "on" : ""}">플래너</button><button data-view="cal" class="${view === "cal" ? "on" : ""}">캘린더</button><button data-view="plan" class="${view === "plan" ? "on" : ""}">커리큘럼</button><button data-view="set" class="${view === "set" ? "on" : ""}">설정</button></nav>`;
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
  const left = dayIdx(today, S.exam);
  const examLabel = left > 0 ? `D-${left}` : left === 0 ? "D-DAY" : `D+${-left}`;

  let days = "", lines = "", months = "";
  for (let i = 0; i < n; i++) {
    const d = parse(shift(first, i));
    const dt = shift(first, i);
    days += `<i class="${d.getDay() === 0 || d.getDay() === 6 ? "we" : ""}${d.getDate() === 1 ? " m1" : ""}${dt === today ? " td" : dt === S.exam ? " ex" : ""}">${d.getDate()}</i>`;
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
    ? `<div class="pop"><form id="planform"><select name="s">${S.subjects.map((s) => `<option value="${s.id}"${pf?.subject === s.id ? " selected" : ""}>${s.name}</option>`).join("")}</select><input name="n" placeholder="계획 이름 (예: 기출 3회독)" value="${esc(pf?.name ?? "")}" autocomplete="off" /><input type="date" name="a" value="${pf?.start ?? today}" /><input type="date" name="z" value="${pf?.end ?? shift(today, 14)}" /><button>저장</button>${pf ? `<button type="button" class="dg" data-plandel="${pf.id}">삭제</button>` : ""}</form></div>`
    : "";

  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top"><div><div class="label">CURRICULUM</div><div class="date"><span class="wd" style="font-size:clamp(28px,5vw,40px);color:var(--fg)">커리큘럼</span></div></div>
      <div class="acts"><button class="pill" id="goto-today">오늘로</button><button class="add" id="addplan">${planForm ? "×" : "+"}</button>${form}</div></div>
    <div class="tl" id="tl"><div class="tlin" style="width:${n * DAYW}px">
      <div class="tlhead"><div class="tle"><span class="ev today" style="left:${x(today) + DAYW / 2}px">오늘</span><span class="ev exam" style="left:${x(S.exam) + DAYW / 2}px">수능 ${examLabel}</span></div><div class="tlm">${months}</div><div class="tld">${days}</div></div>
      ${rows}${lines}
      <div class="band today" style="left:${x(today)}px"></div><div class="vl today" style="left:${x(today) + DAYW / 2}px"></div>
      <div class="band exam" style="left:${x(S.exam)}px"></div><div class="vl exam" style="left:${x(S.exam) + DAYW / 2}px"></div>
    </div></div>
    <p class="hint">좌우로 밀어서 이동 · 막대를 탭하면 수정/삭제</p>`;
  const tl = document.getElementById("tl")!;
  tl.scrollLeft = tlLeft ?? Math.max(0, x(today) - tl.clientWidth * 0.3);
  tlLeft = tl.scrollLeft;
  focusInput();
}

// 캘린더: 월간 달력. 날짜 칸에 공부 시간, 할 일 달성률, 공부한 과목 점, 모의고사 점수를 보여준다.
function renderCal() {
  const first = parse(calMonth);
  const today = iso(new Date());
  const perDay: Record<string, Record<string, number>> = {};
  for (const k in S.paint) { const m = (perDay[k.slice(0, 10)] ??= {}); m[S.paint[k]] = (m[S.paint[k]] ?? 0) + 1; }

  let cells = "";
  for (let i = 0; i < first.getDay(); i++) cells += `<div class="cd blank"></div>`;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  for (let n = 1; n <= days; n++) {
    const dt = iso(new Date(first.getFullYear(), first.getMonth(), n));
    const by = perDay[dt] ?? {};
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    const tasks = S.tasks[dt] ?? [];
    const pct = tasks.length ? Math.round((tasks.filter((t) => t.status === 1).length / tasks.length) * 100) : 0;
    const seg = S.subjects.filter((sj) => by[sj.id]).map((sj) => `<i style="flex:${by[sj.id]};background:${sj.color}"></i>`).join("");
    const scores = tasks.filter((t) => t.type === "exam" && t.score != null).map((t) => `<em style="--c:${subj(t.subject).color}">${subj(t.subject).name} ${t.score}/${t.max ?? 100}</em>`).join("");
    const C = 2 * Math.PI * 11;
    const gauge = tasks.length && dt <= today // 미래 날짜는 아직 달성률이 의미 없다
      ? `<svg class="gauge" viewBox="0 0 28 28"><circle cx="14" cy="14" r="11" fill="none" stroke="var(--line2)" stroke-width="3"/><circle cx="14" cy="14" r="11" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}" transform="rotate(-90 14 14)"/><text x="14" y="17" text-anchor="middle">${pct}%</text></svg>`
      : "";
    cells += `<button class="cd${dt === today ? " today" : ""}${dt === S.exam ? " exam" : ""}" data-d="${dt}"><span class="ct"><span class="nl"><span class="n">${n}</span>${dt === S.exam ? `<small class="ed">수능</small>` : ""}</span>${gauge}</span><span class="tm">${total ? fmt(total) : ""}</span><span class="sb${total ? "" : " none"}">${seg}</span>${scores}</button>`;
  }

  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top"><div><div class="label">CALENDAR</div><div class="date"><button class="nav" data-cal="-1">‹</button><span class="wd" style="font-size:clamp(28px,5vw,40px);color:var(--fg)">${first.getFullYear()}년 ${first.getMonth() + 1}월</span><button class="nav" data-cal="1">›</button></div></div>
      <div class="acts"><button class="pill" id="cal-today">이번 달</button></div></div>
    <div class="cal"><div class="cw">${"일월화수목금토".split("").map((c, i) => `<span class="${i === 0 ? "sun" : ""}">${c}</span>`).join("")}</div><div class="cg">${cells}</div></div>
    <p class="hint">날짜를 탭하면 그날의 플래너로 이동 · 원은 할 일 달성률 · 막대는 과목별 공부 비중</p>`;
}

// 설정: 수능 날짜, 과목 편집, 반복 할 일, 백업
const DOW = "일월화수목금토";
function renderSet() {
  const subs = S.subjects.map((sj) => `<div class="srow"><input type="color" value="${sj.color}" data-scolor="${sj.id}" /><input class="sname" value="${esc(sj.name)}" data-sname="${sj.id}" autocomplete="off" /><button class="del" data-sdel="${sj.id}" aria-label="삭제">${DEL}</button></div>`).join("");
  const reps = S.repeats.map((r) => `<div class="srow"><span class="ty">${TYPES[r.type].icon}</span><span class="rtxt"><b style="color:${subj(r.subject).color}">${subj(r.subject).name}</b> ${esc(r.text)}<small>${r.days.length === 7 ? "매일" : r.days.map((d) => DOW[d]).join(" ")}</small></span><button class="del" data-rdel="${r.id}" aria-label="삭제">${DEL}</button></div>`).join("") || `<p class="empty" style="padding:12px 0">반복 할 일이 없어요.</p>`;
  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top"><div><div class="label">SETTINGS</div><div class="date"><span class="wd" style="font-size:clamp(28px,5vw,40px);color:var(--fg)">설정</span></div></div></div>
    <div class="sets">
      <section class="grp set"><header><span class="sn" style="color:var(--fg)">수능 날짜</span></header><div class="srow"><input type="date" id="exam" value="${S.exam}" /></div></section>
      <section class="grp set"><header><span class="sn" style="color:var(--fg)">과목</span></header>${subs}<div class="srow"><button class="pill" id="sadd">+ 과목 추가</button></div></section>
      <section class="grp set"><header><span class="sn" style="color:var(--fg)">반복 할 일</span></header>${reps}
        <form id="repform"><select name="s">${S.subjects.map((sj) => `<option value="${sj.id}">${sj.name}</option>`).join("")}</select><select name="y">${PICK.map((k) => `<option value="${k}">${TYPES[k].name}</option>`).join("")}</select><input name="t" placeholder="할 일 (예: 영단어 50개)" autocomplete="off" />
          <div class="days">${[...DOW].map((c, i) => `<label><input type="checkbox" name="d" value="${i}" checked /><span>${c}</span></label>`).join("")}</div><button>추가</button></form></section>
      <section class="grp set"><header><span class="sn" style="color:var(--fg)">백업</span></header><div class="srow foot"><button class="pill" id="export">백업 내보내기</button><button class="pill" id="import">백업 불러오기</button><span>마지막 백업: ${S.lastBackup ?? "없음"}</span></div></section>
    </div>
    <input type="file" id="file" accept=".json,application/json" hidden />`;
}

function render() {
  if (view === "set") return renderSet();
  if (view === "cal") return renderCal();
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

  const pop = adding
    ? `<div class="pop"><form id="addform"><select name="s">${S.subjects.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}</select><select name="y">${PICK.map((k) => `<option value="${k}">${TYPES[k].name}</option>`).join("")}</select><input name="t" placeholder="할 일" autocomplete="off" /><button>추가</button></form></div>`
    : "";

  const tools =
    S.subjects.map((s) => `<button class="tool${tool === s.id ? " on" : ""}" data-tool="${s.id}" style="--c:${s.color}"><i></i>${s.name}</button>`).join("") +
    `<button class="tool${tool === "erase" ? " on" : ""}" data-tool="erase">지우개</button>` +
    `<button class="tool mode${paintMode ? " on" : ""}" id="pm">드래그 칠하기 ${paintMode ? "ON" : "OFF"}</button>`;

  const toolsBox = painting ? `<div class="tools box">${tools}<button class="tool" id="pt">완료</button></div>` : "";
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
  const active = S.plans.filter((p) => p.start <= date && date <= p.end);
  const chips = active
    .map((p) => `<span class="chip" style="--c:${subj(p.subject).color}">${subj(p.subject).name} · ${esc(p.name)}</span>`).join("");
  document.getElementById("app")!.innerHTML = `${tabs()}
    <div class="top">
      <div class="dateblock">
        <div class="label">${d.getFullYear()}년 ${d.getMonth() + 1}월</div>
        <div class="date"><button class="nav" data-day="-1">‹</button><span class="big">${d.getDate()}</span><span class="wd">${"일월화수목금토"[d.getDay()]}요일</span><button class="nav" data-day="1">›</button></div>
      </div>
      <div class="chips">${chips}</div>
      <div class="ddaybox" id="dday"><div class="label">D-DAY</div><div class="dday">${dd >= 0 ? "D-" + dd : "D+" + -dd}</div></div>
    </div>
    <div class="main">
      <div class="left">
        <div class="head"><div class="label">TASKS</div><div class="acts"><button class="pill${editing ? " on" : ""}" id="edit">편집</button><button class="add" id="add">${adding ? "×" : "+"}</button>${pop}</div></div>
        ${rows}
      </div>
      <div class="right">
        <div class="total"><div><div class="label">TOTAL TIME</div><b>${fmt(total)}</b></div><div class="bar">${bar}</div></div>
        <div class="head"><div class="label">TIMETABLE</div><button class="pill${painting ? " on" : ""}" id="pt" aria-label="칠하기">${TYPES.problem.icon}</button></div>
        ${toolsBox}
        <div class="ttwrap" id="ttwrap"><div class="tt${painting && paintMode ? " paint" : ""}" id="tt">${grid}</div></div>
      </div>
    </div>${dialogHtml()}`;
  scrollTo(0, keep);
  focusInput();
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
  let closed = false; // 팝업 바깥을 눌러 닫은 경우도 다시 그려야 한다
  if (adding && !el.closest(".pop,#add")) { adding = false; closed = true; }
  if (planForm && !el.closest(".pop,#addplan,[data-plan]")) { planForm = null; closed = true; }
  if (b?.dataset.view) { view = b.dataset.view as typeof view; }
  else if (b?.id === "sadd") S.subjects.push({ id: uid(), name: "새 과목", color: ["#f08a4b", "#2fa8e0", "#5cb85c", "#e07ad1", "#6fd0c4", "#7fb3e8", "#e8c34a", "#9b8cf0"][S.subjects.length % 8] });
  else if (b?.dataset.sdel) {
    const id = b.dataset.sdel;
    if (S.subjects.length <= 1) { alert("과목은 최소 1개가 필요해요."); return; }
    if (!confirm(`"${subj(id).name}" 과목과 그 과목의 할 일, 시간표 기록, 계획, 반복 할 일이 모두 지워져요. 계속할까요?`)) return;
    S.subjects = S.subjects.filter((x) => x.id !== id);
    for (const k in S.tasks) S.tasks[k] = S.tasks[k].filter((t) => t.subject !== id);
    for (const k in S.paint) if (S.paint[k] === id) delete S.paint[k];
    S.plans = S.plans.filter((x) => x.subject !== id);
    S.repeats = S.repeats.filter((x) => x.subject !== id);
    if (tool === id) tool = S.subjects[0].id;
  }
  else if (b?.dataset.rdel) S.repeats = S.repeats.filter((r) => r.id !== b.dataset.rdel);
  else if (b?.dataset.cal) { const f = parse(calMonth); calMonth = iso(new Date(f.getFullYear(), f.getMonth() + +b.dataset.cal, 1)); }
  else if (b?.id === "cal-today") calMonth = iso(new Date()).slice(0, 8) + "01";
  else if (b?.dataset.d) { date = b.dataset.d; view = "planner"; }
  else if (b?.id === "addplan") { planForm = planForm ? null : "new"; focusAdd = !!planForm; }
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
  else if (b?.dataset.score) { dialog = { kind: "score", id: b.dataset.score }; focusAdd = true; }
  else if (b?.dataset.task) cycle(b.dataset.task);
  else if (b?.dataset.day) date = shift(date, +b.dataset.day);
  else if (b?.dataset.tool) { tool = b.dataset.tool; }
  else if (b?.id === "pm") paintMode = !paintMode;
  else if (b?.id === "add") { adding = !adding; focusAdd = adding; }
  else if (b?.id === "pt") painting = !painting;
  else if (b?.dataset.dclose) dialog = null;
  else if (el.classList.contains("backdrop")) dialog = null;
  else if (b?.dataset.dclear) { const dg = dialog; if (dg?.kind === "score") { const t = (S.tasks[date] ?? []).find((x) => x.id === dg.id); if (t) t.score = undefined; } dialog = null; }
  else if (el.closest("#dday")) dialog = { kind: "exam" };
  else if (el.classList.contains("cell") && painting && !paintMode) { paintCell(el); }
  else if (!closed) return;
  save(); render();
});

app.addEventListener("change", async (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.sname) { subj(el.dataset.sname).name = el.value.trim() || "과목"; save(); return; }
  if (el.dataset.scolor) { subj(el.dataset.scolor).color = el.value; save(); return; }
  if (el.id === "exam") { if (el.value) { S.exam = el.value; save(); } return; }
  const f = el.files?.[0];
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
  if (f.id === "dlgform") {
    const dg = dialog;
    const v = (k: string) => (f.elements.namedItem(k) as HTMLInputElement).value;
    if (dg?.kind === "exam") { if (v("d")) S.exam = v("d"); }
    else if (dg?.kind === "score") {
      const t = (S.tasks[date] ?? []).find((x) => x.id === dg.id);
      if (t) { t.score = v("sc") === "" ? undefined : parseFloat(v("sc")); t.max = parseFloat(v("mx")) || 100; }
    }
    dialog = null;
    save(); render();
    return;
  }
  if (f.id === "repform") {
    const text = (f.elements.namedItem("t") as HTMLInputElement).value.trim();
    const days = [...f.querySelectorAll<HTMLInputElement>('input[name="d"]:checked')].map((c) => +c.value);
    if (!text || !days.length) return;
    S.repeats.push({ id: uid(), subject: (f.elements.namedItem("s") as HTMLSelectElement).value, type: (f.elements.namedItem("y") as HTMLSelectElement).value, text, days });
    save(); render();
    return;
  }
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
  focusAdd = true; // 연속으로 추가할 수 있게 입력칸 유지
  save(); render();
});

app.addEventListener("pointerdown", (e) => {
  if (!painting || !paintMode || !(e.target as HTMLElement).classList.contains("cell")) return;
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
