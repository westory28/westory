export type AssessmentConfidence = "sure" | "unsure" | "unknown";
export type AssessmentTelemetryQuality = "complete" | "partial";

export interface AssessmentQuestionTelemetry {
  activeMs: number;
  hiddenMs: number;
  confidenceMs: number;
  firstResponseMs: number | null;
  finalResponseMs: number | null;
  answerChangeCount: number;
  revisitCount: number;
  confidence: AssessmentConfidence | null;
  hintViewed?: boolean;
  quality: AssessmentTelemetryQuality;
}

export interface AssessmentTelemetrySnapshot {
  version: 1;
  quality: AssessmentTelemetryQuality;
  questions: Record<string, AssessmentQuestionTelemetry>;
}

const boundedMs = (value: unknown) =>
  Math.min(86400000, Math.max(0, Math.round(Number(value) || 0)));
const boundedCount = (value: unknown) =>
  Math.min(10000, Math.max(0, Math.floor(Number(value) || 0)));
const blank = (
  quality: AssessmentTelemetryQuality,
): AssessmentQuestionTelemetry => ({
  activeMs: 0,
  hiddenMs: 0,
  confidenceMs: 0,
  firstResponseMs: null,
  finalResponseMs: null,
  answerChangeCount: 0,
  revisitCount: 0,
  confidence: null,
  hintViewed: false,
  quality,
});

/** Local observation only. This collector does not grade, time out or make requests. */
export class AssessmentTelemetryCollector {
  private readonly questions: Record<string, AssessmentQuestionTelemetry> = {};
  private readonly answers: Record<string, string> = {};
  private readonly committedAnswers: Record<string, string> = {};
  private readonly visited = new Set<string>();
  private currentId = "";
  private running = false;
  private visible = true;
  private confidenceFocused = false;
  private lastTick: number;
  private quality: AssessmentTelemetryQuality;

  constructor(
    questionIds: string[],
    options: {
      restored?: AssessmentTelemetrySnapshot;
      answers?: Record<string, string>;
      resumed?: boolean;
      now?: () => number;
    } = {},
  ) {
    this.now = options.now || (() => performance.now());
    this.lastTick = this.now();
    this.quality = options.resumed ? "partial" : "complete";
    questionIds.forEach((id) => {
      const previous = options.restored?.questions?.[id];
      const answer = String(options.answers?.[id] || "");
      this.answers[id] = answer;
      this.committedAnswers[id] = answer;
      this.questions[id] = previous
        ? {
            activeMs: boundedMs(previous.activeMs),
            hiddenMs: boundedMs(previous.hiddenMs),
            confidenceMs: boundedMs(previous.confidenceMs),
            firstResponseMs:
              answer.trim() && typeof previous.firstResponseMs === "number"
                ? boundedMs(previous.firstResponseMs)
                : null,
            finalResponseMs:
              answer.trim() && typeof previous.finalResponseMs === "number"
                ? boundedMs(previous.finalResponseMs)
                : null,
            answerChangeCount: boundedCount(previous.answerChangeCount),
            revisitCount: boundedCount(previous.revisitCount),
            confidence: ["sure", "unsure", "unknown"].includes(
              previous.confidence || "",
            )
              ? previous.confidence
              : null,
            quality: this.quality,
            hintViewed: previous.hintViewed === true,
          }
        : blank(this.quality);
      if (previous && (previous.activeMs > 0 || answer.trim()))
        this.visited.add(id);
    });
  }

  private readonly now: () => number;

  private flush() {
    const next = this.now();
    const elapsed = Math.max(0, next - this.lastTick);
    this.lastTick = next;
    const item = this.questions[this.currentId];
    if (!this.running || !item) return;
    if (!this.visible) item.hiddenMs = boundedMs(item.hiddenMs + elapsed);
    else if (this.confidenceFocused)
      item.confidenceMs = boundedMs(item.confidenceMs + elapsed);
    else item.activeMs = boundedMs(item.activeMs + elapsed);
  }

  setRunning(running: boolean) {
    this.flush();
    this.running = running;
  }

  setVisible(visible: boolean) {
    this.flush();
    this.visible = visible;
  }

  setConfidenceFocused(focused: boolean) {
    this.flush();
    this.confidenceFocused = focused;
  }

  markHintViewed(id: string) {
    if (this.questions[id]) this.questions[id].hintViewed = true;
  }

  visit(id: string) {
    this.flush();
    if (!this.questions[id] || id === this.currentId) return;
    this.commitAnswer(this.currentId);
    this.currentId = id;
    this.confidenceFocused = false;
    if (this.visited.has(id)) this.questions[id].revisitCount += 1;
    this.visited.add(id);
  }

  answer(id: string, answer: string, commit = true) {
    this.flush();
    const item = this.questions[id];
    if (!item || this.answers[id] === answer) return;
    this.answers[id] = answer;
    if (answer.trim()) {
      item.firstResponseMs ??= item.activeMs;
      item.finalResponseMs = item.activeMs;
    } else {
      item.finalResponseMs = null;
    }
    if (commit) this.commitAnswer(id);
  }

  commitAnswer(id: string) {
    const item = this.questions[id];
    if (!item) return;
    const previous = this.committedAnswers[id] || "";
    const next = this.answers[id] || "";
    if (previous.trim() && previous !== next) item.answerChangeCount += 1;
    this.committedAnswers[id] = next;
  }

  setConfidence(id: string, confidence: AssessmentConfidence | null) {
    if (this.questions[id]) this.questions[id].confidence = confidence;
  }

  snapshot(): AssessmentTelemetrySnapshot {
    this.flush();
    return {
      version: 1,
      quality: this.quality,
      questions: Object.fromEntries(
        Object.entries(this.questions).map(([id, item]) => [
          id,
          this.answers[id]?.trim()
            ? { ...item }
            : { ...item, firstResponseMs: null, finalResponseMs: null },
        ]),
      ),
    };
  }
}
