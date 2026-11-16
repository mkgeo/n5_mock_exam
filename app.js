(function () {
  "use strict";

  const TOTAL_SETS = 100;
  const STORAGE_KEY = "jlpt_n5_set_records_v1";

  // State
  const state = {
    mode: "practice", // 'practice' | 'exam'
    sectionFilter: "all",
    selectedSet: "1", // "1".."100" | "random"
    currentSetLabel: "第 1 回",
    questions: [],
    currentIndex: 0,
    answers: {}, // { [questionId]: optionIndex }
    flagged: new Set(),
    timerSeconds: 0,
    timerInterval: null,
    startTime: null,
    isSubmitted: false
  };

  // DOM Elements
  const views = {
    start: document.getElementById("startView"),
    quiz: document.getElementById("quizView"),
    result: document.getElementById("resultView")
  };

  const els = {
    brandHome: document.getElementById("brandHome"),
    headerActions: document.getElementById("headerActions"),
    examSetSelect: document.getElementById("examSetSelect"),
    randomSetBtn: document.getElementById("randomSetBtn"),
    modeSelector: document.getElementById("modeSelector"),
    sectionSelector: document.getElementById("sectionSelector"),
    startBtn: document.getElementById("startBtn"),

    qSectionBadge: document.getElementById("qSectionBadge"),
    qTypeLabel: document.getElementById("qTypeLabel"),
    qCounter: document.getElementById("qCounter"),
    flagBtn: document.getElementById("flagBtn"),
    flagIcon: document.getElementById("flagIcon"),
    progressFill: document.getElementById("progressFill"),

    passageBox: document.getElementById("passageBox"),
    passageContent: document.getElementById("passageContent"),
    listeningBox: document.getElementById("listeningBox"),
    playAudioBtn: document.getElementById("playAudioBtn"),
    audioStatus: document.getElementById("audioStatus"),
    toggleTranscriptBtn: document.getElementById("toggleTranscriptBtn"),
    transcriptBox: document.getElementById("transcriptBox"),

    qInstruction: document.getElementById("qInstruction"),
    qPrompt: document.getElementById("qPrompt"),
    optionsList: document.getElementById("optionsList"),

    explanationBox: document.getElementById("explanationBox"),
    explanationHeader: document.getElementById("explanationHeader"),
    explanationBody: document.getElementById("explanationBody"),
    explanationKeypoints: document.getElementById("explanationKeypoints"),

    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    answeredSummary: document.getElementById("answeredSummary"),
    paletteGrid: document.getElementById("paletteGrid"),
    submitExamBtn: document.getElementById("submitExamBtn"),

    scoreCircle: document.getElementById("scoreCircle"),
    scoreNum: document.getElementById("scoreNum"),
    scoreFraction: document.getElementById("scoreFraction"),
    verdictBadge: document.getElementById("verdictBadge"),
    verdictTitle: document.getElementById("verdictTitle"),
    verdictDesc: document.getElementById("verdictDesc"),
    resultMetaStats: document.getElementById("resultMetaStats"),
    sectionBreakdown: document.getElementById("sectionBreakdown"),
    retryWrongBtn: document.getElementById("retryWrongBtn"),
    restartBtn: document.getElementById("restartBtn"),
    reviewFilters: document.getElementById("reviewFilters"),
    reviewList: document.getElementById("reviewList")
  };

  // Helpers
  function switchView(name) {
    Object.keys(views).forEach((key) => {
      views[key].classList.toggle("active", key === name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatTime(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function stopSpeech() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // Seeded PRNG & Set Generation
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededShuffle(arr, rng) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function loadSetRecords() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveSetRecord(setKey, pct) {
    if (!setKey || setKey === "random") return;
    try {
      const records = loadSetRecords();
      const prev = records[setKey];
      records[setKey] = prev !== undefined ? Math.max(prev, pct) : pct;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Ignore storage errors
    }
  }

  function populateSetSelector() {
    const records = loadSetRecords();
    const prevValue = state.selectedSet || "1";
    els.examSetSelect.innerHTML = "";

    const randomOpt = document.createElement("option");
    randomOpt.value = "random";
    randomOpt.textContent = "🎲 隨機組卷（每次從 140 題隨機抽 28 題）";
    els.examSetSelect.appendChild(randomOpt);

    for (let i = 1; i <= TOTAL_SETS; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      const best = records[String(i)];
      opt.textContent = best !== undefined ? `第 ${i} 回（已完成・最高 ${best}%）` : `第 ${i} 回`;
      els.examSetSelect.appendChild(opt);
    }

    els.examSetSelect.value = prevValue;
  }

  function generateExamSet(setKey) {
    if (setKey === "1") {
      return JLPT_N5_QUESTIONS.slice(0, 28);
    }
    const seed =
      setKey === "random"
        ? Math.floor(Math.random() * 0xffffffff)
        : Number(setKey) * 2654435761 + 1013904223;
    const rng = mulberry32(seed);

    const pick = (section, count) => {
      const pool = JLPT_N5_QUESTIONS.filter((q) => q.section === section);
      return seededShuffle(pool, rng).slice(0, count);
    };

    return [
      ...pick("vocab", 10),
      ...pick("grammar", 10),
      ...pick("reading", 5),
      ...pick("listening", 3)
    ];
  }

  // Start Screen Setup
  populateSetSelector();

  els.examSetSelect.addEventListener("change", (e) => {
    state.selectedSet = e.target.value;
  });

  els.randomSetBtn.addEventListener("click", () => {
    const randomNum = Math.floor(Math.random() * TOTAL_SETS) + 1;
    state.selectedSet = String(randomNum);
    els.examSetSelect.value = state.selectedSet;
  });
  els.modeSelector.addEventListener("change", (e) => {
    if (e.target.name === "examMode") {
      state.mode = e.target.value;
      els.modeSelector.querySelectorAll(".mode-card").forEach((card) => {
        const input = card.querySelector("input");
        card.classList.toggle("selected", input.checked);
      });
    }
  });

  els.sectionSelector.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    state.sectionFilter = btn.dataset.section;
    els.sectionSelector.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("active", p === btn);
    });
  });

  els.brandHome.addEventListener("click", () => {
    if (views.quiz.classList.contains("active") && !state.isSubmitted) {
      if (!confirm("確定要離開目前的測驗回到首頁嗎？作答進度將不會保留。")) {
        return;
      }
    }
    stopTimer();
    stopSpeech();
    els.headerActions.innerHTML = "";
    switchView("start");
  });

  els.startBtn.addEventListener("click", () => {
    let questions;
    if (state.sectionFilter === "all") {
      questions = generateExamSet(state.selectedSet);
      state.currentSetLabel =
        state.selectedSet === "random" ? "隨機組卷" : `第 ${state.selectedSet} 回`;
    } else {
      questions = JLPT_N5_QUESTIONS.filter((q) => q.section === state.sectionFilter);
      const labelMap = {
        vocab: "文字・語彙題庫",
        grammar: "文法題庫",
        reading: "読解題庫",
        listening: "聴解題庫"
      };
      state.currentSetLabel = labelMap[state.sectionFilter] || "分科練習";
    }
    startQuiz(questions);
  });

  // Start Quiz
  function startQuiz(questions) {
    stopTimer();
    stopSpeech();

    state.questions = questions;
    state.currentIndex = 0;
    state.answers = {};
    state.flagged = new Set();
    state.isSubmitted = false;
    state.startTime = Date.now();

    if (state.mode === "exam") {
      // Scale time: 25 mins for full 28 questions, or ~1 min/question
      state.timerSeconds = state.questions.length === 28 ? 25 * 60 : state.questions.length * 60;
    } else {
      state.timerSeconds = 0;
    }

    renderHeaderControls();
    startTimer();
    renderPalette();
    renderQuestion();
    switchView("quiz");
  }

  function renderHeaderControls() {
    const modeText = state.mode === "exam" ? "模擬考試" : "練習模式";
    els.headerActions.innerHTML = `
      <span class="mode-pill">${state.currentSetLabel}</span>
      <span class="mode-pill">${modeText}</span>
      <span class="timer-pill" id="timerPill">${formatTime(state.timerSeconds)}</span>
    `;
  }

  function startTimer() {
    const timerPill = document.getElementById("timerPill");
    if (!timerPill) return;

    state.timerInterval = setInterval(() => {
      if (state.mode === "exam") {
        state.timerSeconds -= 1;
        timerPill.textContent = formatTime(Math.max(0, state.timerSeconds));
        if (state.timerSeconds <= 180) {
          timerPill.classList.add("warning");
        }
        if (state.timerSeconds <= 0) {
          stopTimer();
          alert("測驗時間到！系統將自動為您交卷。");
          submitQuiz();
        }
      } else {
        state.timerSeconds += 1;
        timerPill.textContent = formatTime(state.timerSeconds);
      }
    }, 1000);
  }

  // Render Question
  function renderQuestion() {
    stopSpeech();
    const q = state.questions[state.currentIndex];
    const total = state.questions.length;

    els.qSectionBadge.textContent = q.sectionLabel;
    els.qTypeLabel.textContent = q.typeLabel;
    els.qCounter.textContent = `第 ${state.currentIndex + 1} / ${total} 題`;
    els.progressFill.style.width = `${((state.currentIndex + 1) / total) * 100}%`;

    // Flag button
    const isFlagged = state.flagged.has(q.id);
    els.flagBtn.classList.toggle("flagged", isFlagged);
    els.flagIcon.textContent = isFlagged ? "★" : "☆";

    // Passage
    if (q.passage) {
      els.passageBox.classList.remove("hidden");
      els.passageContent.textContent = q.passage;
    } else {
      els.passageBox.classList.add("hidden");
    }

    // Listening
    if (q.audioScript) {
      els.listeningBox.classList.remove("hidden");
      els.transcriptBox.textContent = q.audioScript;
      els.transcriptBox.classList.add("hidden");
      els.audioStatus.textContent = "點擊播放聽力題目（支援瀏覽器日語語音）";
    } else {
      els.listeningBox.classList.add("hidden");
    }

    // Instruction & Prompt
    els.qInstruction.textContent = q.instruction;
    els.qPrompt.innerHTML = q.prompt;

    // Options
    const userAns = state.answers[q.id];
    const showImmediateFeedback = state.mode === "practice" && userAns !== undefined;

    els.optionsList.innerHTML = "";
    q.options.forEach((optText, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option-btn";

      if (userAns === idx) {
        btn.classList.add("selected");
      }

      if (showImmediateFeedback) {
        btn.disabled = true;
        if (idx === q.answer) {
          btn.classList.add("correct");
        } else if (idx === userAns && userAns !== q.answer) {
          btn.classList.add("wrong");
        }
      }

      btn.innerHTML = `
        <span class="option-num">${idx + 1}</span>
        <span class="option-text">${optText}</span>
      `;
      btn.addEventListener("click", () => selectOption(idx));
      els.optionsList.appendChild(btn);
    });

    // Explanation Box
    if (showImmediateFeedback) {
      renderExplanation(q, userAns);
    } else {
      els.explanationBox.classList.add("hidden");
    }

    // Nav buttons
    els.prevBtn.disabled = state.currentIndex === 0;
    els.nextBtn.textContent = state.currentIndex === total - 1 ? "完成並交卷" : "下一題 →";

    updatePaletteActive();
  }

  function renderExplanation(q, userAns) {
    const isCorrect = userAns === q.answer;
    els.explanationBox.classList.remove("hidden", "is-correct", "is-wrong");
    els.explanationBox.classList.add(isCorrect ? "is-correct" : "is-wrong");

    els.explanationHeader.textContent = isCorrect
      ? `✓ 答對了！正確答案是（${q.answer + 1}）${q.options[q.answer]}`
      : `✕ 答錯了。正確答案是（${q.answer + 1}）${q.options[q.answer]}`;

    els.explanationBody.innerHTML = `
      ${q.kanjiSentence ? `<div class="kanji-ref"><strong>題目漢字：</strong>${q.kanjiSentence}</div>` : ""}
      <div>${q.explanation}</div>
    `;

    if (q.keypoints) {
      els.explanationKeypoints.classList.remove("hidden");
      els.explanationKeypoints.innerHTML = `<strong>重點整理：</strong>${q.keypoints}`;
    } else {
      els.explanationKeypoints.classList.add("hidden");
    }
  }

  function selectOption(optionIdx) {
    const q = state.questions[state.currentIndex];
    if (state.mode === "practice" && state.answers[q.id] !== undefined) {
      return; // Already answered in practice mode
    }
    state.answers[q.id] = optionIdx;
    renderQuestion();
    renderPalette();
  }

  // Listening Audio & Transcript
  els.playAudioBtn.addEventListener("click", () => {
    const q = state.questions[state.currentIndex];
    if (!q || !q.audioScript) return;

    if (!("speechSynthesis" in window)) {
      els.audioStatus.textContent = "您的瀏覽器不支援語音合成，請點擊下方「顯示逐字稿」作答。";
      return;
    }

    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(q.audioScript);
    utterance.lang = "ja-JP";
    utterance.rate = 0.9;

    const voices = window.speechSynthesis.getVoices();
    const jpVoice = voices.find((v) => v.lang.startsWith("ja"));
    if (jpVoice) utterance.voice = jpVoice;

    utterance.onstart = () => {
      els.audioStatus.textContent = "正在播放日語語音...";
    };
    utterance.onend = () => {
      els.audioStatus.textContent = "播放完畢，可再次點擊重聽。";
    };
    utterance.onerror = () => {
      els.audioStatus.textContent = "無法播放語音，請點擊下方「顯示逐字稿」閱讀題目。";
    };

    window.speechSynthesis.speak(utterance);
  });

  els.toggleTranscriptBtn.addEventListener("click", () => {
    els.transcriptBox.classList.toggle("hidden");
  });

  // Flag & Navigation
  els.flagBtn.addEventListener("click", () => {
    const q = state.questions[state.currentIndex];
    if (state.flagged.has(q.id)) {
      state.flagged.delete(q.id);
    } else {
      state.flagged.add(q.id);
    }
    renderQuestion();
    renderPalette();
  });

  els.prevBtn.addEventListener("click", () => {
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  });

  els.nextBtn.addEventListener("click", () => {
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
    } else {
      handleSubmitClick();
    }
  });

  els.submitExamBtn.addEventListener("click", handleSubmitClick);

  function handleSubmitClick() {
    const answeredCount = Object.keys(state.answers).length;
    const total = state.questions.length;
    if (answeredCount < total) {
      const ok = confirm(`您還有 ${total - answeredCount} 題尚未作答，確定要交卷嗎？`);
      if (!ok) return;
    }
    submitQuiz();
  }

  // Palette
  function renderPalette() {
    const total = state.questions.length;
    const answeredCount = Object.keys(state.answers).length;
    els.answeredSummary.textContent = `${answeredCount} / ${total} 已答`;

    els.paletteGrid.innerHTML = "";
    state.questions.forEach((q, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "palette-btn";
      btn.textContent = idx + 1;

      if (state.answers[q.id] !== undefined) btn.classList.add("answered");
      if (state.flagged.has(q.id)) btn.classList.add("flagged");
      if (idx === state.currentIndex) btn.classList.add("current");

      btn.addEventListener("click", () => {
        state.currentIndex = idx;
        renderQuestion();
      });
      els.paletteGrid.appendChild(btn);
    });
  }

  function updatePaletteActive() {
    const buttons = els.paletteGrid.querySelectorAll(".palette-btn");
    buttons.forEach((btn, idx) => {
      btn.classList.toggle("current", idx === state.currentIndex);
    });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (!views.quiz.classList.contains("active")) return;
    if (e.key >= "1" && e.key <= "4") {
      selectOption(Number(e.key) - 1);
    } else if (e.key === "ArrowLeft") {
      if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        renderQuestion();
      }
    } else if (e.key === "ArrowRight") {
      if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex += 1;
        renderQuestion();
      }
    }
  });

  // Submit & Results
  function submitQuiz() {
    stopTimer();
    stopSpeech();
    state.isSubmitted = true;
    els.headerActions.innerHTML = "";

    const total = state.questions.length;
    let correctCount = 0;
    const sectionStats = {};

    state.questions.forEach((q) => {
      if (!sectionStats[q.section]) {
        sectionStats[q.section] = { label: q.sectionLabel, total: 0, correct: 0 };
      }
      sectionStats[q.section].total += 1;
      if (state.answers[q.id] === q.answer) {
        correctCount += 1;
        sectionStats[q.section].correct += 1;
      }
    });

    const pct = Math.round((correctCount / total) * 100);
    const passed = pct >= 60;
    const elapsedSec = Math.round((Date.now() - state.startTime) / 1000);

    if (state.sectionFilter === "all") {
      saveSetRecord(state.selectedSet, pct);
      populateSetSelector();
    }

    els.scoreNum.textContent = `${pct}%`;
    els.scoreFraction.textContent = `${correctCount} / ${total}`;
    els.scoreCircle.className = `score-circle ${passed ? "pass" : "fail"}`;

    els.verdictBadge.className = `verdict-badge ${passed ? "pass" : "fail"}`;
    els.verdictBadge.textContent = passed ? "合格水準（≧ 60%）" : "尚需加強（< 60%）";
    els.verdictTitle.textContent = passed ? "恭喜！達到 N5 模擬合格標準" : "繼續加油！建議複習錯題詳解";
    els.verdictDesc.textContent = passed
      ? "您對 JLPT N5 的基礎字彙、文法與閱讀掌握良好，請查看下方錯題以追求滿分。"
      : "建議針對答錯的題目仔細閱讀下方解析與重點整理，並使用「錯題重練」加強記憶。";

    els.resultMetaStats.innerHTML = `
      <span>作答題數：${Object.keys(state.answers).length} / ${total}</span>
      <span>使用時間：${formatTime(elapsedSec)}</span>
      <span>標記題數：${state.flagged.size}</span>
    `;

    // Breakdown
    els.sectionBreakdown.innerHTML = "";
    Object.values(sectionStats).forEach((st) => {
      const sPct = Math.round((st.correct / st.total) * 100);
      const item = document.createElement("div");
      item.className = "breakdown-item";
      item.innerHTML = `
        <div class="breakdown-top">
          <span>${st.label}</span>
          <span>${st.correct} / ${st.total} (${sPct}%)</span>
        </div>
        <div class="breakdown-bar">
          <div class="breakdown-fill" style="width: ${sPct}%"></div>
        </div>
      `;
      els.sectionBreakdown.appendChild(item);
    });

    const wrongCount = total - correctCount;
    els.retryWrongBtn.disabled = wrongCount === 0;
    els.retryWrongBtn.textContent = wrongCount === 0 ? "全對無錯題" : `錯題重練 (${wrongCount}題)`;

    renderReviewList("all");
    els.reviewFilters.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("active", p.dataset.filter === "all");
    });

    switchView("result");
  }

  function renderReviewList(filter) {
    els.reviewList.innerHTML = "";
    const filtered = state.questions.filter((q) => {
      const isCorrect = state.answers[q.id] === q.answer;
      if (filter === "wrong") return !isCorrect;
      if (filter === "flagged") return state.flagged.has(q.id);
      return true;
    });

    if (filtered.length === 0) {
      els.reviewList.innerHTML = `<div class="review-card"><p>此分類下沒有題目。</p></div>`;
      return;
    }

    filtered.forEach((q) => {
      const qNum = state.questions.indexOf(q) + 1;
      const userAns = state.answers[q.id];
      const isCorrect = userAns === q.answer;
      const userAnsText = userAns !== undefined ? `（${userAns + 1}）${q.options[userAns]}` : "未作答";
      const correctText = `（${q.answer + 1}）${q.options[q.answer]}`;

      const card = document.createElement("div");
      card.className = `review-card ${isCorrect ? "is-correct" : "is-wrong"}`;
      card.innerHTML = `
        <div class="review-card-top">
          <div>
            <span class="section-badge">${q.sectionLabel}</span>
            <span class="q-type-label">第 ${qNum} 題・${q.typeLabel}</span>
          </div>
          <span class="review-status ${isCorrect ? "correct" : "wrong"}">
            ${isCorrect ? "✓ 正確" : "✕ 錯誤"}
          </span>
        </div>
        ${q.passage ? `<div class="transcript-box" style="margin-bottom:0.75rem">${q.passage}</div>` : ""}
        ${q.audioScript ? `<div class="transcript-box" style="margin-bottom:0.75rem"><strong>聽力逐字稿：</strong>\n${q.audioScript}</div>` : ""}
        <div class="review-prompt">${q.prompt}</div>
        <div class="review-answers">
          <div><strong>您的答案：</strong>${userAnsText}</div>
          <div><strong>正確答案：</strong>${correctText}</div>
        </div>
        <div class="review-explanation">
          ${q.kanjiSentence ? `<div class="kanji-ref"><strong>題目漢字：</strong>${q.kanjiSentence}</div>` : ""}
          <div><strong>答案解釋：</strong>${q.explanation}</div>
          ${q.keypoints ? `<div style="margin-top:0.4rem"><strong>重點整理：</strong>${q.keypoints}</div>` : ""}
        </div>
      `;
      els.reviewList.appendChild(card);
    });
  }

  els.reviewFilters.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    els.reviewFilters.querySelectorAll(".pill").forEach((p) => {
      p.classList.toggle("active", p === btn);
    });
    renderReviewList(btn.dataset.filter);
  });

  els.retryWrongBtn.addEventListener("click", () => {
    const wrongQuestions = state.questions.filter((q) => state.answers[q.id] !== q.answer);
    if (wrongQuestions.length > 0) {
      state.mode = "practice";
      startQuiz(wrongQuestions);
    }
  });

  els.restartBtn.addEventListener("click", () => {
    switchView("start");
  });
})();
