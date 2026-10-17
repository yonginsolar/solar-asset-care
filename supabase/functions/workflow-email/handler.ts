import { deliverMail, type MailJob, validateConfig } from "./mail.ts";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
export async function handleWorkflowEmail(
  req: Request,
  env: (name: string) => string | undefined,
  rpc: Rpc,
  deliver = deliverMail,
) {
  const secret = env("WORKFLOW_EMAIL_DISPATCH_SECRET");
  if (
    !secret || secret.length < 32 ||
    req.headers.get("authorization") !== "Bearer " + secret
  ) return new Response("Unauthorized", { status: 401 });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const key = env("RESEND_WORKFLOW_API_KEY");
  if (!key) {
    return Response.json({ error: "Mail provider is not configured" }, {
      status: 503,
    });
  }
  let config;
  try {
    config = validateConfig({
      origin: env("WORKFLOW_EMAIL_SITE_ORIGIN") ?? "",
      from: env("WORKFLOW_EMAIL_FROM") ?? "",
    });
  } catch {
    return Response.json({ error: "Mail configuration is invalid" }, {
      status: 503,
    });
  }
  let processed = 0;
  try {
    for (let n = 0; n < 5; n++) {
      const { data, error } = await rpc("claim_workflow_emails", {
        p_limit: 1,
      });
      if (error) {
        return Response.json({ error: "Mail queue unavailable" }, {
          status: 503,
        });
      }
      const job = (data as MailJob[] | null)?.[0];
      if (!job) break;
      const delivery = await deliver(job, key, config);
      const { data: finished, error: finishError } = await rpc(
        "finish_workflow_email",
        {
          p_id: job.id,
          p_claim_token: job.claimToken,
          p_result: delivery.result,
          p_provider_id: delivery.providerId ?? null,
          p_retry_seconds: delivery.retrySeconds ?? 300,
        },
      );
      // No second provider attempt after an uncertain DB result.
      if (finishError || !finished) {
        return Response.json({ error: "Mail result could not be recorded" }, {
          status: 503,
        });
      }
      processed++;
      if (delivery.result === "rate_limited") break;
    }
    return Response.json({ processed });
  } catch {
    return Response.json({ error: "Mail worker unavailable" }, { status: 503 });
  }
}
