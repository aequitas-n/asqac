import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
test('live Supabase dashboard changes without reload and doctor closes the simulated journey', async ({
  page,
}) => {
  const checkpoints: string[] = [];
  let capsuleId: string | undefined;
  let transportId: string | undefined;
  const url = process.env.VITE_SUPABASE_URL!,
    key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
  const token = process.env.DEVICE_TOKEN!;
  const finalDoctor = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let complete = false;
  try {
    await mkdir('docs/live', { recursive: true });
    await page.goto('/login');
    await page.getByLabel('Staff email').fill('technician@asqac.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.DEMO_TECHNICIAN_PASSWORD || 'technician');
    await page.getByRole('button', { name: 'Enter workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    await expect(page.getByText('LIVE TELEMETRY', { exact: true })).toBeVisible({ timeout: 20000 });
    checkpoints.push('Technician UI login and live subscription');
    await page.getByRole('link', { name: 'Register specimen', exact: true }).click();
    await page.getByPlaceholder('e.g. REF-2048 (anonymised)').fill('ASQAC-UI-VERIFY');
    await page
      .getByPlaceholder('e.g. Separated chemistry panel')
      .fill('Live interface verification');
    await page.getByPlaceholder('e.g. Emergency ward').fill('Research bench');
    await page.getByPlaceholder('e.g. Clinical biochemistry').fill('Demo receiving');
    await page.getByLabel('Handling profile').selectOption('10000000-0000-4000-8000-000000000001');
    await page.getByLabel('Available capsule').selectOption('20000000-0000-4000-8000-000000000001');
    await page.getByRole('button', { name: 'Register & reserve capsule' }).click();
    await expect(
      page.getByRole('heading', { name: 'Registered. Reserved. Ready for preparation.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Prepare transport', exact: true }).click();
    capsuleId = page.url().split('/').at(-1);
    await page.getByRole('button', { name: 'Prepare transport', exact: true }).click();
    await page.getByRole('button', { name: 'Start transport', exact: true }).click();
    checkpoints.push('Registration, preparation, and start through real RPCs');
    await page.getByRole('button', { name: 'Simulator', exact: true }).click();
    await page.getByLabel('Device token').fill(token);
    await page.getByRole('button', { name: 'Start simulator', exact: true }).click();
    await expect(page.getByText('SIMULATED · 1 packets accepted · 10 s interval')).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    const meter = page.getByRole('meter', { name: 'Temperature', exact: true });
    await expect(meter).toHaveAttribute('aria-valuenow', '5');
    let reloads = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads++;
    });
    await expect(meter).not.toHaveAttribute('aria-valuenow', '5', { timeout: 18000 });
    expect(reloads).toBe(0);
    checkpoints.push('Second simulator packet updated the gauge through Realtime without reload');
    const prior = await page.locator('.compact-alerts > div').count();
    await page.getByRole('button', { name: 'Simulated', exact: true }).click();
    await page.getByLabel('Stress scenario').check();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect
      .poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 45000 })
      .toBeGreaterThan(8);
    await expect(page.locator('.compact-alerts > div')).toHaveCount(prior + 1, { timeout: 15000 });
    expect(reloads).toBe(0);
    checkpoints.push('Stress excursion and alert arrived live without reload');
    await page.getByRole('button', { name: 'Simulated', exact: true }).click();
    await page.getByRole('button', { name: 'Stop simulator', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: 'docs/live/capsule-live.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster]{visibility:hidden}',
    });
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    await page.screenshot({
      path: 'docs/live/dashboard-live.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster]{visibility:hidden}',
    });
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Staff email').fill('doctor@asqac.test');
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.DEMO_DOCTOR_PASSWORD || 'doctor');
    await page.getByRole('button', { name: 'Enter workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    await page.getByRole('link', { name: 'Open capsule', exact: true }).click();
    await page.getByRole('button', { name: 'Receive & end transport' }).click();
    await page.getByRole('button', { name: 'Review & record verdict' }).click();
    await page
      .getByPlaceholder('Record the clinical reasoning for this disposition.')
      .fill('Simulated live UI verification. Deliberate stress excursion; no patient specimen.');
    await page.getByRole('button', { name: 'Record verdict & close journey' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    checkpoints.push('Doctor login, receive, and final verdict through real backend');
    complete = true;
  } finally {
    if (capsuleId) {
      const auth = await finalDoctor.auth.signInWithPassword({
        email: 'doctor@asqac.test',
        password: process.env.DEMO_DOCTOR_PASSWORD || 'doctor',
      });
      if (auth.error) throw auth.error;
      const { data: current } = await finalDoctor
        .from('transports')
        .select('*')
        .eq('capsule_id', capsuleId)
        .neq('state', 'closed')
        .maybeSingle();
      if (current) {
        const { data: specimen } = await finalDoctor
          .from('specimens')
          .select('patient_ref')
          .eq('id', current.specimen_id)
          .single();
        if (specimen?.patient_ref === 'ASQAC-UI-VERIFY') {
          transportId = current.id;
          if (current.state === 'in_transit')
            await finalDoctor.rpc('transition_transport', {
              p_transport: current.id,
              p_action: 'arrive',
            });
          const { error } = await finalDoctor.rpc('transition_transport', {
            p_transport: current.id,
            p_action: 'close',
            p_verdict: 'review_required',
            p_notes: 'Incomplete automated UI verification; simulated research record only.',
          });
          if (error) console.error('Verification cleanup:', error.message);
        }
      }
      await finalDoctor.auth.signOut({ scope: 'local' });
    }
    await writeFile(
      'docs/live/browser-verification.json',
      JSON.stringify(
        {
          project_ref: 'chhpbpqoaikbcicxdnzj',
          checked_at: new Date().toISOString(),
          result: complete ? 'pass' : 'incomplete',
          checkpoints,
          cleanup_transport: transportId ?? null,
          real_cloud: true,
        },
        null,
        2,
      ) + '\n',
    );
  }
});
