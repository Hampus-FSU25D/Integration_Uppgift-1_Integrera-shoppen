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

#### Så använde jag AI i Labb 5

Jag tog hjälp av AI för att hitta rätt PostNord-anrop och för att felsöka hur leveranstiden hämtades. Prompterna nedan är återgivna ungefärligt, inte ordagrant.

1. **Hämta ombud.** Jag bad om hjälp att hitta ett anrop som ger flera ombud för ett svenskt postnummer. AI föreslog Service Point API v5. I PostNords guide är skillnaden att `nearest/byaddress` ger flera närliggande ombud, medan `bypostalcode` ger ett standardombud. Därför använder adaptern `nearest/byaddress`. Guidens svarsexempel användes som underlag för mappningen, som kontrollerades med mocktester.

2. **Visa leveranstid.** Jag bad om förslag på hur kassan kunde visa en uppskattad leveranstid. Det första AI-förslaget var Transit Time Calculation. I koden blev det i stället Delivery Options, eftersom PostNords guide visar både hur anropet byggs och var leveransintervallet finns i svaret (`deliveryTime.dayRange.days`). Då kan kassan visa PostNords intervall utan att räkna fram ett eget datum.

3. **Rätta anropet och kontrollera kassan.** När leveransanropet justerades skickade backend en komplett lageradress och mottagarens ort. Anropet ändrades också från en exakt överlämningstid (`handOverTimer`) till `daysUntilOrderIsReady: "0-2"`, som i PostNords exempel. Adaptertestet uppdaterades för att kontrollera den nya requesten. I kassan räknar backend frakten enligt butikens egna prisregler, hämtar ombudslistan på nytt när ordern skapas och skickar totalsumman inklusive frakt till Stripe.

## Administratörsåtkomst

Shoppen har en administratörsdel för produkter och ordrar. Vanliga registreringar får rollen `customer`, medan adminfunktionerna kräver rollen `admin`. Ett separat testkonto finns för rättningen; inloggningsuppgifterna lämnas i inlämningskommentaren.

### Labb 6 – kundinloggning med Google

Google OAuth 2.0 används som en serverbaserad auktoriseringskodsintegration. Start och callback går via Express. Servern skapar och kontrollerar `state`, byter koden mot tokens och verifierar ID-tokenens signatur och identitetsuppgifter. Googles access- och ID-token används bara under callbacken på servern och sparas inte i webbläsaren eller databasen; efter verifieringen slängs de. Webbläsaren får aldrig Googles klienthemlighet eller token. Efter inloggning används shopens egen serversidesession, som lagras i PostgreSQL och har en httpOnly-cookie med sju dagars giltighet. Google-användare identifieras med Googles unika `sub`; första inloggningen skapar ett kundkonto och senare inloggningar återanvänder det. Om e-postadressen redan har ett lösenordskonto länkas Google först efter att kunden loggat in med samma e-postadress och lösenord. Begäran sparas tillfälligt i serversessionen och upphör efter tio minuter. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` och `GOOGLE_REDIRECT_URI` ska anges i `.env` lokalt eller i backendens miljövariabler i drift. Registrera den exakta callback-adressen i Google Cloud: Compose lokalt använder `http://localhost:8080/api/auth/google/callback`, medan separat Vite-utveckling använder `http://localhost:5173/api/auth/google/callback` och `FRONTEND_URL=http://localhost:5173`. För en publik adress ska callbacken använda HTTPS. Labb 6 är implementerad i arbetsgrenen men ännu inte verifierad i den inlämnade driftsmiljön.

### Labb 7 – GitHub-inloggning för administratörer (inloggningsdelen)

GitHub OAuth körs via Express med `state` i shopens session. Backend byter auktoriseringskoden mot en GitHub-token, hämtar profilen med endast `read:user`, validerar profilens ID och användarnamn och slänger tokenen efteråt. Användarnamn jämförs mot den kommaseparerade `ADMIN_GITHUB_LOGINS`; bara godkända administratörer sparas i `github_admins`, där GitHubs stabila numeriska ID är nyckeln. Adminsessionen lagras i samma PostgreSQL-baserade session som övrig inloggning och använder shopens httpOnly-cookie. GitHub-tokenen och klienthemligheten skickas inte till webbläsaren. Ange `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI` och `ADMIN_GITHUB_LOGINS` i `.env` lokalt eller backendens miljövariabler i drift. Compose lokalt använder `http://localhost:8080/api/auth/github/callback`; separat Vite-utveckling använder `http://localhost:5173/api/auth/github/callback`; den publika callbacken är `https://market.hampusandersson.dev/api/auth/github/callback`. Issues-delen är ännu inte implementerad. Inloggningsdelen är implementerad och manuellt verifierad lokalt, men ännu inte verifierad i den inlämnade driftsmiljön.

## Reflektion
Google-inloggningen använder samma typ av server-till-server-flöde fast med en omdirigering mellan webbläsaren, Express och Google. Express behåller klienthemligheten, verifierar svaret från Google och ger kunden en egen shop-session. Det passar eftersom orderhistoriken sedan kan hämtas med kundens session utan att React behöver spara en Google-token. Om e-postadressen redan finns väntar Google-identiteten i serversessionen tills kunden bevisat ägarskap med lösenordet; enbart matchande e-post räcker alltså inte för att koppla konton. Om kunden avbryter eller Google inte kan verifiera svaret skickas kunden tillbaka till inloggningssidan med ett begripligt meddelande. Mina sidor frågar Express efter order där sessionens användar-ID är ägare; utloggade anrop får 401 och ser inte någon kunds order. Inloggning kräver fortsatt tillgänglighet hos Google, men befintliga lösenordsinloggningar fungerar som ett separat alternativ.

Administratörsinloggningen med GitHub använder också en serverbaserad OAuth-omdirigering, men den ska bara ge åtkomst till godkända konton. Express begär `read:user`, jämför GitHub-användarnamnet med `ADMIN_GITHUB_LOGINS` och lagrar den godkända profilen med GitHubs stabila ID. Efter callbacken används shopens egen session i stället för en GitHub-token i webbläsaren. Det gör att admin-API:t kan kontrollera behörigheten på serversidan och att utloggning fungerar genom att förstöra samma session. GitHub måste vara tillgängligt för att starta en ny adminsession; befintliga sessioner och vanliga kundlösenord är separata. För issue-skapandet ska en avgränsad PAT hållas separat från OAuth-inloggningen och bara finnas i backendens miljö.


Jag använder olika integrationssätt eftersom tjänsterna gör olika saker. Produktimporten är filbaserad: backend hämtar leverantörens CSV eller XML. Algolia anropas för sökning och för att hålla produktindexet uppdaterat. Betalningen använder både en omdirigering och en webhook. Kunden går till Stripes Checkout och Stripe meddelar sedan servern när betalningen är klar. Produktbilder laddas upp från admin via Express till Supabase Storage. PostNord anropas för ombud och leveranstid. De här sätten passar funktionerna: butiken hämtar aktuell information från tjänsterna och får betalningsbeskedet direkt till servern. Vid produktimporten läser jag EAN som text och varianter som listor. Jag sparar dem inte i databasen eftersom shoppen inte använder uppgifterna; jag behöll den befintliga produktmodellen i stället för att lägga till fält utan användning.

React går via Express så att leverantörernas hemliga nycklar stannar på servern. Där kan jag också kontrollera information innan den används. Vid checkout hämtas priserna från PostgreSQL i stället för att lita på belopp från webbläsaren. Backend kontrollerar även att det valda PostNord-ombudet finns och att Stripes webhooksignatur stämmer. React får shopens egna svar och behöver inte hantera varje leverantörs API-format.

Tjänsterna sparar arbete som annars skulle kräva egna system. Om jag byggde betalningen själv behövde jag hantera säkra kortbetalningar, bankkopplingar och kvitton. En egen sökmotor skulle behöva indexering och stöd för felskrivningar. Bildlagring kräver lagring, åtkomst och leverans av bilder, och egen fraktinformation skulle kräva avtal och uppdaterade ombudsdata. Importen gör också att sortimentet inte behöver registreras manuellt. I koden mappas leverantörens produkter till butikens SKU, namn, pris och lager.

Om leverantörens API inte svarar får importen ett kontrollerat fel och befintliga produkter finns kvar. Algolia kan misslyckas med en synkning efter att produkten sparats; då får admin en varning. Om själva sökningen misslyckas visas ett fel i shoppen i stället för att inga träffar visas som om sökningen lyckats. Om Stripe inte kan skapa en betalning får kunden ingen fungerande Checkout-session. Om webhooken inte bekräftar betalningen står ordern kvar som väntande. Vid fel i Supabase behåller produkten sin tidigare bild. Om PostNord inte svarar visas ett fel eftersom shoppen då saknar säkra uppgifter om ombud eller leveranstid, och kunden kan försöka igen.

Tjänsterna innebär också risker. Algolia, Stripe och lagring kan ändra priser eller villkor, så kostnaden kan öka när användningen växer. Nycklar måste hållas hemliga och bytas om de läcker. Stripe och fraktflödet hanterar kunduppgifter som namn, adress och e-post. Därför behöver jag veta vilka uppgifter som skickas och hur länge de sparas, enligt GDPR. Om en leverantör ändrar sitt API kan integrationen sluta fungera tills jag uppdaterar adaptern. Varje integration har därför en egen adapter som validerar svar och har en tidsgräns, även om det inte tar bort beroendet av tjänsten.
