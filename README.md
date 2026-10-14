# Min egen e-handel

Webbshop med React/Vite, Express och PostgreSQL. React använder Express-API:t för all appdata. Express sköter inloggning, behörighet och checkout; PostgreSQL lagrar produkter, konton, varukorgar och ordrar.

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

## Kontroller

```powershell
npm run typecheck
npm run build
```
