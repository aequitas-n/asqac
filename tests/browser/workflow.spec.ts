import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { connectLocalBackend, token } from './local-backend';
test('technician registers, starts, simulates, then doctor receives and records a verdict', async ({
  page,
}) => {
  const db = await connectLocalBackend(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await mkdir('docs/screenshots', { recursive: true });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.screenshot({
      path: 'docs/screenshots/login.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.getByLabel('Staff email').fill('technician@asqac.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-only-password');
    await page.getByRole('button', { name: 'Enter workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    await page.keyboard.press(process.platform==='darwin'?'Meta+k':'Control+k');
    await expect(page.getByRole('dialog',{name:'Search your workspace'})).toBeVisible();
    await page.getByRole('textbox',{name:'Search workspace'}).fill('CAP0001');
    await expect(page.getByRole('dialog').getByText('CAP0001',{exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Register specimen', exact: true }).click();
    await page.getByRole('button', { name: 'Register & reserve capsule' }).click();
    await expect(page.getByText('Enter an anonymised patient reference.')).toBeVisible();
    await page.getByPlaceholder('e.g. REF-2048 (anonymised)').fill('TEST-REF-2048');
    await page.getByPlaceholder('e.g. Separated chemistry panel').fill('Research chemistry panel');
    await page.getByPlaceholder('e.g. Emergency ward').fill('Emergency ward');
    await page.getByPlaceholder('e.g. Clinical biochemistry').fill('Clinical biochemistry');
    await page
      .getByLabel('Available capsule')
      .selectOption({ label: 'CAP0001 · Clinical chemistry capsule' });
    await page.getByRole('button', { name: 'Register & reserve capsule' }).click();
    await expect(
      page.getByRole('heading', { name: 'Registered. Reserved. Ready for preparation.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Prepare transport' }).click();
    await page.getByRole('button', { name: 'Prepare transport', exact: true }).click();
    await page.getByRole('button', { name: 'Start transport', exact: true }).click();
    await expect(page.getByText('No open journey', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Simulator', exact: true }).click();
    await page.getByLabel('Device token').fill(token);
    await page.getByRole('button', { name: 'Start simulator', exact: true }).click();
    await expect(page.getByText('SIMULATED · 1 packets accepted · 10 s interval')).toBeVisible();
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('meter', { name: 'Temperature', exact: true })).toHaveAttribute(
      'aria-valuenow',
      '21.5',
    );
    await page.screenshot({
      path: 'docs/screenshots/capsule-console.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.getByRole('button', { name: 'Simulated', exact: true }).click();
    await page.getByRole('button', { name: 'Stop simulator' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await page.screenshot({
      path: 'docs/screenshots/dashboard.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.getByText('Sensor trends & fleet details',{exact:true}).click();
    await expect(page.getByRole('link',{name:'Open CAP0001',exact:true})).toBeVisible();
    await page.getByText('Sensor trends & fleet details',{exact:true}).click();
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Transport reports' })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(2);
    await page.screenshot({
      path: 'docs/screenshots/reports.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export custody CSV' }).click();
    expect((await download).suggestedFilename()).toContain('ASQAC-custody');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
    await page.getByLabel('Staff email').fill('doctor@asqac.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-only-password');
    await page.getByRole('button', { name: 'Enter workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Register', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Open capsule', exact: true }).click();
    await page.getByRole('button', { name: 'Receive & end transport' }).click();
    await page.getByRole('button', { name: 'Review & record verdict' }).click();
    await expect(
      page.getByRole('button', { name: 'Record verdict & close journey' }),
    ).toBeDisabled();
    await page
      .getByPlaceholder('Record the clinical reasoning for this disposition.')
      .fill('Simulated research journey; repeat under validated conditions.');
    await page.screenshot({
      path: 'docs/screenshots/doctor-verdict.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.getByRole('button', { name: 'Record verdict & close journey' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const closed = await db.query(
      "select * from public.transports where state='closed' and verdict_notes like 'Simulated research%'",
    );
    expect(closed.rows).toHaveLength(1);
    const transport = closed.rows[0];
    await page.goto(`/reports/${transport.id}`);
    await expect(page.getByRole('heading', { name: 'Every custody event' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await page.screenshot({
      path: 'docs/screenshots/transport-report-print.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.pdf({
      path: 'docs/screenshots/transport-report.pdf',
      format: 'A4',
      printBackground: true,
    });
    await page.emulateMedia({ media: 'screen' });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await db.close();
  }
});
test('unconfigured setup preview has honest empty states and no working mutation controls', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5299/login');
  await page.getByRole('button', { name: 'Explore the interface before connecting' }).click();
  await expect(page.getByText('SETUP MODE', { exact: true })).toBeVisible();
  await page.getByText('Sensor trends & fleet details', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your connected fleet starts here' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Simulator', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start simulator', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Register', exact: true }).click();
  await page.getByRole('button', { name: 'Register & reserve capsule' }).click();
  await expect(page.getByText('Assign an available capsule.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});
test('mobile layouts, fleet filters, hardware and keyboard-accessible simulator', async ({
  page,
}) => {
  const db = await connectLocalBackend(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByLabel('Staff email').fill('technician@asqac.test');
    await page.getByLabel('Password', { exact: true }).fill('local-test-password');
    await page.getByRole('button', { name: 'Enter workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Specimen overview' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: 'docs/screenshots/mobile-overview.png',
      fullPage: true,
      animations: 'disabled',
      style: '[data-sonner-toaster] { visibility: hidden; }',
    });
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('link', { name: 'Capsules', exact: true }).click();
    await page.getByRole('button', { name: 'Maintenance 0' }).click();
    await expect(
      page.getByRole('heading', { name: 'No capsules match your filters' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('link', { name: 'Hardware', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Capsule hardware' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.getByRole('button', { name: 'Simulator', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await page.close();
    await db.close();
  }
});
