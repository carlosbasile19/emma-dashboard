import { redirect } from "next/navigation";
import config from "@/config";

// Root simply forwards into the app; middleware (Phase 3) decides login vs. dashboard.
export default function Home() {
  redirect(config.auth.callbackUrl);
}
