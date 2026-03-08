const ENV_SUFFIX = process.env.DEPLOY_ENV || 'development';

module.exports = {
  apps: [
    {
      name: `fetchit-be-${ENV_SUFFIX}`,
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
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
