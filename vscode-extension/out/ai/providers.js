"use strict";
/**
 * Provider adapters. Each call returns the raw model text (expected to be a
 * JSON object) or an error message. Uses Node 18+ global fetch — no SDKs.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.callProvider = callProvider;
const DEFAULT_OPENAI = 'https://api.openai.com/v1';
const DEFAULT_ANTHROPIC = 'https://api.anthropic.com/v1';
const DEFAULT_GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
async function callProvider(req) {
    switch (req.provider) {
        case 'aoai': return callAzureOpenAI(req);
        case 'openai': return callOpenAI(req);
        case 'anthropic': return callAnthropic(req);
        case 'gemini': return callGemini(req);
        default: return { raw: '', error: `Unknown provider: ${req.provider}` };
    }
}
function ctxLine(req) {
    const parts = [`provider=${req.provider}`];
    if (req.model) {
        parts.push(`model=${req.model}`);
    }
    if (req.endpoint) {
        parts.push(`endpoint=${req.endpoint}`);
    }
    if (req.apiVersion && req.provider === 'aoai') {
        parts.push(`api_version=${req.apiVersion}`);
    }
    return '  Config: ' + parts.join(', ');
}
function err(req, msg) {
    return { raw: '', error: `${msg}\n${ctxLine(req)}` };
}
async function withTimeout(req, fn) {
    if (req.signal) {
        return fn(req.signal);
    }
    if (!req.timeoutMs) {
        return fn(new AbortController().signal);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
        return await fn(controller.signal);
    }
    finally {
        clearTimeout(timer);
    }
}
// ── Azure OpenAI ────────────────────────────────────────────────────────────
async function callAzureOpenAI(req) {
    const missing = [];
    if (!req.apiKey) {
        missing.push('commitDefender.apiKey');
    }
    if (!req.endpoint) {
        missing.push('commitDefender.endpoint');
    }
    if (!req.model) {
        missing.push('commitDefender.model');
    }
    if (missing.length > 0) {
        return err(req, `Missing Azure OpenAI settings: ${missing.join(', ')}`);
    }
    const apiVersion = req.apiVersion || '2024-08-01-preview';
    const url = `${req.endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(req.model)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const tryBody = (withJsonFormat) => ({
        messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userMessage },
        ],
        max_completion_tokens: req.maxTokens,
        ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    });
    return withTimeout(req, async (signal) => {
        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'api-key': req.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(tryBody(true)),
                signal,
            });
        }
        catch (e) {
            return err(req, `Could not reach Azure OpenAI endpoint: ${e.message}`);
        }
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            // Some deployments reject response_format — retry without it.
            if (/response_format|json_object|unsupported/i.test(body)) {
                let retry;
                try {
                    retry = await fetch(url, {
                        method: 'POST',
                        headers: { 'api-key': req.apiKey, 'Content-Type': 'application/json' },
                        body: JSON.stringify(tryBody(false)),
                        signal,
                    });
                }
                catch (e) {
                    return err(req, `Could not reach Azure OpenAI endpoint: ${e.message}`);
                }
                return parseOpenAIResp(req, retry);
            }
            return openaiHttpError(req, resp, body);
        }
        return parseOpenAIResp(req, resp);
    });
}
// ── OpenAI ──────────────────────────────────────────────────────────────────
async function callOpenAI(req) {
    if (!req.apiKey) {
        return err(req, 'Missing OpenAI API key. Set commitDefender.apiKey.');
    }
    const base = (req.endpoint || DEFAULT_OPENAI).replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const model = req.model || 'gpt-4o';
    const tryBody = (withJsonFormat) => ({
        model,
        messages: [
            { role: 'system', content: req.systemPrompt },
            { role: 'user', content: req.userMessage },
        ],
        max_completion_tokens: req.maxTokens,
        ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
    });
    return withTimeout(req, async (signal) => {
        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(tryBody(true)),
                signal,
            });
        }
        catch (e) {
            return err(req, `Could not reach OpenAI API: ${e.message}`);
        }
        if (!resp.ok) {
            const body = await resp.text().catch(() => '');
            if (/response_format|json_object|unsupported/i.test(body)) {
                let retry;
                try {
                    retry = await fetch(url, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${req.apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(tryBody(false)),
                        signal,
                    });
                }
                catch (e) {
                    return err(req, `Could not reach OpenAI API: ${e.message}`);
                }
                return parseOpenAIResp(req, retry);
            }
            return openaiHttpError(req, resp, body);
        }
        return parseOpenAIResp(req, resp);
    });
}
async function parseOpenAIResp(req, resp) {
    if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return openaiHttpError(req, resp, body);
    }
    let data;
    try {
        data = await resp.json();
    }
    catch (e) {
        return err(req, `Invalid JSON in API response: ${e.message}`);
    }
    const raw = data?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') {
        return err(req, `Empty or malformed response: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return { raw: raw.trim() };
}
function openaiHttpError(req, resp, body) {
    const detail = body.slice(0, 600);
    if (resp.status === 401 || resp.status === 403) {
        return err(req, `Authentication failed (HTTP ${resp.status}): ${detail}`);
    }
    if (resp.status === 429) {
        return err(req, `Rate limit exceeded (HTTP 429): ${detail}`);
    }
    return err(req, `HTTP ${resp.status}: ${detail}`);
}
// ── Anthropic ───────────────────────────────────────────────────────────────
async function callAnthropic(req) {
    if (!req.apiKey) {
        return err(req, 'Missing Anthropic API key. Set commitDefender.apiKey.');
    }
    const base = (req.endpoint || DEFAULT_ANTHROPIC).replace(/\/+$/, '');
    const url = `${base}/messages`;
    const model = req.model || 'claude-sonnet-4-6';
    const body = JSON.stringify({
        model,
        max_tokens: req.maxTokens,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userMessage }],
    });
    return withTimeout(req, async (signal) => {
        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: {
                    'x-api-key': req.apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                body,
                signal,
            });
        }
        catch (e) {
            return err(req, `Could not reach Anthropic API: ${e.message}`);
        }
        if (!resp.ok) {
            const detail = (await resp.text().catch(() => '')).slice(0, 600);
            if (resp.status === 401 || resp.status === 403) {
                return err(req, `Anthropic authentication failed (HTTP ${resp.status}): ${detail}`);
            }
            if (resp.status === 429) {
                return err(req, `Anthropic rate limit exceeded (HTTP 429): ${detail}`);
            }
            return err(req, `Anthropic HTTP ${resp.status}: ${detail}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (e) {
            return err(req, `Invalid JSON in Anthropic response: ${e.message}`);
        }
        const block = Array.isArray(data?.content) ? data.content.find((b) => b?.type === 'text') : null;
        const raw = block?.text;
        if (typeof raw !== 'string') {
            return err(req, `Empty or malformed Anthropic response: ${JSON.stringify(data).slice(0, 300)}`);
        }
        return { raw: raw.trim() };
    });
}
// ── Google Gemini ───────────────────────────────────────────────────────────
async function callGemini(req) {
    if (!req.apiKey) {
        return err(req, 'Missing Gemini API key. Set commitDefender.apiKey.');
    }
    const base = (req.endpoint || DEFAULT_GEMINI).replace(/\/+$/, '');
    const model = req.model || 'gemini-2.5-flash';
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;
    const body = JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userMessage }] }],
        generationConfig: {
            maxOutputTokens: req.maxTokens,
            responseMimeType: 'application/json',
        },
    });
    return withTimeout(req, async (signal) => {
        let resp;
        try {
            resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal,
            });
        }
        catch (e) {
            return err(req, `Could not reach Gemini API: ${e.message}`);
        }
        if (!resp.ok) {
            const detail = (await resp.text().catch(() => '')).slice(0, 600);
            if (resp.status === 401 || resp.status === 403) {
                return err(req, `Gemini authentication failed (HTTP ${resp.status}): ${detail}`);
            }
            if (resp.status === 429) {
                return err(req, `Gemini rate limit or quota exceeded (HTTP 429): ${detail}`);
            }
            if (resp.status === 404) {
                return err(req, `Gemini model not found (HTTP 404) — check commitDefender.model: ${detail}`);
            }
            return err(req, `Gemini HTTP ${resp.status}: ${detail}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (e) {
            return err(req, `Invalid JSON in Gemini response: ${e.message}`);
        }
        const parts = data?.candidates?.[0]?.content?.parts;
        const raw = Array.isArray(parts)
            ? parts.map((p) => p?.text ?? '').join('')
            : undefined;
        if (typeof raw !== 'string' || !raw.trim()) {
            return err(req, `Empty or malformed Gemini response: ${JSON.stringify(data).slice(0, 300)}`);
        }
        return { raw: raw.trim() };
    });
}
//# sourceMappingURL=providers.js.map