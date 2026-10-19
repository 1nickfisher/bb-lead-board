// bb-plugin-lead-board frontend: the Lead board, as a tab in a thread's side
// panel (open it beside the lead thread) and as a full page in the sidebar.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { LeadBoard, LeadBoardPage } from "@/components/lead-board";

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "lead-board",
    title: "Lead board",
    icon: "ListChecks",
    component: LeadBoard,
  });
  app.slots.navPanel({
    id: "lead-board",
    title: "Lead board",
    icon: "ListChecks",
    path: "board",
    component: LeadBoardPage,
  });
});
