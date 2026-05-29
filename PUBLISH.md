# Publishing And Syncing

This site can run in two modes:

- Browser-only mode: no setup, but scores stay in one browser.
- Cloud-sync mode: scores live in Supabase, so your phone, laptop, and viewers see the same rounds.

## Setup

1. Create a Supabase project.
2. Open the Supabase SQL editor and run `supabase-schema.sql`.
3. Copy your Supabase project URL and anon key.
4. Edit `config.js` and fill in `supabaseUrl` and `supabaseAnonKey`.
5. Publish this folder with any static website host.

The normal URL lets someone add, edit, and delete rounds. Add `?view=1` to the URL to show a viewer-style page with the entry form and action buttons hidden.

## Security Note

This is a shared-journal setup. The Supabase anon key is meant to be public, but the database policies in `supabase-schema.sql` allow anyone with the live site URL to write data. The `?view=1` page hides controls in the interface; it is not a security lock.

For owner-only editing and public read-only viewing, the next step is adding login.

## Verify

1. Open the live site on your computer.
2. Add a test round.
3. Open the same live site on your phone.
4. Confirm the test round appears there.
5. Add another round from the phone.
6. Refresh the computer page and confirm the average score and trend chart update.
