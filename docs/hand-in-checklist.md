# Inlämningschecklista

Denna checklista visar var kraven i uppgiften uppfylls i projektet.

## Betyg G

| Krav | Var det finns |
| --- | --- |
| Diagram för databas | `docs/diagrams/database-er-diagram.eraser.md` |
| Sitemap | `docs/planning/sitemap.md` |
| Tidsplan | `docs/planning/time-plan.md` |
| Databas med tabeller enligt diagram | PostgreSQL-schemat i `backend/src/db/migrations/` och diagrammet i `docs/diagrams/database-er-diagram.eraser.md` |
| Admin kan lägga till produkter | `frontend/src/pages/admin/AdminProductNewPage.tsx` och `frontend/src/pages/admin/AdminProductForm.tsx` |
| Admin kan redigera produkter | `frontend/src/pages/admin/AdminProductEditPage.tsx` och `frontend/src/services/productService.ts` |
| Produkter sparas i databasen | `frontend/src/services/productService.ts` anropar Express; backend skriver till PostgreSQL-tabellen `products` |
| Kunder kan se alla produkter | `frontend/src/pages/customer/ProductListPage.tsx` |
| Kunder kan lägga produkter i varukorg | `frontend/src/cart/CartContext.tsx` och `frontend/src/components/ProductCard.tsx` |
| Kunden kan betala simulerat och skapa order | `frontend/src/pages/customer/CheckoutPage.tsx` och `frontend/src/services/orderService.ts` |
| Order sparas i databasen | `POST /api/orders` validerar priser/lager och skapar order i en PostgreSQL-transaktion |
| Admin kan se ordrar och beställda produkter | `frontend/src/pages/admin/AdminOrdersPage.tsx` och `frontend/src/pages/admin/AdminOrderDetailsPage.tsx` |
| Sidan är deployad | Länk finns i `README.md` |

## Betyg VG

| Krav | Var det finns |
| --- | --- |
| Alla G-krav | Se listan ovan |
| Varukorg sparas i databasen för inloggade kunder | `frontend/src/cart/CartContext.tsx`, `frontend/src/services/cartService.ts` och sessionsskyddade Express-routes |
| Endast administratörer kan redigera produkter | `frontend/src/auth/RequireAdmin.tsx` samt serverkontroll i `backend/src/server.js` |
| Login finns | `frontend/src/pages/customer/LoginPage.tsx`, `frontend/src/pages/customer/RegisterPage.tsx` och `frontend/src/auth/AuthContext.tsx` |
| Admin kan ändra orderstatus | `frontend/src/pages/admin/AdminOrderDetailsPage.tsx` och `frontend/src/services/orderService.ts` |
| Statusvärden | `Beställd`, `Behandlas`, `Levererad`, `Återbetald` |

## Uppgift 2: Google, GitHub och e-post

| Krav | Var det finns | Status |
| --- | --- | --- |
| Labb 6: Google-inloggning, kundsession och Mina sidor | `backend/src/integrations/googleOAuthRoutes.js`, `backend/src/integrations/googleOAuthAdapter.js` och orderhistorikens routes | Implementerad; samtliga `Klart när`-krav återstår att verifiera i den deployade shoppen |
| Labb 7: GitHub-admininloggning och skyddade adminroutes | `backend/src/integrations/githubOAuthRoutes.js` och `backend/src/server.js` | Manuellt verifierad lokalt; deployad verifiering återstår |
| Labb 7: skapa och lista issues | `backend/src/integrations/githubIssuesRoutes.js`, `backend/src/integrations/githubIssuesAdapter.js` och `frontend/src/pages/admin/AdminGitHubIssuesPage.tsx` | Skapa, lista, rapportör och 401 utan session manuellt verifierade lokalt; deployad verifiering återstår |
| Labb 8: skicka orderbekräftelse efter betald order | `backend/src/integrations/stripeWebhookRoutes.js` och `backend/src/integrations/resendEmailAdapter.js` | Implementerad; lokala tester passerar och ett syntetiskt provmejl accepterades av Resend; full verifiering i deployad shop återstår |

## Granskningsuppgifter

Den publika deployment-länken och admininloggningen finns i `README.md`.

Kör lokalt med Compose:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Kontrollera innan inlämning:

```powershell
npm run typecheck
npm run build
```
