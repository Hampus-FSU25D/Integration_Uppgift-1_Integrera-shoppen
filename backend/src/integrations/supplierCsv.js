export function parseSupplierCsv(csv) {
  if (typeof csv !== "string") {
    throw new Error("Supplier CSV must be text.");
  }

  const records = parseRecords(csv);
  const headers = records.shift()?.map((header, index) => {
    return index === 0 ? header.replace(/^\uFEFF/, "") : header;
  });

  if (!headers?.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error("Supplier CSV has invalid headers.");
  }

  const rows = [];
  const skipped = [];
  records.forEach((values, index) => {
    if (values.length === 1 && values[0] === "") return;
    if (values.length !== headers.length) {
      const rowNumber = index + 2;
      const noun = values.length === 1 ? "value" : "values";
      skipped.push({
        articleNumber: values[0] || null,
        reason: `CSV row ${rowNumber} has ${values.length} ${noun}; expected ${headers.length}.`,
      });
      return;
    }
    rows.push(Object.fromEntries(headers.map((header, column) => [header, values[column]])));
  });
  return { rows, skipped };
}

function parseRecords(csv) {
  const records = [];
  let record = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (inQuotes) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== ";" && character !== "\r" && character !== "\n") {
      throw new Error("Supplier CSV has unexpected text after a quoted field.");
    }

    if (character === '"') {
      if (field) throw new Error("Supplier CSV has an unexpected quote in a field.");
      inQuotes = true;
    } else if (character === ";") {
      record.push(field);
      field = "";
      afterQuote = false;
    } else if (character === "\r" || character === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      afterQuote = false;
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("Supplier CSV has an unclosed quoted field.");
  if (field || record.length || afterQuote) {
    record.push(field);
    records.push(record);
  }
  return records;
}
