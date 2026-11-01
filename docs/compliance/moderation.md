# Moderation runbook

How the maintainer moderates the shared library, answers notices, reports offences and executes removal orders. The maintainer is the host of every submitted text and, since every text is approved before publication, its publication director ([loi 82-652 art. 93-2](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000033971722): "Lorsque le service est fourni par une personne physique, le directeur de la publication est cette personne physique"). Every source was read on its official text on 2026-10-31; EU texts in the Official Journal. This is not legal advice. When a step changes, update this runbook, [`/terms`](../../apps/web/src/legal/) and `packages/core/src/moderation.ts` in the same pull request.

## Contact points

One address, `CONTACT_EMAIL` in `packages/core/src/compliance-facts.ts`, published on `/legal` in French and English, serves as:

- the point of contact for authorities ([DSA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065) art. 11), in French, the official language of the Member State of establishment (11(3)), and English;
- the point of contact for users (DSA art. 12), answered by the maintainer, not an automated tool;
- the contact point for removal orders ([Regulation 2021/784](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021R0784) art. 15), mandatory for every host and public, with the languages it accepts.

Mail to that address must reach the maintainer's phone with a notification: a removal order runs from its receipt.

## 1. Before approving a text

The queue in `/admin` (#274) shows each pending text with its estimated level and the six checks of `MODERATION_CHECKS`. « Approuver » stays disabled until all six are ticked. When in doubt, reject: an approved text is published under the maintainer's responsibility (loi 82-652 art. 93-3, the message having been subject to "une fixation préalable à sa communication au public").

| Check | Look for | Ground cited (`LEGAL_GROUNDS`, `TERMS_CLAUSES`) |
|---|---|---|
| Copyright | Song lyrics, book passages, articles, subtitles, translations of someone else's text; a "story" that reads like a known work. The submitter attested the text is theirs or a story generated in the app | CPI art. L122-4 |
| Defamation | An allegation of a precise fact harming the honour of an identifiable person, even under initials; an insult | Loi du 29 juillet 1881, art. 29 and 32 |
| Hate | Provocation to discrimination, hatred or violence against a group, denial of crimes against humanity | Loi du 29 juillet 1881, art. 24, 32 and 33 |
| Other people's personal data | A full name, school, town, address, phone or photo description of a real person, the submitter's own included; teenagers often identify themselves | Code civil art. 9; GDPR art. 6 |
| Serious offences of LCEN art. 6 IV.A | For example apology of or provocation to terrorism (CP 421-2-5), child sexual abuse images (CP 227-23), sale of drugs (CP 222-39), incitement to suicide (CP 223-13), pimping (CP 225-5), sexual harassment (CP 222-33); the full list is in the article | [LCEN art. 6 IV.A](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000801164) (version of 2026-08-26); also report it (section 3) |
| Library rules | Not in Chinese (3.2), a duplicate or spam (3.3), unsuitable for teenagers (3.4) | `/terms` rule 3.2, 3.3 or 3.4 |

A rejection or a removal records a statement of reasons (DSA art. 17(3)): the measure, the facts, own initiative or a notice, the legal ground or the terms clause with an explanation, "no automated means", and the redress. The statement is emailed to the submitter at once (17(1)). Redress offered: a review by email to the contact address, then the courts. The internal complaint-handling system of art. 20 and the rest of arts 20 to 28 do not apply to a micro platform (art. 19(1)); art. 24(3) does: if the Digital Services Coordinator or the Commission asks, send the average monthly active recipients.

## 2. Notices (DSA art. 16)

- « Signaler » on every library text opens `/report` (#276), with no account. A notice holds the reasons, the exact text, the notifier's name and email (optional for child sexual abuse material, art. 16(2)(c)) and the good-faith statement (16(2)(d)). The form reminds that a notice the notifier knows to be false is punished by one year of prison and €15,000 (LCEN art. 6 VII).
- A receipt goes out at once when the notice holds an email (16(4)).
- Decide "in a timely, diligent, non-arbitrary and objective manner" (16(6)). The host keeps its exemption only if, once it knows, it "acts expeditiously to remove or to disable access to the illegal content" (art. 6(1)(b)); no delay is set, so the project's own targets are 24 hours for a notice that names a serious offence and 7 days otherwise.
- Remove the text with the statement of reasons, or keep it. The notifier gets the decision with its redress (16(5)); the submitter gets the statement of reasons, never the notifier's identity.
- In `/admin` › « Signalements », removing a text through a notice decides every open notice on that text: each notifier with an email gets the decision. A decision mail that fails does not undo the removal; `/admin` lists the addresses to write to by hand. `POST /api/notices` takes at most 5 notices per address in 10 minutes.
- Copies already imported on devices stay there, as `/terms` says: the app cannot reach them.

## 3. Reporting offences

| When | Where | Basis |
|---|---|---|
| A text or a notice reveals an offence of LCEN art. 6 IV.A | [PHAROS](https://www.internet-signalement.gouv.fr), the Interior Ministry's portal, "promptement"; then remove the text | LCEN art. 6 IV.A: hosts "informent promptement les autorités compétentes de toutes les activités illicites" |
| Information that makes you suspect an offence threatening someone's life or safety (threats, a suicide plan, abuse of a child) | Police: 17 or 112 when the threat is imminent, otherwise PHAROS, with all the information available | DSA art. 18(1): "promptly inform the law enforcement or judicial authorities" |

Keep the text, the notice and the report reference until the authority answers, even after removal; record them in the register (section 5).

## 4. Orders

**Administrative request, LCEN art. 6-1.** The anti-cybercrime office (OFAC, direction générale de la police nationale, [décret 2015-125](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000030195477) art. 1) may ask the host to remove content of apology of or provocation to terrorism (CP 421-2-5), child sexual abuse images (CP 227-23) or drug offers (CP 222-39). If the content is not removed "dans un délai de vingt-quatre heures", it may order access providers to block the site. Remove it within the 24 hours, so the whole app is never blocked.

**Removal order for terrorist content, Regulation 2021/784** (LCEN art. 6-1-1). Remove the text or disable access to it "as soon as possible and in any event within one hour of receipt of the removal order" (art. 3(3)). Before the first order, the authority gives at least 12 hours' notice of its procedures and deadlines, except in an emergency (3(2)). Then:

1. In `/admin`, remove the text with the ground « Infractions graves (LCEN art. 6, IV, A) ». If `/admin` is down, remove it directly and write the statement of reasons afterwards:

   ```bash
   wrangler d1 execute openlinguo --remote --command "UPDATE submission SET status = 'removed' WHERE id = '<submission id>'"
   ```

   Record that direct write in the access register ([requests runbook](requests.md), section 5).
2. Preserve the text and the related data for six months from the removal (art. 6(2)), longer only at the authority's or a court's request: export the submission and its hosting records to an encrypted file outside the app before the daily jobs could purge them.
3. Reply to the authority with the time of removal.
4. An order from another Member State may be contested by "a reasoned request" to the French authority "within 48 hours" (art. 4(4)), while still removing within the hour (4(2)).

**Judicial orders and requisitions** for the data of `hosting_record`: only a written requisition whose legal basis is checked, as the [requests runbook](requests.md) says (section 4).

## 5. Register

One line per notice decided, report made or order received, kept with the access register of the [requests runbook](requests.md): date and time received, origin (notice id, authority, reference), text concerned, action and time of action, report reference, preservation end date. The notices and statements of reasons themselves are deleted 1 year after the decision ([retention](retention-schedule.md)).
