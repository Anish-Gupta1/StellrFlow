import { NavBar } from "@/components/nav-bar";
import { WorkflowBuilder } from "@/components/workflow/workflow-builder";

export default function Home() {
  return (
    <main className="flex flex-col h-screen w-full overflow-hidden">
      <NavBar />
      <WorkflowBuilder />
    </main>
  );
}