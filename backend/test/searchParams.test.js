import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchParams } from "../src/integrations/searchParams.js";

test("uses defaults and accepts a valid query and page", () => {
  assert.deepEqual(parseSearchParams({ query: "tea", page: "2", pageSize: "24" }), {
    query: "tea", page: 2, pageSize: 24,
  });
  assert.deepEqual(parseSearchParams({}), { query: "", page: 1, pageSize: 12 });
});

test("rejects invalid page numbers and page sizes", () => {
  for (const params of [{ page: "0" }, { page: "-1" }, { page: "1.5" }, { pageSize: "0" }, { pageSize: "1000" }]) {
    assert.throws(() => parseSearchParams(params), /page|pageSize/);
  }
});

test("rejects malformed or overly long search text", () => {
  assert.throws(() => parseSearchParams({ query: ["tea", "coffee"] }), /query/);
  assert.throws(() => parseSearchParams({ query: "x".repeat(201) }), /query/);
});
