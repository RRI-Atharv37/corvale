**Effective date:** [[EFFECTIVE_DATE]] · **Version:** 2026-08-28

## Agreeing to these terms

These terms are an agreement between you and [[OPERATOR_LEGAL_NAME]], [[OPERATOR_TYPE]], covering
your use of **the hosted Corvale service** at [[PRODUCT_DOMAIN]]. By creating an account you
accept them.

They do **not** cover self-hosted installations. The Corvale software is licensed separately
under the GNU AGPL v3.0 — see [Open-source software](#open-source-software) below.

## Who can use Corvale

**You must be 18 or older.** We require you to attest to this when you sign up. If you are not 18,
you may not create an account. See the age section of the [Privacy Policy](./privacy.md) for why.

One account is for one person. Do not share your login.

**Where we offer the service.** Corvale is operated from India, and your data is stored there
wherever you are. You may use it from anywhere, with one exception: **we do not offer the service
in the European Economic Area or the UK.** If you are in one of those, please do not create an
account — we have not appointed a data protection representative there, and the
[Privacy Policy](./privacy.md) explains why.

This eligibility rule is a condition of using **the hosted service**. It does not restrict who may
obtain, study, modify or run the AGPL-licensed software — see
[Open-source software](#open-source-software).

## Your account

You are responsible for taking reasonable steps to protect your account credentials, and you
should notify us promptly if you suspect unauthorised access to your account. You can sign out of
every session at once from Settings.

## Corvale is not financial advice

**This is the most important section on this page.**

Corvale is a record-keeping and calculation tool. It is **not** financial, investment, tax, or
legal advice, and using it does not create an advisory or fiduciary relationship between you and
us. We are not financial advisers, planners, brokers, or accountants.

Several features produce numbers that can look like recommendations. They are not:

- **Debt payoff schedules.** Snowball and avalanche plans are illustrative calculations. They
  assume fixed balances, interest rates and payments, and ignore fees and promotional rates.
- **Cash-flow forecasts.** Projected balances are estimates built from your recurring bills,
  scheduled contributions and recent average spending. Real transactions will move them.
- **Savings goal projections.** Completion dates assume your recent contribution rate continues
  unchanged.
- **Report averages and savings rates.** These describe the date range you selected. They are not
  predictions.
- **Detected subscriptions.** This list is inferred from patterns and can miss irregular charges
  or flag a one-off repeat.
- **Budget figures.** These describe what you have recorded, not what you should spend.

Consider speaking to a qualified professional before making a financial decision. Decisions you
make remain yours. The [financial disclaimer](./financial-disclaimer.md) sets this out in full.

## Corvale never moves money

Corvale does not hold, transfer, transmit, invest, or take custody of funds. It is not a bank, a
payment service, a broker, or a money transmitter. It has no connection to your bank.

Two features are easy to misread, so to be explicit:

- **The saver** only lowers the spendable balance Corvale displays. It is an earmark. No money
  moves and no transaction is created.
- **A rollover** — the feature the app calls **Pushover** — snapshots your saver balance into
  history and resets the saver to zero. Again, no money moves.

Your bank account is never touched by anything you do in Corvale.

## Your data is yours, and you enter it

Everything Corvale shows you is built from what you record. If what you enter is incomplete or
wrong, what Corvale shows will be too.

Imported bank files are parsed on a best-effort basis and may be misread. We give no guarantee
that imported data is complete or correct, and you remain responsible for reviewing it before
relying on it. Always check imported data against your own statements. Reconciliation exists for
exactly this reason.

### Your content

**"Your Content"** means the data and files you put into Corvale: transactions, accounts, budgets,
goals, categories, tags, rules, templates, saved reports, receipts, workspace content, and
anything else you enter or upload.

You keep all rights to Your Content. You grant us only the limited, non-exclusive permission
needed to store it, process it, back it up, and show it back to you and to anyone you have
deliberately shared a workspace with — nothing more. That permission ends when you delete the
content or your account, except for backup copies still inside their retention window. We do not
use Your Content for any other purpose, we do not sell it, and we do not use it to train machine
learning models.

### Our content

Everything that is not Your Content stays ours. [[OPERATOR_LEGAL_NAME]] and its licensors retain
all rights in the Corvale software, the hosted service, its interface and design, the Corvale name
and logo and other branding, the documentation, and the underlying methods and calculations.

Nothing in these terms transfers any of that to you. "Your data is yours" means exactly that —
your data — and not the product it is stored in.

The **software** is separately licensed to everyone under the AGPL v3.0, which grants rights in
the code. It does not grant rights in the Corvale name, logo, or other trademarks — see
[Open-source software](#open-source-software).

## Acceptable use

Do not:

- Use Corvale for anything unlawful
- Try to access another user's data
- Probe, scan, or attack the service, or work around rate limits
- Place a load on the service that degrades it for other users, whether through automated clients,
  bulk or repeated automated collection of data, or otherwise
- Resell or sublicense access to the hosted service

**What this is not meant to prohibit.** These rules are aimed at abuse, not at legitimate use.
Nothing above is intended to prevent you from:

- Using assistive technology, screen readers, or other accessibility tools
- Using the documented API for your own account, at a reasonable rate
- Automating exports or backups of your own data
- Writing your own scripts or integrations against your own account
- Conducting good-faith security research within the published security policy

If you are unsure whether something you want to build crosses the line, ask us first.

Fair use applies. Receipt uploads are capped per account and write operations are rate limited, so
one account cannot crowd out everyone else. If you hit a limit doing something legitimate, tell us
rather than working around it.

We may suspend an account that breaks these rules.

Security researchers are welcome. Report privately through the **Security** tab on the GitHub
repository rather than a public issue. The security policy published there sets out scope, the
roughly 90-day disclosure window, and a safe-harbour commitment for good-faith research.

## Workspaces and shared data

Corvale lets you share a workspace with other people as owner, editor, or viewer.

- Anyone with access to a workspace can see the records inside it.
- You can only invite someone who already has a Corvale account. Sending an invite therefore tells
  you whether an email address is registered here — invite only people who are expecting it.
- If you invite someone, you are responsible for having a proper reason to share whatever
  personal or financial information you put in that workspace.
- A workspace owner controls membership and roles.
- **If you leave a workspace, or an owner removes you from it,** the records you added stay in
  that workspace and remain visible to its members. You lose access to them.
- **If you delete your account,** everything you kept privately is erased. Records you added to a
  workspace that still has other members are **kept, with the link to you removed** — the shared
  ledger stays intact and its balances stay correct, but those records are no longer connected to
  your account or attributed to you. If no other member is left in a workspace, its records are
  erased along with everything else. Receipts you uploaded are always deleted, wherever they were
  attached.
- Records created by other members are not touched when a workspace carries on. The one exception
  is a workspace left with **nobody** in it: everything inside it is erased, including anything
  contributed by members who had already left, since by then no one can reach it. The workspace
  itself is removed too.
- We tell the remaining members of an affected workspace that a member has left and their entries
  are now unattributed, without naming you.
- Other members may hold exported copies of anything you shared with them, which we cannot reach.
- If you are the only owner of a workspace that still has other members, you must transfer
  ownership or remove the workspace before deleting your account, so nobody else's shared data is
  destroyed without warning.

## Copyright and takedown requests

Corvale is a place to store your own financial records, so this rarely comes up. Still: do not
upload material you have no right to store or share, including in a shared workspace.

If you believe material stored in Corvale infringes your copyright, email [[SUPPORT_EMAIL]] with:

- What the work is, in enough detail to identify it
- Where the infringing material is in Corvale, in enough detail for us to find it
- Your contact details
- A statement that you believe in good faith that the use is not authorised by the rights holder
  or by law
- A statement that the information in your notice is accurate, and that you are the rights holder
  or authorised to act for them

We will review a valid notice and may remove or disable access to the material, and may suspend or
close the account of a repeat infringer. If your material was removed and you believe that was a
mistake, write to the same address and tell us why.

Note that almost everything in Corvale is private to one account and published nowhere, so a
takedown here removes a user's own stored file rather than anything publicly visible.

## Availability

Corvale is provided on an "as available" basis. There is **no uptime guarantee and no service
level agreement.** It is built and operated by one person, and it may change, break, or be taken
offline for maintenance without notice.

## Backups are your responsibility too

You can export a complete copy of your data at any time from Settings, as JSON or as a ZIP
including receipts. **Export is never restricted** — not while your account is inactive, not
during any billing state, not ever. We consider that a floor, not a feature.

We keep our own backups so the service can be recovered after a failure. Those backups are kept
for 30 days and then overwritten, so a deleted account can persist in a backup for that long even
though it is erased from the live database immediately. We do not restore an individual account
from a backup on request.

You should still keep your own copy of anything you cannot afford to lose. We are not liable for
data loss.

## What it costs

The hosted service is **free**. There are no paid plans, no trial that turns into a charge, and no
payment details for you to give us.

Paid plans may exist one day. If they do, we will publish subscription terms — pricing, trial
length, renewal, cancellation, and refunds — and ask you to accept an updated version of these
terms before any charge is ever made. Nothing in this document authorises us to charge you.

## Ending your account

**You** can delete your account at any time from Settings. Deletion immediately removes your
account, your records and your uploaded receipts from the live service, and it cannot be undone —
there is no grace period. Backup copies may still contain your data for up to 30 days, as
described above, after which they are overwritten. Export first if you want a copy.

**We** may suspend or close an account that breaches these terms. Except in cases of serious abuse
or where the law requires otherwise, we will give you reasonable notice and a chance to export
your data first.

**If we shut the service down**, we will give at least 30 days of notice before accounts are
closed and data is deleted, so you can export everything you want to keep.
Export stays available for that whole window. We will announce a shutdown by email to the address
on your account and on [[PRODUCT_DOMAIN]].

## Warranties and liability

Corvale is provided "as is", without warranties of any kind, whether express or implied,
including any implied warranty of merchantability, fitness for a particular purpose, accuracy, or
non-infringement.

To the fullest extent the law allows, we are not liable for indirect, incidental, special,
consequential or punitive damages, or for lost profits, lost savings, lost data, or any financial
decision made using Corvale. Where liability cannot be excluded, it is limited to the greater of
the amount you paid us in the twelve months before the claim, or ₹1,000.

Nothing here excludes liability that cannot lawfully be excluded.

Note that the AGPL's own warranty disclaimer covers the **software**. This section covers the
**hosted service**. They are separate.

## Indemnity

You agree to indemnify us against third-party claims, losses and reasonable legal costs arising
from your misuse of the service, your breach of these terms, or content you put into a workspace
that you had no right to share.

This does not apply to the extent a claim arises from our own breach of these terms, our own
negligence, or our failure to meet an obligation the law places on us. We will tell you promptly
about any claim we want covered, will not settle it without your agreement, and will let you take
over the defence if you want to.

## Governing law

These terms are governed by the laws of India. The courts at [[JURISDICTION_CITY]] have exclusive
jurisdiction over any dispute, except where mandatory consumer protection law in your country of
residence gives you the right to bring a claim locally.

## Events outside our control

We are not liable for any failure or delay in providing the service that is caused by something
outside our reasonable control. That includes natural disasters, fire, flood, epidemic, war, civil
unrest, strikes, government action or legal orders, failures of the internet or of
telecommunications networks, power outages, and the failure, suspension or discontinuation of a
hosting, storage, email, or other upstream provider we depend on.

If such an event lasts long enough to make the service unusable, either of us may end this
agreement. Your right to export your data is not suspended by this section — we will keep export
available for as long as we are technically able to.

## If part of these terms does not hold

If a court or other competent authority finds any part of these terms invalid, unlawful, or
unenforceable, that part is treated as modified to the least extent needed to make it enforceable,
or removed if that is not possible. The rest of these terms stay in full effect.

If we do not enforce a right or a provision straight away, that is not a waiver of it.

## The whole agreement

These terms, together with the [Privacy Policy](./privacy.md), the
[Cookie Policy](./cookies.md), and the [financial disclaimer](./financial-disclaimer.md), are the
entire agreement between you and us about the hosted Corvale service, and they replace any earlier
understanding, statement or representation about it.

This does not exclude liability for fraud or fraudulent misrepresentation, and it does not affect
rights the law gives you that cannot be contracted away. It also does not affect the AGPL v3.0
licence, which governs the software independently of this agreement.

You may not transfer your rights under these terms to someone else. We may transfer ours to a
successor operator of the service, and will tell you if that happens.

## Changes to these terms

If we make a material change we will update the version at the top of this page and ask you to
accept the new version the next time you sign in. If you do not accept, you can export your data
and close your account.

## Open-source software

Corvale's source code is published under the **GNU Affero General Public License v3.0**. You may
run, study, modify and redistribute it under that licence, including hosting your own instance.

The licence governs the **code**. These terms govern **our hosted service**. Nothing in these
terms limits, adds conditions to, or otherwise modifies the rights the AGPL grants you in the
software — including the age requirement above, which is a condition of using the hosted service
only.

**Trademarks are not covered by the licence.** The AGPL grants rights in the code, not in names or
branding. "Corvale", the Corvale logo, and our other brand assets remain ours. If you run a
modified version or your own instance, do not present it in a way that suggests it is the official
Corvale service or that we operate, endorse, or support it. Nominative references — saying your
instance is based on Corvale — are fine.

If you run your own instance, these terms and our Privacy Policy do not apply to it. The operator
of that instance is responsible for deciding how it processes personal data and for providing any
notices, safeguards, or other protections required by the law that applies to them.

## Contact

Questions about these terms: [[SUPPORT_EMAIL]]. See the [Contact page](./contact.md) for support,
privacy and security routes.
