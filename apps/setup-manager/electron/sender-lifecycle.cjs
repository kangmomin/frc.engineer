// The private stdin pipe is available before the Sender's HTTP API or tray.
// Resolve only on actual process exit, so restart/install cannot race the old
// process's file handles. A stuck child gets one bounded forced-stop attempt.
function stopSenderProcess(proc, { forceStop, graceMs = 10000, forceMs = 5000 }) {
  if (!proc.pid || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let finished = false;
    let forcing = false;
    let timer;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      proc.removeListener('exit', onExit);
      proc.removeListener('error', onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = () => {
      // A failed spawn has no process to wait for. Other errors do not prove exit.
      if (!proc.pid) finish();
      else void force();
    };
    const force = async () => {
      if (finished || forcing) return;
      forcing = true;
      clearTimeout(timer);
      timer = setTimeout(() => finish(new Error('Sender did not exit after forced stop.')), forceMs);
      try {
        await forceStop(proc);
      } catch (error) {
        finish(error);
      }
    };
    proc.once('exit', onExit);
    proc.on('error', onError);
    timer = setTimeout(force, graceMs);
    // Keep an error listener through stream teardown (EPIPE may follow exit).
    proc.stdin?.once('error', () => { void force(); });
    try {
      if (proc.stdin?.writable) proc.stdin.end('shutdown\n');
      else void force();
    } catch {
      void force();
    }
  });
}

module.exports = { stopSenderProcess };
