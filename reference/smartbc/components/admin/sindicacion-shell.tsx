"use client";

import { useState } from "react";
import { FeedsTable, type FeedRowVM } from "@/components/admin/feeds-table";
import {
  type AgencyOption,
  NewFeedModal,
  type ScraperOption,
} from "@/components/admin/new-feed-modal";

export function SindicacionShell({
  feeds,
  agenciesWithoutFeed,
  scrapers,
}: {
  feeds: FeedRowVM[];
  agenciesWithoutFeed: AgencyOption[];
  scrapers: ScraperOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FeedsTable feeds={feeds} onCreateClick={() => setOpen(true)} />
      <NewFeedModal
        open={open}
        onClose={() => setOpen(false)}
        agenciesWithoutFeed={agenciesWithoutFeed}
        scrapers={scrapers}
      />
    </>
  );
}
