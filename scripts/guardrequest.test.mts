import test from "node:test";
import assert from "node:assert/strict";
import { checkRequest } from "../src/lib/guardrequest.ts";

const base = { method: "POST", host: "localhost:3000", origin: null as string | null, secFetchSite: null as string | null };
const ok = (r: Parameters<typeof checkRequest>[0]) => assert.equal(checkRequest(r).ok, true, JSON.stringify(r));
const no = (r: Parameters<typeof checkRequest>[0]) => assert.equal(checkRequest(r).ok, false, JSON.stringify(r));

test("local hosts are accepted, anything else is refused (DNS rebinding)", () => {
  for (const host of ["localhost:3000", "localhost", "127.0.0.1:3100", "[::1]:3000", "LOCALHOST:3000"]) ok({ ...base, host, method: "GET" });
  for (const host of ["evil.example", "evil.example:3000", "localhost.evil.example", "127.0.0.1.evil.example:3000", "", null]) {
    no({ ...base, host, method: "GET" });
  }
});

test("a page on another site cannot change anything", () => {
  no({ ...base, origin: "https://evil.example" });
  no({ ...base, secFetchSite: "cross-site" });
  no({ ...base, secFetchSite: "same-site" });
  no({ ...base, origin: "http://localhost:4000" }); // another local app on another port is another site
  no({ ...base, origin: "null" });
  no({ ...base, method: "PATCH", origin: "https://evil.example" });
  no({ ...base, method: "DELETE", secFetchSite: "cross-site" });
});

test("the Studio's own pages and command-line tools can", () => {
  ok({ ...base, origin: "http://localhost:3000", secFetchSite: "same-origin" });
  ok({ ...base, secFetchSite: "none" });
  ok({ ...base }); // node fetch from scripts/efj.mjs: no Origin, no Sec-Fetch-Site
  ok({ ...base, method: "DELETE", origin: "http://localhost:3000" });
});

test("reading is allowed from anywhere on a local host, since a foreign page cannot read the reply", () => {
  ok({ ...base, method: "GET", origin: "https://evil.example", secFetchSite: "cross-site" });
});

test("extra host names can be allowed on purpose", () => {
  no({ ...base, host: "studio.home:3000", method: "GET" });
  ok({ ...base, host: "studio.home:3000", method: "GET", allowedHosts: ["studio.home:3000"] });
  ok({ ...base, host: "studio.home:3000", origin: "http://studio.home:3000", allowedHosts: ["Studio.Home:3000"] });
});
