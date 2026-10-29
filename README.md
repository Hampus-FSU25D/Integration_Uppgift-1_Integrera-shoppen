# Min egen e-handel

En svensk webbshop med produktkatalog, sökning, kundkonton, varukorg, checkout och en administratörsdel för produkter och ordrar. Projektet är inlämningsuppgift 1, **Integrera shoppen med omvärlden**.

**Publik shop:** https://market.hampusandersson.dev<br>
**GitHub:** https://github.com/Hampus-FSU25D/Integration_Uppgift-1_Integrera-shoppen

Frontend är React 19, TypeScript och Vite. Webbläsaren anropar shopens Express-API; Express hanterar inloggning, behörighet, validering och integrationer. PostgreSQL lagrar bland annat konton, produkter, varukorgar och ordrar. `compose.yaml` startar databasen, API:t och frontend. Backend kör databasmigreringar när den startar.

## Kom igång lokalt

Du behöver Node.js 20 eller senare, npm och Docker med Docker Compose. Integrationsnycklar krävs för att använda respektive extern tjänst.

1. Klona repot och installera paketen från projektroten:

   ```powershell
   npm install
   ```

2. Skapa en lokal miljöfil och fyll i minst databaslösenord och sessionshemlighet:

   ```powershell
   Copy-Item .env.example .env
   ```

   Ändra `POSTGRES_PASSWORD` och `SESSION_SECRET` till egna slumpmässiga värden. Fyll även i nycklar för de integrationer du vill prova. `.env` är ignorerad av Git; lägg aldrig riktiga nycklar i `.env.example` eller i källkoden.

3. Starta den lokala stacken:

   ```powershell
   docker compose -f compose.yaml -f compose.dev.yaml up --build
   ```

   Öppna http://localhost:8080. API:t nås via samma adress under `/api`. Compose skapar PostgreSQL-volymen `postgres_data`; backend kör migrationerna vid uppstart. Stoppa med `Ctrl+C` och `docker compose -f compose.yaml -f compose.dev.yaml down`.

För separat frontendutveckling och backend kör du `npm run dev:backend` respektive `npm run dev:frontend` i två terminaler. De lokala utvecklingsportarna är normalt 3000 för API och 5173 för Vite. Miljövariablerna läses från projektets `.env`. Kör `npm run db:migrate` före första starten; den separata backendens utvecklingskommando kör inte migreringarna automatiskt.

För att lägga in exempelprodukter när databasen är igång kan du köra `npm run seed-db`. Skriptet hämtar exempeldata från DummyJSON. Konton registreras via shoppen. Publik registrering ger alltid rollen `customer`; den skapar inte ett administratörskonto. Se avsnittet **Administratörsåtkomst** innan läraren ska prova adminfunktionerna.

## Integrationer

### Labb 1 – import av produktdata

Backend hämtar CSV eller XML från leverantörens export-API med `SUPPLIER_API_BASE_URL` och `SUPPLIER_API_KEY`. Branschen är `mat`. CSV parsas från text med semikolon som avgränsare; XML valideras före parsning. Svarskodning avläses från HTTP-svaret. Artikelnummer lagras som produktens unika SKU, decimalpriser med kommatecken blir numeriska priser och tomt lagersaldo blir noll. EAN bevaras som text och varianter parsas till listor i både CSV- och XML-importen. Ogiltiga poster hoppas över med orsak. Importen gör upsert på SKU och administrationssidan har separata CSV- och XML-knappar med antal nya, ändrade och överhoppade poster. EAN och varianter sparas inte eftersom produktmodellen saknar fält för dem.

### Labb 2 – Algolia-sökning

React skickar fritext, sida, sidstorlek och valfria parametrar för kategori och sortering till `/api/search`; Express validerar dem och anropar Algolia. Kategorin filtreras tillsammans med fritexten. Sorteringen kan vara relevans, lägsta pris eller högsta pris. Svaret kontrolleras och innehåller träffar, totalt antal träffar och sidantal efter filter och sortering. `page` börjar på 1 och `pageSize` är högst 50. Algolias skrivnyckel används av backend för att synka produkter efter import och produktändringar; söknyckeln används för sökningar. Om synkningen misslyckas sparas produkten ändå och admin får en varning. Om sökningen misslyckas visas ett fel i shoppen.

Algolia-indexet behöver konfigureras innan kategori och prissortering kan användas: lägg till `filterOnly(categorySlug)` i indexets `attributesForFaceting` och skapa standardreplikerna `<ALGOLIA_INDEX_NAME>_price_asc` och `<ALGOLIA_INDEX_NAME>_price_desc`, sorterade numeriskt på `price`. Behåll befintliga indexinställningar. Se Algolias dokumentation om [filterbara attribut](https://www.algolia.com/doc/api-reference/api-parameters/attributesForFaceting) och [sortering med repliker](https://www.algolia.com/doc/guides/managing-results/refine-results/sorting/in-depth/exhaustive-sort).

### Labb 3 – Stripe Checkout

Express räknar priser och kontrollerar lagersaldo från PostgreSQL, skapar en obetald order och ber Stripe skapa en Checkout-session. Kunden går vidare till Stripes betalningssida. Stripe skickar sedan webhookhändelser till `/api/payments/stripe/webhook`. Backend verifierar signaturen och orderns belopp innan den markerar ordern betald och minskar lagret i en transaktion. Upprepad webhook behandlas idempotent. En utgången session avbryter en fortfarande obetald order. Använd testnycklar. Lokalt kan Stripe CLI vidarebefordra webhooken:

```powershell
stripe listen --forward-to localhost:8080/api/payments/stripe/webhook
```

Ange CLI:ns `whsec_...` som `STRIPE_WEBHOOK_SECRET`. I Stripe Dashboard behöver testendpointen vara `https://market.hampusandersson.dev/api/payments/stripe/webhook` med händelserna `checkout.session.completed`, `checkout.session.async_payment_succeeded` och `checkout.session.expired`. Nycklar och webhookhemlighet ska ligga i backendens miljö.

### Labb 4 – produktbilder i Supabase Storage

En administratör laddar upp en JPEG- eller PNG-bild genom Express. Servern kontrollerar filtyp och innehåll, begränsar filen till 5 MiB och laddar upp den till en unik sökväg i Supabase Storage med en hemlig servernyckel. Produktens Storage-sökväg och publika bildadress sparas i PostgreSQL. Vid bildbyte sparas den nya bilden och databasreferensen innan den gamla filen tas bort. Fel från Storage ger ett kontrollerat fel; en misslyckad uppladdning lämnar den gamla produktbilden kvar.

### Labb 5 – PostNord-frakt

Express-adaptern anropar PostNords sandbox för närliggande ombud och leveransintervall. Checkout visar ombuds- eller hemleverans, ombudsval, uppskattad leveranstid och fraktpris. Kunden väljer ombud från PostNords svar. När ordern skapas hämtar backend ombuden igen för att kontrollera det valda ID:t och landet. Pris och orderrader räknas från PostgreSQL; servern sparar fraktsätt, pris och ombudsuppgifter och skickar samma totalsumma till Stripe. Standardpriserna är 59 kr till ombud och 99 kr hem, med fri frakt från 500 kr. `SHIPPING_SERVICE_POINT_PRICE_SEK`, `SHIPPING_HOME_PRICE_SEK` och `SHIPPING_FREE_THRESHOLD_SEK` kan ändras i `.env`; Compose skickar värdena vidare till backend och använder standardpriserna om de saknas. Nycklar och PostNords ursprungsadress behövs i backendmiljön. API-fel och ogiltiga svar ger kontrollerade felmeddelanden.

## Administratörsåtkomst

Det finns inga publika testinloggningsuppgifter dokumenterade i repot. Registrera ett separat testkonto via shoppen. I lokal utveckling kan databasoperatören ge kontot adminroll så här (byt e-postadressen mot kontots registrerade adress):

```powershell
docker compose exec db psql -U shop -d shop -c "UPDATE users SET role = 'admin' WHERE email = 'teacher-test@example.com';"
```

För den deployade shoppen behöver deploymentens databasoperatör göra motsvarande ändring. Kontrollera sedan rollen och verifiera inloggning samt att `/admin/products` går att öppna. Lämna lärarens dedikerade testkonto och lösenord privat i inlämningskommentaren, inte i repot. Dela inte ägarens personliga konto. Hashade lösenord kan inte återskapas till klartext.

## Reflektion

I projektet används flera integrationssätt eftersom tjänsterna gör olika saker. Produktimporten är en filbaserad integration: leverantören lämnar CSV eller XML och backend hämtar filinnehållet. Algolia används med API-anrop för att söka och hålla produktindexet uppdaterat. För betalningen används både en omdirigering och en webhook. Kunden går till Stripes Checkout, medan webhooken talar om för vår server att betalningen faktiskt blev klar. Produktbilder skickas som filuppladdningar från admin till Express, som i sin tur skickar dem till Supabase Storage. PostNord anropas med API för ombud och leveranstid. Valet passar eftersom butiken behöver aktuella tjänstesvar, medan betalningsstatus måste komma tillbaka server-till-server.

React går via Express för att webbläsaren inte ska få leverantörernas hemliga nycklar. Det gör också att servern kan kontrollera information innan den används. Vid checkout utgår priset från PostgreSQL, inte från det belopp webbläsaren skickar. På samma sätt kontrollerar backend att ett valt PostNord-ombud fortfarande finns och att Stripe-webhookens signatur stämmer. React får shopens egna svar och behöver inte känna till varje leverantörs API-format.

Att använda tjänsterna sparar arbete som annars skulle bli stora egna delsystem. För att bygga betalning själv skulle jag behöva hantera kortuppgifter säkert, bankkopplingar och kvitton. En egen sökmotor behöver indexering och felskrivningstolerans. Bildlagring kräver lagring, åtkomst och leverans av bilder. Egen fraktinformation kräver avtal och uppdaterade ombudsdata. Leverantörsimporten slipper att någon manuellt registrerar hela sortimentet. I min kod mappas leverantörens produkter till butikens SKU, namn, pris och lager.

Om leverantörens API inte svarar får importen ett kontrollerat fel; befintliga produkter finns kvar. Om Algolia inte går att nå kan en synkning misslyckas trots att produkten sparats, och administratören får en varning. Sökningen visar fel i butiken i stället för att låtsas att inga produkter finns. Om Stripe inte kan skapa en betalning får kunden inte en fungerande Checkout-session. En väntande order kan då behöva följas upp. Om webhooken inte bekräftar betalningen står ordern kvar som väntande. Om Supabase misslyckas behåller produkten sin tidigare bild. Om PostNord inte svarar kan butiken inte säkert visa ombud eller leveranstid; kunden får ett fel och kan försöka igen.

Tjänsterna innebär beroenden och risker. Algolia, Stripe och lagring kan ändra priser eller villkor, så kostnaden kan växa när användningen ökar. Nycklar måste hållas hemliga och roteras om de läcker. Stripe och fraktflödet hanterar kunduppgifter som namn, adress och e-post; det gör GDPR relevant och innebär att jag behöver veta vilka uppgifter som skickas och hur länge de sparas. Om en leverantör ändrar API eller stänger en funktion kan integrationen sluta fungera tills adaptern uppdateras. Därför har varje integration en egen adapter, validerar svar och har en tidsgräns, men det tar inte bort beroendet av tjänsten.