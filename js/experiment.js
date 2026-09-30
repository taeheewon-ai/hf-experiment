// =====================================================================
//  실험 진행 순서와 데이터 기록
// =====================================================================
const C = CONFIG;
const MODALITIES = ["subtitle", "audio", "both"];

// 참가자 한 명의 모든 정보가 여기에 모입니다.
const S = {
  pid: null, age: "", gender: "", orderId: null, order: null,
  mainItems: [], practiceItems: [],
  sequence: [],        // 본실험 클립 12개(보는 순서대로)
  practiceClip: null,
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
const stamp = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const page = (html) => `<div class="box">${html}</div>`;

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
  const need = MODALITIES.length * C.CLIPS_PER_CONDITION * C.ITEM_COUNTS.reduce((a, b) => a + b, 0);
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
  if (!prac.length) errs.push("연습(practice) 항목이 없습니다.");
  return errs;
}

// ---------- 참가자별 클립 구성 ----------
//  · 항목 이름을 조건에 무작위로 나눠 줌(참가자마다 다름)
//  · 한 조건의 두 클립을 합치면 네 공정이 같은 횟수
//  · 블록(제시 방식) 순서는 참가자 번호로, 블록 안 클립 순서는 무작위
function buildSequence() {
  const pools = {};
  for (const p of C.PROCESSES) pools[p] = shuffle(S.mainItems.filter((r) => r.process === p));
  const conditions = {};   // "audio|6" → [클립1 항목들, 클립2 항목들]
  for (const m of MODALITIES) {
    for (const n of C.ITEM_COUNTS) {
      const perProc = (n * C.CLIPS_PER_CONDITION) / C.PROCESSES.length;
      // 공정별로 뽑아 이어 붙인 뒤 클립1, 클립2, 클립1 … 번갈아 나눔 → 두 클립 크기가 같고 공정이 고르게 퍼짐
      const dealt = shuffle(C.PROCESSES).flatMap((p) => pools[p].splice(0, perProc));
      const clips = Array.from({ length: C.CLIPS_PER_CONDITION }, () => []);
      dealt.forEach((it, i) => clips[i % C.CLIPS_PER_CONDITION].push(it));
      conditions[`${m}|${n}`] = clips.map(shuffle);
    }
  }
  S.sequence = [];
  S.order.forEach((m, b) => {
    const blockClips = [];
    for (const n of C.ITEM_COUNTS) for (const items of conditions[`${m}|${n}`]) blockClips.push({ modality: m, n, items });
    shuffle(blockClips).forEach((c) => S.sequence.push({ ...c, block: b + 1, phase: "main" }));
  });
  S.sequence.forEach((c, i) => { c.clipNo = i + 1; c.qOrder = shuffle(c.items); });

  const pi = shuffle(S.practiceItems);
  S.practiceClip = { modality: "both", n: pi.length, items: pi, block: 0, clipNo: 0, phase: "practice", qOrder: shuffle(pi) };
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
      const title = practice() ? "연습 클립" : `클립 ${c.clipNo} / ${total}`;
      return page(`<h2>${title}</h2>
        <p style="text-align:center">준비되면 <b>[시작]</b>을 눌러 주세요.<br>
        화면 가운데 <b>+</b> 가 나오고 1초 뒤 ${C.CLIP_SECONDS}초 동안 항목이 제시됩니다.<br>
        <span class="note">클립은 멈추거나 다시 볼 수 없어요.</span></p>`);
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
    stimulus: page(`<p style="text-align:center;font-size:22px">이제 방금 나온 항목에 대한 문제가 나옵니다.</p>`),
    choices: "NO_KEYS",
    trial_duration: C.TRANSITION_MS,
  };

  let q = 0;
  const question = {
    type: jsPsychHtmlButtonResponse,
    stimulus: () => `<div class="question">${withIGa(getClip().qOrder[q].name)} 속하는 공정은?</div>`,
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
        participant: S.pid, phase: c.phase, block_order_id: S.orderId, block_no: c.block,
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
      if (d.timeout) return `<p class="feedback no">시간 초과! (정답: ${d.answer})</p><p class="note">문제마다 ${C.QUESTION_TIME_LIMIT_MS / 1000}초 안에 답해 주세요.</p>`;
      return d.correct ? `<p class="feedback ok">정답입니다!</p>` : `<p class="feedback no">틀렸어요. 정답은 ${d.answer}입니다.</p>`;
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
    stimulus: page(`<p style="text-align:center">방금 본 클립에 대해 답해 주세요.</p>
      <div class="question" style="text-align:center">${C.RATING_QUESTION}</div>`),
    choices: C.RATING_LABELS,
    button_html: (choice) => `<button class="jspsych-btn rating-btn">${choice}</button>`,
    on_finish: (d) => {
      const c = getClip(), cd = c.clipData || {};
      S.clipRows.push({
        participant: S.pid, phase: c.phase, block_order_id: S.orderId, block_no: c.block,
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

  tl.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: page(`<h2>학습 콘텐츠 인식 실험</h2>
      <p>참여해 주셔서 감사합니다. 실험은 약 <b>10~15분</b> 걸립니다.</p>
      <ul>
        <li>짧은 클립(${C.CLIP_SECONDS}초)을 보거나 듣고, 방금 나온 내용을 얼마나 정확히 알아보는지 답하는 실험이에요.</li>
        <li><b>조용한 곳</b>에서, <b>이어폰이나 스피커로 소리를 들을 수 있는 컴퓨터</b>로 참여해 주세요.</li>
        <li>실험 중에는 다른 창이나 탭으로 이동하지 말아 주세요.</li>
        <li>중간에 창을 닫으면 처음부터 다시 해야 해요.</li>
      </ul>`),
    choices: ["다음"],
  });

  // 참가자 정보 (번호 확인 화면을 거쳐, 잘못 입력했으면 다시 입력)
  const info = {
    type: jsPsychSurveyHtmlForm,
    preamble: `<h2>참가자 정보</h2>`,
    html: `<div class="form">
      <div class="row">참가자 번호 <input name="pid" type="number" min="1" max="9999" step="1" required> <span class="note">(안내받은 번호)</span></div>
      <div class="row">나이 <input name="age" type="number" min="10" max="99" step="1" required> 세</div>
      <div class="row">성별
        <label><input type="radio" name="gender" value="남" required> 남</label>
        <label><input type="radio" name="gender" value="여"> 여</label>
        <label><input type="radio" name="gender" value="응답하지 않음"> 응답하지 않음</label></div>
      <label class="check"><input type="checkbox" name="normal" required>
        <span>시력(안경·렌즈 교정 포함)과 청력이 정상입니다.</span></label>
    </div>`,
    button_label: "다음",
    on_finish: (d) => {
      S.pid = parseInt(d.response.pid, 10);
      S.age = d.response.age;
      S.gender = d.response.gender;
    },
  };
  const confirmPid = {
    type: jsPsychHtmlButtonResponse,
    stimulus: () => page(`<p style="text-align:center;font-size:22px">참가자 번호가 <b>${S.pid}번</b> 맞나요?</p>`),
    choices: ["맞아요", "다시 입력할게요"],
  };
  tl.push({
    timeline: [info, confirmPid],
    loop_function: (data) => data.values()[1].response === 1,
  });
  tl.push({
    type: jsPsychCallFunction,
    func: () => {
      S.orderId = ((S.pid - 1) % C.BLOCK_ORDERS.length) + 1;
      S.order = C.BLOCK_ORDERS[S.orderId - 1];
      buildSequence();
    },
  });

  tl.push({
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: page(`<p style="text-align:center">실험은 <b>전체 화면</b>에서 진행됩니다.<br>아래 버튼을 눌러 주세요.</p>`),
    button_label: "전체 화면으로 시작",
    on_finish: () => AUDIO.resume(),
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
        ? `<p class="warn">앗, 다른 단어였어요. 볼륨을 조금 올리고 다시 들어 주세요.</p>` : "",
      on_finish: () => { S.soundcheckAttempts++; },
    }],
    loop_function: (data) => !data.values()[0].sc_correct,
  });

  tl.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: page(`<h2>과제 안내</h2>
      <p>화면에 <b>'가상의 가공법 이름 – 공정 분류'</b> 쌍이 ${C.CLIP_SECONDS}초 동안 차례로 제시됩니다. 예: <b>펄디법 – ${C.PROCESSES[0]}</b></p>
      <ul>
        <li>공정 분류는 <b>${C.PROCESSES.join(", ")}</b> 네 가지뿐이에요.</li>
        <li>클립에 따라 <b>자막만</b>, <b>음성만</b>, 또는 <b>자막과 음성이 함께</b> 나옵니다.</li>
        <li>클립이 끝나면 방금 나온 각 가공법이 어느 공정에 속했는지 고르는 문제가 나와요.</li>
        <li>문제마다 <b>${C.QUESTION_TIME_LIMIT_MS / 1000}초 안에</b>, 되도록 <b>빠르고 정확하게</b> 마우스로 답해 주세요.</li>
        <li>문제를 다 풀면 클립이 얼마나 따라가기 쉬웠는지 1~5점으로 답합니다.</li>
      </ul>
      <p>먼저 <b>연습</b>을 한 번 해 볼게요. 연습에서는 정답을 알려 드려요.</p>`),
    choices: ["연습 시작"],
  });
  tl.push(...clipUnit(() => S.practiceClip, 0));
  tl.push({
    type: jsPsychHtmlButtonResponse,
    stimulus: () => page(`<h2>연습 끝</h2>
      <p style="text-align:center">연습에서 ${S.practiceTotal}문제 중 ${S.practiceCorrect}문제를 맞혔어요.</p>
      <p>이제 본실험을 시작합니다. 본실험은 클립 <b>12개</b>를 <b>3개 묶음</b>으로 나눠 진행하고,
      <b>정답은 알려 드리지 않아요</b>. 묶음 사이에 쉴 수 있어요.</p>`),
    choices: ["본실험 시작"],
  });

  // 본실험: 블록 3개 × 클립 4개
  const perBlock = C.ITEM_COUNTS.length * C.CLIPS_PER_CONDITION;
  const total = MODALITIES.length * perBlock;
  for (let b = 0; b < MODALITIES.length; b++) {
    tl.push({
      type: jsPsychHtmlButtonResponse,
      stimulus: () => {
        const m = S.order[b];
        const rest = b > 0 ? `<p style="text-align:center">수고하셨어요! 잠시 쉬었다가 준비되면 시작해 주세요.</p>` : "";
        return page(`<h2>묶음 ${b + 1} / ${MODALITIES.length}</h2>${rest}
          <p style="text-align:center">이번 묶음의 클립 ${perBlock}개는 <b>${C.MODALITY_LABELS[m]}</b>으로 제시됩니다.</p>`);
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
    stimulus: page(`<p style="text-align:center;font-size:22px">응답을 저장하고 있어요… 창을 닫지 말아 주세요.</p>`),
    choices: "NO_KEYS",
    trial_duration: 300,
  });
  tl.push({ type: jsPsychCallFunction, async: true, func: (done) => saveAll().then(done) });
  tl.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: () => {
      if (S.saveOk) return page(`<h2>실험이 끝났습니다. 감사합니다!</h2>
        <p style="text-align:center">응답이 저장되었어요. 이제 창을 닫아도 됩니다.</p>`);
      const links = S.files.map((f) => downloadLink(f)).join("<br>");
      return page(`<h2>실험이 끝났습니다. 감사합니다!</h2>
        <p class="warn">응답을 서버에 저장하지 못했어요.</p>
        <p>아래 파일 3개를 눌러 내려받은 뒤, 실험 진행자에게 보내 주세요.</p><p>${links}</p>`);
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
    participant: S.pid, age: S.age, gender: S.gender,
    block_order_id: S.orderId, block_order: S.order.join(">"),
    start_time: stamp(S.startTime), end_time: stamp(end),
    duration_min: ((end - S.startTime) / 60000).toFixed(1),
    practice_correct: S.practiceCorrect, practice_total: S.practiceTotal,
    soundcheck_attempts: S.soundcheckAttempts,
    tab_away_total: WATCH.away, fullscreen_exits: WATCH.fsExits,
    font_loaded: S.fontOk ? 1 : 0,
    audio_output_latency_ms: Math.round(((AUDIO.ctx.outputLatency || 0) + (AUDIO.ctx.baseLatency || 0)) * 1000),
    screen: `${screen.width}x${screen.height}`, window: `${innerWidth}x${innerHeight}`,
    browser: navigator.userAgent, version: C.EXPERIMENT_VERSION,
  }];
  const tag = `P${String(S.pid).padStart(3, "0")}_${stamp(S.startTime).replace(/[-: ]/g, "")}_${Math.random().toString(36).slice(2, 6)}`;
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
  document.body.innerHTML = `<div class="box" style="margin-top:20vh">${html}</div>`;
}
async function main() {
  const ua = navigator.userAgent;
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const tooSmall = screen.width > 0 && (screen.width < 960 || screen.height < 600);  // 0 = 크기를 알 수 없음
  if (isMobile || tooSmall) {
    return stopWith(`<h2>컴퓨터로 접속해 주세요</h2>
      <p>이 실험은 모든 참가자가 같은 화면 크기에서 보도록 <b>컴퓨터(노트북·데스크톱)</b>로만 참여할 수 있어요.
      같은 링크를 컴퓨터에서 열어 주세요.</p>
      <p class="note">(감지된 화면: ${screen.width}×${screen.height})</p>`);
  }
  const bar = document.getElementById("loading-bar");
  const label = document.getElementById("loading-text");
  try {
    const items = parseCSV(await fetchText("stimuli/items.csv")).map((r) => ({ ...r, audio: `stimuli/${r.audio}` }));
    const errs = checkItems(items);
    if (errs.length) return stopWith(`<h2>항목 목록(items.csv)에 문제가 있어요</h2><ul>${errs.map((e) => `<li>${e}</li>`).join("")}</ul>`);
    S.mainItems = items.filter((r) => r.set === "main");
    S.practiceItems = items.filter((r) => r.set === "practice");

    const paths = [...items.map((r) => r.audio), ...Object.keys(C.SOUNDCHECK_WORDS).map((k) => `stimuli/audio/soundcheck/${k}.wav`)];
    let n = 0;
    label.textContent = "음성 파일을 불러오고 있어요…";
    await Promise.all(paths.map((p) => AUDIO.load(p).then(() => { bar.style.width = `${(++n / paths.length) * 100}%`; })));
    try {
      await document.fonts.load('500 40px "Noto Sans KR"');
      S.fontOk = document.fonts.check('500 40px "Noto Sans KR"');
    } catch { S.fontOk = false; }
  } catch (e) {
    return stopWith(`<h2>실험을 불러오지 못했어요</h2><p>인터넷 연결을 확인하고 새로고침(F5)해 주세요.</p><p class="note">${e.message}</p>`);
  }
  document.getElementById("loading").remove();
  window.addEventListener("beforeunload", warnLeave);
  jsPsych.run(buildTimeline());
}
main();
