// =====================================================================
//  실험 진행 순서와 데이터 기록
// =====================================================================
const C = CONFIG;
const MODALITIES = ["subtitle", "audio", "both"];
const PER_BLOCK = C.ITEM_COUNTS.reduce((a, n) => a + C.CLIPS_PER_N[n], 0);   // 블록 하나의 클립 수 (4 + 2 = 6)
const TOTAL_CLIPS = MODALITIES.length * PER_BLOCK;                            // 18

// 참가자 한 명의 모든 정보가 여기에 모입니다.
const URLP = new URLSearchParams(location.search);
// 무작위 참가자 코드(신원과 연결되지 않음). 파일럿/테스트는 PILOT- 로 시작
const randomCode = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join("");
};
const S = {
  pilot: URLP.get("pilot") === "1",
  code: null, assignment: "", ageGroup: "", gender: "", orderId: null, order: null,
  mainItems: [], practiceItems: [],
  sequence: [],        // 본실험 클립 18개(보는 순서대로)
  practiceClips: [],
  trialRows: [], clipRows: [],
  soundcheckAttempts: 0, practiceCorrect: 0, practiceTotal: 0,
  startTime: new Date(), fontOk: false, saveOk: false, files: [],
};

// ---------- 작은 도구들 ----------
const shuffle = (a) => {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// "펄디법" → "펄디법이", "코나" → "코나가"
const withIGa = (w) => {
  const c = w.charCodeAt(w.length - 1);
  const hasBatchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return w + (hasBatchim ? "이" : "가");
};
const EYEBROW = `<div class="eyebrow">${C.COURSE_LABEL}</div>`;
// 안내 화면 틀. head=true 이면 맨 위에 과목·조 표시
const page = (html, head = false) => `<div class="box">${head ? EYEBROW : ""}${html}</div>`;
// 진행 막대 (본실험 클립 몇 개째인지)
const progressBar = (done, total, label) => `<div class="progress">
  <div class="label"><span>${label}</span><span>${Math.round((done / total) * 100)}%</span></div>
  <div class="track"><div class="fill" style="width:${(done / total) * 100}%"></div></div></div>`;

// ---------- CSV 읽기/쓰기 ----------
function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().replace(/^﻿/, ""));
  return rows.filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}
function toCSV(rows, cols) {
  const esc = (v) => {
    v = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n") + "\r\n";
}
// 엑셀에서 저장하면 인코딩이 바뀔 수 있어서 두 가지 모두 읽을 수 있게 함
async function fetchText(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`파일을 찾을 수 없습니다: ${path}`);
  const buf = await res.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("euc-kr").decode(buf); }
}

// ---------- 항목 목록 검사 ----------
function checkItems(items) {
  const errs = [];
  const main = items.filter((r) => r.set === "main");
  const prac = items.filter((r) => r.set === "practice");
  // 조건 하나 = 항목 수 n × 클립 수 (예: 3×4 = 6×2 = 12문항)
  const perCondition = C.ITEM_COUNTS.map((n) => n * C.CLIPS_PER_N[n]);
  const need = MODALITIES.length * perCondition.reduce((a, b) => a + b, 0);
  if (main.length !== need) errs.push(`본실험(main) 항목이 ${main.length}개입니다. ${need}개여야 합니다.`);
  for (const p of C.PROCESSES) {
    const n = main.filter((r) => r.process === p).length;
    if (n !== need / C.PROCESSES.length) errs.push(`'${p}' 항목이 ${n}개입니다. ${need / C.PROCESSES.length}개여야 합니다.`);
  }
  const bad = items.filter((r) => !C.PROCESSES.includes(r.process));
  if (bad.length) errs.push(`공정 이름이 잘못된 줄: ${bad.map((r) => r.id).join(", ")}`);
  const names = items.map((r) => r.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) errs.push(`이름이 겹치는 항목: ${[...new Set(dup)].join(", ")}`);
  const needPrac = C.PRACTICE_CLIPS.reduce((a, b) => a + b, 0);
  if (prac.length !== needPrac) errs.push(`연습(practice) 항목이 ${prac.length}개입니다. ${needPrac}개여야 합니다.`);
  return errs;
}

// ---------- 블록 순서 배정 ----------
//  · 보통: DataPipe가 들어온 순서대로 1→2→…→6→1… 을 돌아가며 배정 (30명이면 각 5명)
//  · 링크 끝에 ?order=3 처럼 붙이면 그 순서로 지정 (중도 포기로 모자란 순서를 채울 때)
//  · 링크 끝에 ?pilot=1 을 붙이면 파일럿/테스트: 배정 순번을 쓰지 않고 무작위, 코드가 PILOT- 로 시작
async function assignOrder() {
  const n = C.BLOCK_ORDERS.length;
  const manual = parseInt(URLP.get("order"), 10);
  S.code = (S.pilot ? "PILOT-" : "") + randomCode();
  if (manual >= 1 && manual <= n) {
    S.orderId = manual; S.assignment = "manual";
  } else if (S.pilot || !C.DATAPIPE_ID) {
    S.orderId = Math.floor(Math.random() * n) + 1; S.assignment = "random_pilot";
  } else {
    const res = await fetch("https://pipe.jspsych.org/api/condition/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({ experimentID: C.DATAPIPE_ID }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!body || body.error || typeof body.condition !== "number") {
      throw new Error(`순서 배정 실패 (HTTP ${res.status}${body && body.error ? ", " + body.error : ""})`);
    }
    S.orderId = (body.condition % n) + 1; S.assignment = "datapipe";
  }
  S.order = C.BLOCK_ORDERS[S.orderId - 1];
}

// ---------- 참가자별 클립 구성 ----------
//  · 항목 이름을 6개 조건(항목 수 × 제시 방식)에 무작위로 나눠 줌(참가자마다 다름)
//  · 각 조건에는 공정별로 같은 개수(조건당 12개면 공정별 3개)가 들어감 — 조건 합계 기준 균형
//  · 조건의 항목들을 클립 크기(3개 또는 6개)로 무작위로 나눔 (클립 단위 균형은 따지지 않음)
//  · 블록(제시 방식) 순서는 assignOrder()로, 블록 안 클립 순서·클립 안 제시 순서·문항 순서는 각각 무작위
function buildSequence() {
  const pools = {};
  for (const p of C.PROCESSES) pools[p] = shuffle(S.mainItems.filter((r) => r.process === p));
  const conditions = {};   // "audio|6" → [클립1 항목들, 클립2 항목들, …]
  for (const m of MODALITIES) {
    for (const n of C.ITEM_COUNTS) {
      const k = C.CLIPS_PER_N[n];
      const perProc = (n * k) / C.PROCESSES.length;
      const items = shuffle(C.PROCESSES.flatMap((p) => pools[p].splice(0, perProc)));
      conditions[`${m}|${n}`] = Array.from({ length: k }, (_, j) => items.slice(j * n, (j + 1) * n));
    }
  }
  S.sequence = [];
  S.order.forEach((m, b) => {
    const blockClips = [];
    for (const n of C.ITEM_COUNTS) for (const items of conditions[`${m}|${n}`]) blockClips.push({ modality: m, n, items });
    shuffle(blockClips).forEach((c) => S.sequence.push({ ...c, block: b + 1, phase: "main" }));
  });
  S.sequence.forEach((c, i) => { c.clipNo = i + 1; c.qOrder = shuffle(c.items); });

  // 연습: 자막+음성, 정해진 순서(예: 3개 → 6개). clip_no 는 0으로 기록하고 항목 수로 구분
  const pi = shuffle(S.practiceItems);
  let at = 0;
  S.practiceClips = C.PRACTICE_CLIPS.map((n, j) => {
    const items = pi.slice(at, at + n); at += n;
    return { modality: "both", n, items, block: 0, clipNo: 0, practiceNo: j + 1, phase: "practice", qOrder: shuffle(items) };
  });
}

// =====================================================================
//  화면(시행) 만들기
// =====================================================================
const jsPsych = initJsPsych({ display_element: document.body });

function clipUnit(getClip, total) {
  const practice = () => getClip().phase === "practice";
  const ready = {
    type: jsPsychHtmlButtonResponse,
    stimulus: () => {
      const c = getClip();
      const bar = practice() ? "" : progressBar(c.clipNo - 1, total, `본실험 · 클립 ${c.clipNo} / ${total}`);
      const title = practice() ? `연습 클립 ${c.practiceNo} / ${C.PRACTICE_CLIPS.length}` : `클립 ${c.clipNo}`;
      return page(`${bar}<h2 class="center">${title}</h2>
        <p class="center">준비되면 <b>[시작]</b>을 눌러 주세요.<br>
        화면 가운데 <b>+</b>가 나오고, 1초 뒤 ${C.CLIP_SECONDS}초 동안 항목이 제시됩니다.</p>
        <p class="center note">클립은 멈추거나 다시 볼 수 없습니다.</p>`);
    },
    choices: ["시작"],
    on_finish: () => AUDIO.resume(),
  };
  const clip = {
    type: ClipPlugin,
    get_clip: getClip,
    clip_seconds: C.CLIP_SECONDS,
    on_finish: (d) => { getClip().clipData = d; },
  };
  const toQuestions = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: page(`<p class="center" style="font-size:21px;margin:18px 0">이제 방금 나온 항목에 대한 문제가 나옵니다.</p>`),
    choices: "NO_KEYS",
    trial_duration: C.TRANSITION_MS,
  };

  let q = 0;
  const question = {
    type: jsPsychHtmlButtonResponse,
    stimulus: () => {
      const c = getClip(), name = c.qOrder[q].name, josa = withIGa(name).slice(name.length);
      const where = c.phase === "practice" ? "연습" : `클립 ${c.clipNo}`;
      return `<div class="qmeta">${where} · 문항 ${q + 1} / ${c.qOrder.length}</div>
        <div class="question"><span class="name">${name}</span>${josa} 속하는 공정은?</div>`;
    },
    choices: C.PROCESSES,
    button_html: (choice) => `<button class="jspsych-btn choice-btn">${choice}</button>`,
    trial_duration: C.QUESTION_TIME_LIMIT_MS,
    post_trial_gap: C.GAP_BETWEEN_QUESTIONS_MS,
    on_finish: (d) => {
      const c = getClip(), it = c.qOrder[q];
      const timeout = d.response === null || d.response === undefined;
      const resp = timeout ? "" : C.PROCESSES[d.response];
      const correct = resp === it.process ? 1 : 0;
      d.correct = correct; d.timeout = timeout; d.answer = it.process;
      if (c.phase === "practice") { S.practiceTotal++; S.practiceCorrect += correct; }
      S.trialRows.push({
        participant: S.code, phase: c.phase, block_order_id: S.orderId, block_no: c.block,
        modality: c.modality, n_items: c.n, clip_no: c.clipNo, question_no: q + 1,
        item_id: it.id, item: it.name, correct_answer: it.process, response: resp,
        correct, rt_ms: timeout ? "" : Math.round(d.rt), timeout: timeout ? 1 : 0,
      });
    },
  };
  const feedback = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => {
      const d = jsPsych.data.getLastTrialData().values()[0];
      if (d.timeout) return `<p class="feedback no">시간 초과</p><p>정답은 <b>${d.answer}</b>입니다.</p><p class="note">문제마다 ${C.QUESTION_TIME_LIMIT_MS / 1000}초 안에 답해 주세요.</p>`;
      return d.correct ? `<p class="feedback ok">정답입니다</p>` : `<p class="feedback no">오답입니다</p><p>정답은 <b>${d.answer}</b>입니다.</p>`;
    },
    choices: "NO_KEYS",
    trial_duration: 1300,
    post_trial_gap: C.GAP_BETWEEN_QUESTIONS_MS,
  };
  const questions = {
    timeline: [question, { timeline: [feedback], conditional_function: practice }],
    loop_function: () => {
      q++;
      if (q < getClip().qOrder.length) return true;
      q = 0;
      return false;
    },
  };
  const rating = {
    type: jsPsychHtmlButtonResponse,
    stimulus: page(`<p class="center note" style="margin:0">방금 본 클립에 대해 답해 주세요.</p>
      <div class="scale-q center">${C.RATING_QUESTION}</div>`),
    choices: C.RATING_LABELS,
    button_html: (choice) => `<button class="jspsych-btn rating-btn">${choice}</button>`,
    prompt: `<div class="scale-ends"><span>1 = ${C.RATING_ENDS[0]}</span><span>5 = ${C.RATING_ENDS[1]}</span></div>`,
    on_finish: (d) => {
      const c = getClip(), cd = c.clipData || {};
      S.clipRows.push({
        participant: S.code, phase: c.phase, block_order_id: S.orderId, block_no: c.block,
        modality: c.modality, n_items: c.n, clip_no: c.clipNo,
        rating: d.response + 1, rating_rt_ms: Math.round(d.rt),
        away_during_clip: cd.clip_away, fullscreen_exit_during_clip: cd.clip_fs_exit,
        sub_lag_mean_ms: cd.sub_lag_mean_ms, sub_lag_max_ms: cd.sub_lag_max_ms,
        items_in_order: c.items.map((it) => `${it.name}(${it.process})`).join(" | "),
      });
    },
  };
  return [ready, clip, toQuestions, questions, rating];
}

function buildTimeline() {
  const tl = [];

  const chips = (name, values) => `<div class="chips">${values.map((v, i) =>
    `<label class="chip"><input type="radio" name="${name}" value="${v}" ${i === 0 ? "required" : ""}><span>${v}</span></label>`).join("")}</div>`;

  // 1) 시작 화면 → 전체 화면 전환
  tl.push({
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: page(`<h1>${C.EXPERIMENT_TITLE}</h1>
      <p class="lead">짧은 학습 클립을 보거나 듣고, 방금 나온 내용을 얼마나 정확히 알아보는지 측정합니다.</p>
      <div class="facts">
        <div class="fact">소요 시간<b>${C.EST_MINUTES}</b></div>
        <div class="fact">준비물<b>PC + 스피커/이어폰</b></div>
        <div class="fact">환경<b>조용한 곳</b></div>
      </div>
      <p class="note">실험은 전체 화면에서 진행됩니다. 진행 중에는 다른 창이나 탭으로 이동하지 말아 주세요.</p>`, true),
    button_label: "전체 화면으로 시작",
    on_finish: () => AUDIO.resume(),
  });

  // 2) 안내 및 동의
  tl.push({
    type: jsPsychSurveyHtmlForm,
    html: page(`<h2>실험 안내 및 참여 동의</h2>
      <dl class="consent-text">
        <dt>실험 목적</dt>
        <dd>짧은 학습 콘텐츠에서 정보가 얼마나 잘 전달되는지 측정하는 수업(인간공학실험) 과제입니다.</dd>
        <dt>진행 방법</dt>
        <dd>${C.CLIP_SECONDS}초 클립 ${TOTAL_CLIPS}개를 보거나 들은 뒤, 각 클립에 나온 항목에 대한 문제에 답합니다. ${C.EST_MINUTES}이 걸립니다.</dd>
        <dt>자발적 참여</dt>
        <dd>참여는 자유이며, 원하지 않으면 언제든 창을 닫아 그만둘 수 있습니다. 중간에 그만두면 응답은 저장되지 않습니다.</dd>
        <dt>수집 정보와 익명성</dt>
        <dd>이름, 연락처, 학번 등 개인을 알아볼 수 있는 정보는 수집하지 않습니다. 연령대, 성별과 과제 응답만 무작위 코드로 저장합니다.</dd>
        <dt>자료 이용</dt>
        <dd>수집한 자료는 수업 보고서 작성에만 사용하며, 결과는 집단 평균으로만 보고합니다.</dd>
      </dl>
      <label class="check"><input type="checkbox" name="consent" required>
        <span><b>위 내용을 읽었으며, 실험 참여에 동의합니다.</b></span></label>`, true),
    button_label: "동의하고 계속",
  });

  // 3) 기본 정보 (이름·번호 등 신원 정보는 받지 않음)
  tl.push({
    type: jsPsychSurveyHtmlForm,
    html: page(`<h2>기본 정보</h2>
      <div class="form">
        <div class="field"><span class="name">연령대</span>${chips("age_group", C.AGE_GROUPS)}</div>
        <div class="field"><span class="name">성별</span>${chips("gender", ["남", "여", "응답하지 않음"])}</div>
        <div style="padding-top:10px">
          <label class="check"><input type="checkbox" name="normal" required>
            <span>시력(안경·렌즈 교정 포함)과 청력이 정상입니다.</span></label>
          <label class="check"><input type="checkbox" name="korean" required>
            <span>한국어가 모어(모국어)입니다.</span></label>
        </div>
      </div>`, true),
    button_label: "다음",
    on_finish: (d) => {
      S.ageGroup = d.response.age_group;
      S.gender = d.response.gender;
    },
  });

  // 4) 블록 순서 배정 (정보 입력을 마친 사람에게만 배정해서, 앞 화면에서 나간 사람은 순서를 차지하지 않음)
  tl.push({
    type: jsPsychCallFunction,
    async: true,
    func: (done) => {
      assignOrder().then(() => { buildSequence(); done(); })
        .catch((e) => {
          window.removeEventListener("beforeunload", warnLeave);
          stopWith(`<h2>잠시 후 다시 시도해 주세요</h2>
            <p>실험 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 <b>새로고침(F5)</b>해서 다시 시작해 주세요.</p>
            <p class="note">${e.message}</p>`);
        });
    },
  });

  // 소리 테스트: 맞힐 때까지 반복
  const words = C.SOUNDCHECK_WORDS;
  let lastTarget = null;
  tl.push({
    timeline: [{
      type: SoundCheckPlugin,
      words,
      target: () => {
        const opts = Object.keys(words).filter((k) => k !== lastTarget);
        lastTarget = opts[Math.floor(Math.random() * opts.length)];
        return lastTarget;
      },
      message: () => S.soundcheckAttempts > 0
        ? `<p class="warn">다른 단어였습니다. 음량을 조금 올리고 다시 들어 주세요.</p>` : "",
      on_finish: () => { S.soundcheckAttempts++; },
    }],
    loop_function: (data) => !data.values()[0].sc_correct,
  });

  tl.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: page(`<h2>과제 안내</h2>
      <p>화면에 <b>가상의 가공법 이름과 공정 분류</b>가 짝지어 ${C.CLIP_SECONDS}초 동안 차례로 제시됩니다.</p>
      <div class="stage-sample"><span>펄디법 – ${C.PROCESSES[0]}</span></div>
      <ul>
        <li>공정 분류는 <b>${C.PROCESSES.join(" · ")}</b> 네 가지뿐입니다.</li>
        <li>클립에 따라 <b>자막만</b>, <b>음성만</b>, 또는 <b>자막과 음성이 함께</b> 나옵니다.</li>
        <li>클립이 끝나면 방금 나온 각 가공법이 어느 공정에 속했는지 고르는 문제가 나옵니다.</li>
        <li>문제마다 <b>${C.QUESTION_TIME_LIMIT_MS / 1000}초 안에</b>, 되도록 <b>빠르고 정확하게</b> 마우스로 답해 주세요.</li>
        <li>문제를 다 풀면 클립을 얼마나 잘 따라갈 수 있었는지 1~5점으로 답합니다.</li>
      </ul>
      <p class="note">먼저 연습 클립 ${C.PRACTICE_CLIPS.length}개로 연습합니다. 연습에서는 정답을 알려 드립니다.</p>`, true),
    choices: ["연습 시작"],
  });
  C.PRACTICE_CLIPS.forEach((_, j) => tl.push(...clipUnit(() => S.practiceClips[j], 0)));
  tl.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: () => page(`<h2>연습 완료</h2>
      <p>연습 문제 ${S.practiceTotal}개 중 <b>${S.practiceCorrect}개</b>를 맞혔습니다.</p>
      <div class="facts">
        <div class="fact">본실험<b>클립 ${TOTAL_CLIPS}개</b></div>
        <div class="fact">구성<b>${MODALITIES.length}개 묶음 × ${PER_BLOCK}클립</b></div>
        <div class="fact">정답 안내<b>없음</b></div>
      </div>
      <p class="note">묶음 사이에 쉬어 갈 수 있습니다.</p>`, true),
    choices: ["본실험 시작"],
  });

  // 본실험: 블록 3개 × 클립 4개
  const perBlock = PER_BLOCK;
  const total = TOTAL_CLIPS;
  for (let b = 0; b < MODALITIES.length; b++) {
    tl.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: () => {
        const m = S.order[b];
        const rest = b > 0 ? `<p class="center">수고하셨습니다. 잠시 쉬었다가 준비되면 시작해 주세요.</p>` : "";
        return page(`${progressBar(b * perBlock, total, `본실험 · 묶음 ${b + 1} / ${MODALITIES.length}`)}
          <h2 class="center">묶음 ${b + 1}</h2>${rest}
          <p class="center">이번 묶음의 클립 ${perBlock}개는 <b>${C.MODALITY_LABELS[m]}</b>으로 제시됩니다.</p>`);
      },
      choices: ["시작"],
    });
    for (let k = 0; k < perBlock; k++) {
      const idx = b * perBlock + k;
      tl.push(...clipUnit(() => S.sequence[idx], total));
    }
  }

  // 저장
  tl.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: page(`<p class="center" style="font-size:20px;margin:18px 0">응답을 저장하고 있습니다… 창을 닫지 말아 주세요.</p>`),
    choices: "NO_KEYS",
    trial_duration: 300,
  });
  tl.push({ type: jsPsychCallFunction, async: true, func: (done) => saveAll().then(done) });
  tl.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => {
      if (S.saveOk) return page(`<h2>실험이 끝났습니다</h2>
        <p>참여해 주셔서 감사합니다. 응답이 저장되었습니다.</p>
        <p class="note">이제 창을 닫으셔도 됩니다.</p>`, true);
      const links = S.files.map((f) => downloadLink(f)).join("<br>");
      return page(`<h2>실험이 끝났습니다</h2>
        <p class="warn">응답을 서버에 저장하지 못했습니다.</p>
        <p>아래 파일 3개를 눌러 내려받은 뒤, 실험 진행자에게 보내 주세요.</p><p>${links}</p>`, true);
    },
    choices: "NO_KEYS",
  });
  return tl;
}

// =====================================================================
//  데이터 저장
// =====================================================================
function buildFiles() {
  const end = new Date();
  const participant = [{
    // 익명성을 위해 시작·종료 시각과 브라우저 정보는 저장하지 않고 소요 시간만 남김
    participant: S.code, pilot: S.pilot ? 1 : 0, age_group: S.ageGroup, gender: S.gender,
    block_order_id: S.orderId, block_order: S.order.join(">"), assignment: S.assignment,
    duration_min: ((end - S.startTime) / 60000).toFixed(1),
    practice_correct: S.practiceCorrect, practice_total: S.practiceTotal,
    soundcheck_attempts: S.soundcheckAttempts,
    tab_away_total: WATCH.away, fullscreen_exits: WATCH.fsExits,
    font_loaded: S.fontOk ? 1 : 0,
    audio_output_latency_ms: Math.round(((AUDIO.ctx.outputLatency || 0) + (AUDIO.ctx.baseLatency || 0)) * 1000),
    screen: `${screen.width}x${screen.height}`, version: C.EXPERIMENT_VERSION,
  }];
  const tag = S.code;   // 파일 이름에도 시각을 넣지 않음
  return [
    { name: `${tag}_trials.csv`, data: toCSV(S.trialRows, ["participant", "phase", "block_order_id", "block_no", "modality", "n_items", "clip_no", "question_no", "item_id", "item", "correct_answer", "response", "correct", "rt_ms", "timeout"]) },
    { name: `${tag}_clips.csv`, data: toCSV(S.clipRows, ["participant", "phase", "block_order_id", "block_no", "modality", "n_items", "clip_no", "rating", "rating_rt_ms", "away_during_clip", "fullscreen_exit_during_clip", "sub_lag_mean_ms", "sub_lag_max_ms", "items_in_order"]) },
    { name: `${tag}_participant.csv`, data: toCSV(participant, Object.keys(participant[0])) },
  ];
}
function downloadLink(f) {
  const url = URL.createObjectURL(new Blob([f.data], { type: "text/csv;charset=utf-8" }));
  return `<a href="${url}" download="${f.name}">${f.name}</a>`;
}
async function sendToDataPipe(f) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://pipe.jspsych.org/api/data/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "*/*" },
        body: JSON.stringify({ experimentID: C.DATAPIPE_ID, filename: f.name, data: f.data }),
      });
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (res.ok && body && !body.error) return true;
      console.warn("DataPipe 응답:", res.status, body);
    } catch (e) { console.warn(e); }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}
async function saveAll() {
  S.files = buildFiles();
  window.removeEventListener("beforeunload", warnLeave);
  if (!C.DATAPIPE_ID) {
    // 테스트 모드: 내 컴퓨터로 바로 다운로드
    for (const f of S.files) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([f.data], { type: "text/csv;charset=utf-8" }));
      a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      await new Promise((r) => setTimeout(r, 400));
    }
    S.saveOk = true;
    return;
  }
  const results = await Promise.all(S.files.map(sendToDataPipe));
  S.saveOk = results.every(Boolean);
}
function warnLeave(e) { e.preventDefault(); e.returnValue = ""; }

// =====================================================================
//  시작: 기기 확인 → 항목 목록·음성 불러오기 → 실험 실행
// =====================================================================
function stopWith(html) {
  document.body.innerHTML = `<div class="stopped box">${EYEBROW}${html}</div>`;
}
async function main() {
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const tooSmall = screen.width > 0 && (screen.width < 960 || screen.height < 600);  // 0 = 크기를 알 수 없음
  if (isMobile || tooSmall) {
    return stopWith(`<h2>컴퓨터로 접속해 주세요</h2>
      <p>이 실험은 모든 참가자가 같은 화면 크기에서 보도록 <b>컴퓨터(노트북·데스크톱)</b>로만 참여할 수 있습니다.
      같은 링크를 컴퓨터에서 열어 주세요.</p>
      <p class="note">(감지된 화면: ${screen.width}×${screen.height})</p>`);
  }
  const bar = document.getElementById("loading-bar");
  const label = document.getElementById("loading-text");
  try {
    const items = parseCSV(await fetchText("stimuli/items.csv")).map((r) => ({ ...r, audio: `stimuli/${r.audio}` }));
    const errs = checkItems(items);
    if (errs.length) return stopWith(`<h2>항목 목록(items.csv)에 문제가 있습니다</h2><ul>${errs.map((e) => `<li>${e}</li>`).join("")}</ul>`);
    S.mainItems = items.filter((r) => r.set === "main");
    S.practiceItems = items.filter((r) => r.set === "practice");

    const paths = [...items.map((r) => r.audio), ...Object.keys(C.SOUNDCHECK_WORDS).map((k) => `stimuli/audio/soundcheck/${k}.wav`)];
    let n = 0;
    label.textContent = "음성 파일을 불러오고 있습니다…";
    await Promise.all(paths.map((p) => AUDIO.load(p).then(() => { bar.style.width = `${(++n / paths.length) * 100}%`; })));
    try {
      await document.fonts.load('500 40px "Noto Sans KR"');
      S.fontOk = document.fonts.check('500 40px "Noto Sans KR"');
    } catch { S.fontOk = false; }
  } catch (e) {
    return stopWith(`<h2>실험을 불러오지 못했습니다</h2><p>인터넷 연결을 확인하고 새로고침(F5)해 주세요.</p><p class="note">${e.message}</p>`);
  }
  document.getElementById("loading").remove();
  window.addEventListener("beforeunload", warnLeave);
  jsPsych.run(buildTimeline());
}
main();
