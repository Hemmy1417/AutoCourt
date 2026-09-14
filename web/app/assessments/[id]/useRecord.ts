"use client";

import { useCallback, useEffect, useState } from "react";

import { getConfig, getRecord, getVerdict, invalidateReads } from "../../../lib/read";
import type { ChainConfig, RecordView, VerdictView } from "../../../lib/types";

export interface RecordState {
  record: RecordView | null;
  config: ChainConfig | null;
  verdict: VerdictView | null;
  notFound: boolean;
  error: unknown;
  /** Re-read from the chain, skipping every cached live answer. */
  reload: () => Promise<void>;
}

/** One record, the contract's limits, and the standing verdict once there is one. */
export function useRecord(id: string): RecordState {
  const [record, setRecord] = useState<RecordView | null>(null);
  const [config, setConfig] = useState<ChainConfig | null>(null);
  const [verdict, setVerdict] = useState<VerdictView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (force: boolean) => {
      try {
        if (force) invalidateReads();
        const [r, c] = await Promise.all([getRecord(id, force), getConfig()]);
        setConfig(c);
        if (!r) {
          setNotFound(true);
          return;
        }
        setRecord(r);
        setVerdict(r.runs_count > 0 ? await getVerdict(id, force) : null);
        setError(null);
      } catch (e) {
        setError(e);
      }
    },
    [id],
  );

  useEffect(() => {
    const kick = setTimeout(() => void load(false), 0);
    return () => clearTimeout(kick);
  }, [load]);

  const reload = useCallback(() => load(true), [load]);
  return { record, config, verdict, notFound, error, reload };
}
