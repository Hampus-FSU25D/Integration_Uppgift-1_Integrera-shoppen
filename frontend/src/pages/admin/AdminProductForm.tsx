import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { uploadAdminProductImage, type Category, type ProductFormInput } from "../../services/productService";

type AdminProductFormProps = {
  categories: Category[];
  initialValues: ProductFormInput;
  submitLabel: string;
  productId?: string;
  isSubmitting: boolean;
  onSubmit: (input: ProductFormInput) => void;
};

export function AdminProductForm({
  categories,
  initialValues,
  submitLabel,
  productId,
  isSubmitting,
  onSubmit,
}: AdminProductFormProps) {
  const [values, setValues] = useState<ProductFormInput>(initialValues);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageMessage, setImageMessage] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploadingImage) return;
    onSubmit(values);
  }

  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setImageMessage("Bilden får vara högst 5 MiB.");
      return;
    }
    if (!productId) {
      setImageMessage("Spara produkten först, så kan du sedan ladda upp bilden.");
      return;
    }

    setIsUploadingImage(true);
    setImageMessage("Laddar upp bilden...");
    try {
      const image = await uploadAdminProductImage(productId, file);
      setValues((current) => ({ ...current, imageUrl: image.publicUrl }));
      setImageMessage(image.searchIndexUpdated
        ? image.cleanupWarning
          ? "Bilden sparades, men den gamla Storage-bilden kunde inte tas bort."
          : "Bilden laddades upp och sparades på produkten."
        : `Bilden sparades, men sökindexet kunde inte uppdateras: ${image.searchIndexError ?? "okänt fel"}`);
    } catch (error) {
      setImageMessage(error instanceof Error ? error.message : "Bilden kunde inte laddas upp.");
    } finally {
      setIsUploadingImage(false);
    }
  }

  return (
    <form className="form-block product-form product-form-layout" onSubmit={handleSubmit}>
      <div className="product-form-main">
        <section className="admin-card form-section">
          <h2>Grundläggande information</h2>
          <label>
            Produktnamn
            <input
              type="text"
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
              required
            />
          </label>

          <label>
            Beskrivning
            <textarea
              value={values.description}
              onChange={(event) => setValues({ ...values, description: event.target.value })}
              rows={5}
            />
          </label>

          <div className="form-row">
            <label>
              Kategori
              <select
                value={values.categoryId ?? ""}
                onChange={(event) => setValues({ ...values, categoryId: event.target.value || null })}
              >
                <option value="">Ingen kategori</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Varumärke
              <input
                type="text"
                value={values.brand}
                onChange={(event) => setValues({ ...values, brand: event.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="admin-card form-section">
          <h2>Lager och prissättning</h2>
          <div className="form-row">
            <label>
              Pris (SEK)
              <input
                type="number"
                min="0"
                step="0.01"
                value={values.price}
                onChange={(event) => setValues({ ...values, price: Number(event.target.value) })}
                required
              />
            </label>

            <label>
              Rabatt (%)
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={values.discountPercentage}
                onChange={(event) => setValues({ ...values, discountPercentage: Number(event.target.value) })}
                required
              />
            </label>

            <label>
              Lager
              <input
                type="number"
                min="0"
                step="1"
                value={values.stock}
                onChange={(event) => setValues({ ...values, stock: Number(event.target.value) })}
                required
              />
            </label>
          </div>

          <label>
            SKU
            <input
              type="text"
              value={values.sku}
              onChange={(event) => setValues({ ...values, sku: event.target.value })}
              required
            />
          </label>
        </section>
      </div>

      <div className="product-form-side">
        <section className="admin-card form-section">
          <h2>Produktbild</h2>
          <div className="image-preview">
            {values.imageUrl ? <img src={values.imageUrl} alt="Förhandsvisning" /> : <span>Bild visas här</span>}
          </div>
          <label>
            Bild-URL
            <input
              type="url"
              value={values.imageUrl}
              onChange={(event) => setValues({ ...values, imageUrl: event.target.value })}
            />
          </label>
          <label>
            Ladda upp bild (JPEG eller PNG, max 5 MiB)
            <input
              type="file"
              accept="image/jpeg,image/png"
              onChange={handleImageChange}
              disabled={!productId || isSubmitting || isUploadingImage}
            />
          </label>
          {!productId && <p>Spara produkten först för att aktivera bilduppladdning.</p>}
          {imageMessage && <p className="form-message" role="status">{imageMessage}</p>}
        </section>

        <section className="admin-card form-section">
          <h2>Status</h2>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(event) => setValues({ ...values, isActive: event.target.checked })}
            />
            Aktiv produkt
          </label>
          <button type="submit" disabled={isSubmitting || isUploadingImage}>
            {isSubmitting ? "Sparar..." : submitLabel}
          </button>
        </section>
      </div>
    </form>
  );
}
