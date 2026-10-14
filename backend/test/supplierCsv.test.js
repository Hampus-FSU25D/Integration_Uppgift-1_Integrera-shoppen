import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSupplierCsv } from "../src/integrations/supplierCsv.js";

test("parses supplier rows without converting product values", () => {
  const csv = [
    "artNr;ean;benamning;kategori;pris;lagersaldo;varianter;uppdaterad",
    "LEV-1001;0735105543300;Surdegsbröd Klassisk;Bröd;59,00;0;Helt|Skivat;2026-09-01",
    "LEV-1002;0735105551219;Smörgås;Mat;79,00;;;2026-09-02",
  ].join("\r\n");

  assert.deepEqual(parseSupplierCsv(csv).rows, [
    {
      artNr: "LEV-1001",
      ean: "0735105543300",
      benamning: "Surdegsbröd Klassisk",
      kategori: "Bröd",
      pris: "59,00",
      lagersaldo: "0",
      varianter: "Helt|Skivat",
      uppdaterad: "2026-09-01",
    },
    {
      artNr: "LEV-1002",
      ean: "0735105551219",
      benamning: "Smörgås",
      kategori: "Mat",
      pris: "79,00",
      lagersaldo: "",
      varianter: "",
      uppdaterad: "2026-09-02",
    },
  ]);
});

test("parses quoted semicolons and escaped quotes in fields", () => {
  const csv = [
    "artNr;benamning",
    'LEV-1001;"Bröd; ""surdegs"""',
  ].join("\n");

  assert.deepEqual(parseSupplierCsv(csv).rows, [
    { artNr: "LEV-1001", benamning: 'Bröd; "surdegs"' },
  ]);
});

test("skips rows whose number of values differs from the header with a reason", () => {
  assert.deepEqual(parseSupplierCsv("artNr;ean\nLEV-1001;0735\nLEV-1002"), {
    rows: [{ artNr: "LEV-1001", ean: "0735" }],
    skipped: [{
      articleNumber: "LEV-1002",
      reason: "CSV row 3 has 1 value; expected 2.",
    }],
  });
});
