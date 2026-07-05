const ENV_SUFFIX = process.env.DEPLOY_ENV || 'development';

module.exports = {
  apps: [
    {
      name: `fetchit-be-${ENV_SUFFIX}`,
      script: 'dist/main.js',
      // Only production needs multi-core cluster scaling. dev/staging share a
      // small, memory-constrained box with many other apps, so run a single
      // instance there to conserve RAM.
      instances: ENV_SUFFIX === 'production' ? 'max' : 1,
      exec_mode: 'cluster',
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
      env_production: {
        NODE_ENV: 'production',
        PORT: 6100,
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      merge_logs: true,
    },
  ],
};
