// =====================================================================
//  실험 설정 파일 — 바꿀 일이 있는 값은 모두 여기에 모아 두었습니다.
// =====================================================================
const CONFIG = {
  // DataPipe 에서 받은 "Experiment ID" 를 따옴표 안에 붙여 넣으세요.
  // 비워 두면 "테스트 모드": 데이터가 서버로 가지 않고 내 컴퓨터로 CSV 파일이 다운로드됩니다.
  DATAPIPE_ID: "m3DWHYvdkTa4",

  EXPERIMENT_VERSION: "6.0",

  // 화면에 보이는 이름
  EXPERIMENT_TITLE: "숏폼 학습 콘텐츠 정보 전달 실험",
  COURSE_LABEL: "2026-2 인간공학실험 · 3조",
  AGE_GROUPS: ["10대", "20대", "30대", "40대", "50대 이상"],

  // 클립 설정
  CLIP_SECONDS: 20,             // 클립 길이(초)
  ITEM_COUNTS: [3, 6],          // 항목 수 조건 → 항목당 약 6.67초 / 3.33초 (20초 클립)
  CLIPS_PER_N: { 3: 4, 6: 2 },  // 조건당 클립 수 (3개×4클립 = 6개×2클립 = 조건당 12문항)
  PRACTICE_CLIPS: [3, 6],       // 연습 클립 항목 수 (자막+음성, 이 순서대로)
  EST_MINUTES: "약 15분",       // 안내 화면에 보이는 예상 소요 시간

  // 문제 설정
  QUESTION_TIME_LIMIT_MS: 10000,   // 문제당 제한 시간(ms). 10000 = 10초
  GAP_BETWEEN_QUESTIONS_MS: 250,   // 문제 사이 빈 화면(ms)
  TRANSITION_MS: 500,              // 클립이 끝나고 "문제가 나옵니다" 안내를 보여 주는 시간(ms)
  PROCESSES: ["해공정", "달공정", "별공정", "숲공정"],  // 보기 순서(항상 이 순서)

  // 자기보고 문항
  RATING_QUESTION: "제시된 정보를 끝까지 따라갈 수 있었다.",
  RATING_LABELS: ["1", "2", "3", "4", "5"],
  RATING_ENDS: ["전혀 그렇지 않다", "매우 그렇다"],

  // 소리 테스트 단어 (tools/make_audio.py 의 SOUNDCHECK_WORDS 와 같아야 함)
  SOUNDCHECK_WORDS: { apple: "사과", sea: "바다", pencil: "연필", cloud: "구름" },

  // 블록 순서 6가지. 참가자 번호로 정해짐: 1번→1, 2번→2, … 6번→6, 7번→1 …
  // subtitle = 자막만, audio = 음성만, both = 자막+음성
  BLOCK_ORDERS: [
    ["subtitle", "audio", "both"],
    ["subtitle", "both", "audio"],
    ["audio", "subtitle", "both"],
    ["audio", "both", "subtitle"],
    ["both", "subtitle", "audio"],
    ["both", "audio", "subtitle"],
  ],
  MODALITY_LABELS: { subtitle: "자막만", audio: "음성만", both: "자막 + 음성" },
};
