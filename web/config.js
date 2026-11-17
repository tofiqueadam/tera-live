// Deployment configuration for the static front-end.
//
// apiBase: URL of the deployed Cloudflare Worker, e.g.
//   'https://tera-live-api.<your-subdomain>.workers.dev'
// Leave empty to ship a static preview: the app then offers demo mode
// (?demo=1, clearly badged SIMULATED DATA) instead of pretending to be live.
export const CONFIG = {
  apiBase: '',
};
