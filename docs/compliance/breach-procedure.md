# Personal data breach procedure

Applies to any breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data held by the server (accounts, submissions, synced data, leagues, logs, backups). Asked by the [DPIA](dpia.md) (risks R1 and R2). Sources read on 2026-11-02:

- GDPR [arts 33 and 34](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4) and art. 12(1) (clear and plain language, "in particular for any information addressed specifically to a child").
- CNIL, [« Les violations de données personnelles »](https://www.cnil.fr/fr/les-violations-de-donnees-personnelles) and its [notification service](https://www.cnil.fr/fr/services-en-ligne/notifier-une-violation-de-donnees-personnelles).
- EDPB [Guidelines 9/2022](https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-92022-personal-data-breach-notification-under_en), version 2.0: a controller is aware with "a reasonable degree of certainty" (para 31), in principle "once the processor has informed it" (para 44); notices go in dedicated messages, not with other information (para 89).

Commands run from `apps/api`; `wrangler` stands for `pnpm exec wrangler`. Every read or write of the production database goes in the access register of the [requests runbook](requests.md) (section 5).

## Steps

The 72 hours run from step 1: note the time you became aware.

1. **Preserve.** Containing destroys evidence (`DELETE FROM session` removes IP addresses and browsers), so this comes first, in minutes.
   - Note the current bookmark: `wrangler d1 time-travel info openlinguo`. It is the point to restore to, for 7 days.
   - If an attack is under way, take the API offline first (below): it touches no data.
   - Export the database: `wrangler d1 export openlinguo --remote --output=incident.sql`. An export blocks other requests while it runs. Keep the file encrypted, outside the repository, and delete it when the case closes ([retention](retention-schedule.md)). The daily jobs keep purging, which makes this copy the only one of what reaches its end date meanwhile.
2. **Contain.** Revoke what is exposed (below) and block the path used. Local-first means learners keep working offline.
3. **Assess.** What data, how many people, what likely consequences, is there a risk to their rights and freedoms? Is the risk high? Read the evidence (below).
   - The people are teenagers: treat an email linked to a pseudonym, a sealed identity or IP addresses read by someone else as high risk (DPIA, R1).
   - If a Cloudflare account or token was taken, assume every table was read unless the evidence rules it out.
4. **Record.** Add a line to the register (below), notified or not (art. 33(5)).
5. **Notify the CNIL within 72 hours** of becoming aware, unless the breach is unlikely to result in a risk (art. 33(1)): [notifications.cnil.fr](https://notifications.cnil.fr/notifications/). If facts are incomplete, send an initial notification and complete it later, explaining any delay. The notification describes (art. 33(3)):
   - the nature of the breach, categories and approximate number of people and records concerned;
   - the contact point for more information;
   - the likely consequences;
   - the measures taken or proposed, including mitigation.
6. **Inform the people affected without undue delay if the risk is high** (art. 34(1)), with the notice below. When unsure, notify the CNIL, which can indicate whether people must be informed.
7. **Restore** if data was destroyed or altered: `wrangler d1 time-travel restore openlinguo --bookmark=<bookmark>`. It loses what was written after the bookmark. The next daily job applies recent erasures again (#277).
8. **Review.** Root cause, fix, and update the [data map](data-map.md), [records](records-of-processing.md) or security measures as needed.

## Take the API offline

Deploy the built PWA without its Functions: Wrangler looks for `functions/` in the current directory, and `apps/api` has none.

```bash
pnpm --dir ../.. build
```

```bash
wrangler pages deploy ../web/dist --project-name openlinguo --branch=main
```

Nothing then reaches the database through the API: a `POST` answers 405, a `GET` under `/api/` answers the PWA's HTML with a 200. So `/api/health` looks fine during this time, and an alert on its status stays silent. The cron Worker keeps running; remove its cron trigger in the dashboard if its code is in doubt.

To come back, after the fix: `gh workflow run deploy --ref main`, then approve the run.

## Revoke

A changed Pages secret only applies to the next deployment, so renew the deploy token first, then finish with one run of `deploy`.

| What | How | Effect |
|---|---|---|
| Deploy token | Delete it in the Cloudflare dashboard (API Tokens), create one with the same scopes, then `gh secret set CLOUDFLARE_API_TOKEN --env production` | Deploys wait for the new one |
| Cloudflare or GitHub account | Change the password, sign out other sessions, replace the second factor, check tokens and members (#291) | |
| Every session | `wrangler d1 execute openlinguo --remote --command "DELETE FROM session"`, after the export | Immediate: no cookie cache is turned on. Everyone signs in again |
| Sign-in codes in progress | `wrangler d1 execute openlinguo --remote --command "DELETE FROM verification"` | Codes already sent stop working |
| `LETTERMINT_API_TOKEN` | New project token in Lettermint, old one deleted; `wrangler pages secret put LETTERMINT_API_TOKEN --project-name openlinguo` and `wrangler secret put LETTERMINT_API_TOKEN` | It can only send, but a stolen one can send to anyone from our domain |
| `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET` | New secret in each console; `wrangler pages secret put <NAME> --project-name openlinguo` | The database holds no provider token to revoke |
| `BETTER_AUTH_SECRET`, only if it leaked | `openssl rand -base64 32`; `wrangler pages secret put BETTER_AUTH_SECRET --project-name openlinguo`; then `wrangler d1 execute openlinguo --remote --command "UPDATE user SET two_factor_enabled = 0"` and the same with `DELETE FROM two_factor` | It encrypts the TOTP secrets: the admin sets up the authenticator again. The daily code counts start over |

## Evidence

| Evidence | Holds | Kept | Read with |
|---|---|---|---|
| `security_event` | Sign-ins, failures, codes sent, second factors, admin actions, with IP address and browser | 6 months | `wrangler d1 execute openlinguo --remote --json --command "SELECT type, method, user_id, ip_address, user_agent, reason, target, datetime(created_at / 1000, 'unixepoch') AS at FROM security_event WHERE created_at >= unixepoch('2026-11-01') * 1000 ORDER BY created_at"` |
| `hosting_record` | Each creation, edit or deletion of a text, with IP address | 1 year | `wrangler d1 execute openlinguo --remote --json --command "SELECT operation, user_id, submission_id, ip_address, datetime(created_at / 1000, 'unixepoch') AS at FROM hosting_record WHERE created_at >= unixepoch('2026-11-01') * 1000 ORDER BY created_at"` |
| `session` | Live sessions, with IP address and browser | Until expiry | In the export of step 1 |
| `job_run` | Each daily job's outcome: a purge that failed or stopped | Not purged | `wrangler d1 execute openlinguo --remote --json --command "SELECT job, status, datetime(started_at / 1000, 'unixepoch') AS at FROM job_run ORDER BY started_at DESC LIMIT 50"` |
| Access register | Direct reads and writes of the database that have a reason. A read missing from it is a lead | 5 years for rights requests | The maintainer's private notes |
| Cloudflare audit log | Account actions, and API calls with the token's name | [18 months](https://developers.cloudflare.com/fundamentals/account/account-security/audit-logs/); the dashboard shows 90 days and hides `view` actions, the API has the rest | Audit Logs page, or the API. Its page does not list D1, so whether a D1 console read appears is for the exercise to establish |
| GitHub security log, `deploy` runs | Sign-ins, tokens, secrets; who approved what | [90 days](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/reviewing-your-security-log) for the log | Settings › Archives › Security log; `gh run list --workflow deploy` |
| Lettermint | Messages sent: addresses, content, events | 28 days; delivery events and totals 90 days at most ([DPA](https://lettermint.co/dpa) §3.1) | Lettermint dashboard |

## When a processor has the breach

The 72 hours start when the processor's notice arrives (EDPB, para 44), so its contact mailbox must be one read every day.

| Processor | Notice | Goes to |
|---|---|---|
| Cloudflare | "without undue delay", with all reasonable information it holds ([DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) version 6.4, §3.1(e)). No public announcement of it without our written consent (§3.1(f)) | The DPA names no channel: the account's address |
| Lettermint | Within 24 hours: nature, consequences, measures, contact, possibly in phases ([DPA](https://lettermint.co/dpa) version of 2026-10-09, §10.1 to 10.3). It tells neither the CNIL nor the people for us (§10.5) | The designated contact, otherwise the account owner (§10.6) |

Then steps 3 to 8 apply as for any breach. Revoke the keys that provider holds.

## Notice to the people affected

The content of art. 34(2), in words a 15-year-old can read (art. 12(1)). Send it alone, with nothing else in the message. Say what is known, and what is not yet known. No link: a real notice must not look like phishing. Keep only what is true for this breach, in the brackets and around them.

### Message (French, then English)

> Objet : Incident de sécurité : vos données OpenLinguo sont concernées / Security incident: your OpenLinguo data is affected
>
> Le <date>, une personne qui n'en avait pas le droit a pu <voir / modifier / supprimer> des données d'OpenLinguo, dont les vôtres. Voici ce que nous savons et ce que vous pouvez faire.
>
> Ce qui s'est passé : <une ou deux phrases, sans jargon>.
>
> Vos données concernées : <votre adresse e-mail, votre pseudonyme, l'adresse IP de vos connexions, les textes que vous avez envoyés>. OpenLinguo n'a pas de mot de passe : aucun n'a pu être volé. Ce que vous apprenez reste sur votre appareil et n'est pas touché.
>
> Ce qui peut arriver : <quelqu'un peut faire le lien entre votre e-mail et votre pseudonyme ; vous pouvez recevoir des messages qui se font passer pour OpenLinguo>.
>
> Ce que nous avons fait : <coupé l'accès, déconnecté tous les comptes, changé les clés>. Nous avons prévenu la CNIL, l'autorité française de protection des données.
>
> Ce que vous pouvez faire :
>
> - Méfiez-vous des messages qui parlent d'OpenLinguo, même s'ils citent votre pseudonyme. Nous ne vous demanderons jamais d'argent, de papiers ni de code.
> - Ne donnez à personne un code de connexion, même si vous en recevez un sans l'avoir demandé.
> - Si un message vous inquiète ou si quelqu'un vous contacte à cause de ça, parlez-en à un adulte de confiance et écrivez-nous.
>
> Une question : openlinguo@gmail.com. Vous pouvez aussi vous plaindre à la CNIL.
>
> ---
>
> On <date>, someone who had no right to do so was able to <see / change / delete> OpenLinguo data, including yours. Here is what we know and what you can do.
>
> What happened: <one or two sentences, no jargon>.
>
> Your data involved: <your email address, your pseudonym, the IP address of your sign-ins, the texts you sent>. OpenLinguo has no passwords: none could be stolen. What you learn stays on your device and is not affected.
>
> What could happen: <someone could link your email to your pseudonym; you could get messages pretending to be OpenLinguo>.
>
> What we did: <cut the access, signed every account out, changed the keys>. We told the CNIL, the French data protection authority.
>
> What you can do:
>
> - Be careful with messages about OpenLinguo, even if they mention your pseudonym. We will never ask you for money, ID documents or a code.
> - Never give anyone a sign-in code, even one you receive without asking for it.
> - If a message worries you, or someone contacts you because of this, talk to an adult you trust and write to us.
>
> A question: openlinguo@gmail.com. You can also complain to the CNIL.

### Sending it

One mail per person, so no one sees another address, through Lettermint with tracking off. The free plan sends [300 mails a month](https://lettermint.co/pricing), sign-in codes included.

1. List the addresses, keeping only the tables the breach reached. The second table holds deleted accounts, the third people who sent a notice:

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT email FROM user WHERE id <> 'deleted-account' UNION SELECT email FROM sealed_identity UNION SELECT email FROM notice WHERE email IS NOT NULL" > addresses.json
   ```

2. Save the message as `notice.txt` and this script as `send-notice.mts`, both next to `addresses.json`, outside the repository:

   ```ts
   import { readFileSync } from "node:fs";

   const [addressesFile, noticeFile, subject] = process.argv.slice(2);
   const token = process.env["LETTERMINT_API_TOKEN"];
   const from = process.env["MAIL_FROM"];
   if (!addressesFile || !noticeFile || !subject || !token || !from) {
     throw new Error("Needs LETTERMINT_API_TOKEN, MAIL_FROM, an addresses file, a notice file, a subject");
   }
   const [{ results }] = JSON.parse(readFileSync(addressesFile, "utf8")) as [
     { results: { email: string }[] },
   ];
   const text = readFileSync(noticeFile, "utf8");
   const failed: string[] = [];
   for (const { email } of results) {
     try {
       const response = await fetch("https://api.lettermint.co/v1/send", {
         method: "POST",
         headers: { "Content-Type": "application/json", "x-lettermint-token": token },
         body: JSON.stringify({
           from: `OpenLinguo <${from}>`,
           to: [email],
           subject,
           text,
           settings: { track_opens: false, track_clicks: false },
         }),
         signal: AbortSignal.timeout(5000),
       });
       if (response.status !== 202) failed.push(`${email}: ${String(response.status)}`);
     } catch (error) {
       failed.push(`${email}: ${String(error)}`);
     }
   }
   console.log(`${String(results.length - failed.length)} of ${String(results.length)} accepted`);
   if (failed.length > 0) {
     console.error(failed.join("\n"));
     process.exitCode = 1;
   }
   ```

3. Send it with `MAIL_FROM` and the current token in the environment, the token out of the shell history (`read -rs LETTERMINT_API_TOKEN`, then `export` it):

   ```bash
   node send-notice.mts addresses.json notice.txt "Incident de sécurité : vos données OpenLinguo sont concernées / Security incident: your OpenLinguo data is affected"
   ```

   Whoever it lists as failed is sent the message again, or written to by hand. Delete the three files when the case closes.

**If email cannot do it** (Lettermint itself is touched, more people than the plan allows, addresses lost): a public communication instead (art. 34(3)(c)), the same message without what would help an attacker, in a pinned issue on the repository and at the top of its README. The CNIL notification says so.

## Register

Kept outside this repository, with the access register in the maintainer's private notes: a breach not yet fixed has no place in a public file, and the CNIL can ask to see the register. No names in it. It has no legal end date (EDPB, para 124), and without personal data it is simply kept.

Columns: date found, date aware, nature, people and records concerned, likely consequences, measures taken, why the CNIL or the people were not told if so, CNIL notified (date, reference), people informed (date).

## Exercise

At least once before sign-ups open (`SIGNUPS_OPEN`), then after any large change to the hosting or the processors. Before opening, only the admin has an account, so these commands touch nothing else. Note the time of each step, and add a line to the register: "exercise", the date, the times, the gaps. Fix the gaps in this file.

Scenario: on a Friday evening, Lettermint writes that the sending token was used from an unknown address, and the Cloudflare audit log shows a sign-in you do not recognise.

1. Find the Lettermint and Cloudflare contact addresses: is each one read every day?
2. Preserve: bookmark and export. Does the file open? Encrypt it.
3. Take the API offline, check `/api/health` and the app, come back with `deploy`.
4. Revoke: every session, and the Lettermint token in both places.
5. Run a query in the D1 console, then look for it in the audit log, `view` actions included. Whichever way it goes, write the answer in the Evidence table.
6. Assess, on the scenario: CNIL or not, people or not, and fill in the CNIL form without sending it.
7. Send the notice to your own address only.
8. Delete the files of the exercise.
