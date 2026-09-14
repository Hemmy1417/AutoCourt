/** Dump every [DISAGREE]/[DOWNGRADE] line (and stderr tails) from a tx. */
const RPC = process.env.GENLAYER_RPC_URL ?? "https://studio-next.genlayer.com/api";
const HASH = process.argv[2];
const res = await fetch(RPC, {
  method: "POST",
  headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 autocourt" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionByHash", params: [HASH] }),
});
const t = (await res.json()).result;
console.log(`status ${t?.status ?? t?.statusName} · ${t?.result_name}`);
const streams = [];
for (const r of t?.consensus_data?.leader_receipt ?? []) {
  streams.push({ who: `leader-slot(${r.mode ?? "?"})`, out: String(r?.genvm_result?.stdout ?? ""), err: String(r?.genvm_result?.stderr ?? "") });
}
for (const v of t?.consensus_data?.validators ?? []) {
  streams.push({ who: "validator", out: String(v?.genvm_result?.stdout ?? ""), err: String(v?.genvm_result?.stderr ?? "") });
}
for (const s of streams) {
  const lines = s.out.split("\n").filter((l) => l.includes("[DISAGREE]") || l.includes("[DOWNGRADE]"));
  for (const l of lines) console.log(`${s.who}: ${l.slice(0, 1600)}`);
  if (lines.length === 0 && s.err.trim()) console.log(`${s.who} stderr tail: ${s.err.slice(-200)}`);
}
if (streams.length === 0) console.log("no receipts with streams");
