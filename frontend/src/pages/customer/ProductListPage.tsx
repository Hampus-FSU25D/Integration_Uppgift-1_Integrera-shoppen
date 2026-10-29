import { useEffect, useMemo, useState } from "react";
import { CategoryFilter } from "../../components/CategoryFilter";
import { ProductCard } from "../../components/ProductCard";
import { getCategories, searchActiveProducts, type Category, type Product, type ProductSearchResult, type ProductSort } from "../../services/productService";

type LoadState = "loading" | "ready" | "error";
const PRODUCTS_PER_PAGE = 12;

function readProductSearch() {
  return new URLSearchParams(window.location.search).get("search")?.trim() ?? "";
}

function readPage() {
  const value = new URLSearchParams(window.location.search).get("page");
  return value === null ? 1 : Number(value);
}

export function ProductListPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<ProductSearchResult | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState(readProductSearch);
  const [sort, setSort] = useState<ProductSort>("relevance");
  const [page, setPage] = useState(readPage);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    getCategories().then((rows) => {
      if (active) setCategories(rows);
    }).catch(() => {
      if (active) setCategories([]);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadState("loading");
    setErrorMessage("");
    const loadProducts = searchActiveProducts(searchQuery, page, PRODUCTS_PER_PAGE, selectedCategory || undefined, sort);
    loadProducts.then((searchResult) => {
      if (!active) return;
      setResult(searchResult);
      setLoadState("ready");
      if (searchResult.totalPages > 0 && page > searchResult.totalPages) changePage(searchResult.totalPages);
    }).catch((error: Error) => {
      if (!active) return;
      setErrorMessage(error.message || "Sökningen misslyckades. Försök igen senare.");
      setLoadState("error");
    });
    return () => { active = false; };
  }, [searchQuery, page, selectedCategory, sort]);

  useEffect(() => {
    function handleNavigation() {
      setSearchQuery(readProductSearch());
      setPage(readPage());
    }
    window.addEventListener("popstate", handleNavigation);
    return () => window.removeEventListener("popstate", handleNavigation);
  }, []);

  const visibleProducts = useMemo(() => result?.hits ?? [], [result]);

  const heading = selectedCategory
    ? categories.find((category) => category.slug === selectedCategory)?.name ?? "Produkter"
    : "Alla produkter";
  const emptyMessage = searchQuery ? `Inga produkter matchar "${searchQuery}".` : "Inga produkter hittades.";

  function changePage(nextPage: number) {
    const url = new URL(window.location.href);
    if (nextPage === 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(nextPage));
    window.history.pushState({}, "", `${url.pathname}${url.search}`);
    setPage(nextPage);
  }

  function clearSearch() {
    window.history.pushState({}, "", "/");
    setSearchQuery("");
    setPage(1);
  }

  return (
    <section className="storefront-layout">
      <CategoryFilter categories={categories} selectedSlug={selectedCategory} onChange={(slug) => {
        setSelectedCategory(slug);
        changePage(1);
      }} />

      <div className="product-list-content">
        <div className="page-heading">
          <div>
            <h1>{heading}</h1>
            {loadState === "ready" && <p>Visar {visibleProducts.length} av {result?.totalHits ?? 0} produkter</p>}
            {searchQuery && (
              <p className="search-summary">
                <span>Resultat för "{searchQuery}".</span>
                <button type="button" onClick={clearSearch}>Rensa sökning</button>
              </p>
            )}
          </div>
          <label className="filter-field search-sort-control">
            Sortera efter
            <select value={sort} onChange={(event) => {
              setSort(event.target.value as ProductSort);
              changePage(1);
            }}>
              <option value="relevance">Relevans</option>
              <option value="price_asc">Pris: lägst först</option>
              <option value="price_desc">Pris: högst först</option>
            </select>
          </label>
        </div>

        {loadState === "loading" ? <p role="status">Söker produkter…</p> : null}
        {loadState === "error" ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {loadState === "ready" && visibleProducts.length === 0 ? <p>{emptyMessage}</p> : null}
        {loadState === "ready" && visibleProducts.length > 0 && (
          <>
            <div className="product-grid">
              {visibleProducts.map((product: Product) => <ProductCard key={product.id} product={product} />)}
            </div>
            <nav className="search-pagination" aria-label="Produktsidor">
              <button type="button" className="secondary-action" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                Föregående
              </button>
              <span>Sida {page} av {result?.totalPages ?? 0}</span>
              <button type="button" className="secondary-action" disabled={page >= (result?.totalPages ?? 0)} onClick={() => changePage(page + 1)}>
                Nästa
              </button>
            </nav>
          </>
        )}
      </div>
    </section>
  );
}
