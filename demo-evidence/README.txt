Demo documents for AutoCourt.

The clean record. List VIN 1HGCM82633A004352 as a 2003 Honda Accord with the
claim Mileage "87,432 miles". Upload honda-accord-invoice.txt with a typed
reading (2026-03-07, 87432 mi), then add this independent source:
https://raw.githubusercontent.com/Hemmy1417/AutoCourt/76a39eea547c8286dcdaf360899303f9c75b481b/fixtures/registry/1HGCM82633A004352.txt
Seal and request adjudication: the claim comes back Verified, High
confidence, backed by an independent source.

  honda-accord-invoice.txt  the seller's invoice for that Honda (first-party)

The documents below name VIN 1M8GDM9AXKP042788 instead. Choose any of them
in "Add evidence" on a record:

  service-invoice.txt     the seller's own paperwork (first-party)
  vehicle-history.txt     a history pull that mentions a wing refinish
  rolled-back-listing.txt a LATER document with a LOWER odometer reading

All three name VIN 1M8GDM9AXKP042788, which the federal registry decodes to
a 1989 Motor Coach Industries bus. That makes two demos possible.

The rollback. List the vehicle as the registry knows it (make "Motor Coach
Industries", year 1989, that VIN), so the identity check confirms it. Upload
the invoice from the seller's wallet, then connect a second wallet and upload
the rolled-back listing from it, adding a typed odometer reading to each
(2026-03-07 / 87432 and 2026-05-01 / 62000). Seal from the seller's wallet
and adjudicate: the contract computes the mileage conflict from the typed
readings itself, no model asked. Because the two readings come from two
different wallets, and unless the record explains the lower reading, the
report headlines a possible odometer rollback. Readings from one wallet
alone raise a mileage conflict, never a rollback.

The identity check. List it as the documents describe it, a 2019 Meridian
GT Wagon with that VIN. Before any evidence is judged, every validator
decodes the VIN, finds a bus, and records a mismatch; the mismatch caps
every claim and takes the headline. The seller supplied every other byte,
and not that one.
