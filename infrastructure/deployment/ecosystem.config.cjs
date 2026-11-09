// PM2 process file. Usage (from repo root on the server):
//   pm2 start infrastructure/deployment/ecosystem.config.cjs && pm2 save && pm2 startup
//
// One instance only: live room state is in-process in Phase 1. Do NOT use cluster mode
// until the Redis adapter + room affinity land (Phase 6).
module.exports = {
  apps: [
    {
      name: 'video-platform-api',
      cwd: './backend',
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: '--enable-source-maps',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      kill_timeout: 10000,
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,
      out_file: '/var/log/video-platform/api.out.log',
      error_file: '/var/log/video-platform/api.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
