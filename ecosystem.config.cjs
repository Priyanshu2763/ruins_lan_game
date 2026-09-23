// pm2 process definition — keeps this app's runtime config (port, etc.) in one versioned file
// instead of depending on whatever env vars happened to be in the shell that ran `pm2 start`.
// .cjs extension deliberately, not .js: package.json has "type": "module", so a plain .js file
// here would be loaded as an ES module and module.exports/__dirname would break — pm2's own
// ecosystem-file loader explicitly supports .cjs for exactly this case.
// Usage:
//   pm2 start ecosystem.config.cjs        (first time / after `pm2 delete wreckveil`)
//   pm2 restart ecosystem.config.cjs      (picks up changes to the env block below)
//   pm2 save                              (persists this so `pm2 resurrect` / a reboot keeps it)
//
// PORT is what the local Apache reverse proxy on game.antiszn.com forwards to — this box (the
// actual game server) listens on 3001 so port 3000 stays free for the separate antiszn.com site
// running on the same machine.
module.exports = {
  apps: [
    {
      name: 'wreckveil',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        PORT: 3001,
      },
    },
  ],
};
