import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// DEV 微調工具專用：把面板匯出的數值寫進專案的 tuning/export.json，方便 Claude 讀取後 baked 進 source
function devTuningSave() {
  return {
    name: 'dev-tuning-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const data = JSON.parse(body);
            const dir = path.resolve(server.config.root, 'tuning');
            fs.mkdirSync(dir, { recursive: true });
            const file = path.join(dir, 'export.json');
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
            res.end(JSON.stringify({ ok: true, file }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devTuningSave()],
  server: {
    host: true,
    // 匯出檔不參與熱更新，避免存檔時整頁重載
    watch: { ignored: ['**/tuning/**'] },
  },
});
