// Explicit opt-in only. Creates isolated synthetic users/organizations, then removes them.
// Does not send email, alter existing users or deploy anything.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { testJpeg } from '../tests/fixtures/report-image.mjs';
import ts from 'typescript';
import { acceptanceTarget } from './acceptance-target.mjs';
if (process.env.SOLAR_ACCEPTANCE_RUN !== '1')
  throw new Error(
    'Set SOLAR_ACCEPTANCE_RUN=1 to run the isolated remote acceptance test.',
  );
const project = 'vzgmryqglptxowbdewkf';
const origin = acceptanceTarget(process.env);
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const n = l.indexOf('=');
      return [l.slice(0, n), l.slice(n + 1).replace(/^['"]|['"]$/g, '')];
    }),
);
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
const keys = JSON.parse(
  execFileSync(
    'npx',
    [
      '--no-install',
      'supabase',
      'projects',
      'api-keys',
      '--project-ref',
      project,
      '--reveal',
      '--output',
      'json',
    ],
    { encoding: 'utf8', maxBuffer: 1048576 },
  ),
);
const secret = keys.find((k) => k.api_key?.startsWith('sb_secret_'))?.api_key;
assert.ok(secret, 'A modern secret key is required in CLI memory.');
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const users = [];
const organizations = [];
const paths = [];
const artifacts = [];
let reportId;
let checks = 0;
let failure;
const cleanupErrors = [];
const digest = (b) => createHash('sha256').update(b).digest('hex');
function check(value, description) {
  assert.ok(value, description);
  checks++;
  console.log(`PASS ${description}`);
}
async function required(p) {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
async function user() {
  const password = `T-${randomUUID()}-9a!`;
  const email = `acceptance-${randomUUID()}@example.invalid`;
  const data = await required(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    options,
  );
  const entry = { id: data.user.id, client, token: null, email, password };
  users.push(entry);
  const signed = await required(
    client.auth.signInWithPassword({ email, password }),
  );
  entry.token = signed.session.access_token;
  return entry;
}
async function org(owner) {
  const row = await required(
    admin
      .from('organizations')
      .insert({
        name: '삭제예정 수용시험',
        slug: `acceptance-${randomUUID()}`,
        is_primary_operator: false,
      })
      .select('*')
      .single(),
  );
  organizations.push(row.id);
  await required(
    admin.from('organization_members').insert({
      organization_id: row.id,
      user_id: owner.id,
      role: 'owner',
      status: 'active',
    }),
  );
  return row;
}
async function api(actor, method = 'GET') {
  return fetch(`${origin}/api/reports/${reportId}/pdf`, {
    method,
    headers: actor ? { Authorization: `Bearer ${actor.token}` } : {},
    signal: AbortSignal.timeout(60000),
  });
}
try {
  const owner = await user(),
    expert = await user(),
    client = await user(),
    otherClient = await user(),
    otherOwner = await user();
  if (process.env.SOLAR_ACCEPTANCE_DEPLOYED === '1') {
    // Generate links for a synthetic account only; this API does not send email.
    // Check both explicit recovery redirects and the fallback used by invitations.
    for (const options of [{ redirectTo: `${origin}/` }, undefined]) {
      const link = await required(
        admin.auth.admin.generateLink({
          type: 'recovery',
          email: client.email,
          options,
        }),
      );
      const redirect = new URL(link.properties.action_link).searchParams.get(
        'redirect_to',
      );
      check(
        redirect && new URL(redirect).origin === origin,
        options
          ? 'hosted recovery returns to this site'
          : 'default auth callback returns to this site',
      );
    }
  }
  const organization = await org(owner);
  await org(otherOwner);
  await required(
    admin.from('organization_members').insert([
      {
        organization_id: organization.id,
        user_id: expert.id,
        role: 'expert',
        status: 'active',
      },
      {
        organization_id: organization.id,
        user_id: client.id,
        role: 'client',
        status: 'active',
      },
      {
        organization_id: organization.id,
        user_id: otherClient.id,
        role: 'client',
        status: 'active',
      },
    ]),
  );
  const plant = await required(
    owner.client
      .from('plants')
      .insert({
        organization_id: organization.id,
        name: '가상 한글 발전소',
        capacity_kw: 100,
        commissioned_on: '2020-01-01',
        address: '수용시험용 가상 주소',
      })
      .select('*')
      .single(),
  );
  await required(
    admin
      .from('plant_requesters')
      .insert({ plant_id: plant.id, requester_user_id: client.id }),
  );
  const inspection = await required(
    owner.client
      .from('inspections')
      .insert({
        organization_id: organization.id,
        plant_id: plant.id,
        inspection_code: `TEST-${randomUUID().slice(0, 8)}`,
        status: 'quality_review',
        assigned_expert_user_id: expert.id,
        created_by: owner.id,
        purpose: '실제 고객 자료가 아닌 합성 자료 수용시험',
        notes: '가상 입력 자료로 계산과 권한·문서 보관만 확인합니다.',
      })
      .select('*')
      .single(),
  );
  const partnerProfile = (overrides = {}) => ({
    p_organization_id: organization.id,
    p_partner_id: null,
    p_name: `가상 정비업체 ${randomUUID().slice(0, 6)}`,
    p_partner_type: 'maintenance',
    p_service_regions: ['경기', '서울', '경기'],
    p_rating: null,
    p_status: 'active',
    p_business_registration_number: '',
    p_license_registration_number: '',
    p_contact_name: '가상 담당자',
    p_contact_email: 'fixture@example.invalid',
    p_contact_phone: '010-0000-0000',
    p_notes: '삭제되는 합성 수용시험 업체',
    ...overrides,
  });
  check(
    Boolean(
      (
        await owner.client.from('partners').insert({
          organization_id: organization.id,
          name: '직접 등록 차단 시험',
          partner_type: 'maintenance',
        })
      ).error,
    ),
    'partner table writes require the audited RPC',
  );
  check(
    Boolean(
      (
        await expert.client.rpc(
          'save_partner_profile',
          partnerProfile({ p_name: '전문가 등록 차단 시험' }),
        )
      ).error,
    ),
    'expert cannot create a partner profile',
  );
  const partnerIds = [];
  for (let index = 0; index < 3; index++)
    partnerIds.push(
      await required(
        owner.client.rpc(
          'save_partner_profile',
          partnerProfile({
            p_name: `가상 정비업체 ${index + 1}`,
            p_business_registration_number: `12345678${String(index + 1).padStart(2, '0')}`,
            p_contact_email: `FIXTURE-${index + 1}@EXAMPLE.INVALID`,
            p_rating: 4 + index / 10,
          }),
        ),
      ),
    );
  const ownerPrivateDetails = await required(
    owner.client
      .from('partner_private_details')
      .select('*')
      .in('partner_id', partnerIds),
  );
  check(
    ownerPrivateDetails.length === 3 &&
      ownerPrivateDetails.every(
        (detail) =>
          /^12345678\d{2}$/.test(detail.business_registration_number) &&
          detail.contact_email === detail.contact_email.toLowerCase(),
      ),
    'owner saves normalized private partner details',
  );
  check(
    (
      await client.client
        .from('partner_private_details')
        .select('*')
        .in('partner_id', partnerIds)
    ).data?.length === 0,
    'requester cannot read partner private details',
  );
  check(
    Boolean(
      (
        await owner.client.rpc(
          'save_partner_profile',
          partnerProfile({ p_name: '가상 정비업체 1' }),
        )
      ).error,
    ),
    'duplicate partner name and type are rejected',
  );
  check(
    Boolean(
      (
        await owner.client.rpc(
          'save_partner_profile',
          partnerProfile({
            p_name: '다른 이름 중복 사업자',
            p_business_registration_number: '123-45-67801',
          }),
        )
      ).error,
    ),
    'duplicate business registration is rejected within the organization',
  );
  check(
    Boolean(
      (
        await otherOwner.client.rpc(
          'save_partner_profile',
          partnerProfile({ p_partner_id: partnerIds[0] }),
        )
      ).error,
    ),
    'other organization owner cannot change partner details',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('create_quote_request_with_partners', {
          p_plant_id: plant.id,
          p_requester_user_id: client.id,
          p_title: '업체 수 부족 차단 시험',
          p_scope_summary: '합성 시험',
          p_response_due_at: null,
          p_partner_ids: partnerIds.slice(0, 2),
          p_inspection_id: inspection.id,
          p_maintenance_request_id: null,
          p_commission_rate: 7.5,
        })
      ).error,
    ),
    'quote request rejects fewer than three partners atomically',
  );
  check(
    Boolean(
      (
        await expert.client.rpc('create_quote_request_with_partners', {
          p_plant_id: plant.id,
          p_requester_user_id: client.id,
          p_title: '전문가 요청 차단 시험',
          p_scope_summary: '합성 시험',
          p_response_due_at: null,
          p_partner_ids: partnerIds,
          p_inspection_id: inspection.id,
          p_maintenance_request_id: null,
          p_commission_rate: 7.5,
        })
      ).error,
    ),
    'expert cannot create a quote request',
  );
  const quoteRequest = await required(
    owner.client.rpc('create_quote_request_with_partners', {
      p_plant_id: plant.id,
      p_requester_user_id: client.id,
      p_title: '가상 태양광 정비 견적',
      p_scope_summary: '합성 수용시험 범위',
      p_response_due_at: new Date(Date.now() + 86400000).toISOString(),
      p_partner_ids: partnerIds,
      p_inspection_id: inspection.id,
      p_maintenance_request_id: null,
      p_commission_rate: 7.5,
    }),
  );
  const requestedQuotes = await required(
    owner.client
      .from('partner_quotes')
      .select('*')
      .eq('quote_request_id', quoteRequest.id)
      .order('partner_id'),
  );
  check(
    requestedQuotes.length === 3 &&
      requestedQuotes.every((quote) => quote.status === 'requested'),
    'one transaction creates exactly three requested quotes',
  );
  check(
    (
      await client.client
        .from('quote_requests')
        .select('id')
        .eq('id', quoteRequest.id)
    ).data?.length === 1 &&
      (
        await client.client
          .from('partner_quotes')
          .select('id')
          .eq('quote_request_id', quoteRequest.id)
      ).data?.length === 0,
    'requester sees the request but not unsubmitted quotes',
  );
  for (let index = 0; index < 2; index++)
    await required(
      owner.client.rpc('record_partner_quote_response', {
        p_quote_id: requestedQuotes[index].id,
        p_amount_krw: (index + 1) * 1000000,
        p_estimated_days: (index + 1) * 3,
        p_proposed_start_on: '2026-09-15',
        p_valid_until: '2026-09-30',
        p_scope: `가상 작업 ${index + 1}`,
        p_conditions: '합성 수용시험 조건',
        p_commission_rate: 7.5,
      }),
    );
  check(
    (
      await client.client
        .from('partner_quotes')
        .select('id')
        .eq('quote_request_id', quoteRequest.id)
    ).data?.length === 2,
    'requester sees only the two submitted quotes while collecting',
  );
  check(
    Boolean(
      (
        await expert.client.rpc('record_partner_quote_response', {
          p_quote_id: requestedQuotes[2].id,
          p_amount_krw: 3000000,
          p_estimated_days: 9,
          p_proposed_start_on: null,
          p_valid_until: null,
          p_scope: '권한 차단 시험',
          p_conditions: '',
          p_commission_rate: 7.5,
        })
      ).error,
    ),
    'expert cannot record a partner response',
  );
  await required(
    owner.client.rpc('record_partner_quote_response', {
      p_quote_id: requestedQuotes[2].id,
      p_amount_krw: 3000000,
      p_estimated_days: 9,
      p_proposed_start_on: '2026-09-20',
      p_valid_until: '2026-10-10',
      p_scope: '가상 작업 3',
      p_conditions: '합성 수용시험 조건',
      p_commission_rate: 7.5,
    }),
  );
  check(
    Boolean(
      (
        await otherClient.client.rpc('select_partner_quote', {
          p_quote_id: requestedQuotes[1].id,
        })
      ).error,
    ) &&
      Boolean(
        (
          await expert.client.rpc('select_partner_quote', {
            p_quote_id: requestedQuotes[1].id,
          })
        ).error,
      ),
    'unlinked requester and expert cannot select a quote',
  );
  await required(
    client.client.rpc('select_partner_quote', {
      p_quote_id: requestedQuotes[1].id,
    }),
  );
  const selectedQuotes = await required(
    owner.client
      .from('partner_quotes')
      .select('*')
      .eq('quote_request_id', quoteRequest.id)
      .order('amount_krw'),
  );
  const selectedRequest = await required(
    client.client
      .from('quote_requests')
      .select('*')
      .eq('id', quoteRequest.id)
      .single(),
  );
  check(
    selectedRequest.status === 'selected' &&
      selectedRequest.selected_quote_id === requestedQuotes[1].id &&
      selectedQuotes.filter((quote) => quote.status === 'selected').length ===
        1 &&
      selectedQuotes[0].commission_amount_krw === 75000,
    'three responses become selectable and selection preserves commission math',
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=',
    'base64',
  );
  const uploadModule = ts
    .transpileModule(
      readFileSync(
        new URL('../lib/original-upload.ts', import.meta.url),
        'utf8',
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    )
    .outputText.replace(
      /from ['"]tus-js-client['"]/g,
      `from '${import.meta.resolve('tus-js-client')}'`,
    );
  const { sendResumableOriginal, saveOriginal, ORIGINAL_CHUNK_BYTES } =
    await import(
      `data:text/javascript;base64,${Buffer.from(uploadModule).toString('base64')}`
    );
  // Synthetic transport-only bytes, not a representative camera original.
  const large = Buffer.concat([
    png,
    Buffer.alloc(7 * 1024 * 1024 - png.length, 37),
  ]);
  large.size = large.length;
  const resumedPath = `${organization.id}/${inspection.id}/${randomUUID()}.png`;
  paths.push({ bucket: 'inspection-originals', path: resumedPath });
  const remembered = new Map();
  const urlStorage = {
    async findAllUploads() {
      return [...remembered.values()];
    },
    async findUploadsByFingerprint(fingerprint) {
      return [...remembered.values()].filter(
        (v) => v.fingerprint === fingerprint,
      );
    },
    async addUpload(fingerprint, upload) {
      const key = randomUUID();
      remembered.set(key, { ...upload, fingerprint, urlStorageKey: key });
      return key;
    },
    async removeUpload(key) {
      remembered.delete(key);
    },
  };
  const firstController = new AbortController();
  let accepted = 0;
  const transferOptions = {
    file: large,
    client: expert.client,
    userId: expert.id,
    projectUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    path: resumedPath,
    checksum: digest(large),
    mimeType: 'image/png',
    urlStorage,
    onProgress() {},
  };
  await assert.rejects(
    () =>
      sendResumableOriginal({
        ...transferOptions,
        signal: firstController.signal,
        onChunkComplete(_size, total) {
          accepted = total;
          firstController.abort();
        },
      }),
    { name: 'AbortError' },
  );
  check(
    accepted === ORIGINAL_CHUNK_BYTES && remembered.size === 1,
    'large upload pauses after acknowledged 6MB chunk',
  );
  const resumedChunks = [];
  await sendResumableOriginal({
    ...transferOptions,
    signal: new AbortController().signal,
    onChunkComplete(size) {
      resumedChunks.push(size);
    },
  });
  check(
    resumedChunks.length === 1 &&
      resumedChunks[0] === 1024 * 1024 &&
      remembered.size === 0,
    'new uploader resumes remaining 1MB and clears resume hint',
  );
  const resumedBytes = await required(
    expert.client.storage.from('inspection-originals').download(resumedPath),
  );
  check(
    digest(Buffer.from(await resumedBytes.arrayBuffer())) === digest(large),
    'resumed file checksum equals all original 7MB',
  );
  // Exercise completed-object recovery and concurrent-safe row deduplication with actual app code.
  const recoveryFile = new File([png], 'metadata-recovery.png', {
    type: 'image/png',
  });
  const recoveryPath = `${organization.id}/${inspection.id}/visible_original-${digest(png)}.png`;
  paths.push({ bucket: 'inspection-originals', path: recoveryPath });
  await required(
    expert.client.storage
      .from('inspection-originals')
      .upload(recoveryPath, png, { contentType: 'image/png' }),
  );
  const recoveryOptions = {
    file: recoveryFile,
    client: expert.client,
    userId: expert.id,
    projectUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    organizationId: organization.id,
    inspectionId: inspection.id,
    kind: 'visible_original',
    signal: new AbortController().signal,
    onProgress() {},
  };
  const [recovered, duplicate] = await Promise.all([
    saveOriginal(recoveryOptions),
    saveOriginal(recoveryOptions),
  ]);
  check(
    recovered.id === duplicate.id && recovered.captured_at === null,
    'finished-object retry registers once and does not invent a capture time',
  );
  check(
    Boolean(
      (
        await expert.client.storage
          .from('inspection-originals')
          .upload(recoveryPath, png, { contentType: 'image/png', upsert: true })
      ).error,
    ),
    'registered original overwrite denied',
  );
  check(
    Boolean(
      (
        await expert.client
          .from('inspection_files')
          .update({ sha256: 'a'.repeat(64) })
          .eq('id', recovered.id)
      ).error,
    ),
    'registered original identity cannot be rewritten',
  );
  const path = `${organization.id}/${inspection.id}/${randomUUID()}.png`;
  await required(
    expert.client.storage
      .from('inspection-originals')
      .upload(path, png, { contentType: 'image/png', upsert: false }),
  );
  paths.push({ bucket: 'inspection-originals', path });
  const file = await required(
    expert.client
      .from('inspection_files')
      .insert({
        organization_id: organization.id,
        inspection_id: inspection.id,
        kind: 'thermal_original',
        storage_bucket: 'inspection-originals',
        storage_path: path,
        original_name: '합성-시험.png',
        mime_type: 'image/png',
        bytes: png.length,
        sha256: digest(png),
        created_by: expert.id,
      })
      .select('*')
      .single(),
  );
  const downloaded = await required(
    expert.client.storage.from('inspection-originals').download(path),
  );
  check(
    digest(Buffer.from(await downloaded.arrayBuffer())) === digest(png),
    'original upload and byte integrity',
  );
  async function addPhoto(actor, id) {
    const form = new FormData();
    form.set('id', id);
    form.set('sourceId', file.id);
    form.set('caption', '가상 열화상 · 검은 영역은 가림 처리 시험');
    form.set(
      'masks',
      JSON.stringify([{ x: 0.75, y: 0.78, width: 0.22, height: 0.17 }]),
    );
    form.set('image', new Blob([testJpeg], { type: 'image/jpeg' }), 'test.jpg');
    return fetch(`${origin}/api/report-images`, {
      method: 'POST',
      body: form,
      headers: { Authorization: `Bearer ${actor.token}` },
    });
  }
  const imageId = randomUUID();
  paths.push({
    bucket: 'report-images',
    path: `${organization.id}/${inspection.id}/${imageId}.jpg`,
  });
  check(
    (await addPhoto(client, randomUUID())).status === 404,
    'requester cannot prepare report images',
  );
  check(
    (await addPhoto(otherOwner, randomUUID())).status === 404,
    'other organization cannot prepare report images',
  );
  const imageResponse = await addPhoto(expert, imageId);
  if (!imageResponse.ok) throw new Error(await imageResponse.text());
  const photo = (await imageResponse.json()).image;
  check((await addPhoto(expert, imageId)).ok, 'image save retry is idempotent');
  const pendingId = randomUUID();
  paths.push({
    bucket: 'report-images',
    path: `${organization.id}/${inspection.id}/${pendingId}.jpg`,
  });
  check(
    (await addPhoto(expert, pendingId)).ok,
    'unapproved image retained separately',
  );
  const viewPhoto = (actor, report = false, id = photo.id) =>
    fetch(
      `${origin}/api/report-images?id=${id}${report ? `&reportId=${reportId}` : ''}`,
      { headers: actor ? { Authorization: `Bearer ${actor.token}` } : {} },
    );
  const approvedPreview = await viewPhoto(owner);
  const imageBytes = Buffer.from(await approvedPreview.arrayBuffer());
  check(
    approvedPreview.ok &&
      digest(imageBytes) === photo.sha256 &&
      imageBytes.length < testJpeg.length,
    'saved image preview verifies bytes and strips JPEG metadata',
  );
  check(
    (await viewPhoto(client)).status === 404,
    'requester cannot preview internal images',
  );
  check(
    Boolean(
      (
        await expert.client.rpc('review_report_image', {
          p_id: photo.id,
          p_sha256: photo.sha256,
          p_approve: true,
        })
      ).error,
    ),
    'expert cannot approve report image',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('review_report_image', {
          p_id: photo.id,
          p_sha256: '0'.repeat(64),
          p_approve: true,
        })
      ).error,
    ),
    'review rejects stale image checksum',
  );
  await required(
    owner.client.rpc('review_report_image', {
      p_id: photo.id,
      p_sha256: photo.sha256,
      p_approve: true,
    }),
  );
  check(
    Boolean(
      (
        await owner.client.storage
          .from('report-images')
          .upload(photo.storage_path, imageBytes, {
            contentType: 'image/jpeg',
            upsert: true,
          })
      ).error,
    ),
    'approved image bytes cannot be overwritten',
  );
  const s = {
    sunHours: 3.6,
    degradationRatePercent: 0.6,
    orientationFactor: 1,
    selfUseTariff: 165,
    smp: 125,
    rec: 72,
    recWeight: 1,
    prNormal: 0.85,
    prWarning: 0.7,
    irradianceMinimum: 600,
    windWarning: 7,
    angleMinimum: 10,
    angleMaximum: 80,
    distanceMaximum: 30,
    deltaTWarning: 5,
    deltaTCritical: 10,
    improvementRates: {
      soiling: 0.9,
      string: 0.95,
      inverter: 1,
      diode: 0.7,
      cell_pid: 0.4,
    },
  };
  const setting = await required(
    owner.client.rpc('save_calculation_settings', {
      p_organization_id: organization.id,
      p_effective_from: '2020-01-01',
      p_values: s,
      p_reason: '삭제예정 수용시험 기준. 운영 단가 아님.',
    }),
  );
  const assessment = await required(
    expert.client.rpc('save_inspection_assessment', {
      p_inspection_id: inspection.id,
      p_settings_id: setting.id,
      p_capture: {
        measuredAt: new Date(Date.now() - 3600000).toISOString(),
        source: '합성 시험 기록',
        irradiance: 600,
        wind: 3,
        ambientTemperature: 25,
        angle: 45,
        distance: 20,
      },
      p_input: {
        periodStart: '2026-01-01',
        periodEnd: '2026-08-31',
        actualGenerationKwh: 60000,
        operationType: 'generation',
        repairCost: 2000000,
        defectType: 'soiling',
        generationSource: '합성 발전량 기록',
      },
      p_exception_reason: '',
      p_expected_revision: 0,
    }),
  );
  check(
    assessment.result.periodDays === 243 &&
      Math.abs(
        assessment.result.expectedGenerationKwh - 100 * 3.6 * 243 * 0.994 ** 6,
      ) < 0.00001,
    'expert assessment computed by database',
  );
  const finding = await required(
    expert.client
      .from('findings')
      .insert({
        organization_id: organization.id,
        inspection_id: inspection.id,
        source: 'expert_manual',
        source_file_id: file.id,
        kind: 'hotspot',
        defect_type: 'cell_hotspot',
        location_label: 'A열 01번',
        severity: 'major',
        disposition: 'accepted',
        temperature_max_c: 70,
        temperature_delta_c: 12,
        measurement_source: '합성 계측값 - 실제 온도 진단 아님',
        expert_note: '수용시험 소견. 현장 자료를 사용하지 않았습니다.',
        region: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      })
      .select('*')
      .single(),
  );
  const report = await required(
    expert.client.rpc('create_report_draft', {
      p_inspection_id: inspection.id,
      p_title: '가상 발전소 진단 수용시험 보고서',
    }),
  );
  reportId = report.id;
  await required(
    expert.client.rpc('transition_report_status', {
      p_report_id: reportId,
      p_next_status: 'review',
    }),
  );
  check(
    Boolean(
      (
        await expert.client.rpc('transition_report_status', {
          p_report_id: reportId,
          p_next_status: 'approved',
        })
      ).error,
    ),
    'expert cannot approve',
  );
  await required(
    owner.client.rpc('transition_report_status', {
      p_report_id: reportId,
      p_next_status: 'approved',
    }),
  );
  check(
    (await api(client)).status === 404,
    'requester cannot read unissued PDF',
  );
  const snapshot = await required(
    owner.client
      .from('report_snapshots')
      .select('*')
      .eq('report_id', reportId)
      .single(),
  );
  const pdfPath = `${organization.id}/${inspection.id}/${reportId}/${snapshot.sha256}.pdf`;
  check(
    snapshot.content.reportImages.length === 1 &&
      snapshot.content.reportImages[0].id === photo.id,
    'snapshot includes only administrator-approved images',
  );
  check(
    (await viewPhoto(client, true)).status === 404,
    'unissued report image access denied',
  );
  paths.push({ bucket: 'reports', path: pdfPath });
  const prepared = await api(owner, 'POST');
  if (!prepared.ok)
    throw new Error(
      `PDF preparation failed: ${prepared.status} ${await prepared.text()}`,
    );
  check(
    (await prepared.json()).archived === true,
    'server PDF generated and archived',
  );
  const again = await api(owner, 'POST');
  check(again.ok, 'PDF preparation is idempotent');
  check(
    Boolean(
      (await client.client.storage.from('reports').download(pdfPath)).error,
    ),
    'unissued PDF direct storage access denied',
  );
  await required(
    owner.client.rpc('transition_report_status', {
      p_report_id: reportId,
      p_next_status: 'published',
    }),
  );
  const result = await api(client);
  check(
    Boolean(
      (
        await client.client.storage
          .from('report-images')
          .download(photo.storage_path)
      ).error,
    ),
    'published images require application gateway, never direct customer storage',
  );
  check(
    Boolean(
      (await client.client.storage.from('reports').download(pdfPath)).error,
    ),
    'published PDFs require application gateway, never direct customer storage',
  );
  const customerPhoto = await viewPhoto(client, true);
  check(
    customerPhoto.ok &&
      digest(Buffer.from(await customerPhoto.arrayBuffer())) === photo.sha256,
    'requester reads exact approved report image',
  );
  check(
    (await viewPhoto(client, true, pendingId)).status === 404,
    'pending image cannot be read through a published report',
  );
  for (const blocked of [null, otherClient, otherOwner])
    check(
      [401, 404].includes((await viewPhoto(blocked, true)).status),
      'anonymous / other requester / organization report image denied',
    );
  await required(
    owner.client.rpc('review_report_image', {
      p_id: photo.id,
      p_sha256: photo.sha256,
      p_approve: false,
    }),
  );
  check(
    (await viewPhoto(client, true)).ok,
    'later exclusion does not alter existing frozen report',
  );
  check(
    result.ok && result.headers.get('content-type') === 'application/pdf',
    'requester downloads issued PDF',
  );
  const pdf = Buffer.from(await result.arrayBuffer());
  check(
    pdf.subarray(0, 5).toString() === '%PDF-',
    'download contains actual PDF bytes',
  );
  const manifest = await required(
    client.client
      .from('report_documents')
      .select('*')
      .eq('report_id', reportId)
      .single(),
  );
  check(
    digest(pdf) === manifest.pdf_sha256,
    'download matches archived checksum',
  );
  for (const blocked of [otherClient, otherOwner])
    check(
      (await api(blocked)).status === 404,
      'other requester / organization cannot download',
    );
  for (const blocked of [otherClient, otherOwner]) {
    check(
      Boolean(
        (
          await blocked.client.storage
            .from('report-images')
            .download(photo.storage_path)
        ).error,
      ),
      'cross-tenant direct image storage denied',
    );
    check(
      Boolean(
        (await blocked.client.storage.from('reports').download(pdfPath)).error,
      ),
      'cross-tenant direct PDF storage denied',
    );
  }
  check((await api(null)).status === 401, 'anonymous PDF access denied');
  const overwrite = await owner.client.storage
    .from('reports')
    .upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: true });
  check(Boolean(overwrite.error), 'archived PDF overwrite blocked');
  await required(
    owner.client
      .from('plants')
      .update({ name: '발행 후 이름 수정' })
      .eq('id', plant.id),
  );
  await required(
    expert.client
      .from('findings')
      .update({
        expert_note: '발행 후 메모 수정',
        disposition: 'modified',
        reviewed_by: expert.id,
      })
      .eq('id', finding.id),
  );
  const frozen = await required(
    client.client
      .from('report_snapshots')
      .select('*')
      .eq('report_id', reportId)
      .single(),
  );
  check(
    frozen.sha256 === snapshot.sha256 &&
      frozen.content.plant.name === '가상 한글 발전소',
    'published content remains frozen',
  );
  const second = await api(client);
  check(
    digest(Buffer.from(await second.arrayBuffer())) === digest(pdf),
    'download does not regenerate from changed source',
  );
  mkdirSync(new URL('../work/acceptance/', import.meta.url), {
    recursive: true,
  });
  const artifact = new URL('../work/acceptance/report.pdf', import.meta.url);
  writeFileSync(artifact, pdf);
  artifacts.push(fileURLToPath(artifact));
  writeFileSync(
    new URL('../work/acceptance/report-fixture.json', import.meta.url),
    JSON.stringify({ report, snapshot }, null, 2),
  );
  const certificateId = randomUUID();
  async function certificateApi(actor, id = certificateId, body) {
    return fetch(
      `${origin}/api/recycling-certificates${body ? '' : `?id=${id}`}`,
      {
        method: body ? 'POST' : 'GET',
        body,
        headers: actor ? { Authorization: `Bearer ${actor.token}` } : {},
        signal: AbortSignal.timeout(60000),
      },
    );
  }
  function certificateForm(id = certificateId, bytes = pdf, updates = {}) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      id,
      plantId: plant.id,
      title: '수용시험 재활용 증빙',
      issuer: '가상 시험 발급기관',
      number: 'SYNTHETIC-ONLY',
      issuedOn: '2026-09-01',
      panelCount: '12',
      ...updates,
    }))
      form.set(key, value);
    form.set(
      'file',
      new Blob([bytes], { type: 'application/pdf' }),
      'synthetic-certificate.pdf',
    );
    return form;
  }
  for (const actor of [null, client, expert, otherOwner])
    check(
      [401, 403, 404].includes(
        (await certificateApi(actor, certificateId, certificateForm())).status,
      ),
      'non-admin / anonymous / other organization certificate upload blocked',
    );
  check(
    (
      await certificateApi(
        owner,
        certificateId,
        certificateForm(certificateId, pdf, { issuedOn: '2026-02-30' }),
      )
    ).status === 400,
    'impossible certificate date rejected',
  );
  check(
    (
      await certificateApi(
        owner,
        certificateId,
        certificateForm(
          certificateId,
          Buffer.from('<script>not a PDF</script>'),
        ),
      )
    ).status === 400,
    'spoofed certificate extension rejected',
  );
  const certificatePath = `${organization.id}/${plant.id}/${certificateId}.pdf`;
  paths.push({ bucket: 'recycling-certificates', path: certificatePath });
  const registered = await certificateApi(
    owner,
    certificateId,
    certificateForm(),
  );
  if (!registered.ok)
    throw new Error(
      `Certificate register failed: ${registered.status} ${await registered.text()}`,
    );
  let certificate = (await registered.json()).certificate;
  check(
    certificate.status === 'pending' && certificate.sha256 === digest(pdf),
    'certificate registered privately with original checksum',
  );
  check(
    (await certificateApi(owner, certificateId, certificateForm())).ok,
    'certificate retry is idempotent',
  );
  check(
    (await certificateApi(owner, certificateId, certificateForm(randomUUID())))
      .status === 409,
    'duplicate certificate upload blocked',
  );
  check(
    (await certificateApi(client)).status === 404,
    'pending certificate invisible to requester',
  );
  check(
    (await required(client.client.from('recycling_certificates').select('*')))
      .length === 0,
    'pending certificate absent from requester listing',
  );
  check(
    Boolean(
      (
        await owner.client
          .from('recycling_certificates')
          .update({ title: 'tampered' })
          .eq('id', certificate.id)
      ).error,
    ),
    'direct certificate metadata writes blocked',
  );
  check(
    Boolean(
      (
        await owner.client.storage
          .from('recycling-certificates')
          .upload(certificatePath, pdf, {
            upsert: true,
            contentType: 'application/pdf',
          })
      ).error,
    ),
    'certificate bytes cannot be overwritten',
  );
  const reviewArgs = {
    p_id: certificate.id,
    p_revision: certificate.revision,
    p_sha256: certificate.sha256,
    p_publish: true,
    p_reason: '가상 자료·내용 확인',
  };
  const correctionArgs = {
    p_id: certificate.id,
    p_revision: certificate.revision,
    p_plant_id: plant.id,
    p_title: '수정한 수용시험 재활용 증빙',
    p_issuer: certificate.issuer,
    p_number: 'CORRECTED-ONLY',
    p_issued_on: '2026-09-02',
    p_panel_count: 10,
    p_reason: '가상 입력 오타 정정',
  };
  for (const actor of [expert, client, otherOwner])
    check(
      Boolean(
        (
          await actor.client.rpc(
            'correct_recycling_certificate',
            correctionArgs,
          )
        ).error,
      ),
      'non-admin certificate correction denied',
    );
  check(
    Boolean(
      (await expert.client.rpc('review_recycling_certificate', reviewArgs))
        .error,
    ),
    'expert cannot publish certificate',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('review_recycling_certificate', {
          ...reviewArgs,
          p_sha256: '0'.repeat(64),
        })
      ).error,
    ),
    'certificate stale checksum rejected',
  );
  certificate = await required(
    owner.client.rpc('review_recycling_certificate', reviewArgs),
  );
  check(
    Boolean(
      (await owner.client.rpc('review_recycling_certificate', reviewArgs))
        .error,
    ),
    'certificate stale revision rejected',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('correct_recycling_certificate', {
          ...correctionArgs,
          p_revision: certificate.revision,
        })
      ).error,
    ),
    'published certificate must be withdrawn before correction',
  );
  const certificateDownload = await certificateApi(client);
  check(
    certificateDownload.ok &&
      digest(Buffer.from(await certificateDownload.arrayBuffer())) ===
        digest(pdf),
    'linked requester downloads exact certificate PDF',
  );
  check(
    certificateDownload.headers.get('cache-control') === 'private, no-store' &&
      certificateDownload.headers
        .get('content-disposition')
        ?.startsWith('attachment;'),
    'certificate is no-store attachment, not executable inline content',
  );
  for (const actor of [null, otherClient, otherOwner])
    check(
      [401, 404].includes((await certificateApi(actor)).status),
      'anonymous / unlinked / cross-organization certificate access denied',
    );
  for (const actor of [owner, expert, client])
    check(
      Boolean(
        (
          await actor.client.storage
            .from('recycling-certificates')
            .download(certificatePath)
        ).error,
      ),
      'direct certificate storage read denied even to staff',
    );
  check(
    (
      await required(
        client.client
          .from('recycling_certificates')
          .select('*')
          .ilike('title', '%재활용%'),
      )
    ).length === 1,
    'requester can search published certificate',
  );
  await required(
    admin
      .from('plant_requesters')
      .delete()
      .eq('plant_id', plant.id)
      .eq('requester_user_id', client.id),
  );
  check(
    (await certificateApi(client)).status === 404,
    'removing plant assignment revokes certificate access in same session',
  );
  await required(
    admin
      .from('plant_requesters')
      .insert({ plant_id: plant.id, requester_user_id: client.id }),
  );
  certificate = await required(
    owner.client.rpc('review_recycling_certificate', {
      ...reviewArgs,
      p_revision: certificate.revision,
      p_publish: false,
      p_reason: '가상 자료 시험 회수',
    }),
  );
  check(
    (await certificateApi(client)).status === 404,
    'certificate withdrawal blocks existing requester session',
  );
  check(
    (await required(client.client.from('recycling_certificates').select('*')))
      .length === 0,
    'withdrawn certificate disappears from requester list',
  );
  check(
    Boolean(
      (await owner.client.rpc('correct_recycling_certificate', correctionArgs))
        .error,
    ),
    'stale certificate correction rejected',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('correct_recycling_certificate', {
          ...correctionArgs,
          p_revision: certificate.revision,
          p_plant_id: randomUUID(),
        })
      ).error,
    ),
    'certificate cannot move to an inaccessible plant',
  );
  check(
    Boolean(
      (
        await owner.client.rpc('correct_recycling_certificate', {
          ...correctionArgs,
          p_revision: certificate.revision,
          p_issued_on: '2999-01-01',
        })
      ).error,
    ),
    'future certificate correction date rejected',
  );
  const corrected = await required(
    owner.client.rpc('correct_recycling_certificate', {
      ...correctionArgs,
      p_revision: certificate.revision,
    }),
  );
  check(
    corrected.status === 'pending' &&
      corrected.title === correctionArgs.p_title &&
      corrected.panel_count === 10 &&
      corrected.reviewed_by === null,
    'correction returns certificate to pending with new metadata',
  );
  check(
    corrected.sha256 === certificate.sha256 &&
      corrected.storage_path === certificate.storage_path &&
      (await certificateApi(client)).status === 404,
    'correction preserves original bytes and requires fresh publication',
  );
  certificate = corrected;
  if (process.env.SOLAR_UI_ACCEPTANCE === '1') {
    await required(
      owner.client.rpc('review_recycling_certificate', {
        ...reviewArgs,
        p_revision: certificate.revision,
      }),
    );
    console.log(
      'UI_TEST_READY ' +
        JSON.stringify({
          owner: { email: owner.email, password: owner.password },
          expert: { email: expert.email, password: expert.password },
          client: { email: client.email, password: client.password },
          plantId: plant.id,
          inspectionId: inspection.id,
          certificateId,
          reportId,
        }),
    );
    console.log(
      'Synthetic-only UI test pause. Send a newline to clean up. Auto-cleanup after 45 minutes.',
    );
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 45 * 60 * 1000);
      process.stdin.once('data', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Browser logout revokes that actor's Auth session. Renew this test's
    // clients so the final withdrawal checks prove authorization, not merely 401.
    for (const actor of users) {
      const signed = await required(
        actor.client.auth.signInWithPassword({
          email: actor.email,
          password: actor.password,
        }),
      );
      actor.token = signed.session.access_token;
    }
    // UI tests may have added certificates; remove only this generated organization's files.
    const uiCertificates = await required(
      admin
        .from('recycling_certificates')
        .select('storage_path')
        .eq('organization_id', organization.id),
    );
    for (const row of uiCertificates)
      if (
        !paths.some(
          (p) =>
            p.bucket === 'recycling-certificates' &&
            p.path === row.storage_path,
        )
      )
        paths.push({
          bucket: 'recycling-certificates',
          path: row.storage_path,
        });
  }
  await required(
    owner.client.rpc('transition_report_status', {
      p_report_id: reportId,
      p_next_status: 'withdrawn',
      p_reason: '수용시험 종료',
    }),
  );
  check(
    (await api(client)).status === 404,
    'withdrawal immediately removes requester access',
  );
  check(
    (await viewPhoto(client, true)).status === 404,
    'withdrawal removes image API access',
  );
  const withdrawnImage = await client.client.storage
    .from('report-images')
    .download(photo.storage_path, {}, { cache: 'no-store' });
  check(
    Boolean(withdrawnImage.error),
    'withdrawal removes direct image storage access',
  );
  check(
    Boolean(
      (await client.client.storage.from('reports').download(pdfPath)).error,
    ),
    'withdrawal removes direct PDF storage access',
  );
  await required(client.client.auth.signOut({ scope: 'global' }));
  check(
    (await api(client)).status === 401,
    'logged-out Auth token is rejected before report authorization',
  );
  const renewed = await required(
    client.client.auth.signInWithPassword({
      email: client.email,
      password: client.password,
    }),
  );
  client.token = renewed.session.access_token;
  check(
    (await api(client)).status === 404,
    'renewed session still cannot read withdrawn report',
  );
} catch (error) {
  failure = error;
  console.error(`Acceptance failure: ${error.message}`);
} finally {
  // Collect only objects belonging to this run's generated organizations,
  // including extra evidence created through the browser during an opted-in UI test.
  for (const organizationId of organizations)
    for (const [table, bucket] of [
      ['report_images', 'report-images'],
      ['recycling_certificates', 'recycling-certificates'],
    ]) {
      const result = await admin
        .from(table)
        .select('storage_path')
        .eq('organization_id', organizationId);
      if (result.error)
        cleanupErrors.push(`${table} collection: ${result.error.message}`);
      else
        for (const row of result.data || [])
          if (
            !paths.some(
              (p) => p.bucket === bucket && p.path === row.storage_path,
            )
          )
            paths.push({ bucket, path: row.storage_path });
    }
  for (const object of paths) {
    const r = await admin.storage.from(object.bucket).remove([object.path]);
    if (r.error) cleanupErrors.push(`storage: ${r.error.message}`);
  }
  if (reportId) {
    for (const table of ['report_documents', 'report_snapshots']) {
      const r = await admin.from(table).delete().eq('report_id', reportId);
      if (r.error) cleanupErrors.push(`${table}: ${r.error.message}`);
    }
  }
  for (const organizationId of organizations) {
    const quoteRows = await admin
      .from('quote_requests')
      .select('id')
      .eq('organization_id', organizationId);
    if (quoteRows.error)
      cleanupErrors.push(
        `quote request collection: ${quoteRows.error.message}`,
      );
    else if (quoteRows.data.length) {
      const r = await admin
        .from('quote_request_findings')
        .delete()
        .in(
          'quote_request_id',
          quoteRows.data.map((row) => row.id),
        );
      if (r.error)
        cleanupErrors.push(`quote_request_findings: ${r.error.message}`);
    }
    const partnerRows = await admin
      .from('partners')
      .select('id')
      .eq('organization_id', organizationId);
    if (partnerRows.error)
      cleanupErrors.push(`partner collection: ${partnerRows.error.message}`);
    else if (partnerRows.data.length)
      for (const table of ['partner_users', 'partner_private_details']) {
        const r = await admin
          .from(table)
          .delete()
          .in(
            'partner_id',
            partnerRows.data.map((row) => row.id),
          );
        if (r.error) cleanupErrors.push(`${table}: ${r.error.message}`);
      }
    for (const table of [
      'recycling_certificates',
      'partner_quotes',
      'quote_requests',
      'partners',
      'reports',
      'report_images',
      'findings',
      'analysis_runs',
      'inspection_assessments',
      'inspection_files',
      'maintenance_requests',
      'inspections',
    ]) {
      const r = await admin
        .from(table)
        .delete()
        .eq('organization_id', organizationId);
      if (r.error) cleanupErrors.push(`${table}: ${r.error.message}`);
    }
    const plants = await required(
      admin.from('plants').select('id').eq('organization_id', organizationId),
    );
    for (const p of plants) {
      const r = await admin
        .from('plant_requesters')
        .delete()
        .eq('plant_id', p.id);
      if (r.error) cleanupErrors.push(`access: ${r.error.message}`);
    }
    for (const table of ['plants', 'calculation_settings', 'audit_events']) {
      const r = await admin
        .from(table)
        .delete()
        .eq('organization_id', organizationId);
      if (r.error) cleanupErrors.push(`${table}: ${r.error.message}`);
    }
    const r = await admin
      .from('organizations')
      .delete()
      .eq('id', organizationId);
    if (r.error) cleanupErrors.push(`organization: ${r.error.message}`);
  }
  for (const u of users) {
    await u.client.auth.signOut({ scope: 'global' });
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) cleanupErrors.push(`user: ${r.error.message}`);
  }
  if (!cleanupErrors.length)
    console.log(
      `Removed ${users.length} synthetic users and ${organizations.length} test organizations.`,
    );
}
if (cleanupErrors.length)
  throw new Error(`Test cleanup incomplete: ${cleanupErrors.join('; ')}`);
if (failure) throw failure;
console.log(JSON.stringify({ passed: checks, artifacts }, null, 2));
