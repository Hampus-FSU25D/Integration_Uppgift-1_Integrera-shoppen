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
`POST /api/admin/products/:id/image` med headern `X-Requested-With: XMLHttpRequest`.
Vid en lyckad uppladdning sparas Storage-sökvägen i `image_storage_path` och den
publika HTTPS-adressen i `image_url` för produkten. Databasmigreringen körs vid
backendens start. I produktens adminformulär kan en JPEG- eller PNG-fil laddas
upp när produkten har sparats; fältet Bild-URL finns kvar som alternativ. Vid byte
sparas den nya bilden innan den gamla Storage-filen tas bort.

## Labb 5 – PostNord (steg 1–4: adapter, routes, leveranstid och fraktpris)

Backendens PostNord-adapter hämtar flera närliggande serviceställen med
`GET /rest/businesslocation/v5/servicepoints/nearest/byaddress` på sandboxen
`https://atapi2.postnord.com`. Den tar ett svenskt postnummer och returnerar
bara ID, landskod, namn och besöksadress. Nyckeln skickas server-till-server i
PostNords `apikey`-parameter och lagras i `POSTNORD_API_KEY`; sandboxvärdena
konfigureras via `.env` eller serverns miljövariabler. Se `.env.example`.

Dokumentationskälla: [PostNord Customer API Guides – Service Points v5](https://guide.developer.postnord.com/).
Guiden anger sandboxvärd, API-nyckelautentisering och `nearest/byaddress` för
flera sorterade närliggande serviceställen. Den skiljer detta från
`bypostalcode`, som returnerar ett standardombud. Guidens exempel på ett
serviceställesvar visar fälten `servicePointId` och `visitingAddress`; adaptern
validerar dessa och mappar endast de uppgifter shoppen behöver. PostNord anger
också att ID måste kombineras med landskod. API-svarsmappningen är verifierad
mot guideexemplet och mocktester; ett liveanrop mot sandboxen återstår.

Steg 2 exponerar sökningen genom `GET
/api/shipping/service-points?postalCode=12345`. Routens Express-handler avvisar
saknat eller dubblerat postnummer, anropar adaptern och returnerar dess
begränsade serviceställeformat. Providerfel blir kontrollerade HTTP-fel.
Express-testerna använder en mockad adapter och kräver varken en startad server
eller PostNord-nyckel:

```powershell
node --test backend/test/postNordServicePointRoutes.test.js
```

Ett manuellt anrop till `http://localhost:3000/api/shipping/service-points?postalCode=12345`
kräver att backend körs och att PostNord-sandboxen är konfigurerad i `.env`.

Steg 3 hämtar leveransintervall från PostNords Delivery Options API via
`GET /api/shipping/delivery-estimate?postalCode=41104&deliveryType=home`.
PostNord rekommenderar Delivery Options för checkout och dess dokumenterade
svar innehåller `deliveryTime.dayRange.days`; shoppen visar därför intervallet
som PostNord returnerar, utan att räkna fram ett eget datum. `deliveryType` är
`home` eller `service-point`. Anropet anger butikens postnummer och aktuell
handover-tid. För att anropa tjänsten behövs även `POSTNORD_CUSTOMER_KEY` och
`POSTNORD_ORIGIN_POSTAL_CODE` i backendmiljön.

Dokumentationskälla: [PostNord Customer API Guides – Delivery Options](https://guide.developer.postnord.com/).
Den innehåller requestformatet för `POST /rest/shipment/v1/deliveryoptions/bywarehouse`,
leveransalternativen och `deliveryTime.dayRange.days`. Den separata Transit
Time Calculation-guiden beskriver servicekoder och postnummer, men den publika
guidesidan visar inget lyckat svarsexempel för dess svarsschema. Delivery
Options valdes eftersom dess officiella request- och svarsexempel räcker för
att validera och visa ett intervall korrekt.

Steg 4 exponerar `POST /api/shipping/quote`. Klienten skickar produkt-ID:n och
antal; backend hämtar produktpris och lager från PostgreSQL och returnerar
delsumma samt total för båda fraktsätten. Klientens eventuella priser ignoreras.
Frakt är 59 kr till ombud och 99 kr hem, med fri frakt vid minst 500 kr i
varusumma. Det här är förslag i labbtexten, inte tvingande belopp; värdena kan
ändras med `SHIPPING_SERVICE_POINT_PRICE_SEK`, `SHIPPING_HOME_PRICE_SEK` och
`SHIPPING_FREE_THRESHOLD_SEK`. Beräkningen använder heltalsören.
konfigurerbara startvärden, inte som lärarkrav.

Backendtesterna för offertberäkningen körs med:

```powershell
node --test backend/test/shippingPricing.test.js backend/test/shippingQuoteRoutes.test.js
```

## Kontroller

```powershell
npm run typecheck
npm run build
```
