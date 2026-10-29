# Min egen e-handel

Webbshop med React/Vite, Express och PostgreSQL. React använder Express-API:t för all appdata. Express sköter inloggning, behörighet och checkout; PostgreSQL lagrar produkter, konton, varukorgar och ordrar.

Publik shop: https://market.hampusandersson.dev

## Kör lokalt

```powershell
Copy-Item .env.example .env
```

Byt `POSTGRES_PASSWORD` och `SESSION_SECRET` i `.env`, starta sedan stacken:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Öppna shoppen på `http://localhost:8080`. API-anrop går via samma adress under `/api`. Databasen sparas i volymen `postgres_data`.

## Exempelprodukter

```powershell
npm run seed-db
```

## Administratör

Registrera ett konto i shoppen och ge det administratörsrollen i databasen:

```powershell
docker compose exec db psql -U shop -d shop -c "UPDATE users SET role = 'admin' WHERE email = 'din-adress@example.com';"
```

## Labb 1 – import av produktdata

Ange `SUPPLIER_API_BASE_URL` och `SUPPLIER_API_KEY` i den lokala `.env`-filen. Variabelnamnen finns i `.env.example`; använd aldrig riktiga nycklar där. Importen använder leverantörens bransch `mat`, som valdes eftersom shoppen främst innehåller dagligvaror.

Logga in som administratör och öppna **Produkter**. Där finns en knapp för CSV och en för XML. Resultatet visar antal nya, uppdaterade och överhoppade produkter samt artikelnummer och orsak för överhoppade rader.

Artikelnumret sparas i produktmodellens unika `sku`-fält så att nästa import uppdaterar samma produkt. Produktmodellen saknar EAN- och variantfält, så de värdena importeras inte. Leverantörens tomma lagersaldo blir noll; decimalpriser med kommatecken blir numeriska priser. Trasiga produkter hoppas över, till exempel `LEV-1037` med ogiltigt pris.

Kör de fokuserade backendtesterna från projektroten:

```powershell
node --test backend/test/supplierAdapter.test.js backend/test/supplierCsv.test.js backend/test/supplierXml.test.js backend/test/supplierProduct.test.js backend/test/supplierImport.test.js
```

## Labb 2 – Algolia-sökning

Skapa separata Algolia-nycklar för indexering och sökning. Ange app-ID, admin-nyckel, söknyckel och indexnamn med `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_API_KEY`, `ALGOLIA_SEARCH_API_KEY` och `ALGOLIA_INDEX_NAME` i lokal `.env` och i deploymentens servermiljö. `.env.example` visar bara variabelnamnen. Admin-nyckeln används bara av Express; webbläsaren anropar `/api/search`.

När Algolia-nycklarna är konfigurerade, importera leverantörens CSV eller XML igen från adminsidan för att skicka butikens produkter till indexet. Importen indexerar produktmodellerna från databasen efter commit, inklusive produkter som redan fanns där. Nya, ändrade och borttagna produkter synkas efter att databasskrivningen lyckats. Om synken misslyckas ligger produkten kvar i databasen och adminsidan visar att indexet behöver uppdateras. `objectID` är produktens SKU/artikelnummer.

Sökningen hanteras av Express och returnerar produkter, totalt antal träffar och sidantal. `page` börjar på 1 och `pageSize` har maxtaket 50. Exempel på lokal API-kontroll efter start: `http://localhost:8080/api/search?query=kakao&page=1&pageSize=12`. Ogiltiga värden, till exempel `page=0` eller `pageSize=1000`, ger HTTP 400.

Backendtesterna för leverantörsimport och sökindex körs med:

```powershell
node --test
```

## Labb 3 - Stripe Checkout

Stripe Checkout använder testläge. Ange `STRIPE_SECRET_KEY` (`sk_test_...`),
`STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` och `STRIPE_WEBHOOK_SECRET` i `.env`.
`.env.example` visar URL-formatet och variabelnamnen. För lokal testning kör
Stripe CLI och vidarebefordra webhook-anrop till Express:

```powershell
stripe listen --forward-to localhost:8080/api/payments/stripe/webhook
```

Kopiera CLI:ns signeringshemlighet `whsec_...` till `STRIPE_WEBHOOK_SECRET` och
starta om backend. I Stripe Dashboard anger du den deployade endpointen som
`https://market.hampusandersson.dev/api/payments/stripe/webhook` och väljer
`checkout.session.completed`, `checkout.session.async_payment_succeeded` samt
`checkout.session.expired`. Använd endpointens testlägeshemlighet i serverns
miljö. Lägg aldrig Stripe-nycklar i Git.

Efter ett testköp ska ordern visas som **Betald** i admin och produktlagret
minska med beställt antal. Stripe-metadata innehåller hela orderns UUID.
Adminlistan visar ett kort prefix och orderdetaljsidan visar hela numret.

## Labb 4 - produktbilder

Serverns Supabase Storage-adapter accepterar JPEG- och PNG-innehåll som matchar
filens format. Maxstorleken är 5 MiB (5 242 880 byte); större filer avvisas
innan något skickas till Storage. Den inkommande uppladdningsrouten får samma
gräns. Administratörer kan skicka en fil i multipart-fältet `image` till
`POST /api/admin/product-images` med headern `X-Requested-With: XMLHttpRequest`.

## Kontroller

```powershell
npm run typecheck
npm run build
```
