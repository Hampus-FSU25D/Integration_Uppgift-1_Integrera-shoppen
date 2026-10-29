import test from "node:test";
import assert from "node:assert/strict";
import { parseSearchParams } from "../src/integrations/searchParams.js";

test("uses defaults and accepts a valid query and page", () => {
  assert.deepEqual(parseSearchParams({ query: "tea", page: "2", pageSize: "24" }), {
    query: "tea", page: 2, pageSize: 24, categorySlug: null, sort: "relevance",
  });
  assert.deepEqual(parseSearchParams({}), { query: "", page: 1, pageSize: 12, categorySlug: null, sort: "relevance" });
});

test("accepts and normalizes a category slug with a text query", () => {
  assert.deepEqual(parseSearchParams({ query: " tea ", category: "hot-drinks" }), {
    query: "tea", page: 1, pageSize: 12, categorySlug: "hot-drinks", sort: "relevance",
  });
});

test("rejects invalid or repeated category parameters", () => {
  for (const category of ["", "Hot Drinks", "foo_bar", "a".repeat(101), ["mat", "dryck"]]) {
    assert.throws(() => parseSearchParams({ category }), /category/i);
  }
});

test("accepts the supported sort modes and defaults to relevance", () => {
  for (const sort of ["relevance", "price_asc", "price_desc"]) {
    assert.equal(parseSearchParams({ sort }).sort, sort);
  }
  assert.equal(parseSearchParams({}).sort, "relevance");
});

test("rejects invalid or repeated sort parameters", () => {
  for (const sort of ["name", "asc", "price", ["price_asc", "price_desc"]]) {
    assert.throws(() => parseSearchParams({ sort }), /sort/i);
  }
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
