import { test } from "node:test";
import assert from "node:assert/strict";
import { ThreadsApiError, api, diagnose, headCheck } from "../scripts/lib/threads-common.mjs";

test("api:5xx 重試後成功", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return new Response("oops", { status: 500 });
    return new Response(JSON.stringify({ id: "1" }), { status: 200 });
  };
  const out = await api({ method: "GET", path: "v1.0/me", token: "t", fetchImpl, retryDelayMs: 1 });
  assert.deepEqual(out, { id: "1" });
  assert.equal(calls, 3);
});

test("api:4xx 不重試,丟 ThreadsApiError 帶 meta", async () => {
  let calls = 0;
  const body = JSON.stringify({ error: { message: "Failed to decode", code: 190, type: "OAuthException" } });
  const fetchImpl = async () => { calls++; return new Response(body, { status: 400 }); };
  await assert.rejects(
    api({ method: "GET", path: "v1.0/me", token: "t", fetchImpl, retryDelayMs: 1 }),
    (err) => err instanceof ThreadsApiError && err.meta.code === 190 && err.status === 400,
  );
  assert.equal(calls, 1);
});

test("headCheck:HEAD 被 405 拒絕時退回 Range GET", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.method);
    if (init.method === "HEAD") return new Response(null, { status: 405 });
    return new Response("x", { status: 206, headers: { "content-type": "video/mp4" } });
  };
  const r = await headCheck("https://cdn.example.com/a.mp4", { fetchImpl });
  assert.deepEqual(seen, ["HEAD", "GET"]);
  assert.equal(r.ok, true);
  assert.equal(r.contentType, "video/mp4");
});

test("headCheck:網路錯誤回 ok:false 不丟例外", async () => {
  const fetchImpl = async () => { throw new Error("ENOTFOUND"); };
  const r = await headCheck("https://nope.example.com/a.mp4", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});

test("diagnose:code 190 → TOKEN_INVALID_OR_EXPIRED(step 5)", () => {
  const err = new ThreadsApiError("x", { status: 400, body: "", meta: { code: 190, message: "Failed to decode" } });
  const d = diagnose(err, { phase: "setup" });
  assert.equal(d.error, "TOKEN_INVALID_OR_EXPIRED");
  assert.equal(d.step, 5);
});

test("diagnose:scope 錯誤 → MISSING_SCOPE(step 2)", () => {
  const err = new ThreadsApiError("x", { status: 403, body: "", meta: { code: 10, message: "(#10) Permission denied" } });
  assert.equal(diagnose(err).error, "MISSING_SCOPE");
});

test("diagnose:未知錯誤 → UNKNOWN + 指向排查章節", () => {
  const d = diagnose(new Error("boom"));
  assert.equal(d.error, "UNKNOWN");
  assert.match(d.action, /threads-publishing-rules/);
});
