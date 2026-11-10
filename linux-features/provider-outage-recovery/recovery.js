"use strict";

// This factory is injected verbatim into the renderer; keep it self-contained.
function recoveryRuntime() {
  const delays = [10, 30, 60, 120, 180, 180, 180];
  const isOutage = error => error != null && typeof error === "object" && error.httpConnectionFailed?.httpStatusCode === 503;
  const newEpisode = now => ({ started: now, attempts: 0, cancelled: false, submitted: new Set(), outstanding: false });
  function createRecovery({ episode, expected, read, send, cancelSend = () => {}, now = Date.now, priorAttempts = 0 }) {
    episode.attempts = Math.max(episode.attempts, priorAttempts);
    const due = now() + (delays[episode.attempts] ?? 0) * 1000;
    let disposed = false, submitted = false, settled = false, cancellationSent = false;
    function current() {
      const s = read();
      return !disposed && !episode.cancelled && now() < episode.started + 900000 &&
        s?.hostId === expected.hostId && s?.threadId === expected.threadId && s?.turnId === expected.turnId &&
        s.ready === true && s.failed === true && s.owner === true && !s.pending && isOutage(s.error);
    }
    const available = () => current() && !submitted && !episode.outstanding && !episode.submitted.has(expected.turnId) && episode.attempts < delays.length;
    function cancel() { episode.cancelled = true; if (!cancellationSent) { cancellationSent = true; void Promise.resolve(cancelSend()).catch(() => {}); } }
    async function retryNow() {
      if (!available()) return;
      submitted = true;
      episode.submitted.add(expected.turnId);
      episode.attempts++;
      episode.outstanding = true;
      try { await send(() => { if (!current()) throw Error("Recovery cancelled or conversation changed"); }); }
      catch { cancel(); } // An unsuccessful GUI submission can have an unknown outcome.
      finally { settled = true; episode.outstanding = false; }
    }
    return {
      seconds: () => available() ? Math.max(0, Math.ceil((due - now()) / 1000)) : null,
      tick: async () => { if (submitted) return; if (!current()) { cancel(); return; } if (now() >= due) await retryNow(); },
      retryNow, cancel,
      dispose: () => { disposed = true; if (!settled) cancel(); },
    };
  }
  return { isOutage, newEpisode, createRecovery };
}
module.exports = { recoveryRuntime, ...recoveryRuntime() };
