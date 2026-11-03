# Requests runbook

How the maintainer answers the requests that reach personal data outside the app: rights requests, parents' requests to delete their child's account, and authorities' requests for the data that décret 2021-1362 keeps. Asked by the [DPIA](dpia.md) (section 2.2, risk R1). Sources read on 2026-11-01:

- GDPR art. 12(3): an answer "within one month of receipt"; two more months only if the person is told within that first month, with the reasons. The CNIL repeats it in [« Exercice des droits : dans quel délai doit-on me répondre »](https://www.cnil.fr/fr/cnil-direct/question/exercice-des-droits-informatique-et-libertes-dans-quel-delai-doit-me-repondre).
- Identity: no ID document by default, only on reasonable doubt (GDPR art. 12(6); CNIL, [« Professionnels : comment répondre à une demande de droit d'accès »](https://www.cnil.fr/fr/repondre-une-demande-de-droit-dacces)).
- [Loi 78-17 art. 45](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000037823135): from 15, a minor consents alone to an online service. Under 15, the holder of parental authority must consent too; OpenLinguo takes no account under 15.
- CNIL [recommendation 1](https://www.cnil.fr/fr/recommandation-1-encadrer-la-capacite-dagir-des-mineurs-en-ligne) (2021-06-01): parents need "une voie de recours pour demander la suppression du compte de leur enfant". It says nothing on how to check the request.
- [LCEN art. 6](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000045292730) V.B: not answering a request of the judicial authority for the data of V.A is punished by one year in prison and a €250,000 fine.

The production database is read with `wrangler d1 execute openlinguo --remote` from `apps/api`.

## 1. Intake

Every request arrives at `openlinguo@gmail.com` (`CONTACT_EMAIL`), and its thread is its record (section 5).

Answer within the month. If more time is needed (complex or many requests), tell the person before the month ends, with the reasons, and answer within the two further months.

## 2. Rights requests

Access, rectification, erasure, restriction, objection, portability (GDPR arts 15 to 21).

1. **Point to the app first**: signing in already proves who the person is. Profile › Compte gives the export (« Mes données », arts 15 and 20, with the synced data decoded on the device), the pseudonym (art. 16), turning sync off, which deletes the synced data, and the deletion (art. 17).
2. **Otherwise, check identity through the account**:
   - If the request comes from the account's own address, answer that address.
   - If not, write to the account's address with a code (`openssl rand -hex 3`), and act only once the code comes back from that address.
   - Ask for an ID document only on reasonable doubt (for example, a request about data that no account address can confirm). Delete it once the request is answered.
3. **What the export does not cover**, from `apps/api`:

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT id FROM user WHERE email = 'person@example.org'"
   ```

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT operation, submission_id, ip_address, protocol, datetime(created_at / 1000, 'unixepoch') AS at FROM hosting_record WHERE user_id = '<id>'"
   ```

   A `submission_id` of `sync:<chunk id>` is a sync upload, and `sync:all` a deletion of the synced data.

   For someone who cannot sign in, their synced data, each `gzip` value then read with `xxd -r -p | gunzip`:

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT id, hex(bytes) AS gzip FROM sync_chunk WHERE user_id = '<id>' ORDER BY id"
   ```

   For a deleted account, the identity kept under décret 2021-1362:

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT email, pseudonyms, datetime(email_until / 1000, 'unixepoch') AS until FROM sealed_identity WHERE email = 'person@example.org'"
   ```

   The hosting records and the sealed identity rest on a legal obligation: they are given on an access request, but not erased or opposed before their end date (GDPR art. 17(3)(b), art. 21 does not apply).
4. **Objection to the security events** (legitimate interest, art. 21), unless a security incident is under way:

   ```bash
   wrangler d1 execute openlinguo --remote --command "DELETE FROM security_event WHERE user_id = '<id>'"
   ```

5. **Erasure for someone who cannot sign in** (lost mailbox): once identity is checked as in step 2, delete in Moderation › Comptes (`/admin/accounts`). Published texts stay without a name, the default of the deletion screen. Synced data goes with the account.
6. Keep the request, the answer and their dates for 5 years as proof ([retention](retention-schedule.md)); nothing else.

## 3. Parents' requests

A parent asks for their child's account to be deleted, giving the account's address. No ID document is asked, and the parent's link to the child is not checked: an account under 15 should not exist, whoever reports it. From 15, the account holder decides alone (art. 45), so they are asked first.

1. The deadline is 14 days after the request.
2. Write to the account's address (template below).
3. Answer the parent without saying whether an account exists (template below).
4. After 14 days:
   - No answer, or the holder confirms being under 15: delete in Moderation › Comptes. Published texts stay without a name.
   - The holder answers that they are 15 or over: keep the account. Close the parent's request with the neutral answer.
   - The holder deletes the account in the app meanwhile: nothing to do.
5. If the parent writes again with facts that put the holder's answer in doubt, decide on those facts, still without asking for an ID document by default.

The risk accepted: someone can have an unused account deleted after 14 days. Only the server account goes, with its synced data: the learning data stays on the device, and published texts stay without a name. An account that synced then keeps its sealed identity, like one that submitted.

### Message to the account (French, then English)

> Objet : Demande de suppression de votre compte OpenLinguo / Request to delete your OpenLinguo account
>
> Une personne qui dit être votre parent nous a demandé de supprimer votre compte OpenLinguo.
>
> Si vous avez moins de 15 ans, votre compte sera supprimé le <date + 14 jours>. Vous pouvez aussi le supprimer vous-même dès maintenant : Profil › Compte › Supprimer mon compte. Vos données d'apprentissage sur votre appareil ne sont pas touchées.
>
> Si vous avez 15 ans ou plus, répondez à ce message avant le <date + 14 jours> : à partir de 15 ans, c'est vous qui décidez, et nous garderons votre compte.
>
> ---
>
> Someone who says they are your parent asked us to delete your OpenLinguo account.
>
> If you are under 15, your account will be deleted on <date + 14 days>. You can also delete it yourself now: Profile › Account › Delete my account. Your learning data on your device is not touched.
>
> If you are 15 or over, answer this message before <date + 14 days>: from 15, you decide, and we will keep your account.

### Answer to the parent (French, then English)

> Nous avons bien reçu votre demande. Si un compte utilise cette adresse, nous avons écrit à son titulaire : le compte sera supprimé le <date + 14 jours>, sauf s'il nous dit avoir 15 ans ou plus, âge à partir duquel la loi le laisse décider seul (loi Informatique et Libertés, art. 45).
>
> ---
>
> We received your request. If an account uses this address, we have written to its holder: the account will be deleted on <date + 14 days>, unless they tell us they are 15 or over, the age from which the law lets them decide alone (French data protection act, art. 45).

## 4. Authorities' requests

For the data of `hosting_record` and `sealed_identity` (LCEN art. 6 V.A, décret 2021-1362), and the account data of a live account.

1. **Only a written requisition** from a judicial authority (a magistrate, or an officer of the judicial police acting on a requisition), or from another authority that cites the law giving it access. Nothing on a phone call or an email without a requisition, however urgent it sounds.
2. **Check it**: the legal basis it cites, that it names the data and the account or the text concerned, and its origin. Call the service back on its official number, never on one given in the message.
3. **Export only what is asked**, for the period asked, with the queries of section 2 filtered on the account or the text and the dates. Synced data is given only if the requisition names it. Save the output to an encrypted file and send it by the channel the authority gives. Delete the local copy once it is received.
4. Keep the requisition and the answer in the mailbox. If either went through another channel, mail yourself a note: date, authority, reference of the requisition, legal basis, data given, date sent.
5. Removal orders (24 hours, 1 hour for terrorist content) follow the [moderation runbook](moderation.md), section 4.

## 5. Proof

No separate register: what proves a request was handled is already kept.

| What | Where | Kept |
|---|---|---|
| A request, its answer, their dates, and the data given | Its thread in the mailbox | 5 years for a rights request ([retention](retention-schedule.md)) |
| A requisition and its answer | The mailbox (section 4) | As for a rights request |
| An account deleted from Moderation › Comptes | `security_event`, written by the app | 6 months |

A direct read that answers no request leaves no record here, but it appears in the Cloudflare audit log, without the SQL ([breach procedure](breach-procedure.md), Evidence).
