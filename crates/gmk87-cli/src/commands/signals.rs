//! Turns `SIGINT`/`SIGTERM` into a [`CancelToken`] cancellation.
//!
//! A signal handler may only perform async-signal-safe work, so it stores
//! `true` in a static [`AtomicBool`] and does nothing else. A short-lived
//! watcher thread polls that flag and cancels the upload token; the upload
//! itself keeps running on the main thread, so its in-process repair (a bare
//! `COMMIT` plus the complete pre-upload configuration block) executes before
//! the process exits.
//!
//! `SIGKILL` cannot be caught. Killing the process outright leaves the display
//! mid-transaction, and the recovery procedure in `docs/hardware-testing.md`
//! must be run. The first `SIGINT`/`SIGTERM` is therefore cooperative, and
//! dropping the guard restores the default disposition so a second one
//! terminates the process immediately instead of being swallowed.
//!
//! Implemented with a raw `extern "C"` declaration of the C library's
//! `signal(2)` so no new crate dependency is needed.

use gmk87_device::session::CancelToken;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

/// Set by the signal handler. Only `true` is ever meaningful.
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

/// `SIGINT` and `SIGTERM` on Linux, the only platform this CLI targets.
const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;

/// `SIG_DFL`: the handler value that restores a signal's default action.
const SIG_DFL: usize = 0;

/// How often the watcher thread checks the flag.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

extern "C" {
    /// `sighandler_t signal(int signum, sighandler_t handler)` from the C
    /// library. `sighandler_t` is a function pointer, represented here as the
    /// pointer-sized `usize`.
    fn signal(signum: i32, handler: usize) -> usize;
}

/// The signal handler: record the interrupt. `AtomicBool::store` is
/// async-signal-safe; nothing else may happen here.
extern "C" fn note_signal(_signum: i32) {
    INTERRUPTED.store(true, Ordering::SeqCst);
}

/// Installs the handlers and starts a watcher that cancels `cancel`.
///
/// Keep the returned guard alive for as long as the upload runs; dropping it
/// stops the watcher thread and restores the default `SIGINT`/`SIGTERM`
/// disposition.
pub fn watch(cancel: CancelToken) -> InterruptGuard {
    INTERRUPTED.store(false, Ordering::SeqCst);
    // SAFETY: `signal` is a standard C library function. The handler has the
    // required `extern "C" fn(i32)` shape and touches only an atomic.
    unsafe {
        let handler = note_signal as *const () as usize;
        let _ = signal(SIGINT, handler);
        let _ = signal(SIGTERM, handler);
    }

    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);
    let handle = std::thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            if INTERRUPTED.load(Ordering::SeqCst) {
                cancel.cancel();
                return;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });

    InterruptGuard {
        stop,
        handle: Some(handle),
    }
}

/// Stops the watcher when the command returns.
///
/// Binding it matters: an unbound guard would be dropped immediately, which
/// both stops the watcher and restores the default handlers, leaving the
/// upload uninterruptible. `#[must_use]` keeps `signals::watch(cancel);` from
/// compiling silently.
#[must_use = "the guard must outlive the upload, or interrupts will not cancel it"]
pub struct InterruptGuard {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for InterruptGuard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        // Restore the default disposition now that nothing watches the flag.
        // Otherwise a second Ctrl-C would only set `INTERRUPTED` again and be
        // swallowed, leaving `SIGKILL` as the only escape — the path that tears
        // a frame.
        // SAFETY: `signal` is a standard C library function and `SIG_DFL` is
        // the portable default-handler constant.
        unsafe {
            let _ = signal(SIGINT, SIG_DFL);
            let _ = signal(SIGTERM, SIG_DFL);
        }
    }
}
