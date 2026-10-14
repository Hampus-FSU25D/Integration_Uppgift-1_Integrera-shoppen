import { useEffect, useState } from "react";
import { Link } from "../../components/Link";
import {
  getAdminProducts,
  importSupplierCatalog,
  type Product,
  type SupplierImportFormat,
  type SupplierImportReport,
} from "../../services/productService";
import { formatPrice } from "../../utils/format";

type LoadState = "loading" | "ready" | "error";

export function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [importingFormat, setImportingFormat] = useState<SupplierImportFormat | null>(null);
  const [importError, setImportError] = useState("");
  const [importReport, setImportReport] = useState<SupplierImportReport | null>(null);

  async function runImport(format: SupplierImportFormat) {
    setImportingFormat(format);
    setImportError("");
    setImportReport(null);
    try {
      const report = await importSupplierCatalog(format);
      setImportReport(report);
      try {
        setProducts(await getAdminProducts());
      } catch {
        setImportError("Importen genomfördes, men produktlistan kunde inte uppdateras.");
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Importen kunde inte genomföras.");
    } finally {
      setImportingFormat(null);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadProducts() {
      try {
        const productRows = await getAdminProducts();

        if (!active) {
          return;
        }

        setProducts(productRows);
        setLoadState("ready");
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    }

    void loadProducts();

    return () => {
      active = false;
    };
  }, []);

  if (loadState === "loading") {
    return (
      <section className="placeholder">
        <h1>Produkthantering</h1>
        <p>Laddar produkter.</p>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="placeholder">
        <h1>Produkthantering</h1>
        <p>Produkterna kunde inte hämtas. Kontrollera att du är inloggad som administratör.</p>
      </section>
    );
  }

  return (
    <section className="admin-page">
      <div className="page-heading">
        <div>
          <h1>Produkthantering</h1>
          <p>Hantera butikens lager, priser och publicering.</p>
        </div>
        <Link href="/admin/products/new" className="primary-action">
          Lägg till produkt
        </Link>
      </div>

      <section className="supplier-import" aria-labelledby="supplier-import-heading">
        <h2 id="supplier-import-heading">Importera leverantörens produkter</h2>
        <p>Bransch: mat. Välj vilket filformat som ska importeras.</p>
        <div className="supplier-import-actions">
          <button className="button" type="button" disabled={importingFormat !== null} onClick={() => void runImport("csv")}>
            {importingFormat === "csv" ? "Importerar CSV…" : "Importera CSV"}
          </button>
          <button className="button" type="button" disabled={importingFormat !== null} onClick={() => void runImport("xml")}>
            {importingFormat === "xml" ? "Importerar XML…" : "Importera XML"}
          </button>
        </div>
        {importError && <p className="form-error" role="alert">{importError}</p>}
        {importReport && (
          <div className="supplier-import-report" role="status">
            <p>
              Nya: {importReport.created}. Uppdaterade: {importReport.updated}. Överhoppade: {importReport.skipped}.
            </p>
            {importReport.skippedProducts.length > 0 && (
              <ul>
                {importReport.skippedProducts.map((product, index) => (
                  <li key={`${product.articleNumber ?? "unknown"}-${index}`}>
                    {product.articleNumber ?? "Okänt artikelnummer"}: {product.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {products.length === 0 ? (
        <p>Inga produkter finns ännu.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Bild</th>
                <th>Namn</th>
                <th>Kategori</th>
                <th>Pris</th>
                <th>Lager</th>
                <th>Status</th>
                <th>Åtgärder</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id}>
                  <td>
                    {product.imageUrl ? (
                      <img className="admin-product-image" src={product.imageUrl} alt={product.name} />
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>
                    <strong>{product.name}</strong>
                    <br />
                    SKU: {product.sku}
                  </td>
                  <td>
                    <span className="badge muted">{product.categoryName ?? "Ingen kategori"}</span>
                  </td>
                  <td>{formatPrice(product.price)}</td>
                  <td>{product.stock} st</td>
                  <td>
                    <span className={product.isActive ? "badge" : "badge neutral"}>
                      {product.isActive ? "Aktiv" : "Inaktiv"}
                    </span>
                  </td>
                  <td>
                    <Link href={`/admin/products/${product.id}/edit`}>Redigera</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
