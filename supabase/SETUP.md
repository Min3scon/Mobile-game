# Connect Neon Swarm to Supabase

This turns on accounts, cloud saves, leaderboards, the weekly raid, duels and live co-op.
It takes about 10 minutes and the free plan is enough. You can do it on a computer or a phone.

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) and sign up. Signing in with GitHub is quickest.
2. Click **New project**. Give it any name (for example `neon-swarm`), make up a database password and save it somewhere, then pick the region closest to you.
3. Wait a minute or two while the project starts.

## 2. Create the database

1. In the left sidebar, open **SQL Editor**, then click **New query**.
2. Open [`supabase/schema.sql`](schema.sql) from this repo, copy **all** of it, and paste it into the editor.
3. Click **Run**. You should see "Success. No rows returned".

You can run the file again after future game updates; it only creates or replaces things.

## 3. Set up logins

1. Open **Authentication** > **Sign In / Providers** (on some dashboards it's **Providers**), then **Email**.
2. Keep **Email** turned on.
3. Turn **Confirm email** off, then save. Supabase's built-in email sender only sends a few emails per hour. With confirmation off, players can sign up instantly. You can turn it back on later if you set up your own email sender under **Authentication** > **Emails** > **SMTP settings**.
4. Open **Authentication** > **URL Configuration**.
   - Set **Site URL** to `https://min3scon.github.io/Mobile-game/`
   - Under **Redirect URLs**, add `https://min3scon.github.io/Mobile-game/**`

   Password-reset emails use these to send players back to the game.

## 4. Copy your keys into the game

1. Open **Project Settings** (the gear at the bottom of the sidebar). On newer dashboards the keys are under **API Keys**, on older ones under **Data API** or **API**.
2. Copy the **Project URL**. It looks like `https://abcdefghijkl.supabase.co`.
3. Copy the **anon** key, which some dashboards call the **publishable** key. It's a long string that starts with `eyJ` or `sb_publishable_`.
   - Do **not** use the `service_role` or **secret** key. That key bypasses every rule and must never be put in a website.
4. On GitHub, open `config.js` in the repo, click the pencil icon to edit it, and paste both values:

   ```js
   window.NS_CONFIG = { supabaseUrl: 'https://abcdefghijkl.supabase.co', supabaseKey: 'eyJ...your anon key...' };
   ```

5. Commit the change to `main`. GitHub Pages rebuilds the site in a minute or two.

It's fine for the anon key to be public. The database rules in `schema.sql` decide what anyone can do with it. If you'd rather not edit the file yourself, send the two values to whoever maintains the game.

## 5. Check it works

Open the game and go to **Online**. You should see **Log in or sign up** instead of "not connected yet". Make an account, play a run, then check **Online** > **Leaderboard**.

## How player data is protected

- **Cloud saves are encrypted.** Each save is encrypted with AES-256 using a key that belongs to that player only.
- **Keys are kept apart.** Keys live in a separate `private` part of the database that the website and players can never read. Only the save and load functions use them.
- **Deleting an account destroys the key first.** Then the profile, scores, duels and login are removed. Any leftover copy of the save can't be decrypted.
  - Supabase's own daily backups (paid plans only) can keep deleted rows for up to 7 days, and then they expire.
  - Usernames are shown on the leaderboard, so they're stored as plain text. They're deleted along with the account.
- **Scores, raid damage and duels are checked by the server.**
  - Every run gets a ticket when it starts.
  - Results can't be submitted faster than the run could have been played.
  - Totals are checked against the run time.
  - The daily run is limited to once per day per account.

## Anti-cheat

- **Checkpoints.** Every 30 seconds of play, the game reports its progress (time, kills, level). The server checks each report:
  - It must move forward.
  - It must keep pace with real time, so sped-up games are rejected.
  - It must stay under hard caps worked out from the game's own spawn rates.
- **Final score checks.**
  - The final score must match the checkpoints.
  - Runs with too few checkpoints are rejected.
  - Scores that are possible but unusual (missing checkpoints, very high kill counts, a game clock faster than real time) are saved but hidden. They wait in the admin review queue.
- **In-game guard.** The game also checks itself for edited values, sped-up clocks and open developer tools. When it catches something, the run isn't posted and the server records a tamper report for admins.
- **Daily rewards follow the server's clock.** Changing the phone's date doesn't unlock tomorrow's rewards.

## Admin and bans

The account named exactly **Minescon** is the admin. The admin gets an **Admin** button under **Online**, where they can:

- search players and see their scores, tamper reports and ban history;
- ban for 1 hour, 1 day, 3 days, 1 week, 30 days or permanently, or for any number of minutes, hours, days or weeks, with a reason the player sees;
- lift a ban, from the player's page or from the **Banned** tab, which lists everyone banned right now with an **Unban** button on each;
- approve or remove flagged scores;
- delete all of a player's scores.

Banned players can still play offline. They can't post scores, hit the raid, duel or change their name, and they don't appear on the leaderboard.

Admin rights are granted when `schema.sql` runs. If the Minescon account didn't exist yet at that point, sign up as Minescon, then run this in the SQL Editor:

```sql
select private.grant_admin('Minescon');
```

To add another admin, use the same line with their exact name.

To unban someone straight from the SQL Editor:

```sql
update public.bans set lifted_at = now()
where lifted_at is null and user_id = (select id from public.profiles where username = 'TheirName');
```

## Updating the database

When the game gets a database update, open **SQL Editor** > **New query**, paste the whole new `supabase/schema.sql`, and click **Run**. It's safe to run again: nothing is lost.

## Updates reach players automatically

Every published version has its own build number. The game checks for a new one when it opens, when you come back to it, and every 2 minutes. If there's a newer version, the menus reload into it straight away. During a run, it waits until the run ends.

## Free plan limits

The free plan covers a group of friends easily. Live co-op sends many small messages: a 4-player, 8-minute run uses roughly 25,000 of the 2 million Realtime messages a month. You can see usage under **Project Settings** > **Usage**.

Free projects are paused after a week with no activity. If that happens, open the Supabase dashboard and click **Restore**.
