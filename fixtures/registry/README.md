# Registry fixture

`1HGCM82633A004352.txt` is a **fictional** vehicle registry extract. No
registry publishes odometer history through a free public API, so this file
stands in for one. It is committed here, served from its commit-pinned
`raw.githubusercontent.com` URL (the host the deployment allowlists), and
fetched by every validator itself when the independent-source lane enters
it.

What is real and what is not:

| | |
|---|---|
| the VIN | real: the widely published example `1HGCM82633A004352`, which the federal registry (NHTSA vPIC) decodes to a 2003 Honda Accord, so the record's identity check is a genuine lookup |
| the registry, reference, registration mark and readings | invented |
| the fetch, the hashes and the panel that judges it | real, on the deployment of record |

## The fingerprint is taken over the rendered text

The readings are laid out in columns with two spaces between date and
figure. That is deliberate now, and it was an accident first: validators read
a page through GenVM's webdriver, which normalizes whitespace, so they hash
the rendered text, not these raw bytes. Pinned at commit `76a39ee`:

| | sha256 |
|---|---|
| the file's raw bytes | `83a9bc85009906d87faa1aa088c27cd80f91d5311a22ed9a8391fddb8a8fb0e3` |
| the text every validator hashes | `4308ed17c2a6685ec1f1d9bc4c53c297882c8fe3c74d2b24f3566004f3682eb6` |

Every validator hashes the second: the render probe measured it
(docs/PROBE-REPORT.md, "The render probe"), and the clean record `ac-000001`
entered this file `EXTRACTED` under it on the deployment of record. A source
committed under the first would enter as unavailable and never be judged.
Check both:

```bash
git cat-file -p 76a39ee:fixtures/registry/1HGCM82633A004352.txt | sha256sum
```

and, for the rendered text, `renderedText` in
[`web/lib/evidence/anchor.ts`](../../web/lib/evidence/anchor.ts), which
[`web/tests/anchor.test.ts`](../../web/tests/anchor.test.ts) pins to the
digest above and
[`web/tests/live/clean-record.test.ts`](../../web/tests/live/clean-record.test.ts)
uses on the live record.
