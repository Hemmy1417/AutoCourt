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

Check the bytes yourself. The record stores the SHA-256 of the file at the
pinned commit, and the contract refuses to judge a source whose fetched
bytes hash to anything else:

```bash
git cat-file -p <commit>:fixtures/registry/1HGCM82633A004352.txt | sha256sum
```

[`scripts/prove-clean-record.mjs`](../../scripts/prove-clean-record.mjs)
runs this check before it starts, then reads the same hash back from the
contract.
