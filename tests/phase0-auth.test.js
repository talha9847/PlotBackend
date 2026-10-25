"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

const app = require("../server");
const jwtService = require("../services/jwtService");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });

    server.on("error", reject);
  });
});

after(async () => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

test("public root remains open", async () => {
  const response = await request("/");

  assert.equal(response.status, 200);

  const body = await response.json();

  assert.equal(body.success, true);
});

test("protected route rejects a missing cookie", async () => {
  const response = await request("/api/plots/projects");

  assert.equal(response.status, 401);
});

test("protected route rejects a bogus token", async () => {
  const response = await request("/api/plots/projects", {
    headers: { Cookie: "token=this-is-not-a-jwt" },
  });

  assert.equal(response.status, 401);

  const body = await response.json();

  assert.equal(body.success, false);
});

test("lead update requires authentication (no cookie)", async () => {
  const response = await request(
    "/api/leads/00000000-0000-4000-8000-000000000000",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 401);
});

test("lead update requires authentication (bogus token)", async () => {
  const response = await request(
    "/api/leads/00000000-0000-4000-8000-000000000000",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: "token=bogus",
      },
      body: JSON.stringify({}),
    },
  );

  assert.equal(response.status, 401);
});

test("verifyJwt rejects a malformed token instead of returning undefined", async () => {
  await assert.rejects(() => jwtService.verifyJwt("this-is-not-a-jwt"));
});
