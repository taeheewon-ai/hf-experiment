// =====================================================================
//  직접 만든 과제 화면 2개: 클립 재생(ClipPlugin), 소리 테스트(SoundCheckPlugin)
// =====================================================================
const PT = jsPsychModule.ParameterType;

// ---- 오디오: 모든 소리는 Web Audio 시계 하나로 예약 재생합니다(정확한 동기화용) ----
const AUDIO = {
  ctx: new (window.AudioContext || window.webkitAudioContext)(),
  buffers: {},   // 파일 경로 → 디코딩된 소리
  async load(path) {
    const res = await fetch(path, { cache: "no-cache" });   // 바뀐 음성 파일이 있으면 새로 받음
    if (!res.ok) throw new Error(`음성 파일을 찾을 수 없습니다: ${path}`);
    const data = await res.arrayBuffer();
    // 옛 Safari는 콜백 방식만 지원하므로 두 방식 모두 처리
    this.buffers[path] = await new Promise((ok, fail) => {
      const p = this.ctx.decodeAudioData(data, ok, fail);
      if (p && p.then) p.then(ok, fail);
    });
  },
  // 사용자가 클릭·키 입력을 할 때마다 호출: Safari 등은 이때만 소리 재생을 허락함
  unlock() {
    const ctx = this.ctx;
    if (ctx.state === "running") return;
    try { ctx.resume(); } catch (e) { /* 무시 */ }
    try {   // 아주 짧은 무음을 한 번 재생하면 Safari에서 소리가 확실히 풀림
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* 무시 */ }
  },
  // 소리 재생 준비. 브라우저가 응답하지 않아도 0.5초 이상 기다리지 않음(화면이 멈추지 않게)
  async resume() {
    if (this.ctx.state === "running") return;
    try { await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 500))]); } catch (e) { /* 무시 */ }
  },
  play(path, when = 0) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[path];
    src.connect(this.ctx.destination);
    src.start(when);
    return src;
  },
  // 지금 스피커/이어폰에서 실제로 나오고 있는 소리의 시각(오디오 시계 기준, 초)
  audibleTime() {
    const ctx = this.ctx;
    if (ctx.getOutputTimestamp) {
      const ts = ctx.getOutputTimestamp();
      const age = performance.now() - ts.performanceTime;
      // 값이 이상하면(브라우저마다 다름) 쓰지 않고 아래 방식으로 계산
      if (ts.contextTime > 0 && ts.performanceTime > 0 && age >= 0 && age < 1000) {
        return ts.contextTime + age / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  },
};
["pointerdown", "keydown", "touchend", "click"].forEach((ev) =>
  document.addEventListener(ev, () => AUDIO.unlock(), true));

// ---- 참가자가 창을 벗어난 횟수(다른 탭/창으로 이동) ----
const WATCH = { away: 0, fsExits: 0 };
document.addEventListener("visibilitychange", () => { if (document.hidden) WATCH.away++; });
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) WATCH.fsExits++; });

// =====================================================================
//  클립 재생: 정해진 시간(기본 20초) 동안 항목을 차례로 제시. 멈춤/되감기 불가.
//  자막과 음성은 같은 오디오 시계로 맞춰서 동시에 나옵니다.
// =====================================================================
class ClipPlugin {
  static info = {
    name: "clip",
    version: "1.0.0",
    parameters: {
      get_clip: { type: PT.FUNCTION, default: undefined },   // () => { items, modality }
      clip_seconds: { type: PT.FLOAT, default: 30 },
      lead_in: { type: PT.FLOAT, default: 1.0 },              // 시작 전 '+'만 보이는 시간(초)
    },
    data: {},
  };
  constructor(jsPsych) { this.jsPsych = jsPsych; }

  // 주의: async 로 만들면 jsPsych 가 시행이 바로 끝난 것으로 처리하므로 일반 함수로 둡니다.
  trial(el, trial) {
    AUDIO.resume().then(() => {
      if (AUDIO.ctx.state === "running") return this.run(el, trial);
      // 브라우저가 소리를 막고 있으면(주로 Safari) 클릭 한 번으로 풀고 시작
      el.innerHTML = `<div class="box center"><h2>소리 켜기</h2>
        <p>브라우저가 소리 재생을 막고 있습니다. 아래 버튼을 누르면 클립이 시작됩니다.</p>
        <button class="jspsych-btn" id="unlock">소리 켜고 시작</button></div>`;
      el.querySelector("#unlock").addEventListener("click", () => {
        AUDIO.unlock();
        AUDIO.resume().then(() => this.run(el, trial));
      });
    });
  }

  run(el, trial) {
    const clip = trial.get_clip();
    const items = clip.items;
    const slot = trial.clip_seconds / items.length;          // 항목당 시간(5초 또는 2.5초)
    const showSub = clip.modality !== "audio";
    const playAudio = clip.modality !== "subtitle";

    document.body.classList.add("clip-mode");   // 클립 동안은 카드 없이 어두운 배경
    el.innerHTML = `<div class="stage"><div class="fix">+</div><div class="sub" id="sub"></div></div>`;
    const sub = el.querySelector("#sub");

    const awayStart = WATCH.away, fsStart = WATCH.fsExits;
    const t0 = AUDIO.ctx.currentTime + trial.lead_in;        // 첫 항목 시작 시각
    if (playAudio) items.forEach((it, i) => AUDIO.play(it.audio, t0 + i * slot));

    const lags = [];
    let shown = -1, done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.body.classList.remove("clip-mode");
      sub.textContent = "";
      const mean = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : "";
      this.jsPsych.finishTrial({
        clip_away: WATCH.away - awayStart,
        clip_fs_exit: WATCH.fsExits - fsStart,
        sub_lag_mean_ms: mean === "" ? "" : Math.round(mean),
        sub_lag_max_ms: lags.length ? Math.round(Math.max(...lags)) : "",
      });
    };
    const update = () => {
      if (done) return;
      const t = AUDIO.audibleTime() - t0;                     // 첫 항목 시작 후 경과 시간(초)
      if (t >= trial.clip_seconds) return finish();
      if (t >= 0 && showSub) {
        const idx = Math.min(items.length - 1, Math.floor(t / slot));
        if (idx !== shown) {
          shown = idx;
          const it = items[idx];
          sub.textContent = `${it.name} – ${it.process}`;
          lags.push((t - idx * slot) * 1000);                 // 음성 시작보다 자막이 늦은 정도(ms)
        }
      }
    };
    // 화면이 새로 그려질 때마다 확인(보통 1/60초마다) + 보조 타이머(10ms마다)
    const tick = () => { update(); if (!done) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const timer = setInterval(() => (done ? clearInterval(timer) : update()), 10);
    // 다른 탭으로 가서 화면 갱신이 멈춰도 클립은 제시간에 끝나도록
    const ms = (t0 - AUDIO.ctx.currentTime + trial.clip_seconds) * 1000 + 300;
    this.jsPsych.pluginAPI.setTimeout(finish, ms);
  }
}

// =====================================================================
//  소리 테스트: 단어를 듣고 4개 중에서 고르기
// =====================================================================
class SoundCheckPlugin {
  static info = {
    name: "sound-check",
    version: "1.0.0",
    parameters: {
      words: { type: PT.OBJECT, default: undefined },   // { key: "사과", ... }
      target: { type: PT.STRING, default: undefined },  // 들려줄 단어의 key
      message: { type: PT.HTML_STRING, default: "" },
    },
    data: {},
  };
  constructor(jsPsych) { this.jsPsych = jsPsych; }

  trial(el, trial) {
    const keys = Object.keys(trial.words);
    el.innerHTML = `
      <div class="box">
        <div class="eyebrow">${CONFIG.COURSE_LABEL}</div>
        <h2>소리 테스트</h2>
        ${trial.message}
        <p><b>[소리 듣기]</b>를 누르면 단어 하나가 들립니다. 여러 번 들어도 됩니다.<br>
        소리가 <b>편하게 잘 들리도록 컴퓨터 음량을 조절</b>한 뒤, 들린 단어를 골라 주세요.</p>
        <p class="note">여기서 맞춘 음량은 실험이 끝날 때까지 바꾸지 말아 주세요.</p>
      </div>
      <div class="center" style="margin-top:22px">
        <button class="jspsych-btn play-btn" id="play">🔊 소리 듣기</button>
        <div class="sc-choices">
        ${keys.map((k) => `<button class="jspsych-btn choice-btn" data-k="${k}" disabled>${trial.words[k]}</button>`).join("")}
        </div>
      </div>`;
    let plays = 0;
    el.querySelector("#play").addEventListener("click", () => {
      // 기다리지 않고 바로 처리: 클릭 안에서 소리를 풀고 재생해야 Safari에서도 들리고, 버튼도 바로 켜짐
      AUDIO.unlock();
      AUDIO.play(`stimuli/audio/soundcheck/${trial.target}.wav`);
      plays++;
      el.querySelectorAll("[data-k]").forEach((b) => (b.disabled = false));
    });
    el.querySelectorAll("[data-k]").forEach((b) =>
      b.addEventListener("click", () => {
        this.jsPsych.finishTrial({ sc_target: trial.target, sc_response: b.dataset.k, sc_correct: b.dataset.k === trial.target, sc_plays: plays });
      })
    );
  }
}
