const path = require('path');

const ENV_SUFFIX = process.env.DEPLOY_ENV || 'development';

module.exports = {
  apps: [
    {
      name: `fetchit-be-${ENV_SUFFIX}`,
      // Absolute, and anchored to wherever THIS file was deployed, rather than
      // the relative 'dist/main.js' it used to be. A relative script path is
      // resolved against the process's cwd, and PM2 keeps an existing app's
      // original `pm_cwd` across a `reload` — so once a process had been
      // started from some other directory, every later deploy rsynced new code
      // into APP_PATH while the running process kept executing the old tree.
      // That is invisible: the health check passes against the old build, and
      // the only symptom is methods added since then missing at runtime
      // ("this.storage.getSignedUrl is not a function" on the admin document
      // review endpoint).
      cwd: __dirname,
      script: path.join(__dirname, 'dist', 'main.js'),
      // Only production needs multi-core cluster scaling. dev/staging share a
      // small, memory-constrained box with many other apps, so run a single
      // fork-mode process there — cluster mode with one instance just adds the
      // cluster master/IPC overhead with nothing to load-balance.
      instances: ENV_SUFFIX === 'production' ? 'max' : 1,
      exec_mode: ENV_SUFFIX === 'production' ? 'cluster' : 'fork',
      autorestart: true,
      watch: false,
      // Crashloop backstop: a process must stay up at least `min_uptime` to count
      // as a healthy start. If it keeps exiting sooner, PM2 gives up after
      // `max_restarts` consecutive fast crashes and marks the app "errored"
      // (visible/alertable) instead of retrying forever. Without this, a startup
      // crash on 2026-03-18 (TimeoutInterceptor DI error) racked up ~2,500
      // unbounded restarts before it was noticed.
      min_uptime: '30s',
      max_restarts: 10,
      max_memory_restart: '1G',
      env_development: {
        NODE_ENV: 'development',
        PORT: 6100,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 6101,
      },
      // Ports are distinct per environment so two environments can run on
      // the same box without an EADDRINUSE collision. nginx fronts 6100.
      env_production: {
        NODE_ENV: 'production',
        PORT: 6102,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
    },
  ],
};
