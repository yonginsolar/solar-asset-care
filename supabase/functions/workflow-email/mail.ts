export type MailJob = {
  id: string;
  claimToken: string;
  kind: "inspection_received" | "expert_assigned" | "report_published";
  role: "owner" | "expert" | "client";
  email: string;
  inspectionCode: string;
  inspectionId: string;
  reportId: string | null;
};
export type MailConfig = { origin: string; from: string };
export function validateConfig(config: MailConfig) {
  const url = new URL(config.origin);
  if (
    url.protocol !== "https:" || url.origin !== config.origin ||
    !/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$/.test(config.from)
  ) {
    throw new Error("Invalid mail configuration");
  }
  return config;
}
export function safeRecipient(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !/(^|\.)(invalid|test|localhost|example\.(com|org|net))$/.test(domain);
}
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]!),
  );
}
export function renderMail(job: MailJob, config: MailConfig) {
  const { origin, from } = validateConfig(config);
  const titles = {
    inspection_received: "점검이 접수되었습니다",
    expert_assigned: "점검 담당 전문가가 배정되었습니다",
    report_published: "점검 보고서가 발행되었습니다",
  };
  const descriptions = {
    inspection_received: job.role === "owner"
      ? "새로운 점검 요청이 접수되었습니다. 관리자 화면에서 요청 내용을 확인해 주시기 바랍니다."
      : "요청하신 점검이 정상적으로 접수되었습니다. 로그인하시면 접수 내용과 진행 상황을 확인하실 수 있습니다.",
    expert_assigned: job.role === "expert"
      ? "새로운 점검의 담당 전문가로 배정되셨습니다. 전문가 화면에서 점검 내용을 확인해 주시기 바랍니다."
      : "요청하신 점검을 담당할 전문가가 배정되었습니다. 로그인하시면 점검 진행 상황을 확인하실 수 있습니다.",
    report_published:
      "요청하신 점검의 보고서가 발행되었습니다. 로그인하신 후 보고서를 확인해 주시기 바랍니다.",
  };
  const title = titles[job.kind];
  if (!title) throw new Error("Unsupported mail event");
  const code = job.inspectionCode.replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
    .slice(0, 100);
  const route = job.role === "owner"
    ? "admin"
    : job.role === "expert"
    ? "expert"
    : "client";
  const url = job.kind === "report_published" && job.reportId
    ? origin + "/reports/" + encodeURIComponent(job.reportId)
    : origin + "/" + route + "?view=inspections&inspection=" +
      encodeURIComponent(job.inspectionId);
  const detail = descriptions[job.kind];
  const greeting = "안녕하세요. SolarScope입니다.";
  const thanks = job.role === "owner"
    ? "원활한 점검 운영에 협조해 주셔서 감사합니다."
    : job.role === "expert"
    ? "점검 업무에 협조해 주셔서 감사합니다."
    : "SolarScope를 이용해 주셔서 감사합니다.";
  return {
    from,
    to: [job.email],
    subject: "[SolarScope] " + title,
    text: "SolarScope\n\n" + title + "\n\n" + greeting + "\n\n" + detail +
      "\n\n점검번호: " + code +
      "\n\n확인하기: " + url +
      "\n\n" + thanks +
      "\n\n이 메일은 서비스 진행 안내입니다. 회신은 수신되지 않습니다.",
    html:
      '<div lang="ko" style="max-width:560px;margin:auto;padding:32px;font-family:Arial,sans-serif;line-height:1.8;color:#1f2937"><p style="color:#15803d;font-weight:bold">SolarScope</p><h1 style="font-size:22px">' +
      title + "</h1><p>" + greeting + "</p><p>" + detail +
      "</p><p>점검번호: " + escapeHtml(code) +
      '</p><p><a href="' + escapeHtml(url) +
      '" style="display:inline-block;background:#166534;color:white;text-decoration:none;padding:10px 22px;border-radius:8px">로그인 후 확인하기</a></p><p>' +
      thanks +
      '</p><hr style="border:0;border-top:1px solid #e5e7eb"><p style="font-size:12px;color:#6b7280">이 메일은 서비스 진행 안내입니다. 회신은 수신되지 않습니다.</p></div>',
  };
}
export type Delivery = {
  result: "accepted" | "failed" | "unknown" | "rate_limited";
  providerId?: string;
  retrySeconds?: number;
};
export async function deliverMail(
  job: MailJob,
  key: string,
  config: MailConfig,
  http: typeof fetch = fetch,
): Promise<Delivery> {
  if (!safeRecipient(job.email)) return { result: "failed" };
  try {
    const response = await http("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        "Idempotency-Key": "solar-workflow-v1/" + job.id,
      },
      body: JSON.stringify(renderMail(job, config)),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter && !/^\d+(\.\d+)?$/.test(retryAfter)
        ? Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
        : Number(retryAfter);
      // Do not shorten a supplier's longer embargo to fit our retry budget.
      if (Number.isFinite(seconds) && seconds > 3600) {
        return { result: "failed" };
      }
      return {
        result: "rate_limited",
        retrySeconds: Number.isFinite(seconds) && seconds > 0
          ? Math.max(60, seconds)
          : 300,
      };
    }
    if (!response.ok) {
      return {
        result: response.status >= 500 || response.status === 409
          ? "unknown"
          : "failed",
      };
    }
    const data = await response.json();
    return typeof data.id === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(data.id)
      ? { result: "accepted", providerId: data.id }
      : { result: "unknown" };
  } catch {
    return { result: "unknown" };
  }
}
