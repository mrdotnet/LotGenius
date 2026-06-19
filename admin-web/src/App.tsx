import { useState } from "react";
import { type AdminApi } from "./api";
import { Tabs, type TabDef } from "./components/Tabs";
import { ReviewView } from "./views/ReviewView";
import { SourceCurationView } from "./views/SourceCurationView";
import { UsersGroupsView } from "./views/UsersGroupsView";
import { CalibrationView } from "./views/CalibrationView";

interface AppProps {
  api: AdminApi;
}

const TABS: TabDef[] = [
  { id: "review", label: "Review" },
  { id: "curation", label: "Source curation" },
  { id: "users", label: "Users & Groups" },
  { id: "calibration", label: "Calibration" },
];

/**
 * Admin console shell. A roving-focus tablist switches between the original SC4
 * classification-review lane and the three v-next admin views (source curation,
 * identity/ABAC, calibration). Each view owns its own data loading against the
 * same typed AdminApi, so the shell stays thin and the review lane is untouched.
 */
export function App({ api }: AppProps) {
  const [tab, setTab] = useState<string>("review");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <b>Lot Genius</b>
          <span className="sub">· Admin console</span>
        </div>
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "review" && <ReviewView api={api} />}
      {tab === "curation" && <SourceCurationView api={api} />}
      {tab === "users" && <UsersGroupsView api={api} />}
      {tab === "calibration" && <CalibrationView api={api} />}
    </div>
  );
}
