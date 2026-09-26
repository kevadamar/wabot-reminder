/**
 * Antigravity CLI Host Bridge
 * 
 * Runs on the host server outside the Docker container.
 * Exposes a lightweight HTTP bridge so containers can use the host's `antigravity` / `agy` CLI as an LLM fallback.
 * 
 * Usage on Host:
 *   bun run scripts/antigravity-bridge.ts
 *   (or via PM2: pm2 start scripts/antigravity-bridge.ts --name antigravity-bridge --interpreter bun)
 */

const PORT = parseInt(process.env.PORT || '7860', 10);
const HOST = process.env.HOST || '0.0.0.0';

console.log(`🚀 Memulai Antigravity CLI Bridge pada http://${HOST}:${PORT}...`);

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (req.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok', service: 'antigravity-cli-bridge' });
    }

    // Generate prompt endpoint
    if (req.method === 'POST' && (url.pathname === '/generate' || url.pathname === '/prompt')) {
      try {
        const body = (await req.json()) as { prompt?: string };
        const prompt = body?.prompt?.trim();

        if (!prompt) {
          return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }

        // Execute agy CLI on host
        const proc = Bun.spawn(['agy', '-p', prompt, '--output-format', 'text'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });

        const output = await new Response(proc.stdout).text();
        const errOutput = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          console.error(`[Bridge Error] agy exited with code ${exitCode}:`, errOutput);
          return Response.json({ error: 'CLI execution failed', details: errOutput }, { status: 500 });
        }

        return Response.json({ text: output.trim() });
      } catch (err: any) {
        console.error('[Bridge Error]', err);
        return Response.json({ error: err?.message || 'Internal server error' }, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`✅ Antigravity CLI Bridge siap melayani request pada port ${PORT}.`);
