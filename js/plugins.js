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
    this.buffers[path] = await this.ctx.decodeAudioData(await res.arrayBuffer());
  },
  async resume() {
    if (this.ctx.state !== "running") await this.ctx.resume();
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
      if (ts.contextTime > 0 && ts.performanceTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  },
};

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
    AUDIO.resume().then(() => this.run(el, trial));
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
    el.querySelector("#play").addEventListener("click", async () => {
      await AUDIO.resume();
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
