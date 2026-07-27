# Gestionale Baccanalia

Gestionale responsive per tavoli, comande, cassa, utenti e storico ordini.

## Stack

- Next.js + React + TypeScript
- PostgreSQL Supabase
- Postgres.js con Transaction Pooler
- Password cifrate con bcrypt
- Sessioni JWT in cookie HttpOnly
- Deploy su Vercel

## Pubblicazione

1. Carica tutto il contenuto di questa cartella nel repository GitHub.
2. Su Vercel scegli **Add New → Project** e importa il repository.
3. In **Settings → Environment Variables** configura:

   - `DATABASE_URL`: stringa **Transaction pooler** copiata da Supabase, porta `6543`.
   - `AUTH_SECRET`: stringa casuale lunga almeno 32 caratteri.

4. Esegui il deploy.
5. Apri il sito e premi **Prima configurazione**.
6. Crea il primo account amministratore. L’operazione è consentita soltanto se la tabella `users` è vuota.

## Generare AUTH_SECRET

Esegui localmente:

```bash
openssl rand -base64 48
```

Non pubblicare `.env`, password, `DATABASE_URL` o chiavi Supabase.

## Operazioni già protette

- username univoci senza distinzione tra maiuscole e minuscole;
- password cifrate con bcrypt;
- sessione in cookie HttpOnly;
- controlli server-side dei ruoli;
- blocco atomico del tavolo tramite transazione e `SELECT ... FOR UPDATE`;
- un solo ordine aperto per tavolo;
- chiusura ordine e liberazione tavolo nella stessa transazione;
- cassiere limitato agli ordini della serata attiva;
- admin autorizzato allo storico completo.

## Nota

Prima dell’uso reale inserisci almeno una serata attiva, i tavoli e le voci del menu. L’API principale si trova in `src/app/api/app/route.ts`.
