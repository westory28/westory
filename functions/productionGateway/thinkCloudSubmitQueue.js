const { HttpsError } = require("firebase-functions/v2/https");
const { performance } = require("node:perf_hooks");

const DEFAULT_LIMITS = Object.freeze({
  maxSessions: 64,
  maxPending: 512,
  perSessionPending: 64,
  waitTimeoutMs: 15000,
});

const busy = (reason) => new HttpsError("resource-exhausted",
  "응답이 몰려 잠시 대기하고 있습니다. 입력한 내용을 다시 보내 주세요.",
  { reason, retryable: true });

// This queue reduces contention within one warm instance only. It is not a
// distributed lock: the unchanged gateway transaction remains authoritative.
// Authorization, semester checks and receipt replay run when a job starts.
const createThinkCloudSubmitQueue = (execute, options = {}) => {
  if (typeof execute !== "function") throw new TypeError("execute must be a function");
  const limits = { ...DEFAULT_LIMITS, ...options };
  const dequeuedExecute = options.dequeuedExecute || execute;
  const now = options.now || (() => performance.now());
  if (typeof dequeuedExecute !== "function" || typeof now !== "function")
    throw new TypeError("dequeuedExecute and now must be functions");
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1)
      throw new TypeError(`${key} must be a positive safe integer`);
  }
  const sessions = new Map();
  let pending = 0;

  const dispatch = (key, state) => {
    if (state.running) return;
    while (state.waiting.length) {
      const job = state.waiting.shift();
      pending--;
      clearTimeout(job.timer);
      // Timers may be delayed behind Promise microtasks or a busy event loop.
      // Enforce the actual monotonic deadline before a waiting job can start.
      if (now() >= job.deadline) {
        job.reject(busy("THINK_CLOUD_SUBMIT_WAIT_TIMEOUT"));
        continue;
      }
      job.started = true;
      state.running = true;
      Promise.resolve().then(() => dequeuedExecute(job.request)).then(job.resolve, job.reject).finally(() => {
        state.running = false;
        dispatch(key, state);
      });
      return;
    }
    sessions.delete(key);
  };

  return (request) => {
    const uid = request?.auth?.uid;
    const payload = request?.data?.payload;
    // Malformed/unauthenticated requests retain the gateway's exact errors and
    // never consume queue slots. The key contains no additional user data.
    if (request?.data?.commandType !== "submitThinkCloudResponse"
      || typeof uid !== "string" || !uid || uid.length > 180 || uid.includes("/")
      || typeof payload?.semesterId !== "string" || !/^\d{4}-[12]$/.test(payload.semesterId)
      || typeof payload?.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(payload.sessionId)) {
      return execute(request);
    }
    const key = `${payload.semesterId}:${payload.sessionId}`;
    let state = sessions.get(key);
    if ((!state && sessions.size >= limits.maxSessions)
      || pending >= limits.maxPending
      || (state && state.waiting.length >= limits.perSessionPending)) {
      return Promise.reject(busy("THINK_CLOUD_SUBMIT_QUEUE_FULL"));
    }
    if (!state) {
      state = { running: false, waiting: [] };
      sessions.set(key, state);
    }
    const current = state;
    return new Promise((resolve, reject) => {
      const job = { request, resolve, reject, started: false, timer: null,
        deadline: current.running ? now() + limits.waitTimeoutMs : Infinity };
      current.waiting.push(job);
      pending++;
      if (current.running) {
        const expire = () => {
          if (job.started) return;
          const remaining = job.deadline - now();
          if (remaining > 0) {
            job.timer = setTimeout(expire, Math.ceil(remaining));
            return;
          }
          const index = current.waiting.indexOf(job);
          if (index < 0) return;
          current.waiting.splice(index, 1);
          pending--;
          reject(busy("THINK_CLOUD_SUBMIT_WAIT_TIMEOUT"));
          if (!current.running && !current.waiting.length) sessions.delete(key);
        };
        job.timer = setTimeout(expire, limits.waitTimeoutMs);
      }
      dispatch(key, current);
    });
  };
};

const createThinkCloudFastHandler = (execute) => (request) => {
  if (request?.data?.commandType !== "submitThinkCloudResponse")
    throw new HttpsError("permission-denied", "이 경로에서는 생각모아 응답만 보낼 수 있습니다.",
      { reason: "THINK_CLOUD_FAST_SUBMIT_REQUIRED" });
  return execute(request);
};

module.exports = { DEFAULT_LIMITS, createThinkCloudSubmitQueue, createThinkCloudFastHandler };
