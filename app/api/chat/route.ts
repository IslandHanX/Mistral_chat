import { NextRequest } from 'next/server';
export const runtime = 'nodejs';

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first'); // 避免部分环境 IPv6 坑

import fs from 'node:fs';
import https from 'node:https';
import axios from 'axios';
import { Readable } from 'node:stream';

// ---- utils ----
function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// Node Readable -> Web ReadableStream（兼容旧 Node 没有 toWeb 的情况）
function toWebStream(nodeReadable: any): ReadableStream<Uint8Array> {
  if ((Readable as any).toWeb) {
    return (Readable as any).toWeb(nodeReadable) as unknown as ReadableStream<Uint8Array>;
  }
  // 兜底转换：把 Node 流包成 Web ReadableStream
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeReadable.setEncoding?.('utf8');
      nodeReadable.on('data', (chunk: string | Buffer) => {
        const buf = typeof chunk === 'string' ? encoder.encode(chunk) : new Uint8Array(chunk);
        controller.enqueue(buf);
      });
      nodeReadable.on('error', (err: any) => controller.error(err));
      nodeReadable.on('end', () => controller.close());
    }
  });
}

// ---- handler ----
export async function POST(req: NextRequest) {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return new Response('missing MISTRAL_API_KEY', { status: 500 });

  // 读取 body + 过滤“空 assistant 占位”
  let payload: any;
  try {
    payload = await req.json();
  } catch (e: any) {
    return new Response(`Bad request JSON: ${e?.message || String(e)}`, { status: 400 });
  }
  const incoming = payload?.messages ?? [];
  const preferModel = payload?.model ?? 'mistral-large-latest';
  const temperature = typeof payload?.temperature === 'number' ? payload.temperature : 0.2;

  const messages = Array.isArray(incoming)
    ? incoming.filter((m: any) =>
        !(m?.role === 'assistant'
          && (!m?.content || String(m.content).trim() === '')
          && (!m?.tool_calls || m.tool_calls.length === 0)))
    : [];

  // 选 CA bundle（先用 NODE_EXTRA_CA_CERTS，再常见路径）
  const caCandidates = [
    process.env.NODE_EXTRA_CA_CERTS,
    '/etc/ssl/cert.pem',
    '/private/etc/ssl/cert.pem',
    '/etc/ssl/certs/ca-certificates.crt',
    '/etc/pki/tls/certs/ca-bundle.crt',
    '/usr/local/etc/openssl@3/cert.pem',
    '/opt/homebrew/etc/openssl@3/cert.pem',
  ].filter(Boolean) as string[];

  let ca: Buffer | undefined;
  let caPathUsed: string | undefined;
  for (const p of caCandidates) {
    try {
      if (p && fs.existsSync(p)) { ca = fs.readFileSync(p); caPathUsed = p; break; }
    } catch {}
  }

  // 仅用于本地排错：ALLOW_INSECURE_TLS=1 时跳过证书校验（打通后务必关掉）
  const allowInsecure = process.env.ALLOW_INSECURE_TLS === '1';
  const httpsAgent = new https.Agent({ rejectUnauthorized: !allowInsecure, ca });

  try {
    const modelCandidates = [preferModel, 'mistral-medium-latest', 'mistral-small-latest'];

    // 逐个模型尝试；每个模型最多重试 1 次（指数退避）
    for (const m of modelCandidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) {
          const base = 200 * Math.pow(2, attempt - 1);
          const jitter = Math.floor(Math.random() * base);
          await sleep(base + jitter);
        }

        const res = await axios.post(
          'https://api.mistral.ai/v1/chat/completions',
          { model: m, messages, temperature, stream: true, safe_prompt: true },
          {
            headers: {
              'Authorization': `Bearer ${key}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
            },
            responseType: 'stream',
            httpsAgent,
            validateStatus: () => true,
          }
        );

        // 成功：SSE 原样透传，结束
        if (res.status >= 200 && res.status < 300 && res.data) {
          const web = toWebStream(res.data);
          return new Response(web, {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive',
              'X-Model-Used': m,
              ...(caPathUsed ? { 'X-CA-Used': caPathUsed } : {}),
            },
          });
        }

        // 非成功：读取错误体
        const errText: string = await new Promise((resolve) => {
          if (!res.data) return resolve('');
          let s = '';
          res.data.setEncoding('utf8');
          res.data.on('data', (c: string) => (s += c));
          res.data.on('end', () => resolve(s));
        });

        // 429：容量不足，按退避策略在本模型再试一次；失败则尝试下一个模型
        const is429 = res.status === 429 || /service_tier_capacity_exceeded/i.test(errText);
        if (!is429) {
          const meta = JSON.stringify({ status: res.status, modelTried: m, caPathUsed, allowInsecure });
          return new Response(`Upstream ${res.status}: ${errText}\n${meta}`, { status: res.status });
        }
        // 是 429：继续循环（同模型重试一次），然后切换到下一个模型
      }
      // 到这里说明该模型两次都失败（429），换下一个
    }

    // 所有候选模型都因 429 失败
    const meta = JSON.stringify({ caPathUsed, allowInsecure, tried: modelCandidates });
    return new Response(`Capacity exceeded for all candidates.\n${meta}`, { status: 429 });

  } catch (e: any) {
    const details = JSON.stringify({
      message: e?.message || String(e),
      name: e?.name,
      code: e?.code,
      caPathUsed,
      allowInsecure,
    });
    return new Response(`Axios failed: ${details}`, { status: 502 });
  }
}
