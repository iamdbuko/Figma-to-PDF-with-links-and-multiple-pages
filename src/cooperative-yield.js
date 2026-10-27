// Yield through separate browser tasks without creating a chain of zero-delay
// timers, which Chromium can heavily throttle while the plugin is backgrounded.
// This scheduler does not replace timers used for real deadlines or cleanup.
function createCooperativeYield(options = {}) {
  const Channel = options.MessageChannel === undefined ? globalThis.MessageChannel : options.MessageChannel;
  const scheduleTimer = options.setTimeout || globalThis.setTimeout;
  const MAX_PENDING = 4096;
  let channel = null, queue = [], head = 0, scheduled = false, disposed = false;

  function closeChannel() {
    if (!channel) return;
    channel.port1.onmessage = null;
    channel.port1.close(); channel.port2.close();
    channel = null;
  }

  function schedule() {
    if (scheduled || disposed || head === queue.length) return;
    scheduled = true;
    if (channel) {
      try { channel.port2.postMessage(null); return; }
      catch (_) { closeChannel(); }
    }
    try { scheduleTimer(drain, 0); }
    catch (error) {
      scheduled = false;
      const pending = queue.slice(head); queue = []; head = 0;
      for (const entry of pending) entry.reject(error);
    }
  }

  function drain() {
    if (disposed) return;
    scheduled = false;
    const entry = queue[head++];
    if (!entry) { queue = []; head = 0; return; }
    // Release completed entries, and periodically compact a sustained queue.
    if (head === queue.length) { queue = []; head = 0; }
    else {
      queue[head - 1] = null;
      if (head >= 1024) { queue = queue.slice(head); head = 0; }
    }
    entry.resolve();
    schedule();
  }

  if (typeof Channel === 'function') {
    try {
      channel = new Channel();
      channel.port1.onmessage = drain;
    } catch (_) { closeChannel(); }
  }

  function yieldToBrowser() {
    if (disposed) return Promise.reject(new Error('The cooperative scheduler is closed.'));
    if (queue.length - head >= MAX_PENDING) return Promise.reject(new Error('Too many pending cooperative tasks.'));
    return new Promise((resolve, reject) => { queue.push({ resolve, reject }); schedule(); });
  }
  // The UI owns one scheduler for its window lifetime. Tests/other hosts can
  // explicitly close the ports; cancellation of one export must not close it.
  yieldToBrowser.dispose = () => {
    if (disposed) return;
    disposed = true; scheduled = false;
    closeChannel();
    const pending = queue.slice(head); queue = []; head = 0;
    for (const entry of pending) entry.reject(new Error('The cooperative scheduler is closed.'));
  };
  return yieldToBrowser;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createCooperativeYield };
