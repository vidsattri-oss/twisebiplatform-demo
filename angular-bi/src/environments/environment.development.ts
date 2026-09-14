export const environment = {
  production: false,
  // The demo backend (query-builder-prototype/server.js) runs standalone on
  // 4173 in this prototype rather than behind an Angular dev-server proxy,
  // so the base URL is absolute here and CORS-scoped on the server side.
  apiBaseUrl: 'http://localhost:4173/api',
};
