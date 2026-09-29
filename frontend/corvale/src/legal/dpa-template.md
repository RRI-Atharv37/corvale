<!--
  TEMPLATE - not wired into `index.ts` / `LEGAL_DOCUMENTS` and not served at any app route or
  docs page. Per `.project/TODO.md` and `PAPERWORK.md` §9, a DPA is sent to a workspace customer
  only when one actually asks for it - it is not a unilateral policy like the other files in this
  folder, so it is not published by default.

  Before sending:
  1. Fill every [[TOKEN]] below for the specific customer.
  2. Fill [[OPERATOR_NOTICES_ADDRESS]] deliberately - the published Privacy Policy and Terms
     permanently omit a postal address (see PAPERWORK.md R4), but a bilateral signed contract
     conventionally needs a notices address for either party. Decide at send-time whether that is
     a registered business address (once one exists per M0c3), a virtual mailbox, or an
     email-only notices clause instead - do not default to a home address.
  3. Check the sub-processor table below against the live one in `privacy.md` - if that table has
     changed since this template was last touched, update this one to match before sending.
  4. If the requesting customer is itself subject to the GDPR (established in the EEA/UK, or
     enters EEA/UK personal data into the Service), read `PAPERWORK.md`'s EEA/UK section (R8)
     first - signing this DPA does not by itself make Corvale GDPR-compliant if the standing
     no-EEA/UK-representative position no longer holds.
  5. `PAPERWORK.md` §8 records that a lawyer review of the Terms is optional and not a launch
     gate (decided 2026-09-26). That decision was about the unilaterally-published policies. A
     DPA is a bilaterally negotiated contract a counterparty's own legal team may redline - if a
     customer pushes back on any clause here, that is an ordinary contract negotiation, not
     evidence this template was wrong.
-->

# Data Processing Agreement

**Template version:** 2026-09-28

This Data Processing Agreement ("**DPA**") is entered into between:

- **[[CUSTOMER_LEGAL_NAME]]**, of [[CUSTOMER_ADDRESS]] ("**Customer**"); and
- **Atharv Dewangan**, an individual resident in India, operating the hosted Corvale service at
  corvale.app, of [[OPERATOR_NOTICES_ADDRESS]] ("**Processor**"),

and applies from [[EFFECTIVE_DATE]] (the "**Effective Date**"). It supplements the
[Terms of Service](./terms.md) accepted by Customer at signup (or the separate agreement
referenced as [[AGREEMENT_REFERENCE]], if one exists) (the "**Agreement**").

## 1. Purpose and scope

Processor's Service lets Customer record, categorise and report on financial data, some of which
may be Personal Data about individuals other than Customer itself (for example, Customer's own
clients, employees or contacts named in transactions, receipts or notes Customer enters). This DPA
governs that Processing.

It does **not** cover Processor's own processing of Customer's account data, or of the account
data of anyone Customer invites into a shared workspace as an independent Corvale user - each such
individual holds their own account and their own direct relationship with Processor as described
in the [Privacy Policy](./privacy.md), regardless of this DPA.

## 2. Definitions

- **"Applicable Data Protection Law"** means India's Digital Personal Data Protection Act, 2023
  and its rules, and, to the extent it applies to the Personal Data in question, the EU/UK GDPR.
- **"Personal Data"**, **"Processing"**, **"Controller"**/**"Data Fiduciary"**,
  **"Processor"**/**"Data Processor"**, **"Data Subject"**/**"Data Principal"**, and
  **"Sub-processor"** have the meanings given in Applicable Data Protection Law.
- **"Customer Data"** means the Personal Data described in Annex 1 that Customer submits to the
  Service and that Processor Processes on Customer's behalf under this DPA.

Customer is the Controller of Customer Data. Processor is the Processor of Customer Data and will
only Process it on Customer's documented instructions, including those set out in this DPA and the
Agreement, unless required to do otherwise by law - in which case Processor will tell Customer
before Processing, unless the law prohibits this.

## 3. Processor obligations

**3.1 Confidentiality.** Processor ensures that anyone authorised to Process Customer Data
(currently Processor alone; Corvale is a solo-operated service) is under a duty of confidentiality.

**3.2 Security.** Processor implements the technical and organisational measures described in
Annex 2, appropriate to the risk. Processor maintains a documented internal procedure for
detecting, containing, assessing and notifying a personal data breach.

**3.3 Sub-processors.** Customer gives Processor general authorisation to engage the
sub-processors listed in Annex 3. Processor will not add a new sub-processor to Customer Data
without updating Annex 3 and giving Customer at least 14 days' notice, during which Customer may
object on reasonable data-protection grounds; if the parties cannot resolve the objection, either
party may terminate this DPA (and, with it, any part of the Agreement that depends on it) without
penalty. Processor remains liable for each sub-processor's acts and omissions as if they were its
own.

**3.4 Assistance.** Processor will, taking into account the nature of the Processing, reasonably
assist Customer in:

- responding to requests from Data Subjects exercising their rights under Applicable Data
  Protection Law, to the extent Customer cannot reasonably do so itself from the Service;
- meeting Customer's own security and breach-notification obligations - Processor will notify
  Customer without undue delay after becoming aware of a personal data breach affecting Customer
  Data, following the process in its internal breach-response runbook; and
- any data protection impact assessment or prior consultation with a supervisory authority that
  Applicable Data Protection Law requires of Customer in relation to the Service, based on
  information Processor already holds.

**3.5 Audits.** On reasonable written notice, and no more than once in any 12-month period unless
required sooner by a supervisory authority or following a confirmed breach, Processor will make
available the information reasonably necessary to demonstrate compliance with this DPA, which may
take the form of a written response to a security questionnaire or documentation of the measures
in Annex 2, rather than an on-site inspection, given the solo-operated scale of the Service. Any
audit findings are Confidential Information of Processor.

**3.6 Deletion or return.** On termination of the Agreement, Processor will delete Customer Data
in line with the retention periods already described in the [Privacy Policy](./privacy.md), except
where it must keep a copy to comply with law - Processor does not offer a separate data-return
format beyond the export tools already available in the Service, which Customer should use before
termination if it needs a copy.

## 4. International transfers

Where a sub-processor in Annex 3 Processes Customer Data outside India (or outside the EEA/UK, if
the GDPR applies to that data), the transfer is covered by Processor's agreement with that
sub-processor, including standard contractual clauses or an equivalent transfer mechanism where
Applicable Data Protection Law requires one.

## 5. Liability

Each party's liability under this DPA is subject to the same limitations and exclusions set out in
the Agreement.

## 6. Term and governing law

This DPA remains in effect for as long as the Agreement does. It is governed by the same law as
the Agreement, except that a transfer mechanism referenced under Section 4 is governed by its own
terms where those differ.

## Annex 1 - Details of processing

| | |
| --- | --- |
| **Subject matter** | Processor's provision of the Service to Customer |
| **Duration** | The term of the Agreement, plus the retention periods in the Privacy Policy |
| **Nature and purpose** | Storage, computation (balances, budgets, reports) and display of data Customer enters into the Service |
| **Types of Personal Data** | Names, contact details, transaction descriptions and counterparties, amounts, account identifiers, receipt images, and any other Personal Data Customer chooses to enter about a Data Subject |
| **Categories of Data Subjects** | Individuals whose Personal Data Customer enters into the Service (for example, Customer's clients, employees or contacts) |

## Annex 2 - Technical and organisational measures

- Every query against tenant data is scoped by account/workspace at the database layer
  (row-level-security enforcement); cross-tenant queries are rejected rather than filtered.
- Data in transit is encrypted (TLS). Locally cached data on desktop is encrypted at rest
  (SQLCipher); the browser/PWA local store encrypts its data blob when a device PIN is set.
- Authentication uses short-lived access tokens and rotating refresh tokens, with the ability to
  invalidate every outstanding token on password reset or logout-all.
- Authentication and write endpoints are rate-limited.
- Internal access to billing and account metadata goes through a separate tool gated by mandatory
  two-factor authentication, with every action recorded to an append-only audit log.
- Structured logging, error tracking and uptime monitoring are in place for the production service.
- Backups are taken on a documented schedule with a tested restore procedure.
- A documented internal runbook governs detecting, containing, assessing and notifying a personal
  data breach.

## Annex 3 - Sub-processors

| Sub-processor | What they do | Where they process |
| --- | --- | --- |
| Google LLC (Google Cloud) | Runs the application servers, database, receipt storage and backups | United States (South Carolina) |
| Resend, Inc. | Sends account and transactional email | United States |
| Cloudflare, Inc. | DNS for corvale.app and routing for our published email addresses | United States, global edge network |
| GitHub, Inc. | Serves desktop-app updates | United States |
| Paddle.com Market Limited | Payment processing and merchant of record - only if Customer is on a paid plan | United Kingdom |
| Sentry (Functional Software, Inc.) | Error tracking - only if enabled on the instance Customer uses | United States |
| Intuition Machines, Inc. (hCaptcha) | Signup bot-check - only if enabled on the instance Customer uses | United States |

This table must match the sub-processor table in the [Privacy Policy](./privacy.md#who-else-processes-your-data)
at the time this DPA is sent; if it has drifted, update this table first.

---

**Signed for and on behalf of Customer:**

Name: [[CUSTOMER_SIGNATORY_NAME]]
Title: [[CUSTOMER_SIGNATORY_TITLE]]
Date: [[CUSTOMER_SIGNATURE_DATE]]

**Signed for and on behalf of Processor:**

Name: Atharv Dewangan
Date: [[OPERATOR_SIGNATURE_DATE]]
