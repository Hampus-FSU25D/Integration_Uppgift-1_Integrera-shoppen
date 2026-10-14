import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSupplierXml } from "../src/integrations/supplierXml.js";

test("parses supplier XML fields as strings and variants as a list", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <katalog>
      <produkt artNr="LEV-1001">
        <ean>0735105543300</ean>
        <benamning>Surdegsbröd</benamning>
        <kategori>Bröd</kategori>
        <pris valuta="SEK">59.00</pris>
        <lagersaldo></lagersaldo>
        <varianter><variant>Helt</variant><variant>Skivat</variant></varianter>
        <uppdaterad>2026-09-01T08:00:00.000Z</uppdaterad>
      </produkt>
    </katalog>`;

  assert.deepEqual(parseSupplierXml(xml), [
    {
      artNr: "LEV-1001",
      ean: "0735105543300",
      benamning: "Surdegsbröd",
      kategori: "Bröd",
      pris: "59.00",
      valuta: "SEK",
      lagersaldo: "",
      varianter: ["Helt", "Skivat"],
      uppdaterad: "2026-09-01T08:00:00.000Z",
    },
  ]);
});

test("reports malformed supplier XML", () => {
  assert.throws(() => parseSupplierXml("<katalog><produkt></katalog>"), /malformed/i);
});
