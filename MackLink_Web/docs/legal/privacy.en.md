# Privacy Policy

MacLink · 2026-10-17 · 오종현 · taoss3932@gmail.com

How MacLink processes information and carries screen and remote input.

## 1. Operator and scope

MacLink is a remote screen sharing and device control service operated by 오종현. This policy covers the operator’s processing through https://www.maclink.cloud and the MacLink Connector.

Privacy contact and person responsible: 오종현. Requests, complaints, access, correction, deletion, restriction and consent withdrawal: taoss3932@gmail.com.

Device owners sign in with Google. Google authentication is also governed by Google policies. Rights requests and deletion rules in this policy also cover any retained account/device records from the previous service.

## 2. Information and purposes

| Category | Information | Purpose |
| --- | --- | --- |
| Account authentication | Provider account identifier, email and supplied display name; for Google, the Google subject identifier and email verification status | Sign-in, account ownership, device management and verification of requests |
| Device management | Device name and ID, connector-key hash, app version, screen/input permission status, connectivity and last-seen time | Connector authentication and device availability |
| Invitations and sessions | Invitation/session IDs, secret hashes, host-email verification hash, permissions, status/timestamps/end reasons, quality settings and WebRTC SDP/ICE information that may include IP addresses and ports | Invitation verification, connection negotiation, revocation, recovery and diagnostics |
| Screens and remote input | The shared display, pointer coordinates/clicks/wheel, key events and text explicitly submitted | Authorized screen sharing and remote interaction |
| Optional TURN configuration | User-supplied Cloudflare TURN key ID/API token and temporary relay credentials | Relay connectivity when direct connections fail |
| Settings, security and support | Language/key mappings, current session recovery information, infrastructure request metadata such as IP/time/browser, and information users send in support emails or reports | Preferences, recovery, security and support |

## 3. Sources and basis

Data comes from identity responses, user registration/settings/support requests, Connector status reports, remote connections and browser/hosting operations. Necessary account and connection processing supports the service requested by the user.

Where consent is required for optional information or a new purpose, the relevant purpose, information and retention will be explained and the required consent obtained. Security and abuse prevention use the minimum necessary information within applicable law.

Declining required sign-in or connection information can prevent device registration or remote access. Invited visitors do not need an owner account. TURN configuration and support attachments are optional.

## 4. Remote screen and input processing

With direct WebRTC, encrypted communication carries screens and input between the host and visitor. With TURN, the relay provider processes encrypted packets and connection metadata.

Screens and keyboard, pointer and text-send contents travel only over WebRTC media/data channels. No HTTPS screen/input fallback or server API that accepts and stores these payloads is provided. HTTPS protects the website, sign-in, authorization and connection signaling.

Documents, notifications, accounts and sensitive information visible on the shared screen may be seen by the visitor. Close unnecessary windows and confirm your authority to share others’ information. Audio streaming, dedicated file transfer and screen recording are not currently provided.

The operator does not use remote screens or input for advertising, sale, user profiling or AI model training. Any access needed for support, security or legal obligations is limited to a necessary scope and lawful basis.

## 5. Retention

| Information | Retention and cleanup |
| --- | --- |
| Account and email verification data | Retained while the account is used and deleted when an account-deletion request is processed. Device removal does not by itself remove all account or TURN data. |
| Devices, invitations and sessions | Retained for device management and recovery. Device removal deletes its related invitations/sessions. Single-use invitations are usable for one hour; reusable links remain valid until revoked. Expired or used invitation records may be removed during later cleanup. |
| Google sign-in, when used | Login transactions are valid for up to 10 minutes and app sessions for up to seven days. Logout revokes that session. Expired database records are removed during later sign-in cleanup; validity and physical deletion are different. |
| TURN credentials | Registered settings are encrypted until removed or account deletion is requested. Temporary credentials normally last 24 hours and are cleaned up on expiry, configuration removal or renewal. |
| Local browser/Mac data | Language and key mappings can remain until browser site data is cleared. Session recovery data can remain until the connection/tab session ends. Local keys, status and logs on a Mac may remain until the user deletes the files; uninstalling the app may not remove them. |
| Support and legally retained information | Retained as necessary to resolve a request, then deleted without undue delay. Legally required retention or legitimate dispute preservation is limited to necessary information; applicable grounds and periods are explained to the requester. |

## 6. Deletion

When a purpose ends or a valid deletion request is verified, related account/device data is identified and deleted from the database and file storage. Electronic records are deleted so they cannot ordinarily be recovered or replayed; any paper records are destroyed appropriately.

Provider backups, security logs and legally retained records may follow separate contractual, provider or legal periods. MacLink does not promise an unverified backup deletion deadline.

## 7. Visitors and service providers

When an owner shares an invitation, the invited visitor can see the authorized screen, device name and connection state, and can operate the device if control is permitted. Knowing the host email is not a second authentication factor. A reusable invitation may allow connections without approval each time.

MacLink does not sell personal data or provide it to advertisers. Disclosure is limited to requested connectivity/authentication/hosting, separately authorized purposes and legal obligations.

| Provider and role | Processing and contact |
| --- | --- |
| Google LLC — when Google sign-in is used | Authentication and basic identity. Google’s privacy policy and account controls also apply. |
| OpenAI — Sites hosting | Website delivery, request processing and security. MacLink does not provide a feature that sends screen/input contents to an AI model. Contact: OpenAI Privacy Portal. |
| Cloudflare, Inc. — hosting infrastructure, storage, security and STUN/TURN | Requests, storage/transport and optional relay services. User-managed relay accounts also follow the provider agreement. Contact: privacyquestions@cloudflare.com. |

- [Google Privacy Policy](https://policies.google.com/privacy)
- [OpenAI Privacy Policy and contact](https://openai.com/policies/row-privacy-policy/)
- [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/)

## 8. International processing

Providers include US-based organizations with global infrastructure. When you sign in, use the site or connect through a relay, necessary data may be transmitted over encrypted networks and processed in the United States and other processing locations published by the providers. MacLink does not offer storage confined to the Republic of Korea.

Read the categories, purposes and retention criteria above together with the providers’ policies. MacLink cannot currently guarantee a fixed country for each data center or a specific provider backup/security-log period; ask the privacy contact for case-specific details. Any additional notice or separate consent required by law will be provided.

You can decline such processing by stopping the relevant sign-in/hosting/relay features and requesting account/device deletion. Refusing processing required to deliver a feature can make that feature unavailable.

## 9. Cookies and local storage

Necessary cookies protect authentication and maintain sign-in. Local storage retains language/key mappings and tab session storage supports recovery. When Google sign-in is used, app session cookies last up to seven days and authentication transaction cookies up to ten minutes, with protections including HttpOnly and SameSite.

Hosting/authentication providers may add security cookies. The MacLink application currently includes no advertising trackers or separate visitor analytics SDK. Infrastructure security and operational processing follow the providers’ policies.

Browser controls let you block cookies or clear site data. This can sign you out or remove preferences and recovery information.

## 10. Google information

When enabled, Google sign-in requests only openid, email and profile to identify the account and its device ownership. MacLink does not receive your Google password or request Gmail, Drive or Calendar contents.

Use and transfer of information received through Google APIs comply with the Google API Services User Data Policy, including applicable Limited Use requirements. This information is not used for advertising, sale, credit decisions or general-purpose AI training.

You may revoke MacLink access in your Google Account. Revoking the connection there does not automatically erase all information already retained by MacLink; contact the operator to request deletion.

- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

## 11. Your rights

Users and legal representatives can request access, correction, deletion, restriction, consent withdrawal or account deletion as provided by applicable law. Email taoss3932@gmail.com with the request and sufficient account information. After minimum necessary identity verification, we respond without undue delay as required by law and explain any limitation.

Do not post passwords, raw connector keys, secret invitation values, full identity documents or sensitive screens in public issues. If further evidence is required, the contact will explain an appropriate submission method.

To stop access immediately, stop the Connector, revoke invitations or remove the device. Request account and residual information deletion separately from the privacy contact.

The Korean Privacy Portal provides official information about privacy complaints and dispute resolution.

- [Korean Privacy Portal](https://www.privacy.go.kr/)

## 12. Safeguards, children and changes

Safeguards include encrypted transport, owner/key-based authorization, secret hashing, encrypted TURN settings, input validation and session-permission checks. No system can guarantee complete freedom from security incidents.

MacLink is not directed to children under 14. If such use becomes known, appropriate protection and deletion measures will be taken. This does not mean that the service continuously collects dates of birth or identity documents to verify age.

Changes to purposes, information, providers or rights are published here with an effective date. Material changes or changes requiring notice/consent receive the required separate communication. This policy first takes effect on October 17, 2026.

