import { withSupabase } from "@supabase/server";
import { handleWorkflowEmail } from "./handler.ts";
// No browser JWT/CORS, recipient/body input, Auth SMTP changes or SMS path.
// auth:none is paired with a separate function-scoped bearer-secret check.
export default {
  fetch: withSupabase(
    { auth: "none" },
    (req, ctx) =>
      handleWorkflowEmail(
        req,
        (name) => Deno.env.get(name),
        (name, args) => ctx.supabaseAdmin.rpc(name, args),
      ),
  ),
};
