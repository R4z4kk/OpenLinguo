# Requests runbook

How the maintainer answers the requests that reach personal data outside the app: rights requests, parents' requests to delete their child's account, and authorities' requests for the data that décret 2021-1362 keeps. Asked by the [DPIA](dpia.md) (section 2.2, risk R1). Sources read on 2026-11-01:

- GDPR art. 12(3): an answer "within one month of receipt"; two more months only if the person is told within that first month, with the reasons. The CNIL repeats it in [« Exercice des droits : dans quel délai doit-on me répondre »](https://www.cnil.fr/fr/cnil-direct/question/exercice-des-droits-informatique-et-libertes-dans-quel-delai-doit-me-repondre).
- Identity: no ID document by default, only on reasonable doubt (GDPR art. 12(6); CNIL, [« Professionnels : comment répondre à une demande de droit d'accès »](https://www.cnil.fr/fr/repondre-une-demande-de-droit-dacces)).
- [Loi 78-17 art. 45](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000037823135): from 15, a minor consents alone to an online service. Under 15, the holder of parental authority must consent too; OpenLinguo takes no account under 15.
- CNIL [recommendation 1](https://www.cnil.fr/fr/recommandation-1-encadrer-la-capacite-dagir-des-mineurs-en-ligne) (2021-06-01): parents need "une voie de recours pour demander la suppression du compte de leur enfant". It says nothing on how to check the request.
- [LCEN art. 6](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000045292730) V.B: not answering a request of the judicial authority for the data of V.A is punished by one year in prison and a €250,000 fine.

The production database is read with `wrangler d1 execute openlinguo --remote` from `apps/api`. Every such read or write goes in the access register (section 5).

## 1. Intake

Every request arrives at `openlinguo@gmail.com` (`CONTACT_EMAIL`). On the day it arrives:

1. Add a line to the access register: date received, kind of request, requester, deadline (one month later).
2. Answer within the month. If more time is needed (complex or many requests), tell the person before the month ends, with the reasons, and answer within the two further months.

## 2. Rights requests

Access, rectification, erasure, restriction, objection, portability (GDPR arts 15 to 21).

1. **Point to the app first**: signing in already proves who the person is. Profile › Compte gives the export (« Mes données », arts 15 and 20), the pseudonym (art. 16) and the deletion (art. 17).
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

   For a deleted account, the identity kept under décret 2021-1362:

   ```bash
   wrangler d1 execute openlinguo --remote --json --command "SELECT email, pseudonyms, datetime(email_until / 1000, 'unixepoch') AS until FROM sealed_identity WHERE email = 'person@example.org'"
   ```

   The hosting records and the sealed identity rest on a legal obligation: they are given on an access request, but not erased or opposed before their end date (GDPR art. 17(3)(b), art. 21 does not apply).
4. **Objection to the security events** (legitimate interest, art. 21), unless a security incident is under way:

   ```bash
   wrangler d1 execute openlinguo --remote --command "DELETE FROM security_event WHERE user_id = '<id>'"
   ```

5. **Erasure for someone who cannot sign in** (lost mailbox): once identity is checked as in step 2, delete in Moderation › Comptes (`/admin/accounts`). Published texts stay without a name, the default of the deletion screen.
6. Keep the request, the answer and their dates for 5 years as proof ([retention](retention-schedule.md)); nothing else.

## 3. Parents' requests

A parent asks for their child's account to be deleted, giving the account's address. No ID document is asked, and the parent's link to the child is not checked: an account under 15 should not exist, whoever reports it. From 15, the account holder decides alone (art. 45), so they are asked first.

1. Register line; the deadline is 14 days later.
2. Write to the account's address (template below).
3. Answer the parent without saying whether an account exists (template below).
4. After 14 days:
   - No answer, or the holder confirms being under 15: delete in Moderation › Comptes. Published texts stay without a name.
   - The holder answers that they are 15 or over: keep the account. Close the parent's request with the neutral answer.
   - The holder deletes the account in the app meanwhile: nothing to do.
5. If the parent writes again with facts that put the holder's answer in doubt, decide on those facts, still without asking for an ID document by default.

The risk accepted: someone can have an unused account deleted after 14 days. Only the server account goes: the learning data stays on the device, and published texts stay without a name.

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
3. **Export only what is asked**, for the period asked, with the queries of section 2 filtered on the account or the text and the dates. Save the output to an encrypted file and send it by the channel the authority gives. Delete the local copy once it is received.
4. Record it in the access register: date, authority, reference of the requisition, legal basis, data given, date sent.
5. Removal orders (24 hours, 1 hour for terrorist content) follow the [moderation runbook](moderation.md), section 4.

## 5. Access register

Kept outside this repository, in the maintainer's private notes, because it names real people. One line per:

- request received (section 1);
- export from `hosting_record` or `sealed_identity`;
- direct read or write of the production database: D1 console, `wrangler d1 execute --remote`, for an incident, a rights request, a requisition or a removal order ([moderation runbook](moderation.md));
- account deleted from Moderation › Comptes.

Columns: date, reason, requester, reference, data given or query run, outcome. Lines about a rights request are kept 5 years as proof, like the request itself; the moderation register of the [moderation runbook](moderation.md) (section 5) is kept in the same place.
