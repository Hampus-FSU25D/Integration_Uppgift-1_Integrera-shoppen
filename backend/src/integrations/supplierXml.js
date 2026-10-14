import { XMLParser, XMLValidator } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (tagName) => tagName === "produkt" || tagName === "variant",
});

export function parseSupplierXml(xml) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new Error(`Supplier XML is malformed: ${validation.err.msg}.`);
  }

  const document = parser.parse(xml);
  const products = document.katalog?.produkt;
  if (!Array.isArray(products)) {
    throw new Error("Supplier XML does not contain a product catalog.");
  }

  return products.map((product) => ({
    artNr: product["@_artNr"],
    ean: nodeText(product.ean),
    benamning: nodeText(product.benamning),
    kategori: nodeText(product.kategori),
    pris: nodeText(product.pris),
    valuta: product.pris?.["@_valuta"],
    lagersaldo: nodeText(product.lagersaldo),
    varianter: product.varianter?.variant?.map(nodeText) ?? [],
    uppdaterad: nodeText(product.uppdaterad),
  }));
}

function nodeText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return value["#text"] ?? "";
  return value;
}
