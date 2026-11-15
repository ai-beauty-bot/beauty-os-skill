# Onboarding

Sequence: connect account → select or create salon → verified catalog, team and schedules → complete CRM setup → (optional) publish online booking → (optional) AI receptionist: configure → offer test or accept an explicit skip → connect channel → explicit activation → delivery verification.

The CRM is useful on its own. Do not make channel connection, the AI receptionist or a test a condition for finishing CRM setup.

## Account and salon

Start with `beautyos_get_onboarding` without `salonId` and follow its `nextStep`.

- `nextStep = reconnect`: no salon is shared with this connection and creating new salons was not approved. Offer to reconnect the right account and share an existing salon, or allow access to salons the user creates later.
- `status = no_linked_salons` only means nothing is shared with this connection. Never create a copy of an existing salon.
- If a salon is already shared, do not restart onboarding: summarize current readiness, resume pending operations and offer the next unfinished step. With several salons, ask which one.

If pending operations are returned, resolve them first. When a creation outcome is unknown, read it with `beautyos_get_operation`; do not create again.

## Sources and catalog

Ask one simple question first: where are the services and prices now (website, Instagram, price list file, or a plain description)? Then ask only for what is missing: salon name, city or time zone, and currency.

Source tools need a real `salonId`, so prepare and confirm a minimal salon (`beautyos_salon_create_prepare`) before reading a source. A public website can be read with `beautyos_catalog_source_read`. Instagram may be unavailable: never bypass sign-in or access limits; ask for a file or pasted text instead. For files (price lists, spreadsheets, PDFs, images) and pasted text, read the content yourself; use only what you can actually read, otherwise ask for text or another format. Never call unread data "extracted".

Show the extracted services, prices, currency and durations and resolve ambiguities. Then pass them as structured rows to `beautyos_catalog_import_prepare` and ask for confirmation before applying.

## Team and CRM completion

Configure staff and working hours. Native BeautyOS staff can be created here; staff from an external CRM must already exist there. Then check `beautyos_get_setup_readiness` and prepare `beautyos_complete_setup_prepare`. Publishing the online booking page is a separate owner-confirmed step; completing setup can expose a booking page that is already enabled, so mention that in the preview.

## AI receptionist

Configure it with supported fields only. Offer an optional test and mention that it uses the AI allowance. A test checks replies and catalog reading in an isolated conversation; it creates no real appointments and proves no delivery. If the user declines, accept that once and use `skipTest: true` on the confirmed activation. Do not keep pushing for a test.

Connecting a channel and turning on automatic replies are separate. Begin a connection only after the user confirms it, give them the browser setup link, check provider status, then preview activation and get an explicit confirmation. Activation can affect channels that are already connected.

## Limits

BeautyOS sends a confirmation email right after email-and-password registration; Google sign-in counts as verified. An unverified email does not block CRM setup, but it blocks turning on AI replies. When that happens, ask the user to confirm the email from that message (checking spam if needed) and then re-read state.

If a plan limit, used-up AI allowance or email verification blocks progress, describe it without guessing a price or changing billing. The user resolves it in their BeautyOS account and can resume here. Stop at unsupported operations rather than claiming completion.

Account registration and connection consent are not consent to pay, publish a booking page, turn on the AI receptionist or message customers.
